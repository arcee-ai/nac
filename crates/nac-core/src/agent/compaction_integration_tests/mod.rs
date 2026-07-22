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
            ssh_host: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
        },
    )
    .unwrap()
}

mod flow;
mod lifecycle;
