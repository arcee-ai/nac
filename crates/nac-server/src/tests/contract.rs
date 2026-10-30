use super::*;

#[tokio::test]
async fn route_health_and_readiness_latency_use_bounded_content_free_labels() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("telemetry_routes");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("telemetry-route-test-key"));
    let manager = test_manager(&root);
    let exporter = Arc::new(nac_core::telemetry::InMemoryExporter::default());
    let recorder = nac_core::telemetry::TelemetryRecorder::bounded(
        exporter.clone(),
        nac_core::telemetry::RuntimeMetadata::sqlite(
            "build-test",
            "revision-test",
            nac_core::store::schema_version(),
            Some("host-secret"),
            Some("route-test"),
        ),
        128,
    );
    let _telemetry = nac_core::telemetry::install_test_recorder(recorder);
    let app = router(manager);

    for path in ["/healthz", "/readyz", "/sessions/RAW-SESSION-CANARY"] {
        let _ = get_response(app.clone(), path, None).await;
    }

    let deadline = Instant::now() + Duration::from_secs(2);
    let events = loop {
        let events = exporter
            .events()
            .into_iter()
            .filter(|event| event.name == nac_core::telemetry::TelemetryName::HttpRequestDuration)
            .collect::<Vec<_>>();
        if events.len() >= 3 {
            break events;
        }
        assert!(Instant::now() < deadline, "route telemetry did not drain");
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    let routes = events
        .iter()
        .filter_map(|event| event.route.as_deref())
        .collect::<std::collections::HashSet<_>>();
    assert!(routes.contains("/healthz"));
    assert!(routes.contains("/readyz"));
    assert!(routes.contains("/sessions/{session_id}"));
    assert!(!serde_json::to_string(&events)
        .unwrap()
        .contains("RAW-SESSION-CANARY"));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn event_cursor_requires_both_epoch_and_sequence() {
    assert!(delivery::session_runs::event_cursor(&EventsQuery {
        after_epoch_id: None,
        after_sequence_id: None,
        limit: None,
    })
    .unwrap()
    .is_none());
    assert!(delivery::session_runs::event_cursor(&EventsQuery {
        after_epoch_id: Some("epoch".to_string()),
        after_sequence_id: Some(7),
        limit: None,
    })
    .unwrap()
    .is_some());
    for query in [
        EventsQuery {
            after_epoch_id: Some("epoch".to_string()),
            after_sequence_id: None,
            limit: None,
        },
        EventsQuery {
            after_epoch_id: None,
            after_sequence_id: Some(7),
            limit: None,
        },
    ] {
        let error = delivery::session_runs::event_cursor(&query).unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }
}

#[test]
fn model_request_fields_distinguish_omitted_null_and_values() {
    let request: CreateSessionRequest = serde_json::from_str(
        r#"{
                "model":" model-a ",
                "base_url":null,
                "allow_insecure_http":true,
                "backend":"openai-responses",
                "reasoning_effort":"xhigh",
                "api_key_env":null,
                "extra_headers":{"X-Trace":"launch"},
                "orchestrator_compaction_threshold":0
            }"#,
    )
    .unwrap();

    assert_eq!(request.model, RequestField::Value(" model-a ".to_string()));
    assert_eq!(request.base_url, RequestField::Null);
    assert_eq!(request.allow_insecure_http, RequestField::Value(true));
    assert_eq!(
        request.backend,
        RequestField::Value("openai-responses".to_string())
    );
    assert_eq!(
        request.reasoning_effort,
        RequestField::Value("xhigh".to_string())
    );
    assert_eq!(request.api_key_env, RequestField::Null);
    assert_eq!(
        request.extra_headers,
        RequestField::Value(HeadersRequest(BTreeMap::from([(
            "X-Trace".to_string(),
            "launch".to_string()
        )])))
    );
    assert_eq!(
        request.orchestrator_compaction_threshold,
        RequestField::Value(0)
    );
    assert_eq!(request.cwd, None);
}

#[test]
fn create_resolution_inherits_overrides_and_explicitly_clears_optional_config() {
    let inherited = model_options(
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
    )
    .unwrap();
    assert_eq!(inherited.reasoning_effort, OptionalModelOption::Inherit);
    assert_eq!(inherited.api_key_env, OptionalModelOption::Inherit);
    assert_eq!(inherited.extra_headers, None);

    let explicit = model_options(
        Field::Set(" model-a ".to_string()),
        Field::Set(" https://example.com/v1 ".to_string()),
        Field::Set("openai-responses".to_string()),
        Field::Set("xhigh".to_string()),
        Field::Clear,
        Field::Clear,
        Field::Set(true),
    )
    .unwrap();
    assert_eq!(explicit.api_model.as_deref(), Some("model-a"));
    assert_eq!(
        explicit.api_base_url.as_deref(),
        Some("https://example.com/v1")
    );
    assert_eq!(explicit.backend, Some(BackendKind::OpenAiResponses));
    assert_eq!(
        explicit.reasoning_effort,
        OptionalModelOption::Value(ReasoningEffort::Xhigh)
    );
    assert_eq!(explicit.api_key_env, OptionalModelOption::Clear);
    assert_eq!(explicit.extra_headers, Some(BTreeMap::new()));
    assert!(explicit.allow_insecure_http);

    let raw_selector = " SELECTED_KEY ";
    let selected = model_options(
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Set(raw_selector.to_string()),
        Field::Unchanged,
        Field::Unchanged,
    )
    .unwrap();
    assert_eq!(
        selected.api_key_env,
        OptionalModelOption::Value(raw_selector.to_string())
    );
}

#[test]
fn null_required_and_blank_concrete_create_fields_are_bad_requests() {
    for field in ["model", "base_url", "backend"] {
        let json = format!(r#"{{"{field}":null}}"#);
        let request: CreateSessionRequest = serde_json::from_str(&json).unwrap();
        let request = request.into_application();
        let error = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
            request.allow_insecure_http,
        )
        .unwrap_err();
        assert!(error.downcast_ref::<RequestConfigurationError>().is_some());
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }
}

#[test]
fn headers_prefer_objects_and_accept_only_valid_legacy_object_strings() {
    let object: CreateSessionRequest =
        serde_json::from_str(r#"{"extra_headers":{"X-Test":"yes"}}"#).unwrap();
    let legacy: CreateSessionRequest =
        serde_json::from_str(r#"{"extra_headers":"{\"X-Test\":\"yes\"}"}"#).unwrap();
    assert_eq!(object.extra_headers, legacy.extra_headers);

    for invalid in [
        r#"{"extra_headers":"   "}"#,
        r#"{"extra_headers":"[1]"}"#,
        r#"{"extra_headers":{"X-Count":3}}"#,
    ] {
        assert!(serde_json::from_str::<CreateSessionRequest>(invalid).is_err());
    }
}

// The committed Vite build is what every release serves, so a stale or
// partial `assets/dist` has to fail here rather than in a browser.
#[test]
fn committed_frontend_build_is_embedded_and_self_consistent() {
    const HTML: &str = include_str!("../../assets/dist/index.html");

    let referenced: Vec<&str> = HTML
        .match_indices("/assets/dist/assets/")
        .map(|(start, _)| {
            let tail = &HTML[start + 1..];
            let end = tail
                .find(['"', '\''])
                .expect("asset reference must be quoted");
            &tail[..end]
        })
        .collect();
    assert!(
        referenced.iter().any(|path| path.ends_with(".js")),
        "the entry document must load a bundled script"
    );
    assert!(
        referenced.iter().any(|path| path.ends_with(".css")),
        "the entry document must load a bundled stylesheet"
    );

    for path in referenced {
        let embedded = path
            .strip_prefix("assets/")
            .expect("references are rooted at the asset directory");
        let file = ASSETS
            .get_file(embedded)
            .unwrap_or_else(|| panic!("{path} is referenced but not embedded"));
        assert!(!file.contents().is_empty(), "{path} is empty");
        assert_eq!(
            asset_cache_control(embedded),
            "public, max-age=31536000, immutable",
            "hashed bundles must be cacheable forever"
        );
    }

    assert!(!HTML.to_ascii_lowercase().contains("prototype"));
}

#[tokio::test]
async fn public_proxy_headers_reach_get_json_and_sse_routes() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("public_proxy_headers");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    // The proxy's public name is only served once the operator names it.
    unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "preview-1234.ngrok-free.app") };
    seed_editable_session(&root, "session");
    let app = router(test_manager(&root));

    for (origin, fetch_site) in [
        (Some("https://preview-1234.ngrok-free.app"), "same-origin"),
        (None, "none"),
        (Some("https://operator.example"), "cross-site"),
    ] {
        let mut request = Request::builder()
            .uri("/health")
            .header(header::HOST, "preview-1234.ngrok-free.app")
            .header("sec-fetch-site", fetch_site);
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{fetch_site}");
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/missing/steering")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header(header::ORIGIN, "https://operator.example")
                .header("sec-fetch-site", "cross-site")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"instruction":"do nothing"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/missing/steering")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header(header::ORIGIN, "https://preview-1234.ngrok-free.app")
                .header("sec-fetch-site", "same-origin")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"instruction":"do nothing"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/sessions/session/events/stream")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header(header::ORIGIN, "https://preview-1234.ngrok-free.app")
                .header("sec-fetch-site", "same-origin")
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CONTENT_TYPE),
        Some(&header::HeaderValue::from_static("text/event-stream"))
    );
    assert!(response.headers().get(header::CONTENT_ENCODING).is_none());

    drop(response);
    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn a_foreign_host_is_refused_until_the_operator_names_it() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("foreign_host");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    nac_core::store::initialize(&root.join("store.db")).unwrap();

    let health = |app: Router, host: &'static str| async move {
        app.oneshot(
            Request::builder()
                .uri("/health")
                .header(header::HOST, host)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
    };

    // Rebinding turns an attacker-controlled name into a request for this
    // very server, so the name is what has to be refused.
    let guarded = router(test_manager(&root));
    assert_eq!(
        health(guarded.clone(), "rebound.example").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        health(guarded.clone(), "127.0.0.1.rebound.example").await,
        StatusCode::FORBIDDEN
    );
    for host in [
        "127.0.0.1:3210",
        "localhost:3210",
        "[::1]:3210",
        "192.168.1.10:3210",
        "[fd00::1]:3210",
        "LOCALHOST",
    ] {
        assert_eq!(
            health(guarded.clone(), host).await,
            StatusCode::OK,
            "{host} names this server"
        );
    }

    unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "nac.internal, preview.example") };
    let allowlisted = router(test_manager(&root));
    assert_eq!(
        health(allowlisted.clone(), "preview.example").await,
        StatusCode::OK
    );
    assert_eq!(
        health(allowlisted.clone(), "preview.example:8443").await,
        StatusCode::OK
    );
    assert_eq!(
        health(allowlisted.clone(), "other.example").await,
        StatusCode::FORBIDDEN
    );

    unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "*") };
    let unguarded = router(test_manager(&root));
    assert_eq!(
        health(unguarded.clone(), "anything.example").await,
        StatusCode::OK
    );

    drop((guarded, allowlisted, unguarded));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn a_request_without_a_host_header_is_served() {
    let root = temp_root("hostless_request");
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let app = router(test_manager(&root));

    // HTTP/1.0 clients and probes omit the header; browsers never do.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cross_origin_browser_mutations_are_refused() {
    let root = temp_root("cross_origin_mutation");
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let app = router(test_manager(&root));
    let request = |fetch_site: Option<&str>, origin: Option<&str>| {
        let mut request = Request::builder()
            .method("POST")
            .uri("/sessions/missing/compact")
            .header(header::HOST, "192.168.1.20:3210");
        if let Some(fetch_site) = fetch_site {
            request = request.header("sec-fetch-site", fetch_site);
        }
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        request.body(Body::empty()).unwrap()
    };

    for fetch_site in ["cross-site", "same-site"] {
        let response = app
            .clone()
            .oneshot(request(Some(fetch_site), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{fetch_site}");
    }

    let wrong_origin = app
        .clone()
        .oneshot(request(None, Some("http://attacker.example")))
        .await
        .unwrap();
    assert_eq!(wrong_origin.status(), StatusCode::FORBIDDEN);

    let invalid_fetch_metadata = app
        .clone()
        .oneshot(request(Some("unexpected"), Some("http://attacker.example")))
        .await
        .unwrap();
    assert_eq!(invalid_fetch_metadata.status(), StatusCode::FORBIDDEN);

    // Same-origin browsers and non-browser clients reach the handler. The
    // missing session then proves the origin middleware admitted them.
    for admitted in [
        request(Some("same-origin"), None),
        request(None, Some("http://192.168.1.20:3210")),
        request(None, None),
    ] {
        let response = app.clone().oneshot(admitted).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let cross_site_read = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .header(header::HOST, "192.168.1.20:3210")
                .header("sec-fetch-site", "cross-site")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cross_site_read.status(), StatusCode::OK);

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn an_exact_operator_allowed_origin_gets_credentialed_cors_without_broadening_others() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("allowed_browser_origin");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe {
        std::env::set_var(
            ALLOWED_ORIGINS_ENV,
            "https://app.example.com, *, https://bad.example/path",
        )
    };
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let app = router(test_manager(&root));

    let preflight = app
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/sessions/missing/compact")
                .header(header::HOST, "192.168.1.20:3210")
                .header(header::ORIGIN, "https://app.example.com")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(
                    header::ACCESS_CONTROL_REQUEST_HEADERS,
                    "authorization,content-type,x-nac-request-id,x-nac-launch",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preflight.status(), StatusCode::OK);
    assert_eq!(
        preflight.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(&header::HeaderValue::from_static("https://app.example.com"))
    );
    assert_eq!(
        preflight
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS),
        Some(&header::HeaderValue::from_static("true"))
    );
    let allowed_headers = preflight
        .headers()
        .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
        .and_then(|value| value.to_str().ok())
        .unwrap();
    assert!(allowed_headers.contains("x-nac-request-id"));
    assert!(allowed_headers.contains("x-nac-launch"));

    let allowed_mutation = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/missing/compact")
                .header(header::HOST, "192.168.1.20:3210")
                .header(header::ORIGIN, "https://app.example.com")
                .header("sec-fetch-site", "cross-site")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed_mutation.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        allowed_mutation
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(&header::HeaderValue::from_static("https://app.example.com"))
    );

    for denied_origin in ["https://attacker.example", "https://bad.example"] {
        let denied = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/missing/compact")
                    .header(header::HOST, "192.168.1.20:3210")
                    .header(header::ORIGIN, denied_origin)
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN, "{denied_origin}");
        assert!(denied
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_admission_errors_retain_allowed_origin_cors_headers() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_admission_cors");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var(ALLOWED_ORIGINS_ENV, "https://app.example.com") };
    let store_path = root.join("store.db");
    nac_core::store::initialize(&store_path).unwrap();
    let app = router(test_managed_manager(&root));

    // Replacing the store with a directory after construction makes managed
    // admission fail before the route handler runs, exercising its short circuit.
    std::fs::remove_file(&store_path).unwrap();
    std::fs::create_dir(&store_path).unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/missing/compact")
                .header(header::HOST, "192.168.1.20:3210")
                .header(header::ORIGIN, "https://app.example.com")
                .header("sec-fetch-site", "cross-site")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(&header::HeaderValue::from_static("https://app.example.com"))
    );

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn host_headers_are_split_from_their_port_before_they_are_judged() {
    assert_eq!(bare_host("example.com:8443"), Some("example.com"));
    assert_eq!(bare_host("[::1]:3210"), Some("::1"));
    assert_eq!(bare_host("  example.com  "), Some("example.com"));
    assert_eq!(bare_host(":3210"), None);
    // An unterminated IPv6 literal is malformed, not a host.
    assert_eq!(bare_host("[::1"), None);

    for host in [
        "127.0.0.1",
        "127.9.9.9:80",
        "[::1]",
        "localhost",
        "LocalHost:1",
    ] {
        assert!(
            is_non_rebindable_host(host),
            "{host} should not be rebindable"
        );
    }
    for host in ["example.com", "127.0.0.1.example.com", "[::1", ""] {
        assert!(
            !is_non_rebindable_host(host),
            "{host} should require an allowlist entry"
        );
    }

    for host in ["10.0.0.1", "192.168.1.10:3210", "[fd00::1]:3210"] {
        assert!(
            is_non_rebindable_host(host),
            "{host} is an IP literal and cannot be rebound"
        );
    }
}

#[test]
fn the_allowlist_is_parsed_leniently_and_matched_exactly() {
    let allowed = vec!["nac.internal".to_string(), "preview.example".to_string()];

    assert!(host_is_allowed("NAC.Internal:8080", &allowed));
    assert!(host_is_allowed("preview.example", &allowed));
    assert!(!host_is_allowed("evil-preview.example", &allowed));
    assert!(!host_is_allowed("preview.example.evil.com", &allowed));
    // Loopback needs no entry at all.
    assert!(host_is_allowed("localhost:3210", &[]));
}

#[tokio::test]
async fn an_explicit_non_loopback_bind_is_accepted() {
    let root = temp_root("non_loopback_bind");
    let manager = test_manager(&root);
    let (listening_tx, listening_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        serve_with_policy(
            "0.0.0.0:0".parse().unwrap(),
            BindPolicy::AllowRemote,
            manager,
            move |bound| {
                let _ = listening_tx.send(bound);
            },
        )
        .await
    });

    let bound = tokio::time::timeout(Duration::from_secs(2), listening_rx)
        .await
        .expect("non-loopback bind timed out")
        .expect("server stopped before listening");
    assert!(bound.ip().is_unspecified());
    assert_ne!(bound.port(), 0);

    server.abort();
    let _ = server.await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn complete_shutdown_is_bounded_with_an_open_session_event_stream() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("bounded_shutdown_sse");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("shutdown-test-key"));
    let manager = test_manager(&root);
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let snapshot = sessions::new_snapshot(
        "shutdown-stream".to_string(),
        root.clone(),
        "gpt-5.2".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bound = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let (forced_tx, forced_rx) = std::sync::mpsc::channel();
    let server = tokio::spawn(serve_listener_with_shutdown(
        listener,
        None,
        manager,
        async move {
            let _ = shutdown_rx.await;
        },
        Duration::from_millis(100),
        move || {
            let _ = forced_tx.send(());
        },
    ));

    let mut stream = tokio::net::TcpStream::connect(bound).await.unwrap();
    stream
            .write_all(
                b"GET /sessions/shutdown-stream/events/stream HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\n\r\n",
            )
            .await
            .unwrap();
    let mut response = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let mut chunk = [0_u8; 1024];
            let count = stream.read(&mut chunk).await.unwrap();
            assert_ne!(count, 0, "event stream closed before its response");
            response.extend_from_slice(&chunk[..count]);
            if response
                .windows(b"\r\n\r\n".len())
                .any(|window| window == b"\r\n\r\n")
            {
                break;
            }
        }
    })
    .await
    .expect("event stream response timed out");
    let response = String::from_utf8_lossy(&response);
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("content-type: text/event-stream"));

    shutdown_tx.send(()).unwrap();
    tokio::task::block_in_place(|| forced_rx.recv_timeout(Duration::from_secs(1)))
        .expect("forced shutdown outlived the complete shutdown bound");
    drop(stream);
    server.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn non_loopback_bind_is_refused_without_explicit_policy() {
    let error = BindPolicy::LoopbackOnly
        .validate("192.168.1.20:3210".parse().unwrap())
        .unwrap_err();
    assert!(error.to_string().contains("--allow-remote"));
}

/// Path of a bundled script, whose name carries a content hash that changes
/// on every build.
fn bundled_script_path() -> String {
    let file = ASSETS
        .get_dir("dist/assets")
        .expect("the committed build must be embedded")
        .files()
        .find(|file| file.path().extension().is_some_and(|ext| ext == "js"))
        .expect("the build must emit at least one script");
    format!("/assets/{}", file.path().to_string_lossy())
}

#[tokio::test]
async fn finite_static_and_json_routes_gzip_without_changing_identity_bodies() {
    let root = temp_root("route_compression");
    let app = router(test_manager(&root));
    let script = bundled_script_path();

    let identity = get_response(app.clone(), &script, None).await;
    assert_eq!(identity.status(), StatusCode::OK);
    assert!(identity.headers().get(header::CONTENT_ENCODING).is_none());
    let identity_body = response_body(identity).await;
    assert!(!identity_body.is_empty());

    let compressed = get_response(app.clone(), &script, Some("gzip")).await;
    assert_eq!(compressed.status(), StatusCode::OK);
    assert_eq!(
        compressed.headers().get(header::CONTENT_ENCODING),
        Some(&header::HeaderValue::from_static("gzip"))
    );
    assert_eq!(gunzip(&response_body(compressed).await), identity_body);

    let json_identity = get_response(app.clone(), "/store", None).await;
    assert_eq!(json_identity.status(), StatusCode::OK);
    assert!(json_identity
        .headers()
        .get(header::CONTENT_ENCODING)
        .is_none());
    let json_identity_body = response_body(json_identity).await;
    let _: serde_json::Value = serde_json::from_slice(&json_identity_body).unwrap();

    let json_compressed = get_response(app, "/store", Some("gzip")).await;
    assert_eq!(json_compressed.status(), StatusCode::OK);
    assert_eq!(
        json_compressed.headers().get(header::CONTENT_ENCODING),
        Some(&header::HeaderValue::from_static("gzip"))
    );
    assert_eq!(
        gunzip(&response_body(json_compressed).await),
        json_identity_body
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn session_event_envelope_serializes_for_sse_payloads() {
    let envelope = SessionEventEnvelope {
        session_id: Some("session-1".to_string()),
        epoch_id: "test-epoch".to_string(),
        sequence_id: 42,
        client_id: None,
        run_id: None,
        event: nac_core::events::SessionEvent::RunFailed {
            message: "boom".to_string(),
            failure: None,
        },
    };

    let payload = serde_json::to_string(&envelope).unwrap();

    assert!(payload.contains("\"sequence_id\":42"));
    assert!(payload.contains("\"message\":\"boom\""));
}

#[test]
fn invalid_workspace_diff_stage_maps_to_bad_request() {
    let error = view::WorkspaceDiffStage::parse("sideways").unwrap_err();
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_replacement_preserves_attached_sandbox_ownership() {
    assert_eq!(
            config_replacement_conflict(false, true),
            Some(
                "session owns an active sandbox; config replacement is unavailable while container-local state must be preserved"
            )
        );
    assert!(config_replacement_conflict(false, false).is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn deletion_fails_closed_when_snapshot_decode_cannot_yield_sandbox_metadata() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("delete_invalid_snapshot_preserves_sandbox_authority");
    seed_editable_session(&root, "sandbox-session");
    let store_path = root.join("store.db");
    let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    sessions::save_session(&store_path, &snapshot).unwrap();

    let mut raw = sessions::load_session_config(&store_path, "sandbox-session").unwrap();
    raw.backend = Some("auto".to_string());
    sessions::update_raw_session_config(&store_path, &raw).unwrap();
    assert!(sessions::load_session(&store_path, "sandbox-session").is_err());

    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let arguments = root.join("podman-arguments");
    std::fs::write(
        &podman,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("PATH", &bin);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }

    let manager = test_manager(&root);
    manager
        .delete_session("sandbox-session")
        .await
        .expect_err("invalid snapshot must fail closed before cleanup or row deletion");
    assert!(
        sessions::load_session_config(&store_path, "sandbox-session").is_ok(),
        "durable row and sandbox retry authority must remain"
    );
    assert!(
        !arguments.exists(),
        "container cleanup must not run without decoded ownership metadata"
    );

    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn failed_restart_container_cleanup_preserves_durable_delete_authority() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("durable_sandbox_delete");
    seed_editable_session(&root, "sandbox-session");
    let git_executable = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join("git"))
        .find(|candidate| candidate.is_file())
        .expect("git executable on PATH");
    let git = |args: &[&str]| {
        let output = std::process::Command::new(&git_executable)
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.name", "NAC Test"]);
    git(&["config", "user.email", "nac@example.invalid"]);
    std::fs::write(root.join("revision.txt"), b"pinned\n").unwrap();
    git(&["add", "revision.txt"]);
    git(&["commit", "-m", "pinned revision"]);
    git(&["update-ref", "refs/nac/revisions/sandbox-session", "HEAD"]);
    let fork_point = String::from_utf8(
        std::process::Command::new(&git_executable)
            .arg("-C")
            .arg(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    let store_path = root.join("store.db");
    let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    nac_core::test_support::set_sandbox_worktree(
        &mut snapshot,
        root.clone(),
        root.join("missing-worktree"),
        fork_point,
    );
    sessions::save_session(&store_path, &snapshot).unwrap();

    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::os::unix::fs::symlink(&git_executable, bin.join("git")).unwrap();
    let podman = bin.join("podman");
    let arguments = root.join("podman-arguments");
    std::fs::write(
            &podman,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\nexit \"$NAC_TEST_PODMAN_STATUS\"\n",
        )
        .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    let original_status = std::env::var_os("NAC_TEST_PODMAN_STATUS");
    unsafe {
        std::env::set_var("PATH", &bin);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
        std::env::set_var("NAC_TEST_PODMAN_STATUS", "23");
    }

    let manager = test_manager(&root);
    let error = manager.delete_session("sandbox-session").await.unwrap_err();
    assert!(error
        .to_string()
        .contains("failed to remove sandbox container"));
    assert!(sessions::load_session(&store_path, "sandbox-session").is_ok());
    git(&[
        "rev-parse",
        "--verify",
        "refs/nac/revisions/sandbox-session",
    ]);
    assert_eq!(
        std::fs::read_to_string(&arguments).unwrap(),
        "rm\n--ignore\n-f\nnac-sandbox-session\n"
    );

    unsafe { std::env::set_var("NAC_TEST_PODMAN_STATUS", "0") };
    manager.delete_session("sandbox-session").await.unwrap();
    assert!(sessions::load_session(&store_path, "sandbox-session").is_err());
    let revision_ref = std::process::Command::new(&git_executable)
        .arg("-C")
        .arg(&root)
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            "refs/nac/revisions/sandbox-session",
        ])
        .status()
        .unwrap();
    assert!(!revision_ref.success());

    unsafe {
        for (name, value) in [
            ("PATH", original_path),
            ("NAC_TEST_PODMAN_ARGUMENTS", original_arguments),
            ("NAC_TEST_PODMAN_STATUS", original_status),
        ] {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_delete_request_keeps_authority_until_podman_cleanup_settles() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cancelled_durable_sandbox_delete");
    seed_editable_session(&root, "sandbox-session");
    let store_path = root.join("store.db");
    let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    sessions::save_session(&store_path, &snapshot).unwrap();

    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let ready = root.join("podman-ready");
    let release = root.join("podman-release");
    std::fs::write(
            &podman,
            "#!/bin/sh\n: > \"$NAC_TEST_PODMAN_READY\"\nwhile [ ! -f \"$NAC_TEST_PODMAN_RELEASE\" ]; do /bin/sleep 0.01; done\nexit 0\n",
        )
        .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_ready = std::env::var_os("NAC_TEST_PODMAN_READY");
    let original_release = std::env::var_os("NAC_TEST_PODMAN_RELEASE");
    unsafe {
        std::env::set_var("PATH", &bin);
        std::env::set_var("NAC_TEST_PODMAN_READY", &ready);
        std::env::set_var("NAC_TEST_PODMAN_RELEASE", &release);
    }

    let manager = test_manager(&root);
    let delete_manager = manager.clone();
    let request =
        tokio::spawn(async move { delete_manager.delete_session("sandbox-session").await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !ready.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("Podman cleanup should start");
    request.abort();

    assert!(matches!(
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "sandbox-session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&store_path, "sandbox-session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));

    std::fs::write(&release, b"release").unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while sessions::load_session(&store_path, "sandbox-session").is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned deletion task should finish after cleanup");
    drop(
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "sandbox-session")
            .unwrap(),
    );

    unsafe {
        for (name, value) in [
            ("PATH", original_path),
            ("NAC_TEST_PODMAN_READY", original_ready),
            ("NAC_TEST_PODMAN_RELEASE", original_release),
        ] {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_drains_private_control_requests_before_persistence_and_accounting() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("shutdown_control_drain");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("shutdown-test-key"));
    let manager = test_manager(&root);
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let public = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let control = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bound = control.local_addr().unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let app = Router::new().route(
        "/held",
        get({
            let entered = entered.clone();
            let release = release.clone();
            let finished = finished.clone();
            let store = root.join("store.db");
            move || {
                let entered = entered.clone();
                let release = release.clone();
                let finished = finished.clone();
                let store = store.clone();
                async move {
                    entered.notify_one();
                    release.notified().await;
                    nac_core::store::check_readiness(&store).unwrap();
                    finished.store(true, std::sync::atomic::Ordering::SeqCst);
                    "done"
                }
            }
        }),
    );
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(serve_listener_with_shutdown(
        public,
        Some((control, app)),
        manager,
        async move {
            let _ = shutdown_rx.await;
        },
        Duration::from_secs(1),
        || panic!("control drain exceeded unchanged shutdown deadline"),
    ));
    let mut stream = tokio::net::TcpStream::connect(bound).await.unwrap();
    stream
        .write_all(b"GET /held HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(1), entered.notified())
        .await
        .unwrap();
    shutdown_tx.send(()).unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(
        !server.is_finished(),
        "server returned before private request drained"
    );
    assert!(!finished.load(std::sync::atomic::Ordering::SeqCst));
    release.notify_one();
    let mut response = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), stream.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(finished.load(std::sync::atomic::Ordering::SeqCst));
    let _ = std::fs::remove_dir_all(root);
}
