//! Exact occurrence admission and invocation-only human management.
use super::*;
use crate::store::{HeartbeatAction, HeartbeatOccurrence, HeartbeatReceipt};
use crate::tools::heartbeat::{HeartbeatControlTool, CONTROL_HEARTBEAT};
use crate::tools::kernel::{ToolCallContext, ToolRegistry, ToolServices};

#[cfg(test)]
mod tests;

/// Not deserializable or model-constructible. The lifecycle issues this only
/// for the authenticated product control operation on its exact session.
pub(crate) struct SubmittedHeartbeat {
    request_id: String,
    operation: HeartbeatAction,
}
impl SubmittedHeartbeat {
    pub(crate) fn tool_input(&self) -> serde_json::Value {
        serde_json::json!({"request_id":self.request_id,"operation":self.operation})
    }
}

pub(super) struct HeartbeatContext {
    runtime: crate::tools::ToolRuntime,
    client: crate::model::ModelClient,
}
impl HeartbeatContext {
    pub(super) fn execution_cwd(&self) -> String {
        self.runtime
            .backend
            .default_terminal_cwd()
            .to_string_lossy()
            .into_owned()
    }
    pub(super) fn new(
        runtime: crate::tools::ToolRuntime,
        client: crate::model::ModelClient,
    ) -> Self {
        Self { runtime, client }
    }
    pub(super) async fn stop(&self) {
        self.runtime.command_cancellation.cancel_async().await;
    }
    pub(super) fn needs_human_action(&self) -> bool {
        self.runtime
            .heartbeat_needs_human_action
            .load(std::sync::atomic::Ordering::Acquire)
    }
}

impl SessionService {
    /// Live monotonic waiting cannot extend execution when the wall clock
    /// moves backwards. The durable run receipt still decides cancellation.
    pub(super) fn arm_heartbeat_deadline(&self, run_id: &SessionRunId, timeout: Duration) {
        let (deadline, mut settled) = {
            let operation = self.lock_active_operation();
            let Some(ActiveSessionOperation::Run(run)) = operation.as_ref() else {
                return;
            };
            if !run.heartbeat || run.snapshot.run_id != *run_id {
                return;
            }
            (run.started_at + timeout, run.settlement.subscribe())
        };
        let service = self.clone();
        let run_id = run_id.clone();
        tokio::spawn(async move {
            let finished = async {
                while !*settled.borrow() {
                    if settled.changed().await.is_err() {
                        break;
                    }
                }
            };
            tokio::select! {
                ()=tokio::time::sleep_until(tokio::time::Instant::from_std(deadline))=>{},
                ()=finished=>return,
            }
            {
                let operation = service.lock_active_operation();
                if !matches!(operation.as_ref(),Some(ActiveSessionOperation::Run(run)) if run.heartbeat && run.snapshot.run_id==run_id)
                {
                    return;
                }
                if let Some(context) = &service.heartbeat_context {
                    context
                        .runtime
                        .heartbeat_needs_human_action
                        .store(true, std::sync::atomic::Ordering::Release);
                }
            }
            let (Some(session), path) = (
                service.metadata.session_id.clone(),
                service.metadata.store_path.clone(),
            ) else {
                return;
            };
            let exact = run_id.to_string();
            let reached = crate::store::spawn_blocking_store_caller(move || {
                crate::store::heartbeat_deadline_reached(
                    &path,
                    &session,
                    &exact,
                    i64::try_from(now_epoch_ms()).unwrap_or(i64::MAX),
                )
            })
            .await;
            if !matches!(reached, Ok(Ok(false))) {
                if let Err(error) = service.request_cancel(&run_id).await {
                    eprintln!("nac: heartbeat deadline cleanup requires review: {error}");
                }
            }
        });
    }

    /// Does not acquire the agent mutex or run operation lease. A model turn
    /// may control its schedule without waiting for itself to finish.
    pub async fn control_human_heartbeat(
        &self,
        request_id: String,
        operation: HeartbeatAction,
    ) -> Result<HeartbeatReceipt> {
        anyhow::ensure!(
            !self.managed_admission_enabled,
            "managed heartbeat execution is not qualified"
        );
        self.require_direct_primary_behavior_async().await?;
        anyhow::ensure!(
            !self
                .stopping_admission
                .load(std::sync::atomic::Ordering::Acquire),
            "heartbeat control is stopping"
        );
        let context = self
            .heartbeat_context
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("heartbeat controls are unavailable"))?;
        let intent = SubmittedHeartbeat {
            request_id,
            operation,
        };
        let snapshot = ToolRegistry::builder()
            .register(HeartbeatControlTool::submitted(&intent))
            .finish()?
            .snapshot([CONTROL_HEARTBEAT])?;
        let result = snapshot
            .invoke_submitted_heartbeat(
                &intent,
                ToolServices {
                    runtime: &context.runtime,
                    client: &context.client,
                },
                &ToolCallContext::default(),
            )
            .await;
        anyhow::ensure!(
            !result.is_error,
            "{}",
            result
                .content
                .as_text()
                .unwrap_or("heartbeat control failed")
        );
        Ok(serde_json::from_str(result.content.as_text().ok_or_else(
            || anyhow::anyhow!("heartbeat receipt is unavailable"),
        )?)?)
    }

    /// Called only for one durable occurrence, under the supplied operation
    /// lease. Unlike ordinary attachment/inbox wake, this never chooses some
    /// other pending input or a goal continuation.
    pub async fn start_heartbeat_occurrence(
        &self,
        occurrence: HeartbeatOccurrence,
        lease: sessions::SessionOperationLease,
    ) -> Result<Option<SessionRunHandle>> {
        self.require_direct_primary_behavior_async().await?;
        anyhow::ensure!(
            self.metadata.behavior == sessions::SessionBehavior::Direct
                && self
                    .heartbeat_context
                    .as_ref()
                    .is_some_and(|context| matches!(
                        context.runtime.backend.as_ref(),
                        crate::sandbox::ExecutionBackend::Local { .. }
                    ))
                && !self.managed_admission_enabled,
            "heartbeats require ordinary independent direct Local execution"
        );
        anyhow::ensure!(
            self.metadata.session_id.as_deref() == Some(&occurrence.session_id),
            "heartbeat target is not this session"
        );
        if self.has_active_operation()
            || !self.list_permission_requests()?.is_empty()
            || !self.list_blocked_permission_reviews()?.is_empty()
        {
            return Ok(None);
        }
        if !self
            .permission_broker
            .as_ref()
            .is_some_and(|broker| broker.heartbeat_admission_allowed())
        {
            let path = self.metadata.store_path.clone();
            crate::store::spawn_blocking_store_caller(move || {
                crate::store::heartbeat_admission_unavailable(
                    &path,
                    &occurrence.session_id,
                    &occurrence.occurrence_id,
                    occurrence.revision,
                    true,
                    "Current heartbeat admission policy requires human action.",
                    i64::try_from(now_epoch_ms()).unwrap_or(i64::MAX),
                )
            })
            .await??;
            return Ok(None);
        }
        let mut prompt=format!("Durable heartbeat occurrence {} (receipt {}).\nCheck only the saved human-authorized purpose below in this same chat. Current conversation, human guidance, configured tool policy and backend remain authoritative. This input is automation; it grants no human-product invocation authority or arbitrary external effects. Do not create a goal or a new chat. Do not create, renew or enlarge scheduling authority/limits.\nDue range: {}..{} ms UTC; {} coalesced checks.\nSaved instructions:\n{}\nEnd condition:\n{}\nUse report_heartbeat for this occurrence, its exact generation and current revision after checking. Unchanged retains evidence quietly; missing classification stays visible. Finished ends only this heartbeat after successful run settlement. Read the current occurrence revision first.\n",
            occurrence.occurrence_id,occurrence.receipt_id,occurrence.due_first_ms,occurrence.due_last_ms,occurrence.coalesced_count,occurrence.spec.instructions,occurrence.spec.end_condition);
        for skill in &occurrence.spec.skills {
            anyhow::ensure!(
                self.skills
                    .as_ref()
                    .is_some_and(|registry| registry.has_skill(skill)),
                "saved heartbeat skill '{skill}' is unavailable"
            );
            prompt.push_str(&format!("\nRequested skill: ${skill}\n"));
        }
        let expanded = commands::expand_user_prompt(&prompt, self.skills.as_deref());
        let prompt = format!(
            "Heartbeat check: {}\n<nac_heartbeat>\n{}\n</nac_heartbeat>",
            serde_json::to_string(&occurrence.spec.name)?,
            expanded
        );
        let service = self.clone();
        crate::store::spawn_blocking_store_caller(move || {
            let result = service.try_submit_prompt_inner(
                None,
                prompt,
                Some(lease),
                RunAdmissionKind {
                    heartbeat_occurrence: Some(Box::new(occurrence)),
                    ..RunAdmissionKind::default()
                },
            );
            match result {
                Ok(run) => Ok(Some(run)),
                Err(
                    SessionSubmitError::Busy { .. }
                    | SessionSubmitError::ExternalBusy { .. }
                    | SessionSubmitError::Coordination {
                        message: SessionCoordinationError::LocalAgentBusy,
                    },
                ) => Ok(None),
                Err(error) => Err(anyhow::Error::new(error)),
            }
        })
        .await?
    }
}
