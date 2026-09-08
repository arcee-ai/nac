use super::*;

#[tokio::test]
async fn steering_routes_reject_blank_before_lookup_and_keep_inactive_conflicts() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("steering_validation");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let app = router(test_manager(&root));

    for (uri, instruction, expected) in [
        (
            "/sessions/missing/steering",
            "  \n ",
            StatusCode::BAD_REQUEST,
        ),
        (
            "/sessions/missing/threads/worker/steering",
            "\t",
            StatusCode::BAD_REQUEST,
        ),
        (
            "/sessions/session/steering",
            "redirect",
            StatusCode::CONFLICT,
        ),
        (
            "/sessions/session/threads/worker/steering",
            "redirect",
            StatusCode::CONFLICT,
        ),
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({ "instruction": instruction }).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected, "{uri}: {instruction:?}");
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn active_run_accepts_orchestrator_steering() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("orchestrator_steering");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);

    manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "begin the original task".to_string(),
            },
        )
        .await
        .unwrap();
    let steering = manager
        .queue_orchestrator_steering(
            "session",
            OrchestratorSteeringRequest {
                instruction: "change direction".to_string(),
            },
        )
        .await
        .unwrap();
    assert_eq!(steering.status, "queued");
    let records = manager.snapshot("session").await.unwrap().thread_steering;
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].thread_name, "__orchestrator__");
    assert_eq!(records[0].instruction, "change direction");

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cancel_active_run_route_is_idempotent() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cancel_idempotent");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "begin the original task".to_string(),
            },
        )
        .await
        .unwrap();
    let app = router(manager);
    let request = || {
        Request::builder()
            .method("POST")
            .uri("/sessions/session/cancel-active-run")
            .body(Body::empty())
            .unwrap()
    };

    let (first, second) = tokio::join!(
        app.clone().oneshot(request()),
        app.clone().oneshot(request())
    );
    assert_eq!(first.unwrap().status(), StatusCode::ACCEPTED);
    assert_eq!(second.unwrap().status(), StatusCode::ACCEPTED);
    assert_eq!(
        app.clone().oneshot(request()).await.unwrap().status(),
        StatusCode::ACCEPTED
    );

    let terminal_events = service
        .recent_events(None, 64)
        .1
        .into_iter()
        .filter(|envelope| {
            matches!(
                envelope.event,
                nac_core::events::SessionEvent::RunCompleted { .. }
                    | nac_core::events::SessionEvent::RunFailed { .. }
                    | nac_core::events::SessionEvent::RunCancelled
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(terminal_events.len(), 1);
    assert_eq!(
        terminal_events[0].event,
        nac_core::events::SessionEvent::RunCancelled
    );
    assert!(service.active_run().is_none());
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deletion_winning_lifecycle_gate_prevents_late_submission_recreation() {
    let root = temp_root("delete_before_submit");
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("session");
    let blocker = gate.lock().await;

    let (delete_started_tx, delete_started_rx) = tokio::sync::oneshot::channel();
    let delete_manager = manager.clone();
    let delete = tokio::spawn(async move {
        delete_started_tx.send(()).unwrap();
        delete_manager.delete_session("session").await
    });
    delete_started_rx.await.unwrap();
    tokio::task::yield_now().await;

    let submit_manager = manager.clone();
    let submit = tokio::spawn(async move {
        submit_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "must not revive deleted state".to_string(),
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(!delete.is_finished());
    assert!(!submit.is_finished());

    drop(blocker);
    tokio::time::timeout(Duration::from_secs(2), delete)
        .await
        .expect("delete should acquire the lifecycle gate")
        .unwrap()
        .unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), submit)
        .await
        .expect("submission should observe the deletion")
        .unwrap()
        .unwrap_err();
    assert!(error.to_string().contains("was not found"), "{error:#}");
    assert!(sessions::load_session(&root.join("store.db"), "session").is_err());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn submission_winning_lifecycle_gate_makes_concurrent_patch_reject_busy() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("submit_before_patch");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let original_service = manager.attach_session("session").await.unwrap();

    let gate = manager.lifecycle_gate("session");
    let blocker = gate.lock().await;
    let (submit_started_tx, submit_started_rx) = tokio::sync::oneshot::channel();
    let submit_manager = manager.clone();
    let submit = tokio::spawn(async move {
        submit_started_tx.send(()).unwrap();
        submit_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "hold this run open".to_string(),
                },
            )
            .await
    });
    submit_started_rx.await.unwrap();
    tokio::task::yield_now().await;

    let (patch_started_tx, patch_started_rx) = tokio::sync::oneshot::channel();
    let patch_manager = manager.clone();
    let patch = tokio::spawn(async move {
        patch_started_tx.send(()).unwrap();
        patch_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("model-after-update".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
    });
    patch_started_rx.await.unwrap();
    tokio::task::yield_now().await;
    assert!(!submit.is_finished());
    assert!(!patch.is_finished());

    drop(blocker);
    let submitted = tokio::time::timeout(Duration::from_secs(2), submit)
        .await
        .expect("submission should acquire the gate")
        .unwrap()
        .unwrap();
    let patch_error = tokio::time::timeout(Duration::from_secs(2), patch)
        .await
        .expect("patch should run after submission")
        .unwrap()
        .unwrap_err();
    assert!(patch_error
        .to_string()
        .contains("busy with an active operation"));
    assert_eq!(ApiError::from(patch_error).status, StatusCode::CONFLICT);
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "session")
            .unwrap()
            .model,
        "model-a"
    );
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(Arc::ptr_eq(&mapped, &original_service));
    assert_eq!(
        mapped.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn patch_winning_lifecycle_gate_evicts_before_concurrent_submission_attaches() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("patch_before_submit");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let stale_service = manager.attach_session("session").await.unwrap();

    let gate = manager.lifecycle_gate("session");
    let blocker = gate.lock().await;
    let (patch_started_tx, patch_started_rx) = tokio::sync::oneshot::channel();
    let patch_manager = manager.clone();
    let patch = tokio::spawn(async move {
        patch_started_tx.send(()).unwrap();
        patch_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("model-after-update".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
    });
    patch_started_rx.await.unwrap();
    tokio::task::yield_now().await;

    let (submit_started_tx, submit_started_rx) = tokio::sync::oneshot::channel();
    let submit_manager = manager.clone();
    let submit = tokio::spawn(async move {
        submit_started_tx.send(()).unwrap();
        submit_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "use committed settings".to_string(),
                },
            )
            .await
    });
    submit_started_rx.await.unwrap();
    tokio::task::yield_now().await;
    assert!(!patch.is_finished());
    assert!(!submit.is_finished());

    drop(blocker);
    tokio::time::timeout(Duration::from_secs(2), patch)
        .await
        .expect("patch should acquire the gate")
        .unwrap()
        .unwrap();
    let submitted = tokio::time::timeout(Duration::from_secs(2), submit)
        .await
        .expect("submission should run after patch")
        .unwrap()
        .unwrap();
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(!Arc::ptr_eq(&mapped, &stale_service));
    assert_eq!(mapped.metadata().model, "model-after-update");
    assert!(stale_service.active_run().is_none());
    assert_eq!(
        mapped.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "session")
            .unwrap()
            .model,
        "model-after-update"
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn external_active_operation_lease_rejects_patch_from_independent_manager() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("external_active_patch");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let running_manager = test_manager(&root);
    let patch_manager = test_manager(&root);

    running_manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "hold cross-process lease".to_string(),
            },
        )
        .await
        .expect("first manager starts run");
    let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

    let error = patch_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("must-not-commit".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("PATCH cannot commit beneath another process run");
    assert!(error.to_string().contains("busy with an active operation"));
    assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
    let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(after.model, before.model);
    assert_eq!(after.config_version, before.config_version);
    assert!(!patch_manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));

    running_manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn stale_manager_rebuilds_all_model_authority_after_external_patch() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("external_patch_rebuild");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("SECOND_API_KEY", "second-server-key") };
    seed_editable_session(&root, "session");
    let stale_manager = test_manager(&root);
    let patch_manager = test_manager(&root);
    let stale_service = stale_manager.attach_session("session").await.unwrap();
    assert_eq!(stale_service.config_version(), Some(0));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let new_base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let endpoint = tokio::spawn(async move {
        if let Ok((socket, _)) = listener.accept().await {
            let _socket = socket;
            std::future::pending::<()>().await;
        }
    });
    let new_headers = BTreeMap::from([
        ("X-Cross-Process".to_string(), "current".to_string()),
        ("X-Revision".to_string(), "1".to_string()),
    ]);
    patch_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("model-from-other-manager".to_string()),
                base_url: RequestField::Value(new_base_url.clone()),
                backend: RequestField::Value("openai-responses".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                api_key_env: RequestField::Value("SECOND_API_KEY".to_string()),
                extra_headers: RequestField::Value(HeadersRequest(new_headers.clone())),
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("external manager commits complete model settings");
    assert_eq!(stale_service.metadata().model, "model-a");

    let submitted = stale_manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "must use externally committed authority".to_string(),
            },
        )
        .await
        .expect("stale manager converges before starting the next run");
    let current_service = stale_manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(!Arc::ptr_eq(&current_service, &stale_service));
    assert_eq!(current_service.config_version(), Some(1));
    let metadata = current_service.metadata();
    assert_eq!(metadata.model, "model-from-other-manager");
    assert_eq!(metadata.base_url, new_base_url);
    assert_eq!(metadata.backend, "openai-responses");
    assert_eq!(metadata.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(metadata.api_key_env.as_deref(), Some("SECOND_API_KEY"));
    assert_eq!(metadata.extra_headers, new_headers);
    assert_eq!(
        current_service.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );
    assert!(stale_service.active_run().is_none());

    stale_manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn ordinary_attachment_does_not_open_operation_lease_sidecar() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("attachment_without_effort_migration");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
    let snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "claude-sonnet-4-6-20251001".to_string(),
        "https://api.anthropic.com/v1".to_string(),
        BackendKind::AnthropicMessages,
        Some(ReasoningEffort::High),
        None,
        None,
        Vec::new(),
        Some("ANTHROPIC_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    std::fs::write(root.join("store.db.run-locks"), b"unavailable").unwrap();
    let manager = test_manager(&root);

    let first = manager.attach_session("session").await.unwrap();
    let second = manager.attach_session("session").await.unwrap();
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(first.config_version(), Some(0));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn attachment_takes_resource_lease_before_sandbox_materialization() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("attachment_resource_lease_order");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
    let mut snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "claude-sonnet-4-6-20251001".to_string(),
        "https://api.anthropic.com/v1".to_string(),
        BackendKind::AnthropicMessages,
        Some(ReasoningEffort::High),
        None,
        None,
        Vec::new(),
        Some("ANTHROPIC_API_KEY".to_string()),
        BTreeMap::new(),
    );
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    snapshot.behavior = sessions::SessionBehavior::Direct;
    let store_path = root.join("store.db");
    sessions::create_session(&store_path, &snapshot).unwrap();
    let mutation =
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "session").unwrap();
    let manager = test_manager(&root);

    let error = match manager.attach_session("session").await {
        Ok(_) => panic!("exclusive deletion authority must precede Podman inspection"),
        Err(error) => error,
    };
    assert!(error.to_string().contains("busy with an active operation"));
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));

    drop(mutation);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn busy_attachment_is_transient_and_next_attach_observes_durable_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("busy_transient_effort_recovery");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
    let snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "claude-sonnet-4-6-20251001".to_string(),
        "https://api.anthropic.com/v1".to_string(),
        BackendKind::AnthropicMessages,
        Some(ReasoningEffort::Xhigh),
        None,
        None,
        Vec::new(),
        Some("ANTHROPIC_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let lease =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session").unwrap();
    let reader = test_manager(&root);
    let writer = test_manager(&root);

    let transient = reader.attach_session("session").await.unwrap();
    assert_eq!(
        transient.metadata().reasoning_effort.as_deref(),
        Some("high")
    );
    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Xhigh));
    assert_eq!(stored.config_version, 0);

    drop(lease);
    writer
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("claude-opus-4-6".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();

    let current = reader.attach_session("session").await.unwrap();
    assert_eq!(current.metadata().model, "claude-opus-4-6");
    assert_eq!(current.metadata().reasoning_effort.as_deref(), Some("high"));
    assert_eq!(current.config_version(), Some(1));
    let cached = reader.attach_session("session").await.unwrap();
    assert!(Arc::ptr_eq(&current, &cached));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn independent_manager_patch_rejects_held_shared_lease() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cross_manager_config_lease");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let first_manager = test_manager(&root);
    let second_manager = test_manager(&root);
    let held = sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session")
        .expect("first process lease");

    let conflict = second_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("blocked-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("a concurrent shared lease must reject PATCH without waiting");
    assert!(conflict
        .to_string()
        .contains("busy with an active operation"));
    assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "session")
            .unwrap()
            .model,
        "model-a"
    );

    drop(held);
    first_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("committed-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("dropping the other process lease permits PATCH");
    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.model, "committed-model");
    assert_eq!(stored.config_version, 1);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn independent_manager_patch_rejects_peer_sandbox_resource_lease() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cross_manager_sandbox_resource_lease");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let held = sessions::SessionResourceLease::try_acquire(&store_path, "session")
        .expect("peer attached sandbox lease");
    let manager = test_manager(&root);

    let conflict = manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("blocked-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("peer sandbox ownership must reject config replacement");
    assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);
    assert_eq!(
        sessions::load_session(&store_path, "session")
            .unwrap()
            .model,
        "model-a"
    );

    drop(held);
    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("committed-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        sessions::load_session(&store_path, "session")
            .unwrap()
            .model,
        "committed-model"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn empty_patch_does_not_touch_store_credentials_or_attached_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("empty_patch_noop");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    let before = manager.attach_session("session").await.unwrap();
    let before_metadata = before.metadata();
    let store_path = root.join("store.db");
    let hidden_store = root.join("store.db.hidden");
    std::fs::rename(&store_path, &hidden_store).unwrap();
    std::fs::create_dir(&store_path).unwrap();
    unsafe { std::env::remove_var("OPENAI_API_KEY") };

    manager
        .update_session_config("session", UpdateConfigRequest::default())
        .await
        .expect("an empty patch must not read the store or credentials");

    let after = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .expect("empty patch must preserve attached service");
    assert!(Arc::ptr_eq(&before, &after));
    assert_eq!(after.metadata().model, before_metadata.model);
    assert_eq!(after.metadata().base_url, before_metadata.base_url);
    assert_eq!(after.active_run(), None);

    std::fs::remove_dir(&store_path).unwrap();
    std::fs::rename(hidden_store, store_path).unwrap();
    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.model, "model-a");
    assert_eq!(stored.updated_at, "2026-01-01 00:00:00.000000000");
    let _ = std::fs::remove_dir_all(root);
}
