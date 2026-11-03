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

// Wake returns a spawned run, so only the exact durable input establishes delivery.
// The returned receipt stays a snapshot; a fresh passive read observes the commit.
async fn delivered_status_after_wake(
    manager: &SessionManager,
    controller: &NativeTaskLaunchController,
    caller: &str,
    returned: &nac_core::task_launch_control::NativeTaskReceipt,
    expected_error: &str,
) -> nac_core::task_launch_control::NativeTaskReceipt {
    let launch = &returned.launch;
    let session = &launch.session_id;
    let input_id = launch
        .first_input_id
        .expect("published initial input identity");
    let exact_item =
        || nac_core::store::load_session_inbox_item(&manager.inner.store_path, session, input_id);
    eprintln!(
        "native wake retained={}: returned={returned:?}; exact_input={:?}",
        launch.retained,
        exact_item()
    );
    if let Some(error) = launch.error.as_deref() {
        assert_eq!(
            error,
            expected_error,
            "unexpected admission error; retained={}; returned={returned:?}; exact_input={:?}",
            launch.retained,
            exact_item()
        );
    }
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let item = exact_item().unwrap_or_else(|error| {
                panic!("exact input unavailable: {error:#}; retained={}; returned={returned:?}", launch.retained)
            });
            if item.status == nac_core::store::InboxStatus::Delivered {
                break;
            }
            assert_eq!(item.status, nac_core::store::InboxStatus::Pending, "unexpected input disposition; retained={}; returned={returned:?}; exact_input={item:?}", launch.retained);
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("exact delivery timed out; retained={}; returned={returned:?}; exact_input={:?}", launch.retained, exact_item()));
    let observed = controller
        .status(caller, &launch.request.request_id)
        .await
        .unwrap_or_else(|error| panic!("passive status failed: {error:#}; retained={}; returned={returned:?}; exact_input={:?}", launch.retained, exact_item()));
    eprintln!("native delivered retained={}: returned={returned:?}; passive={observed:?}; exact_input={:?}", launch.retained, exact_item());
    assert_eq!(observed.launch.session_id, launch.session_id);
    assert_eq!(observed.launch.first_input_id, launch.first_input_id);
    assert_eq!(observed.launch.phase, launch.phase);
    observed
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
    let delivered = delivered_status_after_wake(
        &restarted,
        &controller,
        &caller,
        &retry,
        passive.launch.error.as_deref().unwrap(),
    )
    .await;
    assert!(
        delivered.launch.error.is_none(),
        "{:?}",
        delivered.launch.error
    );
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
    let delivered = delivered_status_after_wake(
        &restarted,
        &controller,
        &caller,
        &retry,
        failed.launch.error.as_deref().unwrap(),
    )
    .await;
    assert!(
        delivered.launch.error.is_none(),
        "{:?}",
        delivered.launch.error
    );
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_passive_status_after_restart_derives_admission_from_original_delivery() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for retained in [false, true] {
        let root = temp_root("native_delivered_status");
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
        let manager = test_manager(&root);
        let (controller, caller, input) = fixture_context(&root, &manager, retained).await;
        let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
        if retained {
            *manager
                .inner
                .task_preparations
                .initial_input_wake
                .lock()
                .unwrap() = Some(gate.clone());
        } else {
            *manager
                .inner
                .session_creation_after_persistence
                .lock()
                .unwrap() = Some(gate.clone());
        }
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
        let stale = controller.status(&caller, &input.request_id).await.unwrap();
        assert_eq!(stale.launch.phase, "ready");
        assert!(stale.launch.error.is_none());
        manager.stop_local_run_admission().await;
        gate.resume.notify_one();
        settle(&manager).await;
        stop(&manager).await;
        let path = manager.inner.store_path.clone();
        let input_id = stale.launch.first_input_id.unwrap();
        nac_core::store::update_native_task_admission_error(
            &path,
            &input.request_id,
            Some("wake failed after retry snapshot".into()),
        )
        .unwrap();
        // Commit the original input through its real transcript boundary without
        // running resume_initial_input's optional error cleanup. This also models
        // a pre-repair store left with a historical error after committed delivery.
        let writer = nac_core::store::TranscriptLogWriter::new(&path).unwrap();
        let next_idx = sessions::load_session(&path, &stale.launch.session_id)
            .unwrap()
            .messages
            .len() as u64;
        writer
            .append_inbox_run_prompt(
                &stale.launch.session_id,
                next_idx,
                &nac_core::types::Message::User {
                    content: input.initial_prompt(),
                },
                "delivered-before-restart",
                input_id,
            )
            .unwrap();
        drop(writer);
        drop(controller);
        drop(manager);
        let restarted = test_manager(&root);
        let controller = NativeTaskLaunchController::new(&restarted);
        for _ in 0..2 {
            let passive = controller.status(&caller, &input.request_id).await.unwrap();
            assert!(passive.launch.error.is_none(), "{:?}", passive.launch);
            assert_eq!(passive.launch.session_id, first.launch.session_id);
            assert_eq!(passive.launch.first_input_id, Some(input_id));
            assert_eq!(passive.task.unwrap().pending_inbox_items, 0);
            assert!(restarted.inner.active_sessions.read().await.is_empty());
        }
        let inbox = nac_core::store::list_session_inbox(&path, &first.launch.session_id).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
        let raw: String = rusqlite::Connection::open(&path)
            .unwrap()
            .query_row(
                "SELECT error FROM native_task_launches WHERE request_id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            raw, "wake failed after retry snapshot",
            "passive reads do not rewrite history"
        );
        stop(&restarted).await;
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_ready_retry_keeps_error_when_cached_attachment_cannot_deliver() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for retained in [false, true] {
        let root = temp_root("native_cached_retry_pending");
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
        let manager = test_manager(&root);
        let (controller, caller, input) = fixture_context(&root, &manager, retained).await;
        let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
        if retained {
            *manager
                .inner
                .task_preparations
                .initial_input_wake
                .lock()
                .unwrap() = Some(gate.clone());
        } else {
            *manager
                .inner
                .session_creation_after_persistence
                .lock()
                .unwrap() = Some(gate.clone());
        }
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
        let session = &published.launch.session_id;
        let input_id = published.launch.first_input_id.unwrap();
        // Publish the ordinary supported cached attachment without waking input.
        let service = manager
            .session_attachment()
            .attach_question_target(session)
            .await
            .unwrap();
        let lease =
            sessions::SessionOperationLease::try_acquire(&manager.inner.store_path, session)
                .unwrap();
        gate.resume.notify_one();
        settle(&manager).await;
        nac_core::store::update_native_task_admission_error(
            &manager.inner.store_path,
            &input.request_id,
            Some("initial wake interrupted".into()),
        )
        .unwrap();
        let before = controller.status(&caller, &input.request_id).await.unwrap();
        assert!(Arc::ptr_eq(
            &service,
            &manager.attach_session(session).await.unwrap()
        ));
        assert!(!service.has_active_operation());
        assert_eq!(
            nac_core::store::load_session_inbox_item(&manager.inner.store_path, session, input_id,)
                .unwrap()
                .status,
            nac_core::store::InboxStatus::Pending
        );
        let retry = start(
            &controller,
            &caller,
            input.clone(),
            &manager.inner.store_path,
        )
        .await;
        eprintln!(
            "native held-lease retained={retained}: returned={retry:?}; exact_input={:?}",
            nac_core::store::load_session_inbox_item(&manager.inner.store_path, session, input_id)
        );
        assert_eq!(
            retry.launch.error.as_deref(),
            Some("initial wake interrupted")
        );
        assert_eq!(retry.launch.updated_at, before.launch.updated_at);
        assert_eq!(retry.launch.session_id, first.launch.session_id);
        assert_eq!(retry.launch.first_input_id, Some(input_id));
        assert_eq!(retry.launch.phase, "ready");
        assert_eq!(retry.task.unwrap().run_count, 0);
        assert_eq!(
            nac_core::store::list_session_inbox(&manager.inner.store_path, session)
                .unwrap()
                .len(),
            1
        );
        stop(&manager).await;
        drop(lease);
        drop(service);
        let restarted = test_manager(&root);
        let controller = NativeTaskLaunchController::new(&restarted);
        let passive = controller.status(&caller, &input.request_id).await.unwrap();
        assert_eq!(
            passive.launch.error.as_deref(),
            Some("initial wake interrupted")
        );
        assert!(restarted.inner.active_sessions.read().await.is_empty());
        let recovered = start(
            &controller,
            &caller,
            input.clone(),
            &restarted.inner.store_path,
        )
        .await;
        let delivered = delivered_status_after_wake(
            &restarted,
            &controller,
            &caller,
            &recovered,
            "initial wake interrupted",
        )
        .await;
        assert!(
            delivered.launch.error.is_none(),
            "{:?}",
            delivered.launch.error
        );
        assert_eq!(recovered.launch.session_id, first.launch.session_id);
        assert_eq!(recovered.launch.first_input_id, Some(input_id));
        assert_eq!(
            nac_core::store::load_session_inbox_item(
                &restarted.inner.store_path,
                session,
                input_id,
            )
            .unwrap()
            .status,
            nac_core::store::InboxStatus::Delivered
        );
        restarted.cancel_active_run(session).await.unwrap();
        stop(&restarted).await;
        assert_eq!(
            nac_core::store::list_session_inbox(&restarted.inner.store_path, session)
                .unwrap()
                .len(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_ready_retry_preserves_cancelled_or_missing_input_error_after_restart() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for retained in [false, true] {
        for missing in [false, true] {
            let root = temp_root("native_terminal_input_retry");
            let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
            let manager = test_manager(&root);
            let (controller, caller, input) = fixture_context(&root, &manager, retained).await;
            let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
            if retained {
                *manager
                    .inner
                    .task_preparations
                    .initial_input_wake
                    .lock()
                    .unwrap() = Some(gate.clone());
            } else {
                *manager
                    .inner
                    .session_creation_after_persistence
                    .lock()
                    .unwrap() = Some(gate.clone());
            }
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
            let launch = controller
                .status(&caller, &input.request_id)
                .await
                .unwrap()
                .launch;
            let session = &launch.session_id;
            let input_id = launch.first_input_id.unwrap();
            let service = manager
                .session_attachment()
                .attach_question_target(session)
                .await
                .unwrap();
            let lease =
                sessions::SessionOperationLease::try_acquire(&manager.inner.store_path, session)
                    .unwrap();
            gate.resume.notify_one();
            settle(&manager).await;
            nac_core::store::update_native_task_admission_error(
                &manager.inner.store_path,
                &input.request_id,
                Some("initial wake interrupted".into()),
            )
            .unwrap();
            if missing {
                // Corrupt only this isolated fixture, after recording the real Pending failure.
                rusqlite::Connection::open(&manager.inner.store_path)
                    .unwrap()
                    .execute(
                        "DELETE FROM session_inbox WHERE id=?1 AND session_id=?2",
                        rusqlite::params![input_id, session],
                    )
                    .unwrap();
            } else {
                let item = nac_core::store::load_session_inbox_item(
                    &manager.inner.store_path,
                    session,
                    input_id,
                )
                .unwrap();
                nac_core::store::cancel_pending_session_inbox_item(
                    &manager.inner.store_path,
                    session,
                    input_id,
                    item.version,
                )
                .unwrap();
            }
            let retry = start(
                &controller,
                &caller,
                input.clone(),
                &manager.inner.store_path,
            )
            .await;
            eprintln!("native terminal-input retained={retained} missing={missing}: returned={retry:?}; exact_input={:?}", nac_core::store::load_session_inbox_item(&manager.inner.store_path, session, input_id));
            assert_eq!(
                retry.launch.error.as_deref(),
                Some("initial wake interrupted")
            );
            assert_eq!(retry.launch.session_id, first.launch.session_id);
            assert_eq!(retry.launch.first_input_id, Some(input_id));
            assert_eq!(retry.launch.phase, "ready");
            assert!(!service.has_active_operation());
            stop(&manager).await;
            drop(lease);
            drop(service);
            let restarted = test_manager(&root);
            let controller = NativeTaskLaunchController::new(&restarted);
            let passive = controller.status(&caller, &input.request_id).await.unwrap();
            assert!(restarted.inner.active_sessions.read().await.is_empty());
            let retry = start(
                &controller,
                &caller,
                input.clone(),
                &restarted.inner.store_path,
            )
            .await;
            eprintln!("native terminal-input restart retained={retained} missing={missing}: returned={retry:?}; exact_input={:?}", nac_core::store::load_session_inbox_item(&restarted.inner.store_path, session, input_id));
            assert_eq!(retry.launch, passive.launch);
            assert_eq!(
                retry.launch.error.as_deref(),
                Some("initial wake interrupted")
            );
            let rows =
                nac_core::store::list_session_inbox(&restarted.inner.store_path, session).unwrap();
            assert_eq!(rows.len(), if missing { 0 } else { 1 });
            if !missing {
                assert_eq!(rows[0].id, input_id);
                assert_eq!(rows[0].status, nac_core::store::InboxStatus::Cancelled);
            }
            assert_eq!(retry.task.unwrap().run_count, 0);
            stop(&restarted).await;
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_failure_receipt_settles_before_owned_store_drain() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    // Owned first makes the expected-red characterization exercise real store ownership.
    for owned in [true, false] {
        let root = temp_root("native_failure_receipt_settlement");
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
        let setup = test_manager(&root);
        let (_, caller, input) = fixture_context(&root, &setup, false).await;
        drop(setup);
        let manager = if owned {
            SessionManager::new_async(ServerOptions {
                root_cwd: root.clone(),
                store_path: Some(root.join("store.db")),
                worker_executable: None,
                managed_host: None,
            })
            .await
            .unwrap()
        } else {
            test_manager(&root)
        };
        let controller = NativeTaskLaunchController::new(&manager);
        let projection = Arc::new(application::session_creation::CreationProjectionGate::default());
        let failure = Arc::new(application::session_creation::CreationProjectionGate::default());
        *manager
            .inner
            .session_creation_before_projection
            .lock()
            .unwrap() = Some(projection.clone());
        *manager
            .inner
            .task_preparations
            .native_failure_before_receipt
            .lock()
            .unwrap() = Some(failure.clone());
        let first = start(
            &controller,
            &caller,
            input.clone(),
            &manager.inner.store_path,
        )
        .await;
        assert!(!first.launch.retained, "owned={owned}; receipt={first:?}");
        tokio::time::timeout(Duration::from_secs(10), projection.reached.notified())
            .await
            .unwrap();
        manager.stop_local_run_admission().await;
        projection.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(10), failure.reached.notified())
            .await
            .unwrap();
        // Preparation has returned Err, but the outer error command cannot have started.
        let waiting = controller.status(&caller, &input.request_id).await.unwrap();
        eprintln!("native failure barrier owned={owned}; receipt={waiting:?}");
        assert_eq!(waiting.launch.phase, "preparing_runtime");
        assert!(waiting.launch.error.is_none());
        assert!(waiting.launch.first_input_id.is_none());
        assert_eq!(waiting.launch.session_id, first.launch.session_id);
        assert!(
            !sessions::session_exists(&manager.inner.store_path, &first.launch.session_id).unwrap()
        );
        assert!(manager.inner.active_sessions.read().await.is_empty());
        assert!(matches!(
            sessions::SessionOperationLease::try_acquire(
                &manager.inner.store_path,
                &format!("native-task-launch:{}", input.request_id),
            ),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
        {
            // One poll per checkpoint, with cooperative budget disabled only for that poll.
            // Pending must not mean that Tokio yielded before inspecting the semaphore.
            let mut settlement = Box::pin(manager.inner.task_preparations.settle());
            let first_poll = tokio::task::coop::unconstrained(std::future::poll_fn(|cx| {
                std::task::Poll::Ready(std::future::Future::poll(settlement.as_mut(), cx))
            }))
            .await;
            assert!(
                first_poll.is_pending(),
                "settle crossed the deferred failure receipt; owned={owned}; receipt={waiting:?}"
            );
            let mut shutdown = Box::pin(async {
                manager.quiesce_persistence_callers().await;
                manager.drain_persistence().await.unwrap();
            });
            let shutdown_poll = tokio::task::coop::unconstrained(std::future::poll_fn(|cx| {
                std::task::Poll::Ready(std::future::Future::poll(shutdown.as_mut(), cx))
            }))
            .await;
            assert!(
                shutdown_poll.is_pending(),
                "shutdown drained before the failure receipt; owned={owned}; receipt={waiting:?}"
            );
            failure.resume.notify_one();
            tokio::time::timeout(Duration::from_secs(10), settlement)
                .await
                .unwrap();
            tokio::time::timeout(Duration::from_secs(10), shutdown)
                .await
                .unwrap();
        }
        // The serving coordinator is drained. Inspect only this fixture's persisted rows.
        let connection = rusqlite::Connection::open_with_flags(
            &manager.inner.store_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let row: (String, Option<String>, Option<i64>) = connection
            .query_row(
                "SELECT phase,error,first_input_id FROM native_task_launches WHERE request_id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        eprintln!(
            "native failure settled owned={owned}; request={}; session={}; row={row:?}",
            input.request_id, first.launch.session_id
        );
        assert_eq!(row.0, "failed");
        assert_eq!(
            row.1.as_deref(),
            Some("conflict: server is stopping; retained task preparation interrupted")
        );
        assert!(row.2.is_none());
        for table in ["sessions", "session_inbox"] {
            let count: i64 = connection
                .query_row(
                    &format!("SELECT count(*) FROM {table} WHERE session_id=?1"),
                    [&first.launch.session_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "owned={owned}; unexpected target rows in {table}");
        }
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM native_task_launches WHERE request_id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        drop(connection);
        let lease = sessions::SessionOperationLease::try_acquire(
            &manager.inner.store_path,
            &format!("native-task-launch:{}", input.request_id),
        )
        .unwrap();
        drop(lease);
        drop(controller);
        drop(manager);
        if owned {
            let restarted = SessionManager::new_async(ServerOptions {
                root_cwd: root.clone(),
                store_path: Some(root.join("store.db")),
                worker_executable: None,
                managed_host: None,
            })
            .await
            .unwrap();
            let controller = NativeTaskLaunchController::new(&restarted);
            let observed = controller.status(&caller, &input.request_id).await.unwrap();
            assert_eq!(observed.launch.phase, "failed");
            assert_eq!(observed.launch.session_id, first.launch.session_id);
            assert!(observed.launch.first_input_id.is_none());
            assert!(observed.task.is_none());
            assert!(restarted.inner.active_sessions.read().await.is_empty());
            stop(&restarted).await;
            drop(controller);
            drop(restarted);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
