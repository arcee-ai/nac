#![cfg(unix)]
#![allow(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    reason = "disposable real-process contracts must fail immediately"
)]

use std::io::{BufRead, BufReader, Read, Write};
use std::os::{fd::AsRawFd, unix::net::UnixStream, unix::process::CommandExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use nac_core::sessions::StoreProcessLease;
use rusqlite::Connection;
use serde_json::{json, Value};

const BINARY: &str = env!("CARGO_BIN_EXE_nac-web");
const GUIDANCE: &str = "The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.";

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    bytes: Option<Vec<u8>>,
    modified: Option<SystemTime>,
}

fn snapshot(path: &Path) -> Snapshot {
    match std::fs::read(path) {
        Ok(bytes) => Snapshot {
            bytes: Some(bytes),
            modified: Some(std::fs::metadata(path).unwrap().modified().unwrap()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Snapshot {
            bytes: None,
            modified: None,
        },
        Err(error) => panic!("snapshot failed: {error}"),
    }
}

fn sqlite_snapshot(path: &Path) -> [Snapshot; 3] {
    ["", "-wal", "-shm"].map(|suffix| {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        snapshot(Path::new(&name))
    })
}

fn databases(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            found.extend(databases(&entry.path()));
        } else if entry.path().extension().is_some_and(|ext| ext == "db") {
            found.push(entry.path());
        }
    }
    found.sort();
    found
}

fn command(root: &Path) -> Command {
    let mut command = Command::new(BINARY);
    command
        .env_clear()
        .env("HOME", root.join("home"))
        .env("NAC_HOME", root.join("nac"))
        .env("TMPDIR", root.join("tmp"))
        .env("PATH", "/usr/bin:/bin")
        .env("NAC_TELEMETRY", "disabled")
        .current_dir(root)
        .stdin(Stdio::null());
    command
}

fn run_case(wal: bool, owned: bool, invalid: bool) {
    let root = std::env::temp_dir().join(format!("nac desktop schema {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let fixture = Fixture(root.canonicalize().unwrap());
    let root = &fixture.0;
    for name in ["home", "nac", "tmp", "selected store"] {
        std::fs::create_dir(root.join(name)).unwrap();
    }
    let store = root.join("selected store/selected.db");
    let config = root.join("nac/config.toml");
    std::fs::write(
        &config,
        format!("[storage]\nstore_path = '{}'\n", store.display()),
    )
    .unwrap();
    let config_before = snapshot(&config);
    let keeper = if invalid {
        std::fs::write(&store, b"invalid-sqlite-private-canary").unwrap();
        None
    } else {
        let connection = Connection::open(&store).unwrap();
        connection.execute_batch("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('retained-store-data');").unwrap();
        connection
            .pragma_update(None, "user_version", nac_core::store::schema_version())
            .unwrap();
        if wal {
            connection
                .pragma_update(None, "journal_mode", "WAL")
                .unwrap();
            connection
                .pragma_update(None, "wal_autocheckpoint", 0)
                .unwrap();
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .unwrap();
        }
        connection
            .pragma_update(None, "user_version", nac_core::store::schema_version() + 1)
            .unwrap();
        if wal {
            let bytes = std::fs::read(&store).unwrap();
            assert_eq!(
                u32::from_be_bytes(bytes[60..64].try_into().unwrap()) as i64,
                nac_core::store::schema_version()
            );
            Some(connection)
        } else {
            drop(connection);
            None
        }
    };
    let before = sqlite_snapshot(&store);
    let lease = owned.then(|| StoreProcessLease::try_acquire(&store).unwrap());
    let identity_output = command(root).arg("__desktop-identity").output().unwrap();
    assert!(identity_output.status.success());
    let identity: Value = serde_json::from_slice(&identity_output.stdout).unwrap();
    assert_eq!(identity.as_object().unwrap().len(), 4);

    let selection_output = command(root)
        .args(["__desktop-configuration", "--directory"])
        .arg(root)
        .output()
        .unwrap();
    assert!(selection_output.status.success());
    let selection: Value = serde_json::from_slice(&selection_output.stdout).unwrap();
    assert_eq!(
        selection,
        json!({"version":1,"status":"selected","root_cwd":root,"store":store,"track":identity["track"]})
    );
    assert_eq!(sqlite_snapshot(&store), before);
    assert_eq!(snapshot(&config), config_before);
    if !owned {
        drop(
            StoreProcessLease::try_acquire(&store)
                .expect("configuration discovery must not own the store"),
        );
    }

    let (mut parent, child) = UnixStream::pair().unwrap();
    parent
        .set_read_timeout(Some(Duration::from_secs(12)))
        .unwrap();
    parent
        .set_write_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let fd = child.as_raw_fd();
    let mut launch = command(root);
    launch
        .args(["--bind", "127.0.0.1:0", "--directory"])
        .arg(root)
        .arg("--store-path")
        .arg(&store)
        .arg("--no-open")
        .env("NAC_DESKTOP_CHANNEL_FD", fd.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    // SAFETY: only the exact connected child endpoint is inherited by this
    // disposable process. No other descriptor or process authority changes.
    unsafe {
        launch.pre_exec(move || {
            let flags = libc::fcntl(fd, libc::F_GETFD);
            if flags < 0 || libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut process = ChildGuard(launch.spawn().unwrap());
    drop(child);
    let incarnation = uuid::Uuid::new_v4().to_string();
    writeln!(parent, "{}", json!({"kind":"hello","version":1,"incarnation":incarnation,"identity":identity,"store":store})).unwrap();
    let mut reader = BufReader::new(parent);
    let mut bytes = Vec::new();
    let count = reader
        .by_ref()
        .take(16 * 1024 + 1)
        .read_until(b'\n', &mut bytes)
        .unwrap();
    assert!((1..=16 * 1024).contains(&count) && bytes.last() == Some(&b'\n'));
    let receipt: Value = serde_json::from_slice(&bytes).unwrap();
    let deadline = Instant::now() + Duration::from_secs(12);
    let status = loop {
        if let Some(status) = process.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "failed startup did not retire its child"
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(status.code(), Some(1));
    let mut trailing = Vec::new();
    reader.read_to_end(&mut trailing).unwrap();
    assert!(
        trailing.is_empty(),
        "a failed launch published another record"
    );
    let mut diagnostics = String::new();
    process
        .0
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut diagnostics)
        .unwrap();
    assert!(!diagnostics.contains("invalid-sqlite-private-canary"));
    assert_eq!(
        sqlite_snapshot(&store),
        before,
        "failed startup changed SQLite files"
    );
    assert_eq!(snapshot(&config), config_before);
    assert_eq!(databases(root), [store.clone()]);
    drop(lease);
    drop(StoreProcessLease::try_acquire(&store).expect("failed child retained the serving lease"));

    let code = if owned {
        "store_owned"
    } else if invalid {
        "engine_unavailable"
    } else {
        "store_schema_incompatible"
    };
    assert_eq!(receipt["kind"], "failed");
    assert_eq!(receipt["version"], 1);
    assert_eq!(receipt["incarnation"], incarnation);
    assert_eq!(receipt["stage"], "startup");
    assert_eq!(receipt["code"], code, "{receipt}");
    assert!(receipt.get("endpoint").is_none());
    assert!(!String::from_utf8_lossy(&bytes).contains("invalid-sqlite-private-canary"));
    if !owned && !invalid {
        assert_eq!(receipt["message"], GUIDANCE);
    }
    drop(keeper);
}

#[test]
fn future_main_store_is_selected_then_rejected_with_guidance() {
    run_case(false, false, false);
}

#[test]
fn future_wal_store_is_selected_then_rejected_without_pager_changes() {
    run_case(true, false, false);
}

#[test]
fn owned_future_store_retains_store_owned_priority() {
    run_case(true, true, false);
}

#[test]
fn unrelated_invalid_store_retains_generic_failure() {
    run_case(false, false, true);
}
