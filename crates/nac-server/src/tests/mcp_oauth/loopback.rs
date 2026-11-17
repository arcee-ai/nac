use super::*;

#[derive(Default)]
struct CallbackExporter {
    events: std::sync::Mutex<Vec<nac_core::telemetry::TelemetryEvent>>,
    paused: std::sync::Mutex<bool>,
    wake: std::sync::Condvar,
    entered: std::sync::atomic::AtomicBool,
    fail: std::sync::atomic::AtomicBool,
}
impl nac_core::telemetry::TelemetryExporter for CallbackExporter {
    fn export(
        &self,
        event: &nac_core::telemetry::TelemetryEvent,
    ) -> Result<(), nac_core::telemetry::TelemetryExportError> {
        // Attempts are retained before returning an exporter error. They are NOT
        // successfully delivered observations or a zero-loss/native receipt.
        self.events.lock().unwrap().push(event.clone());
        let mut paused = self.paused.lock().unwrap();
        if *paused {
            self.entered
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
        while *paused {
            paused = self.wake.wait(paused).unwrap();
        }
        if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
            Err(nac_core::telemetry::TelemetryExportError)
        } else {
            Ok(())
        }
    }
}
struct ReleaseCallbackExporter(std::sync::Arc<CallbackExporter>);
impl Drop for ReleaseCallbackExporter {
    fn drop(&mut self) {
        *self.0.paused.lock().unwrap() = false;
        self.0.wake.notify_all();
    }
}

#[tokio::test]
async fn loopback_retry_reuses_only_its_own_live_callback_listener() {
    loopback_case(false, false).await;
}

#[tokio::test]
async fn loopback_replacement_rejects_the_old_accepted_callback() {
    loopback_case(true, false).await;
}

#[tokio::test]
async fn loopback_failed_export_preserves_404_rejection_and_callback_ownership() {
    loopback_case(true, true).await;
}

async fn loopback_case(replace_accepted: bool, fail_export: bool) {
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
    let exporter = std::sync::Arc::new(CallbackExporter::default());
    exporter
        .fail
        .store(fail_export, std::sync::atomic::Ordering::SeqCst);
    let release_exporter = ReleaseCallbackExporter(exporter.clone());
    let recorder = nac_core::telemetry::TelemetryRecorder::bounded(
        exporter.clone(),
        nac_core::telemetry::RuntimeMetadata::sqlite("callback-test", "source-test", 1, None, None),
        // Preserve the original cases' capacity4. The new failed-export case
        // keeps its prefix observable before deliberately overflowing below.
        if fail_export { 32 } else { 4 },
    );
    let _telemetry = nac_core::telemetry::install_test_recorder(recorder.clone());
    let case_exporter = exporter.clone();
    let case_recorder = recorder.clone();
    let body_app = app.clone();
    let result = tokio::spawn(async move {
        let app = body_app;
        let first = authenticate(app.clone(), serde_json::json!({})).await;
        let first_url = first["authorization_url"].as_str().unwrap().to_owned();
        if fail_export {
            listening_attempt(&case_exporter, 1).await;
        }
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
        let current_owner = if fail_export {
            let owner = listening_attempt(&case_exporter, 2).await;
            settled_attempts(&case_recorder).await;
            assert_eq!(case_recorder.stats().dropped, 0);
            assert!(case_recorder.stats().failures > 0);
            let before = response_json(
                get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
            )
            .await;
            let response = loopback_request("/not-an-oauth-callback?state=unrelated").await;
            assert!(response.starts_with("HTTP/1.1 404 Not Found\r\n"));
            assert!(response.ends_with("This is not an active OAuth callback."));
            settled_attempts(&case_recorder).await;
            assert_eq!(case_recorder.stats().dropped, 0);
            let attempts = case_exporter.events.lock().unwrap().clone();
            assert_eq!(
                attempts
                    .iter()
                    .filter(|event| event.name
                        == nac_core::telemetry::TelemetryName::McpOAuthCallbackListening)
                    .count(),
                2
            );
            assert!(!attempts.iter().any(|event| event.name
                == nac_core::telemetry::TelemetryName::McpOAuthCallbackStateRejected));
            assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 0);
            let after = response_json(
                get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
            )
            .await;
            assert!(
                after == before,
                "unrelated path changed the current callback state"
            );
            Some(owner)
        } else {
            None
        };
        let rejected = callback(&first_url).await;
        assert!(rejected.starts_with("HTTP/1.1 400"));
        if fail_export {
            assert!(rejected.ends_with(
                "This OAuth callback is stale or invalid. Return to NAC and try again."
            ));
        }
        assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 0);
        // A second invalid state stays on the same listener and cannot emit another rejection.
        assert!(callback(&first_url).await.starts_with("HTTP/1.1 400"));
        let pending = response_json(
            get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
        )
        .await;
        assert_eq!(pending["status"], "connecting");
        let observed = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let events = case_exporter.events.lock().unwrap().clone();
                if let Some(rejected) = events.iter().find(|e| {
                    e.name == nac_core::telemetry::TelemetryName::McpOAuthCallbackStateRejected
                }) {
                    assert_eq!(events.iter().filter(|e| e.name == rejected.name).count(), 1);
                    assert!(events.iter().any(|e| e.name
                        == nac_core::telemetry::TelemetryName::McpOAuthCallbackListening
                        && e.correlation.generation == rejected.correlation.generation));
                    break;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await;
        assert!(observed.is_ok());
        if let Some(owner) = current_owner {
            settled_attempts(&case_recorder).await;
            assert_eq!(case_recorder.stats().dropped, 0);
            let attempts = case_exporter.events.lock().unwrap().clone();
            let rejections = attempts
                .iter()
                .filter(|event| {
                    event.name == nac_core::telemetry::TelemetryName::McpOAuthCallbackStateRejected
                })
                .collect::<Vec<_>>();
            assert_eq!(rejections.len(), 1);
            assert_eq!(rejections[0].correlation.generation, Some(owner));
            for event in attempts.iter().filter(|event| {
                matches!(
                    event.name,
                    nac_core::telemetry::TelemetryName::McpOAuthCallbackListening
                        | nac_core::telemetry::TelemetryName::McpOAuthCallbackStateRejected
                )
            }) {
                assert!(event.route.is_none() && event.error.is_none());
                let encoded = serde_json::to_string(event).unwrap();
                assert!(
                    !encoded.contains("route-client-secret-canary")
                        && !encoded.contains("loopback-test-code")
                        && !encoded.contains(&first_url)
                        && !encoded.contains(&second_url)
                );
            }
            // Matching state now completes on that SAME pending owner, despite
            // every attempted observation returning an actual exporter error.
            let url = second_url.clone();
            let accepted = tokio::spawn(async move { callback(&url).await });
            tokio::time::timeout(Duration::from_secs(5), entered.notified())
                .await
                .unwrap();
            release.notify_one();
            let response = tokio::time::timeout(Duration::from_secs(5), accepted)
                .await
                .unwrap()
                .unwrap();
            assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
            assert!(response.ends_with("Authorization complete. You can close this window."));
            assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 1);
            let connected = response_json(
                get_response(app.clone(), "/mcp_library/servers/slack/oauth/status", None).await,
            )
            .await;
            assert_eq!(connected["status"], "connected");
            settled_attempts(&case_recorder).await;
            assert_eq!(
                case_exporter
                    .events
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|event| event.name
                        == nac_core::telemetry::TelemetryName::McpOAuthCallbackStateRejected
                        && event.correlation.generation == Some(owner))
                    .count(),
                1
            );
        }
        // Stall the actual exporter and overflow its queue. The remaining real callbacks,
        // replacement abort/join, token completion and logout must still finish below.
        *case_exporter.paused.lock().unwrap() = true;
        nac_core::telemetry::emit_http_duration(
            "/fixture-control",
            Default::default(),
            Duration::ZERO,
            nac_core::telemetry::TelemetryOutcome::Ok,
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            while !case_exporter
                .entered
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .unwrap();
        for _ in 0..100 {
            nac_core::telemetry::emit_http_duration(
                "/fixture-control",
                Default::default(),
                Duration::ZERO,
                nac_core::telemetry::TelemetryOutcome::Ok,
            );
        }

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
            (if replace_accepted { 2 } else { 1 }) + usize::from(fail_export)
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
    assert!(
        recorder.stats().dropped > 0,
        "stalled exporter did not exercise overflow"
    );
    drop(release_exporter);
    settled_attempts(&recorder).await;
    let stats = recorder.stats();
    assert_eq!(stats.accepted, stats.exported + stats.failures);
    assert_eq!(
        exporter.events.lock().unwrap().len() as u64,
        stats.exported + stats.failures
    );
    if fail_export {
        assert!(
            stats.failures > 0,
            "error adapter was not actually exercised"
        );
        assert_eq!(
            stats.exported, 0,
            "failed attempts must not be credited as delivered"
        );
        assert_eq!(stats.accepted, stats.failures);
    } else {
        assert_eq!(stats.failures, 0);
    }
    drop(recorder);
    // bounded() is observation-only: Drained acknowledges queue processing,
    // not thread join, delivered observations, final receipts or Native acceptance.
    assert_eq!(
        nac_core::telemetry::finish_export(Duration::from_secs(2)),
        nac_core::telemetry::ExportShutdown::Drained
    );
    result.unwrap();
}

async fn listening_attempt(exporter: &CallbackExporter, count: usize) -> u64 {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let owners = exporter
                .events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| {
                    event.name == nac_core::telemetry::TelemetryName::McpOAuthCallbackListening
                })
                .filter_map(|event| event.correlation.generation)
                .collect::<Vec<_>>();
            if owners.len() == count {
                return *owners.last().unwrap();
            }
            assert!(owners.len() < count);
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap()
}

async fn settled_attempts(recorder: &nac_core::telemetry::TelemetryRecorder) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let stats = recorder.stats();
            if stats.accepted == stats.exported + stats.failures {
                return;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
}

async fn authenticate(app: axum::Router, body: serde_json::Value) -> serde_json::Value {
    let response = post_json(app, "/mcp_library/servers/slack/oauth/authenticate", body).await;
    let status = response.status();
    let value = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value
}

async fn callback(authorization_url: &str) -> String {
    let url = url::Url::parse(authorization_url).unwrap();
    let state = url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("code", "loopback-test-code")
        .append_pair("state", &state)
        .finish();
    loopback_request(&format!("/mcp_library/oauth/callback?{query}")).await
}

async fn loopback_request(target: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect("127.0.0.1:1456")
        .await
        .unwrap();
    stream
        .write_all(
            format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    let mut response = String::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_string(&mut response))
        .await
        .unwrap()
        .unwrap();
    response
}
