use super::*;

impl SessionService {
    pub fn from_orchestrator_run_config(
        mut run_config: OrchestratorRunConfig,
    ) -> SessionServiceParts {
        let behavior = run_config.session.behavior();
        let store_path = run_config.session.store_path();
        let session_id = run_config.session.session_id().map(str::to_string);
        let restored_messages = run_config.agent.messages.clone();
        let transcript_recovery_warning = run_config
            .agent
            .transcript_recovery_warning()
            .map(str::to_owned);
        let response_timing =
            ResponseTimingSnapshot::from_session_snapshot(match &run_config.session {
                OrchestratorSession::Active { snapshot, .. } => Some(snapshot),
                OrchestratorSession::Picker { .. } => None,
            });
        let config_version = match &run_config.session {
            OrchestratorSession::Active { snapshot, .. } => Some(snapshot.config_version),
            OrchestratorSession::Picker { .. } => None,
        };
        let project_id = match &run_config.session {
            OrchestratorSession::Active { snapshot, .. } => snapshot.project_id.clone(),
            OrchestratorSession::Picker { .. } => None,
        };

        let event_bus =
            SessionEventBus::with_thread_event_store(session_id.clone(), store_path.clone());
        let events = event_bus.subscribe();
        run_config
            .agent
            .set_event_sink(EventSink::bus(event_bus.clone()));
        let permission_broker = run_config
            .agent
            .configure_permission_broker(config_version.unwrap_or(0));
        if let Some(broker) = &permission_broker {
            broker.attach_event_bus(event_bus.clone());
        }
        if let Some(run_id) = run_config.agent.take_interrupted_run_recovery() {
            event_bus.emit_with_context(
                SessionEvent::RunFailed {
                    message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                },
                Some(SessionRunId::from_stored(run_id)),
                None,
            );
        }

        let workspace_git = run_config.workspace_git;
        let metadata = SessionMetadata {
            cwd: run_config.workspace_display,
            workspace_host_path: workspace_git
                .as_ref()
                .and_then(|target| target.local_path())
                .map(Path::to_path_buf),
            store_path,
            model: run_config.client.model.clone(),
            backend: run_config.client.backend().as_str().to_string(),
            session_id,
            behavior,
            project_id,
            sandbox_status: run_config.sandbox_status,
            agents_md_status: run_config.agents_md_status,
            base_url: run_config.client.base_url().to_string(),
            reasoning_effort: run_config
                .client
                .reasoning_effort()
                .map(|effort| effort.as_str().to_string()),
            api_key_env: run_config.client.api_key_env().map(str::to_string),
            extra_headers: run_config.client.extra_headers().clone(),
        };
        let session_snapshot = run_config.session.into_snapshot();
        let active_threads = run_config.agent.active_threads_handle();
        let transcript_log = run_config.agent.transcript_log_writer();
        let has_sandbox = run_config.agent.sandbox_session().is_some();
        let skills = run_config.agent.skills();
        let terminal_manager = run_config.agent.terminal_manager();
        if let Some(target) = workspace_git.as_ref() {
            terminal_manager.configure_workspace_authority(
                metadata.store_path.clone(),
                target.lease_identity(),
            );
        }
        if let Some(session_id) = metadata.session_id.clone() {
            terminal_manager
                .configure_session_resource_authority(metadata.store_path.clone(), session_id);
        }
        let goal_runtime = run_config.agent.goal_runtime();
        // The restored transcript is exactly the store transcript (blob ++
        // log tail) at construction, so the initial scan is an in-memory
        // pass; later scans read only the newly appended tail rows.
        let transcript_scan = if transcript_log.is_some() {
            TranscriptScanCache::from_transcript(&restored_messages)
        } else {
            TranscriptScanCache::default()
        };
        let service = Self {
            agent: Arc::new(Mutex::new(run_config.agent)),
            goal_runtime,
            metadata: Arc::new(metadata.clone()),
            workspace_git,
            config_version,
            session_snapshot: Arc::new(Mutex::new(session_snapshot)),
            transcript_recovery_warning: Arc::new(StdMutex::new(transcript_recovery_warning)),
            reconciled_recovery_run_id: Arc::new(StdMutex::new(None)),
            transcript_log,
            transcript_scan: Arc::new(StdMutex::new(transcript_scan)),
            event_bus,
            active_operation: Arc::new(StdMutex::new(None)),
            active_threads,
            skills,
            terminal_manager,
            permission_broker,
            sandbox_resource_lease: Arc::new(StdMutex::new(None)),
            has_sandbox,
            inbox_wake: Arc::new(Mutex::new(())),
            #[cfg(test)]
            frontend_snapshot_after_workspace_gate: None,
        };
        let init = SessionServiceInit {
            metadata,
            restored_messages,
            response_timing,
        };

        SessionServiceParts {
            service,
            init,
            events,
        }
    }

    pub fn connect_client(&self) -> SessionClientHandle {
        SessionClientHandle {
            service: self.clone(),
            client_id: SessionClientId::new(),
        }
    }

    pub async fn attach_client(&self) -> Result<SessionClientAttachment> {
        self.connect_client().attach().await
    }

    pub fn subscribe_events(&self) -> SessionEventReceiver {
        self.event_bus.subscribe()
    }

    pub fn recent_events(
        &self,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> (SessionEventBoundary, Vec<SessionEventEnvelope>) {
        self.event_bus.recent_events(cursor, limit)
    }

    pub fn subscribe_events_for_client(
        &self,
        client_id: SessionClientId,
    ) -> SessionEventSubscription {
        self.event_bus.subscribe_for_client(client_id)
    }

    pub fn subscribe_events_for_client_with_replay(
        &self,
        client_id: SessionClientId,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.event_bus
            .subscribe_for_client_with_replay(client_id, cursor, limit)
    }

    pub fn subscribe_agent_events(&self) -> AgentEventReceiver {
        let mut events = self.subscribe_events();
        let (tx, rx) = mpsc::unbounded_channel();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(envelope) => {
                            if let SessionEvent::Agent { event } = envelope.event {
                                if tx.send(event).is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }
        rx
    }

    pub fn metadata(&self) -> SessionMetadata {
        (*self.metadata).clone()
    }

    pub fn active_operation(&self) -> Option<ActiveSessionOperationSnapshot> {
        self.lock_active_operation()
            .as_ref()
            .map(ActiveSessionOperation::snapshot)
    }

    pub fn has_active_operation(&self) -> bool {
        self.lock_active_operation().is_some()
    }

    /// True while any client holds a live subscription to this session's event
    /// stream (an open SSE connection). A session with live subscribers must
    /// not be evicted from the server's in-memory cache: dropping the service
    /// would drop the event bus's broadcast senders and close their stream.
    pub fn has_event_subscribers(&self) -> bool {
        self.event_bus.has_subscribers()
    }

    /// True when this session executes inside a sandbox container. Idle
    /// eviction skips attached sandbox services so their shared resource
    /// lease continuously excludes peer deletion and configuration mutation.
    pub fn has_sandbox(&self) -> bool {
        self.has_sandbox
    }

    /// Establishes durable peer-visible ownership for an attached sandbox.
    /// Server construction calls this before publishing the service in its
    /// process-local cache.
    pub fn acquire_sandbox_resource_lease(&self) -> Result<()> {
        if !self.has_sandbox {
            return Ok(());
        }
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(());
        };
        let mut lease = self
            .sandbox_resource_lease
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if lease.is_none() {
            *lease = Some(
                sessions::SessionResourceLease::try_acquire(&self.metadata.store_path, session_id)
                    .map_err(anyhow::Error::new)?,
            );
        }
        Ok(())
    }

    /// Installs a shared lease acquired before resume-side resource
    /// materialization. This closes the peer deletion window without opening
    /// a second lock acquisition gap after the service is constructed.
    pub fn adopt_sandbox_resource_lease(&self, lease: sessions::SessionResourceLease) {
        if !self.has_sandbox {
            return;
        }
        let mut slot = self
            .sandbox_resource_lease
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        debug_assert!(slot.is_none());
        *slot = Some(lease);
    }

    /// Deletion is the only operation allowed to relinquish attached sandbox
    /// ownership before the service is dropped. It immediately takes the
    /// exclusive twin, so a peer attachment wins the race only by making the
    /// deletion fail closed.
    pub fn release_sandbox_resource_lease(&self) {
        self.sandbox_resource_lease
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
    }

    pub fn has_retained_terminals(&self) -> bool {
        self.terminal_manager.has_retained()
    }

    pub fn active_run(&self) -> Option<ActiveRunSnapshot> {
        match self.lock_active_operation().as_ref() {
            Some(ActiveSessionOperation::Run(active_run)) => Some(active_run.snapshot.clone()),
            _ => None,
        }
    }

    pub fn active_compaction(&self) -> Option<ActiveCompactionSnapshot> {
        match self.lock_active_operation().as_ref() {
            Some(ActiveSessionOperation::ManualCompaction(active_compaction)) => {
                Some(active_compaction.snapshot.clone())
            }
            _ => None,
        }
    }

    pub fn config_version(&self) -> Option<i64> {
        self.config_version
    }

    /// Explicitly destroy the sandbox container (if any) associated with this
    /// session, including when other `Arc` references keep the service alive.
    /// The durable deletion caller owns worktree cleanup after the session row
    /// commits; removing workspace files here would make a later database
    /// failure retain a session whose uncommitted work had already been lost.
    pub async fn destroy_sandbox(&self) -> Result<()> {
        let sandbox = {
            let agent = self.agent.lock().await;
            agent.sandbox_session()
        };
        if let Some(sandbox) = sandbox {
            sandbox.destroy().await?;
        }
        Ok(())
    }

    /// Terminates every session-owned terminal, including explicitly retained
    /// handles. Deletion calls this before removing durable session state so
    /// external service/client clones cannot keep processes alive.
    pub async fn destroy_terminals(&self) -> Result<()> {
        self.terminal_manager.remove_all().await
    }
}
