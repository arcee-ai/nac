use super::*;

#[tokio::test]
async fn checkpoint_store_failure_keeps_prior_view_and_continues_ordinary_call() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_store_failure_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    // Inject checkpoint-persistence failure precisely: a trigger aborts
    // checkpoint inserts while every other table keeps working. The old
    // missing-session-row injection no longer isolates checkpoint
    // persistence — with the transcript log dual-write, a missing session
    // row fails the run's own log append (foreign key) before compaction.
    crate::store::open_runtime_connection(&store_path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_checkpoint_inserts
             BEFORE INSERT ON orchestrator_compaction_checkpoints
             BEGIN
                 SELECT RAISE(ABORT, 'injected checkpoint store failure');
             END;",
        )
        .unwrap();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("cannot persist", 10, 0, 2, 12),
        ),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("ordinary fallback", 10, 0, 2, 12),
        ),
    ]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1),
        EventSink::channel(events_tx),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages = vec![
        Message::User {
            content: "old".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "recent".to_string(),
        },
    ];

    assert_eq!(agent.send("current").await.unwrap(), "ordinary fallback");
    let requests = server.finish();
    let ordinary: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    let input = ordinary["input"].to_string();
    assert!(input.contains("old answer"));
    assert!(!input.contains(compaction::HISTORICAL_CONTEXT_PREFIX));
    assert!(agent
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .is_none());
    assert!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session"
        )
        .unwrap()
        .is_empty()
    );
    let events = drain_events(&mut events_rx);
    let started = events
        .iter()
        .position(|event| {
            matches!(
                event,
                AgentEvent::OrchestratorCompactionStarted {
                    reason: crate::events::CompactionReason::Auto,
                    ..
                }
            )
        })
        .unwrap();
    let failed = events
        .iter()
        .position(|event| {
            matches!(
                event,
                AgentEvent::OrchestratorCompactionFailed {
                    reason: crate::events::CompactionReason::Auto,
                    failure: crate::events::CompactionFailure::CheckpointPersistenceFailed,
                    ..
                }
            )
        })
        .unwrap();
    assert!(started < failed);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, AgentEvent::OrchestratorCompactionStarted { .. }))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, AgentEvent::OrchestratorCompactionFailed { .. }))
            .count(),
        1
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

async fn wait_until_observed(observed: &std::sync::atomic::AtomicBool) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    while !observed.load(std::sync::atomic::Ordering::SeqCst) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "model request was not observed"
        );
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
}

fn blocking_observed_server(
    responses: Vec<crate::model::test_http::ScriptedResponse>,
) -> (
    crate::model::test_http::ScriptedServer,
    Arc<std::sync::atomic::AtomicBool>,
    Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    let observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let release = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed_cb = observed.clone();
    let release_cb = release.clone();
    let server = crate::model::test_http::ScriptedServer::start_observed(
        responses,
        move |_index, _request| {
            observed_cb.store(true, Ordering::SeqCst);
            while !release_cb.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        },
    );
    (server, observed, release)
}

async fn abort_and_assert_cancelled<T: std::fmt::Debug>(
    task: tokio::task::JoinHandle<T>,
    observed: &std::sync::atomic::AtomicBool,
) {
    wait_until_observed(observed).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn cancellation_during_summary_keeps_the_prior_checkpoint() {
    use std::sync::atomic::Ordering;

    use crate::model::test_http::ScriptedResponse;

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_cancel_summary_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let messages = vec![
        Message::User {
            content: "old".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "aged".to_string(),
        },
        Message::Assistant {
            content: Some("aged answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "recent".to_string(),
        },
    ];
    let (source, policy) = compaction::checkpoint_digests(&messages, 2);
    let prior = crate::store::orchestrator_compaction::append_orchestrator_compaction_checkpoint(
        &store_path,
        &crate::store::orchestrator_compaction::NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: compaction::installed_summary("prior"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: compaction::PROMPT_POLICY_VERSION,
            old_context_estimate: 1_000,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 500,
        },
    )
    .unwrap();

    let (server, observed, release) = blocking_observed_server(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("replacement", 10, 0, 2, 12),
    )]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1),
        EventSink::channel(events_tx),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages = messages;
    agent.restore_compaction_checkpoint().unwrap();
    let agent = Arc::new(tokio::sync::Mutex::new(agent));
    let task_agent = agent.clone();
    let task = tokio::spawn(async move { task_agent.lock().await.send("current").await });

    abort_and_assert_cancelled(task, &observed).await;
    let guard = agent.lock().await;
    assert_eq!(
        guard
            .compaction
            .as_ref()
            .unwrap()
            .active_checkpoint_for_test()
            .unwrap()
            .id,
        prior.id
    );
    assert!(
        matches!(guard.messages.last(), Some(Message::User { content }) if content == "current")
    );
    drop(guard);
    assert_eq!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session"
        )
        .unwrap()
        .len(),
        1
    );
    let events = drain_events(&mut events_rx);
    let AgentEvent::OrchestratorCompactionStarted {
        compaction_id,
        reason: crate::events::CompactionReason::Auto,
    } = events[1]
    else {
        panic!("expected automatic start event: {:?}", events[1]);
    };
    assert!(matches!(
        events[2],
        AgentEvent::OrchestratorCompactionFailed {
            compaction_id: id,
            reason: crate::events::CompactionReason::Auto,
            failure: crate::events::CompactionFailure::Cancelled,
        } if id == compaction_id
    ));

    release.store(true, Ordering::SeqCst);
    assert_eq!(server.finish().len(), 1);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn cancellation_after_checkpoint_commit_keeps_the_committed_projection() {
    use std::sync::atomic::{AtomicBool, Ordering};

    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_cancel_ordinary_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    let ordinary_observed = Arc::new(AtomicBool::new(false));
    let release = Arc::new(AtomicBool::new(false));
    let observed_server = ordinary_observed.clone();
    let release_server = release.clone();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json("200 OK", scripted_responses_text("committed", 10, 0, 2, 12)),
            ScriptedResponse::json("200 OK", scripted_responses_text("too late", 10, 0, 2, 12)),
        ],
        move |index, _request| {
            if index == 1 {
                observed_server.store(true, Ordering::SeqCst);
                while !release_server.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            }
        },
    );
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1),
        EventSink::channel(events_tx),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages = vec![
        Message::User {
            content: "old".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "recent".to_string(),
        },
    ];
    let agent = Arc::new(tokio::sync::Mutex::new(agent));
    let task_agent = agent.clone();
    let task = tokio::spawn(async move { task_agent.lock().await.send("current").await });

    wait_until_observed(&ordinary_observed).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let checkpoints =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session",
        )
        .unwrap();
    assert_eq!(checkpoints.len(), 1);
    let guard = agent.lock().await;
    assert_eq!(
        guard
            .compaction
            .as_ref()
            .unwrap()
            .active_checkpoint_for_test()
            .unwrap()
            .id,
        checkpoints[0].id
    );
    assert!(
        matches!(guard.messages.last(), Some(Message::User { content }) if content == "current")
    );
    assert!(!serde_json::to_string(&guard.messages)
        .unwrap()
        .contains("committed"));
    drop(guard);
    let events = drain_events(&mut events_rx);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionCompleted {
                    reason: crate::events::CompactionReason::Auto,
                    ..
                }
            ))
            .count(),
        1
    );
    assert!(!events.iter().any(|event| matches!(
        event,
        AgentEvent::OrchestratorCompactionFailed {
            failure: crate::events::CompactionFailure::Cancelled,
            ..
        }
    )));

    release.store(true, Ordering::SeqCst);
    assert_eq!(server.finish().len(), 2);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn manual_summary_request_and_rejection_failures_are_typed_and_terminal() {
    use crate::events::{CompactionFailure, CompactionReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let cases = [
        (
            "request",
            ScriptedResponse::json("200 OK", "{}"),
            CompactionFailure::SummaryRequestFailed,
            false,
        ),
        (
            "rejected",
            ScriptedResponse::json("200 OK", scripted_responses_text("  ", 17, 0, 2, 19)),
            CompactionFailure::SummaryRejected,
            true,
        ),
    ];

    for (label, response, expected_failure, has_usage) in cases {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store_path = std::env::temp_dir()
            .join(format!("nac_agent_manual_{label}_failure_{unique}"))
            .join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session");
        let server = ScriptedServer::start(vec![response]);
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut agent = compaction_test_agent(
            ModelClient::new_for_test_server(server.base_url.clone()),
            store_path.clone(),
            Some("session"),
            None,
            EventSink::channel(events_tx),
        );
        agent.messages = compactable_messages();
        agent.last_usage = Some(TokenUsage {
            input_tokens: 44,
            output_tokens: 5,
            orchestrator_context_tokens: 99,
            ..TokenUsage::default()
        });
        let canonical_before = serde_json::to_vec(&agent.messages).unwrap();
        let usage_before = agent.last_usage.clone();

        let error = agent.compact().await.unwrap_err();
        assert_eq!(error.failure(), Some(expected_failure));
        let compaction_id = error.compaction_id().unwrap();
        assert_eq!(server.finish().len(), 1);
        assert_eq!(
            serde_json::to_vec(&agent.messages).unwrap(),
            canonical_before
        );
        assert_eq!(agent.last_usage, usage_before);
        assert!(
            crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
                &store_path,
                "session"
            )
            .unwrap()
            .is_empty()
        );

        let events = drain_events(&mut events_rx);
        assert_eq!(events.len(), if has_usage { 3 } else { 2 });
        assert!(matches!(
            events[0],
            AgentEvent::OrchestratorCompactionStarted {
                compaction_id: id,
                reason: CompactionReason::Manual,
            } if id == compaction_id
        ));
        if has_usage {
            assert!(matches!(events[1], AgentEvent::TokenUsageUpdated { .. }));
        }
        assert!(matches!(
            events[events.len() - 1],
            AgentEvent::OrchestratorCompactionFailed {
                compaction_id: id,
                reason: CompactionReason::Manual,
                failure,
            } if id == compaction_id && failure == expected_failure
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}

#[tokio::test]
async fn manual_checkpoint_store_failure_is_hard_and_keeps_the_prior_view() {
    use crate::events::{CompactionFailure, CompactionReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_manual_store_failure_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("cannot persist", 12, 0, 3, 15),
    )]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("missing-session"),
        Some(1),
        EventSink::channel(events_tx),
    );
    agent.messages = compactable_messages();
    let canonical_before = serde_json::to_vec(&agent.messages).unwrap();

    let error = agent.compact().await.unwrap_err();
    assert_eq!(
        error.failure(),
        Some(CompactionFailure::CheckpointPersistenceFailed)
    );
    let compaction_id = error.compaction_id().unwrap();
    assert_eq!(server.finish().len(), 1);
    assert_eq!(
        serde_json::to_vec(&agent.messages).unwrap(),
        canonical_before
    );
    assert!(agent
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .is_none());

    let events = drain_events(&mut events_rx);
    assert_eq!(events.len(), 3);
    assert!(matches!(
        events[0],
        AgentEvent::OrchestratorCompactionStarted {
            compaction_id: id,
            reason: CompactionReason::Manual,
        } if id == compaction_id
    ));
    assert!(matches!(events[1], AgentEvent::TokenUsageUpdated { .. }));
    assert!(matches!(
        events[2],
        AgentEvent::OrchestratorCompactionFailed {
            compaction_id: id,
            reason: CompactionReason::Manual,
            failure: CompactionFailure::CheckpointPersistenceFailed,
        } if id == compaction_id
    ));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn manual_cancellation_emits_cancelled_and_preserves_state() {
    use std::sync::atomic::Ordering;

    use crate::events::{CompactionFailure, CompactionReason};
    use crate::model::test_http::ScriptedResponse;

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_manual_cancel_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    let (server, observed, release) = blocking_observed_server(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("too late", 10, 0, 2, 12),
    )]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        None,
        EventSink::channel(events_tx),
    );
    agent.messages = compactable_messages();
    agent.last_usage = Some(TokenUsage {
        input_tokens: 8,
        ..TokenUsage::default()
    });
    let canonical_before = serde_json::to_vec(&agent.messages).unwrap();
    let usage_before = agent.last_usage.clone();
    let agent = Arc::new(tokio::sync::Mutex::new(agent));
    let task_agent = agent.clone();
    let task = tokio::spawn(async move { task_agent.lock().await.compact().await });

    abort_and_assert_cancelled(task, &observed).await;
    let guard = agent.lock().await;
    assert_eq!(
        serde_json::to_vec(&guard.messages).unwrap(),
        canonical_before
    );
    assert_eq!(guard.last_usage, usage_before);
    assert!(guard
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .is_none());
    drop(guard);
    assert!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session"
        )
        .unwrap()
        .is_empty()
    );

    let events = drain_events(&mut events_rx);
    assert_eq!(events.len(), 2);
    let AgentEvent::OrchestratorCompactionStarted {
        compaction_id,
        reason: CompactionReason::Manual,
    } = events[0]
    else {
        panic!("expected manual start event: {:?}", events[0]);
    };
    assert!(matches!(
        events[1],
        AgentEvent::OrchestratorCompactionFailed {
            compaction_id: id,
            reason: CompactionReason::Manual,
            failure: CompactionFailure::Cancelled,
        } if id == compaction_id
    ));

    release.store(true, Ordering::SeqCst);
    assert_eq!(server.finish().len(), 1);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
