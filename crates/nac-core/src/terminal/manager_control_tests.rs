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
    let state = manager.execution_model_input_state(&human).unwrap();
    assert_eq!(state.controller, InputController::Human);
    assert_eq!(state.revision, "1");
    assert!(manager.prepare_model_input(&human).is_err());
    manager
        .transfer_input_control(&human, 1, InputController::Agent, false)
        .await
        .unwrap();
    let state = manager.execution_model_input_state(&human).unwrap();
    assert_eq!(state.controller, InputController::Agent);
    assert_eq!(state.revision, "2");
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn initial_protocol_keeps_browser_recovery_but_shared_protocol_freezes_server_admission() {
    use std::sync::{mpsc::sync_channel, Mutex};
    struct Writer {
        started: std::sync::mpsc::SyncSender<()>,
        release: std::sync::mpsc::Receiver<()>,
        bytes: Arc<Mutex<Vec<u8>>>,
        first: bool,
    }
    impl std::io::Write for Writer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.first {
                self.first = false;
                self.started.send(()).unwrap();
                self.release.recv().unwrap();
            }
            self.bytes.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    for legacy in [true, false] {
        let manager = TerminalManager::for_direct();
        let backend = backend();
        let name = manager.user_terminal_name(uuid::Uuid::new_v4());
        let cancellation = ThreadCancellation::default();
        manager
            .create_user_terminal(
                name.clone(),
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
        let (started, started_rx) = sync_channel(1);
        let (release, release_rx) = sync_channel(1);
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let _native_writer = manager
            .sessions
            .lock()
            .await
            .get_mut(&name)
            .unwrap()
            .replace_input_writer_for_test(Box::new(Writer {
                started,
                release: release_rx,
                bytes: bytes.clone(),
                first: true,
            }))
            .unwrap();
        let owner = manager.clone();
        let handle = name.clone();
        let write = tokio::spawn(async move {
            if legacy {
                owner
                    .write_user_input(&handle, b"once", &ThreadCancellation::default())
                    .await
            } else {
                owner
                    .write_controlled_human_input(
                        &handle,
                        1,
                        b"once",
                        &ThreadCancellation::default(),
                    )
                    .await
            }
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(write
            .await
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("unconfirmed"));
        assert_eq!(
            manager.input_control_status(&name).await.unwrap().frozen,
            !legacy
        );
        release.send(()).unwrap();
        if legacy {
            // Browser acknowledgement enables a new batch; it never resends
            // the original. The legacy server contract needs no new endpoint.
            manager
                .write_user_input(&name, b"fresh", &cancellation)
                .await
                .unwrap();
        } else {
            assert!(manager
                .write_controlled_human_input(&name, 1, b"rejected", &cancellation)
                .await
                .is_err());
            tokio::time::timeout(Duration::from_secs(2), async {
                while manager.input_control_status(&name).await.unwrap().in_flight {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            manager
                .transfer_input_control(&name, 1, InputController::Human, true)
                .await
                .unwrap();
            manager
                .write_controlled_human_input(&name, 2, b"fresh", &cancellation)
                .await
                .unwrap();
            assert!(manager
                .write_user_input(&name, b"legacy-stale", &cancellation)
                .await
                .is_err());
        }
        assert_eq!(*bytes.lock().unwrap(), b"oncefresh");
        manager.remove_all().await.unwrap();
    }
}
