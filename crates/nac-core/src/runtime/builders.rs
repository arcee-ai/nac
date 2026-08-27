use super::*;

pub async fn build_run_config(
    options: RunOptions,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    build_run_config_inner(
        options,
        config,
        None,
        sessions::SessionBehavior::Orchestrator,
    )
    .await
}

pub async fn build_run_config_for_project(
    options: RunOptions,
    config: &NacConfig,
    project_id: Option<String>,
) -> Result<OrchestratorRunConfig> {
    build_run_config_inner(
        options,
        config,
        project_id,
        sessions::SessionBehavior::Orchestrator,
    )
    .await
}

/// Build a persistent top-level session with an explicitly selected immutable
/// behavior. Existing callers continue through the orchestrator-only wrappers
/// above, so omission remains backward compatible.
pub async fn build_run_config_for_project_with_behavior(
    options: RunOptions,
    config: &NacConfig,
    project_id: Option<String>,
    behavior: sessions::SessionBehavior,
) -> Result<OrchestratorRunConfig> {
    build_run_config_inner(options, config, project_id, behavior).await
}

async fn build_run_config_inner(
    options: RunOptions,
    config: &NacConfig,
    project_id: Option<String>,
    behavior: sessions::SessionBehavior,
) -> Result<OrchestratorRunConfig> {
    let agent_mode = match behavior {
        sessions::SessionBehavior::Orchestrator => AgentMode::Orchestrator,
        sessions::SessionBehavior::Direct | sessions::SessionBehavior::DirectWithOrchestrator => {
            AgentMode::Direct
        }
    };
    let ssh_host = options.ssh.host();
    let config_cwd = options
        .config_cwd
        .clone()
        .unwrap_or_else(|| default_config_cwd(&options.workspace_cwd, ssh_host.as_deref()));
    let settings = effective_model_settings(&options.model, config)?;
    let orchestrator_compaction_threshold = effective_orchestrator_compaction_threshold(
        options.orchestrator_compaction_threshold,
        settings.resolved.context_window,
    )?;
    let client = ModelClient::from_effective_settings(settings.clone())?.with_cache_ttl(Some("1h"));
    let light_model = options.model.light_model.clone();
    let light_client = light_model
        .as_ref()
        .map(|light| resolve_light_client(light, &settings.extra_headers))
        .transpose()?
        .map(std::sync::Arc::new);
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
    validate_target_sandbox_options(ssh_host.as_deref(), &sandbox_options, "session")?;
    let store_base_cwd = if ssh_host.is_some() {
        &config_cwd
    } else {
        &options.workspace_cwd
    };
    let store_path = resolve_store_path(store_base_cwd, options.store, config);
    store::initialize(&store_path)?;

    let config_paths = PathContext::new(&config_cwd);
    options.ssh.validate(&config_paths)?;
    if ssh_host.is_some() {
        let connection = options
            .ssh
            .connection(&config_paths)
            .expect("a trimmed ssh host yields a connection");
        let requested_remote_cwd = remote_cwd_or_home(options.workspace_cwd.clone());
        let requested_remote_cwd_text = requested_remote_cwd
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("remote working directory is not valid UTF-8"))?;
        let remote_cwd =
            canonical_remote_session_cwd(&connection, requested_remote_cwd_text, &config_paths)
                .await?;
        let working_directory = directory_display(&remote_cwd);
        let workspace_git = GitTarget::ssh(connection.clone(), remote_cwd.clone(), &config_cwd);
        let session_id = Uuid::new_v4().to_string();
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                command_output_limits: worker_command_output_limits(config)?,
                mode: agent_mode,
                session_behavior: Some(behavior),
                store_path: store_path.clone(),
                session_id: Some(session_id.clone()),
                orchestrator_compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: remote_cwd.clone(),
                config_cwd: config_cwd.clone(),
                working_directory: working_directory.clone(),
                worker_executable: options.worker_executable,
                sandbox: None,
                ssh: Some(connection.clone()),
                mcp: None,
                skills,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: worker_thread_timeout_secs(config),
                light_client: light_client.clone(),
                permission_rules: config.permissions.rules.clone(),
            },
        )?;
        let mut session_snapshot = sessions::new_snapshot(
            session_id.clone(),
            remote_cwd,
            settings.model.clone(),
            settings.base_url.clone(),
            settings.backend,
            settings.reasoning_effort,
            None,
            Some(connection),
            agent.messages.clone(),
            settings.api_key_env.clone(),
            settings.extra_headers.clone(),
        );
        session_snapshot.behavior = behavior;
        session_snapshot.project_id = project_id.clone();
        session_snapshot.orchestrator_compaction_threshold = orchestrator_compaction_threshold;
        session_snapshot.light_model = light_model;
        sessions::create_session(&store_path, &session_snapshot)?;

        return Ok(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id,
                store_path,
                snapshot: session_snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: working_directory,
            workspace_git: Some(workspace_git),
            resume_base_cwd: config_cwd,
        });
    }

    let workspace_cwd = options.workspace_cwd;
    let session_id = Uuid::new_v4().to_string();
    let paths = PathContext::new(&workspace_cwd);
    let mut worktree_rollback: session_worktree::RollbackGuard;
    let sandbox = build_sandbox_session_inner(
        &sandbox_options,
        &workspace_cwd,
        Some(session_id.clone()),
        Some(store_path.clone()),
    )
    .await?;
    worktree_rollback = session_worktree::RollbackGuard::new(
        sandbox
            .as_ref()
            .and_then(|session| session.spec().worktree.clone()),
    );
    let build_result = (|| -> Result<OrchestratorRunConfig> {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &paths)?;
        let working_directory = sandbox
            .as_ref()
            .map(super::super::sandbox::SandboxSession::workdir_display)
            .unwrap_or_else(|| directory_display(&workspace_cwd));
        let workspace_git = if let Some(session) = sandbox.as_ref() {
            session.host_workdir().map(GitTarget::local)
        } else {
            Some(GitTarget::local(workspace_cwd.clone()))
        };
        let sandbox_status = sandbox
            .as_ref()
            .map(super::super::sandbox::SandboxSession::status_text)
            .unwrap_or_else(|| "off".to_string());
        let agents_md_message = agents_md.system_message();
        let agents_md_status = agents_md.status_text();

        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                command_output_limits: worker_command_output_limits(config)?,
                mode: agent_mode,
                session_behavior: Some(behavior),
                store_path: store_path.clone(),
                session_id: Some(session_id.clone()),
                orchestrator_compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: workspace_cwd.clone(),
                config_cwd: config_cwd.clone(),
                working_directory: working_directory.clone(),
                worker_executable: options.worker_executable,
                sandbox: sandbox.clone(),
                ssh: None,
                mcp: None,
                skills,
                extra_tool_defs: Vec::new(),
                agents_md_message,
                thread_timeout_secs: worker_thread_timeout_secs(config),
                light_client: light_client.clone(),
                permission_rules: config.permissions.rules.clone(),
            },
        )?;
        let mut session_snapshot = sessions::new_snapshot(
            session_id.clone(),
            workspace_cwd.clone(),
            settings.model.clone(),
            settings.base_url.clone(),
            settings.backend,
            settings.reasoning_effort,
            sandbox.as_ref().map(|session| session.spec().clone()),
            None, // fresh local/sandbox sessions carry no ssh_host
            agent.messages.clone(),
            settings.api_key_env.clone(),
            settings.extra_headers.clone(),
        );
        session_snapshot.behavior = behavior;
        session_snapshot.project_id = project_id;
        session_snapshot.orchestrator_compaction_threshold = orchestrator_compaction_threshold;
        session_snapshot.light_model = light_model;
        sessions::create_session(&store_path, &session_snapshot)?;
        if let Some(sandbox) = sandbox.as_ref() {
            sandbox.retain_for_durable_session();
        }
        worktree_rollback.disarm();

        Ok(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id,
                store_path,
                snapshot: session_snapshot,
            },
            sandbox_status,
            agents_md_status,
            workspace_display: working_directory,
            workspace_git,
            resume_base_cwd: workspace_cwd,
        })
    })();

    match build_result {
        Ok(run_config) => Ok(run_config),
        Err(error) => {
            if let Some(sandbox) = sandbox.as_ref() {
                // Disable fire-and-forget Drop cleanup before performing the
                // checked rollback. Every in-process failure after successful
                // `podman run` now settles removal before launch returns.
                sandbox.disable_drop_cleanup();
                if let Err(cleanup) = sandbox.destroy().await {
                    return Err(error.context(format!(
                        "fresh sandbox launch also failed to roll back its container: {cleanup:#}"
                    )));
                }
            }
            Err(error)
        }
    }
}

pub async fn build_managed_worker_config(
    options: ManagedWorkerOptions,
    config: &NacConfig,
) -> Result<ManagedWorkerRunConfig> {
    let client = ModelClient::from_effective_settings(managed_worker_effective_model_settings(
        &options.model,
    )?)?;
    let ssh_host = options.ssh.host();
    let config_cwd = options
        .config_cwd
        .clone()
        .unwrap_or_else(|| default_config_cwd(&options.workspace_cwd, ssh_host.as_deref()));
    let workspace_cwd = options.workspace_cwd;
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
    validate_target_sandbox_options(ssh_host.as_deref(), &sandbox_options, "worker")?;
    let store_base_cwd = if ssh_host.is_some() {
        &config_cwd
    } else {
        &workspace_cwd
    };
    let store_path = resolve_store_path(store_base_cwd, options.store, config);
    store::initialize(&store_path)?;
    let sandbox = if ssh_host.is_some() {
        None
    } else {
        build_sandbox_session(&sandbox_options, &workspace_cwd).await?
    };
    let workspace_paths = PathContext::new(&workspace_cwd);
    let config_paths = PathContext::new(&config_cwd);
    let (agents_md_message, mcp_outcome, skills) = if ssh_host.is_some() {
        let mcp_outcome = McpRegistry::load_reporting_skips(
            &workspace_cwd,
            None,
            &config_paths,
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await?;
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        (None, mcp_outcome, skills)
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &workspace_paths)?;
        let mcp_outcome = McpRegistry::load_reporting_skips(
            &workspace_cwd,
            sandbox.as_ref(),
            &workspace_paths,
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &workspace_paths)?;
        (agents_md.system_message(), mcp_outcome, skills)
    };
    // Surface each skip as a typed event on the worker's stderr channel so the
    // dashboard shows why a server's tools are missing.
    let worker_event_sink = EventSink::stderr_prefixed();
    for skipped in &mcp_outcome.skipped {
        worker_event_sink.emit(AgentEvent::McpServerSkipped {
            thread_name: Some(options.dispatch.thread_name.clone()),
            server_name: skipped.name.clone(),
            reason: skipped.reason.clone(),
        });
    }
    let mcp = mcp_outcome.registry;
    let working_directory = sandbox
        .as_ref()
        .map(super::super::sandbox::SandboxSession::workdir_display)
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let extra_tool_defs = mcp
        .as_ref()
        .map(|registry| registry.tool_definitions())
        .unwrap_or_default();

    let worker_context = store::load_worker_context(
        &store_path,
        &options.dispatch.session_id,
        &options.dispatch.thread_name,
        &options.dispatch.source_threads,
    )?;
    let mut initial_messages =
        build_preloaded_skill_messages(skills.as_deref(), &options.dispatch.skills)?;
    initial_messages.extend(build_worker_context_messages(
        &options.dispatch.thread_name,
        &worker_context,
    ));
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: worker_command_output_limits(config)?,
            mode: AgentMode::Worker,
            session_behavior: None,
            store_path: store_path.clone(),
            session_id: Some(options.dispatch.session_id.clone()),
            orchestrator_compaction_threshold: None,
            initial_messages,
            thread_name: Some(options.dispatch.thread_name.clone()),
            dispatch_id: Some(options.dispatch.dispatch_id.clone()),
            event_sink: EventSink::stderr_prefixed(),
            workspace_cwd,
            config_cwd,
            working_directory,
            worker_executable: None,
            sandbox,
            ssh: options.ssh.connection(&config_paths),
            mcp,
            skills: None,
            extra_tool_defs,
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
            light_client: None,
            permission_rules: config.permissions.rules.clone(),
        },
    )?;

    Ok(ManagedWorkerRunConfig {
        agent,
        store_path,
        session_id: options.dispatch.session_id,
        thread_name: options.dispatch.thread_name,
        action: options.dispatch.action,
    })
}
