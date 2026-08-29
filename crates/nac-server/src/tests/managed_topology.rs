use super::*;

#[tokio::test]
async fn attaching_direct_session_wakes_oldest_persisted_inbox_item() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_inbox_reattach");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-reattach-test-key"));
    let (base_url, request_finished) = scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let store_path = root.join("store.db");
    let pending = nac_core::store::create_session_inbox_item(
        &store_path,
        "direct",
        InboxDelivery::Queue,
        "survive restart",
        None,
        None,
    )
    .unwrap();

    let manager = test_manager(&root);
    let service = manager.attach_session("direct").await.unwrap();
    tokio::task::spawn_blocking(move || {
        request_finished
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("reattached direct run should finish");

    let delivered =
        nac_core::store::load_session_inbox_item(&store_path, "direct", pending.id).unwrap();
    assert_eq!(delivered.status, nac_core::store::InboxStatus::Delivered);
    assert!(delivered.delivered_run_id.is_some());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn attaching_direct_session_reconciles_one_stale_goal_claim_without_duplicate_start() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_goal_reattach");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-goal-reattach-key"));
    let (base_url, request_finished) = scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let store_path = root.join("store.db");
    nac_core::store::create_session_goal(
        &store_path,
        "direct",
        "resume exactly once",
        Some(15),
        None,
    )
    .unwrap();
    nac_core::store::bind_session_goal_run(
        &store_path,
        "direct",
        &nac_core::store::GoalRunBaseline {
            run_id: "stale-run".to_string(),
            billable_tokens: 0,
            started_at_epoch_ms: 1,
            continuation: true,
        },
    )
    .unwrap();

    let manager = test_manager(&root);
    let service = manager.attach_session("direct").await.unwrap();
    tokio::task::spawn_blocking(move || {
        request_finished
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let goal = service.direct_goal().unwrap().unwrap();
            if !service.has_active_operation() && goal.status == GoalStatus::BudgetLimited {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("one recovered continuation should settle at its budget");
    let goal = service.direct_goal().unwrap().unwrap();
    assert_eq!(goal.tokens_used, 15);
    assert!(goal.continuation_run_id.is_none());
    assert_ne!(goal.accounting_run_id.as_deref(), Some("stale-run"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_inbox_http_api_lists_edits_and_cancels_pending_input() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_inbox_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-inbox-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    let store_path = root.join("store.db");
    let _lease = sessions::SessionOperationLease::try_acquire(&store_path, "direct").unwrap();
    let app = router(test_manager(&root));

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/inbox")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"delivery":"queue","prompt":"do this later"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let create_status = create.status();
    let create_body = response_body(create).await;
    assert_eq!(
        create_status,
        StatusCode::ACCEPTED,
        "{}",
        String::from_utf8_lossy(&create_body)
    );
    let created: InboxItemResponse = serde_json::from_slice(&create_body).unwrap();
    assert_eq!(created.status, nac_core::store::InboxStatus::Pending);
    assert_eq!(created.prompt, "do this later");

    let list = get_response(app.clone(), "/sessions/direct/inbox", None).await;
    assert_eq!(list.status(), StatusCode::OK);
    let listed: Vec<InboxItemResponse> =
        serde_json::from_slice(&response_body(list).await).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);

    let update = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/sessions/direct/inbox/{}", created.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{},"delivery":"steer"}}"#,
                    created.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update.status(), StatusCode::OK);
    let updated: InboxItemResponse = serde_json::from_slice(&response_body(update).await).unwrap();
    assert_eq!(updated.delivery, InboxDelivery::Steer);
    assert_eq!(updated.target_run_id, None);

    let stale = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/sessions/direct/inbox/{}", created.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{},"delivery":"queue"}}"#,
                    created.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);

    let cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/sessions/direct/inbox/{}", created.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{}}}"#,
                    updated.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancelled: InboxItemResponse =
        serde_json::from_slice(&response_body(cancel).await).unwrap();
    assert_eq!(cancelled.status, nac_core::store::InboxStatus::Cancelled);

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/orchestrator/inbox")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"delivery":"queue","prompt":"not here"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_permission_http_api_lists_replies_and_removes_revision_bound_grants() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_permission_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-permission-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    let grant_id = nac_core::store::insert_permission_grants(
        &root.join("store.db"),
        "direct",
        "execute",
        &["command:[cargo][test]*".to_string()],
        "local",
        0,
    )
    .unwrap()[0]
        .id
        .clone();
    let app = router(test_manager(&root));

    let list = get_response(app.clone(), "/sessions/direct/permissions", None).await;
    assert_eq!(list.status(), StatusCode::OK);
    let state: PermissionStateResponse =
        serde_json::from_slice(&response_body(list).await).unwrap();
    assert!(state.requests.is_empty());
    assert_eq!(state.grants.len(), 1);
    assert_eq!(state.grants[0].id, grant_id);

    let missing_reply = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/permissions/missing")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"reply":"once"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_reply.status(), StatusCode::NOT_FOUND);

    let delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/sessions/direct/permissions/grants/{grant_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);
    let list = get_response(app.clone(), "/sessions/direct/permissions", None).await;
    let state: PermissionStateResponse =
        serde_json::from_slice(&response_body(list).await).unwrap();
    assert!(state.grants.is_empty());

    let rejected = get_response(app, "/sessions/orchestrator/permissions", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_goal_http_api_creates_edits_pauses_resumes_and_clears() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_goal_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-goal-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    let endpoint = point_session_at_hanging_endpoint(&root, "direct").await;
    let manager = test_manager(&root);
    manager
        .submit_prompt(
            "direct",
            SubmitPromptRequest {
                prompt: "hold the local run open".to_string(),
            },
        )
        .await
        .unwrap();
    let app = router(manager.clone());

    let empty = get_response(app.clone(), "/sessions/direct/goal", None).await;
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(response_body(empty).await.as_ref(), b"null");

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/goal")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"objective":"ship the feature","token_budget":500}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create.status(), StatusCode::CREATED);
    let created: SessionGoalRecord = serde_json::from_slice(&response_body(create).await).unwrap();
    assert_eq!(created.status, GoalStatus::Active);
    assert_eq!(created.token_budget, Some(500));

    let pause = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/direct/goal/{}", created.goal_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{},"objective":"ship safely","token_budget":null,"status":"paused"}}"#,
                        created.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(pause.status(), StatusCode::OK);
    let paused: SessionGoalRecord = serde_json::from_slice(&response_body(pause).await).unwrap();
    assert_eq!(paused.objective, "ship safely");
    assert_eq!(paused.token_budget, None);
    assert_eq!(paused.status, GoalStatus::Paused);

    let resume = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/sessions/direct/goal/{}", paused.goal_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{},"status":"active"}}"#,
                    paused.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resume.status(), StatusCode::OK);
    let resumed: SessionGoalRecord = serde_json::from_slice(&response_body(resume).await).unwrap();
    assert_eq!(resumed.status, GoalStatus::Active);

    let clear = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/sessions/direct/goal/{}", resumed.goal_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{}}}"#,
                    resumed.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(clear.status(), StatusCode::NO_CONTENT);

    let rejected = get_response(app, "/sessions/orchestrator/goal", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    manager.cancel_active_run("direct").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn traditional_child_goal_http_api_is_bad_request() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_goal_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("child-goal-test-key"));
    seed_direct_session(&root, "direct");
    let manager = test_manager(&root);
    let child_session_id = manager
        .create_traditional_child_session("direct", "general", "child goal ownership")
        .await
        .unwrap();
    let app = router(manager);

    let response = get_response(app, &format!("/sessions/{child_session_id}/goal"), None).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(
        body["error"],
        serde_json::Value::String(
            "running assigned sessions cannot own autonomous goals".to_string()
        )
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_orchestrator_http_api_runs_foreground_then_delivers_background_completion() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-test-key"));
    let (base_url, requests) = scripted_direct_responses(&[
        "foreground orchestrator done",
        "background orchestrator done",
        "parent received orchestrator completion",
    ]);
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    seed_direct_session(&root, "ordinary-direct");
    seed_editable_session(&root, "orchestrator");
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let foreground = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"description":"implement durable control","prompt":"complete the first pass","background":false}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(foreground.status(), StatusCode::CREATED);
    let foreground: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(foreground).await).unwrap();
    assert_eq!(foreground.status, ManagedOrchestratorStatus::Completed);
    assert_eq!(foreground.generation, 1);
    assert_eq!(
        foreground.report.as_deref(),
        Some("foreground orchestrator done")
    );
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    let child_snapshot =
        sessions::load_session(&root.join("store.db"), &foreground.orchestrator_session_id)
            .unwrap();
    assert_eq!(
        child_snapshot.behavior,
        sessions::SessionBehavior::Orchestrator
    );
    let lineage_response = get_response(
        app.clone(),
        &format!(
            "/sessions/{}?include_sessions=false",
            foreground.orchestrator_session_id
        ),
        None,
    )
    .await;
    assert_eq!(lineage_response.status(), StatusCode::OK);
    let lineage_json = response_json(lineage_response).await;
    assert_eq!(lineage_json["lineage"]["kind"], "managed-orchestrator");
    assert_eq!(lineage_json["lineage"]["parent_session_id"], "delegating");
    assert_eq!(
        lineage_json["lineage"]["description"],
        "implement durable control"
    );

    let background = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"description":"implement durable control","prompt":"complete the second pass","orchestrator_session_id":"{}","background":true}}"#,
                        foreground.orchestrator_session_id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(background.status(), StatusCode::CREATED);
    let background: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(background).await).unwrap();
    assert_eq!(background.status, ManagedOrchestratorStatus::Running);
    assert_eq!(background.generation, 2);
    assert_eq!(
        background.execution_mode,
        Some(ManagedOrchestratorExecutionMode::Background)
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
    })
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let orchestrator = manager
                .delegation()
                .managed_orchestrator("delegating", &foreground.orchestrator_session_id)
                .unwrap();
            if orchestrator.status == ManagedOrchestratorStatus::Completed {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background orchestrator should settle");
    let completed = manager
        .delegation()
        .managed_orchestrator("delegating", &foreground.orchestrator_session_id)
        .unwrap();
    assert_eq!(completed.generation, 2);
    assert_eq!(
        completed.report.as_deref(),
        Some("background orchestrator done")
    );
    assert!(completed.completion_inbox_id.is_some());
    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "delegating").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
    assert!(inbox[0]
        .content
        .contains(&foreground.orchestrator_session_id));

    assert_eq!(
        get_response(app.clone(), "/sessions/ordinary-direct/orchestrators", None)
            .await
            .status(),
        StatusCode::OK
    );
    let rejected = get_response(app, "/sessions/orchestrator/orchestrators", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(rejected).await["error"],
        sessions::NAC_CANNOT_CREATE_SESSIONS
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn nac_parent_cannot_create_managed_orchestrators() {
    let root = temp_root("nac_parent_orchestrators");
    seed_editable_session(&root, "orchestrator");
    let app = router(test_manager(&root));

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/orchestrator/orchestrators")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"description":"forbidden spawn","prompt":"do not create a session","background":true}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(rejected).await["error"],
        sessions::NAC_CANNOT_CREATE_SESSIONS
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_binding_failure_precedes_run_and_prompt_execution() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_binding_before_execution");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-bind-test-key"));
    seed_editable_session(&root, "orchestrator");
    let manager = test_manager(&root);
    let orchestrator = "orchestrator".to_string();
    let store_path = root.join("store.db");

    let error = manager
        .submit_managed_orchestrator_prompt(
            &orchestrator,
            SubmitPromptRequest {
                prompt: "must never execute".to_string(),
            },
            ManagedOrchestratorExecutionMode::Background,
        )
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "session operation coordination failed");
    let service = manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&orchestrator)
        .cloned()
        .unwrap();
    assert!(service.active_run().is_none());
    assert!(
        nac_core::store::load_run_recovery(&store_path, &orchestrator)
            .unwrap()
            .is_none()
    );
    assert!(sessions::load_session(&store_path, &orchestrator)
        .unwrap()
        .messages
        .is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_orchestrator_cancel_propagates_and_delivers_once() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_cancel");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-cancel-key"));
    let (base_url, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let started = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"description":"cancel flow","prompt":"wait until cancelled","background":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(started.status(), StatusCode::CREATED);
    let running: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(started).await).unwrap();
    let continued = nac_core::orchestration_control::controller_for(&root.join("store.db"))
        .unwrap()
        .start(
            nac_core::orchestration_control::ManagedOrchestratorStartRequest {
                parent_session_id: "delegating".to_string(),
                orchestrator_session_id: Some(running.orchestrator_session_id.clone()),
                description: "cancel flow".to_string(),
                prompt: "additional foreground steering".to_string(),
                execution_mode: ManagedOrchestratorExecutionMode::Foreground,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        continued.execution_mode,
        Some(ManagedOrchestratorExecutionMode::Background),
        "continuation must not rewrite the admitted generation mode"
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();

    let cancelled = tokio::time::timeout(
        Duration::from_secs(10),
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/sessions/delegating/orchestrators/{}/cancel",
                    running.orchestrator_session_id
                ))
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("managed orchestrator cancellation should not hang")
    .unwrap();
    assert_eq!(cancelled.status(), StatusCode::OK);
    let cancelled: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(cancelled).await).unwrap();
    assert_eq!(cancelled.status, ManagedOrchestratorStatus::Cancelled);
    release.send(()).unwrap();

    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "delegating").unwrap();
    assert_eq!(inbox.len(), 1);
    assert!(inbox[0].content.contains("cancelled"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_attachment_reconciles_abandoned_managed_orchestrator_once() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_restart");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-restart-key"));
    let (base_url, requests) =
        scripted_direct_responses(&["parent acknowledged interrupted orchestrator"]);
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    let store_path = root.join("store.db");

    let first = test_manager(&root);
    let child_session_id = first
        .create_managed_orchestrator_session("delegating", "survive restart")
        .await
        .unwrap();
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &child_session_id,
        "abandoned-orchestrator-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &child_session_id,
            0,
            &Message::User {
                content: "work interrupted by restart".to_string(),
            },
            "abandoned-orchestrator-run",
        )
        .unwrap();
    drop(first);

    let rebuilt = test_manager(&root);
    rebuilt.snapshot("delegating").await.unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let relation =
                nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
                    .unwrap()
                    .unwrap();
            let inbox = nac_core::store::list_session_inbox(&store_path, "delegating").unwrap();
            if relation.status.is_terminal()
                && inbox
                    .first()
                    .is_some_and(|item| item.status == nac_core::store::InboxStatus::Delivered)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("restart reconciliation should interrupt and deliver");
    rebuilt.snapshot("delegating").await.unwrap();
    let relation = nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
        .unwrap()
        .unwrap();
    let inbox = nac_core::store::list_session_inbox(&store_path, "delegating").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(relation.status, ManagedOrchestratorStatus::Interrupted);
    assert_eq!(relation.completion_inbox_id, Some(inbox[0].id));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_attachment_settles_canonical_managed_terminal_once_after_restart() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_terminal_restart");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-terminal-restart-key"));
    let (base_url, requests) =
        scripted_direct_responses(&["parent acknowledged completed orchestrator"]);
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    let store_path = root.join("store.db");

    let first = test_manager(&root);
    let orchestrator = first
        .create_managed_orchestrator_session("delegating", "finish before restart")
        .await
        .unwrap();
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator,
        "terminal-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    let snapshot = sessions::load_session(&store_path, &orchestrator).unwrap();
    let start_idx = snapshot.messages.len() as u64;
    let writer = nac_core::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_run_prompt(
            &orchestrator,
            start_idx,
            &Message::User {
                content: "complete durably".to_string(),
            },
            "terminal-run",
        )
        .unwrap();
    writer
        .append(
            &orchestrator,
            start_idx + 1,
            &Message::Assistant {
                content: Some("durable orchestrator report".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        )
        .unwrap();
    let mut terminal_snapshot = snapshot;
    let mut update = terminal_snapshot.apply_run_state(sessions::SessionRunState::default());
    update.finished_run_id = Some("terminal-run".to_string());
    update.finished_run_disposition = Some(nac_core::store::RunTerminalDisposition::Completed);
    sessions::save_session_run_state(&store_path, &update).unwrap();
    assert!(
        nac_core::store::load_run_recovery(&store_path, &orchestrator)
            .unwrap()
            .unwrap()
            .terminal_disposition
            .is_some()
    );
    drop(first);

    let rebuilt = test_manager(&root);
    rebuilt.snapshot("delegating").await.unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let relation = nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
                .unwrap()
                .unwrap();
            if relation.status == ManagedOrchestratorStatus::Completed
                && relation.completion_inbox_id.is_some()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("canonical terminal obligation should settle");
    rebuilt.snapshot("delegating").await.unwrap();
    let relation = nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
        .unwrap()
        .unwrap();
    assert_eq!(
        relation.report.as_deref(),
        Some("durable orchestrator report")
    );
    assert!(
        nac_core::store::load_run_recovery(&store_path, &orchestrator)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        nac_core::store::list_session_inbox(&store_path, "delegating")
            .unwrap()
            .len(),
        1
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deleting_parent_removes_managed_orchestrator_sessions() {
    let root = temp_root("managed_orchestrator_delete");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let child_session_id = manager
        .create_managed_orchestrator_session("delegating", "delete with parent")
        .await
        .unwrap();
    manager.delete_session("delegating").await.unwrap();
    let store_path = root.join("store.db");
    assert!(sessions::load_session(&store_path, "delegating").is_err());
    assert!(sessions::load_session(&store_path, &child_session_id).is_err());
    assert!(
        nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
            .unwrap()
            .is_none()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deleting_project_skips_descendants_already_removed_by_parent_cascade() {
    let root = temp_root("project_parent_cascade_delete")
        .canonicalize()
        .unwrap();
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Cascade delete".to_string()),
            description: None,
            cwd: root.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        })
        .await
        .unwrap();
    manager
        .projects()
        .assign_session(&project.project_id, "delegating")
        .unwrap();
    let child_session_id = manager
        .create_managed_orchestrator_session("delegating", "cascade with project")
        .await
        .unwrap();
    manager
        .session_catalog()
        .update_presentation("delegating", "Pinned parent", true, 0)
        .await
        .unwrap();

    let deleted = manager
        .projects()
        .delete(
            &project.project_id,
            application::projects::ProjectSessionDisposition::Delete,
        )
        .await
        .unwrap();
    assert!(deleted
        .deleted_session_ids
        .contains(&"delegating".to_string()));
    assert!(deleted.deleted_session_ids.contains(&child_session_id));
    let store_path = root.join("store.db");
    assert!(sessions::load_session(&store_path, "delegating").is_err());
    assert!(sessions::load_session(&store_path, &child_session_id).is_err());
    assert!(projects::list_projects(&store_path).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(root);
}
