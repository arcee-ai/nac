use super::*;

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
    assert!(!ordinary_request["tools"].as_array().unwrap().is_empty());
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

    let events = drain_events(&mut events_rx);
    let usage_events = events
        .iter()
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
    let started_index = events
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
    let AgentEvent::OrchestratorCompactionStarted { compaction_id, .. } = events[started_index]
    else {
        unreachable!();
    };
    let summary_usage_index = events
        .iter()
        .position(|event| matches!(event, AgentEvent::TokenUsageUpdated { usage, .. } if usage.orchestrator_context_tokens == checkpoints[0].new_context_estimate))
        .unwrap();
    let completed_index = events
        .iter()
        .position(|event| {
            matches!(
                event,
                AgentEvent::OrchestratorCompactionCompleted {
                    compaction_id: id,
                    reason: crate::events::CompactionReason::Auto,
                } if *id == compaction_id
            )
        })
        .unwrap();
    let ordinary_start_index = events
        .iter()
        .position(|event| matches!(event, AgentEvent::TokenUsageUpdated { usage, .. } if usage.orchestrator_context_tokens == 55))
        .unwrap();
    assert!(started_index < summary_usage_index);
    assert!(summary_usage_index < completed_index);
    assert!(completed_index < ordinary_start_index);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn long_single_prompt_can_compact_once_per_hook_and_again_after_steering() {
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
                scripted_responses_text("second checkpoint", 20, 0, 4, 24),
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
    let prompt = "current long turn ".repeat(200);

    assert_eq!(agent.send(&prompt).await.unwrap(), "final answer");
    let requests = server.finish();
    assert_eq!(requests.len(), 4);
    for (index, has_tools) in [(0, false), (1, true), (2, false), (3, true)] {
        let body: serde_json::Value = serde_json::from_slice(&requests[index].body).unwrap();
        assert_eq!(body.get("tools").is_some(), has_tools, "request {index}");
    }
    let second_summary: serde_json::Value = serde_json::from_slice(&requests[2].body).unwrap();
    let second_summary_input = second_summary["input"].to_string();
    assert!(second_summary_input.contains("first checkpoint"));
    assert!(second_summary_input.contains("newly aged turn"));
    assert!(!second_summary_input.contains("intermediate answer"));
    assert!(!second_summary_input.contains("raw old answer"));
    let final_ordinary: serde_json::Value = serde_json::from_slice(&requests[3].body).unwrap();
    let final_input = final_ordinary["input"].to_string();
    assert!(final_input.contains("second checkpoint"));
    assert!(final_input.contains("intermediate answer"));
    assert!(final_input.contains("steer now"));
    assert!(!final_input.contains("first checkpoint"));

    let checkpoints =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "session",
        )
        .unwrap();
    assert_eq!(checkpoints.len(), 2);
    assert_eq!(
        checkpoints[0].previous_checkpoint_id,
        Some(checkpoints[1].id)
    );
    assert_eq!(checkpoints[0].tail_start_message_index, 4);
    assert_eq!(checkpoints[1].tail_start_message_index, 3);

    let canonical = serde_json::to_string(&agent.messages).unwrap();
    assert!(canonical.contains("raw oldest"));
    assert!(canonical.contains("raw old answer"));
    assert!(!canonical.contains("first checkpoint"));
    assert!(!canonical.contains("second checkpoint"));
    let events = drain_events(&mut events_rx);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                AgentEvent::OrchestratorCompactionStarted {
                    reason: crate::events::CompactionReason::Auto,
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
                AgentEvent::OrchestratorCompactionCompleted {
                    reason: crate::events::CompactionReason::Auto,
                    ..
                }
            ))
            .count(),
        2
    );

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
        .prepare_provider_view(&mut TokenUsage::default())
        .await;
    let encoded = serde_json::to_string(&view.messages).unwrap();
    assert!(encoded.contains("restored summary"));
    assert!(encoded.contains("retained"));
    assert!(encoded.contains("current"));
    assert!(!encoded.contains("old answer"));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
