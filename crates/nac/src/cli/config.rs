use super::*;

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(super) struct NacConfig {
    #[serde(default)]
    pub(super) storage: StorageConfig,
    #[serde(default)]
    pub(super) model: ModelConfig,
    #[serde(default)]
    pub(super) sandbox: SandboxConfig,
    #[serde(default)]
    pub(super) worker: WorkerConfig,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(super) struct StorageConfig {
    pub(super) store_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(super) struct ModelConfig {
    pub(super) backend: Option<BackendKind>,
    pub(super) model: Option<String>,
    pub(super) base_url: Option<String>,
    pub(super) reasoning_effort: Option<ReasoningEffort>,
    pub(super) api_key_env: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(super) struct SandboxConfig {
    pub(super) image: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(super) struct WorkerConfig {
    pub(super) thread_timeout_secs: Option<u64>,
}

impl NacConfig {
    pub(super) fn load() -> Result<Self> {
        let Some(path) = crate::paths::nac_config_path() else {
            return Ok(Self::default());
        };
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

pub(super) enum OrchestratorSession {
    Active {
        session_id: String,
        snapshot: SessionSnapshot,
    },
    Picker {
        store_path: PathBuf,
    },
}

impl OrchestratorSession {
    pub(super) fn session_id(&self) -> Option<&str> {
        match self {
            Self::Active { session_id, .. } => Some(session_id),
            Self::Picker { .. } => None,
        }
    }

    pub(super) fn store_path(&self) -> PathBuf {
        match self {
            Self::Active { snapshot, .. } => snapshot.store_path.clone(),
            Self::Picker { store_path } => store_path.clone(),
        }
    }

    pub(super) fn into_snapshot(self) -> Option<SessionSnapshot> {
        match self {
            Self::Active { snapshot, .. } => Some(snapshot),
            Self::Picker { .. } => None,
        }
    }
}

pub(super) struct OrchestratorRunConfig {
    pub(super) agent: Agent,
    pub(super) client: ModelClient,
    pub(super) session: OrchestratorSession,
    pub(super) sandbox_status: String,
    pub(super) agents_md_status: String,
    pub(super) workspace_display: String,
    pub(super) workspace_host_path: Option<PathBuf>,
}

pub(super) struct ManagedWorkerRunConfig {
    pub(super) agent: Agent,
    pub(super) store_path: PathBuf,
    pub(super) session_id: String,
    pub(super) thread_name: String,
    pub(super) action: String,
}

pub(super) enum RunState {
    Orchestrator {
        run_config: OrchestratorRunConfig,
        start_in_session_picker: bool,
    },
    ManagedWorker(ManagedWorkerRunConfig),
}
