//! Human task-launch use case over the existing prepared-session lifecycle.
use crate::SessionManager;
use anyhow::{anyhow, Result};
use nac_core::{
    sessions,
    store::{self, TaskLaunchPhase, TaskLaunchRecord, TaskLaunchRequest},
    workspace::task_worktree,
};

#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct TaskLaunchSourceInfo {
    pub eligible: bool,
    pub default_ref: Option<String>,
}

pub(crate) struct TaskLaunchApplication<'a> {
    manager: &'a SessionManager,
}
impl<'a> TaskLaunchApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn source_info(&self, project_id: String) -> Result<TaskLaunchSourceInfo> {
        let path = self.manager.inner.store_path.clone();
        let unmanaged = self.manager.managed_host().is_none();
        store::spawn_blocking_store_caller(move || {
            let project =
                nac_core::projects::load_project_launch_context(&path, &project_id)?.project;
            let bound = store::load_project_git_source(&path, &project_id)?;
            let eligible = unmanaged
                && project.ssh_host.is_none()
                && (bound.is_some() || task_worktree::is_git_project(&project.cwd)?);
            Ok(TaskLaunchSourceInfo {
                eligible,
                default_ref: bound.map(|b| b.default_ref),
            })
        })
        .await?
    }

    pub(crate) async fn start(&self, request: TaskLaunchRequest) -> Result<TaskLaunchRecord> {
        request.validate()?;
        // Keep existing serving/host admission effective. Local retained task
        // workspaces are deliberately absent from managed-host deployment.
        anyhow::ensure!(
            self.manager.managed_host().is_none(),
            "invalid request: retained tasks require an unmanaged Local host"
        );
        let manager = self.manager.clone();
        let prepared = store::spawn_blocking_store_caller(move || -> Result<_> {
            let path = &manager.inner.store_path;
            let lease_id = format!("task-launch:{}", request.request_id);
            let lease = match sessions::SessionOperationLease::try_acquire(path, &lease_id) {
                Ok(lease) => lease,
                Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                    let existing = store::load_task_launch(path, &request.request_id)?
                        .ok_or_else(|| anyhow!("conflict: launch source resolution is in progress; retry the same request"))?;
                    anyhow::ensure!(existing.request == request, "conflict: launch identity reused with different arguments");
                    return Ok((existing, None));
                }
                Err(error) => return Err(error.into()),
            };
            if let Some(existing) = store::load_task_launch(path, &request.request_id)? {
                anyhow::ensure!(existing.request == request, "conflict: launch identity reused with different arguments");
                return Ok((existing, Some(lease)));
            }
            let project = nac_core::projects::load_project_launch_context(path, &request.project_id)?.project;
            let bound = store::load_project_git_source(path, &request.project_id)?;
            let invoking = request.invoking_session_id.as_deref().map(|id| sessions::load_session(path,id)).transpose()?;
            let source = task_worktree::resolve_source(&project, &request, bound.as_ref(), invoking.as_ref())?;
            let record = store::reserve_task_launch(path, request, source)?;
            Ok((record, Some(lease)))
        }).await??;
        let (record, lease) = prepared;
        if let Some(lease) = lease {
            if !matches!(
                record.phase,
                TaskLaunchPhase::Ready | TaskLaunchPhase::Cancelled
            ) {
                let manager = self.manager.clone();
                let launch = record.clone();
                // The request may disappear; the preparation owns its lease and
                // durable receipt through publication, never the HTTP waiter.
                tokio::spawn(async move {
                    let result = Self::prepare(&manager, launch.clone()).await;
                    if let Err(error) = result {
                        let path = manager.inner.store_path.clone();
                        let id = launch.request.request_id.clone();
                        let _ = store::spawn_blocking_store_caller(move || {
                            store::update_task_launch(
                                &path,
                                &id,
                                TaskLaunchPhase::Failed,
                                Some(format!("{error:#}")),
                            )
                        })
                        .await;
                    }
                    drop(lease);
                });
            }
        }
        Ok(record)
    }

    async fn phase(
        manager: &SessionManager,
        launch: &TaskLaunchRecord,
        phase: TaskLaunchPhase,
    ) -> Result<TaskLaunchRecord> {
        let path = manager.inner.store_path.clone();
        let id = launch.request.request_id.clone();
        store::spawn_blocking_store_caller(move || {
            store::update_task_launch(&path, &id, phase, None)
        })
        .await?
    }

    async fn prepare(manager: &SessionManager, launch: TaskLaunchRecord) -> Result<()> {
        let launch = Self::phase(manager, &launch, TaskLaunchPhase::PreparingWorkspace).await?;
        if launch.phase == TaskLaunchPhase::Cancelled {
            return Ok(());
        }
        let path = manager.inner.store_path.clone();
        let work = launch.clone();
        store::spawn_blocking_store_caller(move || -> Result<()> {
            let config = nac_core::runtime::NacConfig::load_from_cwd(&work.source.project_cwd)?;
            task_worktree::authorize_human_preparation(&work, &config, &path)?;
            task_worktree::prepare_workspace(&work)?;
            Ok(())
        })
        .await??;
        let launch = Self::phase(manager, &launch, TaskLaunchPhase::PreparingRuntime).await?;
        if launch.phase == TaskLaunchPhase::Cancelled {
            return Ok(());
        }
        let snapshot = manager
            .session_creation()
            .create_retained_task_session(launch)
            .await?;
        let id = snapshot
            .metadata
            .session_id
            .ok_or_else(|| anyhow!("prepared task missing identity"))?;
        // Publication committed the only initial inbox item. Existing admission
        // owns its idempotent promotion; reattachment recovers pending input.
        let service = manager.inner.active_sessions.read().await.get(&id).cloned();
        if let Some(service) = service {
            manager.wake_direct_inbox(&service).await?;
        }
        Ok(())
    }

    pub(crate) async fn status(&self, request_id: String) -> Result<TaskLaunchRecord> {
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            store::load_task_launch(&path, &request_id)?
                .ok_or_else(|| anyhow!("launch '{request_id}' was not found"))
        })
        .await?
    }

    pub(crate) async fn inventory(&self, project_id: String) -> Result<Vec<TaskLaunchRecord>> {
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || store::list_task_launches(&path, &project_id))
            .await?
    }

    pub(crate) async fn cancel(&self, request_id: String) -> Result<TaskLaunchRecord> {
        let path = self.manager.inner.store_path.clone();
        let record = store::spawn_blocking_store_caller(move || {
            store::update_task_launch(&path, &request_id, TaskLaunchPhase::Cancelled, None)
        })
        .await??;
        if record.first_input_id.is_some() {
            self.manager
                .session_runs()
                .cancel(&record.session_id)
                .await?;
        }
        Ok(record)
    }
}

/// Construction is synchronous, including embedders on a current-thread
/// runtime. Submit the typed startup command from a bounded ordinary thread.
pub(crate) fn reconcile_startup(path: &std::path::Path) -> Result<()> {
    // Ordinary construction/preflight must not create a database as a side
    // effect. A new store has no interrupted preparations to reconcile.
    if !path.exists() {
        return Ok(());
    }
    std::thread::scope(|scope| scope.spawn(|| store::reconcile_task_launches(path)).join())
        .map_err(|_| anyhow!("task preparation reconciliation thread panicked"))?
}
