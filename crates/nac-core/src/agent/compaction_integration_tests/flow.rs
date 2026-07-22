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
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1_000_000),
        EventSink::none(),
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

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn compaction_is_durable_before_ordinary_request_and_preserves_canonical_transcript() {
    use std::sync::atomic::{AtomicBool, Ordering};

    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_integration_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    let first_request_had_no_checkpoint = Arc::new(AtomicBool::new(false));
    let ordinary_request_had_checkpoint = Arc::new(AtomicBool::new(false));
    let first_observed = first_request_had_no_checkpoint.clone();
    let ordinary_observed = ordinary_request_had_checkpoint.clone();
    let observer_path = store_path.clone();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("durable concise summary", 100, 20, 10, 110),
            ),
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("ordinary answer", 50, 0, 5, 55),
            ),
        ],
        move |index, _request| {
            let checkpoints =
                crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
                    &observer_path,
                    "session",
                )
                .unwrap();
            if index == 0 {
                first_observed.store(checkpoints.is_empty(), Ordering::SeqCst);
            } else if index == 1 {
                ordinary_observed.store(checkpoints.len() == 1, Ordering::SeqCst);
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
        Message::System {
            content: "canonical system".to_string(),
        },
        Message::User {
            content: "old user".to_string(),
        },
        Message::Assistant {
            content: Some("old assistant".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        },
        Message::User {
            content: "recent user".to_string(),
        },
    ];
    let canonical_before = serde_json::to_value(&agent.messages).unwrap();

    assert_eq!(agent.send("current user").await.unwrap(), "ordinary answer");
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert!(first_request_had_no_checkpoint.load(Ordering::SeqCst));
    assert!(ordinary_request_had_checkpoint.load(Ordering::SeqCst));

    let summary_request: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(summary_request.get("tools").is_none());
    let summary_input = summary_request["input"].as_array().unwrap();
    assert_eq!(
        summary_input.last().unwrap()["content"],
        compaction::CODEX_COMPACTION_PROMPT
    );
    assert_eq!(
        summary_input[0]["content"],
        compaction::SUMMARIZER_SYSTEM_INSTRUCTION
    );

    let ordinary_request: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(ordinary_request["tools"].as_array().unwrap().len() > 0);
    let ordinary_input = ordinary_request["input"].as_array().unwrap();
    assert_eq!(ordinary_input[0]["content"], "canonical system");
    assert!(ordinary_input[1]["content"]
        .as_str()
        .unwrap()
        .starts_with(compaction::HISTORICAL_CONTEXT_PREFIX));
    assert_eq!(ordinary_input[2]["content"], "recent user");
    assert_eq!(ordinary_input[3]["content"], "current user");

    assert_eq!(
        serde_json::to_value(&agent.messages[..4]).unwrap(),
        canonical_before
    );
    assert!(matches!(
        &agent.messages[4],
        Message::User { content } if content == "current user"
    ));
    assert!(matches!(
        &agent.messages[5],
        Message::Assistant { content: Some(content), .. } if content == "ordinary answer"
    ));
    assert!(!serde_json::to_string(&agent.messages)
        .unwrap()
        .contains("durable concise summary"));

    let checkpoints =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session",
        )
        .unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].tail_start_message_index, 3);
    assert_eq!(checkpoints[0].summary_prompt_tokens, Some(100));
    assert_eq!(checkpoints[0].summary_completion_tokens, Some(10));
    let usage = agent.last_usage.unwrap();
    assert_eq!(usage.input_tokens, 130);
    assert_eq!(usage.cache_read_tokens, 20);
    assert_eq!(usage.output_tokens, 15);
    assert_eq!(usage.orchestrator_context_tokens, 55);

    let usage_events = std::iter::from_fn(|| events_rx.try_recv().ok())
        .filter_map(|event| match event {
            AgentEvent::TokenUsageUpdated { usage, .. } => Some(usage),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(usage_events.len(), 2);
    assert_eq!(
        usage_events[0].orchestrator_context_tokens,
        checkpoints[0].new_context_estimate
    );
    assert_eq!(usage_events[1].orchestrator_context_tokens, 55);

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
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        Some(1),
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

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn steering_reenters_projection_hook_without_second_summary_attempt() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_steering_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let observer_path = store_path.clone();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("first checkpoint", 20, 0, 4, 24),
            ),
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("intermediate answer", 20, 0, 4, 24),
            ),
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("final answer", 20, 0, 4, 24),
            ),
        ],
        move |index, _request| {
            if index == 1 {
                crate::store::queue_thread_steering(
                    &observer_path,
                    "session",
                    crate::store::ORCHESTRATOR_STEERING_TARGET,
                    "run",
                    "steer now",
                )
                .unwrap();
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
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "raw oldest".to_string(),
        },
        Message::Assistant {
            content: Some("raw old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        },
        Message::User {
            content: "newly aged turn".to_string(),
        },
    ];

    assert_eq!(agent.send("current turn").await.unwrap(), "final answer");
    let requests = server.finish();
    assert_eq!(requests.len(), 3);
    let final_ordinary: serde_json::Value = serde_json::from_slice(&requests[2].body).unwrap();
    let final_input = final_ordinary["input"].to_string();
    assert!(final_input.contains("first checkpoint"));
    assert!(final_input.contains("current turn"));
    assert!(final_input.contains("intermediate answer"));
    assert!(final_input.contains("steer now"));

    let checkpoints =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session",
        )
        .unwrap();
    assert_eq!(checkpoints.len(), 1);
    assert_eq!(checkpoints[0].previous_checkpoint_id, None);
    assert_eq!(checkpoints[0].tail_start_message_index, 3);

    let canonical = serde_json::to_string(&agent.messages).unwrap();
    assert!(canonical.contains("raw oldest"));
    assert!(canonical.contains("raw old answer"));
    assert!(!canonical.contains("first checkpoint"));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn valid_checkpoint_projects_after_restore_when_generation_is_disabled() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_compaction_resume_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let mut agent = compaction_test_agent(
        ModelClient::new_for_test(),
        store_path.clone(),
        Some("session"),
        None,
        EventSink::none(),
    );
    agent.restore_messages(vec![
        Message::System {
            content: "stored stale system".to_string(),
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
            content: "retained".to_string(),
        },
        Message::User {
            content: "current".to_string(),
        },
    ]);
    let (source, policy) = compaction::checkpoint_digests(&agent.messages, 3);
    crate::store::orchestrator_compaction::append_orchestrator_compaction_checkpoint(
        &store_path,
        &crate::store::orchestrator_compaction::NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: compaction::installed_summary("restored summary"),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: compaction::PROMPT_POLICY_VERSION,
            old_context_estimate: 2_000,
            summary_prompt_tokens: Some(1_000),
            summary_completion_tokens: Some(100),
            new_context_estimate: 1_500,
        },
    )
    .unwrap();

    agent.restore_compaction_checkpoint().unwrap();
    let view = agent
        .prepare_provider_view(&mut TokenUsage::default(), &mut false)
        .await;
    let encoded = serde_json::to_string(&view.messages).unwrap();
    assert!(encoded.contains("restored summary"));
    assert!(encoded.contains("retained"));
    assert!(encoded.contains("current"));
    assert!(!encoded.contains("old answer"));

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
