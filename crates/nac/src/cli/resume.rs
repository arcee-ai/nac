use super::*;

pub(super) async fn build_resume_picker_config(cli: RunCli) -> Result<RunConfig> {
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: cli.api_base_url,
        model: cli.api_model,
        backend: Some(cli.backend),
        reasoning_effort: cli.reasoning_effort,
    })?;
    let current_dir = std::env::current_dir()?;
    let agents_md = AgentsMdBundle::load(Some(&current_dir))?;
    let working_directory = current_directory_display();
    let workspace_host_path = Some(current_dir.clone());
    let sandbox_status = "off".to_string();
    let agents_md_status = agents_md.status_text();
    let store_path = absolute_store_path(
        &current_dir,
        cli.store_path.unwrap_or_else(store::default_store_path),
    );
    store::initialize(&store_path)?;
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path,
            session_id: None,
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory: working_directory.clone(),
            sandbox: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: agents_md.system_message(),
        },
    );

    Ok(RunConfig {
        mode: AgentMode::Orchestrator,
        agent,
        initial_prompt: None,
        continue_repl: true,
        managed_worker: None,
        client,
        session_id: None,
        session_snapshot: None,
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

pub(super) async fn build_resume_config(cli: ResumeCli) -> Result<RunConfig> {
    if cli.last && cli.session_id.is_some() {
        anyhow::bail!("resume accepts either a session id or --last, not both");
    }

    let snapshot = match (cli.session_id.as_deref(), cli.last) {
        (Some(session_id), false) => sessions::load_session(session_id)?,
        (Some(_), true) => unreachable!(),
        (None, _) => sessions::load_last_session()?,
    };

    std::env::set_current_dir(&snapshot.cwd)?;
    let current_dir = std::env::current_dir()?;
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: Some(snapshot.base_url.clone()),
        model: Some(snapshot.model.clone()),
        backend: Some(snapshot.backend),
        reasoning_effort: snapshot.reasoning_effort,
    })?;
    let sandbox = match snapshot.sandbox_spec.clone() {
        Some(spec) => Some(SandboxSession::create(spec, Uuid::new_v4().to_string(), true).await?),
        None => None,
    };
    let agents_md_workspace_dir = effective_agents_md_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(agents_md_workspace_dir.as_deref())?;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(current_directory_display);
    let workspace_host_path = if let Some(session) = sandbox.as_ref() {
        session.host_workdir()
    } else {
        Some(current_dir.clone())
    };
    let sandbox_status = sandbox
        .as_ref()
        .map(|session| session.status_text())
        .unwrap_or_else(|| "off".to_string());
    let agents_md_status = agents_md.status_text();

    store::initialize(&snapshot.store_path)?;
    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: snapshot.store_path.clone(),
            session_id: Some(snapshot.session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory: working_directory.clone(),
            sandbox,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
        },
    );
    agent.restore_messages(snapshot.messages.clone());

    Ok(RunConfig {
        mode: AgentMode::Orchestrator,
        agent,
        initial_prompt: None,
        continue_repl: true,
        managed_worker: None,
        client,
        session_id: Some(snapshot.session_id.clone()),
        session_snapshot: Some(snapshot),
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

pub(super) async fn build_resume_config_for_session(session_id: &str) -> Result<RunConfig> {
    build_resume_config(ResumeCli {
        session_id: Some(session_id.to_string()),
        last: false,
    })
    .await
}
