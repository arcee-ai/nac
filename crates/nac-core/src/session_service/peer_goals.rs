//! Peer goal controls share the target's operation/accounting and inbox owner.
use super::*;
use crate::peer_goal_control::PeerGoalError;
use crate::peer_goal_control::{AuthorizedPeerGoal, PeerGoalAction, PeerGoalOutcome};

impl SessionService {
    pub async fn control_peer_goal(
        &self,
        request: AuthorizedPeerGoal,
        idle_lease: Option<sessions::SessionOperationLease>,
    ) -> Result<PeerGoalOutcome> {
        anyhow::ensure!(
            self.metadata.session_id.as_deref() == Some(request.target())
                && self.metadata.behavior == sessions::SessionBehavior::Direct
                && self.shell_runtime.as_ref().is_some_and(|runtime| matches!(
                    runtime.backend.as_ref(),
                    crate::sandbox::ExecutionBackend::Local { .. }
                )),
            PeerGoalError::Unavailable("peer goal owner mismatch")
        );
        let _wake = self.inbox_wake.lock().await;
        let service = self.clone();
        let (value, wake, lease, changed) =
            crate::store::call_legacy_store(&self.metadata.store_path, move || -> Result<_> {
                anyhow::ensure!(
                    !service
                        .stopping_admission
                        .load(std::sync::atomic::Ordering::Acquire),
                    PeerGoalError::Unavailable("session admission is stopping")
                );
                let _relationship = sessions::SessionRelationshipLease::try_acquire(
                    &service.metadata.store_path,
                    request.target(),
                )?;
                service.require_peer_goal_scope(&request)?;
                let start = match request.action() {
                    PeerGoalAction::Start {
                        request_id,
                        objective,
                        token_budget,
                    } => Some(crate::store::PeerGoalStart {
                        caller_session_id: request.caller().to_owned(),
                        request_id: request_id.clone(),
                        target_session_id: request.target().to_owned(),
                        objective: objective.clone(),
                        token_budget: *token_budget,
                        project_id: request.project().map(str::to_owned),
                    }),
                    _ => None,
                };
                // Replay is passive: never bind the replacement goal or wake it.
                if let Some(start) = &start {
                    if let Some(receipt) = crate::store::peer_goals::lookup_peer_goal_start(
                        &service.metadata.store_path,
                        start,
                    )? {
                        return Ok((
                            PeerGoalOutcome::Replayed { receipt },
                            false,
                            idle_lease,
                            false,
                        ));
                    }
                }
                let active = service.lock_active_operation();
                anyhow::ensure!(
                    !service
                        .stopping_admission
                        .load(std::sync::atomic::Ordering::Acquire),
                    PeerGoalError::Unavailable("session admission is stopping")
                );
                let run = match active.as_ref() {
                    Some(ActiveSessionOperation::Run(run)) if !run.finishing => {
                        Some(run.snapshot.run_id.as_str())
                    }
                    Some(_) => {
                        return Err(anyhow::anyhow!(PeerGoalError::Unavailable(
                            "target operation is settling or is not an agent run"
                        )))
                    }
                    None => None,
                };
                let lease = match (run, idle_lease) {
                    (Some(_), Some(_)) => {
                        return Err(anyhow::anyhow!(PeerGoalError::Conflict(
                            "target became active"
                        )))
                    }
                    (Some(_), None) => None,
                    (None, Some(lease)) => {
                        lease.validate(&service.metadata.store_path, request.target())?;
                        Some(lease)
                    }
                    (None, None) => Some(
                        sessions::SessionOperationLease::try_acquire(
                            &service.metadata.store_path,
                            request.target(),
                        )
                        .map_err(|error| match error {
                            sessions::SessionOperationLeaseError::Busy(_) => anyhow::anyhow!(
                                PeerGoalError::Unavailable("target is owned by another process")
                            ),
                            sessions::SessionOperationLeaseError::Store(error) => error,
                        })?,
                    ),
                };
                let value = if let Some(start) = start {
                    let baseline = run
                        .map(|run_id| {
                            service
                                .goal_runtime
                                .as_ref()
                                .and_then(|runtime| runtime.current_baseline())
                                .filter(|baseline| baseline.run_id == run_id)
                                .ok_or_else(|| {
                                    anyhow::anyhow!(PeerGoalError::Unavailable(
                                        "exact active-run accounting baseline is unavailable"
                                    ))
                                })
                        })
                        .transpose()?;
                    let receipt = crate::store::peer_goals::start_peer_goal(
                        &service.metadata.store_path,
                        &start,
                        baseline.as_ref(),
                        service.config_version.ok_or_else(|| {
                            anyhow::anyhow!("target configuration is unavailable")
                        })?,
                    )?;
                    PeerGoalOutcome::Started { receipt }
                } else {
                    let (goal_id, version, resume) = match request.action() {
                        PeerGoalAction::Pause {
                            goal_id,
                            expected_version,
                        } => (goal_id, *expected_version, false),
                        PeerGoalAction::Resume {
                            goal_id,
                            expected_version,
                        } => (goal_id, *expected_version, true),
                        _ => unreachable!(),
                    };
                    let goal = crate::store::peer_goals::transition_peer_goal(
                        &service.metadata.store_path,
                        &crate::store::peer_goals::PeerGoalTransition {
                            session_id: request.target().to_owned(),
                            goal_id: goal_id.to_owned(),
                            expected_version: version,
                            resume,
                            active_run_id: run.map(str::to_owned),
                            project_id: request.project().map(str::to_owned),
                            config_version: service.config_version.ok_or_else(|| {
                                anyhow::anyhow!("target configuration is unavailable")
                            })?,
                        },
                    )?;
                    if resume {
                        PeerGoalOutcome::Resumed { goal }
                    } else {
                        PeerGoalOutcome::Paused { goal }
                    }
                };
                Ok((
                    value,
                    !matches!(request.action(), PeerGoalAction::Pause { .. }),
                    lease,
                    true,
                ))
            })
            .await??;
        if changed {
            self.cancel_goal_retry_wake();
        }
        if wake {
            if let Some(lease) = lease {
                self.start_next_direct_inbox_item_with_lease_async(lease)
                    .await?;
            }
            // Active turns already settle through the existing continuation owner.
        }
        Ok(value)
    }

    fn require_peer_goal_scope(&self, request: &AuthorizedPeerGoal) -> Result<()> {
        let path = &self.metadata.store_path;
        let target_project = crate::store::load_session_project_id(path, request.target())?;
        anyhow::ensure!(
            target_project.as_deref() == request.project(),
            PeerGoalError::Conflict("target project changed")
        );
        anyhow::ensure!(
            request.caller() != request.target(),
            "peer goal target must be another task"
        );
        let config = sessions::load_session_config(path, request.target())?;
        anyhow::ensure!(
            Some(config.config_version) == self.config_version && config.diagnostics.is_empty(),
            PeerGoalError::Unavailable("target configuration changed")
        );
        anyhow::ensure!(
            matches!(
                crate::store::load_direct_task(path, request.target())?,
                crate::store::TaskLookup::Found(_)
            ),
            PeerGoalError::Unavailable("target is not an independent task")
        );
        Ok(())
    }
}

#[cfg(test)]
#[path = "peer_goals_tests.rs"]
mod tests;
