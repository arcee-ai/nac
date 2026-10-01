use super::*;

struct OAuthEnvRestore {
    values: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl Drop for OAuthEnvRestore {
    fn drop(&mut self) {
        for (name, value) in self.values.drain(..).rev() {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}

#[tokio::test]
async fn oauth_configuration_status_and_logout_are_redacted_and_outside_config_toml() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mcp_oauth_routes");
    let nac_home = root.join("nac-home");
    let _model_env = ScopedModelEnv::isolated(&nac_home, None);
    let names = ["TEST_ROUTE_CLIENT_ID", "TEST_ROUTE_CLIENT_SECRET"];
    let _oauth_env = OAuthEnvRestore {
        values: names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect(),
    };
    unsafe {
        std::env::set_var("TEST_ROUTE_CLIENT_ID", "route-client-id-canary");
        std::env::set_var("TEST_ROUTE_CLIENT_SECRET", "route-client-secret-canary");
    }
    let app = router(test_manager(&root));

    let created = post_json(
        app.clone(),
        "/mcp_library/servers",
        serde_json::json!({
            "name": "slack",
            "enabled": true,
            "transport": "streamable_http",
            "url": "https://mcp.slack.com/mcp",
            "headers": {},
            "args": [],
            "env": {}
        }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);

    let configured = post_json(
        app.clone(),
        "/mcp_library/servers/slack/oauth/configure",
        serde_json::json!({
            "client_id_credential": "TEST_ROUTE_CLIENT_ID",
            "client_secret_credential": "TEST_ROUTE_CLIENT_SECRET",
            "scopes": ["channels:history", "chat:write"]
        }),
    )
    .await;
    assert_eq!(configured.status(), StatusCode::OK);
    let configured = response_json(configured).await;
    assert_eq!(
        configured,
        serde_json::json!({"status": "needs_authorization"})
    );
    let configured_text = configured.to_string();
    for protected in [
        "TEST_ROUTE_CLIENT_ID",
        "TEST_ROUTE_CLIENT_SECRET",
        "route-client-id-canary",
        "route-client-secret-canary",
    ] {
        assert!(!configured_text.contains(protected));
    }

    let status = get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(status.status(), StatusCode::OK);
    assert_eq!(
        response_json(status).await,
        serde_json::json!({"status": "needs_authorization"})
    );

    let config = std::fs::read_to_string(nac_home.join("config.toml")).unwrap();
    assert!(config.contains("https://mcp.slack.com/mcp"));
    assert!(!config.contains("TEST_ROUTE_CLIENT"));
    assert!(!config.contains("route-client"));

    let logged_out = post_json(
        app,
        "/mcp_library/servers/slack/oauth/logout",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(logged_out.status(), StatusCode::OK);
    assert_eq!(
        response_json(logged_out).await,
        serde_json::json!({"status": "needs_authorization"})
    );
}
