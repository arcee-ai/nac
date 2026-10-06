//! Admission and effect ownership for independently submitted human commands.
use super::*;
use crate::store::TranscriptLogWriter;
use crate::tools::{kernel::ToolCallContext, ThreadCancellation, ToolRuntime};
use anyhow::Context;
use std::sync::atomic::Ordering;

pub(super) struct ActiveShellCommand {
    pub(super) snapshot: ShellCommandSnapshot,
    cancellation: ThreadCancellation,
}

impl ActiveShellCommand {
    pub(super) fn cancel_for_shutdown(&self) {
        self.cancellation.cancel();
    }
}

struct ShellTaskGuard {
    service: SessionService,
    operation_id: String,
}
impl Drop for ShellTaskGuard {
    fn drop(&mut self) {
        let mut operation = self.service.lock_active_operation();
        if matches!(operation.as_ref(), Some(ActiveSessionOperation::HumanShell(active))
            if active.snapshot.operation_id == self.operation_id)
        {
            *operation = None;
        }
        drop(operation);
        self.service.publish_shell_snapshot();
    }
}

fn store_error(error: impl std::fmt::Display) -> ShellCommandError {
    ShellCommandError::Store(error.to_string())
}

impl SessionService {
    fn publish_shell_snapshot(&self) {
        if let Some(session_id) = self.metadata.session_id.as_ref() {
            self.event_bus.emit(SessionEvent::SnapshotSaved {
                session_id: session_id.clone(),
            });
        }
    }
    pub async fn submit_shell_command(
        &self,
        request: ShellCommandRequest,
    ) -> std::result::Result<(ShellCommandSnapshot, bool), ShellCommandError> {
        let timeout = request
            .validate()
            .map_err(|e| ShellCommandError::Invalid(e.to_string()))?;
        // An owned caller keeps acceptance and launching adjacent even if the
        // HTTP future disappears while the journal commit is acknowledged.
        let service = self.clone();
        tokio::spawn(async move {
            crate::store::spawn_blocking_store_caller(move || {
                service.admit_shell_command(request, timeout)
            })
            .await
            .map_err(store_error)?
        })
        .await
        .map_err(store_error)?
    }

    fn admit_shell_command(
        &self,
        request: ShellCommandRequest,
        timeout: u64,
    ) -> std::result::Result<(ShellCommandSnapshot, bool), ShellCommandError> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or(ShellCommandError::Unsupported)?;
        let fingerprint = request.fingerprint(timeout);
        let mut operation = self.lock_active_operation();
        if let Some((stored, snapshot)) = crate::store::lookup_shell_command(
            &self.metadata.store_path,
            session_id,
            &request.request_id,
        )
        .map_err(store_error)?
        {
            if stored != fingerprint {
                return Err(ShellCommandError::Conflict);
            }
            if !snapshot.state.is_terminal() && operation.is_none() {
                if let Ok(lease) = sessions::SessionOperationLease::try_acquire(
                    &self.metadata.store_path,
                    session_id,
                ) {
                    self.reconcile_shell_commands_under_lease(&Arc::new(lease))
                        .map_err(store_error)?;
                    let (_, recovered) = crate::store::lookup_shell_command(
                        &self.metadata.store_path,
                        session_id,
                        &request.request_id,
                    )
                    .map_err(store_error)?
                    .ok_or_else(|| store_error("accepted command disappeared"))?;
                    return Ok((recovered, true));
                }
            }
            return Ok((snapshot, true));
        }
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            return Err(ShellCommandError::Unsupported);
        }
        if crate::store::load_traditional_child(&self.metadata.store_path, session_id)
            .map_err(store_error)?
            .is_some()
            || crate::store::load_managed_orchestrator(&self.metadata.store_path, session_id)
                .map_err(store_error)?
                .is_some()
        {
            return Err(ShellCommandError::Unsupported);
        }
        let _host_admission = if self.managed_admission_enabled {
            Some(
                match self.managed_identity.as_ref() {
                    Some(identity) => crate::store::try_admit_managed_work_for_identity(
                        &self.metadata.store_path,
                        identity,
                    ),
                    None => crate::store::try_admit_managed_work(&self.metadata.store_path),
                }
                .map_err(store_error)?,
            )
        } else {
            None
        };
        if operation.is_some() || self.stopping_admission.load(Ordering::Acquire) {
            return Err(ShellCommandError::Busy);
        }
        let (runtime, client) = self
            .agent
            .try_lock()
            .map_err(|_| ShellCommandError::Busy)?
            .shell_execution_context()
            .map_err(|_| ShellCommandError::Unsupported)?;
        let lease = Arc::new(
            self.prepare_operation_admission(None)
                .map_err(|e| match e {
                    OperationAdmissionPreparationError::ExternalBusy { .. } => {
                        ShellCommandError::Busy
                    }
                    OperationAdmissionPreparationError::Coordination { message } => {
                        store_error(message)
                    }
                })?
                .ok_or(ShellCommandError::Unsupported)?,
        );
        let recovery = crate::store::reconcile_active_run(&self.metadata.store_path, session_id)
            .map_err(store_error)?;
        if let crate::store::ActiveRunReconciliation::Interrupted { run_id } = recovery {
            self.event_bus.emit_with_context(
                SessionEvent::RunFailed {
                    message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                    failure: Some(crate::run_failure::RunFailure::interrupted(
                        INTERRUPTED_RUN_EVENT_MESSAGE,
                    )),
                },
                Some(SessionRunId::from_stored(run_id)),
                None,
            );
        }
        let workspace_lease = self
            .terminal_manager
            .acquire_workspace_activity_lease()
            .map_err(store_error)?;
        self.reconcile_shell_commands_under_lease(&lease)
            .map_err(store_error)?;
        let command = runtime
            .redact_output("", &request.command)
            .map_err(store_error)?;
        let snapshot = ShellCommandSnapshot {
            request_id: request.request_id,
            operation_id: Uuid::new_v4().to_string(),
            command,
            timeout_ms: timeout,
            state: ShellCommandState::Accepted,
            accepted_at_epoch_ms: now_epoch_ms(),
            finished_at_epoch_ms: None,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            diagnostic: None,
            output_id: None,
            transcript_index: None,
        };
        crate::store::accept_shell_command(
            &self.metadata.store_path,
            session_id,
            &fingerprint,
            &snapshot,
            &lease,
        )
        .map_err(store_error)?;
        #[cfg(test)]
        test_crash_barrier("accepted");
        *operation = Some(ActiveSessionOperation::HumanShell(ActiveShellCommand {
            snapshot: snapshot.clone(),
            cancellation: runtime.command_cancellation.clone(),
        }));
        let service = self.clone();
        let accepted = snapshot.clone();
        let submission = SubmittedShell::accepted(request.command, timeout);
        tokio::runtime::Handle::current().spawn(async move {
            let _guard = ShellTaskGuard {
                service: service.clone(),
                operation_id: accepted.operation_id.clone(),
            };
            let _workspace_lease = workspace_lease;
            if let Err(error) = service
                .execute_shell_command(accepted, submission, runtime, client, lease)
                .await
            {
                eprintln!("nac: human shell settlement failed: {error:#}");
            }
        });
        drop(operation);
        self.publish_shell_snapshot();
        Ok((snapshot, false))
    }

    async fn execute_shell_command(
        &self,
        mut snapshot: ShellCommandSnapshot,
        submission: SubmittedShell,
        runtime: ToolRuntime,
        client: crate::model::ModelClient,
        lease: Arc<sessions::SessionOperationLease>,
    ) -> Result<()> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .context("missing session id")?
            .to_owned();
        snapshot.state = ShellCommandState::Started;
        let path = self.metadata.store_path.clone();
        let started = snapshot.clone();
        let start_lease = Arc::clone(&lease);
        let start_session = session_id.clone();
        crate::store::spawn_blocking_store_caller(move || {
            crate::store::start_shell_command(&path, &start_session, &started, &start_lease)
        })
        .await??;
        {
            let mut active = self.lock_active_operation();
            if let Some(ActiveSessionOperation::HumanShell(command)) = active.as_mut() {
                if command.snapshot.operation_id == snapshot.operation_id {
                    command.snapshot = snapshot.clone();
                }
            }
        }
        #[cfg(test)]
        test_crash_barrier("started");
        self.publish_shell_snapshot();
        let context = ToolCallContext {
            call_id: Some(snapshot.operation_id.clone()),
            thread_name: None,
            cancellation: Some(runtime.command_cancellation.clone()),
        };
        let result =
            crate::tools::execute_submitted_shell(&submission, &runtime, &client, &context).await;
        let text = result
            .content
            .as_text()
            .unwrap_or("command returned a non-text result");
        let parsed = serde_json::from_str::<serde_json::Value>(text).ok();
        if let Some(output) = parsed.filter(|value| value.get("status").is_some()) {
            snapshot.output_id = output
                .get("output_id")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
            snapshot.exit_code = output
                .get("exit_code")
                .and_then(serde_json::Value::as_i64)
                .and_then(|v| v.try_into().ok());
            snapshot.stdout = output
                .get("stdout_preview")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            snapshot.stderr = output
                .get("stderr_preview")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            snapshot.state = match output.get("status").and_then(|v| v.as_str()) {
                Some("completed") => ShellCommandState::Completed,
                Some("timed_out") => ShellCommandState::TimedOut,
                Some("cancelled") => ShellCommandState::Cancelled,
                Some("spawn_error") if snapshot.output_id.is_none() => {
                    ShellCommandState::SpawnFailed
                }
                _ => ShellCommandState::OutcomeUnknown,
            };
        } else {
            snapshot.state = if runtime.command_cancellation.is_cancelled() {
                ShellCommandState::Cancelled
            } else {
                ShellCommandState::Rejected
            };
            snapshot.diagnostic = Some(runtime.redact_output("", text)?);
        }
        if let Some(output_id) = snapshot.output_id.as_deref() {
            let runtime = runtime.clone();
            let output_id = output_id.to_owned();
            let (stdout, stderr) = tokio::task::spawn_blocking(move || -> Result<_> {
                let stdout = super::shell_output::redacted_artifact(
                    &runtime,
                    &output_id,
                    crate::terminal::OutputStream::Stdout,
                )?;
                let stderr = super::shell_output::redacted_artifact(
                    &runtime,
                    &output_id,
                    crate::terminal::OutputStream::Stderr,
                )?;
                Ok((stdout, stderr))
            })
            .await??;
            snapshot.stdout = stdout
                .map(|(text, _)| text.chars().take(4_000).collect())
                .unwrap_or_default();
            snapshot.stderr = stderr
                .map(|(text, _)| text.chars().take(4_000).collect())
                .unwrap_or_default();
        }
        snapshot.finished_at_epoch_ms = Some(now_epoch_ms());
        #[cfg(test)]
        test_crash_barrier("result");
        let path = self.metadata.store_path.clone();
        crate::store::spawn_blocking_store_caller(move || {
            let writer =
                TranscriptLogWriter::for_run(&path, &session_id, &snapshot.operation_id, &lease)?;
            writer.finish_shell_command(&session_id, &snapshot)
        })
        .await??;
        Ok(())
    }

    fn reconcile_shell_commands_under_lease(
        &self,
        lease: &Arc<sessions::SessionOperationLease>,
    ) -> Result<()> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .context("missing session id")?;
        for mut snapshot in
            crate::store::list_shell_commands(&self.metadata.store_path, session_id)?
        {
            if snapshot.state.is_terminal() {
                continue;
            }
            snapshot.state = match snapshot.state {
                ShellCommandState::Accepted => ShellCommandState::Interrupted,
                _ => ShellCommandState::OutcomeUnknown,
            };
            snapshot.finished_at_epoch_ms = Some(now_epoch_ms());
            snapshot.diagnostic = Some("The previous owner ended before a durable result was recorded. This command will not be rerun.".into());
            let writer = TranscriptLogWriter::for_run(
                &self.metadata.store_path,
                session_id,
                &snapshot.operation_id,
                lease,
            )?;
            writer.finish_shell_command(session_id, &snapshot)?;
        }
        Ok(())
    }

    pub async fn shell_commands(&self) -> Result<Vec<ShellCommandSnapshot>> {
        let service = self.clone();
        crate::store::spawn_blocking_store_caller(move || {
            let session_id = service
                .metadata
                .session_id
                .as_deref()
                .context("missing session id")?;
            let commands =
                crate::store::list_shell_commands(&service.metadata.store_path, session_id)?;
            // Ordinary snapshot reads must not contend with model admission for
            // an operation lease. Only an unfinished command needs recovery.
            if commands.iter().all(|command| command.state.is_terminal()) {
                return Ok(commands);
            }
            let operation = service.lock_active_operation();
            if operation.is_none() {
                if let Ok(lease) = sessions::SessionOperationLease::try_acquire(
                    &service.metadata.store_path,
                    session_id,
                ) {
                    service.reconcile_shell_commands_under_lease(&Arc::new(lease))?;
                    return crate::store::list_shell_commands(
                        &service.metadata.store_path,
                        session_id,
                    );
                }
            }
            Ok(commands)
        })
        .await?
    }

    pub async fn lookup_shell_command(
        &self,
        request_id: &str,
    ) -> Result<Option<ShellCommandSnapshot>> {
        Ok(self
            .shell_commands()
            .await?
            .into_iter()
            .find(|command| command.request_id == request_id))
    }

    pub async fn cancel_shell_command(
        &self,
        request_id: &str,
    ) -> Result<Option<ShellCommandSnapshot>> {
        let cancellation = {
            let operation = self.lock_active_operation();
            match operation.as_ref() {
                Some(ActiveSessionOperation::HumanShell(command))
                    if command.snapshot.request_id == request_id =>
                {
                    Some(command.cancellation.clone())
                }
                _ => None,
            }
        };
        if let Some(cancellation) = cancellation {
            cancellation.cancel_async().await;
        }
        self.lookup_shell_command(request_id).await
    }
}

#[cfg(test)]
#[path = "shell_command_tests.rs"]
mod tests;

#[cfg(test)]
fn test_crash_barrier(stage: &str) {
    if std::env::var("NAC_HUMAN_CRASH_STAGE").as_deref() == Ok(stage) {
        std::fs::write(std::env::var_os("NAC_HUMAN_CRASH_REACHED").unwrap(), stage).unwrap();
        loop {
            std::thread::park();
        }
    }
}
