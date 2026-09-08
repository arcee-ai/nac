use super::*;

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
    #[serde(default)]
    pub permissions: PermissionConfig,
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

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct PermissionConfig {
    /// Ordered low-to-high-precedence rules appended after NAC's pragmatic
    /// backend defaults. Hard safety policy remains outside this list.
    #[serde(default)]
    pub rules: Vec<crate::permissions::PermissionRule>,
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
pub(super) struct NonModelNacConfig {
    #[serde(default)]
    storage: StorageConfig,
    #[serde(default)]
    sandbox: SandboxConfig,
    #[serde(default)]
    worker: WorkerConfig,
    #[serde(default)]
    security: SecurityConfig,
    #[serde(default)]
    permissions: PermissionConfig,
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
            permissions: config.permissions,
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
        let raw = Self::read_explicit_config(path)
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
        let raw = Self::read_explicit_config(path)
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
        crate::mcp::read_mcp_configuration_consistently(path)
            .map_err(anyhow::Error::new)
            .with_context(|| format!("failed to read config {}", path.display()))
    }

    fn read_explicit_config(path: &Path) -> Result<String> {
        std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config {}", path.display()))
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
