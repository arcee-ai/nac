use super::*;

pub(crate) fn fixture() -> (PathBuf, TaskLaunchRequest, TaskLaunchSource) {
    let path = std::env::temp_dir()
        .join(format!("nac-task-launch-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_project(
        &path,
        NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: "/repo/nested".into(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    let request = TaskLaunchRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        project_id: "project".into(),
        invoking_session_id: None,
        git_ref: Some("topic".into()),
        default_ref: Some("dev".into()),
        title: "Retained task".into(),
        prompt: "Work on this".into(),
    };
    let source = TaskLaunchSource {
        project_cwd: "/repo/nested".into(),
        source_cwd: "/repo/nested".into(),
        repo_root: "/repo".into(),
        common_git_dir: "/repo/.git".into(),
        repository_identity: "fixture".into(),
        subdirectory: "nested".into(),
        default_ref: "dev".into(),
        selected_ref: "topic".into(),
        commit: "a".repeat(40),
        excluded_source_edits: true,
    };
    (path, request, source)
}

#[test]
fn launch_title_uses_existing_session_presentation_rules() {
    let (path, mut request, _) = fixture();
    for invalid in [
        "x".repeat(121),
        "bad\ttitle".into(),
        " untrimmed ".into(),
        " ".into(),
    ] {
        request.title = invalid;
        assert!(request
            .validate()
            .unwrap_err()
            .to_string()
            .starts_with("invalid request:"));
    }
    request.title = "é".repeat(120);
    request.validate().unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn retry_after_reopen_returns_original_pin_and_intentional_duplicate_is_distinct() {
    let (path, request, mut source) = fixture();
    let first = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    source.commit = "b".repeat(40);
    source.selected_ref = "deleted-branch".into();
    let retry = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    assert_eq!(first, retry);
    let mut other = request;
    other.request_id = uuid::Uuid::new_v4().to_string();
    let second = reserve_task_launch(&path, other, source).unwrap();
    assert_ne!(first.session_id, second.session_id);
    assert_ne!(first.workspace_path, second.workspace_path);
    assert_eq!(list_task_launches(&path, "project").unwrap().len(), 2);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn incompatible_retry_and_changed_project_repository_are_conflicts() {
    let (path, request, source) = fixture();
    reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    let mut changed = request.clone();
    changed.prompt.push('!');
    assert!(reserve_task_launch(&path, changed, source.clone())
        .unwrap_err()
        .to_string()
        .contains("conflict"));
    let mut changed = request;
    changed.request_id = uuid::Uuid::new_v4().to_string();
    let mut other_repo = source;
    other_repo.common_git_dir = "/other/.git".into();
    assert!(reserve_task_launch(&path, changed, other_repo)
        .unwrap_err()
        .to_string()
        .contains("binding changed"));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn cancellation_is_durable_and_late_preparation_cannot_reopen_it() {
    let (path, request, source) = fixture();
    reserve_task_launch(&path, request.clone(), source).unwrap();
    update_task_launch(&path, &request.request_id, TaskLaunchPhase::Cancelled, None).unwrap();
    let late = update_task_launch(
        &path,
        &request.request_id,
        TaskLaunchPhase::PreparingRuntime,
        None,
    )
    .unwrap();
    assert_eq!(late.phase, TaskLaunchPhase::Cancelled);
    assert!(late.first_input_id.is_none());
    // Inventory survives project deletion; it is ownership evidence, not GC.
    delete_project(&path, "project").unwrap();
    assert_eq!(
        load_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap(),
        late
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn migrates_previous_store_without_touching_existing_session_identity() {
    let (path, _, _) = fixture();
    insert_test_session(&path, "legacy");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "DROP TABLE task_launches; DROP TABLE project_git_sources; PRAGMA user_version=34;",
    )
    .unwrap();
    drop(conn);
    initialize(&path).unwrap();
    assert!(crate::sessions::session_exists(&path, "legacy").unwrap());
    assert!(list_task_launches(&path, "project").unwrap().is_empty());
    initialize(&path).unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn restart_reconciliation_preserves_pin_and_retained_ownership_without_admitting_work() {
    let (path, request, source) = fixture();
    let first = reserve_task_launch(&path, request.clone(), source).unwrap();
    std::fs::create_dir_all(&first.workspace_path).unwrap();
    std::fs::write(first.workspace_path.join("keep"), "uncertain owned effect").unwrap();
    let lease = crate::sessions::SessionOperationLease::try_acquire(
        &path,
        &format!("task-launch:{}", request.request_id),
    )
    .unwrap();
    reconcile_task_launches(&path).unwrap();
    assert_eq!(
        load_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap()
            .phase,
        TaskLaunchPhase::Pinned
    );
    drop(lease);
    reconcile_task_launches(&path).unwrap();
    let recovered = load_task_launch(&path, &request.request_id)
        .unwrap()
        .unwrap();
    assert_eq!(recovered.phase, TaskLaunchPhase::Failed);
    assert_eq!(first.source, recovered.source);
    assert_eq!(first.session_id, recovered.session_id);
    assert!(recovered.first_input_id.is_none());
    assert_eq!(
        std::fs::read_to_string(first.workspace_path.join("keep")).unwrap(),
        "uncertain owned effect"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
