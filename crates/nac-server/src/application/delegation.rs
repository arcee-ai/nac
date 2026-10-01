use crate::{delegation_runtime, DEFAULT_REPLAY_LIMIT};
use anyhow::{anyhow, Result};
use nac_core::{events::SessionEvent, session_service::MessagePageRequest, types::Message};
use nac_core::{
    sessions,
    store::{
        ManagedOrchestratorExecutionMode, ManagedOrchestratorRecord, ManagedOrchestratorStatus,
        TraditionalChildExecutionMode, TraditionalChildRecord,
    },
};
use std::time::Duration;

use crate::SessionManager;

pub(crate) struct StartTraditionalChild {
    pub(crate) profile: String,
    pub(crate) description: String,
    pub(crate) prompt: String,
    pub(crate) child_session_id: Option<String>,
    pub(crate) background: bool,
}

pub(crate) struct StartManagedOrchestrator {
    pub(crate) description: String,
    pub(crate) prompt: String,
    pub(crate) orchestrator_session_id: Option<String>,
    pub(crate) background: bool,
}

/// Durable child-session and managed-orchestrator use cases.
///
/// Traditional children and managed orchestrators intentionally remain
/// distinct topologies. This service owns their parent eligibility checks and
/// foreground/background completion behavior without exposing HTTP concerns.
pub(crate) struct DelegationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> DelegationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn list_traditional_children(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<TraditionalChildRecord>> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior == sessions::SessionBehavior::Orchestrator {
            return Err(anyhow!(
                "traditional children are available only for direct behaviors"
            ));
        }
        if nac_core::store::load_traditional_child(
            &self.manager.inner.store_path,
            parent_session_id,
        )?
        .is_some()
        {
            return Err(anyhow!(
                "traditional child nesting limit reached (1): child sessions cannot launch children"
            ));
        }
        nac_core::store::list_traditional_children(
            &self.manager.inner.store_path,
            parent_session_id,
        )
    }

    pub(crate) async fn start_traditional_child(
        &self,
        parent_session_id: &str,
        command: StartTraditionalChild,
    ) -> Result<TraditionalChildRecord> {
        self.manager.attach_session(parent_session_id).await?;
        let controller =
            nac_core::traditional_children::controller_for(&self.manager.inner.store_path)?;
        let child = controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: parent_session_id.to_string(),
                    child_session_id: command.child_session_id,
                    profile: command.profile,
                    description: command.description,
                    prompt: command.prompt,
                    execution_mode: if command.background {
                        TraditionalChildExecutionMode::Background
                    } else {
                        TraditionalChildExecutionMode::Foreground
                    },
                },
            )
            .await?;
        if command.background {
            Ok(child)
        } else {
            controller
                .wait(&child.child_session_id, child.generation)
                .await
        }
    }

    pub(crate) fn traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        nac_core::store::load_traditional_child_for_parent(
            &self.manager.inner.store_path,
            parent_session_id,
            child_session_id,
        )?
        .ok_or_else(|| anyhow!("traditional child was not found"))
    }

    pub(crate) async fn cancel_traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        let child = self.traditional_child(parent_session_id, child_session_id)?;
        nac_core::traditional_children::controller_for(&self.manager.inner.store_path)?
            .cancel(parent_session_id, child_session_id, child.generation)
            .await
    }

    pub(crate) async fn list_managed_orchestrators(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<ManagedOrchestratorRecord>> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior != sessions::SessionBehavior::DirectWithOrchestrator {
            return Err(anyhow!(
                "managed orchestrators require direct-with-orchestrator behavior"
            ));
        }
        nac_core::store::list_managed_orchestrators(
            &self.manager.inner.store_path,
            parent_session_id,
        )
    }

    pub(crate) async fn start_managed_orchestrator(
        &self,
        parent_session_id: &str,
        command: StartManagedOrchestrator,
    ) -> Result<ManagedOrchestratorRecord> {
        self.manager.attach_session(parent_session_id).await?;
        let controller =
            nac_core::orchestration_control::controller_for(&self.manager.inner.store_path)?;
        let orchestrator = controller
            .start(
                nac_core::orchestration_control::ManagedOrchestratorStartRequest {
                    parent_session_id: parent_session_id.to_string(),
                    orchestrator_session_id: command.orchestrator_session_id,
                    description: command.description,
                    prompt: command.prompt,
                    execution_mode: if command.background {
                        ManagedOrchestratorExecutionMode::Background
                    } else {
                        ManagedOrchestratorExecutionMode::Foreground
                    },
                },
            )
            .await?;
        if command.background {
            Ok(orchestrator)
        } else {
            controller
                .wait(
                    &orchestrator.orchestrator_session_id,
                    orchestrator.generation,
                )
                .await
        }
    }

    pub(crate) async fn managed_orchestrator_async(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        let manager = self.manager.clone();
        let parent_session_id = parent_session_id.to_owned();
        let orchestrator_session_id = orchestrator_session_id.to_owned();
        nac_core::store::spawn_blocking_store_caller(move || {
            manager
                .delegation()
                .managed_orchestrator(&parent_session_id, &orchestrator_session_id)
        })
        .await?
    }

    pub(crate) fn managed_orchestrator(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        nac_core::store::load_managed_orchestrator_for_parent(
            &self.manager.inner.store_path,
            parent_session_id,
            orchestrator_session_id,
        )?
        .ok_or_else(|| anyhow!("managed orchestrator was not found"))
    }

    pub(crate) async fn cancel_managed_orchestrator(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        let orchestrator = self
            .managed_orchestrator_async(parent_session_id, orchestrator_session_id)
            .await?;
        nac_core::orchestration_control::controller_for(&self.manager.inner.store_path)?
            .cancel(
                parent_session_id,
                orchestrator_session_id,
                orchestrator.generation,
            )
            .await
    }
}

impl SessionManager {
    pub(crate) async fn monitor_managed_orchestrator(
        &self,
        orchestrator_session_id: &str,
        generation: u64,
    ) -> Result<ManagedOrchestratorRecord> {
        self.monitor_managed_orchestrator_with_lease(orchestrator_session_id, generation, None)
            .await
    }

    pub(crate) async fn monitor_managed_orchestrator_with_lease(
        &self,
        orchestrator_session_id: &str,
        generation: u64,
        mut initial_lease: Option<sessions::SessionOperationLease>,
    ) -> Result<ManagedOrchestratorRecord> {
        loop {
            let path = self.inner.store_path.clone();
            let session_id = orchestrator_session_id.to_owned();
            let record = self
                .inner
                ._store_ownership
                .call_legacy(move || {
                    delegation_runtime::load_managed_monitor_record(&path, &session_id, generation)
                })
                .await??
                .ok_or_else(|| {
                    anyhow!(
                        "managed orchestrator session '{orchestrator_session_id}' was not found"
                    )
                })?;
            if record.generation != generation {
                return Err(anyhow!(
                    "managed orchestrator generation {generation} was superseded by {}",
                    record.generation
                ));
            }
            if record.status.is_terminal() {
                return Ok(record);
            }
            let run_id = record
                .run_id
                .as_deref()
                .ok_or_else(|| anyhow!("running managed orchestrator has no run id"))?;
            let cached = self
                .inner
                .active_sessions
                .read()
                .await
                .get(orchestrator_session_id)
                .cloned();
            if cached.as_ref().is_some_and(|service| {
                service
                    .active_run()
                    .is_some_and(|active| active.run_id.to_string() == run_id)
            }) {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }

            // A busy operation lease is positive evidence that another
            // process still owns the generation. Never synthesize an
            // interruption merely because this process has no active task.
            let operation_lease = match initial_lease.take() {
                Some(lease) => lease,
                None => match sessions::SessionOperationLease::try_acquire(
                    &self.inner.store_path,
                    orchestrator_session_id,
                ) {
                    Ok(lease) => lease,
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        #[cfg(test)]
                        self.inner.managed_monitor_peer_observed.notify_one();
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    Err(error) => return Err(anyhow::Error::new(error)),
                },
            };
            let gate = self.lifecycle_gate(orchestrator_session_id);
            let _lifecycle = gate.lock().await;
            let service = self
                .attach_current_operation_service_locked(orchestrator_session_id, &operation_lease)
                .await?;

            let (_, events) = service.recent_events(None, DEFAULT_REPLAY_LIMIT);
            let path = self.inner.store_path.clone();
            let session_id = orchestrator_session_id.to_owned();
            let terminal = self
                .inner
                ._store_ownership
                .call_legacy(move || nac_core::store::load_run_recovery(&path, &session_id))
                .await??
                .filter(|recovery| recovery.run_id == run_id)
                .and_then(|recovery| {
                    if let Some(disposition) = recovery.terminal_disposition {
                        return Some(match disposition {
                            nac_core::store::RunTerminalDisposition::Completed => {
                                nac_core::store::ManagedOrchestratorTerminal {
                                    status: ManagedOrchestratorStatus::Completed,
                                    report: None,
                                    failure: None,
                                }
                            }
                            nac_core::store::RunTerminalDisposition::Cancelled => {
                                nac_core::store::ManagedOrchestratorTerminal {
                                    status: ManagedOrchestratorStatus::Cancelled,
                                    report: None,
                                    failure: None,
                                }
                            }
                        });
                    }
                    match recovery.status {
                        nac_core::store::RunRecoveryStatus::Interrupted => {
                            Some(nac_core::store::ManagedOrchestratorTerminal {
                                status: ManagedOrchestratorStatus::Interrupted,
                                report: None,
                                failure: Some("run interrupted by process restart".to_string()),
                            })
                        }
                        nac_core::store::RunRecoveryStatus::Failed => {
                            Some(nac_core::store::ManagedOrchestratorTerminal {
                                status: ManagedOrchestratorStatus::Failed,
                                report: None,
                                failure: Some("managed orchestrator run failed".to_string()),
                            })
                        }
                        nac_core::store::RunRecoveryStatus::Active => None,
                    }
                })
                .or_else(|| {
                    events.iter().rev().find_map(|envelope| {
                        (envelope.run_id.as_ref().map(ToString::to_string).as_deref()
                            == Some(run_id))
                        .then_some(&envelope.event)
                        .and_then(|event| match event {
                            SessionEvent::RunCompleted { response, .. } => {
                                Some(nac_core::store::ManagedOrchestratorTerminal {
                                    status: ManagedOrchestratorStatus::Completed,
                                    report: Some(response.clone()),
                                    failure: None,
                                })
                            }
                            SessionEvent::RunFailed { message, failure } => {
                                Some(nac_core::store::ManagedOrchestratorTerminal {
                                    status: delegation_runtime::managed_run_failure_status(
                                        failure.as_ref(),
                                    ),
                                    report: None,
                                    failure: Some(message.clone()),
                                })
                            }
                            SessionEvent::RunCancelled => {
                                Some(nac_core::store::ManagedOrchestratorTerminal {
                                    status: ManagedOrchestratorStatus::Cancelled,
                                    report: None,
                                    failure: None,
                                })
                            }
                            _ => None,
                        })
                    })
                });
            let terminal = match terminal {
                Some(mut terminal) => {
                    if terminal.status == ManagedOrchestratorStatus::Completed
                        && terminal.report.is_none()
                    {
                        terminal.report = events.iter().rev().find_map(|envelope| {
                            (envelope.run_id.as_ref().map(ToString::to_string).as_deref()
                                == Some(run_id))
                            .then_some(&envelope.event)
                            .and_then(|event| match event {
                                SessionEvent::RunCompleted { response, .. } => {
                                    Some(response.clone())
                                }
                                _ => None,
                            })
                        });
                        if terminal.report.is_none() {
                            terminal.report = service
                                .messages_page(MessagePageRequest {
                                    before: None,
                                    limit: 24,
                                    include_system: false,
                                })
                                .await
                                .ok()
                                .and_then(|page| {
                                    page.messages.into_iter().rev().find_map(
                                        |message| match message {
                                            Message::Assistant { content, .. } => content,
                                            _ => None,
                                        },
                                    )
                                });
                        }
                    }
                    terminal
                }
                None => {
                    let report = service
                        .messages_page(MessagePageRequest {
                            before: None,
                            limit: 24,
                            include_system: false,
                        })
                        .await
                        .ok()
                        .and_then(|page| {
                            page.messages
                                .into_iter()
                                .rev()
                                .find_map(|message| match message {
                                    Message::Assistant { content, .. } => content,
                                    _ => None,
                                })
                        });
                    nac_core::store::ManagedOrchestratorTerminal {
                        status: ManagedOrchestratorStatus::Interrupted,
                        report,
                        failure: Some(
                            "managed orchestrator stopped without a retained terminal event"
                                .to_string(),
                        ),
                    }
                }
            };
            let path = self.inner.store_path.clone();
            let session_id = orchestrator_session_id.to_owned();
            let run_id = run_id.to_owned();
            let settlement = self
                .inner
                ._store_ownership
                .call_legacy(move || {
                    let settlement = nac_core::store::settle_managed_orchestrator_run(
                        &path,
                        &session_id,
                        &run_id,
                        terminal,
                    )?;
                    nac_core::store::clear_settled_run_recovery(&path, &session_id, &run_id)?;
                    anyhow::Ok(settlement)
                })
                .await??;
            if settlement.newly_settled && settlement.orchestrator.completion_inbox_id.is_some() {
                let parent_session_id = settlement.orchestrator.parent_session_id.clone();
                let cached = {
                    let active = self.inner.active_sessions.read().await;
                    active.get(&parent_session_id).cloned()
                };
                let parent = match cached {
                    Some(service) => service,
                    None => self.attach_session(&parent_session_id).await?,
                };
                parent.start_next_direct_inbox_item().await?;
            }
            return Ok(settlement.orchestrator);
        }
    }

    pub(crate) fn spawn_managed_orchestrator_monitor(
        &self,
        orchestrator_session_id: String,
        generation: u64,
    ) {
        let manager = self.clone();
        tokio::spawn(async move {
            if let Err(error) = manager
                .monitor_managed_orchestrator(&orchestrator_session_id, generation)
                .await
            {
                eprintln!(
                    "nac: managed orchestrator monitor failed for {orchestrator_session_id}: {error:#}"
                );
            }
        });
    }
}
