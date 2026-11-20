//! Human standalone management over the shared schedule/launch owners.
use super::heartbeats::HeartbeatInspection;
use crate::SessionManager;
use anyhow::{ensure, Context, Result};
use nac_core::{
    session_service::SessionService,
    store::{
        self, FreshTaskDestination, FreshTaskLaunchReceipt, HeartbeatAction, HeartbeatReceipt,
    },
};

#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct FreshTaskScheduleInspection {
    pub heartbeat: HeartbeatInspection,
    pub inventory: Vec<FreshTaskLaunchReceipt>,
    pub host_retained_limit: i64,
    pub host_allowance: store::FreshTaskRetainedAllowance,
    pub launches: Vec<store::TaskLaunchRecord>,
}

pub(crate) struct FreshTaskScheduleApplication<'a> {
    manager: &'a SessionManager,
}
impl<'a> FreshTaskScheduleApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn inventory(&self, project: String) -> Result<Vec<store::HeartbeatSchedule>> {
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            Ok(store::list_heartbeats(&path, None)?
                .into_iter()
                .filter(|schedule| {
                    schedule.session_id.is_none()
                        && schedule.binding.project_id.as_deref() == Some(project.as_str())
                })
                .collect())
        })
        .await?
    }
    pub(crate) async fn inspect(
        &self,
        project: String,
        schedule: String,
    ) -> Result<FreshTaskScheduleInspection> {
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            let scope = format!("project:{project}");
            let inventory = store::fresh_heartbeat_inventory(&path, &project, Some(&schedule))?;
            let launches = inventory
                .iter()
                .map(|receipt| store::load_task_launch(&path, &receipt.request.request_id))
                .collect::<Result<Vec<_>>>()?
                .into_iter()
                .flatten()
                .collect();
            Ok(FreshTaskScheduleInspection {
                heartbeat: HeartbeatInspection {
                    schedule: store::read_heartbeat(&path, &scope, &schedule)?,
                    history: store::heartbeat_history(&path, &scope, &schedule)?,
                    calendar_preview: None,
                },
                inventory,
                host_retained_limit: store::fresh_heartbeat_host_retained_limit(&path)?,
                host_allowance: store::fresh_heartbeat_retained_allowance(&path)?,
                launches,
            })
        })
        .await?
    }
    pub(crate) async fn change_retained_allowance(
        &self,
        project: String,
        change: store::FreshTaskRetainedAllowanceChange,
    ) -> Result<store::FreshTaskRetainedAllowanceReceipt> {
        ensure!(
            self.manager.managed_host().is_none() && !self.manager.is_recovery_only(),
            "host retained allowance requires an available unmanaged Local host"
        );
        ensure!(
            !self.manager.inner.task_preparations.is_stopping(),
            "retained allowance control is stopping"
        );
        SessionService::control_human_retained_allowance(
            self.manager.inner.store_path.clone(),
            project,
            change,
        )
        .await
    }

    pub(crate) async fn control(
        &self,
        project: String,
        request: String,
        operation: HeartbeatAction,
        destination: Option<FreshTaskDestination>,
        creator: Option<String>,
    ) -> Result<HeartbeatReceipt> {
        ensure!(
            self.manager.managed_host().is_none() && !self.manager.is_recovery_only(),
            "standalone schedules require an available unmanaged Local host"
        );
        ensure!(
            !self.manager.inner.task_preparations.is_stopping(),
            "standalone schedule control is stopping"
        );
        let path = self.manager.inner.store_path.clone();
        let target = project.clone();
        let action = operation.clone();
        let request_id = request.clone();
        let binding = store::spawn_blocking_store_caller(move || {
            let replay = store::read_heartbeat_command_receipt(
                &path,
                &format!("project:{target}"),
                &request_id,
            )?;
            let prior = if replay.is_some() {
                None
            } else {
                action
                    .target()
                    .map(|(id, _)| store::read_heartbeat(&path, &format!("project:{target}"), id))
                    .transpose()?
            };
            if matches!(
                action,
                HeartbeatAction::Pause { .. }
                    | HeartbeatAction::Stop { .. }
                    | HeartbeatAction::Delete { .. }
            ) {
                return Ok(replay
                    .or(prior.map(|schedule| HeartbeatReceipt {
                        request_id: request_id.clone(),
                        schedule,
                        occurrence: None,
                        active_occurrence: None,
                    }))
                    .context("standalone schedule was not found")?
                    .schedule
                    .binding);
            }
            let selected = if let Some(destination) = destination {
                destination
            } else if let Some(receipt) = &replay {
                match &action {
                    HeartbeatAction::Edit {
                        schedule_id,
                        expected_version,
                        ..
                    } => store::read_heartbeat_destination_at_version(
                        &path,
                        &format!("project:{target}"),
                        schedule_id,
                        *expected_version,
                    )?
                    .context("original schedule destination is unavailable")?,
                    // Resume and RunNow bind only their action in the historical
                    // command digest; recover the saved project binding rather
                    // than requiring a newly supplied model.
                    HeartbeatAction::Resume { .. } | HeartbeatAction::RunNow { .. } => receipt
                        .schedule
                        .binding
                        .fresh_task
                        .clone()
                        .context("original schedule destination is unavailable")?,
                    _ => anyhow::bail!("fresh task destination is required"),
                }
            } else {
                prior
                    .as_ref()
                    .and_then(|prior| prior.binding.fresh_task.clone())
                    .context("fresh task destination is required")?
            };
            ensure!(
                selected.project_id == target,
                "conflict: schedule destination project changed"
            );
            let project = nac_core::projects::load_project_launch_context(&path, &target)?.project;
            ensure!(
                project.ssh_host.is_none(),
                "SSH scheduled tasks are not qualified"
            );
            let cwd = std::fs::canonicalize(project.cwd)?;
            store::fresh_heartbeat_binding(
                &path,
                &selected,
                creator.as_deref(),
                cwd.to_str().context("project cwd is not UTF-8")?,
            )
        })
        .await??;
        SessionService::control_human_project_heartbeat(
            self.manager.inner.store_path.clone(),
            binding,
            request,
            operation,
        )
        .await
    }
}
