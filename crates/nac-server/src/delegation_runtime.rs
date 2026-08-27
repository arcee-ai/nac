use std::time::Duration;

use anyhow::anyhow;
use nac_core::{
    session_service::MessagePageRequest,
    sessions,
    store::{ManagedOrchestratorRecord, ManagedOrchestratorStatus},
};

use crate::{
    orchestration, ServerOrchestrationController, ServerTraditionalChildController,
    SubmitPromptRequest, ThreadSteeringRequest,
};

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
            nac_core::traditional_children::validate_general_profile(&request.profile)?;
            if request.prompt.trim().is_empty() {
                return Err(anyhow!("traditional child prompt is empty"));
            }
            manager.repair_orphaned_completion_suppressions(&request.parent_session_id)?;
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
            let relation = service
                .reconcile_traditional_child_terminal()
                .await?
                .unwrap_or(relation);
            if relation.status == nac_core::store::TraditionalChildStatus::Running {
                if service.active_run().is_some() {
                    service
                        .enqueue_traditional_child_input(
                            nac_core::store::InboxDelivery::Steer,
                            &request.prompt,
                        )
                        .await?;
                } else {
                    nac_core::store::create_session_inbox_item(
                        &manager.inner.store_path,
                        &child_session_id,
                        nac_core::store::InboxDelivery::Steer,
                        &request.prompt,
                        relation.run_id.as_deref(),
                        None,
                    )?;
                }
                return Ok(relation);
            }
            service
                .try_submit_traditional_child_prompt(request.prompt, request.execution_mode)
                .map_err(anyhow::Error::new)?;
            nac_core::store::load_traditional_child(&manager.inner.store_path, &child_session_id)?
                .ok_or_else(|| anyhow!("traditional child disappeared after run admission"))
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
                if child.generation != generation {
                    return Err(anyhow!(
                        "traditional child generation {generation} was superseded by {}",
                        child.generation
                    ));
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
            if child.status != nac_core::store::TraditionalChildStatus::Running {
                return Ok(child);
            }
            let active = service.active_run().ok_or_else(|| {
                anyhow!("traditional child '{child_session_id}' is running in another process")
            })?;
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
            if request.prompt.trim().is_empty() {
                return Err(anyhow!("managed orchestrator prompt is empty"));
            }
            manager.repair_orphaned_completion_suppressions(&request.parent_session_id)?;
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
            let mut relation = manager
                .delegation()
                .managed_orchestrator(&request.parent_session_id, &orchestrator_session_id)?;
            if relation.description != request.description.trim() {
                return Err(anyhow!(
                    "managed orchestrator description is immutable (expected '{}')",
                    relation.description
                ));
            }
            if relation.status == ManagedOrchestratorStatus::Running {
                let service = manager.attach_session(&orchestrator_session_id).await?;
                if service.active_run().is_some() {
                    manager.queue_managed_orchestrator_steering(
                        &request.parent_session_id,
                        &orchestrator_session_id,
                        &request.prompt,
                    )?;
                    return Ok(relation);
                }
                match sessions::SessionOperationLease::try_acquire(
                    &manager.inner.store_path,
                    &orchestrator_session_id,
                ) {
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        manager.queue_managed_orchestrator_steering(
                            &request.parent_session_id,
                            &orchestrator_session_id,
                            &request.prompt,
                        )?;
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
            let relation = nac_core::store::load_managed_orchestrator(
                &manager.inner.store_path,
                &orchestrator_session_id,
            )?
            .ok_or_else(|| anyhow!("managed orchestrator disappeared after run admission"))?;
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
                .managed_orchestrator(parent_session_id, orchestrator_session_id)?;
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
                manager.queue_managed_orchestrator_steering(
                    parent_session_id,
                    orchestrator_session_id,
                    instruction,
                )?;
            }
            manager
                .delegation()
                .managed_orchestrator(parent_session_id, orchestrator_session_id)
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
                .managed_orchestrator(parent_session_id, orchestrator_session_id)?;
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
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            let relation = manager
                .delegation()
                .managed_orchestrator(parent_session_id, orchestrator_session_id)?;
            if relation.status != ManagedOrchestratorStatus::Running {
                return Ok(relation);
            }
            manager
                .cancel_active_run_unchecked(orchestrator_session_id)
                .await?;
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
