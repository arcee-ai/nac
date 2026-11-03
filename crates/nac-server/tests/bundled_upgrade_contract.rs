#![cfg(unix)]
#![allow(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    reason = "isolated binary contract fixtures fail immediately"
)]

// These execute the real CLI in a disposable bundle-shaped directory. They
// qualify self-upgrade refusal, not a signed native app or replacement journey.
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    net::TcpListener,
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const BINARY: &str = env!("CARGO_BIN_EXE_nac-web");
static BINARY_EXECUTION: Mutex<()> = Mutex::new(());
type Snapshot = BTreeMap<PathBuf, (u32, u64, std::time::SystemTime, Vec<u8>)>;

struct Fixture {
    root: PathBuf,
    engine: PathBuf,
    marker: PathBuf,
    identity: Value,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-bundled-upgrade-{}", uuid::Uuid::new_v4()));
        let resources = root.join("NAC fixture with spaces.app/Contents/Resources");
        fs::create_dir_all(&resources).unwrap();
        let engine = resources.join("nac-web");
        fs::copy(BINARY, &engine).unwrap();
        let identity = Command::new(BINARY)
            .arg("__desktop-identity")
            .output()
            .unwrap();
        assert!(identity.status.success());
        let identity: Value = serde_json::from_slice(&identity.stdout).unwrap();
        fs::write(
            resources.join("engine-identity.json"),
            serde_json::to_vec(&identity).unwrap(),
        )
        .unwrap();
        fs::write(resources.join("build-receipt.json"), b"raw builder fixture").unwrap();
        for directory in ["home", "state", "project", "probes"] {
            fs::create_dir(root.join(directory)).unwrap();
        }
        fs::write(
            root.join("state/config-sentinel"),
            b"preserve existing configuration",
        )
        .unwrap();
        for probe in ["sh", "curl", "wget"] {
            let path = root.join("probes").join(probe);
            fs::write(
                &path,
                b"#!/bin/sh\nprintf effect >> \"$NAC_UPGRADE_EFFECT_FILE\"\nexit 91\n",
            )
            .unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        Self {
            marker: resources.join("PackageIdentity.json"),
            root,
            engine,
            identity,
        }
    }

    fn package(&self, purpose: &str) -> Value {
        json!({
            "schema_version": 1, "purpose": purpose, "consumer_distribution": false,
            "engine_identity": self.identity,
            "engine_input": {"sha256": "unsigned input, intentionally not signed executable bytes"},
            "receipt_fixture": "x".repeat(19 * 1024),
        })
    }

    fn command(&self, executable: &Path) -> Command {
        let mut command = Command::new(executable);
        command
            .current_dir(self.root.join("project"))
            .env("HOME", self.root.join("home"))
            .env("NAC_HOME", self.root.join("state"))
            .env_remove("NAC_DESKTOP_CHANNEL_FD");
        command
    }

    fn assert_refuses_without_effects(&self, executable: &Path, prerelease: bool) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut command = self.command(executable);
        command
            .arg0("arbitrary-invocation-alias")
            .args(["upgrade", "--install-dir"])
            .arg(self.root.join("explicit-install-must-not-exist"))
            .env(
                "INSTALL_DIR",
                self.root.join("ambient-install-must-not-exist"),
            )
            .env("PATH", self.root.join("probes"))
            .env(
                "NAC_UPGRADE_EFFECT_FILE",
                self.root.join("probe-or-installer-effect"),
            )
            .env("NAC_BUILD_TRACK", "stable") // Ambient values are not ownership.
            .env(
                "NAC_SCRIPT_BASE_URL",
                format!("http://{}", listener.local_addr().unwrap()),
            );
        if prerelease {
            command.args(["--pre-release", "--yes"]);
        }
        let before = snapshot(&self.root);
        let output = bounded_output(command);
        assert!(!output.status.success());
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(stderr.contains("replace the whole application"), "{stderr}");
        assert!(!stderr.contains("is a dev source build"), "{stderr}");
        assert!(!stderr.contains("failed to download"), "{stderr}");
        assert!(
            output.stdout.is_empty(),
            "installer/download output: {output:?}"
        );
        assert_eq!(
            snapshot(&self.root),
            before,
            "upgrade changed fixture files"
        );
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn bounded_output(mut command: Command) -> Output {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if child.try_wait().unwrap().is_some() {
            return child.wait_with_output().unwrap();
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let output = child.wait_with_output().unwrap();
            panic!("CLI exceeded fixture deadline: {output:?}");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

// Full tree names, modes, lengths and modification times catch new/deleted or
// rewritten files. Small file bytes cover configuration, receipts and traps;
// the large engine has an independent whole-suite digest assertion below.
fn snapshot(root: &Path) -> Snapshot {
    fn visit(root: &Path, path: &Path, output: &mut Snapshot) {
        for item in fs::read_dir(path).unwrap() {
            let path = item.unwrap().path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            let bytes = if metadata.is_file() && metadata.len() < 4 * 1024 * 1024 {
                fs::read(&path).unwrap()
            } else {
                Vec::new()
            };
            output.insert(
                path.strip_prefix(root).unwrap().into(),
                (
                    metadata.permissions().mode(),
                    metadata.len(),
                    metadata.modified().unwrap(),
                    bytes,
                ),
            );
            if metadata.is_dir() {
                visit(root, &path, output);
            }
        }
    }
    let mut output = BTreeMap::new();
    visit(root, root, &mut output);
    output
}

fn digest(path: &Path) -> Vec<u8> {
    let mut file = fs::File::open(path).unwrap();
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).unwrap();
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    hash.finalize().to_vec()
}

#[test]
fn bundled_upgrade_refuses_for_real_engine_and_symlink_alias_before_any_installer_effect() {
    let _execution = BINARY_EXECUTION.lock().unwrap();
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let original_digest = digest(&fixture.engine);
    let alias = fixture.root.join("outside renamed engine");
    symlink(&fixture.engine, &alias).unwrap();
    let outside_marker = fixture.root.join("outside-marker.json");
    fs::write(
        &outside_marker,
        serde_json::to_vec(&fixture.package("normal-app-preparation")).unwrap(),
    )
    .unwrap();
    for state in [
        "normal",
        "preview",
        "missing",
        "malformed",
        "stale",
        "future",
        "oversized",
        "symlink",
    ] {
        if fs::symlink_metadata(&fixture.marker).is_ok() {
            fs::remove_file(&fixture.marker).unwrap();
        }
        let mut marker = fixture.package("normal-app-preparation");
        match state {
            "missing" => {}
            "malformed" => fs::write(&fixture.marker, b"{invalid").unwrap(),
            "oversized" => fs::write(&fixture.marker, vec![b' '; 2 * 1024 * 1024 + 1]).unwrap(),
            "symlink" => symlink(&outside_marker, &fixture.marker).unwrap(),
            _ => {
                if state == "preview" {
                    marker["purpose"] = "development-preview-fixture".into();
                }
                if state == "stale" {
                    marker["engine_identity"]["source_revision"] = "different-source".into();
                }
                if state == "future" {
                    marker["schema_version"] = 2.into();
                }
                fs::write(&fixture.marker, serde_json::to_vec(&marker).unwrap()).unwrap();
            }
        }
        for executable in [&fixture.engine, &alias] {
            fixture.assert_refuses_without_effects(executable, false);
        }
    }
    fixture.assert_refuses_without_effects(&fixture.engine, true);
    assert_eq!(digest(&fixture.engine), original_digest);
}

struct ScriptServer {
    address: std::net::SocketAddr,
    requests: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl ScriptServer {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(AtomicUsize::new(0));
        let thread_stop = Arc::clone(&stop);
        let thread_requests = Arc::clone(&requests);
        let thread = thread::spawn(move || {
            while !thread_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        let mut bytes = [0; 8192];
                        let count = stream.read(&mut bytes).unwrap();
                        let request = String::from_utf8_lossy(&bytes[..count]);
                        let phase = if request.starts_with("GET /uninstall.sh ") {
                            "uninstall"
                        } else {
                            assert!(request.starts_with("GET /install.sh "), "{request}");
                            "install"
                        };
                        let script = format!(
                            "printf '%s\\n' {phase} >> \"$INSTALL_DIR/installer-effects\"\n"
                        );
                        write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{script}", script.len()).unwrap();
                        thread_requests.fetch_add(1, Ordering::SeqCst);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("fixture server: {error}"),
                }
            }
        });
        Self {
            address,
            requests,
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for ScriptServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}

#[test]
fn independent_copy_preserves_dev_refusal_or_real_standalone_installer_flow() {
    let _execution = BINARY_EXECUTION.lock().unwrap();
    let fixture = Fixture::new();
    let directory = fixture.root.join("independent CLI with spaces");
    fs::create_dir(&directory).unwrap();
    let independent = directory.join("custom-nac-command");
    fs::copy(&fixture.engine, &independent).unwrap();
    // A copied marker beside an independent executable grants no ownership.
    fs::write(
        directory.join("PackageIdentity.json"),
        b"malformed irrelevant marker",
    )
    .unwrap();
    let server = ScriptServer::new();
    let mut command = fixture.command(&independent);
    command
        .arg("upgrade")
        .env("NAC_SCRIPT_BASE_URL", format!("http://{}", server.address))
        .env_remove("INSTALL_DIR");
    let output = bounded_output(command);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if env!("NAC_BUILD_TRACK") == "dev" {
        assert!(!output.status.success());
        assert!(
            stderr.contains("custom-nac-command is a dev source build"),
            "{stderr}"
        );
        assert!(stderr.contains("make install-dev"), "{stderr}");
        assert_eq!(server.requests.load(Ordering::SeqCst), 0);
        assert!(!directory.join("installer-effects").exists());
    } else {
        assert!(output.status.success(), "{stderr}");
        assert_eq!(server.requests.load(Ordering::SeqCst), 2);
        assert_eq!(
            fs::read_to_string(directory.join("installer-effects")).unwrap(),
            "uninstall\ninstall\n"
        );
    }
    assert!(
        !stderr.contains("replace the whole application"),
        "{stderr}"
    );
}
