use super::*;

fn delete_terminal(uri: &str) -> Request<Body> {
    Request::builder()
        .method("DELETE")
        .uri(uri)
        .header(header::HOST, "localhost")
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn terminal_termination_route_binds_session_and_terminal_identity() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("terminal_termination_identity");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_direct_session(&root, "session-a");
    seed_direct_session(&root, "session-b");
    let store_path = root.join("store.db");
    nac_core::store::record_terminal_remote_cleanup(
        &store_path,
        "session-a",
        "durable-terminal-cleanup",
    )
    .unwrap();
    let app = router(test_manager(&root));

    let missing_session = app
        .clone()
        .oneshot(delete_terminal(
            "/sessions/missing/terminals/not-a-terminal",
        ))
        .await
        .unwrap();
    assert_eq!(missing_session.status(), StatusCode::NOT_FOUND);

    let missing_terminal = app
        .clone()
        .oneshot(delete_terminal(
            "/sessions/session-a/terminals/not-a-terminal",
        ))
        .await
        .unwrap();
    assert_eq!(missing_terminal.status(), StatusCode::NOT_FOUND);

    let cross_session = app
        .clone()
        .oneshot(delete_terminal(
            "/sessions/session-b/terminals/durable-terminal-cleanup",
        ))
        .await
        .unwrap();
    assert_eq!(cross_session.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        nac_core::store::list_terminal_remote_cleanups(&store_path, "session-a")
            .unwrap()
            .len(),
        1,
        "a cross-session request must not clear the owner's cleanup obligation"
    );

    let terminate = || delete_terminal("/sessions/session-a/terminals/durable-terminal-cleanup");
    assert_eq!(
        app.clone().oneshot(terminate()).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.clone().oneshot(terminate()).await.unwrap().status(),
        StatusCode::NO_CONTENT,
        "same-service retry must be idempotent"
    );
    assert!(
        nac_core::store::list_terminal_remote_cleanups(&store_path, "session-a")
            .unwrap()
            .is_empty()
    );

    let stale_or_foreign = app
        .clone()
        .oneshot(delete_terminal(
            "/sessions/session-b/terminals/shell-00000000-0000-4000-8000-000000000000-1",
        ))
        .await
        .unwrap();
    assert_eq!(stale_or_foreign.status(), StatusCode::CONFLICT);

    let invalid_id = "x".repeat(1025);
    let invalid = app
        .clone()
        .oneshot(delete_terminal(&format!(
            "/sessions/session-a/terminals/{invalid_id}"
        )))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

    drop(app);
    nac_core::store::record_terminal_remote_cleanup(
        &store_path,
        "session-a",
        "recovered-terminal-cleanup",
    )
    .unwrap();
    let restarted = router(test_manager(&root));
    let recovered = restarted
        .oneshot(delete_terminal(
            "/sessions/session-a/terminals/recovered-terminal-cleanup",
        ))
        .await
        .unwrap();
    assert_eq!(recovered.status(), StatusCode::NO_CONTENT);
    assert!(
        nac_core::store::list_terminal_remote_cleanups(&store_path, "session-a")
            .unwrap()
            .is_empty(),
        "restart attachment must recover and settle the durable cleanup"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn terminal_termination_route_rejects_cross_origin_mutation() {
    let root = temp_root("terminal_termination_origin");
    seed_direct_session(&root, "session");
    let app = router(test_manager(&root));
    let request = Request::builder()
        .method("DELETE")
        .uri("/sessions/session/terminals/not-a-terminal")
        .header(header::HOST, "localhost")
        .header(header::ORIGIN, "https://attacker.example")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let _ = std::fs::remove_dir_all(root);
}
