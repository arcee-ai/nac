use super::*;

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
        ui_mode: tui::UiMode,
    },
    ManagedWorker(ManagedWorkerRunConfig),
}
