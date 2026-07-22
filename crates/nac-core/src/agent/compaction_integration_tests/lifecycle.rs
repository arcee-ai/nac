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
    // Intentionally do not create the session row: checkpoint append must
    // fail atomically after a valid summary without activating it.
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
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("missing-session"),
        Some(1),
        EventSink::none(),
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
            "missing-session"
        )
        .unwrap()
        .is_empty()
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

#[tokio::test]
async fn cancellation_during_summary_keeps_the_prior_checkpoint() {
    use std::sync::atomic::{AtomicBool, Ordering};

    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

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
        },
        Message::User {
            content: "aged".to_string(),
        },
        Message::Assistant {
            content: Some("aged answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
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

    let observed = Arc::new(AtomicBool::new(false));
    let release = Arc::new(AtomicBool::new(false));
    let observed_server = observed.clone();
    let release_server = release.clone();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("replacement", 10, 0, 2, 12),
        )],
        move |_index, _request| {
            observed_server.store(true, Ordering::SeqCst);
            while !release_server.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        },
    );
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1),
        EventSink::none(),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages = messages;
    agent.restore_compaction_checkpoint().unwrap();
    let agent = Arc::new(tokio::sync::Mutex::new(agent));
    let task_agent = agent.clone();
    let task = tokio::spawn(async move { task_agent.lock().await.send("current").await });

    wait_until_observed(&observed).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
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
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1),
        EventSink::none(),
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

    release.store(true, Ordering::SeqCst);
    assert_eq!(server.finish().len(), 2);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
