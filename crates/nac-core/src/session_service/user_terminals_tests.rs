use super::*;
use crate::agent::{AgentConfig, AgentMode};
use crate::permissions::{
    PermissionApprovalMode, PermissionEffect, PermissionReply, PermissionRule,
};
use nac_contracts::{
    CommandEnvironmentFuture, CommandEnvironmentProvider, CommandEnvironmentSnapshot,
    WorkerEnvironment,
};

#[path = "user_terminal_control_tests.rs"]
mod control;

#[path = "user_terminals_managed_tests.rs"]
mod managed;

#[path = "terminal_model_observation_tests.rs"]
mod model_observation;

#[cfg(unix)]
#[path = "user_terminals_native_redaction_tests.rs"]
mod native_redaction;

struct Environment(CommandEnvironmentSnapshot);
impl CommandEnvironmentProvider for Environment {
    fn snapshot(&self) -> CommandEnvironmentFuture<'_> {
        Box::pin(async { Ok(self.0.clone()) })
    }
    fn redaction_snapshot(&self) -> Result<CommandEnvironmentSnapshot> {
        Ok(self.0.clone())
    }
    fn worker_environment(&self) -> WorkerEnvironment {
        WorkerEnvironment::default()
    }
}

// Pause the real environment snapshot after prepared authorization and before
// native admission/spawn. No approval lifecycle or timing-only race hook.
struct PausedEnvironment {
    barrier: Arc<tokio::sync::Barrier>,
    fail: bool,
}
impl CommandEnvironmentProvider for PausedEnvironment {
    fn snapshot(&self) -> CommandEnvironmentFuture<'_> {
        Box::pin(async {
            self.barrier.wait().await;
            self.barrier.wait().await;
            anyhow::ensure!(!self.fail, "test environment unavailable");
            Ok(CommandEnvironmentSnapshot::empty())
        })
    }
    fn redaction_snapshot(&self) -> Result<CommandEnvironmentSnapshot> {
        Ok(CommandEnvironmentSnapshot::empty())
    }
    fn worker_environment(&self) -> WorkerEnvironment {
        WorkerEnvironment::default()
    }
}

fn fixture() -> (SessionServiceParts, PathBuf) {
    fixture_with_provider(None)
}

fn fixture_with_provider(
    provider: Option<Arc<dyn CommandEnvironmentProvider>>,
) -> (SessionServiceParts, PathBuf) {
    fixture_with_policy(provider, Vec::new())
}

fn fixture_with_policy(
    provider: Option<Arc<dyn CommandEnvironmentProvider>>,
    permission_rules: Vec<PermissionRule>,
) -> (SessionServiceParts, PathBuf) {
    let directory = std::env::temp_dir().join(format!("nac-user-terminal-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let store_path = directory.join("store.db");
    let client = crate::model::ModelClient::new_for_test();
    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
            session_behavior: None,
            store_path: store_path.clone(),
            session_id: Some("direct-terminal".into()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: directory.clone(),
            config_cwd: directory.clone(),
            working_directory: directory.display().to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules,
        },
    )
    .unwrap();
    let provider = provider.unwrap_or_else(|| {
        Arc::new(Environment(CommandEnvironmentSnapshot::from_parts(
            BTreeMap::from([
                ("HOME".into(), directory.display().to_string()),
                ("NAC_TEST_SECRET".into(), "synthetic-user-secret".into()),
            ]),
            vec!["synthetic-user-secret".into()],
        )))
    });
    agent.set_command_environment_provider(Some(provider));
    let mut snapshot = sessions::new_snapshot(
        "direct-terminal".into(),
        directory.clone(),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: "direct-terminal".into(),
            store_path,
            snapshot,
        },
        sandbox_status: "off".into(),
        agents_md_status: "off".into(),
        workspace_display: directory.display().to_string(),
        workspace_git: Some(GitTarget::local(directory.clone())),
        resume_base_cwd: directory.clone(),
    });
    (parts, directory)
}

async fn wait_for(service: &SessionService, id: &str, needle: &[u8]) -> Vec<u8> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(id, 0, 64 * 1024)
                .await
                .unwrap();
            if page
                .bytes
                .windows(needle.len())
                .any(|bytes| bytes == needle)
            {
                return page.bytes;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn active_agent_mutex_and_workspace_gate_do_not_block_human_terminal_operations() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let launch_id = Uuid::new_v4();
    // Simulate the same mutex held across a running model request. Opening,
    // observing and typing must not queue behind it.
    let agent = service.agent.lock().await;
    let terminal = tokio::time::timeout(
        Duration::from_secs(3),
        service.open_user_terminal(launch_id, 80, 24),
    )
    .await
    .unwrap()
    .unwrap();
    let retry = service.open_user_terminal(launch_id, 80, 24).await.unwrap();
    assert_eq!(retry.id, terminal.id);
    let gate = crate::tools::shared_workspace_gate_for(&directory.join("store.db"), &directory);
    let mutation = tokio::time::timeout(Duration::from_secs(1), gate.write())
        .await
        .unwrap();
    std::fs::write(directory.join("same.txt"), b"agent-written-file").unwrap();
    service
        .write_user_terminal_input(
            &terminal.id,
            b"cat same.txt; printf '%s' \"$NAC_TEST_SECRET\"\r",
        )
        .await
        .unwrap();
    let output = wait_for(service, &terminal.id, b"[REDACTED]").await;
    assert!(output
        .windows(b"agent-written-file".len())
        .any(|bytes| bytes == b"agent-written-file"));
    assert!(!output
        .windows(b"synthetic-user-secret".len())
        .any(|bytes| bytes == b"synthetic-user-secret"));
    service
        .resize_user_terminal(&terminal.id, 91, 31)
        .await
        .unwrap();
    // Agent settlement/cancellation has its own domain and preserves retained
    // human shells. The user terminal does not append output to the transcript.
    service.terminal_manager.settle_run().await.unwrap();
    assert!(
        service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .alive
    );
    assert!(agent
        .messages
        .iter()
        .all(|message| !matches!(message, Message::Tool { .. })));
    drop(mutation);
    drop(agent);
    let identity = GitTarget::local(directory.clone()).lease_identity();
    assert!(
        sessions::WorkspaceMutationLease::try_acquire(&directory.join("store.db"), &identity)
            .is_err()
    );
    assert!(sessions::SessionResourceMutationLease::try_acquire(
        &directory.join("store.db"),
        "direct-terminal"
    )
    .is_err());
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    drop(
        sessions::WorkspaceMutationLease::try_acquire(&directory.join("store.db"), &identity)
            .unwrap(),
    );
    drop(
        sessions::SessionResourceMutationLease::try_acquire(
            &directory.join("store.db"),
            "direct-terminal",
        )
        .unwrap(),
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn human_launch_without_approver_never_asks_saves_or_changes_manual_mode() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let mut events = service.event_bus.subscribe();
    assert!(!service.event_bus.has_interactive_subscribers());
    let launch_id = Uuid::new_v4();
    let terminal = tokio::time::timeout(
        Duration::from_secs(3),
        service.open_user_terminal(launch_id, 80, 24),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        service
            .open_user_terminal(launch_id, 80, 24)
            .await
            .unwrap()
            .id,
        terminal.id
    );
    service
        .write_user_terminal_input(&terminal.id, b"printf HUMAN-FRESH\r")
        .await
        .unwrap();
    wait_for(service, &terminal.id, b"HUMAN-FRESH").await;
    service
        .resize_user_terminal(&terminal.id, 91, 31)
        .await
        .unwrap();
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert!(service.list_permission_grants().unwrap().is_empty());
    assert_eq!(
        service.permission_approval_mode().await.unwrap(),
        PermissionApprovalMode::Manual
    );
    while let Ok(envelope) = events.try_recv() {
        assert!(!matches!(
            envelope.event,
            crate::events::SessionEvent::PermissionAsked { .. }
        ));
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn configured_denial_still_rejects_human_launch_without_spawn_or_ask() {
    for action in ["execute", "execute_broad", "terminal_input", "execute_cwd"] {
        let (parts, directory) = fixture_with_policy(
            None,
            vec![PermissionRule::new(action, "*", PermissionEffect::Deny)],
        );
        let result = parts
            .service
            .open_user_terminal(Uuid::new_v4(), 80, 24)
            .await;
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("permission denied"),
            "{action}"
        );
        assert!(parts
            .service
            .list_user_terminals()
            .await
            .unwrap()
            .is_empty());
        assert!(parts.service.list_permission_requests().unwrap().is_empty());
        assert!(parts.service.list_permission_grants().unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[tokio::test]
async fn selected_unsupported_backend_rejects_human_launch_without_local_fallback() {
    let (mut parts, directory) = fixture();
    let context = parts.service.user_terminal_context.as_ref().unwrap();
    let mut runtime = context.runtime.clone();
    runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Ssh(
        crate::sandbox::SshBackend::new(
            "unreachable-terminal-host.invalid".into(),
            directory.clone(),
        ),
    ));
    parts.service.user_terminal_context = Some(Arc::new(user_terminals::UserTerminalContext::new(
        runtime,
        context.client.clone(),
    )));
    let error = parts
        .service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("selected Local backend"));
    assert!(parts
        .service
        .list_user_terminals()
        .await
        .unwrap()
        .is_empty());
    assert!(parts.service.list_permission_requests().unwrap().is_empty());
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn human_launch_does_not_change_agent_exec_or_nonempty_stdin_authority() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let context = service.require_user_terminal_context().unwrap();
    let protected = crate::tools::execute_tool(
        "write_stdin",
        serde_json::json!({"session_id": terminal.id, "chars": "default-must-not-run"}),
        &context.runtime,
        &context.client,
    )
    .await;
    assert!(protected.is_error);
    assert!(service.list_permission_requests().unwrap().is_empty());
    service
        .transfer_terminal_input_control(
            &terminal.id,
            1,
            crate::terminal::InputController::Agent,
            false,
        )
        .await
        .unwrap();
    let _interactive = service.event_bus.subscribe_assistant_deltas();
    for (tool, input, action) in [
        (
            "exec_command",
            serde_json::json!({"cmd": "echo $HOME"}),
            "execute_opaque",
        ),
        (
            "write_stdin",
            serde_json::json!({"session_id": terminal.id, "chars": "printf AGENT-MUST-NOT-RUN\r"}),
            "terminal_input",
        ),
    ] {
        let invoke = crate::tools::execute_tool(tool, input, &context.runtime, &context.client);
        tokio::pin!(invoke);
        let reject = async {
            loop {
                if let Some(request) = service.list_permission_requests().unwrap().pop() {
                    assert_eq!(request.tool, tool);
                    assert!(request
                        .resources
                        .iter()
                        .any(|resource| resource.action == action));
                    assert!(request
                        .resources
                        .iter()
                        .all(|resource| resource.save_resource.is_none()));
                    service
                        .reply_permission_request(&request.id, PermissionReply::Reject)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(3), async {
            tokio::select! {
                result = &mut invoke => panic!("{tool} finished without an Ask: {}", result.content.as_text().unwrap()),
                () = reject => {}
            }
            (invoke.await, ())
        })
        .await
        .unwrap();
        assert!(result.is_error);
    }
    for flag in ["human", "origin", "submission"] {
        for (tool, mut input) in [
            ("exec_command", serde_json::json!({"cmd": "echo $HOME"})),
            (
                "write_stdin",
                serde_json::json!({"session_id": terminal.id, "chars": "x"}),
            ),
        ] {
            input[flag] = serde_json::json!("human");
            let result =
                crate::tools::execute_tool(tool, input, &context.runtime, &context.client).await;
            assert!(result.is_error);
            assert!(service.list_permission_requests().unwrap().is_empty());
        }
    }
    assert!(service.list_permission_grants().unwrap().is_empty());
    assert_eq!(
        service.permission_approval_mode().await.unwrap(),
        PermissionApprovalMode::Manual
    );
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn shutdown_fences_launch_input_resize_and_foreign_handles_remain_opaque() {
    let (parts, directory) = fixture();
    let terminal = parts
        .service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let (foreign, foreign_directory) = fixture();
    assert!(foreign
        .service
        .user_terminal_status(&terminal.id)
        .await
        .is_err());
    assert!(foreign
        .service
        .read_user_terminal_output(&terminal.id, 0, 1024)
        .await
        .is_err());
    assert!(foreign
        .service
        .terminate_user_terminal(&terminal.id)
        .await
        .is_err());
    parts.service.stop_run_admission().await.unwrap();
    assert!(parts
        .service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .is_err());
    assert!(parts
        .service
        .write_user_terminal_input(&terminal.id, b"x")
        .await
        .is_err());
    assert!(parts
        .service
        .resize_user_terminal(&terminal.id, 80, 24)
        .await
        .is_err());
    assert!(
        parts
            .service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .alive
    );
    parts
        .service
        .terminate_user_terminal(&terminal.id)
        .await
        .unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    std::fs::remove_dir_all(foreign_directory).unwrap();
}

#[tokio::test]
async fn configuration_replacement_after_authorization_rejects_the_stale_launch() {
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let (parts, directory) = fixture_with_provider(Some(Arc::new(PausedEnvironment {
        barrier: barrier.clone(),
        fail: false,
    })));
    let launch = parts.service.open_user_terminal(Uuid::new_v4(), 80, 24);
    let replace = async {
        barrier.wait().await;
        assert!(parts.service.list_permission_requests().unwrap().is_empty());
        assert!(parts
            .service
            .list_user_terminals()
            .await
            .unwrap()
            .is_empty());
        let snapshot =
            sessions::load_session(&directory.join("store.db"), "direct-terminal").unwrap();
        sessions::update_session_config(&directory.join("store.db"), &snapshot).unwrap();
        barrier.wait().await;
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(launch, replace)
    })
    .await
    .unwrap();
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("configuration changed"));
    assert!(parts
        .service
        .list_user_terminals()
        .await
        .unwrap()
        .is_empty());
    drop(
        sessions::SessionResourceMutationLease::try_acquire(
            &directory.join("store.db"),
            "direct-terminal",
        )
        .unwrap(),
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn shutdown_after_authorization_before_spawn_leaves_no_process() {
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let (parts, directory) = fixture_with_provider(Some(Arc::new(PausedEnvironment {
        barrier: barrier.clone(),
        fail: false,
    })));
    let launch = parts.service.open_user_terminal(Uuid::new_v4(), 80, 24);
    let stop = async {
        barrier.wait().await;
        parts.service.stop_run_admission().await.unwrap();
        barrier.wait().await;
    };
    let (result, ()) =
        tokio::time::timeout(Duration::from_secs(5), async { tokio::join!(launch, stop) })
            .await
            .unwrap();
    assert!(result.unwrap_err().to_string().contains("cancelled"));
    assert!(parts
        .service
        .list_user_terminals()
        .await
        .unwrap()
        .is_empty());
    assert!(parts.service.list_permission_requests().unwrap().is_empty());
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn natural_exit_archives_output_and_releases_lifetime_leases() {
    let (parts, directory) = fixture();
    let terminal = parts
        .service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    parts
        .service
        .write_user_terminal_input(&terminal.id, b"printf EXIT-MARKER; exit 7\r")
        .await
        .unwrap();
    wait_for(&parts.service, &terminal.id, b"EXIT-MARKER").await;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = parts
                .service
                .user_terminal_status(&terminal.id)
                .await
                .unwrap();
            if status.output_complete && status.exit_code == Some(7) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    drop(
        sessions::SessionResourceMutationLease::try_acquire(
            &directory.join("store.db"),
            "direct-terminal",
        )
        .unwrap(),
    );
    let identity = GitTarget::local(directory.clone()).lease_identity();
    drop(
        sessions::WorkspaceMutationLease::try_acquire(&directory.join("store.db"), &identity)
            .unwrap(),
    );
    assert_eq!(
        parts.service.list_user_terminals().await.unwrap()[0].id,
        terminal.id
    );
    assert!(parts
        .service
        .read_user_terminal_output(&terminal.id, 0, 1024)
        .await
        .is_ok());
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn terminal_output_wait_wakes_multiple_observers_and_checks_output_before_waiting() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    // A shell blocked on read gives both observers a stable shared cursor;
    // octal READY bytes prevent command echo from satisfying the handshake.
    service
        .write_user_terminal_input(
            &terminal.id,
            b"stty -echo; printf '\\122\\105\\101\\104\\131'; read -r line; printf WAKE-MARKER\r",
        )
        .await
        .unwrap();
    wait_for(service, &terminal.id, b"READY").await;
    let cursor = service
        .read_user_terminal_output(&terminal.id, 0, 65536)
        .await
        .unwrap()
        .retained_end;
    let first = service.wait_for_user_terminal_output(&terminal.id, cursor, 1000);
    let second = service.wait_for_user_terminal_output(&terminal.id, cursor, 1000);
    let trigger = async {
        tokio::task::yield_now().await;
        service
            .write_user_terminal_input(&terminal.id, b"go\r")
            .await
            .unwrap();
    };
    tokio::time::timeout(Duration::from_millis(700), async {
        let (first, second, ()) = tokio::join!(first, second, trigger);
        first.unwrap();
        second.unwrap();
    })
    .await
    .unwrap();
    let output = service
        .read_user_terminal_output(&terminal.id, cursor, 65536)
        .await
        .unwrap();
    assert!(output.retained_end > cursor);
    // Output arriving between an empty read and waiter registration must not
    // cost the full polling delay or lose a notification.
    tokio::time::timeout(
        Duration::from_millis(100),
        service.wait_for_user_terminal_output(&terminal.id, cursor, 1000),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(service
        .wait_for_user_terminal_output(&terminal.id, output.retained_end, 1001)
        .await
        .is_err());
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn terminal_output_wait_observes_eof_without_more_bytes_and_remains_owner_scoped() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .write_user_terminal_input(
            &terminal.id,
            b"stty -echo; printf '\\122\\105\\101\\104\\131'; read -r line; exit 7\r",
        )
        .await
        .unwrap();
    wait_for(service, &terminal.id, b"READY").await;
    let cursor = service
        .read_user_terminal_output(&terminal.id, 0, 65536)
        .await
        .unwrap()
        .retained_end;
    let trigger = async {
        tokio::task::yield_now().await;
        service
            .write_user_terminal_input(&terminal.id, b"go\r")
            .await
            .unwrap();
    };
    tokio::time::timeout(Duration::from_millis(700), async {
        let (waited, ()) = tokio::join!(
            service.wait_for_user_terminal_output(&terminal.id, cursor, 1000),
            trigger
        );
        waited.unwrap();
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .output_complete
        {
            service
                .wait_for_user_terminal_output(&terminal.id, cursor, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap();
    tokio::time::timeout(
        Duration::from_millis(100),
        service.wait_for_user_terminal_output(&terminal.id, cursor, 1000),
    )
    .await
    .unwrap()
    .unwrap();
    let (foreign, foreign_directory) = fixture();
    assert!(foreign
        .service
        .wait_for_user_terminal_output(&terminal.id, cursor, 0)
        .await
        .is_err());
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    std::fs::remove_dir_all(foreign_directory).unwrap();
}

async fn wait_for_settled_user_history(service: &SessionService, id: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = service.user_terminal_status(id).await.unwrap();
            if status.output_complete && !status.alive && status.exit_code.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn eviction_after_existing_launch_resolution_never_reanimates_its_handle() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let launch_id = Uuid::new_v4();
    let old = service.open_user_terminal(launch_id, 80, 24).await.unwrap();
    service.terminate_user_terminal(&old.id).await.unwrap();
    wait_for_settled_user_history(service, &old.id).await;
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    service
        .pause_resolved_user_launch_for_test(barrier.clone())
        .await;
    let retry = service.open_user_terminal(launch_id, 80, 24);
    let evict = async {
        barrier.wait().await;
        // Real bounded history eviction while the resolved old capability is
        // suspended; direct manager admission avoids the facade's launch gate.
        let backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
        for _ in 0..16 {
            let name = service
                .terminal_manager
                .resolve_user_terminal_launch(Uuid::new_v4())
                .await;
            service
                .terminal_manager
                .create_user_terminal(
                    name.clone(),
                    "exit 0",
                    directory.clone(),
                    80,
                    24,
                    &backend,
                    CommandEnvironmentSnapshot::empty(),
                    None,
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
                .unwrap();
            wait_for_settled_user_history(service, &name).await;
        }
        assert!(service.user_terminal_status(&old.id).await.is_err());
        barrier.wait().await;
    };
    let (result, ()) = tokio::join!(retry, evict);
    // A cached settled reply, an opaque stale result, or a fresh authorized
    // capability is valid. Retire all fixture children before any assertion.
    let reanimated = result
        .as_ref()
        .is_ok_and(|status| status.id == old.id && status.alive);
    let stale_input = service.write_user_terminal_input(&old.id, b"exit\r").await;
    let stale_resize = service.resize_user_terminal(&old.id, 91, 31).await;
    service.destroy_terminals().await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    assert!(
        !reanimated,
        "history eviction recreated a live process under its old input capability"
    );
    assert!(stale_input.is_err());
    assert!(stale_resize.is_err());
}

#[tokio::test]
async fn listing_archives_settled_live_terminal_without_invalidating_its_snapshot() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let mut handles = Vec::new();
    for _ in 0..16 {
        handles.push(
            service
                .open_user_terminal(Uuid::new_v4(), 80, 24)
                .await
                .unwrap()
                .id,
        );
    }
    handles.sort();
    let exiting = handles.remove(0);
    // Archive lexically largest first: the oldest tombstone is guaranteed to
    // appear later than `exiting` in the old names-then-status listing loop.
    let oldest = handles.last().unwrap().clone();
    for id in handles.iter().rev() {
        service.terminate_user_terminal(id).await.unwrap();
        wait_for_settled_user_history(service, id).await;
    }
    let last = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service.terminate_user_terminal(&last.id).await.unwrap();
    wait_for_settled_user_history(service, &last.id).await;
    assert!(service.user_terminal_status(&oldest).await.is_ok());
    service
        .write_user_terminal_input(&exiting, b"exit 9\r")
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !service
            .terminal_manager
            .user_terminal_settled_without_archive_for_test(&exiting)
            .await
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    // No separate status call may archive `exiting` before the actual list.
    let result = service.list_user_terminals().await;
    let retained_count = service.terminal_manager.user_terminal_names().await.len();
    service.destroy_terminals().await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    let statuses = result.unwrap();
    let settled = statuses.iter().find(|status| status.id == exiting).unwrap();
    assert!(!settled.alive && settled.output_complete);
    assert_eq!(settled.exit_code, Some(9));
    let mut unique = std::collections::BTreeSet::new();
    assert!(statuses
        .iter()
        .all(|status| unique.insert(status.id.clone())));
    assert!(statuses.iter().all(|status| !status.alive));
    assert!(retained_count <= 16);
}

#[tokio::test]
async fn rendered_selection_preview_remains_independent_of_active_agent_and_workspace_mutation() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let agent = service.agent.lock().await;
    let shell = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let gate = crate::tools::shared_workspace_gate_for(&directory.join("store.db"), &directory);
    let mutation = gate.write().await;
    let before = serde_json::to_value(&agent.messages).unwrap();
    let preview = tokio::time::timeout(
        Duration::from_secs(1),
        service
            .preview_user_terminal_selection(&shell.id, "synthetic-user-secret\n/compact\n$skill"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(preview.text, "[REDACTED]\n/compact\n$skill");
    assert_eq!(serde_json::to_value(&agent.messages).unwrap(), before);
    assert!(!service.has_active_operation());
    assert!(service.list_direct_inbox().unwrap().is_empty());
    assert!(service.user_terminal_status(&shell.id).await.unwrap().alive);
    drop(mutation);
    drop(agent);
    service.terminate_user_terminal(&shell.id).await.unwrap();
}
