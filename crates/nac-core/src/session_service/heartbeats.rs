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
    /// Host allowance changes are a separate human operation. They never
    /// resume schedules, grant agent authority or invoke an attached task.
    pub async fn control_human_retained_allowance(
        store_path: std::path::PathBuf,
        project_id: String,
        change: crate::store::FreshTaskRetainedAllowanceChange,
    ) -> Result<crate::store::FreshTaskRetainedAllowanceReceipt> {
        struct SubmittedRetainedAllowance {
            project_id: String,
            change: crate::store::FreshTaskRetainedAllowanceChange,
        }
        let intent = SubmittedRetainedAllowance { project_id, change };
        crate::store::spawn_blocking_store_caller(move || {
            let project =
                crate::projects::load_project_launch_context(&store_path, &intent.project_id)?
                    .project;
            anyhow::ensure!(
                project.ssh_host.is_none(),
                "host retained allowance requires a saved Local project"
            );
            let canonical = std::fs::canonicalize(&project.cwd)?;
            let destination = crate::store::FreshTaskDestination {
                project_id: intent.project_id.clone(),
                pinned_commit: None,
                default_ref: None,
                model: None,
                reasoning_effort: None,
                retained_limit: 1,
            };
            let binding = crate::store::fresh_heartbeat_binding(
                &store_path,
                &destination,
                None,
                canonical
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("Local project cwd is not UTF-8"))?,
            )?;
            let config = crate::runtime::NacConfig::load_from_cwd(&canonical)?;
            crate::permissions::authorize_human_retained_allowance(
                &intent.project_id,
                &config.permissions.rules,
            )?;
            crate::store::change_fresh_heartbeat_retained_allowance(
                &store_path,
                &intent.change,
                &binding,
            )
        })
        .await?
    }

    /// Service-issued human project management does not require the creator
    /// chat to exist. No model-visible origin flag selects this invocation.
    pub async fn control_human_project_heartbeat(
        store_path: std::path::PathBuf,
        binding: crate::store::HeartbeatBinding,
        request_id: String,
        operation: HeartbeatAction,
    ) -> Result<HeartbeatReceipt> {
        struct SubmittedProjectHeartbeat {
            binding: crate::store::HeartbeatBinding,
            request_id: String,
            operation: HeartbeatAction,
        }
        let intent = SubmittedProjectHeartbeat {
            binding,
            request_id,
            operation,
        };
        crate::store::spawn_blocking_store_caller(move || {
            use crate::permissions::{PermissionBackend, PermissionEffect, PermissionPolicy};
            use crate::tools::kernel::PermissionResource;
            let destination = intent.binding.fresh_task.as_ref().ok_or_else(|| {
                anyhow::anyhow!("human project control requires a standalone destination")
            })?;
            anyhow::ensure!(
                intent.binding.backend == "local"
                    && intent.binding.project_id.as_deref()
                        == Some(destination.project_id.as_str()),
                "human project control changed its selected backend/project"
            );
            let config = crate::runtime::NacConfig::load_from_cwd(std::path::Path::new(
                &intent.binding.cwd,
            ))?;
            let decision =
                PermissionPolicy::for_backend(PermissionBackend::Local, config.permissions.rules)
                    .evaluate(
                        &[PermissionResource::new(
                            "heartbeat_manage",
                            format!("project:{}", destination.project_id),
                        )],
                        &[],
                    );
            anyhow::ensure!(
                decision.effect != PermissionEffect::Deny,
                "configured or hard policy denies human project schedule management"
            );
            crate::store::control_heartbeat(
                &store_path,
                &format!("project:{}", destination.project_id),
                &intent.request_id,
                &intent.operation,
                &format!(
                    "Human configured this project interval schedule: {}",
                    serde_json::to_string(&intent.operation)?
                ),
                &intent.binding,
                i64::try_from(now_epoch_ms()).unwrap_or(i64::MAX),
            )
        })
        .await?
    }

    /// Promote only this retained launch's identified first input. Ordinary
    /// queued guidance takes priority and is left to the normal inbox owner.
    pub async fn start_fresh_heartbeat_initial_input(
        &self,
        occurrence: HeartbeatOccurrence,
        lease: sessions::SessionOperationLease,
    ) -> Result<Option<SessionRunHandle>> {
        self.require_direct_primary_behavior_async().await?;
        anyhow::ensure!(
            self.metadata.session_id == occurrence.session_id,
            "scheduled initial input belongs to another task"
        );
        let service = self.clone();
        crate::store::spawn_blocking_store_caller(move || {
            let session = occurrence.execution_session_id()?;
            if crate::store::next_pending_session_inbox_item(&service.metadata.store_path, session)?
                .is_some()
                || service.has_active_operation()
            {
                return Ok(None);
            }
            let input = crate::store::load_session_inbox_item(
                &service.metadata.store_path,
                session,
                occurrence.inbox_item_id.ok_or_else(|| {
                    anyhow::anyhow!("scheduled first input has not been published")
                })?,
            )?;
            match service.try_submit_prompt_inner(
                None,
                input.content,
                Some(lease),
                RunAdmissionKind {
                    inbox_item_id: Some(input.id),
                    ..RunAdmissionKind::default()
                },
            ) {
                Ok(run) => Ok(Some(run)),
                Err(
                    SessionSubmitError::Busy { .. }
                    | SessionSubmitError::ExternalBusy { .. }
                    | SessionSubmitError::Coordination {
                        message: SessionCoordinationError::LocalAgentBusy,
                    },
                ) => Ok(None),
                Err(error) => Err(error.into()),
            }
        })
        .await?
    }

    /// Called by ordinary inbox promotion before its exact initial input can
    /// become a run. Later human input has no scheduled execution identity.
    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub(super) fn prepare_fresh_heartbeat_input(
        &self,
        inbox_id: i64,
        prompt: &mut String,
    ) -> std::result::Result<Option<HeartbeatOccurrence>, SessionSubmitError> {
        let failure = |error: anyhow::Error| SessionSubmitError::Coordination {
            message: SessionCoordinationError::store(format!(
                "scheduled initial input is unavailable: {error:#}"
            )),
        };
        let Some(session) = self.metadata.session_id.as_deref() else {
            return Ok(None);
        };
        let Some(occurrence) =
            crate::store::fresh_heartbeat_for_inbox(&self.metadata.store_path, session, inbox_id)
                .map_err(failure)?
        else {
            return Ok(None);
        };
        let context = self
            .heartbeat_context
            .as_ref()
            .ok_or_else(|| failure(anyhow::anyhow!("scheduled runtime is unavailable")))?;
        let allowed = self.metadata.behavior == sessions::SessionBehavior::Direct
            && matches!(
                context.runtime.backend.as_ref(),
                crate::sandbox::ExecutionBackend::Local { .. }
            )
            && !self.managed_admission_enabled
            && self.metadata.project_id.as_deref().is_some_and(|project| {
                self.permission_broker
                    .as_ref()
                    .is_some_and(|broker| broker.fresh_heartbeat_admission_allowed(project))
            });
        let missing_skill = occurrence.spec.skills.iter().any(|skill| {
            !self
                .skills
                .as_ref()
                .is_some_and(|registry| registry.has_skill(skill))
        });
        if !allowed || missing_skill {
            crate::store::fail_fresh_heartbeat_before_run(&self.metadata.store_path,&occurrence.occurrence_id,crate::store::HeartbeatOutcome::NeedsHumanAction,"The scheduled task's current Local policy, readiness or requested skills require human action.",i64::try_from(now_epoch_ms()).unwrap_or(i64::MAX)).map_err(failure)?;
            return Err(failure(anyhow::anyhow!(
                "scheduled initial input requires human action"
            )));
        }
        if !self.list_permission_requests().map_err(failure)?.is_empty()
            || !self
                .list_blocked_permission_reviews()
                .map_err(failure)?
                .is_empty()
        {
            return Err(SessionSubmitError::Coordination {
                message: SessionCoordinationError::local_agent_busy(),
            });
        }
        *prompt = commands::expand_user_prompt(prompt, self.skills.as_deref());
        Ok(Some(occurrence))
    }

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
            self.metadata.session_id == occurrence.session_id && occurrence.session_id.is_some(),
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
                    occurrence.execution_session_id()?,
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
