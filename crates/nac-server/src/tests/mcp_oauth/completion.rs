use super::*;
use axum::response::IntoResponse;

#[derive(Clone, Copy, Debug)]
enum Outcome {
    Success,
    ConcurrentCallback,
    ConcurrentInvalidIssuer,
    ScopeUpgrade,
    RetryScopes,
    FailedRestart,
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

#[tokio::test]
async fn flowless_scope_upgrade_stays_connecting_during_exchange() {
    complete(Outcome::ScopeUpgrade).await;
}
#[tokio::test]
async fn authenticate_retry_preserves_pending_only_scopes() {
    complete(Outcome::RetryScopes).await;
}

#[tokio::test]
async fn a_failed_replacement_start_preserves_an_accepted_callback() {
    complete(Outcome::FailedRestart).await;
}

#[tokio::test]
async fn a_rejected_concurrent_callback_cannot_retire_the_winning_http_flow() {
    complete(Outcome::ConcurrentCallback).await;
}

#[tokio::test]
async fn a_rejected_issuer_cannot_retire_state_claimed_between_failure_reads() {
    complete(Outcome::ConcurrentInvalidIssuer).await;
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
                    "scope": if matches!(outcome, Outcome::ScopeUpgrade | Outcome::RetryScopes) { "channels:history chat:write mcp:pending-only" } else { "channels:history chat:write" }
                }))
                .into_response()
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
    assert_eq!(
        post_json(
            app.clone(),
            "/mcp_library/servers",
            serde_json::json!({
                "name": "slack", "enabled": true, "transport": "streamable_http",
                "url": &endpoint, "headers": {}, "args": [], "env": {}
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
    let authenticating = if matches!(outcome, Outcome::ScopeUpgrade) {
        // The core publisher also serves remote scope upgrades without an
        // authenticate-created HTTP watchdog/flow-map entry.
        let session = nac_core::mcp_configurations::begin_mcp_oauth_authorization(
            manager.root_cwd(),
            "slack",
            &endpoint,
            "https://nac.example.test/mcp_library/servers/slack/oauth/callback",
            &["mcp:pending-only".into()],
        )
        .await
        .unwrap();
        serde_json::json!({"authorization_url":session.authorization_url()})
    } else {
        let first = response_json(
            post_json(
                app.clone(),
                "/mcp_library/servers/slack/oauth/authenticate",
                serde_json::json!({"additional_scopes": if matches!(outcome, Outcome::RetryScopes) { vec!["mcp:pending-only"] } else { vec![] }}),
            )
            .await,
        )
        .await;
        if matches!(outcome, Outcome::RetryScopes) {
            response_json(
                post_json(
                    app.clone(),
                    "/mcp_library/servers/slack/oauth/authenticate",
                    serde_json::json!({}),
                )
                .await,
            )
            .await
        } else {
            first
        }
    };
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
    let race_barrier = matches!(outcome, Outcome::ConcurrentCallback).then(|| {
        crate::mcp_api::callback_test_gate(
            &manager,
            "slack",
            crate::mcp_api::CallbackTestPhase::Snapshot,
        )
        .0
    });
    let mut invalid_snapshot = matches!(outcome, Outcome::ConcurrentInvalidIssuer).then(|| {
        crate::mcp_api::callback_test_gate(
            &manager,
            "slack",
            crate::mcp_api::CallbackTestPhase::Snapshot,
        )
    });
    let mut invalid_failure = matches!(outcome, Outcome::ConcurrentInvalidIssuer).then(|| {
        crate::mcp_api::callback_test_gate(
            &manager,
            "slack",
            crate::mcp_api::CallbackTestPhase::PendingFailureRead,
        )
    });
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
    let racing_callback = if matches!(outcome, Outcome::ConcurrentInvalidIssuer) {
        let (guard, snapshot) = invalid_snapshot.take().unwrap();
        tokio::time::timeout(Duration::from_secs(5), snapshot.entered.notified())
            .await
            .unwrap();
        drop(guard);
        let app = app.clone();
        let query = format!("{replay_query}&iss=https%3A%2F%2Fwrong.example.test%2F");
        let other = tokio::spawn(async move {
            get_response(
                app,
                &format!("/mcp_library/servers/slack/oauth/callback?{query}"),
                None,
            )
            .await
        });
        tokio::time::timeout(
            Duration::from_secs(5),
            invalid_failure.as_ref().unwrap().1.entered.notified(),
        )
        .await
        .unwrap();
        snapshot.release.wait().await;
        Some(other)
    } else if matches!(outcome, Outcome::ConcurrentCallback) {
        let app = app.clone();
        let query = replay_query.clone();
        Some(tokio::spawn(async move {
            get_response(
                app,
                &format!("/mcp_library/servers/slack/oauth/callback?{query}"),
                None,
            )
            .await
        }))
    } else {
        None
    };
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .expect("token endpoint was not entered");
    if let Some((guard, gate)) = invalid_failure.take() {
        gate.release.wait().await;
        drop(guard);
    }

    if let Some(other) = racing_callback.as_ref() {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !callback.is_finished() && !other.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the rejected callback did not settle before the held token response");
    }
    drop(race_barrier);

    assert!(
        nac_core::mcp_configurations::mcp_oauth_pending_authorization_url(
            manager.root_cwd(),
            "slack",
            &endpoint,
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
    let mut restart_status = None;
    let after_intervention = match outcome {
        Outcome::FailedRestart => {
            restart_status = Some(
                post_json(
                    app.clone(),
                    "/mcp_library/servers/slack/oauth/authenticate",
                    serde_json::json!({"additional_scopes":[""]}),
                )
                .await
                .status(),
            );
            Some(
                response_json(
                    get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None)
                        .await,
                )
                .await,
            )
        }
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
    let racing_status = if let Some(other) = racing_callback {
        Some(
            tokio::time::timeout(Duration::from_secs(5), other)
                .await
                .unwrap()
                .unwrap()
                .status(),
        )
    } else {
        None
    };
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
        Outcome::ConcurrentCallback | Outcome::ConcurrentInvalidIssuer => {
            let statuses = [callback_status, racing_status.unwrap()];
            assert_eq!(
                statuses
                    .iter()
                    .filter(|status| **status == StatusCode::OK)
                    .count(),
                1
            );
            assert_eq!(
                statuses
                    .iter()
                    .filter(|status| **status == StatusCode::BAD_REQUEST)
                    .count(),
                1
            );
            assert_eq!(completed["status"], "connected");
        }
        Outcome::Success
        | Outcome::ScopeUpgrade
        | Outcome::RetryScopes
        | Outcome::FailedRestart => {
            assert_eq!(callback_status, StatusCode::OK);
            assert_eq!(completed["status"], "connected");
        }
        Outcome::TokenFailure | Outcome::Expire => {
            assert_eq!(callback_status, StatusCode::BAD_REQUEST);
            assert_eq!(completed["status"], "failed");
        }
        Outcome::Logout | Outcome::Reconfigure => {
            assert_eq!(
                after_intervention.as_ref().unwrap()["status"],
                "needs_authorization"
            );
            assert_eq!(callback_status, StatusCode::BAD_REQUEST);
            assert_eq!(completed["status"], "needs_authorization");
        }
        Outcome::Supersede => {
            let replacement = after_intervention.as_ref().unwrap();
            assert_eq!(callback_status, StatusCode::BAD_REQUEST);
            assert_eq!(completed["status"], "connecting");
            assert!(replacement["authorization_url"] == completed["authorization_url"]);
            assert!(replacement["authorization_url"].as_str() != Some(authorization.as_str()));
        }
    }
    if matches!(outcome, Outcome::FailedRestart) {
        assert_eq!(restart_status, Some(StatusCode::BAD_REQUEST));
        let surviving = after_intervention.unwrap();
        assert_eq!(surviving["status"], "connecting");
        assert!(surviving.get("authorization_url").is_none());
    }
    if matches!(outcome, Outcome::RetryScopes) {
        let scopes = authorization
            .query_pairs()
            .find_map(|(key, value)| (key == "scope").then(|| value.into_owned()))
            .unwrap();
        assert!(scopes
            .split_whitespace()
            .any(|scope| scope == "mcp:pending-only"));
    }
    assert_eq!(pending["status"], "connecting");
    assert!(pending.get("authorization_url").is_none());
    assert_eq!(after_replay["status"], "connecting");
    assert!(after_replay.get("authorization_url").is_none());
}
