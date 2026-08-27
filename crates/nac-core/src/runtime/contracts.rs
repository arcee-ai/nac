use super::*;

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
    pub(super) fn resolve(&self, configured: Option<T>) -> Option<T> {
        match self {
            Self::Inherit => configured,
            Self::Value(value) => Some(value.clone()),
            Self::Clear => None,
        }
    }

    pub(super) fn snapshot_value(&self) -> Option<T> {
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
    pub(super) fn validate(&self, paths: &PathContext) -> Result<()> {
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
            Self::Active { store_path, .. } | Self::Picker { store_path } => store_path.clone(),
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
