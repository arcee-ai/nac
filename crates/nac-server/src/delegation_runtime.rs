use std::time::Duration;

use anyhow::anyhow;
use nac_core::{
    run_failure::RunFailure,
    session_service::MessagePageRequest,
    sessions,
    store::{ManagedOrchestratorRecord, ManagedOrchestratorStatus},
};

pub(crate) fn managed_run_failure_status(
    failure: Option<&RunFailure>,
) -> ManagedOrchestratorStatus {
    if failure.is_some_and(RunFailure::is_interrupted) {
        ManagedOrchestratorStatus::Interrupted
    } else {
        ManagedOrchestratorStatus::Failed
    }
}

use crate::{
    orchestration, ServerOrchestrationController, ServerTraditionalChildController,
    SubmitPromptRequest, ThreadSteeringRequest,
};

#[cfg(test)]
static INJECTED_MANAGED_MONITOR_FAILURES: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(crate) fn inject_managed_monitor_failures(count: usize) {
    INJECTED_MANAGED_MONITOR_FAILURES.store(count, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
pub(crate) fn pending_managed_monitor_failures() -> usize {
    INJECTED_MANAGED_MONITOR_FAILURES.load(std::sync::atomic::Ordering::SeqCst)
}

pub(crate) fn load_managed_monitor_record(
    store_path: &std::path::Path,
    orchestrator_session_id: &str,
    generation: u64,
) -> anyhow::Result<Option<ManagedOrchestratorRecord>> {
    #[cfg(feature = "managed-fault-fixture")]
    if nac_core::managed_fault_fixture::hit(
        nac_core::managed_fault_fixture::Boundary::MonitorRead,
        orchestrator_session_id,
        None,
        Some(generation),
    )? {
        return Err(anyhow!(
            "private fixture injected managed monitor read failure"
        ));
    }
    #[cfg(test)]
    if INJECTED_MANAGED_MONITOR_FAILURES
        .fetch_update(
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
            |remaining| remaining.checked_sub(1),
        )
        .is_ok()
    {
        return Err(anyhow!(
            "injected deterministic managed orchestrator monitor failure"
        ));
    }
    let correlation = nac_core::telemetry::Correlation::session(Some(orchestrator_session_id))
        .with_generation(generation);
    nac_core::telemetry::emit_resource_sample(correlation.clone(), None);
    nac_core::telemetry::observe_store(
        nac_core::telemetry::StoreOperation::ManagedMonitorPoll,
        correlation,
        || nac_core::store::load_managed_orchestrator(store_path, orchestrator_session_id),
    )
}

impl nac_core::traditional_children::TraditionalChildController
    for ServerTraditionalChildController
{
    fn start<'a>(
        &'a self,
        request: nac_core::traditional_children::TraditionalChildStartRequest,
    ) -> nac_core::traditional_children::ChildFuture<'a, nac_core::store::TraditionalChildRecord>
    {
        Box::pin(async move {
            let manager = self.manager()?;
            let _host_admission = manager.managed_work_admission_async().await?;
            nac_core::traditional_children::validate_general_profile(&request.profile)?;
            if request.prompt.trim().is_empty() {
                return Err(anyhow!("traditional child prompt is empty"));
            }
            manager
                .repair_orphaned_completion_suppressions_async(&request.parent_session_id)
                .await?;
            let child_session_id = match request.child_session_id {
                Some(child_session_id) => child_session_id,
                None => {
                    manager
                        .create_traditional_child_session(
                            &request.parent_session_id,
                            &request.profile,
                            &request.description,
                        )
                        .await?
                }
            };
            let relation = nac_core::store::load_traditional_child_for_parent(
                &manager.inner.store_path,
                &request.parent_session_id,
                &child_session_id,
            )?
            .ok_or_else(|| anyhow!("traditional child was not found"))?;
            if relation.profile != request.profile {
                return Err(anyhow!(
                    "traditional child profile is immutable (expected '{}')",
                    relation.profile
                ));
            }
            if relation.description != request.description.trim() {
                return Err(anyhow!(
                    "traditional child description is immutable (expected '{}')",
                    relation.description
                ));
            }
            let service = manager.attach_session(&child_session_id).await?;
            // The service reauthorizes each actual mutation. Do not retain a
            // host admission lease throughout a foreground delivery wait.
            drop(_host_admission);
            service
                .submit_or_steer_traditional_child_with_origin(
                    &request.parent_session_id,
                    request.prompt,
                    request.execution_mode,
                    request.origin,
                )
                .await
        })
    }

    fn wait<'a>(
        &'a self,
        child_session_id: &'a str,
        generation: u64,
    ) -> nac_core::traditional_children::ChildFuture<'a, nac_core::store::TraditionalChildRecord>
    {
        Box::pin(async move {
            let manager = self.manager()?;
            loop {
                let child = nac_core::store::load_traditional_child(
                    &manager.inner.store_path,
                    child_session_id,
                )?
                .ok_or_else(|| {
                    anyhow!("traditional child session '{child_session_id}' was not found")
                })?;
                if let Some(terminal) = nac_core::store::load_traditional_child_terminal_receipt(
                    &manager.inner.store_path,
                    child_session_id,
                    generation,
                )? {
                    return Ok(terminal);
                }
                if child.generation != generation {
                    return Err(anyhow!("traditional child generation {generation} has no retained terminal receipt"));
                }
                if child.status.is_terminal() {
                    return Ok(child);
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
    }

    fn cancel<'a>(
        &'a self,
        parent_session_id: &'a str,
        child_session_id: &'a str,
        expected_generation: u64,
    ) -> nac_core::traditional_children::ChildFuture<'a, nac_core::store::TraditionalChildRecord>
    {
        Box::pin(async move {
            let manager = self.manager()?;
            let child = nac_core::store::load_traditional_child(
                &manager.inner.store_path,
                child_session_id,
            )?
            .ok_or_else(|| {
                anyhow!("traditional child session '{child_session_id}' was not found")
            })?;
            if child.parent_session_id != parent_session_id {
                return Err(anyhow!(
                    "session '{child_session_id}' is not a child of parent '{parent_session_id}'"
                ));
            }
            let service = manager.attach_session(child_session_id).await?;
            let child = service
                .reconcile_traditional_child_terminal()
                .await?
                .unwrap_or(child);
            if child.generation != expected_generation {
                return Err(anyhow!(
                    "traditional child generation {expected_generation} was superseded by {}",
                    child.generation
                ));
            }
            if child.status != nac_core::store::TraditionalChildStatus::Running {
                return Ok(child);
            }
            let expected_run_id = child
                .run_id
                .as_deref()
                .ok_or_else(|| anyhow!("running traditional child is missing its run identity"))?;
            let active = service.active_run().ok_or_else(|| {
                anyhow!("traditional child '{child_session_id}' is running in another process")
            })?;
            if active.run_id.as_str() != expected_run_id {
                return Err(anyhow!(
                    "traditional child generation {expected_generation} is no longer active"
                ));
            }
            service
                .request_cancel(&active.run_id)
                .await
                .map_err(anyhow::Error::new)?;
            nac_core::store::load_traditional_child(&manager.inner.store_path, child_session_id)?
                .ok_or_else(|| anyhow!("traditional child disappeared after cancellation"))
        })
    }

    fn wake<'a>(
        &'a self,
        session_id: &'a str,
    ) -> nac_core::traditional_children::ChildFuture<'a, ()> {
        Box::pin(async move {
            let manager = self.manager()?;
            let cached = {
                let active = manager.inner.active_sessions.read().await;
                active.get(session_id).cloned()
            };
            let service = if let Some(service) = cached {
                service
            } else {
                manager.attach_session(session_id).await?
            };
            if service.metadata().behavior != sessions::SessionBehavior::Orchestrator {
                service.start_next_direct_inbox_item().await?;
            }
            Ok(())
        })
    }
}

impl nac_core::orchestration_control::OrchestrationController for ServerOrchestrationController {
    fn start<'a>(
        &'a self,
        request: nac_core::orchestration_control::ManagedOrchestratorStartRequest,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            let _host_admission = manager.managed_work_admission_async().await?;
            if request.prompt.trim().is_empty() {
                return Err(anyhow!("managed orchestrator prompt is empty"));
            }
            manager
                .repair_orphaned_completion_suppressions_async(&request.parent_session_id)
                .await?;
            let orchestrator_session_id = match request.orchestrator_session_id {
                Some(session_id) => session_id,
                None => {
                    manager
                        .create_managed_orchestrator_session(
                            &request.parent_session_id,
                            &request.description,
                        )
                        .await?
                }
            };
            // Creation is committed. Subsequent guarded steering/admission
            // reacquires host authority for its own bounded mutation.
            drop(_host_admission);
            // Serialize start/continue choices, independently of the lifecycle
            // gate used by attachment and the terminal monitor.
            let input_gate =
                manager.lifecycle_gate(&format!("delegated-input:{orchestrator_session_id}"));
            let _input = input_gate.lock().await;
            let service = manager.attach_session(&orchestrator_session_id).await?;
            service.await_finishing_run().await?;
            let mut relation = manager
                .delegation()
                .managed_orchestrator_async(&request.parent_session_id, &orchestrator_session_id)
                .await?;
            if relation.description != request.description.trim() {
                return Err(anyhow!(
                    "managed orchestrator description is immutable (expected '{}')",
                    relation.description
                ));
            }
            if relation.status == ManagedOrchestratorStatus::Running {
                if let Some(steering) = service
                    .steer_managed_orchestrator_input(&request.parent_session_id, &request.prompt)
                    .await?
                {
                    drop(_input);
                    if request.execution_mode
                        == nac_core::store::ManagedOrchestratorExecutionMode::Foreground
                    {
                        wait_for_managed_steering(&manager, &orchestrator_session_id, steering.id)
                            .await?;
                    }
                    return Ok(relation);
                }
                match sessions::SessionOperationLease::try_acquire(
                    &manager.inner.store_path,
                    &orchestrator_session_id,
                ) {
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        let path = manager.inner.store_path.clone();
                        let parent = request.parent_session_id.clone();
                        let id = orchestrator_session_id.clone();
                        let prompt = request.prompt.clone();
                        let host_admission = manager.managed_work_admission_async().await?;
                        let steering = manager
                            .inner
                            ._store_ownership
                            .call_legacy(move || {
                                nac_core::store::queue_managed_orchestrator_steering(
                                    &path, &parent, &id, &prompt,
                                )
                            })
                            .await??;
                        drop(host_admission);
                        drop(_input);
                        if request.execution_mode
                            == nac_core::store::ManagedOrchestratorExecutionMode::Foreground
                        {
                            wait_for_managed_steering(
                                &manager,
                                &orchestrator_session_id,
                                steering.id,
                            )
                            .await?;
                        }
                        return Ok(relation);
                    }
                    Err(error) => return Err(anyhow::Error::new(error)),
                    Ok(lease) => {
                        relation = manager
                            .monitor_managed_orchestrator_with_lease(
                                &orchestrator_session_id,
                                relation.generation,
                                Some(lease),
                            )
                            .await?;
                    }
                }
            }
            if relation.status == ManagedOrchestratorStatus::Running {
                return Err(anyhow!("managed orchestrator is still running"));
            }
            let submitted = manager
                .submit_managed_orchestrator_prompt(
                    &orchestrator_session_id,
                    SubmitPromptRequest {
                        prompt: request.prompt,
                    },
                    request.execution_mode,
                )
                .await?;
            let relation = manager
                .delegation()
                .managed_orchestrator_async(&request.parent_session_id, &orchestrator_session_id)
                .await?;
            debug_assert_eq!(
                relation.run_id.as_deref(),
                Some(submitted.run_id.as_str()),
                "managed child relationship must bind the submitted run generation"
            );
            manager
                .spawn_managed_orchestrator_monitor(orchestrator_session_id, relation.generation);
            Ok(relation)
        })
    }

    fn wait<'a>(
        &'a self,
        orchestrator_session_id: &'a str,
        generation: u64,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            self.manager()?
                .monitor_managed_orchestrator(orchestrator_session_id, generation)
                .await
        })
    }

    fn steer<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        instruction: &'a str,
        thread_name: Option<&'a str>,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            let relation = manager
                .delegation()
                .managed_orchestrator_async(parent_session_id, orchestrator_session_id)
                .await?;
            if relation.status != ManagedOrchestratorStatus::Running {
                return Err(anyhow!("managed orchestrator is not running"));
            }
            if let Some(thread_name) = thread_name {
                let expected_run_id = relation.run_id.as_deref().ok_or_else(|| {
                    anyhow!("running managed orchestrator is missing its run identity")
                })?;
                manager
                    .queue_thread_steering_unchecked(
                        orchestrator_session_id,
                        thread_name,
                        ThreadSteeringRequest {
                            instruction: instruction.to_string(),
                        },
                        Some(expected_run_id),
                    )
                    .await?;
            } else {
                manager
                    .queue_managed_orchestrator_steering_async(
                        parent_session_id,
                        orchestrator_session_id,
                        instruction,
                    )
                    .await?;
            }
            manager
                .delegation()
                .managed_orchestrator_async(parent_session_id, orchestrator_session_id)
                .await
        })
    }

    fn read<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        kind: nac_core::orchestration_control::ManagedOrchestratorReadKind,
        limit: usize,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, serde_json::Value> {
        Box::pin(async move {
            let manager = self.manager()?;
            let operations = orchestration::OrchestrationOperations::new(manager.clone());
            manager
                .delegation()
                .managed_orchestrator_async(parent_session_id, orchestrator_session_id)
                .await?;
            match kind {
                nac_core::orchestration_control::ManagedOrchestratorReadKind::Messages => {
                    let page = operations
                        .messages_page(
                            orchestrator_session_id,
                            MessagePageRequest {
                                before: None,
                                limit,
                                include_system: false,
                            },
                        )
                        .await?;
                    Ok(serde_json::to_value(page)?)
                }
                nac_core::orchestration_control::ManagedOrchestratorReadKind::Episodes => {
                    operations
                        .thread_episodes(orchestrator_session_id, None)
                        .await
                }
                nac_core::orchestration_control::ManagedOrchestratorReadKind::Events => {
                    operations
                        .thread_events(orchestrator_session_id, None, None, limit)
                        .await
                }
            }
        })
    }

    fn cancel<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        expected_generation: u64,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            let relation = manager
                .delegation()
                .managed_orchestrator_async(parent_session_id, orchestrator_session_id)
                .await?;
            if relation.generation != expected_generation {
                return Err(anyhow!(
                    "managed orchestrator generation {expected_generation} was superseded by {}",
                    relation.generation
                ));
            }
            if relation.status != ManagedOrchestratorStatus::Running {
                return Ok(relation);
            }
            let expected_run_id = relation.run_id.as_deref().ok_or_else(|| {
                anyhow!("running managed orchestrator is missing its run identity")
            })?;
            let outcome = manager
                .cancel_active_run_exact_unchecked(orchestrator_session_id, expected_run_id)
                .await?;
            if outcome == crate::application::session_runs::ExactCancelOutcome::ActiveRunMismatch {
                return Err(anyhow!(
                    "managed orchestrator generation {expected_generation} is no longer active"
                ));
            }
            manager
                .monitor_managed_orchestrator(orchestrator_session_id, relation.generation)
                .await
        })
    }

    fn wake<'a>(
        &'a self,
        session_id: &'a str,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ()> {
        Box::pin(async move {
            let manager = self.manager()?;
            let cached = {
                let active = manager.inner.active_sessions.read().await;
                active.get(session_id).cloned()
            };
            let service = match cached {
                Some(service) => service,
                None => manager.attach_session(session_id).await?,
            };
            service.start_next_direct_inbox_item().await?;
            Ok(())
        })
    }
}

/// Foreground steering must establish consumption of this exact input, not
/// borrow a later relationship's successful result. Background means queued.
pub(crate) async fn wait_for_managed_steering(
    manager: &crate::SessionManager,
    session_id: &str,
    steering_id: i64,
) -> anyhow::Result<()> {
    let receipt = load_managed_steering_receipt(manager, session_id, steering_id).await?;
    match receipt.status.as_str() {
        "delivered" => return Ok(()),
        "expired" => return Err(undelivered_managed_steering()),
        _ => {}
    }
    let path = manager.inner.store_path.clone();
    let id = session_id.to_owned();
    let relation = manager
        .inner
        ._store_ownership
        .call_legacy(move || nac_core::store::load_managed_orchestrator(&path, &id))
        .await??
        .ok_or_else(|| anyhow!("managed orchestrator was not found"))?;
    if relation.run_id.as_deref() != Some(receipt.dispatch_id.as_str())
        || relation.status.is_terminal()
    {
        return confirm_managed_steering_delivery(manager, session_id, steering_id).await;
    }

    // Foreground input waits before the application's ordinary completion
    // wait. Drive the existing exact-generation recovery owner now, including
    // peer lease observation, so a crashed peer cannot strand this input wait.
    // This owned task retains its leases if the HTTP future is dropped.
    let monitor_manager = manager.clone();
    let monitor_id = session_id.to_owned();
    let mut monitor = tokio::spawn(async move {
        monitor_manager
            .monitor_managed_orchestrator(&monitor_id, relation.generation)
            .await
    });
    loop {
        let receipt = load_managed_steering_receipt(manager, session_id, steering_id).await?;
        match receipt.status.as_str() {
            "delivered" => return Ok(()),
            "expired" => return Err(undelivered_managed_steering()),
            _ => {}
        }
        let path = manager.inner.store_path.clone();
        let id = session_id.to_owned();
        let current = manager
            .inner
            ._store_ownership
            .call_legacy(move || nac_core::store::load_managed_orchestrator(&path, &id))
            .await??
            .ok_or_else(|| anyhow!("managed orchestrator was not found"))?;
        if current.run_id.as_deref() != Some(receipt.dispatch_id.as_str())
            || current.status.is_terminal()
        {
            return confirm_managed_steering_delivery(manager, session_id, steering_id).await;
        }
        tokio::select! {
            result = &mut monitor => {
                result.map_err(|error| anyhow!("managed steering recovery task failed: {error}"))??;
                return confirm_managed_steering_delivery(manager, session_id, steering_id).await;
            }
            _ = tokio::time::sleep(Duration::from_millis(25)) => {}
        }
    }
}

async fn load_managed_steering_receipt(
    manager: &crate::SessionManager,
    session_id: &str,
    steering_id: i64,
) -> anyhow::Result<nac_core::store::ThreadSteeringRecord> {
    let path = manager.inner.store_path.clone();
    let id = session_id.to_owned();
    manager
        .inner
        ._store_ownership
        .call_legacy(move || nac_core::store::load_thread_steering(&path, &id, steering_id))
        .await??
        .ok_or_else(|| anyhow!("managed orchestrator steering receipt was not found"))
}

async fn confirm_managed_steering_delivery(
    manager: &crate::SessionManager,
    session_id: &str,
    steering_id: i64,
) -> anyhow::Result<()> {
    // Settlement and delivery can commit between reads. Re-read the exact
    // input after terminal/identity observation before declaring it unconsumed.
    let receipt = load_managed_steering_receipt(manager, session_id, steering_id).await?;
    if receipt.status == "delivered" {
        Ok(())
    } else {
        Err(undelivered_managed_steering())
    }
}

fn undelivered_managed_steering() -> anyhow::Error {
    anyhow!("managed orchestrator finished before this steering message was delivered; review its result and explicitly resend the message if still needed")
}
