use super::*;

#[tokio::test]
async fn create_inherits_overrides_and_null_clears_optional_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_tristate");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        r#"[model]
model = "gpt-5.2"
reasoning_effort = "medium"
extra_headers = { X-Config = "yes" }

[compaction]
threshold_tokens = 64000
"#,
    )
    .unwrap();
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);

    let inherited = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect("omitted fields should inherit config");
    assert!(inherited.metadata.extra_headers.is_empty());
    let inherited_id = inherited.metadata.session_id.unwrap();
    let stored = sessions::load_session(&root.join("store.db"), &inherited_id).unwrap();
    assert_eq!(stored.behavior, sessions::SessionBehavior::Orchestrator);
    assert_eq!(stored.backend, BackendKind::OpenAiResponses);
    assert_eq!(stored.model, "gpt-5.2");
    assert_eq!(stored.base_url, "https://api.openai.com/v1");
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
    assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert_eq!(stored.orchestrator_compaction_threshold, Some(280_000));
    assert_eq!(
        stored.extra_headers,
        BTreeMap::from([("X-Config".to_string(), "yes".to_string())])
    );
    let Json(config) = delivery::session_lifecycle::session_config_handler(
        State(manager.clone()),
        AxumPath(inherited_id.clone()),
    )
    .await
    .unwrap();
    assert_eq!(
        config.extra_headers_json.as_deref(),
        Some("{\"X-Config\":\"yes\"}")
    );
    assert_eq!(config.orchestrator_compaction_threshold, Some(280_000));
    assert!(manager
        .snapshot(&inherited_id)
        .await
        .unwrap()
        .metadata
        .extra_headers
        .is_empty());

    for behavior in [
        sessions::SessionBehavior::Direct,
        sessions::SessionBehavior::DirectWithOrchestrator,
    ] {
        let direct = manager
            .create_session(CreateSessionRequest {
                behavior,
                ..CreateSessionRequest::default()
            })
            .await
            .expect("an explicitly selected direct behavior should launch");
        assert_eq!(direct.metadata.behavior, behavior.for_create());
        let direct_id = direct.metadata.session_id.unwrap();
        assert_eq!(
            sessions::load_session(&root.join("store.db"), &direct_id)
                .unwrap()
                .behavior,
            behavior.for_create()
        );
        assert_eq!(
            manager
                .attach_session(&direct_id)
                .await
                .unwrap()
                .metadata()
                .behavior,
            behavior.for_create()
        );
    }

    let cleared = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("trinity-large-thinking".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            reasoning_effort: RequestField::Null,
            api_key_env: RequestField::Null,
            extra_headers: RequestField::Null,
            orchestrator_compaction_threshold: RequestField::Null,
            ..CreateSessionRequest::default()
        })
        .await
        .expect("explicit values and null optional fields should override config");
    let cleared_id = cleared.metadata.session_id.unwrap();
    let stored = sessions::load_session(&root.join("store.db"), &cleared_id).unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(stored.model, "trinity-large-thinking");
    assert_eq!(stored.reasoning_effort, None);
    assert_eq!(stored.api_key_env, None);
    assert!(stored.extra_headers.is_empty());
    assert_eq!(stored.orchestrator_compaction_threshold, None);

    let zero_disabled = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("trinity-large-thinking".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            reasoning_effort: RequestField::Null,
            api_key_env: RequestField::Null,
            extra_headers: RequestField::Null,
            orchestrator_compaction_threshold: RequestField::Value(0),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("zero should disable an inherited compaction threshold");
    let zero_disabled_id = zero_disabled.metadata.session_id.unwrap();
    assert_eq!(
        sessions::load_session(&root.join("store.db"), &zero_disabled_id)
            .unwrap()
            .orchestrator_compaction_threshold,
        None
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn openai_config_launch_switch_to_arcee_normalizes_the_managed_tuple() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("openai_to_arcee_launch");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        r#"[model]
model = "gpt-5.2"
"#,
    )
    .unwrap();
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);

    let created = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("trinity-large-thinking".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("an explicit managed launch materializes its canonical tuple");
    assert_eq!(
        created.metadata.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(created.metadata.api_key_env, None);

    let session_id = created.metadata.session_id.unwrap();
    let stored = sessions::load_session(&root.join("store.db"), &session_id).unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(
        stored.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(stored.api_key_env, None);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn inherited_managed_launches_clear_stale_selectors_and_persist_fixed_bases() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_base_materialization");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    write_codex_auth(&nac_home);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    // The full auto-resolution chain end-to-end: a bare configured
    // model resolves its provider through the catalog (gpt-5.2 is
    // unique to openai-responses), the base URL materializes from the
    // catalog endpoint default, and the credential auto-selects the
    // conventional env var — persisted into the session.
    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"gpt-5.2\"\n",
    )
    .unwrap();
    let created = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("a configured catalog-known model auto-resolves the full tuple");
    assert_eq!(created.metadata.backend, "openai-responses");
    assert_eq!(created.metadata.base_url, "https://api.openai.com/v1");
    assert_eq!(
        created.metadata.api_key_env.as_deref(),
        Some("OPENAI_API_KEY")
    );
    let session_id = created.metadata.session_id.unwrap();
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(stored.backend, BackendKind::OpenAiResponses);
    assert_eq!(stored.base_url, "https://api.openai.com/v1");
    assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

    // Force a real persisted-snapshot attach instead of returning the
    // service left in memory by create.
    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove(&session_id);
    let resumed = manager.snapshot(&session_id).await.unwrap();
    assert_eq!(resumed.metadata.base_url, "https://api.openai.com/v1");

    // Managed backends are only reachable through an explicit request
    // backend: every managed model id collides with a non-managed
    // provider's entry (the Trinity ids with arcee-api, the codex seed
    // ids with the openai baseline) and the collision rule prefers the
    // non-managed provider.
    for (backend, model, expected_base) in [
        (
            "arcee-auth",
            "trinity-large-thinking",
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
        ),
        (
            "chatgpt-codex-responses",
            "gpt-5.3-codex-spark",
            nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
        ),
    ] {
        let explicit: CreateSessionRequest = serde_json::from_value(serde_json::json!({
            "cwd": root,
            "backend": backend,
            "model": model,
            "api_key_env": null
        }))
        .unwrap();
        let created = manager
            .create_session(explicit)
            .await
            .unwrap_or_else(|error| panic!("explicit {backend} launch failed: {error:#}"));
        assert_eq!(created.metadata.base_url, expected_base);
        assert_eq!(created.metadata.api_key_env, None);
        let session_id = created.metadata.session_id.unwrap();
        let stored = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(stored.base_url, expected_base);
        assert_eq!(stored.api_key_env, None);

        // An explicit canonical managed base URL remains accepted.
        let canonical: CreateSessionRequest = serde_json::from_value(serde_json::json!({
            "cwd": root,
            "backend": backend,
            "model": model,
            "base_url": expected_base,
            "api_key_env": null
        }))
        .unwrap();
        let created = manager
            .create_session(canonical)
            .await
            .expect("an explicit canonical managed base URL must remain accepted");
        assert_eq!(created.metadata.base_url, expected_base);
    }

    let before_controls = sessions::list_sessions(&store_path).unwrap().len();
    for (backend, invalid_base, expected_error) in [
        (
            "chatgpt-codex-responses",
            "https://attacker.example/backend-api",
            "requires the approved ChatGPT origin",
        ),
        (
            "arcee-auth",
            "https://tenant.arcee.ai/api/v1",
            "does not match the stored credential origin",
        ),
    ] {
        let model = if backend == "arcee-auth" {
            "trinity-large-thinking"
        } else {
            "gpt-5.3-codex-spark"
        };
        let invalid: CreateSessionRequest = serde_json::from_value(serde_json::json!({
            "cwd": root,
            "backend": backend,
            "model": model,
            "base_url": invalid_base
        }))
        .unwrap();
        let error = manager
            .create_session(invalid)
            .await
            .expect_err("a present non-managed origin must not be overwritten by the default");
        assert!(error.to_string().contains(expected_error), "{error:#}");
    }

    // An unknown configured model resolves no provider: the guided
    // missing-backend error surfaces (the frontend renders the
    // from-config selection as unrecognized).
    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"api-model\"\n",
    )
    .unwrap();
    let error = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .expect_err("an unknown configured model must not resolve a backend");
    assert!(error.to_string().contains("backend"), "{error:#}");
    assert_eq!(
        sessions::list_sessions(&store_path).unwrap().len(),
        before_controls,
        "mismatch and unresolved failures must not persist sessions"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn empty_patch_never_repairs_or_revisions_uncached_managed_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_base_patch_repair");
    let nac_home = root.join("nac-home");
    write_codex_auth(&nac_home);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let store_path = root.join("store.db");
    let manager = test_manager(&root);

    for (session_id, backend, expected_base, light_api_key_env) in [
        (
            "repair-codex",
            BackendKind::ChatGptCodexResponses,
            nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            Some("STALE_API_KEY"),
        ),
        (
            "repair-arcee",
            BackendKind::ArceeAuth,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            Some("STALE_API_KEY"),
        ),
        (
            "repair-arcee-without-light-selector",
            BackendKind::ArceeAuth,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            None,
        ),
    ] {
        seed_session(&root, session_id, "2026-01-01 00:00:00.000000000");
        let mut incomplete = sessions::load_session(&store_path, session_id).unwrap();
        incomplete.backend = backend;
        if backend == BackendKind::ArceeAuth {
            incomplete.model = "trinity-large-thinking".to_string();
        }
        incomplete.base_url.clear();
        incomplete.api_key_env = Some("STALE_API_KEY".to_string());
        incomplete.light_model = Some(LightModelSettings {
            model: match backend {
                BackendKind::ArceeAuth => "trinity-large-thinking",
                BackendKind::ChatGptCodexResponses => "gpt-5.2-codex",
                _ => unreachable!("test only covers managed backends"),
            }
            .to_string(),
            backend: Some(backend),
            base_url: Some(expected_base.to_string()),
            api_key_env: light_api_key_env.map(str::to_string),
            reasoning_effort: None,
        });
        sessions::update_session_config(&store_path, &incomplete).unwrap();
        let before = sessions::load_session(&store_path, session_id).unwrap();

        manager
            .update_session_config(session_id, UpdateConfigRequest::default())
            .await
            .expect("empty PATCH is a no-op even when legacy managed config needs repair");
        let after = sessions::load_session(&store_path, session_id).unwrap();
        assert_eq!(after.base_url, before.base_url);
        assert_eq!(after.api_key_env, before.api_key_env);
        assert_eq!(after.light_model, before.light_model);
        assert_eq!(after.config_version, before.config_version);
        assert_eq!(after.updated_at, before.updated_at);
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn api_key_settings_switch_to_arcee_normalizes_omitted_managed_endpoint_and_credentials() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("api_key_to_arcee_patch");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let mut api_key_session = sessions::load_session(&store_path, "session").unwrap();
    api_key_session.reasoning_effort = None;
    let inherited_selector = api_key_session
        .api_key_env
        .clone()
        .expect("seeded API-key session has a selector");
    sessions::update_session_config(&store_path, &api_key_session).unwrap();
    let manager = test_manager(&root);

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-auth".to_string()),
                model: RequestField::Value("trinity-large-thinking".to_string()),
                light_model: RequestField::Value(LightModelSettings {
                    model: "trinity-large-thinking".to_string(),
                    backend: Some(BackendKind::ArceeAuth),
                    base_url: None,
                    api_key_env: Some(inherited_selector),
                    reasoning_effort: None,
                }),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("managed PATCH must normalize its omitted endpoint and credential fields");

    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(
        stored.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(stored.api_key_env, None);
    assert_eq!(
        stored
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );
    let rehydrated = manager.session_config("session").unwrap();
    assert_eq!(rehydrated.backend.as_deref(), Some("arcee-auth"));
    assert_eq!(
        rehydrated.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(rehydrated.api_key_env, None);
    assert_eq!(
        rehydrated
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn create_reports_the_missing_light_model_credential() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_missing_light_credential");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let manager = test_manager(&root);

    let error = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("moonshotai/kimi-k3".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai/api/v1".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            api_key_env: RequestField::Null,
            light_model: RequestField::Value(LightModelSettings {
                model: "deepseek/deepseek-v4-flash-latest".to_string(),
                backend: Some(BackendKind::ArceeApi),
                base_url: Some("https://api.arcee.ai/api/v1".to_string()),
                api_key_env: None,
                reasoning_effort: None,
            }),
            ..CreateSessionRequest::default()
        })
        .await
        .expect_err("an API-key light model without a key must fail creation");
    let response = ApiError::from(error);

    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert!(
        response.message.contains("invalid light model settings"),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("api_key_env"),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("ARCEE_API_KEY"),
        "{}",
        response.message
    );
    assert!(manager
        .session_catalog()
        .list(false)
        .await
        .unwrap()
        .is_empty());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn update_reports_the_missing_light_model_credential() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("update_missing_light_credential");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);

    let error = manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                light_model: RequestField::Value(LightModelSettings {
                    model: "deepseek/deepseek-v4-flash-latest".to_string(),
                    backend: Some(BackendKind::ArceeApi),
                    base_url: Some("https://api.arcee.ai/api/v1".to_string()),
                    api_key_env: None,
                    reasoning_effort: None,
                }),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("an API-key light model without a key must fail the update");
    let response = ApiError::from(error);

    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    // Assert the rendered boundary output: the resolver keeps the cause
    // chain intact and the boundary renders it once with `{:#}`, so the
    // response pairs the context with the actionable cause.
    assert!(
        response
            .message
            .starts_with("invalid light model settings: "),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("api_key_env"),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("ARCEE_API_KEY"),
        "{}",
        response.message
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn codex_create_preflights_endpoint_and_managed_credentials_before_persistence() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

    for (label, base_url, auth, expected_status, expected) in [
        (
            "codex-create-missing",
            "https://chatgpt.com/backend-api",
            None,
            StatusCode::BAD_REQUEST,
            "not configured",
        ),
        (
            "codex-create-malformed",
            "https://chatgpt.com/backend-api",
            Some("{not-json}"),
            StatusCode::BAD_REQUEST,
            "failed to parse",
        ),
        (
            "codex-create-blank",
            "https://chatgpt.com/backend-api",
            Some(
                r#"{"type":"chatgpt-codex","access":"secret-must-not-leak","refresh":"","expires_at_ms":1,"account_id":"account"}"#,
            ),
            StatusCode::BAD_REQUEST,
            "nonblank field 'refresh'",
        ),
        (
            "codex-create-endpoint",
            "http://chatgpt.com/backend-api",
            Some(
                r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":"account"}"#,
            ),
            StatusCode::BAD_REQUEST,
            "requires HTTPS",
        ),
    ] {
        let root = temp_root(label);
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        if let Some(auth) = auth {
            write_managed_credential(&nac_home.join("auth.json"), auth);
        }
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("gpt-test".to_string()),
                base_url: RequestField::Value(base_url.to_string()),
                backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                api_key_env: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("invalid Codex setup must fail creation");
        assert!(error.to_string().contains(expected), "{error:#}");
        assert!(!format!("{error:#}").contains("secret-must-not-leak"));
        assert_eq!(ApiError::from(error).status, expected_status);
        assert!(!root.join("store.db").exists());
        drop(_env);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let root = temp_root("codex-create-symlink");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let target = nac_home.join("target.json");
        std::fs::write(&target, "secret-target").unwrap();
        symlink(&target, nac_home.join("auth.json")).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("gpt-test".to_string()),
                base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                api_key_env: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
        assert_eq!(
            ApiError::from(error).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert!(!root.join("store.db").exists());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "secret-target");
        drop(_env);
        let _ = std::fs::remove_dir_all(root);
    }
}

#[tokio::test]
async fn codex_resume_preflights_missing_credentials() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("codex-resume-missing");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
    let mut stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    stored.backend = BackendKind::ChatGptCodexResponses;
    stored.base_url = "https://chatgpt.com/backend-api".to_string();
    stored.api_key_env = None;
    sessions::update_session_config(&root.join("store.db"), &stored).unwrap();
    let manager = test_manager(&root);

    let error = manager
        .attach_session("session")
        .await
        .err()
        .expect("resume without Codex auth must fail");
    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
    assert!(error.to_string().contains("not configured"));
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn codex_patch_failures_roll_back_database_and_active_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("codex-patch-rollback");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    manager.attach_session("session").await.unwrap();
    let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

    for (auth, base_url, expected_status) in [
        (
            "{not-json}",
            "https://chatgpt.com/backend-api",
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
            "https://attacker.example/backend-api",
            StatusCode::BAD_REQUEST,
        ),
    ] {
        write_managed_credential(&nac_home.join("auth.json"), auth);
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value(base_url.to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(ApiError::from(error).status, expected_status);
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.base_url, before.base_url);
        assert_eq!(after.api_key_env, before.api_key_env);
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        write_codex_auth(&nac_home);
        std::fs::set_permissions(
            nac_home.join("auth.json"),
            std::fs::Permissions::from_mode(0o660),
        )
        .unwrap();
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("unsafe permissions 0660"));
        assert!(!format!("{error:#}").contains("codex-server-access"));
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.base_url, before.base_url);
        assert_eq!(after.api_key_env, before.api_key_env);
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        std::fs::remove_file(nac_home.join("auth.json")).unwrap();
        let target = nac_home.join("patch-target.json");
        std::fs::write(&target, "secret-target").unwrap();
        symlink(&target, nac_home.join("auth.json")).unwrap();
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
        assert_eq!(
            ApiError::from(error).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.base_url, before.base_url);
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
        assert_eq!(std::fs::read_to_string(target).unwrap(), "secret-target");
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn create_rejects_raw_invalid_selectors_without_persisting() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_invalid_selectors");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    for (backend, base_url, selector) in [
        ("openai-responses", "https://api.openai.com/v1", ""),
        ("openai-responses", "https://api.openai.com/v1", "   "),
        (
            "openai-responses",
            "https://api.openai.com/v1",
            " SURROUNDED_KEY ",
        ),
        ("arcee-auth", "https://api.arcee.ai", ""),
        ("arcee-auth", "https://api.arcee.ai", "   "),
    ] {
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("test-model".to_string()),
                base_url: RequestField::Value(base_url.to_string()),
                backend: RequestField::Value(backend.to_string()),
                api_key_env: RequestField::Value(selector.to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("invalid selector must fail creation");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert!(
            !store_path.exists(),
            "invalid selector {selector:?} must fail before persistence"
        );
    }

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn create_rejects_unsupported_backend_and_anthropic_model_efforts_before_persisting() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_invalid_reasoning");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);
    let cases = [
        (
            "together-chat",
            "test-model",
            "https://api.together.xyz/v1",
            "minimal",
        ),
        (
            "anthropic-messages",
            "claude-sonnet-4-6",
            "https://api.anthropic.com/v1",
            "xhigh",
        ),
        (
            "anthropic-messages",
            "claude-opus-4-5",
            "https://api.anthropic.com/v1",
            "high",
        ),
        (
            "anthropic-messages",
            "claude-always-on-future",
            "https://api.anthropic.com/v1",
            "low",
        ),
    ];

    for (backend, model, base_url, effort) in cases {
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value(model.to_string()),
                base_url: RequestField::Value(base_url.to_string()),
                backend: RequestField::Value(backend.to_string()),
                reasoning_effort: RequestField::Value(effort.to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("unsupported effort must fail creation");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains(effort), "{error:#}");
        assert!(error.to_string().contains(backend), "{error:#}");
        if backend == "anthropic-messages" {
            assert!(error.to_string().contains(model), "{error:#}");
        }
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert!(
            !root.join("store.db").exists(),
            "invalid {model}/{effort} must fail before persistence"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn patch_round_trips_every_state_and_rebuilds_from_persisted_settings() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("patch_tristate");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    write_codex_auth(&nac_home);
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);

    manager.attach_session("session").await.unwrap();
    assert!(manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value(" replacement-model ".to_string()),
                base_url: RequestField::Value(" https://api.openai.com/v1 ".to_string()),
                backend: RequestField::Value("openai-responses".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "X-Replaced".to_string(),
                    "true".to_string(),
                )]))),
                orchestrator_compaction_threshold: RequestField::Value(64_000),
                light_model: RequestField::Omitted,
            },
        )
        .await
        .unwrap();
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));
    let replaced = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(replaced.model, "replacement-model");
    assert_eq!(replaced.reasoning_effort, Some(ReasoningEffort::High));
    assert_eq!(replaced.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert_eq!(replaced.extra_headers.get("X-Replaced").unwrap(), "true");
    assert_eq!(replaced.orchestrator_compaction_threshold, Some(64_000));
    assert_eq!(
        manager
            .session_config("session")
            .unwrap()
            .orchestrator_compaction_threshold,
        Some(64_000)
    );

    manager.attach_session("session").await.unwrap();
    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-auth".to_string()),
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                reasoning_effort: RequestField::Null,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Null,
                orchestrator_compaction_threshold: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch to stored Arcee auth");
    let arcee_auth = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(arcee_auth.backend, BackendKind::ArceeAuth);
    assert_eq!(arcee_auth.reasoning_effort, None);
    assert_eq!(arcee_auth.api_key_env, None);
    assert!(arcee_auth.extra_headers.is_empty());
    assert_eq!(arcee_auth.orchestrator_compaction_threshold, None);

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-api".to_string()),
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api/v1".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                orchestrator_compaction_threshold: RequestField::Value(32_000),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch to Arcee API key mode");
    let arcee_api = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(arcee_api.backend, BackendKind::ArceeApi);
    assert_eq!(arcee_api.orchestrator_compaction_threshold, Some(32_000));

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                model: RequestField::Value("gpt-5.2-codex".to_string()),
                base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                api_key_env: RequestField::Null,
                orchestrator_compaction_threshold: RequestField::Value(0),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch to Codex stored OAuth mode");
    let codex = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(codex.backend, BackendKind::ChatGptCodexResponses);
    assert_eq!(codex.api_key_env, None);
    assert_eq!(codex.orchestrator_compaction_threshold, None);

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("openai-responses".to_string()),
                model: RequestField::Value("gpt-5.2".to_string()),
                base_url: RequestField::Value("https://api.openai.com/v1".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::new())),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch back to API-key mode");
    let api_key = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(api_key.backend, BackendKind::OpenAiResponses);
    assert_eq!(api_key.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert!(api_key.extra_headers.is_empty());

    let before_omitted = api_key;
    manager
        .update_session_config("session", UpdateConfigRequest::default())
        .await
        .expect("omitted fields preserve snapshot");
    let after_omitted = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(after_omitted.model, before_omitted.model);
    assert_eq!(after_omitted.base_url, before_omitted.base_url);
    assert_eq!(after_omitted.backend, before_omitted.backend);
    assert_eq!(after_omitted.api_key_env, before_omitted.api_key_env);
    assert_eq!(after_omitted.extra_headers, before_omitted.extra_headers);

    manager.attach_session("session").await.unwrap();
    let rebuilt = manager.snapshot("session").await.unwrap();
    assert_eq!(rebuilt.metadata.model, "gpt-5.2");
    assert_eq!(rebuilt.metadata.backend, "openai-responses");

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn invalid_patches_preserve_database_and_active_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("patch_rollback");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    manager.attach_session("session").await.unwrap();

    let invalid = [
        UpdateConfigRequest {
            orchestrator_compaction_threshold: RequestField::Value(
                nac_core::MAX_SUPPORTED_TOKEN_COUNT + 1,
            ),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Null,
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            base_url: RequestField::Value("   ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Null,
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            // Clearing the selector fails only when conventional-var
            // auto-selection cannot repair it: deepseek's conventional
            // variable is cleared in this environment (the session's
            // own openai conventional variable is set and would
            // auto-select, so clearing stays valid there).
            backend: RequestField::Value("deepseek-chat".to_string()),
            api_key_env: RequestField::Null,
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value("   ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value(" SURROUNDED_KEY ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Value("arcee-auth".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            api_key_env: RequestField::Value("   ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value("MISSING_SERVER_KEY".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                "bad header".to_string(),
                "value".to_string(),
            )]))),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                "Authorization".to_string(),
                "must-not-append".to_string(),
            )]))),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                "X-API-KEY".to_string(),
                "must-not-append".to_string(),
            )]))),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Value("together-chat".to_string()),
            reasoning_effort: RequestField::Value("xhigh".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Value("claude-sonnet-4-6".to_string()),
            base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
            backend: RequestField::Value("anthropic-messages".to_string()),
            reasoning_effort: RequestField::Value("xhigh".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Value("claude-opus-4-5".to_string()),
            base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
            backend: RequestField::Value("anthropic-messages".to_string()),
            reasoning_effort: RequestField::Value("high".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Value("claude-always-on-future".to_string()),
            base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
            backend: RequestField::Value("anthropic-messages".to_string()),
            reasoning_effort: RequestField::Value("low".to_string()),
            ..UpdateConfigRequest::default()
        },
    ];

    for request in invalid {
        let anthropic_model = match (&request.backend, &request.model) {
            (RequestField::Value(backend), RequestField::Value(model))
                if backend == "anthropic-messages" =>
            {
                Some(model.clone())
            }
            _ => None,
        };
        let error = manager
            .update_session_config("session", request)
            .await
            .unwrap_err();
        if let Some(model) = anthropic_model {
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(&model), "{error:#}");
        }
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.model, "model-a");
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(stored.extra_headers.get("X-Original").unwrap(), "yes");
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
    }

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn removed_backend_updates_are_bad_requests_and_are_not_persisted() {
    let root = temp_root("removed_backend_update");
    seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
    let manager = test_manager(&root);

    for backend in ["arcee", "auto"] {
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value(backend.to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
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

        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn server_arcee_configuration_status_and_persistence_are_consistent() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("arcee_config_status");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://tenant.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    let create_error = manager
        .create_session(CreateSessionRequest {
            behavior: sessions::SessionBehavior::Orchestrator,
            first_chat: false,
            project_id: None,
            cwd: None,
            model: RequestField::Omitted,
            base_url: RequestField::Value("http://api.arcee.ai/insecure".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
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
    assert!(create_error
        .downcast_ref::<ModelConfigurationError>()
        .is_some());
    assert_eq!(ApiError::from(create_error).status, StatusCode::BAD_REQUEST);
    assert!(
        !store_path.exists(),
        "invalid create must fail before initializing session storage"
    );

    seed_session(&root, "attach-invalid", "2026-01-01 00:00:00.000000000");
    let mut attach_snapshot = sessions::load_session(&store_path, "attach-invalid").unwrap();
    attach_snapshot.backend = BackendKind::ArceeApi;
    attach_snapshot.base_url = "https://api.arcee.ai/api/v1".to_string();
    sessions::update_session_config(&store_path, &attach_snapshot).unwrap();
    let attach_error = match manager.attach_session("attach-invalid").await {
        Ok(_) => panic!("arcee-api attach without api_key_env must fail"),
        Err(error) => error,
    };
    // The guided error names the provider's conventional variable
    // (ScopedModelEnv keeps ARCEE_API_KEY cleared, so auto-selection
    // cannot adopt it).
    assert!(
        attach_error
            .to_string()
            .contains("set the ARCEE_API_KEY environment variable"),
        "{attach_error:#}"
    );
    assert!(attach_error
        .downcast_ref::<ModelConfigurationError>()
        .is_some());
    assert_eq!(ApiError::from(attach_error).status, StatusCode::BAD_REQUEST);

    seed_session(&root, "update", "2026-01-02 00:00:00.000000000");
    for invalid_base_url in ["https://api.arcee.ai/v1", "not a URL"] {
        let update_error = manager
            .update_session_config(
                "update",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Value(invalid_base_url.to_string()),
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
        assert!(
            update_error
                .downcast_ref::<ModelConfigurationError>()
                .is_some(),
            "unclassified configuration error: {update_error:#}"
        );
        assert_eq!(ApiError::from(update_error).status, StatusCode::BAD_REQUEST);

        let stored = sessions::load_session(&store_path, "update").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
    }

    manager
        .update_session_config(
            "update",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("same-origin approved Arcee configuration should persist");
    let approved = sessions::load_session(&store_path, "update").unwrap();
    assert_eq!(approved.backend, BackendKind::ArceeAuth);
    assert_eq!(approved.base_url, "https://tenant.arcee.ai/api/v1");

    unsafe { std::env::set_var("OPENAI_API_KEY", "custom-server-key") };
    manager
        .update_session_config(
            "update",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                backend: RequestField::Value("arcee-api".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("approved arcee-api configuration with an explicit selector should persist");
    let api_mode = sessions::load_session(&store_path, "update").unwrap();
    assert_eq!(api_mode.base_url, "https://api.arcee.ai/api");
    assert_eq!(api_mode.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

    let created = manager
        .create_session(CreateSessionRequest {
            behavior: sessions::SessionBehavior::Orchestrator,
            first_chat: false,
            project_id: None,
            cwd: None,
            model: RequestField::Value("test-model".to_string()),
            base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
            backend: RequestField::Value("arcee-api".to_string()),
            reasoning_effort: RequestField::Omitted,
            api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
            extra_headers: RequestField::Omitted,
            orchestrator_compaction_threshold: RequestField::Omitted,
            light_model: RequestField::Omitted,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            sandbox: SandboxRequest::default(),
        })
        .await
        .expect("valid approved arcee-api create should succeed");
    assert!(created.metadata.session_id.is_some());

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn null_update_clears_legacy_arcee_api_key_env() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("clear_arcee_api_key_env");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let snapshot = sessions::new_snapshot(
        "legacy-arcee".to_string(),
        root.clone(),
        "model".to_string(),
        "https://api.arcee.ai".to_string(),
        BackendKind::ArceeAuth,
        None,
        None,
        None,
        Vec::new(),
        Some("LEGACY_ARCEE_KEY_ENV".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let manager = test_manager(&root);

    manager
        .update_session_config(
            "legacy-arcee",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Omitted,
                backend: RequestField::Omitted,
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("null api_key_env should clear the invalid legacy value");

    let stored = sessions::load_session(&root.join("store.db"), "legacy-arcee").unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(stored.model, "trinity-large-thinking");
    assert_eq!(stored.api_key_env, None);

    let _ = std::fs::remove_dir_all(&root);
}
