use super::*;
use nac_core::commands::slash_command_definitions;

#[tokio::test]
async fn provider_models_route_maps_caller_url_hygiene_to_bad_request() {
    let root = temp_root("provider_models_url_hygiene");
    let app = router(test_manager(&root));

    for (base_url, expected) in [
        ("relative/path", "not a valid absolute URL"),
        (
            "ftp://gateway.example/v1",
            "absolute http(s) URL with a host",
        ),
        (
            "https://user:secret@gateway.example/v1",
            "must not embed userinfo",
        ),
        ("http://gateway.example/v1", "requires HTTPS"),
    ] {
        let response = post_json(
            app.clone(),
            "/providers/models",
            serde_json::json!({
                "backend": "openai-responses",
                "api_key": "provider-route-test-key",
                "base_url": base_url,
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{base_url}");
        let body = response_json(response).await;
        assert!(
            body["error"]
                .as_str()
                .is_some_and(|message| message.contains(expected)),
            "unexpected response for {base_url}: {body}"
        );
        assert!(!body.to_string().contains("provider-route-test-key"));
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn provider_models_route_keeps_provider_failures_at_bad_gateway() {
    use std::io::{Read, Write};

    let root = temp_root("provider_models_upstream_failure");
    let app = router(test_manager(&root));
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0u8; 2048];
        let read = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..read]);
        assert!(request.starts_with("GET /models "), "{request}");
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer provider-route-test-key"),
            "{request}"
        );
        stream
            .write_all(
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 21\r\nConnection: close\r\n\r\ndiscovery unavailable",
            )
            .unwrap();
    });

    let response = post_json(
        app,
        "/providers/models",
        serde_json::json!({
            "backend": "openai-responses",
            "api_key": "provider-route-test-key",
            "base_url": base_url,
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body = response_json(response).await;
    assert!(body["error"]
        .as_str()
        .is_some_and(|message| message.contains("503")));
    assert!(!body.to_string().contains("provider-route-test-key"));
    server.join().unwrap();

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn commands_route_returns_registry() {
    let root = temp_root("commands_endpoint");
    let app = router(test_manager(&root));
    let response = get_response(app, "/commands", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::to_value(slash_command_definitions()).unwrap()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn session_skills_route_uses_the_attached_session_registry() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("session_skills");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let skills = root.join(".nac/skills");
    for (name, description) in [
        ("zeta", "Last skill alphabetically"),
        ("demo", "Demonstrate the feature"),
    ] {
        let directory = skills.join(name);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
                directory.join("SKILL.md"),
                format!(
                    "---\nname: {name}\ndescription: {description}\ncompatibility: nac\n---\n\n{name} body\n"
                ),
            )
            .unwrap();
    }

    let manager = test_manager(&root);
    let request = CreateSessionRequest {
        cwd: Some(root.clone()),
        model: RequestField::Value("gpt-5.2".to_string()),
        backend: RequestField::Value("openai-responses".to_string()),
        api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
        ..CreateSessionRequest::default()
    };
    let populated = manager.create_session(request.clone()).await.unwrap();
    let populated_id = populated.metadata.session_id.unwrap();

    let app = router(manager.clone());
    let response = get_response(
        app.clone(),
        &format!("/sessions/{populated_id}/skills"),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let mut catalog = response_json(response).await;
    let bundled = catalog.as_array_mut().unwrap().remove(1);
    assert_eq!(bundled["name"], "nac-help");
    assert!(bundled["description"]
        .as_str()
        .unwrap()
        .contains("first-party"));
    assert_eq!(
        catalog,
        serde_json::json!([
            {
                "name": "demo",
                "description": "Demonstrate the feature",
                "compatibility": "nac"
            },
            {
                "name": "zeta",
                "description": "Last skill alphabetically",
                "compatibility": "nac"
            }
        ])
    );
    let response = get_response(
        app.clone(),
        &format!("/sessions/{populated_id}/commands"),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::to_value(slash_command_definitions()).unwrap()
    );
    std::fs::remove_dir_all(&skills).unwrap();
    let empty = manager.create_session(request).await.unwrap();
    let empty_id = empty.metadata.session_id.unwrap();

    let response = get_response(app.clone(), &format!("/sessions/{empty_id}/skills"), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let catalog = response_json(response).await;
    assert_eq!(catalog.as_array().unwrap().len(), 1);
    assert_eq!(catalog[0]["name"], "nac-help");

    let response = get_response(app, "/sessions/missing/skills", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn models_endpoint_serves_the_catalog_listing() {
    let root = temp_root("models_endpoint");
    let app = router(test_manager(&root));
    let response = get_response(app, "/models", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;

    assert!(body["catalog_version"].as_u64().unwrap() >= 1);
    let providers = body["providers"].as_array().unwrap();
    assert_eq!(providers.len(), 9);
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

    // Auth requirements and managed base URLs derive from the backend
    // kind, so they are exact regardless of the machine's catalog layers.
    assert_eq!(by_id("anthropic-messages")["auth"], "api_key_env");
    assert!(by_id("anthropic-messages")["managed_base_url"].is_null());
    assert_eq!(by_id("arcee-api")["auth"], "api_key_env");
    assert_eq!(by_id("arcee-auth")["auth"], "managed_arcee");
    assert_eq!(
        by_id("arcee-auth")["managed_base_url"],
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(by_id("chatgpt-codex-responses")["auth"], "codex_oauth");

    // Catalog endpoint defaults: present for the six models.dev-backed
    // projections and the hand-seeded arcee-api (exact values are pinned
    // hermetically in nac-core; a machine overlay could carry a
    // refreshed models.dev `api`), absent for the managed providers.
    for id in [
        "anthropic-messages",
        "deepseek-chat",
        "fireworks-chat",
        "openai-chat-completions",
        "openai-responses",
        "together-chat",
        "arcee-api",
    ] {
        assert!(
            by_id(id)["default_base_url"].is_string(),
            "{id} must serve a catalog default_base_url"
        );
    }
    for id in ["arcee-auth", "chatgpt-codex-responses"] {
        assert!(
            by_id(id)["default_base_url"].is_null(),
            "{id} must not serve a catalog default_base_url"
        );
    }
    assert_eq!(
        by_id("chatgpt-codex-responses")["managed_base_url"],
        nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL
    );
    // Managed providers without a stored credential hint their login
    // command (a code constant, independent of machine catalog layers).
    for (id, command) in [
        ("arcee-auth", "nac-web arcee-auth login"),
        ("chatgpt-codex-responses", "nac-web codex-auth login"),
    ] {
        if by_id(id)["auth_status"] == "no_credential" {
            assert_eq!(by_id(id)["auth_hint"], command, "{id}");
        }
    }

    // Every provider carries `_default` limits and real entries only
    // (never the `_default` id or a synthesis-product source). Values
    // stay unpinned here: the prod nac-core build layers the machine's
    // overlay/models.json, which may patch them — exact values are
    // pinned hermetically by the nac-core catalog tests.
    for provider in providers {
        // Auth status is computed per request from the machine's env
        // and credential files, so only the value domain and the
        // hint/status invariants are machine-independent here.
        let status = provider["auth_status"].as_str().unwrap();
        assert!(
            ["ready", "no_credential"].contains(&status),
            "unexpected auth_status: {status}"
        );
        let hint = &provider["auth_hint"];
        if status == "ready" {
            assert!(hint.is_null(), "ready providers carry no hint: {provider}");
        } else if provider["auth"] == "api_key_env" {
            assert!(
                hint.as_str().is_some_and(|hint| !hint.is_empty()),
                "no_credential API-key providers hint the conventional var: {provider}"
            );
        }
        let limits = &provider["default_limits"];
        assert!(limits["context_window"].as_u64().unwrap() > 0);
        assert!(limits["max_tokens"].as_u64().unwrap() > 0);
        assert!(limits["supported_efforts"].is_array());
        for model in provider["models"].as_array().unwrap() {
            assert_ne!(model["id"], "_default");
            assert!(
                ["baseline", "overlay", "user_override"]
                    .contains(&model["source"].as_str().unwrap()),
                "unexpected model source: {}",
                model["source"]
            );
            assert!(model["context_window"].as_u64().unwrap() > 0);
            assert!(model["max_tokens"].as_u64().unwrap() > 0);
        }
    }

    // Baseline entries are always present: the overlay/user layers patch
    // or add, never remove.
    let anthropic_models = by_id("anthropic-messages")["models"].as_array().unwrap();
    let opus = anthropic_models
        .iter()
        .find(|m| m["id"] == "claude-opus-4-6")
        .expect("the embedded baseline's claude-opus-4-6 entry");
    assert!(opus["supported_efforts"].is_array());
    assert_eq!(opus["reasoning"], true);

    // The hand-seeded providers serve their maintained entries too.
    for (provider, model_id) in [
        ("arcee-auth", "trinity-large-thinking"),
        ("arcee-api", "trinity-large-thinking"),
        ("chatgpt-codex-responses", "gpt-5.6-sol"),
    ] {
        assert!(
            by_id(provider)["models"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["id"] == model_id),
            "the seed's {model_id} entry must reach the {provider} listing"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn models_endpoint_computes_auth_status_from_the_environment() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("models_endpoint_status");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    // Isolated: no credential files, no config, OPENAI_API_KEY cleared.
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

    // Conventional var unset + no configured selector: no_credential
    // with the conventional name as the hint.
    assert_eq!(by_id("openai-responses")["auth_status"], "no_credential");
    assert_eq!(by_id("openai-responses")["auth_hint"], "OPENAI_API_KEY");
    assert!(by_id("openai-responses")["connection"].is_null());
    assert_eq!(
        by_id("openai-chat-completions")["auth_status"],
        "no_credential"
    );
    assert_eq!(
        by_id("openai-chat-completions")["auth_hint"],
        "OPENAI_API_KEY"
    );
    // Managed providers without stored credentials hint the login
    // commands.
    assert_eq!(by_id("arcee-auth")["auth_status"], "no_credential");
    assert_eq!(by_id("arcee-auth")["auth_hint"], "nac-web arcee-auth login");
    assert_eq!(
        by_id("chatgpt-codex-responses")["auth_status"],
        "no_credential"
    );
    assert_eq!(
        by_id("chatgpt-codex-responses")["auth_hint"],
        "nac-web codex-auth login"
    );

    let saved = post_json(app.clone(), "/provider-connections", serde_json::json!({
        "backend":"deepseek-chat", "base_url":"https://api.deepseek.com", "api_key":"saved-deepseek-key"
    })).await;
    assert_eq!(saved.status(), StatusCode::CREATED);
    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let deepseek = body["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|provider| provider["id"] == "deepseek-chat")
        .unwrap();
    assert_eq!(deepseek["auth_status"], "ready");
    assert_eq!(
        deepseek["connection"]["base_url"],
        "https://api.deepseek.com"
    );
    let selector = deepseek["connection"]["api_key_env"].as_str().unwrap();
    assert!(selector.starts_with("NAC_PROVIDER_"));
    assert_ne!(selector, "saved-deepseek-key");

    // The conventional variable naming a set value reads ready — the
    // same variable session resolution auto-selects. Unrelated
    // providers still report only their conventional credential hint.
    unsafe { std::env::set_var("OPENAI_API_KEY", "server-test-key") };
    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();
    assert_eq!(by_id("openai-responses")["auth_status"], "ready");
    assert!(by_id("openai-responses")["auth_hint"].is_null());
    assert_eq!(
        by_id("openai-responses")["connection"]["api_key_env"],
        "OPENAI_API_KEY"
    );
    assert_eq!(by_id("openai-chat-completions")["auth_status"], "ready");
    assert_eq!(
        by_id("openai-chat-completions")["connection"]["api_key_env"],
        "OPENAI_API_KEY"
    );
    assert_eq!(by_id("anthropic-messages")["auth_status"], "no_credential");
    assert_eq!(
        by_id("anthropic-messages")["auth_hint"],
        "ANTHROPIC_API_KEY"
    );

    // A parseable stored credential flips its managed provider.
    std::fs::write(
            nac_home.join("auth.json"),
            r#"{"type":"chatgpt-codex","access":"access-test","refresh":"refresh-test","expires_at_ms":18446744073709551615,"account_id":"account-test"}"#,
        )
        .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            nac_home.join("auth.json"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
    }
    let body = response_json(get_response(app, "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let codex = providers
        .iter()
        .find(|p| p["id"] == "chatgpt-codex-responses")
        .unwrap();
    assert_eq!(codex["auth_status"], "ready");
    assert!(codex["auth_hint"].is_null());
    assert!(codex["connection"]["api_key_env"].is_null());

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn create_session_request_deserializes_optional_ssh_host() {
    let with_host: CreateSessionRequest = serde_json::from_str(
            r#"{"ssh_host":"build-box","backend":"together-chat","api_key_env":"TOGETHER_CUSTOM_KEY","extra_headers":"{\"X-Launch\":\"yes\"}"}"#,
        )
        .unwrap();
    assert_eq!(with_host.ssh_host.as_deref(), Some("build-box"));
    assert_eq!(with_host.behavior, sessions::SessionBehavior::Direct);
    assert_eq!(
        with_host.backend,
        RequestField::Value("together-chat".to_string())
    );
    assert_eq!(
        with_host.api_key_env,
        RequestField::Value("TOGETHER_CUSTOM_KEY".to_string())
    );
    assert_eq!(
        with_host.extra_headers,
        RequestField::Value(HeadersRequest(BTreeMap::from([(
            "X-Launch".to_string(),
            "yes".to_string()
        )])))
    );

    let alias_host: CreateSessionRequest =
        serde_json::from_str(r#"{"host_id":"legacy-box"}"#).unwrap();
    assert_eq!(alias_host.ssh_host.as_deref(), Some("legacy-box"));
    assert_eq!(with_host.cwd, None);
    assert!(!with_host.sandbox.enabled);

    let without_host: CreateSessionRequest =
        serde_json::from_str(r#"{"cwd":"/tmp/project"}"#).unwrap();
    assert_eq!(without_host.ssh_host, None);
    assert_eq!(without_host.cwd, Some(PathBuf::from("/tmp/project")));

    let direct: CreateSessionRequest = serde_json::from_str(r#"{"behavior":"direct"}"#).unwrap();
    assert_eq!(direct.behavior, sessions::SessionBehavior::Direct);
    assert!(
        serde_json::from_str::<CreateSessionRequest>(r#"{"behavior":"future-behavior"}"#).is_err()
    );
}

#[tokio::test]
async fn create_session_rejects_ssh_host_combined_with_sandbox() {
    let root = temp_root("host_sandbox_conflict");
    let manager = test_manager(&root);

    let request = CreateSessionRequest {
        behavior: sessions::SessionBehavior::Direct,
        first_chat: false,
        first_chat_same_behavior: false,
        project_id: None,
        cwd: None,
        model: RequestField::Omitted,
        base_url: RequestField::Omitted,
        allow_insecure_http: RequestField::Omitted,
        backend: RequestField::Omitted,
        reasoning_effort: RequestField::Omitted,
        api_key_env: RequestField::Omitted,
        extra_headers: RequestField::Omitted,
        orchestrator_compaction_threshold: RequestField::Omitted,
        ssh_host: Some("build-box".to_string()),
        ssh_port: None,
        ssh_identity_file: None,
        sandbox: SandboxRequest {
            enabled: true,
            ..SandboxRequest::default()
        },
    };
    let error = manager.create_session(request).await.unwrap_err();
    assert!(error.to_string().contains("ssh_host and sandbox"));
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn server_create_rejects_removed_backend_names_as_bad_requests() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("removed_backend_create");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);

    for backend in ["arcee", "auto"] {
        let error = manager
            .create_session(CreateSessionRequest {
                behavior: sessions::SessionBehavior::Direct,
                first_chat: false,
                first_chat_same_behavior: false,
                project_id: None,
                cwd: None,
                model: RequestField::Omitted,
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                allow_insecure_http: RequestField::Omitted,
                backend: RequestField::Value(backend.to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                sandbox: SandboxRequest::default(),
            })
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("unsupported backend"),
            "{error:#}"
        );
        assert!(
            error.to_string().contains("settings repair required"),
            "{error:#}"
        );
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }
    assert!(!root.join("store.db").exists());
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn stored_arcee_auth_config_errors_are_400_and_store_failures_are_500() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

    {
        let root = temp_root("arcee_malformed_auth_status");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        write_managed_credential(&nac_home.join("arcee_auth.json"), "{not-json}");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    allow_insecure_http: RequestField::Omitted,
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        let response = ApiError::from(error);
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert!(response
            .message
            .contains("failed to parse stored Arcee auth"));
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("arcee_unsafe_auth_permissions");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        std::fs::set_permissions(
            nac_home.join("arcee_auth.json"),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    allow_insecure_http: RequestField::Omitted,
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("unsafe permissions 0644"));
        assert!(!format!("{error:#}").contains("arcee-access-server-test"));
        let response = ApiError::from(error);
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert!(response.message.contains("mode to 0600"));
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        let _ = std::fs::remove_dir_all(&root);
    }

    {
        let root = temp_root("arcee_auth_store_failure_status");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(nac_home.join("arcee_auth.json")).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    allow_insecure_http: RequestField::Omitted,
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
        assert!(format!("{error:#}").contains("non-regular credential path"));
        let response = ApiError::from(error);
        assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(response.message, "failed to load stored Arcee credentials");
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[tokio::test]
async fn provider_connection_is_model_independent_and_keeps_secret_private() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("provider_connection");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let rejected = post_json(
        app.clone(),
        "/provider-connections",
        serde_json::json!({
            "backend": "openai-responses", "base_url": "http://example.invalid/v1",
            "api_key": "private-fake-api-key"
        }),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let response = post_json(
        app.clone(),
        "/provider-connections",
        serde_json::json!({
            "backend": "openai-responses", "base_url": "https://example.invalid/v1",
            "api_key": "private-fake-api-key"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    assert!(body
        .get("connection_id")
        .and_then(serde_json::Value::as_str)
        .is_some());
    assert!(!body.to_string().contains("private-fake-api-key"));
    let conn = rusqlite::Connection::open(root.join("store.db")).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='model_configurations'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
    drop(conn);
    let listing = nac_core::store::spawn_blocking_store_caller(move || {
        Ok::<_, anyhow::Error>(manager.model_catalog().listing())
    })
    .await
    .unwrap()
    .unwrap();
    let provider = listing
        .providers
        .iter()
        .find(|p| p.id == BackendKind::OpenAiResponses)
        .unwrap();
    let connection = provider.connection.as_ref().unwrap();
    assert_eq!(connection.base_url, "https://example.invalid/v1");
    assert!(!connection.allow_insecure_http);
    let selector = connection.api_key_env.as_deref().unwrap();
    assert_eq!(
        nac_core::model::resolve_backend_api_key(BackendKind::OpenAiResponses, Some(selector))
            .unwrap(),
        "private-fake-api-key"
    );
    assert!(!serde_json::to_string(&listing)
        .unwrap()
        .contains("private-fake-api-key"));
    let _ = std::fs::remove_dir_all(root);
}
