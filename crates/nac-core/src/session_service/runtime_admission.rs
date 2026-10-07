use super::*;
use crate::runtime::{ManagedRuntimeLeaseGuard, RuntimeEffectLease, RuntimeRunAdmission};

struct PendingRuntimeDelivery {
    guard: Arc<ManagedRuntimeLeaseGuard>,
    completed: bool,
}
impl Drop for PendingRuntimeDelivery {
    fn drop(&mut self) {
        if !self.completed {
            self.guard.deny_now();
        }
    }
}

impl SessionService {
    /// A retained original run never authorizes a successor through the
    /// conventional prompt, inbox, goal or manual-compaction entry points.
    pub(super) fn check_conventional_runtime_admission(&self) -> Result<()> {
        if self.runtime_effect_required {
            anyhow::bail!("authenticated runtime operation admission required");
        }
        self.check_host_execution_authority()
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors retain the existing conflict snapshot"
    )]
    pub(super) fn check_original_run_admission_guard(
        &self,
        initial_check: Option<&Arc<crate::store::MutationAdmission>>,
    ) -> std::result::Result<(), SessionSubmitError> {
        let result = if let Some(check) = initial_check {
            check().and_then(|()| self.check_host_execution_authority())
        } else {
            self.check_conventional_runtime_admission()
        };
        result.map_err(|error| SessionSubmitError::Coordination {
            message: SessionCoordinationError::store(error.to_string()),
        })
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors retain the existing conflict snapshot"
    )]
    pub(super) fn check_original_run_admission(
        &self,
        original: Option<&RuntimeRunAdmission>,
        selected_lease: Option<&sessions::SessionOperationLease>,
    ) -> std::result::Result<(), SessionSubmitError> {
        let result = (|| -> Result<()> {
            if let Some(original) = original {
                anyhow::ensure!(
                    self.runtime_effect_required,
                    "runtime original requires protected construction"
                );
                let agent = self
                    .agent
                    .try_lock()
                    .map_err(|_| anyhow::anyhow!("runtime agent is busy"))?;
                anyhow::ensure!(
                    agent.matches_runtime_original_construction(&original.construction_identity),
                    "runtime original does not match protected construction"
                );
                drop(agent);
                let session = self
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("runtime session unavailable"))?;
                let lease = selected_lease
                    .or(original.operation_lease.as_ref())
                    .ok_or_else(|| anyhow::anyhow!("runtime original session lease unavailable"))?;
                original.check_selected_initial_now(&self.metadata.store_path, session, lease)?;
                self.check_host_execution_authority()
            } else {
                self.check_conventional_runtime_admission()
            }
        })();
        result.map_err(|error| SessionSubmitError::Coordination {
            message: SessionCoordinationError::store(error.to_string()),
        })
    }

    /// Consume the one protected existing-session original. Delivery must have
    /// matched its actual canonical target and input before supplying this cap.
    /// MCP expansion belongs to this pending original, before run admission.
    pub async fn submit_runtime_original(
        &self,
        original: RuntimeRunAdmission,
        input: String,
    ) -> Result<SessionRunHandle> {
        let mut delivery = PendingRuntimeDelivery {
            guard: Arc::clone(&original.guard),
            completed: false,
        };
        self.check_original_run_admission(Some(&original), None)
            .map_err(anyhow::Error::new)?;
        let session = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("runtime session unavailable"))?;
        original
            .check_initial(&self.metadata.store_path, session)
            .await?;
        let prepared = match self.prepare_user_input(&input) {
            PreparedUserInput::Empty => anyhow::bail!("prompt is empty"),
            PreparedUserInput::InvalidSlashCommand { message } => anyhow::bail!("{message}"),
            PreparedUserInput::FrontendCommand(_) => {
                anyhow::bail!("frontend command cannot start a runtime run")
            }
            PreparedUserInput::SubmitPrompt(prompt) => prompt,
            PreparedUserInput::McpPrompt(invocation) => {
                let registry = self
                    .mcp
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("MCP prompt capability is unavailable"))?;
                tokio::select! {
                    biased;
                    () = original.guard.wait_for_denial() => anyhow::bail!("runtime prompt expansion denied"),
                    result = registry.resolve_prompt_invocation(invocation) => result?,
                }
            }
        };
        original
            .check_initial(&self.metadata.store_path, session)
            .await?;
        let service = self.clone();
        let run = crate::store::spawn_blocking_store_caller(move || {
            service
                .try_submit_prompt_inner(
                    None,
                    prepared.agent_prompt,
                    None,
                    RunAdmissionKind {
                        runtime_original: Some(original),
                        ..Default::default()
                    },
                )
                .map_err(anyhow::Error::new)
        })
        .await??;
        delivery.completed = true;
        Ok(run)
    }

    pub(super) fn runtime_run_observer(
        &self,
        run_id: &SessionRunId,
        expected: &Arc<ManagedRuntimeLeaseGuard>,
    ) -> Arc<crate::runtime::RuntimeRunObserver> {
        let operation = Arc::downgrade(&self.active_operation);
        let expected = Arc::downgrade(expected);
        let run_id = run_id.clone();
        Arc::new(move || {
            let operation = operation
                .upgrade()
                .ok_or_else(|| anyhow::anyhow!("runtime owner unavailable"))?;
            // This is the same canonical private mutex used by lock_active_operation;
            // no projection or retained journal row supplies liveness.
            let active = operation
                .lock()
                .map_err(|_| anyhow::anyhow!("runtime owner unavailable"))?;
            let Some(ActiveSessionOperation::Run(run)) = active.as_ref() else {
                anyhow::bail!("runtime original is not active");
            };
            anyhow::ensure!(
                !run.finishing && run.snapshot.run_id == run_id,
                "runtime original is not active"
            );
            let original = run
                .runtime_original
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("run has no runtime original"))?;
            let expected = expected
                .upgrade()
                .ok_or_else(|| anyhow::anyhow!("runtime guard unavailable"))?;
            anyhow::ensure!(
                Arc::ptr_eq(&original.guard, &expected),
                "runtime original mismatch"
            );
            Ok(crate::store::ManagedRuntimeObservation::Run {
                session_id: original.session_id.parse()?,
                run_id: run.snapshot.run_id.as_str().parse()?,
            })
        })
    }

    /// Read canonical private state at the observation point. A public active
    /// projection can still exist during finishing or cancellation.
    pub fn observe_runtime_original_run(
        &self,
        run_id: &SessionRunId,
        expected: &Arc<ManagedRuntimeLeaseGuard>,
    ) -> Result<crate::store::ManagedRuntimeObservation> {
        let active = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(run)) = active.as_ref() else {
            anyhow::bail!("runtime original is not active");
        };
        anyhow::ensure!(
            !run.finishing && run.snapshot.run_id == *run_id,
            "runtime original is not active"
        );
        let original = run
            .runtime_original
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("run has no runtime original"))?;
        anyhow::ensure!(
            Arc::ptr_eq(&original.guard, expected),
            "runtime original mismatch"
        );
        original.guard.check_now()?;
        Ok(crate::store::ManagedRuntimeObservation::Run {
            session_id: original.session_id.parse()?,
            run_id: run.snapshot.run_id.as_str().parse()?,
        })
    }
}

#[cfg(test)]
mod tests;
