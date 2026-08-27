use super::*;

impl TerminalManager {
    #[expect(
        clippy::too_many_arguments,
        reason = "the compatibility entry point forwards explicit command execution authority"
    )]
    #[allow(
        dead_code,
        reason = "retained for native callers while production uses the environment-aware entry point"
    )]
    pub async fn exec_one_shot(
        &self,
        cmd: &str,
        cwd: Option<PathBuf>,
        _cols: u16,
        _rows: u16,
        yield_ms: u64,
        max_output: usize,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
    ) -> CommandOutput {
        self.exec_one_shot_with_environment(
            cmd,
            cwd,
            _cols,
            _rows,
            yield_ms,
            max_output,
            backend,
            cancellation,
            &[],
        )
        .await
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "one-shot execution keeps backend, bounds, cancellation, and environment explicit"
    )]
    #[expect(
        clippy::expect_used,
        reason = "the child command configures piped stdout and stderr immediately before spawn"
    )]
    pub async fn exec_one_shot_with_environment(
        &self,
        cmd: &str,
        cwd: Option<PathBuf>,
        _cols: u16,
        _rows: u16,
        yield_ms: u64,
        max_output: usize,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
        extra_envs: &[(String, String)],
    ) -> CommandOutput {
        let start = Instant::now();
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            return CommandOutput {
                status: CommandStatus::Cancelled,
                exit_code: None,
                wall_time_ms: start.elapsed().as_millis() as u64,
                stdout_preview: String::new(),
                stderr_preview: String::new(),
                output_id: None,
                stdout_bytes: 0,
                stderr_bytes: 0,
                truncated: false,
                overflowed: false,
            };
        }
        let mut envs = terminal_env_owned();
        envs.reserve(NONINTERACTIVE_PROMPT_ENV.len());
        envs.extend(
            NONINTERACTIVE_PROMPT_ENV
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string())),
        );
        envs.extend(extra_envs.iter().cloned());
        let (mut command, pidfile) = backend.terminal_pipe_command(cmd, cwd.as_deref(), &envs);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Reserve bounded output metadata before a process exists. The lease
        // stays active for the full command future (including cancellation)
        // and becomes evictable only after every reader has settled.
        let output_lease = match self.output_registry.create(ArtifactKind::Command) {
            Ok(lease) => lease,
            Err(error) => {
                return CommandOutput {
                    status: CommandStatus::SpawnError,
                    exit_code: None,
                    wall_time_ms: start.elapsed().as_millis() as u64,
                    stdout_preview: String::new(),
                    stderr_preview: error.to_string(),
                    output_id: None,
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    truncated: false,
                    overflowed: false,
                };
            }
        };
        let output_id = output_lease.output_id().to_string();

        #[cfg(test)]
        let _one_shot_spawn = self.one_shot_spawn_gate.lock().await;

        // Registration and spawn are one synchronous cancellation mutation.
        // If cancellation takes the shared gate first, neither a local process
        // nor a remote transport/pidfile owner can appear afterward.
        let mut spawn = || {
            let remote_transport = pidfile.as_deref().map(|pidfile| {
                let cleanup = Arc::new(PendingRemoteCleanup {
                    backend: Arc::clone(backend),
                    transport_active: AtomicBool::new(true),
                });
                self.pending_remote_cleanups
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(pidfile.to_string(), Arc::clone(&cleanup));
                RemoteTransportOwnership { cleanup }
            });
            let spawned = if self.isolate_process_groups {
                ProcessTreeGuard::spawn_supervised(&mut command)
            } else {
                command.spawn().map(|child| {
                    let guard = ProcessTreeGuard::for_child(&child);
                    (child, guard)
                })
            };
            (spawned, remote_transport)
        };
        let admitted = match cancellation {
            Some(cancellation) => cancellation.run_if_active(spawn),
            None => Some(spawn()),
        };
        let Some((spawned, remote_transport)) = admitted else {
            return CommandOutput {
                status: CommandStatus::Cancelled,
                exit_code: None,
                wall_time_ms: start.elapsed().as_millis() as u64,
                stdout_preview: String::new(),
                stderr_preview: String::new(),
                output_id: None,
                stdout_bytes: 0,
                stderr_bytes: 0,
                truncated: false,
                overflowed: false,
            };
        };
        let (mut child, mut process_tree) = match spawned {
            Ok(spawned) => spawned,
            Err(error) => {
                if let Some(remote_transport) = remote_transport.as_ref() {
                    remote_transport.stopped();
                }
                if let Some(pidfile) = pidfile.as_deref() {
                    self.forget_remote_cleanup(pidfile);
                }
                return CommandOutput {
                    status: CommandStatus::SpawnError,
                    exit_code: None,
                    wall_time_ms: start.elapsed().as_millis() as u64,
                    stdout_preview: String::new(),
                    stderr_preview: format!("failed to spawn command: {error}"),
                    output_id: None,
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    truncated: false,
                    overflowed: false,
                };
            }
        };
        let stdout = child.stdout.take().expect("piped stdout is present");
        let stderr = child.stderr.take().expect("piped stderr is present");
        let (sender, mut receiver) = mpsc::channel(PIPE_CHANNEL_CHUNKS);
        let reader_shutdown = ThreadCancellation::default();
        let stdout_reader = tokio::spawn(read_chunks(
            stdout,
            OutputStream::Stdout,
            sender.clone(),
            reader_shutdown.clone(),
        ));
        let stderr_reader = tokio::spawn(read_chunks(
            stderr,
            OutputStream::Stderr,
            sender,
            reader_shutdown.clone(),
        ));

        let deadline = start + Duration::from_millis(yield_ms);
        let mut status = CommandStatus::Completed;
        let mut exit_code = None;
        let mut runtime_error = None;
        let mut process_exited = false;
        let mut readers_open = true;

        while !process_exited {
            match child.try_wait() {
                Ok(Some(process_status)) => {
                    exit_code = Some(process_status.code().unwrap_or(-1));
                    process_exited = true;
                    continue;
                }
                Ok(None) => {}
                Err(error) => {
                    status = CommandStatus::SpawnError;
                    runtime_error = Some(format!("failed to wait for command: {error}"));
                    break;
                }
            }

            if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                status = CommandStatus::Cancelled;
                break;
            }
            if Instant::now() >= deadline {
                status = CommandStatus::TimedOut;
                break;
            }

            tokio::select! {
                chunk = receiver.recv(), if readers_open => {
                    match chunk {
                        Some(chunk) => {
                            if let Err(error) = self.output_registry.append(&output_id, chunk.stream, chunk.bytes) {
                                status = CommandStatus::SpawnError;
                                runtime_error = Some(error.to_string());
                                break;
                            }
                        }
                        None => readers_open = false,
                    }
                }
                _ = sleep(PROCESS_POLL_INTERVAL) => {}
                _ = async {
                    if let Some(cancellation) = cancellation {
                        cancellation.cancelled().await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                } => {
                    status = CommandStatus::Cancelled;
                    break;
                }
            }
        }

        let mut force_reader_shutdown = false;
        if !process_exited {
            // Stop the local transport first. A remote kill that observes no
            // pidfile is authoritative only after SSH/Podman can no longer
            // start the wrapper and create that pidfile afterwards.
            let transport_stopped = match process_tree.terminate(&mut child).await {
                Ok(()) => {
                    force_reader_shutdown = true;
                    true
                }
                Err(error) => {
                    reader_shutdown.cancel();
                    let cleanup_error = format!("command cleanup incomplete: {error}");
                    runtime_error = Some(match runtime_error.take() {
                        Some(existing) => format!("{existing}\n{cleanup_error}"),
                        None => cleanup_error,
                    });
                    false
                }
            };
            if transport_stopped {
                if let Some(remote_transport) = remote_transport.as_ref() {
                    remote_transport.stopped();
                }
            }
            if transport_stopped {
                if let Some(pidfile) = pidfile.as_deref() {
                    if let Err(error) = self.retry_remote_cleanup(pidfile).await {
                        runtime_error = Some(match runtime_error.take() {
                            Some(existing) => {
                                format!("{existing}\nremote command cleanup incomplete: {error}")
                            }
                            None => format!("remote command cleanup incomplete: {error}"),
                        });
                    }
                }
            }
            exit_code = None;
        } else {
            if let Some(remote_transport) = remote_transport.as_ref() {
                remote_transport.stopped();
            }
            if let Some(pidfile) = pidfile.as_deref() {
                if let Err(error) = self.retry_remote_cleanup(pidfile).await {
                    status = CommandStatus::SpawnError;
                    runtime_error = Some(format!(
                        "remote command completion cleanup incomplete: {error}"
                    ));
                }
            }
        }
        if process_exited && self.isolate_process_groups {
            // A successful shell leader can leave background descendants.
            // The dedicated owned group leader prevents pgid reuse while we
            // tear down that group after reaping the requested command.
            process_tree.mark_leader_reaped();
            process_tree.finish().await;
            force_reader_shutdown = true;
        } else if process_exited {
            process_tree.disarm();
        }

        let preserve_status = !process_exited;
        let record_output_error =
            |message: String, status: &mut CommandStatus, runtime_error: &mut Option<String>| {
                if preserve_status {
                    *runtime_error = Some(match runtime_error.take() {
                        Some(existing) => format!("{existing}\n{message}"),
                        None => message,
                    });
                } else {
                    *status = CommandStatus::SpawnError;
                    *runtime_error = Some(message);
                }
            };

        let reader_shutdown_timer = async {
            if force_reader_shutdown {
                sleep(READER_DRAIN_GRACE).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::pin!(reader_shutdown_timer);
        let mut reader_shutdown_pending = force_reader_shutdown;
        let mut append_failed = false;
        loop {
            tokio::select! {
                biased;
                _ = &mut reader_shutdown_timer, if reader_shutdown_pending => {
                    reader_shutdown.cancel();
                    reader_shutdown_pending = false;
                }
                chunk = receiver.recv() => {
                    let Some(chunk) = chunk else {
                        break;
                    };
                    if append_failed {
                        continue;
                    }
                    if let Err(error) = self.output_registry.append(
                        &output_id,
                        chunk.stream,
                        chunk.bytes,
                    ) {
                        record_output_error(error.to_string(), &mut status, &mut runtime_error);
                        append_failed = true;
                    }
                }
            }
        }

        for reader in [stdout_reader, stderr_reader] {
            let message = match reader.await {
                Ok(Ok(())) => None,
                Ok(Err(error)) => Some(format!("failed to read command output: {error}")),
                Err(error) => Some(format!("command output reader failed: {error}")),
            };
            if let Some(message) = message {
                record_output_error(message, &mut status, &mut runtime_error);
            }
        }

        let stats = self.output_registry.stats(&output_id).unwrap_or(
            crate::terminal::output::ArtifactStats {
                stdout_bytes: 0,
                stderr_bytes: 0,
                combined_bytes: 0,
                retained_bytes: 0,
                overflowed: false,
            },
        );
        let ((stdout_preview, stdout_truncated), (mut stderr_preview, stderr_truncated)) = self
            .output_registry
            .command_previews(&output_id, max_output)
            .unwrap_or_default();
        if let Some(error) = runtime_error {
            if !stderr_preview.is_empty() {
                stderr_preview.push('\n');
            }
            stderr_preview.push_str(&error);
        }

        CommandOutput {
            status,
            exit_code: if status == CommandStatus::Completed {
                exit_code
            } else {
                None
            },
            wall_time_ms: start.elapsed().as_millis() as u64,
            stdout_preview,
            stderr_preview,
            output_id: Some(output_id),
            stdout_bytes: stats.stdout_bytes,
            stderr_bytes: stats.stderr_bytes,
            truncated: stdout_truncated || stderr_truncated,
            overflowed: stats.overflowed,
        }
    }
}
