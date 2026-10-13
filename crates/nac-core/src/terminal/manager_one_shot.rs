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
        self.exec_one_shot_sanitized(
            cmd,
            cwd,
            _cols,
            _rows,
            yield_ms,
            max_output,
            backend,
            cancellation,
            extra_envs,
            nac_contracts::CommandEnvironmentSnapshot::empty(),
        )
        .await
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "pipe launch binds immutable output policy"
    )]
    #[expect(
        clippy::expect_used,
        reason = "spawn configures both pipes; only open readers retain the sanitizer"
    )]
    pub(crate) async fn exec_one_shot_sanitized(
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
        environment: nac_contracts::CommandEnvironmentSnapshot,
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
        self.output_registry.mark_sanitized(&output_id);
        let execution = match self.register_pipe(
            &output_id,
            environment.redact(
                &cwd.clone()
                    .unwrap_or_else(|| backend.default_terminal_cwd())
                    .to_string_lossy(),
            ),
            backend,
        ) {
            Ok(execution) => execution,
            Err(_) => {
                return CommandOutput {
                    status: CommandStatus::SpawnError,
                    exit_code: None,
                    wall_time_ms: 0,
                    stdout_preview: String::new(),
                    stderr_preview: "execution capacity reached".into(),
                    output_id: None,
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    truncated: false,
                    overflowed: false,
                }
            }
        };
        let mut sanitizer = Some(environment.pipe_redactor());
        let append = |chunks: Vec<(bool, Vec<u8>)>| -> Result<()> {
            for (stderr, bytes) in chunks {
                self.output_registry.append(
                    &output_id,
                    if stderr {
                        OutputStream::Stderr
                    } else {
                        OutputStream::Stdout
                    },
                    bytes,
                )?;
            }
            Ok(())
        };

        #[cfg(test)]
        let _one_shot_spawn = self.one_shot_spawn_gate.lock().await;

        // Registration and spawn are one synchronous cancellation mutation.
        // If cancellation takes the shared gate first, neither a local process
        // nor a remote transport/pidfile owner can appear afterward.
        let mut spawn = || {
            let remote_transport = match pidfile.as_deref() {
                Some(pidfile) => {
                    match self.register_remote_cleanup(pidfile, Arc::clone(backend), true) {
                        Ok(cleanup) => Some(RemoteTransportOwnership { cleanup }),
                        Err(error) => return (Err(std::io::Error::other(error.to_string())), None),
                    }
                }
                None => None,
            };
            let spawned = if self.isolate_process_groups {
                ProcessTreeGuard::spawn_supervised(&mut command)
            } else {
                ProcessTreeGuard::spawn_tracked(&mut command)
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
                    let _ = self.forget_remote_cleanup(pidfile);
                }
                return CommandOutput {
                    status: CommandStatus::SpawnError,
                    exit_code: None,
                    wall_time_ms: start.elapsed().as_millis() as u64,
                    stdout_preview: String::new(),
                    stderr_preview: environment
                        .redact(&format!("failed to spawn command: {error}")),
                    output_id: None,
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    truncated: false,
                    overflowed: false,
                };
            }
        };
        execution.started();
        let telemetry_session = self
            .session_resource_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(|(_, session_id)| session_id.clone());
        let _child_activity = crate::telemetry::ChildProcessGuard::start(
            child.id(),
            crate::telemetry::Correlation::session(telemetry_session.as_deref()),
        );
        let stdout = child.stdout.take().expect("piped stdout is present");
        let stderr = child.stderr.take().expect("piped stderr is present");
        let (sender, mut receiver) = mpsc::channel(PIPE_CHANNEL_CHUNKS);
        let reader_shutdown = ThreadCancellation::default();
        let mut stdout_reader = tokio::spawn(read_chunks(
            stdout,
            OutputStream::Stdout,
            sender.clone(),
            reader_shutdown.clone(),
        ));
        let mut stderr_reader = tokio::spawn(read_chunks(
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
        let mut cleanup_pending = false;
        let mut readers_open = true;
        let mut reader_results = None;
        let mut append_failed = false;

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

            if execution.cancelled() || cancellation.is_some_and(ThreadCancellation::is_cancelled) {
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
                            if let Err(error) = append(sanitizer.as_mut().expect("open readers retain sanitizer").push(chunk.stream == OutputStream::Stderr, &chunk.bytes)) {
                                append_failed = true;
                                status = CommandStatus::SpawnError;
                                runtime_error = Some(error.to_string());
                                break;
                            }
                        }
                        None => {
                            readers_open = false;
                            // Both sender owners ended and the queue is drained.
                            // Confirm actual EOF before flushing an incomplete
                            // secret prefix; process ownership can remain live.
                            let results = tokio::join!(&mut stdout_reader, &mut stderr_reader);
                            let confirmed = matches!(&results.0, Ok(Ok(true))) && matches!(&results.1, Ok(Ok(true)));
                            if confirmed {
                                if let Some(policy) = sanitizer.take() {
                                    if let Err(error) = append(policy.finish()) {
                                        append_failed = true;
                                        status = CommandStatus::SpawnError;
                                        runtime_error = Some(error.to_string());
                                    }
                                }
                            } else {
                                sanitizer.take(); // Never flush an unconfirmed suffix.
                            }
                            execution.finish((!confirmed || runtime_error.is_some()).then(|| "command output collection interrupted".into()));
                            reader_results = Some([results.0, results.1]);
                            if runtime_error.is_some() { break; }
                        },
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
                    cleanup_pending = true;
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
                        cleanup_pending = true;
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
                    cleanup_pending = true;
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

        execution.settle_process(
            if status == CommandStatus::Completed {
                exit_code
            } else {
                None
            },
            cleanup_pending,
            status,
        );
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
                    if append_failed || sanitizer.is_none() {
                        continue;
                    }
                    if let Err(error) = append(sanitizer.as_mut().expect("open readers retain sanitizer").push(chunk.stream == OutputStream::Stderr, &chunk.bytes)) {
                        record_output_error(error.to_string(), &mut status, &mut runtime_error);
                        append_failed = true;
                    }
                }
            }
        }

        let mut confirmed_eof = !append_failed;
        let results = match reader_results {
            Some(results) => results,
            None => {
                let results = tokio::join!(&mut stdout_reader, &mut stderr_reader);
                [results.0, results.1]
            }
        };
        for result in results {
            let message = match result {
                Ok(Ok(true)) => None,
                Ok(Ok(false)) => {
                    confirmed_eof = false;
                    None
                }
                Ok(Err(error)) => Some(format!("failed to read command output: {error}")),
                Err(error) => Some(format!("command output reader failed: {error}")),
            };
            if let Some(message) = message {
                confirmed_eof = false;
                record_output_error(message, &mut status, &mut runtime_error);
            }
        }

        if confirmed_eof {
            if let Some(policy) = sanitizer.take() {
                if let Err(error) = append(policy.finish()) {
                    confirmed_eof = false;
                    record_output_error(error.to_string(), &mut status, &mut runtime_error);
                }
            }
        }
        execution.finish((!confirmed_eof).then(|| "command output collection interrupted".into()));
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
            stderr_preview.push_str(&environment.redact(&error));
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
