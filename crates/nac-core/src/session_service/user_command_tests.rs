use std::sync::Arc;

use super::*;
use crate::agent::{AgentConfig, AgentMode};
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::model::ModelClient;
use crate::permissions::{PermissionEffect, PermissionRule};
use crate::store::UserCommandTerminal;
use crate::terminal::OutputStream;

pub(super) const SESSION: &str = "user-command-session";
const SECRET: &str = "nac-user-command-secret-7f3a";
/// Leaves one file in the runs directory per execution.
pub(super) const COUNTED: &str = "mktemp \"$NAC_TEST_RUNS/run.XXXXXX\"";

/// Supplies a credential and a per-test directory whose entries count executions.
struct TestEnvironment {
    runs: PathBuf,
}

impl TestEnvironment {
    fn environment(&self) -> nac_contracts::CommandEnvironmentSnapshot {
        nac_contracts::CommandEnvironmentSnapshot::from_parts(
            BTreeMap::from([
                ("NAC_TEST_SECRET".to_string(), SECRET.to_string()),
                ("NAC_TEST_RUNS".to_string(), self.runs.display().to_string()),
            ]),
            vec![SECRET.to_string()],
        )
    }
}

impl nac_contracts::CommandEnvironmentProvider for TestEnvironment {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        let environment = self.environment();
        Box::pin(async move { Ok(environment) })
    }

    fn redaction_snapshot(&self) -> Result<nac_contracts::CommandEnvironmentSnapshot> {
        Ok(self.environment())
    }

    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        nac_contracts::WorkerEnvironment::default()
    }
}

pub(super) struct Fixture {
    service: SessionService,
    events: SessionEventReceiver,
    pub(super) store_path: PathBuf,
    workspace: PathBuf,
    directory: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

impl Fixture {
    pub(super) fn new(label: &str, client: ModelClient, rules: Vec<PermissionRule>) -> Self {
        let directory =
            std::env::temp_dir().join(format!("nac-user-command-{label}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("workspace")).unwrap();
        std::fs::create_dir_all(directory.join("runs")).unwrap();
        let workspace = directory.join("workspace").canonicalize().unwrap();
        let store_path = directory.join("store.db");
        let parts = direct_service(&store_path, &workspace, client, rules);
        Self {
            service: parts.service,
            events: parts.events,
            store_path,
            workspace,
            directory,
        }
    }

    pub(super) fn reopen(&self) -> SessionService {
        direct_service(
            &self.store_path,
            &self.workspace,
            ModelClient::new_for_test(),
            Vec::new(),
        )
        .service
    }

    pub(super) fn lease(&self) -> sessions::SessionOperationLease {
        sessions::SessionOperationLease::try_acquire(&self.store_path, SESSION).unwrap()
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    fn submit(
        &self,
        request_id: &str,
        command: &str,
        timeout_ms: Option<u64>,
    ) -> std::result::Result<UserCommandAdmission, UserCommandSubmitError> {
        self.service
            .submit_user_command_with_lease(request(request_id, command, timeout_ms), self.lease())
    }

    pub(super) fn executions(&self) -> usize {
        std::fs::read_dir(self.directory.join("runs"))
            .unwrap()
            .count()
    }

    fn rows(&self) -> Vec<UserCommandSnapshot> {
        crate::store::list_user_commands(&self.store_path, SESSION).unwrap()
    }

    fn command_events(&mut self) -> Vec<UserCommandState> {
        std::iter::from_fn(|| self.events.try_recv().ok())
            .filter_map(|envelope| match envelope.event {
                SessionEvent::UserCommandUpdated { command } => Some(command.state),
                SessionEvent::RunStarted { .. } => panic!("a user command started a model run"),
                _ => None,
            })
            .collect()
    }
}

pub(super) fn direct_service(
    store_path: &Path,
    workspace: &Path,
    client: ModelClient,
    rules: Vec<PermissionRule>,
) -> SessionServiceParts {
    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
            session_behavior: Some(sessions::SessionBehavior::Direct),
            store_path: store_path.to_path_buf(),
            session_id: Some(SESSION.to_string()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: workspace.to_path_buf(),
            config_cwd: workspace.to_path_buf(),
            working_directory: workspace.display().to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: rules,
        },
    )
    .unwrap();
    agent.set_command_environment_provider(Some(Arc::new(TestEnvironment {
        runs: store_path.with_file_name("runs"),
    })));
    let snapshot = sessions::load_session(store_path, SESSION).unwrap_or_else(|_| {
        let mut snapshot = sessions::new_snapshot(
            SESSION.to_string(),
            workspace.to_path_buf(),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        snapshot.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(store_path, &snapshot).unwrap();
        snapshot
    });
    SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: SESSION.to_string(),
            store_path: store_path.to_path_buf(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: workspace.display().to_string(),
        workspace_git: None,
        resume_base_cwd: workspace.to_path_buf(),
    })
}

pub(super) fn request(
    request_id: &str,
    command: &str,
    timeout_ms: Option<u64>,
) -> UserCommandRequest {
    UserCommandRequest {
        request_id: request_id.to_string(),
        command: command.to_string(),
        timeout_ms,
    }
}

async fn settled(service: &SessionService, request_id: &str) -> UserCommandSnapshot {
    let store_path = service.metadata().store_path;
    for _ in 0..1_000 {
        let lease_free = sessions::SessionOperationLease::try_acquire(&store_path, SESSION).is_ok();
        if lease_free && !service.has_active_operation() {
            if let Some(command) = service.user_command(request_id).await.unwrap() {
                if command.state.is_terminal() {
                    return command;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("user command {request_id} did not settle");
}

async fn executing(service: &SessionService, request_id: &str) {
    for _ in 0..500 {
        let state = service
            .user_command(request_id)
            .await
            .unwrap()
            .map(|c| c.state);
        if state == Some(UserCommandState::Executing) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("user command {request_id} did not start");
}

pub(super) async fn records(service: &SessionService) -> Vec<String> {
    service
        .messages_snapshot()
        .await
        .unwrap()
        .into_iter()
        .filter_map(|message| match message {
            Message::User { content } if content.starts_with("<user_command>") => Some(content),
            _ => None,
        })
        .collect()
}

#[cfg(unix)]
#[tokio::test]
async fn completed_command_appends_one_attributed_record_without_a_run() {
    let mut fixture = Fixture::new("completed", ModelClient::new_for_test(), Vec::new());

    let admission = fixture
        .submit("done", "printf out; printf %d err; exit 3", None)
        .unwrap();
    assert!(!admission.replayed);
    assert_eq!(admission.command.state, UserCommandState::Admitted);
    assert_eq!(admission.command.timeout_ms, 30_000);
    let command = settled(&fixture.service, "done").await;

    assert_eq!(command.state, UserCommandState::Completed, "{command:?}");
    assert_eq!(command.exit_code, Some(3));
    assert!(command.stdout_preview.contains("out"));
    assert!(command.stderr_preview.contains("err"));
    assert!(command.process_started);
    assert_eq!(
        command.cwd.as_deref(),
        Some(fixture.workspace.to_str().unwrap())
    );
    let index = command.message_index.expect("the record is attributed");
    let messages = fixture.service.messages_snapshot().await.unwrap();
    let Message::User { content } = &messages[index] else {
        panic!("the record is a user message");
    };
    assert!(content.contains("the assistant did not run it"));
    assert!(content.contains("exit_code: 3"));
    assert_eq!(records(&fixture.service).await.len(), 1);
    assert_eq!(
        fixture.command_events(),
        vec![
            UserCommandState::Admitted,
            UserCommandState::Executing,
            UserCommandState::Completed
        ]
    );
    assert!(fixture.service.active_operation().is_none());

    let snapshot = fixture.service.frontend_snapshot().await.unwrap();
    assert!(snapshot.active_user_command.is_none());
    assert_eq!(snapshot.user_commands, vec![command.clone()]);
    let page = fixture
        .service
        .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
            messages: FrontendSnapshotMessages::Page(MessagePageRequest {
                before: None,
                limit: 10,
                include_system: false,
            }),
            ..FrontendSnapshotLoadOptions::default()
        })
        .await
        .unwrap();
    let paged = &page.snapshot.user_commands[0];
    let start = page.message_page.unwrap().start;
    assert_eq!(
        serde_json::to_value(&page.snapshot.messages[paged.message_index.unwrap() - start])
            .unwrap(),
        serde_json::to_value(&messages[index]).unwrap()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn admission_rejects_invalid_non_direct_and_busy_requests_without_rows() {
    let fixture = Fixture::new("admission", ModelClient::new_for_test(), Vec::new());
    for (request_id, command, timeout_ms) in [
        ("blank", "  \n", None),
        ("", "printf x", None),
        ("zero", "printf x", Some(0)),
        ("long", "printf x", Some(3_600_001)),
    ] {
        assert!(matches!(
            fixture.submit(request_id, command, timeout_ms),
            Err(UserCommandSubmitError::Invalid { .. })
        ));
    }

    fixture.service.try_begin_run(None, "a prompt").unwrap();
    assert!(matches!(
        fixture.submit("during-run", "printf x", None),
        Err(UserCommandSubmitError::Busy {
            active_operation: ActiveSessionOperationSnapshot::Run { .. }
        })
    ));
    assert!(fixture.rows().is_empty());

    let (orchestrator, store_path) =
        super::super::tests::test_active_service("user-command-orchestrator", "orchestrator");
    let lease = sessions::SessionOperationLease::try_acquire(&store_path, "orchestrator").unwrap();
    assert_eq!(
        orchestrator
            .service
            .submit_user_command_with_lease(request("o", "printf x", None), lease)
            .unwrap_err(),
        UserCommandSubmitError::NotDirectPrimary
    );
    assert!(
        crate::store::list_user_commands(&store_path, "orchestrator")
            .unwrap()
            .is_empty()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn active_command_makes_prompts_and_compaction_busy_until_cancelled() {
    let fixture = Fixture::new("busy", ModelClient::new_for_test(), Vec::new());
    fixture.submit("long", "sleep 30", None).unwrap();
    executing(&fixture.service, "long").await;

    assert!(sessions::SessionOperationLease::try_acquire(&fixture.store_path, SESSION).is_err());
    let busy = fixture
        .service
        .try_submit_prompt("prompt".to_string())
        .err()
        .expect("prompts are busy during a user command");
    assert!(matches!(
        &busy,
        SessionSubmitError::ExternalBusy {
            session_id: SessionOperationBusy::Local {
                active_operation: ActiveSessionOperationSnapshot::UserCommand { .. },
                ..
            }
        }
    ));
    assert_eq!(busy.to_string(), "session is busy with a user command");
    assert!(matches!(
        fixture.service.try_compact(),
        Err(SessionCompactionAdmissionError::Busy {
            active_operation: ActiveSessionOperationSnapshot::UserCommand { .. }
        })
    ));
    assert_eq!(
        fixture
            .service
            .frontend_snapshot()
            .await
            .unwrap()
            .active_user_command
            .map(|c| c.state),
        Some(UserCommandState::Executing)
    );

    fixture.service.cancel_user_command("long").await.unwrap();
    let cancelled = settled(&fixture.service, "long").await;
    assert_eq!(cancelled.state, UserCommandState::Cancelled);
    assert!(cancelled.process_started);
    assert_eq!(records(&fixture.service).await.len(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn same_request_replays_and_a_different_payload_conflicts() {
    let fixture = Fixture::new("replay", ModelClient::new_for_test(), Vec::new());
    fixture.submit("once", COUNTED, None).unwrap();
    let settled_command = settled(&fixture.service, "once").await;
    assert_eq!(
        settled_command.state,
        UserCommandState::Completed,
        "{settled_command:?}"
    );

    for timeout_ms in [None, Some(30_000)] {
        let replay = fixture.submit("once", COUNTED, timeout_ms).unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.command, settled_command);
    }
    for (command, timeout_ms) in [("printf other", None), (COUNTED, Some(5))] {
        assert_eq!(
            fixture.submit("once", command, timeout_ms).unwrap_err(),
            UserCommandSubmitError::Conflict {
                request_id: "once".to_string()
            }
        );
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(fixture.executions(), 1);
    assert_eq!(fixture.rows().len(), 1);
    assert_eq!(records(&fixture.service).await.len(), 1);

    let admit = |request_id: &str| {
        crate::store::admit_user_command(
            &fixture.store_path,
            SESSION,
            request_id,
            "digest",
            "printf x",
            30_000,
            None,
        )
        .unwrap()
    };
    assert!(matches!(
        admit("first"),
        crate::store::UserCommandAdmitOutcome::Admitted(_)
    ));
    assert!(
        matches!(admit("second"), crate::store::UserCommandAdmitOutcome::Busy(active) if active.request_id == "first")
    );
    assert!(matches!(
        admit("first"),
        crate::store::UserCommandAdmitOutcome::Existing(_)
    ));
    assert_eq!(fixture.rows().len(), 2);
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_cancel_and_rejection_are_distinct_terminal_states() {
    let fixture = Fixture::new(
        "terminal-states",
        ModelClient::new_for_test(),
        vec![PermissionRule::new(
            "execute",
            "command:[printf][denied]*",
            PermissionEffect::Deny,
        )],
    );

    fixture.submit("timeout", "sleep 30", Some(300)).unwrap();
    let timed_out = settled(&fixture.service, "timeout").await;
    assert_eq!(timed_out.state, UserCommandState::TimedOut);
    assert!(timed_out.process_started);

    fixture.submit("pre-spawn", COUNTED, None).unwrap();
    fixture
        .service
        .cancel_user_command("pre-spawn")
        .await
        .unwrap();
    let cancelled = settled(&fixture.service, "pre-spawn").await;
    assert_eq!(cancelled.state, UserCommandState::Cancelled);
    assert!(!cancelled.process_started);

    for (request_id, command) in [
        ("hard", "LD_PRELOAD=./payload.so printf x"),
        ("configured", "printf denied"),
    ] {
        fixture.submit(request_id, command, None).unwrap();
        let rejected = settled(&fixture.service, request_id).await;
        assert_eq!(rejected.state, UserCommandState::Rejected);
        assert!(!rejected.process_started);
        assert!(rejected.reason.unwrap().contains("permission denied"));
    }
    assert_eq!(fixture.executions(), 0);
    assert_eq!(records(&fixture.service).await.len(), 4);
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_after_executing_commit_before_spawn_reports_no_started_process() {
    let fixture = Fixture::new("cancel-at-spawn", ModelClient::new_for_test(), Vec::new());
    let gate = fixture
        .service
        .terminal_manager
        .one_shot_spawn_gate_for_test();
    let held = gate.lock().await;
    fixture.submit("cancel-at-spawn", COUNTED, None).unwrap();
    executing(&fixture.service, "cancel-at-spawn").await;
    fixture
        .service
        .cancel_user_command("cancel-at-spawn")
        .await
        .unwrap();
    drop(held);
    let cancelled = settled(&fixture.service, "cancel-at-spawn").await;
    assert_eq!(cancelled.state, UserCommandState::Cancelled);
    assert!(!cancelled.process_started);
    assert_eq!(fixture.executions(), 0);
}

#[test]
fn a_post_spawn_execution_failure_is_unknown_instead_of_a_spawn_failure() {
    let output = CommandOutput {
        status: CommandStatus::SpawnError,
        exit_code: None,
        wall_time_ms: 100,
        stdout_preview: "effect already happened".into(),
        stderr_preview: "cleanup failed".into(),
        output_id: Some("retained-output".into()),
        stdout_bytes: 23,
        stderr_bytes: 0,
        truncated: false,
        overflowed: false,
    };
    let outcome = invocation_terminal(
        Ok(ToolResult::text(
            serde_json::to_string(&output).unwrap(),
            true,
        )),
        false,
    );
    assert_eq!(outcome.state, UserCommandState::OutcomeUnknown);
    assert!(outcome.process_started);
    assert!(outcome.reason.unwrap().contains("not rerun"));
    assert!(outcome.result.is_some());
}

#[cfg(unix)]
#[tokio::test]
async fn failed_start_transition_terminates_without_spawning() {
    let fixture = Fixture::new("start-fault", ModelClient::new_for_test(), Vec::new());
    crate::store::fail_next_user_command_start_for_test("fault");
    let admission = fixture.submit("fault", COUNTED, None).unwrap();
    assert_eq!(admission.command.state, UserCommandState::Admitted);

    let command = settled(&fixture.service, "fault").await;
    assert_eq!(command.state, UserCommandState::Rejected);
    assert!(!command.process_started);
    assert_eq!(fixture.executions(), 0);
    assert_eq!(records(&fixture.service).await.len(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn lost_terminal_ack_replays_the_same_receipt_without_a_second_record() {
    let fixture = Fixture::new("lost-ack", ModelClient::new_for_test(), Vec::new());
    crate::store::admit_user_command(
        &fixture.store_path,
        SESSION,
        "lost",
        "digest",
        "printf x",
        30_000,
        None,
    )
    .unwrap();
    assert!(
        crate::store::mark_user_command_executing(&fixture.store_path, SESSION, "lost").unwrap()
    );
    let lease = Arc::new(fixture.lease());
    let writer = crate::store::TranscriptLogWriter::for_user_command(
        &fixture.store_path,
        SESSION,
        "lost",
        &lease,
    )
    .unwrap();
    let terminal = UserCommandTerminal {
        from: UserCommandState::Executing,
        state: UserCommandState::Completed,
        result: None,
        reason: None,
        process_started: true,
        finished_at_epoch_ms: 1,
    };
    let executing = crate::store::find_user_command(&fixture.store_path, SESSION, "lost")
        .unwrap()
        .unwrap()
        .snapshot;
    let record = crate::store::user_command_record(&executing.finished(&terminal));

    writer.lose_next_append_ack_for_test();
    let lost = writer
        .commit_user_command(SESSION, "lost", &record, &terminal)
        .unwrap_err();
    assert_eq!(
        lost.downcast_ref::<crate::store::TranscriptAppendError>(),
        Some(&crate::store::TranscriptAppendError::CommitUncertain)
    );
    let receipt = writer
        .commit_user_command(SESSION, "lost", &record, &terminal)
        .unwrap();
    assert_eq!(
        writer
            .commit_user_command(SESSION, "lost", &record, &terminal)
            .unwrap(),
        receipt
    );

    let row = crate::store::find_user_command(&fixture.store_path, SESSION, "lost")
        .unwrap()
        .unwrap()
        .snapshot;
    assert_eq!(row.state, UserCommandState::Completed);
    assert_eq!(row.message_index, Some(receipt.start_idx as usize));
    assert_eq!(records(&fixture.service).await.len(), 1);

    fixture
        .service
        .reconcile_durable_run_recovery(&lease)
        .await
        .unwrap();
    assert_eq!(
        crate::store::find_user_command(&fixture.store_path, SESSION, "lost")
            .unwrap()
            .unwrap()
            .snapshot,
        row
    );
    assert_eq!(records(&fixture.service).await.len(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn credential_values_are_redacted_from_every_projection() {
    let fixture = Fixture::new("redaction", ModelClient::new_for_test(), Vec::new());
    fixture
        .submit("secret", "printf \"$NAC_TEST_SECRET\"", None)
        .unwrap();
    let command = settled(&fixture.service, "secret").await;

    assert_eq!(command.state, UserCommandState::Completed, "{command:?}");
    assert!(command.stdout_preview.contains("[REDACTED]"));
    let lookup =
        serde_json::to_string(&fixture.service.user_command("secret").await.unwrap()).unwrap();
    let row: String = crate::store::open_connection(&fixture.store_path)
        .unwrap()
        .query_row(
            "SELECT COALESCE(result_json, '') || command FROM session_user_commands",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let page = fixture
        .service
        .read_user_command_output("secret", OutputStream::Combined, 0, 4_096)
        .await
        .unwrap();
    assert!(page.content.contains("[REDACTED]"));
    let mut offset = 0;
    let mut paged_output = String::new();
    loop {
        let page = fixture
            .service
            .read_user_command_output("secret", OutputStream::Combined, offset, 4)
            .await
            .unwrap();
        paged_output.push_str(&page.content);
        offset = page.next_offset;
        if page.eof {
            break;
        }
    }
    assert!(
        !paged_output.contains(SECRET),
        "credential crossed page boundaries"
    );
    assert!(paged_output.contains("[REDACTED]"));
    for exposed in [
        lookup,
        row,
        page.content,
        records(&fixture.service).await.join("\n"),
    ] {
        assert!(!exposed.contains(SECRET), "credential leaked: {exposed}");
    }
    assert_eq!(
        fixture
            .service
            .read_user_command_output("missing", OutputStream::Combined, 0, 16)
            .await
            .unwrap_err(),
        UserCommandOutputError::NotFound
    );
}

#[cfg(unix)]
#[tokio::test]
async fn literal_credential_executes_exactly_but_is_redacted_from_durable_intent_and_results() {
    let fixture = Fixture::new("literal-secret", ModelClient::new_for_test(), Vec::new());
    let payload = format!("test '{SECRET}' = \"$NAC_TEST_SECRET\"");
    let admitted = fixture.submit("literal", &payload, None).unwrap();
    assert!(!admitted.command.command.contains(SECRET));
    let command = settled(&fixture.service, "literal").await;
    assert_eq!(command.state, UserCommandState::Completed, "{command:?}");
    assert_eq!(command.exit_code, Some(0));
    assert!(fixture.submit("literal", &payload, None).unwrap().replayed);
    assert!(matches!(
        fixture.submit("literal", "printf different", None),
        Err(UserCommandSubmitError::Conflict { .. })
    ));
    for exposed in [
        serde_json::to_string(&fixture.rows()).unwrap(),
        records(&fixture.service).await.join("\n"),
    ] {
        assert!(!exposed.contains(SECRET), "literal credential leaked");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn reopened_service_reconciles_unsettled_commands_once_without_rerunning() {
    let fixture = Fixture::new("reconcile", ModelClient::new_for_test(), Vec::new());
    let admit = |request_id: &str| {
        crate::store::admit_user_command(
            &fixture.store_path,
            SESSION,
            request_id,
            "digest",
            COUNTED,
            30_000,
            None,
        )
        .unwrap();
    };
    let state = |request_id: &str| {
        crate::store::find_user_command(&fixture.store_path, SESSION, request_id)
            .unwrap()
            .unwrap()
            .snapshot
    };

    admit("admitted-crash");
    let reopened = fixture.reopen();
    assert!(reopened.has_unreconciled_durable_run_recovery().unwrap());
    let lease = fixture.lease();
    reopened
        .reconcile_durable_run_recovery(&lease)
        .await
        .unwrap();
    reopened
        .reconcile_durable_run_recovery(&lease)
        .await
        .unwrap();
    drop(lease);
    let interrupted = state("admitted-crash");
    assert_eq!(interrupted.state, UserCommandState::Interrupted);
    assert!(!interrupted.process_started);
    assert!(interrupted.message_index.is_some());
    assert!(!reopened.has_unreconciled_durable_run_recovery().unwrap());
    assert_eq!(records(&reopened).await.len(), 1);

    admit("executing-crash");
    assert!(crate::store::mark_user_command_executing(
        &fixture.store_path,
        SESSION,
        "executing-crash"
    )
    .unwrap());
    let reopened = fixture.reopen();
    reopened
        .submit_user_command_with_lease(request("next", "printf next", None), fixture.lease())
        .unwrap();
    assert_eq!(
        settled(&reopened, "next").await.state,
        UserCommandState::Completed
    );
    let unknown = state("executing-crash");
    assert_eq!(unknown.state, UserCommandState::OutcomeUnknown);
    assert!(unknown.reason.unwrap().contains("not rerun"));
    assert_eq!(records(&reopened).await.len(), 3);

    let lease = Arc::new(fixture.lease());
    let late = UserCommandTerminal {
        from: UserCommandState::Executing,
        state: UserCommandState::Completed,
        result: None,
        reason: None,
        process_started: true,
        finished_at_epoch_ms: 1,
    };
    let record = crate::store::user_command_record(&state("executing-crash").finished(&late));
    let writer = crate::store::TranscriptLogWriter::for_user_command(
        &fixture.store_path,
        SESSION,
        "executing-crash",
        &lease,
    )
    .unwrap();
    assert!(writer
        .commit_user_command(SESSION, "executing-crash", &record, &late)
        .is_err());
    assert_eq!(
        state("executing-crash").state,
        UserCommandState::OutcomeUnknown
    );
    assert_eq!(records(&reopened).await.len(), 3);
    assert_eq!(fixture.executions(), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn queued_input_runs_after_the_command_and_sees_its_record_first() {
    let bodies = Arc::new(StdMutex::new(Vec::new()));
    let observed = Arc::clone(&bodies);
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "answer"}]}],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            })
            .to_string(),
        )],
        move |_, request| {
            observed
                .lock()
                .unwrap()
                .push(String::from_utf8_lossy(&request.body).into_owned());
        },
    );
    let fixture = Fixture::new(
        "follow-up",
        ModelClient::new_for_test_server(server.base_url.clone()),
        Vec::new(),
    );

    fixture
        .submit("first", "sleep 1; printf done", None)
        .unwrap();
    executing(&fixture.service, "first").await;
    fixture
        .service
        .enqueue_direct_input(crate::store::InboxDelivery::Queue, "queued follow up", None)
        .await
        .unwrap();
    assert!(matches!(
        fixture.service.active_operation(),
        Some(ActiveSessionOperationSnapshot::UserCommand { .. })
    ));

    assert_eq!(
        settled(&fixture.service, "first").await.state,
        UserCommandState::Completed
    );
    for _ in 0..500 {
        if !bodies.lock().unwrap().is_empty() && !fixture.service.has_active_operation() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let bodies = bodies.lock().unwrap();
    assert_eq!(bodies.len(), 1);
    let record = bodies[0]
        .find("<user_command>")
        .expect("the provider sees the record");
    let follow_up = bodies[0]
        .find("queued follow up")
        .expect("the provider sees the prompt");
    assert!(record < follow_up);
}

#[cfg(unix)]
#[tokio::test]
async fn revert_removes_the_record_while_lookup_keeps_the_terminal_state() {
    let fixture = Fixture::new("revert", ModelClient::new_for_test(), Vec::new());
    fixture.submit("reverted", "printf kept", None).unwrap();
    let command = settled(&fixture.service, "reverted").await;

    fixture
        .service
        .revert_to_message(command.message_index.unwrap())
        .await
        .unwrap();

    let after = fixture
        .service
        .user_command("reverted")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after.state, UserCommandState::Completed);
    assert_eq!(after.message_index, None);
    assert!(records(&fixture.service).await.is_empty());
}

#[path = "user_command_lifecycle_tests.rs"]
mod lifecycle;
