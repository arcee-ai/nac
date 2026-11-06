//! Scheduled launches adapt the same retained/prepared creation operation.
use super::*;
use nac_core::store::{FreshTaskPreparationPort, PreparedFreshTaskLaunch};

impl FreshTaskPreparationPort for TaskLaunchApplication<'_> {
    fn prepare<'a>(
        &'a self,
        launch: PreparedFreshTaskLaunch,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            anyhow::ensure!(
                self.manager.managed_host().is_none(),
                "scheduled tasks require an unmanaged Local host"
            );
            let admission = self.manager.inner.task_preparations.admit().await?;
            let manager = self.manager.clone();
            // Accepted preparation keeps its serving-lifetime reader even when
            // the scheduler or original waiter is cancelled during shutdown.
            tokio::spawn(async move {
                let path = manager.inner.store_path.clone();
                let expected = launch.receipt().clone();
                let context = store::spawn_blocking_store_caller(move || -> Result<_> {
                    let lease = match sessions::SessionOperationLease::try_acquire(
                        &path,
                        &format!("task-launch:{}", expected.request.request_id),
                    ) {
                        Ok(lease) => lease,
                        Err(sessions::SessionOperationLeaseError::Busy(_)) => return Ok(None),
                        Err(error) => return Err(error.into()),
                    };
                    let current =
                        store::read_fresh_heartbeat_launch(&path, &expected.occurrence_id)?
                            .ok_or_else(|| anyhow!("scheduled launch reservation disappeared"))?;
                    anyhow::ensure!(
                        current.receipt().request == expected.request
                            && current.receipt().session_id == expected.session_id
                            && current.receipt().destination == expected.destination,
                        "conflict: scheduled preparation arguments changed"
                    );
                    if current.receipt().stop_requested
                        || current.receipt().first_input_id.is_some()
                        || current.receipt().initial_outcome.is_some()
                    {
                        return Ok(None);
                    }
                    let project = nac_core::projects::load_project_launch_context(
                        &path,
                        &expected.destination.project_id,
                    )?
                    .project;
                    let canonical = std::fs::canonicalize(&project.cwd)?;
                    anyhow::ensure!(
                        project.ssh_host.is_none()
                            && project.cwd.to_string_lossy() == expected.binding.cwd
                            && canonical.to_str() == expected.binding.execution_cwd.as_deref(),
                        "scheduled Local project source/configuration changed"
                    );
                    let config = nac_core::runtime::NacConfig::load_from_cwd(&project.cwd)?;
                    nac_core::permissions::authorize_local_scheduled_project(
                        &project.project_id,
                        &config.permissions.rules,
                    )?;
                    let bound = store::load_project_git_source(&path, &project.project_id)?;
                    Ok(Some((lease, current, project, bound)))
                })
                .await??;
                let Some((lease, current, project, bound)) = context else {
                    return Ok(());
                };
                let git = bound.is_some()
                    || manager
                        .inner
                        .task_preparations
                        .git
                        .is_git_project(&project.cwd)
                        .await?;
                let path = manager.inner.store_path.clone();
                let id = current.receipt().occurrence_id.clone();
                store::spawn_blocking_store_caller(move || {
                    store::pin_fresh_heartbeat_workspace_mode(&path, &id, !git)
                })
                .await??;
                if git {
                    let request = current.receipt().request.clone();
                    #[cfg(test)]
                    {
                        let gate = manager
                            .inner
                            .task_preparations
                            .scheduled_handoff
                            .lock()
                            .unwrap()
                            .clone();
                        if let Some(gate) = gate {
                            gate.reached.notify_one();
                            gate.resume.notified().await;
                        }
                    }
                    TaskLaunchApplication::new(&manager)
                        .start_with_scheduled(request, current, admission, lease)
                        .await?;
                } else {
                    anyhow::ensure!(
                        current.receipt().destination.pinned_commit.is_none()
                            && current.receipt().destination.default_ref.is_none(),
                        "Git selectors cannot be applied to a non-Git Local directory"
                    );
                    let _lease = lease;
                    let _admission = admission;
                    manager
                        .session_creation()
                        .create_scheduled_task_session(None, current)
                        .await?;
                }
                Ok(())
            })
            .await?
        })
    }
}
