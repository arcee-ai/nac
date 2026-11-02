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
fn guide_routing_is_bounded_and_available_in_all_primary_behaviors() {
    for (mode, behavior) in [
        (AgentMode::Direct, crate::sessions::SessionBehavior::Direct),
        (
            AgentMode::Direct,
            crate::sessions::SessionBehavior::DirectWithOrchestrator,
        ),
        (
            AgentMode::Orchestrator,
            crate::sessions::SessionBehavior::Orchestrator,
        ),
    ] {
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
