use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::EventSink;
use crate::light_model::{resolve_light_client, LightModelError, LightModelSettings};
use crate::mcp::{McpRegistry, McpRootPolicy, McpTransportPolicy};
use crate::model::{
    managed_backend_base_url, resolve_model_metadata, BackendKind, EffectiveModelSettings,
    ModelClient, ModelConfigurationError, ModelMetadata, ReasoningEffort,
};
use crate::paths::PathContext;
/// Public because callers outside this crate build the connections that sessions
/// and git targets are created from.
pub use crate::sandbox::SshConnection;
use crate::sandbox::{
    browse_remote_directory, build_sandbox_spec, parse_mount_spec, MountSpec, SandboxBackendType,
    SandboxSession, DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR,
};
pub use crate::sandbox::{RemoteBrowseError, RemoteEntry, RemoteListing};
use crate::sessions::{self, SessionSnapshot};
use crate::skills::{self, SkillPathVisibility, SkillRegistry};
use crate::store;
use crate::worker::{build_preloaded_skill_messages, build_worker_context_messages};
pub use crate::worker::{run_managed_worker, ManagedWorkerRunConfig};
use crate::workspace::GitTarget;

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct NacConfig {
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub model: ModelConfig,
    #[serde(default)]
    pub compaction: CompactionConfig,
    #[serde(default)]
    pub sandbox: SandboxConfig,
    #[serde(default)]
    pub worker: WorkerConfig,
    #[serde(default)]
    pub security: SecurityConfig,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct StorageConfig {
    pub store_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct SecurityConfig {
    /// Extra hosts allowed to receive API-key credentials as `base_url`.
    ///
    /// Only this file can widen the set, which is what keeps the credential
    /// destination out of reach of the unauthenticated HTTP API.
    #[serde(default)]
    pub trusted_base_url_hosts: Vec<String>,
}

/// Model defaults from config.toml's `[model]` section. Slim by design:
/// the backend is resolved from the configured model id through the
/// catalog, base URLs materialize from catalog provider endpoint defaults,
/// and credentials auto-select the provider's conventional env var — so
/// only the model id, an optional effort, and extra headers remain.
/// Removed keys (`backend`, `base_url`, `api_key_env`) in an old config
/// are ignored with a one-time warning at load.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ModelConfig {
    pub model: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    #[serde(default)]
    pub extra_headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct CompactionConfig {
    /// Absolute orchestrator context threshold for new sessions. Zero disables it.
    pub threshold_tokens: Option<u64>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct SandboxConfig {
    pub image: Option<String>,
    pub backend: Option<String>,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct WorkerConfig {
    pub thread_timeout_secs: Option<u64>,
    pub command_output_max_bytes: Option<usize>,
    pub command_output_session_max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct NonModelNacConfig {
    #[serde(default)]
    storage: StorageConfig,
    #[serde(default)]
    sandbox: SandboxConfig,
    #[serde(default)]
    worker: WorkerConfig,
    #[serde(default)]
    security: SecurityConfig,
}

impl From<NonModelNacConfig> for NacConfig {
    fn from(config: NonModelNacConfig) -> Self {
        Self {
            storage: config.storage,
            model: ModelConfig::default(),
            compaction: CompactionConfig::default(),
            sandbox: config.sandbox,
            worker: config.worker,
            security: config.security,
        }
    }
}

impl NacConfig {
    pub fn load() -> Result<Self> {
        let Some(path) = crate::paths::nac_config_path() else {
            return Ok(Self::default());
        };
        Self::load_from_path(path)
    }

    pub fn load_from_cwd(cwd: &Path) -> Result<Self> {
        let paths = PathContext::new(cwd);
        let Some(path) = paths.nac_config_path() else {
            return Ok(Self::default());
        };
        Self::load_from_path(path)
    }

    /// Load runtime settings for a command whose model tuple and orchestrator
    /// compaction threshold come from a persisted session snapshot or whose
    /// model tuple comes from managed-worker transport.
    ///
    /// The complete TOML document must still be syntactically valid and all
    /// non-model runtime sections remain strictly typed. The `model` key is
    /// deliberately omitted from the deserialization target, so obsolete
    /// backend names, selector fields, and table shapes cannot affect a
    /// snapshot-authoritative command. MCP, workspace metadata, and other
    /// independent config consumers continue loading their own sections from
    /// the same file. The `compaction` key is also omitted so resumed sessions
    /// and managed workers never inherit an ambient orchestrator threshold.
    pub fn load_without_model_from_cwd(cwd: &Path) -> Result<Self> {
        let paths = PathContext::new(cwd);
        let Some(path) = paths.nac_config_path() else {
            return Ok(Self::default());
        };
        let raw = Self::read_config(&path)?;
        toml::from_str::<NonModelNacConfig>(&raw)
            .map(Into::into)
            .with_context(|| format!("failed to parse non-model config {}", path.display()))
    }

    /// Load the settings that decide where credentials may be sent.
    ///
    /// Deliberately lenient about the rest of `[model]`: config repair runs
    /// through the same request path, so an obsolete backend name must not
    /// stop NAC from authorizing a destination.
    pub fn load_credential_destination_policy(cwd: &Path) -> Result<CredentialDestinationPolicy> {
        let paths = PathContext::new(cwd);
        let Some(path) = paths.nac_config_path() else {
            return Ok(CredentialDestinationPolicy::default());
        };
        let raw = Self::read_config(&path)?;
        let parsed = toml::from_str::<CredentialPolicyConfig>(&raw).with_context(|| {
            format!("failed to parse credential policy from {}", path.display())
        })?;
        Ok(CredentialDestinationPolicy {
            configured_base_url: parsed.model.base_url,
            trusted_hosts: parsed.security.trusted_base_url_hosts,
        })
    }

    /// Read the provider identity an explicitly named config file spells out.
    ///
    /// Launching ignores these keys — the catalog resolves the provider from
    /// the model id — but importing a file the user pointed at is the one
    /// case where they are the only statement of intent available, so the
    /// importer reads them directly instead of through [`ModelConfig`].
    pub fn load_model_identity_from_file(path: &Path) -> Result<ConfiguredModelIdentity> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config {}", path.display()))?;
        toml::from_str::<ConfiguredModelIdentityConfig>(&raw)
            .map(|config| config.model)
            .with_context(|| format!("failed to parse config {}", path.display()))
    }

    /// Load a configuration file the user pointed at explicitly.
    ///
    /// Unlike the ambient search, a missing file is an error: the user named
    /// this path, so silently falling back to defaults would hide a typo.
    pub fn load_from_file(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config {}", path.display()))?;
        toml::from_str(&raw).with_context(|| format!("failed to parse config {}", path.display()))
    }

    fn load_from_path(path: PathBuf) -> Result<Self> {
        let raw = Self::read_config(&path)?;
        Self::warn_removed_model_keys(&raw);
        toml::from_str(&raw).with_context(|| format!("failed to parse config {}", path.display()))
    }

    /// One-time migration warning for `[model]` keys removed from the
    /// config schema (`backend`, `base_url`, `api_key_env`): they parse
    /// tolerantly (serde ignores them) and the catalog-driven resolution
    /// replaces them. Printed at most once per process even though config
    /// loads happen per session launch.
    fn warn_removed_model_keys(raw: &str) {
        const REMOVED_KEYS: [&str; 3] = ["backend", "base_url", "api_key_env"];
        static WARNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if WARNED.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let Ok(value) = raw.parse::<toml::Value>() else {
            return;
        };
        let Some(model) = value.get("model").and_then(|model| model.as_table()) else {
            return;
        };
        let removed: Vec<&str> = REMOVED_KEYS
            .into_iter()
            .filter(|key| model.contains_key(*key))
            .collect();
        if removed.is_empty() {
            return;
        }
        WARNED.store(true, std::sync::atomic::Ordering::Relaxed);
        eprintln!(
            "nac: config: ignoring removed [model] keys ({}) — the backend now resolves from the model id through the catalog, base URLs default from the catalog, and credentials auto-select the provider's conventional environment variable",
            removed.join(", ")
        );
    }

    fn read_config(path: &Path) -> Result<String> {
        match std::fs::read_to_string(path) {
            Ok(raw) => Ok(raw),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(error) => {
                Err(error).with_context(|| format!("failed to read config {}", path.display()))
            }
        }
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct ConfiguredModelIdentityConfig {
    #[serde(default)]
    model: ConfiguredModelIdentity,
}

/// The `[model]` keys an older config file uses to name a provider outright.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ConfiguredModelIdentity {
    pub backend: Option<BackendKind>,
    pub base_url: Option<String>,
    pub api_key_env: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct CredentialPolicyConfig {
    #[serde(default)]
    model: CredentialPolicyModelConfig,
    #[serde(default)]
    security: SecurityConfig,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct CredentialPolicyModelConfig {
    #[serde(default)]
    base_url: Option<String>,
}

/// Destinations an operator has approved for API-key credentials.
#[derive(Debug, Clone, Default)]
pub struct CredentialDestinationPolicy {
    /// `[model] base_url`, which is authoritative by virtue of living in a
    /// hand-edited file rather than arriving over the HTTP API.
    pub configured_base_url: Option<String>,
    pub trusted_hosts: Vec<String>,
}

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
    pub sandbox_image: Option<String>,
    pub sandbox_gpus: Vec<String>,
    pub sandbox_shm_size: Option<String>,
    pub sandbox_session_key: Option<String>,
    pub sandbox_workdir: Option<String>,
    pub sandbox_backend: Option<String>,
    pub sandbox_cpus: Option<u8>,
    pub sandbox_mem: Option<u32>,
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
    pub sandbox_image: Option<String>,
    pub sandbox_gpus: Vec<String>,
    pub sandbox_shm_size: Option<String>,
    pub sandbox_session_key: Option<String>,
    pub sandbox_workdir: Option<String>,
    pub sandbox_backend: crate::sandbox::SandboxBackendType,
    pub sandbox_cpus: u8,
    pub sandbox_mem: u32,
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

#[allow(dead_code)]
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
}

#[derive(Debug, Clone)]
pub struct ResumePickerRunConfig {
    pub store_path: PathBuf,
    pub lookup_cwd: PathBuf,
    pub worker_executable: Option<PathBuf>,
}

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

/// Merge explicit new-session model options over `config.toml` settings.
///
/// This resolution never consults `OPENAI_MODEL`, `OPENAI_BASE_URL`, or any
/// ambient backend/model/base selector. Credential values are read only from
/// the configured `api_key_env` later when constructing the model client.
pub fn effective_model_settings(
    model: &ModelOptions,
    config: &NacConfig,
) -> Result<EffectiveModelSettings> {
    let model_id = model
        .api_model
        .clone()
        .or_else(|| config.model.model.clone());
    // The backend is explicit (request/CLI) or resolved from the model id
    // through the catalog (unique exact match; collisions prefer the
    // non-managed provider with a warning; unknown ids stay unresolved and
    // surface as the missing-backend error).
    let backend = model.backend.or_else(|| {
        model_id
            .as_deref()
            .and_then(crate::model::provider_for_model)
    });
    let selected_managed_base_url = model
        .backend
        .and_then(managed_backend_base_url)
        .map(str::to_string);
    // base_url chain: request/override → managed-if-request-names-backend →
    // (catalog provider default → managed second-stage → error, inside
    // `resolve_model_base_url`). No config tier.
    let base_url = model.api_base_url.clone().or(selected_managed_base_url);
    // api_key_env chain: request/override → (conventional-var
    // auto-selection inside `from_optional`) → managed = None → guided
    // error. No config tier.
    let api_key_env = model.api_key_env.snapshot_value();

    EffectiveModelSettings::from_optional(
        backend,
        model_id,
        base_url,
        model
            .reasoning_effort
            .resolve(config.model.reasoning_effort),
        api_key_env,
        model
            .extra_headers
            .clone()
            .unwrap_or_else(|| config.model.extra_headers.clone()),
    )
}

/// Resolve and normalize the persisted orchestrator compaction threshold for a
/// new session. Resume never calls this function: its value comes from the
/// session snapshot instead.
///
/// When no threshold is requested, the default is 70% of the resolved model's
/// context window (rounded to the nearest whole token). `Some(0)` explicitly
/// disables compaction. Config.toml `[compaction].threshold_tokens` is no
/// longer consulted — the section is silently ignored if present.
pub fn effective_orchestrator_compaction_threshold(
    requested: Option<u64>,
    context_window: u64,
) -> Result<Option<u64>> {
    let threshold = requested
        .or(Some((context_window as f64 * 0.7).round() as u64))
        .filter(|threshold| *threshold != 0);
    if threshold.is_some_and(|threshold| threshold > crate::MAX_SUPPORTED_TOKEN_COUNT) {
        anyhow::bail!(
            "orchestrator compaction threshold must not exceed {} tokens",
            crate::MAX_SUPPORTED_TOKEN_COUNT
        );
    }
    Ok(threshold)
}

fn managed_worker_effective_model_settings(model: &ModelOptions) -> Result<EffectiveModelSettings> {
    EffectiveModelSettings::from_optional(
        model.backend,
        model.api_model.clone(),
        model.api_base_url.clone(),
        model.reasoning_effort.snapshot_value(),
        model.api_key_env.snapshot_value(),
        model.extra_headers.clone().unwrap_or_default(),
    )
}

/// Parse the hidden worker header transport as a JSON object.
///
/// A present argument must be valid JSON. In particular, workers use `{}` to
/// transport an explicitly empty snapshot header map; absence is represented by
/// omitting the argument entirely.
pub fn parse_extra_headers_json(
    json: &str,
) -> std::result::Result<BTreeMap<String, String>, String> {
    serde_json::from_str::<BTreeMap<String, String>>(json)
        .map_err(|error| format!("expected a JSON object with string header values: {error}"))
}

pub(crate) fn worker_thread_timeout_secs(config: &NacConfig) -> u64 {
    config
        .worker
        .thread_timeout_secs
        .unwrap_or(crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS)
        .max(crate::tools::thread::MIN_THREAD_TIMEOUT_SECS)
}

pub(crate) fn worker_command_output_limits(
    config: &NacConfig,
) -> Result<crate::terminal::CommandOutputLimits> {
    crate::terminal::CommandOutputLimits {
        per_command_bytes: config
            .worker
            .command_output_max_bytes
            .unwrap_or(crate::terminal::DEFAULT_COMMAND_OUTPUT_MAX_BYTES),
        per_session_bytes: config
            .worker
            .command_output_session_max_bytes
            .unwrap_or(crate::terminal::DEFAULT_COMMAND_OUTPUT_SESSION_MAX_BYTES),
    }
    .validate()
}

fn default_config_cwd(workspace_cwd: &Path, ssh_host: Option<&str>) -> PathBuf {
    let is_ssh = ssh_host
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if is_ssh {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        workspace_cwd.to_path_buf()
    }
}

/// Resolve the SQLite store path against the caller's local base cwd.
pub fn resolve_store_path(cwd: &Path, options: StoreOptions, config: &NacConfig) -> PathBuf {
    absolute_store_path(
        cwd,
        options
            .store_path
            .or_else(|| config.storage.store_path.clone())
            .unwrap_or_else(store::default_store_path),
    )
}

pub async fn build_run_config(
    options: RunOptions,
    config: &NacConfig,
) -> Result<OrchestratorRunConfig> {
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
        let remote_cwd = remote_cwd_or_home(options.workspace_cwd.clone());
        let working_directory = directory_display(&remote_cwd);
        let workspace_git = GitTarget::ssh(connection.clone(), remote_cwd.clone(), &config_cwd);
        let session_id = Uuid::new_v4().to_string();
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                command_output_limits: worker_command_output_limits(config)?,
                mode: AgentMode::Orchestrator,
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
    let paths = PathContext::new(&workspace_cwd);
    let sandbox = build_sandbox_session(&sandbox_options, &workspace_cwd).await?;
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

    let session_id = Uuid::new_v4().to_string();
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: worker_command_output_limits(config)?,
            mode: AgentMode::Orchestrator,
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
    session_snapshot.orchestrator_compaction_threshold = orchestrator_compaction_threshold;
    session_snapshot.light_model = light_model;
    sessions::create_session(&store_path, &session_snapshot)?;

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
    let (agents_md_message, mcp, skills) = if ssh_host.is_some() {
        let mcp = McpRegistry::load_with_policy(
            &workspace_cwd,
            None,
            &config_paths,
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await?;
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        (None, mcp, skills)
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &workspace_paths)?;
        let mcp = McpRegistry::load(&workspace_cwd, sandbox.as_ref(), &workspace_paths).await?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &workspace_paths)?;
        (agents_md.system_message(), mcp, skills)
    };
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
        (Some(session_id), false) => sessions::load_session(&resume_store_path, session_id)?,
        (Some(_), true) => unreachable!(),
        (None, _) => sessions::load_last_session(&resume_store_path)?,
    };
    let session_id = snapshot.session_id.clone();
    let lease = sessions::SessionOperationLease::try_acquire(&resume_store_path, &session_id)?;
    lease.validate(&resume_store_path, &session_id)?;
    let recovery = store::reconcile_active_run(&resume_store_path, &session_id)?;
    let snapshot = sessions::load_session(&resume_store_path, &session_id)?;

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
    let snapshot = sessions::load_session(&store_path, session_id)?;
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
    let snapshot = sessions::load_session(&store_path, session_id)?;
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
            let snapshot = sessions::load_session(&store_path, session_id)?;
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
    let snapshot = sessions::load_session(&store_path, session_id)?;
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
                Some(SandboxSession::create(spec, Uuid::new_v4().to_string(), true).await?)
            }
            None => None,
        }
    };

    store::initialize(&store_path)?;

    let (skills, agents_md_status) = if ssh.is_some() {
        let config_paths = PathContext::new(&config_cwd);
        let skills = SkillRegistry::load(None, SkillPathVisibility::Hidden, &config_paths)?;
        (skills, "off".to_string())
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
        let (skill_workspace, visibility) = if sandbox.is_some() {
            (None, SkillPathVisibility::Hidden)
        } else {
            (workspace_dir.as_deref(), SkillPathVisibility::Visible)
        };
        let skills = SkillRegistry::load(skill_workspace, visibility, &paths)?;
        (skills, agents_md.status_text())
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
            mode: AgentMode::Orchestrator,
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
            agents_md_message: None,
            thread_timeout_secs: worker_thread_timeout_secs(config),
            light_client,
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
    let cwd = raw_cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve session cwd {}", raw_cwd.display()))?;
    snapshot.cwd = cwd;
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

pub async fn build_sandbox_session(
    options: &EffectiveSandboxOptions,
    cwd: &Path,
) -> Result<Option<SandboxSession>> {
    validate_sandbox_options(options)?;
    if !options.sandbox {
        return Ok(None);
    }

    let mut mounts = Vec::new();
    if !options.no_mount_cwd {
        mounts.push(parse_mount_spec(
            &format!("{}:{}", cwd.display(), DEFAULT_SANDBOX_WORKDIR),
            false,
            cwd,
        )?);
    }
    for mount in &options.mounts {
        mounts.push(parse_mount_spec(mount, false, cwd)?);
    }
    for mount in &options.mounts_ro {
        mounts.push(parse_mount_spec(mount, true, cwd)?);
    }

    let workdir = options
        .sandbox_workdir
        .clone()
        .unwrap_or_else(|| DEFAULT_SANDBOX_WORKDIR.to_string());
    let skills_workspace_dir = workspace_dir_from_mounts(&mounts, PathBuf::from(&workdir))
        .unwrap_or_else(|| cwd.to_path_buf());
    mounts.extend(skills::auto_mounts(
        &skills_workspace_dir,
        &mounts,
        &PathContext::new(cwd),
    )?);

    let spec = build_sandbox_spec(
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
    )?;
    let owner = options.sandbox_session_key.is_none();
    let session_key = options
        .sandbox_session_key
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = SandboxSession::create(spec, session_key, owner).await?;
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
mod tests {
    use super::*;
    use crate::mcp::test_support::{shell_single_quote, start_fake_http_mcp_server, toml_string};
    use crate::sandbox::SandboxSpec;
    use crate::types::Message;
    use crate::TEST_ENV_LOCK;
    use std::ffi::OsString;

    fn test_openai_model_options() -> ModelOptions {
        ModelOptions {
            backend: Some(BackendKind::OpenAiResponses),
            api_base_url: Some(" https://api.openai.com/v1 ".to_string()),
            api_model: Some(" test-model ".to_string()),
            api_key_env: OptionalModelOption::Value("OPENAI_API_KEY".to_string()),
            ..ModelOptions::default()
        }
    }

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_main_test_{}_{}", label, unique))
            .join("store.db")
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    async fn create_and_resume_effort_snapshot(
        store_path: &Path,
        root: &Path,
        key_name: &str,
        session_id: &str,
        backend: BackendKind,
        model: &str,
        stored_effort: ReasoningEffort,
    ) -> SessionSnapshot {
        let base_url = match backend {
            BackendKind::TogetherChat => "https://api.together.xyz/v1",
            BackendKind::AnthropicMessages => "https://api.anthropic.com/v1",
            BackendKind::ArceeApi => "https://api.arcee.ai/api/v1",
            _ => unreachable!(),
        };
        let snapshot = sessions::new_snapshot(
            session_id.to_string(),
            root.to_path_buf(),
            model.to_string(),
            base_url.to_string(),
            backend,
            Some(stored_effort),
            None,
            None,
            Vec::new(),
            Some(key_name.to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(store_path, &snapshot).unwrap();
        build_resume_config_for_session(
            store_path.to_path_buf(),
            session_id,
            &NacConfig::default(),
            root.to_path_buf(),
            None,
        )
        .await
        .unwrap()
        .session
        .into_snapshot()
        .unwrap()
    }

    /// A config whose `[model]` section resolves through the catalog:
    /// gpt-5.2 is unique to openai-responses, so the backend, the catalog
    /// endpoint default and the conventional credential variable all come
    /// from the catalog rather than config fields.
    fn complete_model_config() -> NacConfig {
        let mut config = NacConfig::default();
        config.model.model = Some("gpt-5.2".to_string());
        config
    }

    #[test]
    fn compaction_threshold_defaults_to_70pct_context_normalizes_zero_and_rejects_out_of_range_values(
    ) {
        // No request: defaults to 70% of the context window (rounded).
        assert_eq!(
            effective_orchestrator_compaction_threshold(None, 200_000).unwrap(),
            Some(140_000)
        );
        // Explicit request wins over the 0.7×context default.
        assert_eq!(
            effective_orchestrator_compaction_threshold(Some(12_000), 200_000).unwrap(),
            Some(12_000)
        );
        // Some(0) explicitly disables compaction regardless of context window.
        assert_eq!(
            effective_orchestrator_compaction_threshold(Some(0), 200_000).unwrap(),
            None
        );
        // The boundary value is accepted.
        assert_eq!(
            effective_orchestrator_compaction_threshold(
                Some(crate::MAX_SUPPORTED_TOKEN_COUNT),
                200_000,
            )
            .unwrap(),
            Some(crate::MAX_SUPPORTED_TOKEN_COUNT)
        );
        // Above the boundary is rejected.
        assert!(effective_orchestrator_compaction_threshold(
            Some(crate::MAX_SUPPORTED_TOKEN_COUNT + 1),
            200_000,
        )
        .is_err());

        // The `[compaction]` section is no longer consulted: a config that
        // has one produces the same result as one without.
        let config_with_compaction: NacConfig =
            toml::from_str("[compaction]\nthreshold_tokens = 64000\n").unwrap();
        assert_eq!(
            effective_orchestrator_compaction_threshold(None, 200_000).unwrap(),
            Some(140_000)
        );
        // The field still parses (backward compat) but is dead.
        assert_eq!(
            config_with_compaction.compaction.threshold_tokens,
            Some(64_000)
        );

        // NonModelNacConfig still omits compaction entirely.
        let worker_config: NacConfig =
            toml::from_str::<NonModelNacConfig>("[compaction]\nthreshold_tokens = 64000\n")
                .unwrap()
                .into();
        assert_eq!(worker_config.compaction.threshold_tokens, None);
    }

    #[test]
    fn effective_model_settings_ignore_ambient_model_and_base() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_base_url = std::env::var_os("OPENAI_BASE_URL");
        let original_model = std::env::var_os("OPENAI_MODEL");
        unsafe {
            std::env::set_var("OPENAI_BASE_URL", "https://ambient.example/v1");
            std::env::set_var("OPENAI_MODEL", "ambient-model");
        }

        let settings =
            effective_model_settings(&ModelOptions::default(), &complete_model_config()).unwrap();
        assert_eq!(settings.base_url, "https://api.openai.com/v1");
        assert_eq!(settings.model, "gpt-5.2");

        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
    }

    #[test]
    fn explicit_model_settings_beat_config_and_config_supplies_omissions() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_openai_key = std::env::var_os("OPENAI_API_KEY");
        unsafe { std::env::remove_var("OPENAI_API_KEY") };

        let mut config = complete_model_config();
        config.model.reasoning_effort = Some(ReasoningEffort::High);
        config
            .model
            .extra_headers
            .insert("X-Config".to_string(), "config".to_string());

        let inherited = effective_model_settings(&ModelOptions::default(), &config).unwrap();
        assert_eq!(inherited.backend, BackendKind::OpenAiResponses);
        assert_eq!(inherited.model, "gpt-5.2");
        assert_eq!(inherited.base_url, "https://api.openai.com/v1");
        assert_eq!(inherited.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(inherited.api_key_env, None);
        assert_eq!(
            inherited.extra_headers.get("X-Config").map(String::as_str),
            Some("config")
        );

        let headers = BTreeMap::from([("X-Explicit".to_string(), "explicit".to_string())]);
        let explicit = effective_model_settings(
            &ModelOptions {
                backend: Some(BackendKind::TogetherChat),
                reasoning_effort: OptionalModelOption::Value(ReasoningEffort::Low),
                api_base_url: Some(" https://explicit.example/v1 ".to_string()),
                api_model: Some(" explicit-model ".to_string()),
                api_key_env: OptionalModelOption::Value("EXPLICIT_API_KEY".to_string()),
                extra_headers: Some(headers.clone()),
                light_model: None,
            },
            &config,
        )
        .unwrap();
        assert_eq!(explicit.backend, BackendKind::TogetherChat);
        assert_eq!(explicit.model, "explicit-model");
        assert_eq!(explicit.base_url, "https://explicit.example/v1");
        assert_eq!(explicit.reasoning_effort, Some(ReasoningEffort::Low));
        assert_eq!(explicit.api_key_env.as_deref(), Some("EXPLICIT_API_KEY"));
        assert_eq!(explicit.extra_headers, headers);

        restore_env("OPENAI_API_KEY", original_openai_key);
    }

    #[test]
    fn managed_backends_materialize_base_after_explicit_over_config_resolution() {
        // A configured model id that collides with a managed provider's
        // entries resolves to the non-managed provider (the codex seed ids
        // all overlap the openai baseline), so managed backends are
        // reachable only through an explicit selection.
        let mut colliding_config = NacConfig::default();
        colliding_config.model.model = Some("gpt-5.3-codex-spark".to_string());
        let resolved = effective_model_settings(&ModelOptions::default(), &colliding_config)
            .expect("a colliding configured model resolves the non-managed provider");
        assert_eq!(resolved.backend, BackendKind::OpenAiResponses);
        assert_eq!(resolved.base_url, "https://api.openai.com/v1");

        for (backend, expected) in [
            (
                BackendKind::ChatGptCodexResponses,
                crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            ),
            (
                BackendKind::ArceeAuth,
                crate::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            ),
        ] {
            let mut explicit_config = NacConfig::default();
            explicit_config.model.model = Some("managed-model".to_string());
            let explicit = effective_model_settings(
                &ModelOptions {
                    backend: Some(backend),
                    api_model: Some(if backend == BackendKind::ArceeAuth {
                        "trinity-large-thinking".to_string()
                    } else {
                        "managed-model".to_string()
                    }),
                    ..ModelOptions::default()
                },
                &explicit_config,
            )
            .expect("an explicit managed backend should materialize after merge");
            assert_eq!(explicit.base_url, expected);
        }
    }

    #[test]
    fn openai_to_managed_launch_normalizes_omitted_url_and_credentials() {
        let config = complete_model_config();

        for (backend, expected_base_url) in [
            (
                BackendKind::ChatGptCodexResponses,
                crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            ),
            (
                BackendKind::ArceeAuth,
                crate::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            ),
        ] {
            let settings = effective_model_settings(
                &ModelOptions {
                    backend: Some(backend),
                    api_model: Some("managed-model".to_string()),
                    ..ModelOptions::default()
                },
                &config,
            )
            .expect("managed selection must not inherit the OpenAI tuple");
            assert_eq!(settings.backend, backend);
            assert_eq!(settings.base_url, expected_base_url);
            assert_eq!(settings.api_key_env, None);

            let explicit = effective_model_settings(
                &ModelOptions {
                    backend: Some(backend),
                    api_model: Some("managed-model".to_string()),
                    api_base_url: Some("https://explicit.example/v1".to_string()),
                    api_key_env: OptionalModelOption::Value("EXPLICIT_KEY".to_string()),
                    ..ModelOptions::default()
                },
                &config,
            )
            .expect("explicit values must survive merge for validation");
            assert_eq!(explicit.base_url, "https://explicit.example/v1");
            assert_eq!(explicit.api_key_env.as_deref(), Some("EXPLICIT_KEY"));
        }
    }

    #[test]
    fn optional_model_overrides_distinguish_inherit_value_and_clear() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_openai_key = std::env::var_os("OPENAI_API_KEY");
        unsafe { std::env::remove_var("OPENAI_API_KEY") };

        let mut config = complete_model_config();
        config.model.reasoning_effort = Some(ReasoningEffort::High);

        let inherited = effective_model_settings(&ModelOptions::default(), &config).unwrap();
        assert_eq!(inherited.api_key_env, None);
        assert_eq!(inherited.reasoning_effort, Some(ReasoningEffort::High));

        let valued = effective_model_settings(
            &ModelOptions {
                api_key_env: OptionalModelOption::Value("CLI_API_KEY".to_string()),
                reasoning_effort: OptionalModelOption::Value(ReasoningEffort::None),
                ..ModelOptions::default()
            },
            &config,
        )
        .unwrap();
        assert_eq!(valued.api_key_env.as_deref(), Some("CLI_API_KEY"));
        assert_eq!(valued.reasoning_effort, Some(ReasoningEffort::None));

        let cleared = effective_model_settings(
            &ModelOptions {
                api_key_env: OptionalModelOption::Clear,
                reasoning_effort: OptionalModelOption::Clear,
                ..ModelOptions::default()
            },
            &config,
        )
        .unwrap();
        assert_eq!(cleared.api_key_env, None);
        assert_eq!(cleared.reasoning_effort, None);

        // With the conventional variable set, Inherit and Clear both fall
        // through to auto-selection; an explicit Value always wins.
        unsafe { std::env::set_var("OPENAI_API_KEY", "env-key") };
        let auto_selected = effective_model_settings(&ModelOptions::default(), &config).unwrap();
        assert_eq!(auto_selected.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        let cleared = effective_model_settings(
            &ModelOptions {
                api_key_env: OptionalModelOption::Clear,
                ..ModelOptions::default()
            },
            &config,
        )
        .unwrap();
        assert_eq!(cleared.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        let valued = effective_model_settings(
            &ModelOptions {
                api_key_env: OptionalModelOption::Value("CLI_API_KEY".to_string()),
                ..ModelOptions::default()
            },
            &config,
        )
        .unwrap();
        assert_eq!(valued.api_key_env.as_deref(), Some("CLI_API_KEY"));

        restore_env("OPENAI_API_KEY", original_openai_key);
    }

    #[test]
    fn api_key_selectors_are_preserved_for_api_backends_and_normalized_for_managed_auth() {
        for selector in ["", "   ", " SURROUNDED_KEY "] {
            let settings = effective_model_settings(
                &ModelOptions {
                    api_key_env: OptionalModelOption::Value(selector.to_string()),
                    ..ModelOptions::default()
                },
                &complete_model_config(),
            )
            .unwrap();
            assert_eq!(settings.api_key_env.as_deref(), Some(selector));
            let error = ModelClient::from_effective_settings(settings)
                .expect_err("invalid configured selector must not be normalized or ignored");
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("api_key_env"), "{error:#}");
        }

        // A managed backend never auto-selects and rejects any explicit
        // selector at validation.
        let settings = effective_model_settings(
            &ModelOptions {
                backend: Some(BackendKind::ArceeAuth),
                api_model: Some("trinity-large-thinking".to_string()),
                ..ModelOptions::default()
            },
            &NacConfig::default(),
        )
        .unwrap();
        assert_eq!(settings.api_key_env, None);
    }

    #[test]
    fn required_model_settings_are_rejected_without_defaults() {
        // No configured or requested model: no id to resolve a backend
        // from. An unknown configured model id fails the same way.
        for config in [NacConfig::default(), {
            let mut config = NacConfig::default();
            config.model.model = Some("never-seen-model".to_string());
            config
        }] {
            let error = effective_model_settings(&ModelOptions::default(), &config).unwrap_err();
            assert!(error.to_string().contains("backend"), "{error:#}");
        }

        // An explicit backend with no model id anywhere fails on the model.
        let error = effective_model_settings(
            &ModelOptions {
                backend: Some(BackendKind::OpenAiResponses),
                ..ModelOptions::default()
            },
            &NacConfig::default(),
        )
        .unwrap_err();
        assert!(error.to_string().contains("model"), "{error:#}");
    }

    #[test]
    fn no_reasoning_effort_is_injected() {
        let settings =
            effective_model_settings(&ModelOptions::default(), &complete_model_config()).unwrap();
        assert_eq!(settings.reasoning_effort, None);
    }

    #[test]
    fn managed_worker_settings_are_snapshot_authoritative() {
        let settings = managed_worker_effective_model_settings(&ModelOptions {
            backend: Some(BackendKind::TogetherChat),
            api_base_url: Some("https://worker.example/v1".to_string()),
            api_model: Some("worker-model".to_string()),
            api_key_env: OptionalModelOption::Value("SESSION_API_KEY".to_string()),
            extra_headers: Some(BTreeMap::new()),
            ..ModelOptions::default()
        })
        .unwrap();
        assert_eq!(settings.reasoning_effort, None);
        assert_eq!(settings.api_key_env.as_deref(), Some("SESSION_API_KEY"));
        assert!(settings.extra_headers.is_empty());

        for (backend, expected) in [
            (
                BackendKind::ChatGptCodexResponses,
                crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            ),
            (
                BackendKind::ArceeAuth,
                crate::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            ),
        ] {
            let managed = managed_worker_effective_model_settings(&ModelOptions {
                backend: Some(backend),
                api_model: Some("managed-worker-model".to_string()),
                extra_headers: Some(BTreeMap::new()),
                ..ModelOptions::default()
            })
            .expect("managed worker resolver should use the same fixed URL invariant");
            assert_eq!(managed.base_url, expected);
        }

        let raw_selector = " WORKER_KEY ";
        let invalid = managed_worker_effective_model_settings(&ModelOptions {
            backend: Some(BackendKind::TogetherChat),
            api_base_url: Some("https://worker.example/v1".to_string()),
            api_model: Some("worker-model".to_string()),
            api_key_env: OptionalModelOption::Value(raw_selector.to_string()),
            extra_headers: Some(BTreeMap::new()),
            ..ModelOptions::default()
        })
        .unwrap();
        assert_eq!(invalid.api_key_env.as_deref(), Some(raw_selector));
        let error = ModelClient::from_effective_settings(invalid)
            .expect_err("worker selector must be validated without normalization");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());

        let error = managed_worker_effective_model_settings(&ModelOptions {
            backend: Some(BackendKind::TogetherChat),
            ..ModelOptions::default()
        })
        .unwrap_err();
        assert!(error.to_string().contains("model"));
    }

    #[tokio::test]
    async fn resume_picker_defers_snapshot_and_credential_validation_until_selection() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let key_name = "NAC_MISSING_PICKER_SELECTION_KEY";
        let original = std::env::var_os(key_name);
        unsafe { std::env::remove_var(key_name) };

        let root = temp_store_path("credential_free_picker")
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("sessions.db");
        store::initialize(&store_path).unwrap();
        sessions::create_session(
            &store_path,
            &sessions::new_snapshot(
                "picker-session".to_string(),
                root.clone(),
                "snapshot-model".to_string(),
                "https://snapshot.example/v1".to_string(),
                BackendKind::TogetherChat,
                None,
                None,
                None,
                Vec::new(),
                Some(key_name.to_string()),
                BTreeMap::new(),
            ),
        )
        .unwrap();

        let picker = build_resume_picker_config(
            ResumeOptions {
                lookup_cwd: root.clone(),
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                ..ResumeOptions::default()
            },
            &NacConfig::default(),
        )
        .await
        .expect("picker startup must not resolve model settings or credentials");
        assert_eq!(picker.store_path, store_path);
        assert_eq!(
            sessions::list_sessions(&picker.store_path).unwrap().len(),
            1
        );

        let error = match build_resume_config_for_session(
            picker.store_path,
            "picker-session",
            &NacConfig::default(),
            picker.lookup_cwd,
            None,
        )
        .await
        {
            Ok(_) => panic!("selecting a session with a missing credential must fail"),
            Err(error) => error,
        };
        assert!(error.to_string().contains(key_name), "{error:#}");

        match original {
            Some(value) => unsafe { std::env::set_var(key_name, value) },
            None => unsafe { std::env::remove_var(key_name) },
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn resume_picker_and_selection_perform_no_network() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let server = crate::model::test_http::ScriptedServer::start_unexpected_request_server(
            std::time::Duration::from_millis(300),
        );
        let original_url = std::env::var_os("MODELS_DEV_URL");
        unsafe { std::env::set_var("MODELS_DEV_URL", &server.base_url) };
        let key_name = "NAC_MISSING_NETWORK_FREE_PICKER_KEY";
        let original_key = std::env::var_os(key_name);
        unsafe { std::env::remove_var(key_name) };

        let root = temp_store_path("network_free_picker")
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("sessions.db");
        store::initialize(&store_path).unwrap();
        sessions::create_session(
            &store_path,
            &sessions::new_snapshot(
                "network-free-session".to_string(),
                root.clone(),
                "snapshot-model".to_string(),
                "https://snapshot.example/v1".to_string(),
                BackendKind::TogetherChat,
                None,
                None,
                None,
                Vec::new(),
                Some(key_name.to_string()),
                BTreeMap::new(),
            ),
        )
        .unwrap();

        let picker = build_resume_picker_config(
            ResumeOptions {
                lookup_cwd: root.clone(),
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                ..ResumeOptions::default()
            },
            &NacConfig::default(),
        )
        .await
        .expect("picker startup must not touch the network");
        // The selection path resolves model settings and catalog metadata
        // locally (it fails on the missing credential, never on network).
        let error = match build_resume_config_for_session(
            picker.store_path,
            "network-free-session",
            &NacConfig::default(),
            picker.lookup_cwd,
            None,
        )
        .await
        {
            Ok(_) => panic!("selection without a credential must fail locally"),
            Err(error) => error,
        };
        assert!(error.to_string().contains(key_name), "{error:#}");

        match original_url {
            Some(value) => unsafe { std::env::set_var("MODELS_DEV_URL", value) },
            None => unsafe { std::env::remove_var("MODELS_DEV_URL") },
        }
        match original_key {
            Some(value) => unsafe { std::env::set_var(key_name, value) },
            None => unsafe { std::env::remove_var(key_name) },
        }
        let _ = std::fs::remove_dir_all(root);
        let requests = server.finish();
        assert!(
            requests.is_empty(),
            "resume/picker paths must not touch the network: {requests:?}"
        );
    }

    #[test]
    fn parse_extra_headers_json_requires_valid_object() {
        assert!(parse_extra_headers_json("").is_err());
        assert_eq!(parse_extra_headers_json("{}").unwrap(), BTreeMap::new());
        let headers = BTreeMap::from([("X-Custom".to_string(), "val".to_string())]);
        assert_eq!(
            parse_extra_headers_json(r#"{"X-Custom":"val"}"#).unwrap(),
            headers
        );
        assert!(parse_extra_headers_json("not json").is_err());
        assert!(parse_extra_headers_json(r#"{"X-Custom":1}"#).is_err());
    }

    #[tokio::test]
    async fn required_model_failures_occur_before_session_persistence() {
        let root = temp_store_path("required_model_before_persist")
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::create_dir_all(&root).unwrap();
        let cases: [(ModelOptions, NacConfig, &str); 3] = [
            (ModelOptions::default(), NacConfig::default(), "backend"),
            (
                ModelOptions::default(),
                {
                    let mut config = NacConfig::default();
                    config.model.model = Some("never-seen-model".to_string());
                    config
                },
                "backend",
            ),
            (
                ModelOptions {
                    backend: Some(BackendKind::OpenAiResponses),
                    ..ModelOptions::default()
                },
                NacConfig::default(),
                "model",
            ),
        ];

        for (index, (model, config, expected)) in cases.into_iter().enumerate() {
            let store_path = root.join(format!("store-{index}.db"));
            let error = match build_run_config(
                RunOptions {
                    workspace_cwd: root.clone(),
                    store: StoreOptions {
                        store_path: Some(store_path.clone()),
                    },
                    model,
                    ..RunOptions::default()
                },
                &config,
            )
            .await
            {
                Ok(_) => panic!("missing {expected} must fail"),
                Err(error) => error,
            };
            assert!(error.to_string().contains(expected), "{error:#}");
            assert!(
                !store_path.exists(),
                "invalid settings created the session store"
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sandbox_image_config_is_default_not_enablement() {
        let mut config = NacConfig::default();
        config.sandbox.image = Some("custom-image".to_string());

        let disabled = effective_sandbox_options(SandboxOptions::default(), &config);
        assert!(!disabled.sandbox_enabled());
        assert!(!disabled.explicit_sandbox_config_flags_present());
        assert_eq!(disabled.sandbox_image(), Some("custom-image"));

        let enabled = effective_sandbox_options(
            SandboxOptions {
                sandbox: true,
                ..SandboxOptions::default()
            },
            &config,
        );
        assert!(enabled.sandbox_enabled());
        assert_eq!(enabled.sandbox_image(), Some("custom-image"));

        let overridden = effective_sandbox_options(
            SandboxOptions {
                sandbox: true,
                sandbox_image: Some("cli-image".to_string()),
                ..SandboxOptions::default()
            },
            &config,
        );
        assert_eq!(overridden.sandbox_image(), Some("cli-image"));
        assert!(overridden.explicit_sandbox_config_flags_present());
    }

    #[test]
    fn worker_timeout_reads_config_default() {
        let mut config = NacConfig::default();
        config.worker.thread_timeout_secs = Some(7_200);
        assert_eq!(worker_thread_timeout_secs(&config), 7_200);

        config.worker.thread_timeout_secs = Some(10);
        assert_eq!(
            worker_thread_timeout_secs(&config),
            crate::tools::thread::MIN_THREAD_TIMEOUT_SECS
        );
    }

    #[test]
    fn worker_command_output_limits_validate_config() {
        let mut config = NacConfig::default();
        let defaults = worker_command_output_limits(&config).unwrap();
        assert_eq!(
            defaults.per_command_bytes,
            crate::terminal::DEFAULT_COMMAND_OUTPUT_MAX_BYTES
        );
        assert_eq!(
            defaults.per_session_bytes,
            crate::terminal::DEFAULT_COMMAND_OUTPUT_SESSION_MAX_BYTES
        );

        config.worker.command_output_max_bytes = Some(1_024);
        config.worker.command_output_session_max_bytes = Some(4_096);
        assert_eq!(
            worker_command_output_limits(&config).unwrap(),
            crate::terminal::CommandOutputLimits {
                per_command_bytes: 1_024,
                per_session_bytes: 4_096,
            }
        );

        config.worker.command_output_session_max_bytes = Some(512);
        assert!(worker_command_output_limits(&config).is_err());
    }

    #[test]
    fn nac_config_loads_new_sections_alongside_existing_mcp() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = std::env::temp_dir().join(format!(
            "nac_config_load_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("config.toml"),
            r#"
[storage]
store_path = "custom/store.db"

[model]
model = "config-model"
reasoning_effort = "high"

[sandbox]
image = "config-image"

[worker]
thread_timeout_secs = 7200
command_output_max_bytes = 8388608
command_output_session_max_bytes = 67108864

[mcp_servers.context7]
enabled = true
transport = "streamable_http"
url = "https://mcp.context7.com/mcp"
"#,
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &root);
        }

        let config = NacConfig::load().unwrap();
        assert_eq!(
            config.storage.store_path.as_deref(),
            Some(Path::new("custom/store.db"))
        );
        assert_eq!(config.model.model.as_deref(), Some("config-model"));
        assert_eq!(config.model.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(config.sandbox.image.as_deref(), Some("config-image"));
        assert_eq!(config.worker.thread_timeout_secs, Some(7_200));
        assert_eq!(config.worker.command_output_max_bytes, Some(8_388_608));
        assert_eq!(
            config.worker.command_output_session_max_bytes,
            Some(67_108_864)
        );

        restore_env("NAC_HOME", original_nac_home);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn non_model_config_load_ignores_invalid_model_values_but_keeps_other_sections_strict() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = std::env::temp_dir().join(format!(
            "nac_non_model_config_load_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &root);
        }

        // Removed `[model]` keys (backend/base_url/api_key_env) are
        // parse-tolerated by the new-session load too — they are ignored
        // with a one-time warning, so only genuinely invalid remaining
        // fields fail.
        let invalid_model_sections = [
            ("[model]\nbackend = \"auto\"\nmodel = \"legacy\"\n", true),
            (
                "[model]\nbackend = \"arcee\"\napi_key_env = [\"NOT_A_SELECTOR\"]\n",
                true,
            ),
            ("model = [\"not\", \"a\", \"table\"]\n", false),
            (
                "[model]\nextra_headers = \"not-a-header-map\"\nreasoning_effort = 7\n",
                false,
            ),
        ];
        for (invalid_model, accepted) in invalid_model_sections {
            std::fs::write(
                root.join("config.toml"),
                format!(
                    "{invalid_model}\n[storage]\nstore_path = \"persisted/store.db\"\n\n[sandbox]\nimage = \"runtime-image\"\n\n[worker]\nthread_timeout_secs = 7200\n"
                ),
            )
            .unwrap();

            let config = NacConfig::load_without_model_from_cwd(&root).unwrap();
            assert_eq!(
                config.storage.store_path.as_deref(),
                Some(Path::new("persisted/store.db"))
            );
            assert_eq!(config.sandbox.image.as_deref(), Some("runtime-image"));
            assert_eq!(config.worker.thread_timeout_secs, Some(7_200));
            assert!(config.model.model.is_none());
            assert_eq!(
                NacConfig::load_from_cwd(&root).is_ok(),
                accepted,
                "new-session config mishandled {invalid_model:?}"
            );
        }

        std::fs::write(
            root.join("config.toml"),
            "[model]\nbackend = \"auto\"\n\n[storage]\nstore_path = [\"invalid\"]\n",
        )
        .unwrap();
        let error = NacConfig::load_without_model_from_cwd(&root).unwrap_err();
        assert!(error.to_string().contains("non-model config"), "{error:#}");

        restore_env("NAC_HOME", original_nac_home);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn removed_model_config_keys_are_ignored_and_resolution_uses_the_catalog() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_openai_key = std::env::var_os("OPENAI_API_KEY");
        let root = std::env::temp_dir().join(format!(
            "nac_removed_model_keys_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        // A pre-slimming config: backend/base_url/api_key_env are ignored
        // (with a one-time warning); the kept fields load and the
        // configured model resolves through the catalog.
        std::fs::write(
            root.join("config.toml"),
            r#"
[model]
backend = "fireworks-chat"
model = "gpt-5.2"
base_url = "https://stale.example/v1"
api_key_env = "STALE_KEY"
reasoning_effort = "high"

[model.extra_headers]
X-Config = "yes"
"#,
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &root);
            std::env::set_var("OPENAI_API_KEY", "env-openai-key");
        }

        let config = NacConfig::load().expect("removed keys parse tolerantly");
        assert_eq!(config.model.model.as_deref(), Some("gpt-5.2"));
        assert_eq!(config.model.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(
            config
                .model
                .extra_headers
                .get("X-Config")
                .map(String::as_str),
            Some("yes")
        );

        // The stale backend/base_url/api_key_env values play no role:
        // gpt-5.2 resolves to openai-responses, the base URL comes from the
        // catalog default, and the credential auto-selects the conventional
        // variable.
        let settings = effective_model_settings(&ModelOptions::default(), &config).unwrap();
        assert_eq!(settings.backend, BackendKind::OpenAiResponses);
        assert_eq!(settings.base_url, "https://api.openai.com/v1");
        assert_eq!(settings.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(settings.reasoning_effort, Some(ReasoningEffort::High));

        restore_env("NAC_HOME", original_nac_home);
        restore_env("OPENAI_API_KEY", original_openai_key);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn nac_config_load_from_cwd_resolves_relative_nac_home_against_explicit_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = std::env::temp_dir().join(format!(
            "nac_config_relative_home_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        let nac_home = root.join("relative-nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        std::fs::write(
            nac_home.join("config.toml"),
            "[storage]\nstore_path = \"from-relative-home.db\"\n",
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", "relative-nac-home");
        }

        let config = NacConfig::load_from_cwd(&root).unwrap();
        assert_eq!(
            config.storage.store_path.as_deref(),
            Some(Path::new("from-relative-home.db"))
        );

        restore_env("NAC_HOME", original_nac_home);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_store_path_defaults_to_single_global_store_for_any_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let nac_home = std::env::temp_dir().join(format!(
            "nac_global_store_home_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let config = NacConfig::default();
        let from_repo_a =
            resolve_store_path(Path::new("/repo-a"), StoreOptions::default(), &config);
        let from_repo_b = resolve_store_path(
            Path::new("/repo-b/nested"),
            StoreOptions::default(),
            &config,
        );

        assert_eq!(from_repo_a, nac_home.join("store.db"));
        assert_eq!(
            from_repo_a, from_repo_b,
            "default store must be identical regardless of launch directory"
        );

        restore_env("NAC_HOME", original_nac_home);
        let _ = std::fs::remove_dir_all(nac_home);
    }

    #[test]
    fn resolve_store_path_falls_back_to_workspace_store_without_home() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_xdg_config_home = std::env::var_os("XDG_CONFIG_HOME");
        let original_home = std::env::var_os("HOME");
        unsafe {
            std::env::remove_var("NAC_HOME");
            std::env::remove_var("XDG_CONFIG_HOME");
            std::env::remove_var("HOME");
        }

        let resolved = resolve_store_path(
            Path::new("/repo"),
            StoreOptions::default(),
            &NacConfig::default(),
        );
        assert_eq!(resolved, Path::new("/repo/.nac/store.db"));

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg_config_home);
        restore_env("HOME", original_home);
    }

    #[test]
    fn resolve_store_path_overrides_beat_global_default_and_resolve_against_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let nac_home = std::env::temp_dir().join(format!(
            "nac_store_override_home_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }
        let cwd = Path::new("/workspace/repo");

        let mut config = NacConfig::default();
        config.storage.store_path = Some(PathBuf::from("custom/store.db"));
        assert_eq!(
            resolve_store_path(cwd, StoreOptions::default(), &config),
            Path::new("/workspace/repo/custom/store.db")
        );

        assert_eq!(
            resolve_store_path(
                cwd,
                StoreOptions {
                    store_path: Some(PathBuf::from("/elsewhere/store.db")),
                },
                &config,
            ),
            Path::new("/elsewhere/store.db")
        );

        assert_eq!(
            resolve_store_path(
                cwd,
                StoreOptions {
                    store_path: Some(PathBuf::from(".nac/store.db")),
                },
                &NacConfig::default(),
            ),
            Path::new("/workspace/repo/.nac/store.db")
        );

        restore_env("NAC_HOME", original_nac_home);
    }

    #[test]
    fn workspace_dir_from_explicit_mount_uses_workspace_guest_mapping() {
        let root = std::env::temp_dir().join(format!(
            "nac_main_test_workspace_mount_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join(".git")).unwrap();

        let mounts = vec![MountSpec {
            host: root.clone(),
            guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            read_only: false,
        }];

        let resolved = workspace_dir_from_mounts(&mounts, PathBuf::from(DEFAULT_SANDBOX_WORKDIR));
        assert_eq!(resolved.as_deref(), Some(root.as_path()));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn resume_and_delegated_worker_reject_arcee_api_key_env_early() {
        let root = temp_store_path("arcee_api_key_env_paths")
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::create_dir_all(&root).unwrap();
        let expected = "is not supported for backend 'arcee-auth'";

        let snapshot = sessions::new_snapshot(
            "invalid-arcee-resume".to_string(),
            root.clone(),
            "model".to_string(),
            "https://api.arcee.ai".to_string(),
            BackendKind::ArceeAuth,
            None,
            None,
            None,
            Vec::new(),
            Some("SESSION_ARCEE_KEY".to_string()),
            BTreeMap::new(),
        );
        let resume_store = root.join("resume.db");
        let resume_error = match build_resume_config_from_snapshot(
            snapshot,
            resume_store.clone(),
            &NacConfig::default(),
            root.clone(),
            None,
            None,
            true,
            None,
        )
        .await
        {
            Ok(_) => panic!("Arcee session resume must reject api_key_env"),
            Err(error) => error,
        };
        assert!(
            resume_error.to_string().contains(expected),
            "got: {resume_error:#}"
        );
        assert!(
            !resume_store.exists(),
            "invalid resume initialized its store"
        );

        let worker_store = root.join("worker.db");
        let worker_error = match build_managed_worker_config(
            ManagedWorkerOptions {
                workspace_cwd: root.clone(),
                config_cwd: None,
                dispatch: WorkerDispatchOptions {
                    session_id: "session".to_string(),
                    thread_name: "impl".to_string(),
                    dispatch_id: "test-dispatch".to_string(),
                    action: "work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(worker_store.clone()),
                },
                model: ModelOptions {
                    backend: Some(BackendKind::ArceeAuth),
                    api_base_url: Some("https://api.arcee.ai".to_string()),
                    api_model: Some("model".to_string()),
                    api_key_env: OptionalModelOption::Value("DELEGATED_ARCEE_KEY".to_string()),
                    ..ModelOptions::default()
                },
                sandbox: SandboxOptions::default(),
                ssh: SshOptions::default(),
            },
            &NacConfig::default(),
        )
        .await
        {
            Ok(_) => panic!("delegated Arcee worker must reject api_key_env"),
            Err(error) => error,
        };
        assert!(
            worker_error.to_string().contains(expected),
            "got: {worker_error:#}"
        );
        assert!(
            !worker_store.exists(),
            "invalid worker initialized its store"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn managed_worker_builds_user_messages_from_self_and_source_threads() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }

        let store_path = temp_store_path("managed_worker_messages");
        store::initialize(&store_path).unwrap();

        let session_id = "session-msg-order";
        store::append_episode(
            &store_path,
            session_id,
            "impl",
            "step-1",
            "impl retained episode",
        )
        .unwrap();
        store::append_episode(
            &store_path,
            session_id,
            "auth",
            "inspect",
            "auth latest episode",
        )
        .unwrap();
        store::append_episode(
            &store_path,
            session_id,
            "tests",
            "inspect",
            "tests latest episode",
        )
        .unwrap();

        let workspace_cwd = store_path.parent().unwrap().to_path_buf();
        let options = ManagedWorkerOptions {
            workspace_cwd,
            config_cwd: None,
            dispatch: WorkerDispatchOptions {
                session_id: session_id.to_string(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "implement the next step".to_string(),
                source_threads: vec!["auth".to_string(), "tests".to_string()],
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions::default(),
        };

        let run_config = build_managed_worker_config(options, &NacConfig::default())
            .await
            .unwrap();

        assert_eq!(run_config.action, "implement the next step");
        assert_eq!(run_config.agent.messages.len(), 4);

        match &run_config.agent.messages[1] {
            Message::User { content } => assert!(content.contains("impl retained episode")),
            other => panic!("expected self-history user message, got {:?}", other),
        }
        match &run_config.agent.messages[2] {
            Message::User { content } => {
                assert!(content.contains("auth latest episode"));
                assert!(content.contains("thread \"auth\""));
            }
            other => panic!("expected first source-thread user message, got {:?}", other),
        }
        match &run_config.agent.messages[3] {
            Message::User { content } => {
                assert!(content.contains("tests latest episode"));
                assert!(content.contains("thread \"tests\""));
            }
            other => panic!(
                "expected second source-thread user message, got {:?}",
                other
            ),
        }

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[test]
    fn sandbox_gpu_all_maps_to_nvidia_cdi_device() {
        assert_eq!(normalize_gpu_device("all"), "nvidia.com/gpu=all");
        assert_eq!(
            normalize_gpu_device("nvidia.com/gpu=mig1:0"),
            "nvidia.com/gpu=mig1:0"
        );
    }

    #[tokio::test]
    async fn resume_recovers_effort_and_only_persists_authoritative_changes() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let key_name = "NAC_RESUME_EFFORT_MIGRATION_KEY";
        let original_key = std::env::var_os(key_name);
        unsafe { std::env::set_var(key_name, "test-key") };

        let root = temp_store_path("resume_effort_migration")
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("store.db");
        store::initialize(&store_path).unwrap();

        for (session_id, model, stored_effort, effective_effort, stored_after, version) in [
            (
                "dated-family",
                "claude-sonnet-4-6-20251001",
                ReasoningEffort::Xhigh,
                Some(ReasoningEffort::High),
                Some(ReasoningEffort::High),
                1,
            ),
            (
                "supported",
                "claude-sonnet-4-6-20251001",
                ReasoningEffort::High,
                Some(ReasoningEffort::High),
                Some(ReasoningEffort::High),
                0,
            ),
            (
                "provider-default",
                "unknown-model",
                ReasoningEffort::Medium,
                Some(ReasoningEffort::None),
                Some(ReasoningEffort::Medium),
                0,
            ),
        ] {
            let active = create_and_resume_effort_snapshot(
                &store_path,
                &root,
                key_name,
                session_id,
                BackendKind::AnthropicMessages,
                model,
                stored_effort,
            )
            .await;
            assert_eq!(active.reasoning_effort, effective_effort);
            assert_eq!(active.config_version, version);
            let stored = sessions::load_session(&store_path, session_id).unwrap();
            assert_eq!(stored.reasoning_effort, stored_after);
            assert_eq!(stored.config_version, version);
        }

        let _ = std::fs::remove_dir_all(root);
        restore_env(key_name, original_key);
    }

    #[tokio::test]
    async fn resume_effort_migration_requires_operation_lease() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let key_name = "NAC_RESUME_EFFORT_LEASE_KEY";
        let original_key = std::env::var_os(key_name);
        unsafe { std::env::set_var(key_name, "test-key") };

        let root = temp_store_path("resume_effort_lease")
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("store.db");
        store::initialize(&store_path).unwrap();
        let snapshot = sessions::new_snapshot(
            "session".to_string(),
            root.clone(),
            "deepseek-ai/DeepSeek-V4-Pro".to_string(),
            "https://api.together.xyz/v1".to_string(),
            BackendKind::TogetherChat,
            Some(ReasoningEffort::Medium),
            None,
            None,
            Vec::new(),
            Some(key_name.to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();

        let lease = sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
        assert!(build_resume_config_for_session(
            store_path.clone(),
            "session",
            &NacConfig::default(),
            root.clone(),
            None,
        )
        .await
        .is_err());
        assert_eq!(
            sessions::load_session(&store_path, "session")
                .unwrap()
                .reasoning_effort,
            Some(ReasoningEffort::Medium)
        );

        let resumed = build_resume_config_for_session_with_lease(
            store_path.clone(),
            "session",
            &NacConfig::default(),
            root.clone(),
            None,
            &lease,
        )
        .await
        .unwrap();
        assert_eq!(
            resumed.client.reasoning_effort(),
            Some(ReasoningEffort::High)
        );
        let stored = sessions::load_session(&store_path, "session").unwrap();
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(stored.config_version, 1);

        drop(lease);
        let _ = std::fs::remove_dir_all(root);
        restore_env(key_name, original_key);
    }

    #[tokio::test]
    async fn persisted_settings_are_identical_across_create_snapshot_resume_and_worker_transport() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let key_name = "NAC_REASONING_LIFECYCLE_TEST_KEY";
        let original_key = std::env::var_os(key_name);
        unsafe { std::env::set_var(key_name, "test-key") };

        let root = temp_store_path("reasoning_lifecycle")
            .parent()
            .unwrap()
            .to_path_buf();
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let store_path = root.join("store.db");
        let headers = BTreeMap::from([("X-Snapshot".to_string(), "exact".to_string())]);
        let created = build_run_config(
            RunOptions {
                workspace_cwd: workspace.clone(),
                config_cwd: None,
                worker_executable: None,
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: ModelOptions {
                    backend: Some(BackendKind::OpenAiResponses),
                    reasoning_effort: OptionalModelOption::Value(ReasoningEffort::Xhigh),
                    api_base_url: Some("https://snapshot.example/v1".to_string()),
                    api_model: Some("snapshot-model".to_string()),
                    api_key_env: OptionalModelOption::Value(key_name.to_string()),
                    extra_headers: Some(headers.clone()),
                    light_model: None,
                },
                orchestrator_compaction_threshold: Some(48_000),
                sandbox: SandboxOptions::default(),
                ssh: SshOptions::default(),
            },
            &NacConfig::default(),
        )
        .await
        .unwrap();
        let session_id = created.session.session_id().unwrap().to_string();
        assert_eq!(
            created.client.reasoning_effort(),
            Some(ReasoningEffort::Xhigh)
        );

        let snapshot = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(snapshot.reasoning_effort, Some(ReasoningEffort::Xhigh));
        assert_eq!(snapshot.extra_headers, headers);
        assert_eq!(snapshot.orchestrator_compaction_threshold, Some(48_000));

        let mut conflicting_config = complete_model_config();
        conflicting_config.compaction.threshold_tokens = Some(96_000);
        conflicting_config.model.reasoning_effort = Some(ReasoningEffort::Low);
        conflicting_config.model.model = Some("must-not-win".to_string());
        let resumed = build_resume_config(
            ResumeOptions {
                lookup_cwd: workspace,
                worker_executable: None,
                session_id: Some(session_id),
                last: false,
                store: StoreOptions {
                    store_path: Some(store_path),
                },
            },
            &conflicting_config,
        )
        .await
        .unwrap();
        assert_eq!(resumed.client.model, "snapshot-model");
        assert_eq!(
            resumed.client.reasoning_effort(),
            Some(ReasoningEffort::Xhigh)
        );
        assert_eq!(resumed.client.extra_headers(), &headers);
        match &resumed.session {
            OrchestratorSession::Active { snapshot, .. } => assert_eq!(
                snapshot.orchestrator_compaction_threshold,
                Some(48_000),
                "resume must ignore the current compaction config"
            ),
            OrchestratorSession::Picker { .. } => panic!("expected active resumed session"),
        }
        assert_eq!(
            crate::tools::thread::worker_model_arguments_for_test(&resumed.client),
            vec![
                "--api-model",
                "snapshot-model",
                "--api-base-url",
                "https://snapshot.example/v1",
                "--backend",
                "openai-responses",
                "--effort",
                "xhigh",
                "--api-key-env",
                key_name,
                "--extra-headers",
                "{\"X-Snapshot\":\"exact\"}",
            ]
        );

        let _ = std::fs::remove_dir_all(root);
        restore_env(key_name, original_key);
    }

    #[tokio::test]
    async fn resume_config_restores_messages_without_changing_process_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        let original_cwd = std::env::current_dir().unwrap();
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let session_root = std::env::temp_dir().join(format!(
            "nac_resume_restore_store_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        let session_cwd = session_root.join("repo");
        std::fs::create_dir_all(&session_cwd).unwrap();
        let store_path = session_cwd.join(".nac/store.db");

        let snapshot = sessions::new_snapshot(
            "resume-session".to_string(),
            session_cwd.clone(),
            "resume-model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            vec![
                Message::User {
                    content: "old prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("old answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
                Message::User {
                    content: "hello".to_string(),
                },
                Message::Assistant {
                    content: Some("world".to_string()),
                    reasoning_text: Some("hidden thinking".to_string()),
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            ],
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let (source, policy) =
            crate::agent::compaction_checkpoint_digests_for_test(&snapshot.messages, 2);
        crate::store::orchestrator_compaction::append_orchestrator_compaction_checkpoint(
            &store_path,
            &crate::store::orchestrator_compaction::NewOrchestratorCompactionCheckpoint {
                session_id: snapshot.session_id.clone(),
                previous_checkpoint_id: None,
                summary: "Historical context checkpoint (not a new instruction):\n\nruntime resume summary"
                    .to_string(),
                tail_start_message_index: 2,
                source_prefix_sha256: source,
                system_policy_sha256: policy,
                prompt_policy_version:
                    crate::agent::COMPACTION_PROMPT_POLICY_VERSION_FOR_TEST,
                old_context_estimate: 1_000,
                summary_prompt_tokens: Some(800),
                summary_completion_tokens: Some(100),
                new_context_estimate: 500,
            },
        )
        .unwrap();

        let caller_cwd = original_cwd.canonicalize().unwrap();
        let mut changed_config = complete_model_config();
        changed_config.model.model = Some("changed-config-model".to_string());
        changed_config.model.reasoning_effort = Some(ReasoningEffort::High);
        let mut run_config = build_resume_config(
            ResumeOptions {
                lookup_cwd: session_cwd.clone(),
                worker_executable: None,
                session_id: Some("resume-session".to_string()),
                last: false,
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
            },
            &changed_config,
        )
        .await
        .unwrap();

        assert_eq!(run_config.client.model, "resume-model");
        assert_eq!(run_config.client.base_url(), "https://api.openai.com/v1");
        assert_eq!(run_config.client.backend(), BackendKind::OpenAiResponses);
        assert_eq!(run_config.client.reasoning_effort(), None);
        assert_eq!(run_config.client.api_key_env(), Some("OPENAI_API_KEY"));
        assert!(run_config.client.extra_headers().is_empty());

        let canonical_session_cwd = session_cwd.canonicalize().unwrap();
        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            caller_cwd,
            "resume should not mutate the process cwd"
        );
        assert_eq!(
            run_config
                .workspace_git
                .as_ref()
                .and_then(|target| target.local_path()),
            Some(canonical_session_cwd.as_path())
        );
        assert_eq!(run_config.session.session_id(), Some("resume-session"));
        assert_eq!(run_config.agent.messages.len(), 4);
        match &run_config.agent.messages[2] {
            Message::User { content } => assert_eq!(content, "hello"),
            other => panic!("expected restored user message, got {:?}", other),
        }
        match &run_config.agent.messages[3] {
            Message::Assistant {
                content: Some(content),
                reasoning_text: Some(reasoning),
                ..
            } => {
                assert_eq!(content, "world");
                assert_eq!(reasoning, "hidden thinking");
            }
            other => panic!("expected restored assistant message, got {:?}", other),
        }
        let projected = run_config.agent.provider_messages_for_test();
        let projected_json = serde_json::to_string(&projected).unwrap();
        assert!(projected_json.contains("runtime resume summary"));
        assert!(projected_json.contains("hello"));
        assert!(!projected_json.contains("old prompt"));
        assert!(!projected_json.contains("old answer"));
        assert!(serde_json::to_string(&run_config.agent.messages)
            .unwrap()
            .contains("old answer"));

        let _ = std::fs::remove_dir_all(session_root);
        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[test]
    fn normalize_snapshot_paths_uses_remote_cwd_verbatim_without_local_checks() {
        let missing_remote_cwd = PathBuf::from(format!(
            "/remote/workspace/missing-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        assert!(!missing_remote_cwd.exists());
        let snapshot = sessions::new_snapshot(
            "remote-session".to_string(),
            missing_remote_cwd.clone(),
            "model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some(SshConnection::new("build-box")),
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );

        let normalized =
            normalize_snapshot_paths(snapshot, Path::new("/local/resume/base")).unwrap();
        assert_eq!(
            normalized.cwd, missing_remote_cwd,
            "remote cwd must be used verbatim with no canonicalization"
        );

        let relative = sessions::new_snapshot(
            "remote-relative".to_string(),
            PathBuf::from("workspace/repo"),
            "model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some(SshConnection::new("build-box")),
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );
        let normalized =
            normalize_snapshot_paths(relative, Path::new("/local/resume/base")).unwrap();
        assert_eq!(normalized.cwd, PathBuf::from("workspace/repo"));
    }

    #[tokio::test]
    async fn resume_rejects_ssh_snapshot_with_sandbox_metadata_before_restore() {
        let snapshot = sessions::new_snapshot(
            "malformed-remote".to_string(),
            PathBuf::from("~/repo"),
            "model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            Some(SandboxSpec {
                backend: crate::sandbox::SandboxBackendType::Podman,
                image: DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: Vec::new(),
                workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                gpu_devices: Vec::new(),
                shm_size: None,
                cpus: 2,
                memory_mib: 2048,
            }),
            Some(SshConnection::new("build-box")),
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );

        let error = match build_resume_config_from_snapshot(
            snapshot,
            temp_store_path("malformed_remote_resume"),
            &NacConfig::default(),
            PathBuf::from("/local/resume/base"),
            None,
            None,
            true,
            None,
        )
        .await
        {
            Ok(_) => panic!("ssh snapshots with sandbox metadata must fail before podman restore"),
            Err(error) => error,
        };

        assert!(
            error.to_string().contains("ssh_host") && error.to_string().contains("sandbox"),
            "got: {error:#}"
        );
    }

    #[tokio::test]
    async fn invalid_legacy_snapshot_requires_settings_repair_without_persistence() {
        let store_path = temp_store_path("invalid_legacy_model_snapshot");
        let snapshot = sessions::new_snapshot(
            "legacy-invalid-model".to_string(),
            PathBuf::from("~/repo"),
            "   ".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some(SshConnection::new("build-box")),
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );

        let error = match build_resume_config_from_snapshot(
            snapshot,
            store_path.clone(),
            &complete_model_config(),
            PathBuf::from("/local/resume/base"),
            None,
            None,
            true,
            None,
        )
        .await
        {
            Ok(_) => panic!("invalid legacy model settings must not resume"),
            Err(error) => error,
        };
        assert!(
            error.to_string().contains("settings repair required"),
            "{error:#}"
        );
        assert!(error.to_string().contains("model"), "{error:#}");
        assert!(!store_path.exists());
    }

    #[test]
    fn normalize_snapshot_paths_still_canonicalizes_local_sessions() {
        let missing_local_cwd = std::env::temp_dir().join(format!(
            "nac_missing_local_cwd_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        let snapshot = sessions::new_snapshot(
            "local-session".to_string(),
            missing_local_cwd.clone(),
            "model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );

        let error = normalize_snapshot_paths(snapshot, Path::new("/")).unwrap_err();
        assert!(
            error.to_string().contains("failed to resolve session cwd"),
            "local sessions must keep failing on a missing cwd, got: {error:#}"
        );
    }

    #[tokio::test]
    async fn resume_remote_session_skips_local_path_checks_and_rebuilds_system_prompt() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let store_root = std::env::temp_dir().join(format!("nac_remote_resume_{}", unique));
        let store_path = store_root.join("store.db");
        let remote_cwd = PathBuf::from(format!("/remote/workspace/missing-{}", unique));
        assert!(!remote_cwd.exists());

        store::initialize(&store_path).unwrap();

        let snapshot = sessions::new_snapshot(
            "remote-session".to_string(),
            remote_cwd.clone(),
            "resume-model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some(SshConnection::new("build-box")),
            vec![
                Message::System {
                    content: "You are nac. Working directory: /old/stale/local/path.".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
                },
            ],
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();

        let run_config = build_resume_config(
            ResumeOptions {
                lookup_cwd: std::env::temp_dir(),
                worker_executable: None,
                session_id: Some("remote-session".to_string()),
                last: false,
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
            },
            &NacConfig::default(),
        )
        .await
        .expect("remote resume must not perform local path checks");

        assert_eq!(run_config.session.session_id(), Some("remote-session"));
        assert_eq!(
            run_config.workspace_display,
            remote_cwd.display().to_string()
        );
        assert_eq!(run_config.agent.messages.len(), 2);
        match &run_config.agent.messages[0] {
            Message::System { content } => {
                assert!(
                    content.contains(&format!("Working directory: {}", remote_cwd.display())),
                    "system prompt must be rebuilt from the resolved cwd, got: {content}"
                );
                assert!(
                    !content.contains("/old/stale/local/path"),
                    "stale pinned working directory must not be replayed"
                );
            }
            other => panic!("expected rebuilt system prompt, got {:?}", other),
        }
        match &run_config.agent.messages[1] {
            Message::User { content } => assert_eq!(content, "hello"),
            other => panic!("expected restored user message, got {:?}", other),
        }

        let _ = std::fs::remove_dir_all(&store_root);
        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[tokio::test]
    async fn create_remote_session_with_ssh_host_skips_local_checks_and_persists_target() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let store_root = std::env::temp_dir().join(format!("nac_remote_create_{}", unique));
        let store_path = store_root.join("store.db");
        let remote_cwd = PathBuf::from(format!("/remote/workspace/create-{}", unique));
        assert!(!remote_cwd.exists());

        store::initialize(&store_path).unwrap();

        let run_config = build_run_config(
            RunOptions {
                workspace_cwd: remote_cwd.clone(),
                config_cwd: None,
                worker_executable: None,
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: test_openai_model_options(),
                orchestrator_compaction_threshold: None,
                sandbox: SandboxOptions::default(),
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        .expect("remote session creation must not perform local path checks");

        assert_eq!(
            run_config.workspace_display,
            remote_cwd.display().to_string()
        );
        let workspace_git = run_config
            .workspace_git
            .as_ref()
            .expect("a remote session must still have a git target");
        assert_eq!(workspace_git.ssh_host(), Some("build-box"));
        assert_eq!(
            workspace_git.local_path(),
            None,
            "remote sessions must not expose a local path for git inspection"
        );
        assert_eq!(run_config.sandbox_status, "off");
        match &run_config.agent.messages[0] {
            Message::System { content } => assert!(
                content.contains(&format!("Working directory: {}", remote_cwd.display())),
                "system prompt must use the remote cwd, got: {content}"
            ),
            other => panic!("expected system prompt, got {:?}", other),
        }

        let session_id = run_config
            .session
            .session_id()
            .expect("remote creation must produce an active session")
            .to_string();
        let stored = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(
            stored.ssh.as_ref().map(|c| c.host.as_str()),
            Some("build-box")
        );
        assert_eq!(stored.cwd, remote_cwd);
        assert_eq!(stored.model, "test-model");
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.reasoning_effort, None);
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert!(stored.extra_headers.is_empty());
        assert!(stored.sandbox_spec.is_none());

        let _ = std::fs::remove_dir_all(&store_root);
        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[tokio::test]
    async fn ssh_fresh_run_resume_base_and_resume_control_socket_use_local_config_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
            std::env::remove_var("XDG_CONFIG_HOME");
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let local_root = std::env::temp_dir().join(format!("nac_remote_run_resume_{unique}"));
        let config_cwd = local_root.join("hub");
        let nac_home_rel = PathBuf::from(format!("relative-nac-home-{unique}"));
        let expected_nac_home = config_cwd.join(&nac_home_rel);
        let remote_cwd = PathBuf::from(format!("/remote/workspace/run-{unique}"));
        assert!(!remote_cwd.exists());
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home_rel);
        }

        let run_config = build_run_config(
            RunOptions {
                workspace_cwd: remote_cwd.clone(),
                config_cwd: Some(config_cwd.clone()),
                worker_executable: None,
                store: StoreOptions::default(),
                model: test_openai_model_options(),
                orchestrator_compaction_threshold: None,
                sandbox: SandboxOptions::default(),
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        .expect("fresh remote session should use local config cwd for nac state");

        assert_eq!(run_config.resume_base_cwd(), config_cwd.as_path());
        assert_eq!(
            run_config.session.store_path(),
            expected_nac_home.join("store.db")
        );
        let fresh_control_path = run_config
            .agent
            .ssh_control_path_for_test()
            .expect("fresh remote session should use ssh backend");
        assert!(
            fresh_control_path.starts_with(expected_nac_home.join("ssh")),
            "fresh control socket should be under local config cwd, got {}",
            fresh_control_path.display()
        );

        let session_id = run_config.session.session_id().unwrap().to_string();
        let store_path = run_config.session.store_path();
        let resume_base_cwd = run_config.resume_base_cwd().to_path_buf();
        let resumed = build_resume_config_for_session(
            store_path,
            &session_id,
            &NacConfig::default(),
            resume_base_cwd,
            None,
        )
        .await
        .expect("remote resume should keep using the local config cwd");

        assert_eq!(resumed.resume_base_cwd(), config_cwd.as_path());
        let resumed_control_path = resumed
            .agent
            .ssh_control_path_for_test()
            .expect("resumed remote session should use ssh backend");
        assert!(
            resumed_control_path.starts_with(expected_nac_home.join("ssh")),
            "resumed control socket should be under local config cwd, got {}",
            resumed_control_path.display()
        );
        assert!(
            !resumed_control_path.starts_with(remote_cwd.join(&nac_home_rel)),
            "remote cwd must not be used as the relative NAC_HOME base"
        );

        let _ = std::fs::remove_dir_all(&local_root);
        restore_env("OPENAI_API_KEY", original_api_key);
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
    }

    #[tokio::test]
    async fn invalid_ssh_sandbox_configs_do_not_initialize_store() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }

        let run_store_path = temp_store_path("invalid_ssh_sandbox_run");
        let run_store_root = run_store_path.parent().unwrap().to_path_buf();
        assert!(!run_store_root.exists());
        let run_error = match build_run_config(
            RunOptions {
                workspace_cwd: PathBuf::from("~"),
                config_cwd: Some(std::env::temp_dir()),
                worker_executable: None,
                store: StoreOptions {
                    store_path: Some(run_store_path.clone()),
                },
                model: test_openai_model_options(),
                orchestrator_compaction_threshold: None,
                sandbox: SandboxOptions {
                    sandbox: true,
                    ..SandboxOptions::default()
                },
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        {
            Ok(_) => panic!("ssh run with sandbox should fail before creating the store"),
            Err(error) => error,
        };
        assert!(
            run_error.to_string().contains("ssh_host") && run_error.to_string().contains("sandbox"),
            "got: {run_error:#}"
        );
        assert!(
            !run_store_root.exists(),
            "invalid run config created store dir {}",
            run_store_root.display()
        );

        let worker_store_path = temp_store_path("invalid_ssh_sandbox_worker");
        let worker_store_root = worker_store_path.parent().unwrap().to_path_buf();
        assert!(!worker_store_root.exists());
        let worker_error = match build_managed_worker_config(
            ManagedWorkerOptions {
                workspace_cwd: PathBuf::from("~"),
                config_cwd: Some(std::env::temp_dir()),
                dispatch: WorkerDispatchOptions {
                    session_id: "remote-session".to_string(),
                    thread_name: "impl".to_string(),
                    dispatch_id: "test-dispatch".to_string(),
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(worker_store_path.clone()),
                },
                model: test_openai_model_options(),
                sandbox: SandboxOptions {
                    sandbox: true,
                    ..SandboxOptions::default()
                },
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        {
            Ok(_) => panic!("ssh worker with sandbox should fail before creating the store"),
            Err(error) => error,
        };
        assert!(
            worker_error.to_string().contains("ssh_host")
                && worker_error.to_string().contains("sandbox"),
            "got: {worker_error:#}"
        );
        assert!(
            !worker_store_root.exists(),
            "invalid worker config created store dir {}",
            worker_store_root.display()
        );

        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[tokio::test]
    async fn create_remote_session_defaults_blank_cwd_to_home_and_rejects_sandbox_conflict() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let store_path = temp_store_path("remote_create_defaults");
        store::initialize(&store_path).unwrap();

        let options = |workspace_cwd: PathBuf, sandbox: SandboxOptions| RunOptions {
            workspace_cwd,
            config_cwd: None,
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            orchestrator_compaction_threshold: None,
            sandbox,
            ssh: SshOptions {
                host: Some("build-box".to_string()),
                ..SshOptions::default()
            },
        };

        let run_config = build_run_config(
            options(PathBuf::new(), SandboxOptions::default()),
            &NacConfig::default(),
        )
        .await
        .expect("blank remote cwd should default to home");
        assert_eq!(run_config.workspace_display, "~");
        let session_id = run_config.session.session_id().unwrap().to_string();
        let stored = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(stored.cwd, PathBuf::from("~"));
        assert_eq!(
            stored.ssh.as_ref().map(|c| c.host.as_str()),
            Some("build-box")
        );

        let conflicting = match build_run_config(
            options(
                PathBuf::from("~"),
                SandboxOptions {
                    sandbox: true,
                    ..SandboxOptions::default()
                },
            ),
            &NacConfig::default(),
        )
        .await
        {
            Ok(_) => panic!("ssh host + sandbox must be a hard configuration error"),
            Err(error) => error,
        };
        assert!(
            conflicting.to_string().contains("ssh_host")
                && conflicting.to_string().contains("sandbox"),
            "got: {conflicting:#}"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[tokio::test]
    async fn managed_worker_with_ssh_host_reattaches_to_remote_session() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let store_root = std::env::temp_dir().join(format!("nac_remote_worker_{}", unique));
        let store_path = store_root.join("store.db");
        let remote_cwd = PathBuf::from(format!("/remote/workspace/worker-{}", unique));
        assert!(!remote_cwd.exists());

        store::initialize(&store_path).unwrap();

        let run_config = build_managed_worker_config(
            ManagedWorkerOptions {
                workspace_cwd: remote_cwd.clone(),
                config_cwd: None,
                dispatch: WorkerDispatchOptions {
                    session_id: "remote-session".to_string(),
                    thread_name: "impl".to_string(),
                    dispatch_id: "test-dispatch".to_string(),
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: test_openai_model_options(),
                sandbox: SandboxOptions::default(),
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        .expect("remote workers must not perform local path checks");

        assert_eq!(run_config.session_id, "remote-session");
        match &run_config.agent.messages[0] {
            Message::System { content } => assert!(
                content.contains(&format!("Working directory: {}", remote_cwd.display())),
                "worker system prompt must use the remote cwd verbatim, got: {content}"
            ),
            other => panic!("expected system prompt, got {:?}", other),
        }

        let _ = std::fs::remove_dir_all(&store_root);
        restore_env("OPENAI_API_KEY", original_api_key);
    }

    #[tokio::test]
    async fn ssh_managed_worker_skips_stdio_mcp_without_spawning() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let nac_home = std::env::temp_dir().join(format!("nac_remote_worker_stdio_mcp_{unique}"));
        std::fs::create_dir_all(&nac_home).unwrap();
        let marker = nac_home.join("stdio-spawned");
        let shell = format!("printf spawned > {}", shell_single_quote(&marker));
        std::fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
                toml_string(&shell)
            ),
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let store_path = temp_store_path("remote_worker_stdio_mcp");
        store::initialize(&store_path).unwrap();
        let run_config = build_managed_worker_config(
            ManagedWorkerOptions {
                workspace_cwd: PathBuf::from("~"),
                config_cwd: None,
                dispatch: WorkerDispatchOptions {
                    session_id: "remote-session".to_string(),
                    thread_name: "impl".to_string(),
                    dispatch_id: "test-dispatch".to_string(),
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: test_openai_model_options(),
                sandbox: SandboxOptions::default(),
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        .expect("remote workers should skip stdio MCP instead of spawning it");

        assert!(run_config
            .agent
            .tool_definitions_for_test()
            .iter()
            .all(|def| !def.function.name.starts_with("mcp__")));
        assert!(
            !marker.exists(),
            "stdio MCP server was spawned despite SSH HTTP-only policy"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        let _ = std::fs::remove_dir_all(&nac_home);
        restore_env("OPENAI_API_KEY", original_api_key);
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
    }

    #[tokio::test]
    async fn ssh_managed_worker_resolves_relative_nac_home_against_local_config_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_api_key = std::env::var_os("OPENAI_API_KEY");
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
            std::env::remove_var("XDG_CONFIG_HOME");
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let local_root =
            std::env::temp_dir().join(format!("nac_remote_worker_relative_config_{unique}"));
        let config_cwd = local_root.join("hub");
        let nac_home_rel = PathBuf::from(format!("relative-nac-home-{unique}"));
        let nac_home = config_cwd.join(&nac_home_rel);
        std::fs::create_dir_all(&nac_home).unwrap();
        let marker = nac_home.join("stdio-spawned");
        let shell = format!("printf spawned > {}", shell_single_quote(&marker));
        let (http_url, http_server) = start_fake_http_mcp_server();
        std::fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.http]
transport = "streamable_http"
url = {}

[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
                toml_string(&http_url),
                toml_string(&shell)
            ),
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home_rel);
        }

        let store_path = temp_store_path("remote_worker_relative_config_mcp");
        store::initialize(&store_path).unwrap();
        let run_config = build_managed_worker_config(
            ManagedWorkerOptions {
                workspace_cwd: PathBuf::from("~"),
                config_cwd: Some(config_cwd.clone()),
                dispatch: WorkerDispatchOptions {
                    session_id: "remote-session".to_string(),
                    thread_name: "impl".to_string(),
                    dispatch_id: "test-dispatch".to_string(),
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: test_openai_model_options(),
                sandbox: SandboxOptions::default(),
                ssh: SshOptions {
                    host: Some("build-box".to_string()),
                    ..SshOptions::default()
                },
            },
            &NacConfig::default(),
        )
        .await
        .expect("remote workers should resolve MCP config from local config cwd");

        let tool_names: Vec<_> = run_config
            .agent
            .tool_definitions_for_test()
            .iter()
            .map(|def| def.function.name.as_str())
            .collect();
        assert!(
            tool_names.contains(&"mcp__http__echo"),
            "HTTP MCP config under relative NAC_HOME was not loaded: {tool_names:?}"
        );
        assert!(
            !marker.exists(),
            "stdio MCP server was spawned despite SSH HTTP-only policy"
        );

        drop(run_config);
        http_server.join().unwrap();
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        let _ = std::fs::remove_dir_all(&local_root);
        restore_env("OPENAI_API_KEY", original_api_key);
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
    }
}
