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

    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
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

    #[allow(clippy::too_many_arguments)]
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
        // Capacity accounting, replacement, and insertion form one admission
        // transaction. Cleanup may await a remote backend, so a dedicated
        // gate keeps parallel creates from both consuming the same slot.
        let _create = self.create_gate.lock().await;
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
                    (!session.is_alive()).then(|| name.clone())
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
                    let session = TerminalSession::spawn(
                        name.clone(),
                        command,
                        cwd,
                        cols,
                        rows,
                        backend,
                        self.output_registry.clone(),
                        extra_envs,
                    )?;
                    let info = self.session_info(&name, &session);
                    sessions.insert(name.clone(), session);
                    Ok::<_, anyhow::Error>(info)
                })
                .ok_or_else(|| anyhow!("terminal command cancelled before PTY spawn"))??,
            None => {
                let session = TerminalSession::spawn(
                    name.clone(),
                    command,
                    cwd,
                    cols,
                    rows,
                    backend,
                    self.output_registry.clone(),
                    extra_envs,
                )?;
                let info = self.session_info(&name, &session);
                sessions.insert(name, session);
                info
            }
        };
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
        let (output_id, start_cursor, notify) =
            {
                let mut sessions = self.sessions.lock().await;
                let session = sessions
                    .get_mut(name)
                    .ok_or_else(|| self.missing_session_error(name))?;
                session.refresh_status();
                if !session.is_alive() && !bytes.is_empty() {
                    return Err(anyhow!("terminal session '{name}' has already exited"));
                }
                if !bytes.is_empty() {
                    match cancellation {
                        Some(cancellation) => cancellation
                            .run_if_active(|| session.write(&bytes))
                            .ok_or_else(|| anyhow!("terminal command cancelled before input"))??,
                        None => session.write(&bytes)?,
                    }
                }
                (
                    session.output_id().to_string(),
                    session.preview_cursor(),
                    session.output_notify().clone(),
                )
            };

        if !bytes.is_empty() {
            sleep(Duration::from_millis(50)).await;
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
