use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex as StdMutex, Weak as StdWeak};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{Mutex, Notify, RwLock};

use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::sandbox::ExecutionBackend;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::{ToolContent, ToolDefinition};

pub(crate) const REMOTE_FILE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(10);
const REMOTE_FILE_LOCK_BUSY_EXIT_CODE: i32 = 75;
const REMOTE_FILE_LOCK_BUSY_MARKER: &str = "NAC_FILE_LOCK_BUSY";

type SharedWorkspaceGate = RwLock<()>;
type SharedWorkspaceKey = (PathBuf, PathBuf);
static SHARED_WORKSPACE_GATES: LazyLock<
    StdMutex<HashMap<SharedWorkspaceKey, StdWeak<SharedWorkspaceGate>>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));

mod discovery;
pub mod edit;
pub mod exec_command;
pub mod glob;
pub(crate) mod goal;
pub mod grep;
pub mod kernel;
pub(crate) mod mutation;
pub(crate) mod orchestrator;
pub mod read;
pub(crate) mod subagent;
mod terminal_tools;
pub mod thread;
pub(crate) mod web;
pub mod workset;
pub mod write;

#[derive(Debug)]
pub struct ToolResult {
    pub content: ToolContent,
    pub is_error: bool,
}

impl ToolResult {
    pub fn text(content: impl Into<String>, is_error: bool) -> Self {
        Self {
            content: ToolContent::text(content),
            is_error,
        }
    }
}

#[derive(Default)]
struct ThreadCancellationState {
    cancelled: AtomicBool,
    activity: Notify,
    mutation_gate: StdMutex<()>,
}

#[derive(Clone, Default)]
pub(crate) struct ThreadCancellation {
    state: Arc<ThreadCancellationState>,
}

impl ThreadCancellation {
    pub(crate) fn cancel(&self) {
        // Synchronous process creation and terminal writes take this same
        // short-lived gate for their final check plus mutation. Whichever side
        // acquires it first defines the boundary: after cancellation wins, no
        // new PTY or terminal input can pass an earlier observation.
        let _mutation = self
            .state
            .mutation_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !self.state.cancelled.swap(true, Ordering::AcqRel) {
            self.state.activity.notify_waiters();
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn run_if_active<T>(&self, operation: impl FnOnce() -> T) -> Option<T> {
        let _mutation = self
            .state
            .mutation_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (!self.is_cancelled()).then(operation)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.state.activity.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ActiveThreadDispatchState {
    Pending,
    Running,
}

struct ActiveThreadDispatch {
    dispatch_id: String,
    state: ActiveThreadDispatchState,
}

struct ActiveThreadState {
    dispatches: HashMap<String, ActiveThreadDispatch>,
    cancellation: ThreadCancellation,
    accepting: bool,
    run_id: Option<String>,
}

impl Default for ActiveThreadState {
    fn default() -> Self {
        Self {
            dispatches: HashMap::new(),
            cancellation: ThreadCancellation::default(),
            accepting: true,
            run_id: None,
        }
    }
}

pub struct ActiveThreadRegistry {
    state: StdMutex<ActiveThreadState>,
    activity: Notify,
}

impl Default for ActiveThreadRegistry {
    fn default() -> Self {
        Self {
            state: StdMutex::new(ActiveThreadState::default()),
            activity: Notify::new(),
        }
    }
}

impl ActiveThreadRegistry {
    pub fn names(&self) -> Vec<String> {
        self.lock().dispatches.keys().cloned().collect()
    }

    pub fn is_active(&self, thread_name: &str) -> bool {
        self.lock().dispatches.contains_key(thread_name)
    }

    pub fn begin_run(&self, run_id: &str) -> bool {
        let mut state = self.lock();
        if !state.dispatches.is_empty() {
            return false;
        }
        state.cancellation = ThreadCancellation::default();
        state.accepting = true;
        state.run_id = Some(run_id.to_string());
        true
    }

    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let mut state = self.lock();
        if !state.accepting || state.dispatches.contains_key(thread_name) {
            return false;
        }
        state.dispatches.insert(
            thread_name.to_string(),
            ActiveThreadDispatch {
                dispatch_id: dispatch_id.to_string(),
                state: ActiveThreadDispatchState::Pending,
            },
        );
        true
    }

    pub(crate) fn start(&self, thread_name: &str, dispatch_id: &str) -> Option<ThreadCancellation> {
        let mut state = self.lock();
        if !state.accepting || state.cancellation.is_cancelled() {
            return None;
        }
        let dispatch = state.dispatches.get_mut(thread_name)?;
        if dispatch.dispatch_id != dispatch_id
            || dispatch.state != ActiveThreadDispatchState::Pending
        {
            return None;
        }
        dispatch.state = ActiveThreadDispatchState::Running;
        Some(state.cancellation.clone())
    }

    pub fn queue(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        instruction: &str,
        expected_run_id: Option<&str>,
    ) -> anyhow::Result<Option<crate::store::ThreadSteeringRecord>> {
        let state = self.lock();
        if expected_run_id.is_some() && state.run_id.as_deref() != expected_run_id {
            return Ok(None);
        }
        let Some(dispatch) = state.dispatches.get(thread_name) else {
            return Ok(None);
        };
        crate::store::queue_thread_steering(
            store_path,
            session_id,
            thread_name,
            &dispatch.dispatch_id,
            instruction,
        )
        .map(Some)
    }

    pub fn close(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        dispatch_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        if state
            .dispatches
            .get(thread_name)
            .map(|dispatch| dispatch.dispatch_id.as_str())
            != Some(dispatch_id)
        {
            return Ok(Vec::new());
        }
        state.dispatches.remove(thread_name);
        drop(state);
        self.activity.notify_waiters();
        crate::store::expire_thread_steering(store_path, session_id, dispatch_id)
    }

    pub async fn cancel_and_drain(
        &self,
        steering_store: Option<(&Path, &str)>,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let (cancellation, targets) = {
            let mut state = self.lock();
            state.accepting = false;
            let cancellation = state.cancellation.clone();
            let targets = state
                .dispatches
                .values()
                .map(|dispatch| dispatch.dispatch_id.clone())
                .collect::<Vec<_>>();
            state
                .dispatches
                .retain(|_, dispatch| dispatch.state == ActiveThreadDispatchState::Running);
            (cancellation, targets)
        };
        cancellation.cancel();
        self.activity.notify_waiters();

        let mut expired = Vec::new();
        let mut steering_error = None;
        if let Some((store_path, session_id)) = steering_store {
            for dispatch_id in &targets {
                match crate::store::expire_thread_steering(store_path, session_id, dispatch_id) {
                    Ok(records) => expired.extend(records),
                    Err(error) if steering_error.is_none() => steering_error = Some(error),
                    Err(_) => {}
                }
            }
        }

        loop {
            let notified = self.activity.notified();
            if self.lock().dispatches.is_empty() {
                break;
            }
            notified.await;
        }
        self.lock().run_id = None;

        match steering_error {
            Some(error) => Err(error),
            None => Ok(expired),
        }
    }

    pub fn close_all(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        state.accepting = false;
        state.cancellation.cancel();
        let targets = state
            .dispatches
            .iter()
            .map(|(name, dispatch)| (name.clone(), dispatch.dispatch_id.clone()))
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        for (name, dispatch_id) in targets {
            expired.extend(crate::store::expire_thread_steering(
                store_path,
                session_id,
                &dispatch_id,
            )?);
            if state
                .dispatches
                .get(&name)
                .is_some_and(|dispatch| dispatch.dispatch_id == dispatch_id)
            {
                state.dispatches.remove(&name);
            }
        }
        state.run_id = None;
        drop(state);
        self.activity.notify_waiters();
        Ok(expired)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ActiveThreadState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod active_thread_registry_tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_drains_running_dispatches_and_rejects_pending_work() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        assert!(registry.begin_run("run-1"));
        assert!(registry.mark("a", "dispatch-a"));
        assert!(registry.mark("b", "dispatch-b"));
        assert!(registry.mark("dependent", "dispatch-c"));
        let cancellation_a = registry.start("a", "dispatch-a").unwrap();
        let cancellation_b = registry.start("b", "dispatch-b").unwrap();

        let cancelling_registry = registry.clone();
        let cancelling = tokio::spawn(async move {
            cancelling_registry.cancel_and_drain(None).await.unwrap();
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            cancellation_a.cancelled().await;
            cancellation_b.cancelled().await;
        })
        .await
        .expect("running dispatches did not receive cancellation");

        assert!(registry.start("dependent", "dispatch-c").is_none());
        assert!(!registry.is_active("dependent"));
        assert!(!cancelling.is_finished());

        let missing = Path::new("/store/does/not/exist");
        assert!(registry
            .close(missing, "session", "a", "dispatch-a")
            .is_err());
        assert!(registry
            .close(missing, "session", "b", "dispatch-b")
            .is_err());
        tokio::time::timeout(Duration::from_secs(1), cancelling)
            .await
            .expect("cancellation did not drain")
            .unwrap();

        assert!(registry.names().is_empty());
        registry.cancel_and_drain(None).await.unwrap();
    }

    #[test]
    fn stale_close_cannot_remove_same_name_replacement() {
        let registry = ActiveThreadRegistry::default();
        assert!(registry.begin_run("run-1"));
        assert!(registry.mark("worker", "dispatch-old"));
        let missing = Path::new("/store/does/not/exist");
        assert!(registry
            .close(missing, "session", "worker", "dispatch-old")
            .is_err());

        assert!(registry.begin_run("run-2"));
        assert!(registry.mark("worker", "dispatch-new"));
        assert!(registry
            .close(missing, "session", "worker", "dispatch-old")
            .unwrap()
            .is_empty());
        assert!(registry.is_active("worker"));
    }

    #[tokio::test]
    async fn stale_run_cannot_steer_same_name_replacement() {
        let root =
            std::env::temp_dir().join(format!("nac-thread-generation-{}", uuid::Uuid::new_v4()));
        let store = root.join("store.db");
        crate::store::initialize(&store).unwrap();
        crate::store::insert_test_session(&store, "session");
        let registry = ActiveThreadRegistry::default();

        assert!(registry.begin_run("run-1"));
        assert!(registry.mark("worker", "dispatch-1"));
        registry
            .close(&store, "session", "worker", "dispatch-1")
            .unwrap();
        registry.cancel_and_drain(None).await.unwrap();
        assert!(registry.begin_run("run-2"));
        assert!(registry.mark("worker", "dispatch-2"));

        assert!(registry
            .queue(
                &store,
                "session",
                "worker",
                "belongs to run one",
                Some("run-1")
            )
            .unwrap()
            .is_none());
        assert!(crate::store::list_thread_steering(&store, "session")
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_gate_is_shared_by_sessions_using_the_same_store_and_checkout() {
        let shared_a = shared_workspace_gate_for(
            Path::new("/tmp/nac-shared-store"),
            Path::new("/tmp/nac-shared-workspace"),
        );
        let shared_b = shared_workspace_gate_for(
            Path::new("/tmp/nac-shared-store"),
            Path::new("/tmp/nac-shared-workspace"),
        );
        let other_workspace = shared_workspace_gate_for(
            Path::new("/tmp/nac-shared-store"),
            Path::new("/tmp/nac-other-workspace"),
        );

        assert!(Arc::ptr_eq(&shared_a, &shared_b));
        assert!(!Arc::ptr_eq(&shared_a, &other_workspace));
    }
}

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
    pub skills: Option<Arc<SkillRegistry>>,
    pub terminal_manager: TerminalManager,
    pub command_cancellation: ThreadCancellation,
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

fn shared_workspace_gate(runtime: &ToolRuntime) -> Arc<SharedWorkspaceGate> {
    shared_workspace_gate_for(&runtime.store_path, &runtime.workspace_cwd)
}

pub fn shared_workspace_gate_for(
    store_path: &Path,
    workspace_cwd: &Path,
) -> Arc<tokio::sync::RwLock<()>> {
    let key = (store_path.to_path_buf(), workspace_cwd.to_path_buf());
    let mut gates = SHARED_WORKSPACE_GATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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

struct ReadTool {
    image_read: bool,
}

impl kernel::NativeTool for ReadTool {
    type Input = read::ReadInput;

    fn definition(&self) -> ToolDefinition {
        read::definition(self.image_read)
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        read::decode(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        let path = services
            .runtime
            .backend
            .resolve_path(input.path())
            .map_err(|error| {
                ToolResult::text(format!("Error: invalid read path: {error}"), true)
            })?;
        Ok(crate::permissions::file_resources(
            "read",
            path,
            services.runtime.backend.as_ref(),
            &services.runtime.store_path,
            false,
        ))
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let path = resources
            .iter()
            .find(|resource| resource.action == "read")
            .ok_or_else(|| ToolResult::text("Error: authorized read target is missing", true))?;
        input.bind_authorized_path(&path.resource);
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        // Provider capabilities shape the registered definition; the captured
        // tool setting remains authoritative for native callers.
        let _provider_supports_images = services.client.supports_image_tool_results();
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            let _read = gate.read().await;
            read::execute_native(input, services.runtime, self.image_read).await
        })
    }
}

pub(crate) const WORKER_TOOL_NAMES: [&str; 8] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "exec_command",
    "write_stdin",
    "read_command_output",
];

pub(crate) const GOAL_TOOL_NAMES: [&str; 3] = ["create_goal", "get_goal", "update_goal"];
pub(crate) const DIRECT_TOOL_NAMES: [&str; 14] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "exec_command",
    "write_stdin",
    "read_command_output",
    "create_goal",
    "get_goal",
    "update_goal",
    "subagent",
    "subagent_status",
    "subagent_cancel",
];
pub(crate) const ORCHESTRATOR_CONTROL_TOOL_NAMES: [&str; 6] = [
    "orchestrator_launch",
    "orchestrator_status",
    "orchestrator_steer",
    "orchestrator_read",
    "orchestrator_wait",
    "orchestrator_cancel",
];
pub(crate) const WEB_TOOL_NAMES: [&str; 2] = ["web_search", "web_fetch"];
pub(crate) const DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES: [&str; 20] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "exec_command",
    "write_stdin",
    "read_command_output",
    "create_goal",
    "get_goal",
    "update_goal",
    "subagent",
    "subagent_status",
    "subagent_cancel",
    "orchestrator_launch",
    "orchestrator_status",
    "orchestrator_steer",
    "orchestrator_read",
    "orchestrator_wait",
    "orchestrator_cancel",
];

fn worker_tool_registry(
    image_read: bool,
) -> Result<kernel::ToolRegistry, kernel::ToolRegistryError> {
    let registry = kernel::ToolRegistry::builder()
        .register(ReadTool { image_read })
        .register(write::WriteTool)
        .register(edit::EditTool)
        .register(glob::GlobTool)
        .register(grep::GrepTool)
        .register(terminal_tools::ExecCommandTool)
        .register(terminal_tools::WriteStdinTool)
        .register(terminal_tools::ReadCommandOutputTool)
        .register(goal::CreateGoalTool)
        .register(goal::GetGoalTool)
        .register(goal::UpdateGoalTool)
        .register(subagent::SubagentTool)
        .register(subagent::SubagentStatusTool)
        .register(subagent::SubagentCancelTool)
        .register(orchestrator::LaunchTool)
        .register(orchestrator::StatusTool)
        .register(orchestrator::SteerTool)
        .register(orchestrator::ReadTool)
        .register(orchestrator::WaitTool)
        .register(orchestrator::CancelTool)
        .register(web::WebSearchTool)
        .register(web::WebFetchTool)
        .finish()?;
    // Keep the native instance retrievable; direct Rust callers do not need a
    // JSON round-trip to execute the same registered read operation.
    let _read_handle = registry.native_handle::<ReadTool>()?;
    Ok(registry)
}

pub fn worker_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    worker_tool_registry(image_read)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| {
            WORKER_TOOL_NAMES.contains(&descriptor.name())
                && !GOAL_TOOL_NAMES.contains(&descriptor.name())
        })
        .definitions()
}

pub fn direct_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    worker_tool_registry(image_read)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot(DIRECT_TOOL_NAMES)
        .expect("built-in direct capability selection must be complete")
        .definitions()
}

#[cfg(test)]
pub(crate) fn direct_tool_definitions_with_web(
    image_read: bool,
    web_enabled: bool,
) -> Vec<ToolDefinition> {
    let mut definitions = direct_tool_definitions(image_read);
    if web_enabled {
        definitions.extend(web::definitions());
    }
    definitions
}

pub fn direct_with_orchestrator_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    let snapshot = worker_tool_registry(image_read)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot(DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES)
        .expect("direct-with-orchestrator capability selection must be complete");
    debug_assert!(ORCHESTRATOR_CONTROL_TOOL_NAMES
        .iter()
        .all(|name| snapshot.contains(name)));
    snapshot.definitions()
}

#[cfg(test)]
pub(crate) fn direct_with_orchestrator_tool_definitions_with_web(
    image_read: bool,
    web_enabled: bool,
) -> Vec<ToolDefinition> {
    let mut definitions = direct_with_orchestrator_tool_definitions(image_read);
    if web_enabled {
        definitions.extend(web::definitions());
    }
    definitions
}

fn is_complete_direct_capability(name: &str) -> bool {
    DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES.contains(&name) || WEB_TOOL_NAMES.contains(&name)
}

pub(crate) fn direct_tool_admission(name: &str) -> Option<kernel::ToolAdmission> {
    worker_tool_registry(false)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| is_complete_direct_capability(descriptor.name()))
        .admission(name)
}

pub fn orchestrator_tool_definitions(
    skills: Option<&SkillRegistry>,
    light: Option<&crate::model::ModelClient>,
) -> Vec<ToolDefinition> {
    vec![
        thread::dispatch_definition(skills, light),
        thread::threads_definition(),
        thread::thread_read_definition(),
        thread::thread_delete_definition(),
        workset::define_definition(),
        workset::read_definition(),
        workset::list_definition(),
    ]
}

pub fn require_str(args: &Value, key: &str) -> Result<String, ToolResult> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| ToolResult {
            content: (format!("Error: '{}' argument required", key)).into(),
            is_error: true,
        })
}

pub fn require_string_array(args: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };

    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: (format!("Error: '{}' must be an array of strings", key)).into(),
            is_error: true,
        });
    };

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(value) = item.as_str() else {
            return Err(ToolResult {
                content: (format!("Error: '{}' must be an array of strings", key)).into(),
                is_error: true,
            });
        };
        out.push(value.to_string());
    }

    Ok(out)
}

#[cfg(test)]
pub async fn execute_tool(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
) -> ToolResult {
    execute_tool_with_context(
        name,
        args,
        runtime,
        client,
        &kernel::ToolCallContext::default(),
    )
    .await
}

pub async fn execute_tool_with_context(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
    context: &kernel::ToolCallContext,
) -> ToolResult {
    if !runtime.allows_tool(name) {
        return ToolResult::text(
            format!("Error: unknown tool '{name}' is not available to this agent"),
            true,
        );
    }
    if name.starts_with("mcp__") {
        let Some(registry) = &runtime.mcp else {
            return ToolResult {
                content: (format!("Error: MCP tool '{}' is not available", name)).into(),
                is_error: true,
            };
        };
        return registry
            .call_tool(name, args, client.supports_image_tool_results())
            .await;
    }

    let direct = worker_tool_registry(client.supports_image_tool_results())
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| is_complete_direct_capability(descriptor.name()));
    if direct.contains(name) {
        return direct
            .invoke(
                name,
                args,
                kernel::ToolServices { runtime, client },
                context,
            )
            .await;
    }

    match name {
        "thread" => thread::execute_dispatch(args, runtime, client).await,
        "threads" => thread::execute_threads(runtime).await,
        "thread_read" => thread::execute_thread_read(args, runtime).await,
        "thread_delete" => thread::execute_thread_delete(args, runtime).await,
        "workset_define" => workset::execute_define(args, runtime).await,
        "workset_read" => workset::execute_read(args, runtime).await,
        "workset_list" => workset::execute_list(args, runtime).await,
        unknown => ToolResult {
            content: (format!("Error: unknown tool '{}'", unknown)).into(),
            is_error: true,
        },
    }
}

#[cfg(test)]
#[path = "../tools_tests.rs"]
mod tests;

// ------------------------------------------------------------------
// Test helpers (shared across agent::dag, agent::tool_exec, tools::thread)
// ------------------------------------------------------------------

/// Create a `ToolRuntime` suitable for unit tests.  Uses the current
/// directory as the workspace, an empty store path, a dummy session id,
/// and no MCP / skills / worker executable.
#[cfg(test)]
pub(crate) fn test_runtime() -> ToolRuntime {
    let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace_cwd);
    ToolRuntime {
        command_cancellation: crate::tools::ThreadCancellation::default(),
        config_cwd: workspace_cwd.clone(),
        workspace_cwd,
        store_path: PathBuf::new(),
        session_id: Some("test-session".to_string()),
        worker_executable: None,
        active_threads: Arc::new(crate::tools::ActiveThreadRegistry::default()),
        event_sink: EventSink::none(),
        backend,
        mcp: None,
        skills: None,
        terminal_manager: TerminalManager::new(),
        thread_timeout_secs: thread::DEFAULT_THREAD_TIMEOUT_SECS,
        worker_usage: Arc::new(Mutex::new(crate::model::TokenUsage::default())),
        light_client: None,
        allowed_tools: None,
        permission_broker: None,
        goal_runtime: None,
        command_environment: None,
        web_credential: None,
        command_redactions: Arc::new(StdMutex::new(HashMap::new())),
    }
}
