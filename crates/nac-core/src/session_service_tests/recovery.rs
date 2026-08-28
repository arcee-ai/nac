use super::*;

/// Subprocess for
/// `shared_store_recovery_after_peer_crash_preserves_committed_transcript`.
/// In `run` mode it completes one real service run, starts a second run,
/// and waits in model I/O while holding the operation lease. In `inspect`
/// mode it restores the durable transcript as a freshly started process
/// and writes that view for the parent to compare.
#[tokio::test]
async fn shared_store_peer_process_helper() {
    let Some(store_path) = std::env::var_os("NAC_TEST_SHARED_STORE_STORE") else {
        return;
    };
    let store_path = PathBuf::from(store_path);
    let session_id = std::env::var("NAC_TEST_SHARED_STORE_SESSION").unwrap();
    let base_url = std::env::var("NAC_TEST_SHARED_STORE_BASE_URL").unwrap();
    let mode = std::env::var("NAC_TEST_SHARED_STORE_MODE").unwrap_or_else(|_| "run".to_string());
    let client = ModelClient::new_for_test_server(base_url);
    let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::load_session(&store_path, &session_id).unwrap();
    agent
        .restore_messages_merging_log_tail(snapshot.messages.clone(), None)
        .await
        .unwrap();

    if mode == "inspect" {
        let output_path = PathBuf::from(std::env::var_os("NAC_TEST_SHARED_STORE_OUTPUT").unwrap());
        std::fs::write(output_path, serde_json::to_vec(&agent.messages).unwrap()).unwrap();
        return;
    }

    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
            store_path,
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    let mut events = parts.service.subscribe_events();
    parts
        .service
        .try_submit_prompt("peer completed prompt".to_string())
        .unwrap();
    loop {
        let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("timed out waiting for the peer's completed run")
            .unwrap();
        if matches!(
            &envelope.event,
            SessionEvent::RunCompleted { response, .. } if response == "peer answer"
        ) {
            break;
        }
    }
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());

    parts
        .service
        .try_submit_prompt("peer interrupted prompt".to_string())
        .unwrap();
    tokio::time::sleep(Duration::from_secs(30)).await;
}

/// Regression test for issue #146 (shared-store recovery): a child
/// process completes one real run, starts another, and is SIGKILLed while
/// its model request holds the session operation lease. A survivor with a
/// stale cached service must adopt every committed transcript row and
/// persisted run-state field before running. A fresh post-recovery
/// process must then restore the same transcript, with counters and
/// SQLite integrity intact.
#[tokio::test]
async fn shared_store_recovery_after_peer_crash_preserves_committed_transcript() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("shared_store_recovery");
    let session_id = "session-shared-store".to_string();
    let (interrupted_ready_sender, interrupted_ready_receiver) = std::sync::mpsc::sync_channel(1);
    let (release_interrupted_sender, release_interrupted_receiver) =
        std::sync::mpsc::sync_channel(1);
    let server = ScriptedServer::start_observed_with_timeout(
            vec![
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{"type": "message", "content": [{"type": "output_text", "text": "peer answer"}]}],
                        "usage": {"input_tokens": 101, "output_tokens": 11, "total_tokens": 112}
                    })
                    .to_string(),
                ),
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{"type": "message", "content": [{"type": "output_text", "text": "killed answer"}]}],
                        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
                    })
                    .to_string(),
                )
                .drop_connection(),
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{"type": "message", "content": [{"type": "output_text", "text": "survivor answer"}]}],
                        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                    })
                    .to_string(),
                ),
            ],
            Duration::from_secs(30),
            move |index, _request| {
                if index == 1 {
                    interrupted_ready_sender.send(()).unwrap();
                    release_interrupted_receiver.recv().unwrap();
                }
            },
        );
    let client = ModelClient::new_for_test_server(server.base_url.clone());
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
    // The survivor's cached agent and run accounting predate both peer
    // runs.
    assert_eq!(parts.service.agent.lock().await.messages.len(), 1);
    assert!(parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_ref()
        .unwrap()
        .token_usages
        .is_empty());

    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "session_service::tests::recovery::shared_store_peer_process_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_SHARED_STORE_STORE", &store_path)
        .env("NAC_TEST_SHARED_STORE_SESSION", &session_id)
        .env("NAC_TEST_SHARED_STORE_BASE_URL", &server.base_url)
        .env("NAC_TEST_SHARED_STORE_MODE", "run")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    interrupted_ready_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("peer never reached its interrupted model request");
    assert!(
        child.try_wait().unwrap().is_none(),
        "peer helper exited before SIGKILL"
    );
    child.kill().unwrap();
    child.wait().unwrap();
    release_interrupted_sender.send(()).unwrap();

    // The survivor acquires the released lease, adopts the peer's
    // completed exchange plus interrupted prompt, and appends after them.
    let mut events = parts.service.subscribe_events();
    let survivor_run = parts
        .service
        .try_submit_prompt("survivor prompt".to_string())
        .unwrap();
    let terminal = loop {
        let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("timed out waiting for the recovery run's terminal event")
            .unwrap();
        if envelope.run_id.as_ref() == Some(&survivor_run.run_id)
            && matches!(
                envelope.event,
                SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
            )
        {
            break envelope;
        }
    };
    assert!(
        matches!(
            &terminal.event,
            SessionEvent::RunCompleted { response, .. } if response == "survivor answer"
        ),
        "the recovery run must complete from the refreshed transcript: {:?}",
        terminal.event
    );
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());

    let log = crate::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .read_from(&session_id, 0)
        .unwrap();
    assert_eq!(log.len(), 5);
    assert_eq!(log[0].0, 1);
    assert!(matches!(&log[0].1, Message::User { content } if content == "peer completed prompt"));
    assert_eq!(log[1].0, 2);
    assert!(
        matches!(&log[1].1, Message::Assistant { content: Some(text), .. } if text == "peer answer")
    );
    assert_eq!(log[2].0, 3);
    assert!(matches!(&log[2].1, Message::User { content } if content == "peer interrupted prompt"));
    assert_eq!(log[3].0, 4);
    assert!(matches!(&log[3].1, Message::User { content } if content == "survivor prompt"));
    assert_eq!(log[4].0, 5);
    assert!(
        matches!(&log[4].1, Message::Assistant { content: Some(text), .. } if text == "survivor answer")
    );

    let agent = parts.service.agent.lock().await;
    assert_eq!(agent.messages.len(), 6);
    for (idx, message) in &log {
        assert_eq!(
            serde_json::to_vec(message).unwrap(),
            serde_json::to_vec(&agent.messages[*idx as usize]).unwrap()
        );
    }
    let survivor_messages = serde_json::to_vec(&agent.messages).unwrap();
    drop(agent);

    // The recovery run must append its accounting to the peer's durable
    // history rather than overwriting that history from the survivor's
    // stale cached snapshot.
    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(loaded.token_usages.len(), 2);
    assert_eq!(loaded.token_usages[0].as_ref().unwrap().input_tokens, 101);
    assert_eq!(loaded.token_usages[1].as_ref().unwrap().input_tokens, 10);
    let durations = loaded.response_durations_ms.as_ref().unwrap();
    assert_eq!(durations.len(), 2);
    assert!(durations[0].is_some());
    assert!(durations[1].is_some());

    let summary = sessions::list_sessions(&store_path)
        .unwrap()
        .into_iter()
        .find(|summary| summary.session_id == session_id)
        .unwrap();
    assert_eq!(summary.visible_message_count, 5);
    assert_eq!(summary.last_user_prompt.as_deref(), Some("survivor prompt"));
    assert_eq!(summary.run_count, 3);
    let connection = crate::store::open_connection(&store_path).unwrap();
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    drop(connection);

    // A new process after recovery must restore the same complete
    // transcript as the still-live survivor.
    let restarted_output = store_path
        .parent()
        .unwrap()
        .join("restarted-transcript.json");
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "session_service::tests::recovery::shared_store_peer_process_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_SHARED_STORE_STORE", &store_path)
        .env("NAC_TEST_SHARED_STORE_SESSION", &session_id)
        .env("NAC_TEST_SHARED_STORE_BASE_URL", &server.base_url)
        .env("NAC_TEST_SHARED_STORE_MODE", "inspect")
        .env("NAC_TEST_SHARED_STORE_OUTPUT", &restarted_output)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success(), "restarted peer helper failed");
    assert_eq!(
        std::fs::read(&restarted_output).unwrap(),
        survivor_messages,
        "restarted and surviving processes must serve the same transcript"
    );

    assert_eq!(server.finish().len(), 3);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

/// Regression test for the stale-snapshot Bugbot finding: an admission
/// that repairs the snapshot blob but fails before patching the cached
/// snapshot (e.g. snapshot lock contention) must not leave the stale
/// pre-repair blob cached for the process lifetime. The next admission
/// sees nothing left to repair, so it reconciles the cached snapshot
/// with the durable blob the refresh returns on every admission.
#[tokio::test]
async fn admission_reconciles_a_snapshot_left_stale_by_a_prior_repair() {
    let (parts, store_path) =
        test_active_service("admission_stale_snapshot", "stale-snapshot-session");

    // The durable blob was already repaired by a prior admission
    // attempt: it holds only the complete turn.
    let repaired_blob = vec![
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "prompt".to_string(),
        },
    ];
    seed_store_transcript(&parts, repaired_blob.clone()).await;

    // ...but that attempt failed before patching the cached snapshot,
    // which still serves the discarded dangling tool-call turn.
    let mut stale_blob = repaired_blob.clone();
    stale_blob.push(Message::Assistant {
        content: None,
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: Some(vec![crate::types::ToolCall {
            id: "call-1".to_string(),
            call_type: "function".to_string(),
            function: crate::types::FunctionCall {
                name: "read".to_string(),
                arguments: "{}".to_string(),
            },
        }]),
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    });
    parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_mut()
        .unwrap()
        .messages = stale_blob;

    // The retry finds nothing left to repair in the durable store, yet
    // must still heal the cached snapshot from the durable blob.
    let lease = match parts.service.prepare_operation_admission(None) {
        Ok(lease) => lease,
        Err(_) => panic!("admission must succeed for the fresh session"),
    };
    drop(lease);

    let snapshot = parts.service.session_snapshot.lock().await;
    let messages = &snapshot.as_ref().unwrap().messages;
    assert_eq!(
        messages.len(),
        repaired_blob.len(),
        "the cached snapshot no longer serves the discarded dangling turn"
    );
    assert!(matches!(messages[1], Message::User { .. }));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn completed_run_reports_failure_when_snapshot_persistence_fails() {
    let store_path = test_store_path("active_persist_failure");
    let store_parent = store_path.parent().unwrap().to_path_buf();
    // The store must be usable at agent construction time (the transcript
    // log writer opens it eagerly); break the path afterwards so only the
    // snapshot save at run end fails.
    crate::store::initialize(&store_path).unwrap();
    let client = ModelClient::new_for_test();
    let session_id = "session-persist-failure".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id,
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
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: snapshot.session_id.clone(),
            store_path,
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    // Inject the persistence failure: replace the store directory with a
    // plain file so `save_session` can no longer open the database.
    std::fs::remove_dir_all(&store_parent).unwrap();
    std::fs::write(&store_parent, "not a directory").unwrap();

    let mut events = parts.service.subscribe_events();
    let active = parts.service.try_begin_run(None, "prompt").unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent.messages.push(Message::User {
            content: "prompt".to_string(),
        });
        agent.messages.push(Message::Assistant {
            content: Some("done".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        });
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
    assert_run_started_event(started, &active, "prompt");

    let terminal = events.recv().await.unwrap();
    assert_eq!(terminal.sequence_id, 2);
    assert_eq!(terminal.run_id.as_ref(), Some(&active.run_id));
    assert_eq!(terminal.client_id.as_ref(), active.client_id.as_ref());
    assert_eq!(
        terminal.event,
        SessionEvent::RunFailed {
            message: "run failed".to_string()
        }
    );
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
    assert!(parts.service.active_run().is_none());

    let _ = std::fs::remove_file(store_parent);
}

#[tokio::test]
async fn cancelled_run_stays_cancelled_when_snapshot_persistence_fails() {
    let store_path = test_store_path("cancel_persist_failure");
    let store_parent = store_path.parent().unwrap().to_path_buf();
    crate::store::initialize(&store_path).unwrap();
    let client = ModelClient::new_for_test();
    let session_id = "session-cancel-persist-failure".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id,
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
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: snapshot.session_id.clone(),
            store_path,
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    std::fs::remove_dir_all(&store_parent).unwrap();
    std::fs::write(&store_parent, "not a directory").unwrap();
    let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
    parts.service.request_cancel(&active.run_id).await.unwrap();

    let terminal_events = parts
        .service
        .recent_events(None, 32)
        .1
        .into_iter()
        .filter(|envelope| {
            matches!(
                envelope.event,
                SessionEvent::RunCompleted { .. }
                    | SessionEvent::RunFailed { .. }
                    | SessionEvent::RunCancelled
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(terminal_events.len(), 1);
    assert_eq!(terminal_events[0].event, SessionEvent::RunCancelled);
    assert!(parts.service.active_run().is_none());
    let _ = std::fs::remove_file(store_parent);
}

#[tokio::test]
async fn subscribe_agent_events_filters_agent_envelopes() {
    let store_path = test_store_path("agent_event_adapter");
    let client = ModelClient::new_for_test();
    let session_id = "session-agent-events".to_string();
    crate::store::insert_test_session(&store_path, &session_id);
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
    let mut agent_events = parts.service.subscribe_agent_events();
    let agent_event = AgentEvent::RunFinished {
        thread_name: Some("impl".to_string()),
    };

    parts.service.event_bus.emit(SessionEvent::SnapshotSaved {
        session_id: session_id.clone(),
    });
    parts.service.event_bus.emit_agent(agent_event.clone());

    assert_eq!(agent_events.recv().await, Some(agent_event));
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn client_subscribers_receive_same_events_with_unique_identity() {
    let parts = test_picker_service("client_subscribers");
    let first_client = parts.service.connect_client();
    let second_client = parts.service.connect_client();
    let mut first_events = first_client.subscribe_events();
    let mut second_events = second_client.subscribe_events();

    assert_ne!(first_client.client_id(), second_client.client_id());
    assert_eq!(&first_events.client_id, first_client.client_id());
    assert_eq!(&second_events.client_id, second_client.client_id());
    assert_ne!(first_events.subscription_id, second_events.subscription_id);

    let agent_event = AgentEvent::RunFinished {
        thread_name: Some("impl".to_string()),
    };
    parts.service.event_bus.emit_agent(agent_event.clone());

    let first = first_events.receiver.recv().await.unwrap();
    let second = second_events.receiver.recv().await.unwrap();
    assert_eq!(first, second);
    assert_eq!(first.sequence_id, 1);
    assert_eq!(first.event, SessionEvent::Agent { event: agent_event });
}

#[tokio::test]
async fn frontend_snapshot_does_not_wait_for_agent_lock_while_active_run() {
    let parts = test_picker_service("snapshot_nonblocking");
    let agent_guard = parts.service.agent.lock().await;
    let active = parts.service.try_begin_run(None, "blocked prompt").unwrap();

    let snapshot = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        parts.service.frontend_snapshot(),
    )
    .await
    .expect("frontend snapshot should not wait for the held agent mutex")
    .unwrap();

    assert_eq!(snapshot.active_run, Some(active.clone()));
    let submitted = snapshot
        .active_run
        .as_ref()
        .and_then(|active_run| active_run.submitted_user_message.as_ref())
        .expect("active run should expose server-submitted user message");
    assert_eq!(submitted.run_id, active.run_id);
    assert_eq!(submitted.content, "blocked prompt");
    assert!(snapshot.messages.is_empty());

    drop(agent_guard);
    assert!(
        parts
            .service
            .finish_run_once(
                &active.run_id,
                RunOutcome::Failed("cleanup".to_string(), None)
            )
            .await
    );
    let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
}

#[tokio::test]
async fn mark_run_finishing_clears_submitted_user_message_before_persistence() {
    let store_path = test_store_path("active_pending_cleared_on_finish");
    let client = ModelClient::new_for_test();
    let session_id = "session-pending-clear".to_string();
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
    let active = parts
        .service
        .try_begin_run(None, "persisted prompt")
        .unwrap();
    assert!(active.submitted_user_message.is_some());
    assert_eq!(parts.service.active_run(), Some(active.clone()));
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_for_test(Message::User {
                content: "persisted prompt".to_string(),
            })
            .await
            .unwrap();
    }

    let finishing = parts
        .service
        .mark_run_finishing(&active.run_id)
        .expect("run should transition to finishing");
    assert_eq!(finishing.snapshot.run_id, active.run_id);
    assert!(finishing.snapshot.submitted_user_message.is_none());
    let active_after_finishing = parts.service.active_run().unwrap();
    assert_eq!(active_after_finishing.run_id, active.run_id);
    assert!(active_after_finishing.submitted_user_message.is_none());

    let frontend_before_persist = parts.service.frontend_snapshot().await.unwrap();
    assert!(frontend_before_persist
        .active_run
        .as_ref()
        .unwrap()
        .submitted_user_message
        .is_none());
    assert!(matches!(
        frontend_before_persist.messages.last(),
        Some(Message::User { content }) if content == "persisted prompt"
    ));

    parts
        .service
        .persist_run_snapshot(
            &finishing.snapshot,
            finishing.transcript_baseline,
            Some(42),
            None,
            DurableRunTerminal::Completed,
        )
        .await
        .unwrap();

    let started = events.recv().await.unwrap();
    assert_run_started_event(started, &active, "persisted prompt");
    // The commit-point log append emits the live transcript signal before
    // the run-end snapshot save. The run id travels only inside send()
    // (the run-context sink), so this direct append carries none.
    let appended = events.recv().await.unwrap();
    assert_eq!(
        appended.event,
        SessionEvent::TranscriptAppended { transcript_len: 2 }
    );
    let saved = events.recv().await.unwrap();
    assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
    assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
    let active_after_save = parts.service.active_run().unwrap();
    assert_eq!(active_after_save.run_id, active.run_id);
    assert!(active_after_save.submitted_user_message.is_none());

    let frontend_after_persist = parts.service.frontend_snapshot().await.unwrap();
    assert!(frontend_after_persist
        .active_run
        .as_ref()
        .unwrap()
        .submitted_user_message
        .is_none());
    assert!(matches!(
        frontend_after_persist.messages.last(),
        Some(Message::User { content }) if content == "persisted prompt"
    ));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn mark_run_cancelling_clears_submitted_user_message() {
    let parts = test_picker_service("active_pending_cleared_on_cancel");
    let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
    assert!(active.submitted_user_message.is_some());

    let cancelling = parts
        .service
        .mark_run_cancelling(&active.run_id)
        .expect("run should transition to cancelling");

    assert_eq!(cancelling.snapshot.run_id, active.run_id);
    assert!(cancelling.snapshot.submitted_user_message.is_none());
    let active_after_cancelling = parts.service.active_run().unwrap();
    assert_eq!(active_after_cancelling.run_id, active.run_id);
    assert!(active_after_cancelling.submitted_user_message.is_none());
    drop(cancelling);
    let retry = parts
        .service
        .mark_run_cancelling(&active.run_id)
        .expect("dropping an interrupted cancellation claim must make it retryable");
    drop(retry);
    let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
}

#[tokio::test]
async fn dropping_a_cancel_caller_does_not_drop_owned_settlement() {
    let parts = test_picker_service("cancel_caller_drop_owned");
    let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
    let agent_guard = parts.service.agent.lock().await;
    let service = parts.service.clone();
    let run_id = active.run_id.clone();
    let caller = tokio::spawn(async move { service.request_cancel(&run_id).await });

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if parts
                .service
                .active_run()
                .is_some_and(|run| run.submitted_user_message.is_none())
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned cancellation never claimed the run");
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    drop(agent_guard);

    tokio::time::timeout(Duration::from_secs(2), async {
        while parts.service.active_run().is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("detached cancellation settlement did not finish");
    let agent = parts.service.agent.lock().await;
    assert_eq!(
        agent
            .messages
            .iter()
            .filter(|message| matches!(
                message,
                Message::Assistant { content: Some(content), .. }
                    if content == crate::agent::RUN_CANCELLED_MARKER
            ))
            .count(),
        1
    );
    drop(agent);
    let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
}

#[tokio::test]
async fn cancel_and_completion_race_has_exactly_one_terminal_owner() {
    let parts = test_picker_service("cancel_completion_race");
    let active = parts.service.try_begin_run(None, "race prompt").unwrap();
    let barrier = Arc::new(tokio::sync::Barrier::new(3));

    let cancel_service = parts.service.clone();
    let cancel_run_id = active.run_id.clone();
    let cancel_barrier = barrier.clone();
    let cancel = tokio::spawn(async move {
        cancel_barrier.wait().await;
        cancel_service.request_cancel(&cancel_run_id).await
    });
    let finish_service = parts.service.clone();
    let finish_run_id = active.run_id.clone();
    let finish_barrier = barrier.clone();
    let finish = tokio::spawn(async move {
        finish_barrier.wait().await;
        finish_service
            .finish_run_once(
                &finish_run_id,
                RunOutcome::Completed("done".to_string(), None),
            )
            .await
    });
    barrier.wait().await;
    let _ = cancel.await.unwrap();
    let _ = finish.await.unwrap();

    let terminal_events = parts
        .service
        .recent_events(None, 16)
        .1
        .into_iter()
        .filter(|envelope| {
            matches!(
                envelope.event,
                SessionEvent::RunCompleted { .. }
                    | SessionEvent::RunFailed { .. }
                    | SessionEvent::RunCancelled
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(terminal_events.len(), 1);
    assert!(matches!(
        terminal_events[0].event,
        SessionEvent::RunCompleted { .. } | SessionEvent::RunCancelled
    ));
    assert!(parts.service.active_run().is_none());
    let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
}

#[tokio::test]
async fn busy_run_rejects_concurrent_submission_and_clears_once() {
    let parts = test_picker_service("busy_rejection");
    let client = parts.service.connect_client();
    let mut events = parts.service.subscribe_events();
    let first = parts
        .service
        .try_begin_run(Some(client.client_id().clone()), "first prompt")
        .unwrap();

    assert_eq!(parts.service.active_run(), Some(first.clone()));
    let first_started = events.recv().await.unwrap();
    assert_eq!(first_started.sequence_id, 1);
    assert_run_started_event(first_started, &first, "first prompt");
    assert!(matches!(
        parts.service.try_begin_run(None, "second prompt"),
        Err(SessionSubmitError::Busy { active_run }) if active_run == first
    ));

    assert!(
        parts
            .service
            .finish_run_once(
                &first.run_id,
                RunOutcome::Completed("done".to_string(), None)
            )
            .await
    );
    let completion = events.recv().await.unwrap();
    assert_eq!(completion.sequence_id, 2);
    assert_eq!(completion.run_id.as_ref(), Some(&first.run_id));
    assert_eq!(completion.client_id.as_ref(), first.client_id.as_ref());
    assert!(matches!(
        completion.event,
        SessionEvent::RunCompleted {
            response,
            duration_ms: Some(_),
        } if response == "done"
    ));
    assert!(parts.service.active_run().is_none());

    assert!(
        !parts
            .service
            .finish_run_once(
                &first.run_id,
                RunOutcome::Completed("duplicate".to_string(), None)
            )
            .await
    );
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));

    let second = parts.service.try_begin_run(None, "second prompt").unwrap();
    let second_started = events.recv().await.unwrap();
    assert_run_started_event(second_started, &second, "second prompt");
    assert!(
        parts
            .service
            .finish_run_once(&second.run_id, RunOutcome::Failed("boom".to_string(), None))
            .await
    );
    let failed = events.recv().await.unwrap();
    assert_eq!(failed.run_id.as_ref(), Some(&second.run_id));
    assert!(failed.client_id.is_none());
    assert_eq!(
        failed.event,
        SessionEvent::RunFailed {
            message: "run failed".to_string()
        }
    );
    assert!(parts.service.active_run().is_none());
}

#[tokio::test]
async fn failed_run_persists_messages_without_recording_new_duration() {
    let store_path = test_store_path("active_failed_persist");
    let client = ModelClient::new_for_test();
    let session_id = "session-failed-persist".to_string();
    let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    agent.messages.push(Message::User {
        content: "old prompt".to_string(),
    });
    agent.messages.push(Message::Assistant {
        content: Some("old response".to_string()),
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
    snapshot.last_response_duration_ms = Some(123);
    snapshot.response_durations_ms = Some(vec![Some(123)]);
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
    let active = parts.service.try_begin_run(None, "failed prompt").unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_run_prompt_for_test(
                Message::User {
                    content: "failed prompt".to_string(),
                },
                &active.run_id,
            )
            .await
            .unwrap();
    }

    assert!(
        parts
            .service
            .finish_run_once(&active.run_id, RunOutcome::Failed("boom".to_string(), None))
            .await
    );
    let started = events.recv().await.unwrap();
    assert_run_started_event(started, &active, "failed prompt");
    // The prompt commit point's live signal precedes the run-end save.
    let appended = events.recv().await.unwrap();
    assert_eq!(
        appended.event,
        SessionEvent::TranscriptAppended { transcript_len: 4 }
    );
    let saved = events.recv().await.unwrap();
    assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
    assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
    let failed = events.recv().await.unwrap();
    assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
    assert_eq!(
        failed.event,
        SessionEvent::RunFailed {
            message: "run failed".to_string()
        }
    );

    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(loaded.last_response_duration_ms, Some(123));
    assert_eq!(loaded.previous_response_duration_ms, None);
    assert_eq!(loaded.response_durations_ms, Some(vec![Some(123)]));
    // Never-fold (step 4): the failed run's prompt persists in the
    // transcript log, not the blob.
    assert_eq!(
        serde_json::to_value(&loaded.messages).unwrap(),
        serde_json::to_value(&parts.init.restored_messages).unwrap()
    );
    let transcript = parts.service.messages_snapshot().await.unwrap();
    assert_eq!(transcript.len(), parts.init.restored_messages.len() + 1);
    assert!(matches!(
        transcript.last(),
        Some(Message::User { content }) if content == "failed prompt"
    ));
    let recovery = crate::store::load_run_recovery(&store_path, &session_id)
        .unwrap()
        .expect("failed run must retain a durable terminal outcome");
    assert_eq!(recovery.run_id, active.run_id.as_str());
    assert_eq!(recovery.status, crate::store::RunRecoveryStatus::Failed);
    assert_eq!(
        parts
            .service
            .frontend_snapshot()
            .await
            .unwrap()
            .transcript_recovery_warning
            .as_deref(),
        Some(FAILED_RUN_WARNING)
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn cancellation_waits_for_the_atomic_prompt_commit() {
    let (parts, store_path) = test_active_service("cancel_prompt_barrier", "cancel-prompt-barrier");
    let active = parts
        .service
        .try_begin_run_inner(
            None,
            "cancel prompt",
            None,
            false,
            RunAdmissionKind::default(),
        )
        .unwrap();
    let prompt_commit = parts.service.run_prompt_commit(&active.run_id).unwrap();
    let cancel_service = parts.service.clone();
    let cancel_run_id = active.run_id.clone();
    let cancel = tokio::spawn(async move { cancel_service.request_cancel(&cancel_run_id).await });
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    assert!(
        !cancel.is_finished(),
        "cancellation must not claim the run before its user turn is durable"
    );

    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_run_prompt_for_test(
                Message::User {
                    content: "cancel prompt".to_string(),
                },
                &active.run_id,
            )
            .await
            .unwrap();
    }
    prompt_commit.send_replace(RunPromptCommitStatus::Committed);
    cancel.await.unwrap().unwrap();

    let transcript = crate::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .read_from("cancel-prompt-barrier", 0)
        .unwrap();
    assert_eq!(transcript.len(), 2);
    assert!(matches!(
        &transcript[0].1,
        Message::User { content } if content == "cancel prompt"
    ));
    assert!(matches!(
        &transcript[1].1,
        Message::Assistant {
            content: Some(content),
            tool_calls,
            ..
        } if content == crate::agent::RUN_CANCELLED_MARKER
            && tool_calls.as_ref().is_none_or(Vec::is_empty)
    ));
    assert!(
        crate::store::load_run_recovery(&store_path, "cancel-prompt-barrier")
            .unwrap()
            .is_none()
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn request_cancel_persists_marker_and_emits_terminal_event() {
    let store_path = test_store_path("active_cancel_persist");
    let client = ModelClient::new_for_test();
    let session_id = "session-cancel-persist".to_string();
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
    let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
    assert!(parts
        .service
        .active_threads
        .mark("worker", "worker-dispatch"));
    crate::store::queue_thread_steering(
        &store_path,
        &session_id,
        "worker",
        "worker-dispatch",
        "worker direction",
    )
    .unwrap();
    crate::store::queue_thread_steering(
        &store_path,
        &session_id,
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        active.run_id.as_str(),
        "orchestrator direction",
    )
    .unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_run_prompt_for_test(
                Message::User {
                    content: "cancel prompt".to_string(),
                },
                &active.run_id,
            )
            .await
            .unwrap();
        agent.last_usage = Some(crate::model::TokenUsage {
            input_tokens: 40,
            output_tokens: 10,
            cost: crate::model::TokenCostMicros {
                input: 80,
                output: 40,
                total: 120,
                ..crate::model::TokenCostMicros::default()
            },
            ..crate::model::TokenUsage::default()
        });
    }

    parts.service.request_cancel(&active.run_id).await.unwrap();

    let started = events.recv().await.unwrap();
    assert_run_started_event(started, &active, "cancel prompt");
    // The prompt commit point's live signal fires before the cancel.
    let appended = events.recv().await.unwrap();
    assert_eq!(
        appended.event,
        SessionEvent::TranscriptAppended { transcript_len: 2 }
    );
    let steering_events = [
        events.recv().await.unwrap().event,
        events.recv().await.unwrap().event,
    ];
    assert!(steering_events.iter().any(|event| matches!(
        event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorSteeringExpired { .. }
        }
    )));
    assert!(steering_events.iter().any(|event| matches!(
        event,
        SessionEvent::Agent {
            event: AgentEvent::ThreadSteeringExpired { .. }
        }
    )));
    // The cancellation marker is a transcript commit point: the live
    // signal fires before the snapshot save (the cancel path runs outside
    // send(), so it carries no run context).
    let appended = events.recv().await.unwrap();
    assert_eq!(
        appended.event,
        SessionEvent::TranscriptAppended { transcript_len: 3 }
    );
    let saved = events.recv().await.unwrap();
    assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
    assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
    let cancelled = events.recv().await.unwrap();
    assert_eq!(cancelled.run_id.as_ref(), Some(&active.run_id));
    assert_eq!(cancelled.event, SessionEvent::RunCancelled);
    assert!(parts.service.active_run().is_none());
    assert!(
        crate::store::load_run_recovery(&store_path, &session_id)
            .unwrap()
            .is_none(),
        "the cancellation marker and run-state save clear the durable active marker"
    );
    assert!(parts.service.active_thread_names().is_empty());
    assert!(crate::store::list_thread_steering(&store_path, &session_id)
        .unwrap()
        .iter()
        .all(|record| record.status == "expired"));

    // Never-fold (step 4): the cancel path persists bookkeeping only —
    // the blob keeps the system head and the cancellation marker lives
    // in the transcript log.
    let loaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(loaded.token_usages.len(), 1);
    let cancellation_usage = loaded.token_usages[0]
        .as_ref()
        .expect("early cancellation usage should be attributed to its marker");
    assert_eq!(cancellation_usage.input_tokens, 40);
    assert_eq!(cancellation_usage.output_tokens, 10);
    assert_eq!(cancellation_usage.cost.total, 120);
    assert_eq!(
        serde_json::to_value(&loaded.messages).unwrap(),
        serde_json::to_value(&parts.init.restored_messages).unwrap()
    );
    let transcript = parts.service.messages_snapshot().await.unwrap();
    assert!(matches!(
        transcript.last(),
        Some(Message::Assistant {
            content: Some(content),
            ..
        }) if content == "[run cancelled by user]"
    ));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn direct_cancel_settles_foreground_terminal_without_another_tool_poll() {
    let session_id = "session-cancel-foreground-pty";
    let (parts, store_path) = test_direct_active_service(
        "cancel_foreground_pty",
        session_id,
        ModelClient::new_for_test(),
    );
    let cwd = std::env::current_dir().unwrap();
    let backend = crate::sandbox::execution_backend_from_sandbox(None, &cwd);
    let terminal_name = parts.service.terminal_manager.next_session_name();
    parts
        .service
        .terminal_manager
        .create(
            terminal_name.clone(),
            "sleep 30",
            Some(cwd),
            120,
            40,
            &backend,
        )
        .await
        .unwrap();
    assert!(parts
        .service
        .terminal_manager
        .get(&terminal_name)
        .await
        .is_some());

    let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_run_prompt_for_test(
                Message::User {
                    content: "cancel prompt".to_string(),
                },
                &active.run_id,
            )
            .await
            .unwrap();
    }

    parts.service.request_cancel(&active.run_id).await.unwrap();
    assert!(
        parts
            .service
            .terminal_manager
            .get(&terminal_name)
            .await
            .is_none(),
        "cancellation must kill the foreground PTY even when no terminal tool is polling"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn finish_run_without_active_session_snapshot_emits_completion_without_saving() {
    let store_path = test_store_path("picker_noop");
    let client = ModelClient::new_for_test();
    let agent = test_agent(client.clone(), store_path.clone(), None);
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Picker {
            store_path: store_path.clone(),
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    let mut events = parts.service.subscribe_events();
    let active = parts.service.try_begin_run(None, "prompt").unwrap();

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
    assert_run_started_event(started, &active, "prompt");
    let completion = events.recv().await.unwrap();
    assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
    assert!(matches!(
        completion.event,
        SessionEvent::RunCompleted {
            response,
            duration_ms: Some(_),
        } if response == "done"
    ));
    assert!(events.try_recv().is_err());
    assert!(!store_path.exists());
}
