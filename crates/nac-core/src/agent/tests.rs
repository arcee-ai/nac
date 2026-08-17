use super::*;

#[test]
fn test_agent_creation() {
    let client = ModelClient::new_for_test();
    let agent = Agent::default(client);
    assert!(!agent.messages.is_empty());
    assert!(!agent.tool_defs.is_empty());
}

#[test]
fn worker_prompt_prefers_native_workspace_discovery() {
    let prompt = render_worker_system_prompt("/workspace");
    assert!(prompt.contains("Use glob to find workspace paths"));
    assert!(prompt.contains("Use grep to search file contents"));
    assert!(prompt.contains("instead of find, fd"));
    assert!(prompt.contains("instead of grep, rg"));
}

#[test]
fn restore_messages_refreshes_leading_system_prompt() {
    let client = ModelClient::new_for_test();
    let mut agent = Agent::with_config(
        client,
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Orchestrator,
            store_path: crate::store::default_store_path(),
            session_id: None,
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: PathBuf::from("/resolved/workspace"),
            config_cwd: PathBuf::from("/resolved/workspace"),
            working_directory: "/resolved/workspace".to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
        },
    )
    .expect("agent config must be valid");

    agent.restore_messages(vec![
        Message::System {
            content: "You are nac. Working directory: /old/stale/path.".to_string(),
        },
        Message::User {
            content: "hello".to_string(),
        },
    ]);

    assert_eq!(agent.messages.len(), 2);
    match &agent.messages[0] {
        Message::System { content } => {
            assert!(content.contains("Working directory: /resolved/workspace"));
            assert!(!content.contains("/old/stale/path"));
        }
        other => panic!("expected refreshed system prompt, got {:?}", other),
    }
    match &agent.messages[1] {
        Message::User { content } => assert_eq!(content, "hello"),
        other => panic!("expected restored user message, got {:?}", other),
    }
}

#[test]
fn exec_command_result_preview_uses_structured_previews() {
    let result = ToolResult {
        content: (serde_json::json!({
            "status": "completed",
            "stdout_preview": "line one\nline two\n",
            "stderr_preview": "",
            "exit_code": 0,
            "wall_time_ms": 1,
            "truncated": false,
        })
        .to_string())
        .into(),
        is_error: false,
    };

    assert_eq!(preview_tool_result("exec_command", &result), "line two...");
}

#[test]
fn exec_command_result_preview_includes_nonzero_exit() {
    let result = ToolResult {
        content: (serde_json::json!({
            "status": "completed",
            "stdout_preview": "",
            "stderr_preview": "failure\n",
            "exit_code": 7,
            "wall_time_ms": 1,
            "truncated": false,
        })
        .to_string())
        .into(),
        is_error: false,
    };

    assert_eq!(
        preview_tool_result("exec_command", &result),
        "exit 7: failure"
    );
}

#[test]
fn exec_command_finished_event_carries_structured_outcome() {
    let result = ToolResult {
        content: (serde_json::json!({
            "status": "completed",
            "stdout_preview": "",
            "stderr_preview": "failure",
            "exit_code": 7,
        })
        .to_string())
        .into(),
        is_error: false,
    };
    let event = AgentEvent::tool_call_finished(
        Some("worker".to_string()),
        "call-1".to_string(),
        "exec_command".to_string(),
        &result,
    );
    assert!(matches!(
        event,
        AgentEvent::ToolCallFinished {
            command_status: Some(crate::terminal::CommandStatus::Completed),
            exit_code: Some(7),
            is_error: false,
            ..
        }
    ));
}

#[test]
fn finished_pty_result_preview_keeps_terminal_output() {
    let result = ToolResult {
        content: (serde_json::json!({
            "session_name": null,
            "output_id": "termout-1",
            "start_cursor": 0,
            "end_cursor": 14,
            "content_preview": "line one\nline two\n",
            "truncated": false,
            "overflowed": false,
            "exit_code": 0,
            "wall_time_ms": 1,
        })
        .to_string())
        .into(),
        is_error: false,
    };

    assert_eq!(preview_tool_result("exec_command", &result), "line two");
}

#[test]
fn exec_command_finished_events_distinguish_terminal_statuses() {
    for (serialized, expected) in [
        ("completed", crate::terminal::CommandStatus::Completed),
        ("timed_out", crate::terminal::CommandStatus::TimedOut),
        ("cancelled", crate::terminal::CommandStatus::Cancelled),
        ("spawn_error", crate::terminal::CommandStatus::SpawnError),
    ] {
        let result = ToolResult {
            content: (serde_json::json!({
                "status": serialized,
                "stdout_preview": "",
                "stderr_preview": "",
                "exit_code": null,
            })
            .to_string())
            .into(),
            is_error: serialized == "spawn_error",
        };
        let event = AgentEvent::tool_call_finished(
            Some("worker".to_string()),
            format!("call-{serialized}"),
            "exec_command".to_string(),
            &result,
        );
        assert!(matches!(
            event,
            AgentEvent::ToolCallFinished {
                command_status: Some(status),
                exit_code: None,
                ..
            } if status == expected
        ));
    }
}

#[test]
fn worker_cannot_self_activate_skills_and_orchestrator_can_schedule_them() {
    let client = ModelClient::new_for_test();
    let registry = Arc::new(crate::skills::SkillRegistry::load_for_test(vec![
        crate::skills::SkillRecord {
            name: "lint".to_string(),
            description: "Run linting workflows.".to_string(),
            compatibility: None,
            skill_root_visible: PathBuf::from("/tmp/lint"),
            body: "lint body".to_string(),
            resources: Vec::new(),
        },
    ]));
    let build_agent = |mode, skills| {
        Agent::with_config(
            client.clone(),
            AgentConfig {
                command_output_limits: crate::terminal::CommandOutputLimits::default(),
                mode,
                store_path: crate::store::default_store_path(),
                session_id: None,
                orchestrator_compaction_threshold: None,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("."),
                config_cwd: PathBuf::from("."),
                working_directory: ".".to_string(),
                worker_executable: None,
                sandbox: None,
                ssh: None,
                mcp: None,
                skills,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
                light_client: None,
            },
        )
        .expect("agent config must be valid")
    };

    let worker = build_agent(AgentMode::Worker, Some(registry.clone()));
    assert!(!worker
        .tool_defs
        .iter()
        .any(|definition| definition.function.name == "activate_skill"));
    assert!(!worker.messages.iter().any(|message| match message {
        Message::System { content } => content.contains("<available_skills>"),
        _ => false,
    }));

    let orchestrator = build_agent(AgentMode::Orchestrator, Some(registry));
    assert!(!orchestrator
        .tool_defs
        .iter()
        .any(|definition| definition.function.name == "activate_skill"));
    let thread_tool = orchestrator
        .tool_defs
        .iter()
        .find(|definition| definition.function.name == "thread")
        .unwrap();
    let skills = &thread_tool.function.parameters["properties"]["skills"];
    assert_eq!(skills["items"]["enum"], serde_json::json!(["lint"]));
    assert!(skills["description"]
        .as_str()
        .unwrap()
        .contains("workers cannot activate skills themselves"));
}

#[test]
fn tool_args_detail_is_larger_than_preview_but_bounded() {
    let args = "x".repeat(TOOL_ARGS_DETAIL_LIMIT + 10);
    let detail = tool_args_detail(&args);

    assert!(detail.starts_with(&"x".repeat(TOOL_ARGS_DETAIL_LIMIT)));
    assert!(detail.ends_with("..."));
    assert_eq!(detail.len(), TOOL_ARGS_DETAIL_LIMIT + 3);
}

#[test]
fn preview_truncates_on_utf8_boundary() {
    assert_eq!(preview("a┌b", 2), "a...");
    assert_eq!(preview("a┌b", 4), "a┌...");
}

#[test]
fn preview_handles_box_table_prompt() {
    let prompt = "hey can you see why markdown rendering is bugged in this way?\n\
Here's the quick summary of what was discovered:\n\n\
┌──────────────────┬─────────────────────────────┬─────────────────────────┐\n\
│ Property         │ Mistral (Tekken)            │ Llama 3                 │\n\
├──────────────────┼─────────────────────────────┼─────────────────────────┤\n\
│ Vocab size       │ 131,072                     │ 128,000                 │\n\
│ Tokenizer engine │ Tekken (custom,             │ BPE (tiktoken/GPT-4     │\n\
│                  │ tiktoken-based)             │ style)                  │\n\
└──────────────────┴─────────────────────────────┴─────────────────────────┘\n\
| Special tokens | <unk>, <s>, </s>, <pad> (IDs 0-999) | <|begin_of_text|>, <|end_of_text|> (IDs 128000+) |\n\
| Byte fallback | Yes (first 256 tokens = raw bytes) | No |\n\
| Pre-tokenizer | Unicode multi-script, case-sensitive | GPT-4 style with English contractions |\n\
| Merges | 269,443 | 280,147 |\n";

    let rendered = preview(prompt, 160);

    assert!(rendered.ends_with("..."));
    assert!(rendered.len() <= 163);
}

#[tokio::test]
async fn multi_row_steering_ack_failure_rolls_back_messages_and_retries_once() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_agent_steering_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = Agent::with_config(
        ModelClient::new_for_test(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Worker,
            store_path: store_path.clone(),
            session_id: Some("session".to_string()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: Some("impl/ui".to_string()),
            dispatch_id: Some("worker-dispatch".to_string()),
            event_sink: EventSink::channel(events_tx),
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
            light_client: None,
        },
    )
    .unwrap();
    let message_checkpoint = agent.messages.len();
    let first = crate::store::queue_thread_steering(
        &store_path,
        "session",
        "impl/ui",
        "worker-dispatch",
        "Keep the picker keyboard accessible.",
    )
    .unwrap();
    let second = crate::store::queue_thread_steering(
        &store_path,
        "session",
        "impl/ui",
        "worker-dispatch",
        "Preserve visible focus states.",
    )
    .unwrap();
    let connection = rusqlite::Connection::open(&store_path).unwrap();
    connection
        .execute_batch(&format!(
            "CREATE TRIGGER fail_second_steering_ack
             BEFORE UPDATE OF status ON thread_steering
             WHEN OLD.id = {} AND NEW.status = 'delivered'
             BEGIN
                 SELECT RAISE(FAIL, 'forced batch acknowledgement failure');
             END;",
            second.id
        ))
        .unwrap();

    assert!(agent.append_pending_steering().await.is_err());
    assert_eq!(agent.messages.len(), message_checkpoint);
    assert!(agent.appended_steering_ids.is_empty());
    assert!(events_rx.try_recv().is_err());
    let claimed = crate::store::list_thread_steering(&store_path, "session").unwrap();
    assert_eq!(claimed.len(), 2);
    assert!(claimed.iter().all(|record| record.status == "claimed"));

    connection
        .execute_batch("DROP TRIGGER fail_second_steering_ack")
        .unwrap();
    assert_eq!(agent.append_pending_steering().await.unwrap(), 2);
    assert_eq!(agent.append_pending_steering().await.unwrap(), 0);
    let appended = agent.messages[message_checkpoint..]
        .iter()
        .filter_map(|message| match message {
            Message::User { content } => Some(content.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(appended.len(), 2);
    assert_eq!(
        appended
            .iter()
            .filter(|content| content.contains("Keep the picker keyboard accessible."))
            .count(),
        1
    );
    assert_eq!(
        appended
            .iter()
            .filter(|content| content.contains("Preserve visible focus states."))
            .count(),
        1
    );
    assert!(crate::store::list_thread_steering(&store_path, "session")
        .unwrap()
        .iter()
        .all(|record| record.status == "delivered"));
    let delivered_ids =
        [events_rx.try_recv().unwrap(), events_rx.try_recv().unwrap()].map(|event| match event {
            AgentEvent::ThreadSteeringDelivered { steering_id, .. } => steering_id,
            event => panic!("expected delivered event, got {event:?}"),
        });
    assert_eq!(delivered_ids, [first.id, second.id]);
    assert!(events_rx.try_recv().is_err());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn orchestrator_claims_steering_as_an_exact_user_message() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let store_path = std::env::temp_dir()
        .join(format!("nac_orchestrator_steering_{unique}"))
        .join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = Agent::with_config(
        ModelClient::new_for_test(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Orchestrator,
            store_path: store_path.clone(),
            session_id: Some("session".to_string()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: Some("run-dispatch".to_string()),
            event_sink: EventSink::channel(events_tx),
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
            light_client: None,
        },
    )
    .unwrap();
    crate::store::open_runtime_connection(&store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET messages_json = ?1 WHERE session_id = 'session'",
            rusqlite::params![serde_json::to_string(&agent.messages).unwrap()],
        )
        .unwrap();
    let instruction = "Drop the fun facts and recommend a niche OSS repository.";
    let queued = crate::store::queue_thread_steering(
        &store_path,
        "session",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run-dispatch",
        instruction,
    )
    .unwrap();

    assert_eq!(agent.append_pending_steering().await.unwrap(), 1);
    assert_eq!(agent.append_pending_steering().await.unwrap(), 0);
    assert!(matches!(
        agent.messages.last(),
        Some(Message::User { content }) if content == instruction
    ));
    assert!(matches!(
        events_rx.try_recv().unwrap(),
        AgentEvent::OrchestratorSteeringDelivered { steering_id, .. }
            if steering_id == queued.id
    ));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn image_limit_error_is_the_only_finished_event_for_the_result() {
    use crate::tool_content::{ToolContent, ToolContentPart, ToolImage, MAX_TRANSCRIPT_IMAGES};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(1, 1, Rgba([1, 2, 3, 255])));
    let mut encoded = Cursor::new(Vec::new());
    source.write_to(&mut encoded, ImageFormat::Png).unwrap();
    let image = ToolImage::validate(encoded.into_inner(), None, None).unwrap();
    let image_content = ToolContent::from_parts(vec![ToolContentPart::Image(image)]).unwrap();
    let messages = (0..MAX_TRANSCRIPT_IMAGES)
        .map(|index| Message::Tool {
            tool_call_id: format!("prior-{index}"),
            content: image_content.clone(),
        })
        .collect::<Vec<_>>();
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();

    let finalized = finalize_tool_results(
        &messages,
        vec![(
            "call-image".to_string(),
            "read".to_string(),
            ToolResult {
                content: image_content,
                is_error: false,
            },
        )],
        &EventSink::channel(events_tx),
        &None,
    );

    assert!(
        matches!(&finalized[0], Message::Tool { content, .. } if content.contains("image_limit_exceeded"))
    );
    assert!(matches!(
        events_rx.try_recv().unwrap(),
        AgentEvent::ToolCallFinished {
            call_id,
            is_error: true,
            ..
        } if call_id == "call-image"
    ));
    assert!(events_rx.try_recv().is_err());
}

#[tokio::test]
async fn cancelled_image_result_still_emits_finished_event() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    let root = std::env::temp_dir().join(format!(
        "nac_cancelled_image_finish_{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(1, 1, Rgba([1, 2, 3, 255])));
    let mut encoded = Cursor::new(Vec::new());
    source.write_to(&mut encoded, ImageFormat::Png).unwrap();
    std::fs::write(root.join("fixture.png"), encoded.into_inner()).unwrap();

    let response = serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "function_call",
            "call_id": "call-image",
            "name": "read",
            "arguments": "{\"path\":\"fixture.png\"}"
        }],
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
    })
    .to_string();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response)]);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut agent = Agent::with_config(
        ModelClient::new_for_test_server(server.base_url.clone()),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Worker,
            store_path: root.join("store.db"),
            session_id: None,
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: Some("worker".to_string()),
            dispatch_id: None,
            event_sink: EventSink::channel(events_tx),
            workspace_cwd: root.clone(),
            config_cwd: root.clone(),
            working_directory: root.display().to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
        },
    )
    .unwrap();
    agent.command_cancellation().cancel();

    let error = agent.send("read the fixture").await.unwrap_err();
    assert!(error.to_string().contains("worker command cancelled"));
    let finished = std::iter::from_fn(|| events_rx.try_recv().ok())
        .filter_map(|event| match event {
            AgentEvent::ToolCallFinished {
                call_id,
                content_preview,
                ..
            } => Some((call_id, content_preview)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].0, "call-image");
    assert!(finished[0].1.contains("[image: image/png,"));

    let _ = std::fs::remove_dir_all(root);
}
