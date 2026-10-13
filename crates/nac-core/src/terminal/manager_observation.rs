//! Session-local projections of existing executions. Reads never reconcile,
//! spawn, retain, archive, acquire an agent lock or advance model cursors.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ExecutionOrigin {
    Human,
    Agent,
    HumanCommand,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ExecutionRepresentation {
    Pty,
    Log,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ExecutionProcessState {
    Running,
    CleanupPending,
    Settled,
}

/// Process settlement and collector completion are independent facts. IDs bind
/// this manager instance; artifact IDs are private implementation details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ExecutionStatus {
    pub id: String,
    pub origin: ExecutionOrigin,
    pub representation: ExecutionRepresentation,
    pub cwd: String,
    pub backend: String,
    pub request_id: Option<String>,
    pub alive: bool,
    pub process_state: ExecutionProcessState,
    pub exit_code: Option<i32>,
    pub output_complete: bool,
    pub output_error: Option<String>,
    pub input: bool,
    pub resize: bool,
    pub stop: bool,
    pub retained: bool,
    pub cols: u16,
    pub rows: u16,
}

pub(super) struct PipeExecution {
    status: StdMutex<ExecutionStatus>,
    output_id: String,
    cancellation: ThreadCancellation,
    started: AtomicBool,
}

pub(super) struct PipeExecutionGuard {
    execution: Arc<PipeExecution>,
}

impl PipeExecutionGuard {
    pub(super) fn started(&self) {
        self.execution.started.store(true, Ordering::Release);
    }
    pub(super) fn cancelled(&self) -> bool {
        self.execution.cancellation.is_cancelled()
    }
    pub(super) fn settle_process(&self, exit_code: Option<i32>, cleanup_pending: bool) {
        let mut status = self
            .execution
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        status.alive = cleanup_pending;
        status.process_state = if cleanup_pending {
            ExecutionProcessState::CleanupPending
        } else {
            ExecutionProcessState::Settled
        };
        status.stop = false;
        status.exit_code = if cleanup_pending { None } else { exit_code };
    }
    pub(super) fn finish(&self, error: Option<String>) {
        let mut status = self
            .execution
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        status.output_complete = true;
        status.output_error = error;
    }
}

impl Drop for PipeExecutionGuard {
    fn drop(&mut self) {
        let mut status = self
            .execution
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !status.output_complete {
            if status.alive {
                status.process_state = ExecutionProcessState::CleanupPending;
            }
            status.stop = false;
            status.output_error =
                Some("execution owner ended before collection was confirmed".into());
        }
    }
}

pub(crate) fn backend_label(backend: &ExecutionBackend) -> &'static str {
    match backend {
        ExecutionBackend::Local { .. } => "local",
        ExecutionBackend::Ssh(_) => "ssh",
        ExecutionBackend::Sandbox(_) => "podman",
    }
}

impl TerminalManager {
    /// Only the admitted human-command owner sets this private launch origin.
    pub(crate) fn for_human_command(&self, request_id: String) -> Self {
        let mut manager = self.clone();
        manager.human_command = Some(request_id);
        manager
    }

    pub(super) fn register_pipe(
        &self,
        output_id: &str,
        cwd: String,
        backend: &ExecutionBackend,
    ) -> Result<PipeExecutionGuard> {
        let mut executions = self
            .pipe_executions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        executions.retain(|execution| self.output_registry.stats(&execution.output_id).is_ok());
        // Command admission already reserves a bounded output artifact. The
        // observation registry cannot impose the separate PTY slot limit or
        // change whether an otherwise admitted pipe command can run.
        let execution = Arc::new(PipeExecution {
            status: StdMutex::new(ExecutionStatus {
                id: format!("execution-{}-{}", self.instance_id, uuid::Uuid::new_v4()),
                origin: if self.human_command.is_some() {
                    ExecutionOrigin::HumanCommand
                } else {
                    ExecutionOrigin::Agent
                },
                representation: ExecutionRepresentation::Log,
                cwd,
                backend: backend_label(backend).into(),
                request_id: self.human_command.clone(),
                alive: true,
                process_state: ExecutionProcessState::Running,
                exit_code: None,
                output_complete: false,
                output_error: None,
                input: false,
                resize: false,
                stop: true,
                retained: false,
                cols: 0,
                rows: 0,
            }),
            started: AtomicBool::new(false),
            output_id: output_id.to_owned(),
            cancellation: ThreadCancellation::default(),
        });
        executions.push_back(Arc::clone(&execution));
        Ok(PipeExecutionGuard { execution })
    }

    pub fn output_is_sanitized(&self, output_id: &str) -> bool {
        self.output_registry.is_sanitized(output_id)
    }

    pub async fn execution_catalog(&self) -> Vec<ExecutionStatus> {
        let completed = self.completed_sessions.lock().await;
        let sessions = self.sessions.lock().await;
        let mut statuses = sessions
            .iter()
            .map(|(id, session)| ExecutionStatus {
                id: id.clone(),
                origin: if session.is_user_owned() {
                    ExecutionOrigin::Human
                } else {
                    ExecutionOrigin::Agent
                },
                representation: ExecutionRepresentation::Pty,
                cwd: session.observation_cwd.clone(),
                backend: session.backend_label.clone(),
                request_id: None,
                alive: if session.is_user_owned() {
                    session.is_alive()
                } else {
                    session.exit_code().is_none()
                },
                process_state: if session.observation_cleanup_pending() {
                    ExecutionProcessState::CleanupPending
                } else if session.exit_code().is_some() {
                    ExecutionProcessState::Settled
                } else {
                    ExecutionProcessState::Running
                },
                exit_code: session.exit_code(),
                output_complete: session.output_complete(),
                output_error: session.output_error().map(str::to_owned),
                input: session.is_user_owned() && session.accepts_user_input(),
                resize: session.is_user_owned() && session.accepts_user_input(),
                stop: if session.is_user_owned() {
                    session.is_alive()
                } else {
                    session.exit_code().is_none() || !session.output_complete()
                },
                retained: session.is_retained(),
                cols: session.cols,
                rows: session.rows,
            })
            .collect::<Vec<_>>();
        statuses.extend(
            completed
                .iter()
                .filter(|(_, terminal)| self.output_registry.stats(&terminal.output_id).is_ok())
                .map(|(id, terminal)| ExecutionStatus {
                    id: id.clone(),
                    origin: if terminal.user_owned {
                        ExecutionOrigin::Human
                    } else {
                        ExecutionOrigin::Agent
                    },
                    representation: ExecutionRepresentation::Pty,
                    cwd: terminal.cwd.clone(),
                    backend: terminal.backend.clone(),
                    request_id: None,
                    alive: false,
                    process_state: ExecutionProcessState::Settled,
                    exit_code: terminal.exit_code,
                    output_complete: terminal.collector_state.complete(),
                    output_error: terminal.collector_state.error().map(str::to_owned),
                    input: false,
                    resize: false,
                    stop: false,
                    retained: false,
                    cols: terminal.cols,
                    rows: terminal.rows,
                }),
        );
        drop(sessions);
        drop(completed);
        statuses.extend(
            self.pipe_executions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .iter()
                .filter(|execution| {
                    execution.started.load(Ordering::Acquire)
                        && self.output_registry.stats(&execution.output_id).is_ok()
                })
                .map(|execution| {
                    execution
                        .status
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .clone()
                }),
        );
        statuses.sort_by(|left, right| left.id.cmp(&right.id));
        statuses
    }

    pub async fn execution_status(&self, id: &str) -> Result<ExecutionStatus> {
        self.execution_catalog()
            .await
            .into_iter()
            .find(|status| status.id == id)
            .ok_or_else(|| anyhow!("execution unavailable"))
    }

    pub async fn read_execution_output(
        &self,
        id: &str,
        offset: u64,
        limit: usize,
    ) -> Result<OutputBytePage> {
        self.read_execution_stream_output(id, OutputStream::Combined, offset, limit)
            .await
    }

    /// Shared read-only resolution for browser and model observers. Resolve
    /// ownership before touching the artifact, and require source-sanitized
    /// retained bytes rather than guessing a current-provider masking policy.
    pub(crate) async fn read_execution_stream_output(
        &self,
        id: &str,
        stream: OutputStream,
        offset: u64,
        limit: usize,
    ) -> Result<OutputBytePage> {
        let read = |output_id: &str| {
            if !self.output_registry.is_sanitized(output_id) {
                return Err(anyhow!("execution unavailable"));
            }
            self.read_output_bytes(output_id, stream, offset, limit)
                .map_err(|_| anyhow!("execution unavailable"))
        };
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(id) {
            return read(session.output_id());
        }
        drop(sessions);
        let completed = self.completed_sessions.lock().await;
        if let Some((_, terminal)) = completed.iter().find(|(name, _)| name == id) {
            return read(&terminal.output_id);
        }
        drop(completed);
        let pipes = self
            .pipe_executions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let execution = pipes
            .iter()
            .find(|execution| {
                execution
                    .status
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .id
                    == id
            })
            .ok_or_else(|| anyhow!("execution unavailable"))?;
        if !execution.started.load(Ordering::Acquire) {
            return Err(anyhow!("execution unavailable"));
        }
        read(&execution.output_id)
    }

    pub async fn stop_execution(&self, id: &str) -> Result<()> {
        let pipe = self
            .pipe_executions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .find(|execution| {
                execution
                    .status
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .id
                    == id
            })
            .cloned();
        if let Some(pipe) = pipe {
            pipe.cancellation.cancel();
            return Ok(());
        }
        self.execution_status(id).await?;
        self.terminate(id).await
    }
}

#[cfg(test)]
#[path = "manager_observation_tests.rs"]
mod tests;
