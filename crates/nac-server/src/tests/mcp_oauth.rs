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
    let names = [
        "TEST_ROUTE_CLIENT_ID",
        "TEST_ROUTE_CLIENT_SECRET",
        crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV,
    ];
    let _oauth_env = OAuthEnvRestore {
        values: names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect(),
    };
    unsafe {
        std::env::set_var("TEST_ROUTE_CLIENT_ID", "route-client-id-canary");
        std::env::set_var("TEST_ROUTE_CLIENT_SECRET", "route-client-secret-canary");
        std::env::set_var(
            crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV,
            "https://nac.example.test",
        );
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
            "scopes": ["channels:history", "chat:write"],
            "authorization_metadata": {
                "authorization_endpoint": "https://auth.example.test/authorize",
                "token_endpoint": "https://auth.example.test/token",
                "issuer": "https://auth.example.test/",
                "response_types_supported": ["code"],
                "code_challenge_methods_supported": ["S256"]
            }
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

    let authenticating = post_json(
        app.clone(),
        "/mcp_library/servers/slack/oauth/authenticate",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(authenticating.status(), StatusCode::OK);
    let authenticating = response_json(authenticating).await;
    assert_eq!(authenticating["status"], "connecting");
    let authorization_url = authenticating["authorization_url"].as_str().unwrap();
    let authorization_url = url::Url::parse(authorization_url).unwrap();
    let redirect_uri = authorization_url
        .query_pairs()
        .find_map(|(key, value)| (key == "redirect_uri").then(|| value.into_owned()))
        .unwrap();
    assert_eq!(
        redirect_uri,
        "https://nac.example.test/mcp_library/servers/slack/oauth/callback"
    );

    let status = get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(status.status(), StatusCode::OK);
    let status = response_json(status).await;
    assert_eq!(status["status"], "connecting");
    assert_eq!(
        status["authorization_url"].as_str(),
        Some(authorization_url.as_str())
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
