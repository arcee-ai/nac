struct TestEnvironment;
impl nac_contracts::CommandEnvironmentProvider for TestEnvironment {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        Box::pin(async { Ok(test_environment()) })
    }
    fn redaction_snapshot(&self) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
        Ok(test_environment())
    }
    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        Default::default()
    }
}
fn test_environment() -> nac_contracts::CommandEnvironmentSnapshot {
    nac_contracts::CommandEnvironmentSnapshot::from_parts(
        std::collections::BTreeMap::from([("NAC_HUMAN_SECRET".into(), "secret--line\nend".into())]),
        vec!["secret--line\nend".into()],
    )
}

use super::*;
use crate::agent::{AgentConfig, AgentMode};
use crate::model::ModelClient;
use crate::session_service::tests::{test_active_service, test_store_path};

fn test_direct_active_service(
    label: &str,
    session_id: &str,
    client: ModelClient,
) -> (SessionServiceParts, PathBuf) {
    let path = std::env::var_os("NAC_HUMAN_CRASH_STORE")
        .map(PathBuf::from)
        .unwrap_or_else(|| test_store_path(label));
    let cwd = path.parent().unwrap().join("workspace");
    std::fs::create_dir_all(&cwd).unwrap();
    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
            session_behavior: Some(sessions::SessionBehavior::Direct),
            store_path: path.clone(),
            session_id: Some(session_id.into()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: cwd.clone(),
            config_cwd: cwd.clone(),
            working_directory: cwd.to_string_lossy().into(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: if label == "deny" {
                vec![crate::permissions::PermissionRule::new(
                    "*",
                    "*",
                    crate::permissions::PermissionEffect::Deny,
                )]
            } else {
                Vec::new()
            },
        },
    )
    .unwrap();
    agent.set_command_environment_provider(Some(Arc::new(TestEnvironment)));
    let mut snapshot = sessions::new_snapshot(
        session_id.into(),
        cwd.clone(),
        client.model.clone(),
        client.base_url().into(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    if let Ok(stored) = sessions::load_session(&path, session_id) {
        snapshot = stored;
    } else {
        sessions::create_session(&path, &snapshot).unwrap();
    }
    let service = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.into(),
            store_path: path.clone(),
            snapshot,
        },
        sandbox_status: "off".into(),
        agents_md_status: "off".into(),
        workspace_display: cwd.to_string_lossy().into(),
        workspace_git: None,
        resume_base_cwd: cwd,
    });
    (service, path)
}

fn request(id: &str, command: &str) -> ShellCommandRequest {
    ShellCommandRequest {
        request_id: id.into(),
        command: command.into(),
        timeout_ms: None,
    }
}

async fn settled(service: &SessionService, id: &str) -> ShellCommandSnapshot {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(snapshot) = service.lookup_shell_command(id).await.unwrap() {
                if snapshot.state.is_terminal() && !service.has_active_operation() {
                    return snapshot;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn human_shell_executes_once_without_model_or_approval_and_appends_once() {
    let (parts, _) =
        test_direct_active_service("human_shell_once", "session", ModelClient::new_for_test());
    let command = "  printf 'human-result'; exit 7\n";
    let (accepted, replay) = parts
        .service
        .submit_shell_command(request("request", command))
        .await
        .unwrap();
    assert!(!replay);
    assert_eq!(accepted.command, command);
    let result = settled(&parts.service, "request").await;
    assert_eq!(result.state, ShellCommandState::Completed);
    assert_eq!(result.exit_code, Some(7));
    assert_eq!(result.stdout, "human-result");
    assert!(parts
        .service
        .permission_broker
        .as_ref()
        .unwrap()
        .pending()
        .is_empty());
    assert!(parts
        .service
        .permission_broker
        .as_ref()
        .unwrap()
        .grants()
        .unwrap()
        .is_empty());
    let (same, replay) = parts
        .service
        .submit_shell_command(request("request", command))
        .await
        .unwrap();
    assert!(replay);
    assert_eq!(same, result);
    assert_eq!(
        parts
            .service
            .submit_shell_command(request("request", "echo changed"))
            .await
            .unwrap_err(),
        ShellCommandError::Conflict
    );
    let page = parts
        .service
        .messages_page(MessagePageRequest {
            before: None,
            limit: 100,
            include_system: false,
        })
        .await
        .unwrap();
    assert_eq!(page.messages.len(), 1);
    assert!(
        matches!(&page.messages[0], Message::User { content } if content.contains("<human_shell_result>"))
    );
    assert!(parts.service.active_run().is_none());
}

#[tokio::test]
async fn human_shell_rejects_unsupported_topology_and_busy_without_effects() {
    let (orchestrator, _) = test_active_service("human_shell_orchestrator", "session");
    assert_eq!(
        orchestrator
            .service
            .submit_shell_command(request("unsupported", "touch /tmp/never-human-shell"))
            .await
            .unwrap_err(),
        ShellCommandError::Unsupported
    );
    let (parts, _) =
        test_direct_active_service("human_shell_busy", "session", ModelClient::new_for_test());
    parts
        .service
        .submit_shell_command(request("long", "sleep 10"))
        .await
        .unwrap();
    assert_eq!(
        parts
            .service
            .submit_shell_command(request("busy", "echo forbidden"))
            .await
            .unwrap_err(),
        ShellCommandError::Busy
    );
    parts.service.cancel_shell_command("long").await.unwrap();
    assert_eq!(
        settled(&parts.service, "long").await.state,
        ShellCommandState::Cancelled
    );
    assert!(parts
        .service
        .lookup_shell_command("busy")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn human_shell_timeout_and_recovery_never_repeat_accepted_effects() {
    let (parts, path) = test_direct_active_service(
        "human_shell_timeout",
        "session",
        ModelClient::new_for_test(),
    );
    let mut timeout = request("timeout", "sleep 10");
    timeout.timeout_ms = Some(20);
    parts.service.submit_shell_command(timeout).await.unwrap();
    assert_eq!(
        settled(&parts.service, "timeout").await.state,
        ShellCommandState::TimedOut
    );
    let lease = Arc::new(sessions::SessionOperationLease::try_acquire(&path, "session").unwrap());
    let snapshot = ShellCommandSnapshot {
        request_id: "crashed".into(),
        operation_id: Uuid::new_v4().to_string(),
        command: "echo must-not-rerun".into(),
        timeout_ms: DEFAULT_SHELL_TIMEOUT_MS,
        state: ShellCommandState::Accepted,
        accepted_at_epoch_ms: now_epoch_ms(),
        finished_at_epoch_ms: None,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        diagnostic: None,
        output_id: None,
        transcript_index: None,
    };
    crate::store::accept_shell_command(&path, "session", "fingerprint", &snapshot, &lease).unwrap();
    drop(lease);
    let recovered = parts
        .service
        .lookup_shell_command("crashed")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovered.state, ShellCommandState::Interrupted);
    assert!(recovered.transcript_index.is_some());
    assert_eq!(
        parts
            .service
            .lookup_shell_command("crashed")
            .await
            .unwrap()
            .unwrap(),
        recovered
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn human_shell_crash_child() {
    if std::env::var_os("NAC_HUMAN_CRASH_STORE").is_none() {
        return;
    }
    let (parts, _) = test_direct_active_service("child", "session", ModelClient::new_for_test());
    parts
        .service
        .submit_shell_command(request("crash", "mktemp effects.XXXXXX"))
        .await
        .unwrap();
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn human_shell_real_process_death_never_repeats_effects() {
    for stage in ["accepted", "started", "result", "committed"] {
        let (parts, path) =
            test_direct_active_service(stage, "session", ModelClient::new_for_test());
        let reached = path.parent().unwrap().join("reached");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "session_service::shell_commands::tests::human_shell_crash_child",
                "--nocapture",
            ])
            .env("NAC_HUMAN_CRASH_STORE", &path)
            .env("NAC_HUMAN_CRASH_STAGE", stage)
            .env("NAC_HUMAN_CRASH_REACHED", &reached)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !reached.exists() && Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let was_reached = reached.exists();
        let _ = child.kill();
        let _ = child.wait();
        assert!(was_reached, "child did not reach {stage}");
        let workspace = path.parent().unwrap().join("workspace");
        let effects = || {
            let mut files = std::fs::read_dir(&workspace)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .filter(|name| name.to_string_lossy().starts_with("effects."))
                .collect::<Vec<_>>();
            files.sort();
            files
        };
        let before = effects();
        assert_eq!(
            before.len(),
            if matches!(stage, "result" | "committed") {
                1
            } else {
                0
            },
            "stage {stage}"
        );
        let result = parts
            .service
            .lookup_shell_command("crash")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            result.state,
            match stage {
                "accepted" => ShellCommandState::Interrupted,
                "committed" => ShellCommandState::Completed,
                _ => ShellCommandState::OutcomeUnknown,
            }
        );
        let (replayed, replay) = parts
            .service
            .submit_shell_command(request("crash", "mktemp effects.XXXXXX"))
            .await
            .unwrap();
        assert!(replay);
        assert_eq!(replayed, result);
        assert_eq!(effects(), before);
        let messages = parts
            .service
            .messages_page(MessagePageRequest {
                before: None,
                limit: 100,
                include_system: false,
            })
            .await
            .unwrap();
        assert_eq!(messages.messages.len(), 1);
    }
}

#[tokio::test]
async fn human_shell_keeps_configured_and_hard_denials_and_invocation_isolation() {
    let (denied, _) = test_direct_active_service("deny", "session", ModelClient::new_for_test());
    denied
        .service
        .submit_shell_command(request("deny", "mktemp denied.XXXXXX"))
        .await
        .unwrap();
    assert_eq!(
        settled(&denied.service, "deny").await.state,
        ShellCommandState::Rejected
    );
    let (parts, _) =
        test_direct_active_service("hard-deny", "session", ModelClient::new_for_test());
    parts
        .service
        .submit_shell_command(request("hard", "sudo touch denied"))
        .await
        .unwrap();
    assert_eq!(
        settled(&parts.service, "hard").await.state,
        ShellCommandState::Rejected
    );
    parts
        .service
        .submit_shell_command(request("export", "export NAC_HUMAN_TEMP_FLAG_140=changed"))
        .await
        .unwrap();
    assert_eq!(
        settled(&parts.service, "export").await.state,
        ShellCommandState::Completed
    );
    parts
        .service
        .submit_shell_command(request(
            "observe",
            "printf '%s' \"$NAC_HUMAN_TEMP_FLAG_140\"",
        ))
        .await
        .unwrap();
    assert_eq!(settled(&parts.service, "observe").await.stdout, "");
}

#[tokio::test]
async fn human_shell_masks_credential_literals_and_pages_before_truncation() {
    let (parts, path) =
        test_direct_active_service("redaction", "session", ModelClient::new_for_test());
    let command = "printf '%03999d%s' 0 \"$NAC_HUMAN_SECRET\"";
    parts
        .service
        .submit_shell_command(request("output", command))
        .await
        .unwrap();
    let result = settled(&parts.service, "output").await;
    assert_eq!(result.state, ShellCommandState::Completed);
    assert!(!result.stdout.contains("secret"));
    let mut output = String::new();
    let mut offset = 3999;
    loop {
        let page = parts
            .service
            .shell_command_output("output", "stdout", offset, 1)
            .await
            .unwrap()
            .unwrap();
        output.push_str(&page.content);
        if page.eof {
            break;
        }
        offset = page.next_offset;
    }
    assert_eq!(output, "[REDACTED]");
    let literal = "printf '%s' 'secret--line\nend'";
    let (accepted, _) = parts
        .service
        .submit_shell_command(request("literal", literal))
        .await
        .unwrap();
    assert!(!accepted.command.contains("secret"));
    let literal_result = settled(&parts.service, "literal").await;
    assert_eq!(literal_result.stdout, "[REDACTED]");
    let (_, replay) = parts
        .service
        .submit_shell_command(request("literal", literal))
        .await
        .unwrap();
    assert!(replay);
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes
        .windows(b"secret--line".len())
        .any(|window| window == b"secret--line"));
}

#[tokio::test]
async fn human_shell_spawn_failure_is_terminal_and_distinct_from_nonzero_exit() {
    let (parts, _) =
        test_direct_active_service("spawn-failure", "session", ModelClient::new_for_test());
    parts
        .service
        .submit_shell_command(request("spawn", "printf 'bad\0value'"))
        .await
        .unwrap();
    let failed = settled(&parts.service, "spawn").await;
    assert_eq!(failed.state, ShellCommandState::SpawnFailed);
    assert!(failed.output_id.is_none());
}

#[tokio::test]
async fn human_shell_rejects_a_traditional_child_before_execution() {
    let (parts, path) =
        test_direct_active_service("child-denial", "session", ModelClient::new_for_test());
    crate::store::insert_test_session(&path, "parent");
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id='parent'",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &path,
        "parent",
        "session",
        crate::store::GENERAL_CHILD_PROFILE,
        "bounded child",
    )
    .unwrap();
    assert_eq!(
        parts
            .service
            .submit_shell_command(request("child", "mktemp denied.XXXXXX"))
            .await
            .unwrap_err(),
        ShellCommandError::Unsupported
    );
    assert!(parts
        .service
        .lookup_shell_command("child")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn human_shell_cancellation_reaps_the_descendant_process_tree() {
    let (parts, path) =
        test_direct_active_service("tree-cleanup", "session", ModelClient::new_for_test());
    let mut command = request("tree", "python3 -c 'import subprocess,pathlib,time; p=subprocess.Popen([\"sleep\",\"30\"]); pathlib.Path(\"child.pid\").write_text(str(p.pid)); time.sleep(30)'" );
    command.timeout_ms = Some(5_000);
    parts.service.submit_shell_command(command).await.unwrap();
    let pid_file = path.parent().unwrap().join("workspace/child.pid");
    let pid = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pid_file) {
                return pid;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    parts.service.cancel_shell_command("tree").await.unwrap();
    assert_eq!(
        settled(&parts.service, "tree").await.state,
        ShellCommandState::Cancelled
    );
    let alive = std::process::Command::new("kill")
        .args(["-0", pid.trim()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success();
    assert!(!alive, "cancelled descendant still exists");
}

#[path = "shell_recovery_tests.rs"]
mod recovery;
