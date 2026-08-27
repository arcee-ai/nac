use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::{AgentEvent, EventSink};
use crate::light_model::{resolve_light_client, LightModelError, LightModelSettings};
use crate::mcp::{McpRegistry, McpRootPolicy, McpTransportPolicy};
use crate::model::{
    managed_backend_base_url, resolve_model_metadata, BackendKind, EffectiveModelSettings,
    ModelClient, ModelConfigurationError, ModelMetadata, ReasoningEffort,
};
use crate::paths::PathContext;
pub use crate::sandbox::session_worktree::cleanup_session_worktree;
/// Public because callers outside this crate build the connections that sessions
/// and git targets are created from.
pub use crate::sandbox::SshConnection;
use crate::sandbox::{
    browse_remote_directory, build_sandbox_spec, parse_mount_spec, session_worktree, MountSpec,
    SandboxBackendType, SandboxSession, SandboxSpec, DEFAULT_SANDBOX_IMAGE,
    DEFAULT_SANDBOX_WORKDIR,
};
pub use crate::sandbox::{
    current_activity, probe_availability, RemoteBrowseError, RemoteEntry, RemoteListing,
    SandboxActivity, SandboxAvailability,
};
use crate::sessions::{self, SessionSnapshot};
use crate::skills::{self, SkillPathVisibility, SkillRegistry};
use crate::store;
use crate::worker::{build_preloaded_skill_messages, build_worker_context_messages};
pub use crate::worker::{run_managed_worker, ManagedWorkerRunConfig};
use crate::workspace::GitTarget;

mod configuration;
mod model_resolution;

#[cfg(test)]
use configuration::NonModelNacConfig;
pub use configuration::{
    CompactionConfig, ConfiguredModelIdentity, CredentialDestinationPolicy, ModelConfig, NacConfig,
    PermissionConfig, SandboxConfig, SecurityConfig, StorageConfig, WorkerConfig,
};
use model_resolution::{
    default_config_cwd, managed_worker_effective_model_settings, worker_command_output_limits,
    worker_thread_timeout_secs,
};
pub use model_resolution::{
    effective_model_settings, effective_orchestrator_compaction_threshold,
    parse_extra_headers_json, resolve_store_path,
};

#[derive(Debug, Clone, Default)]
pub struct StoreOptions {
    pub store_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum OptionalModelOption<T> {
    /// No CLI/API override was supplied; inherit `config.toml`.
    #[default]
    Inherit,
    /// Use the explicitly supplied value.
    Value(T),
    /// Explicitly select absence instead of inheriting a configured value.
    Clear,
}

impl<T: Clone> OptionalModelOption<T> {
    fn resolve(&self, configured: Option<T>) -> Option<T> {
        match self {
            Self::Inherit => configured,
            Self::Value(value) => Some(value.clone()),
            Self::Clear => None,
        }
    }

    fn snapshot_value(&self) -> Option<T> {
        match self {
            Self::Value(value) => Some(value.clone()),
            Self::Inherit | Self::Clear => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModelOptions {
    pub backend: Option<BackendKind>,
    pub reasoning_effort: OptionalModelOption<ReasoningEffort>,
    pub api_base_url: Option<String>,
    pub api_model: Option<String>,
    pub api_key_env: OptionalModelOption<String>,
    pub extra_headers: Option<BTreeMap<String, String>>,
    /// Optional light worker model; `Some` enables weight-classified
    /// dispatch for the session, `None` keeps single-model behavior.
    pub light_model: Option<LightModelSettings>,
}

#[derive(Debug, Clone, Default)]
pub struct SandboxOptions {
    pub sandbox: bool,
    pub no_mount_cwd: bool,
    pub mounts: Vec<String>,
    pub mounts_ro: Vec<String>,
    pub internal_mounts: Vec<(PathBuf, PathBuf, bool)>,
    pub sandbox_image: Option<String>,
    pub sandbox_gpus: Vec<String>,
    pub sandbox_shm_size: Option<String>,
    pub sandbox_session_key: Option<String>,
    pub sandbox_workdir: Option<String>,
    pub sandbox_backend: Option<String>,
    pub sandbox_cpus: Option<u8>,
    pub sandbox_mem: Option<u32>,
    /// Client-generated launch id used to key sandbox setup activity so a
    /// launching UI can poll its own progress. Not a sandbox config flag:
    /// it neither enables the sandbox nor marks explicit configuration.
    pub sandbox_activity_key: Option<String>,
}

impl SandboxOptions {
    pub fn explicit_sandbox_config_flags_present(&self) -> bool {
        self.no_mount_cwd
            || !self.mounts.is_empty()
            || !self.mounts_ro.is_empty()
            || self.sandbox_session_key.is_some()
            || self.sandbox_workdir.is_some()
            || self.sandbox_image.is_some()
            || !self.sandbox_gpus.is_empty()
            || self.sandbox_shm_size.is_some()
            || self.sandbox_backend.is_some()
            || self.sandbox_cpus.is_some()
            || self.sandbox_mem.is_some()
    }
}

#[derive(Debug, Clone, Default)]
pub struct WorkerDispatchOptions {
    pub session_id: String,
    pub thread_name: String,
    pub dispatch_id: String,
    pub action: String,
    pub source_threads: Vec<String>,
    pub skills: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    pub workspace_cwd: PathBuf,
    /// Local cwd for config/store resolution; SSH workspaces are remote.
    pub config_cwd: Option<PathBuf>,
    pub worker_executable: Option<PathBuf>,
    pub store: StoreOptions,
    pub model: ModelOptions,
    /// New-session override. `None` defaults to 70% of the resolved model's
    /// context window; `Some(0)` explicitly disables compaction.
    pub orchestrator_compaction_threshold: Option<u64>,
    pub sandbox: SandboxOptions,
    /// How to reach the host of a remote session; mutually exclusive with sandbox.
    pub ssh: SshOptions,
}

/// How to reach a host, as the caller supplies it: untrimmed, with the key path
/// still as typed. [`SshOptions::connection`] turns it into what ssh is given.
///
/// Every option OpenSSH would otherwise read from `~/.ssh/config` can be stated
/// here, so a remote session never depends on config nac cannot see. An alias
/// still works: a host with no port and no key leaves both to ssh.
#[derive(Debug, Clone, Default)]
pub struct SshOptions {
    /// `host` or `user@host`; absent or blank means the session is local.
    pub host: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<PathBuf>,
}

impl SshOptions {
    /// The host name, trimmed, or `None` for a local session.
    pub fn host(&self) -> Option<String> {
        trim_ssh_host(self.host.clone())
    }

    /// The connection these options describe, or `None` for a local session.
    ///
    /// `paths` is nac's own local path context, because the key lives on this
    /// machine: a `~` typed into the launch form has to become a real path
    /// before ssh, which is spawned without a shell, ever sees it.
    pub fn connection(&self, paths: &PathContext) -> Option<SshConnection> {
        self.host().map(|host| {
            SshConnection::resolved(host, self.port, self.identity_file.as_deref(), paths)
        })
    }

    /// Resolve the connection exactly as a session launch rooted at `config_cwd`
    /// would, so callers can persist stable host-side key paths.
    pub fn resolved_connection(&self, config_cwd: &Path) -> Option<SshConnection> {
        self.connection(&PathContext::new(config_cwd))
    }

    /// Rejects what would otherwise fail later as an opaque ssh error.
    ///
    /// nac runs ssh in batch mode, where a missing key is reported as a refused
    /// authentication rather than as a missing file, so the file is checked here
    /// while there is still something specific to say about it.
    fn validate(&self, paths: &PathContext) -> Result<()> {
        let Some(connection) = self.connection(paths) else {
            if self.port.is_some() || self.identity_file.is_some() {
                anyhow::bail!("an ssh port or private key needs an ssh host as well");
            }
            return Ok(());
        };
        if self.port == Some(0) {
            anyhow::bail!("ssh port must be between 1 and 65535");
        }
        if let Some(key) = connection.identity_file.as_deref() {
            if !key.exists() {
                anyhow::bail!("ssh private key '{}' does not exist", key.display());
            }
            if !key.is_file() {
                anyhow::bail!("ssh private key '{}' is not a file", key.display());
            }
        }
        Ok(())
    }
}

/// Lists a directory on the host these options describe, or the login home when
/// `path` is empty.
///
/// This is also how a launch form finds out whether the connection works: the
/// listing needs the same handshake a session would, and it leaves the
/// multiplexed connection behind for the session that follows. `config_cwd` is
/// the *local* directory nac's own paths resolve against, since the private key
/// and the control socket are on this machine.
pub async fn browse_ssh_directory(
    options: &SshOptions,
    path: Option<&str>,
    hidden: bool,
    config_cwd: &Path,
) -> std::result::Result<RemoteListing, RemoteBrowseError> {
    let paths = PathContext::new(config_cwd);
    options
        .validate(&paths)
        .map_err(|error| RemoteBrowseError::Invalid(error.to_string()))?;
    let connection = options.connection(&paths).ok_or_else(|| {
        RemoteBrowseError::Invalid("an ssh host is required to browse a remote directory".into())
    })?;
    browse_remote_directory(&connection, path, hidden, &paths).await
}

#[derive(Debug, Clone, Default)]
pub struct ManagedWorkerOptions {
    pub workspace_cwd: PathBuf,
    /// Local cwd for config/store resolution; SSH workspaces are remote.
    pub config_cwd: Option<PathBuf>,
    pub dispatch: WorkerDispatchOptions,
    pub store: StoreOptions,
    pub model: ModelOptions,
    pub sandbox: SandboxOptions,
    /// How to reach the host of a remote worker; mutually exclusive with sandbox.
    pub ssh: SshOptions,
}

#[derive(Debug, Clone, Default)]
pub struct ResumeOptions {
    pub lookup_cwd: PathBuf,
    pub worker_executable: Option<PathBuf>,
    pub session_id: Option<String>,
    pub last: bool,
    pub store: StoreOptions,
}

#[derive(Debug, Clone)]
pub struct EffectiveSandboxOptions {
    pub sandbox: bool,
    pub no_mount_cwd: bool,
    pub mounts: Vec<String>,
    pub mounts_ro: Vec<String>,
    pub internal_mounts: Vec<MountSpec>,
    pub sandbox_image: Option<String>,
    pub sandbox_gpus: Vec<String>,
    pub sandbox_shm_size: Option<String>,
    pub sandbox_session_key: Option<String>,
    pub sandbox_workdir: Option<String>,
    pub sandbox_backend: crate::sandbox::SandboxBackendType,
    pub sandbox_cpus: u8,
    pub sandbox_mem: u32,
    pub sandbox_activity_key: Option<String>,
    pub explicit_sandbox_config_flags_present: bool,
}

impl EffectiveSandboxOptions {
    pub fn sandbox_enabled(&self) -> bool {
        self.sandbox
    }

    pub fn sandbox_image(&self) -> Option<&str> {
        self.sandbox_image.as_deref()
    }

    pub fn explicit_sandbox_config_flags_present(&self) -> bool {
        self.explicit_sandbox_config_flags_present
    }
}

#[allow(dead_code, clippy::large_enum_variant)]
pub(crate) enum OrchestratorSession {
    Active {
        session_id: String,
        store_path: PathBuf,
        snapshot: SessionSnapshot,
    },
    Picker {
        store_path: PathBuf,
    },
}

impl OrchestratorSession {
    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::Active { session_id, .. } => Some(session_id),
            Self::Picker { .. } => None,
        }
    }

    pub fn store_path(&self) -> PathBuf {
        match self {
            Self::Active { store_path, .. } => store_path.clone(),
            Self::Picker { store_path } => store_path.clone(),
        }
    }

    pub fn into_snapshot(self) -> Option<SessionSnapshot> {
        match self {
            Self::Active { snapshot, .. } => Some(snapshot),
            Self::Picker { .. } => None,
        }
    }

    pub fn behavior(&self) -> sessions::SessionBehavior {
        match self {
            Self::Active { snapshot, .. } => snapshot.behavior,
            Self::Picker { .. } => sessions::SessionBehavior::Orchestrator,
        }
    }
}

pub struct OrchestratorRunConfig {
    pub(crate) agent: Agent,
    pub(crate) client: ModelClient,
    pub(crate) session: OrchestratorSession,
    pub(crate) sandbox_status: String,
    pub(crate) agents_md_status: String,
    pub(crate) workspace_display: String,
    /// Where git can be run for this session's checkout. `None` is a sandbox
    /// whose working directory is not mounted from the host: nothing outside
    /// the container can see those files, and the container does not outlive
    /// the session.
    pub(crate) workspace_git: Option<GitTarget>,
    pub(crate) resume_base_cwd: PathBuf,
}

impl OrchestratorRunConfig {
    pub fn resume_base_cwd(&self) -> &Path {
        &self.resume_base_cwd
    }

    pub fn set_command_environment_provider(
        &mut self,
        provider: Option<std::sync::Arc<dyn nac_contracts::CommandEnvironmentProvider>>,
    ) {
        self.agent.set_command_environment_provider(provider);
    }
}

#[derive(Debug, Clone)]
pub struct ResumePickerRunConfig {
    pub store_path: PathBuf,
    pub lookup_cwd: PathBuf,
    pub worker_executable: Option<PathBuf>,
}

#[allow(clippy::large_enum_variant)]
pub enum RunState {
    Orchestrator { run_config: OrchestratorRunConfig },
    ResumePicker(ResumePickerRunConfig),
    ManagedWorker(ManagedWorkerRunConfig),
}

pub(crate) fn effective_sandbox_options(
    options: SandboxOptions,
    config: &NacConfig,
) -> EffectiveSandboxOptions {
    let explicit_sandbox_config_flags_present = options.explicit_sandbox_config_flags_present();
    let sandbox_backend = options
        .sandbox_backend
        .as_deref()
        .or(config.sandbox.backend.as_deref())
        .map(|s| SandboxBackendType::from_str(s).unwrap_or_default())
        .unwrap_or_default();
    let sandbox_cpus = options.sandbox_cpus.or(config.sandbox.cpus).unwrap_or(2);
    let sandbox_mem = options
        .sandbox_mem
        .or(config.sandbox.memory_mib)
        .unwrap_or(2048);
    EffectiveSandboxOptions {
        sandbox: options.sandbox,
        no_mount_cwd: options.no_mount_cwd,
        mounts: options.mounts,
        mounts_ro: options.mounts_ro,
        internal_mounts: options
            .internal_mounts
            .into_iter()
            .map(|(host, guest, read_only)| MountSpec {
                host,
                guest,
                read_only,
            })
            .collect(),
        sandbox_image: options
            .sandbox_image
            .or_else(|| config.sandbox.image.clone()),
        sandbox_gpus: options.sandbox_gpus,
        sandbox_shm_size: options.sandbox_shm_size,
        sandbox_session_key: options.sandbox_session_key,
        sandbox_workdir: options.sandbox_workdir,
        sandbox_backend,
        sandbox_cpus,
        sandbox_mem,
        sandbox_activity_key: options.sandbox_activity_key,
        explicit_sandbox_config_flags_present,
    }
}

fn validate_target_sandbox_options(
    ssh_host: Option<&str>,
    options: &EffectiveSandboxOptions,
    remote_label: &str,
) -> Result<()> {
    if ssh_host.is_some()
        && (options.sandbox_enabled() || options.explicit_sandbox_config_flags_present())
    {
        anyhow::bail!(
            "invalid remote {remote_label}: ssh_host and sandbox options cannot both be set"
        );
    }
    validate_sandbox_options(options)
}

fn validate_sandbox_options(options: &EffectiveSandboxOptions) -> Result<()> {
    if !options.sandbox_enabled() && options.explicit_sandbox_config_flags_present() {
        anyhow::bail!("sandbox configuration flags require --sandbox");
    }
    Ok(())
}

pub async fn build_run_config(
    options: RunOptions,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    build_run_config_inner(
        options,
        config,
        None,
        sessions::SessionBehavior::Orchestrator,
    )
    .await
}

pub async fn build_run_config_for_project(
    options: RunOptions,
    config: &NacConfig,
    project_id: Option<String>,
) -> Result<OrchestratorRunConfig> {
    build_run_config_inner(
        options,
        config,
        project_id,
        sessions::SessionBehavior::Orchestrator,
    )
    .await
}

/// Build a persistent top-level session with an explicitly selected immutable
/// behavior. Existing callers continue through the orchestrator-only wrappers
/// above, so omission remains backward compatible.
pub async fn build_run_config_for_project_with_behavior(
    options: RunOptions,
    config: &NacConfig,
    project_id: Option<String>,
    behavior: sessions::SessionBehavior,
) -> Result<OrchestratorRunConfig> {
    build_run_config_inner(options, config, project_id, behavior).await
}

async fn build_run_config_inner(
    options: RunOptions,
    config: &NacConfig,
    project_id: Option<String>,
    behavior: sessions::SessionBehavior,
) -> Result<OrchestratorRunConfig> {
    let agent_mode = match behavior {
        sessions::SessionBehavior::Orchestrator => AgentMode::Orchestrator,
        sessions::SessionBehavior::Direct | sessions::SessionBehavior::DirectWithOrchestrator => {
            AgentMode::Direct
        }
    };
    let ssh_host = options.ssh.host();
    let config_cwd = options
        .config_cwd
        .clone()
        .unwrap_or_else(|| default_config_cwd(&options.workspace_cwd, ssh_host.as_deref()));
    let settings = effective_model_settings(&options.model, config)?;
    let orchestrator_compaction_threshold = effective_orchestrator_compaction_threshold(
        options.orchestrator_compaction_threshold,
        settings.resolved.context_window,
    )?;
    let client = ModelClient::from_effective_settings(settings.clone())?.with_cache_ttl(Some("1h"));
    let light_model = options.model.light_model.clone();
    let light_client = light_model
        .as_ref()
        .map(|light| resolve_light_client(light, &settings.extra_headers))
        .transpose()?
        .map(std::sync::Arc::new);
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
    validate_target_sandbox_options(ssh_host.as_deref(), &sandbox_options, "session")?;
    let store_base_cwd = if ssh_host.is_some() {
        &config_cwd
    } else {
        &options.workspace_cwd
    };
    let store_path = resolve_store_path(store_base_cwd, options.store, config);
    store::initialize(&store_path)?;

    let config_paths = PathContext::new(&config_cwd);
    options.ssh.validate(&config_paths)?;
    if ssh_host.is_some() {
        let connection = options
            .ssh
            .connection(&config_paths)
            .expect("a trimmed ssh host yields a connection");
        let requested_remote_cwd = remote_cwd_or_home(options.workspace_cwd.clone());
        let requested_remote_cwd_text = requested_remote_cwd
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("remote working directory is not valid UTF-8"))?;
        let remote_cwd =
            canonical_remote_session_cwd(&connection, requested_remote_cwd_text, &config_paths)
                .await?;
        let working_directory = directory_display(&remote_cwd);
        let workspace_git = GitTarget::ssh(connection.clone(), remote_cwd.clone(), &config_cwd);
        let session_id = Uuid::new_v4().to_string();
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                command_output_limits: worker_command_output_limits(config)?,
                mode: agent_mode,
                session_behavior: Some(behavior),
                store_path: store_path.clone(),
                session_id: Some(session_id.clone()),
                orchestrator_compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: remote_cwd.clone(),
                config_cwd: config_cwd.clone(),
                working_directory: working_directory.clone(),
                worker_executable: options.worker_executable,
                sandbox: None,
                ssh: Some(connection.clone()),
                mcp: None,
                skills,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: worker_thread_timeout_secs(config),
                light_client: light_client.clone(),
                permission_rules: config.permissions.rules.clone(),
            },
        )?;
        let mut session_snapshot = sessions::new_snapshot(
            session_id.clone(),
            remote_cwd,
            settings.model.clone(),
            settings.base_url.clone(),
            settings.backend,
            settings.reasoning_effort,
            None,
            Some(connection),
            agent.messages.clone(),
            settings.api_key_env.clone(),
            settings.extra_headers.clone(),
        );
        session_snapshot.behavior = behavior;
        session_snapshot.project_id = project_id.clone();
        session_snapshot.orchestrator_compaction_threshold = orchestrator_compaction_threshold;
        session_snapshot.light_model = light_model;
        sessions::create_session(&store_path, &session_snapshot)?;

        return Ok(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id,
                store_path,
                snapshot: session_snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: working_directory,
            workspace_git: Some(workspace_git),
            resume_base_cwd: config_cwd,
        });
    }

    let workspace_cwd = options.workspace_cwd;
    let session_id = Uuid::new_v4().to_string();
    let paths = PathContext::new(&workspace_cwd);
    let mut worktree_rollback: session_worktree::RollbackGuard;
    let sandbox = build_sandbox_session_inner(
        &sandbox_options,
        &workspace_cwd,
        Some(session_id.clone()),
        Some(store_path.clone()),
    )
    .await?;
    worktree_rollback = session_worktree::RollbackGuard::new(
        sandbox
            .as_ref()
            .and_then(|session| session.spec().worktree.clone()),
    );
    let build_result = (|| -> Result<OrchestratorRunConfig> {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &paths)?;
        let working_directory = sandbox
            .as_ref()
            .map(|session| session.workdir_display())
            .unwrap_or_else(|| directory_display(&workspace_cwd));
        let workspace_git = if let Some(session) = sandbox.as_ref() {
            session.host_workdir().map(GitTarget::local)
        } else {
            Some(GitTarget::local(workspace_cwd.clone()))
        };
        let sandbox_status = sandbox
            .as_ref()
            .map(|session| session.status_text())
            .unwrap_or_else(|| "off".to_string());
        let agents_md_message = agents_md.system_message();
        let agents_md_status = agents_md.status_text();

        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                command_output_limits: worker_command_output_limits(config)?,
                mode: agent_mode,
                session_behavior: Some(behavior),
                store_path: store_path.clone(),
                session_id: Some(session_id.clone()),
                orchestrator_compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: workspace_cwd.clone(),
                config_cwd: config_cwd.clone(),
                working_directory: working_directory.clone(),
                worker_executable: options.worker_executable,
                sandbox: sandbox.clone(),
                ssh: None,
                mcp: None,
                skills,
                extra_tool_defs: Vec::new(),
                agents_md_message,
                thread_timeout_secs: worker_thread_timeout_secs(config),
                light_client: light_client.clone(),
                permission_rules: config.permissions.rules.clone(),
            },
        )?;
        let mut session_snapshot = sessions::new_snapshot(
            session_id.clone(),
            workspace_cwd.clone(),
            settings.model.clone(),
            settings.base_url.clone(),
            settings.backend,
            settings.reasoning_effort,
            sandbox.as_ref().map(|session| session.spec().clone()),
            None, // fresh local/sandbox sessions carry no ssh_host
            agent.messages.clone(),
            settings.api_key_env.clone(),
            settings.extra_headers.clone(),
        );
        session_snapshot.behavior = behavior;
        session_snapshot.project_id = project_id;
        session_snapshot.orchestrator_compaction_threshold = orchestrator_compaction_threshold;
        session_snapshot.light_model = light_model;
        sessions::create_session(&store_path, &session_snapshot)?;
        if let Some(sandbox) = sandbox.as_ref() {
            sandbox.retain_for_durable_session();
        }
        worktree_rollback.disarm();

        Ok(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id,
                store_path,
                snapshot: session_snapshot,
            },
            sandbox_status,
            agents_md_status,
            workspace_display: working_directory,
            workspace_git,
            resume_base_cwd: workspace_cwd,
        })
    })();

    match build_result {
        Ok(run_config) => Ok(run_config),
        Err(error) => {
            if let Some(sandbox) = sandbox.as_ref() {
                // Disable fire-and-forget Drop cleanup before performing the
                // checked rollback. Every in-process failure after successful
                // `podman run` now settles removal before launch returns.
                sandbox.disable_drop_cleanup();
                if let Err(cleanup) = sandbox.destroy().await {
                    return Err(error.context(format!(
                        "fresh sandbox launch also failed to roll back its container: {cleanup:#}"
                    )));
                }
            }
            Err(error)
        }
    }
}

pub async fn build_managed_worker_config(
    options: ManagedWorkerOptions,
    config: &NacConfig,
) -> Result<ManagedWorkerRunConfig> {
    let client = ModelClient::from_effective_settings(managed_worker_effective_model_settings(
        &options.model,
    )?)?;
    let ssh_host = options.ssh.host();
    let config_cwd = options
        .config_cwd
        .clone()
        .unwrap_or_else(|| default_config_cwd(&options.workspace_cwd, ssh_host.as_deref()));
    let workspace_cwd = options.workspace_cwd;
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
    validate_target_sandbox_options(ssh_host.as_deref(), &sandbox_options, "worker")?;
    let store_base_cwd = if ssh_host.is_some() {
        &config_cwd
    } else {
        &workspace_cwd
    };
    let store_path = resolve_store_path(store_base_cwd, options.store, config);
    store::initialize(&store_path)?;
    let sandbox = if ssh_host.is_some() {
        None
    } else {
        build_sandbox_session(&sandbox_options, &workspace_cwd).await?
    };
    let workspace_paths = PathContext::new(&workspace_cwd);
    let config_paths = PathContext::new(&config_cwd);
    let (agents_md_message, mcp_outcome, skills) = if ssh_host.is_some() {
        let mcp_outcome = McpRegistry::load_reporting_skips(
            &workspace_cwd,
            None,
            &config_paths,
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await?;
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        (None, mcp_outcome, skills)
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &workspace_paths)?;
        let mcp_outcome = McpRegistry::load_reporting_skips(
            &workspace_cwd,
            sandbox.as_ref(),
            &workspace_paths,
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &workspace_paths)?;
        (agents_md.system_message(), mcp_outcome, skills)
    };
    // Surface each skip as a typed event on the worker's stderr channel so the
    // dashboard shows why a server's tools are missing.
    let worker_event_sink = EventSink::stderr_prefixed();
    for skipped in &mcp_outcome.skipped {
        worker_event_sink.emit(AgentEvent::McpServerSkipped {
            thread_name: Some(options.dispatch.thread_name.clone()),
            server_name: skipped.name.clone(),
            reason: skipped.reason.clone(),
        });
    }
    let mcp = mcp_outcome.registry;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let extra_tool_defs = mcp
        .as_ref()
        .map(|registry| registry.tool_definitions())
        .unwrap_or_default();

    let worker_context = store::load_worker_context(
        &store_path,
        &options.dispatch.session_id,
        &options.dispatch.thread_name,
        &options.dispatch.source_threads,
    )?;
    let mut initial_messages =
        build_preloaded_skill_messages(skills.as_deref(), &options.dispatch.skills)?;
    initial_messages.extend(build_worker_context_messages(
        &options.dispatch.thread_name,
        &worker_context,
    ));
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: worker_command_output_limits(config)?,
            mode: AgentMode::Worker,
            session_behavior: None,
            store_path: store_path.clone(),
            session_id: Some(options.dispatch.session_id.clone()),
            orchestrator_compaction_threshold: None,
            initial_messages,
            thread_name: Some(options.dispatch.thread_name.clone()),
            dispatch_id: Some(options.dispatch.dispatch_id.clone()),
            event_sink: EventSink::stderr_prefixed(),
            workspace_cwd,
            config_cwd,
            working_directory,
            worker_executable: None,
            sandbox,
            ssh: options.ssh.connection(&config_paths),
            mcp,
            skills: None,
            extra_tool_defs,
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
            light_client: None,
            permission_rules: config.permissions.rules.clone(),
        },
    )?;

    Ok(ManagedWorkerRunConfig {
        agent,
        store_path,
        session_id: options.dispatch.session_id,
        thread_name: options.dispatch.thread_name,
        action: options.dispatch.action,
    })
}

pub async fn build_resume_picker_config(
    options: ResumeOptions,
    config: &NacConfig,
) -> Result<ResumePickerRunConfig> {
    if options.last || options.session_id.is_some() {
        anyhow::bail!("session picker does not accept a session id or --last");
    }

    let lookup_cwd = options.lookup_cwd;
    let store_path = resolve_store_path(&lookup_cwd, options.store, config);
    store::initialize(&store_path)?;

    Ok(ResumePickerRunConfig {
        store_path,
        lookup_cwd,
        worker_executable: options.worker_executable,
    })
}

fn record_interrupted_run_recovery(
    run_config: &mut OrchestratorRunConfig,
    recovery: store::ActiveRunReconciliation,
) {
    if let store::ActiveRunReconciliation::Interrupted { run_id } = recovery {
        run_config.agent.set_interrupted_run_recovery(run_id);
    }
}

pub async fn build_resume_config(
    options: ResumeOptions,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
    if options.last && options.session_id.is_some() {
        anyhow::bail!("resume accepts either a session id or --last, not both");
    }

    let lookup_cwd = options.lookup_cwd;
    let resume_store_path = resolve_store_path(&lookup_cwd, options.store, config);

    let snapshot = match (options.session_id.as_deref(), options.last) {
        (Some(session_id), false) => {
            sessions::load_session_async(resume_store_path.clone(), session_id.to_string()).await?
        }
        (Some(_), true) => unreachable!(),
        (None, _) => sessions::load_last_session_async(resume_store_path.clone()).await?,
    };
    let session_id = snapshot.session_id.clone();
    let lease = sessions::SessionOperationLease::try_acquire(&resume_store_path, &session_id)?;
    lease.validate(&resume_store_path, &session_id)?;
    let recovery = store::reconcile_active_run(&resume_store_path, &session_id)?;
    let snapshot =
        sessions::load_session_async(resume_store_path.clone(), session_id.clone()).await?;

    let mut run_config = build_resume_config_from_snapshot(
        snapshot,
        resume_store_path,
        config,
        lookup_cwd,
        options.worker_executable,
        Some(&lease),
        true,
        None,
    )
    .await?;
    record_interrupted_run_recovery(&mut run_config, recovery);
    Ok(run_config)
}

pub async fn build_resume_config_for_session(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<OrchestratorRunConfig> {
    let lease = sessions::SessionOperationLease::try_acquire(&store_path, session_id)?;
    lease.validate(&store_path, session_id)?;
    let recovery = store::reconcile_active_run(&store_path, session_id)?;
    let snapshot = sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
    let mut run_config = build_resume_config_from_snapshot(
        snapshot,
        store_path,
        config,
        resume_base_cwd,
        worker_executable,
        Some(&lease),
        true,
        None,
    )
    .await?;
    record_interrupted_run_recovery(&mut run_config, recovery);
    Ok(run_config)
}

pub async fn build_resume_config_for_session_attachment(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<(
    OrchestratorRunConfig,
    bool,
    Option<sessions::SessionOperationLease>,
)> {
    let snapshot = sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
    let metadata = resolve_model_metadata(snapshot.backend, &snapshot.model);
    let requires_migration = snapshot.reasoning_effort.is_some_and(|effort| {
        metadata.source.is_authoritative() && !metadata.thinking_level_map.is_supported(effort)
    });
    let requires_run_recovery = store::load_run_recovery(&store_path, session_id)?.is_some();
    if !requires_migration && !requires_run_recovery {
        let run_config = build_resume_config_from_snapshot(
            snapshot,
            store_path,
            config,
            resume_base_cwd,
            worker_executable,
            None,
            true,
            Some(metadata),
        )
        .await?;
        return Ok((run_config, true, None));
    }
    match sessions::SessionOperationLease::try_acquire(&store_path, session_id) {
        Ok(lease) => {
            lease.validate(&store_path, session_id)?;
            let recovery = store::reconcile_active_run(&store_path, session_id)?;
            let snapshot =
                sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
            let mut run_config = build_resume_config_from_snapshot(
                snapshot,
                store_path,
                config,
                resume_base_cwd,
                worker_executable,
                Some(&lease),
                true,
                None,
            )
            .await?;
            record_interrupted_run_recovery(&mut run_config, recovery);
            Ok((run_config, true, Some(lease)))
        }
        Err(sessions::SessionOperationLeaseError::Busy(_)) => {
            let run_config = build_resume_config_from_snapshot(
                snapshot,
                store_path,
                config,
                resume_base_cwd,
                worker_executable,
                None,
                false,
                Some(metadata),
            )
            .await?;
            Ok((run_config, false, None))
        }
        Err(error) => Err(error.into()),
    }
}

pub async fn build_resume_config_for_session_with_lease(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
    operation_lease: &sessions::SessionOperationLease,
) -> Result<OrchestratorRunConfig> {
    operation_lease.validate(&store_path, session_id)?;
    let recovery = store::reconcile_active_run(&store_path, session_id)?;
    let snapshot = sessions::load_session_async(store_path.clone(), session_id.to_string()).await?;
    let mut run_config = build_resume_config_from_snapshot(
        snapshot,
        store_path,
        config,
        resume_base_cwd,
        worker_executable,
        Some(operation_lease),
        true,
        None,
    )
    .await?;
    record_interrupted_run_recovery(&mut run_config, recovery);
    Ok(run_config)
}

#[allow(clippy::too_many_arguments)]
async fn build_resume_config_from_snapshot(
    snapshot: SessionSnapshot,
    store_path: PathBuf,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
    operation_lease: Option<&sessions::SessionOperationLease>,
    persist_recovery: bool,
    resolved_metadata: Option<ModelMetadata>,
) -> Result<OrchestratorRunConfig> {
    let mut snapshot = normalize_snapshot_paths(snapshot, &resume_base_cwd)?;
    let agent_mode = match snapshot.behavior {
        sessions::SessionBehavior::Orchestrator => AgentMode::Orchestrator,
        sessions::SessionBehavior::Direct | sessions::SessionBehavior::DirectWithOrchestrator => {
            AgentMode::Direct
        }
    };
    // Resume reaches the host with the connection the session recorded, not with
    // whatever the local ssh config happens to say now.
    let ssh = snapshot.ssh.clone();
    if ssh.is_some() && snapshot.sandbox_spec.is_some() {
        anyhow::bail!(
            "invalid session configuration: ssh_host and podman sandbox metadata cannot both be set"
        );
    }

    let workspace_cwd = snapshot.cwd.clone();
    let config_cwd = if ssh.is_some() {
        resume_base_cwd.clone()
    } else {
        workspace_cwd.clone()
    };
    let paths = PathContext::new(&workspace_cwd);
    let stored_model = snapshot.model.clone();
    let stored_base_url = snapshot.base_url.clone();
    let stored_reasoning_effort = snapshot.reasoning_effort;
    let metadata = resolved_metadata
        .unwrap_or_else(|| resolve_model_metadata(snapshot.backend, &stored_model));
    if let Some(effort) = stored_reasoning_effort {
        if !metadata.thinking_level_map.is_supported(effort) {
            snapshot.reasoning_effort =
                metadata.thinking_level_map.closest_supported_effort(effort);
        }
    }
    let authoritative = metadata.source.is_authoritative();
    let snapshot_settings = EffectiveModelSettings::new_with_resolved(
        snapshot.backend,
        stored_model.clone(),
        stored_base_url.clone(),
        snapshot.reasoning_effort,
        snapshot.api_key_env.clone(),
        snapshot.extra_headers.clone(),
        metadata,
    )
    .map_err(|error| {
        anyhow::anyhow!(
            "stored session model settings are invalid; settings repair required: {}",
            error
        )
    })?;
    if snapshot_settings.model != stored_model || snapshot_settings.base_url != stored_base_url {
        anyhow::bail!(
            "stored session model settings are invalid; settings repair required: model and base_url must be stored in normalized nonblank form"
        );
    }
    if persist_recovery && snapshot.reasoning_effort != stored_reasoning_effort && authoritative {
        let migration_lease;
        if let Some(lease) = operation_lease {
            lease.validate(&store_path, &snapshot.session_id)?;
        } else {
            migration_lease =
                sessions::SessionOperationLease::try_acquire(&store_path, &snapshot.session_id)?;
            migration_lease.validate(&store_path, &snapshot.session_id)?;
        }
        snapshot.config_version = sessions::update_session_config(&store_path, &snapshot)?;
    }
    let client = ModelClient::from_effective_settings(snapshot_settings)
        .map_err(|error| {
            if error.downcast_ref::<ModelConfigurationError>().is_some() {
                let message = format!(
                    "stored session model settings are invalid; settings repair required: {}",
                    error
                );
                error.context(message)
            } else {
                error
            }
        })?
        .with_cache_ttl(Some("1h"));
    let light_client = snapshot
        .light_model
        .as_ref()
        .map(|light| resolve_light_client(light, &snapshot.extra_headers))
        .transpose()
        .map_err(|error| match error {
            // The resolver classifies the failure at the source; add the
            // repair context without type-sniffing the chain. The boundary
            // renders the full chain once with `{:#}`.
            LightModelError::InvalidSettings(inner) => inner.context(
                "stored session light-model settings are invalid; settings repair required",
            ),
            // Keep the typed wrapper so its top-level context still names
            // the light model as the failing component.
            error @ LightModelError::Other(_) => anyhow::Error::from(error),
        })?
        .map(std::sync::Arc::new);
    let sandbox = if ssh.is_some() {
        None
    } else {
        match snapshot.sandbox_spec.clone() {
            Some(spec) => {
                let materialize = match &spec.worktree {
                    Some(worktree) => session_worktree::restore(
                        worktree,
                        session_worktree::checkout_in_container(&spec),
                    )?,
                    None => false,
                };
                let session_key = snapshot.session_id.clone();
                // A persisted container is owned by the durable session, not
                // by each process that observes it. Resume attachments must
                // never acquire destructive Drop authority: multiple servers
                // can legitimately observe the same stable container.
                let session = SandboxSession::create_for_durable_resume(
                    spec,
                    session_key.clone(),
                    session_key,
                )
                .await?;
                if materialize {
                    session.materialize_worktree().await?;
                    if let Some(worktree) = session.spec().worktree.as_ref() {
                        session_worktree::mark_materialized(worktree)?;
                    }
                }
                Some(session)
            }
            None => None,
        }
    };

    store::initialize(&store_path)?;

    let (skills, agents_md_status, agents_md_message) = if ssh.is_some() {
        let config_paths = PathContext::new(&config_cwd);
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        (skills, "off".to_string(), None)
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &paths)?;
        let message = (agent_mode == AgentMode::Direct)
            .then(|| agents_md.system_message())
            .flatten();
        (skills, agents_md.status_text(), message)
    };
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let workspace_git = match ssh.clone() {
        Some(connection) => Some(GitTarget::ssh(
            connection,
            workspace_cwd.clone(),
            &config_cwd,
        )),
        None => match sandbox.as_ref() {
            Some(session) => session.host_workdir().map(GitTarget::local),
            None => Some(GitTarget::local(workspace_cwd.clone())),
        },
    };
    let sandbox_status = sandbox
        .as_ref()
        .map(|session| session.status_text())
        .unwrap_or_else(|| "off".to_string());

    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: worker_command_output_limits(config)?,
            mode: agent_mode,
            session_behavior: Some(snapshot.behavior),
            store_path: store_path.clone(),
            session_id: Some(snapshot.session_id.clone()),
            orchestrator_compaction_threshold: snapshot.orchestrator_compaction_threshold,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd,
            config_cwd,
            working_directory: working_directory.clone(),
            worker_executable,
            sandbox,
            ssh,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
            light_client,
            permission_rules: config.permissions.rules.clone(),
        },
    )?;
    // Restore is blob ++ transcript log: rows the crashed previous run
    // appended after the last snapshot save are merged over the blob, and a
    // dangling tool turn is trimmed from both (crash-resume normalization).
    // An empty log tail is exactly the pre-log restore path.
    // Gap recovery can also rewrite the blob itself (a dangling turn trimmed
    // out of it): install the repaired blob so store-backed transcript reads
    // do not serve the discarded turn from the stale pre-repair snapshot.
    if let Some(repaired_blob) = agent
        .restore_messages_merging_log_tail(snapshot.messages.clone(), operation_lease)
        .await?
    {
        snapshot.messages = repaired_blob;
    }
    agent.restore_compaction_checkpoint()?;

    let session_id = snapshot.session_id.clone();
    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
            store_path,
            snapshot,
        },
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_git,
        resume_base_cwd,
    })
}

fn normalize_snapshot_paths(
    mut snapshot: SessionSnapshot,
    resume_base_cwd: &Path,
) -> Result<SessionSnapshot> {
    // Remote cwd values are not local paths.
    if snapshot.ssh.is_some() {
        return Ok(snapshot);
    }

    let raw_cwd = if snapshot.cwd.is_absolute() {
        snapshot.cwd.clone()
    } else {
        resume_base_cwd.join(&snapshot.cwd)
    };
    snapshot.cwd = match raw_cwd.canonicalize() {
        Ok(cwd) => cwd,
        Err(_)
            if snapshot
                .sandbox_spec
                .as_ref()
                .is_some_and(|spec| spec.worktree.is_some()) =>
        {
            // The live checkout may have switched to a branch where this
            // subdirectory is absent. The persisted sandbox mounts still
            // identify the session worktree, which remains resumable.
            raw_cwd
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to resolve session cwd {}", raw_cwd.display()));
        }
    };
    Ok(snapshot)
}

fn trim_ssh_host(ssh_host: Option<String>) -> Option<String> {
    ssh_host
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn remote_cwd_or_home(cwd: PathBuf) -> PathBuf {
    if cwd.as_os_str().to_string_lossy().trim().is_empty() {
        PathBuf::from("~")
    } else {
        cwd
    }
}

async fn canonical_remote_session_cwd(
    connection: &SshConnection,
    requested: &str,
    paths: &PathContext,
) -> Result<PathBuf> {
    // The login home spelling is already stable for one canonical connection
    // identity and intentionally remains portable across hosts.
    if requested == "~" {
        return Ok(PathBuf::from("~"));
    }
    #[cfg(test)]
    if let Some(path) = std::env::var_os("NAC_TEST_CANONICAL_REMOTE_CWD") {
        return Ok(PathBuf::from(path));
    }
    Ok(PathBuf::from(
        crate::sandbox::browse_remote_directory(connection, Some(requested), false, paths)
            .await
            .map_err(anyhow::Error::new)?
            .path,
    ))
}

pub async fn build_sandbox_session(
    options: &EffectiveSandboxOptions,
    cwd: &Path,
) -> Result<Option<SandboxSession>> {
    build_sandbox_session_inner(options, cwd, None, None).await
}

async fn build_sandbox_session_inner(
    options: &EffectiveSandboxOptions,
    cwd: &Path,
    owned_session_key: Option<String>,
    durable_store_path: Option<PathBuf>,
) -> Result<Option<SandboxSession>> {
    validate_sandbox_options(options)?;
    if !options.sandbox {
        return Ok(None);
    }

    let owner = owned_session_key.is_some() || options.sandbox_session_key.is_none();
    let session_key = owned_session_key
        .or_else(|| options.sandbox_session_key.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Everything between the fork (inside `cwd_mount`) and `launch_session`
    // is fallible, and `launch_session`'s rollback only covers
    // `SandboxSession::create` failing. A forked worktree predates the
    // session row, so nothing else would ever clean it up: roll it back here
    // when any intermediate step fails.
    let mut forked_worktree = None;
    let mut inferred_workdir = PathBuf::from(DEFAULT_SANDBOX_WORKDIR);
    let spec = (|| -> Result<SandboxSpec> {
        let mut mounts = Vec::new();
        if !options.no_mount_cwd {
            let cwd_mount = session_worktree::cwd_mount(cwd, &session_key, owner)?;
            mounts.extend(cwd_mount.git_dir_mounts);
            inferred_workdir = cwd_mount.workdir;
            forked_worktree = cwd_mount.worktree;
            mounts.push(MountSpec {
                host: cwd_mount.host,
                guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            });
        }
        mounts.extend(options.internal_mounts.clone());
        for mount in &options.mounts {
            mounts.push(parse_mount_spec(mount, false, cwd)?);
        }
        for mount in &options.mounts_ro {
            mounts.push(parse_mount_spec(mount, true, cwd)?);
        }

        let workdir = options.sandbox_workdir.clone().unwrap_or_else(|| {
            inferred_workdir
                .to_str()
                .expect("sandbox worktree paths are validated as UTF-8")
                .to_string()
        });
        let skills_workspace_dir = workspace_dir_from_mounts(&mounts, PathBuf::from(&workdir))
            .unwrap_or_else(|| cwd.to_path_buf());
        mounts.extend(skills::auto_mounts(
            &skills_workspace_dir,
            &mounts,
            &PathContext::new(cwd),
        )?);

        build_sandbox_spec(
            options.sandbox_backend,
            options
                .sandbox_image
                .as_deref()
                .unwrap_or(DEFAULT_SANDBOX_IMAGE)
                .to_string(),
            workdir,
            mounts,
            options
                .sandbox_gpus
                .iter()
                .map(|device| normalize_gpu_device(device))
                .collect(),
            Some(
                options
                    .sandbox_shm_size
                    .clone()
                    .unwrap_or_else(|| "0".to_string()),
            ),
            options.sandbox_cpus,
            options.sandbox_mem,
        )
    })();
    let mut spec = match spec {
        Ok(spec) => spec,
        Err(error) => {
            if let Some(worktree) = &forked_worktree {
                session_worktree::rollback(worktree);
            }
            return Err(error);
        }
    };
    spec.worktree = forked_worktree;
    // A launching UI polls setup activity under its own client-generated key;
    // without one, the session key is the correlation id. Bounded so a
    // caller cannot grow the activity map with unbounded keys.
    let activity_key = options
        .sandbox_activity_key
        .clone()
        .filter(|key| !key.is_empty() && key.len() <= 128)
        .unwrap_or_else(|| session_key.clone());
    let session = session_worktree::launch_session(
        spec,
        session_key,
        owner,
        activity_key,
        durable_store_path,
    )
    .await?;
    Ok(Some(session))
}

pub(crate) fn normalize_gpu_device(device: &str) -> String {
    if device == "all" {
        "nvidia.com/gpu=all".to_string()
    } else {
        device.to_string()
    }
}

pub(crate) fn workspace_dir_from_mounts(mounts: &[MountSpec], workdir: PathBuf) -> Option<PathBuf> {
    for mount in mounts {
        if workdir.starts_with(&mount.guest) {
            let suffix = workdir
                .strip_prefix(&mount.guest)
                .unwrap_or_else(|_| Path::new(""));
            let mut host = mount.host.clone();
            for component in suffix.components() {
                if let std::path::Component::Normal(part) = component {
                    host.push(part);
                }
            }
            return Some(host);
        }
    }
    None
}

pub(crate) fn effective_workspace_dir(
    current_dir: &Path,
    sandbox: Option<&SandboxSession>,
) -> Option<PathBuf> {
    if let Some(sandbox) = sandbox {
        return sandbox.host_workdir();
    }
    Some(current_dir.to_path_buf())
}

pub(crate) fn directory_display(cwd: &Path) -> String {
    cwd.display().to_string()
}

pub(crate) fn absolute_store_path(cwd: &Path, store_path: PathBuf) -> PathBuf {
    if store_path.is_absolute() {
        store_path
    } else {
        cwd.join(store_path)
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
