#![allow(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    reason = "integration-test setup and assertions should fail immediately"
)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BINARY: &str = env!("CARGO_BIN_EXE_nac-web");

struct ChildGuard(Option<Child>);

impl ChildGuard {
    fn finish(mut self) -> Output {
        let mut child = self.0.take().unwrap();
        let _ = child.kill();
        child.wait_with_output().unwrap()
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn temp_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "nac_source_binary_{label}_{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn custom_binary(root: &Path) -> PathBuf {
    let binary = root
        .join("installed path with spaces")
        .join("nac-my-branch");
    std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
    std::fs::copy(BINARY, &binary).unwrap();
    binary
}

fn reserve_address() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap()
}

fn http_body(address: SocketAddr, path: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(100))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .ok_or_else(|| std::io::Error::other("HTTP response had no body separator"))
}

#[test]
fn unset_track_custom_install_reports_dev_identity_and_uses_dev_store() {
    assert_eq!(env!("NAC_BUILD_TRACK"), "dev");
    assert_eq!(
        env!("NAC_BUILD_ID"),
        format!("dev-{}", env!("NAC_SOURCE_REVISION"))
    );

    let root = temp_root("startup");
    let project = root.join("project");
    let nac_home = root.join("state");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let binary = custom_binary(&root);

    let help = Command::new(&binary).arg("--help").output().unwrap();
    assert!(help.status.success());
    let help = String::from_utf8(help.stdout).unwrap();
    assert!(help.contains("Usage: nac-my-branch"), "{help}");
    assert!(!help.contains("Usage: nac-web"), "{help}");

    let address = reserve_address();
    let child = Command::new(&binary)
        .args([
            "--bind",
            &address.to_string(),
            "--directory",
            project.to_str().unwrap(),
            "--no-open",
            "--yes",
        ])
        .env("NAC_HOME", &nac_home)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut child = ChildGuard(Some(child));
    let mut models = None;
    for _ in 0..500 {
        match http_body(address, "/models") {
            Ok(body) => {
                models = Some(body);
                break;
            }
            Err(_) => {
                if let Some(status) = child.0.as_mut().unwrap().try_wait().unwrap() {
                    panic!("custom source binary exited before readiness: {status}");
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    let models = models.expect("custom source binary did not become ready");
    assert!(
        models.contains("nac-my-branch arcee-auth login"),
        "{models}"
    );
    assert!(
        models.contains("nac-my-branch codex-auth login"),
        "{models}"
    );

    let output = child.finish();
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains(&format!("nac-my-branch listening on http://{address}")),
        "{stderr}"
    );
    assert!(
        stderr.contains(&format!(
            "build: dev {} ({})",
            env!("NAC_BUILD_ID"),
            env!("NAC_SOURCE_REVISION")
        )),
        "{stderr}"
    );
    assert!(nac_home.join("dev.db").is_file());
    assert!(!nac_home.join("beta.db").exists());
    assert!(!nac_home.join("stable.db").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn custom_dev_upgrade_refuses_before_network_or_install_mutation() {
    assert_eq!(env!("NAC_BUILD_TRACK"), "dev");
    let root = temp_root("upgrade");
    std::fs::create_dir_all(&root).unwrap();
    let binary = custom_binary(&root);
    let install_dir = root.join("must-remain-empty");
    std::fs::create_dir_all(&install_dir).unwrap();

    let output = Command::new(&binary)
        .arg("upgrade")
        .arg("--install-dir")
        .arg(&install_dir)
        .env("NAC_SCRIPT_BASE_URL", "http://127.0.0.1:1/must-not-connect")
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains("nac-my-branch is a dev source build"),
        "{stderr}"
    );
    assert!(stderr.contains("make install-dev"), "{stderr}");
    assert_eq!(std::fs::read_dir(&install_dir).unwrap().count(), 0);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(not(feature = "managed-fault-fixture"))]
#[test]
fn normal_binary_rejects_private_fault_controls_before_startup() {
    let root = temp_root("fault_exclusion");
    let output = Command::new(BINARY)
        .arg("--help")
        .env("NAC_MANAGED_FAULT_ROOT", &root)
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("managed fault controls require the private fault-fixture build"));
    assert!(!root.exists());
}
