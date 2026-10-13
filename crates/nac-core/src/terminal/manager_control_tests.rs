use super::*;

fn backend() -> Arc<ExecutionBackend> {
    Arc::new(ExecutionBackend::Local {
        workspace_cwd: std::env::current_dir().unwrap(),
    })
}

#[tokio::test]
async fn retained_agent_and_human_handoff_keep_exact_process_and_literal_adapter() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let name = manager.next_session_name();
    manager
        .create(name.clone(), "/bin/sh", None, 80, 24, &backend)
        .await
        .unwrap();
    assert!(manager
        .transfer_input_control(&name, 1, InputController::Human, false)
        .await
        .is_err());
    manager.retain_with_cancellation(&name, None).await.unwrap();
    let pid = manager.sessions.lock().await[&name].pid();
    let prepared = manager.prepare_model_input(&name).unwrap();
    manager
        .transfer_input_control(&name, 1, InputController::Human, false)
        .await
        .unwrap();
    assert!(manager.revalidate_model_input(&name, &prepared).is_err());
    assert!(manager
        .write_stdin_prepared(&name, "echo stale<RET>", 1, 100, None, Some(&prepared))
        .await
        .is_err());
    let cancellation = ThreadCancellation::default();
    assert!(manager
        .write_controlled_human_input(&name, 1, b"wrong\n", &cancellation)
        .await
        .is_err());
    manager
        .write_controlled_human_input(&name, 2, b"printf 'literal:<RET>\\n'\n", &cancellation)
        .await
        .unwrap();
    manager
        .transfer_input_control(&name, 2, InputController::Agent, false)
        .await
        .unwrap();
    manager
        .write_stdin(&name, "printf 'model-ok\\n'<RET>", 50, 1000, None)
        .await
        .unwrap();
    assert_eq!(manager.sessions.lock().await[&name].pid(), pid);
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
            &cancellation,
        )
        .await
        .unwrap();
    assert!(manager.prepare_model_input(&human).is_err());
    manager
        .transfer_input_control(&human, 1, InputController::Agent, false)
        .await
        .unwrap();
    let ticket = manager.prepare_model_input(&human).unwrap();
    let human_pid = manager.sessions.lock().await[&human].pid();
    manager
        .write_stdin_prepared(
            &human,
            "printf 'human-model-ok\\n'<RET>",
            10,
            100,
            None,
            Some(&ticket),
        )
        .await
        .unwrap();
    assert_eq!(manager.sessions.lock().await[&human].pid(), human_pid);
    manager
        .transfer_input_control(&human, 2, InputController::Human, false)
        .await
        .unwrap();
    assert!(manager
        .write_user_input(&human, b"legacy-stale\n", &cancellation)
        .await
        .is_err());
    manager
        .write_controlled_human_input(&human, 3, b"echo fresh\n", &cancellation)
        .await
        .unwrap();
    manager.terminate(&human).await.unwrap();
    assert!(manager.input_control_status(&human).await.is_err());
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn controller_ticket_binds_replacement_and_session_owner() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let name = manager.next_session_name();
    manager
        .create(name.clone(), "sleep 60", None, 80, 24, &backend)
        .await
        .unwrap();
    let ticket = manager.prepare_model_input(&name).unwrap();
    manager
        .create(name.clone(), "sleep 60", None, 80, 24, &backend)
        .await
        .unwrap();
    assert!(manager.revalidate_model_input(&name, &ticket).is_err());
    assert!(TerminalManager::for_direct()
        .prepare_model_input(&name)
        .is_err());
    assert!(manager
        .transfer_input_control(&name, 1, InputController::Human, false)
        .await
        .is_err());
    manager.remove_all().await.unwrap();
}
