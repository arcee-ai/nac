//! Step-2 tests for the DB-direct transcript workset: the in-loop dual-write
//! (four commit points), the orchestrator-only construction gate, the
//! blob ++ log restore merge, and crash/cancel log normalization.
use super::*;

fn test_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_agent_transcript_log_{label}_{unique}"))
        .join("store.db")
}

fn transcript_test_agent(
    client: ModelClient,
    store_path: PathBuf,
    session_id: Option<&str>,
    mode: AgentMode,
) -> Agent {
    Agent::with_config(
        client,
        AgentConfig {
            mode,
            store_path,
            session_id: session_id.map(str::to_string),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: match mode {
                AgentMode::Worker => Some("impl/x".to_string()),
                AgentMode::Orchestrator => None,
            },
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: PathBuf::from("."),
            config_cwd: PathBuf::from("."),
            working_directory: ".".to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
        },
    )
    .expect("agent config must be valid")
}

fn orchestrator_agent(store_path: PathBuf, session_id: &str, server_url: Option<String>) -> Agent {
    let client = match server_url {
        Some(url) => ModelClient::new_for_test_server(url),
        None => ModelClient::new_for_test(),
    };
    let mut agent = transcript_test_agent(
        client,
        store_path,
        Some(session_id),
        AgentMode::Orchestrator,
    );
    agent.set_steering_dispatch_id(Some("run".to_string()));
    agent
}

fn scripted_text_response(text: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    })
    .to_string()
}

fn scripted_tool_call_response(calls: &[(&str, &str, &str)]) -> String {
    let output = calls
        .iter()
        .map(|(call_id, name, arguments)| {
            serde_json::json!({
                "type": "function_call",
                "call_id": call_id,
                "name": name,
                "arguments": arguments
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "status": "completed",
        "output": output,
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    })
    .to_string()
}

fn read_log(store_path: &std::path::Path, session_id: &str) -> Vec<(u64, Message)> {
    crate::store::TranscriptLogWriter::new(store_path)
        .unwrap()
        .read_from(session_id, 0)
        .unwrap()
}

fn store_snapshot_messages(store_path: &std::path::Path, messages: &[Message]) {
    let messages_json = serde_json::to_string(messages).unwrap();
    let visible_count = crate::sessions::visible_message_count(messages) as i64;
    let last_user_prompt = crate::sessions::last_user_prompt(messages);
    let connection = rusqlite::Connection::open(store_path).unwrap();
    connection
        .execute(
            "UPDATE sessions
             SET messages_json = ?1, visible_message_count = ?2, last_user_prompt = ?3
             WHERE session_id = 'session'",
            rusqlite::params![messages_json, visible_count, last_user_prompt],
        )
        .unwrap();
}

fn canonical(message: &Message) -> Vec<u8> {
    serde_json::to_vec(message).unwrap()
}

fn user_message(content: &str) -> Message {
    Message::User {
        content: content.to_string(),
    }
}

fn plain_assistant(content: &str) -> Message {
    Message::Assistant {
        content: Some(content.to_string()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

fn tool_call_assistant(call_ids: &[&str]) -> Message {
    Message::Assistant {
        content: None,
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: Some(
            call_ids
                .iter()
                .map(|id| crate::types::ToolCall {
                    id: id.to_string(),
                    call_type: "function".to_string(),
                    function: crate::types::FunctionCall {
                        name: "read".to_string(),
                        arguments: "{}".to_string(),
                    },
                })
                .collect(),
        ),
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

#[test]
fn transcript_log_gate_is_orchestrator_with_session_only() {
    // The construction-time gate: workers (separate `__worker` processes)
    // must never log, and neither must session-less (picker) orchestrators.
    let worker = transcript_test_agent(
        ModelClient::new_for_test(),
        test_store_path("gate_worker"),
        Some("session"),
        AgentMode::Worker,
    );
    assert!(worker.transcript_log.is_none());

    let picker = transcript_test_agent(
        ModelClient::new_for_test(),
        test_store_path("gate_picker"),
        None,
        AgentMode::Orchestrator,
    );
    assert!(picker.transcript_log.is_none());

    let store_path = test_store_path("gate_orchestrator");
    crate::store::initialize(&store_path).unwrap();
    let orchestrator = transcript_test_agent(
        ModelClient::new_for_test(),
        store_path.clone(),
        Some("session"),
        AgentMode::Orchestrator,
    );
    let sink = orchestrator
        .transcript_log
        .as_ref()
        .expect("orchestrator with a session id must have a transcript log");
    assert_eq!(sink.session_id, "session");

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn worker_send_never_writes_transcript_log_rows() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("worker_send");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_text_response("worker answer"),
    )]);
    let mut worker = transcript_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
        AgentMode::Worker,
    );
    worker.set_steering_dispatch_id(Some("dispatch".to_string()));

    assert_eq!(worker.send("hello").await.unwrap(), "worker answer");
    server.finish();
    assert!(worker.messages.len() > 1);
    assert!(
        read_log(&store_path, "session").is_empty(),
        "worker runs must not write `__orchestrator__` transcript rows"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn send_logs_prompt_assistant_and_tool_batch_at_absolute_indices() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("commit_points");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            scripted_tool_call_response(&[
                ("call-1", "unknown_alpha", "{}"),
                ("call-2", "unknown_beta", "{}"),
            ]),
        ),
        ScriptedResponse::json("200 OK", scripted_text_response("done")),
    ]);
    let mut agent =
        orchestrator_agent(store_path.clone(), "session", Some(server.base_url.clone()));
    store_snapshot_messages(&store_path, &agent.messages);
    // The agent starts with exactly one (system) message, so the prompt lands
    // at absolute idx 1.
    assert_eq!(agent.messages.len(), 1);

    assert_eq!(agent.send("current").await.unwrap(), "done");
    server.finish();

    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 5);
    assert_eq!(log[0].0, 1);
    assert!(matches!(log[0].1, Message::User { ref content } if content == "current"));
    assert_eq!(log[1].0, 2);
    match &log[1].1 {
        Message::Assistant {
            tool_calls: Some(tool_calls),
            ..
        } => assert_eq!(tool_calls.len(), 2),
        other => panic!("expected assistant tool-call message, got {other:?}"),
    }
    assert_eq!(log[2].0, 3);
    assert!(matches!(log[2].1, Message::Tool { ref tool_call_id, .. } if tool_call_id == "call-1"));
    assert_eq!(log[3].0, 4);
    assert!(matches!(log[3].1, Message::Tool { ref tool_call_id, .. } if tool_call_id == "call-2"));
    assert_eq!(log[4].0, 5);
    assert!(
        matches!(log[4].1, Message::Assistant { content: Some(ref text), .. } if text == "done")
    );

    // The log is byte-identical to the in-memory transcript tail.
    assert_eq!(agent.messages.len(), 6);
    for (idx, message) in log {
        assert_eq!(
            canonical(&message),
            canonical(&agent.messages[idx as usize])
        );
    }

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn steering_delivery_is_logged_after_the_ack() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("steering_commit");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let queued = crate::store::queue_thread_steering(
        &store_path,
        "session",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run",
        "steer now",
    )
    .unwrap();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_text_response("steered answer"),
    )]);
    let mut agent =
        orchestrator_agent(store_path.clone(), "session", Some(server.base_url.clone()));
    store_snapshot_messages(&store_path, &agent.messages);

    assert_eq!(agent.send("current").await.unwrap(), "steered answer");
    server.finish();

    // The ack is durable and the staged message is in the transcript...
    let records = crate::store::list_thread_steering(&store_path, "session").unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].status, "delivered");
    assert_eq!(records[0].id, queued.id);
    assert!(agent
        .messages
        .iter()
        .any(|message| matches!(message, Message::User { content } if content == "steer now")));

    // ...and the log carries prompt@1, steering@2, assistant@3 in order.
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 3);
    assert_eq!(log[0].0, 1);
    assert!(matches!(log[0].1, Message::User { ref content } if content == "current"));
    assert_eq!(log[1].0, 2);
    assert!(matches!(log[1].1, Message::User { ref content } if content == "steer now"));
    assert_eq!(log[2].0, 3);
    assert!(
        matches!(log[2].1, Message::Assistant { content: Some(ref text), .. } if text == "steered answer")
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn restore_merges_log_tail_over_the_snapshot_blob() {
    let store_path = test_store_path("merge");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("old prompt"),
        plain_assistant("old answer"),
    ];
    store_snapshot_messages(&store_path, &blob);

    // Crash scenario: the blob is the pre-run snapshot; the log holds the
    // full crashed run appended after it.
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_batch(
            "session",
            3,
            &[
                user_message("crashed prompt"),
                tool_call_assistant(&["call-1"]),
                Message::Tool {
                    tool_call_id: "call-1".to_string(),
                    content: "tool output".to_string(),
                },
                plain_assistant("crashed answer"),
            ],
        )
        .unwrap();
    let mut agent = orchestrator_agent(store_path.clone(), "session", None);

    agent
        .restore_messages_merging_log_tail(blob, None)
        .await
        .unwrap();

    assert_eq!(agent.messages.len(), 7);
    match &agent.messages[0] {
        Message::System { content } => {
            assert!(content.contains("Working directory"));
            assert!(!content.contains("stored system"));
        }
        other => panic!("expected refreshed system prompt, got {other:?}"),
    }
    assert!(
        matches!(agent.messages[3], Message::User { ref content } if content == "crashed prompt")
    );
    assert!(
        matches!(agent.messages[6], Message::Assistant { content: Some(ref text), .. } if text == "crashed answer")
    );
    // A complete tail is not normalized away.
    assert_eq!(read_log(&store_path, "session").len(), 4);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn restore_with_no_log_tail_matches_the_plain_blob_path() {
    let store_path = test_store_path("merge_empty");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    // Historical rows below the blob length are not a tail.
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append("session", 0, &user_message("already snapshotted"))
        .unwrap();

    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("already snapshotted"),
        plain_assistant("answer"),
    ];
    store_snapshot_messages(&store_path, &blob);
    let mut merging = orchestrator_agent(store_path.clone(), "session", None);
    merging
        .restore_messages_merging_log_tail(blob.clone(), None)
        .await
        .unwrap();

    let mut plain = orchestrator_agent(store_path.clone(), "session", None);
    plain.restore_messages(blob);

    assert_eq!(
        serde_json::to_value(&merging.messages).unwrap(),
        serde_json::to_value(&plain.messages).unwrap(),
        "an empty log tail must be exactly the pre-log restore path"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn restore_trims_a_dangling_tool_turn_from_the_transcript_and_log() {
    let store_path = test_store_path("merge_trim");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("old prompt"),
    ];
    store_snapshot_messages(&store_path, &blob);

    // The crashed run logged a dangling assistant tool call and a partial
    // tool result: call-2's result never arrived.
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_batch(
            "session",
            2,
            &[
                tool_call_assistant(&["call-1", "call-2"]),
                Message::Tool {
                    tool_call_id: "call-1".to_string(),
                    content: "partial output".to_string(),
                },
            ],
        )
        .unwrap();
    let mut agent = orchestrator_agent(store_path.clone(), "session", None);

    agent
        .restore_messages_merging_log_tail(blob, None)
        .await
        .unwrap();

    assert_eq!(agent.messages.len(), 2);
    assert!(
        read_log(&store_path, "session").is_empty(),
        "the dangling log tail must be deleted during crash normalization"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn restore_recovers_a_non_contiguous_log_tail() {
    let store_path = test_store_path("merge_gap");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("first prompt"),
        plain_assistant("first answer"),
        user_message("second prompt"),
        plain_assistant("second answer"),
        user_message("third prompt"),
        plain_assistant("third answer"),
    ];
    store_snapshot_messages(&store_path, &blob);
    for (idx, content) in [(8, "orphaned tail"), (9, "later orphan")] {
        crate::store::append_thread_event(
            &store_path,
            "session",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            &crate::store::encode_transcript_log_entry(idx, &user_message(content)).unwrap(),
        )
        .unwrap();
    }

    let mut agent = orchestrator_agent(store_path.clone(), "session", None);
    agent
        .restore_messages_merging_log_tail(blob, None)
        .await
        .unwrap();

    assert_eq!(agent.messages.len(), 7);
    let warning = agent
        .transcript_recovery_warning()
        .expect("gap recovery must produce a warning");
    assert!(warning.contains("index 7"), "{warning}");
    assert!(
        warning.contains("2 untrusted transcript log rows"),
        "{warning}"
    );
    assert!(!warning.contains("orphaned tail"), "{warning}");
    assert!(read_log(&store_path, "session").is_empty());
    let summary = crate::sessions::list_sessions(&store_path)
        .unwrap()
        .remove(0);
    assert_eq!(summary.visible_message_count, 6);
    assert_eq!(summary.last_user_prompt.as_deref(), Some("third prompt"));

    agent
        .push_and_log_for_test(user_message("next prompt"))
        .await
        .unwrap();
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].0, 7);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn gap_recovery_normalizes_a_dangling_turn_in_the_snapshot() {
    let store_path = test_store_path("merge_gap_snapshot_tool_turn");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("first prompt"),
        plain_assistant("first answer"),
        user_message("second prompt"),
        plain_assistant("second answer"),
        user_message("third prompt"),
        tool_call_assistant(&["call-1"]),
    ];
    store_snapshot_messages(&store_path, &blob);
    crate::store::append_thread_event(
        &store_path,
        "session",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        &crate::store::encode_transcript_log_entry(8, &user_message("orphaned tail")).unwrap(),
    )
    .unwrap();

    let mut agent = orchestrator_agent(store_path.clone(), "session", None);
    agent
        .restore_messages_merging_log_tail(blob, None)
        .await
        .unwrap();

    assert_eq!(agent.messages.len(), 6);
    assert!(agent.transcript_recovery_warning().is_some());
    assert!(read_log(&store_path, "session").is_empty());
    let connection = rusqlite::Connection::open(&store_path).unwrap();
    let persisted_json: String = connection
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = 'session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let persisted: Vec<Message> = serde_json::from_str(&persisted_json).unwrap();
    assert_eq!(persisted.len(), 6);
    assert_eq!(
        crate::sessions::list_sessions(&store_path)
            .unwrap()
            .remove(0)
            .last_user_prompt
            .as_deref(),
        Some("third prompt")
    );

    agent
        .push_and_log_for_test(user_message("next prompt"))
        .await
        .unwrap();
    assert_eq!(read_log(&store_path, "session")[0].0, 6);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn cancellation_trims_the_dangling_turn_and_logs_the_marker() {
    let store_path = test_store_path("cancel");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    let mut agent = orchestrator_agent(store_path.clone(), "session", None);
    // Seed a realistic mid-run state in both the vec and the log: a dangling
    // assistant tool call (call-2 has no result).
    let seeded = vec![
        Message::System {
            content: "system".to_string(),
        },
        user_message("prompt"),
        tool_call_assistant(&["call-1", "call-2"]),
        Message::Tool {
            tool_call_id: "call-1".to_string(),
            content: "partial output".to_string(),
        },
    ];
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer.append_batch("session", 0, &seeded).unwrap();
    agent.messages = seeded;

    agent.append_cancellation_marker().await.unwrap();

    assert_eq!(agent.messages.len(), 3);
    assert!(
        matches!(agent.messages[2], Message::Assistant { content: Some(ref text), .. } if text == "[run cancelled by user]")
    );
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 3);
    assert_eq!(log[2].0, 2);
    assert!(
        matches!(log[2].1, Message::Assistant { content: Some(ref text), .. } if text == "[run cancelled by user]"),
        "the cancellation marker must be logged at the trimmed length"
    );

    // No dangling turn: the marker simply appends.
    let mut clean = orchestrator_agent(store_path.clone(), "session", None);
    clean.messages = vec![
        Message::System {
            content: "system".to_string(),
        },
        user_message("prompt"),
        plain_assistant("answer"),
    ];
    clean.append_cancellation_marker().await.unwrap();
    assert_eq!(clean.messages.len(), 4);
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 4);
    assert_eq!(log[3].0, 3);
    assert!(
        matches!(log[3].1, Message::Assistant { content: Some(ref text), .. } if text == "[run cancelled by user]")
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn cancellation_deletes_log_stragglers_from_an_aborted_append() {
    let store_path = test_store_path("cancel_straggler");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    // A run-task abort cannot interrupt a spawn_blocking log append once it
    // starts, so the log can hold a row the vec never saw (abort between the
    // append and the vec push). The cancellation marker would reuse that
    // idx, leaving duplicate-idx rows for the restore merge — unless the
    // cancel path deletes the straggler first.
    let mut agent = orchestrator_agent(store_path.clone(), "session", None);
    agent.messages = vec![
        Message::System {
            content: "system".to_string(),
        },
        user_message("prompt"),
    ];
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_batch(
            "session",
            0,
            &[
                Message::System {
                    content: "system".to_string(),
                },
                user_message("prompt"),
                tool_call_assistant(&["call-1"]),
            ],
        )
        .unwrap();

    agent.append_cancellation_marker().await.unwrap();

    assert_eq!(agent.messages.len(), 3);
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 3);
    assert_eq!(log[2].0, 2);
    assert!(
        matches!(log[2].1, Message::Assistant { content: Some(ref text), .. } if text == "[run cancelled by user]"),
        "the straggler row must be replaced by the cancellation marker, not duplicated"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn normalize_dangling_tail_trims_the_vec_and_log_without_a_marker() {
    let store_path = test_store_path("normalize_failed");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    // The post-failure state the run-failure path normalizes: the assistant
    // tool-call message is in the vec AND the log; its tool results are in
    // neither (the tool-batch log append failed atomically).
    let mut agent = orchestrator_agent(store_path.clone(), "session", None);
    let seeded = vec![
        Message::System {
            content: "system".to_string(),
        },
        user_message("prompt"),
        tool_call_assistant(&["call-1"]),
    ];
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer.append_batch("session", 0, &seeded).unwrap();
    agent.messages = seeded;

    agent.normalize_dangling_tail().await.unwrap();

    assert_eq!(agent.messages.len(), 2);
    let log = read_log(&store_path, "session");
    assert_eq!(
        log.len(),
        2,
        "the dangling log row is deleted and no marker is appended"
    );
    assert!(matches!(log[1].1, Message::User { .. }));

    // A clean transcript is untouched: no trim, and the unconditional tail
    // delete is a no-op when the vec and the log agree.
    let mut clean = orchestrator_agent(store_path.clone(), "session", None);
    clean.messages = vec![
        Message::System {
            content: "system".to_string(),
        },
        user_message("prompt"),
        plain_assistant("answer"),
    ];
    clean.normalize_dangling_tail().await.unwrap();
    assert_eq!(clean.messages.len(), 3);
    assert_eq!(read_log(&store_path, "session").len(), 2);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn steering_log_failure_truncates_the_staged_messages() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("steering_log_failure");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let queued = crate::store::queue_thread_steering(
        &store_path,
        "session",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run",
        "steer now",
    )
    .unwrap();
    // Inject the log failure precisely at the post-ack steering append: the
    // staged message carries the instruction text; the prompt does not.
    let connection = rusqlite::Connection::open(&store_path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_steering_log_append
             BEFORE INSERT ON thread_events
             WHEN NEW.event_json LIKE '%steer now%'
             BEGIN
                 SELECT RAISE(ABORT, 'injected steering log failure');
             END;",
        )
        .unwrap();
    // One scripted response, for the SECOND send only: the first send fails
    // at the steering commit point, before any model call.
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_text_response("after failure"),
    )]);
    let mut agent =
        orchestrator_agent(store_path.clone(), "session", Some(server.base_url.clone()));
    store_snapshot_messages(&store_path, &agent.messages);

    let error = agent.send("current").await.unwrap_err();
    assert!(
        error.to_string().contains("injected steering log failure"),
        "the injected log failure must be the run failure: {error:#}"
    );

    // The staged message is truncated from the vec: the vec and the log
    // agree at the pre-staging checkpoint (log-first invariant restored).
    assert_eq!(agent.messages.len(), 2);
    assert!(matches!(agent.messages[1], Message::User { ref content } if content == "current"));
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].0, 1);
    assert!(matches!(log[0].1, Message::User { ref content } if content == "current"));

    // The ack is durable: the record stays delivered and is never
    // redelivered, even though its message left the transcript.
    let records = crate::store::list_thread_steering(&store_path, "session").unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, queued.id);
    assert_eq!(records[0].status, "delivered");

    // The next run appends contiguously from the checkpoint — no gap.
    connection
        .execute_batch("DROP TRIGGER fail_steering_log_append")
        .unwrap();
    assert_eq!(agent.send("next").await.unwrap(), "after failure");
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert!(
        !agent.messages.iter().any(|message| matches!(
            message,
            Message::User { content } if content == "steer now"
        )),
        "the acked steering is not redelivered"
    );
    let log = read_log(&store_path, "session");
    assert_eq!(log.len(), 3);
    assert_eq!(log[1].0, 2);
    assert!(matches!(log[1].1, Message::User { ref content } if content == "next"));
    assert_eq!(log[2].0, 3);

    // The restore merge reads the log cleanly (the pre-fix gap failed it
    // loudly and bricked re-attach).
    let mut restored = orchestrator_agent(store_path.clone(), "session", None);
    restored
        .restore_messages_merging_log_tail(
            vec![Message::System {
                content: "stored system".to_string(),
            }],
            None,
        )
        .await
        .unwrap();
    assert_eq!(restored.messages.len(), 4);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn send_emits_transcript_appended_at_each_commit_point_live_only() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("live_trigger");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    // Queue steering so the run covers all four commit points: prompt,
    // steering (stage→ack→append), assistant, and the tool-result batch.
    crate::store::queue_thread_steering(
        &store_path,
        "session",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run",
        "steer now",
    )
    .unwrap();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            scripted_tool_call_response(&[("call-1", "unknown_alpha", "{}")]),
        ),
        ScriptedResponse::json("200 OK", scripted_text_response("done")),
    ]);
    let mut agent =
        orchestrator_agent(store_path.clone(), "session", Some(server.base_url.clone()));
    store_snapshot_messages(&store_path, &agent.messages);
    let bus = crate::events::SessionEventBus::with_thread_event_store(
        Some("session".to_string()),
        store_path.clone(),
    );
    let mut events = bus.subscribe();
    agent.set_event_sink(EventSink::bus(bus));

    assert_eq!(agent.send("current").await.unwrap(), "done");
    server.finish();

    let mut appended_lens = Vec::new();
    while let Ok(envelope) = events.try_recv() {
        if let crate::events::SessionEvent::TranscriptAppended { transcript_len } = envelope.event {
            appended_lens.push(transcript_len);
        }
    }
    assert_eq!(
        appended_lens,
        vec![2, 3, 4, 5, 6],
        "one live signal per commit point: prompt@1, steering@2, assistant@3, tool batch@4, assistant@5"
    );

    // Live-only: the bus persists nothing for these events — thread_events
    // holds exactly the five transcript log rows and no event rows.
    assert_eq!(read_log(&store_path, "session").len(), 5);
    assert!(
        crate::store::load_all_thread_events(&store_path, "session", 100)
            .unwrap()
            .is_empty()
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn successful_turn_stamps_assistant_origin_on_transcript_and_log() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("origin_stamp");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [
                {"type": "reasoning", "id": "rs_1",
                 "summary": [{"type": "summary_text", "text": "orchestrator thinking"}]},
                {"type": "message", "content": [{"type": "output_text", "text": "stamped answer"}]}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )]);
    let mut agent =
        orchestrator_agent(store_path.clone(), "session", Some(server.base_url.clone()));
    store_snapshot_messages(&store_path, &agent.messages);

    assert_eq!(agent.send("current").await.unwrap(), "stamped answer");
    server.finish();

    let Message::Assistant {
        model_origin,
        reasoning_field,
        reasoning_text,
        ..
    } = agent.messages.last().expect("assistant message pushed")
    else {
        panic!("last message should be the assistant turn");
    };
    assert_eq!(
        model_origin
            .as_ref()
            .map(|origin| (origin.backend, origin.model.as_str())),
        Some((crate::model::BackendKind::OpenAiResponses, "gpt-5.5")),
        "the push site stamps the client identity"
    );
    assert_eq!(reasoning_text.as_deref(), Some("orchestrator thinking"));
    assert_eq!(
        reasoning_field, &None,
        "responses-api reasoning is details-based; no completions field stamp"
    );

    let log = read_log(&store_path, "session");
    let Message::Assistant {
        model_origin: logged_origin,
        ..
    } = &log.last().expect("assistant row logged").1
    else {
        panic!("last log row should be the assistant turn");
    };
    assert_eq!(
        logged_origin, model_origin,
        "the durable row carries the stamp"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn errored_turns_never_enter_the_transcript() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("errored_turn");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    // HTTP 400 is non-retryable: the turn fails immediately, before the
    // assistant push. This pins the S5 precondition that reasoning
    // normalization never has to skip errored assistant messages — they
    // do not exist.
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "400 Bad Request",
        serde_json::json!({"error": {"message": "bad request"}}).to_string(),
    )]);
    let mut agent =
        orchestrator_agent(store_path.clone(), "session", Some(server.base_url.clone()));
    store_snapshot_messages(&store_path, &agent.messages);

    let error = agent
        .send("current")
        .await
        .expect_err("a 400 fails the turn")
        .to_string();
    server.finish();
    assert!(error.contains("HTTP 400"), "{error}");

    assert!(
        !agent
            .messages
            .iter()
            .any(|message| matches!(message, Message::Assistant { .. })),
        "no assistant message in the in-memory transcript: {:?}",
        agent.messages
    );
    let log = read_log(&store_path, "session");
    assert!(
        !log.iter()
            .any(|(_, message)| matches!(message, Message::Assistant { .. })),
        "no assistant row in the durable log: {log:?}"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
