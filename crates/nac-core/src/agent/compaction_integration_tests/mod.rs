use super::*;

fn scripted_responses_text(
    text: &str,
    input_tokens: u64,
    cached_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "message",
            "content": [{"type": "output_text", "text": text}]
        }],
        "usage": {
            "input_tokens": input_tokens,
            "input_tokens_details": {"cached_tokens": cached_tokens},
            "output_tokens": output_tokens,
            "total_tokens": total_tokens
        }
    })
    .to_string()
}

fn compaction_test_agent(
    client: ModelClient,
    store_path: PathBuf,
    session_id: Option<&str>,
    threshold: Option<u64>,
    event_sink: EventSink,
) -> Agent {
    Agent::with_config(
        client,
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path,
            session_id: session_id.map(str::to_string),
            orchestrator_compaction_threshold: threshold,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink,
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
            mixed_clients: None,
        },
    )
    .unwrap()
}

fn store_agent_snapshot(store_path: &std::path::Path, agent: &Agent) {
    let connection = crate::store::open_runtime_connection(store_path).unwrap();
    connection
        .execute(
            "UPDATE sessions
             SET messages_json = ?1, visible_message_count = ?2, last_user_prompt = ?3
             WHERE session_id = 'session'",
            rusqlite::params![
                serde_json::to_string(&agent.messages).unwrap(),
                crate::sessions::visible_message_count(&agent.messages) as i64,
                crate::sessions::last_user_prompt(&agent.messages)
            ],
        )
        .unwrap();
}

fn compactable_messages() -> Vec<Message> {
    vec![
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "old user".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "recent user".to_string(),
        },
        Message::User {
            content: "current user".to_string(),
        },
    ]
}

fn drain_events(
    events_rx: &mut tokio::sync::mpsc::UnboundedReceiver<AgentEvent>,
) -> Vec<AgentEvent> {
    std::iter::from_fn(|| events_rx.try_recv().ok()).collect()
}

mod automatic_flow;
mod lifecycle;
mod manual_flow;
mod projection_durability;
