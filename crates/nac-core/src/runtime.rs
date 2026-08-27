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

mod builders;
mod configuration;
mod model_resolution;
mod resume;

pub use builders::{
    build_managed_worker_config, build_run_config, build_run_config_for_project,
    build_run_config_for_project_with_behavior,
};
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
pub use resume::{
    build_resume_config, build_resume_config_for_session,
    build_resume_config_for_session_attachment, build_resume_config_for_session_with_lease,
    build_resume_picker_config,
};
#[cfg(test)]
use resume::{build_resume_config_from_snapshot, normalize_snapshot_paths};

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
