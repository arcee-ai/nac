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
            ssh_host: None,
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
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("old prompt"),
        plain_assistant("old answer"),
    ];
    agent.restore_messages_merging_log_tail(blob).await.unwrap();

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
    let mut merging = orchestrator_agent(store_path.clone(), "session", None);
    merging
        .restore_messages_merging_log_tail(blob.clone())
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
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("old prompt"),
    ];
    agent.restore_messages_merging_log_tail(blob).await.unwrap();

    assert_eq!(agent.messages.len(), 2);
    assert!(
        read_log(&store_path, "session").is_empty(),
        "the dangling log tail must be deleted during crash normalization"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn restore_fails_loudly_on_a_non_contiguous_log_tail() {
    let store_path = test_store_path("merge_gap");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");

    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append("session", 5, &user_message("orphaned tail"))
        .unwrap();

    let mut agent = orchestrator_agent(store_path.clone(), "session", None);
    let blob = vec![
        Message::System {
            content: "stored system".to_string(),
        },
        user_message("old prompt"),
    ];
    let error = agent
        .restore_messages_merging_log_tail(blob)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("not contiguous"));

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
