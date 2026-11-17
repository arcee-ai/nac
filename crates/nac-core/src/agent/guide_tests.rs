use super::*;

fn agent(
    mode: AgentMode,
    behavior: Option<crate::sessions::SessionBehavior>,
    preload: bool,
) -> Agent {
    let root = std::env::temp_dir();
    let registry = Arc::new(crate::skills::SkillRegistry::bundled_for_test());
    let initial_messages = if preload {
        crate::worker::build_preloaded_skill_messages(Some(&registry), &["nac-help".into()])
            .unwrap()
    } else {
        Vec::new()
    };
    Agent::with_config(
        ModelClient::new_for_test(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode,
            session_behavior: behavior,
            store_path: root.join("unused-guide-test.db"),
            session_id: None,
            orchestrator_compaction_threshold: None,
            initial_messages,
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: root.clone(),
            config_cwd: root,
            working_directory: ".".into(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: if mode == AgentMode::Worker {
                None
            } else {
                Some(registry)
            },
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: Vec::new(),
        },
    )
    .unwrap()
}

#[test]
fn direct_guide_routing_is_bounded() {
    for (mode, behavior) in [(AgentMode::Direct, crate::sessions::SessionBehavior::Direct)] {
        let mut agent = agent(mode, Some(behavior), false);
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
        assert!(agent
            .refresh_model_request_capabilities()
            .unwrap()
            .iter()
            .any(|tool| tool.function.name == "nac_guide"));
    }
}

#[test]
fn guide_worker_retrieval_requires_the_selected_preload_and_survives_refresh() {
    let mut unselected = agent(AgentMode::Worker, None, false);
    let defs = unselected.refresh_model_request_capabilities().unwrap();
    assert!(!defs.iter().any(|tool| tool.function.name == "nac_guide"));
    assert!(!unselected.messages.iter().any(|message| matches!(message, Message::System { content } if content.contains("NAC product self-help"))));
    let mut selected = agent(AgentMode::Worker, None, true);
    for _ in 0..2 {
        let defs = selected.refresh_model_request_capabilities().unwrap();
        assert!(defs.iter().any(|tool| tool.function.name == "nac_guide"));
        assert!(!defs
            .iter()
            .any(|tool| tool.function.name == "activate_skill"));
    }
    assert!(selected.messages.iter().any(|message| matches!(message, Message::System { content } if content.contains("first-party bundled NAC Guide"))));
}

#[tokio::test]
async fn resumed_direct_guide_uses_fresh_system_head_without_rewriting_history() {
    let root = std::env::temp_dir().join(format!("nac-guide-resume-{}", uuid::Uuid::new_v4()));
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
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
    let mut agent = super::transcript_log_tests::transcript_test_agent(
        ModelClient::new_for_test(),
        store_path.clone(),
        Some("session"),
        AgentMode::Direct,
    );
    agent
        .restore_messages_merging_log_tail(stored, None)
        .await
        .unwrap();
    assert_eq!(read(), before);
    assert!(
        matches!(&agent.messages[0], Message::System { content } if content.contains("NAC product self-help") && !content.contains("direct-with-orchestrator") && !content.contains("worker dispatch"))
    );
    drop(connection);
    std::fs::remove_dir_all(root).unwrap();
}
