use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{anyhow, Result};
use nac_core::{
    light_model::{LightModelError, LightModelSettings},
    model::provider_for_model,
    model_configurations::ModelConfigurationRecord,
    projects,
    runtime::{self, NacConfig, OptionalModelOption, RunOptions, StoreOptions},
    session_service::{SessionFrontendSnapshot, SessionService},
    sessions::{self, SessionBehavior},
};

use crate::{
    create_compaction_threshold_override, enforce_trusted_base_url, light_model, model_options,
    nonblank, request_configuration_error_from, sandbox_options, sandbox_requested,
    ResolvedLaunchLocation, SessionManager, SshRequest,
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

fn inherit_project_field<T>(field: &mut Field<T>, inherited: Field<T>) {
    if matches!(field, Field::Unchanged) {
        *field = inherited;
    }
}

fn apply_project_model_defaults(
    request: &mut SessionCreationCommand,
    defaults: ModelConfigurationRecord,
) {
    inherit_project_field(&mut request.model, Field::Set(defaults.model));
    inherit_project_field(&mut request.base_url, Field::Set(defaults.base_url));
    inherit_project_field(&mut request.backend, Field::Set(defaults.backend));
    inherit_project_field(
        &mut request.reasoning_effort,
        defaults
            .reasoning_effort
            .map(Field::Set)
            .unwrap_or(Field::Clear),
    );
    inherit_project_field(
        &mut request.api_key_env,
        defaults.api_key_env.map(Field::Set).unwrap_or(Field::Clear),
    );
    inherit_project_field(
        &mut request.extra_headers,
        Field::Set(defaults.extra_headers),
    );
    if let Some(threshold) = defaults.orchestrator_compaction_threshold {
        inherit_project_field(
            &mut request.orchestrator_compaction_threshold,
            Field::Set(threshold),
        );
    }
    inherit_project_field(
        &mut request.light_model,
        defaults.light_model.map(Field::Set).unwrap_or(Field::Clear),
    );
}

/// The chat a project's model settings are read off when the project names no
/// default configuration of its own.
///
/// A project set up from a one-off model pick has no saved configuration to
/// point at, which used to leave its every later chat unlaunchable: nothing said
/// what to run it on. Its existing chats do say, so the newest one stands in —
/// and being the newest, it also tracks the project as its chats are retuned,
/// rather than pinning it to whatever was chosen the day it was created.
///
/// A chat whose own stored configuration no longer parses has nothing to lend,
/// and is passed over so one broken row cannot make the project unusable.
fn newest_project_session(
    store_path: &Path,
    project_id: &str,
) -> Option<sessions::SessionSnapshot> {
    let mut candidates: Vec<_> = sessions::list_sessions(store_path)
        .ok()?
        .into_iter()
        .filter(|summary| summary.project_id.as_deref() == Some(project_id))
        .collect();
    candidates.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    candidates
        .into_iter()
        .find_map(|summary| sessions::load_session(store_path, &summary.session_id).ok())
}

/// Same inheritance as `apply_project_model_defaults`, sourced from a sibling
/// chat instead of a saved configuration.
fn apply_sibling_model_defaults(
    request: &mut SessionCreationCommand,
    sibling: sessions::SessionSnapshot,
) {
    inherit_project_field(&mut request.model, Field::Set(sibling.model));
    inherit_project_field(&mut request.base_url, Field::Set(sibling.base_url));
    inherit_project_field(
        &mut request.backend,
        Field::Set(sibling.backend.as_str().to_string()),
    );
    inherit_project_field(
        &mut request.reasoning_effort,
        sibling
            .reasoning_effort
            .map(|effort| Field::Set(effort.as_str().to_string()))
            .unwrap_or(Field::Clear),
    );
    inherit_project_field(
        &mut request.api_key_env,
        sibling.api_key_env.map(Field::Set).unwrap_or(Field::Clear),
    );
    inherit_project_field(
        &mut request.extra_headers,
        Field::Set(sibling.extra_headers),
    );
    if let Some(threshold) = sibling.orchestrator_compaction_threshold {
        inherit_project_field(
            &mut request.orchestrator_compaction_threshold,
            Field::Set(threshold),
        );
    }
    inherit_project_field(
        &mut request.light_model,
        sibling.light_model.map(Field::Set).unwrap_or(Field::Clear),
    );
}

/// Marks credential names this server generated for a saved configuration, so

#[derive(Debug, Clone, Default)]
pub(crate) struct SessionCreationCommand {
    pub(crate) behavior: SessionBehavior,
    pub(crate) first_chat: bool,
    pub(crate) project_id: Option<String>,
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) model: Field<String>,
    pub(crate) base_url: Field<String>,
    pub(crate) backend: Field<String>,
    pub(crate) reasoning_effort: Field<String>,
    pub(crate) api_key_env: Field<String>,
    pub(crate) extra_headers: Field<BTreeMap<String, String>>,
    pub(crate) orchestrator_compaction_threshold: Field<u64>,
    pub(crate) light_model: Field<LightModelSettings>,
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
/// Project location/default inheritance, model and credential preflight,
/// sandbox/SSH exclusion, runtime construction, resource ownership, and cache
/// publication stay in one application transaction.
pub(crate) struct SessionCreationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionCreationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub async fn create_session(
        &self,
        mut request: SessionCreationCommand,
    ) -> Result<SessionFrontendSnapshot> {
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
            if let Some(session_id) = self.manager.newest_primary_project_session_id(project_id)? {
                return self.manager.snapshot(&session_id).await;
            }
        }
        self.manager.sweep_idle_sessions(None).await;
        let behavior = request.behavior;
        let project_context = request
            .project_id
            .as_deref()
            .map(|project_id| {
                projects::load_project_launch_context(&self.manager.inner.store_path, project_id)
            })
            .transpose()?;
        let (project_id, location) = if let Some(context) = project_context {
            if project_location_conflicts(&request) {
                return Err(anyhow!(
                    "invalid request: project_id cannot be combined with cwd or ssh location fields"
                ));
            }
            if let Some(defaults) = context.default_model_config {
                apply_project_model_defaults(&mut request, defaults);
            } else if let Some(sibling) =
                newest_project_session(&self.manager.inner.store_path, &context.project.project_id)
            {
                apply_sibling_model_defaults(&mut request, sibling);
            }
            let project = context.project;
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
        let config = NacConfig::load_from_cwd(&location.config_cwd)?;
        let orchestrator_compaction_threshold =
            create_compaction_threshold_override(request.orchestrator_compaction_threshold)?;
        let mut model = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
        )?;
        model.light_model = match request.light_model {
            Field::Unchanged | Field::Clear => None,
            Field::Set(light) => {
                // A same-backend light model with no explicit selector
                // inherits the session's primary one.
                let primary_key = match &model.api_key_env {
                    OptionalModelOption::Value(name) => Some(name.clone()),
                    OptionalModelOption::Inherit | OptionalModelOption::Clear => None,
                };
                let inherited = primary_key.as_deref().and_then(|name| {
                    let backend = model
                        .backend
                        .or_else(|| model.api_model.as_deref().and_then(provider_for_model))?;
                    Some(light_model::InheritedCredential {
                        backend,
                        name: Some(name),
                        previous: None,
                    })
                });
                Some(light_model::normalize(
                    light,
                    &NacConfig::load_credential_destination_policy(&location.config_cwd)?,
                    inherited,
                )?)
            }
        };
        // Mirror the launch-time resolution so the destination is checked
        // against the backend the session will actually use.
        let launch_backend = model.backend.or_else(|| {
            model
                .api_model
                .as_deref()
                .or(config.model.model.as_deref())
                .and_then(provider_for_model)
        });
        enforce_trusted_base_url(
            launch_backend,
            model.api_base_url.as_deref(),
            &NacConfig::load_credential_destination_policy(&location.config_cwd)?,
        )?;
        let mut run_config = runtime::build_run_config_for_project_with_behavior(
            RunOptions {
                workspace_cwd: location.workspace_cwd,
                config_cwd: Some(location.config_cwd.clone()),
                worker_executable: Some(self.manager.inner.worker_executable.clone()),
                store: StoreOptions {
                    store_path: Some(self.manager.inner.store_path.clone()),
                },
                model,
                orchestrator_compaction_threshold,
                sandbox: sandbox_options(request.sandbox),
                ssh: location.ssh,
            },
            &config,
            project_id,
            behavior,
        )
        .await
        .map_err(|error| {
            // A broken light model fails here, at launch resolution. Route it
            // through the configuration-error boundary so the response names
            // the actionable cause.
            match error.downcast_ref::<LightModelError>() {
                Some(light_error) if light_error.is_invalid_settings() => {
                    request_configuration_error_from(error)
                }
                _ => error,
            }
        })?;
        self.manager
            .attach_managed_command_environment(&mut run_config);
        let parts = SessionService::from_orchestrator_run_config(run_config);
        let service = parts.service;
        service.acquire_sandbox_resource_lease()?;
        let snapshot = service.frontend_snapshot().await?;
        let session_id = snapshot
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("new session did not include a session id"))?;
        self.manager
            .inner
            .active_sessions
            .write()
            .await
            .insert(session_id, Arc::new(service));
        Ok(snapshot)
    }
}
