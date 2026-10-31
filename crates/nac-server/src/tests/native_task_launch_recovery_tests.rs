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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_git_source_resolution_keeps_identity_lease_after_caller_is_lost() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("native_source_response_loss");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let (controller, caller, input) = fixture_context(&root, &manager, true).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .task_preparations
        .source_resolution
        .lock()
        .unwrap() = Some(gate.clone());
    let worker = manager.clone();
    let owner = caller.clone();
    let intent = input.clone();
    let waiter = tokio::spawn(async move {
        let controller = NativeTaskLaunchController::new(&worker);
        start(&controller, &owner, intent, &worker.inner.store_path).await
    });
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    assert!(
        nac_core::store::load_task_launch(&manager.inner.store_path, &input.request_id)
            .unwrap()
            .is_none()
    );
    waiter.abort();
    assert!(waiter.await.unwrap_err().is_cancelled());
    let retry = start(
        &controller,
        &caller,
        input.clone(),
        &manager.inner.store_path,
    )
    .await;
    assert_eq!(retry.launch.phase, "reserved");
    assert!(retry.launch.error.is_none());
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(
            &manager.inner.store_path,
            &format!("native-task-launch:{}", input.request_id)
        ),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    gate.resume.notify_one();
    settle(&manager).await;
    let ready = controller.status(&caller, &input.request_id).await.unwrap();
    assert_eq!(ready.launch.phase, "ready", "{:?}", ready.launch.error);
    assert_eq!(ready.launch.session_id, retry.launch.session_id);
    assert_eq!(
        nac_core::store::list_session_inbox(&manager.inner.store_path, &ready.launch.session_id)
            .unwrap()
            .len(),
        1
    );
    stop(&manager).await;
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_saved_symlink_projects_bind_canonical_targets_and_reject_retargeting() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for retained in [false, true] {
        let root = temp_root("native_symlink_project");
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
        let manager = test_manager(&root);
        let (controller, caller, input) = fixture_context(&root, &manager, retained).await;
        let original = controller.resolve(&caller, &input).await.unwrap();
        let alias = root.join("saved-alias");
        std::os::unix::fs::symlink(&original.cwd, &alias).unwrap();
        rusqlite::Connection::open(&manager.inner.store_path)
            .unwrap()
            .execute(
                "UPDATE projects SET cwd=?2 WHERE project_id=?1",
                rusqlite::params![original.project_id, alias.to_string_lossy()],
            )
            .unwrap();
        let first = start(
            &controller,
            &caller,
            input.clone(),
            &manager.inner.store_path,
        )
        .await;
        settle(&manager).await;
        let ready = controller.status(&caller, &input.request_id).await.unwrap();
        assert_eq!(ready.launch.phase, "ready", "{:?}", ready.launch.error);
        assert_eq!(ready.launch.session_id, first.launch.session_id);
        assert_eq!(ready.launch.source_cwd, original.cwd);
        let mut changed = input.clone();
        changed.request_id = uuid::Uuid::new_v4().to_string();
        let target = controller.resolve(&caller, &changed).await.unwrap();
        let other = root.join("other");
        std::fs::create_dir(&other).unwrap();
        std::fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(other, alias).unwrap();
        let authorization =
            nac_core::task_launch_control::NativeTaskAuthorization::for_local_fixture(
                manager.inner.store_path.clone(),
                caller.clone(),
                target.cwd.clone(),
            );
        let rejected = controller
            .launch(&caller, changed.clone(), target, authorization)
            .await
            .unwrap_err();
        assert!(rejected.to_string().contains("binding changed"));
        assert!(nac_core::store::load_native_task_launch(
            &manager.inner.store_path,
            &changed.request_id
        )
        .unwrap()
        .is_none());
        let rebound = controller.resolve(&caller, &input).await.unwrap();
        let authorization =
            nac_core::task_launch_control::NativeTaskAuthorization::for_local_fixture(
                manager.inner.store_path.clone(),
                caller.clone(),
                rebound.cwd.clone(),
            );
        let rejected = controller
            .launch(&caller, input.clone(), rebound, authorization)
            .await
            .unwrap_err();
        assert!(rejected.to_string().contains("source binding"));
        let unchanged = controller.status(&caller, &input.request_id).await.unwrap();
        assert_eq!(unchanged.launch.phase, "ready");
        assert_eq!(unchanged.launch.session_id, ready.launch.session_id);
        assert_eq!(
            nac_core::store::list_session_inbox(
                &manager.inner.store_path,
                &ready.launch.session_id
            )
            .unwrap()
            .len(),
            1
        );
        stop(&manager).await;
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_retained_wake_failure_is_visible_and_exact_retry_recovers_one_input() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("native_retained_wake_failure");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let (controller, caller, input) = fixture_context(&root, &manager, true).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .task_preparations
        .initial_input_wake
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
    // Exercise a real fail-closed lease error for this exact reserved session;
    // request/preparation lease files remain untouched and keep their owners.
    let lock_name = first
        .launch
        .session_id
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let lock_dir = manager.inner.store_path.with_file_name(format!(
        "{}.run-locks",
        manager
            .inner
            .store_path
            .file_name()
            .unwrap()
            .to_string_lossy()
    ));
    let lock_path = lock_dir.join(format!("{lock_name}.lock"));
    let saved_lock = lock_dir.join(format!("{lock_name}.saved-fixture-lock"));
    if lock_path.exists() {
        std::fs::rename(&lock_path, &saved_lock).unwrap();
    }
    std::fs::create_dir(&lock_path).unwrap();
    gate.resume.notify_one();
    settle(&manager).await;
    std::fs::remove_dir(&lock_path).unwrap();
    if saved_lock.exists() {
        std::fs::rename(saved_lock, lock_path).unwrap();
    }
    let failed = controller.status(&caller, &input.request_id).await.unwrap();
    assert_eq!(failed.launch.phase, "ready");
    assert!(
        failed.launch.error.is_some(),
        "published retained wake failure must be visible"
    );
    assert_eq!(failed.task.unwrap().pending_inbox_items, 1);
    assert_eq!(
        nac_core::store::load_session_inbox_item(
            &manager.inner.store_path,
            &first.launch.session_id,
            input_id
        )
        .unwrap()
        .status,
        nac_core::store::InboxStatus::Pending
    );
    stop(&manager).await;
    let restarted = test_manager(&root);
    let controller = NativeTaskLaunchController::new(&restarted);
    let retry = start(&controller, &caller, input, &restarted.inner.store_path).await;
    assert_eq!(retry.launch.session_id, first.launch.session_id);
    assert_eq!(retry.launch.first_input_id, Some(input_id));
    assert!(retry.launch.error.is_none());
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
    assert_eq!(
        nac_core::store::list_session_inbox(&restarted.inner.store_path, &retry.launch.session_id)
            .unwrap()
            .len(),
        1
    );
    stop(&restarted).await;
    std::fs::remove_dir_all(root).unwrap();
}
