use super::*;

pub async fn build_resume_picker_config(
    options: ResumeOptions,
    config: &NacConfig,
) -> Result<ResumePickerRunConfig> {
    if options.last || options.session_id.is_some() {
        anyhow::bail!("session picker does not accept a session id or --last");
    }

    let lookup_cwd = options.lookup_cwd;
    let store_path = resolve_store_path(&lookup_cwd, options.store, config);
    store::initialize(&store_path)?;

    Ok(ResumePickerRunConfig {
        store_path,
        lookup_cwd,
        worker_executable: options.worker_executable,
    })
}

fn record_interrupted_run_recovery(
    run_config: &mut OrchestratorRunConfig,
    recovery: store::ActiveRunReconciliation,
) {
    if let store::ActiveRunReconciliation::Interrupted { run_id } = recovery {
        run_config.agent.set_interrupted_run_recovery(run_id);
    }
}

pub async fn build_resume_config(
    options: ResumeOptions,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    if options.last && options.session_id.is_some() {
        anyhow::bail!("resume accepts either a session id or --last, not both");
    }

    let lookup_cwd = options.lookup_cwd;
    let resume_store_path = resolve_store_path(&lookup_cwd, options.store, config);

    let snapshot = match (options.session_id.as_deref(), options.last) {
        (Some(session_id), false) => {
            sessions::load_session_async(resume_store_path.clone(), session_id.to_string()).await?
        }
        (Some(_), true) => unreachable!(),
        (None, _) => sessions::load_last_session_async(resume_store_path.clone()).await?,
    };
    let session_id = snapshot.session_id.clone();
    let lease = sessions::SessionOperationLease::try_acquire(&resume_store_path, &session_id)?;
    lease.validate(&resume_store_path, &session_id)?;
    let recovery = store::reconcile_active_run(&resume_store_path, &session_id)?;
    let snapshot =
        sessions::load_session_async(resume_store_path.clone(), session_id.clone()).await?;

    let mut run_config = build_resume_config_from_snapshot(
        snapshot,
        resume_store_path,
        config,
        lookup_cwd,
        options.worker_executable,
        Some(&lease),
        true,
        None,
    )
    .await?;
    record_interrupted_run_recovery(&mut run_config, recovery);
    Ok(run_config)
}

pub async fn build_resume_config_for_session(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<OrchestratorRunConfig> {
    let lease = sessions::SessionOperationLease::try_acquire(&store_path, session_id)?;
    lease.validate(&store_path, session_id)?;
    let recovery = store::reconcile_active_run(&store_path, session_id)?;
    let snapshot = sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
    let mut run_config = build_resume_config_from_snapshot(
        snapshot,
        store_path,
        config,
        resume_base_cwd,
        worker_executable,
        Some(&lease),
        true,
        None,
    )
    .await?;
    record_interrupted_run_recovery(&mut run_config, recovery);
    Ok(run_config)
}

pub async fn build_resume_config_for_session_attachment(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<(
    OrchestratorRunConfig,
    bool,
    Option<sessions::SessionOperationLease>,
)> {
    let snapshot = sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
    let metadata = resolve_model_metadata(snapshot.backend, &snapshot.model);
    let requires_migration = snapshot.reasoning_effort.is_some_and(|effort| {
        metadata.source.is_authoritative() && !metadata.thinking_level_map.is_supported(effort)
    });
    let requires_run_recovery = store::load_run_recovery(&store_path, session_id)?.is_some();
    if !requires_migration && !requires_run_recovery {
        let run_config = build_resume_config_from_snapshot(
            snapshot,
            store_path,
            config,
            resume_base_cwd,
            worker_executable,
            None,
            true,
            Some(metadata),
        )
        .await?;
        return Ok((run_config, true, None));
    }
    match sessions::SessionOperationLease::try_acquire(&store_path, session_id) {
        Ok(lease) => {
            lease.validate(&store_path, session_id)?;
            let recovery = store::reconcile_active_run(&store_path, session_id)?;
            let snapshot =
                sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
            let mut run_config = build_resume_config_from_snapshot(
                snapshot,
                store_path,
                config,
                resume_base_cwd,
                worker_executable,
                Some(&lease),
                true,
                None,
            )
            .await?;
            record_interrupted_run_recovery(&mut run_config, recovery);
            Ok((run_config, true, Some(lease)))
        }
        Err(sessions::SessionOperationLeaseError::Busy(_)) => {
            let run_config = build_resume_config_from_snapshot(
                snapshot,
                store_path,
                config,
                resume_base_cwd,
                worker_executable,
                None,
                false,
                Some(metadata),
            )
            .await?;
            Ok((run_config, false, None))
        }
        Err(error) => Err(error.into()),
    }
}

pub async fn build_resume_config_for_session_with_lease(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
    operation_lease: &sessions::SessionOperationLease,
) -> Result<OrchestratorRunConfig> {
    operation_lease.validate(&store_path, session_id)?;
    let recovery = store::reconcile_active_run(&store_path, session_id)?;
    let snapshot = sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
    let mut run_config = build_resume_config_from_snapshot(
        snapshot,
        store_path,
        config,
        resume_base_cwd,
        worker_executable,
        Some(operation_lease),
        true,
        None,
    )
    .await?;
    record_interrupted_run_recovery(&mut run_config, recovery);
    Ok(run_config)
}

#[expect(
    clippy::too_many_arguments,
    reason = "resume composition keeps persisted snapshot, overrides, lease, and executable authority explicit"
)]
pub(super) async fn build_resume_config_from_snapshot(
    snapshot: SessionSnapshot,
    store_path: PathBuf,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
    operation_lease: Option<&sessions::SessionOperationLease>,
    persist_recovery: bool,
    resolved_metadata: Option<ModelMetadata>,
) -> Result<OrchestratorRunConfig> {
    let mut snapshot = normalize_snapshot_paths(snapshot, &resume_base_cwd)?;
    let agent_mode = match snapshot.behavior {
        sessions::SessionBehavior::Orchestrator => AgentMode::Orchestrator,
        sessions::SessionBehavior::Direct | sessions::SessionBehavior::DirectWithOrchestrator => {
            AgentMode::Direct
        }
    };
    // Resume reaches the host with the connection the session recorded, not with
    // whatever the local ssh config happens to say now.
    let ssh = snapshot.ssh.clone();
    if ssh.is_some() && snapshot.sandbox_spec.is_some() {
        anyhow::bail!(
            "invalid session configuration: ssh_host and podman sandbox metadata cannot both be set"
        );
    }

    let workspace_cwd = snapshot.cwd.clone();
    let config_cwd = if ssh.is_some() {
        resume_base_cwd.clone()
    } else {
        workspace_cwd.clone()
    };
    let paths = PathContext::new(&workspace_cwd);
    let stored_model = snapshot.model.clone();
    let stored_base_url = snapshot.base_url.clone();
    let stored_reasoning_effort = snapshot.reasoning_effort;
    let metadata = resolved_metadata
        .unwrap_or_else(|| resolve_model_metadata(snapshot.backend, &stored_model));
    if let Some(effort) = stored_reasoning_effort {
        if !metadata.thinking_level_map.is_supported(effort) {
            snapshot.reasoning_effort =
                metadata.thinking_level_map.closest_supported_effort(effort);
        }
    }
    let authoritative = metadata.source.is_authoritative();
    let snapshot_settings = EffectiveModelSettings::new_with_resolved(
        snapshot.backend,
        stored_model.clone(),
        stored_base_url.clone(),
        snapshot.reasoning_effort,
        snapshot.api_key_env.clone(),
        snapshot.extra_headers.clone(),
        metadata,
    )
    .map_err(|error| {
        anyhow::anyhow!(
            "stored session model settings are invalid; settings repair required: {error}"
        )
    })?;
    if snapshot_settings.model != stored_model || snapshot_settings.base_url != stored_base_url {
        anyhow::bail!(
            "stored session model settings are invalid; settings repair required: model and base_url must be stored in normalized nonblank form"
        );
    }
    if persist_recovery && snapshot.reasoning_effort != stored_reasoning_effort && authoritative {
        let migration_lease;
        if let Some(lease) = operation_lease {
            lease.validate(&store_path, &snapshot.session_id)?;
        } else {
            migration_lease =
                sessions::SessionOperationLease::try_acquire(&store_path, &snapshot.session_id)?;
            migration_lease.validate(&store_path, &snapshot.session_id)?;
        }
        snapshot.config_version = sessions::update_session_config(&store_path, &snapshot)?;
    }
    let client = ModelClient::from_effective_settings(snapshot_settings)
        .map_err(|error| {
            if error.downcast_ref::<ModelConfigurationError>().is_some() {
                let message = format!(
                    "stored session model settings are invalid; settings repair required: {error}"
                );
                error.context(message)
            } else {
                error
            }
        })?
        .with_cache_ttl(Some("1h"));
    let light_client = snapshot
        .light_model
        .as_ref()
        .map(|light| resolve_light_client(light, &snapshot.extra_headers))
        .transpose()
        .map_err(|error| match error {
            // The resolver classifies the failure at the source; add the
            // repair context without type-sniffing the chain. The boundary
            // renders the full chain once with `{:#}`.
            LightModelError::InvalidSettings(inner) => inner.context(
                "stored session light-model settings are invalid; settings repair required",
            ),
            // Keep the typed wrapper so its top-level context still names
            // the light model as the failing component.
            error @ LightModelError::Other(_) => anyhow::Error::from(error),
        })?
        .map(std::sync::Arc::new);
    let sandbox = if ssh.is_some() {
        None
    } else {
        match snapshot.sandbox_spec.clone() {
            Some(spec) => {
                let materialize = match &spec.worktree {
                    Some(worktree) => session_worktree::restore(
                        worktree,
                        session_worktree::checkout_in_container(&spec),
                    )?,
                    None => false,
                };
                let session_key = snapshot.session_id.clone();
                // A persisted container is owned by the durable session, not
                // by each process that observes it. Resume attachments must
                // never acquire destructive Drop authority: multiple servers
                // can legitimately observe the same stable container.
                let session = SandboxSession::create_for_durable_resume(
                    spec,
                    session_key.clone(),
                    session_key,
                )
                .await?;
                if materialize {
                    session.materialize_worktree().await?;
                    if let Some(worktree) = session.spec().worktree.as_ref() {
                        session_worktree::mark_materialized(worktree)?;
                    }
                }
                Some(session)
            }
            None => None,
        }
    };

    store::initialize(&store_path)?;

    let (skills, agents_md_status, agents_md_message) = if ssh.is_some() {
        let config_paths = PathContext::new(&config_cwd);
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        (skills, "off".to_string(), None)
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &paths)?;
        let message = (agent_mode == AgentMode::Direct)
            .then(|| agents_md.system_message())
            .flatten();
        (skills, agents_md.status_text(), message)
    };
    let working_directory = sandbox
        .as_ref()
        .map(super::super::sandbox::SandboxSession::workdir_display)
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let workspace_git = match ssh.clone() {
        Some(connection) => Some(GitTarget::ssh(
            connection,
            workspace_cwd.clone(),
            &config_cwd,
        )),
        None => match sandbox.as_ref() {
            Some(session) => session.host_workdir().map(GitTarget::local),
            None => Some(GitTarget::local(workspace_cwd.clone())),
        },
    };
    let sandbox_status = sandbox
        .as_ref()
        .map(super::super::sandbox::SandboxSession::status_text)
        .unwrap_or_else(|| "off".to_string());

    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: worker_command_output_limits(config)?,
            mode: agent_mode,
            session_behavior: Some(snapshot.behavior),
            store_path: store_path.clone(),
            session_id: Some(snapshot.session_id.clone()),
            orchestrator_compaction_threshold: snapshot.orchestrator_compaction_threshold,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd,
            config_cwd,
            working_directory: working_directory.clone(),
            worker_executable,
            sandbox,
            ssh,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
            light_client,
            permission_rules: config.permissions.rules.clone(),
        },
    )?;
    // Restore is blob ++ transcript log: rows the crashed previous run
    // appended after the last snapshot save are merged over the blob, and a
    // dangling tool turn is trimmed from both (crash-resume normalization).
    // An empty log tail is exactly the pre-log restore path.
    // Gap recovery can also rewrite the blob itself (a dangling turn trimmed
    // out of it): install the repaired blob so store-backed transcript reads
    // do not serve the discarded turn from the stale pre-repair snapshot.
    if let Some(repaired_blob) = agent
        .restore_messages_merging_log_tail(snapshot.messages.clone(), operation_lease)
        .await?
    {
        snapshot.messages = repaired_blob;
    }
    agent.restore_compaction_checkpoint()?;

    let session_id = snapshot.session_id.clone();
    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
            store_path,
            snapshot,
        },
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_git,
        resume_base_cwd,
    })
}

pub(super) fn normalize_snapshot_paths(
    mut snapshot: SessionSnapshot,
    resume_base_cwd: &Path,
) -> Result<SessionSnapshot> {
    // Remote cwd values are not local paths.
    if snapshot.ssh.is_some() {
        return Ok(snapshot);
    }

    let raw_cwd = if snapshot.cwd.is_absolute() {
        snapshot.cwd.clone()
    } else {
        resume_base_cwd.join(&snapshot.cwd)
    };
    snapshot.cwd = match raw_cwd.canonicalize() {
        Ok(cwd) => cwd,
        Err(_)
            if snapshot
                .sandbox_spec
                .as_ref()
                .is_some_and(|spec| spec.worktree.is_some()) =>
        {
            // The live checkout may have switched to a branch where this
            // subdirectory is absent. The persisted sandbox mounts still
            // identify the session worktree, which remains resumable.
            raw_cwd
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to resolve session cwd {}", raw_cwd.display()));
        }
    };
    Ok(snapshot)
}
