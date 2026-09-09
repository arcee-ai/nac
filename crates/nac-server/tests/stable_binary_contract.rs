#![allow(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    reason = "integration-test setup and assertions should fail immediately"
)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nac_core::projects::{insert_project, list_projects, NewProject};
use serde_json::Value;
use sha2::{Digest, Sha256};

const BINARY: &str = env!("CARGO_BIN_EXE_nac-web");

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[derive(Debug, PartialEq, Eq)]
struct FileSnapshot {
    bytes: Option<Vec<u8>>,
    sha256: Option<[u8; 32]>,
    created: Option<SystemTime>,
    modified: Option<SystemTime>,
}

fn temp_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "nac_stable_binary_{label}_{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn sqlite_sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

fn snapshot_file(path: &Path) -> FileSnapshot {
    match std::fs::read(path) {
        Ok(bytes) => {
            let metadata = std::fs::metadata(path).unwrap();
            FileSnapshot {
                sha256: Some(Sha256::digest(&bytes).into()),
                created: metadata.created().ok(),
                modified: Some(metadata.modified().unwrap()),
                bytes: Some(bytes),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => FileSnapshot {
            bytes: None,
            sha256: None,
            created: None,
            modified: None,
        },
        Err(error) => panic!("failed to snapshot {}: {error}", path.display()),
    }
}

fn snapshot_sqlite_files(path: &Path) -> [FileSnapshot; 3] {
    [
        snapshot_file(path),
        snapshot_file(&sqlite_sidecar(path, "-wal")),
        snapshot_file(&sqlite_sidecar(path, "-shm")),
    ]
}

fn create_fixture(label: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = temp_root(label);
    let repository_root = root.join("repositories");
    let state_root = root.join("state");
    let home_root = root.join("home");
    let project_root = root.join("project");
    for path in [
        &root,
        &repository_root,
        &state_root,
        &home_root,
        &project_root,
    ] {
        std::fs::create_dir_all(path).unwrap();
    }
    let credential = root.join("model-token");
    std::fs::write(&credential, b"stable-binary-test-key\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let config = root.join("managed.toml");
    std::fs::write(
        &config,
        format!(
            "version = 1\n\
             logical_host_id = \"stable-contract-host\"\n\
             owner = \"owner@example.test\"\n\
             public_hostname = \"stable-contract.example.test\"\n\
             repository_root = \"{}\"\n\
             state_root = \"{}\"\n\
             home_root = \"{}\"\n\
             github_client_id = \"Iv1.stable-contract\"\n\
             model_backend = \"arcee-api\"\n\
             model_id = \"trinity-large-thinking\"\n\
             model_endpoint = \"https://api.arcee.ai/api/v1\"\n\
             model_credential_file = \"{}\"\n\
             model_credential_environment_names = [\"ARCEE_API_KEY\"]\n",
            repository_root.display(),
            state_root.display(),
            home_root.display(),
            credential.display()
        ),
    )
    .unwrap();
    (root, config, state_root)
}

fn reserve_address() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap()
}

fn start_server_at(
    address: SocketAddr,
    root: &Path,
    config: &Path,
    state_root: &Path,
    store: &Path,
) -> ChildGuard {
    let child = Command::new(BINARY)
        .arg("--bind")
        .arg(address.to_string())
        .arg("--directory")
        .arg(root)
        .arg("--store-path")
        .arg(store)
        .arg("--managed-config")
        .arg(config)
        .args(["--no-open", "--yes"])
        .env("NAC_HOME", state_root)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut guard = ChildGuard(child);
    let mut last_error = None;
    for _ in 0..500 {
        match http_json(address, "/healthz") {
            Ok(_) => return guard,
            Err(error) => last_error = Some(error),
        }
        if let Some(status) = guard.0.try_wait().unwrap() {
            panic!("stable binary exited before listening: {status}");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!(
        "stable binary did not answer at {address}: {}",
        last_error.unwrap()
    );
}

fn http_json(address: SocketAddr, path: &str) -> std::io::Result<(u16, Value)> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(100))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let (head, body) = response.split_once("\r\n\r\n").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "missing HTTP separator")
    })?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing status"))?;
    let body = if head
        .lines()
        .any(|line| line.eq_ignore_ascii_case("transfer-encoding: chunked"))
    {
        decode_chunked(body)?
    } else {
        body.to_string()
    };
    let body = serde_json::from_str(&body).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{error}; response head={head:?}; body={body:?}"),
        )
    })?;
    Ok((status, body))
}

fn decode_chunked(mut encoded: &str) -> std::io::Result<String> {
    let mut decoded = String::new();
    loop {
        let (size, rest) = encoded.split_once("\r\n").ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "missing chunk size")
        })?;
        let size = usize::from_str_radix(size.split(';').next().unwrap(), 16)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        if size == 0 {
            return Ok(decoded);
        }
        if rest.len() < size + 2 || !rest.is_char_boundary(size) || &rest[size..size + 2] != "\r\n"
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid HTTP chunk",
            ));
        }
        decoded.push_str(&rest[..size]);
        encoded = &rest[size + 2..];
    }
}

fn assert_identity_and_schema(value: &Value, opened: i64, state: &str, maintenance: &str) {
    assert_eq!(value["build_track"], "stable");
    assert_eq!(
        value["build_id"],
        format!("v{}", include_str!("../../../version.txt").trim())
    );
    assert_eq!(value["source_revision"], env!("NAC_SOURCE_REVISION"));
    assert_eq!(
        value["product_version"],
        include_str!("../../../version.txt").trim()
    );
    assert_eq!(value["version"], value["product_version"]);
    assert_eq!(
        value["supported_schema_version"],
        nac_core::store::schema_version()
    );
    assert_eq!(
        value["minimum_migratable_schema_version"],
        nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION
    );
    assert_eq!(value["opened_schema_version"], opened);
    assert_eq!(value["migration_state"], state);
    assert_eq!(value["maintenance_state"], maintenance);
}

#[test]
fn stable_binary_reports_identity_and_preserves_future_store_on_real_http_routes() {
    if env!("NAC_BUILD_TRACK") != "stable" {
        eprintln!("stable binary contract runs through make test-stable-binary");
        return;
    }
    assert_eq!(
        env!("NAC_BUILD_ID"),
        format!("v{}", include_str!("../../../version.txt").trim())
    );
    assert_eq!(env!("NAC_SOURCE_REVISION").len(), 40);

    let (root, config, state_root) = create_fixture("current");
    let store = root.join("stable.db");
    nac_core::store::initialize(&store).unwrap();
    insert_project(
        &store,
        NewProject {
            project_id: "stable-sentinel".to_string(),
            name: Some("Stable sentinel".to_string()),
            description: Some("must survive future-schema refusal".to_string()),
            cwd: root.join("project"),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    let address = reserve_address();
    let server = start_server_at(address, &root, &config, &state_root, &store);
    let (ready_status, ready) = http_json(address, "/readyz").unwrap();
    assert!(matches!(ready_status, 200 | 503));
    assert_identity_and_schema(
        &ready,
        nac_core::store::schema_version(),
        "current",
        "serving",
    );
    let (status, managed) = http_json(address, "/managed/status").unwrap();
    assert_eq!(status, 200);
    assert_identity_and_schema(
        &managed,
        nac_core::store::schema_version(),
        "current",
        "serving",
    );
    drop(server);

    let future_version = nac_core::store::schema_version() + 1;
    for with_sidecars in [false, true] {
        nac_core::test_support::store::set_test_schema_version(
            &store,
            nac_core::store::schema_version(),
        )
        .unwrap();
        let connection = rusqlite::Connection::open(&store).unwrap();
        connection
            .pragma_update(
                None,
                "journal_mode",
                if with_sidecars { "WAL" } else { "DELETE" },
            )
            .unwrap();
        if with_sidecars {
            connection
                .pragma_update(None, "wal_autocheckpoint", 0)
                .unwrap();
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .unwrap();
        }
        connection
            .pragma_update(None, "user_version", future_version)
            .unwrap();
        let open = if with_sidecars {
            Some(connection)
        } else {
            drop(connection);
            None
        };
        let main_header = std::fs::read(&store).unwrap();
        if with_sidecars {
            assert_eq!(
                &main_header[60..64],
                &(nac_core::store::schema_version() as u32).to_be_bytes(),
                "future schema must exist only in the uncheckpointed WAL"
            );
            assert_eq!(&main_header[18..20], &[2, 2]);
            assert!(sqlite_sidecar(&store, "-wal").exists());
            assert!(sqlite_sidecar(&store, "-shm").exists());
        } else {
            assert_eq!(&main_header[60..64], &(future_version as u32).to_be_bytes());
            assert_eq!(&main_header[18..20], &[1, 1]);
            assert!(!sqlite_sidecar(&store, "-wal").exists());
            assert!(!sqlite_sidecar(&store, "-shm").exists());
        }
        let before = snapshot_sqlite_files(&store);
        let address = reserve_address();
        let server = start_server_at(address, &root, &config, &state_root, &store);
        let (status, ready) = http_json(address, "/readyz").unwrap();
        assert_eq!(status, 503);
        assert_identity_and_schema(&ready, future_version, "failed", "recovery-only");
        assert_eq!(ready["migration_failure"], "future-schema");
        let (status, managed) = http_json(address, "/managed/status").unwrap();
        assert_eq!(status, 200);
        assert_identity_and_schema(&managed, future_version, "failed", "recovery-only");
        assert_eq!(managed["migration_failure"], "future-schema");
        drop(server);
        assert_eq!(
            snapshot_sqlite_files(&store),
            before,
            "full stable-binary startup changed future-schema files"
        );
        if let Some(open) = open.as_ref() {
            assert_eq!(
                open.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                    .unwrap(),
                future_version
            );
            assert_eq!(
                open.query_row("SELECT COUNT(*) FROM projects", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
        drop(open);
    }

    for suffix in ["-wal", "-shm"] {
        let sidecar = sqlite_sidecar(&store, suffix);
        if sidecar.exists() {
            std::fs::remove_file(sidecar).unwrap();
        }
    }
    nac_core::test_support::store::set_test_schema_version(
        &store,
        nac_core::store::schema_version(),
    )
    .unwrap();
    let projects = list_projects(&store).unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].project_id, "stable-sentinel");
    let _ = std::fs::remove_dir_all(root);
}
