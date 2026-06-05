use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::model::{BackendKind, ClientOverrides, ModelClient, ReasoningEffort};
use crate::paths::PathContext;
use crate::sandbox::{
    build_sandbox_spec, parse_mount_spec, MountSpec, SandboxSession, DEFAULT_SANDBOX_IMAGE,
    DEFAULT_SANDBOX_WORKDIR,
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
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct SandboxConfig {
    pub image: Option<String>,
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
    pub worker_executable: Option<PathBuf>,
    pub store: StoreOptions,
    pub model: ModelOptions,
    pub sandbox: SandboxOptions,
}

#[derive(Debug, Clone, Default)]
pub struct ManagedWorkerOptions {
    pub workspace_cwd: PathBuf,
    pub dispatch: WorkerDispatchOptions,
    pub store: StoreOptions,
    pub model: ModelOptions,
    pub sandbox: SandboxOptions,
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
            Self::Active { snapshot, .. } => snapshot.store_path.clone(),
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
        explicit_sandbox_config_flags_present,
    }
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
        api_key_env: configured_api_key_env(config),
    })
}

pub(crate) fn worker_thread_timeout_secs(config: &NacConfig) -> u64 {
    config
        .worker
        .thread_timeout_secs
        .unwrap_or(crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS)
        .max(crate::tools::thread::MIN_THREAD_TIMEOUT_SECS)
}

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
    let client = ModelClient::from_env_with_overrides(model_overrides(&options.model, config)?)?;
    let workspace_cwd = options.workspace_cwd;
    let paths = PathContext::new(&workspace_cwd);
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
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

    let store_path = resolve_store_path(&workspace_cwd, options.store, config);
    store::initialize(&store_path)?;
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
            working_directory: working_directory.clone(),
            worker_executable: options.worker_executable,
            sandbox: sandbox.clone(),
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    );
    let session_snapshot = sessions::new_snapshot(
        session_id.clone(),
        workspace_cwd.clone(),
        store_path,
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        sandbox.as_ref().map(|session| session.spec().clone()),
        agent.messages.clone(),
    );
    sessions::create_session(&session_snapshot)?;

    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
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
    let workspace_cwd = options.workspace_cwd;
    let paths = PathContext::new(&workspace_cwd);
    let sandbox_options = effective_sandbox_options(options.sandbox, config);
    let sandbox = build_sandbox_session(&sandbox_options, &workspace_cwd).await?;
    let workspace_dir = effective_workspace_dir(&workspace_cwd, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(workspace_dir.as_deref(), &paths)?;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(|| directory_display(&workspace_cwd));
    let agents_md_message = agents_md.system_message();
    let store_path = resolve_store_path(&workspace_cwd, options.store, config);
    let mcp = McpRegistry::load(&workspace_cwd, sandbox.as_ref(), &paths).await?;
    let skills = SkillRegistry::load(workspace_dir.as_deref(), sandbox.as_ref(), &paths)?;
    let extra_tool_defs = mcp
        .as_ref()
        .map(|registry| registry.tool_definitions())
        .unwrap_or_default();

    store::initialize(&store_path)?;
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
            working_directory,
            worker_executable: None,
            sandbox,
            mcp,
            skills: None,
            extra_tool_defs,
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    );

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
        ModelClient::from_env_with_overrides(model_overrides(&ModelOptions::default(), config)?)?;
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
            working_directory: working_directory.clone(),
            worker_executable: options.worker_executable,
            sandbox: None,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: agents_md.system_message(),
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    );

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

    build_resume_config_from_snapshot(snapshot, config, lookup_cwd, options.worker_executable).await
}

pub async fn build_resume_config_for_session(
    store_path: PathBuf,
    session_id: &str,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<OrchestratorRunConfig> {
    let snapshot = sessions::load_session(&store_path, session_id)?;
    build_resume_config_from_snapshot(snapshot, config, resume_base_cwd, worker_executable).await
}

async fn build_resume_config_from_snapshot(
    snapshot: SessionSnapshot,
    config: &NacConfig,
    resume_base_cwd: PathBuf,
    worker_executable: Option<PathBuf>,
) -> Result<OrchestratorRunConfig> {
    let snapshot = normalize_snapshot_paths(snapshot, &resume_base_cwd)?;
    let workspace_cwd = snapshot.cwd.clone();
    let paths = PathContext::new(&workspace_cwd);
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: Some(snapshot.base_url.clone()),
        model: Some(snapshot.model.clone()),
        backend: Some(snapshot.backend),
        reasoning_effort: snapshot.reasoning_effort,
        api_key_env: configured_api_key_env(config),
    })?;
    let sandbox = match snapshot.sandbox_spec.clone() {
        Some(spec) => Some(SandboxSession::create(spec, Uuid::new_v4().to_string(), true).await?),
        None => None,
    };
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
    let agents_md_status = agents_md.status_text();

    store::initialize(&snapshot.store_path)?;
    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: snapshot.store_path.clone(),
            session_id: Some(snapshot.session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            workspace_cwd,
            working_directory: working_directory.clone(),
            worker_executable,
            sandbox,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: worker_thread_timeout_secs(config),
        },
    );
    agent.restore_messages(snapshot.messages.clone());

    let session_id = snapshot.session_id.clone();
    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
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
    let raw_cwd = if snapshot.cwd.is_absolute() {
        snapshot.cwd.clone()
    } else {
        resume_base_cwd.join(&snapshot.cwd)
    };
    let cwd = raw_cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve session cwd {}", raw_cwd.display()))?;
    let store_path = absolute_store_path(&cwd, snapshot.store_path.clone());
    snapshot.cwd = cwd;
    snapshot.store_path = store_path;
    Ok(snapshot)
}

pub async fn build_sandbox_session(
    options: &EffectiveSandboxOptions,
    cwd: &Path,
) -> Result<Option<SandboxSession>> {
    if !options.sandbox {
        if options.explicit_sandbox_config_flags_present {
            anyhow::bail!("sandbox configuration flags require --sandbox");
        }
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

        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
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
            store_path,
            "resume-model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
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
        );
        sessions::create_session(&snapshot).unwrap();

        let caller_cwd = original_cwd.canonicalize().unwrap();
        let run_config = build_resume_config(
            ResumeOptions {
                lookup_cwd: session_cwd.clone(),
                worker_executable: None,
                session_id: Some("resume-session".to_string()),
                last: false,
                store: StoreOptions { store_path: None },
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
}
