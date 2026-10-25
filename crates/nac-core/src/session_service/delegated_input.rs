//! Parent-owned delegated input admission. Relationship projections are not
//! operation authority: terminal persistence can precede local cleanup.
use super::*;

use crate::store::{TraditionalChildExecutionMode, TraditionalChildRecord};

enum ChildInputTransition {
    Accepted(TraditionalChildRecord),
    Queued(
        TraditionalChildRecord,
        i64,
        Option<sessions::ChildInputWaitLease>,
    ),
    Finishing(watch::Receiver<bool>),
    Recovering(sessions::SessionOperationLease),
}

impl SessionService {
    /// Admit a fresh message to an existing child without choosing an action
    /// from a stale relationship snapshot. A finishing run is awaited before
    /// admission; no input has been acknowledged at that point.
    pub async fn submit_or_steer_traditional_child(
        &self,
        parent_session_id: &str,
        prompt: String,
        execution_mode: TraditionalChildExecutionMode,
    ) -> Result<TraditionalChildRecord> {
        loop {
            let service = self.clone();
            let parent = parent_session_id.to_owned();
            let input = prompt.clone();
            let transition =
                crate::store::call_legacy_store(&self.metadata.store_path, move || {
                    service.admit_child_input(&parent, input, execution_mode)
                })
                .await??;
            match transition {
                ChildInputTransition::Accepted(child) => {
                    return Ok(child);
                }
                ChildInputTransition::Queued(child, item_id, _wait_lease) => {
                    self.start_next_direct_inbox_item().await?;
                    if execution_mode == TraditionalChildExecutionMode::Background {
                        return Ok(child);
                    }
                    return self.wait_for_child_input_delivery(item_id).await;
                }
                ChildInputTransition::Recovering(lease) => {
                    self.recover_child_input_for_admission(&lease).await?;
                }
                ChildInputTransition::Finishing(mut settlement) => {
                    if !*settlement.borrow_and_update() {
                        settlement.changed().await.map_err(|_| {
                            anyhow::anyhow!(
                                "child run settlement ended without releasing admission"
                            )
                        })?;
                    }
                }
            }
        }
    }

    pub(super) async fn recover_child_input_for_admission(
        &self,
        lease: &sessions::SessionOperationLease,
    ) -> Result<()> {
        self.reconcile_durable_run_recovery(lease).await?;
        let child = self
            .reconcile_traditional_child_terminal_with_lease(lease)
            .await?
            .ok_or_else(|| anyhow::anyhow!("traditional child was not found after recovery"))?;
        if child.status == crate::store::TraditionalChildStatus::Running {
            // The lease proves there is no live owner to receive a steer. A
            // mismatched recovery identity or failed settlement is not progress;
            // fail closed instead of hot-looping or queueing to an unowned run.
            return Err(anyhow::anyhow!(
                "traditional child generation {} remains running after recovery; input was not admitted",
                child.generation,
            ));
        }
        Ok(())
    }

    async fn wait_for_child_input_delivery(&self, item_id: i64) -> Result<TraditionalChildRecord> {
        loop {
            let service = self.clone();
            let delivered = crate::store::call_legacy_store(&self.metadata.store_path, move || {
                let session_id = service
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
                let child =
                    crate::store::load_traditional_child(&service.metadata.store_path, session_id)?
                        .ok_or_else(|| anyhow::anyhow!("traditional child was not found"))?;
                let item = crate::store::load_session_inbox_item(
                    &service.metadata.store_path,
                    session_id,
                    item_id,
                )?;
                match item.status {
                    crate::store::InboxStatus::Cancelled => {
                        Err(anyhow::anyhow!("child input was cancelled before delivery"))
                    }
                    crate::store::InboxStatus::Pending => Ok(None),
                    crate::store::InboxStatus::Delivered => {
                        let run_id = item.delivered_run_id.as_deref().ok_or_else(|| {
                            anyhow::anyhow!("delivered child input has no run identity")
                        })?;
                        if child.run_id.as_deref() == Some(run_id) {
                            return Ok(Some(child));
                        }
                        crate::store::load_traditional_child_terminal_receipt_for_run(
                            &service.metadata.store_path,
                            session_id,
                            run_id,
                        )?
                        .map(Some)
                        .ok_or_else(|| {
                            anyhow::anyhow!("delivered child run has no retained terminal receipt")
                        })
                    }
                }
            })
            .await??;
            if let Some(child) = delivered {
                return Ok(child);
            }
            if self
                .stopping_admission
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return Err(anyhow::anyhow!(
                    "session is shutting down before child input delivery was confirmed"
                ));
            }
            self.start_next_direct_inbox_item().await?;
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    fn admit_child_input(
        &self,
        parent_session_id: &str,
        prompt: String,
        execution_mode: TraditionalChildExecutionMode,
    ) -> Result<ChildInputTransition> {
        if prompt.trim().is_empty() {
            return Err(anyhow::anyhow!("traditional child prompt is empty"));
        }
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let _host_admission = self.delegated_work_admission()?;
        let guard = self.lock_active_operation();
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(anyhow::anyhow!(
                "session is shutting down; new runs are rejected"
            ));
        }
        let child = crate::store::load_traditional_child_for_parent(
            &self.metadata.store_path,
            parent_session_id,
            session_id,
        )?
        .ok_or_else(|| anyhow::anyhow!("traditional child was not found"))?;
        match guard.as_ref() {
            Some(ActiveSessionOperation::Run(run)) if run.finishing => {
                #[cfg(any(test, feature = "test-support"))]
                self.observe_child_input_handoff_for_test();
                return Ok(ChildInputTransition::Finishing(run.settlement.subscribe()));
            }
            Some(ActiveSessionOperation::Run(run)) => {
                let wait_lease = (execution_mode == TraditionalChildExecutionMode::Foreground)
                    .then(|| sessions::ChildInputWaitLease::new(&self.metadata.store_path))
                    .transpose()?;
                let input = crate::store::create_traditional_child_inbox_item(
                    &self.metadata.store_path,
                    session_id,
                    &prompt,
                    Some(run.snapshot.run_id.as_str()),
                    execution_mode,
                    wait_lease.as_ref().map(sessions::ChildInputWaitLease::id),
                )?;
                return Ok(ChildInputTransition::Queued(child, input.id, wait_lease));
            }
            None if child.status == crate::store::TraditionalChildStatus::Running => {
                // A busy OS lease, rather than a missing local task, proves a
                // peer owns this generation. Persist input for that exact run.
                match sessions::SessionOperationLease::try_acquire(
                    &self.metadata.store_path,
                    session_id,
                ) {
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        let wait_lease = (execution_mode
                            == TraditionalChildExecutionMode::Foreground)
                            .then(|| sessions::ChildInputWaitLease::new(&self.metadata.store_path))
                            .transpose()?;
                        let input = crate::store::create_traditional_child_inbox_item(
                            &self.metadata.store_path,
                            session_id,
                            &prompt,
                            child.run_id.as_deref(),
                            execution_mode,
                            wait_lease.as_ref().map(sessions::ChildInputWaitLease::id),
                        )?;
                        return Ok(ChildInputTransition::Queued(child, input.id, wait_lease));
                    }
                    Err(error) => return Err(error.into()),
                    Ok(lease) => {
                        return Ok(ChildInputTransition::Recovering(lease));
                    }
                }
            }
            _ => {}
        }
        let generation = child.generation + 1;
        let submitted = self
            .try_submit_prompt_with_guard(
                None,
                prompt,
                None,
                RunAdmissionKind {
                    child_execution_mode: Some(execution_mode),
                    ..Default::default()
                },
                Some(guard),
            )
            .map_err(anyhow::Error::new)?;
        let admitted = crate::store::load_traditional_child(&self.metadata.store_path, session_id)?
            .ok_or_else(|| anyhow::anyhow!("traditional child disappeared after run admission"))?;
        if admitted.run_id.as_deref() == Some(submitted.run_id.as_str()) {
            return Ok(ChildInputTransition::Accepted(admitted));
        }
        let terminal = crate::store::load_traditional_child_terminal_receipt(
            &self.metadata.store_path,
            session_id,
            generation,
        )?
        .filter(|record| record.run_id.as_deref() == Some(submitted.run_id.as_str()))
        .ok_or_else(|| anyhow::anyhow!("admitted child generation has no terminal receipt"))?;
        Ok(ChildInputTransition::Accepted(terminal))
    }

    /// Queue against a live local managed run, or await its exact finishing
    /// boundary and let the controller revalidate continuation admission.
    pub async fn steer_managed_orchestrator_input(
        &self,
        parent_session_id: &str,
        instruction: &str,
    ) -> Result<Option<crate::store::ThreadSteeringRecord>> {
        let service = self.clone();
        let parent = parent_session_id.to_owned();
        let instruction = instruction.to_owned();
        let transition = crate::store::call_legacy_store(&self.metadata.store_path, move || {
            let session_id = service
                .metadata
                .session_id
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
            let _host_admission = service.delegated_work_admission()?;
            let guard = service.lock_active_operation();
            if service
                .stopping_admission
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return Err(anyhow::anyhow!(
                    "session is shutting down; new input is rejected"
                ));
            }
            match guard.as_ref() {
                Some(ActiveSessionOperation::Run(run)) if run.finishing => {
                    Ok((None, Some(run.settlement.subscribe())))
                }
                Some(ActiveSessionOperation::Run(_)) => {
                    let steering = crate::store::queue_managed_orchestrator_steering(
                        &service.metadata.store_path,
                        &parent,
                        session_id,
                        &instruction,
                    )?;
                    Ok((Some(steering), None))
                }
                _ => Ok((None, None)),
            }
        })
        .await??;
        if let Some(mut settlement) = transition.1 {
            if !*settlement.borrow_and_update() {
                settlement.changed().await.map_err(|_| {
                    anyhow::anyhow!("run settlement ended without releasing admission")
                })?;
            }
        }
        Ok(transition.0)
    }

    // The shared host lease protects the durable input mutation only. It must
    // not remain held while a foreground caller waits for delivery/settlement.
    fn delegated_work_admission(&self) -> Result<Option<crate::store::ManagedWorkAdmission>> {
        if !self.managed_admission_enabled {
            return Ok(None);
        }
        match self.managed_identity.as_deref() {
            Some(identity) => crate::store::try_admit_managed_work_for_identity(
                &self.metadata.store_path,
                identity,
            ),
            None => crate::store::try_admit_managed_work(&self.metadata.store_path),
        }
        .map(Some)
    }

    /// Register a finishing-run handoff while holding the authoritative local
    /// operation lock. A caller must revalidate normal admission after waking.
    pub async fn await_finishing_run(&self) -> Result<()> {
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(anyhow::anyhow!(
                "session is shutting down; new input is rejected"
            ));
        }
        let settlement = self
            .coordinate_local(move |service| {
                let guard = service.lock_active_operation();
                match guard.as_ref() {
                    Some(ActiveSessionOperation::Run(run)) if run.finishing => {
                        Some(run.settlement.subscribe())
                    }
                    _ => None,
                }
            })
            .await?;
        if let Some(mut settlement) = settlement {
            if !*settlement.borrow_and_update() {
                settlement.changed().await.map_err(|_| {
                    anyhow::anyhow!("run settlement ended without releasing admission")
                })?;
            }
        }
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(anyhow::anyhow!(
                "session is shutting down; new input is rejected"
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "delegated_input_tests.rs"]
mod tests;
