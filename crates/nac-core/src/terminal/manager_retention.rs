use super::*;

impl TerminalManager {
    pub fn read_output(
        &self,
        output_id: &str,
        stream: OutputStream,
        offset: u64,
        limit: usize,
    ) -> Result<OutputPage> {
        self.output_registry.page(output_id, stream, offset, limit)
    }

    #[cfg(test)]
    pub(crate) async fn set_backend_cleanup_for_test(
        &self,
        name: &str,
        backend: Arc<ExecutionBackend>,
        pidfile: String,
    ) -> Result<()> {
        self.sessions
            .lock()
            .await
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?
            .set_backend_cleanup_for_test(backend, pidfile);
        Ok(())
    }

    pub async fn remove_all(&self) -> Result<()> {
        let names = self
            .sessions
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut cleanup_errors = Vec::new();
        for name in names {
            if let Err(error) = self.kill_owned_session(&name, false).await {
                cleanup_errors.push(format!(
                    "terminal session '{name}' cleanup incomplete during removal: {error:#}"
                ));
            }
        }
        if let Err(error) = self.retry_pending_remote_cleanups().await {
            cleanup_errors.push(error.to_string());
        }
        if cleanup_errors.is_empty() {
            self.completed_sessions.lock().await.clear();
            self.output_registry.clear();
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("; ")))
        }
    }

    pub async fn settle_run(&self) -> Result<()> {
        if !self.preserve_retained_on_settlement {
            return self.remove_all().await;
        }
        let foreground = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, session)| !session.is_retained())
                .map(|(name, _)| name.clone())
                .collect::<Vec<_>>()
        };
        let mut cleanup_errors = Vec::new();
        for name in foreground {
            if let Err(error) = self.kill_owned_session(&name, true).await {
                cleanup_errors.push(format!(
                    "foreground terminal session '{name}' cleanup incomplete: {error:#}"
                ));
            }
        }
        if let Err(error) = self.retry_pending_remote_cleanups().await {
            cleanup_errors.push(error.to_string());
        }
        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("; ")))
        }
    }

    /// Kill a session while it remains manager-owned. Holding the map entry
    /// across every await makes dropping the cleanup future cancellation-safe:
    /// a later caller can still find the handle and retry backend cleanup.
    pub(super) async fn kill_owned_session(
        &self,
        name: &str,
        preserve_if_retained: bool,
    ) -> Result<Option<TerminalSession>> {
        let mut sessions = self.sessions.lock().await;
        let Some(session) = sessions.get_mut(name) else {
            return Ok(None);
        };
        // Selection and cleanup use different lock acquisitions so retain can
        // win in between. Recheck under the same lock held through kill;
        // once retain has reported success, settlement/eviction cannot kill
        // that session.
        if preserve_if_retained && session.is_retained() {
            return Ok(None);
        }
        session.kill().await?;
        Ok(sessions.remove(name))
    }

    pub(super) fn register_remote_cleanup(
        &self,
        pidfile: &str,
        backend: Arc<ExecutionBackend>,
        transport_active: bool,
    ) -> Result<Arc<PendingRemoteCleanup>> {
        if let Some((store_path, session_id, _)) = self
            .remote_cleanup_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            crate::store::record_terminal_remote_cleanup(store_path, session_id, pidfile)?;
        }
        let cleanup = Arc::new(PendingRemoteCleanup {
            backend,
            transport_active: AtomicBool::new(transport_active),
        });
        self.pending_remote_cleanups
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(pidfile.to_string(), Arc::clone(&cleanup));
        Ok(cleanup)
    }

    pub(super) fn forget_remote_cleanup(&self, pidfile: &str) -> Result<()> {
        if let Some((store_path, session_id, _)) = self
            .remote_cleanup_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            crate::store::clear_terminal_remote_cleanup(store_path, session_id, pidfile)?;
        }
        self.pending_remote_cleanups
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(pidfile);
        Ok(())
    }

    pub(super) async fn retry_remote_cleanup(&self, pidfile: &str) -> Result<()> {
        let cleanup = self
            .pending_remote_cleanups
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(pidfile)
            .cloned();
        let Some(cleanup) = cleanup else {
            return Ok(());
        };
        if cleanup.transport_active.load(Ordering::SeqCst) {
            return Err(anyhow!(
                "local transport for remote command '{pidfile}' is still active"
            ));
        }
        cleanup.backend.terminal_pipe_kill(pidfile).await?;
        self.forget_remote_cleanup(pidfile)?;
        Ok(())
    }

    async fn retry_pending_remote_cleanups(&self) -> Result<()> {
        let pidfiles = self
            .pending_remote_cleanups
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut errors = Vec::new();
        for pidfile in pidfiles {
            if let Err(error) = self.retry_remote_cleanup(&pidfile).await {
                errors.push(format!(
                    "remote one-shot command cleanup for '{pidfile}' remains incomplete: {error:#}"
                ));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(errors.join("; ")))
        }
    }

    #[cfg(test)]
    pub(super) fn pending_remote_cleanup_count(&self) -> usize {
        self.pending_remote_cleanups
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    #[cfg(test)]
    pub async fn retain(&self, name: &str) -> Result<TerminalInfo> {
        self.retain_with_cancellation(name, None).await
    }

    pub(crate) async fn retain_with_cancellation(
        &self,
        name: &str,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !session.is_alive() {
            return Err(anyhow!("terminal session '{name}' has already exited"));
        }
        let workspace_activity = self.acquire_workspace_activity_lease()?;
        let session_resource = self.acquire_session_resource_lease()?;
        match cancellation {
            Some(cancellation) => cancellation
                .run_if_active(|| session.retain(workspace_activity, session_resource))
                .ok_or_else(|| anyhow!("terminal command cancelled before retention"))?,
            None => session.retain(workspace_activity, session_resource),
        }
        Ok(self.session_info(name, session))
    }

    pub fn has_retained(&self) -> bool {
        self.sessions
            .try_lock()
            .map(|mut sessions| {
                sessions.values_mut().any(|session| {
                    session.refresh_status();
                    // An exited remote transport can still own a live backend
                    // process. Keep its service until polling or explicit
                    // teardown runs the pidfile cleanup.
                    session.is_retained()
                })
            })
            // A concurrent terminal operation is not a safe eviction point.
            .unwrap_or(true)
    }

    /// Process-local terminal identities that can still own a live local or
    /// remote process. Completed retained output is deliberately excluded.
    pub async fn live_terminal_names(&self) -> Vec<String> {
        // Preparation is a non-waiting query. A concurrent terminal cleanup
        // is itself a blocker rather than something the controller queues
        // behind for seconds.
        let Ok(mut tombstones) = self.completed_sessions.try_lock() else {
            return vec!["terminal-output-settlement".to_string()];
        };
        let Ok(mut sessions) = self.sessions.try_lock() else {
            return vec!["terminal-cleanup-in-progress".to_string()];
        };
        let mut names = Vec::new();
        let mut reap = Vec::new();
        for (name, session) in sessions.iter_mut() {
            session.refresh_status();
            if session.is_alive() || session.has_backend_cleanup() || session.exit_code().is_none()
            {
                names.push(name.clone());
            } else {
                reap.push(name.clone());
            }
        }
        for name in reap {
            if let Some(session) = sessions.remove(&name) {
                let completed = CompletedTerminal {
                    output_id: session.output_id().to_string(),
                    preview_cursor: session.preview_cursor(),
                    exit_code: session.exit_code(),
                };
                tombstones.retain(|(session_name, _)| session_name != &name);
                tombstones.push_back((name, completed));
                while tombstones.len() > self.max_sessions {
                    tombstones.pop_front();
                }
            }
        }
        drop(sessions);
        drop(tombstones);
        let remote = match self.pending_remote_cleanups.try_lock() {
            Ok(remote) => remote,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => {
                names.push("remote-cleanup-in-progress".to_string());
                names.sort();
                names.dedup();
                return names;
            }
        };
        // A stopped launcher with a failed backend kill still owns a remote
        // process obligation. Every pending cleanup is therefore a blocker,
        // independently of the local transport state.
        names.extend(remote.keys().cloned());
        names.sort();
        names.dedup();
        names
    }

    #[cfg(test)]
    pub(crate) async fn get(&self, name: &str) -> Option<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        sessions.get_mut(name).map(|session| {
            session.refresh_status();
            self.session_info(&session.name, session)
        })
    }

    pub(super) fn session_info(&self, name: &str, session: &TerminalSession) -> TerminalInfo {
        TerminalInfo {
            name: name.to_string(),
            cwd: session.cwd.clone(),
            cols: session.cols,
            rows: session.rows,
            alive: session.is_alive(),
            retained: session.is_retained(),
            idle_ms: session.idle_duration().as_millis() as u64,
            pid: session.pid(),
        }
    }

    pub(super) async fn remember_completed(&self, session: &mut TerminalSession) -> Option<i32> {
        let exit_code = session
            .wait_for_exit_code()
            .await
            .or_else(|| session.exit_code());
        let completed = CompletedTerminal {
            output_id: session.output_id().to_string(),
            preview_cursor: session.preview_cursor(),
            exit_code,
        };
        let mut tombstones = self.completed_sessions.lock().await;
        tombstones.retain(|(name, _)| name != &session.name);
        tombstones.push_back((session.name.clone(), completed));
        while tombstones.len() > self.max_sessions {
            tombstones.pop_front();
        }
        exit_code
    }

    pub(super) async fn wait_for_pty_output(
        &self,
        name: &str,
        output_id: &str,
        start_cursor: u64,
        yield_ms: u64,
        notify: Arc<tokio::sync::Notify>,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<()> {
        let deadline = Instant::now() + Duration::from_millis(yield_ms);
        loop {
            if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                return Err(anyhow!("terminal command cancelled"));
            }
            let alive = {
                let mut sessions = self.sessions.lock().await;
                let session = sessions
                    .get_mut(name)
                    .ok_or_else(|| anyhow!("terminal session vanished"))?;
                session.refresh_status();
                session.is_alive()
            };
            let end = self.output_registry.stats(output_id)?.combined_bytes;
            if !alive || Instant::now() >= deadline {
                return Ok(());
            }
            if end > start_cursor {
                tokio::task::yield_now().await;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            tokio::select! {
                biased;
                _ = async {
                    if let Some(cancellation) = cancellation {
                        cancellation.cancelled().await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                } => return Err(anyhow!("terminal command cancelled")),
                _ = notify.notified() => {}
                _ = sleep(remaining) => return Ok(()),
            }
        }
    }
}
