use super::*;

fn blocked(id: &str, session: &str) -> nac_core::permissions::PermissionReview {
    nac_core::permissions::PermissionReview {
        id: id.into(),
        session_id: session.into(),
        call_id: Some("call-1".into()),
        tool: "exec_command".into(),
        backend: "local".into(),
        resources: vec![nac_core::permissions::ReviewResource {
            action: "execute".into(),
            resource: "command:[git][push]".into(),
            display: "git push".into(),
        }],
        user_authorized_retry: false,
        outcome: Some(nac_core::permissions::PermissionReviewOutcome::Rejected),
        code: Some(nac_core::permissions::PermissionReviewCode::ReviewRejected),
        category: Some(nac_core::permissions::ReviewCategory::OutOfScope),
        failure_reason: None,
        duration_ms: Some(5),
        reviewer: "test".into(),
        created_at_epoch_ms: 1,
    }
}

fn seed_child(root: &std::path::Path) {
    for id in ["parent", "other", "child"] {
        seed_direct_session(root, id);
    }
    nac_core::store::create_traditional_child_relationship(
        &root.join("store.db"),
        "parent",
        "child",
        nac_core::store::GENERAL_CHILD_PROFILE,
        "retry child",
    )
    .unwrap();
}

fn retry(parent: &str, review: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!(
            "/sessions/{parent}/children/child/permissions/reviews/{review}/authorize-retry"
        ))
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn child_retry_is_parent_owned_child_local_and_rolls_back_only_before_commit() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_review_retry_ownership");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    seed_child(&root);
    let manager = test_manager(&root);
    let app = router(manager.clone());
    // Wrong ownership is rejected even before child attachment.
    assert_eq!(
        app.clone()
            .oneshot(retry("other", "review"))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("child"));
    let service = manager.attach_session("child").await.unwrap();
    let broker = service.permission_broker_for_test().unwrap();
    broker.insert_blocked_review_for_test(blocked("review", "child"));
    let parent = manager.attach_session("parent").await.unwrap();
    parent
        .permission_broker_for_test()
        .unwrap()
        .insert_blocked_review_for_test(blocked("parent-only", "parent"));
    assert_eq!(
        app.clone()
            .oneshot(retry("parent", "parent-only"))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert!(service
        .authorize_permission_review_retry("review")
        .await
        .is_err());
    assert_eq!(
        app.clone()
            .oneshot(retry("child", "review"))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    nac_core::session_service::SessionService::fail_next_retry_enqueue_for_test();
    assert_eq!(
        app.clone()
            .oneshot(retry("parent", "review"))
            .await
            .unwrap()
            .status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(broker.blocked_reviews().len(), 1);
    assert_eq!(broker.pending_retry_authorizations_for_test(), 0);
    assert!(
        nac_core::store::list_session_inbox(&root.join("store.db"), "child")
            .unwrap()
            .is_empty()
    );
    nac_core::session_service::SessionService::fail_next_retry_wake_for_test();
    assert_eq!(
        app.clone()
            .oneshot(retry("parent", "review"))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "child").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].delivery, InboxDelivery::Steer);
    assert_eq!(broker.pending_retry_authorizations_for_test(), 1);
    assert!(parent.list_direct_inbox().unwrap().is_empty());
    assert_eq!(
        app.oneshot(retry("parent", "review"))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        nac_core::store::list_session_inbox(&root.join("store.db"), "child")
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn child_retry_fences_deletion_suppression_and_peer_owned_running_generation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_review_retry_fences");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    seed_child(&root);
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let service = manager.attach_session("child").await.unwrap();
    let broker = service.permission_broker_for_test().unwrap();
    broker.insert_blocked_review_for_test(blocked("review", "child"));
    for id in ["parent", "child"] {
        let deletion =
            sessions::SessionRelationshipLease::try_acquire(&root.join("store.db"), id).unwrap();
        assert!(service
            .authorize_child_permission_review_retry("parent", "review")
            .await
            .is_err());
        assert_eq!(broker.pending_retry_authorizations_for_test(), 0);
        drop(deletion);
    }
    let operation =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "child").unwrap();
    let running = nac_core::store::begin_traditional_child_run(
        &root.join("store.db"),
        "child",
        "peer-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::suppress_traditional_child_completion(&root.join("store.db"), "child")
        .unwrap();
    assert!(service
        .authorize_child_permission_review_retry("parent", "review")
        .await
        .is_err());
    assert_eq!(broker.pending_retry_authorizations_for_test(), 0);
    nac_core::store::restore_traditional_child_completion(
        &root.join("store.db"),
        "child",
        running.generation,
    )
    .unwrap();
    assert_eq!(
        app.oneshot(retry("parent", "review"))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "child").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].target_run_id.as_deref(), Some("peer-run"));
    assert_eq!(
        nac_core::store::load_traditional_child(&root.join("store.db"), "child")
            .unwrap()
            .unwrap()
            .generation,
        running.generation
    );
    drop(operation);
    // Deleting the durable relationship cannot leave a cached child with recourse.
    view::delete_session(&root.join("store.db"), "child").unwrap();
    broker.insert_blocked_review_for_test(blocked("deleted", "child"));
    assert!(service
        .authorize_child_permission_review_retry("parent", "deleted")
        .await
        .is_err());
    assert_eq!(broker.pending_retry_authorizations_for_test(), 1);
}

#[tokio::test]
async fn child_retry_steers_local_active_generation_without_changing_mode() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_review_retry_active");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    seed_child(&root);
    let endpoint = point_session_at_hanging_endpoint(&root, "child").await;
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let service = manager.attach_session("child").await.unwrap();
    service
        .try_submit_traditional_child_prompt(
            "wait for steering".into(),
            TraditionalChildExecutionMode::Foreground,
        )
        .unwrap();
    let active = service.active_run().unwrap();
    let before = nac_core::store::load_traditional_child(&root.join("store.db"), "child")
        .unwrap()
        .unwrap();
    let broker = service.permission_broker_for_test().unwrap();
    broker.insert_blocked_review_for_test(blocked("local", "child"));
    assert_eq!(
        app.oneshot(retry("parent", "local"))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "child").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(
        inbox[0].target_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    let after = nac_core::store::load_traditional_child(&root.join("store.db"), "child")
        .unwrap()
        .unwrap();
    assert_eq!(after.generation, before.generation);
    assert_eq!(
        after.execution_mode,
        Some(TraditionalChildExecutionMode::Foreground)
    );
    service
        .connect_client()
        .request_cancel(&active.run_id)
        .await
        .unwrap();
    endpoint.abort();
}

#[tokio::test]
async fn terminal_child_retry_starts_background_successor_and_delivers_parent_completion() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("child_review_retry_terminal");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    seed_child(&root);
    let (base, _requests) = scripted_direct_response();
    let mut snapshot = sessions::load_session(&root.join("store.db"), "child").unwrap();
    snapshot.base_url = base;
    sessions::update_session_config(&root.join("store.db"), &snapshot).unwrap();
    let old = nac_core::store::begin_traditional_child_run(
        &root.join("store.db"),
        "child",
        "old-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    nac_core::store::settle_traditional_child_run(
        &root.join("store.db"),
        "child",
        "old-run",
        nac_core::store::TraditionalChildTerminal {
            status: nac_core::store::TraditionalChildStatus::Completed,
            report: Some("old result".into()),
            failure: None,
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap();
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let service = manager.attach_session("child").await.unwrap();
    service
        .permission_broker_for_test()
        .unwrap()
        .insert_blocked_review_for_test(blocked("terminal", "child"));
    assert_eq!(
        app.oneshot(retry("parent", "terminal"))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let completed = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let record = nac_core::store::load_traditional_child(&root.join("store.db"), "child")
                .unwrap()
                .unwrap();
            if record.generation > old.generation && record.status.is_terminal() {
                break record;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(completed.generation, old.generation + 1);
    assert_eq!(
        completed.status,
        nac_core::store::TraditionalChildStatus::Completed
    );
    assert_eq!(
        completed.execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    let completion_id = completed
        .completion_inbox_id
        .expect("successor delivers completion");
    let parent_inbox =
        nac_core::store::list_session_inbox(&root.join("store.db"), "parent").unwrap();
    assert_eq!(
        parent_inbox
            .iter()
            .filter(|item| item.id == completion_id)
            .count(),
        1
    );
}
