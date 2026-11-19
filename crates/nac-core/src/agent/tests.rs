use super::*;

#[tokio::test]
async fn direct_run_emits_balanced_runtime_activity() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use crate::telemetry::{self, RuntimeActivity, TelemetryName};

    // Activity counters cover the whole process, including runs with no test
    // recorder. Isolate this assertion from other parallel agent tests.
    const CHILD_ENV: &str = "NAC_DIRECT_ACTIVITY_TEST_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "agent::tests::direct_run_emits_balanced_runtime_activity",
                "--exact",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        return;
    }
    let _lock = telemetry::test_recorder_lock();
    let exporter = std::sync::Arc::new(telemetry::InMemoryExporter::default());
    let recorder = telemetry::TelemetryRecorder::bounded(
        exporter.clone(),
        telemetry::RuntimeMetadata::sqlite(
            "test",
            "test",
            crate::store::schema_version(),
            None,
            None,
        ),
        1024,
    );
    let _guard = telemetry::install_test_recorder(recorder.clone());
    let root = std::env::temp_dir().join(format!("nac_direct_activity_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let response = serde_json::json!({
        "status": "completed",
        "output": [{"type": "message", "role": "assistant", "content": [
            {"type": "output_text", "text": "done"}
        ]}]
    })
    .to_string();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response)]);
    let mut agent = test_agent(&root, &server.base_url);
    assert_eq!(
        agent.send("exercise direct activity").await.unwrap(),
        "done"
    );
    assert_eq!(server.finish().len(), 1);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while recorder.stats().exported < recorder.stats().accepted {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let values: Vec<_> = exporter
        .events()
        .into_iter()
        .filter(|event| {
            event.name == TelemetryName::RuntimeActivityActive
                && event.activity == Some(RuntimeActivity::Direct)
        })
        .filter_map(|event| event.value)
        .collect();
    assert_eq!(values, vec![1, 0]);
    std::fs::remove_dir_all(root).unwrap();
}

fn test_agent(root: &std::path::Path, base_url: &str) -> Agent {
    Agent::with_config(
        ModelClient::new_for_test_server(base_url.to_string()),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
            store_path: root.join("store.db"),
            session_id: None,
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: root.to_path_buf(),
            config_cwd: root.to_path_buf(),
            working_directory: root.display().to_string(),
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            permission_rules: Vec::new(),
        },
    )
    .unwrap()
}

#[test]
fn test_agent_creation() {
    let client = ModelClient::new_for_test();
    let agent = Agent::default(client);
    assert!(!agent.messages.is_empty());
    assert!(!agent.tool_defs.is_empty());
}

#[test]
fn direct_prompt_treats_permission_denial_as_no_execution() {
    let prompt = render_direct_system_prompt("/workspace")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    assert!(prompt.contains("permission-denied tool result means the"));
    assert!(prompt.contains("operation did not execute"));
    assert!(prompt.contains("do not evade the policy through a different tool"));
    assert!(prompt.contains("headless run fails closed"));
}

#[test]
fn direct_prompt_keeps_model_goal_authority_narrow() {
    let prompt = render_direct_system_prompt("/workspace")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    assert!(prompt.contains("create_goal only when the user explicitly asks"));
    assert!(prompt.contains("complete only when the objective is genuinely achieved"));
    assert!(prompt.contains("Use blocked only at a genuine impasse"));
    assert!(prompt.contains("cannot pause, resume, clear"));
    assert!(prompt.contains("Explicit user cancellation pauses it"));
}

#[test]
fn direct_topologies_expose_exact_capability_boundaries() {
    let root =
        std::env::temp_dir().join(format!("nac_child_tool_boundary_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("store.db");
    for session_id in ["parent", "child"] {
        let mut snapshot = crate::sessions::new_snapshot(
            session_id.to_string(),
            root.clone(),
            "test-model".to_string(),
            "https://api.openai.com/v1".to_string(),
            crate::model::BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            std::collections::BTreeMap::new(),
        );
        snapshot.behavior = crate::sessions::SessionBehavior::Direct;
        crate::sessions::create_session(&store_path, &snapshot).unwrap();
    }
    crate::store::create_traditional_child_relationship(
        &store_path,
        "parent",
        "child",
        crate::store::GENERAL_CHILD_PROFILE,
        "review the implementation",
    )
    .unwrap();

    let build = |session_id: &str, ssh: Option<SshConnection>| {
        Agent::with_config(
            ModelClient::new_for_test(),
            AgentConfig {
                command_output_limits: crate::terminal::CommandOutputLimits::default(),
                mode: AgentMode::Direct,
                store_path: store_path.clone(),
                session_id: Some(session_id.to_string()),
                orchestrator_compaction_threshold: None,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: root.clone(),
                config_cwd: root.clone(),
                working_directory: root.display().to_string(),
                sandbox: None,
                ssh,
                mcp: None,
                skills: Some(Arc::new(crate::skills::SkillRegistry::bundled_for_test())),
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
                permission_rules: Vec::new(),
            },
        )
        .unwrap()
    };

    let mut parent = build("parent", None);
    let mut child = build("child", None);
    let mut remote = build(
        "parent",
        Some(SshConnection {
            host: "fixture.invalid".into(),
            port: None,
            identity_file: None,
        }),
    );
    let names = |agent: &Agent| {
        agent
            .tool_definitions_for_test()
            .iter()
            .map(|definition| definition.function.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        names(&parent),
        crate::tools::DIRECT_TOOL_NAMES.map(str::to_string)
    );
    let child_names: Vec<_> = crate::tools::CODING_TOOL_NAMES
        .into_iter()
        .chain(["nac_guide"])
        .map(str::to_string)
        .collect();
    assert_eq!(names(&child), child_names);
    let crate::commands::PreparedUserInput::SubmitPrompt(help) =
        crate::commands::prepare_user_input(
            "$nac-help How do I add MCP?",
            child.skills().as_deref(),
        )
    else {
        panic!("child help prompt did not expand")
    };
    assert!(help.agent_prompt.contains("first-party bundled NAC Guide"));
    assert!(help.agent_prompt.contains("nac_guide"));
    for _ in 0..2 {
        assert_eq!(
            child
                .refresh_model_request_capabilities()
                .unwrap()
                .iter()
                .map(|definition| definition.function.name.clone())
                .collect::<Vec<_>>(),
            child_names
        );
    }
    let capability_names = |definitions: Vec<ToolDefinition>| {
        definitions
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        capability_names(parent.model_request_capabilities_for_test(None)),
        crate::tools::DIRECT_TOOL_NAMES
    );
    let parent_web =
        capability_names(parent.model_request_capabilities_for_test(Some("direct-exa-canary")));
    assert_eq!(
        &parent_web[..crate::tools::DIRECT_TOOL_NAMES.len()],
        crate::tools::DIRECT_TOOL_NAMES
    );
    assert_eq!(
        &parent_web[crate::tools::DIRECT_TOOL_NAMES.len()..],
        crate::tools::WEB_TOOL_NAMES
    );
    let remote_names = capability_names(remote.model_request_capabilities_for_test(None));
    for name in crate::tools::TASK_FOLLOWUP_TOOL_NAMES {
        assert!(!remote_names.iter().any(|candidate| candidate == name));
    }
    let child_web =
        capability_names(child.model_request_capabilities_for_test(Some("child-exa-canary")));
    assert_eq!(&child_web[..child_names.len()], child_names);
    assert_eq!(
        &child_web[child_names.len()..],
        crate::tools::WEB_TOOL_NAMES
    );
    assert!(matches!(
        child.messages.first(),
        Some(Message::System { content })
            if content.contains("traditional child coding agent")
                && content.contains("review the implementation")
                && !content.contains("NAC product self-help")
    ));
    struct ProductPort;
    impl crate::product_context::ProductContextPort for ProductPort {
        fn read(
            &self,
        ) -> crate::product_context::ProductContextFuture<'_, crate::product_context::ProductContext>
        {
            Box::pin(async { Err(anyhow!("test-only unavailable context")) })
        }
        fn resolve(
            &self,
            _: crate::product_context::ProductDestination,
            _: String,
        ) -> crate::product_context::ProductContextFuture<
            '_,
            crate::product_context::ProductNavigationResolution,
        > {
            Box::pin(async { Err(anyhow!("test-only unavailable destination")) })
        }
    }
    child.bind_product_context(Arc::new(ProductPort)).unwrap();
    assert!(child.tool_runtime.product_context.is_none());
    assert!(!names(&child)
        .iter()
        .any(|name| crate::tools::PRODUCT_CONTEXT_TOOL_NAMES.contains(&name.as_str())));
    parent.bind_product_context(Arc::new(ProductPort)).unwrap();
    let refreshed = capability_names(parent.model_request_capabilities_for_test(None));
    assert!(crate::tools::PRODUCT_CONTEXT_TOOL_NAMES
        .iter()
        .all(|name| refreshed.iter().any(|found| found == name)));
    let before = names(&parent);
    assert!(parent.bind_product_context(Arc::new(ProductPort)).is_err());
    assert_eq!(names(&parent), before);

    drop(parent);
    drop(child);
    drop(remote);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn restore_messages_refreshes_leading_system_prompt() {
    let client = ModelClient::new_for_test();
    let mut agent = Agent::with_config(
        client,
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
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
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            permission_rules: Vec::new(),
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
        execution_duration_ms: None,
        execution_duration_excludes_authorization: false,
        delegation_outcome: None,
        delegation_summary: None,
    };

    assert_eq!(preview_tool_result("exec_command", &result), "line two...");
}

#[test]
fn key_argument_preview_is_family_aware_and_fail_closed() {
    for (name, args, expected) in [
        ("read", r#"{"path":"src/lib.rs"}"#, "src/lib.rs"),
        ("glob", r#"{"pattern":"**/*.rs"}"#, "**/*.rs"),
        ("grep", r#"{"pattern":"AgentEvent"}"#, "AgentEvent"),
        ("web_search", r#"{"query":"NAC docs"}"#, "NAC docs"),
        (
            "orchestrator_launch",
            r#"{"description":"Audit storage","prompt":"SECRET_PROMPT"}"#,
            "Audit storage",
        ),
        (
            "subagent",
            r#"{"description":"Review tests","prompt":"SECRET_PROMPT"}"#,
            "Review tests",
        ),
        (
            "mcp__linear__linear_read_issue",
            r#"{"name":"ALL-1","authorization":"SECRET_HEADER"}"#,
            "ALL-1",
        ),
    ] {
        assert_eq!(key_arg_preview(name, Some(args), args), expected);
    }

    // A continuation's child ID is an identity, not its task description.
    let continuation =
        r#"{"description":null,"child_session_id":"child-opaque-id","prompt":"SECRET"}"#;
    assert_eq!(
        key_arg_preview("subagent", Some(continuation), continuation),
        ""
    );
    let empty_description = r#"{"description":"","child_session_id":"child-opaque-id"}"#;
    assert_eq!(
        key_arg_preview("subagent", Some(empty_description), empty_description),
        ""
    );

    assert_eq!(
        key_arg_preview(
            "write_stdin",
            Some(r#"{"session_id":"term-1","chars":"SECRET_STDIN"}"#),
            "ignored"
        ),
        "→ term-1 (12 input chars)"
    );
    assert_eq!(
        key_arg_preview(
            "unknown_tool",
            Some(r#"{"password":"SECRET_VALUE"}"#),
            "SECRET_RAW_PREVIEW"
        ),
        ""
    );
    assert_eq!(
        key_arg_preview("read", Some("malformed SECRET_VALUE"), "SECRET_RAW_PREVIEW"),
        ""
    );
}

#[test]
fn file_path_preview_keeps_the_end_of_long_paths() {
    let preview_of = |name: &str, key: &str, value: &str| {
        let args = serde_json::json!({ key: value }).to_string();
        key_arg_preview(name, Some(&args), &args)
    };

    let long = format!(
        "{}crates/nac-core/src/agent/preview.rs",
        "workspace/".repeat(15)
    );
    let preview = preview_of("read", "path", &long);
    assert_eq!(preview.chars().count(), 120, "{preview}");
    assert!(preview.starts_with('…'), "{preview}");
    assert!(preview.ends_with("/agent/preview.rs"), "{preview}");

    let multibyte = format!("{}/notes.md", "é".repeat(200));
    let preview = preview_of("read", "path", &multibyte);
    assert_eq!(preview.chars().count(), 120, "{preview}");
    assert!(preview.ends_with("é/notes.md"), "{preview}");

    let exact = format!("{}.rs", "a".repeat(117));
    assert_eq!(exact.chars().count(), 120);
    assert_eq!(preview_of("read", "path", &exact), exact);

    let pattern = format!("needle{}", "x".repeat(200));
    assert_eq!(
        preview_of("grep", "pattern", &pattern),
        format!("needle{}…", "x".repeat(114))
    );
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
        execution_duration_ms: None,
        execution_duration_excludes_authorization: false,
        delegation_outcome: None,
        delegation_summary: None,
    };

    assert_eq!(
        preview_tool_result("exec_command", &result),
        "exit 7: failure"
    );
}

#[test]
fn exec_command_timeout_preview_reports_deadline_and_honest_termination() {
    for (termination, expected) in [
        (Some("terminated"), "1000 ms deadline exceeded; terminated"),
        (
            Some("cleanup_pending"),
            "1000 ms deadline exceeded; cleanup pending",
        ),
        (None, "1000 ms deadline exceeded"),
    ] {
        let result = ToolResult::text(
            serde_json::json!({
                "status":"timed_out", "timeout_ms":1000,
                "termination_status":termination, "stdout_preview":"", "stderr_preview":""
            })
            .to_string(),
            false,
        );
        let preview = preview_tool_result("exec_command", &result);
        assert_eq!(preview, expected);
        assert!(!format!("Timed out: {preview}").contains("Timed out: timed out"));
    }
    let result = ToolResult::text(
        serde_json::json!({
            "status":"timed_out", "timeout_ms":1000, "termination_status":"cleanup_pending",
            "stdout_preview":"", "stderr_preview":"remote command cleanup incomplete"
        })
        .to_string(),
        false,
    );
    assert_eq!(
        preview_tool_result("exec_command", &result),
        "1000 ms deadline exceeded; cleanup pending: remote command cleanup incomplete"
    );
    let legacy = ToolResult::text(serde_json::json!({"status":"timed_out"}).to_string(), false);
    assert_eq!(
        preview_tool_result("exec_command", &legacy),
        "command deadline exceeded"
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
        execution_duration_ms: None,
        execution_duration_excludes_authorization: false,
        delegation_outcome: None,
        delegation_summary: None,
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
            completion_status: Some(crate::events::ToolCompletionStatus::Error),
            is_error: false,
            ..
        }
    ));
}

#[test]
fn generic_deadline_finished_event_carries_typed_timing_metadata() {
    let result = ToolResult::text(
        serde_json::json!({
            "error":"Tool 'read' timed_out after 12 ms",
            "_nac": {
                "status":"timed_out",
                "timeout_ms":10,
                "execution_duration_ms":12,
                "cleanup_duration_ms":2,
                "remote_outcome_uncertain":true
            }
        })
        .to_string(),
        true,
    );
    let event = AgentEvent::tool_call_finished(
        None,
        "call-deadline".to_string(),
        "read".to_string(),
        &result,
    );
    assert!(matches!(
        event,
        AgentEvent::ToolCallFinished {
            completion_status: Some(crate::events::ToolCompletionStatus::TimedOut),
            effective_timeout_ms: Some(10),
            execution_duration_ms: Some(12),
            cleanup_duration_ms: Some(2),
            remote_outcome_uncertain: true,
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
        execution_duration_ms: None,
        execution_duration_excludes_authorization: false,
        delegation_outcome: None,
        delegation_summary: None,
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
            execution_duration_ms: None,
            execution_duration_excludes_authorization: false,
            delegation_outcome: None,
            delegation_summary: None,
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
async fn direct_inbox_batch_ack_failure_rolls_back_and_retries_once() {
    let root = std::env::temp_dir().join(format!("nac_direct_steering_{}", uuid::Uuid::new_v4()));
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let mut agent = super::transcript_log_tests::transcript_test_agent(
        ModelClient::new_for_test(),
        store_path.clone(),
        Some("session"),
    );
    agent.set_current_run_id(Some("run".to_string()));
    super::transcript_log_tests::store_snapshot_messages(&store_path, &agent.messages);
    let checkpoint = agent.messages.len();
    let first = crate::store::create_session_inbox_item(
        &store_path,
        "session",
        crate::store::InboxDelivery::Steer,
        "Keep the picker keyboard accessible.",
        Some("run"),
        None,
    )
    .unwrap();
    let second = crate::store::create_session_inbox_item(
        &store_path,
        "session",
        crate::store::InboxDelivery::Steer,
        "Preserve visible focus states.",
        Some("run"),
        None,
    )
    .unwrap();
    let connection = rusqlite::Connection::open(&store_path).unwrap();
    connection
        .execute_batch(&format!(
            "CREATE TRIGGER fail_second_inbox_ack BEFORE UPDATE OF status ON session_inbox
         WHEN OLD.id = {} AND NEW.status = 'delivered'
         BEGIN SELECT RAISE(FAIL, 'forced batch acknowledgement failure'); END;",
            second.id,
        ))
        .unwrap();

    assert!(agent.append_pending_direct_inbox().await.is_err());
    assert_eq!(agent.messages.len(), checkpoint);
    let pending = crate::store::list_session_inbox(&store_path, "session").unwrap();
    assert_eq!(
        pending.iter().map(|item| item.id).collect::<Vec<_>>(),
        [first.id, second.id]
    );
    assert!(pending
        .iter()
        .all(|item| item.status == crate::store::InboxStatus::Pending));

    connection
        .execute_batch("DROP TRIGGER fail_second_inbox_ack")
        .unwrap();
    assert_eq!(agent.append_pending_direct_inbox().await.unwrap(), 2);
    assert_eq!(agent.append_pending_direct_inbox().await.unwrap(), 0);
    let appended = agent.messages[checkpoint..]
        .iter()
        .map(|message| match message {
            Message::User { content } => content.as_str(),
            other => panic!("expected user steering, got {other:?}"),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        appended,
        [
            "Keep the picker keyboard accessible.",
            "Preserve visible focus states."
        ]
    );
    let delivered = crate::store::list_session_inbox(&store_path, "session").unwrap();
    assert!(delivered
        .iter()
        .all(|item| item.status == crate::store::InboxStatus::Delivered));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn image_limit_error_is_the_only_finished_event_for_the_result() {
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
                execution_duration_ms: Some(42),
                execution_duration_excludes_authorization: true,
                delegation_outcome: None,
                delegation_summary: None,
            },
        )],
        &EventSink::channel(events_tx),
        &None,
    )
    .await;

    assert!(
        matches!(&finalized[0], Message::Tool { content, .. } if content.contains("image_limit_exceeded"))
    );
    assert!(matches!(
        events_rx.try_recv().unwrap(),
        AgentEvent::ToolCallFinished {
            call_id,
            is_error: true,
            execution_duration_ms: Some(42),
            ..
        } if call_id == "call-image"
    ));
    assert!(events_rx.try_recv().is_err());
}

#[tokio::test]
async fn cancelled_image_call_still_emits_one_typed_finished_event() {
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
            mode: AgentMode::Direct,
            store_path: root.join("store.db"),
            session_id: None,
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::channel(events_tx),
            workspace_cwd: root.clone(),
            config_cwd: root.clone(),
            working_directory: root.display().to_string(),
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            permission_rules: Vec::new(),
        },
    )
    .unwrap();
    agent.command_cancellation().cancel();

    let error = agent.send("read the fixture").await.unwrap_err();
    assert!(error.to_string().contains("command cancelled"));
    let finished = std::iter::from_fn(|| events_rx.try_recv().ok())
        .filter_map(|event| match event {
            AgentEvent::ToolCallFinished {
                call_id,
                content_preview,
                completion_status,
                ..
            } => Some((call_id, content_preview, completion_status)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].0, "call-image");
    assert!(finished[0].1.contains("cancelled"));
    assert_eq!(
        finished[0].2,
        Some(crate::events::ToolCompletionStatus::Cancelled)
    );

    let _ = std::fs::remove_dir_all(root);
}

fn test_tool_call(id: &str, name: &str, arguments: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: crate::types::FunctionCall {
            name: name.to_string(),
            arguments: arguments.to_string(),
        },
    }
}

fn json_tool_error(id: &str, name: &str, body: serde_json::Value) -> (String, String, ToolResult) {
    (
        id.to_string(),
        name.to_string(),
        ToolResult {
            content: (body.to_string()).into(),
            is_error: true,
            execution_duration_ms: None,
            execution_duration_excludes_authorization: false,
            delegation_outcome: None,
            delegation_summary: None,
        },
    )
}

fn text_tool_error(id: &str, name: &str, text: &str) -> (String, String, ToolResult) {
    (
        id.to_string(),
        name.to_string(),
        ToolResult::text(text, true),
    )
}

#[test]
fn failed_tool_round_matches_identical_create_only_writes() {
    let calls = vec![test_tool_call(
        "c1",
        "write",
        r#"{ "path": "docker-compose.yml", "contents": "services:\n", "expected_revision": null }"#,
    )];
    let results = vec![json_tool_error(
        "c1",
        "write",
        serde_json::json!({
            "error": "already_exists",
            "message": "file already exists: docker-compose.yml",
            "current_revision": "sha256:abc",
        }),
    )];
    let first = failed_tool_round(&calls, &results).expect("failing write round");
    let second = failed_tool_round(
        &[test_tool_call(
            "c2",
            "write",
            r#"{"contents":"services:\n","expected_revision":null,"path":"docker-compose.yml"}"#,
        )],
        &[json_tool_error(
            "c2",
            "write",
            serde_json::json!({
                "error": "already_exists",
                "message": "file already exists: docker-compose.yml",
                "current_revision": "sha256:abc",
            }),
        )],
    )
    .expect("retried write round");

    assert_eq!(first.signature, second.signature);
    assert!(first.detail.contains("write"));
    assert!(first.detail.contains("docker-compose.yml"));
    assert!(first.detail.contains("already_exists"));
    assert!(
        !first.detail.contains("services:"),
        "stop detail must not dump write contents: {}",
        first.detail
    );
}

#[test]
fn failed_tool_round_does_not_collapse_unrelated_failures() {
    let write = failed_tool_round(
        &[test_tool_call(
            "w",
            "write",
            r#"{"path":"a.yml","expected_revision":null}"#,
        )],
        &[json_tool_error(
            "w",
            "write",
            serde_json::json!({ "error": "already_exists" }),
        )],
    )
    .unwrap();
    let other_write = failed_tool_round(
        &[test_tool_call(
            "w2",
            "write",
            r#"{"path":"b.yml","expected_revision":null}"#,
        )],
        &[json_tool_error(
            "w2",
            "write",
            serde_json::json!({ "error": "already_exists" }),
        )],
    )
    .unwrap();
    let thread_a = failed_tool_round(
        &[test_tool_call(
            "t1",
            "thread",
            r#"{"name":"worker-a","action":"build"}"#,
        )],
        &[text_tool_error(
            "t1",
            "thread",
            "Thread 'worker-a' failed (exit 1):\nboom",
        )],
    )
    .unwrap();
    let thread_b = failed_tool_round(
        &[test_tool_call(
            "t2",
            "thread",
            r#"{"name":"worker-b","action":"test"}"#,
        )],
        &[text_tool_error(
            "t2",
            "thread",
            "Thread 'worker-b' failed (exit 1):\nboom",
        )],
    )
    .unwrap();
    let grep_a = failed_tool_round(
        &[test_tool_call("g1", "grep", r#"{"pattern":"foo"}"#)],
        &[json_tool_error(
            "g1",
            "grep",
            serde_json::json!({
                "error": { "code": "invalid_regex", "message": "bad", "path": null }
            }),
        )],
    )
    .unwrap();
    let grep_b = failed_tool_round(
        &[test_tool_call("g2", "grep", r#"{"pattern":"bar"}"#)],
        &[json_tool_error(
            "g2",
            "grep",
            serde_json::json!({
                "error": { "code": "invalid_regex", "message": "bad", "path": null }
            }),
        )],
    )
    .unwrap();
    let exec_a = failed_tool_round(
        &[test_tool_call(
            "e1",
            "exec_command",
            r#"{"cmd":"ls missing-a"}"#,
        )],
        &[text_tool_error("e1", "exec_command", "exit 2")],
    )
    .unwrap();
    let exec_b = failed_tool_round(
        &[test_tool_call(
            "e2",
            "exec_command",
            r#"{"cmd":"ls missing-b"}"#,
        )],
        &[text_tool_error("e2", "exec_command", "exit 2")],
    )
    .unwrap();

    let signatures = [
        write.signature,
        other_write.signature,
        thread_a.signature,
        thread_b.signature,
        grep_a.signature,
        grep_b.signature,
        exec_a.signature,
        exec_b.signature,
    ];
    let unique = signatures.iter().collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        unique.len(),
        signatures.len(),
        "unrelated failing rounds must not share a signature: {signatures:?}"
    );
}

#[test]
fn failed_tool_round_ignores_successful_results() {
    let calls = vec![test_tool_call("ok", "read", r#"{"path":"a.rs"}"#)];
    let results = vec![(
        "ok".to_string(),
        "read".to_string(),
        ToolResult::text("ok", false),
    )];
    assert!(failed_tool_round(&calls, &results).is_none());
}
