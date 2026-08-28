use std::sync::Arc;

use anyhow::{anyhow, Result};
use nac_core::{
    runtime::{self, NacConfig},
    session_service::SessionService,
    sessions,
    store::ManagedOrchestratorStatus,
};

use crate::SessionManager;

/// Session attachment, durable recovery, and cache publication.
///
/// Resource leases precede sandbox observation, configuration versions are
/// checked before publication, and delegated completion repair/wake-up remains
/// part of the same lifecycle boundary.
pub(crate) struct SessionAttachmentApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionAttachmentApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn attach_session(&self, session_id: &str) -> Result<Arc<SessionService>> {
        const MAX_ATTEMPTS: usize = 2;

        self.manager.sweep_idle_sessions(Some(session_id)).await;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        for _ in 0..MAX_ATTEMPTS {
            let cached_service = {
                let active = self.manager.inner.active_sessions.read().await;
                active.get(session_id).cloned()
            };
            if let Some(service) = cached_service {
                let version = self.manager.session_config(session_id)?.config_version;
                if service.config_version() == Some(version) {
                    let has_recovery = service.has_unreconciled_durable_run_recovery()?;
                    if !has_recovery || service.has_active_operation() {
                        self.manager.wake_direct_inbox(&service).await?;
                        return Ok(service);
                    }
                    match sessions::SessionOperationLease::try_acquire(
                        &self.manager.inner.store_path,
                        session_id,
                    ) {
                        Ok(lease) => {
                            service.reconcile_durable_run_recovery(&lease).await?;
                            drop(lease);
                            self.manager.wake_direct_inbox(&service).await?;
                            return Ok(service);
                        }
                        Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                            return Ok(service);
                        }
                        Err(error) => return Err(anyhow::Error::new(error)),
                    }
                }
                let mut active = self.manager.inner.active_sessions.write().await;
                if active
                    .get(session_id)
                    .is_some_and(|cached| Arc::ptr_eq(cached, &service))
                {
                    active.remove(session_id);
                }
            }

            let (service, cacheable, operation_lease) =
                self.manager.resume_session_attachment(session_id).await?;
            drop(operation_lease);
            let service = Arc::new(service);
            if !cacheable {
                return Ok(service);
            }
            let version = self.manager.session_config(session_id)?.config_version;
            if service.config_version() != Some(version) {
                continue;
            }
            self.manager
                .inner
                .active_sessions
                .write()
                .await
                .insert(session_id.to_string(), Arc::clone(&service));
            self.manager.wake_direct_inbox(&service).await?;
            return Ok(service);
        }
        Err(anyhow!(
            "session '{session_id}' configuration kept changing during attachment"
        ))
    }

    pub(crate) async fn wake_direct_inbox(&self, service: &SessionService) -> Result<()> {
        if let Some(parent_session_id) = service.metadata().session_id.as_deref() {
            self.manager
                .repair_orphaned_completion_suppressions(parent_session_id)?;
        }
        let child = service.reconcile_traditional_child_terminal().await?;
        if child.is_none() {
            let metadata = service.metadata();
            let Some(parent_session_id) = metadata.session_id.as_deref() else {
                return Ok(());
            };
            let running_children = nac_core::store::list_traditional_children(
                &self.manager.inner.store_path,
                parent_session_id,
            )?
            .into_iter()
            .filter(|child| child.status == nac_core::store::TraditionalChildStatus::Running)
            .map(|child| child.child_session_id)
            .collect::<Vec<_>>();
            for child_session_id in running_children {
                // Attaching a child reconciles an abandoned generation from its
                // durable run-recovery row. The parent is already cached before
                // this method runs, so the resulting completion wake does not
                // need to re-enter the parent's lifecycle gate.
                Box::pin(self.manager.attach_session(&child_session_id)).await?;
            }
            if metadata.behavior == sessions::SessionBehavior::DirectWithOrchestrator {
                for orchestrator in nac_core::store::list_managed_orchestrators(
                    &self.manager.inner.store_path,
                    parent_session_id,
                )?
                .into_iter()
                .filter(|orchestrator| orchestrator.status == ManagedOrchestratorStatus::Running)
                {
                    self.manager.spawn_managed_orchestrator_monitor(
                        orchestrator.orchestrator_session_id,
                        orchestrator.generation,
                    );
                }
            }
        }
        if service.metadata().behavior != sessions::SessionBehavior::Orchestrator {
            service.start_next_direct_inbox_item().await?;
        }
        Ok(())
    }

    /// `completion_suppressed=1` is itself the durable rollback obligation for
    /// a deletion that did not commit. An active deletion owns the child's
    /// relationship lease and wins; after process death or a failed in-memory
    /// rollback the lease is free, so parent attachment restores delivery and
    /// synthesizes any terminal completion that settlement omitted.
    pub(crate) fn repair_orphaned_completion_suppressions(
        &self,
        parent_session_id: &str,
    ) -> Result<()> {
        let store_path = &self.manager.inner.store_path;
        for (child_session_id, generation) in
            nac_core::store::list_suppressed_traditional_child_generations(
                store_path,
                parent_session_id,
            )?
        {
            let lease = match sessions::SessionRelationshipLease::try_acquire(
                store_path,
                &child_session_id,
            ) {
                Ok(lease) => lease,
                Err(sessions::SessionOperationLeaseError::Busy(_)) => continue,
                Err(sessions::SessionOperationLeaseError::Store(error)) => return Err(error),
            };
            if sessions::load_session(store_path, &child_session_id).is_ok() {
                nac_core::store::restore_traditional_child_completion(
                    store_path,
                    &child_session_id,
                    generation,
                )?;
            }
            drop(lease);
        }
        for (orchestrator_session_id, generation) in
            nac_core::store::list_suppressed_managed_orchestrator_generations(
                store_path,
                parent_session_id,
            )?
        {
            let lease = match sessions::SessionRelationshipLease::try_acquire(
                store_path,
                &orchestrator_session_id,
            ) {
                Ok(lease) => lease,
                Err(sessions::SessionOperationLeaseError::Busy(_)) => continue,
                Err(sessions::SessionOperationLeaseError::Store(error)) => return Err(error),
            };
            if sessions::load_session(store_path, &orchestrator_session_id).is_ok() {
                nac_core::store::restore_managed_orchestrator_completion(
                    store_path,
                    &orchestrator_session_id,
                    generation,
                )?;
            }
            drop(lease);
        }
        Ok(())
    }

    /// Attaches while the caller holds this session's lifecycle gate. Keeping
    /// resume and insertion behind the same gate prevents an old service from
    /// being inserted after a settings update has committed.
    pub(crate) async fn attach_session_locked(
        &self,
        session_id: &str,
        operation_lease: Option<&sessions::SessionOperationLease>,
    ) -> Result<Arc<SessionService>> {
        self.manager.sweep_idle_sessions(Some(session_id)).await;
        if let Some(service) = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
        {
            return Ok(Arc::clone(service));
        }

        let service = Arc::new(
            self.manager
                .resume_session(session_id, operation_lease)
                .await?,
        );
        let mut active = self.manager.inner.active_sessions.write().await;
        if let Some(existing) = active.get(session_id) {
            return Ok(Arc::clone(existing));
        }
        active.insert(session_id.to_string(), Arc::clone(&service));
        Ok(service)
    }

    /// Returns a service whose model configuration matches the store. The
    /// caller must hold both the local lifecycle gate and the supplied
    /// operation lease. Durable compaction checkpoints are refreshed by the
    /// core admission path after this returns.
    pub(crate) async fn attach_current_operation_service_locked(
        &self,
        session_id: &str,
        operation_lease: &sessions::SessionOperationLease,
    ) -> Result<Arc<SessionService>> {
        operation_lease
            .validate(&self.manager.inner.store_path, session_id)
            .map_err(anyhow::Error::new)?;
        let persisted_version =
            sessions::load_session_config(&self.manager.inner.store_path, session_id)?
                .config_version;
        let cached = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        let service = if let Some(service) = cached {
            if service.config_version() == Some(persisted_version) {
                service
            } else {
                if service.has_active_operation() {
                    return Err(anyhow!(
                        "session is busy with an active operation while its persisted configuration changed"
                    ));
                }
                self.manager
                    .inner
                    .active_sessions
                    .write()
                    .await
                    .remove(session_id);
                self.manager
                    .attach_session_locked(session_id, Some(operation_lease))
                    .await?
            }
        } else {
            self.manager
                .attach_session_locked(session_id, Some(operation_lease))
                .await?
        };
        if service.has_unreconciled_durable_run_recovery()? && !service.has_active_operation() {
            service
                .reconcile_durable_run_recovery(operation_lease)
                .await?;
        }
        Ok(service)
    }

    pub(crate) async fn resume_session(
        &self,
        session_id: &str,
        operation_lease: Option<&sessions::SessionOperationLease>,
    ) -> Result<SessionService> {
        let summary = self
            .manager
            .session_catalog()
            .list(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{session_id}' was not found"))?;
        let resource_lease = summary
            .sandboxed
            .then(|| {
                sessions::SessionResourceLease::try_acquire(
                    &self.manager.inner.store_path,
                    session_id,
                )
                .map_err(anyhow::Error::new)
            })
            .transpose()?;
        let config_cwd = if summary.ssh_host.is_some() {
            &self.manager.inner.root_cwd
        } else {
            &summary.cwd
        };
        let config = NacConfig::load_without_model_from_cwd(config_cwd)?;
        let mut run_config = if let Some(operation_lease) = operation_lease {
            runtime::build_resume_config_for_session_with_lease(
                self.manager.inner.store_path.clone(),
                session_id,
                &config,
                self.manager.inner.root_cwd.clone(),
                Some(self.manager.inner.worker_executable.clone()),
                operation_lease,
                runtime::ResumeModelOptions::default(),
            )
            .await?
        } else {
            runtime::build_resume_config_for_session(
                self.manager.inner.store_path.clone(),
                session_id,
                &config,
                self.manager.inner.root_cwd.clone(),
                Some(self.manager.inner.worker_executable.clone()),
                runtime::ResumeModelOptions::default(),
            )
            .await?
        };
        self.manager
            .attach_managed_command_environment(&mut run_config)?;
        let service = SessionService::from_orchestrator_run_config(run_config).service;
        if let Some(resource_lease) = resource_lease {
            service.adopt_sandbox_resource_lease(resource_lease);
        }
        Ok(service)
    }

    pub(crate) async fn resume_session_attachment(
        &self,
        session_id: &str,
    ) -> Result<(
        SessionService,
        bool,
        Option<sessions::SessionOperationLease>,
    )> {
        let summary = self
            .manager
            .session_catalog()
            .list(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{session_id}' was not found"))?;
        // For a sandbox row, shared resource authority must precede snapshot
        // loading and any observer-side Podman inspection/materialization. A
        // concurrent deletion either wins before this acquisition (so the
        // subsequent row load fails) or remains excluded through service
        // publication. Ordinary sessions create no resource lock sidecar.
        let resource_lease = summary
            .sandboxed
            .then(|| {
                sessions::SessionResourceLease::try_acquire(
                    &self.manager.inner.store_path,
                    session_id,
                )
                .map_err(anyhow::Error::new)
            })
            .transpose()?;
        let config_cwd = if summary.ssh_host.is_some() {
            &self.manager.inner.root_cwd
        } else {
            &summary.cwd
        };
        let config = NacConfig::load_without_model_from_cwd(config_cwd)?;
        let (mut run_config, cacheable, operation_lease) =
            runtime::build_resume_config_for_session_attachment(
                self.manager.inner.store_path.clone(),
                session_id,
                &config,
                self.manager.inner.root_cwd.clone(),
                Some(self.manager.inner.worker_executable.clone()),
                runtime::ResumeModelOptions::default(),
            )
            .await?;
        self.manager
            .attach_managed_command_environment(&mut run_config)?;
        let service = SessionService::from_orchestrator_run_config(run_config).service;
        if let Some(resource_lease) = resource_lease {
            service.adopt_sandbox_resource_lease(resource_lease);
        }
        Ok((service, cacheable, operation_lease))
    }
}
