//! Native task adapter over saved projects and the shared prepared-session lifecycle.
use super::task_launches::TaskLaunchApplication;
use crate::{SessionManager, SessionManagerInner};
use anyhow::{anyhow, Result};
type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;
use nac_core::{
    sessions, store,
    task_launch_control::{
        NativeTaskLaunch, NativeTaskReceipt, NativeTaskRequest, SavedTaskProject,
        TaskLaunchController, TaskWorkspace,
    },
};
use std::sync::{Arc, Weak};

pub(crate) struct NativeTaskLaunchController {
    manager: Weak<SessionManagerInner>,
}

impl NativeTaskLaunchController {
    pub(crate) fn new(manager: &SessionManager) -> Self {
        Self {
            manager: Arc::downgrade(&manager.inner),
        }
    }
    fn manager(&self) -> Result<SessionManager> {
        self.manager
            .upgrade()
            .map(|inner| SessionManager { inner })
            .ok_or_else(|| anyhow!("task launch host is unavailable"))
    }
}

async fn caller(manager: &SessionManager, id: &str) -> Result<sessions::SessionSnapshot> {
    anyhow::ensure!(
        manager.managed_host().is_none(),
        "independent native tasks require an unmanaged Local host"
    );
    let path = manager.inner.store_path.clone();
    let id = id.to_owned();
    store::spawn_blocking_store_caller(move || {
        anyhow::ensure!(
            matches!(
                store::load_direct_task(&path, &id)?,
                store::TaskLookup::Found(_)
            ),
            "caller must be an independent direct task"
        );
        let session = sessions::load_session(&path, &id)?;
        anyhow::ensure!(
            session.ssh.is_none() && session.sandbox_spec.is_none(),
            "native task launch cannot substitute a Local backend for the caller's backend"
        );
        Ok(session)
    })
    .await?
}

async fn projects(manager: &SessionManager) -> Result<Vec<SavedTaskProject>> {
    let path = manager.inner.store_path.clone();
    store::spawn_blocking_store_caller(move || {
        nac_core::projects::list_projects(&path)?.into_iter().map(|project| {
            let bound = store::load_project_git_source(&path, &project.project_id)?;
            let defaults = nac_core::projects::load_project_launch_context(&path, &project.project_id)?.default_model_config;
            let eligible = project.ssh_host.is_none();
            Ok(SavedTaskProject { project_id:project.project_id, name:project.name, cwd:project.cwd,
                ssh_host:project.ssh_host, default_model_config_id:project.default_model_config_id,
                default_model:defaults.as_ref().map(|d|d.model.clone()),
                default_reasoning_effort:defaults.and_then(|d|d.reasoning_effort),
                default_ref:bound.map(|source| source.default_ref), eligible,
                eligibility_detail:if eligible { "Local launch eligible; source and runtime readiness are validated at admission" } else { "SSH launch is unavailable; no Local fallback" }.into() })
        }).collect()
    }).await?
}

async fn load(manager: &SessionManager, request_id: &str) -> Result<Option<NativeTaskLaunch>> {
    let path = manager.inner.store_path.clone();
    let id = request_id.to_owned();
    store::spawn_blocking_store_caller(move || store::load_native_task_launch(&path, &id)).await?
}

async fn resolve(
    manager: &SessionManager,
    caller_id: &str,
    request: &NativeTaskRequest,
) -> Result<SavedTaskProject> {
    request.validate()?;
    let caller = caller(manager, caller_id).await?;
    let existing = load(manager, &request.request_id).await?;
    let project_id = if let Some(existing) = existing {
        anyhow::ensure!(
            existing.caller_session_id == caller_id && existing.request == *request,
            "conflict: native launch identity reused with different caller or arguments"
        );
        existing.project_id
    } else {
        request.project_id.clone().or(caller.project_id).ok_or_else(|| anyhow!("missing saved project: use list_projects and pass an explicit project_id; no directory/projectless substitution"))?
    };
    let target = projects(manager)
        .await?
        .into_iter()
        .find(|p| p.project_id == project_id)
        .ok_or_else(|| {
            anyhow!("saved project '{project_id}' not found; use list_projects for candidates")
        })?;
    anyhow::ensure!(target.eligible, "{}", target.eligibility_detail);
    Ok(target)
}

async fn receipt(manager: &SessionManager, caller_id: &str, id: &str) -> Result<NativeTaskReceipt> {
    caller(manager, caller_id).await?;
    let path = manager.inner.store_path.clone();
    let id = id.to_owned();
    let caller_id = caller_id.to_owned();
    store::spawn_blocking_store_caller(move || {
        let mut launch = store::load_native_task_launch(&path, &id)?
            .filter(|r| r.caller_session_id == caller_id)
            .ok_or_else(|| anyhow!("native launch not found"))?;
        let retained_launch = if launch.retained {
            store::load_task_launch(&path, &id)?
        } else {
            None
        };
        if let Some(retained) = &retained_launch {
            anyhow::ensure!(
                retained.session_id == launch.session_id
                    && retained.request.project_id == launch.project_id,
                "native retained receipt ownership mismatch"
            );
            launch.phase = serde_json::to_value(retained.phase)?
                .as_str()
                .ok_or_else(|| anyhow!("invalid launch phase"))?
                .to_owned();
            launch.error = if retained.phase == store::TaskLaunchPhase::Ready {
                retained.error.clone().or(launch.error)
            } else {
                retained.error.clone()
            };
            launch.first_input_id = retained.first_input_id;
            launch.updated_at.clone_from(&retained.updated_at);
        }
        let task = match store::load_direct_task(&path, &launch.session_id)? {
            store::TaskLookup::Found(task)
                if task.project_id.as_deref() == Some(launch.project_id.as_str()) =>
            {
                Some(task)
            }
            _ => None,
        };
        // Session IDs are generated by the shared store, never supplied URL fragments.
        anyhow::ensure!(
            uuid::Uuid::parse_str(&launch.session_id)
                .is_ok_and(|id| id.to_string() == launch.session_id),
            "invalid task identity"
        );
        Ok(NativeTaskReceipt {
            navigation: format!("/session/{}", launch.session_id),
            launch,
            retained_launch,
            task,
            as_of_epoch_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
            approvals: "unknown; open the task to see its live approval queue".into(),
        })
    })
    .await?
}

async fn phase(
    manager: &SessionManager,
    id: &str,
    value: &str,
    error: Option<String>,
) -> Result<NativeTaskLaunch> {
    let path = manager.inner.store_path.clone();
    let id = id.to_owned();
    let value = value.to_owned();
    store::spawn_blocking_store_caller(move || {
        store::update_native_task_launch(&path, &id, &value, error)
    })
    .await?
}

async fn resume_initial_input(manager: &SessionManager, launch: &NativeTaskLaunch) -> Result<()> {
    let path = manager.inner.store_path.clone();
    let session = launch.session_id.clone();
    let expected = launch.clone();
    let input = launch
        .first_input_id
        .ok_or_else(|| anyhow!("published launch has no initial input identity"))?;
    let item = store::spawn_blocking_store_caller(move || {
        let snapshot = sessions::load_session(&path, &session)?;
        let cwd = if expected.retained {
            let retained = store::load_task_launch(&path, &expected.request.request_id)?
                .ok_or_else(|| anyhow!("retained launch not found"))?;
            anyhow::ensure!(
                retained.session_id == session,
                "retained initial input owner changed"
            );
            retained.workspace_path.join(retained.source.subdirectory)
        } else {
            expected.source_cwd
        };
        anyhow::ensure!(
            snapshot.behavior == sessions::SessionBehavior::Direct
                && snapshot.project_id.as_deref() == Some(expected.project_id.as_str())
                && snapshot.cwd == cwd
                && snapshot.ssh.is_none()
                && snapshot.sandbox_spec.is_none(),
            "published native task binding changed; initial input was not resumed"
        );
        store::load_session_inbox_item(&path, &session, input)
    })
    .await??;
    if item.status == store::InboxStatus::Pending {
        manager.inner.task_preparations.git.check_running()?;
        // This is an active exact launch retry, never a status read. Existing
        // attachment/admission recovers only the durable input, without reinserting it.
        manager.attach_session(&launch.session_id).await?;
        manager.inner.task_preparations.git.check_running()?;
    }
    if launch.error.is_some() {
        let path = manager.inner.store_path.clone();
        let id = launch.request.request_id.clone();
        store::spawn_blocking_store_caller(move || {
            store::update_native_task_admission_error(&path, &id, None)
        })
        .await??;
    }
    Ok(())
}

async fn prepare(
    manager: &SessionManager,
    launch: NativeTaskLaunch,
    admission: tokio::sync::OwnedRwLockReadGuard<()>,
    authorization: nac_core::task_launch_control::NativeTaskAuthorization,
) -> Result<()> {
    if launch.retained {
        let prompt = launch.request.initial_prompt();
        TaskLaunchApplication::new(manager)
            .start_admitted(
                store::TaskLaunchRequest {
                    request_id: launch.request.request_id,
                    project_id: launch.project_id,
                    invoking_session_id: Some(launch.caller_session_id),
                    git_ref: launch.request.git_ref.clone(),
                    default_ref: launch.request.default_ref.clone(),
                    title: launch.request.title.clone(),
                    prompt,
                },
                admission,
                Some(authorization),
            )
            .await?;
    } else {
        let _admission = admission;
        let launch = phase(
            manager,
            &launch.request.request_id,
            "preparing_runtime",
            None,
        )
        .await?;
        if launch.phase == "cancelled" {
            return Ok(());
        }
        let snapshot = manager
            .session_creation()
            .create_native_task_session(launch)
            .await?;
        let id = snapshot
            .metadata
            .session_id
            .ok_or_else(|| anyhow!("native task missing session identity"))?;
        let service = manager.inner.active_sessions.read().await.get(&id).cloned();
        if let Some(service) = service {
            if manager.inner.task_preparations.git.check_running().is_ok() {
                manager.wake_direct_inbox(&service).await?;
            } else {
                service.stop_run_admission().await?;
            }
        }
    }
    Ok(())
}

impl TaskLaunchController for NativeTaskLaunchController {
    fn projects<'a>(&'a self, caller_id: &'a str) -> BoxFuture<'a, Result<Vec<SavedTaskProject>>> {
        Box::pin(async move {
            let manager = self.manager()?;
            caller(&manager, caller_id).await?;
            projects(&manager).await
        })
    }
    fn resolve<'a>(
        &'a self,
        caller_id: &'a str,
        request: &'a NativeTaskRequest,
    ) -> BoxFuture<'a, Result<SavedTaskProject>> {
        Box::pin(async move { resolve(&self.manager()?, caller_id, request).await })
    }
    fn launch<'a>(
        &'a self,
        caller_id: &'a str,
        request: NativeTaskRequest,
        target: SavedTaskProject,
        authorization: nac_core::task_launch_control::NativeTaskAuthorization,
    ) -> BoxFuture<'a, Result<NativeTaskReceipt>> {
        Box::pin(async move {
            let manager = self.manager()?;
            let current = resolve(&manager, caller_id, &request).await?;
            anyhow::ensure!(
                current == target && std::fs::canonicalize(&target.cwd)? == target.cwd,
                "conflict: authorized saved project binding changed; retry launch"
            );
            let admission = manager.inner.task_preparations.admit().await?;
            let existing = load(&manager, &request.request_id).await?;
            let retained = match existing.as_ref() {
                Some(launch) => launch.retained,
                None => match request.workspace {
                    TaskWorkspace::ExistingCheckout => false,
                    TaskWorkspace::CleanRef => true,
                    TaskWorkspace::Auto => {
                        manager
                            .inner
                            .task_preparations
                            .git
                            .is_git_project(&target.cwd)
                            .await?
                    }
                },
            };
            anyhow::ensure!(
                retained || (request.git_ref.is_none() && request.default_ref.is_none()),
                "invalid request: non-Git launch cannot select a Git ref"
            );
            let path = manager.inner.store_path.clone();
            let id = request.request_id.clone();
            let owner = caller_id.to_owned();
            let (launch, lease) = store::spawn_blocking_store_caller(move || -> Result<_> {
                let lease = match sessions::SessionOperationLease::try_acquire(
                    &path,
                    &format!("native-task-launch:{id}"),
                ) {
                    Ok(lease) => Some(lease),
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => None,
                    Err(e) => return Err(e.into()),
                };
                let launch = store::reserve_native_task_launch(
                    &path,
                    &owner,
                    &target.project_id,
                    &target.cwd,
                    retained,
                    request,
                )?;
                Ok((launch, lease))
            })
            .await??;
            let id = launch.request.request_id.clone();
            let receipt_id = id.clone();
            if let Some(lease) = lease {
                if launch.phase == "ready" {
                    let _lease = lease;
                    if let Err(error) = resume_initial_input(&manager, &launch).await {
                        let path = manager.inner.store_path.clone();
                        let id = id.clone();
                        let message = format!("initial input admission failed: {error:#}");
                        store::spawn_blocking_store_caller(move || {
                            store::update_native_task_admission_error(&path, &id, Some(message))
                        })
                        .await??;
                    }
                    return receipt(&manager, caller_id, &receipt_id).await;
                }
                if !matches!(launch.phase.as_str(), "ready" | "cancelled") {
                    let phase_name = if launch.retained {
                        "reserved"
                    } else {
                        "preparing_runtime"
                    };
                    let launch = phase(&manager, &id, phase_name, None).await?;
                    if launch.retained {
                        let _lease = lease;
                        if let Err(error) =
                            prepare(&manager, launch, admission, authorization).await
                        {
                            let _ =
                                phase(&manager, &id, "failed", Some(format!("{error:#}"))).await;
                        }
                        return receipt(&manager, caller_id, &receipt_id).await;
                    }
                    // Publish the owned retry's preparation state before its
                    // acknowledgement; the background task cannot race a stale failed receipt.
                    let worker = manager.clone();
                    tokio::spawn(async move {
                        let _lease = lease;
                        if let Err(error) = prepare(&worker, launch, admission, authorization).await
                        {
                            let _ = phase(&worker, &id, "failed", Some(format!("{error:#}"))).await;
                        }
                    });
                }
            }
            receipt(&manager, caller_id, &receipt_id).await
        })
    }
    fn status<'a>(
        &'a self,
        caller_id: &'a str,
        id: &'a str,
    ) -> BoxFuture<'a, Result<NativeTaskReceipt>> {
        Box::pin(async move { receipt(&self.manager()?, caller_id, id).await })
    }
}
