use super::*;

#[tokio::test]
async fn session_integration_refresh_is_passive_scoped_revision_checked_and_restart_safe() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("session_integrations");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    seed_direct_session(&root, "direct");
    seed_direct_session(&root, "separate");
    seed_session(&root, "orchestrator", "2026-10-30T00:00:00Z");
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let initial = get_response(app.clone(), "/sessions/direct/integrations", None).await;
    assert_eq!(initial.status(), StatusCode::OK);
    let initial = response_json(initial).await;
    assert_eq!(initial["revision"], 0);
    assert!(initial["applied_revision"].is_null());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let refreshed = post_json(
        app.clone(),
        "/sessions/direct/integrations/refresh",
        serde_json::json!({"expected_revision": 0}),
    )
    .await;
    assert_eq!(refreshed.status(), StatusCode::OK);
    let refreshed = response_json(refreshed).await;
    assert_eq!(refreshed["revision"], 1);
    assert_eq!(refreshed["state"], "pending");
    assert!(
        nac_core::store::list_permission_grants(&root.join("store.db"), "direct")
            .unwrap()
            .is_empty()
    );
    assert!(
        manager.inner.active_sessions.read().await.is_empty(),
        "refresh cannot attach or wake an agent"
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/sessions/direct/integrations/refresh",
            serde_json::json!({"expected_revision": 0})
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/sessions/direct/integrations/refresh",
            serde_json::json!({"expected_revision": -1})
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/sessions/direct/integrations/refresh",
            serde_json::json!({"expected_revision": 1, "human": true})
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/sessions/missing/integrations/refresh",
            serde_json::json!({"expected_revision": 0})
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let separate =
        response_json(get_response(app.clone(), "/sessions/separate/integrations", None).await)
            .await;
    assert_eq!(separate["revision"], 0);
    let workers = response_json(
        post_json(
            app.clone(),
            "/sessions/orchestrator/integrations/refresh",
            serde_json::json!({"expected_revision": 0}),
        )
        .await,
    )
    .await;
    assert_eq!(workers["state"], "scheduled_for_workers");
    assert!(
        workers["applied_revision"].is_null(),
        "workers have no aggregate acknowledgement"
    );
    assert!(workers["incarnation_id"].is_null());
    drop((app, manager));
    let restarted = test_manager(&root);
    let durable = response_json(
        get_response(
            router(restarted.clone()),
            "/sessions/direct/integrations",
            None,
        )
        .await,
    )
    .await;
    assert_eq!(durable["revision"], 1);
    assert_eq!(durable["requested_at"], refreshed["requested_at"]);
    assert!(durable["applied_revision"].is_null());
    assert!(restarted.inner.active_sessions.read().await.is_empty());
}

#[tokio::test]
async fn session_integration_refresh_keeps_http_origin_admission() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("session_integrations_origin");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    seed_direct_session(&root, "direct");
    let app = router(test_manager(&root));
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/integrations/refresh")
                .header("content-type", "application/json")
                .header("origin", "https://untrusted.example.test")
                .header("sec-fetch-site", "cross-site")
                .body(Body::from(r#"{"expected_revision":0}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        nac_core::store::load_session_mcp_refresh(&root.join("store.db"), "direct")
            .unwrap()
            .revision,
        0
    );
}

#[tokio::test]
async fn session_integration_status_does_not_acknowledge_a_stale_cached_incarnation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("session_integrations_stale_cache");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-only-model-key"));
    seed_direct_session(&root, "direct");
    let manager = test_manager(&root);
    let service = manager.attach_session("direct").await.unwrap();
    let first = manager
        .session_integrations()
        .status("direct")
        .await
        .unwrap();
    assert_eq!(first.applied_revision, Some(0));
    assert!(first.incarnation_id.is_some());
    let path = root.join("store.db");
    let mut saved = sessions::load_session(&path, "direct").unwrap();
    saved.model = "another-fixture-model".to_string();
    sessions::update_session_config(&path, &saved).unwrap();
    let stale = manager
        .session_integrations()
        .status("direct")
        .await
        .unwrap();
    assert_eq!(stale.applied_revision, None);
    assert_eq!(stale.incarnation_id, None);
    assert!(std::sync::Arc::ptr_eq(
        &service,
        &manager.inner.active_sessions.read().await["direct"]
    ));
    assert!(!service.has_active_operation());
}
