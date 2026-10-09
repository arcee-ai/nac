use super::*;

impl SessionService {
    pub fn has_unreconciled_durable_run_recovery(&self) -> Result<bool> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(false);
        };
        let record = crate::store::load_run_recovery(&self.metadata.store_path, session_id)?;
        let unsettled =
            crate::store::load_unsettled_user_command(&self.metadata.store_path, session_id)?;
        Ok(self.recovery_pending(record, unsettled))
    }

    pub async fn has_unreconciled_durable_run_recovery_async(&self) -> Result<bool> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(false);
        };
        let Some(owner) = crate::store::coordinator::owner_for(&self.metadata.store_path)? else {
            return self.has_unreconciled_durable_run_recovery();
        };
        let record = owner.load_run_recovery(session_id.to_owned()).await?;
        let unsettled = owner
            .load_unsettled_user_command(session_id.to_owned())
            .await?;
        Ok(self.recovery_pending(record, unsettled))
    }

    fn recovery_pending(
        &self,
        record: Option<crate::store::RunRecoveryRecord>,
        unsettled: Option<UserCommandSnapshot>,
    ) -> bool {
        let reconciled = self
            .reconciled_recovery_run_id
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        unsettled.is_some()
            || record.is_some_and(|record| reconciled.as_deref() != Some(record.run_id.as_str()))
    }

    /// Reconcile a durable run left by another process and refresh this cached
    /// service's transcript while the caller holds the session operation lease.
    /// This preserves the existing event bus/subscribers instead of replacing
    /// the service after a cross-process handoff.
    pub async fn reconcile_durable_run_recovery(
        &self,
        operation_lease: &sessions::SessionOperationLease,
    ) -> Result<crate::store::ActiveRunReconciliation> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("run recovery requires a persisted session"))?;
        if self.has_active_operation() {
            return Err(anyhow::anyhow!(
                "cannot reconcile durable run recovery while a local operation is active"
            ));
        }
        operation_lease
            .validate(&self.metadata.store_path, session_id)
            .map_err(anyhow::Error::new)?;
        let owner = crate::store::coordinator::owner_for(&self.metadata.store_path)?;
        let recovery = match &owner {
            Some(owner) => owner.reconcile_active_run(session_id.to_owned()).await?,
            None => crate::store::reconcile_active_run(&self.metadata.store_path, session_id)?,
        };
        let reconciled_command = match &owner {
            Some(owner) => {
                owner
                    .reconcile_unsettled_user_command(session_id.to_owned())
                    .await?
            }
            None => crate::store::reconcile_unsettled_user_command(
                &self.metadata.store_path,
                session_id,
            )?,
        };
        let mut snapshot =
            sessions::load_session_async(self.metadata.store_path.clone(), session_id.to_string())
                .await?;
        if Some(snapshot.config_version) != self.config_version {
            return Err(anyhow::anyhow!(
                "session '{session_id}' configuration changed before run recovery"
            ));
        }

        let (transcript_scan, transcript_warning, terminal_report) = {
            let mut agent = self.agent.lock().await;
            if let Some(refreshed_blob) = agent
                .restore_messages_merging_log_tail(snapshot.messages.clone(), Some(operation_lease))
                .await?
            {
                snapshot.messages = refreshed_blob;
            }
            (
                TranscriptScanCache::from_transcript(&agent.messages),
                agent.transcript_recovery_warning().map(str::to_owned),
                latest_terminal_assistant_report(&agent.messages),
            )
        };
        *self.session_snapshot.lock().await = Some(snapshot);
        *self.lock_transcript_scan() = transcript_scan;
        *self
            .transcript_recovery_warning
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = transcript_warning;
        let recovered_record = match &owner {
            Some(owner) => owner.load_run_recovery(session_id.to_owned()).await?,
            None => crate::store::load_run_recovery(&self.metadata.store_path, session_id)?,
        };
        let reconciled_run_id = recovered_record
            .as_ref()
            .map(|record| record.run_id.clone());
        *self
            .reconciled_recovery_run_id
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = reconciled_run_id;

        if let Some(command) = reconciled_command {
            self.event_bus
                .emit_with_context_async(
                    SessionEvent::UserCommandUpdated {
                        command: Box::new(command),
                    },
                    None,
                    None,
                )
                .await?;
        }
        match &recovery {
            crate::store::ActiveRunReconciliation::CanonicalTerminal => {
                if let Some(record) = recovered_record {
                    if let Some(disposition) = record.terminal_disposition {
                        let status = match disposition {
                            crate::store::RunTerminalDisposition::Completed => {
                                crate::store::TraditionalChildStatus::Completed
                            }
                            crate::store::RunTerminalDisposition::Cancelled => {
                                crate::store::TraditionalChildStatus::Cancelled
                            }
                        };
                        self.settle_traditional_child_run(
                            &SessionRunId::from_stored(record.run_id),
                            status,
                            (disposition == crate::store::RunTerminalDisposition::Completed)
                                .then(|| terminal_report.clone())
                                .flatten(),
                            None,
                        )
                        .await;
                    }
                }
            }
            crate::store::ActiveRunReconciliation::Failed { run_id, failure } => {
                let failure = failure
                    .clone()
                    .unwrap_or_else(|| crate::run_failure::RunFailure::unknown(FAILED_RUN_WARNING));
                self.event_bus
                    .emit_with_context_async(
                        SessionEvent::RunFailed {
                            message: failure.diagnostic.clone(),
                            failure: Some(failure.clone()),
                        },
                        Some(SessionRunId::from_stored(run_id.clone())),
                        None,
                    )
                    .await?;
                self.settle_traditional_child_run(
                    &SessionRunId::from_stored(run_id.clone()),
                    crate::store::TraditionalChildStatus::Failed,
                    None,
                    Some(failure.diagnostic),
                )
                .await;
            }
            crate::store::ActiveRunReconciliation::Interrupted { run_id } => {
                self.event_bus
                    .emit_with_context_async(
                        SessionEvent::RunFailed {
                            message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                            failure: Some(crate::run_failure::RunFailure::interrupted(
                                INTERRUPTED_RUN_EVENT_MESSAGE,
                            )),
                        },
                        Some(SessionRunId::from_stored(run_id.clone())),
                        None,
                    )
                    .await?;
                self.settle_traditional_child_run(
                    &SessionRunId::from_stored(run_id.clone()),
                    crate::store::TraditionalChildStatus::Interrupted,
                    None,
                    Some(INTERRUPTED_RUN_WARNING.to_string()),
                )
                .await;
            }
            crate::store::ActiveRunReconciliation::None => {}
        }
        Ok(recovery)
    }

    /// Settle a child generation whose durable run-recovery row was already
    /// reconciled while constructing this service after restart.
    pub async fn reconcile_traditional_child_terminal(
        &self,
    ) -> Result<Option<crate::store::TraditionalChildRecord>> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(None);
        };
        let owner = crate::store::coordinator::owner_for(&self.metadata.store_path)?;
        let Some(child) = (if let Some(owner) = &owner {
            owner.load_traditional_child(session_id.to_owned()).await?
        } else {
            crate::store::load_traditional_child(&self.metadata.store_path, session_id)?
        }) else {
            return Ok(None);
        };
        if child.status != crate::store::TraditionalChildStatus::Running {
            return Ok(Some(child));
        }
        let recovery = if let Some(owner) = &owner {
            owner.load_run_recovery(session_id.to_owned()).await?
        } else {
            crate::store::load_run_recovery(&self.metadata.store_path, session_id)?
        };
        let recovery = match recovery {
            Some(recovery) => recovery,
            None => {
                if self.active_run().is_some() {
                    return Ok(Some(child));
                }
                let _lease = match sessions::SessionOperationLease::try_acquire(
                    &self.metadata.store_path,
                    session_id,
                ) {
                    Ok(lease) => lease,
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        return Ok(Some(child));
                    }
                    Err(error) => return Err(anyhow::Error::new(error)),
                };
                if (if let Some(owner) = &owner {
                    owner.load_run_recovery(session_id.to_owned()).await?
                } else {
                    crate::store::load_run_recovery(&self.metadata.store_path, session_id)?
                })
                .is_some()
                {
                    return Ok(Some(child));
                }
                let Some(run_id) = child.run_id.as_deref() else {
                    return Err(anyhow::anyhow!(
                        "running traditional child has no bound run id"
                    ));
                };
                self.settle_traditional_child_run(
                    &SessionRunId::from_stored(run_id.to_string()),
                    crate::store::TraditionalChildStatus::Interrupted,
                    None,
                    Some(
                        "child run ended before its prompt and recovery obligation committed"
                            .to_string(),
                    ),
                )
                .await;
                return match owner {
                    Some(owner) => owner.load_traditional_child(session_id.to_owned()).await,
                    None => {
                        crate::store::load_traditional_child(&self.metadata.store_path, session_id)
                    }
                };
            }
        };
        if recovery.run_id != child.run_id.as_deref().unwrap_or_default() {
            return Ok(Some(child));
        }
        let (status, report, failure) = if let Some(disposition) = recovery.terminal_disposition {
            (
                match disposition {
                    crate::store::RunTerminalDisposition::Completed => {
                        crate::store::TraditionalChildStatus::Completed
                    }
                    crate::store::RunTerminalDisposition::Cancelled => {
                        crate::store::TraditionalChildStatus::Cancelled
                    }
                },
                if disposition == crate::store::RunTerminalDisposition::Completed {
                    self.messages_snapshot()
                        .await
                        .ok()
                        .and_then(|messages| latest_terminal_assistant_report(&messages))
                } else {
                    None
                },
                String::new(),
            )
        } else {
            match recovery.status {
                crate::store::RunRecoveryStatus::Active => return Ok(Some(child)),
                crate::store::RunRecoveryStatus::Interrupted => (
                    crate::store::TraditionalChildStatus::Interrupted,
                    None,
                    INTERRUPTED_RUN_WARNING.to_string(),
                ),
                crate::store::RunRecoveryStatus::Failed => (
                    crate::store::TraditionalChildStatus::Failed,
                    None,
                    FAILED_RUN_WARNING.to_string(),
                ),
            }
        };
        self.settle_traditional_child_run(
            &SessionRunId::from_stored(recovery.run_id),
            status,
            report,
            (!failure.is_empty()).then_some(failure),
        )
        .await;
        match owner {
            Some(owner) => owner.load_traditional_child(session_id.to_owned()).await,
            None => crate::store::load_traditional_child(&self.metadata.store_path, session_id),
        }
    }
}
