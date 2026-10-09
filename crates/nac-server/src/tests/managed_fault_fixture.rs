use super::*;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

#[test]
fn private_monitor_fault_is_generation_scoped_once_and_subsequent_read_recovers() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    struct Environment(Option<std::ffi::OsString>);
    impl Drop for Environment {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("NAC_MANAGED_FAULT_ROOT", value),
                None => std::env::remove_var("NAC_MANAGED_FAULT_ROOT"),
            }
        }
    }
    let root = temp_root("private_monitor_fault");
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let id = uuid::Uuid::new_v4();
    let parent = format!("parent-{id}");
    let child = format!("child-{id}");
    seed_session(&root, &child, "2026-01-01 00:00:00.000000000");
    let store = root.join("store.db");
    let mut parent_snapshot = sessions::load_session(&store, &child).unwrap();
    parent_snapshot.session_id = parent.clone();
    parent_snapshot.behavior = sessions::SessionBehavior::DirectWithOrchestrator;
    sessions::create_session(&store, &parent_snapshot).unwrap();
    let before = nac_core::store::create_managed_orchestrator_relationship(
        &store, &parent, &child, "fixture",
    )
    .unwrap();
    let control_root = PathBuf::from(format!("/tmp/all117-fault-{id}"));
    std::fs::create_dir(&control_root).unwrap();
    std::fs::set_permissions(&control_root, std::fs::Permissions::from_mode(0o700)).unwrap();
    let _environment = Environment(std::env::var_os("NAC_MANAGED_FAULT_ROOT"));
    std::env::set_var("NAC_MANAGED_FAULT_ROOT", &control_root);
    let nonce = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let control = serde_json::json!({"nonce": nonce, "boundary": "monitor-read", "session_id": child,
        "run_id": null, "generation": before.generation, "expires_unix_ms": now+10_000});
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(control_root.join("monitor-read.json"))
        .unwrap();
    file.write_all(serde_json::to_string(&control).unwrap().as_bytes())
        .unwrap();
    drop(file);
    let wrong = crate::delegation_runtime::load_managed_monitor_record(
        &store,
        &child,
        before.generation + 1,
    )
    .unwrap()
    .unwrap();
    assert_eq!(wrong.generation, before.generation);
    assert!(crate::delegation_runtime::load_managed_monitor_record(
        &store,
        &child,
        before.generation
    )
    .unwrap_err()
    .to_string()
    .contains("private fixture injected managed monitor read failure"));
    let after =
        crate::delegation_runtime::load_managed_monitor_record(&store, &child, before.generation)
            .unwrap()
            .unwrap();
    assert_eq!(after, before);
    let receipt: serde_json::Value = serde_json::from_slice(
        &std::fs::read(control_root.join(format!("used-{nonce}.json"))).unwrap(),
    )
    .unwrap();
    assert_eq!(receipt["boundary"], "monitor-read");
    assert_eq!(receipt["generation"], before.generation);
    assert_eq!(receipt["after_successful_sqlite_commit"], false);
    std::fs::remove_dir_all(control_root).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
