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

fn oauth_configuration_request() -> serde_json::Value {
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
    })
}

#[tokio::test]
async fn abandoned_authorization_clears_durable_pending_state() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mcp_oauth_abandonment");
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
    let manager = test_manager(&root);
    let app = router(manager.clone());
    assert_eq!(
        post_json(
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
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/configure",
            oauth_configuration_request(),
        )
        .await
        .status(),
        StatusCode::OK
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
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            "https://mcp.slack.com/mcp",
        )
        .unwrap()
        .is_some()
    );

    crate::mcp_api::fail_current_oauth_flow_for_test(&manager, "slack").await;
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            "https://mcp.slack.com/mcp",
        )
        .unwrap()
        .is_none()
    );
    let status = get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(
        response_json(status).await,
        serde_json::json!({
            "status": "failed",
            "message": "OAuth authorization did not complete; start authentication again"
        })
    );

    let replacement = nac_core::mcp_configurations::begin_mcp_oauth_authorization(
        manager.root_cwd(),
        "slack",
        "https://mcp.slack.com/mcp",
        "https://nac.example.test/mcp_library/servers/slack/oauth/callback",
        &[],
    )
    .await
    .unwrap();
    let replacement_url = replacement.authorization_url().to_string();
    drop(replacement);
    let status = get_response(app, "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(
        response_json(status).await,
        serde_json::json!({
            "status": "needs_authorization",
            "authorization_url": replacement_url
        })
    );
}

#[tokio::test]
async fn renaming_server_rebinds_remote_oauth_callback_and_clears_old_flow() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mcp_oauth_rename");
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
    let manager = test_manager(&root);
    let app = router(manager.clone());
    assert_eq!(
        post_json(
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
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/configure",
            oauth_configuration_request(),
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/authenticate",
            serde_json::json!({}),
        )
        .await
        .status(),
        StatusCode::OK
    );
    let renamed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/mcp_library/servers/slack")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::json!({"name": "teams"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(renamed.status(), StatusCode::OK);
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "teams",
            "https://mcp.slack.com/mcp",
        )
        .unwrap()
        .is_none()
    );

    let authenticating = post_json(
        app,
        "/mcp_library/servers/teams/oauth/authenticate",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(authenticating.status(), StatusCode::OK);
    let authenticating = response_json(authenticating).await;
    let authorization_url =
        url::Url::parse(authenticating["authorization_url"].as_str().unwrap()).unwrap();
    let redirect_uri = authorization_url
        .query_pairs()
        .find_map(|(key, value)| (key == "redirect_uri").then(|| value.into_owned()))
        .unwrap();
    assert_eq!(
        redirect_uri,
        "https://nac.example.test/mcp_library/servers/teams/oauth/callback"
    );
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
        oauth_configuration_request(),
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

    let reconfigured = post_json(
        app.clone(),
        "/mcp_library/servers/slack/oauth/configure",
        oauth_configuration_request(),
    )
    .await;
    assert_eq!(reconfigured.status(), StatusCode::OK);
    assert_eq!(
        response_json(reconfigured).await,
        serde_json::json!({"status": "needs_authorization"})
    );
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
    let authorization_url =
        url::Url::parse(authenticating["authorization_url"].as_str().unwrap()).unwrap();

    let state = authorization_url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();
    unsafe {
        std::env::remove_var("TEST_ROUTE_CLIENT_ID");
    }
    let retryable_query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("code", "temporary-code")
        .append_pair("state", &state)
        .finish();
    let retryable_callback = get_response(
        app.clone(),
        &format!("/mcp_library/servers/slack/oauth/callback?{retryable_query}"),
        None,
    )
    .await;
    assert_eq!(retryable_callback.status(), StatusCode::BAD_REQUEST);
    let status = get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(status.status(), StatusCode::BAD_REQUEST);
    unsafe {
        std::env::set_var("TEST_ROUTE_CLIENT_ID", "route-client-id-canary");
    }
    let status = get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(status.status(), StatusCode::OK);
    assert_eq!(
        response_json(status).await,
        serde_json::json!({
            "status": "connecting",
            "authorization_url": authorization_url.as_str()
        })
    );

    let callback_query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("error", "access_denied")
        .append_pair("state", &state)
        .finish();
    let callback = get_response(
        app.clone(),
        &format!("/mcp_library/servers/slack/oauth/callback?{callback_query}"),
        None,
    )
    .await;
    assert_eq!(callback.status(), StatusCode::BAD_REQUEST);
    let status = get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(status.status(), StatusCode::OK);
    let status = response_json(status).await;
    assert_eq!(status["status"], "failed");
    assert!(status.get("authorization_url").is_none());

    let reconfigured = post_json(
        app.clone(),
        "/mcp_library/servers/slack/oauth/configure",
        oauth_configuration_request(),
    )
    .await;
    assert_eq!(reconfigured.status(), StatusCode::OK);
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

#[tokio::test]
async fn redirect_sync_rebinds_later_profiles_after_an_earlier_profile_fails() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mcp_oauth_redirect_rebind");
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
        std::env::remove_var(crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV);
    }
    let manager = test_manager(&root);
    let app = router(manager.clone());
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers",
            serde_json::json!({
                "name": "broken",
                "enabled": true,
                "transport": "streamable_http",
                "url": "https://mcp.broken.test/mcp",
                "headers": {},
                "args": [],
                "env": {}
            }),
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers/broken/oauth/configure",
            oauth_configuration_request(),
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post_json(
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
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        post_json(
            app,
            "/mcp_library/servers/slack/oauth/configure",
            oauth_configuration_request(),
        )
        .await
        .status(),
        StatusCode::OK
    );
    let config_path = nac_core::mcp_configurations::mcp_config_path(manager.root_cwd()).unwrap();
    let (mut broken, revision) =
        nac_core::mcp_configurations::load_mcp_server_configuration_snapshot(
            &config_path,
            "broken",
        )
        .unwrap();
    broken.url = Some("https://mcp.changed.test/mcp".into());
    nac_core::mcp_configurations::update_mcp_server_configuration_at_revision(
        &config_path,
        "broken",
        broken,
        revision,
    )
    .unwrap();
    let session = nac_core::mcp_configurations::begin_mcp_oauth_authorization(
        manager.root_cwd(),
        "slack",
        "https://mcp.slack.com/mcp",
        nac_core::mcp_configurations::MCP_OAUTH_REDIRECT_URI,
        &[],
    )
    .await
    .unwrap();
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            "https://mcp.slack.com/mcp"
        )
        .unwrap()
        .is_some()
    );
    drop(session);

    unsafe {
        std::env::set_var(
            crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV,
            "https://nac.example.test",
        );
    }
    let error = crate::mcp_api::synchronize_mcp_oauth_redirect_uris(&manager).unwrap_err();
    assert!(error.contains("'broken'"));
    let remote_redirect = "https://nac.example.test/mcp_library/servers/slack/oauth/callback";
    assert!(!nac_core::mcp_configurations::set_mcp_oauth_redirect_uri(
        manager.root_cwd(),
        "slack",
        "https://mcp.slack.com/mcp",
        remote_redirect,
    )
    .unwrap());
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            "https://mcp.slack.com/mcp"
        )
        .unwrap()
        .is_none()
    );
}

#[tokio::test]
async fn rejected_transport_step_up_clears_the_durable_authorization_url() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mcp_oauth_transport_step_up");
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
    let manager = test_manager(&root);
    let app = router(manager.clone());
    assert_eq!(
        post_json(
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
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/configure",
            oauth_configuration_request(),
        )
        .await
        .status(),
        StatusCode::OK
    );

    let session = nac_core::mcp_configurations::begin_mcp_oauth_authorization(
        manager.root_cwd(),
        "slack",
        "https://mcp.slack.com/mcp",
        "https://nac.example.test/mcp_library/servers/slack/oauth/callback",
        &["channels:write".into()],
    )
    .await
    .unwrap();
    let authorization_url = url::Url::parse(session.authorization_url()).unwrap();
    let state = authorization_url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();
    drop(session);

    let callback_query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("error", "access_denied")
        .append_pair("state", &state)
        .finish();
    let callback = get_response(
        app.clone(),
        &format!("/mcp_library/servers/slack/oauth/callback?{callback_query}"),
        None,
    )
    .await;
    assert_eq!(callback.status(), StatusCode::BAD_REQUEST);
    let status = get_response(app, "/mcp_library/servers/slack/oauth/status", None).await;
    assert_eq!(status.status(), StatusCode::OK);
    assert_eq!(
        response_json(status).await,
        serde_json::json!({
            "status": "failed",
            "message": "OAuth authorization did not complete; start authentication again"
        })
    );
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            "https://mcp.slack.com/mcp"
        )
        .unwrap()
        .is_none()
    );
}
