use super::*;

#[tokio::test]
async fn manual_compaction_forces_disabled_and_high_threshold_without_mutating_run_state() {
    use crate::events::{CompactionReason, CompactionSkipReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    for (label, threshold) in [("disabled", None), ("high", Some(u64::MAX))] {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store_path = std::env::temp_dir()
            .join(format!("nac_agent_manual_compaction_{label}_{unique}"))
            .join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session");
        let persisted_before: (String, Option<i64>, Option<i64>, Option<String>, Option<String>) =
            crate::store::open_runtime_connection(&store_path)
                .unwrap()
                .query_row(
                    "SELECT messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, token_usages_json FROM sessions WHERE session_id = 'session'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )
                .unwrap();
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("manual summary", 30, 4, 5, 39),
        )]);
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut agent = compaction_test_agent(
            ModelClient::new_for_test_server(server.base_url.clone()),
            store_path.clone(),
            Some("session"),
            threshold,
            EventSink::channel(events_tx),
        );
        agent.messages = compactable_messages();
        agent.last_usage = Some(TokenUsage {
            input_tokens: 91,
            output_tokens: 7,
            orchestrator_context_tokens: 123,
            ..TokenUsage::default()
        });
        let canonical_before = serde_json::to_vec(&agent.messages).unwrap();
        let usage_before = agent.last_usage.clone();

        let result = agent.compact().await.unwrap();
        let CompactionResult::Compacted { compaction_id } = result else {
            panic!("manual attempt should compact: {result:?}");
        };
        assert_eq!(
            serde_json::to_vec(&agent.messages).unwrap(),
            canonical_before
        );
        assert_eq!(agent.last_usage, usage_before);

        let requests = server.finish();
        assert_eq!(requests.len(), 1);
        let request: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert!(request.get("tools").is_none());
        assert_eq!(
            request["input"].as_array().unwrap().last().unwrap()["content"],
            compaction::CODEX_COMPACTION_PROMPT
        );

        let checkpoints =
            crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
                &store_path,
                "session",
            )
            .unwrap();
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].summary_prompt_tokens, Some(30));
        assert_eq!(checkpoints[0].summary_completion_tokens, Some(5));
        let persisted_after: (String, Option<i64>, Option<i64>, Option<String>, Option<String>) =
            crate::store::open_runtime_connection(&store_path)
                .unwrap()
                .query_row(
                    "SELECT messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, token_usages_json FROM sessions WHERE session_id = 'session'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )
                .unwrap();
        assert_eq!(persisted_after, persisted_before);

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
            AgentEvent::OrchestratorCompactionCompleted {
                compaction_id: id,
                reason: CompactionReason::Manual,
            } if id == compaction_id
        ));
        assert!(!events.iter().any(|event| matches!(
            event,
            AgentEvent::OrchestratorCompactionSkipped {
                cause: CompactionSkipReason::NoEligibleBoundary,
                ..
            }
        )));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}

#[tokio::test]
async fn manual_compaction_skips_empty_and_unsafe_history_without_model_requests() {
    use crate::events::{CompactionReason, CompactionSkipReason};
    use crate::model::test_http::ScriptedServer;

    let unsafe_tool_call = crate::types::ToolCall {
        id: "call-open".to_string(),
        call_type: "function".to_string(),
        function: crate::types::FunctionCall {
            name: "read".to_string(),
            arguments: "{}".to_string(),
        },
    };
    let cases = [
        (
            "system-only",
            vec![Message::System {
                content: "policy only".to_string(),
            }],
        ),
        (
            "unsafe-history",
            vec![
                Message::User {
                    content: "old".to_string(),
                },
                Message::Assistant {
                    content: None,
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: Some(vec![unsafe_tool_call]),
                },
                Message::User {
                    content: "recent".to_string(),
                },
                Message::User {
                    content: "current".to_string(),
                },
            ],
        ),
    ];

    for (label, messages) in cases {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store_path = std::env::temp_dir()
            .join(format!("nac_agent_manual_skip_{label}_{unique}"))
            .join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session");
        let server = ScriptedServer::start(Vec::new());
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut agent = compaction_test_agent(
            ModelClient::new_for_test_server(server.base_url.clone()),
            store_path.clone(),
            Some("session"),
            None,
            EventSink::channel(events_tx),
        );
        agent.messages = messages;
        let canonical_before = serde_json::to_vec(&agent.messages).unwrap();

        let result = agent.compact().await.unwrap();
        let CompactionResult::Unchanged {
            compaction_id,
            reason,
        } = result
        else {
            panic!("manual attempt should skip: {result:?}");
        };
        assert_eq!(reason, CompactionSkipReason::NoEligibleBoundary);
        assert_eq!(
            serde_json::to_vec(&agent.messages).unwrap(),
            canonical_before
        );
        assert!(server.finish().is_empty());
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
        assert!(matches!(
            events[0],
            AgentEvent::OrchestratorCompactionStarted {
                compaction_id: id,
                reason: CompactionReason::Manual,
            } if id == compaction_id
        ));
        assert!(matches!(
            events[1],
            AgentEvent::OrchestratorCompactionSkipped {
                compaction_id: id,
                reason: CompactionReason::Manual,
                cause: CompactionSkipReason::NoEligibleBoundary,
            } if id == compaction_id
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}

#[tokio::test]
async fn repeated_manual_compaction_is_already_compacted_and_issues_no_second_request() {
    use crate::events::{CompactionReason, CompactionSkipReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_manual_already_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("first summary", 10, 0, 2, 12),
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

    assert!(matches!(
        agent.compact().await.unwrap(),
        CompactionResult::Compacted { .. }
    ));
    let second = agent.compact().await.unwrap();
    let CompactionResult::Unchanged {
        compaction_id,
        reason: CompactionSkipReason::AlreadyCompacted,
    } = second
    else {
        panic!("second attempt should be unchanged: {second:?}");
    };
    assert_eq!(server.finish().len(), 1);
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
    assert!(matches!(
        events[events.len() - 2],
        AgentEvent::OrchestratorCompactionStarted {
            compaction_id: id,
            reason: CompactionReason::Manual,
        } if id == compaction_id
    ));
    assert!(matches!(
        events[events.len() - 1],
        AgentEvent::OrchestratorCompactionSkipped {
            compaction_id: id,
            reason: CompactionReason::Manual,
            cause: CompactionSkipReason::AlreadyCompacted,
        } if id == compaction_id
    ));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn sessionless_and_worker_manual_compaction_is_unavailable_without_events() {
    let path = PathBuf::from("unused.db");
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut sessionless = compaction_test_agent(
        ModelClient::new_for_test(),
        path.clone(),
        None,
        Some(1),
        EventSink::channel(events_tx),
    );
    assert!(matches!(
        sessionless.compact().await,
        Err(CompactionError::Unavailable)
    ));
    assert!(drain_events(&mut events_rx).is_empty());

    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut worker = Agent::with_config(
        ModelClient::new_for_test(),
        AgentConfig {
            mode: AgentMode::Worker,
            store_path: path,
            session_id: Some("worker-session".to_string()),
            orchestrator_compaction_threshold: Some(1),
            initial_messages: Vec::new(),
            thread_name: Some("worker".to_string()),
            dispatch_id: None,
            event_sink: EventSink::channel(events_tx),
            workspace_cwd: PathBuf::from("."),
            config_cwd: PathBuf::from("."),
            working_directory: ".".to_string(),
            worker_executable: None,
            sandbox: None,
            ssh_host: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
        },
    )
    .unwrap();
    assert!(matches!(
        worker.compact().await,
        Err(CompactionError::Unavailable)
    ));
    assert!(drain_events(&mut events_rx).is_empty());
}
