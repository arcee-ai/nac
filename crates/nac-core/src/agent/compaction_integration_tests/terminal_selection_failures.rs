//! Verification errors block model I/O without converting old state to a full view.
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn selection_provenance_transient_failures_preserve_checkpoint_and_block_provider() {
    let (path, original) = super::terminal_selection::durable_selection_history();
    let observed = std::sync::Arc::new(AtomicUsize::new(0));
    let requests = observed.clone();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("valid retained summary", 80_000, 0, 12, 80_012),
            ),
            ScriptedResponse::json(
                "200 OK",
                scripted_responses_text("verified recovery", 125, 0, 3, 128),
            ),
        ],
        move |_, _| {
            requests.fetch_add(1, Ordering::SeqCst);
        },
    );
    let mut agent = compaction_test_agent_with_mode(
        ModelClient::new_for_test_server(server.base_url.clone()),
        path.clone(),
        Some("session"),
        None,
        EventSink::none(),
        AgentMode::Direct,
    );
    agent.messages = original.into_iter().map(|(_, message)| message).collect();
    store_agent_snapshot(&path, &agent);
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    assert!(matches!(
        agent.compact().await.unwrap(),
        CompactionResult::Compacted { .. }
    ));
    let checkpoint = agent
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .unwrap()
        .clone();
    agent.compaction.as_mut().unwrap().record_ordinary_context(
        &agent.messages,
        125,
        agent.messages.len(),
        Some(checkpoint.id),
    );
    let retained = format!("{:?}", agent.compaction);
    assert_eq!(observed.load(Ordering::SeqCst), 1);

    // The fault command and read execute on the actual serving executor.
    owner
        .fail_selection_provenance_after_reads_for_test(0)
        .await
        .unwrap();
    agent.set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
    let error = agent
        .send("metadata unavailable on this turn")
        .await
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("provenance persistence unavailability"),
        "{error:#}"
    );
    assert_eq!(observed.load(Ordering::SeqCst), 1); // No summary or ordinary model request.
    assert_eq!(format!("{:?}", agent.compaction), retained);

    // A real transient SQLite query failure has the same non-destructive result.
    // Only the private fixture schema is hidden; no production bypass is added.
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch("ALTER TABLE thread_events RENAME TO temporarily_unavailable_events")
        .unwrap();
    let tools = agent.tool_defs.clone();
    assert!(agent
        .prepare_provider_view(&mut TokenUsage::default(), &tools)
        .await
        .is_err());
    assert_eq!(observed.load(Ordering::SeqCst), 1);
    assert_eq!(format!("{:?}", agent.compaction), retained);
    connection
        .execute_batch("ALTER TABLE temporarily_unavailable_events RENAME TO thread_events")
        .unwrap();

    // A later explicit turn re-verifies and uses the same checkpoint, with its
    // provider-reported sample retained rather than reverting to the huge prefix.
    let prepared = agent
        .prepare_provider_view(&mut TokenUsage::default(), &tools)
        .await
        .unwrap();
    assert_eq!(prepared.checkpoint_id, Some(checkpoint.id));
    assert!(prepared.context_estimate < 1_000);
    agent.set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
    agent.send("explicit verified recovery turn").await.unwrap();
    assert_eq!(observed.load(Ordering::SeqCst), 2);
    assert_eq!(
        agent
            .compaction
            .as_ref()
            .unwrap()
            .active_checkpoint_for_test()
            .unwrap()
            .id,
        checkpoint.id
    );

    // Grow a real canonical tail so invalidating the old checkpoint requires
    // another derived-prefix read, rather than reusing a preloaded boundary.
    let tail = (0..32)
        .map(|index| Message::User {
            content: format!("ordinary tail {index}: {}", "later literal ".repeat(1_000)),
        })
        .collect::<Vec<_>>();
    let writer = crate::store::TranscriptLogWriter::new(&path).unwrap();
    let stored = tail.clone();
    let start = agent.messages.len() as u64;
    crate::store::spawn_blocking_store_caller(move || {
        writer.append_batch("session", start, &stored)
    })
    .await
    .unwrap()
    .unwrap();
    agent.messages.extend(tail);
    agent
        .prepare_provider_view(&mut TokenUsage::default(), &tools)
        .await
        .unwrap();
    let retained = format!("{:?}", agent.compaction);

    // Successful verification of actual source removal still invalidates old
    // attribution, even though the canonical User bytes have not changed.
    connection.execute("UPDATE thread_events SET event_json=json_remove(event_json,'$.nac_transcript_message.terminal_selection_attribution') WHERE session_id='session'", []).unwrap();
    // A failure after the first successful read must not partially publish its
    // candidate invalidation or metadata. No unverified model request is sent.
    owner
        .fail_selection_provenance_after_reads_for_test(1)
        .await
        .unwrap();
    assert!(agent
        .prepare_provider_view(&mut TokenUsage::default(), &tools)
        .await
        .is_err());
    assert_eq!(format!("{:?}", agent.compaction), retained);
    assert_eq!(observed.load(Ordering::SeqCst), 2);
    let canonical = serde_json::to_vec(&agent.messages).unwrap();
    let changed = agent
        .prepare_provider_view(&mut TokenUsage::default(), &tools)
        .await
        .unwrap();
    assert!(changed.checkpoint_id.is_none());
    assert!(agent
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .is_none());
    assert_eq!(serde_json::to_vec(&agent.messages).unwrap(), canonical);
    assert_eq!(observed.load(Ordering::SeqCst), 2);
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let resumed: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(resumed["input"].as_array().unwrap().iter().any(|message| {
        message["role"] == "user"
            && message["content"]
                .as_str()
                .unwrap_or("")
                .starts_with(compaction::HISTORICAL_CONTEXT_PREFIX)
    }));
    assert!(!String::from_utf8_lossy(&requests[1].body).contains("selected-0:"));
}
