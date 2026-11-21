use std::time::Duration;

use crate::ServerTraditionalChildController;
use anyhow::anyhow;

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
            // Only creation needs a caller label; reject its absence before
            // any repair or relationship mutation.
            if request.child_session_id.is_none() {
                nac_core::traditional_children::description_for_new_child(
                    request.description.as_deref(),
                )?;
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
                            nac_core::traditional_children::description_for_new_child(
                                request.description.as_deref(),
                            )?,
                        )
                        .await?
                }
            };
            let path = manager.inner.store_path.clone();
            let parent = request.parent_session_id.clone();
            let child = child_session_id.clone();
            let relation = manager
                .inner
                ._store_ownership
                .call_legacy(move || {
                    nac_core::store::load_traditional_child_for_parent(&path, &parent, &child)
                })
                .await??
                .ok_or_else(|| anyhow!("traditional child was not found"))?;
            if relation.profile != request.profile {
                return Err(anyhow!(
                    "traditional child profile is immutable (expected '{}')",
                    relation.profile
                ));
            }
            // Ownership was established above, so a mismatch may name the
            // caller's own label. It rejects before attachment or any turn.
            nac_core::traditional_children::check_continuation_description(
                &relation,
                request.description.as_deref(),
            )?;
            let reservation = manager.reserve_continuation(&child_session_id).await?;
            // Transfer attachment and its host lease to the owned actor; the
            // actor drops the host lease before any foreground delivery wait.
            manager
                .submit_owned_child_input(
                    None,
                    _host_admission,
                    request.parent_session_id,
                    child_session_id,
                    request.prompt,
                    request.execution_mode,
                    request.origin,
                    reservation,
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
                let path = manager.inner.store_path.clone();
                let child_id = child_session_id.to_owned();
                let (child, terminal) = manager
                    .inner
                    ._store_ownership
                    .call_legacy(move || {
                        let child = nac_core::store::load_traditional_child(&path, &child_id)?;
                        let terminal = if child.is_some() {
                            nac_core::store::load_traditional_child_terminal_receipt(
                                &path, &child_id, generation,
                            )?
                        } else {
                            None
                        };
                        Ok::<_, anyhow::Error>((child, terminal))
                    })
                    .await??;
                let child = child.ok_or_else(|| {
                    anyhow!("traditional child session '{child_session_id}' was not found")
                })?;
                if let Some(terminal) = terminal {
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
            let path = manager.inner.store_path.clone();
            let child_id = child_session_id.to_owned();
            let child = manager
                .inner
                ._store_ownership
                .call_legacy(move || nac_core::store::load_traditional_child(&path, &child_id))
                .await??
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
            let path = manager.inner.store_path.clone();
            let child_id = child_session_id.to_owned();
            manager
                .inner
                ._store_ownership
                .call_legacy(move || nac_core::store::load_traditional_child(&path, &child_id))
                .await??
                .ok_or_else(|| anyhow!("traditional child disappeared after cancellation"))
        })
    }

    fn retain_wake(&self, session_id: &str) -> Option<anyhow::Result<()>> {
        Some(
            self.manager()
                .and_then(|manager| manager.schedule_continuation(session_id)),
        )
    }

    fn retain_recovery(&self, session_id: &str) -> Option<anyhow::Result<()>> {
        Some(
            self.manager()
                .and_then(|manager| manager.schedule_recovery(session_id)),
        )
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
            service.start_next_direct_inbox_item().await?;
            Ok(())
        })
    }
}
