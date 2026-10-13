use super::*;

fn backend() -> Arc<ExecutionBackend> {
    Arc::new(ExecutionBackend::Local {
        workspace_cwd: std::env::current_dir().unwrap(),
    })
}

#[tokio::test]
async fn catalog_observes_existing_human_retained_agent_and_active_pipes_without_mutation() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let human = manager.user_terminal_name(uuid::Uuid::new_v4());
    manager
        .create_user_terminal(
            human.clone(),
            "/bin/sh",
            backend.default_terminal_cwd(),
            80,
            24,
            &backend,
            nac_contracts::CommandEnvironmentSnapshot::empty(),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    let agent = manager.next_session_name();
    manager
        .create_with_cancellation(agent.clone(), "sleep 60", None, 80, 24, &backend, None)
        .await
        .unwrap();
    manager
        .retain_with_cancellation(&agent, None)
        .await
        .unwrap();
    let spawn = |owner: TerminalManager| {
        let backend = Arc::clone(&backend);
        tokio::spawn(async move {
            owner
                .exec_one_shot(
                    "printf visible; sleep 60",
                    None,
                    80,
                    24,
                    60_000,
                    100,
                    &backend,
                    None,
                )
                .await
        })
    };
    let pipe = spawn(manager.clone());
    let pipe_id = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let entries = manager.execution_catalog().await;
            if let Some(entry) = entries
                .iter()
                .find(|entry| entry.representation == ExecutionRepresentation::Log)
            {
                assert_eq!(entries.len(), 3);
                assert_eq!(entry.origin, ExecutionOrigin::Agent);
                assert!(entry.alive && entry.stop && !entry.input && !entry.resize);
                break entry.id.clone();
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    for _ in 0..5 {
        manager
            .read_execution_output(&pipe_id, 0, 64)
            .await
            .unwrap();
        let entries = manager.execution_catalog().await;
        assert_eq!(entries.len(), 3);
        assert!(
            entries
                .iter()
                .find(|entry| entry.id == agent)
                .unwrap()
                .retained
        );
        assert_eq!(manager.sessions.lock().await[&agent].preview_cursor(), 0);
    }
    let raw_id = manager
        .pipe_executions
        .lock()
        .unwrap()
        .back()
        .unwrap()
        .output_id
        .clone();
    assert!(manager.read_execution_output(&raw_id, 0, 64).await.is_err());
    assert!(TerminalManager::for_direct()
        .read_execution_output(&pipe_id, 0, 64)
        .await
        .is_err());
    manager.stop_execution(&pipe_id).await.unwrap();
    assert_eq!(pipe.await.unwrap().status, CommandStatus::Cancelled);
    assert!(manager.execution_status(&human).await.unwrap().alive);
    assert!(manager.execution_status(&agent).await.unwrap().alive);
    let command = spawn(manager.for_human_command("exact-request".into()));
    let command_id = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let entries = manager.execution_catalog().await;
            if let Some(entry) = entries
                .iter()
                .find(|entry| entry.origin == ExecutionOrigin::HumanCommand)
            {
                assert_eq!(entry.request_id.as_deref(), Some("exact-request"));
                assert!(entries.iter().any(|entry| entry.id == human));
                assert!(entries
                    .iter()
                    .any(|entry| entry.id == agent && entry.retained));
                break entry.id.clone();
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    manager.stop_execution(&command_id).await.unwrap();
    assert_eq!(command.await.unwrap().status, CommandStatus::Cancelled);
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn sanitized_pipe_and_pty_pages_never_expose_split_launch_secrets_or_remask_markers() {
    let manager = TerminalManager::for_direct();
    let environment = nac_contracts::CommandEnvironmentSnapshot::from_parts(
        Default::default(),
        vec!["secret".into(), "REDACTED".into(), "s\x01ecret".into()],
    );
    let output = manager
        .exec_one_shot_sanitized(
            "printf sec; sleep .03; printf ret; printf ' s\\001ecret tail' >&2",
            None,
            80,
            24,
            5000,
            1000,
            &backend(),
            None,
            &[],
            environment.clone(),
        )
        .await;
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.stdout_preview, "[REDACTED]");
    assert_eq!(output.stderr_preview, " [REDACTED] tail");
    let status = manager.execution_catalog().await.pop().unwrap();
    assert!(!status.alive && status.output_complete);
    let mut cursor = 0;
    let mut bytes = Vec::new();
    loop {
        let page = manager
            .read_execution_output(&status.id, cursor, 1)
            .await
            .unwrap();
        cursor = page.next_offset;
        bytes.extend(page.bytes);
        if page.caught_up {
            break;
        }
    }
    assert_eq!(bytes, b"[REDACTED] [REDACTED] tail");
    let agent = manager.next_session_name();
    manager
        .create_sanitized(
            agent.clone(),
            "printf sec; sleep .03; printf ret",
            None,
            80,
            24,
            &backend(),
            None,
            &[],
            environment,
        )
        .await
        .unwrap();
    let output = manager
        .write_stdin(&agent, "", 1000, 1000, None)
        .await
        .unwrap();
    assert_eq!(output.content_preview, "[REDACTED]");
    assert_eq!(
        manager
            .read_execution_output(&agent, 0, 100)
            .await
            .unwrap()
            .bytes,
        b"[REDACTED]"
    );
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn observing_pipes_does_not_apply_the_pty_session_admission_limit() {
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 1;
    let mut tasks = Vec::new();
    for _ in 0..2 {
        let mut owner = manager.clone();
        // Production has no test-only prespawn barrier; isolate those gates
        // while retaining the same process/output owner for both launches.
        owner.one_shot_spawn_gate = Arc::new(Mutex::new(()));
        tasks.push(tokio::spawn(async move {
            owner
                .exec_one_shot("sleep 60", None, 80, 24, 60_000, 100, &backend(), None)
                .await
        }));
    }
    let entries = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let entries = manager.execution_catalog().await;
            if entries.len() == 2 {
                break entries;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    for entry in entries {
        manager.stop_execution(&entry.id).await.unwrap();
    }
    for task in tasks {
        assert_eq!(task.await.unwrap().status, CommandStatus::Cancelled);
    }
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn natural_human_exit_is_observed_without_archival_or_process_refresh() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let id = manager.user_terminal_name(uuid::Uuid::new_v4());
    manager
        .create_user_terminal(
            id.clone(),
            "printf completed; exit 7",
            backend.default_terminal_cwd(),
            80,
            24,
            &backend,
            nac_contracts::CommandEnvironmentSnapshot::empty(),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    let status = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = manager.execution_status(&id).await.unwrap();
            if !status.alive && status.output_complete {
                break status;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(status.exit_code, Some(7));
    assert_eq!(status.process_state, ExecutionProcessState::Settled);
    assert!(!status.stop && !status.input && !status.resize);
    assert!(manager.sessions.lock().await.contains_key(&id));
    assert!(manager.completed_sessions.lock().await.is_empty());
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn ordinary_pty_line_endings_do_not_expose_control_bearing_launch_secrets() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let environment = nac_contracts::CommandEnvironmentSnapshot::from_parts(
        std::collections::BTreeMap::from([(
            "NAC_MULTILINE_SECRET".into(),
            "synthetic-private\nsecond-line".into(),
        )]),
        vec!["synthetic-private\nsecond-line".into()],
    );
    let envs = environment
        .iter()
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect::<Vec<_>>();
    let agent = manager.next_session_name();
    manager
        .create_sanitized(
            agent.clone(),
            "printf '%s' \"$NAC_MULTILINE_SECRET\"",
            None,
            80,
            24,
            &backend,
            None,
            &envs,
            environment.clone(),
        )
        .await
        .unwrap();
    let output = manager
        .write_stdin(&agent, "", 1000, 1000, None)
        .await
        .unwrap();
    assert_eq!(output.content_preview, "[REDACTED]");
    let human = manager.user_terminal_name(uuid::Uuid::new_v4());
    manager
        .create_user_terminal(
            human.clone(),
            "printf '%s' \"$NAC_MULTILINE_SECRET\"",
            backend.default_terminal_cwd(),
            80,
            24,
            &backend,
            environment,
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !manager
            .execution_status(&human)
            .await
            .unwrap()
            .output_complete
        {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        manager
            .read_execution_output(&human, 0, 1000)
            .await
            .unwrap()
            .bytes,
        b"[REDACTED]"
    );
    manager.remove_all().await.unwrap();
}
