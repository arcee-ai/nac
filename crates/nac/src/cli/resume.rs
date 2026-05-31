use super::*;

pub(super) async fn build_resume_picker_config(
    cli: ResumeCli,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    if let Some(dir) = cli.directory.as_ref() {
        std::env::set_current_dir(dir)?;
    }
    let client =
        ModelClient::from_env_with_overrides(model_overrides(&ModelArgs::default(), config)?)?;
    let current_dir = std::env::current_dir()?;
    let agents_md = AgentsMdBundle::load(Some(&current_dir))?;
    let skills = SkillRegistry::load(Some(&current_dir), None)?;
    let working_directory = current_directory_display();
    let workspace_host_path = Some(current_dir.clone());
    let sandbox_status = "off".to_string();
    let agents_md_status = agents_md.status_text();
    let store_path = absolute_store_path(
        &current_dir,
        cli.store
            .store_path
            .or_else(|| config.storage.store_path.clone())
            .unwrap_or_else(store::default_store_path),
    );
    store::initialize(&store_path)?;
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: store_path.clone(),
            session_id: None,
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory: working_directory.clone(),
            sandbox: None,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: agents_md.system_message(),
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    );

    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Picker { store_path },
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

pub(super) async fn build_resume_config(
    cli: ResumeCli,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    if cli.last && cli.session_id.is_some() {
        anyhow::bail!("resume accepts either a session id or --last, not both");
    }

    if let Some(dir) = cli.directory.as_ref() {
        std::env::set_current_dir(dir)?;
    }
    let resume_dir = std::env::current_dir()?;
    let resume_store_path = absolute_store_path(
        &resume_dir,
        cli.store
            .store_path
            .or_else(|| config.storage.store_path.clone())
            .unwrap_or_else(store::default_store_path),
    );

    let snapshot = match (cli.session_id.as_deref(), cli.last) {
        (Some(session_id), false) => sessions::load_session(&resume_store_path, session_id)?,
        (Some(_), true) => unreachable!(),
        (None, _) => sessions::load_last_session(&resume_store_path)?,
    };

    build_resume_config_from_snapshot(snapshot, config).await
}

pub(super) async fn build_resume_config_for_session(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    let snapshot = sessions::load_session(&store_path, session_id)?;
    build_resume_config_from_snapshot(snapshot, config).await
}

async fn build_resume_config_from_snapshot(
    snapshot: SessionSnapshot,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    std::env::set_current_dir(&snapshot.cwd)?;
    let current_dir = std::env::current_dir()?;
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: Some(snapshot.base_url.clone()),
        model: Some(snapshot.model.clone()),
        backend: Some(snapshot.backend),
        reasoning_effort: snapshot.reasoning_effort,
        api_key_env: configured_api_key_env(config),
    })?;
    let sandbox = match snapshot.sandbox_spec.clone() {
        Some(spec) => Some(SandboxSession::create(spec, Uuid::new_v4().to_string(), true).await?),
        None => None,
    };
    let agents_md_workspace_dir = effective_agents_md_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(agents_md_workspace_dir.as_deref())?;
    let skills_workspace_dir = effective_skills_workspace_dir(&current_dir, sandbox.as_ref());
    let skills = SkillRegistry::load(skills_workspace_dir.as_deref(), sandbox.as_ref())?;
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
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    );
    agent.restore_messages(snapshot.messages.clone());

    let session_id = snapshot.session_id.clone();
    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
            snapshot,
        },
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}
