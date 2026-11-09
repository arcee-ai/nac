use super::*;

#[tokio::test]
async fn loopback_retry_reuses_only_its_own_live_callback_listener() {
    loopback_case(false).await;
}

#[tokio::test]
async fn loopback_replacement_rejects_the_old_accepted_callback() {
    loopback_case(true).await;
}

async fn loopback_case(replace_accepted: bool) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mcp_oauth_loopback_retry");
    let _model_env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let _oauth_env = OAuthEnvRestore {
        values: [
            "TEST_ROUTE_CLIENT_ID",
            "TEST_ROUTE_CLIENT_SECRET",
            crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV,
        ]
        .into_iter()
        .map(|name| (name, std::env::var_os(name)))
        .collect(),
    };
    unsafe {
        std::env::set_var("TEST_ROUTE_CLIENT_ID", "route-client-id-canary");
        std::env::set_var("TEST_ROUTE_CLIENT_SECRET", "route-client-secret-canary");
        std::env::remove_var(crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV);
    }
    let entered = std::sync::Arc::new(tokio::sync::Notify::new());
    let release = std::sync::Arc::new(tokio::sync::Notify::new());
    let requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let token_handler = {
        let entered = entered.clone();
        let release = release.clone();
        let requests = requests.clone();
        move || {
            let entered = entered.clone();
            let release = release.clone();
            let requests = requests.clone();
            async move {
                requests.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                entered.notify_one();
                release.notified().await;
                axum::Json(serde_json::json!({
                    "access_token":"loopback-test-token", "token_type":"Bearer",
                    "expires_in":3600, "scope":"channels:history chat:write mcp:pending-only"
                }))
            }
        }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let issuer = format!("http://{}/", listener.local_addr().unwrap());
    let endpoint = format!("{issuer}mcp");
    let token_server = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().route("/token", axum::routing::post(token_handler)),
        )
        .await
        .unwrap();
    });
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let mut configuration = oauth_configuration_request();
    for (key, suffix) in [
        ("authorization_endpoint", "authorize"),
        ("token_endpoint", "token"),
        ("issuer", ""),
    ] {
        configuration["authorization_metadata"][key] =
            serde_json::json!(format!("{issuer}{suffix}"));
    }
    for name in ["slack", "other"] {
        let created = post_json(
            app.clone(),
            "/mcp_library/servers",
            serde_json::json!({
                "name":name, "enabled":true, "transport":"streamable_http",
                "url":&endpoint, "headers":{}, "args":[], "env":{}
            }),
        )
        .await;
        assert_eq!(created.status(), StatusCode::CREATED);
        let configured = post_json(
            app.clone(),
            &format!("/mcp_library/servers/{name}/oauth/configure"),
            configuration.clone(),
        )
        .await;
        assert_eq!(configured.status(), StatusCode::OK);
    }
    let body_app = app.clone();
    let result = tokio::spawn(async move {
        let app = body_app;
        let first = authenticate(app.clone(), serde_json::json!({})).await;
        let first_url = first["authorization_url"].as_str().unwrap().to_owned();
        let failed = post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/authenticate",
            serde_json::json!({"additional_scopes":[""]}),
        )
        .await;
        assert_eq!(failed.status(), StatusCode::BAD_REQUEST);
        let status = response_json(
            get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
        )
        .await;
        assert_eq!(status["status"], "connecting");
        let second = authenticate(
            app.clone(),
            serde_json::json!({"additional_scopes":["mcp:pending-only"]}),
        )
        .await;
        let second_url = second["authorization_url"].as_str().unwrap().to_owned();
        assert_ne!(first_url, second_url);
        let other = post_json(
            app.clone(),
            "/mcp_library/servers/other/oauth/authenticate",
            serde_json::json!({}),
        )
        .await;
        assert_eq!(other.status(), StatusCode::CONFLICT);
        assert!(callback(&first_url).await.starts_with("HTTP/1.1 400"));
        assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 0);

        // Two simultaneous starts share one per-owner preparation boundary.
        let (guard, gate) = crate::mcp_api::callback_test_gate(
            &manager,
            "slack",
            crate::mcp_api::CallbackTestPhase::PreparingReplacement,
        );
        let a = tokio::spawn(authenticate(app.clone(), serde_json::json!({})));
        tokio::time::timeout(Duration::from_secs(5), gate.entered.notified())
            .await
            .unwrap();
        let (waiting_guard, waiting) = crate::mcp_api::callback_test_gate(
            &manager,
            "slack",
            crate::mcp_api::CallbackTestPhase::WaitingReplacement,
        );
        let b = tokio::spawn(authenticate(app.clone(), serde_json::json!({})));
        tokio::time::timeout(Duration::from_secs(5), waiting.entered.notified())
            .await
            .unwrap();
        assert!(
            !b.is_finished(),
            "second start bypassed the first owner's preparation"
        );
        drop(waiting_guard);
        tokio::time::timeout(Duration::from_secs(5), waiting.release.wait())
            .await
            .unwrap();
        drop(guard);
        tokio::time::timeout(Duration::from_secs(5), gate.release.wait())
            .await
            .unwrap();
        let a = tokio::time::timeout(Duration::from_secs(5), a)
            .await
            .unwrap()
            .unwrap();
        let b = tokio::time::timeout(Duration::from_secs(5), b)
            .await
            .unwrap()
            .unwrap();
        assert_ne!(a["authorization_url"], b["authorization_url"]);
        assert!(callback(a["authorization_url"].as_str().unwrap())
            .await
            .starts_with("HTTP/1.1 400"));
        let accepted_url = b["authorization_url"].as_str().unwrap().to_owned();
        let accepted = tokio::spawn(async move { callback(&accepted_url).await });
        tokio::time::timeout(Duration::from_secs(5), entered.notified())
            .await
            .unwrap();
        let failed = post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/authenticate",
            serde_json::json!({"additional_scopes":[""]}),
        )
        .await;
        assert_eq!(failed.status(), StatusCode::BAD_REQUEST);
        let during = response_json(
            get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
        )
        .await;
        assert_eq!(during["status"], "connecting");
        assert!(during.get("authorization_url").is_none());
        let replacement = if replace_accepted {
            Some(authenticate(app.clone(), serde_json::json!({})).await)
        } else {
            None
        };
        release.notify_one();
        let old_response = tokio::time::timeout(Duration::from_secs(5), accepted)
            .await
            .unwrap()
            .unwrap();
        if let Some(replacement) = replacement {
            assert!(!old_response.starts_with("HTTP/1.1 200"));
            let url = replacement["authorization_url"]
                .as_str()
                .unwrap()
                .to_owned();
            let current = tokio::spawn(async move { callback(&url).await });
            tokio::time::timeout(Duration::from_secs(5), entered.notified())
                .await
                .unwrap();
            release.notify_one();
            assert!(tokio::time::timeout(Duration::from_secs(5), current)
                .await
                .unwrap()
                .unwrap()
                .starts_with("HTTP/1.1 200"));
        } else {
            assert!(old_response.starts_with("HTTP/1.1 200"));
        }
        let completed = response_json(
            get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
        )
        .await;
        assert_eq!(completed["status"], "connected");
        assert_eq!(
            requests.load(std::sync::atomic::Ordering::SeqCst),
            if replace_accepted { 2 } else { 1 }
        );
        let rebound = tokio::net::TcpListener::bind("127.0.0.1:1456")
            .await
            .unwrap();
        let denied = post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/authenticate",
            serde_json::json!({}),
        )
        .await;
        assert_eq!(denied.status(), StatusCode::CONFLICT);
        drop(rebound);
        // A pending replacement is also physically released by logout below.
        authenticate(app, serde_json::json!({})).await;
    })
    .await;
    let logout = post_json(
        app,
        "/mcp_library/servers/slack/oauth/logout",
        serde_json::json!({}),
    )
    .await;
    token_server.abort();
    let stopped = token_server.await;
    assert_eq!(logout.status(), StatusCode::OK);
    assert!(stopped.unwrap_err().is_cancelled());
    assert!(
        tokio::net::TcpListener::bind("127.0.0.1:1456")
            .await
            .is_ok(),
        "logout retained callback sockets"
    );
    result.unwrap();
}

async fn authenticate(app: axum::Router, body: serde_json::Value) -> serde_json::Value {
    let response = post_json(app, "/mcp_library/servers/slack/oauth/authenticate", body).await;
    let status = response.status();
    let value = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value
}

async fn callback(authorization_url: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let url = url::Url::parse(authorization_url).unwrap();
    let state = url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("code", "loopback-test-code")
        .append_pair("state", &state)
        .finish();
    let mut stream = tokio::net::TcpStream::connect("127.0.0.1:1456")
        .await
        .unwrap();
    stream.write_all(format!("GET /mcp_library/oauth/callback?{query} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    let mut response = String::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_string(&mut response))
        .await
        .unwrap()
        .unwrap();
    response
}
