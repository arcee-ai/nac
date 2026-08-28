use super::*;

#[cfg(unix)]
#[test]
fn explicitly_selected_config_is_read_only_even_when_named_config_toml() {
    use std::os::unix::fs::PermissionsExt;

    let path = temp_store_path("explicit_read_only_config")
        .parent()
        .unwrap()
        .join("config.toml");
    let parent = path.parent().unwrap();
    std::fs::create_dir_all(parent).unwrap();
    std::fs::write(&path, "[model]\nmodel = \"selected-model\"\n").unwrap();
    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o500)).unwrap();

    let config = NacConfig::load_from_file(&path).expect("explicit config should be read-only");
    assert_eq!(config.model.model.as_deref(), Some("selected-model"));
    assert!(
        !path.with_extension("toml.lock").exists(),
        "an explicit import must not create the ambient MCP lock sidecar"
    );

    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::remove_dir_all(parent).unwrap();
}

async fn create_and_resume_effort_snapshot(
    store_path: &Path,
    root: &Path,
    key_name: &str,
    session_id: &str,
    backend: BackendKind,
    model: &str,
    stored_effort: ReasoningEffort,
) -> SessionSnapshot {
    let base_url = match backend {
        BackendKind::TogetherChat => "https://api.together.xyz/v1",
        BackendKind::AnthropicMessages => "https://api.anthropic.com/v1",
        BackendKind::ArceeApi => "https://api.arcee.ai/api/v1",
        _ => unreachable!(),
    };
    let snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        model.to_string(),
        base_url.to_string(),
        backend,
        Some(stored_effort),
        None,
        None,
        Vec::new(),
        Some(key_name.to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(store_path, &snapshot).unwrap();
    build_resume_config_for_session(
        store_path.to_path_buf(),
        session_id,
        &NacConfig::default(),
        root.to_path_buf(),
        None,
    )
    .await
    .unwrap()
    .session
    .into_snapshot()
    .unwrap()
}

#[tokio::test]
async fn direct_behavior_builds_and_resumes_a_persistent_direct_primary() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe { std::env::set_var("OPENAI_API_KEY", "test_dummy_key") };
    let store_path = temp_store_path("direct_primary");
    let root = store_path.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&root).unwrap();

    let created = build_run_config_for_project_with_behavior(
        RunOptions {
            workspace_cwd: root.clone(),
            config_cwd: Some(root.clone()),
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            orchestrator_compaction_threshold: Some(32_000),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions::default(),
        },
        &NacConfig::default(),
        None,
        sessions::SessionBehavior::Direct,
    )
    .await
    .unwrap();
    let session_id = created.session.session_id().unwrap().to_string();
    let tool_names = created
        .agent
        .tool_definitions_for_test()
        .iter()
        .map(|definition| definition.function.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(tool_names, crate::tools::DIRECT_TOOL_NAMES);
    assert!(matches!(
        created.agent.messages.first(),
        Some(Message::System { content })
            if content.contains("persistent coding agent")
                && !content.contains("coding agent orchestrator")
    ));
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(stored.behavior, sessions::SessionBehavior::Direct);
    drop(created);

    let resumed = build_resume_config_for_session(
        store_path.clone(),
        &session_id,
        &NacConfig::default(),
        root.clone(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        resumed.session.behavior(),
        sessions::SessionBehavior::Direct
    );
    assert_eq!(
        resumed
            .agent
            .tool_definitions_for_test()
            .iter()
            .map(|definition| definition.function.name.as_str())
            .collect::<Vec<_>>(),
        crate::tools::DIRECT_TOOL_NAMES
    );

    let delegating = build_run_config_for_project_with_behavior(
        RunOptions {
            workspace_cwd: root.clone(),
            config_cwd: Some(root.clone()),
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            orchestrator_compaction_threshold: Some(32_000),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions::default(),
        },
        &NacConfig::default(),
        None,
        sessions::SessionBehavior::DirectWithOrchestrator,
    )
    .await
    .unwrap();
    assert_eq!(
        delegating
            .agent
            .tool_definitions_for_test()
            .iter()
            .map(|definition| definition.function.name.as_str())
            .collect::<Vec<_>>(),
        crate::tools::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES
    );
    assert!(matches!(
        delegating.agent.messages.first(),
        Some(Message::System { content })
            if content.contains("separate durable NAC orchestrator sessions")
    ));

    let _ = std::fs::remove_dir_all(root);
    restore_env("OPENAI_API_KEY", original_api_key);
}

#[test]
fn compaction_threshold_defaults_to_70pct_context_normalizes_zero_and_rejects_out_of_range_values()
{
    // No request: defaults to 70% of the context window (rounded).
    assert_eq!(
        effective_orchestrator_compaction_threshold(None, 200_000).unwrap(),
        Some(140_000)
    );
    // Explicit request wins over the 0.7×context default.
    assert_eq!(
        effective_orchestrator_compaction_threshold(Some(12_000), 200_000).unwrap(),
        Some(12_000)
    );
    // Some(0) explicitly disables compaction regardless of context window.
    assert_eq!(
        effective_orchestrator_compaction_threshold(Some(0), 200_000).unwrap(),
        None
    );
    // The boundary value is accepted.
    assert_eq!(
        effective_orchestrator_compaction_threshold(
            Some(crate::MAX_SUPPORTED_TOKEN_COUNT),
            200_000,
        )
        .unwrap(),
        Some(crate::MAX_SUPPORTED_TOKEN_COUNT)
    );
    // Above the boundary is rejected.
    assert!(effective_orchestrator_compaction_threshold(
        Some(crate::MAX_SUPPORTED_TOKEN_COUNT + 1),
        200_000,
    )
    .is_err());

    // The `[compaction]` section is no longer consulted: a config that
    // has one produces the same result as one without.
    let config_with_compaction: NacConfig =
        toml::from_str("[compaction]\nthreshold_tokens = 64000\n").unwrap();
    assert_eq!(
        effective_orchestrator_compaction_threshold(None, 200_000).unwrap(),
        Some(140_000)
    );
    // The field still parses (backward compat) but is dead.
    assert_eq!(
        config_with_compaction.compaction.threshold_tokens,
        Some(64_000)
    );

    // NonModelNacConfig still omits compaction entirely.
    let worker_config: NacConfig =
        toml::from_str::<NonModelNacConfig>("[compaction]\nthreshold_tokens = 64000\n")
            .unwrap()
            .into();
    assert_eq!(worker_config.compaction.threshold_tokens, None);
}

#[test]
fn effective_model_settings_ignore_ambient_model_and_base() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_base_url = std::env::var_os("OPENAI_BASE_URL");
    let original_model = std::env::var_os("OPENAI_MODEL");
    unsafe {
        std::env::set_var("OPENAI_BASE_URL", "https://ambient.example/v1");
        std::env::set_var("OPENAI_MODEL", "ambient-model");
    }

    let settings =
        effective_model_settings(&ModelOptions::default(), &complete_model_config()).unwrap();
    assert_eq!(settings.base_url, "https://api.openai.com/v1");
    assert_eq!(settings.model, "gpt-5.2");

    restore_env("OPENAI_BASE_URL", original_base_url);
    restore_env("OPENAI_MODEL", original_model);
}

#[test]
fn explicit_model_settings_beat_config_and_config_supplies_omissions() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_openai_key = std::env::var_os("OPENAI_API_KEY");
    unsafe { std::env::remove_var("OPENAI_API_KEY") };

    let mut config = complete_model_config();
    config.model.reasoning_effort = Some(ReasoningEffort::High);
    config
        .model
        .extra_headers
        .insert("X-Config".to_string(), "config".to_string());

    let inherited = effective_model_settings(&ModelOptions::default(), &config).unwrap();
    assert_eq!(inherited.backend, BackendKind::OpenAiResponses);
    assert_eq!(inherited.model, "gpt-5.2");
    assert_eq!(inherited.base_url, "https://api.openai.com/v1");
    assert_eq!(inherited.reasoning_effort, Some(ReasoningEffort::High));
    assert_eq!(inherited.api_key_env, None);
    assert_eq!(
        inherited.extra_headers.get("X-Config").map(String::as_str),
        Some("config")
    );

    let headers = BTreeMap::from([("X-Explicit".to_string(), "explicit".to_string())]);
    let explicit = effective_model_settings(
        &ModelOptions {
            backend: Some(BackendKind::TogetherChat),
            reasoning_effort: OptionalModelOption::Value(ReasoningEffort::Low),
            api_base_url: Some(" https://explicit.example/v1 ".to_string()),
            api_model: Some(" explicit-model ".to_string()),
            api_key_env: OptionalModelOption::Value("EXPLICIT_API_KEY".to_string()),
            extra_headers: Some(headers.clone()),
            light_model: None,
        },
        &config,
    )
    .unwrap();
    assert_eq!(explicit.backend, BackendKind::TogetherChat);
    assert_eq!(explicit.model, "explicit-model");
    assert_eq!(explicit.base_url, "https://explicit.example/v1");
    assert_eq!(explicit.reasoning_effort, Some(ReasoningEffort::Low));
    assert_eq!(explicit.api_key_env.as_deref(), Some("EXPLICIT_API_KEY"));
    assert_eq!(explicit.extra_headers, headers);

    restore_env("OPENAI_API_KEY", original_openai_key);
}

#[test]
fn managed_backends_materialize_base_after_explicit_over_config_resolution() {
    // A configured model id that collides with a managed provider's
    // entries resolves to the non-managed provider (the codex seed ids
    // all overlap the openai baseline), so managed backends are
    // reachable only through an explicit selection.
    let mut colliding_config = NacConfig::default();
    colliding_config.model.model = Some("gpt-5.3-codex-spark".to_string());
    let resolved = effective_model_settings(&ModelOptions::default(), &colliding_config)
        .expect("a colliding configured model resolves the non-managed provider");
    assert_eq!(resolved.backend, BackendKind::OpenAiResponses);
    assert_eq!(resolved.base_url, "https://api.openai.com/v1");

    for (backend, expected) in [
        (
            BackendKind::ChatGptCodexResponses,
            crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
        ),
        (
            BackendKind::ArceeAuth,
            crate::model::ARCEE_AUTH_CANONICAL_BASE_URL,
        ),
    ] {
        let mut explicit_config = NacConfig::default();
        explicit_config.model.model = Some("managed-model".to_string());
        let explicit = effective_model_settings(
            &ModelOptions {
                backend: Some(backend),
                api_model: Some(if backend == BackendKind::ArceeAuth {
                    "trinity-large-thinking".to_string()
                } else {
                    "managed-model".to_string()
                }),
                ..ModelOptions::default()
            },
            &explicit_config,
        )
        .expect("an explicit managed backend should materialize after merge");
        assert_eq!(explicit.base_url, expected);
    }
}

#[test]
fn openai_to_managed_launch_normalizes_omitted_url_and_credentials() {
    let config = complete_model_config();

    for (backend, expected_base_url) in [
        (
            BackendKind::ChatGptCodexResponses,
            crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
        ),
        (
            BackendKind::ArceeAuth,
            crate::model::ARCEE_AUTH_CANONICAL_BASE_URL,
        ),
    ] {
        let settings = effective_model_settings(
            &ModelOptions {
                backend: Some(backend),
                api_model: Some("managed-model".to_string()),
                ..ModelOptions::default()
            },
            &config,
        )
        .expect("managed selection must not inherit the OpenAI tuple");
        assert_eq!(settings.backend, backend);
        assert_eq!(settings.base_url, expected_base_url);
        assert_eq!(settings.api_key_env, None);

        let explicit = effective_model_settings(
            &ModelOptions {
                backend: Some(backend),
                api_model: Some("managed-model".to_string()),
                api_base_url: Some("https://explicit.example/v1".to_string()),
                api_key_env: OptionalModelOption::Value("EXPLICIT_KEY".to_string()),
                ..ModelOptions::default()
            },
            &config,
        )
        .expect("explicit values must survive merge for validation");
        assert_eq!(explicit.base_url, "https://explicit.example/v1");
        assert_eq!(explicit.api_key_env.as_deref(), Some("EXPLICIT_KEY"));
    }
}

#[test]
fn optional_model_overrides_distinguish_inherit_value_and_clear() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_openai_key = std::env::var_os("OPENAI_API_KEY");
    unsafe { std::env::remove_var("OPENAI_API_KEY") };

    let mut config = complete_model_config();
    config.model.reasoning_effort = Some(ReasoningEffort::High);

    let inherited = effective_model_settings(&ModelOptions::default(), &config).unwrap();
    assert_eq!(inherited.api_key_env, None);
    assert_eq!(inherited.reasoning_effort, Some(ReasoningEffort::High));

    let valued = effective_model_settings(
        &ModelOptions {
            api_key_env: OptionalModelOption::Value("CLI_API_KEY".to_string()),
            reasoning_effort: OptionalModelOption::Value(ReasoningEffort::None),
            ..ModelOptions::default()
        },
        &config,
    )
    .unwrap();
    assert_eq!(valued.api_key_env.as_deref(), Some("CLI_API_KEY"));
    assert_eq!(valued.reasoning_effort, Some(ReasoningEffort::None));

    let cleared = effective_model_settings(
        &ModelOptions {
            api_key_env: OptionalModelOption::Clear,
            reasoning_effort: OptionalModelOption::Clear,
            ..ModelOptions::default()
        },
        &config,
    )
    .unwrap();
    assert_eq!(cleared.api_key_env, None);
    assert_eq!(cleared.reasoning_effort, None);

    // With the conventional variable set, Inherit and Clear both fall
    // through to auto-selection; an explicit Value always wins.
    unsafe { std::env::set_var("OPENAI_API_KEY", "env-key") };
    let auto_selected = effective_model_settings(&ModelOptions::default(), &config).unwrap();
    assert_eq!(auto_selected.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    let cleared = effective_model_settings(
        &ModelOptions {
            api_key_env: OptionalModelOption::Clear,
            ..ModelOptions::default()
        },
        &config,
    )
    .unwrap();
    assert_eq!(cleared.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    let valued = effective_model_settings(
        &ModelOptions {
            api_key_env: OptionalModelOption::Value("CLI_API_KEY".to_string()),
            ..ModelOptions::default()
        },
        &config,
    )
    .unwrap();
    assert_eq!(valued.api_key_env.as_deref(), Some("CLI_API_KEY"));

    restore_env("OPENAI_API_KEY", original_openai_key);
}

#[test]
fn api_key_selectors_are_preserved_for_api_backends_and_normalized_for_managed_auth() {
    for selector in ["", "   ", " SURROUNDED_KEY "] {
        let settings = effective_model_settings(
            &ModelOptions {
                api_key_env: OptionalModelOption::Value(selector.to_string()),
                ..ModelOptions::default()
            },
            &complete_model_config(),
        )
        .unwrap();
        assert_eq!(settings.api_key_env.as_deref(), Some(selector));
        let error = ModelClient::from_effective_settings(settings)
            .expect_err("invalid configured selector must not be normalized or ignored");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("api_key_env"), "{error:#}");
    }

    // A managed backend never auto-selects and rejects any explicit
    // selector at validation.
    let settings = effective_model_settings(
        &ModelOptions {
            backend: Some(BackendKind::ArceeAuth),
            api_model: Some("trinity-large-thinking".to_string()),
            ..ModelOptions::default()
        },
        &NacConfig::default(),
    )
    .unwrap();
    assert_eq!(settings.api_key_env, None);
}

#[test]
fn required_model_settings_are_rejected_without_defaults() {
    // No configured or requested model: no id to resolve a backend
    // from. An unknown configured model id fails the same way.
    for config in [NacConfig::default(), {
        let mut config = NacConfig::default();
        config.model.model = Some("never-seen-model".to_string());
        config
    }] {
        let error = effective_model_settings(&ModelOptions::default(), &config).unwrap_err();
        assert!(error.to_string().contains("backend"), "{error:#}");
    }

    // An explicit backend with no model id anywhere fails on the model.
    let error = effective_model_settings(
        &ModelOptions {
            backend: Some(BackendKind::OpenAiResponses),
            ..ModelOptions::default()
        },
        &NacConfig::default(),
    )
    .unwrap_err();
    assert!(error.to_string().contains("model"), "{error:#}");
}

#[test]
fn no_reasoning_effort_is_injected() {
    let settings =
        effective_model_settings(&ModelOptions::default(), &complete_model_config()).unwrap();
    assert_eq!(settings.reasoning_effort, None);
}

#[test]
fn managed_worker_settings_are_snapshot_authoritative() {
    let settings = managed_worker_effective_model_settings(&ModelOptions {
        backend: Some(BackendKind::TogetherChat),
        api_base_url: Some("https://worker.example/v1".to_string()),
        api_model: Some("worker-model".to_string()),
        api_key_env: OptionalModelOption::Value("SESSION_API_KEY".to_string()),
        extra_headers: Some(BTreeMap::new()),
        ..ModelOptions::default()
    })
    .unwrap();
    assert_eq!(settings.reasoning_effort, None);
    assert_eq!(settings.api_key_env.as_deref(), Some("SESSION_API_KEY"));
    assert!(settings.extra_headers.is_empty());

    for (backend, expected) in [
        (
            BackendKind::ChatGptCodexResponses,
            crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
        ),
        (
            BackendKind::ArceeAuth,
            crate::model::ARCEE_AUTH_CANONICAL_BASE_URL,
        ),
    ] {
        let managed = managed_worker_effective_model_settings(&ModelOptions {
            backend: Some(backend),
            api_model: Some("managed-worker-model".to_string()),
            extra_headers: Some(BTreeMap::new()),
            ..ModelOptions::default()
        })
        .expect("managed worker resolver should use the same fixed URL invariant");
        assert_eq!(managed.base_url, expected);
    }

    let raw_selector = " WORKER_KEY ";
    let invalid = managed_worker_effective_model_settings(&ModelOptions {
        backend: Some(BackendKind::TogetherChat),
        api_base_url: Some("https://worker.example/v1".to_string()),
        api_model: Some("worker-model".to_string()),
        api_key_env: OptionalModelOption::Value(raw_selector.to_string()),
        extra_headers: Some(BTreeMap::new()),
        ..ModelOptions::default()
    })
    .unwrap();
    assert_eq!(invalid.api_key_env.as_deref(), Some(raw_selector));
    let error = ModelClient::from_effective_settings(invalid)
        .expect_err("worker selector must be validated without normalization");
    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());

    let error = managed_worker_effective_model_settings(&ModelOptions {
        backend: Some(BackendKind::TogetherChat),
        ..ModelOptions::default()
    })
    .unwrap_err();
    assert!(error.to_string().contains("model"));
}

#[tokio::test]
async fn resume_picker_defers_snapshot_and_credential_validation_until_selection() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let key_name = "NAC_MISSING_PICKER_SELECTION_KEY";
    let original = std::env::var_os(key_name);
    unsafe { std::env::remove_var(key_name) };

    let root = temp_store_path("credential_free_picker")
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("sessions.db");
    store::initialize(&store_path).unwrap();
    sessions::create_session(
        &store_path,
        &sessions::new_snapshot(
            "picker-session".to_string(),
            root.clone(),
            "snapshot-model".to_string(),
            "https://snapshot.example/v1".to_string(),
            BackendKind::TogetherChat,
            None,
            None,
            None,
            Vec::new(),
            Some(key_name.to_string()),
            BTreeMap::new(),
        ),
    )
    .unwrap();

    let picker = build_resume_picker_config(
        ResumeOptions {
            lookup_cwd: root.clone(),
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            ..ResumeOptions::default()
        },
        &NacConfig::default(),
    )
    .await
    .expect("picker startup must not resolve model settings or credentials");
    assert_eq!(picker.store_path, store_path);
    assert_eq!(
        sessions::list_sessions(&picker.store_path).unwrap().len(),
        1
    );

    let error = match build_resume_config_for_session(
        picker.store_path,
        "picker-session",
        &NacConfig::default(),
        picker.lookup_cwd,
        None,
    )
    .await
    {
        Ok(_) => panic!("selecting a session with a missing credential must fail"),
        Err(error) => error,
    };
    assert!(error.to_string().contains(key_name), "{error:#}");

    match original {
        Some(value) => unsafe { std::env::set_var(key_name, value) },
        None => unsafe { std::env::remove_var(key_name) },
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn resume_picker_and_selection_perform_no_network() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = crate::model::test_http::ScriptedServer::start_unexpected_request_server(
        std::time::Duration::from_millis(300),
    );
    let original_url = std::env::var_os("MODELS_DEV_URL");
    unsafe { std::env::set_var("MODELS_DEV_URL", &server.base_url) };
    let key_name = "NAC_MISSING_NETWORK_FREE_PICKER_KEY";
    let original_key = std::env::var_os(key_name);
    unsafe { std::env::remove_var(key_name) };

    let root = temp_store_path("network_free_picker")
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("sessions.db");
    store::initialize(&store_path).unwrap();
    sessions::create_session(
        &store_path,
        &sessions::new_snapshot(
            "network-free-session".to_string(),
            root.clone(),
            "snapshot-model".to_string(),
            "https://snapshot.example/v1".to_string(),
            BackendKind::TogetherChat,
            None,
            None,
            None,
            Vec::new(),
            Some(key_name.to_string()),
            BTreeMap::new(),
        ),
    )
    .unwrap();

    let picker = build_resume_picker_config(
        ResumeOptions {
            lookup_cwd: root.clone(),
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            ..ResumeOptions::default()
        },
        &NacConfig::default(),
    )
    .await
    .expect("picker startup must not touch the network");
    // The selection path resolves model settings and catalog metadata
    // locally (it fails on the missing credential, never on network).
    let error = match build_resume_config_for_session(
        picker.store_path,
        "network-free-session",
        &NacConfig::default(),
        picker.lookup_cwd,
        None,
    )
    .await
    {
        Ok(_) => panic!("selection without a credential must fail locally"),
        Err(error) => error,
    };
    assert!(error.to_string().contains(key_name), "{error:#}");

    match original_url {
        Some(value) => unsafe { std::env::set_var("MODELS_DEV_URL", value) },
        None => unsafe { std::env::remove_var("MODELS_DEV_URL") },
    }
    match original_key {
        Some(value) => unsafe { std::env::set_var(key_name, value) },
        None => unsafe { std::env::remove_var(key_name) },
    }
    let _ = std::fs::remove_dir_all(root);
    let requests = server.finish();
    assert!(
        requests.is_empty(),
        "resume/picker paths must not touch the network: {requests:?}"
    );
}

#[test]
fn parse_extra_headers_json_requires_valid_object() {
    assert!(parse_extra_headers_json("").is_err());
    assert_eq!(parse_extra_headers_json("{}").unwrap(), BTreeMap::new());
    let headers = BTreeMap::from([("X-Custom".to_string(), "val".to_string())]);
    assert_eq!(
        parse_extra_headers_json(r#"{"X-Custom":"val"}"#).unwrap(),
        headers
    );
    assert!(parse_extra_headers_json("not json").is_err());
    assert!(parse_extra_headers_json(r#"{"X-Custom":1}"#).is_err());
}

#[tokio::test]
async fn required_model_failures_occur_before_session_persistence() {
    let root = temp_store_path("required_model_before_persist")
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::create_dir_all(&root).unwrap();
    let cases: [(ModelOptions, NacConfig, &str); 3] = [
        (ModelOptions::default(), NacConfig::default(), "backend"),
        (
            ModelOptions::default(),
            {
                let mut config = NacConfig::default();
                config.model.model = Some("never-seen-model".to_string());
                config
            },
            "backend",
        ),
        (
            ModelOptions {
                backend: Some(BackendKind::OpenAiResponses),
                ..ModelOptions::default()
            },
            NacConfig::default(),
            "model",
        ),
    ];

    for (index, (model, config, expected)) in cases.into_iter().enumerate() {
        let store_path = root.join(format!("store-{index}.db"));
        let error = match build_run_config(
            RunOptions {
                workspace_cwd: root.clone(),
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model,
                ..RunOptions::default()
            },
            &config,
        )
        .await
        {
            Ok(_) => panic!("missing {expected} must fail"),
            Err(error) => error,
        };
        assert!(error.to_string().contains(expected), "{error:#}");
        assert!(
            !store_path.exists(),
            "invalid settings created the session store"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn sandbox_image_config_is_default_not_enablement() {
    let mut config = NacConfig::default();
    config.sandbox.image = Some("custom-image".to_string());

    let disabled = effective_sandbox_options(SandboxOptions::default(), &config);
    assert!(!disabled.sandbox_enabled());
    assert!(!disabled.explicit_sandbox_config_flags_present());
    assert_eq!(disabled.sandbox_image(), Some("custom-image"));

    let enabled = effective_sandbox_options(
        SandboxOptions {
            sandbox: true,
            ..SandboxOptions::default()
        },
        &config,
    );
    assert!(enabled.sandbox_enabled());
    assert_eq!(enabled.sandbox_image(), Some("custom-image"));

    let overridden = effective_sandbox_options(
        SandboxOptions {
            sandbox: true,
            sandbox_image: Some("cli-image".to_string()),
            ..SandboxOptions::default()
        },
        &config,
    );
    assert_eq!(overridden.sandbox_image(), Some("cli-image"));
    assert!(overridden.explicit_sandbox_config_flags_present());
}

#[tokio::test]
async fn sandbox_spec_failure_after_fork_rolls_back_the_worktree() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
    let repo = crate::workspace::worktree::test_harness::TestRepo::new("spec-rollback");
    let nac_home = repo.base.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &nac_home);
        std::env::remove_var("XDG_CONFIG_HOME");
    }
    repo.commit_file("a.txt", "a");

    // The fork succeeds, then this mount fails validation: the worktree
    // and its branch must be rolled back rather than orphaned.
    let options = EffectiveSandboxOptions {
        sandbox: true,
        no_mount_cwd: false,
        mounts: vec!["/definitely-missing-nac-test-path:/data".to_string()],
        mounts_ro: Vec::new(),
        internal_mounts: Vec::new(),
        sandbox_image: None,
        sandbox_gpus: Vec::new(),
        sandbox_shm_size: None,
        sandbox_session_key: None,
        sandbox_workdir: None,
        sandbox_backend: SandboxBackendType::Podman,
        sandbox_cpus: 0,
        sandbox_mem: 0,
        sandbox_activity_key: None,
        explicit_sandbox_config_flags_present: false,
    };
    let result = build_sandbox_session(&options, &repo.root).await;

    assert!(
        result.is_err(),
        "a missing mount source must fail the launch"
    );
    let branches = String::from_utf8_lossy(
        &std::process::Command::new("git")
            .arg("-C")
            .arg(&repo.root)
            .args(["branch", "--list", "nac/*"])
            .output()
            .unwrap()
            .stdout,
    )
    .trim()
    .to_string();
    assert_eq!(
        branches, "",
        "the forked worktree branch must be rolled back"
    );
    let worktrees = nac_home.join("worktrees");
    assert!(
        !worktrees.exists() || std::fs::read_dir(&worktrees).unwrap().next().is_none(),
        "the forked worktree directory must be rolled back"
    );

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
}

#[test]
fn worker_timeout_reads_config_default() {
    let mut config = NacConfig::default();
    config.worker.thread_timeout_secs = Some(7_200);
    assert_eq!(worker_thread_timeout_secs(&config), 7_200);

    config.worker.thread_timeout_secs = Some(10);
    assert_eq!(
        worker_thread_timeout_secs(&config),
        crate::tools::thread::MIN_THREAD_TIMEOUT_SECS
    );
}

#[test]
fn worker_command_output_limits_validate_config() {
    let mut config = NacConfig::default();
    let defaults = worker_command_output_limits(&config).unwrap();
    assert_eq!(
        defaults.per_command_bytes,
        crate::terminal::DEFAULT_COMMAND_OUTPUT_MAX_BYTES
    );
    assert_eq!(
        defaults.per_session_bytes,
        crate::terminal::DEFAULT_COMMAND_OUTPUT_SESSION_MAX_BYTES
    );

    config.worker.command_output_max_bytes = Some(1_024);
    config.worker.command_output_session_max_bytes = Some(4_096);
    assert_eq!(
        worker_command_output_limits(&config).unwrap(),
        crate::terminal::CommandOutputLimits {
            per_command_bytes: 1_024,
            per_session_bytes: 4_096,
        }
    );

    config.worker.command_output_session_max_bytes = Some(512);
    assert!(worker_command_output_limits(&config).is_err());
}

#[test]
fn nac_config_loads_new_sections_alongside_existing_mcp() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let root = std::env::temp_dir().join(format!(
        "nac_config_load_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("config.toml"),
        r#"
[storage]
store_path = "custom/store.db"

[model]
model = "config-model"
reasoning_effort = "high"

[sandbox]
image = "config-image"

[worker]
thread_timeout_secs = 7200
command_output_max_bytes = 8388608
command_output_session_max_bytes = 67108864

[mcp_servers.context7]
enabled = true
transport = "streamable_http"
url = "https://mcp.context7.com/mcp"
"#,
    )
    .unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &root);
    }

    let config = NacConfig::load().unwrap();
    assert_eq!(
        config.storage.store_path.as_deref(),
        Some(Path::new("custom/store.db"))
    );
    assert_eq!(config.model.model.as_deref(), Some("config-model"));
    assert_eq!(config.model.reasoning_effort, Some(ReasoningEffort::High));
    assert_eq!(config.sandbox.image.as_deref(), Some("config-image"));
    assert_eq!(config.worker.thread_timeout_secs, Some(7_200));
    assert_eq!(config.worker.command_output_max_bytes, Some(8_388_608));
    assert_eq!(
        config.worker.command_output_session_max_bytes,
        Some(67_108_864)
    );

    restore_env("NAC_HOME", original_nac_home);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn non_model_config_load_ignores_invalid_model_values_but_keeps_other_sections_strict() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let root = std::env::temp_dir().join(format!(
        "nac_non_model_config_load_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &root);
    }

    // Removed `[model]` keys (backend/base_url/api_key_env) are
    // parse-tolerated by the new-session load too — they are ignored
    // with a one-time warning, so only genuinely invalid remaining
    // fields fail.
    let invalid_model_sections = [
        ("[model]\nbackend = \"auto\"\nmodel = \"legacy\"\n", true),
        (
            "[model]\nbackend = \"arcee\"\napi_key_env = [\"NOT_A_SELECTOR\"]\n",
            true,
        ),
        ("model = [\"not\", \"a\", \"table\"]\n", false),
        (
            "[model]\nextra_headers = \"not-a-header-map\"\nreasoning_effort = 7\n",
            false,
        ),
    ];
    for (invalid_model, accepted) in invalid_model_sections {
        std::fs::write(
                root.join("config.toml"),
                format!(
                    "{invalid_model}\n[storage]\nstore_path = \"persisted/store.db\"\n\n[sandbox]\nimage = \"runtime-image\"\n\n[worker]\nthread_timeout_secs = 7200\n\n[[permissions.rules]]\naction = \"execute\"\nresource = \"command:[curl]*\"\neffect = \"deny\"\n"
                ),
            )
            .unwrap();

        let config = NacConfig::load_without_model_from_cwd(&root).unwrap();
        assert_eq!(
            config.storage.store_path.as_deref(),
            Some(Path::new("persisted/store.db"))
        );
        assert_eq!(config.sandbox.image.as_deref(), Some("runtime-image"));
        assert_eq!(config.worker.thread_timeout_secs, Some(7_200));
        assert_eq!(
            config.permissions.rules,
            [crate::permissions::PermissionRule::new(
                "execute",
                "command:[curl]*",
                crate::permissions::PermissionEffect::Deny,
            )]
        );
        assert!(config.model.model.is_none());
        assert_eq!(
            NacConfig::load_from_cwd(&root).is_ok(),
            accepted,
            "new-session config mishandled {invalid_model:?}"
        );
    }

    std::fs::write(
        root.join("config.toml"),
        "[model]\nbackend = \"auto\"\n\n[storage]\nstore_path = [\"invalid\"]\n",
    )
    .unwrap();
    let error = NacConfig::load_without_model_from_cwd(&root).unwrap_err();
    assert!(error.to_string().contains("non-model config"), "{error:#}");

    restore_env("NAC_HOME", original_nac_home);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn removed_model_config_keys_are_ignored_and_resolution_uses_the_catalog() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let original_openai_key = std::env::var_os("OPENAI_API_KEY");
    let root = std::env::temp_dir().join(format!(
        "nac_removed_model_keys_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    // A pre-slimming config: backend/base_url/api_key_env are ignored
    // (with a one-time warning); the kept fields load and the
    // configured model resolves through the catalog.
    std::fs::write(
        root.join("config.toml"),
        r#"
[model]
backend = "fireworks-chat"
model = "gpt-5.2"
base_url = "https://stale.example/v1"
api_key_env = "STALE_KEY"
reasoning_effort = "high"

[model.extra_headers]
X-Config = "yes"
"#,
    )
    .unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &root);
        std::env::set_var("OPENAI_API_KEY", "env-openai-key");
    }

    let config = NacConfig::load().expect("removed keys parse tolerantly");
    assert_eq!(config.model.model.as_deref(), Some("gpt-5.2"));
    assert_eq!(config.model.reasoning_effort, Some(ReasoningEffort::High));
    assert_eq!(
        config
            .model
            .extra_headers
            .get("X-Config")
            .map(String::as_str),
        Some("yes")
    );

    // The stale backend/base_url/api_key_env values play no role:
    // gpt-5.2 resolves to openai-responses, the base URL comes from the
    // catalog default, and the credential auto-selects the conventional
    // variable.
    let settings = effective_model_settings(&ModelOptions::default(), &config).unwrap();
    assert_eq!(settings.backend, BackendKind::OpenAiResponses);
    assert_eq!(settings.base_url, "https://api.openai.com/v1");
    assert_eq!(settings.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert_eq!(settings.reasoning_effort, Some(ReasoningEffort::High));

    restore_env("NAC_HOME", original_nac_home);
    restore_env("OPENAI_API_KEY", original_openai_key);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn nac_config_load_from_cwd_resolves_relative_nac_home_against_explicit_cwd() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let root = std::env::temp_dir().join(format!(
        "nac_config_relative_home_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    let nac_home = root.join("relative-nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        "[storage]\nstore_path = \"from-relative-home.db\"\n",
    )
    .unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", "relative-nac-home");
    }

    let config = NacConfig::load_from_cwd(&root).unwrap();
    assert_eq!(
        config.storage.store_path.as_deref(),
        Some(Path::new("from-relative-home.db"))
    );

    restore_env("NAC_HOME", original_nac_home);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn resolve_store_path_defaults_to_single_global_store_for_any_cwd() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let nac_home = std::env::temp_dir().join(format!(
        "nac_global_store_home_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    std::fs::create_dir_all(&nac_home).unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &nac_home);
    }

    let config = NacConfig::default();
    let from_repo_a = resolve_store_path(Path::new("/repo-a"), StoreOptions::default(), &config);
    let from_repo_b = resolve_store_path(
        Path::new("/repo-b/nested"),
        StoreOptions::default(),
        &config,
    );

    assert_eq!(from_repo_a, nac_home.join("store.db"));
    assert_eq!(
        from_repo_a, from_repo_b,
        "default store must be identical regardless of launch directory"
    );

    restore_env("NAC_HOME", original_nac_home);
    let _ = std::fs::remove_dir_all(nac_home);
}

#[test]
fn resolve_store_path_falls_back_to_workspace_store_without_home() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let original_xdg_config_home = std::env::var_os("XDG_CONFIG_HOME");
    let original_home = std::env::var_os("HOME");
    unsafe {
        std::env::remove_var("NAC_HOME");
        std::env::remove_var("XDG_CONFIG_HOME");
        std::env::remove_var("HOME");
    }

    let resolved = resolve_store_path(
        Path::new("/repo"),
        StoreOptions::default(),
        &NacConfig::default(),
    );
    assert_eq!(resolved, Path::new("/repo/.nac/store.db"));

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg_config_home);
    restore_env("HOME", original_home);
}

#[test]
fn resolve_store_path_overrides_beat_global_default_and_resolve_against_cwd() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = std::env::var_os("NAC_HOME");
    let nac_home = std::env::temp_dir().join(format!(
        "nac_store_override_home_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    unsafe {
        std::env::set_var("NAC_HOME", &nac_home);
    }
    let cwd = Path::new("/workspace/repo");

    let mut config = NacConfig::default();
    config.storage.store_path = Some(PathBuf::from("custom/store.db"));
    assert_eq!(
        resolve_store_path(cwd, StoreOptions::default(), &config),
        Path::new("/workspace/repo/custom/store.db")
    );

    assert_eq!(
        resolve_store_path(
            cwd,
            StoreOptions {
                store_path: Some(PathBuf::from("/elsewhere/store.db")),
            },
            &config,
        ),
        Path::new("/elsewhere/store.db")
    );

    assert_eq!(
        resolve_store_path(
            cwd,
            StoreOptions {
                store_path: Some(PathBuf::from(".nac/store.db")),
            },
            &NacConfig::default(),
        ),
        Path::new("/workspace/repo/.nac/store.db")
    );

    restore_env("NAC_HOME", original_nac_home);
}

#[test]
fn workspace_dir_from_explicit_mount_uses_workspace_guest_mapping() {
    let root = std::env::temp_dir().join(format!(
        "nac_main_test_workspace_mount_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    std::fs::create_dir_all(root.join(".git")).unwrap();

    let mounts = vec![MountSpec {
        host: root.clone(),
        guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
        read_only: false,
    }];

    let resolved = workspace_dir_from_mounts(&mounts, PathBuf::from(DEFAULT_SANDBOX_WORKDIR));
    assert_eq!(resolved.as_deref(), Some(root.as_path()));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn resume_and_delegated_worker_reject_arcee_api_key_env_early() {
    let root = temp_store_path("arcee_api_key_env_paths")
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::create_dir_all(&root).unwrap();
    let expected = "is not supported for backend 'arcee-auth'";

    let snapshot = sessions::new_snapshot(
        "invalid-arcee-resume".to_string(),
        root.clone(),
        "model".to_string(),
        "https://api.arcee.ai".to_string(),
        BackendKind::ArceeAuth,
        None,
        None,
        None,
        Vec::new(),
        Some("SESSION_ARCEE_KEY".to_string()),
        BTreeMap::new(),
    );
    let resume_store = root.join("resume.db");
    let resume_error = match build_resume_config_from_snapshot(
        snapshot,
        resume_store.clone(),
        &NacConfig::default(),
        root.clone(),
        None,
        None,
        true,
        None,
    )
    .await
    {
        Ok(_) => panic!("Arcee session resume must reject api_key_env"),
        Err(error) => error,
    };
    assert!(
        resume_error.to_string().contains(expected),
        "got: {resume_error:#}"
    );
    assert!(
        !resume_store.exists(),
        "invalid resume initialized its store"
    );

    let worker_store = root.join("worker.db");
    let worker_error = match build_managed_worker_config(
        ManagedWorkerOptions {
            workspace_cwd: root.clone(),
            config_cwd: None,
            dispatch: WorkerDispatchOptions {
                session_id: "session".to_string(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "work".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(worker_store.clone()),
            },
            model: ModelOptions {
                backend: Some(BackendKind::ArceeAuth),
                api_base_url: Some("https://api.arcee.ai".to_string()),
                api_model: Some("model".to_string()),
                api_key_env: OptionalModelOption::Value("DELEGATED_ARCEE_KEY".to_string()),
                ..ModelOptions::default()
            },
            sandbox: SandboxOptions::default(),
            ssh: SshOptions::default(),
        },
        &NacConfig::default(),
    )
    .await
    {
        Ok(_) => panic!("delegated Arcee worker must reject api_key_env"),
        Err(error) => error,
    };
    assert!(
        worker_error.to_string().contains(expected),
        "got: {worker_error:#}"
    );
    assert!(
        !worker_store.exists(),
        "invalid worker initialized its store"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_worker_builds_user_messages_from_self_and_source_threads() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();

    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }

    let store_path = temp_store_path("managed_worker_messages");
    store::initialize(&store_path).unwrap();

    let session_id = "session-msg-order";
    store::append_episode(
        &store_path,
        session_id,
        "impl",
        "step-1",
        "impl retained episode",
    )
    .unwrap();
    store::append_episode(
        &store_path,
        session_id,
        "auth",
        "inspect",
        "auth latest episode",
    )
    .unwrap();
    store::append_episode(
        &store_path,
        session_id,
        "tests",
        "inspect",
        "tests latest episode",
    )
    .unwrap();

    let workspace_cwd = store_path.parent().unwrap().to_path_buf();
    let options = ManagedWorkerOptions {
        workspace_cwd,
        config_cwd: None,
        dispatch: WorkerDispatchOptions {
            session_id: session_id.to_string(),
            thread_name: "impl".to_string(),
            dispatch_id: "test-dispatch".to_string(),
            action: "implement the next step".to_string(),
            source_threads: vec!["auth".to_string(), "tests".to_string()],
            skills: Vec::new(),
        },
        store: StoreOptions {
            store_path: Some(store_path.clone()),
        },
        model: test_openai_model_options(),
        sandbox: SandboxOptions::default(),
        ssh: SshOptions::default(),
    };

    let run_config = build_managed_worker_config(options, &NacConfig::default())
        .await
        .unwrap();

    assert_eq!(run_config.action, "implement the next step");
    assert_eq!(run_config.agent.messages.len(), 4);

    match &run_config.agent.messages[1] {
        Message::User { content } => assert!(content.contains("impl retained episode")),
        other => panic!("expected self-history user message, got {:?}", other),
    }
    match &run_config.agent.messages[2] {
        Message::User { content } => {
            assert!(content.contains("auth latest episode"));
            assert!(content.contains("thread \"auth\""));
        }
        other => panic!("expected first source-thread user message, got {:?}", other),
    }
    match &run_config.agent.messages[3] {
        Message::User { content } => {
            assert!(content.contains("tests latest episode"));
            assert!(content.contains("thread \"tests\""));
        }
        other => panic!(
            "expected second source-thread user message, got {:?}",
            other
        ),
    }

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    restore_env("OPENAI_API_KEY", original_api_key);
}

#[test]
fn sandbox_gpu_all_maps_to_nvidia_cdi_device() {
    assert_eq!(normalize_gpu_device("all"), "nvidia.com/gpu=all");
    assert_eq!(
        normalize_gpu_device("nvidia.com/gpu=mig1:0"),
        "nvidia.com/gpu=mig1:0"
    );
}

#[tokio::test]
async fn resume_recovers_effort_and_only_persists_authoritative_changes() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let key_name = "NAC_RESUME_EFFORT_MIGRATION_KEY";
    let original_key = std::env::var_os(key_name);
    unsafe { std::env::set_var(key_name, "test-key") };

    let root = temp_store_path("resume_effort_migration")
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("store.db");
    store::initialize(&store_path).unwrap();

    for (session_id, model, stored_effort, effective_effort, stored_after, version) in [
        (
            "dated-family",
            "claude-sonnet-4-6-20251001",
            ReasoningEffort::Xhigh,
            Some(ReasoningEffort::High),
            Some(ReasoningEffort::High),
            1,
        ),
        (
            "supported",
            "claude-sonnet-4-6-20251001",
            ReasoningEffort::High,
            Some(ReasoningEffort::High),
            Some(ReasoningEffort::High),
            0,
        ),
        (
            "provider-default",
            "unknown-model",
            ReasoningEffort::Medium,
            Some(ReasoningEffort::None),
            Some(ReasoningEffort::Medium),
            0,
        ),
    ] {
        let active = create_and_resume_effort_snapshot(
            &store_path,
            &root,
            key_name,
            session_id,
            BackendKind::AnthropicMessages,
            model,
            stored_effort,
        )
        .await;
        assert_eq!(active.reasoning_effort, effective_effort);
        assert_eq!(active.config_version, version);
        let stored = sessions::load_session(&store_path, session_id).unwrap();
        assert_eq!(stored.reasoning_effort, stored_after);
        assert_eq!(stored.config_version, version);
    }

    let _ = std::fs::remove_dir_all(root);
    restore_env(key_name, original_key);
}

#[tokio::test]
async fn resume_effort_migration_requires_operation_lease() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let key_name = "NAC_RESUME_EFFORT_LEASE_KEY";
    let original_key = std::env::var_os(key_name);
    unsafe { std::env::set_var(key_name, "test-key") };

    let root = temp_store_path("resume_effort_lease")
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("store.db");
    store::initialize(&store_path).unwrap();
    let snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "deepseek-ai/DeepSeek-V4-Pro".to_string(),
        "https://api.together.xyz/v1".to_string(),
        BackendKind::TogetherChat,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some(key_name.to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();

    let lease = sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
    assert!(build_resume_config_for_session(
        store_path.clone(),
        "session",
        &NacConfig::default(),
        root.clone(),
        None,
    )
    .await
    .is_err());
    assert_eq!(
        sessions::load_session(&store_path, "session")
            .unwrap()
            .reasoning_effort,
        Some(ReasoningEffort::Medium)
    );

    let resumed = build_resume_config_for_session_with_lease(
        store_path.clone(),
        "session",
        &NacConfig::default(),
        root.clone(),
        None,
        &lease,
    )
    .await
    .unwrap();
    assert_eq!(
        resumed.client.reasoning_effort(),
        Some(ReasoningEffort::High)
    );
    let stored = sessions::load_session(&store_path, "session").unwrap();
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::High));
    assert_eq!(stored.config_version, 1);

    drop(lease);
    let _ = std::fs::remove_dir_all(root);
    restore_env(key_name, original_key);
}

#[tokio::test]
async fn persisted_settings_are_identical_across_create_snapshot_resume_and_worker_transport() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let key_name = "NAC_REASONING_LIFECYCLE_TEST_KEY";
    let original_key = std::env::var_os(key_name);
    unsafe { std::env::set_var(key_name, "test-key") };

    let root = temp_store_path("reasoning_lifecycle")
        .parent()
        .unwrap()
        .to_path_buf();
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let store_path = root.join("store.db");
    let headers = BTreeMap::from([("X-Snapshot".to_string(), "exact".to_string())]);
    let created = build_run_config(
        RunOptions {
            workspace_cwd: workspace.clone(),
            config_cwd: None,
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: ModelOptions {
                backend: Some(BackendKind::OpenAiResponses),
                reasoning_effort: OptionalModelOption::Value(ReasoningEffort::Xhigh),
                api_base_url: Some("https://snapshot.example/v1".to_string()),
                api_model: Some("snapshot-model".to_string()),
                api_key_env: OptionalModelOption::Value(key_name.to_string()),
                extra_headers: Some(headers.clone()),
                light_model: None,
            },
            orchestrator_compaction_threshold: Some(48_000),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions::default(),
        },
        &NacConfig::default(),
    )
    .await
    .unwrap();
    let session_id = created.session.session_id().unwrap().to_string();
    assert_eq!(
        created.client.reasoning_effort(),
        Some(ReasoningEffort::Xhigh)
    );

    let snapshot = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(snapshot.reasoning_effort, Some(ReasoningEffort::Xhigh));
    assert_eq!(snapshot.extra_headers, headers);
    assert_eq!(snapshot.orchestrator_compaction_threshold, Some(48_000));

    let mut conflicting_config = complete_model_config();
    conflicting_config.compaction.threshold_tokens = Some(96_000);
    conflicting_config.model.reasoning_effort = Some(ReasoningEffort::Low);
    conflicting_config.model.model = Some("must-not-win".to_string());
    let resumed = build_resume_config(
        ResumeOptions {
            lookup_cwd: workspace,
            worker_executable: None,
            session_id: Some(session_id),
            last: false,
            store: StoreOptions {
                store_path: Some(store_path),
            },
        },
        &conflicting_config,
    )
    .await
    .unwrap();
    assert_eq!(resumed.client.model, "snapshot-model");
    assert_eq!(
        resumed.client.reasoning_effort(),
        Some(ReasoningEffort::Xhigh)
    );
    assert_eq!(resumed.client.extra_headers(), &headers);
    match &resumed.session {
        OrchestratorSession::Active { snapshot, .. } => assert_eq!(
            snapshot.orchestrator_compaction_threshold,
            Some(48_000),
            "resume must ignore the current compaction config"
        ),
        OrchestratorSession::Picker { .. } => panic!("expected active resumed session"),
    }
    assert_eq!(
        crate::tools::thread::worker_model_arguments_for_test(&resumed.client),
        vec![
            "--api-model",
            "snapshot-model",
            "--api-base-url",
            "https://snapshot.example/v1",
            "--backend",
            "openai-responses",
            "--effort",
            "xhigh",
            "--api-key-env",
            key_name,
            "--extra-headers",
            "{\"X-Snapshot\":\"exact\"}",
        ]
    );

    let _ = std::fs::remove_dir_all(root);
    restore_env(key_name, original_key);
}
