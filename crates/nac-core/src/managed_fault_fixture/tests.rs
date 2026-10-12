#![allow(
    clippy::unwrap_used,
    clippy::missing_assert_message,
    reason = "private fixture test assertions"
)]
use super::*;
use std::os::unix::fs::{symlink, OpenOptionsExt as StdOpenOptionsExt, PermissionsExt};

struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-fault-guard-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self(root)
    }
    fn control(&self, boundary: Boundary) -> serde_json::Value {
        let value = serde_json::json!({"nonce": uuid::Uuid::new_v4().to_string(), "boundary": boundary,
            "session_id": "selected", "run_id": if boundary == Boundary::CommitAck { Some("run") } else { None },
            "generation": 7, "expires_unix_ms": clock_ms().unwrap()+10_000});
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(self.0.join(boundary.control_file()))
            .unwrap();
        file.write_all(serde_json::to_string(&value).unwrap().as_bytes())
            .unwrap();
        value
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn selected_identity_only_and_concurrent_nonce_consumption_is_once() {
    let root = Root::new();
    let value = root.control(Boundary::CommitAck);
    let original = std::fs::read(root.0.join("commit-ack.json")).unwrap();
    for (session, run, generation) in [
        ("other", Some("run"), Some(7)),
        ("selected", Some("other"), Some(7)),
        ("selected", Some("run"), Some(8)),
    ] {
        assert!(!hit_in_root(&root.0, Boundary::CommitAck, session, run, generation).unwrap());
    }
    let winners = std::thread::scope(|scope| {
        let mut threads = Vec::new();
        for _ in 0..8 {
            let path = &root.0;
            threads.push(scope.spawn(move || {
                hit_in_root(path, Boundary::CommitAck, "selected", Some("run"), Some(7)).unwrap()
            }));
        }
        threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|won| *won)
            .count()
    });
    assert_eq!(winners, 1);
    assert_eq!(
        std::fs::read(root.0.join("commit-ack.json")).unwrap(),
        original
    );
    let receipt: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            root.0
                .join(format!("used-{}.json", value["nonce"].as_str().unwrap())),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(receipt["session_id"], "selected");
    assert_eq!(receipt["generation"], 7);
    assert_eq!(receipt["after_successful_sqlite_commit"], true);
}

#[test]
fn controls_reject_symlinks_hardlinks_permissions_and_unbounded_payloads() {
    let root = Root::new();
    root.control(Boundary::MonitorRead);
    let control = root.0.join("monitor-read.json");
    std::fs::set_permissions(&control, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(hit_in_root(&root.0, Boundary::MonitorRead, "selected", None, Some(7)).is_err());
    std::fs::set_permissions(&control, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::hard_link(&control, root.0.join("extra-link")).unwrap();
    assert!(hit_in_root(&root.0, Boundary::MonitorRead, "selected", None, Some(7)).is_err());
    std::fs::remove_file(root.0.join("extra-link")).unwrap();
    std::fs::rename(&control, root.0.join("real-control")).unwrap();
    symlink("real-control", &control).unwrap();
    assert!(hit_in_root(&root.0, Boundary::MonitorRead, "selected", None, Some(7)).is_err());
    std::fs::remove_file(&control).unwrap();
    std::fs::rename(root.0.join("real-control"), &control).unwrap();
    std::fs::write(&control, vec![b' '; MAX_CONTROL_BYTES as usize + 1]).unwrap();
    assert!(hit_in_root(&root.0, Boundary::MonitorRead, "selected", None, Some(7)).is_err());
    let link = root.0.with_extension("symlink");
    symlink(&root.0, &link).unwrap();
    assert!(hit_in_root(&link, Boundary::MonitorRead, "selected", None, Some(7)).is_err());
    std::fs::remove_file(link).unwrap();
    assert!(!std::fs::read_dir(&root.0).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("used-")));
}

#[test]
fn expired_and_out_of_budget_arming_cannot_trigger() {
    for expires in [
        clock_ms().unwrap() - 1,
        clock_ms().unwrap() + MAX_ARM_WINDOW_MS + 1000,
    ] {
        let root = Root::new();
        let mut control = root.control(Boundary::MonitorRead);
        control["expires_unix_ms"] = expires.into();
        std::fs::write(
            root.0.join("monitor-read.json"),
            serde_json::to_vec(&control).unwrap(),
        )
        .unwrap();
        assert!(!hit_in_root(&root.0, Boundary::MonitorRead, "selected", None, Some(7)).unwrap());
        assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 1);
    }
}
