use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::EventSink;
use crate::mcp::{McpRegistry, McpRootPolicy, McpTransportPolicy};
use crate::model::{BackendKind, ClientOverrides, ModelClient, ReasoningEffort};
use crate::paths::PathContext;
use crate::sandbox::{
    build_sandbox_spec, parse_mount_spec, MountSpec, SandboxBackendType, SandboxSession,
    DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR,
};
use crate::sessions::{self, SessionSnapshot};
use crate::skills::{self, SkillRegistry};
use crate::store;
use crate::worker::{build_preloaded_skill_messages, build_worker_context_messages};
pub use crate::worker::{run_managed_worker, ManagedWorkerRunConfig};

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct NacConfig {
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub model: ModelConfig,
    #[serde(default)]
    pub sandbox: SandboxConfig,
    #[serde(default)]
    pub worker: WorkerConfig,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct StorageConfig {
    pub store_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ModelConfig {
    pub backend: Option<BackendKind>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub extra_headers: BTreeMap<String, String>,
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

    fn load_from_path(path: PathBuf) -> Result<Self> {
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("failed to read config {}", path.display()));
            }
        };
        toml::from_str(&raw).with_context(|| format!("failed to parse config {}", path.display()))
    }
}

#[derive(Debug, Clone, Default)]
pub struct StoreOptions {
    pub store_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct ModelOptions {
    pub backend: Option<BackendKind>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub api_base_url: Option<String>,
    pub api_model: Option<String>,
    pub api_key_env: Option<String>,
    pub extra_headers: Option<BTreeMap<String, String>>,
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
    pub sandbox: SandboxOptions,
    /// OpenSSH target for remote sessions; mutually exclusive with sandbox.
    pub ssh_host: Option<String>,
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
    /// OpenSSH target for remote workers; mutually exclusive with sandbox.
    pub ssh_host: Option<String>,
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
    pub(crate) workspace_host_path: Option<PathBuf>,
    pub(crate) resume_base_cwd: PathBuf,
}

impl OrchestratorRunConfig {
    pub fn resume_base_cwd(&self) -> &Path {
        &self.resume_base_cwd
    }
}

pub enum RunState {
    Orchestrator {
        run_config: OrchestratorRunConfig,
        start_in_session_picker: bool,
    },
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
    let sandbox_cpus = options
        .sandbox_cpus
        .or(config.sandbox.cpus)
        .unwrap_or(2);
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

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub(crate) fn configured_api_key_env(config: &NacConfig) -> Option<String> {
    config
        .model
        .api_key_env
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
}

pub(crate) fn model_overrides(model: &ModelOptions, config: &NacConfig) -> Result<ClientOverrides> {
    Ok(ClientOverrides {
        base_url: model
            .api_base_url
            .clone()
            .or_else(|| env_var("OPENAI_BASE_URL"))
            .or_else(|| config.model.base_url.clone()),
        model: model
            .api_model
            .clone()
            .or_else(|| env_var("OPENAI_MODEL"))
            .or_else(|| config.model.model.clone()),
        backend: model.backend.or(config.model.backend),
        reasoning_effort: model.reasoning_effort.or(config.model.reasoning_effort),
        api_key_env: model
            .api_key_env
            .clone()
            .or_else(|| configured_api_key_env(config)),
        extra_headers: model
            .extra_headers
            .clone()
            .unwrap_or_else(|| config.model.extra_headers.clone()),
    })
}

/// Parse a JSON object string into a `BTreeMap<String, String>`.
/// Returns `None` for empty or invalid input.
pub fn parse_extra_headers_json(json: &str) -> Option<BTreeMap<String, String>> {
    if json.is_empty() {
        return None;
    }
    serde_json::from_str::<BTreeMap<String, String>>(json).ok()
}

pub(crate) fn worker_thread_timeout_secs(config: &NacConfig) -> u64 {
    config
        .worker
        .thread_timeout_secs
        .unwrap_or(crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS)
        .max(crate::tools::thread::MIN_THREAD_TIMEOUT_SECS)
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
    let ssh_host = trim_ssh_host(options.ssh_host.clone());
    let config_cwd = options
        .config_cwd
        .clone()
        .unwrap_or_else(|| default_config_cwd(&options.workspace_cwd, ssh_host.as_deref()));
    let overrides = model_overrides(&options.model, config)?;
    let client = ModelClient::from_env_with_overrides(overrides.clone())?.with_cache_ttl(Some("1h"));
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
    validate_target_sandbox_options(ssh_host.as_deref(), &sandbox_options, "session")?;
    let store_base_cwd = if ssh_host.is_some() {
        &config_cwd
    } else {
        &options.workspace_cwd
    };
    let store_path = resolve_store_path(store_base_cwd, options.store, config);
    store::initialize(&store_path)?;

    if let Some(ssh_host) = ssh_host {
        let remote_cwd = remote_cwd_or_home(options.workspace_cwd.clone());
        let working_directory = directory_display(&remote_cwd);
        let session_id = Uuid::new_v4().to_string();
        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path: store_path.clone(),
                session_id: Some(session_id.clone()),
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                workspace_cwd: remote_cwd.clone(),
                config_cwd: config_cwd.clone(),
                working_directory: working_directory.clone(),
                worker_executable: options.worker_executable,
                sandbox: None,
                ssh_host: Some(ssh_host.clone()),
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: worker_thread_timeout_secs(config),
            },
        )?;
        let session_snapshot = sessions::new_snapshot(
            session_id.clone(),
            remote_cwd,
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            Some(ssh_host),
            agent.messages.clone(),
            overrides.api_key_env.clone(),
            overrides.extra_headers.clone(),
        );
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
            workspace_host_path: None,
            resume_base_cwd: config_cwd,
        });
    }

    let workspace_cwd = options.workspace_cwd;
    let paths = PathContext::new(&workspace_cwd);
    let sandbox = build_sandbox_session(&sandbox_options, &workspace_cwd).await?;
    let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
    let skills = SkillRegistry::load(workspace_dir.as_deref(), sandbox.as_ref(), &paths)?;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let workspace_host_path = if let Some(session) = sandbox.as_ref() {
        session.host_workdir()
    } else {
        Some(workspace_cwd.clone())
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
            mode: AgentMode::Orchestrator,
            store_path: store_path.clone(),
            session_id: Some(session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            workspace_cwd: workspace_cwd.clone(),
            config_cwd: config_cwd.clone(),
            working_directory: working_directory.clone(),
            worker_executable: options.worker_executable,
            sandbox: sandbox.clone(),
            ssh_host: None,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    )?;
    let session_snapshot = sessions::new_snapshot(
        session_id.clone(),
        workspace_cwd.clone(),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        sandbox.as_ref().map(|session| session.spec().clone()),
        None, // fresh local/sandbox sessions carry no ssh_host
        agent.messages.clone(),
        overrides.api_key_env.clone(),
        overrides.extra_headers.clone(),
    );
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
        workspace_host_path,
        resume_base_cwd: workspace_cwd,
    })
}

pub async fn build_managed_worker_config(
    options: ManagedWorkerOptions,
    config: &NacConfig,
) -> Result<ManagedWorkerRunConfig> {
    let client = ModelClient::from_env_with_overrides(model_overrides(&options.model, config)?)?;
    let ssh_host = trim_ssh_host(options.ssh_host.clone());
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
        (None, mcp, None)
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &workspace_paths)?;
        let mcp = McpRegistry::load(&workspace_cwd, sandbox.as_ref(), &workspace_paths).await?;
        let skills =
            SkillRegistry::load(workspace_dir.as_deref(), sandbox.as_ref(), &workspace_paths)?;
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
            mode: AgentMode::Worker,
            store_path: store_path.clone(),
            session_id: Some(options.dispatch.session_id.clone()),
            initial_messages,
            thread_name: Some(options.dispatch.thread_name.clone()),
            event_sink: EventSink::stderr_prefixed(),
            workspace_cwd,
            config_cwd,
            working_directory,
            worker_executable: None,
            sandbox,
            ssh_host,
            mcp,
            skills: None,
            extra_tool_defs,
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
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
) -> Result<OrchestratorRunConfig> {
    let client =
        ModelClient::from_env_with_overrides(model_overrides(&ModelOptions::default(), config)?)?
            .with_cache_ttl(Some("1h"));
    let lookup_cwd = options.lookup_cwd;
    let paths = PathContext::new(&lookup_cwd);
    let agents_md = AgentsMdBundle::load(Some(&lookup_cwd), &paths)?;
    let skills = SkillRegistry::load(Some(&lookup_cwd), None, &paths)?;
    let working_directory = directory_display(&lookup_cwd);
    let workspace_host_path = Some(lookup_cwd.clone());
    let sandbox_status = "off".to_string();
    let agents_md_status = agents_md.status_text();
    let store_path = resolve_store_path(&lookup_cwd, options.store, config);
    store::initialize(&store_path)?;
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: store_path.clone(),
            session_id: None,
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            workspace_cwd: lookup_cwd.clone(),
            config_cwd: lookup_cwd.clone(),
            working_directory: working_directory.clone(),
            worker_executable: options.worker_executable,
            sandbox: None,
            ssh_host: None,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: agents_md.system_message(),
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    )?;

    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Picker { store_path },
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
        resume_base_cwd: lookup_cwd,
    })
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

    build_resume_config_from_snapshot(
        snapshot,
        resume_store_path,
        config,
        lookup_cwd,
        options.worker_executable,
    )
    .await
}

pub async fn build_resume_config_for_session(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<OrchestratorRunConfig> {
    let snapshot = sessions::load_session(&store_path, session_id)?;
    build_resume_config_from_snapshot(
        snapshot,
        store_path,
        config,
        resume_base_cwd,
        worker_executable,
    )
    .await
}

async fn build_resume_config_from_snapshot(
    snapshot: SessionSnapshot,
    store_path: PathBuf,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<OrchestratorRunConfig> {
    let snapshot = normalize_snapshot_paths(snapshot, &resume_base_cwd)?;
    let ssh_host = snapshot.ssh_host.clone();
    if ssh_host.is_some() && snapshot.sandbox_spec.is_some() {
        anyhow::bail!(
            "invalid session configuration: ssh_host and podman sandbox metadata cannot both be set"
        );
    }

    let workspace_cwd = snapshot.cwd.clone();
    let config_cwd = if ssh_host.is_some() {
        resume_base_cwd.clone()
    } else {
        workspace_cwd.clone()
    };
    let paths = PathContext::new(&workspace_cwd);
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: Some(snapshot.base_url.clone()),
        model: Some(snapshot.model.clone()),
        backend: Some(snapshot.backend),
        reasoning_effort: snapshot.reasoning_effort,
        api_key_env: snapshot.api_key_env.clone(),
        extra_headers: snapshot.extra_headers.clone(),
    })?
    .with_cache_ttl(Some("1h"));
    let sandbox = if ssh_host.is_some() {
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

    let (skills, agents_md_status) = if ssh_host.is_some() {
        (None, "off".to_string())
    } else {
        let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
        let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
        let skills = SkillRegistry::load(workspace_dir.as_deref(), sandbox.as_ref(), &paths)?;
        (skills, agents_md.status_text())
    };
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let workspace_host_path = if ssh_host.is_some() {
        None
    } else if let Some(session) = sandbox.as_ref() {
        session.host_workdir()
    } else {
        Some(workspace_cwd.clone())
    };
    let sandbox_status = sandbox
        .as_ref()
        .map(|session| session.status_text())
        .unwrap_or_else(|| "off".to_string());

    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: store_path.clone(),
            session_id: Some(snapshot.session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            workspace_cwd,
            config_cwd,
            working_directory: working_directory.clone(),
            worker_executable,
            sandbox,
            ssh_host,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    )?;
    agent.restore_messages(snapshot.messages.clone());

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
        workspace_host_path,
        resume_base_cwd,
    })
}

fn normalize_snapshot_paths(
    mut snapshot: SessionSnapshot,
    resume_base_cwd: &Path,
) -> Result<SessionSnapshot> {
    // Remote cwd values are not local paths.
    if snapshot.ssh_host.is_some() {
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

    #[test]
    fn model_overrides_prefer_cli_then_env_then_config() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_base_url = std::env::var_os("OPENAI_BASE_URL");
        let original_model = std::env::var_os("OPENAI_MODEL");
        unsafe {
            std::env::set_var("OPENAI_BASE_URL", "https://env.example/v1");
            std::env::set_var("OPENAI_MODEL", "env-model");
        }

        let mut config = NacConfig::default();
        config.model.base_url = Some("https://config.example/v1".to_string());
        config.model.model = Some("config-model".to_string());
        config.model.backend = Some(BackendKind::OpenAiResponses);
        config.model.reasoning_effort = Some(ReasoningEffort::High);
        config.model.api_key_env = Some("NAC_TEST_API_KEY".to_string());

        let env_overrides = model_overrides(&ModelOptions::default(), &config).unwrap();
        assert_eq!(
            env_overrides.base_url.as_deref(),
            Some("https://env.example/v1")
        );
        assert_eq!(env_overrides.model.as_deref(), Some("env-model"));
        assert_eq!(env_overrides.backend, Some(BackendKind::OpenAiResponses));
        assert_eq!(env_overrides.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(
            env_overrides.api_key_env.as_deref(),
            Some("NAC_TEST_API_KEY")
        );

        let cli_overrides = model_overrides(
            &ModelOptions {
                backend: Some(BackendKind::DeepSeekChat),
                reasoning_effort: Some(ReasoningEffort::Low),
                api_base_url: Some("https://cli.example/v1".to_string()),
                api_model: Some("cli-model".to_string()),
                api_key_env: None,
                extra_headers: None,
            },
            &config,
        )
        .unwrap();
        assert_eq!(
            cli_overrides.base_url.as_deref(),
            Some("https://cli.example/v1")
        );
        assert_eq!(cli_overrides.model.as_deref(), Some("cli-model"));
        assert_eq!(cli_overrides.backend, Some(BackendKind::DeepSeekChat));
        assert_eq!(cli_overrides.reasoning_effort, Some(ReasoningEffort::Low));

        // CLI-provided api_key_env and extra_headers should override config values.
        let mut cli_extra = std::collections::BTreeMap::new();
        cli_extra.insert("X-Custom".to_string(), "cli-value".to_string());
        let cli_full_overrides = model_overrides(
            &ModelOptions {
                backend: Some(BackendKind::DeepSeekChat),
                reasoning_effort: Some(ReasoningEffort::Low),
                api_base_url: Some("https://cli.example/v1".to_string()),
                api_model: Some("cli-model".to_string()),
                api_key_env: Some("CLI_KEY_ENV".to_string()),
                extra_headers: Some(cli_extra.clone()),
            },
            &config,
        )
        .unwrap();
        assert_eq!(
            cli_full_overrides.api_key_env.as_deref(),
            Some("CLI_KEY_ENV")
        );
        assert_eq!(cli_full_overrides.extra_headers, cli_extra);

        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
    }

    #[test]
    fn parse_extra_headers_json_handles_empty_object() {
        // Empty string → None (no override)
        assert_eq!(parse_extra_headers_json(""), None);
        // "{}" → Some(empty map) so the worker uses empty headers, not config fallback
        assert_eq!(parse_extra_headers_json("{}"), Some(BTreeMap::new()));
        // Valid headers → Some(map)
        let mut headers = BTreeMap::new();
        headers.insert("X-Custom".to_string(), "val".to_string());
        assert_eq!(
            parse_extra_headers_json(r#"{"X-Custom":"val"}"#),
            Some(headers)
        );
        // Invalid JSON → None
        assert_eq!(parse_extra_headers_json("not json"), None);
    }

    #[test]
    fn model_overrides_empty_extra_headers_does_not_leak_config() {
        // When the CLI passes Some(empty map), config's extra_headers must NOT leak.
        let mut config = NacConfig::default();
        config
            .model
            .extra_headers
            .insert("X-Config-Leak".to_string(), "should-not-appear".to_string());

        let overrides = model_overrides(
            &ModelOptions {
                backend: None,
                reasoning_effort: None,
                api_base_url: None,
                api_model: None,
                api_key_env: None,
                extra_headers: Some(BTreeMap::new()),
            },
            &config,
        )
        .unwrap();
        assert!(overrides.extra_headers.is_empty());
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
backend = "openai-responses"
model = "config-model"
base_url = "https://config.example/v1"
reasoning_effort = "high"
api_key_env = "NAC_TEST_API_KEY"

[sandbox]
image = "config-image"

[worker]
thread_timeout_secs = 7200

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
        assert_eq!(config.model.backend, Some(BackendKind::OpenAiResponses));
        assert_eq!(config.model.model.as_deref(), Some("config-model"));
        assert_eq!(
            config.model.base_url.as_deref(),
            Some("https://config.example/v1")
        );
        assert_eq!(config.model.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(
            config.model.api_key_env.as_deref(),
            Some("NAC_TEST_API_KEY")
        );
        assert_eq!(config.sandbox.image.as_deref(), Some("config-image"));
        assert_eq!(config.worker.thread_timeout_secs, Some(7_200));

        restore_env("NAC_HOME", original_nac_home);
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
                action: "implement the next step".to_string(),
                source_threads: vec!["auth".to_string(), "tests".to_string()],
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: ModelOptions::default(),
            sandbox: SandboxOptions::default(),
            ssh_host: None,
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
            Some(ReasoningEffort::Xhigh),
            None,
            None,
            vec![
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
                },
                Message::Assistant {
                    content: Some("world".to_string()),
                    reasoning_text: Some("hidden thinking".to_string()),
                    reasoning_details: None,
                    tool_calls: None,
                },
            ],
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();

        let caller_cwd = original_cwd.canonicalize().unwrap();
        let run_config = build_resume_config(
            ResumeOptions {
                lookup_cwd: session_cwd.clone(),
                worker_executable: None,
                session_id: Some("resume-session".to_string()),
                last: false,
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
            },
            &NacConfig::default(),
        )
        .await
        .unwrap();

        let canonical_session_cwd = session_cwd.canonicalize().unwrap();
        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            caller_cwd,
            "resume should not mutate the process cwd"
        );
        assert_eq!(
            run_config.workspace_host_path.as_deref(),
            Some(canonical_session_cwd.as_path())
        );
        assert_eq!(run_config.session.session_id(), Some("resume-session"));
        assert_eq!(run_config.agent.messages.len(), 3);
        match &run_config.agent.messages[1] {
            Message::User { content } => assert_eq!(content, "hello"),
            other => panic!("expected restored user message, got {:?}", other),
        }
        match &run_config.agent.messages[2] {
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
            Some("build-box".to_string()),
            Vec::new(),
        None,
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
            Some("build-box".to_string()),
            Vec::new(),
        None,
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
            Some("build-box".to_string()),
            Vec::new(),
        None,
        BTreeMap::new(),
        );

        let error = match build_resume_config_from_snapshot(
            snapshot,
            temp_store_path("malformed_remote_resume"),
            &NacConfig::default(),
            PathBuf::from("/local/resume/base"),
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
        None,
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
            Some("build-box".to_string()),
            vec![
                Message::System {
                    content: "You are nac. Working directory: /old/stale/local/path.".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
                },
            ],
        None,
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
                model: ModelOptions::default(),
                sandbox: SandboxOptions::default(),
                ssh_host: Some("build-box".to_string()),
            },
            &NacConfig::default(),
        )
        .await
        .expect("remote session creation must not perform local path checks");

        assert_eq!(
            run_config.workspace_display,
            remote_cwd.display().to_string()
        );
        assert_eq!(
            run_config.workspace_host_path, None,
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
        assert_eq!(stored.ssh_host.as_deref(), Some("build-box"));
        assert_eq!(stored.cwd, remote_cwd);
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
                model: ModelOptions::default(),
                sandbox: SandboxOptions::default(),
                ssh_host: Some("build-box".to_string()),
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
                model: ModelOptions::default(),
                sandbox: SandboxOptions {
                    sandbox: true,
                    ..SandboxOptions::default()
                },
                ssh_host: Some("build-box".to_string()),
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
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(worker_store_path.clone()),
                },
                model: ModelOptions::default(),
                sandbox: SandboxOptions {
                    sandbox: true,
                    ..SandboxOptions::default()
                },
                ssh_host: Some("build-box".to_string()),
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
            model: ModelOptions::default(),
            sandbox,
            ssh_host: Some("build-box".to_string()),
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
        assert_eq!(stored.ssh_host.as_deref(), Some("build-box"));

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
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: ModelOptions::default(),
                sandbox: SandboxOptions::default(),
                ssh_host: Some("build-box".to_string()),
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
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: ModelOptions::default(),
                sandbox: SandboxOptions::default(),
                ssh_host: Some("build-box".to_string()),
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
                    action: "do remote work".to_string(),
                    source_threads: Vec::new(),
                    skills: Vec::new(),
                },
                store: StoreOptions {
                    store_path: Some(store_path.clone()),
                },
                model: ModelOptions::default(),
                sandbox: SandboxOptions::default(),
                ssh_host: Some("build-box".to_string()),
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
