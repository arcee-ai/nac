use super::*;

#[tokio::test]
async fn finish_run_persists_snapshot_before_completion_event() {
    let store_path = test_store_path("active_finish_persist");
    let client = ModelClient::new_for_test();
    let session_id = "session-finish-persist".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    let mut events = parts.service.subscribe_events();
    let client = parts.service.connect_client();
    let active = parts
        .service
        .try_begin_run(Some(client.client_id().clone()), "prompt")
        .unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_for_test(Message::User {
                content: "prompt".to_string(),
            })
            .await
            .unwrap();
        agent
            .push_and_log_for_test(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            })
            .await
            .unwrap();
    }

    assert!(
        parts
            .service
            .finish_run_once(
                &active.run_id,
                RunOutcome::Completed("done".to_string(), None)
            )
            .await
    );

    let started = events.recv().await.unwrap();
    assert_eq!(started.sequence_id, 1);
    assert_run_started_event(started, &active, "prompt");

    // The commit-point live signals (step 3) precede the run-end save.
    for (sequence_id, transcript_len) in [(2, 2), (3, 3)] {
        let appended = events.recv().await.unwrap();
        assert_eq!(appended.sequence_id, sequence_id);
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len }
        );
    }

    let saved_event = events.recv().await.unwrap();
    assert_eq!(saved_event.session_id.as_deref(), Some(session_id.as_str()));
    assert_eq!(saved_event.sequence_id, 4);
    assert_eq!(saved_event.client_id.as_ref(), active.client_id.as_ref());
    assert_eq!(saved_event.run_id.as_ref(), Some(&active.run_id));
    assert_eq!(
        saved_event.event,
        SessionEvent::SnapshotSaved {
            session_id: session_id.clone()
        }
    );

    let completion = events.recv().await.unwrap();
    assert_eq!(completion.sequence_id, 5);
    assert_eq!(completion.client_id.as_ref(), active.client_id.as_ref());
    assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
    let duration_ms = match completion.event {
        SessionEvent::RunCompleted {
            response,
            duration_ms,
        } => {
            assert_eq!(response, "done");
            duration_ms.expect("completed run should include duration")
        }
        other => panic!("expected run completion, got {other:?}"),
    };

    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(loaded.last_response_duration_ms, Some(duration_ms));
    assert_eq!(loaded.previous_response_duration_ms, None);
    assert_eq!(loaded.response_durations_ms, Some(vec![Some(duration_ms)]));
    // Never-fold (step 4): the run end did not rewrite the blob...
    assert_eq!(
        serde_json::to_value(&loaded.messages).unwrap(),
        serde_json::to_value(&parts.init.restored_messages).unwrap()
    );
    // ...the run's messages are served from the transcript log.
    let transcript = parts.service.messages_snapshot().await.unwrap();
    assert_eq!(transcript.len(), parts.init.restored_messages.len() + 2);
    assert!(matches!(
        transcript.last(),
        Some(Message::Assistant { content: Some(text), .. }) if text == "done"
    ));
    assert!(parts.service.active_run().is_none());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn run_end_persists_run_state_without_rewriting_messages_json() {
    let (parts, store_path) = test_active_service("never_fold_run_end", "session-never-fold");
    let session_id = "session-never-fold";
    let raw_messages_json = || {
        crate::store::open_connection(&store_path)
            .unwrap()
            .query_row(
                "SELECT messages_json FROM sessions WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap()
    };
    let blob_before = raw_messages_json();

    // Two full runs: the blob stays byte-identical (never-fold) while
    // the run-state bookkeeping accumulates per visible response.
    for (loaded_visible_response_count, (prompt, response, input_tokens)) in [
        ("first prompt", "first done", 10_u64),
        ("second prompt", "second done", 20_u64),
    ]
    .into_iter()
    .enumerate()
    {
        let active = parts.service.try_begin_run(None, prompt).unwrap();
        parts
            .service
            .set_run_transcript_baseline(&active.run_id, loaded_visible_response_count);
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: prompt.to_string(),
                })
                .await
                .unwrap();
            agent
                .push_and_log_for_test(Message::Assistant {
                    content: Some(response.to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                })
                .await
                .unwrap();
        }
        let usage = crate::model::TokenUsage {
            input_tokens,
            output_tokens: 5,
            ..crate::model::TokenUsage::default()
        };
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed(response.to_string(), Some(usage)),
                )
                .await
        );
        assert_eq!(
            raw_messages_json(),
            blob_before,
            "run end must never rewrite messages_json (never-fold)"
        );
    }

    let loaded = sessions::load_session(&store_path, session_id).unwrap();
    let durations = loaded
        .response_durations_ms
        .as_ref()
        .expect("duration history should be persisted");
    assert_eq!(durations.len(), 2);
    assert!(durations.iter().all(|entry| entry.is_some()));
    assert_eq!(loaded.last_response_duration_ms, durations[1]);
    assert_eq!(loaded.previous_response_duration_ms, durations[0]);
    assert_eq!(loaded.token_usages.len(), 2);
    assert_eq!(
        loaded.token_usages[0].as_ref().unwrap().input_tokens,
        10,
        "the first run's usage stays on the first visible response"
    );
    assert_eq!(
        loaded.token_usages[1].as_ref().unwrap().input_tokens,
        20,
        "the second run's usage lands on the final visible response"
    );

    // The full transcript is served from the store: blob ++ log.
    let transcript = parts.service.messages_snapshot().await.unwrap();
    assert_eq!(transcript.len(), parts.init.restored_messages.len() + 4);
    assert!(matches!(
        transcript.last(),
        Some(Message::Assistant { content: Some(text), .. }) if text == "second done"
    ));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn real_run_diffs_token_timing_from_the_run_start_store_count() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("baseline_real_run");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "new answer"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        )]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "baseline-session".to_string();
    let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    // Legacy-shaped history: the prior transcript lives in the blob and
    // the row carries scalar last/previous durations but NO duration
    // history vector (a pre-feature row resumed under this build).
    agent.messages.push(Message::User {
        content: "legacy prompt".to_string(),
    });
    agent.messages.push(Message::Assistant {
        content: Some("legacy answer".to_string()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    });
    let mut snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.last_response_duration_ms = Some(999);
    snapshot.previous_response_duration_ms = Some(888);
    snapshot.response_durations_ms = None;
    sessions::create_session(&store_path, &snapshot).unwrap();
    let blob_json_before: String = crate::store::open_connection(&store_path)
        .unwrap()
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    let handle = parts
        .service
        .try_submit_prompt("new prompt".to_string())
        .unwrap();
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());
    drop(handle);

    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    let durations = loaded
        .response_durations_ms
        .as_ref()
        .expect("the run end persists a duration history");
    assert_eq!(durations.len(), 2);
    assert_eq!(
        durations[0],
        Some(999),
        "the legacy last-duration stays on the pre-run response: the \
             diff base is the visible-response count at run START (1), not \
             the run-end count"
    );
    assert!(
        durations[1].is_some(),
        "the completed run's duration lands on the final visible response"
    );
    assert_eq!(loaded.last_response_duration_ms, durations[1]);
    assert_eq!(loaded.previous_response_duration_ms, Some(999));
    assert_eq!(loaded.token_usages.len(), 2);
    assert!(loaded.token_usages[0].is_none());
    assert_eq!(loaded.token_usages[1].as_ref().unwrap().input_tokens, 10);
    let blob_json_after: String = crate::store::open_connection(&store_path)
        .unwrap()
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        blob_json_after, blob_json_before,
        "a real run end never rewrites messages_json (never-fold)"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn recovered_session_continues_without_model_bookkeeping_and_clears_warning() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("recovered_continuation");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{"type": "output_text", "text": "continued"}]
            }],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "recovered-continuation".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    let interrupted_run_id = SessionRunId::new();
    parts
        .service
        .agent
        .lock()
        .await
        .push_and_log_run_prompt_for_test(
            Message::User {
                content: "prompt before restart".to_string(),
            },
            &interrupted_run_id,
        )
        .await
        .unwrap();
    assert!(matches!(
        crate::store::reconcile_active_run(&store_path, &session_id).unwrap(),
        crate::store::ActiveRunReconciliation::Interrupted { .. }
    ));
    assert_eq!(
        parts
            .service
            .frontend_snapshot()
            .await
            .unwrap()
            .transcript_recovery_warning
            .as_deref(),
        Some(INTERRUPTED_RUN_WARNING)
    );

    let mut events = parts.service.subscribe_events();
    let handle = parts
        .service
        .try_submit_prompt("continue after restart".to_string())
        .unwrap();
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());
    drop(handle);
    let published =
        std::iter::from_fn(|| events.try_recv().ok()).collect::<Vec<SessionEventEnvelope>>();
    assert!(published.iter().any(|envelope| {
        matches!(
            &envelope.event,
            SessionEvent::RunCompleted { response, .. } if response == "continued"
        )
    }));

    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let request_body = String::from_utf8(requests[0].body.clone()).unwrap();
    assert!(request_body.contains("prompt before restart"));
    assert!(request_body.contains("continue after restart"));
    assert!(!request_body.contains(INTERRUPTED_RUN_WARNING));
    assert!(!request_body.contains(interrupted_run_id.as_str()));
    assert!(parts
        .service
        .frontend_snapshot()
        .await
        .unwrap()
        .transcript_recovery_warning
        .is_none());
    assert!(crate::store::load_run_recovery(&store_path, &session_id)
        .unwrap()
        .is_none());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn finish_run_persists_token_usage() {
    let store_path = test_store_path("active_finish_token_usage");
    let client = ModelClient::new_for_test();
    let session_id = "session-finish-token-usage".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    let active = parts.service.try_begin_run(None, "prompt").unwrap();
    parts.service.set_run_transcript_baseline(&active.run_id, 0);
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_for_test(Message::User {
                content: "prompt".to_string(),
            })
            .await
            .unwrap();
        agent
            .push_and_log_for_test(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            })
            .await
            .unwrap();
    }

    let test_usage = crate::model::TokenUsage {
        input_tokens: 500,
        output_tokens: 120,
        cache_read_tokens: 80,
        cache_write_tokens: 15,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 715,
        cost: crate::model::TokenCostMicros::default(),
    };
    assert!(
        parts
            .service
            .finish_run_once(
                &active.run_id,
                RunOutcome::Completed("done".to_string(), Some(test_usage.clone())),
            )
            .await
    );

    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(loaded.token_usages.len(), 1);
    let persisted = loaded.token_usages[0]
        .as_ref()
        .expect("token usage should be persisted");
    assert_eq!(persisted.input_tokens, 500);
    assert_eq!(persisted.output_tokens, 120);
    assert_eq!(persisted.cache_read_tokens, 80);
    assert_eq!(persisted.cache_write_tokens, 15);
    assert_eq!(persisted.orchestrator_context_tokens, 715);

    // Frontend snapshot should expose the usage
    let frontend = parts.service.frontend_snapshot().await.unwrap();
    assert_eq!(
        frontend
            .response_timing
            .last_token_usage
            .as_ref()
            .unwrap()
            .orchestrator_context_tokens,
        715
    );
    assert_eq!(
        frontend
            .response_timing
            .token_usages
            .as_ref()
            .unwrap()
            .len(),
        1
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn failed_run_without_visible_response_round_trips_token_usage() {
    // Regression test: when a run fails (e.g. model API error after a tool
    // round that dispatched workers), the accumulated token usage —
    // including worker thread tokens — must still be persisted so it is
    // not permanently lost.
    let store_path = test_store_path("active_failed_token_usage");
    let client = ModelClient::new_for_test();
    let session_id = "session-failed-token-usage".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    let active = parts.service.try_begin_run(None, "prompt").unwrap();
    parts.service.set_run_transcript_baseline(&active.run_id, 0);
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_run_prompt_for_test(
                Message::User {
                    content: "prompt".to_string(),
                },
                &active.run_id,
            )
            .await
            .unwrap();
    }

    // Simulate usage that was accumulated during the run (including
    // worker thread tokens from a prior tool round) before the run failed.
    let test_usage = crate::model::TokenUsage {
        input_tokens: 500,
        output_tokens: 120,
        cache_read_tokens: 80,
        cache_write_tokens: 15,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 715,
        cost: crate::model::TokenCostMicros::default(),
    };
    assert!(
        parts
            .service
            .finish_run_once(
                &active.run_id,
                RunOutcome::Failed("model API error".to_string(), Some(test_usage.clone())),
            )
            .await
    );

    // The response-indexed history stays empty, while the failed run's
    // accounting round-trips through the extended token accounting JSON.
    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert!(loaded.token_usages.is_empty());
    let persisted = loaded
        .unattributed_token_usage
        .as_ref()
        .expect("failed usage should persist without a visible response");
    assert_eq!(persisted.input_tokens, 500);
    assert_eq!(persisted.output_tokens, 120);
    assert_eq!(persisted.cache_read_tokens, 80);
    assert_eq!(persisted.cache_write_tokens, 15);
    assert_eq!(persisted.orchestrator_context_tokens, 715);

    let frontend = parts.service.frontend_snapshot().await.unwrap();
    assert!(frontend.response_timing.token_usages.unwrap().is_empty());
    assert_eq!(
        frontend
            .response_timing
            .cumulative_token_usage
            .unwrap()
            .input_tokens,
        500
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn successful_response_replaces_failed_run_context_gauge_after_round_trip() {
    let store_path = test_store_path("failed_then_successful_token_usage");
    let client = ModelClient::new_for_test();
    let session_id = "session-failed-then-successful";
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    snapshot.unattributed_token_usage = Some(crate::model::TokenUsage {
        input_tokens: 500,
        output_tokens: 120,
        cache_read_tokens: 80,
        cache_write_tokens: 15,
        orchestrator_context_tokens: 715,
        cost: crate::model::TokenCostMicros {
            input: 1_000,
            output: 480,
            total: 1_480,
            ..crate::model::TokenCostMicros::default()
        },
        ..crate::model::TokenUsage::default()
    });
    sessions::create_session(&store_path, &snapshot).unwrap();

    let successful_usage = crate::model::TokenUsage {
        input_tokens: 700,
        output_tokens: 200,
        cache_read_tokens: 100,
        cache_write_tokens: 0,
        orchestrator_context_tokens: 1_000,
        cost: crate::model::TokenCostMicros {
            input: 1_400,
            output: 800,
            total: 2_200,
            ..crate::model::TokenCostMicros::default()
        },
        ..crate::model::TokenUsage::default()
    };
    let token_usages = token_usages_after_run(&[], 0, 1, Some(successful_usage.clone()));
    let unattributed_token_usage = unattributed_usage_after_run(
        snapshot.unattributed_token_usage.clone(),
        true,
        Some(successful_usage.clone()),
    );
    let update = snapshot.apply_run_state(sessions::SessionRunState {
        last_response_duration_ms: None,
        previous_response_duration_ms: None,
        response_durations_ms: None,
        token_usages,
        unattributed_token_usage,
    });
    sessions::save_session_run_state(&store_path, &update).unwrap();

    let loaded = sessions::load_session(&store_path, session_id).unwrap();
    let unattributed = loaded.unattributed_token_usage.as_ref().unwrap();
    assert_eq!(unattributed.input_tokens, 500);
    assert_eq!(unattributed.output_tokens, 120);
    assert_eq!(unattributed.cache_read_tokens, 80);
    assert_eq!(unattributed.cache_write_tokens, 15);
    assert_eq!(unattributed.cost.total, 1_480);
    assert_eq!(unattributed.orchestrator_context_tokens, 0);

    let timing = ResponseTimingSnapshot::from(&loaded);
    assert_eq!(
        timing
            .last_token_usage
            .as_ref()
            .unwrap()
            .orchestrator_context_tokens,
        1_000
    );
    let cumulative = timing.cumulative_token_usage.unwrap();
    assert_eq!(cumulative.input_tokens, 1_200);
    assert_eq!(cumulative.output_tokens, 320);
    assert_eq!(cumulative.cache_read_tokens, 180);
    assert_eq!(cumulative.cache_write_tokens, 15);
    assert_eq!(cumulative.cost.total, 3_680);
    assert_eq!(cumulative.orchestrator_context_tokens, 1_000);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn failed_run_without_new_visible_response_preserves_and_accumulates_usage() {
    let previous_usage = crate::model::TokenUsage {
        input_tokens: 100,
        output_tokens: 20,
        cost: crate::model::TokenCostMicros {
            input: 200,
            output: 80,
            total: 280,
            ..crate::model::TokenCostMicros::default()
        },
        ..crate::model::TokenUsage::default()
    };
    let failed_usage = crate::model::TokenUsage {
        input_tokens: 900,
        output_tokens: 70,
        cost: crate::model::TokenCostMicros {
            input: 1_800,
            output: 280,
            total: 2_080,
            ..crate::model::TokenCostMicros::default()
        },
        ..crate::model::TokenUsage::default()
    };

    let usages = token_usages_after_run(
        &[Some(previous_usage.clone())],
        1,
        1,
        Some(failed_usage.clone()),
    );
    let unattributed =
        unattributed_usage_after_run(None, false, Some(failed_usage.clone())).unwrap();
    let accumulated =
        unattributed_usage_after_run(Some(unattributed), false, Some(failed_usage.clone()))
            .unwrap();

    assert_eq!(usages, vec![Some(previous_usage)]);
    assert_eq!(accumulated.input_tokens, failed_usage.input_tokens * 2);
    assert_eq!(accumulated.output_tokens, failed_usage.output_tokens * 2);
    assert_eq!(accumulated.cost.total, failed_usage.cost.total * 2);
}

#[tokio::test]
async fn failed_run_normalizes_the_dangling_tool_turn_for_the_next_run() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    // Regression test (transcript review): a run that fails at the
    // tool-result commit point leaves the assistant tool-call message in
    // the long-lived agent's vec AND the log with its tool results in
    // neither. The next run reuses that agent, and providers reject a
    // transcript whose assistant tool calls have no tool results — the
    // run-failure path must trim the dangling turn from both stores.
    let store_path = test_store_path("failed_run_normalizes");
    let server = ScriptedServer::start(vec![
            ScriptedResponse::json(
                "200 OK",
                serde_json::json!({
                    "status": "completed",
                    "output": [{
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "unknown_alpha",
                        "arguments": "{}"
                    }],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
            ScriptedResponse::json(
                "200 OK",
                serde_json::json!({
                    "status": "completed",
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "recovered"}]}],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
        ]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "session-failed-normalizes".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    // Inject the log failure precisely at the tool-result commit point:
    // only tool-kind transcript rows fail to insert (the prompt and
    // assistant appends succeed).
    let connection = rusqlite::Connection::open(&store_path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_tool_log_appends
                 BEFORE INSERT ON thread_events
                 WHEN NEW.event_json LIKE '%\"kind\":\"tool\"%'
                 BEGIN
                     SELECT RAISE(ABORT, 'injected tool batch log failure');
                 END;",
        )
        .unwrap();

    let mut events = parts.service.subscribe_events();
    parts
        .service
        .try_submit_prompt("prompt one".to_string())
        .unwrap();
    let terminal = loop {
        let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("timed out waiting for the first run's terminal event")
            .unwrap();
        if matches!(
            envelope.event,
            SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
        ) {
            break envelope;
        }
    };
    assert!(
        matches!(terminal.event, SessionEvent::RunFailed { .. }),
        "the injected log failure must fail the first run: {:?}",
        terminal.event
    );
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());

    // The dangling assistant tool-call turn is trimmed from the vec AND
    // the log: both end at the failed run's prompt.
    {
        let agent = parts.service.agent.lock().await;
        assert_eq!(agent.messages.len(), 2);
        assert!(
            matches!(agent.messages[1], Message::User { ref content } if content == "prompt one")
        );
    }
    let log = crate::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .read_from(&session_id, 0)
        .unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].0, 1);
    assert!(matches!(log[0].1, Message::User { ref content } if content == "prompt one"));

    // The next run reuses the same agent: with the dangling turn gone,
    // the provider view is clean and the run completes.
    connection
        .execute_batch("DROP TRIGGER fail_tool_log_appends")
        .unwrap();
    parts
        .service
        .try_submit_prompt("prompt two".to_string())
        .unwrap();
    let terminal = loop {
        let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("timed out waiting for the second run's terminal event")
            .unwrap();
        if matches!(
            envelope.event,
            SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
        ) {
            break envelope;
        }
    };
    assert!(
        matches!(
            terminal.event,
            SessionEvent::RunCompleted { ref response, .. } if response == "recovered"
        ),
        "the second run must complete once the dangling turn is trimmed: {:?}",
        terminal.event
    );
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());

    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let second_request: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(
        !second_request["input"]
            .to_string()
            .contains("function_call"),
        "the second run's provider view must not carry the dangling tool call"
    );
    // The log stays contiguous across the normalization: prompt one@1,
    // prompt two@2, assistant@3.
    let log = crate::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .read_from(&session_id, 0)
        .unwrap();
    assert_eq!(log.len(), 3);
    assert_eq!(log[1].0, 2);
    assert!(matches!(log[1].1, Message::User { ref content } if content == "prompt two"));
    assert_eq!(log[2].0, 3);
    assert!(
        matches!(log[2].1, Message::Assistant { content: Some(ref text), .. } if text == "recovered")
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
