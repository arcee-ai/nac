use super::*;

async fn fixture_context(
    root: &std::path::Path,
    manager: &SessionManager,
    retained: bool,
) -> (NativeTaskLaunchController, String, NativeTaskRequest) {
    let source = task_launches::fixture(root, manager).await;
    let caller = manager
        .session_creation()
        .create_session(application::session_creation::SessionCreationCommand {
            behavior: sessions::SessionBehavior::Direct,
            project_id: Some(source.project_id.clone()),
            ..Default::default()
        })
        .await
        .unwrap()
        .metadata
        .session_id
        .unwrap();
    if retained {
        return (
            NativeTaskLaunchController::new(manager),
            caller,
            request(Some(source.project_id)),
        );
    }
    let cwd = root.join("ordinary");
    std::fs::create_dir(&cwd).unwrap();
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Recovery fixture".into()),
            description: None,
            cwd,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("task-config".into()),
        })
        .await
        .unwrap();
    let mut input = request(Some(project.project_id));
    input.default_ref = None;
    (NativeTaskLaunchController::new(manager), caller, input)
}

async fn settle(manager: &SessionManager) {
    tokio::time::timeout(
        Duration::from_secs(20),
        manager.inner.task_preparations.settle(),
    )
    .await
    .unwrap();
}

async fn stop(manager: &SessionManager) {
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_failed_retry_acknowledges_preparation_before_returning_receipt() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    failed_retry(false).await;
    failed_retry(true).await;
}

async fn failed_retry(retained: bool) {
    let root = temp_root("native_failed_retry");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let (controller, caller, input) = fixture_context(&root, &manager, retained).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(gate.clone());
    let first = start(
        &controller,
        &caller,
        input.clone(),
        &manager.inner.store_path,
    )
    .await;
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    manager.stop_local_run_admission().await;
    gate.resume.notify_one();
    settle(&manager).await;
    assert_eq!(
        controller
            .status(&caller, &input.request_id)
            .await
            .unwrap()
            .launch
            .phase,
        "failed"
    );
    stop(&manager).await;
    let restarted = test_manager(&root);
    let controller = NativeTaskLaunchController::new(&restarted);
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *restarted
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(gate.clone());
    let retry = start(
        &controller,
        &caller,
        input.clone(),
        &restarted.inner.store_path,
    )
    .await;
    assert!(
        matches!(
            retry.launch.phase.as_str(),
            "pinned" | "preparing_workspace" | "preparing_runtime"
        ),
        "retry must acknowledge the resumed preparation: {:?}",
        retry.launch
    );
    assert!(retry.launch.error.is_none());
    assert_eq!(retry.launch.session_id, first.launch.session_id);
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    assert!(
        !sessions::session_exists(&restarted.inner.store_path, &retry.launch.session_id).unwrap()
    );
    gate.resume.notify_one();
    settle(&restarted).await;
    let ready = controller.status(&caller, &input.request_id).await.unwrap();
    assert_eq!(ready.launch.phase, "ready", "{:?}", ready.launch.error);
    assert_eq!(
        nac_core::store::list_session_inbox(&restarted.inner.store_path, &ready.launch.session_id)
            .unwrap()
            .len(),
        1
    );
    stop(&restarted).await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_ready_retry_recovers_only_the_pending_initial_input_and_clears_wake_error() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("native_ready_retry");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let (controller, caller, input) = fixture_context(&root, &manager, false).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_after_persistence
        .lock()
        .unwrap() = Some(gate.clone());
    let first = start(
        &controller,
        &caller,
        input.clone(),
        &manager.inner.store_path,
    )
    .await;
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    let published = controller.status(&caller, &input.request_id).await.unwrap();
    assert_eq!(published.launch.phase, "ready");
    let input_id = published.launch.first_input_id.unwrap();
    nac_core::store::update_native_task_admission_error(
        &manager.inner.store_path,
        &input.request_id,
        Some("initial wake interrupted".into()),
    )
    .unwrap();
    manager.stop_local_run_admission().await;
    gate.resume.notify_one();
    settle(&manager).await;
    stop(&manager).await;
    let restarted = test_manager(&root);
    let controller = NativeTaskLaunchController::new(&restarted);
    let passive = controller.status(&caller, &input.request_id).await.unwrap();
    assert!(passive.launch.error.is_some());
    assert_eq!(passive.task.unwrap().pending_inbox_items, 1);
    assert!(
        restarted.inner.active_sessions.read().await.is_empty(),
        "passive status never wakes pending initial input"
    );
    let retry = start(
        &controller,
        &caller,
        input.clone(),
        &restarted.inner.store_path,
    )
    .await;
    assert_eq!(retry.launch.session_id, first.launch.session_id);
    assert_eq!(retry.launch.first_input_id, Some(input_id));
    assert!(retry.launch.error.is_none(), "{:?}", retry.launch.error);
    assert_eq!(
        nac_core::store::load_session_inbox_item(
            &restarted.inner.store_path,
            &retry.launch.session_id,
            input_id
        )
        .unwrap()
        .status,
        nac_core::store::InboxStatus::Delivered
    );
    let service = restarted
        .inner
        .active_sessions
        .read()
        .await
        .get(&retry.launch.session_id)
        .cloned()
        .unwrap();
    // This fixture deliberately has no model server. Cancel the admitted run
    // rather than waiting for the provider's ordinary connection retry policy.
    restarted
        .cancel_active_run(&retry.launch.session_id)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        while service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let before = controller
        .status(&caller, &input.request_id)
        .await
        .unwrap()
        .task
        .unwrap()
        .run_count;
    let repeated = start(&controller, &caller, input, &restarted.inner.store_path).await;
    assert_eq!(repeated.task.unwrap().run_count, before);
    assert_eq!(
        nac_core::store::list_session_inbox(&restarted.inner.store_path, &retry.launch.session_id)
            .unwrap()
            .len(),
        1
    );
    stop(&restarted).await;
    std::fs::remove_dir_all(root).unwrap();
}
