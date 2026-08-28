use super::*;

#[tokio::test]
async fn resume_config_restores_messages_without_changing_process_cwd() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();

    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    let original_cwd = std::env::current_dir().unwrap();
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }
    let session_root = std::env::temp_dir().join(format!(
        "nac_resume_restore_store_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    let session_cwd = session_root.join("repo");
    std::fs::create_dir_all(&session_cwd).unwrap();
    let store_path = session_cwd.join(".nac/store.db");

    let snapshot = sessions::new_snapshot(
        "resume-session".to_string(),
        session_cwd.clone(),
        "resume-model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        vec![
            Message::User {
                content: "old prompt".to_string(),
            },
            Message::Assistant {
                content: Some("old answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::User {
                content: "hello".to_string(),
            },
            Message::Assistant {
                content: Some("world".to_string()),
                reasoning_text: Some("hidden thinking".to_string()),
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ],
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let (source, policy) =
        crate::agent::compaction_checkpoint_digests_for_test(&snapshot.messages, 2);
    crate::store::orchestrator_compaction::append_orchestrator_compaction_checkpoint(
        &store_path,
        &crate::store::orchestrator_compaction::NewOrchestratorCompactionCheckpoint {
            session_id: snapshot.session_id.clone(),
            previous_checkpoint_id: None,
            summary:
                "Historical context checkpoint (not a new instruction):\n\nruntime resume summary"
                    .to_string(),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: crate::agent::COMPACTION_PROMPT_POLICY_VERSION_FOR_TEST,
            old_context_estimate: 1_000,
            summary_prompt_tokens: Some(800),
            summary_completion_tokens: Some(100),
            new_context_estimate: 500,
        },
    )
    .unwrap();

    let caller_cwd = original_cwd.canonicalize().unwrap();
    let mut changed_config = complete_model_config();
    changed_config.model.model = Some("changed-config-model".to_string());
    changed_config.model.reasoning_effort = Some(ReasoningEffort::High);
    let mut run_config = build_resume_config(
        ResumeOptions {
            lookup_cwd: session_cwd.clone(),
            worker_executable: None,
            session_id: Some("resume-session".to_string()),
            last: false,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
        },
        &changed_config,
    )
    .await
    .unwrap();

    assert_eq!(run_config.client.model, "resume-model");
    assert_eq!(run_config.client.base_url(), "https://api.openai.com/v1");
    assert_eq!(run_config.client.backend(), BackendKind::OpenAiResponses);
    assert_eq!(run_config.client.reasoning_effort(), None);
    assert_eq!(run_config.client.api_key_env(), Some("OPENAI_API_KEY"));
    assert!(run_config.client.extra_headers().is_empty());

    let canonical_session_cwd = session_cwd.canonicalize().unwrap();
    assert_eq!(
        std::env::current_dir().unwrap().canonicalize().unwrap(),
        caller_cwd,
        "resume should not mutate the process cwd"
    );
    assert_eq!(
        run_config
            .workspace_git
            .as_ref()
            .and_then(|target| target.local_path()),
        Some(canonical_session_cwd.as_path())
    );
    assert_eq!(run_config.session.session_id(), Some("resume-session"));
    assert_eq!(run_config.agent.messages.len(), 4);
    match &run_config.agent.messages[2] {
        Message::User { content } => assert_eq!(content, "hello"),
        other => panic!("expected restored user message, got {:?}", other),
    }
    match &run_config.agent.messages[3] {
        Message::Assistant {
            content: Some(content),
            reasoning_text: Some(reasoning),
            ..
        } => {
            assert_eq!(content, "world");
            assert_eq!(reasoning, "hidden thinking");
        }
        other => panic!("expected restored assistant message, got {:?}", other),
    }
    let projected = run_config.agent.provider_messages_for_test();
    let projected_json = serde_json::to_string(&projected).unwrap();
    assert!(projected_json.contains("runtime resume summary"));
    assert!(projected_json.contains("hello"));
    assert!(!projected_json.contains("old prompt"));
    assert!(!projected_json.contains("old answer"));
    assert!(serde_json::to_string(&run_config.agent.messages)
        .unwrap()
        .contains("old answer"));

    let _ = std::fs::remove_dir_all(session_root);
    restore_env("OPENAI_API_KEY", original_api_key);
}

#[test]
fn normalize_snapshot_paths_uses_remote_cwd_verbatim_without_local_checks() {
    let missing_remote_cwd = PathBuf::from(format!(
        "/remote/workspace/missing-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    assert!(!missing_remote_cwd.exists());
    let snapshot = sessions::new_snapshot(
        "remote-session".to_string(),
        missing_remote_cwd.clone(),
        "model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        Some(SshConnection::new("build-box")),
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );

    let normalized = normalize_snapshot_paths(snapshot, Path::new("/local/resume/base")).unwrap();
    assert_eq!(
        normalized.cwd, missing_remote_cwd,
        "remote cwd must be used verbatim with no canonicalization"
    );

    let relative = sessions::new_snapshot(
        "remote-relative".to_string(),
        PathBuf::from("workspace/repo"),
        "model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        Some(SshConnection::new("build-box")),
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    let normalized = normalize_snapshot_paths(relative, Path::new("/local/resume/base")).unwrap();
    assert_eq!(normalized.cwd, PathBuf::from("workspace/repo"));
}

#[tokio::test]
async fn resume_rejects_ssh_snapshot_with_sandbox_metadata_before_restore() {
    let snapshot = sessions::new_snapshot(
        "malformed-remote".to_string(),
        PathBuf::from("~/repo"),
        "model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        Some(SandboxSpec::default()),
        Some(SshConnection::new("build-box")),
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );

    let error = match build_resume_config_from_snapshot(
        snapshot,
        temp_store_path("malformed_remote_resume"),
        &NacConfig::default(),
        PathBuf::from("/local/resume/base"),
        None,
        None,
        true,
        None,
        ResumeModelOptions::default(),
    )
    .await
    {
        Ok(_) => panic!("ssh snapshots with sandbox metadata must fail before podman restore"),
        Err(error) => error,
    };

    assert!(
        error.to_string().contains("ssh_host") && error.to_string().contains("sandbox"),
        "got: {error:#}"
    );
}

#[tokio::test]
async fn invalid_legacy_snapshot_requires_settings_repair_without_persistence() {
    let store_path = temp_store_path("invalid_legacy_model_snapshot");
    let snapshot = sessions::new_snapshot(
        "legacy-invalid-model".to_string(),
        PathBuf::from("~/repo"),
        "   ".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        Some(SshConnection::new("build-box")),
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );

    let error = match build_resume_config_from_snapshot(
        snapshot,
        store_path.clone(),
        &complete_model_config(),
        PathBuf::from("/local/resume/base"),
        None,
        None,
        true,
        None,
        ResumeModelOptions::default(),
    )
    .await
    {
        Ok(_) => panic!("invalid legacy model settings must not resume"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("settings repair required"),
        "{error:#}"
    );
    assert!(error.to_string().contains("model"), "{error:#}");
    assert!(!store_path.exists());
}

#[test]
fn normalize_snapshot_paths_still_canonicalizes_local_sessions() {
    let missing_local_cwd = std::env::temp_dir().join(format!(
        "nac_missing_local_cwd_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos()
    ));
    let snapshot = sessions::new_snapshot(
        "local-session".to_string(),
        missing_local_cwd.clone(),
        "model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );

    let error = normalize_snapshot_paths(snapshot, Path::new("/")).unwrap_err();
    assert!(
        error.to_string().contains("failed to resolve session cwd"),
        "local sessions must keep failing on a missing cwd, got: {error:#}"
    );
}

#[test]
fn normalize_snapshot_paths_keeps_missing_live_cwd_for_worktree_sessions() {
    let missing_live_cwd = PathBuf::from("/missing/live/repo/subdir");
    let sandbox = SandboxSpec {
        worktree: Some(crate::sandbox::SandboxWorktree {
            repo_root: PathBuf::from("/missing/live/repo"),
            path: PathBuf::from("/nac/worktrees/session"),
            scratch_root: PathBuf::from("/nac/worktrees"),
            branch: "nac/session".to_string(),
            fork_point: "abc123".to_string(),
        }),
        ..Default::default()
    };
    let snapshot = sessions::new_snapshot(
        "sandbox-session".to_string(),
        missing_live_cwd.clone(),
        "model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        Some(sandbox),
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );

    let normalized = normalize_snapshot_paths(snapshot, Path::new("/")).unwrap();
    assert_eq!(normalized.cwd, missing_live_cwd);
}

#[tokio::test]
async fn resume_remote_session_skips_local_path_checks_and_rebuilds_system_prompt() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();

    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let store_root = std::env::temp_dir().join(format!("nac_remote_resume_{}", unique));
    let store_path = store_root.join("store.db");
    let remote_cwd = PathBuf::from(format!("/remote/workspace/missing-{}", unique));
    assert!(!remote_cwd.exists());

    store::initialize(&store_path).unwrap();

    let snapshot = sessions::new_snapshot(
        "remote-session".to_string(),
        remote_cwd.clone(),
        "resume-model".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        Some(SshConnection::new("build-box")),
        vec![
            Message::System {
                content: "You are nac. Working directory: /old/stale/local/path.".to_string(),
            },
            Message::User {
                content: "hello".to_string(),
            },
        ],
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();

    let run_config = build_resume_config(
        ResumeOptions {
            lookup_cwd: std::env::temp_dir(),
            worker_executable: None,
            session_id: Some("remote-session".to_string()),
            last: false,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
        },
        &NacConfig::default(),
    )
    .await
    .expect("remote resume must not perform local path checks");

    assert_eq!(run_config.session.session_id(), Some("remote-session"));
    assert_eq!(
        run_config.workspace_display,
        remote_cwd.display().to_string()
    );
    assert_eq!(run_config.agent.messages.len(), 2);
    match &run_config.agent.messages[0] {
        Message::System { content } => {
            assert!(
                content.contains(&format!("Working directory: {}", remote_cwd.display())),
                "system prompt must be rebuilt from the resolved cwd, got: {content}"
            );
            assert!(
                !content.contains("/old/stale/local/path"),
                "stale pinned working directory must not be replayed"
            );
        }
        other => panic!("expected rebuilt system prompt, got {:?}", other),
    }
    match &run_config.agent.messages[1] {
        Message::User { content } => assert_eq!(content, "hello"),
        other => panic!("expected restored user message, got {:?}", other),
    }

    let _ = std::fs::remove_dir_all(&store_root);
    restore_env("OPENAI_API_KEY", original_api_key);
}

#[tokio::test]
async fn create_remote_session_with_ssh_host_skips_local_checks_and_persists_target() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();

    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    let original_remote_cwd = std::env::var_os("NAC_TEST_CANONICAL_REMOTE_CWD");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let store_root = std::env::temp_dir().join(format!("nac_remote_create_{}", unique));
    let store_path = store_root.join("store.db");
    let remote_cwd = PathBuf::from(format!("/remote/workspace/create-{}", unique));
    assert!(!remote_cwd.exists());
    unsafe {
        std::env::set_var("NAC_TEST_CANONICAL_REMOTE_CWD", &remote_cwd);
    }

    store::initialize(&store_path).unwrap();

    let run_config = build_run_config(
        RunOptions {
            workspace_cwd: remote_cwd.clone(),
            config_cwd: None,
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            orchestrator_compaction_threshold: None,
            sandbox: SandboxOptions::default(),
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    .expect("remote session creation must not perform local path checks");

    assert_eq!(
        run_config.workspace_display,
        remote_cwd.display().to_string()
    );
    let workspace_git = run_config
        .workspace_git
        .as_ref()
        .expect("a remote session must still have a git target");
    assert_eq!(workspace_git.ssh_host(), Some("build-box"));
    assert_eq!(
        workspace_git.local_path(),
        None,
        "remote sessions must not expose a local path for git inspection"
    );
    assert_eq!(run_config.sandbox_status, "off");
    match &run_config.agent.messages[0] {
        Message::System { content } => assert!(
            content.contains(&format!("Working directory: {}", remote_cwd.display())),
            "system prompt must use the remote cwd, got: {content}"
        ),
        other => panic!("expected system prompt, got {:?}", other),
    }

    let session_id = run_config
        .session
        .session_id()
        .expect("remote creation must produce an active session")
        .to_string();
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(
        stored.ssh.as_ref().map(|c| c.host.as_str()),
        Some("build-box")
    );
    assert_eq!(stored.cwd, remote_cwd);
    assert_eq!(stored.model, "test-model");
    assert_eq!(stored.base_url, "https://api.openai.com/v1");
    assert_eq!(stored.backend, BackendKind::OpenAiResponses);
    assert_eq!(stored.reasoning_effort, None);
    assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert!(stored.extra_headers.is_empty());
    assert!(stored.sandbox_spec.is_none());

    let _ = std::fs::remove_dir_all(&store_root);
    restore_env("OPENAI_API_KEY", original_api_key);
    restore_env("NAC_TEST_CANONICAL_REMOTE_CWD", original_remote_cwd);
}

#[tokio::test]
async fn ssh_fresh_run_resume_base_and_resume_control_socket_use_local_config_cwd() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    let original_nac_home = std::env::var_os("NAC_HOME");
    let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
    let original_remote_cwd = std::env::var_os("NAC_TEST_CANONICAL_REMOTE_CWD");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        std::env::remove_var("XDG_CONFIG_HOME");
    }

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let local_root = std::env::temp_dir().join(format!("nac_remote_run_resume_{unique}"));
    let config_cwd = local_root.join("hub");
    let nac_home_rel = PathBuf::from(format!("relative-nac-home-{unique}"));
    let expected_nac_home = config_cwd.join(&nac_home_rel);
    let remote_cwd = PathBuf::from(format!("/remote/workspace/run-{unique}"));
    assert!(!remote_cwd.exists());
    unsafe {
        std::env::set_var("NAC_HOME", &nac_home_rel);
        std::env::set_var("NAC_TEST_CANONICAL_REMOTE_CWD", &remote_cwd);
    }

    let run_config = build_run_config(
        RunOptions {
            workspace_cwd: remote_cwd.clone(),
            config_cwd: Some(config_cwd.clone()),
            worker_executable: None,
            store: StoreOptions::default(),
            model: test_openai_model_options(),
            orchestrator_compaction_threshold: None,
            sandbox: SandboxOptions::default(),
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    .expect("fresh remote session should use local config cwd for nac state");

    assert_eq!(run_config.resume_base_cwd(), config_cwd.as_path());
    assert_eq!(
        run_config.session.store_path(),
        expected_nac_home.join("store.db")
    );
    let fresh_control_path = run_config
        .agent
        .ssh_control_path_for_test()
        .expect("fresh remote session should use ssh backend");
    assert!(
        fresh_control_path.starts_with(expected_nac_home.join("ssh")),
        "fresh control socket should be under local config cwd, got {}",
        fresh_control_path.display()
    );

    let session_id = run_config.session.session_id().unwrap().to_string();
    let store_path = run_config.session.store_path();
    let resume_base_cwd = run_config.resume_base_cwd().to_path_buf();
    let resumed = build_resume_config_for_session(
        store_path,
        &session_id,
        &NacConfig::default(),
        resume_base_cwd,
        None,
        ResumeModelOptions::default(),
    )
    .await
    .expect("remote resume should keep using the local config cwd");

    assert_eq!(resumed.resume_base_cwd(), config_cwd.as_path());
    let resumed_control_path = resumed
        .agent
        .ssh_control_path_for_test()
        .expect("resumed remote session should use ssh backend");
    assert!(
        resumed_control_path.starts_with(expected_nac_home.join("ssh")),
        "resumed control socket should be under local config cwd, got {}",
        resumed_control_path.display()
    );
    assert!(
        !resumed_control_path.starts_with(remote_cwd.join(&nac_home_rel)),
        "remote cwd must not be used as the relative NAC_HOME base"
    );

    let _ = std::fs::remove_dir_all(&local_root);
    restore_env("OPENAI_API_KEY", original_api_key);
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    restore_env("NAC_TEST_CANONICAL_REMOTE_CWD", original_remote_cwd);
}

#[tokio::test]
async fn invalid_ssh_sandbox_configs_do_not_initialize_store() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }

    let run_store_path = temp_store_path("invalid_ssh_sandbox_run");
    let run_store_root = run_store_path.parent().unwrap().to_path_buf();
    assert!(!run_store_root.exists());
    let run_error = match build_run_config(
        RunOptions {
            workspace_cwd: PathBuf::from("~"),
            config_cwd: Some(std::env::temp_dir()),
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(run_store_path.clone()),
            },
            model: test_openai_model_options(),
            orchestrator_compaction_threshold: None,
            sandbox: SandboxOptions {
                sandbox: true,
                ..SandboxOptions::default()
            },
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    {
        Ok(_) => panic!("ssh run with sandbox should fail before creating the store"),
        Err(error) => error,
    };
    assert!(
        run_error.to_string().contains("ssh_host") && run_error.to_string().contains("sandbox"),
        "got: {run_error:#}"
    );
    assert!(
        !run_store_root.exists(),
        "invalid run config created store dir {}",
        run_store_root.display()
    );

    let worker_store_path = temp_store_path("invalid_ssh_sandbox_worker");
    let worker_store_root = worker_store_path.parent().unwrap().to_path_buf();
    assert!(!worker_store_root.exists());
    let worker_error = match build_managed_worker_config(
        ManagedWorkerOptions {
            workspace_cwd: PathBuf::from("~"),
            config_cwd: Some(std::env::temp_dir()),
            dispatch: WorkerDispatchOptions {
                session_id: "remote-session".to_string(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "do remote work".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(worker_store_path.clone()),
            },
            model: test_openai_model_options(),
            sandbox: SandboxOptions {
                sandbox: true,
                ..SandboxOptions::default()
            },
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    {
        Ok(_) => panic!("ssh worker with sandbox should fail before creating the store"),
        Err(error) => error,
    };
    assert!(
        worker_error.to_string().contains("ssh_host")
            && worker_error.to_string().contains("sandbox"),
        "got: {worker_error:#}"
    );
    assert!(
        !worker_store_root.exists(),
        "invalid worker config created store dir {}",
        worker_store_root.display()
    );

    restore_env("OPENAI_API_KEY", original_api_key);
}

#[tokio::test]
async fn create_remote_session_defaults_blank_cwd_to_home_and_rejects_sandbox_conflict() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();

    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }
    let store_path = temp_store_path("remote_create_defaults");
    store::initialize(&store_path).unwrap();

    let options = |workspace_cwd: PathBuf, sandbox: SandboxOptions| RunOptions {
        workspace_cwd,
        config_cwd: None,
        worker_executable: None,
        store: StoreOptions {
            store_path: Some(store_path.clone()),
        },
        model: test_openai_model_options(),
        orchestrator_compaction_threshold: None,
        sandbox,
        ssh: SshOptions {
            host: Some("build-box".to_string()),
            ..SshOptions::default()
        },
    };

    let run_config = build_run_config(
        options(PathBuf::new(), SandboxOptions::default()),
        &NacConfig::default(),
    )
    .await
    .expect("blank remote cwd should default to home");
    assert_eq!(run_config.workspace_display, "~");
    let session_id = run_config.session.session_id().unwrap().to_string();
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(stored.cwd, PathBuf::from("~"));
    assert_eq!(
        stored.ssh.as_ref().map(|c| c.host.as_str()),
        Some("build-box")
    );

    let conflicting = match build_run_config(
        options(
            PathBuf::from("~"),
            SandboxOptions {
                sandbox: true,
                ..SandboxOptions::default()
            },
        ),
        &NacConfig::default(),
    )
    .await
    {
        Ok(_) => panic!("ssh host + sandbox must be a hard configuration error"),
        Err(error) => error,
    };
    assert!(
        conflicting.to_string().contains("ssh_host") && conflicting.to_string().contains("sandbox"),
        "got: {conflicting:#}"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    restore_env("OPENAI_API_KEY", original_api_key);
}

#[tokio::test]
async fn managed_worker_with_ssh_host_reattaches_to_remote_session() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();

    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let store_root = std::env::temp_dir().join(format!("nac_remote_worker_{}", unique));
    let store_path = store_root.join("store.db");
    let remote_cwd = PathBuf::from(format!("/remote/workspace/worker-{}", unique));
    assert!(!remote_cwd.exists());

    store::initialize(&store_path).unwrap();

    let run_config = build_managed_worker_config(
        ManagedWorkerOptions {
            workspace_cwd: remote_cwd.clone(),
            config_cwd: None,
            dispatch: WorkerDispatchOptions {
                session_id: "remote-session".to_string(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "do remote work".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    .expect("remote workers must not perform local path checks");

    assert_eq!(run_config.session_id, "remote-session");
    match &run_config.agent.messages[0] {
        Message::System { content } => assert!(
            content.contains(&format!("Working directory: {}", remote_cwd.display())),
            "worker system prompt must use the remote cwd verbatim, got: {content}"
        ),
        other => panic!("expected system prompt, got {:?}", other),
    }

    let _ = std::fs::remove_dir_all(&store_root);
    restore_env("OPENAI_API_KEY", original_api_key);
}

#[tokio::test]
async fn ssh_managed_worker_skips_stdio_mcp_without_spawning() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    let original_nac_home = std::env::var_os("NAC_HOME");
    let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let nac_home = std::env::temp_dir().join(format!("nac_remote_worker_stdio_mcp_{unique}"));
    std::fs::create_dir_all(&nac_home).unwrap();
    let marker = nac_home.join("stdio-spawned");
    let shell = format!("printf spawned > {}", shell_single_quote(&marker));
    std::fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
            toml_string(&shell)
        ),
    )
    .unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &nac_home);
    }

    let store_path = temp_store_path("remote_worker_stdio_mcp");
    store::initialize(&store_path).unwrap();
    let run_config = build_managed_worker_config(
        ManagedWorkerOptions {
            workspace_cwd: PathBuf::from("~"),
            config_cwd: None,
            dispatch: WorkerDispatchOptions {
                session_id: "remote-session".to_string(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "do remote work".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    .expect("remote workers should skip stdio MCP instead of spawning it");

    assert!(run_config
        .agent
        .tool_definitions_for_test()
        .iter()
        .all(|def| !def.function.name.starts_with("mcp__")));
    assert!(
        !marker.exists(),
        "stdio MCP server was spawned despite SSH HTTP-only policy"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    let _ = std::fs::remove_dir_all(&nac_home);
    restore_env("OPENAI_API_KEY", original_api_key);
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
}

#[tokio::test]
async fn ssh_managed_worker_resolves_relative_nac_home_against_local_config_cwd() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    let original_nac_home = std::env::var_os("NAC_HOME");
    let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        std::env::remove_var("XDG_CONFIG_HOME");
    }

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let local_root =
        std::env::temp_dir().join(format!("nac_remote_worker_relative_config_{unique}"));
    let config_cwd = local_root.join("hub");
    let nac_home_rel = PathBuf::from(format!("relative-nac-home-{unique}"));
    let nac_home = config_cwd.join(&nac_home_rel);
    std::fs::create_dir_all(&nac_home).unwrap();
    let marker = nac_home.join("stdio-spawned");
    let shell = format!("printf spawned > {}", shell_single_quote(&marker));
    let (http_url, http_server) = start_fake_http_mcp_server();
    std::fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.http]
transport = "streamable_http"
url = {}

[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
            toml_string(&http_url),
            toml_string(&shell)
        ),
    )
    .unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", &nac_home_rel);
    }

    let store_path = temp_store_path("remote_worker_relative_config_mcp");
    store::initialize(&store_path).unwrap();
    let run_config = build_managed_worker_config(
        ManagedWorkerOptions {
            workspace_cwd: PathBuf::from("~"),
            config_cwd: Some(config_cwd.clone()),
            dispatch: WorkerDispatchOptions {
                session_id: "remote-session".to_string(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "do remote work".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        },
        &NacConfig::default(),
    )
    .await
    .expect("remote workers should resolve MCP config from local config cwd");

    let tool_names: Vec<_> = run_config
        .agent
        .tool_definitions_for_test()
        .iter()
        .map(|def| def.function.name.as_str())
        .collect();
    assert!(
        tool_names.contains(&"mcp__http__echo"),
        "HTTP MCP config under relative NAC_HOME was not loaded: {tool_names:?}"
    );
    assert!(
        !marker.exists(),
        "stdio MCP server was spawned despite SSH HTTP-only policy"
    );

    drop(run_config);
    http_server.join().unwrap();
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    let _ = std::fs::remove_dir_all(&local_root);
    restore_env("OPENAI_API_KEY", original_api_key);
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
}
