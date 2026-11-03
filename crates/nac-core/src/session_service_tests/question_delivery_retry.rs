//! Controlled typed termination at the existing owning lifecycle test seam.
//! HTTP-provider classification is deliberately not claimed by this fixture.
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::permissions::{PermissionApprovalMode, PermissionEffect, PermissionRule};
use crate::store::{HeartbeatAction, HeartbeatSpec, HeartbeatState, QuestionAnswer};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Condvar, Mutex,
};

fn response(output: serde_json::Value) -> ScriptedResponse {
    ScriptedResponse::json("200 OK",serde_json::json!({"status":"completed","output":output,"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}).to_string())
}
fn tool(name: &str, args: serde_json::Value) -> serde_json::Value {
    serde_json::json!([{"type":"function_call","call_id":name,"name":name,"arguments":args.to_string()}])
}

#[tokio::test]
async fn heartbeat_question_delivery_typed_answer_failure_uses_real_goal_retry_timer() {
    let root = std::env::temp_dir().join(format!("nac-delivered-retry-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    let path = root.join("store.db");
    let id = "delivered-retry";
    let mut snapshot = sessions::new_snapshot(
        id.into(),
        root.clone(),
        "gpt-5.5".into(),
        "http://127.0.0.1:1".into(),
        crate::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        vec![],
        None,
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&path, &snapshot).unwrap();
    let goal = crate::store::create_session_goal(
        &path,
        id,
        "Verify the delivered answer and finish",
        Some(1000),
        None,
    )
    .unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let held = gate.clone();
    let server = ScriptedServer::start_observed_with_timeout(
        vec![
            response(tool("get_goal", serde_json::json!({}))),
            response(tool(
                "request_question",
                serde_json::json!({"request_id":"retry-answer","text":"CSV?","choices":["CSV"],"responder_class":"human_decision"}),
            )),
            ScriptedResponse::json("200 OK", "{}").drop_connection(),
            response(tool(
                "update_goal",
                serde_json::json!({"goal_id":goal.goal_id,"status":"complete"}),
            )),
            response(
                serde_json::json!([{"type":"message","content":[{"type":"output_text","text":"The target goal is complete."}]}]),
            ),
        ],
        Duration::from_secs(20),
        move |index, _| {
            observed.fetch_add(1, Ordering::SeqCst);
            if index == 2 {
                let (lock, cv) = &*held;
                let mut released = lock.lock().unwrap();
                while !*released {
                    released = cv.wait(released).unwrap();
                }
            }
        },
    );
    snapshot.base_url = server.base_url.clone();
    sessions::update_session_config(&path, &snapshot).unwrap();
    let snapshot = sessions::load_session(&path, id).unwrap();
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
            session_behavior: Some(sessions::SessionBehavior::Direct),
            store_path: path.clone(),
            session_id: Some(id.into()),
            orchestrator_compaction_threshold: None,
            initial_messages: vec![],
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: root.clone(),
            config_cwd: root.clone(),
            working_directory: root.to_string_lossy().into_owned(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: vec![],
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: vec![PermissionRule::new("*", "*", PermissionEffect::Allow)],
        },
    )
    .unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: id.into(),
            store_path: path.clone(),
            snapshot,
        },
        sandbox_status: "off".into(),
        agents_md_status: "off".into(),
        workspace_display: root.to_string_lossy().into_owned(),
        workspace_git: None,
        resume_base_cwd: root.clone(),
    });
    let service = parts.service;
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let schedule = service
        .control_human_heartbeat(
            Uuid::new_v4().to_string(),
            HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: "Typed lifecycle retry".into(),
                    instructions: "Read the goal then ask the exact question.".into(),
                    skills: vec![],
                    interval_ms: 60_000,
                    end_condition: "Review the answer".into(),
                    goal_id: Some(goal.goal_id.clone()),
                    execution_timeout_ms: 60_000,
                    max_occurrences: 1000,
                    token_allowance: None,
                },
            },
        )
        .await
        .unwrap()
        .schedule;
    let pending = service
        .control_human_heartbeat(
            Uuid::new_v4().to_string(),
            HeartbeatAction::RunNow {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: schedule.version,
            },
        )
        .await
        .unwrap()
        .occurrence
        .unwrap();
    let lease = sessions::SessionOperationLease::try_acquire(&path, id).unwrap();
    assert!(service
        .start_heartbeat_occurrence(pending, lease)
        .await
        .unwrap()
        .is_some());
    tokio::time::timeout(Duration::from_secs(5), async {
        while calls.load(Ordering::SeqCst) < 2 || service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let q = crate::store::list_task_questions(&path, id)
        .unwrap()
        .remove(0);
    let receipt = service
        .answer_task_question(QuestionAnswer {
            request_id: q.request.request_id.clone(),
            run_id: q.request.run_id.clone(),
            generation: q.request.generation.clone(),
            expected_revision: q.revision,
            answer: "CSV".into(),
        })
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while calls.load(Ordering::SeqCst) < 3 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let delivered = crate::store::load_task_question(&path, id, &q.request.request_id)
        .unwrap()
        .unwrap();
    assert_eq!(delivered.continuation_state.as_deref(), Some("delivered"));
    let inbox = crate::store::load_session_inbox_item(&path, id, receipt.inbox_item_id).unwrap();
    assert_eq!(
        inbox.delivered_run_id.as_deref(),
        Some(receipt.continuation_run_id.as_str())
    );
    let run_id = SessionRunId::from_stored(receipt.continuation_run_id.clone());
    let task = {
        let mut guard = service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(run)) = guard.as_mut() else {
            panic!("exact answer run must be owned")
        };
        assert_eq!(run.snapshot.run_id, run_id);
        assert!(!run.finishing);
        assert!(run._operation_lease.is_some());
        run.task.take().unwrap()
    };
    // Stop only this exact model future, retain its canonical run and lease,
    // then exercise the established terminal owner, never cancellation/SQL.
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    {
        let (lock, cv) = &*gate;
        *lock.lock().unwrap() = true;
        cv.notify_one();
    }
    assert!(
        service
            .finish_run_once(
                &run_id,
                RunOutcome::Failed(
                    crate::run_failure::RunFailure {
                        kind: crate::run_failure::RunFailureKind::Transport,
                        phase: crate::run_failure::RunFailurePhase::Stream,
                        transient: true,
                        partial_output: Default::default(),
                        attempt_count: 1,
                        http_status: None,
                        retry_after_ms: None,
                        summary: "Controlled typed provider termination".into(),
                        diagnostic: "Owning lifecycle fixture, not HTTP classifier evidence".into(),
                        recovery_action: crate::run_failure::RecoveryAction::AutomaticRetry,
                    },
                    None
                )
            )
            .await
    );
    let retry = crate::store::load_session_goal(&path, id).unwrap().unwrap();
    assert_eq!(retry.status, crate::store::GoalStatus::Active);
    assert_eq!(retry.consecutive_transient_failures, 1);
    assert!(retry.last_failure.as_ref().unwrap().transient);
    let last_run: Option<String> = crate::store::open_runtime_connection(&path)
        .unwrap()
        .query_row(
            "SELECT last_run_id FROM session_goals WHERE session_id=?1",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        last_run.as_deref(),
        Some(receipt.continuation_run_id.as_str())
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    let deadline = retry.next_attempt_at_epoch_ms.unwrap();
    assert!(deadline > now_epoch_ms());
    let completed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let g = crate::store::load_session_goal(&path, id).unwrap().unwrap();
            if calls.load(Ordering::SeqCst) == 5
                && !service.has_active_operation()
                && g.status == crate::store::GoalStatus::Complete
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .is_ok();
    let final_goal = crate::store::load_session_goal(&path, id).unwrap().unwrap();
    let heartbeat = crate::store::read_heartbeat(&path, id, &schedule.schedule_id).unwrap();
    service.stop_run_admission().await.unwrap();
    // Idle precedes the finishing run's direct inbox wake. Keep the unowned
    // store alive until that session's admitted wake/read caller has retired.
    assert!(tokio::time::timeout(
        Duration::from_secs(5),
        service.start_next_direct_inbox_item(),
    )
    .await
    .expect("stopped direct inbox caller must retire before fixture deletion")
    .unwrap()
    .is_none());
    let requests = server.stop_and_finish();
    drop(service);
    drop(parts.events);
    std::fs::remove_dir_all(root).unwrap();
    println!("TYPED_DELIVERED_RETRY_AFTERMATH completed={completed} calls={} exact_answer_run={} deadline={deadline}",calls.load(Ordering::SeqCst),receipt.continuation_run_id);
    assert!(
        completed,
        "F4-R1: delivered answer typed failure must retain the REAL ordinary goal retry timer"
    );
    assert_eq!(requests.len(), 5);
    assert_eq!(final_goal.goal_id, goal.goal_id);
    assert_eq!(final_goal.token_budget, Some(1000));
    assert_eq!(final_goal.tokens_used, 60);
    assert!(final_goal.accounting_run_id.is_none());
    assert!(final_goal.next_attempt_at_epoch_ms.is_none());
    assert_eq!(heartbeat.state, HeartbeatState::Suspended);
    assert_eq!(heartbeat.starts, 1);
    assert!(String::from_utf8_lossy(&requests[3].body)
        .contains("Verify the delivered answer and finish"));
}
