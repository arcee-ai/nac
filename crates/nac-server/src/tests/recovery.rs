use super::*;

#[tokio::test]
async fn server_attach_ignores_invalid_ambient_model_but_create_remains_strict() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("persisted_attach_invalid_ambient_model");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        r#"
[model]
backend = "auto"
api_key_env = ["invalid-selector-shape"]
extra_headers = "invalid-header-shape"

[worker]
thread_timeout_secs = 7200
"#,
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-resume-key"));
    seed_editable_session(&root, "persisted");

    // Server startup, listing, and attachment use only non-model ambient
    // settings; the model tuple and selector come from the stored snapshot.
    let manager = test_manager(&root);
    assert_eq!(
        manager.session_catalog().list(false).await.unwrap().len(),
        1
    );
    let resumed = manager.snapshot("persisted").await.unwrap();
    assert_eq!(resumed.metadata.session_id.as_deref(), Some("persisted"));

    // A new session still parses the complete model table before doing any
    // persistence, so the same obsolete config remains an actionable error.
    let error = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("failed to parse config"),
        "{error:#}"
    );
    assert_eq!(
        manager.session_catalog().list(false).await.unwrap().len(),
        1
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn rebuilt_manager_recovers_interrupted_run_once_and_rotates_event_epoch() {
    let root = temp_root("interrupted_run_restart");
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("restart-test-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let writer = nac_core::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_run_prompt(
            "session",
            0,
            &nac_core::types::Message::User {
                content: "persisted before process death".to_string(),
            },
            "run-before-restart",
        )
        .unwrap();

    let first_manager = test_manager(&root);
    let first = first_manager.snapshot("session").await.unwrap();
    assert_eq!(
            first.transcript_recovery_warning.as_deref(),
            Some(
                "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue."
            )
        );
    assert_eq!(
        first
            .messages
            .iter()
            .filter(|message| matches!(
                message,
                nac_core::types::Message::User { content }
                    if content == "persisted before process death"
            ))
            .count(),
        1
    );
    let first_recovery_events = first_manager
        .recent_events("session", None, 64)
        .await
        .unwrap()
        .1;
    assert_eq!(
        first_recovery_events
            .iter()
            .filter(|envelope| {
                envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("run-before-restart")
                    && matches!(
                        envelope.event,
                        nac_core::events::SessionEvent::RunFailed { .. }
                    )
            })
            .count(),
        1
    );
    let first_epoch = first.thread_event_boundary.epoch_id;
    drop(first_manager);

    let second_manager = test_manager(&root);
    let second = second_manager.snapshot("session").await.unwrap();
    assert_eq!(
        second.transcript_recovery_warning,
        first.transcript_recovery_warning
    );
    assert_ne!(second.thread_event_boundary.epoch_id, first_epoch);
    assert!(
        second_manager
            .recent_events("session", None, 64)
            .await
            .unwrap()
            .1
            .iter()
            .all(|envelope| !matches!(
                envelope.event,
                nac_core::events::SessionEvent::RunFailed { .. }
            )),
        "idempotent rebuild must not synthesize another terminal event"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cached_manager_snapshot_reconciles_peer_interruption_once() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cached_peer_snapshot");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("cached-snapshot-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let manager = test_manager(&root);
    let cached = manager.attach_session("session").await.unwrap();

    let peer_lease = sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &nac_core::types::Message::User {
                content: "committed by peer".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    drop(peer_lease);

    let recovered = manager.snapshot("session").await.unwrap();
    assert_eq!(
            recovered.transcript_recovery_warning.as_deref(),
            Some(
                "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue."
            )
        );
    assert!(matches!(
        recovered.messages.last(),
        Some(nac_core::types::Message::User { content }) if content == "committed by peer"
    ));
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(Arc::ptr_eq(&mapped, &cached));
    assert!(
        !cached
            .has_unreconciled_durable_run_recovery()
            .expect("recovery lookup should succeed"),
        "the cached service must not rehydrate the same recovery row again"
    );

    let recovery_events = manager.recent_events("session", None, 64).await.unwrap().1;
    assert_eq!(
        recovery_events
            .iter()
            .filter(|envelope| {
                envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("peer-run")
                    && matches!(
                        envelope.event,
                        nac_core::events::SessionEvent::RunFailed { .. }
                    )
            })
            .count(),
        1
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cached_manager_reconciles_peer_interruption_before_resubmission() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cached_peer_interruption");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("cached-recovery-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let store_path = root.join("store.db");
    let manager = test_manager(&root);
    let cached = manager.attach_session("session").await.unwrap();

    let peer_lease = sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &nac_core::types::Message::User {
                content: "committed by peer".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    drop(peer_lease);

    let submitted = manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "continue after peer".to_string(),
            },
        )
        .await
        .unwrap();
    let mut continued = false;
    for _ in 0..100 {
        let messages = cached.messages_snapshot().await.unwrap();
        if messages.iter().any(|message| {
            matches!(
                message,
                nac_core::types::Message::User { content }
                    if content == "continue after peer"
            )
        }) {
            continued = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(continued, "replacement prompt never committed");
    assert_eq!(
        cached.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(
        Arc::ptr_eq(&mapped, &cached),
        "recovery must preserve the cached service's event bus and subscribers"
    );
    let recovery_events = manager.recent_events("session", None, 64).await.unwrap().1;
    assert_eq!(
        recovery_events
            .iter()
            .filter(|envelope| {
                envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("peer-run")
                    && matches!(
                        envelope.event,
                        nac_core::events::SessionEvent::RunFailed { .. }
                    )
            })
            .count(),
        1
    );
    assert!(
        cached
            .has_unreconciled_durable_run_recovery()
            .expect("recovery lookup should succeed"),
        "the replacement run must own a new durable recovery row"
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn incomplete_persisted_settings_are_listed_retrievable_and_transactionally_repairable() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("repair_incomplete_settings");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-repair-key"));
    let store_path = root.join("store.db");

    seed_editable_session(&root, "complete");
    seed_session(&root, "missing-selector", "2026-01-02 00:00:00.000000000");
    // A missing selector stays incomplete only when conventional-var
    // auto-selection cannot repair it: deepseek's conventional variable
    // is cleared in this environment (openai's is set and would
    // auto-select).
    let mut missing_selector = sessions::load_session(&store_path, "missing-selector").unwrap();
    missing_selector.backend = BackendKind::DeepSeekChat;
    missing_selector.base_url = "https://api.deepseek.com".to_string();
    sessions::update_session_config(&store_path, &missing_selector).unwrap();
    seed_session(
        &root,
        "missing-environment-value",
        "2026-01-03 00:00:00.000000000",
    );
    let mut missing_value =
        sessions::load_session(&store_path, "missing-environment-value").unwrap();
    missing_value.api_key_env = Some("MISSING_SERVER_REPAIR_KEY".to_string());
    sessions::update_session_config(&store_path, &missing_value).unwrap();

    seed_session(
        &root,
        "unavailable-managed-auth",
        "2026-01-04 00:00:00.000000000",
    );
    let mut unavailable_auth =
        sessions::load_session(&store_path, "unavailable-managed-auth").unwrap();
    unavailable_auth.backend = BackendKind::ArceeAuth;
    unavailable_auth.base_url = "https://api.arcee.ai".to_string();
    unavailable_auth.api_key_env = None;
    sessions::update_session_config(&store_path, &unavailable_auth).unwrap();

    let manager = test_manager(&root);
    let Json(endpoint_config) = delivery::session_lifecycle::session_config_handler(
        State(manager.clone()),
        AxumPath("missing-selector".to_string()),
    )
    .await
    .unwrap();
    assert_eq!(endpoint_config.session_id, "missing-selector");
    assert!(!serde_json::to_string(&endpoint_config)
        .unwrap()
        .contains("server-repair-key"));

    let listed = manager.session_catalog().list(false).await.unwrap();
    let listed_ids = listed
        .iter()
        .map(|entry| entry.summary.session_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(listed_ids.len(), 4);
    for expected in [
        "complete",
        "missing-selector",
        "missing-environment-value",
        "unavailable-managed-auth",
    ] {
        assert!(
            listed_ids.contains(expected),
            "missing listed session {expected}"
        );
    }

    let missing_selector = manager.session_config("missing-selector").unwrap();
    assert_eq!(missing_selector.backend.as_deref(), Some("deepseek-chat"));
    assert_eq!(missing_selector.api_key_env, None);
    let missing_environment = manager.session_config("missing-environment-value").unwrap();
    assert_eq!(
        missing_environment.api_key_env.as_deref(),
        Some("MISSING_SERVER_REPAIR_KEY")
    );
    let unavailable_managed = manager.session_config("unavailable-managed-auth").unwrap();
    assert_eq!(unavailable_managed.backend.as_deref(), Some("arcee-auth"));
    assert_eq!(unavailable_managed.api_key_env, None);
    assert!(
        manager.inner.active_sessions.read().await.is_empty(),
        "reading persisted settings must not attach any session"
    );

    for session_id in [
        "missing-selector",
        "missing-environment-value",
        "unavailable-managed-auth",
    ] {
        let error = manager.snapshot(session_id).await.unwrap_err();
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }
    assert!(manager.inner.active_sessions.read().await.is_empty());

    for session_id in ["missing-selector", "missing-environment-value"] {
        manager
            .update_session_config(
                session_id,
                UpdateConfigRequest {
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("API-key session should be repairable with an available selector");
        assert_eq!(
            manager
                .session_config(session_id)
                .unwrap()
                .api_key_env
                .as_deref(),
            Some("OPENAI_API_KEY")
        );
    }

    manager
        .update_session_config(
            "unavailable-managed-auth",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                backend: RequestField::Value("arcee-api".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("unavailable managed auth should be repairable by switching credential mode");
    let repaired_auth = manager.session_config("unavailable-managed-auth").unwrap();
    assert_eq!(repaired_auth.backend.as_deref(), Some("arcee-api"));
    assert_eq!(repaired_auth.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

    let before_failed_repair = manager.session_config("missing-selector").unwrap();
    let error = manager
        .update_session_config(
            "missing-selector",
            UpdateConfigRequest {
                api_key_env: RequestField::Value("MISSING_SERVER_REPAIR_KEY".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap_err();
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    assert_eq!(
        manager.session_config("missing-selector").unwrap(),
        before_failed_repair,
        "failed repair must leave persisted settings unchanged"
    );

    let listed_after_repairs = manager.session_catalog().list(false).await.unwrap();
    assert_eq!(listed_after_repairs.len(), 4);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn structurally_invalid_raw_settings_require_explicit_transactional_repair() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("repair_structurally_invalid_settings");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-repair-key"));
    let store_path = root.join("store.db");
    for id in ["healthy", "auto", "arcee", "missing", "effort", "headers"] {
        seed_editable_session(&root, id);
    }
    for id in ["auto", "arcee", "missing", "effort", "headers"] {
        let mut raw = sessions::load_session_config(&store_path, id).unwrap();
        match id {
            "auto" => raw.backend = Some("auto".to_string()),
            "arcee" => raw.backend = Some("arcee".to_string()),
            "missing" => raw.backend = None,
            "effort" => raw.reasoning_effort = Some("ultra".to_string()),
            "headers" => raw.extra_headers_json = Some("{broken".to_string()),
            _ => unreachable!(),
        }
        sessions::update_raw_session_config(&store_path, &raw).unwrap();
    }

    let manager = test_manager(&root);
    let listed = manager.session_catalog().list(false).await.unwrap();
    assert_eq!(listed.len(), 6);
    assert_eq!(
        listed
            .iter()
            .find(|entry| entry.summary.session_id == "healthy")
            .unwrap()
            .summary
            .model_config_error,
        None
    );
    for id in ["auto", "arcee", "missing", "effort", "headers"] {
        assert!(
            listed
                .iter()
                .find(|entry| entry.summary.session_id == id)
                .unwrap()
                .summary
                .model_config_error
                .is_some(),
            "{id} should be diagnosed without breaking listing"
        );
    }

    let raw_auto = manager.session_config("auto").unwrap();
    assert_eq!(raw_auto.backend.as_deref(), Some("auto"));
    assert!(!raw_auto.diagnostics.is_empty());
    let raw_missing = manager.session_config("missing").unwrap();
    assert_eq!(raw_missing.backend, None);
    let raw_effort = manager.session_config("effort").unwrap();
    assert_eq!(raw_effort.reasoning_effort.as_deref(), Some("ultra"));
    let raw_headers = manager.session_config("headers").unwrap();
    assert_eq!(raw_headers.extra_headers_json.as_deref(), Some("{broken"));
    let Json(endpoint_headers) = delivery::session_lifecycle::session_config_handler(
        State(manager.clone()),
        AxumPath("headers".to_string()),
    )
    .await
    .unwrap();
    assert_eq!(endpoint_headers, raw_headers);
    assert!(manager.inner.active_sessions.read().await.is_empty());

    let before_failed = raw_auto.clone();
    let error = manager
        .update_session_config(
            "auto",
            UpdateConfigRequest {
                model: RequestField::Value("replacement-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap_err();
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    assert_eq!(manager.session_config("auto").unwrap(), before_failed);

    for id in ["auto", "arcee", "missing"] {
        manager
            .update_session_config(
                id,
                UpdateConfigRequest {
                    backend: RequestField::Value("openai-responses".to_string()),
                    model: RequestField::Value("replacement-model".to_string()),
                    base_url: RequestField::Value("https://api.openai.com/v1".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap();
    }
    manager
        .update_session_config(
            "effort",
            UpdateConfigRequest {
                reasoning_effort: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();
    manager
        .update_session_config(
            "headers",
            UpdateConfigRequest {
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "X-Repaired".to_string(),
                    "yes".to_string(),
                )]))),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();

    for id in ["auto", "arcee", "missing", "effort", "headers"] {
        let repaired = manager.session_config(id).unwrap();
        assert!(
            repaired.diagnostics.is_empty(),
            "{id}: {:?}",
            repaired.diagnostics
        );
        assert_eq!(repaired.config_version, 2);
        sessions::load_session(&store_path, id).expect("repaired row must strictly load");
    }
    assert_eq!(
        manager
            .session_config("headers")
            .unwrap()
            .extra_headers_json
            .as_deref(),
        Some("{\"X-Repaired\":\"yes\"}")
    );
    let _ = std::fs::remove_dir_all(root);
}
