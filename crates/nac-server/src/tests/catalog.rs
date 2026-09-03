use super::*;

#[test]
fn launch_defaults_reload_config_after_manager_boot() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("launch_defaults_reload");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let request = || LaunchModelDefaultsRequest {
        cwd: Some(root.clone()),
        ssh_host: None,
        ssh_port: None,
        ssh_identity_file: None,
    };

    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"trinity-large-thinking\"\n",
    )
    .unwrap();
    let arcee_defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(
        arcee_defaults.configured_model.as_deref(),
        Some("trinity-large-thinking")
    );

    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"gpt-5.6-sol\"\nreasoning_effort = \"high\"\n",
    )
    .unwrap();
    let defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(defaults.configured_model.as_deref(), Some("gpt-5.6-sol"));
    assert_eq!(
        defaults.configured_reasoning_effort,
        Some(ReasoningEffort::High)
    );
    let serialized_defaults = serde_json::to_value(defaults).unwrap();
    assert_eq!(serialized_defaults["configured_model"], "gpt-5.6-sol");
    assert_eq!(serialized_defaults["configured_reasoning_effort"], "high");
    assert!(
        serde_json::to_value(manager.store_info())
            .unwrap()
            .get("configured_model")
            .is_none(),
        "root-only launch metadata must not remain on /store"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn launch_defaults_use_local_cwd_but_server_root_for_ssh_with_relative_config_homes() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

    for config_home_kind in ["NAC_HOME", "XDG_CONFIG_HOME", "HOME"] {
        let root = temp_root(&format!("launch_defaults_{config_home_kind}"));
        let workspace_a = root.join("workspace-a");
        let workspace_b = root.join("workspace-b");
        std::fs::create_dir_all(&workspace_a).unwrap();
        std::fs::create_dir_all(&workspace_b).unwrap();
        let relative_home = std::path::Path::new("relative-config-home");
        let _env = match config_home_kind {
            "NAC_HOME" => ScopedModelEnv::with_config_home(Some(relative_home), None, None, None),
            "XDG_CONFIG_HOME" => {
                ScopedModelEnv::with_config_home(None, Some(relative_home), None, None)
            }
            "HOME" => ScopedModelEnv::with_config_home(None, None, Some(relative_home), None),
            _ => unreachable!(),
        };
        let config_dir = |cwd: &std::path::Path| match config_home_kind {
            "NAC_HOME" => cwd.join(relative_home),
            "XDG_CONFIG_HOME" => cwd.join(relative_home).join("nac"),
            "HOME" => cwd.join(relative_home).join(".config").join("nac"),
            _ => unreachable!(),
        };
        for (cwd, model) in [
            (&root, "gpt-5.2"),
            (&workspace_a, "trinity-large-thinking"),
            (&workspace_b, "gpt-5.6-sol"),
        ] {
            let dir = config_dir(cwd);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("config.toml"),
                format!("[model]\nmodel = \"{model}\"\n"),
            )
            .unwrap();
        }
        let manager = test_manager(&root);

        assert_eq!(
            manager
                .launch_model_defaults(LaunchModelDefaultsRequest {
                    cwd: Some(workspace_a.clone()),
                    ssh_host: None,
                    ssh_port: None,
                    ssh_identity_file: None,
                })
                .unwrap()
                .configured_model
                .as_deref(),
            Some("trinity-large-thinking"),
            "{config_home_kind} local workspace A"
        );
        assert_eq!(
            manager
                .launch_model_defaults(LaunchModelDefaultsRequest {
                    cwd: Some(workspace_b.clone()),
                    ssh_host: None,
                    ssh_port: None,
                    ssh_identity_file: None,
                })
                .unwrap()
                .configured_model
                .as_deref(),
            Some("gpt-5.6-sol"),
            "{config_home_kind} local workspace B"
        );
        assert_eq!(
            manager
                .launch_model_defaults(LaunchModelDefaultsRequest {
                    cwd: Some(std::path::PathBuf::from("remote/project")),
                    ssh_host: Some(" build-box ".to_string()),
                    ssh_port: None,
                    ssh_identity_file: None,
                })
                .unwrap()
                .configured_model
                .as_deref(),
            Some("gpt-5.2"),
            "{config_home_kind} SSH must use the server root"
        );

        let _ = std::fs::remove_dir_all(root);
    }
}

#[test]
fn launch_defaults_carry_the_configured_model_and_effort() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("launch_defaults_model_effort");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let request = || LaunchModelDefaultsRequest {
        cwd: Some(root.clone()),
        ssh_host: None,
        ssh_port: None,
        ssh_identity_file: None,
    };

    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"gpt-5.2\"\nreasoning_effort = \"high\"\n",
    )
    .unwrap();
    let defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(defaults.configured_model.as_deref(), Some("gpt-5.2"));
    assert_eq!(
        defaults.configured_reasoning_effort,
        Some(ReasoningEffort::High)
    );
    let serialized = serde_json::to_value(defaults).unwrap();
    assert_eq!(serialized["configured_model"], "gpt-5.2");
    assert_eq!(serialized["configured_reasoning_effort"], "high");

    // Without a configured model/effort the fields serialize as null
    // (older frontends ignore them either way).
    std::fs::write(nac_home.join("config.toml"), "[model]\n").unwrap();
    let defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(defaults.configured_model, None);
    assert_eq!(defaults.configured_reasoning_effort, None);
    let serialized = serde_json::to_value(defaults).unwrap();
    assert!(serialized["configured_model"].is_null());
    assert!(serialized["configured_reasoning_effort"].is_null());
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
    assert_eq!(
        response_json(response).await,
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
    std::fs::remove_dir_all(&skills).unwrap();
    let empty = manager.create_session(request).await.unwrap();
    let empty_id = empty.metadata.session_id.unwrap();

    let response = get_response(app.clone(), &format!("/sessions/{empty_id}/skills"), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await, serde_json::json!([]));

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
    assert_eq!(providers.len(), 8);
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

    // Catalog endpoint defaults: present for the five models.dev
    // providers and the hand-seeded arcee-api (exact values are pinned
    // hermetically in nac-core; a machine overlay could carry a
    // refreshed models.dev `api`), absent for the managed providers.
    for id in [
        "anthropic-messages",
        "deepseek-chat",
        "fireworks-chat",
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
    let app = router(test_manager(&root));

    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

    // Conventional var unset + no configured selector: no_credential
    // with the conventional name as the hint.
    assert_eq!(by_id("openai-responses")["auth_status"], "no_credential");
    assert_eq!(by_id("openai-responses")["auth_hint"], "OPENAI_API_KEY");
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

    // The conventional variable naming a set value reads ready — the
    // same variable session resolution auto-selects. Unrelated
    // providers still report only their conventional credential hint.
    unsafe { std::env::set_var("OPENAI_API_KEY", "server-test-key") };
    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();
    assert_eq!(by_id("openai-responses")["auth_status"], "ready");
    assert!(by_id("openai-responses")["auth_hint"].is_null());
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

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn create_session_request_deserializes_optional_ssh_host() {
    let with_host: CreateSessionRequest = serde_json::from_str(
            r#"{"ssh_host":"build-box","backend":"together-chat","api_key_env":"TOGETHER_CUSTOM_KEY","extra_headers":"{\"X-Launch\":\"yes\"}"}"#,
        )
        .unwrap();
    assert_eq!(with_host.ssh_host.as_deref(), Some("build-box"));
    assert_eq!(with_host.behavior, sessions::SessionBehavior::Orchestrator);
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
        behavior: sessions::SessionBehavior::Orchestrator,
        first_chat: false,
        project_id: None,
        cwd: None,
        model: RequestField::Omitted,
        base_url: RequestField::Omitted,
        backend: RequestField::Omitted,
        reasoning_effort: RequestField::Omitted,
        api_key_env: RequestField::Omitted,
        extra_headers: RequestField::Omitted,
        orchestrator_compaction_threshold: RequestField::Omitted,
        light_model: RequestField::Omitted,
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
                behavior: sessions::SessionBehavior::Orchestrator,
                first_chat: false,
                project_id: None,
                cwd: None,
                model: RequestField::Omitted,
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                backend: RequestField::Value(backend.to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
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
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
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
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
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
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
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
