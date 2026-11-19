use super::*;

fn agent() -> Agent {
    let root = std::env::temp_dir();
    let registry = Arc::new(crate::skills::SkillRegistry::bundled_for_test());
    Agent::with_config(
        ModelClient::new_for_test(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Direct,
            store_path: root.join("unused-guide-test.db"),
            session_id: None,
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: root.clone(),
            config_cwd: root,
            working_directory: ".".into(),
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: Some(registry),
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            permission_rules: Vec::new(),
        },
    )
    .unwrap()
}

#[test]
fn direct_guide_routing_is_bounded() {
    {
        let mut agent = agent();
        let Message::System { content } = &agent.messages[0] else {
            panic!("missing system prompt")
        };
        assert!(content.contains("NAC product self-help"));
        assert!(content.contains("Generic coding work merely mentioning NAC does not require help"));
        assert!(
            !content.contains("[mcp_servers.context7]"),
            "corpus must stay out of prompt"
        );
        assert!(crate::guide::primary_prompt().len() < 4000);
        for retired in [
            "direct-with-orchestrator",
            "NAC_ORCHESTRATION",
            "worker dispatch",
        ] {
            assert!(!content.contains(retired));
        }
        for _ in 0..2 {
            assert!(agent
                .refresh_model_request_capabilities()
                .unwrap()
                .iter()
                .any(|tool| tool.function.name == "nac_guide"));
        }
    }
}

#[tokio::test]
async fn resumed_direct_guide_uses_fresh_system_head_without_rewriting_history() {
    let root = std::env::temp_dir().join(format!("nac-guide-resume-{}", uuid::Uuid::new_v4()));
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    rusqlite::Connection::open(&store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'session'",
            [],
        )
        .unwrap();
    assert_eq!(
        crate::sessions::load_session_behavior(&store_path, "session").unwrap(),
        crate::sessions::SessionBehavior::Direct
    );
    let old = "Pre-change direct system: direct-with-orchestrator and worker dispatch".to_string();
    let stored = vec![
        Message::System { content: old },
        Message::User {
            content: "hello".into(),
        },
    ];
    super::transcript_log_tests::store_snapshot_messages(&store_path, &stored);
    let connection = rusqlite::Connection::open(&store_path).unwrap();
    let read = || {
        connection
            .query_row(
                "SELECT messages_json FROM sessions WHERE session_id = 'session'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap()
    };
    let before = read();
    let server = crate::model::test_http::ScriptedServer::start(vec![
        crate::model::test_http::ScriptedResponse::json("200 OK", serde_json::json!({
            "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "answer"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        }).to_string()),
    ]);
    let mut agent = super::transcript_log_tests::transcript_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        store_path.clone(),
        Some("session"),
    );
    agent
        .restore_messages_merging_log_tail(stored, None)
        .await
        .unwrap();
    assert_eq!(read(), before);
    assert!(
        matches!(&agent.messages[0], Message::System { content } if content.contains("NAC product self-help") && !content.contains("direct-with-orchestrator") && !content.contains("worker dispatch"))
    );
    agent.set_current_run_id(Some("guide-resume-run".into()));
    assert_eq!(agent.send("How do I use NAC?").await.unwrap(), "answer");
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let body = String::from_utf8(requests[0].body.clone()).unwrap();
    assert!(body.contains("NAC product self-help"));
    assert!(!body.contains("direct-with-orchestrator"));
    assert!(!body.contains("worker dispatch"));
    drop(connection);
    std::fs::remove_dir_all(root).unwrap();
}
