//! Accepted answer delivery must leave the goal's own continuation/retry owner.
use super::*;
use axum::response::IntoResponse;
use nac_core::permissions::PermissionApprovalMode;
use nac_core::store::{GoalStatus, HeartbeatOccurrenceState, HeartbeatOutcome, QuestionAnswer};
use std::sync::atomic::{AtomicUsize, Ordering};

fn text(value: &str) -> serde_json::Value {
    serde_json::json!([{"type":"message","role":"assistant","content":[{"type":"output_text","text":value}]}])
}
fn call(name: &str, id: &str, args: serde_json::Value) -> serde_json::Value {
    serde_json::json!({"type":"function_call","call_id":id,"name":name,"arguments":args.to_string()})
}

async fn delivery_case(information: bool, transient: bool) {
    let root =
        std::env::temp_dir().join(format!("nac-heartbeat-delivery-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("heartbeat-fixture-key"));
    let path = root.join("store.db");
    let target_calls = Arc::new(AtomicUsize::new(0));
    let caller_calls = Arc::new(AtomicUsize::new(0));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let runs = Arc::new(Mutex::new(Vec::new()));
    let fourth = Arc::new(tokio::sync::Notify::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (counter, callers, seen, run_ids, entered, model_path) = (
        target_calls.clone(),
        caller_calls.clone(),
        bodies.clone(),
        runs.clone(),
        fourth.clone(),
        path.clone(),
    );
    let model = tokio::spawn(async move {
        axum::serve(listener, axum::Router::new().route("/v1/responses", axum::routing::post(
            move |axum::Json(body): axum::Json<serde_json::Value>| {
                let (counter, callers, seen, run_ids, entered, path) = (
                    counter.clone(), callers.clone(), seen.clone(), run_ids.clone(), entered.clone(), model_path.clone(),
                );
                async move {
                    let output = if body["model"] == "caller-model" {
                        let i = callers.fetch_add(1, Ordering::SeqCst);
                        match i {
                            0 => {
                                let q = store::list_task_questions(&path, "chat").unwrap().remove(0);
                                let args = serde_json::json!({"session_id":"chat","project_id":null,"request_id":q.request.request_id,"run_id":q.request.run_id,"generation":q.request.generation,"expected_revision":q.revision,"answer":"CSV"});
                                if information {
                                    serde_json::json!([call("answer_question", "answer-one", args.clone()), call("answer_question", "answer-replay", args)])
                                } else {
                                    serde_json::json!([call("answer_question", "human-only-rejection", args)])
                                }
                            }
                            1 => {
                                assert!(body.to_string().contains(if information { "continuation_run_id" } else { "human_required" }));
                                text("The authorized response operation finished.")
                            }
                            _ => panic!("duplicate coordinator model call"),
                        }
                    } else {
                        let attempt = counter.fetch_add(1, Ordering::SeqCst);
                        let i = if transient && attempt >= 12 { attempt - 9 } else { attempt };
                        seen.lock().unwrap().push(body.clone());
                        let goal = store::load_session_goal(&path, "chat").unwrap().unwrap();
                        run_ids.lock().unwrap().push(goal.accounting_run_id.clone().unwrap());
                        // Ten real buffered-provider attempts exhaust its existing
                        // retry policy without artificial backoff in this fixture.
                        if transient && (2..12).contains(&attempt) {
                            return (axum::http::StatusCode::SERVICE_UNAVAILABLE,
                                [("retry-after", "0")], axum::Json(serde_json::json!({"error":{"message":"fixture capacity unavailable"}}))).into_response();
                        }
                        match i {
                            0 => {
                                let o = store::active_heartbeat_occurrences(&path).unwrap().remove(0);
                                serde_json::json!([call("report_heartbeat", "quiet-before-question", serde_json::json!({"occurrence_id":o.occurrence_id,"generation":o.generation,"expected_revision":o.revision,"outcome":"unchanged","evidence":"Observed before requesting the exact answer"}))])
                            }
                            1 => serde_json::json!([call("request_question", "blocking-question", serde_json::json!({"request_id":"delivery-question","text":"Which known format?","choices":["CSV","JSON"],"responder_class":if information {"information"}else{"human_decision"}}))]),
                            2 => text("The answer was consumed; verification remains for the goal."),
                            3 => {
                                if transient {
                                    assert_eq!(goal.consecutive_transient_failures, 1);
                                    assert!(goal.next_attempt_at_epoch_ms.is_some_and(|d| d <= std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64));
                                }
                                assert!(body.to_string().contains("Verify CSV then complete this finite goal"));
                                entered.notify_one();
                                serde_json::json!([call("update_goal", "target-owned-completion", serde_json::json!({"goal_id":goal.goal_id,"status":"complete"}))])
                            }
                            4 => text("CSV verified; the target goal is complete."),
                            _ => panic!("unexpected sixth target batch"),
                        }
                    };
                    axum::Json(serde_json::json!({"status":"completed","output":output,"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}})).into_response()
                }
            }
        ))).await.unwrap();
    });
    for (id, model_name) in [("chat", "target-model"), ("caller", "caller-model")] {
        let mut s = sessions::new_snapshot(
            id.into(),
            root.clone(),
            model_name.into(),
            url.clone(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".into()),
            BTreeMap::new(),
        );
        s.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(&path, &s).unwrap();
    }
    let manager = SessionManager::new_unowned_fixture(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .unwrap();
    let service = manager.attach_session("chat").await.unwrap();
    let caller = manager.attach_session("caller").await.unwrap();
    for s in [&service, &caller] {
        s.set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
            .await
            .unwrap();
    }
    let goal = store::create_session_goal(
        &path,
        "chat",
        "Verify CSV then complete this finite goal",
        Some(1000),
        None,
    )
    .unwrap();
    let app = HeartbeatApplication::new(&manager);
    let schedule = app
        .control(
            "chat",
            uuid::Uuid::new_v4().to_string(),
            HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: "Exact answer".into(),
                    instructions: "Report unchanged then ask the exact format.".into(),
                    skills: vec![],
                    cadence: nac_core::store::HeartbeatCadence::Interval {
                        interval_ms: 60_000,
                    },
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
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if target_calls.load(Ordering::SeqCst) == 2
                && !service.has_active_operation()
                && store::list_task_questions(&path, "chat").unwrap().len() == 1
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let before = store::read_heartbeat(&path, "chat", &schedule.schedule_id).unwrap();
    let q = store::list_task_questions(&path, "chat").unwrap().remove(0);
    // Actual prepared native answer, including the human-only rejection branch.
    caller.try_submit_prompt("Supply the already-authorized CSV information, retry identical delivery once; human decisions must be rejected.".into()).unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while caller_calls.load(Ordering::SeqCst) < 2 || caller.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    if !information {
        assert_eq!(
            store::load_task_question(&path, "chat", &q.request.request_id)
                .unwrap()
                .unwrap()
                .status,
            "pending"
        );
        let answer = QuestionAnswer {
            request_id: q.request.request_id.clone(),
            run_id: q.request.run_id.clone(),
            generation: q.request.generation.clone(),
            expected_revision: q.revision,
            answer: "CSV".into(),
        };
        let receipt = service.answer_task_question(answer.clone()).await.unwrap();
        assert_eq!(receipt, service.answer_task_question(answer).await.unwrap());
    }
    let mut retry_observed = false;
    if transient {
        retry_observed = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let g = store::load_session_goal(&path, "chat").unwrap().unwrap();
                if g.next_attempt_at_epoch_ms.is_some() && !service.has_active_operation() {
                    assert_eq!(g.status, GoalStatus::Active);
                    assert!(g.last_failure.as_ref().unwrap().transient);
                    assert_eq!(target_calls.load(Ordering::SeqCst), 12);
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .is_ok();
    }
    let fourth_arrived = tokio::time::timeout(Duration::from_secs(5), fourth.notified())
        .await
        .is_ok();
    if fourth_arrived {
        tokio::time::timeout(Duration::from_secs(10), async {
            while target_calls.load(Ordering::SeqCst) < if transient { 14 } else { 5 }
                || service.has_active_operation()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
    let final_goal = store::load_session_goal(&path, "chat").unwrap().unwrap();
    let answered = store::load_task_question(&path, "chat", &q.request.request_id)
        .unwrap()
        .unwrap();
    let history = store::heartbeat_history(&path, "chat", &schedule.schedule_id).unwrap();
    let after = store::read_heartbeat(&path, "chat", &schedule.schedule_id).unwrap();
    let inbox = store::list_session_inbox(&path, "chat").unwrap();
    let counts = (
        target_calls.load(Ordering::SeqCst),
        caller_calls.load(Ordering::SeqCst),
    );
    let ids = runs.lock().unwrap().clone();
    let observed = bodies.lock().unwrap().clone();
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    // Idle is published before the finishing task's inbox wake returns. With
    // admission closed, another wake waits behind that session's existing
    // wake/with-lease caller, then returns without reading or admitting work.
    tokio::time::timeout(Duration::from_secs(10), async {
        for stopped in [&service, &caller] {
            assert!(stopped
                .start_next_direct_inbox_item()
                .await
                .unwrap()
                .is_none());
        }
    })
    .await
    .expect("stopped direct inbox callers must retire before fixture deletion");
    manager.drain_persistence().await.unwrap();
    model.abort();
    let _ = model.await;
    drop(caller);
    drop(service);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
    // All cleanup and accepted-answer evidence precede the meaningful e6 RED.
    assert_eq!(answered.status, "answered");
    assert_eq!(answered.continuation_state.as_deref(), Some("delivered"));
    assert_eq!(answered.answer.as_ref().unwrap().run_id, q.request.run_id);
    assert_eq!(counts.1, 2);
    assert_eq!(inbox.len(), 2);
    assert_eq!(
        inbox
            .iter()
            .filter(|i| i.delivered_run_id.as_deref()
                == Some(&answered.answer.as_ref().unwrap().continuation_run_id))
            .count(),
        1
    );
    assert_eq!(before.state, HeartbeatState::Suspended);
    assert_eq!(after, before);
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].state, HeartbeatOccurrenceState::Settled);
    assert_eq!(history[0].outcome, Some(HeartbeatOutcome::NeedsHumanAction));
    println!("DELIVERED_ANSWER_AFTERMATH information={information} transient={transient} target_calls={} goal={:?} goal_id={} retry_observed={retry_observed}",counts.0,final_goal.status,final_goal.goal_id);
    if transient {
        // Preserved adapter gap: these legacy buffered HTTP errors are untyped,
        // so they block the goal and do not qualify transient timer behavior.
        assert!(!fourth_arrived);
        assert_eq!(counts.0, 12);
        assert_eq!(final_goal.status, GoalStatus::Blocked);
        assert!(!final_goal.last_failure.as_ref().unwrap().transient);
        return;
    }
    assert!(
        fourth_arrived,
        "F4-R1: exact delivered answer must release the FOURTH automatic goal turn"
    );
    assert_eq!(counts.0, if transient { 14 } else { 5 });
    assert_eq!(observed.len(), if transient { 14 } else { 5 });
    assert_eq!(ids[0], ids[1]);
    let goal_batch = if transient { 12 } else { 3 };
    assert_eq!(ids[goal_batch], ids[goal_batch + 1]);
    assert_eq!(ids[2], answered.answer.unwrap().continuation_run_id);
    assert_ne!(ids[1], ids[2]);
    assert_ne!(ids[2], ids[goal_batch]);
    assert_ne!(ids[0], ids[goal_batch]);
    assert_eq!(final_goal.goal_id, goal.goal_id);
    assert_eq!(final_goal.status, GoalStatus::Complete);
    assert_eq!(final_goal.token_budget, Some(1000));
    assert_eq!(final_goal.tokens_used, if transient { 60 } else { 75 });
    assert!(final_goal.accounting_run_id.is_none());
    assert!(final_goal.continuation_run_id.is_none());
    assert!(final_goal.next_attempt_at_epoch_ms.is_none());
    assert!(!transient || retry_observed);
}

#[tokio::test]
async fn heartbeat_question_delivery_human_decision_releases_automatic_goal() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    delivery_case(false, false).await;
}
#[tokio::test]
async fn heartbeat_question_delivery_authorized_information_releases_automatic_goal() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    delivery_case(true, false).await;
}
#[tokio::test]
async fn heartbeat_question_delivery_legacy_http503_is_blocked_not_retry_evidence() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    delivery_case(false, true).await;
}
