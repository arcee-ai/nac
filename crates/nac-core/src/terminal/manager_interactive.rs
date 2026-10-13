use super::*;

impl TerminalManager {
    pub fn next_session_name(&self) -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        format!(
            "shell-{}-{}",
            self.instance_id,
            COUNTER.fetch_add(1, Ordering::SeqCst)
        )
    }

    pub fn missing_session_error(&self, name: &str) -> anyhow::Error {
        if name.starts_with("shell-") && !name.starts_with(&format!("shell-{}-", self.instance_id))
        {
            anyhow!(
                "terminal session '{name}' belonged to a previous nac service instance and was lost when that process-local terminal owner stopped"
            )
        } else {
            anyhow!("terminal session '{name}' not found - it was closed or expired")
        }
    }

    #[cfg(test)]
    pub async fn create(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
    ) -> Result<TerminalInfo> {
        self.create_with_cancellation(name, command, cwd, cols, rows, backend, None)
            .await
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the compatibility entry point forwards explicit PTY construction authority"
    )]
    #[allow(
        dead_code,
        reason = "retained for native callers while production uses the environment-aware entry point"
    )]
    pub async fn create_with_cancellation(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<TerminalInfo> {
        self.create_with_environment(name, command, cwd, cols, rows, backend, cancellation, &[])
            .await
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "interactive creation keeps command, geometry, backend, cancellation, and environment explicit"
    )]
    pub async fn create_with_environment(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
        extra_envs: &[(String, String)],
    ) -> Result<TerminalInfo> {
        self.create_sanitized(
            name,
            command,
            cwd,
            cols,
            rows,
            backend,
            cancellation,
            extra_envs,
            nac_contracts::CommandEnvironmentSnapshot::empty(),
        )
        .await
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "PTY launch binds immutable output policy"
    )]
    pub(crate) async fn create_sanitized(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
        extra_envs: &[(String, String)],
        environment: nac_contracts::CommandEnvironmentSnapshot,
    ) -> Result<TerminalInfo> {
        // Capacity accounting, replacement, and insertion form one admission
        // transaction. Cleanup may await a remote backend, so a dedicated
        // gate keeps parallel creates from both consuming the same slot.
        let _create = self.create_gate.lock().await;
        if name.starts_with("user-shell-") {
            return Err(anyhow!(
                "user terminal identities are reserved for the human capability"
            ));
        }
        self.completed_sessions
            .lock()
            .await
            .retain(|(session_name, _)| session_name != &name);
        if self.sessions.lock().await.contains_key(&name) {
            self.kill_owned_session(&name, false)
                .await
                .with_context(|| {
                    format!("terminal session '{name}' cleanup incomplete during replacement")
                })?;
        }

        let exited = {
            let mut sessions = self.sessions.lock().await;
            sessions
                .iter_mut()
                .filter_map(|(name, session)| {
                    session.refresh_status();
                    (!session.is_alive()
                        && !session.native_cleanup_pending()
                        && (!session.is_user_owned() || session.output_complete()))
                    .then(|| name.clone())
                })
                .collect::<Vec<_>>()
        };
        for name in exited {
            if let Some(mut session) = self
                .kill_owned_session(&name, false)
                .await
                .with_context(|| format!("exited terminal session '{name}' cleanup incomplete"))?
            {
                self.remember_completed(&mut session).await;
            }
        }

        loop {
            let oldest_key = {
                let sessions = self.sessions.lock().await;
                if sessions.len() < self.max_sessions {
                    None
                } else {
                    let oldest_key = sessions
                        .iter()
                        .filter(|(_, session)| !session.is_retained())
                        .min_by_key(|(_, session)| session.created_at)
                        .map(|(key, _)| key.clone());
                    if oldest_key.is_none() {
                        return Err(anyhow!(
                        "terminal session limit reached: all {} sessions were explicitly retained",
                        self.max_sessions
                    ));
                    }
                    oldest_key
                }
            };
            let Some(oldest_key) = oldest_key else {
                break;
            };
            self.kill_owned_session(&oldest_key, true)
                .await
                .with_context(|| {
                    format!("terminal session '{oldest_key}' cleanup incomplete during eviction")
                })?;
        }

        // Take the map lock before spawning. `spawn` is synchronous, so there
        // is no cancellation point between acquiring the PTY/process and
        // transferring it into durable manager ownership.
        let mut sessions = self.sessions.lock().await;
        let info = match cancellation {
            Some(cancellation) => cancellation
                .run_if_active(|| {
                    let mut session = TerminalSession::spawn_with_output(
                        name.clone(),
                        command,
                        cwd,
                        cols,
                        rows,
                        backend,
                        self.output_registry.clone(),
                        extra_envs,
                        self.remote_cleanup_persistence(),
                        None,
                        None,
                        environment.pty_redactor(),
                    )?;
                    session.attach_child_telemetry(self.telemetry_correlation());
                    let info = self.session_info(&name, &session);
                    sessions.insert(name.clone(), session);
                    Ok::<_, anyhow::Error>(info)
                })
                .ok_or_else(|| anyhow!("terminal command cancelled before PTY spawn"))??,
            None => {
                let mut session = TerminalSession::spawn_with_output(
                    name.clone(),
                    command,
                    cwd,
                    cols,
                    rows,
                    backend,
                    self.output_registry.clone(),
                    extra_envs,
                    self.remote_cleanup_persistence(),
                    None,
                    None,
                    environment.pty_redactor(),
                )?;
                session.attach_child_telemetry(self.telemetry_correlation());
                let info = self.session_info(&name, &session);
                sessions.insert(name.clone(), session);
                info
            }
        };
        if let Some(session) = sessions.get(&name) {
            super::super::process_observation::start(
                Arc::downgrade(&self.sessions),
                name,
                session.output_id().to_owned(),
            );
        }
        Ok(info)
    }

    pub async fn write_stdin(
        &self,
        name: &str,
        input: &str,
        yield_ms: u64,
        max_output: usize,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<TerminalOutput> {
        let ticket = if input.is_empty() {
            None
        } else {
            let mut sessions = self.sessions.lock().await;
            if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                return Err(anyhow!("terminal command cancelled before input"));
            }
            let session = sessions
                .get_mut(name)
                .ok_or_else(|| self.missing_session_error(name))?;
            session.refresh_status();
            if !session.accepts_user_input() {
                return Err(anyhow!("terminal has exited"));
            }
            Some(
                session
                    .input_control()
                    .ticket(session.output_id(), super::super::InputController::Agent)?,
            )
        };
        self.write_stdin_prepared(
            name,
            input,
            yield_ms,
            max_output,
            cancellation,
            ticket.as_ref(),
        )
        .await
    }

    pub(crate) async fn write_stdin_prepared(
        &self,
        name: &str,
        input: &str,
        yield_ms: u64,
        max_output: usize,
        cancellation: Option<&ThreadCancellation>,
        ticket: Option<&super::super::InputTicket>,
    ) -> Result<TerminalOutput> {
        let start = Instant::now();
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            self.settle_run().await?;
            return Err(anyhow!("terminal command cancelled"));
        }
        let bytes = parse_keys(input);
        let completed = {
            let completed = self.completed_sessions.lock().await;
            completed
                .iter()
                .find(|(session_name, _)| session_name == name)
                .map(|(_, terminal)| terminal.clone())
        };
        if let Some(completed) = completed {
            if completed.user_owned {
                return Err(anyhow!(
                    "user-owned terminal is unavailable to model input or preview"
                ));
            }
            if !bytes.is_empty() {
                return Err(anyhow!("terminal session '{name}' has already exited"));
            }
            let preview = self.output_registry.preview_since(
                &completed.output_id,
                OutputStream::Combined,
                completed.preview_cursor,
                max_output,
            )?;
            if let Some((_, terminal)) = self
                .completed_sessions
                .lock()
                .await
                .iter_mut()
                .find(|(session_name, _)| session_name == name)
            {
                terminal.preview_cursor = preview.end_offset;
            }
            return Ok(TerminalOutput {
                session_name: None,
                retained: false,
                output_id: completed.output_id,
                start_cursor: preview.start_offset,
                end_cursor: preview.end_offset,
                content_preview: preview.content,
                truncated: preview.truncated,
                overflowed: preview.overflowed,
                exit_code: completed.exit_code,
                wall_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let (output_id, start_cursor, notify, receipt, control, human) = {
            let mut sessions = self.sessions.lock().await;
            let session = sessions
                .get_mut(name)
                .ok_or_else(|| self.missing_session_error(name))?;
            if session.is_user_owned() && bytes.is_empty() {
                return Err(anyhow!(
                    "human terminal preview requires the bounded output retrieval tool"
                ));
            }
            session.refresh_status();
            if !session.is_alive() && !bytes.is_empty() {
                return Err(anyhow!("terminal session '{name}' has already exited"));
            }
            let receipt = if !bytes.is_empty() {
                let ticket = ticket
                    .ok_or_else(|| anyhow!("prepared terminal input authority is missing"))?
                    .clone();
                let default_cancellation = ThreadCancellation::default();
                Some(session.enqueue_input(
                    &bytes,
                    ticket,
                    cancellation.unwrap_or(&default_cancellation),
                )?)
            } else {
                None
            };
            (
                session.output_id().to_string(),
                session.preview_cursor(),
                Arc::clone(session.output_notify()),
                receipt,
                session.input_control().clone(),
                session.is_user_owned(),
            )
        };

        if let Some(receipt) = receipt {
            let result = super::super::input::await_receipt(receipt).await;
            if result
                .as_ref()
                .is_err_and(|error| error.to_string().contains("unconfirmed"))
            {
                control.freeze();
            }
            result?;
            sleep(Duration::from_millis(50)).await;
        }
        if human {
            return Ok(TerminalOutput {
                session_name: Some(name.into()),
                retained: true,
                output_id,
                start_cursor: 0,
                end_cursor: 0,
                content_preview: String::new(),
                truncated: false,
                overflowed: false,
                exit_code: None,
                wall_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let wait_result = self
            .wait_for_pty_output(
                name,
                &output_id,
                start_cursor,
                yield_ms,
                notify,
                cancellation,
            )
            .await;
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            self.settle_run().await?;
            return Err(anyhow!("terminal command cancelled"));
        }
        wait_result?;
        let preview = match self.output_registry.preview_since(
            &output_id,
            OutputStream::Combined,
            start_cursor,
            max_output,
        ) {
            Ok(preview) => preview,
            Err(error) => {
                if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                    self.settle_run().await?;
                    return Err(anyhow!("terminal command cancelled"));
                }
                return Err(error);
            }
        };

        let (ended, retained) = {
            let mut sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get_mut(name) {
                session.set_preview_cursor(preview.end_offset);
                session.refresh_status();
                if session.is_alive() {
                    (false, session.is_retained())
                } else {
                    (true, false)
                }
            } else {
                (false, false)
            }
        };

        let (session_name, exit_code) = if ended {
            let mut session = self
                .kill_owned_session(name, false)
                .await
                .with_context(|| format!("exited terminal session '{name}' cleanup incomplete"))?
                .ok_or_else(|| self.missing_session_error(name))?;
            let exit_code = self.remember_completed(&mut session).await;
            (None, exit_code)
        } else {
            (Some(name.to_string()), None)
        };
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            self.settle_run().await?;
            return Err(anyhow!("terminal command cancelled"));
        }

        Ok(TerminalOutput {
            session_name,
            retained,
            output_id,
            start_cursor: preview.start_offset,
            end_cursor: preview.end_offset,
            content_preview: preview.content,
            truncated: preview.truncated,
            overflowed: preview.overflowed,
            exit_code,
            wall_time_ms: start.elapsed().as_millis() as u64,
        })
    }
}
