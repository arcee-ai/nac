use super::*;

#[tokio::test]
async fn workspace_reveal_http_keeps_path_session_and_transport_denials() {
    let root = temp_root("workspace_reveal_http");
    std::fs::create_dir_all(&root).unwrap();
    seed_direct_session(&root, "local");
    let app = router(test_manager(&root));
    let expected = root.canonicalize().unwrap();
    for (session, body, status) in [
        (
            "missing",
            serde_json::json!({"path":"file", "expected_workspace_root": expected}),
            StatusCode::NOT_FOUND,
        ),
        (
            "local",
            serde_json::json!({"path":"file"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            "local",
            serde_json::json!({"path":"file", "expected_workspace_root": expected, "grant":true}),
            StatusCode::BAD_REQUEST,
        ),
        (
            "local",
            serde_json::json!({"path":"file", "expected_workspace_root": root.join("stale")}),
            StatusCode::BAD_REQUEST,
        ),
        (
            "local",
            serde_json::json!({"path":"../outside", "expected_workspace_root": expected}),
            StatusCode::BAD_REQUEST,
        ),
        (
            "local",
            serde_json::json!({"path":"/tmp/absolute", "expected_workspace_root": expected}),
            StatusCode::BAD_REQUEST,
        ),
        (
            "local",
            serde_json::json!({"path":"missing/child", "expected_workspace_root": expected}),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let response = post_json(
            app.clone(),
            &format!("/sessions/{session}/workspace/reveal"),
            body,
        )
        .await;
        assert_eq!(
            response.status(),
            status,
            "{}",
            String::from_utf8_lossy(&response_body(response).await)
        );
    }
    assert!(!root.join("missing").exists());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/tmp", root.join("outside")).unwrap();
        let response = post_json(
            app.clone(),
            "/sessions/local/workspace/reveal",
            serde_json::json!({
                "path":"outside", "expected_workspace_root": expected
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let denied = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/local/workspace/reveal")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ORIGIN, "https://untrusted.example")
                .body(Body::from(
                    serde_json::json!({"path":"store.db", "expected_workspace_root":expected})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let _ = std::fs::remove_dir_all(root);
}
