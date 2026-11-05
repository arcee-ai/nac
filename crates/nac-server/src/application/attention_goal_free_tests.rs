//! Actual model/owned store/service/SSE goal-free settlement, never transcript inference.
use super::*;
use nac_core::{sessions, store};
use tokio::sync::Notify;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Case {
    Complete,
    HistoricalGoal,
    HistoricalGoalQueue,
    QueueAfterComplete,
    Queue,
    QueueThree,
    Question,
    Cancel,
    SaveFailure,
}

async fn wait_for(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

async fn run(case: Case) {
    let planned_calls = match case {
        Case::Queue | Case::HistoricalGoal => 2,
        Case::QueueThree | Case::HistoricalGoalQueue => 3,
        _ => 1,
    };
    let root = std::env::temp_dir().join(format!("nac-goal-free-feed-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let reached = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (seen, arrived, resume) = (calls.clone(), reached.clone(), release.clone());
    let provider = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/responses", axum::routing::post(move |Json(request): Json<serde_json::Value>| {
            let (seen, arrived, resume) = (seen.clone(), arrived.clone(), resume.clone());
            async move {
                let index = seen.fetch_add(1, Ordering::SeqCst);
                assert!(index < planned_calls, "unexpected provider call");
                arrived.notify_one();
                resume.notified().await;
                let item = if case == Case::Question {
                    serde_json::json!({"type":"function_call","call_id":"question","name":"request_question","arguments":serde_json::json!({"request_id":"goal-free-question","text":"Private choice","choices":[],"responder_class":"human_decision"}).to_string()})
                } else { serde_json::json!({"type":"message","content":[{"type":"output_text","text":"private result"}]}) };
                let response = serde_json::json!({"status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}});
                if request["stream"] == true {
                    ([("content-type","text/event-stream")],format!("data: {}\n\n",serde_json::json!({"type":"response.completed","response":response}))).into_response()
                } else { Json(response).into_response() }
            }
        }))).await.unwrap();
    });
    seed_direct_session(&root, "session");
    let path = root.join("store.db");
    let mut config = sessions::load_session(&path, "session").unwrap();
    config.base_url = base;
    sessions::update_session_config(&path, &config).unwrap();
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let app = crate::router(manager.clone());
    let service = manager.attach_session("session").await.unwrap();
    assert!(!service.has_event_subscribers());
    let mut body = open(app.clone()).await;
    assert_eq!(frame(&mut body).await["kind"], "baseline");
    assert!(!service.has_event_subscribers());
    let history_start = store::read_completion_page(&path, None).unwrap().cursor;
    let response = post(
        app.clone(),
        "/sessions/session/runs",
        serde_json::json!({"prompt":"Complete the requested work"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let submitted: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    let mut first_run = submitted["run_id"].as_str().unwrap().to_owned();
    let mut three_run_frontier = None;
    tokio::time::timeout(Duration::from_secs(5), reached.notified())
        .await
        .unwrap();
    let historical = if matches!(case, Case::HistoricalGoal | Case::HistoricalGoalQueue) {
        let goal = service
            .create_direct_goal("first goal", None)
            .await
            .unwrap();
        let (goal_path, goal_id) = (path.clone(), goal.goal_id.clone());
        store::spawn_blocking_store_caller(move || {
            store::update_session_goal_by_model(
                &goal_path,
                "session",
                &goal_id,
                store::GoalStatus::Complete,
            )
        })
        .await
        .unwrap()
        .unwrap();
        release.notify_one();
        let completed = fact(&mut body, "work_settled").await;
        assert_eq!(completed["change"]["work"]["disposition"], "completed");
        assert_eq!(completed["change"]["work"]["run_id"], first_run);
        assert_eq!(completed["change"]["work"]["goal"]["id"], goal.goal_id);
        wait_for(|| !service.has_active_operation()).await;
        let settled_goal = store::load_session_goal(&path, "session").unwrap().unwrap();
        assert_eq!(settled_goal.status, store::GoalStatus::Complete);
        assert!(settled_goal.accounting_run_id.is_none());
        let prior_run = first_run.clone();
        let response = post(
            app.clone(),
            "/sessions/session/runs",
            serde_json::json!({"prompt":"Later ordinary request"}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let submitted: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        first_run = submitted["run_id"].as_str().unwrap().to_owned();
        tokio::time::timeout(Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        Some((settled_goal, prior_run))
    } else {
        None
    };
    let mut expected_final = first_run.clone();
    if matches!(
        case,
        Case::Queue | Case::QueueThree | Case::HistoricalGoalQueue
    ) {
        service
            .enqueue_direct_input(
                store::InboxDelivery::Queue,
                "second requested work",
                None,
                None,
            )
            .await
            .unwrap();
        if case == Case::QueueThree {
            service
                .enqueue_direct_input(
                    store::InboxDelivery::Queue,
                    "third requested work",
                    None,
                    None,
                )
                .await
                .unwrap();
        }
    }
    if case == Case::SaveFailure {
        rusqlite::Connection::open(&path).unwrap().execute_batch("CREATE TRIGGER failed_terminal BEFORE INSERT ON session_run_outcomes BEGIN SELECT RAISE(ABORT,'terminal fixture failure'); END;").unwrap();
    }
    if case == Case::Cancel {
        manager
            .cancel_active_run_exact("session", &first_run)
            .await
            .unwrap();
        // Let the canceled request handler finish; it owns no second model call.
        release.notify_one();
    } else {
        release.notify_one();
    }
    if matches!(case, Case::Queue | Case::HistoricalGoalQueue) {
        tokio::time::timeout(Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        expected_final = service.active_run().unwrap().run_id.to_string();
        let continuing = fact(&mut body, "work_settled").await;
        assert_eq!(continuing["change"]["work"]["run_id"], first_run);
        assert_eq!(continuing["change"]["work"]["disposition"], "continuing");
        assert!(continuing["change"]["work"]["goal"].is_null());
        assert_eq!(continuing["new_attention"], false);
        release.notify_one();
    }
    if case == Case::QueueThree {
        tokio::time::timeout(Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        let b = service.active_run().unwrap().run_id.to_string();
        let live = manager
            .inner
            .attention
            .0
            .lock()
            .unwrap()
            .live
            .upgrade()
            .unwrap();
        wait_for(|| {
            let state = live.state.lock().unwrap();
            state.sources["session"]
                .service
                .as_ref()
                .unwrap()
                .settled
                .as_ref()
                .is_some_and(|work| {
                    work.run_id == first_run
                        && work.disposition == SettledWorkDisposition::Continuing
                })
        })
        .await;
        let a_producer_revision = live.state.lock().unwrap().sources["session"]
            .service
            .as_ref()
            .unwrap()
            .revision;
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        expected_final = service.active_run().unwrap().run_id.to_string();
        let continuing = fact(&mut body, "work_settled").await;
        assert_eq!(continuing["change"]["work"]["run_id"], b);
        assert_eq!(continuing["change"]["work"]["disposition"], "continuing");
        assert_eq!(continuing["new_attention"], false);
        let b_producer_revision = {
            let state = live.state.lock().unwrap();
            let current = state.sources["session"].service.as_ref().unwrap();
            assert_eq!(current.settled.as_ref().unwrap().run_id, b);
            assert_eq!(
                current.operation,
                AttentionOperation::Run(expected_final.clone())
            );
            assert!(current.revision > a_producer_revision);
            current.revision
        };
        while let Ok(item) =
            tokio::time::timeout(Duration::from_millis(100), frame(&mut body)).await
        {
            if item["change"]["kind"] == "work_settled" {
                assert_eq!(
                    item["change"]["work"]["run_id"], b,
                    "producer/SSE cannot regress to A while C is active"
                );
                assert_ne!(item["change"]["work"]["disposition"], "completed");
            }
        }
        three_run_frontier = Some((
            Arc::downgrade(&live),
            b_producer_revision,
            continuing["source_revision"].as_u64().unwrap(),
            continuing["source"]["epoch"].clone(),
        ));
        release.notify_one();
    }
    if matches!(
        case,
        Case::Complete
            | Case::Queue
            | Case::QueueThree
            | Case::QueueAfterComplete
            | Case::HistoricalGoal
            | Case::HistoricalGoalQueue
    ) {
        if let Some((_, prior_run)) = &historical {
            eprintln!("LEFTOVER_GOAL_REGRESSION: goal A={prior_run} completed; waiting for later request {expected_final} without goal attribution");
        }
        let completed = fact(&mut body, "work_settled").await;
        assert_eq!(completed["change"]["work"]["disposition"], "completed");
        assert!(completed["change"]["work"]["goal"].is_null());
        let run = completed["change"]["work"]["run_id"].as_str().unwrap();
        assert_eq!(run, expected_final);
        if let Some((weak, producer_revision, wire_revision, epoch)) = &three_run_frontier {
            assert_eq!(completed["source"]["epoch"], *epoch);
            assert!(completed["source_revision"].as_u64().unwrap() > *wire_revision);
            let live = weak.upgrade().unwrap();
            let state = live.state.lock().unwrap();
            let current = state.sources["session"].service.as_ref().unwrap();
            assert_eq!(current.settled.as_ref().unwrap().run_id, expected_final);
            assert_eq!(
                current.settled.as_ref().unwrap().disposition,
                SettledWorkDisposition::Completed
            );
            assert!(current.revision > *producer_revision);
        }
        assert_eq!(completed["new_attention"], true);
        assert!(!completed.to_string().contains("private result"));
        let metadata = store::read_attention_metadata(&path, Some("session"))
            .unwrap()
            .remove(0);
        assert!(metadata.verifies_goal_free_idle(run, service.config_version()));
        if case == Case::QueueAfterComplete {
            let peer = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
            service
                .enqueue_direct_input(
                    store::InboxDelivery::Queue,
                    "committed work awaiting a peer",
                    None,
                    None,
                )
                .await
                .unwrap();
            assert_eq!(
                service.list_direct_inbox().unwrap()[0].status,
                store::InboxStatus::Pending
            );
            assert_eq!(
                fact(&mut body, "work_cleared").await["new_attention"],
                false
            );
            let queued = service.list_direct_inbox().unwrap().remove(0);
            let cancelling = service.clone();
            let cancelled = store::spawn_blocking_store_caller(move || {
                cancelling.cancel_direct_inbox_item(queued.id, queued.version)
            })
            .await
            .unwrap()
            .unwrap();
            assert_eq!(cancelled.status, store::InboxStatus::Cancelled);
            let restored = fact(&mut body, "work_settled").await;
            assert_eq!(restored["change"]["work"]["run_id"], run);
            assert_eq!(restored["change"]["work"]["disposition"], "completed");
            assert_eq!(
                restored["new_attention"], false,
                "canceling queued work cannot renotify the prior run"
            );
            drop(peer);
        }
        if let Some((goal, prior_run)) = &historical {
            assert_eq!(
                store::load_session_goal(&path, "session").unwrap().as_ref(),
                Some(goal),
                "later requests must not change old goal identity, version, accounting or usage"
            );
            let metadata = store::read_attention_metadata(&path, Some("session"))
                .unwrap()
                .remove(0);
            assert_eq!(metadata.goal.unwrap().last_run.as_ref(), Some(prior_run));
            let page = store::read_completion_page(&path, Some(&history_start)).unwrap();
            assert!(!page.more);
            assert_eq!(page.items.len(), planned_calls);
            let goal_items: Vec<_> = page
                .items
                .iter()
                .filter(|item| item.kind == store::CompletionKind::Goal)
                .collect();
            assert_eq!(goal_items.len(), 1);
            assert_eq!(goal_items[0].run_id, *prior_run);
            assert_eq!(
                goal_items[0].goal_id.as_deref(),
                Some(goal.goal_id.as_str())
            );
            for request in page
                .items
                .iter()
                .filter(|item| item.kind == store::CompletionKind::Request)
            {
                assert!(request.goal_id.is_none());
                assert_ne!(request.run_id, *prior_run);
            }
            assert_eq!(
                page.items
                    .iter()
                    .filter(|item| item.run_id == first_run)
                    .count(),
                1
            );
            assert_eq!(
                page.items
                    .iter()
                    .filter(|item| item.run_id == expected_final)
                    .count(),
                1
            );
        }
        // A changed canonical configuration cannot keep the old service's proof.
        if case == Case::Complete {
            let mut updated = sessions::load_session(&path, "session").unwrap();
            updated.orchestrator_compaction_threshold = Some(64000);
            let value = updated.clone();
            let changing_path = path.clone();
            nac_core::store::spawn_blocking_store_caller(move || {
                sessions::update_session_config(&changing_path, &value)
            })
            .await
            .unwrap()
            .unwrap();
            assert_eq!(
                fact(&mut body, "work_cleared").await["new_attention"],
                false
            );
        }
        drop(body);
        wait_for(|| manager.inner.attention.0.lock().unwrap().seat.is_none()).await;
        body = open(app.clone()).await;
        let baseline = frame(&mut body).await;
        assert_eq!(baseline["kind"], "baseline");
        assert!(
            baseline["sources"][0]["work"].is_null(),
            "history alone cannot recreate settlement"
        );
    } else if case == Case::Question {
        let decision = fact(&mut body, "decision_pending").await;
        assert_eq!(decision["change"]["decision"]["kind"], "question");
        assert_eq!(decision["change"]["decision"]["run_id"], first_run);
        wait_for(|| !service.has_active_operation()).await;
        assert_eq!(
            store::list_task_questions(&path, "session").unwrap()[0].status,
            "pending"
        );
    } else {
        wait_for(|| !service.has_active_operation()).await;
        let metadata = store::read_attention_metadata(&path, Some("session"))
            .unwrap()
            .remove(0);
        assert!(!metadata.verifies_goal_free_idle(&first_run, service.config_version()));
        if case == Case::Cancel {
            assert_eq!(
                metadata.last_outcome.unwrap().disposition,
                store::RunOutcomeDisposition::Cancelled
            );
        } else {
            assert!(metadata.last_outcome.is_none());
            assert!(metadata.recovery_pending);
            rusqlite::Connection::open(&path)
                .unwrap()
                .execute_batch("DROP TRIGGER failed_terminal")
                .unwrap();
        }
    }
    // Drain pending metadata, rejecting any second/spurious completed transition.
    while let Ok(item) = tokio::time::timeout(Duration::from_millis(100), frame(&mut body)).await {
        assert_ne!(
            item["change"]["work"]["disposition"], "completed",
            "{case:?}: {item}"
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), planned_calls);
    assert!(!service.has_event_subscribers());
    drop(body);
    drop(service);
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    provider.abort();
    let _ = provider.await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_actual_owned_sse_completion_queue_config_and_silent_reconnect() {
    let _guard = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for case in [Case::Complete, Case::Queue] {
        run(case).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_actual_question_cancellation_and_terminal_store_failure_never_complete(
) {
    let _guard = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for case in [Case::Question, Case::Cancel, Case::SaveFailure] {
        run(case).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_committed_queue_with_foreign_wake_clears_old_completion() {
    let _guard = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    run(Case::QueueAfterComplete).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_f1_actual_three_model_sse_keeps_b_identity_until_exact_c_completion() {
    let _guard = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    run(Case::QueueThree).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn completed_goal_does_not_capture_later_human_run_or_queued_continuation() {
    let _guard = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for case in [Case::HistoricalGoal, Case::HistoricalGoalQueue] {
        run(case).await;
    }
}
