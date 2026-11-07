use super::*;
use axum::response::IntoResponse;

#[derive(Clone, Copy, Debug)]
enum Outcome {
    Success,
    TokenFailure,
    Logout,
    Reconfigure,
    Supersede,
    Expire,
}

#[tokio::test]
async fn accepted_callback_stays_connecting_until_token_exchange_settles() {
    complete(Outcome::Success).await;
}
#[tokio::test]
async fn token_failure_finishes_the_current_flow() {
    complete(Outcome::TokenFailure).await;
}
#[tokio::test]
async fn logout_rejects_the_late_token_response() {
    complete(Outcome::Logout).await;
}
#[tokio::test]
async fn reconfiguration_rejects_the_late_token_response() {
    complete(Outcome::Reconfigure).await;
}
#[tokio::test]
async fn a_replacement_flow_survives_the_old_callback() {
    complete(Outcome::Supersede).await;
}
#[tokio::test]
async fn expiry_rejects_the_late_token_response() {
    complete(Outcome::Expire).await;
}

async fn complete(outcome: Outcome) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root(&format!("mcp_oauth_pending_exchange_{outcome:?}"));
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
        std::env::set_var(
            crate::mcp_api::MCP_OAUTH_CALLBACK_ORIGIN_ENV,
            "https://nac.example.test",
        );
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
                if matches!(outcome, Outcome::TokenFailure) {
                    return (
                        StatusCode::BAD_REQUEST,
                        axum::Json(serde_json::json!({"error": "invalid_grant"})),
                    )
                        .into_response();
                }
                axum::Json(serde_json::json!({
                    "access_token": "latched-test-access-token",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": "channels:history chat:write"
                }))
                .into_response()
            }
        }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let issuer = format!("http://{}/", listener.local_addr().unwrap());
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
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers",
            serde_json::json!({
                "name": "slack", "enabled": true, "transport": "streamable_http",
                "url": "https://mcp.slack.com/mcp", "headers": {}, "args": [], "env": {}
            }),
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    let mut configuration = oauth_configuration_request();
    configuration["authorization_metadata"]["authorization_endpoint"] =
        serde_json::json!(format!("{issuer}authorize"));
    configuration["authorization_metadata"]["token_endpoint"] =
        serde_json::json!(format!("{issuer}token"));
    configuration["authorization_metadata"]["issuer"] = serde_json::json!(issuer);
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/configure",
            configuration.clone()
        )
        .await
        .status(),
        StatusCode::OK
    );
    let authenticating = response_json(
        post_json(
            app.clone(),
            "/mcp_library/servers/slack/oauth/authenticate",
            serde_json::json!({}),
        )
        .await,
    )
    .await;
    let authorization =
        url::Url::parse(authenticating["authorization_url"].as_str().unwrap()).unwrap();
    let state = authorization
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("code", "latched-test-code")
        .append_pair("state", &state)
        .finish();
    let replay_query = query.clone();
    let callback = {
        let app = app.clone();
        tokio::spawn(async move {
            get_response(
                app,
                &format!("/mcp_library/servers/slack/oauth/callback?{query}"),
                None,
            )
            .await
        })
    };
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .expect("token endpoint was not entered");
    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            "https://mcp.slack.com/mcp",
        )
        .unwrap()
        .is_none(),
        "one-use callback state must already be consumed"
    );
    let pending = response_json(
        get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
    )
    .await;
    let replay = tokio::time::timeout(
        Duration::from_secs(5),
        get_response(
            app.clone(),
            &format!("/mcp_library/servers/slack/oauth/callback?{replay_query}"),
            None,
        ),
    )
    .await;
    let after_replay = response_json(
        get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
    )
    .await;
    let after_intervention = match outcome {
        Outcome::Logout => Some(
            response_json(
                post_json(
                    app.clone(),
                    "/mcp_library/servers/slack/oauth/logout",
                    serde_json::json!({}),
                )
                .await,
            )
            .await,
        ),
        Outcome::Reconfigure => Some(
            response_json(
                post_json(
                    app.clone(),
                    "/mcp_library/servers/slack/oauth/configure",
                    configuration,
                )
                .await,
            )
            .await,
        ),
        Outcome::Supersede => Some(
            response_json(
                post_json(
                    app.clone(),
                    "/mcp_library/servers/slack/oauth/authenticate",
                    serde_json::json!({}),
                )
                .await,
            )
            .await,
        ),
        Outcome::Expire => {
            // Exercise the TTL watchdog's owner transition without moving the
            // clock or claiming a real ten-minute wait.
            crate::mcp_api::fail_current_oauth_flow_for_test(&manager, "slack").await;
            Some(
                response_json(
                    get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None)
                        .await,
                )
                .await,
            )
        }
        _ => None,
    };

    // Settle the actual callback and owned HTTP fixture before the RED assertion.
    release.notify_waiters();
    let callback_status = tokio::time::timeout(Duration::from_secs(5), callback)
        .await
        .unwrap()
        .unwrap()
        .status();
    let completed = response_json(
        get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
    )
    .await;
    post_json(
        app,
        "/mcp_library/servers/slack/oauth/logout",
        serde_json::json!({}),
    )
    .await;
    token_server.abort();
    assert!(token_server.await.unwrap_err().is_cancelled());
    assert_eq!(
        replay.expect("replayed callback did not settle").status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 1);
    match outcome {
        Outcome::Success => {
            assert_eq!(callback_status, StatusCode::OK);
            assert_eq!(completed["status"], "connected");
        }
        Outcome::TokenFailure | Outcome::Expire => {
            assert_eq!(callback_status, StatusCode::BAD_REQUEST);
            assert_eq!(completed["status"], "failed");
        }
        Outcome::Logout | Outcome::Reconfigure => {
            assert_eq!(after_intervention.unwrap()["status"], "needs_authorization");
            assert_eq!(callback_status, StatusCode::BAD_REQUEST);
            assert_eq!(completed["status"], "needs_authorization");
        }
        Outcome::Supersede => {
            let replacement = after_intervention.unwrap();
            assert_eq!(callback_status, StatusCode::BAD_REQUEST);
            assert_eq!(completed["status"], "connecting");
            assert!(replacement["authorization_url"] == completed["authorization_url"]);
            assert!(replacement["authorization_url"].as_str() != Some(authorization.as_str()));
        }
    }
    assert_eq!(pending["status"], "connecting");
    assert!(pending.get("authorization_url").is_none());
    assert_eq!(after_replay["status"], "connecting");
    assert!(after_replay.get("authorization_url").is_none());
}
