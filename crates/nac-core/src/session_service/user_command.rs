use serde_json::json;
use sha2::{Digest, Sha256};

use super::*;
use crate::model::ModelClient;
use crate::store::{UserCommandAdmitOutcome, UserCommandTerminal};
use crate::terminal::{CommandOutput, CommandStatus, OutputPage, OutputStream};
use crate::tools::kernel::{
    InvocationAuthority, ToolCallContext, ToolInvocationRejection, ToolServices,
};
use crate::tools::{ThreadCancellation, ToolResult, ToolRuntime};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 3_600_000;
const COMMIT_ATTEMPTS: usize = 3;

/// Proof that the session service admitted this exact submitted command.
#[derive(Clone, Debug)]
pub(crate) struct UserCommandAuthority(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserCommandRequest {
    pub request_id: String,
    pub command: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserCommandAdmission {
    pub command: UserCommandSnapshot,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserCommandSubmitError {
    Busy {
        active_operation: ActiveSessionOperationSnapshot,
    },
    ExternalBusy {
        session_id: String,
    },
    Conflict {
        request_id: String,
    },
    Invalid {
        message: String,
    },
    NotDirectPrimary,
    Coordination {
        message: SessionCoordinationError,
    },
}

impl std::fmt::Display for UserCommandSubmitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy {
                active_operation: ActiveSessionOperationSnapshot::UserCommand { .. },
            } => formatter.write_str("session is busy with a user command"),
            Self::Busy { .. } => formatter.write_str("session is busy with an active operation"),
            Self::ExternalBusy { session_id } => write!(
                formatter,
                "session '{session_id}' is busy with an active operation in another process"
            ),
            Self::Conflict { request_id } => write!(
                formatter,
                "user command request '{request_id}' was already submitted with a different command or timeout"
            ),
            Self::Invalid { message } => formatter.write_str(message),
            Self::NotDirectPrimary => {
                formatter.write_str("user commands are available only in direct primary sessions")
            }
            Self::Coordination { message } => message.fmt(formatter),
        }
    }
}

impl std::error::Error for UserCommandSubmitError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserCommandOutputError {
    NotFound,
    NotRetained,
    Store { message: String },
}

impl std::fmt::Display for UserCommandOutputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("user command not found"),
            Self::NotRetained => formatter.write_str("user command output is no longer retained"),
            Self::Store { message } => formatter.write_str(message),
        }
    }
}

impl std::error::Error for UserCommandOutputError {}

pub(super) struct ActiveUserCommandState {
    pub(super) snapshot: UserCommandSnapshot,
    cancellation: ThreadCancellation,
    _operation_lease: Arc<sessions::SessionOperationLease>,
    _workspace_activity_lease: Option<sessions::WorkspaceActivityLease>,
}

struct UserCommandExecution {
    runtime: ToolRuntime,
    client: ModelClient,
    cancellation: ThreadCancellation,
    lease: Arc<sessions::SessionOperationLease>,
}

pub(crate) async fn invoke_submitted_command(
    command: &str,
    timeout_ms: u64,
    runtime: &ToolRuntime,
    client: &ModelClient,
) -> Result<ToolResult, ToolInvocationRejection> {
    let context = ToolCallContext {
        authority: InvocationAuthority::SubmittedUserCommand(UserCommandAuthority(())),
        ..Default::default()
    };
    crate::tools::exec_command_snapshot()
        .invoke_authorized(
            "exec_command",
            json!({"cmd": command, "yield_time_ms": timeout_ms}),
            ToolServices { runtime, client },
            &context,
        )
        .await
}

#[expect(
    clippy::result_large_err,
    reason = "admission errors carry the complete active-operation conflict snapshot"
)]
fn effective_timeout(request: &UserCommandRequest) -> Result<u64, UserCommandSubmitError> {
    let invalid = |message: &str| UserCommandSubmitError::Invalid {
        message: message.to_owned(),
    };
    if request.request_id.trim().is_empty() {
        return Err(invalid("request_id must not be empty"));
    }
    if request.command.trim().is_empty() {
        return Err(invalid("command must not be empty"));
    }
    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if !(1..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(invalid("timeout_ms must be between 1 and 3600000"));
    }
    Ok(timeout_ms)
}

fn payload_digest(command: &str, timeout_ms: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update((command.len() as u64).to_be_bytes());
    hasher.update(command.as_bytes());
    hasher.update(timeout_ms.to_be_bytes());
    format!("{:x}", hasher.finalize())
}

fn store_error(context: &str, error: impl std::fmt::Display) -> UserCommandSubmitError {
    UserCommandSubmitError::Coordination {
        message: SessionCoordinationError::store(format!("{context}: {error:#}")),
    }
}

#[expect(
    clippy::result_large_err,
    reason = "admission errors carry the complete active-operation conflict snapshot"
)]
fn replay(
    existing: crate::store::StoredUserCommand,
    digest: &str,
    request_id: &str,
) -> Result<UserCommandAdmission, UserCommandSubmitError> {
    if existing.payload_digest != digest {
        return Err(UserCommandSubmitError::Conflict {
            request_id: request_id.to_owned(),
        });
    }
    Ok(UserCommandAdmission {
        command: existing.snapshot,
        replayed: true,
    })
}

fn terminal(
    from: UserCommandState,
    state: UserCommandState,
    result: Option<CommandOutput>,
    reason: Option<String>,
    process_started: bool,
) -> UserCommandTerminal {
    UserCommandTerminal {
        from,
        state,
        result,
        reason,
        process_started,
        finished_at_epoch_ms: now_epoch_ms(),
    }
}

fn invocation_terminal(
    outcome: Result<ToolResult, ToolInvocationRejection>,
    cancelled: bool,
) -> UserCommandTerminal {
    let from = UserCommandState::Executing;
    let unstarted = |state, reason| terminal(from, state, None, Some(reason), false);
    match outcome {
        Ok(result) => {
            let text = result.content.to_string();
            match serde_json::from_str::<CommandOutput>(&text) {
                Ok(output) => {
                    let state = match output.status {
                        CommandStatus::Completed => UserCommandState::Completed,
                        CommandStatus::TimedOut => UserCommandState::TimedOut,
                        CommandStatus::Cancelled => UserCommandState::Cancelled,
                        CommandStatus::SpawnError => UserCommandState::SpawnFailed,
                    };
                    let started = output.status != CommandStatus::SpawnError;
                    terminal(from, state, Some(output), None, started)
                }
                Err(_) if cancelled => unstarted(UserCommandState::Cancelled, text),
                Err(_) => unstarted(UserCommandState::Rejected, text),
            }
        }
        Err(rejection @ ToolInvocationRejection::Cancelled(_)) => unstarted(
            UserCommandState::Cancelled,
            rejection.reason("exec_command"),
        ),
        Err(rejection) if cancelled => unstarted(
            UserCommandState::Cancelled,
            rejection.reason("exec_command"),
        ),
        Err(rejection) => unstarted(UserCommandState::Rejected, rejection.reason("exec_command")),
    }
}

impl SessionService {
    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub fn submit_user_command_with_lease(
        &self,
        request: UserCommandRequest,
        lease: sessions::SessionOperationLease,
    ) -> Result<UserCommandAdmission, UserCommandSubmitError> {
        let timeout_ms = effective_timeout(&request)?;
        let Some(session_id) = self.metadata.session_id.clone() else {
            return Err(UserCommandSubmitError::NotDirectPrimary);
        };
        let path = self.metadata.store_path.clone();
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator
            || crate::store::load_traditional_child(&path, &session_id)
                .map_err(|error| {
                    store_error("failed to inspect traditional child relationship", error)
                })?
                .is_some()
        {
            return Err(UserCommandSubmitError::NotDirectPrimary);
        }
        let digest = payload_digest(&request.command, timeout_ms);
        if let Some(existing) =
            crate::store::find_user_command(&path, &session_id, &request.request_id)
                .map_err(|error| store_error("failed to look up user command", error))?
        {
            return replay(existing, &digest, &request.request_id);
        }
        let _host_admission = self
            .managed_admission_enabled
            .then(|| match self.managed_identity.as_deref() {
                Some(identity) => {
                    crate::store::try_admit_managed_work_for_identity(&path, identity)
                }
                None => crate::store::try_admit_managed_work(&path),
            })
            .transpose()
            .map_err(|error| store_error("failed to acquire managed host admission", error))?;
        let mut guard = self.lock_active_operation();
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(UserCommandSubmitError::Coordination {
                message: SessionCoordinationError::store(
                    "session is shutting down; new user commands are rejected".to_owned(),
                ),
            });
        }
        if let Some(active) = guard.as_ref() {
            return Err(UserCommandSubmitError::Busy {
                active_operation: active.snapshot(),
            });
        }
        let lease = self
            .prepare_operation_admission(Some(lease))
            .map_err(|error| match error {
                OperationAdmissionPreparationError::ExternalBusy { session_id } => {
                    UserCommandSubmitError::ExternalBusy { session_id }
                }
                OperationAdmissionPreparationError::Coordination { message } => {
                    UserCommandSubmitError::Coordination { message }
                }
            })?
            .map(Arc::new)
            .ok_or(UserCommandSubmitError::NotDirectPrimary)?;
        self.reconcile_interrupted_run(&session_id)
            .map_err(|message| UserCommandSubmitError::Coordination { message })?;
        let workspace_activity_lease = self
            .terminal_manager
            .acquire_workspace_activity_lease()
            .map_err(|error| store_error("failed to acquire workspace run authority", error))?;
        let (runtime, client, cancellation) = self
            .agent
            .try_lock()
            .map_err(|_| UserCommandSubmitError::Coordination {
                message: SessionCoordinationError::local_agent_busy(),
            })?
            .user_command_services();
        let cwd = runtime
            .backend
            .resolve_terminal_cwd(None)
            .map_err(|error| store_error("failed to resolve the command directory", error))?
            .map(|cwd| cwd.display().to_string());
        let admitted = match crate::store::admit_user_command(
            &path,
            &session_id,
            &request.request_id,
            &digest,
            &request.command,
            timeout_ms,
            cwd.as_deref(),
        )
        .map_err(|error| store_error("failed to admit user command", error))?
        {
            UserCommandAdmitOutcome::Admitted(snapshot) => snapshot,
            UserCommandAdmitOutcome::Existing(existing) => {
                return replay(existing, &digest, &request.request_id);
            }
            UserCommandAdmitOutcome::Busy(command) => {
                return Err(UserCommandSubmitError::Busy {
                    active_operation: ActiveSessionOperationSnapshot::UserCommand {
                        command: Box::new(command),
                    },
                });
            }
        };
        *guard = Some(ActiveSessionOperation::UserCommand(
            ActiveUserCommandState {
                snapshot: admitted.clone(),
                cancellation: cancellation.clone(),
                _operation_lease: Arc::clone(&lease),
                _workspace_activity_lease: workspace_activity_lease,
            },
        ));
        drop(guard);
        self.emit_user_command(admitted.clone());
        let service = self.clone();
        let command = admitted.clone();
        tokio::spawn(async move {
            let execution = UserCommandExecution {
                runtime,
                client,
                cancellation,
                lease,
            };
            service.execute_user_command(command, execution).await;
        });
        Ok(UserCommandAdmission {
            command: admitted,
            replayed: false,
        })
    }

    pub async fn user_command(&self, request_id: &str) -> Result<Option<UserCommandSnapshot>> {
        let Some(session_id) = self.metadata.session_id.clone() else {
            return Ok(None);
        };
        let path = self.metadata.store_path.clone();
        let request_id = request_id.to_owned();
        Ok(crate::store::spawn_blocking_store_caller(move || {
            crate::store::find_user_command(&path, &session_id, &request_id)
        })
        .await??
        .map(|stored| stored.snapshot))
    }

    /// Cancels this service's own non-terminal command and returns the current snapshot.
    pub async fn cancel_user_command(
        &self,
        request_id: &str,
    ) -> Result<Option<UserCommandSnapshot>> {
        if let Some(ActiveSessionOperation::UserCommand(active)) =
            self.lock_active_operation().as_ref()
        {
            if active.snapshot.request_id == request_id {
                active.cancellation.cancel();
            }
        }
        self.user_command(request_id).await
    }

    pub async fn read_user_command_output(
        &self,
        request_id: &str,
        stream: OutputStream,
        offset: u64,
        limit: usize,
    ) -> Result<OutputPage, UserCommandOutputError> {
        let command = self
            .user_command(request_id)
            .await
            .map_err(|error| UserCommandOutputError::Store {
                message: format!("failed to look up user command: {error:#}"),
            })?
            .ok_or(UserCommandOutputError::NotFound)?;
        let output_id = command
            .output_id
            .ok_or(UserCommandOutputError::NotRetained)?;
        let redaction = self
            .command_redactions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&output_id)
            .cloned()
            .ok_or(UserCommandOutputError::NotRetained)?;
        let mut page = self
            .terminal_manager
            .read_output(&output_id, stream, offset, limit)
            .map_err(|_| UserCommandOutputError::NotRetained)?;
        page.content = redaction.redact(&page.content);
        Ok(page)
    }

    pub fn active_user_command(&self) -> Option<UserCommandSnapshot> {
        match self.active_operation() {
            Some(ActiveSessionOperationSnapshot::UserCommand { command }) => Some(*command),
            _ => None,
        }
    }

    pub(super) async fn load_user_commands(&self) -> Result<Vec<UserCommandSnapshot>> {
        let Some(session_id) = self.metadata.session_id.clone() else {
            return Ok(Vec::new());
        };
        let path = self.metadata.store_path.clone();
        crate::store::spawn_blocking_store_caller(move || {
            crate::store::list_user_commands(&path, &session_id)
        })
        .await?
    }

    pub(super) fn emit_user_command(&self, command: UserCommandSnapshot) {
        self.event_bus.emit_with_context(
            SessionEvent::UserCommandUpdated {
                command: Box::new(command),
            },
            None,
            None,
        );
    }

    async fn execute_user_command(
        &self,
        mut command: UserCommandSnapshot,
        execution: UserCommandExecution,
    ) {
        let terminal = self.run_admitted_command(&mut command, &execution).await;
        if let Err(error) = self
            .commit_user_command_terminal(&command, &terminal, &execution.lease)
            .await
        {
            eprintln!(
                "nac: user command {} terminal commit failed: {error:#}",
                command.request_id
            );
        }
        if let Err(error) = self.update_transcript_scan().await {
            eprintln!("nac: transcript scan after user command failed: {error:#}");
        }
        let request_id = command.request_id.clone();
        let cleared = {
            let request_id = request_id.clone();
            self.coordinate_local(move |service| service.clear_user_command(&request_id))
                .await
        };
        if let Err(error) = cleared {
            eprintln!("nac: user command local cleanup failed: {error:#}");
        }
        match self.user_command(&request_id).await {
            Ok(Some(settled)) => self.emit_user_command(settled),
            Ok(None) => {}
            Err(error) => eprintln!("nac: user command lookup after terminal failed: {error:#}"),
        }
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return;
        }
        let woke = match Arc::try_unwrap(execution.lease) {
            Ok(lease) => {
                let _wake = self.inbox_wake.lock().await;
                self.start_next_direct_inbox_item_with_lease_async(lease)
                    .await
            }
            Err(lease) => {
                drop(lease);
                self.start_next_direct_inbox_item().await
            }
        };
        if let Err(error) = woke {
            eprintln!("nac: direct inbox wake after user command failed: {error:#}");
        }
    }

    /// Spawns only after this executor committed Admitted to Executing.
    async fn run_admitted_command(
        &self,
        command: &mut UserCommandSnapshot,
        execution: &UserCommandExecution,
    ) -> UserCommandTerminal {
        let admitted = UserCommandState::Admitted;
        if execution.cancellation.is_cancelled() {
            return terminal(
                admitted,
                UserCommandState::Cancelled,
                None,
                Some("cancelled before the command started".to_owned()),
                false,
            );
        }
        let (path, session_id, request_id) = (
            self.metadata.store_path.clone(),
            self.metadata.session_id.clone().unwrap_or_default(),
            command.request_id.clone(),
        );
        let marked = crate::store::spawn_blocking_store_caller(move || {
            crate::store::mark_user_command_executing(&path, &session_id, &request_id)
        })
        .await
        .and_then(|marked| marked);
        let executing = match &marked {
            Ok(true) => true,
            Ok(false) | Err(_) => self
                .user_command(&command.request_id)
                .await
                .ok()
                .flatten()
                .is_some_and(|row| row.state == UserCommandState::Executing),
        };
        if !executing {
            let reason = match marked {
                Err(error) => format!("the command could not be started: {error:#}"),
                Ok(_) => "the command could not be started".to_owned(),
            };
            return terminal(
                admitted,
                UserCommandState::Rejected,
                None,
                Some(reason),
                false,
            );
        }
        command.state = UserCommandState::Executing;
        self.publish_executing(command.clone());
        let outcome = invoke_submitted_command(
            &command.command,
            command.timeout_ms,
            &execution.runtime,
            &execution.client,
        )
        .await;
        invocation_terminal(outcome, execution.cancellation.is_cancelled())
    }

    fn publish_executing(&self, command: UserCommandSnapshot) {
        if let Some(ActiveSessionOperation::UserCommand(active)) =
            self.lock_active_operation().as_mut()
        {
            if active.snapshot.request_id == command.request_id {
                active.snapshot = command.clone();
            }
        }
        self.emit_user_command(command);
    }

    async fn commit_user_command_terminal(
        &self,
        command: &UserCommandSnapshot,
        terminal: &UserCommandTerminal,
        lease: &Arc<sessions::SessionOperationLease>,
    ) -> Result<()> {
        let record = crate::store::user_command_record(&command.finished(terminal));
        let (path, session_id, request_id, terminal, lease) = (
            self.metadata.store_path.clone(),
            self.metadata.session_id.clone().unwrap_or_default(),
            command.request_id.clone(),
            terminal.clone(),
            Arc::clone(lease),
        );
        crate::store::spawn_blocking_store_caller(move || {
            let writer = crate::store::TranscriptLogWriter::for_user_command(
                &path,
                &session_id,
                &request_id,
                &lease,
            )?;
            let mut attempt = 1;
            loop {
                match writer.commit_user_command(&session_id, &request_id, &record, &terminal) {
                    Err(error)
                        if attempt < COMMIT_ATTEMPTS
                            && error.downcast_ref::<crate::store::TranscriptAppendError>()
                                == Some(&crate::store::TranscriptAppendError::CommitUncertain) =>
                    {
                        attempt += 1;
                    }
                    result => return result.map(|_| ()),
                }
            }
        })
        .await?
    }

    fn clear_user_command(&self, request_id: &str) {
        let mut operation = self.lock_active_operation();
        if matches!(
            operation.as_ref(),
            Some(ActiveSessionOperation::UserCommand(active)) if active.snapshot.request_id == request_id
        ) {
            *operation = None;
        }
    }
}

#[cfg(test)]
#[path = "user_command_tests.rs"]
mod tests;
