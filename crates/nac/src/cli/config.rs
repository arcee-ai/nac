use super::*;

pub(super) struct ManagedWorkerConfig {
    pub(super) store_path: PathBuf,
    pub(super) session_id: String,
    pub(super) thread_name: String,
    pub(super) action: String,
}

pub(super) struct RunConfig {
    pub(super) mode: AgentMode,
    pub(super) agent: Agent,
    pub(super) initial_prompt: Option<String>,
    pub(super) continue_repl: bool,
    pub(super) managed_worker: Option<ManagedWorkerConfig>,
    pub(super) client: ModelClient,
    pub(super) session_id: Option<String>,
    pub(super) session_snapshot: Option<SessionSnapshot>,
    pub(super) sandbox_status: String,
    pub(super) agents_md_status: String,
    pub(super) workspace_display: String,
    pub(super) workspace_host_path: Option<PathBuf>,
}

pub(super) struct RunState {
    pub(super) run_config: RunConfig,
    pub(super) start_in_session_picker: bool,
}
