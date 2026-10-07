use super::*;

type SharedWorkspaceGate = RwLock<()>;
type SharedWorkspaceKey = (PathBuf, PathBuf);
static SHARED_WORKSPACE_GATES: LazyLock<
    StdMutex<HashMap<SharedWorkspaceKey, StdWeak<SharedWorkspaceGate>>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));

#[derive(Clone)]
pub struct ToolRuntime {
    pub workspace_cwd: PathBuf,
    pub config_cwd: PathBuf,
    pub store_path: PathBuf,
    pub session_id: Option<String>,
    pub worker_executable: Option<PathBuf>,
    pub active_threads: Arc<ActiveThreadRegistry>,
    pub event_sink: EventSink,
    pub backend: Arc<ExecutionBackend>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub(crate) mcp_tools: Arc<HashMap<String, McpToolCapture>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub terminal_manager: TerminalManager,
    pub command_cancellation: ThreadCancellation,
    /// Trusted host admission, independent of this agent's selected model.
    pub host_execution_authority: Option<crate::model::ManagedHostExecutionAuthority>,
    pub thread_timeout_secs: u64,
    /// Accumulated worker token usage from thread dispatches.  The agent
    /// loop reads and resets this after each tool-execution round so worker
    /// API costs are included in the session totals.  `orchestrator_context_tokens` is
    /// intentionally NOT accumulated here — it stays orchestrator-only.
    pub worker_usage: Arc<Mutex<crate::model::TokenUsage>>,
    /// Light worker model client; `None` keeps single-model dispatch.
    pub light_client: Option<Arc<crate::model::ModelClient>>,
    /// Exact construction-time capability set exposed to this agent. `None`
    /// is reserved for native/test callers that intentionally invoke the
    /// global operation boundary without a model-visible snapshot.
    pub allowed_tools: Option<Arc<std::collections::HashSet<String>>>,
    /// Present only for persistent direct primaries after their session
    /// service attaches. Workers and the existing orchestrator retain their
    /// established allow-through behavior.
    pub permission_broker: Option<Arc<crate::permissions::PermissionBroker>>,
    /// Construction-time rules retained so headless imported capabilities can
    /// fail closed on `ask` while still honoring an explicit final allow.
    pub(crate) permission_rules: Arc<Vec<crate::permissions::PermissionRule>>,
    /// Direct-only bridge for exact mid-run durable-goal baselines.
    pub(crate) goal_runtime: Option<Arc<crate::goals::GoalRuntime>>,
    /// Optional process-environment capability, read immediately before each
    /// command spawn so replacements affect new processes while existing
    /// processes keep their immutable snapshot.
    pub command_environment: Option<Arc<dyn nac_contracts::CommandEnvironmentProvider>>,
    /// Exa key captured by the exact model-request capability snapshot that
    /// admitted `web_search`/`web_fetch` for the following tool round.
    pub(crate) web_credential: Option<Arc<web::ExaCredential>>,
    pub command_redactions:
        Arc<StdMutex<HashMap<String, nac_contracts::CommandEnvironmentSnapshot>>>,
}

impl ToolRuntime {
    pub(crate) fn model_tool_definitions(
        &mut self,
        base: &[ToolDefinition],
        fallback: &[ToolDefinition],
    ) -> Vec<ToolDefinition> {
        match self.mcp.as_ref() {
            Some(mcp) => {
                let (mcp_definitions, captures) = mcp.model_tool_snapshot();
                self.mcp_tools = Arc::new(captures);
                base.iter().cloned().chain(mcp_definitions).collect()
            }
            None => {
                self.mcp_tools = Arc::new(HashMap::new());
                fallback.to_vec()
            }
        }
    }

    pub(crate) fn set_event_sink(&mut self, sink: EventSink) {
        self.event_sink = sink;
    }

    pub(crate) async fn check_host_execution_authority(&self) -> anyhow::Result<()> {
        if let Some(authority) = &self.host_execution_authority {
            if let Err(error) = authority.check_available() {
                self.command_cancellation.cancel_async().await;
                return Err(error);
            }
        }
        Ok(())
    }

    pub(crate) async fn observe_host_execution_denial(&self) {
        let Some(authority) = &self.host_execution_authority else {
            std::future::pending::<()>().await;
            return;
        };
        loop {
            if authority.check_available().is_err() {
                self.command_cancellation.cancel_async().await;
                return;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    pub(crate) fn allows_tool(&self, name: &str) -> bool {
        self.allowed_tools
            .as_ref()
            .is_none_or(|allowed| allowed.contains(name))
    }

    pub(crate) async fn command_environment_snapshot(
        &self,
    ) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
        match self.command_environment.as_ref() {
            Some(provider) => provider.snapshot().await,
            None => Ok(nac_contracts::CommandEnvironmentSnapshot::empty()),
        }
    }

    pub(crate) fn remember_output_environment(
        &self,
        output_id: impl Into<String>,
        snapshot: nac_contracts::CommandEnvironmentSnapshot,
    ) {
        self.command_redactions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(output_id.into(), snapshot);
    }

    pub(crate) fn redact_output(&self, output_id: &str, text: &str) -> anyhow::Result<String> {
        let snapshot = self
            .command_redactions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(output_id)
            .cloned();
        match snapshot {
            Some(snapshot) => Ok(snapshot.redact(text)),
            None => {
                let snapshot = match self.command_environment.as_ref() {
                    Some(provider) => provider.redaction_snapshot()?,
                    None => nac_contracts::CommandEnvironmentSnapshot::empty(),
                };
                Ok(snapshot.redact(text))
            }
        }
    }
}

pub(super) fn shared_workspace_gate(runtime: &ToolRuntime) -> Arc<SharedWorkspaceGate> {
    shared_workspace_gate_for(&runtime.store_path, &runtime.workspace_cwd)
}

pub fn shared_workspace_gate_for(
    store_path: &Path,
    workspace_cwd: &Path,
) -> Arc<tokio::sync::RwLock<()>> {
    let key = (store_path.to_path_buf(), workspace_cwd.to_path_buf());
    let mut gates = SHARED_WORKSPACE_GATES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(gate) = gates.get(&key).and_then(StdWeak::upgrade) {
        return gate;
    }
    let gate = Arc::new(RwLock::new(()));
    gates.insert(key, Arc::downgrade(&gate));
    gate
}

pub(crate) fn resolve_workspace_path(runtime: &ToolRuntime, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        runtime.workspace_cwd.join(path)
    }
}

pub(crate) fn remote_file_lock_busy(output: &std::process::Output) -> bool {
    output.status.code() == Some(REMOTE_FILE_LOCK_BUSY_EXIT_CODE)
        && String::from_utf8_lossy(&output.stdout).trim() == REMOTE_FILE_LOCK_BUSY_MARKER
}
