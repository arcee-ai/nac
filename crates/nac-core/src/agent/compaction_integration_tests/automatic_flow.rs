use super::*;

#[test]
fn compaction_state_is_only_created_for_session_backed_orchestrators() {
    let path = PathBuf::from("unused.db");
    let orchestrator_without_session = compaction_test_agent(
        ModelClient::new_for_test(),
        path.clone(),
        None,
        Some(1),
        EventSink::none(),
    );
    assert!(orchestrator_without_session.compaction.is_none());

    let worker = Agent::with_config(
        ModelClient::new_for_test(),
        AgentConfig {
            mode: AgentMode::Worker,
            store_path: path,
            session_id: Some("worker-session".to_string()),
            orchestrator_compaction_threshold: Some(1),
            initial_messages: Vec::new(),
            thread_name: Some("worker".to_string()),
            dispatch_id: Some("dispatch".to_string()),
            event_sink: EventSink::none(),
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
    assert!(worker.compaction.is_none());
}

#[tokio::test]
async fn worker_send_stays_direct_when_provider_context_total_is_invalid() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("worker answer", 100, 0, 5, 1),
    )]);
    let mut worker = Agent::with_config(
        ModelClient::new_for_test_server(server.base_url.clone()),
        AgentConfig {
            mode: AgentMode::Worker,
            store_path: PathBuf::from("unused.db"),
            session_id: None,
            orchestrator_compaction_threshold: Some(1),
            initial_messages: Vec::new(),
            thread_name: Some("worker".to_string()),
            dispatch_id: None,
            event_sink: EventSink::none(),
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

    assert_eq!(worker.send("hello").await.unwrap(), "worker answer");
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert!(
        serde_json::from_slice::<serde_json::Value>(&requests[0].body).unwrap()["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
    );
    assert_eq!(worker.last_usage.unwrap().orchestrator_context_tokens, 0);
}

#[tokio::test]
async fn threshold_not_reached_sends_one_ordinary_canonical_request() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_below_threshold_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("ordinary", 10, 0, 2, 12),
    )]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1_000_000),
        EventSink::channel(events_tx),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages.push(Message::User {
        content: "prior".to_string(),
    });

    assert_eq!(agent.send("current").await.unwrap(), "ordinary");
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(!body["input"]
        .to_string()
        .contains(compaction::HISTORICAL_CONTEXT_PREFIX));
    assert!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session"
        )
        .unwrap()
        .is_empty()
    );
    assert!(!drain_events(&mut events_rx).iter().any(|event| matches!(
        event,
        AgentEvent::OrchestratorCompactionStarted { .. }
            | AgentEvent::OrchestratorCompactionCompleted { .. }
            | AgentEvent::OrchestratorCompactionSkipped { .. }
            | AgentEvent::OrchestratorCompactionFailed { .. }
    )));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn rejected_summary_accounts_cost_and_falls_back_to_canonical_request() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_rejected_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", scripted_responses_text("   ", 30, 5, 3, 33)),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("fallback answer", 40, 0, 4, 44),
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
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "old".to_string(),
        },
        Message::Assistant {
            content: Some("answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        },
        Message::User {
            content: "recent".to_string(),
        },
    ];

    assert_eq!(agent.send("current").await.unwrap(), "fallback answer");
    let requests = server.finish();
    let ordinary: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    let ordinary_text = ordinary["input"].to_string();
    assert!(ordinary_text.contains("old"));
    assert!(ordinary_text.contains("answer"));
    assert!(!ordinary_text.contains(compaction::HISTORICAL_CONTEXT_PREFIX));
    assert!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session"
        )
        .unwrap()
        .is_empty()
    );
    let usage = agent.last_usage.unwrap();
    assert_eq!(usage.input_tokens, 65);
    assert_eq!(usage.cache_read_tokens, 5);
    assert_eq!(usage.output_tokens, 7);
    assert_eq!(usage.orchestrator_context_tokens, 44);

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
    let summary_usage = events
        .iter()
        .position(|event| matches!(event, AgentEvent::TokenUsageUpdated { usage, .. } if usage.output_tokens == 3))
        .unwrap();
    let failed = events
        .iter()
        .position(|event| {
            matches!(
                event,
                AgentEvent::OrchestratorCompactionFailed {
                    reason: crate::events::CompactionReason::Auto,
                    failure: crate::events::CompactionFailure::SummaryRejected,
                    ..
                }
            )
        })
        .unwrap();
    let ordinary = events
        .iter()
        .position(|event| matches!(event, AgentEvent::TokenUsageUpdated { usage, .. } if usage.output_tokens == 4))
        .unwrap();
    assert!(started < summary_usage && summary_usage < failed && failed < ordinary);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn complete_tool_result_batch_reenters_threshold_hook_before_next_ordinary_call() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_post_tool_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let long_unknown_tool = format!("unknown_{}", "x".repeat(600));
    let tool_response = serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "function_call",
            "call_id": "call-1",
            "name": long_unknown_tool,
            "arguments": "{}"
        }],
        "usage": {"input_tokens": 100, "output_tokens": 0, "total_tokens": 1}
    })
    .to_string();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", tool_response),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("post-tool checkpoint", 20, 0, 4, 24),
        ),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("done after tool", 20, 0, 4, 24),
        ),
    ]);
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(400),
        EventSink::none(),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages = vec![
        Message::System {
            content: "system".to_string(),
        },
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
    let sampled_len = agent.messages.len();
    agent.compaction.as_mut().unwrap().record_ordinary_context(
        &agent.messages.clone(),
        1,
        sampled_len,
        None,
    );

    assert_eq!(agent.send("current").await.unwrap(), "done after tool");
    let requests = server.finish();
    assert_eq!(requests.len(), 3);
    let first: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(first.get("tools").is_some(), "first call must be ordinary");
    let second: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(second.get("tools").is_none(), "second call must be summary");
    assert_eq!(
        second["input"].as_array().unwrap().last().unwrap()["content"],
        compaction::CODEX_COMPACTION_PROMPT
    );
    let third: serde_json::Value = serde_json::from_slice(&requests[2].body).unwrap();
    assert!(third.get("tools").is_some(), "third call must be ordinary");
    let final_input = third["input"].to_string();
    assert!(final_input.contains("call-1"));
    assert!(final_input.contains("unknown tool"));
    assert_eq!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session"
        )
        .unwrap()
        .len(),
        1
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn one_user_automatic_compaction_uses_end_boundary() {
    use crate::events::{CompactionReason, CompactionSkipReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_auto_end_boundary_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("single prompt summary", 10, 0, 2, 12),
        ),
        ScriptedResponse::json("200 OK", scripted_responses_text("ordinary", 10, 0, 2, 12)),
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

    assert_eq!(agent.send("only user").await.unwrap(), "ordinary");
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let summary: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    let ordinary: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(summary.get("tools").is_none());
    assert!(summary["input"].to_string().contains("only user"));
    assert!(ordinary["tools"]
        .as_array()
        .is_some_and(|tools| !tools.is_empty()));
    assert!(ordinary["input"]
        .as_array()
        .unwrap()
        .iter()
        .any(|message| message["content"]
            .as_str()
            .is_some_and(|content| content.starts_with(compaction::HISTORICAL_CONTEXT_PREFIX))));

    let checkpoints =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session",
        )
        .unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].tail_start_message_index, 2);

    let events = drain_events(&mut events_rx);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionStarted {
                    reason: CompactionReason::Auto,
                    ..
                }
            ))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionCompleted {
                    reason: CompactionReason::Auto,
                    ..
                }
            ))
            .count(),
        1
    );
    assert!(!events.iter().any(|event| matches!(
        event,
        AgentEvent::OrchestratorCompactionSkipped {
            cause: CompactionSkipReason::NoEligibleBoundary,
            ..
        }
    )));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn disabled_automatic_compaction_emits_nothing_and_never_calls_summary_model() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_auto_disabled_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_responses_text("ordinary", 10, 0, 2, 12),
    )]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        None,
        EventSink::channel(events_tx),
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent.messages = compactable_messages();

    assert_eq!(agent.send("next").await.unwrap(), "ordinary");
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let request: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(request.get("tools").is_some());
    assert!(!drain_events(&mut events_rx).iter().any(|event| matches!(
        event,
        AgentEvent::OrchestratorCompactionStarted { .. }
            | AgentEvent::OrchestratorCompactionCompleted { .. }
            | AgentEvent::OrchestratorCompactionSkipped { .. }
            | AgentEvent::OrchestratorCompactionFailed { .. }
    )));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn automatic_summary_request_failure_emits_failed_and_falls_back_to_ordinary_generation() {
    use crate::events::{CompactionFailure, CompactionReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_auto_request_failure_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", "{}"),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("ordinary fallback", 11, 0, 3, 14),
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
    agent.messages = compactable_messages();

    assert_eq!(agent.send("next user").await.unwrap(), "ordinary fallback");
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let summary: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    let ordinary: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(summary.get("tools").is_none());
    assert!(ordinary.get("tools").is_some());
    assert!(ordinary["input"].to_string().contains("old answer"));
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
                    reason: CompactionReason::Auto,
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
                    reason: CompactionReason::Auto,
                    failure: CompactionFailure::SummaryRequestFailed,
                    ..
                }
            )
        })
        .unwrap();
    let ordinary_usage = events
        .iter()
        .position(|event| matches!(event, AgentEvent::TokenUsageUpdated { .. }))
        .unwrap();
    assert!(started < failed && failed < ordinary_usage);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn failed_summary_attempt_retries_at_the_next_tool_hook_without_dedup() {
    use crate::events::{CompactionFailure, CompactionReason};
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_retry_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let tool_response = serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "function_call",
            "call_id": "retry-call",
            "name": "unknown_retry_tool",
            "arguments": "{}"
        }],
        "usage": {"input_tokens": 10, "output_tokens": 1, "total_tokens": 11}
    })
    .to_string();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", "{}"),
        ScriptedResponse::json("200 OK", tool_response),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("retry summary", 10, 0, 2, 12),
        ),
        ScriptedResponse::json("200 OK", scripted_responses_text("done", 10, 0, 2, 12)),
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
    agent.messages = compactable_messages();

    assert_eq!(agent.send("retry after tool").await.unwrap(), "done");
    let requests = server.finish();
    assert_eq!(requests.len(), 4);
    for (index, has_tools) in [(0, false), (1, true), (2, false), (3, true)] {
        let body: serde_json::Value = serde_json::from_slice(&requests[index].body).unwrap();
        assert_eq!(body.get("tools").is_some(), has_tools, "request {index}");
    }
    let first_summary: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    let retry_summary: serde_json::Value = serde_json::from_slice(&requests[2].body).unwrap();
    assert_eq!(first_summary["input"], retry_summary["input"]);
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
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionStarted {
                    reason: CompactionReason::Auto,
                    ..
                }
            ))
            .count(),
        2
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionFailed {
                    reason: CompactionReason::Auto,
                    failure: CompactionFailure::SummaryRequestFailed,
                    ..
                }
            ))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionCompleted {
                    reason: CompactionReason::Auto,
                    ..
                }
            ))
            .count(),
        1
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
