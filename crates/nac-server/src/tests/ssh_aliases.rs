use super::*;

async fn aliases_request(app: &Router, method: &str, host: &str) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri("/ssh/aliases")
                .header(header::HOST, host)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn ssh_alias_route_is_guarded_read_only_and_returns_only_alias_names() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("ssh_aliases_route");
    let home = root.join("home");
    let ssh = home.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    std::fs::write(
        ssh.join("config"),
        "Include work.conf missing.conf\nHost build-box *.corp !bastion\n  \
         HostName secret-host.internal\n  User secret-user\n  IdentityFile ~/.ssh/id_secret\n",
    )
    .unwrap();
    std::fs::write(ssh.join("work.conf"), "Host work-jump build-box\n").unwrap();
    std::fs::write(ssh.join("id_secret"), "PRIVATE-KEY-MATERIAL\n").unwrap();
    let _env =
        ScopedModelEnv::with_config_home(Some(&root.join("nac-home")), None, Some(&home), None);
    let app = router(test_manager(&root));

    // The same Host guard as every other route: a rebound name is refused
    // before discovery runs.
    let refused = aliases_request(&app, "GET", "rebound.example").await;
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    let refused = String::from_utf8(response_body(refused).await.to_vec()).unwrap();
    assert!(!refused.contains("build-box"), "{refused}");

    let response = aliases_request(&app, "GET", "127.0.0.1:3210").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(response_body(response).await.to_vec()).unwrap();
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "aliases": ["work-jump", "build-box"],
            "undiscoverable_patterns": 2,
            "warnings": ["missing_include"],
        })
    );
    for private in [
        "secret-host",
        "secret-user",
        "id_secret",
        "PRIVATE-KEY",
        "work.conf",
        ".ssh",
    ] {
        assert!(!body.contains(private), "{private} leaked: {body}");
    }

    // Discovery is read-only; there is nothing to write through this path.
    let write = aliases_request(&app, "POST", "127.0.0.1:3210").await;
    assert_eq!(write.status(), StatusCode::METHOD_NOT_ALLOWED);

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn ssh_alias_route_answers_quietly_when_the_server_user_has_no_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("ssh_aliases_empty");
    let home = root.join("home");
    std::fs::create_dir_all(&home).unwrap();
    let _env =
        ScopedModelEnv::with_config_home(Some(&root.join("nac-home")), None, Some(&home), None);
    let app = router(test_manager(&root));
    let response = aliases_request(&app, "GET", "localhost").await;
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(
        value,
        serde_json::json!({ "aliases": [], "undiscoverable_patterns": 0, "warnings": [] })
    );
    drop(app);
    let _ = std::fs::remove_dir_all(root);
}
