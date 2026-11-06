//! A real two-batch native report/question yield and exact answer continuation.
use super::*;
use nac_core::permissions::PermissionApprovalMode;
use nac_core::store::{HeartbeatOccurrenceState, HeartbeatOutcome, QuestionAnswer};
use std::sync::atomic::{AtomicUsize, Ordering};

async fn settled(manager: &SessionManager, id: &str) -> HeartbeatOccurrence {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let path = manager.inner.store_path.clone();
            let id = id.to_owned();
            let history = store::spawn_blocking_store_caller(move || {
                store::heartbeat_history(&path, "chat", &id)
            })
            .await
            .unwrap()
            .unwrap();
            if let Some(result) = history
                .into_iter()
                .find(|o| o.state == HeartbeatOccurrenceState::Settled)
            {
                if !manager
                    .attach_session("chat")
                    .await
                    .unwrap()
                    .has_active_operation()
                {
                    return result;
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

async fn question_yield_case(bound_goal: bool) {
    let root =
        std::env::temp_dir().join(format!("nac-heartbeat-question-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("heartbeat-fixture-key"));
    let path = root.join("store.db");
    let requests = Arc::new(AtomicUsize::new(0));
    let bodies = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let request_count = Arc::clone(&requests);
    let observed_bodies = Arc::clone(&bodies);
    let model_path = path.clone();
    let model = tokio::spawn(async move {
        axum::serve(listener, axum::Router::new().route("/v1/responses", axum::routing::post(
            move |axum::Json(body): axum::Json<serde_json::Value>| {
                let index = request_count.fetch_add(1, Ordering::SeqCst);
                observed_bodies.lock().unwrap().push(body);
                let path = model_path.clone();
                async move {
                    let output = match index {
                        0 => {
                            let active = store::spawn_blocking_store_caller(move || store::active_heartbeat_occurrences(&path)).await.unwrap().unwrap().remove(0);
                            let args = serde_json::json!({"occurrence_id":active.occurrence_id,"generation":active.generation,"expected_revision":active.revision,"outcome":"unchanged","evidence":"Job unchanged before choosing the next check"});
                            serde_json::json!([{"type":"function_call","call_id":"early-unchanged","name":"report_heartbeat","arguments":args.to_string()}])
                        }
                        1 => {
                            // The first report really executed before a separate provider batch.
                            let active = store::spawn_blocking_store_caller(move || store::active_heartbeat_occurrences(&path)).await.unwrap().unwrap().remove(0);
                            assert_eq!(active.provisional_outcome, Some(HeartbeatOutcome::Unchanged));
                            let args = serde_json::json!({"request_id":"heartbeat-decision","text":"Which result should be checked next?","choices":["CSV","JSON"],"responder_class":"human_decision"});
                            serde_json::json!([{"type":"function_call","call_id":"blocking-question","name":"request_question","arguments":args.to_string()}])
                        }
                        2 => serde_json::json!([{"type":"message","role":"assistant","content":[{"type":"output_text","text":"The exact answer was consumed once."}]}]),
                        _ => panic!("unexpected extra provider call {index}"),
                    };
                    axum::Json(serde_json::json!({"status":"completed","output":output,"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}))
                }
            }
        ))).await.unwrap();
    });
    let mut snapshot = sessions::new_snapshot(
        "chat".into(),
        root.clone(),
        "fixture-model".into(),
        url,
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".into()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&path, &snapshot).unwrap();
    let manager = SessionManager::new_unowned_fixture(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .unwrap();
    let service = manager.attach_session("chat").await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let goal = if bound_goal {
        Some(
            store::create_session_goal(&path, "chat", "Existing finite work", Some(45), None)
                .unwrap(),
        )
    } else {
        None
    };
    let app = HeartbeatApplication::new(&manager);
    let schedule = app
        .control(
            "chat",
            uuid::Uuid::new_v4().to_string(),
            HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: "Question check".into(),
                    instructions: "Report the job, then ask which result to check next.".into(),
                    skills: Vec::new(),
                    cadence: nac_core::store::HeartbeatCadence::Interval {
                        interval_ms: 60_000,
                    },
                    end_condition: "Finish after the decision is handled.".into(),
                    goal_id: goal.as_ref().map(|g| g.goal_id.clone()),
                    execution_timeout_ms: 60_000,
                    max_occurrences: 1000,
                    token_allowance: None,
                },
            },
        )
        .await
        .unwrap()
        .schedule;
    app.control(
        "chat",
        uuid::Uuid::new_v4().to_string(),
        HeartbeatAction::RunNow {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: schedule.version,
        },
    )
    .await
    .unwrap();
    tick(&manager).await.unwrap();
    let result = settled(&manager, &schedule.schedule_id).await;
    let before_answer_calls = requests.load(Ordering::SeqCst);
    let question = store::list_task_questions(&path, "chat").unwrap().remove(0);
    let list = manager
        .session_catalog()
        .list(false)
        .await
        .unwrap()
        .remove(0);
    let current = store::read_heartbeat(&path, "chat", &schedule.schedule_id).unwrap();
    let goal_after_yield = store::load_session_goal(&path, "chat").unwrap();
    let input = QuestionAnswer {
        request_id: question.request.request_id.clone(),
        run_id: question.request.run_id.clone(),
        generation: question.request.generation.clone(),
        expected_revision: question.revision,
        answer: "CSV".into(),
    };
    let receipt = service.answer_task_question(input.clone()).await.unwrap();
    let replay = service.answer_task_question(input).await.unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while requests.load(Ordering::SeqCst) < 3 || service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let answered = store::load_task_question(&path, "chat", &question.request.request_id)
        .unwrap()
        .unwrap();
    let history = store::heartbeat_history(&path, "chat", &schedule.schedule_id).unwrap();
    let goal_after_answer = store::load_session_goal(&path, "chat").unwrap();
    let inbox = store::list_session_inbox(&path, "chat").unwrap();
    let messages = store::TranscriptLogWriter::new(&path)
        .unwrap()
        .read_from("chat", 0)
        .unwrap();
    let call_count = requests.load(Ordering::SeqCst);
    let bodies_count = bodies.lock().unwrap().len();
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    // Idle precedes the finishing task's final inbox wake. Closed admission
    // makes this wait retire that session's earlier wake without new work.
    tokio::time::timeout(Duration::from_secs(10), async {
        assert!(service
            .start_next_direct_inbox_item()
            .await
            .unwrap()
            .is_none());
    })
    .await
    .expect("stopped direct inbox caller must retire before fixture deletion");
    manager.drain_persistence().await.unwrap();
    model.abort();
    let _ = model.await;
    drop(service);
    drop(manager);
    std::fs::remove_dir_all(&root).unwrap();
    // Cleanup precedes the expected old-source RED assertion.
    assert_eq!(before_answer_calls, 2);
    assert_eq!(call_count, 3);
    assert_eq!(bodies_count, 3);
    assert_eq!(question.request.run_id, *result.run_id.as_ref().unwrap());
    assert_eq!(
        question.request.generation,
        *result.run_id.as_ref().unwrap()
    );
    assert_eq!(question.status, "pending");
    assert_eq!(
        result.provisional_outcome,
        Some(HeartbeatOutcome::Unchanged)
    );
    assert_eq!(receipt, replay);
    assert_eq!(answered.continuation_state.as_deref(), Some("delivered"));
    assert_eq!(inbox.len(), 2);
    assert_eq!(
        inbox
            .iter()
            .filter(|i| i.delivered_run_id.as_deref() == Some(&receipt.continuation_run_id))
            .count(),
        1
    );
    assert!(!messages.is_empty());
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].occurrence_id, result.occurrence_id);
    assert_eq!(
        goal_after_yield.as_ref().map(|g| &g.goal_id),
        goal.as_ref().map(|g| &g.goal_id)
    );
    if let Some(goal) = goal_after_yield {
        assert_eq!(goal.status, store::GoalStatus::Active);
        assert!(goal.accounting_run_id.is_none());
        let final_goal = goal_after_answer.unwrap();
        assert_eq!(final_goal.goal_id, goal.goal_id);
        assert_eq!(final_goal.tokens_used, goal.tokens_used + 15);
        assert_eq!(final_goal.status, store::GoalStatus::BudgetLimited);
    }
    assert_eq!(
        result.outcome,
        Some(HeartbeatOutcome::NeedsHumanAction),
        "a successful question yield must override an early quiet report"
    );
    assert_eq!(current.state, HeartbeatState::Suspended);
    assert_eq!(list.attention_updated_at, None);
    assert!(list
        .heartbeat_results
        .iter()
        .any(|r| r.occurrence_id == result.occurrence_id
            && r.outcome == HeartbeatOutcome::NeedsHumanAction
            && !r.seen));
}

#[tokio::test]
async fn heartbeat_question_yield_goal_free_overrides_early_unchanged() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    question_yield_case(false).await;
}

#[tokio::test]
async fn heartbeat_question_yield_exact_goal_keeps_accounting_and_answer_continuation() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    question_yield_case(true).await;
}
