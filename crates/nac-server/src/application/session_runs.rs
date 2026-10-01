use anyhow::{anyhow, Result};
use nac_core::{
    commands::PreparedUserInput,
    events::{
        AssistantStreamDeltaReceiver, SessionEventBoundary, SessionEventEnvelope, SessionReplayGap,
    },
    session_service::{SessionCancelError, SessionEventReceiver},
    sessions,
    store::ManagedOrchestratorExecutionMode,
};

use crate::{frontend_command_name, SessionManager};

pub(crate) struct SubmittedRun {
    pub(crate) run_id: String,
    pub(crate) client_id: Option<String>,
    pub(crate) display_prompt: String,
}

pub(crate) struct OrchestratorSteering {
    pub(crate) steering_id: i64,
    pub(crate) status: String,
    pub(crate) instruction_preview: String,
}

pub(crate) struct ThreadSteering {
    pub(crate) steering_id: i64,
    pub(crate) thread_name: String,
    pub(crate) status: String,
    pub(crate) instruction_preview: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExactCancelOutcome {
    CancelledOrInactive,
    ActiveRunMismatch,
}

pub(crate) type EventSubscription = (
    String,
    u64,
    Option<SessionReplayGap>,
    Vec<SessionEventEnvelope>,
    SessionEventReceiver,
    AssistantStreamDeltaReceiver,
);

/// Run admission, steering, event subscription, and cancellation use cases.
///
/// Admission deliberately holds the per-session lifecycle gate while taking
/// the durable operation lease and establishing active-run state. Approval or
/// cancellation cannot change the already-selected execution backend.
pub(crate) struct SessionRunApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionRunApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn submit(&self, session_id: &str, prompt: String) -> Result<SubmittedRun> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Primary,
            )
            .await?;
        self.submit_with_admission(session_id, prompt, None).await
    }

    pub(crate) async fn submit_managed_orchestrator(
        &self,
        session_id: &str,
        prompt: String,
        execution_mode: ManagedOrchestratorExecutionMode,
    ) -> Result<SubmittedRun> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        self.submit_with_admission(session_id, prompt, Some(execution_mode))
            .await
    }

    async fn submit_with_admission(
        &self,
        session_id: &str,
        prompt: String,
        managed_mode: Option<ManagedOrchestratorExecutionMode>,
    ) -> Result<SubmittedRun> {
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let operation_lease = sessions::SessionOperationLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        )?;
        if managed_mode.is_some() {
            self.manager
                .validate_operation_session(
                    session_id,
                    super::persistence::OperationSessionScope::Persisted,
                )
                .await?;
        } else {
            self.manager
                .validate_operation_session(
                    session_id,
                    super::persistence::OperationSessionScope::Primary,
                )
                .await?;
        }
        let service = self
            .manager
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await?;
        let client = service.connect_client();
        let prepared = match client.prepare_user_input(&prompt) {
            PreparedUserInput::Empty => Err(anyhow!("prompt is empty")),
            PreparedUserInput::InvalidSlashCommand { message } => Err(anyhow!(message)),
            PreparedUserInput::FrontendCommand(command) => Err(anyhow!(
                "frontend command '{}' is not supported by the server API",
                frontend_command_name(command)
            )),
            PreparedUserInput::McpPrompt(invocation) => {
                Ok(service.resolve_mcp_prompt(invocation).await?)
            }
            PreparedUserInput::SubmitPrompt(prompt) => Ok(prompt),
        }?;
        let display_prompt = prepared.display_prompt.clone();
        let handle = nac_core::store::spawn_blocking_store_caller(move || {
            match managed_mode {
                Some(execution_mode) => client
                    .try_submit_prepared_managed_orchestrator_prompt_with_lease(
                        prepared,
                        operation_lease,
                        execution_mode,
                    ),
                None => client.try_submit_prepared_prompt_with_lease(prepared, operation_lease),
            }
            .map_err(anyhow::Error::new)
        })
        .await??;
        Ok(SubmittedRun {
            run_id: handle.run_id.to_string(),
            client_id: handle
                .client_id
                .as_ref()
                .map(std::string::ToString::to_string),
            display_prompt,
        })
    }

    pub(crate) async fn queue_thread_steering(
        &self,
        session_id: &str,
        thread_name: &str,
        instruction: String,
    ) -> Result<ThreadSteering> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Primary,
            )
            .await?;
        self.queue_thread_steering_for_run(session_id, thread_name, instruction, None)
            .await
    }

    pub(crate) async fn queue_thread_steering_for_run(
        &self,
        session_id: &str,
        thread_name: &str,
        instruction: String,
        expected_run_id: Option<&str>,
    ) -> Result<ThreadSteering> {
        let service = self.manager.attach_session(session_id).await?;
        let thread_name = thread_name.to_owned();
        let expected_run_id = expected_run_id.map(str::to_owned);
        let record = self
            .manager
            .inner
            ._store_ownership
            .call_legacy(move || {
                service.queue_thread_steering_for_run(
                    &thread_name,
                    &instruction,
                    expected_run_id.as_deref(),
                )
            })
            .await??;
        Ok(ThreadSteering {
            steering_id: record.id,
            thread_name: record.thread_name,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
    }

    pub(crate) async fn queue_orchestrator_steering(
        &self,
        session_id: &str,
        instruction: String,
    ) -> Result<OrchestratorSteering> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Primary,
            )
            .await?;
        self.queue_orchestrator_steering_unchecked(session_id, instruction)
            .await
    }

    pub(crate) async fn queue_orchestrator_steering_unchecked(
        &self,
        session_id: &str,
        instruction: String,
    ) -> Result<OrchestratorSteering> {
        let service = self.manager.attach_session(session_id).await?;
        let record = self
            .manager
            .inner
            ._store_ownership
            .call_legacy(move || service.queue_orchestrator_steering(&instruction))
            .await??;
        Ok(OrchestratorSteering {
            steering_id: record.id,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
    }

    pub(crate) fn queue_managed_orchestrator_steering(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
        instruction: &str,
    ) -> Result<OrchestratorSteering> {
        let record = nac_core::store::queue_managed_orchestrator_steering(
            &self.manager.inner.store_path,
            parent_session_id,
            orchestrator_session_id,
            instruction,
        )?;
        Ok(OrchestratorSteering {
            steering_id: record.id,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
    }

    pub(crate) async fn recent_events(
        &self,
        session_id: &str,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<(SessionEventBoundary, Vec<SessionEventEnvelope>)> {
        Ok(self
            .manager
            .attach_session(session_id)
            .await?
            .recent_events(cursor, limit))
    }

    pub(crate) async fn subscribe_events(
        &self,
        session_id: &str,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<EventSubscription> {
        let subscription = self
            .manager
            .attach_session(session_id)
            .await?
            .connect_client()
            .subscribe_events_with_replay(cursor, limit);
        Ok((
            subscription.epoch_id,
            subscription.replay_boundary_sequence_id,
            subscription.replay_gap,
            subscription.replayed_events,
            subscription.receiver,
            subscription.assistant_deltas,
        ))
    }

    pub(crate) async fn cancel(&self, session_id: &str) -> Result<()> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Primary,
            )
            .await?;
        self.cancel_unchecked(session_id).await
    }

    pub(crate) async fn cancel_exact(&self, session_id: &str, expected_run_id: &str) -> Result<()> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Primary,
            )
            .await?;
        let _ = self
            .cancel_exact_unchecked(session_id, expected_run_id)
            .await?;
        Ok(())
    }

    pub(crate) async fn cancel_exact_unchecked(
        &self,
        session_id: &str,
        expected_run_id: &str,
    ) -> Result<ExactCancelOutcome> {
        const MAX_RUN_ID_BYTES: usize = 128;
        if expected_run_id.is_empty() || expected_run_id.len() > MAX_RUN_ID_BYTES {
            return Err(anyhow!("run_id is invalid"));
        }
        let service = self.manager.attach_session(session_id).await?;
        let Some(active) = service.active_run() else {
            return match sessions::SessionOperationLease::try_acquire(
                &self.manager.inner.store_path,
                session_id,
            ) {
                Ok(_idle) => Ok(ExactCancelOutcome::CancelledOrInactive),
                Err(sessions::SessionOperationLeaseError::Busy(_)) => Err(anyhow!(
                    "session '{session_id}' is running in another process and cannot be cancelled from this process"
                )),
                Err(error) => Err(anyhow::Error::new(error)),
            };
        };
        if active.run_id.as_str() != expected_run_id {
            return Ok(ExactCancelOutcome::ActiveRunMismatch);
        }
        match service
            .connect_client()
            .request_cancel(&active.run_id)
            .await
        {
            Ok(()) | Err(SessionCancelError::NotActive { .. }) => {
                Ok(ExactCancelOutcome::CancelledOrInactive)
            }
            Err(SessionCancelError::Cleanup { message, .. }) => Err(anyhow!(message)),
        }
    }

    pub(crate) async fn cancel_unchecked(&self, session_id: &str) -> Result<()> {
        let service = self.manager.attach_session(session_id).await?;
        let Some(active) = service.active_run() else {
            return match sessions::SessionOperationLease::try_acquire(
                &self.manager.inner.store_path,
                session_id,
            ) {
                Ok(_idle) => Ok(()),
                Err(sessions::SessionOperationLeaseError::Busy(_)) => Err(anyhow!(
                    "session '{session_id}' is running in another process and cannot be cancelled from this process"
                )),
                Err(error) => Err(anyhow::Error::new(error)),
            };
        };
        match service
            .connect_client()
            .request_cancel(&active.run_id)
            .await
        {
            Ok(()) | Err(SessionCancelError::NotActive { .. }) => Ok(()),
            Err(SessionCancelError::Cleanup { message, .. }) => Err(anyhow!(message)),
        }
    }
}

impl SessionManager {
    pub async fn cancel_active_run_exact(&self, session_id: &str, run_id: &str) -> Result<()> {
        self.session_runs().cancel_exact(session_id, run_id).await
    }
}
