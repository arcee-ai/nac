use super::*;

#[tokio::test]
async fn foreign_child_attachment_is_uncached_until_peer_lease_retires() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("foreign_child_uncached_lifecycle");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    let (base, _requests) = scripted_direct_responses(&["successor report"]);
    seed_direct_session_with_base_url(&root, "parent", base.clone());
    seed_direct_session_with_base_url(&root, "child", base);
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "uncached child",
    )
    .unwrap();
    let original = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "foreign-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let start = sessions::load_session(&path, "child")
        .unwrap()
        .messages
        .len() as u64;
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "child",
            start,
            &Message::User {
                content: "foreign prompt".into(),
            },
            "foreign-run",
        )
        .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let manager = test_manager(&root);
    let controller = nac_core::traditional_children::controller_for(&path).unwrap();
    let waiting = tokio::spawn(async move {
        controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: "parent".into(),
                    child_session_id: Some("child".into()),
                    profile: "general".into(),
                    description: Some("uncached child".into()),
                    prompt: "queued after peer".into(),
                    origin: nac_core::store::InputOrigin::Automation,
                    execution_mode: TraditionalChildExecutionMode::Foreground,
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if !nac_core::store::list_session_inbox(&path, "child")
                .unwrap()
                .is_empty()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("foreground input must be queued");
    waiting.abort();
    assert!(waiting.await.unwrap_err().is_cancelled());
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("child"));
    let first = manager.attach_session("child").await.unwrap();
    let second = manager.attach_session("child").await.unwrap();
    assert!(
        !Arc::ptr_eq(&first, &second),
        "foreign observers are not cached owners"
    );
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("child"));
    assert_eq!(
        nac_core::store::load_traditional_child(&path, "child")
            .unwrap()
            .unwrap(),
        original
    );
    drop(first);
    drop(second);
    drop(peer);
    let canonical = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(service) = manager
                .inner
                .active_sessions
                .read()
                .await
                .get("child")
                .cloned()
            {
                break service;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the owner must attach the child without another request");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let child = nac_core::store::load_traditional_child(&path, "child")
                .unwrap()
                .unwrap();
            if child.generation == original.generation + 1 && child.status.is_terminal() {
                assert_eq!(
                    child.execution_mode,
                    Some(TraditionalChildExecutionMode::Background)
                );
                let inbox = nac_core::store::list_session_inbox(&path, "child").unwrap();
                assert_eq!(inbox.len(), 1);
                assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
                assert_eq!(inbox[0].delivered_run_id, child.run_id);
                let receipt = nac_core::store::load_traditional_child_terminal_receipt(
                    &path,
                    "child",
                    child.generation,
                )
                .unwrap()
                .unwrap();
                let completions = nac_core::store::list_session_inbox(&path, "parent").unwrap();
                assert_eq!(completions.len(), 1);
                assert_eq!(receipt.completion_inbox_id, Some(completions[0].id));
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the abandoned input must settle once");
    drop(canonical);
    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.inner.continuation_owners.contains("child") {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the delivered child obligation must retire");
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

fn init_owned_child_workspace(root: &std::path::Path) {
    std::fs::write(root.join(".gitignore"), "store.db*\nnac-home/\n").unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["add", ".gitignore"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "child fixture",
        ],
    ] {
        assert!(std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn cancelled_owned_child_creation_retains_relationship_lease_until_commit() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cancelled_owned_child_creation");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, None);
    seed_direct_session(&root, "parent");
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let path = manager.inner.store_path.clone();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    *CHILD_CREATION_PAUSE.lock().unwrap() =
        Some((path.clone(), "parent".into(), started_tx, release_rx));
    let creator = manager.clone();
    let task = tokio::spawn(async move {
        creator
            .create_traditional_child_session("parent", "general", "leased creation")
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), started_rx)
        .await
        .unwrap()
        .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(matches!(
        sessions::SessionRelationshipLease::try_acquire(&path, "parent"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match sessions::SessionRelationshipLease::try_acquire(&path, "parent") {
                Ok(lease) => {
                    drop(lease);
                    break;
                }
                Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                    tokio::time::sleep(Duration::from_millis(10)).await
                }
                Err(error) => panic!("relationship lease probe failed: {error}"),
            }
        }
    })
    .await
    .unwrap();
    let children_path = path.clone();
    let children = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_traditional_children(&children_path, "parent")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(children.len(), 1);
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_child_launch_and_wait_use_coordinator() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_current_thread_child");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    init_owned_child_workspace(&root);
    let (base_url, requests) = scripted_direct_responses(&[
        "foreground report",
        "background report",
        "parent acknowledged",
    ]);
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let controller =
        nac_core::traditional_children::controller_for(&manager.inner.store_path).unwrap();
    let start = |child_session_id, execution_mode| {
        nac_core::traditional_children::TraditionalChildStartRequest {
            parent_session_id: "direct".into(),
            child_session_id,
            profile: "general".into(),
            description: Some("owned child fixture".into()),
            prompt: "work".into(),
            origin: nac_core::store::InputOrigin::Automation,
            execution_mode,
        }
    };
    let first = tokio::time::timeout(
        Duration::from_secs(5),
        controller.start(start(None, TraditionalChildExecutionMode::Foreground)),
    )
    .await
    .unwrap()
    .unwrap();
    let first = tokio::time::timeout(
        Duration::from_secs(5),
        controller.wait(&first.child_session_id, first.generation),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(first.report.as_deref(), Some("foreground report"));
    let second = tokio::time::timeout(
        Duration::from_secs(5),
        controller.start(start(
            Some(first.child_session_id.clone()),
            TraditionalChildExecutionMode::Background,
        )),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(second.generation, first.generation + 1);
    let second = tokio::time::timeout(
        Duration::from_secs(5),
        controller.wait(&second.child_session_id, second.generation),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(second.report.as_deref(), Some("background report"));
    let app = crate::delivery::server::build_router(manager.clone());
    assert_eq!(
        get_response(app.clone(), "/sessions/direct/children", None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        get_response(
            app.clone(),
            &format!("/sessions/direct/children/{}", second.child_session_id),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        get_response(
            app,
            &format!("/sessions/other/children/{}", second.child_session_id),
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let path = manager.inner.store_path.clone();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let path = path.clone();
            let inbox = nac_core::store::spawn_blocking_store_caller(move || {
                nac_core::store::list_session_inbox(&path, "direct")
            })
            .await
            .unwrap()
            .unwrap();
            if inbox.len() == 1 && inbox[0].status == nac_core::store::InboxStatus::Delivered {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background completion should be delivered once");
    let parent = manager.attach_session("direct").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while parent.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    tokio::task::spawn_blocking(move || {
        for index in 0..3 {
            assert_eq!(
                requests.recv_timeout(Duration::from_secs(5)).unwrap(),
                index
            );
        }
    })
    .await
    .unwrap();
    manager.drain_persistence().await.unwrap();
    drop(parent);
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_child_cancel_endpoint_preserves_generation() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_current_thread_child_cancel");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-cancel-key"));
    init_owned_child_workspace(&root);
    let (base_url, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let app = crate::delivery::server::build_router(manager.clone());
    let start = app.clone().oneshot(Request::builder().method("POST").uri("/sessions/direct/children")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"profile":"general","description":"cancel fixture","prompt":"wait","background":true}"#)).unwrap()).await.unwrap();
    assert_eq!(start.status(), StatusCode::CREATED);
    let running: TraditionalChildRecord =
        serde_json::from_slice(&response_body(start).await).unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0)
    })
    .await
    .unwrap();
    let controller =
        nac_core::traditional_children::controller_for(&manager.inner.store_path).unwrap();
    let stale = controller
        .cancel("direct", &running.child_session_id, running.generation + 1)
        .await
        .unwrap_err();
    assert!(stale.to_string().contains("superseded"));
    let cancel = tokio::time::timeout(
        Duration::from_secs(10),
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/sessions/direct/children/{}/cancel",
                    running.child_session_id
                ))
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancelled: TraditionalChildRecord =
        serde_json::from_slice(&response_body(cancel).await).unwrap();
    assert_eq!(cancelled.generation, running.generation);
    assert_eq!(
        cancelled.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert!(cancelled.completion_inbox_id.is_some());
    release.send(()).unwrap();
    let path = manager.inner.store_path.clone();
    let inbox = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_session_inbox(&path, "direct")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(cancelled.completion_inbox_id, Some(inbox[0].id));
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn uncached_inbox_wake_survives_a_busy_peer_without_another_request() {
    check_parent_peer_wake(true).await;
}

#[tokio::test]
async fn cached_inbox_wake_survives_a_busy_peer_without_another_request() {
    check_parent_peer_wake(false).await;
}

async fn check_parent_peer_wake(with_recovery: bool) {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_wake_busy_peer");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-wake-fixture-key"));
    let (base, _requests) = scripted_direct_responses(&["continued"]);
    seed_direct_session_with_base_url(&root, "parent", base);
    let path = root.join("store.db");
    let item = nac_core::store::create_session_inbox_item(
        &path,
        "parent",
        nac_core::store::InboxDelivery::Queue,
        "continue",
        None,
        None,
    )
    .unwrap();
    if with_recovery {
        let start = sessions::load_session(&path, "parent")
            .unwrap()
            .messages
            .len() as u64;
        nac_core::store::TranscriptLogWriter::new(&path)
            .unwrap()
            .append_run_prompt(
                "parent",
                start,
                &Message::User {
                    content: "peer run".into(),
                },
                "foreign-parent-run",
            )
            .unwrap();
    }
    let peer = sessions::SessionOperationLease::try_acquire(&path, "parent").unwrap();
    let manager = test_manager(&root);
    let first = manager.attach_session("parent").await.unwrap();
    let second = manager.attach_session("parent").await.unwrap();
    assert_eq!(Arc::ptr_eq(&first, &second), !with_recovery);

    drop(first);
    drop(second);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        nac_core::store::load_session_inbox_item(&path, "parent", item.id)
            .unwrap()
            .status,
        nac_core::store::InboxStatus::Pending
    );
    drop(peer);
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let item = nac_core::store::load_session_inbox_item(&path, "parent", item.id).unwrap();
            if item.status == nac_core::store::InboxStatus::Delivered {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the serving owner must retry after the peer exits");
    assert_eq!(
        nac_core::store::list_session_inbox(&path, "parent")
            .unwrap()
            .len(),
        1
    );
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn peer_exit_before_admission_uses_canonical_child_service() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_peer_exit_before_admission");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    let (base, _requests) = scripted_direct_responses(&["canonical response"]);
    seed_direct_session_with_base_url(&root, "parent", base.clone());
    seed_direct_session_with_base_url(&root, "child", base);
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "uncached child",
    )
    .unwrap();
    let original = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "foreign-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let start = sessions::load_session(&path, "child")
        .unwrap()
        .messages
        .len() as u64;
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "child",
            start,
            &Message::User {
                content: "foreign prompt".into(),
            },
            "foreign-run",
        )
        .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let manager = test_manager(&root);
    let reservation = manager.reserve_continuation("child").await.unwrap();
    let observer = manager.attach_session("child").await.unwrap();
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("child"));
    drop(peer);
    let result = manager
        .submit_owned_child_input(
            Some(observer.clone()),
            None,
            "parent".into(),
            "child".into(),
            "continue".into(),
            TraditionalChildExecutionMode::Foreground,
            nac_core::store::InputOrigin::Automation,
            reservation,
        )
        .await
        .unwrap();
    assert_eq!(result.generation, original.generation + 1);
    let canonical = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("child")
        .cloned()
        .expect("successor must belong to a canonical cached service");
    assert!(!Arc::ptr_eq(&observer, &canonical));
    drop(observer);
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn shutdown_joins_child_retry_while_foreign_peer_remains_alive() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_retry_shutdown_foreign_peer");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    seed_direct_session(&root, "parent");
    seed_direct_session(&root, "child");
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "uncached child",
    )
    .unwrap();
    let original = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "foreign-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let start = sessions::load_session(&path, "child")
        .unwrap()
        .messages
        .len() as u64;
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "child",
            start,
            &Message::User {
                content: "foreign prompt".into(),
            },
            "foreign-run",
        )
        .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let manager = test_manager(&root);
    let controller = nac_core::traditional_children::controller_for(&path).unwrap();
    let waiting = tokio::spawn(async move {
        controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: "parent".into(),
                    child_session_id: Some("child".into()),
                    profile: "general".into(),
                    description: Some("uncached child".into()),
                    prompt: "retain through shutdown".into(),
                    origin: nac_core::store::InputOrigin::Automation,
                    execution_mode: TraditionalChildExecutionMode::Foreground,
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while nac_core::store::list_session_inbox(&path, "child")
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    manager.stop_local_run_admission().await;
    tokio::time::timeout(
        Duration::from_secs(5),
        manager.quiesce_persistence_callers(),
    )
    .await
    .expect("shutdown must join child admission and retry owners");
    assert!(waiting.await.unwrap().is_err());
    let inbox = nac_core::store::list_session_inbox(&path, "child").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Pending);
    assert_eq!(
        nac_core::store::load_traditional_child(&path, "child")
            .unwrap()
            .unwrap(),
        original
    );
    drop(peer);
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn shutdown_joins_owner_waiting_for_a_lifecycle_gate() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_wake_shutdown_gate");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-wake-fixture-key"));
    seed_direct_session(&root, "parent");
    let path = root.join("store.db");
    nac_core::store::create_session_inbox_item(
        &path,
        "parent",
        nac_core::store::InboxDelivery::Queue,
        "retained",
        None,
        None,
    )
    .unwrap();
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("parent");
    let held = gate.lock().await;
    manager.schedule_continuation("parent").unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        manager.inner.continuation_owners.wait_for_gate_attempt(),
    )
    .await
    .expect("owner must reach the held gate");
    manager.stop_local_run_admission().await;
    tokio::time::timeout(
        Duration::from_secs(5),
        manager.quiesce_persistence_callers(),
    )
    .await
    .expect("a waiting owner must stop without taking the held gate");
    assert_eq!(
        nac_core::store::list_session_inbox(&path, "parent").unwrap()[0].status,
        nac_core::store::InboxStatus::Pending
    );
    drop(held);
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn delivered_inbox_wake_retires_while_peer_run_remains_active() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_wake_delivered_active_peer");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-wake-fixture-key"));
    seed_direct_session(&root, "parent");
    let path = root.join("store.db");
    let item = nac_core::store::create_session_inbox_item(
        &path,
        "parent",
        nac_core::store::InboxDelivery::Queue,
        "delivered",
        None,
        None,
    )
    .unwrap();
    let idx = sessions::load_session(&path, "parent")
        .unwrap()
        .messages
        .len() as u64;
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "parent",
            idx,
            &Message::User {
                content: "peer prompt".into(),
            },
            "peer-run",
        )
        .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "parent").unwrap();
    let manager = test_manager(&root);
    manager.schedule_continuation("parent").unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        manager.inner.continuation_owners.wait_for_gate_attempt(),
    )
    .await
    .expect("owner must observe the live peer");
    // Simulate the peer's committed delivery while its OS run lease stays held.
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(connection.execute(
        "UPDATE session_inbox SET status='delivered', delivered_run_id='peer-run', delivered_at=created_at, version=version+1 WHERE id=?1 AND status='pending'",
        [item.id],
    ).unwrap(), 1);
    drop(connection);
    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.inner.continuation_owners.contains("parent") {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("durably delivered work must retire without waiting for the peer run");
    assert_eq!(
        nac_core::store::load_session_inbox_item(&path, "parent", item.id)
            .unwrap()
            .status,
        nac_core::store::InboxStatus::Delivered
    );
    drop(peer);
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn recovery_owner_settles_a_bound_generation_without_an_inbox_row() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_recovery_without_inbox");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-wake-fixture-key"));
    seed_direct_session(&root, "parent");
    seed_direct_session(&root, "child");
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "uncertain admission",
    )
    .unwrap();
    let running = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "bound-before-prompt",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let manager = test_manager(&root);
    manager.schedule_recovery("child").unwrap();
    let terminal = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let child = nac_core::store::load_traditional_child(&path, "child")
                .unwrap()
                .unwrap();
            if child.status.is_terminal() {
                break child;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("bound generation must be recovered without a second input");
    assert_eq!(terminal.generation, running.generation);
    assert_eq!(terminal.run_id.as_deref(), Some("bound-before-prompt"));
    assert_eq!(
        terminal.status,
        nac_core::store::TraditionalChildStatus::Interrupted
    );
    assert!(nac_core::store::list_session_inbox(&path, "child")
        .unwrap()
        .is_empty());
    assert!(nac_core::store::load_traditional_child_terminal_receipt(
        &path,
        "child",
        running.generation,
    )
    .unwrap()
    .is_some());
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn pending_child_retry_retains_cached_service_during_idle_sweep() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_retry_retains_cache");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    seed_direct_session(&root, "parent");
    seed_direct_session(&root, "child");
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "uncached child",
    )
    .unwrap();
    let manager = test_manager(&root);
    let cached = manager.attach_session("child").await.unwrap();
    let identity = Arc::downgrade(&cached);
    drop(cached);
    let original = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "foreign-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let controller = nac_core::traditional_children::controller_for(&path).unwrap();
    let waiting = tokio::spawn(async move {
        controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: "parent".into(),
                    child_session_id: Some("child".into()),
                    profile: "general".into(),
                    description: Some("uncached child".into()),
                    prompt: "retain cached owner".into(),
                    origin: nac_core::store::InputOrigin::Automation,
                    execution_mode: TraditionalChildExecutionMode::Foreground,
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while nac_core::store::list_session_inbox(&path, "child")
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    waiting.abort();
    assert!(waiting.await.unwrap_err().is_cancelled());
    manager.sweep_idle_sessions(None).await;
    let current = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("child")
        .cloned()
        .expect("pending retry must retain the cached service");
    assert!(Arc::ptr_eq(&current, &identity.upgrade().unwrap()));
    assert_eq!(
        nac_core::store::load_traditional_child(&path, "child")
            .unwrap()
            .unwrap(),
        original
    );
    drop(current);
    manager.stop_local_run_admission().await;
    tokio::time::timeout(
        Duration::from_secs(5),
        manager.quiesce_persistence_callers(),
    )
    .await
    .unwrap();
    drop(peer);
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn controller_wake_reports_attachment_failure_to_caller() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_wake_missing_session");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    seed_direct_session(&root, "parent");
    let manager = test_manager(&root);
    let controller =
        nac_core::traditional_children::controller_for(&root.join("store.db")).unwrap();
    assert!(controller.wake("missing").await.is_err());
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn foreground_waiter_receives_permanent_recovery_error_without_losing_input() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_wake_terminal_error");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    seed_direct_session(&root, "parent");
    seed_direct_session(&root, "child");
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "mismatched recovery",
    )
    .unwrap();
    let original = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "relationship-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let idx = sessions::load_session(&path, "child")
        .unwrap()
        .messages
        .len() as u64;
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "child",
            idx,
            &Message::User {
                content: "different run".into(),
            },
            "different-recovery-run",
        )
        .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let manager = test_manager(&root);
    let controller = nac_core::traditional_children::controller_for(&path).unwrap();
    let waiting = tokio::spawn(async move {
        controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: "parent".into(),
                    child_session_id: Some("child".into()),
                    profile: "general".into(),
                    description: Some("mismatched recovery".into()),
                    prompt: "retain this input".into(),
                    origin: nac_core::store::InputOrigin::Automation,
                    execution_mode: TraditionalChildExecutionMode::Foreground,
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while nac_core::store::list_session_inbox(&path, "child")
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    drop(peer);
    let error = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("permanent selector failure must reach the live waiter")
        .unwrap()
        .unwrap_err();
    assert!(
        error.to_string().contains("child input wake failed"),
        "{error:#}"
    );
    let inbox = nac_core::store::list_session_inbox(&path, "child").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Pending);
    assert_eq!(
        nac_core::store::load_traditional_child(&path, "child")
            .unwrap()
            .unwrap(),
        original
    );
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn continuation_reservation_fences_config_replacement() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("continuation_config_replacement");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    seed_direct_session(&root, "parent");
    let manager = test_manager(&root);
    let before = sessions::load_session(&root.join("store.db"), "parent").unwrap();
    let reservation = manager.reserve_continuation("parent").await.unwrap();
    manager
        .update_session_config("parent", UpdateConfigRequest::default())
        .await
        .unwrap();
    let error = manager
        .update_session_config(
            "parent",
            UpdateConfigRequest {
                model: RequestField::Value("must-not-commit".into()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("active operation"));
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "parent")
            .unwrap()
            .config_version,
        before.config_version
    );
    drop(reservation);
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn formatted_overload_returns_to_waiter_and_owned_input_runs_once() {
    check_owned_input_failure_recovery(false).await;
}

#[tokio::test]
async fn lost_enqueue_ack_rechecks_input_without_reinserting() {
    check_owned_input_failure_recovery(true).await;
}

async fn check_owned_input_failure_recovery(lost_ack: bool) {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_owned_overload_retry");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    let (base, _requests) =
        scripted_direct_responses(&["child completed", "parent received child"]);
    seed_direct_session_with_base_url(&root, "parent", base.clone());
    seed_direct_session_with_base_url(&root, "child", base);
    let path = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "overloaded admission",
    )
    .unwrap();
    let original = nac_core::store::begin_traditional_child_run(
        &path,
        "child",
        "foreign-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let idx = sessions::load_session(&path, "child")
        .unwrap()
        .messages
        .len() as u64;
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "child",
            idx,
            &Message::User {
                content: "peer prompt".into(),
            },
            "foreign-run",
        )
        .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let manager = test_manager(&root);
    let observer = manager.attach_session("child").await.unwrap();
    if lost_ack {
        observer.lose_next_child_enqueue_ack_for_test();
    } else {
        observer.reject_next_child_inbox_admission_for_test();
    }
    drop(observer);
    let controller = nac_core::traditional_children::controller_for(&path).unwrap();
    let waiting = tokio::spawn(async move {
        controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: "parent".into(),
                    child_session_id: Some("child".into()),
                    profile: "general".into(),
                    description: Some("overloaded admission".into()),
                    prompt: "one durable input".into(),
                    origin: nac_core::store::InputOrigin::Automation,
                    execution_mode: TraditionalChildExecutionMode::Foreground,
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while nac_core::store::list_session_inbox(&path, "child")
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    drop(peer);
    let error = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("the existing foreground error must be returned")
        .unwrap()
        .unwrap_err();
    let expected = if lost_ack {
        "persistence executor stopped before acknowledgement"
    } else {
        "session operation coordination failed"
    };
    assert!(error.to_string().contains(expected), "{error:#}");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let child = nac_core::store::load_traditional_child(&path, "child")
                .unwrap()
                .unwrap();
            if child.generation == original.generation + 1 && child.status.is_terminal() {
                assert_eq!(
                    child.execution_mode,
                    Some(TraditionalChildExecutionMode::Background)
                );
                let inbox = nac_core::store::list_session_inbox(&path, "child").unwrap();
                assert_eq!(inbox.len(), 1, "retry must not reinsert the input");
                assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
                assert_eq!(inbox[0].delivered_run_id, child.run_id);
                let receipt = nac_core::store::load_traditional_child_terminal_receipt(
                    &path,
                    "child",
                    child.generation,
                )
                .unwrap()
                .unwrap();
                let completions = nac_core::store::list_session_inbox(&path, "parent").unwrap();
                assert_eq!(completions.len(), 1);
                assert_eq!(receipt.completion_inbox_id, Some(completions[0].id));
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the owner must recheck and deliver the original input");
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}
