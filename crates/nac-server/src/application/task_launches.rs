//! Human task-launch use case over the existing prepared-session lifecycle.
use crate::SessionManager;
use anyhow::{anyhow, Context, Result};
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
        let admission = self.manager.inner.task_preparations.admit().await?;
        let manager = self.manager.clone();
        tokio::spawn(async move {
            let _admission = admission;
            let path = manager.inner.store_path.clone();
            let (project, bound) = store::spawn_blocking_store_caller(move || -> Result<_> {
                let project =
                    nac_core::projects::load_project_launch_context(&path, &project_id)?.project;
                let bound = store::load_project_git_source(&path, &project_id)?;
                Ok((project, bound))
            })
            .await??;
            let eligible = manager.managed_host().is_none()
                && project.ssh_host.is_none()
                && (bound.is_some()
                    || manager
                        .inner
                        .task_preparations
                        .git
                        .is_git_project(&project.cwd)
                        .await?);
            Ok(TaskLaunchSourceInfo {
                eligible,
                default_ref: bound.map(|b| b.default_ref),
            })
        })
        .await?
    }

    pub(crate) async fn start(&self, request: TaskLaunchRequest) -> Result<TaskLaunchRecord> {
        let admission = self.manager.inner.task_preparations.admit().await?;
        self.start_admitted(request, admission, None).await
    }

    pub(crate) async fn start_admitted(
        &self,
        request: TaskLaunchRequest,
        admission: tokio::sync::OwnedRwLockReadGuard<()>,
        authorization: Option<nac_core::task_launch_control::NativeTaskAuthorization>,
    ) -> Result<TaskLaunchRecord> {
        request.validate()?;
        anyhow::ensure!(
            self.manager.managed_host().is_none(),
            "invalid request: retained tasks require an unmanaged Local host"
        );
        let manager = self.manager.clone();
        let (reply, response) = tokio::sync::oneshot::channel();
        // Register before source resolution. HTTP cancellation cannot detach
        // blocking store calls, Git, or publication from the serving lifetime.
        tokio::spawn(async move {
            let _admission = admission;
            let prepared = Self::resolve_and_reserve(&manager, request).await;
            let (mut record, lease) = match prepared {
                Ok(prepared) => prepared,
                Err(error) => {
                    let _ = reply.send(Err(error));
                    return;
                }
            };
            if lease.is_some() && record.phase == TaskLaunchPhase::Failed {
                match Self::phase(&manager, &record, TaskLaunchPhase::Pinned).await {
                    Ok(resumed) => record = resumed,
                    Err(error) => {
                        let _ = reply.send(Err(error));
                        return;
                    }
                }
            }
            if lease.is_some()
                && !matches!(
                    record.phase,
                    TaskLaunchPhase::Ready | TaskLaunchPhase::Cancelled
                )
            {
                if let Some(authorization) = authorization {
                    if let Err(error) = authorization.authorize_preparation(&record).await {
                        let path = manager.inner.store_path.clone();
                        let id = record.request.request_id.clone();
                        let message = format!("{error:#}");
                        let _ = store::spawn_blocking_store_caller(move || {
                            store::update_task_launch(
                                &path,
                                &id,
                                TaskLaunchPhase::Failed,
                                Some(message),
                            )
                        })
                        .await;
                        let _ = reply.send(Err(error));
                        return;
                    }
                }
            }
            let _ = reply.send(Ok(record.clone()));
            if let Some(_lease) = lease {
                if !matches!(
                    record.phase,
                    TaskLaunchPhase::Ready | TaskLaunchPhase::Cancelled
                ) {
                    if let Err(error) = Self::prepare(&manager, record.clone()).await {
                        let path = manager.inner.store_path.clone();
                        let id = record.request.request_id;
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
                }
            }
        });
        response.await.context("task launch response stopped")?
    }

    async fn resolve_and_reserve(
        manager: &SessionManager,
        request: TaskLaunchRequest,
    ) -> Result<(TaskLaunchRecord, Option<sessions::SessionOperationLease>)> {
        manager.inner.task_preparations.git.check_running()?;
        let path = manager.inner.store_path.clone();
        let intent = request.clone();
        let (lease, existing, context) =
            store::spawn_blocking_store_caller(move || -> Result<_> {
                let lease_id = format!("task-launch:{}", intent.request_id);
                let lease = match sessions::SessionOperationLease::try_acquire(&path, &lease_id) {
                    Ok(lease) => Some(lease),
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => None,
                    Err(error) => return Err(error.into()),
                };
                let existing = store::load_task_launch(&path, &intent.request_id)?;
                if let Some(existing) = &existing {
                    anyhow::ensure!(
                        existing.request == intent,
                        "conflict: launch identity reused with different arguments"
                    );
                    return Ok((lease, Some(existing.clone()), None));
                }
                anyhow::ensure!(
                    lease.is_some(),
                    "conflict: launch source resolution is in progress; retry the same request"
                );
                let project =
                    nac_core::projects::load_project_launch_context(&path, &intent.project_id)?
                        .project;
                let bound = store::load_project_git_source(&path, &intent.project_id)?;
                let invoking = intent
                    .invoking_session_id
                    .as_deref()
                    .map(|id| sessions::load_session(&path, id))
                    .transpose()?;
                Ok((lease, None, Some((project, bound, invoking))))
            })
            .await??;
        if let Some(existing) = existing {
            return Ok((existing, lease));
        }
        let (project, bound, invoking) =
            context.ok_or_else(|| anyhow!("launch source context missing"))?;
        #[cfg(test)]
        {
            let gate = manager
                .inner
                .task_preparations
                .source_resolution
                .lock()
                .unwrap()
                .clone();
            if let Some(gate) = gate {
                gate.reached.notify_one();
                gate.resume.notified().await;
            }
        }
        let source = manager
            .inner
            .task_preparations
            .git
            .resolve_source(&project, &request, bound.as_ref(), invoking.as_ref())
            .await?;
        manager.inner.task_preparations.git.check_running()?;
        let path = manager.inner.store_path.clone();
        let record = store::spawn_blocking_store_caller(move || {
            store::reserve_task_launch(&path, request, source)
        })
        .await??;
        Ok((record, lease))
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
        manager.inner.task_preparations.git.check_running()?;
        let path = manager.inner.store_path.clone();
        let work = launch.clone();
        store::spawn_blocking_store_caller(move || -> Result<()> {
            let config = nac_core::runtime::NacConfig::load_from_cwd(&work.source.project_cwd)?;
            task_worktree::authorize_human_preparation(&work, &config, &path)
        })
        .await??;
        manager
            .inner
            .task_preparations
            .git
            .prepare_workspace(&launch)
            .await?;
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
            if manager.inner.task_preparations.git.check_running().is_ok() {
                manager.wake_direct_inbox(&service).await?;
            } else {
                service.stop_run_admission().await?;
            }
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
        if record.first_input_id.is_some() && record.session_present {
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
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                store::reconcile_task_launches(path)?;
                store::reconcile_native_task_launches(path)
            })
            .join()
    })
    .map_err(|_| anyhow!("task preparation reconciliation thread panicked"))?
}
