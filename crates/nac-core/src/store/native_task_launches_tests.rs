use super::*;
use crate::task_launch_control::TaskWorkspace;

fn cwd(path: &Path) -> PathBuf {
    std::fs::canonicalize(path.parent().unwrap()).unwrap()
}

fn fixture() -> (PathBuf, NativeTaskRequest) {
    let path = std::env::temp_dir()
        .join(format!("nac-native-intent-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_project(
        &path,
        NewProject {
            project_id: "p".into(),
            name: None,
            description: None,
            cwd: cwd(&path),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    insert_test_session(&path, "caller");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct',cwd=?1 WHERE session_id='caller'",
        params![cwd(&path).to_string_lossy()],
    )
    .unwrap();
    drop(conn);
    assign_session_to_project(&path, "p", "caller").unwrap();
    (
        path,
        NativeTaskRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            project_id: None,
            title: "Native task".into(),
            prompt: "Fresh handoff facts".into(),
            skill: Some("qa".into()),
            model: None,
            reasoning_effort: None,
            workspace: TaskWorkspace::Auto,
            git_ref: None,
            default_ref: None,
        },
    )
}

#[test]
fn native_intent_retry_reopens_original_identity_and_distinguishes_new_requests() {
    let (path, request) = fixture();
    let first =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .unwrap();
    assert_eq!(
        first,
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .unwrap()
    );
    assert!(reserve_native_task_launch(
        &path,
        "caller",
        "p",
        Path::new("/other"),
        false,
        request.clone()
    )
    .is_err());
    assert!(
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), true, request.clone())
            .is_err()
    );
    let mut changed = request.clone();
    changed.skill = Some("release".into());
    assert!(
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, changed)
            .unwrap_err()
            .to_string()
            .contains("conflict")
    );
    assert!(
        reserve_native_task_launch(&path, "foreign", "p", &cwd(&path), false, request.clone())
            .is_err()
    );
    let mut other = request;
    other.request_id = uuid::Uuid::new_v4().to_string();
    assert_ne!(
        first.session_id,
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, other)
            .unwrap()
            .session_id
    );
    assert!(!crate::sessions::session_exists(&path, &first.session_id).unwrap());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn native_intent_refuses_wrong_project_source_and_nonlocal_callers() {
    let (path, request) = fixture();
    assert!(reserve_native_task_launch(
        &path,
        "caller",
        "p",
        Path::new("/other"),
        false,
        request.clone()
    )
    .is_err());
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET host_id='remote' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    assert!(
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .is_err()
    );
    conn.execute(
        "UPDATE sessions SET host_id=NULL,behavior='orchestrator' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    assert!(reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request).is_err());
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn native_restart_observation_respects_live_preparation_and_never_admits_input() {
    let (path, request) = fixture();
    let launch =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .unwrap();
    let lease = crate::sessions::SessionOperationLease::try_acquire(
        &path,
        &format!("native-task-launch:{}", request.request_id),
    )
    .unwrap();
    reconcile_native_task_launches(&path).unwrap();
    assert_eq!(
        load_native_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap()
            .phase,
        "reserved"
    );
    drop(lease);
    reconcile_native_task_launches(&path).unwrap();
    let observed = load_native_task_launch(&path, &request.request_id)
        .unwrap()
        .unwrap();
    assert_eq!(observed.phase, "failed");
    assert!(observed.error.unwrap().contains("restart"));
    assert!(!crate::sessions::session_exists(&path, &launch.session_id).unwrap());
    let retry =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request).unwrap();
    assert_eq!(retry.session_id, launch.session_id);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
