use super::*;
use crate::events::CompactionFailure;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::store::{
    TerminalSelectionDelivery, TerminalSelectionIntent, TerminalSelectionSourceKind,
};
use uuid::Uuid;
fn intent() -> TerminalSelectionIntent {
    TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: Uuid::new_v4().to_string(),
        capture_id: Uuid::new_v4().to_string(),
        source_session_id: "session".into(),
        terminal_id: "historical-source".into(),
        owner_instance_id: Uuid::new_v4().to_string(),
        client_capture_time_ms: None,
        text: "literal untrusted selection".into(),
        user_text: None,
        initial_delivery: TerminalSelectionDelivery::Queue,
        initial_expected_run_id: None,
    }
}
fn record(agent: &mut Agent, tokens: u64) {
    agent.compaction.as_mut().unwrap().record_ordinary_context(
        &agent.messages,
        tokens,
        agent.messages.len(),
        None,
    );
}
#[tokio::test]
async fn selection_provenance_tight_actual_provider_budget_with_ten_thousand_refs() {
    let path = std::env::temp_dir()
        .join(format!("nac-provenance-budget-{}", Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    // Large canonical history is seeded through the real identified-row
    // verification/stamper in one fixture transaction, not rendered fake UI.
    let intents = (0..22_000).map(|_| intent()).collect::<Vec<_>>();
    let messages =
        crate::store::seed_selection_provenance_history_for_test(&path, &intents).unwrap();
    let mut agent = compaction_test_agent_with_mode(
        ModelClient::new_for_test(),
        path.clone(),
        Some("session"),
        Some(1),
        EventSink::none(),
        AgentMode::Direct,
    );
    agent.messages = messages.clone();
    store_agent_snapshot(&path, &agent);
    agent
        .compaction
        .as_mut()
        .unwrap()
        .refresh_provenance_async(&agent.messages)
        .await
        .unwrap();
    let full_context = agent
        .compaction
        .as_mut()
        .unwrap()
        .prepare(&agent.messages, &agent.tool_defs)
        .context_estimate;
    record(&mut agent, full_context);
    let full_budget = agent
        .compaction
        .as_mut()
        .unwrap()
        .selection_budget_for_test(&agent.messages, &agent.tool_defs)
        .unwrap()
        .unwrap();
    // A single planner measurement includes fixed tool/context costs. Choose
    // the final reported sample so only ~128 summary bytes remain after reserve.
    let tight_context = full_context - (full_budget.saturating_sub(128) / 4) as u64;
    record(&mut agent, tight_context);
    let budget = agent
        .compaction
        .as_mut()
        .unwrap()
        .selection_budget_for_test(&agent.messages, &agent.tool_defs)
        .unwrap()
        .unwrap();
    assert!((128..132).contains(&budget));
    let mut rejected = compaction_test_agent_with_mode(
        ModelClient::new_for_test(),
        path.clone(),
        Some("session"),
        Some(1),
        EventSink::none(),
        AgentMode::Direct,
    );
    rejected.messages = messages.clone();
    rejected
        .compaction
        .as_mut()
        .unwrap()
        .refresh_provenance_async(&messages)
        .await
        .unwrap();
    record(&mut rejected, tight_context);
    let mut insufficient = compaction_test_agent_with_mode(
        ModelClient::new_for_test(),
        path.clone(),
        Some("session"),
        Some(1),
        EventSink::none(),
        AgentMode::Direct,
    );
    insufficient.messages = messages.clone();
    insufficient
        .compaction
        .as_mut()
        .unwrap()
        .refresh_provenance_async(&messages)
        .await
        .unwrap();
    record(&mut insufficient, 1);
    let server = ScriptedServer::start_observed_with_timeout(
        vec![
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text(&"s".repeat(budget), 80_000, 0, 32, 80_032),
            ),
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text(&"s".repeat(budget + 1), 80_000, 0, 32, 80_032),
            ),
        ],
        Duration::from_secs(60),
        |_, _| {},
    );
    agent.client = ModelClient::new_for_test_server(server.base_url.clone());
    rejected.client = ModelClient::new_for_test_server(server.base_url.clone());
    insufficient.client = ModelClient::new_for_test_server(server.base_url.clone());
    assert!(matches!(
        agent.compact().await.unwrap(),
        compaction::CompactionResult::Compacted { .. }
    ));
    let checkpoint =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &path, "session",
        )
        .unwrap()
        .remove(0);
    let json = checkpoint
        .summary
        .strip_prefix(compaction::HISTORICAL_CONTEXT_PREFIX)
        .unwrap()
        .split_once('\n')
        .unwrap()
        .1
        .split_once("\n\n")
        .unwrap()
        .0;
    let manifest: serde_json::Value = serde_json::from_str(json).unwrap();
    assert!(manifest["total"].as_u64().unwrap() >= 10_000);
    assert_eq!(manifest["total"], manifest["omitted"]);
    assert!(manifest["recent"].as_array().unwrap().is_empty());
    assert!(checkpoint.summary.ends_with(&"s".repeat(budget)));
    assert_eq!(
        rejected.compact().await.unwrap_err().failure(),
        Some(CompactionFailure::SummaryRejected)
    );
    assert_eq!(
        insufficient.compact().await.unwrap_err().failure(),
        Some(CompactionFailure::SummaryRejected)
    );
    assert!(rejected
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .is_none());
    assert!(insufficient
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .is_none());
    assert_eq!(
        serde_json::to_value(rejected.provider_messages_for_test()).unwrap(),
        serde_json::to_value(&messages).unwrap()
    );
    assert_eq!(
        serde_json::to_value(insufficient.provider_messages_for_test()).unwrap(),
        serde_json::to_value(&messages).unwrap()
    );
    assert_eq!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &path, "session"
        )
        .unwrap()
        .len(),
        1
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 2); // insufficient minimum has no network attempt
    for request in requests {
        let wire: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
        assert!(wire["input"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["content"]
                .as_str()
                .unwrap_or("")
                .contains(&format!("at most {budget} UTF-8 bytes"))));
    }
}
