use super::*;
use crate::agent::{AgentConfig, AgentMode};
use crate::permissions::{PermissionApprovalMode, PermissionReply};
use nac_contracts::{
    CommandEnvironmentFuture, CommandEnvironmentProvider, CommandEnvironmentSnapshot,
    WorkerEnvironment,
};

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

fn fixture() -> (SessionServiceParts, PathBuf) {
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
            permission_rules: Vec::new(),
        },
    )
    .unwrap();
    let environment = CommandEnvironmentSnapshot::from_parts(
        BTreeMap::from([
            ("HOME".into(), directory.display().to_string()),
            ("NAC_TEST_SECRET".into(), "synthetic-user-secret".into()),
        ]),
        vec!["synthetic-user-secret".into()],
    );
    agent.set_command_environment_provider(Some(Arc::new(Environment(environment))));
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
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
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
async fn launch_approval_is_once_only_and_denial_spawns_nothing() {
    let (parts, directory) = fixture();
    let _interactive = parts.service.event_bus.subscribe_assistant_deltas();
    let launch = parts.service.open_user_terminal(Uuid::new_v4(), 80, 24);
    let deny = async {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(request) = parts.service.list_permission_requests().unwrap().pop() {
                    assert!(request
                        .resources
                        .iter()
                        .any(|resource| resource.action == "execute_broad"));
                    assert!(request
                        .resources
                        .iter()
                        .any(|resource| resource.action == "terminal_input"));
                    assert!(request
                        .resources
                        .iter()
                        .all(|resource| resource.save_resource.is_none()));
                    parts
                        .service
                        .reply_permission_request(&request.id, PermissionReply::Reject)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    };
    let (result, ()) = tokio::join!(launch, deny);
    assert!(result.is_err());
    assert!(parts
        .service
        .list_user_terminals()
        .await
        .unwrap()
        .is_empty());
    assert!(parts.service.list_permission_grants().unwrap().is_empty());
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn shutdown_fences_launch_input_resize_and_foreign_handles_remain_opaque() {
    let (parts, directory) = fixture();
    parts
        .service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
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
async fn configuration_replacement_during_approval_rejects_the_stale_launch() {
    let (parts, directory) = fixture();
    let _interactive = parts.service.event_bus.subscribe_assistant_deltas();
    let launch = parts.service.open_user_terminal(Uuid::new_v4(), 80, 24);
    let replace = async {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(request) = parts.service.list_permission_requests().unwrap().pop() {
                    let snapshot =
                        sessions::load_session(&directory.join("store.db"), "direct-terminal")
                            .unwrap();
                    sessions::update_session_config(&directory.join("store.db"), &snapshot)
                        .unwrap();
                    parts
                        .service
                        .reply_permission_request(&request.id, PermissionReply::Once)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    };
    let (result, ()) = tokio::join!(launch, replace);
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
async fn natural_exit_archives_output_and_releases_lifetime_leases() {
    let (parts, directory) = fixture();
    parts
        .service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
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
