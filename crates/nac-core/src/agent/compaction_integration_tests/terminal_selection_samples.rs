//! Real response append and restore bind usage to genuine canonical attribution.
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

#[tokio::test]
async fn selection_provenance_ordinary_response_samples_survive_restore_and_fork_owns_usage() {
    let (path, original) = super::terminal_selection::durable_selection_history();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("bounded historical summary", 80_000, 0, 12, 80_012),
        ),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("first ordinary answer", 100, 0, 20, 120),
        ),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("second ordinary answer", 120, 0, 20, 140),
        ),
        ScriptedResponse::json(
            "200 OK",
            scripted_responses_text("fork ordinary answer", 140, 0, 20, 160),
        ),
    ]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let mut agent = compaction_test_agent_with_mode(
        client.clone(),
        path.clone(),
        Some("session"),
        None,
        EventSink::none(),
        AgentMode::Direct,
    );
    agent.messages = original.into_iter().map(|(_, message)| message).collect();
    store_agent_snapshot(&path, &agent);
    assert!(matches!(
        agent.compact().await.unwrap(),
        CompactionResult::Compacted { .. }
    ));
    let checkpoint_id = agent
        .compaction
        .as_ref()
        .unwrap()
        .active_checkpoint_for_test()
        .unwrap()
        .id;
    agent.set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
    assert_eq!(
        agent.send("ordinary question").await.unwrap(),
        "first ordinary answer"
    );
    // The model loop appended an Assistant AFTER its last verified preparation.
    // A fresh read must retain actual usage, materially below byte estimates.
    let view = agent
        .prepare_provider_view(&mut TokenUsage::default(), &[])
        .await
        .unwrap();
    assert_eq!(view.context_estimate, 120);
    assert_eq!(view.checkpoint_id, Some(checkpoint_id));
    agent.restore_compaction_checkpoint().unwrap();
    assert_eq!(
        agent
            .prepare_provider_view(&mut TokenUsage::default(), &[])
            .await
            .unwrap()
            .context_estimate,
        120
    );
    agent.set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
    assert_eq!(
        agent.send("next ordinary question").await.unwrap(),
        "second ordinary answer"
    );
    assert_eq!(
        agent
            .prepare_provider_view(&mut TokenUsage::default(), &[])
            .await
            .unwrap()
            .context_estimate,
        140
    );
    agent.restore_compaction_checkpoint().unwrap();
    assert_eq!(
        agent
            .prepare_provider_view(&mut TokenUsage::default(), &[])
            .await
            .unwrap()
            .context_estimate,
        140
    );

    let writer = crate::store::TranscriptLogWriter::new(&path).unwrap();
    let canonical = writer
        .read_from("session", 0)
        .unwrap()
        .into_iter()
        .map(|(_, message)| message)
        .collect::<Vec<_>>();
    let mut restarted = compaction_test_agent_with_mode(
        client.clone(),
        path.clone(),
        Some("session"),
        None,
        EventSink::none(),
        AgentMode::Direct,
    );
    restarted.messages = canonical.clone();
    restarted.restore_compaction_checkpoint().unwrap();
    let view = restarted
        .prepare_provider_view(&mut TokenUsage::default(), &[])
        .await
        .unwrap();
    assert_eq!(view.checkpoint_id, Some(checkpoint_id));
    assert!(
        view.context_estimate > 1_000,
        "fresh restart cannot inherit in-process provider usage"
    );

    crate::store::insert_test_session(&path, "fork");
    writer.append_batch("fork", 0, &canonical).unwrap();
    crate::store::copy_terminal_selection_attributions(
        &path,
        "session",
        "fork",
        canonical.len() as u64,
    )
    .unwrap();
    assert_eq!(
        crate::store::load_terminal_selection_references(&path, "fork", 0, 100)
            .unwrap()
            .len(),
        12
    );
    assert!(crate::store::list_session_inbox(&path, "fork")
        .unwrap()
        .is_empty());
    let mut fork = compaction_test_agent_with_mode(
        client,
        path.clone(),
        Some("fork"),
        Some(1_000_000),
        EventSink::none(),
        AgentMode::Direct,
    );
    fork.messages = canonical;
    let connection = crate::store::open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET messages_json=?1 WHERE session_id='fork'",
            [serde_json::to_string(&fork.messages).unwrap()],
        )
        .unwrap();
    drop(connection);
    fork.restore_compaction_checkpoint().unwrap();
    assert!(
        fork.prepare_provider_view(&mut TokenUsage::default(), &[])
            .await
            .unwrap()
            .context_estimate
            > 1_000
    );
    fork.set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
    assert_eq!(
        fork.send("fork asks explicitly").await.unwrap(),
        "fork ordinary answer"
    );
    assert_eq!(
        fork.prepare_provider_view(&mut TokenUsage::default(), &[])
            .await
            .unwrap()
            .context_estimate,
        160
    );
    fork.restore_compaction_checkpoint().unwrap();
    assert_eq!(
        fork.prepare_provider_view(&mut TokenUsage::default(), &[])
            .await
            .unwrap()
            .context_estimate,
        160
    );

    // Metadata-only mutation must invalidate the unchanged canonical sample.
    let connection = crate::store::open_runtime_connection(&path).unwrap();
    connection.execute("UPDATE thread_events SET event_json=json_remove(event_json,'$.nac_transcript_message.terminal_selection_attribution') WHERE session_id='session'", []).unwrap();
    let view = agent
        .prepare_provider_view(&mut TokenUsage::default(), &[])
        .await
        .unwrap();
    assert!(view.context_estimate > 1_000);
    assert!(view.checkpoint_id.is_none());
    assert_eq!(server.finish().len(), 4); // Restore, fork copying and verification never call the provider.
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
