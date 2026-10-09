//! Native, session-bound operations for independently retained human terminals.
//! Authorization belongs to the session service; these handles never enter the
//! model tool registry or its textual input/preview path.

use super::*;

impl TerminalManager {
    pub(crate) fn user_terminal_name(&self, launch_id: uuid::Uuid) -> String {
        format!("user-{}-{launch_id}", self.next_session_name())
    }

    pub(crate) async fn resolve_user_terminal_launch(&self, launch_id: uuid::Uuid) -> String {
        let suffix = format!("-{launch_id}");
        let live = self
            .sessions
            .lock()
            .await
            .iter()
            .find(|(name, session)| session.is_user_owned() && name.ends_with(&suffix))
            .map(|(name, _)| name.clone());
        if let Some(name) = live {
            return name;
        }
        let completed = self
            .completed_sessions
            .lock()
            .await
            .iter()
            .find(|(name, session)| session.user_owned && name.ends_with(&suffix))
            .map(|(name, _)| name.clone());
        if let Some(name) = completed {
            return name;
        }
        // Expired bounded history can require a fresh launch, but its process
        // identity is never reused: old input/resize/close handles stay stale.
        self.user_terminal_name(launch_id)
    }

    pub(crate) fn owns_user_terminal_name(&self, name: &str) -> bool {
        name.strip_prefix(&format!("user-shell-{}-", self.instance_id))
            .and_then(|suffix| suffix.split_once('-'))
            .is_some_and(|(counter, launch)| {
                counter.parse::<u64>().is_ok() && uuid::Uuid::parse_str(launch).is_ok()
            })
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "native launch binds geometry, backend, environment and lifetime cancellation"
    )]
    pub(crate) async fn create_user_terminal(
        &self,
        name: String,
        command: &str,
        cwd: PathBuf,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        environment: nac_contracts::CommandEnvironmentSnapshot,
        expected_config_version: Option<i64>,
        cancellation: &ThreadCancellation,
    ) -> Result<()> {
        validate_geometry(cols, rows)?;
        if !self.owns_user_terminal_name(&name) || !self.preserve_retained_on_settlement {
            return Err(anyhow!(
                "user terminal requires the current direct-session owner"
            ));
        }
        if !matches!(backend.as_ref(), ExecutionBackend::Local { .. }) {
            return Err(anyhow!(
                "user terminal support is currently limited to the Local backend"
            ));
        }
        let _create = self.create_gate.lock().await;
        if self
            .sessions
            .lock()
            .await
            .get(&name)
            .is_some_and(TerminalSession::is_user_owned)
            || self
                .completed_sessions
                .lock()
                .await
                .iter()
                .any(|(id, session)| id == &name && session.user_owned)
        {
            return Ok(());
        }
        let exited = {
            let mut sessions = self.sessions.lock().await;
            sessions
                .iter_mut()
                .filter_map(|(id, session)| {
                    session.refresh_status();
                    (session.is_user_owned()
                        && session.output_complete()
                        && session.exit_code().is_some())
                    .then(|| id.clone())
                })
                .collect::<Vec<_>>()
        };
        for id in exited {
            if let Some(mut session) = self.kill_owned_session(&id, false).await? {
                self.remember_completed(&mut session).await;
            }
        }
        // User admission never evicts another live command to make room.
        if self.sessions.lock().await.len() >= self.max_sessions {
            return Err(anyhow!("terminal session limit reached"));
        }
        // Acquire cross-process lifecycle protection before a child can exist.
        // These shared resource leases are not the agent's workspace write gate.
        let workspace_activity = self.acquire_workspace_activity_lease()?;
        let session_resource = self.acquire_session_resource_lease()?;
        if let Some(expected) = expected_config_version {
            let (store_path, session_id) = self
                .session_resource_authority
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
                .ok_or_else(|| {
                    anyhow!("user terminal session configuration authority is missing")
                })?;
            let current = crate::store::spawn_blocking_store_caller(move || {
                crate::sessions::load_session_config(&store_path, &session_id)
                    .map(|config| config.config_version)
            })
            .await??;
            if current != expected {
                return Err(anyhow!(
                    "session configuration changed before terminal launch; reattach and retry"
                ));
            }
        }
        let envs = environment
            .iter()
            .map(|(key, value)| (key.to_owned(), value.to_owned()))
            .collect::<Vec<_>>();
        let mut sessions = self.sessions.lock().await;
        cancellation
            .run_if_active(|| {
                let mut session = TerminalSession::spawn_with_output(
                    name.clone(),
                    command,
                    Some(cwd),
                    cols,
                    rows,
                    backend,
                    self.output_registry.clone(),
                    &envs,
                    self.remote_cleanup_persistence(),
                    Some(environment.stream_redactor()),
                )?;
                session.retain(workspace_activity, session_resource);
                session.attach_child_telemetry(self.telemetry_correlation());
                sessions.insert(name, session);
                Ok::<_, anyhow::Error>(())
            })
            .ok_or_else(|| anyhow!("user terminal launch cancelled before spawn"))??;
        Ok(())
    }

    pub(crate) async fn user_terminal_status(
        &self,
        name: &str,
    ) -> Result<super::super::UserTerminalStatus> {
        self.check_user_name(name)?;
        let _create = self.create_gate.lock().await;
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions
            .get_mut(name)
            .filter(|session| session.is_user_owned())
        {
            session.refresh_status();
            let status = super::super::UserTerminalStatus {
                id: name.to_owned(),
                cols: session.cols,
                rows: session.rows,
                alive: session.is_alive(),
                exit_code: session.exit_code(),
                output_complete: session.output_complete(),
                output_error: session.output_error().map(str::to_owned),
            };
            if !status.output_complete || status.exit_code.is_none() {
                return Ok(status);
            }
            drop(sessions);
            // Drain before archival, then release lifetime leases on actual
            // process exit. Failed cleanup stays manager-owned for retry.
            if let Some(mut session) = self.kill_owned_session(name, false).await? {
                self.remember_completed(&mut session).await;
            }
            return Ok(status);
        }
        drop(sessions);
        let completed = self.completed_sessions.lock().await;
        let terminal = completed
            .iter()
            .find(|(id, terminal)| id == name && terminal.user_owned)
            .map(|(_, terminal)| terminal)
            .ok_or_else(|| self.missing_user_error())?;
        Ok(super::super::UserTerminalStatus {
            id: name.to_owned(),
            cols: terminal.cols,
            rows: terminal.rows,
            alive: false,
            exit_code: terminal.exit_code,
            output_complete: terminal.collector_state.complete(),
            output_error: terminal.collector_state.error().map(str::to_owned),
        })
    }

    pub(crate) async fn user_terminal_names(&self) -> Vec<String> {
        let mut names = self
            .sessions
            .lock()
            .await
            .iter()
            .filter(|(_, session)| session.is_user_owned())
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        names.extend(
            self.completed_sessions
                .lock()
                .await
                .iter()
                .filter(|(_, terminal)| terminal.user_owned)
                .map(|(id, _)| id.clone()),
        );
        names.sort();
        names.dedup();
        names
    }

    pub(crate) async fn read_user_output(
        &self,
        name: &str,
        offset: u64,
        limit: usize,
    ) -> Result<OutputBytePage> {
        self.check_user_name(name)?;
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(name).filter(|session| session.is_user_owned()) {
            return self.read_output_bytes(
                session.output_id(),
                OutputStream::Combined,
                offset,
                limit,
            );
        }
        drop(sessions);
        let completed = self.completed_sessions.lock().await;
        let terminal = completed
            .iter()
            .find(|(id, terminal)| id == name && terminal.user_owned)
            .map(|(_, terminal)| terminal)
            .ok_or_else(|| self.missing_user_error())?;
        self.read_output_bytes(&terminal.output_id, OutputStream::Combined, offset, limit)
    }

    pub(crate) async fn write_user_input(
        &self,
        name: &str,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
    ) -> Result<()> {
        self.check_user_name(name)?;
        if bytes.len() > 16 * 1024 {
            return Err(anyhow!("terminal input exceeds 16384 bytes"));
        }
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .filter(|session| session.is_user_owned())
            .ok_or_else(|| self.missing_user_error())?;
        session.refresh_status();
        if !session.is_alive() {
            return Err(anyhow!("user terminal has exited"));
        }
        // Admission, not blocking delivery, is the cancellation boundary.
        // Literal bytes bypass model key-name parsing and preserve FIFO order.
        let receipt = session.enqueue_user_input(bytes, cancellation)?;
        drop(sessions);
        super::super::input::await_receipt(receipt).await
    }

    pub(crate) async fn wait_user_output(
        &self,
        name: &str,
        observed_end: u64,
        wait_ms: u16,
    ) -> Result<()> {
        self.check_user_name(name)?;
        if wait_ms > 1000 {
            return Err(anyhow!("terminal output wait exceeds 1000 milliseconds"));
        }
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(name).filter(|session| session.is_user_owned()) else {
            drop(sessions);
            self.user_terminal_status(name).await?;
            return Ok(());
        };
        let notify = Arc::clone(session.output_notify());
        let output_id = session.output_id().to_owned();
        let state = session.collector_state();
        drop(sessions);
        let notified = notify.notified();
        tokio::pin!(notified);
        // Register before the current-end check; collection may advance or
        // finish between a caller's empty page and this observation.
        notified.as_mut().enable();
        if state.complete() || self.output_registry.stats(&output_id)?.combined_bytes > observed_end
        {
            return Ok(());
        }
        let _ = tokio::time::timeout(Duration::from_millis(u64::from(wait_ms)), notified).await;
        Ok(())
    }

    pub(crate) async fn resize_user_terminal(
        &self,
        name: &str,
        cols: u16,
        rows: u16,
        cancellation: &ThreadCancellation,
    ) -> Result<()> {
        self.check_user_name(name)?;
        validate_geometry(cols, rows)?;
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .filter(|session| session.is_user_owned())
            .ok_or_else(|| self.missing_user_error())?;
        session.refresh_status();
        if !session.is_alive() {
            return Err(anyhow!("user terminal has exited"));
        }
        cancellation
            .run_if_active(|| session.resize(cols, rows))
            .ok_or_else(|| anyhow!("user terminal resize cancelled"))?
    }

    pub(crate) async fn terminate_user_terminal(&self, name: &str) -> Result<()> {
        self.check_user_name(name)?;
        self.terminate(name).await
    }

    fn check_user_name(&self, name: &str) -> Result<()> {
        if self.owns_user_terminal_name(name) {
            Ok(())
        } else {
            Err(self.missing_user_error())
        }
    }

    fn missing_user_error(&self) -> anyhow::Error {
        anyhow!("user terminal is unavailable for this session owner; it may have exited or its NAC owner restarted")
    }
}

pub(crate) fn validate_geometry(cols: u16, rows: u16) -> Result<()> {
    if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
        return Err(anyhow!(
            "terminal geometry must be 2..=500 columns and 1..=300 rows"
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "manager_user_tests.rs"]
mod tests;
