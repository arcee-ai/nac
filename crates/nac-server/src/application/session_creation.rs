use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

use anyhow::{anyhow, Result};
use nac_core::{
    projects,
    runtime::{self, NacConfig, OptionalModelOption, RunOptions, StoreOptions},
    session_service::{SessionFrontendSnapshot, SessionService},
    sessions::{self, SessionBehavior},
};

use crate::{
    create_compaction_threshold_override, model_options, nonblank,
    request_configuration_error_from, sandbox_options, sandbox_requested, ResolvedLaunchLocation,
    SessionManager, SshRequest,
};

use super::Field;

fn project_location_conflicts(request: &SessionCreationCommand) -> bool {
    request
        .cwd
        .as_ref()
        .is_some_and(|cwd| !cwd.as_os_str().to_string_lossy().trim().is_empty())
        || nonblank(request.ssh_host.clone()).is_some()
        || request.ssh_port.is_some()
        || nonblank(request.ssh_identity_file.clone()).is_some()
}

fn apply_task_model_selection(
    request: &mut SessionCreationCommand,
    selected: &nac_core::store::TaskModelSelection,
) {
    request.backend = Field::Set(selected.backend.clone());
    request.model = Field::Set(selected.model.clone());
    request.base_url = Field::Set(selected.base_url.clone());
    request.allow_insecure_http = Field::Set(selected.allow_insecure_http);
    request.api_key_env = selected
        .api_key_env
        .clone()
        .map(Field::Set)
        .unwrap_or(Field::Clear);
    request.reasoning_effort = selected
        .reasoning_effort
        .clone()
        .map(Field::Set)
        .unwrap_or(Field::Clear);
    request.extra_headers = selected
        .extra_headers
        .clone()
        .map(Field::Set)
        .unwrap_or(Field::Clear);
    request.compaction_threshold = selected
        .compaction_threshold
        .map(Field::Set)
        .unwrap_or(Field::Clear);
}

fn newest_primary_project_session_id(
    manager: &SessionManager,
    project_id: &str,
    behavior: Option<sessions::SessionBehavior>,
) -> Result<Option<String>> {
    let mut candidates = sessions::list_sessions(&manager.inner.store_path)?
        .into_iter()
        .filter(|summary| {
            summary.project_id.as_deref() == Some(project_id)
                && behavior.is_none_or(|behavior| summary.behavior == behavior)
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    for candidate in candidates {
        if manager.session_lineage(&candidate.session_id)?.is_none() {
            return Ok(Some(candidate.session_id));
        }
    }
    Ok(None)
}

/// Marks credential names this server generated for a saved configuration, so

#[derive(Debug, Clone, Default)]
pub(crate) struct SessionCreationCommand {
    pub(crate) behavior: SessionBehavior,
    pub(crate) first_chat: bool,
    pub(crate) first_chat_same_behavior: bool,
    pub(crate) project_id: Option<String>,
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) model: Field<String>,
    pub(crate) base_url: Field<String>,
    pub(crate) allow_insecure_http: Field<bool>,
    pub(crate) backend: Field<String>,
    pub(crate) reasoning_effort: Field<String>,
    pub(crate) api_key_env: Field<String>,
    pub(crate) extra_headers: Field<BTreeMap<String, String>>,
    pub(crate) compaction_threshold: Field<u64>,
    pub(crate) ssh_host: Option<String>,
    pub(crate) ssh_port: Option<u16>,
    pub(crate) ssh_identity_file: Option<String>,
    pub(crate) sandbox: SessionSandboxCommand,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SessionSandboxCommand {
    pub(crate) enabled: bool,
    pub(crate) no_mount_cwd: bool,
    pub(crate) mounts: Vec<String>,
    pub(crate) mounts_ro: Vec<String>,
    pub(crate) image: Option<String>,
    pub(crate) gpus: Vec<String>,
    pub(crate) shm_size: Option<String>,
    pub(crate) session_key: Option<String>,
    pub(crate) workdir: Option<String>,
    pub(crate) backend: Option<String>,
    pub(crate) cpus: Option<u8>,
    pub(crate) memory_mib: Option<u32>,
    pub(crate) activity_key: Option<String>,
}

/// Session creation and first-chat admission.
///
/// Project location, model and credential preflight,
/// sandbox/SSH exclusion, runtime construction, resource ownership, and cache
/// publication stay in one application transaction.
pub(crate) struct SessionCreationApplication<'a> {
    manager: &'a SessionManager,
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct CreationProjectionGate {
    pub(crate) reached: tokio::sync::Notify,
    pub(crate) resume: tokio::sync::Notify,
}

impl<'a> SessionCreationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub async fn create_session(
        &self,
        request: SessionCreationCommand,
    ) -> Result<SessionFrontendSnapshot> {
        self.create_prepared_session(request, None, None, None)
            .await
    }

    pub(crate) async fn create_retained_task_session(
        &self,
        launch: nac_core::store::TaskLaunchRecord,
    ) -> Result<SessionFrontendSnapshot> {
        let path = self.manager.inner.store_path.clone();
        let id = launch.request.request_id.clone();
        let native = nac_core::store::spawn_blocking_store_caller(move || {
            nac_core::store::load_native_task_launch(&path, &id)
        })
        .await??;
        let mut request = SessionCreationCommand {
            behavior: SessionBehavior::Direct,
            project_id: Some(launch.request.project_id.clone()),
            ..SessionCreationCommand::default()
        };
        if let Some(native) = &native {
            apply_native_settings(&mut request, native)?;
        } else if let Some(selected) = &launch.request.model_selection {
            apply_task_model_selection(&mut request, selected);
        } else {
            return Err(anyhow!(
                "invalid request: select a model for the task session"
            ));
        }
        self.create_prepared_session(request, Some(launch), None, None)
            .await
    }

    pub(crate) async fn create_native_task_session(
        &self,
        launch: nac_core::task_launch_control::NativeTaskLaunch,
    ) -> Result<SessionFrontendSnapshot> {
        let mut request = SessionCreationCommand {
            behavior: SessionBehavior::Direct,
            project_id: Some(launch.project_id.clone()),
            ..Default::default()
        };
        apply_native_settings(&mut request, &launch)?;
        self.create_prepared_session(request, None, Some(launch), None)
            .await
    }

    pub(crate) async fn create_scheduled_task_session(
        &self,
        retained: Option<nac_core::store::TaskLaunchRecord>,
        scheduled: nac_core::store::PreparedFreshTaskLaunch,
    ) -> Result<SessionFrontendSnapshot> {
        anyhow::ensure!(
            self.manager.managed_host().is_none(),
            "scheduled tasks require an unmanaged Local host"
        );
        let destination = &scheduled.receipt().destination;
        let mut request = SessionCreationCommand {
            behavior: SessionBehavior::Direct,
            project_id: Some(destination.project_id.clone()),
            model: destination
                .model
                .clone()
                .map(Field::Set)
                .unwrap_or(Field::Unchanged),
            reasoning_effort: destination
                .reasoning_effort
                .clone()
                .map(Field::Set)
                .unwrap_or(Field::Unchanged),
            ..SessionCreationCommand::default()
        };
        let selected = destination.model_selection.as_ref().ok_or_else(|| {
            anyhow!("scheduled task predates explicit model selection; create a new schedule with a selected model")
        })?;
        apply_task_model_selection(&mut request, selected);
        self.create_prepared_session(request, retained, None, Some(scheduled))
            .await
    }

    async fn create_prepared_session(
        &self,
        mut request: SessionCreationCommand,
        retained: Option<nac_core::store::TaskLaunchRecord>,
        native: Option<nac_core::task_launch_control::NativeTaskLaunch>,
        scheduled: Option<nac_core::store::PreparedFreshTaskLaunch>,
    ) -> Result<SessionFrontendSnapshot> {
        anyhow::ensure!(
            native.is_none() || (retained.is_none() && scheduled.is_none()),
            "conflict: native and scheduled creation ownership are mutually exclusive"
        );
        let first_chat_project_id = if request.first_chat {
            Some(
                request
                    .project_id
                    .clone()
                    .filter(|project_id| !project_id.trim().is_empty())
                    .ok_or_else(|| anyhow!("invalid request: first_chat requires project_id"))?,
            )
        } else {
            None
        };
        let first_chat_gate = first_chat_project_id.as_ref().map(|project_id| {
            self.manager
                .lifecycle_gate(&format!("project-first-chat:{project_id}"))
        });
        let _first_chat_admission = match first_chat_gate.as_ref() {
            Some(gate) => Some(gate.lock().await),
            None => None,
        };
        if let Some(project_id) = first_chat_project_id.as_deref() {
            if let Some(session_id) = newest_primary_project_session_id(
                self.manager,
                project_id,
                request.first_chat_same_behavior.then_some(request.behavior),
            )? {
                return self.manager.snapshot(&session_id).await;
            }
        }
        self.manager.sweep_idle_sessions(None).await;
        let project_context = request
            .project_id
            .as_deref()
            .map(|project_id| projects::load_project(&self.manager.inner.store_path, project_id))
            .transpose()?;
        let (project_id, mut location) = if let Some(project) = project_context {
            if project_location_conflicts(&request) {
                return Err(anyhow!(
                    "invalid request: project_id cannot be combined with cwd or ssh location fields"
                ));
            }
            let ssh = runtime::SshOptions {
                host: project.ssh_host,
                port: project.ssh_port,
                identity_file: project.ssh_identity_file.map(PathBuf::from),
            };
            let config_cwd = if ssh.host().is_some() {
                self.manager.inner.root_cwd.clone()
            } else {
                project.cwd.clone()
            };
            (
                Some(project.project_id),
                ResolvedLaunchLocation {
                    workspace_cwd: project.cwd,
                    config_cwd,
                    ssh,
                },
            )
        } else {
            (
                None,
                self.manager.resolve_launch_location(
                    request.cwd.take(),
                    SshRequest {
                        host: request.ssh_host.take(),
                        port: request.ssh_port.take(),
                        identity_file: request.ssh_identity_file.take(),
                    },
                )?,
            )
        };
        if location.ssh.host().is_some() && sandbox_requested(&request.sandbox) {
            return Err(anyhow!(
                "invalid request: ssh_host and sandbox options cannot both be set"
            ));
        }
        if let Some(launch) = &native {
            anyhow::ensure!(
                location.ssh.host().is_none()
                    && !sandbox_requested(&request.sandbox)
                    && std::fs::canonicalize(&location.workspace_cwd)? == launch.source_cwd,
                "conflict: native task source binding changed"
            );
            location.workspace_cwd.clone_from(&launch.source_cwd);
            location.config_cwd.clone_from(&launch.source_cwd);
        }
        let config = NacConfig::load_from_cwd(&location.config_cwd)?;
        if let Some(scheduled) = &scheduled {
            nac_core::permissions::authorize_local_scheduled_project(
                &scheduled.receipt().destination.project_id,
                &config.permissions.rules,
            )?;
            if retained.is_none() {
                location.workspace_cwd = PathBuf::from(
                    scheduled
                        .receipt()
                        .binding
                        .execution_cwd
                        .as_deref()
                        .ok_or_else(|| anyhow!("scheduled shared directory is unavailable"))?,
                );
            }
        }
        if let Some(launch) = &retained {
            anyhow::ensure!(
                location.ssh.host().is_none() && !sandbox_requested(&request.sandbox),
                "invalid request: isolated task launch requires Local execution"
            );
            location.workspace_cwd = launch.workspace_path.join(&launch.source.subdirectory);
        }
        let compaction_threshold =
            create_compaction_threshold_override(request.compaction_threshold)?;
        let mut model = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
            request.allow_insecure_http,
        )?;
        if let Some(profile) = self.manager.managed_model() {
            let uses_host_credentials = model.backend == Some(profile.backend)
                && model.api_base_url.as_deref() == Some(profile.endpoint.as_str())
                && matches!(model.api_key_env, OptionalModelOption::Clear);
            if uses_host_credentials {
                let managed = self.manager.managed_host().ok_or_else(|| {
                    anyhow!("managed model profile is missing its host configuration")
                })?;
                profile
                    .require_durable_authorization(managed)
                    .map_err(request_configuration_error_from)?;
                model.trusted_api_key_file = profile.trusted_api_key_file();
            }
        }
        let options = RunOptions {
            workspace_cwd: location.workspace_cwd,
            config_cwd: Some(location.config_cwd.clone()),

            store: StoreOptions {
                store_path: Some(self.manager.inner.store_path.clone()),
            },
            model,
            compaction_threshold,
            sandbox: sandbox_options(request.sandbox),
            ssh: location.ssh,
        };
        if retained.is_some() || native.is_some() || scheduled.is_some() {
            self.manager.inner.task_preparations.git.check_running()?;
        }
        let preparation = async {
            if let Some(launch) = &retained {
                runtime::prepare_retained_task_run_config(options, &config, launch).await
            } else if let Some(launch) = &native {
                runtime::prepare_native_task_run_config(options, &config, launch).await
            } else if let Some(scheduled) = &scheduled {
                runtime::prepare_scheduled_shared_task_run_config(options, &config, scheduled).await
            } else {
                runtime::prepare_run_config_for_project(options, &config, project_id).await
            }
        };
        let mut prepared = preparation.await?;
        if let Err(error) = self
            .manager
            .attach_managed_command_environment(prepared.run_config_mut())
        {
            if let Err(cleanup) = prepared.rollback().await {
                return Err(error.context(format!(
                    "fresh session resource rollback failed: {cleanup:#}"
                )));
            }
            return Err(error);
        }
        let (mut run_config, resources) = prepared.into_parts();
        super::task_questions::bind_native(self.manager, &mut run_config);
        let creation = async {
            self.manager.bind_product_context(&mut run_config)?;
            let mut service = SessionService::from_session_run_config(run_config).service;
            if self.manager.managed_host().is_some() {
                service.enable_managed_admission(self.manager.managed_identity().cloned());
            }
            service.acquire_sandbox_resource_lease()?;
            #[cfg(test)]
            {
                let gate = self
                    .manager
                    .inner
                    .session_creation_before_projection
                    .lock()
                    .unwrap()
                    .clone();
                if let Some(gate) = gate {
                    gate.reached.notify_one();
                    gate.resume.notified().await;
                }
            }
            if retained.is_some() || native.is_some() || scheduled.is_some() {
                self.manager.inner.task_preparations.git.check_running()?;
            }
            Ok::<_, anyhow::Error>(service)
        }
        .await;
        let service = match creation {
            Ok(service) => service,
            Err(error) => {
                if let Err(cleanup) = resources.rollback().await {
                    return Err(error.context(format!(
                        "fresh session resource rollback failed: {cleanup:#}"
                    )));
                }
                return Err(error);
            }
        };
        let snapshot = match &retained {
            Some(launch) => {
                service
                    .persist_new_task_session_with_snapshot(
                        resources,
                        launch.request.request_id.clone(),
                    )
                    .await?
            }
            None => {
                if let Some(launch) = &native {
                    service
                        .persist_new_native_task_session_with_snapshot(
                            resources,
                            launch.request.request_id.clone(),
                        )
                        .await?
                } else if let Some(scheduled) = &scheduled {
                    service
                        .persist_new_task_session_with_snapshot(
                            resources,
                            scheduled.receipt().request.request_id.clone(),
                        )
                        .await?
                } else {
                    service.persist_new_session_with_snapshot(resources).await?
                }
            }
        };
        #[cfg(test)]
        if retained.is_some() || native.is_some() {
            let gate = self
                .manager
                .inner
                .session_creation_after_persistence
                .lock()
                .unwrap()
                .clone();
            if let Some(gate) = gate {
                gate.reached.notify_one();
                gate.resume.notified().await;
            }
        }
        let session_id = snapshot
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("new session did not include a session id"))?;
        // The durable commit makes this session observable before its creator
        // reaches cache publication. Attachment may already have published and
        // started a service; preserve that canonical identity under the same
        // lifecycle gate used by attachment and configuration changes.
        let gate = self.manager.lifecycle_gate(&session_id);
        let _lifecycle = gate.lock().await;
        let service = {
            let mut active = self.manager.inner.active_sessions.write().await;
            Arc::clone(active.entry(session_id).or_insert_with(|| {
                let service = Arc::new(service);
                self.manager.inner.attention.bind(&service);
                service
            }))
        };
        if (retained.is_some() || native.is_some() || scheduled.is_some())
            && self
                .manager
                .inner
                .task_preparations
                .git
                .check_running()
                .is_err()
        {
            service.stop_run_admission().await?;
        }
        Ok(snapshot)
    }
}

fn apply_native_settings(
    request: &mut SessionCreationCommand,
    launch: &nac_core::task_launch_control::NativeTaskLaunch,
) -> Result<()> {
    let selection = launch.model_selection.as_ref().ok_or_else(|| {
        anyhow!("native task predates per-session model selection; create a new task with a selected model")
    })?;
    apply_task_model_selection(request, selection);
    if let Some(model) = &launch.request.model {
        request.model = Field::Set(model.clone());
    }
    if let Some(reasoning) = &launch.request.reasoning_effort {
        request.reasoning_effort = Field::Set(reasoning.clone());
    }
    Ok(())
}
