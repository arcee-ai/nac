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

struct LegacyDirectTool<const KIND: u8>;

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

impl<const KIND: u8> kernel::NativeTool for LegacyDirectTool<KIND> {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        match KIND {
            1 => write::definition(),
            2 => edit::definition(),
            3 => glob::definition(),
            4 => grep::definition(),
            5 => exec_command::exec_command_definition(),
            6 => exec_command::write_stdin_definition(),
            7 => exec_command::read_command_output_definition(),
            _ => unreachable!("unknown built-in direct tool kind"),
        }
    }

    fn admission(&self) -> kernel::ToolAdmission {
        match KIND {
            3 | 4 | 7 => kernel::ToolAdmission::Parallel,
            _ => kernel::ToolAdmission::Exclusive,
        }
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        validate_legacy_direct_input(KIND, &input)?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        legacy_permission_resources(KIND, input, services.runtime)
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        bind_legacy_authorized_resources(KIND, input, resources)
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            match KIND {
                3 | 4 => {
                    let _read = gate.read().await;
                    execute_legacy_direct(KIND, input, services.runtime).await
                }
                1 | 2 | 5 | 6 => {
                    let _write = gate.write().await;
                    execute_legacy_direct(KIND, input, services.runtime).await
                }
                _ => execute_legacy_direct(KIND, input, services.runtime).await,
            }
        })
    }
}

fn bind_legacy_authorized_resources(
    kind: u8,
    input: &mut Value,
    resources: &[kernel::PermissionResource],
) -> Result<(), ToolResult> {
    let invalid = |message: &str| ToolResult::text(format!("Error: {message}"), true);
    let canonical = |action: &str| {
        resources
            .iter()
            .filter(|resource| resource.action == action)
            .map(|resource| resource.resource.clone())
            .collect::<Vec<_>>()
    };
    let object = input
        .as_object_mut()
        .ok_or_else(|| invalid("decoded tool arguments are not an object"))?;
    match kind {
        1 | 2 => {
            let path = canonical("edit")
                .into_iter()
                .next()
                .ok_or_else(|| invalid("authorized mutation target is missing"))?;
            object.insert("path".to_string(), Value::String(path));
            object.insert("_nac_authorized_path_bound".to_string(), Value::Bool(true));
        }
        3 => {
            let root = canonical("glob")
                .into_iter()
                .next()
                .ok_or_else(|| invalid("authorized glob root is missing"))?;
            object.insert("root".to_string(), Value::String(root));
        }
        4 => {
            let roots = canonical("grep");
            if roots.is_empty() {
                return Err(invalid("authorized grep roots are missing"));
            }
            object.insert(
                "roots".to_string(),
                Value::Array(roots.into_iter().map(Value::String).collect()),
            );
        }
        5 => {
            let cwd = canonical("execute_cwd")
                .into_iter()
                .next()
                .ok_or_else(|| invalid("authorized command working directory is missing"))?;
            let command = object
                .get("cmd")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("decoded command is missing"))?;
            let command = crate::permissions::bind_authorized_shell_command(
                command,
                std::path::Path::new(&cwd),
                resources,
            )
            .map_err(|error| {
                invalid(&format!(
                    "authorized command paths could not be bound: {error:#}"
                ))
            })?;
            object.insert("workdir".to_string(), Value::String(cwd));
            object.insert("cmd".to_string(), Value::String(command));
        }
        6 | 7 => {}
        _ => unreachable!("unknown built-in direct tool kind"),
    }
    Ok(())
}

fn validate_legacy_direct_input(kind: u8, input: &Value) -> Result<(), ToolResult> {
    fn invalid(message: impl Into<String>) -> ToolResult {
        ToolResult::text(format!("Error: {}", message.into()), true)
    }
    fn object(input: &Value) -> Result<&serde_json::Map<String, Value>, ToolResult> {
        input
            .as_object()
            .ok_or_else(|| invalid("tool arguments must be an object"))
    }
    fn required_string<'a>(
        object: &'a serde_json::Map<String, Value>,
        key: &str,
    ) -> Result<&'a str, ToolResult> {
        object
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| invalid(format!("'{key}' argument must be a string")))
    }
    fn optional_string(
        object: &serde_json::Map<String, Value>,
        key: &str,
    ) -> Result<(), ToolResult> {
        if object.get(key).is_some_and(|value| !value.is_string()) {
            return Err(invalid(format!("'{key}' argument must be a string")));
        }
        Ok(())
    }
    fn optional_bool(object: &serde_json::Map<String, Value>, key: &str) -> Result<(), ToolResult> {
        if object.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(invalid(format!("'{key}' argument must be a boolean")));
        }
        Ok(())
    }
    fn optional_u64(
        object: &serde_json::Map<String, Value>,
        key: &str,
        minimum: u64,
        maximum: u64,
    ) -> Result<(), ToolResult> {
        let Some(value) = object.get(key) else {
            return Ok(());
        };
        if value
            .as_u64()
            .is_none_or(|value| value < minimum || value > maximum)
        {
            return Err(invalid(format!(
                "'{key}' argument must be an integer between {minimum} and {maximum}"
            )));
        }
        Ok(())
    }
    fn reject_unknown(
        object: &serde_json::Map<String, Value>,
        allowed: &[&str],
    ) -> Result<(), ToolResult> {
        if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
            return Err(invalid(format!("unknown '{key}' argument")));
        }
        Ok(())
    }
    fn bounded_string(
        object: &serde_json::Map<String, Value>,
        key: &str,
        required: bool,
        minimum: usize,
        maximum: usize,
    ) -> Result<(), ToolResult> {
        let value = match object.get(key) {
            Some(Value::String(value)) => value,
            None if !required => return Ok(()),
            _ => return Err(invalid(format!("'{key}' argument must be a string"))),
        };
        if value.len() < minimum || value.len() > maximum {
            return Err(invalid(format!(
                "'{key}' argument must contain between {minimum} and {maximum} bytes"
            )));
        }
        Ok(())
    }
    fn string_array(
        object: &serde_json::Map<String, Value>,
        key: &str,
        minimum: usize,
        maximum: usize,
        item_maximum: usize,
    ) -> Result<(), ToolResult> {
        let Some(value) = object.get(key) else {
            return Ok(());
        };
        let values = value
            .as_array()
            .ok_or_else(|| invalid(format!("'{key}' argument must be an array of strings")))?;
        if values.len() < minimum || values.len() > maximum {
            return Err(invalid(format!(
                "'{key}' must contain between {minimum} and {maximum} strings"
            )));
        }
        if values.iter().any(|value| {
            value
                .as_str()
                .is_none_or(|value| value.len() > item_maximum)
        }) {
            return Err(invalid(format!(
                "'{key}' must contain only strings of at most {item_maximum} bytes"
            )));
        }
        Ok(())
    }

    let object = object(input)?;
    match kind {
        1 => {
            reject_unknown(object, &["path", "content", "expected_revision"])?;
            required_string(object, "path")?;
            required_string(object, "content")?;
            match object.get("expected_revision") {
                Some(Value::String(_)) | Some(Value::Null) => {}
                _ => {
                    return Err(invalid(
                        "'expected_revision' must be a revision string or null",
                    ));
                }
            }
        }
        2 => {
            reject_unknown(object, &["path", "expected_revision", "edits"])?;
            required_string(object, "path")?;
            required_string(object, "expected_revision")?;
            let edits = object
                .get("edits")
                .and_then(Value::as_array)
                .filter(|edits| !edits.is_empty())
                .ok_or_else(|| invalid("'edits' must contain at least one replacement"))?;
            for edit in edits {
                let edit = edit
                    .as_object()
                    .ok_or_else(|| invalid("each edit must be an object"))?;
                reject_unknown(edit, &["old_text", "new_text"])?;
                if required_string(edit, "old_text")?.is_empty() {
                    return Err(invalid("'old_text' must not be empty"));
                }
                required_string(edit, "new_text")?;
            }
        }
        3 => {
            reject_unknown(
                object,
                &["pattern", "root", "gitignore", "hidden", "limit", "cursor"],
            )?;
            bounded_string(object, "pattern", true, 1, 1024)?;
            bounded_string(object, "root", false, 0, 1024)?;
            optional_bool(object, "gitignore")?;
            optional_bool(object, "hidden")?;
            optional_u64(object, "limit", 1, 1_000)?;
            bounded_string(object, "cursor", false, 0, 4_096)?;
        }
        4 => {
            reject_unknown(
                object,
                &[
                    "pattern",
                    "roots",
                    "regex",
                    "case",
                    "globs",
                    "context",
                    "multiline",
                    "gitignore",
                    "hidden",
                    "limit",
                    "cursor",
                ],
            )?;
            bounded_string(object, "pattern", true, 1, 65_536)?;
            string_array(object, "roots", 1, 32, 1_024)?;
            string_array(object, "globs", 0, 128, 1_024)?;
            optional_bool(object, "regex")?;
            optional_bool(object, "multiline")?;
            optional_bool(object, "gitignore")?;
            optional_bool(object, "hidden")?;
            optional_u64(object, "context", 0, 100)?;
            optional_u64(object, "limit", 1, 1_000)?;
            bounded_string(object, "cursor", false, 0, 4_096)?;
            if let Some(case) = object.get("case") {
                if !matches!(case.as_str(), Some("smart" | "sensitive" | "insensitive")) {
                    return Err(invalid(
                        "'case' argument must be smart, sensitive, or insensitive",
                    ));
                }
            }
        }
        5 => {
            reject_unknown(
                object,
                &["cmd", "workdir", "tty", "yield_time_ms", "max_output_chars"],
            )?;
            required_string(object, "cmd")?;
            optional_string(object, "workdir")?;
            optional_bool(object, "tty")?;
            optional_u64(object, "yield_time_ms", 0, 3_600_000)?;
            optional_u64(object, "max_output_chars", 0, usize::MAX as u64)?;
        }
        6 => {
            reject_unknown(
                object,
                &[
                    "session_id",
                    "chars",
                    "retain",
                    "yield_time_ms",
                    "max_output_chars",
                ],
            )?;
            required_string(object, "session_id")?;
            optional_string(object, "chars")?;
            optional_bool(object, "retain")?;
            if object
                .get("chars")
                .and_then(Value::as_str)
                .is_some_and(|chars| !chars.is_empty())
                && object
                    .get("retain")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                return Err(invalid(
                    "'retain=true' requires empty 'chars'; send input and retain in separate calls",
                ));
            }
            optional_u64(object, "yield_time_ms", 0, 3_600_000)?;
            optional_u64(object, "max_output_chars", 0, usize::MAX as u64)?;
        }
        7 => {
            reject_unknown(object, &["output_id", "offset", "limit", "stream"])?;
            required_string(object, "output_id")?;
            optional_u64(object, "offset", 0, u64::MAX)?;
            optional_u64(
                object,
                "limit",
                1,
                crate::terminal::MAX_OUTPUT_PAGE_BYTES as u64,
            )?;
            if let Some(stream) = object.get("stream") {
                if !matches!(stream.as_str(), Some("combined" | "stdout" | "stderr")) {
                    return Err(invalid(
                        "'stream' argument must be combined, stdout, or stderr",
                    ));
                }
            }
        }
        _ => unreachable!("unknown built-in direct tool kind"),
    }
    Ok(())
}

async fn execute_legacy_direct(kind: u8, input: Value, runtime: &ToolRuntime) -> ToolResult {
    match kind {
        1 => write::execute(input, runtime).await,
        2 => edit::execute(input, runtime).await,
        3 => glob::execute(input, runtime).await,
        4 => grep::execute(input, runtime).await,
        5 => exec_command::execute_exec_command(&input, runtime).await,
        6 => exec_command::execute_write_stdin(&input, runtime).await,
        7 => exec_command::execute_read_command_output(&input, runtime),
        _ => unreachable!("unknown built-in direct tool kind"),
    }
}

fn legacy_permission_resources(
    kind: u8,
    input: &Value,
    runtime: &ToolRuntime,
) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
    fn invalid(message: impl Into<String>) -> ToolResult {
        ToolResult::text(format!("Error: {}", message.into()), true)
    }
    fn string<'a>(input: &'a Value, key: &str) -> Result<&'a str, ToolResult> {
        input
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| invalid(format!("'{key}' argument must be a string")))
    }
    fn resolved_file(
        action: &str,
        path: &str,
        runtime: &ToolRuntime,
        mutating: bool,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        let path = runtime
            .backend
            .resolve_path(path)
            .map_err(|error| invalid(format!("invalid {action} path: {error}")))?;
        Ok(crate::permissions::file_resources(
            action,
            path,
            runtime.backend.as_ref(),
            &runtime.store_path,
            mutating,
        ))
    }

    match kind {
        1 | 2 => resolved_file("edit", string(input, "path")?, runtime, true),
        3 => {
            let root = match input.get("root") {
                None => ".",
                Some(Value::String(root)) => root,
                Some(_) => return Err(invalid("'root' argument must be a string")),
            };
            resolved_file("glob", root, runtime, false)
        }
        4 => {
            let roots = match input.get("roots") {
                None => vec!["."],
                Some(Value::Array(roots)) if !roots.is_empty() => roots
                    .iter()
                    .map(|root| {
                        root.as_str()
                            .ok_or_else(|| invalid("'roots' must contain only strings"))
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                Some(Value::Array(_)) => {
                    return Err(invalid("'roots' must contain at least one path"));
                }
                Some(_) => return Err(invalid("'roots' argument must be an array of strings")),
            };
            roots
                .into_iter()
                .map(|root| resolved_file("grep", root, runtime, false))
                .collect::<Result<Vec<_>, _>>()
                .map(|resources| resources.into_iter().flatten().collect())
        }
        5 => {
            let command = string(input, "cmd")?;
            let tty = match input.get("tty") {
                None => false,
                Some(Value::Bool(tty)) => *tty,
                Some(_) => return Err(invalid("'tty' argument must be a boolean")),
            };
            let requested = match input.get("workdir") {
                None => None,
                Some(Value::String(workdir)) => Some(workdir.as_str()),
                Some(_) => return Err(invalid("'workdir' argument must be a string")),
            };
            let cwd = runtime
                .backend
                .resolve_terminal_cwd(requested)
                .map_err(|error| invalid(format!("invalid command working directory: {error}")))?
                .unwrap_or_else(|| runtime.backend.default_terminal_cwd());
            let mut resources =
                crate::permissions::shell_resources(command, &cwd, runtime.backend.as_ref());
            if tty
                && crate::permissions::unbounded_interactive_input(command)
                && runtime.permission_broker.is_none()
            {
                resources.push(
                    kernel::PermissionResource::new("terminal_input", "unbounded-interpreter")
                        .with_display(
                            "interactive opaque commands and broad interpreters require direct-session approval",
                        )
                        .with_hard_denial(
                            "interactive opaque commands and broad interpreters are unavailable to brokerless workers because follow-up input requires direct-session approval",
                        ),
                );
            }
            Ok(resources)
        }
        6 => {
            let session_id = string(input, "session_id")?;
            let chars = match input.get("chars") {
                None => "",
                Some(Value::String(chars)) => chars,
                Some(_) => return Err(invalid("'chars' argument must be a string")),
            };
            let retain = match input.get("retain") {
                None => false,
                Some(Value::Bool(retain)) => *retain,
                Some(_) => return Err(invalid("'retain' argument must be a boolean")),
            };
            let resource = if !chars.is_empty() {
                let backend = match runtime.backend.as_ref() {
                    crate::sandbox::ExecutionBackend::Local { .. } => "local",
                    crate::sandbox::ExecutionBackend::Sandbox(_) => "podman",
                    crate::sandbox::ExecutionBackend::Ssh(_) => "ssh",
                };
                let resource = kernel::PermissionResource::new("terminal_input", session_id)
                    .with_display(format!(
                        "send exact input {} to terminal handle '{session_id}' on the {backend} backend; the running process may interpret these bytes as commands",
                        serde_json::to_string(chars)
                            .expect("a Rust string always has a JSON string representation")
                    ));
                if runtime.permission_broker.is_none() {
                    resource.with_hard_denial(
                        "nonempty terminal input is unavailable to brokerless workers because it requires direct-session approval",
                    )
                } else {
                    resource
                }
            } else if retain {
                kernel::PermissionResource::new("terminal_retain", session_id)
            } else {
                kernel::PermissionResource::new("terminal_observe", session_id)
            };
            Ok(vec![resource])
        }
        7 => Ok(vec![kernel::PermissionResource::new(
            "command_output",
            string(input, "output_id")?,
        )]),
        _ => unreachable!("unknown built-in direct tool kind"),
    }
}

fn worker_tool_registry(
    image_read: bool,
) -> Result<kernel::ToolRegistry, kernel::ToolRegistryError> {
    let registry = kernel::ToolRegistry::builder()
        .register(ReadTool { image_read })
        .register(LegacyDirectTool::<1>)
        .register(LegacyDirectTool::<2>)
        .register(LegacyDirectTool::<3>)
        .register(LegacyDirectTool::<4>)
        .register(LegacyDirectTool::<5>)
        .register(LegacyDirectTool::<6>)
        .register(LegacyDirectTool::<7>)
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
mod discovery_tool_definition_tests {
    use super::{
        direct_tool_definitions, kernel, worker_tool_definitions, worker_tool_registry, ReadTool,
    };
    use std::collections::HashSet;
    use std::sync::Arc;

    #[test]
    fn every_worker_receives_complete_glob_and_grep_definitions_once() {
        let definitions = worker_tool_definitions(false);
        for name in ["glob", "grep"] {
            let matches: Vec<_> = definitions
                .iter()
                .filter(|definition| definition.function.name == name)
                .collect();
            assert_eq!(matches.len(), 1, "{name} must be defined exactly once");
            let schema = &matches[0].function.parameters;
            assert_eq!(schema["type"], "object");
            assert_eq!(schema["additionalProperties"], false);
            assert!(schema["required"]
                .as_array()
                .expect("required array")
                .iter()
                .any(|value| value == "pattern"));
            assert_eq!(schema["properties"]["limit"]["maximum"], 1000);
            assert!(schema["properties"]["cursor"].is_object());
        }

        let grep = definitions
            .iter()
            .find(|definition| definition.function.name == "grep")
            .expect("grep definition");
        assert_eq!(
            grep.function.parameters["properties"]["case"]["enum"],
            serde_json::json!(["smart", "sensitive", "insensitive"])
        );
        for property in [
            "roots",
            "regex",
            "case",
            "globs",
            "context",
            "multiline",
            "gitignore",
            "hidden",
            "limit",
            "cursor",
        ] {
            assert!(
                grep.function.parameters["properties"][property].is_object(),
                "missing grep property {property}"
            );
        }
    }

    #[tokio::test]
    async fn model_execution_cannot_invoke_a_tool_outside_its_capability_snapshot() {
        let mut runtime = super::test_runtime();
        runtime.allowed_tools = Some(Arc::new(HashSet::from(["read".to_string()])));
        let result = super::execute_tool(
            "thread",
            serde_json::json!({"name":"escape","action":"must not run"}),
            &runtime,
            &crate::model::ModelClient::new_for_test(),
        )
        .await;
        assert!(result.is_error);
        assert_eq!(
            result.content.as_text(),
            Some("Error: unknown tool 'thread' is not available to this agent")
        );
        assert!(runtime.active_threads.names().is_empty());

        runtime.web_credential = Some(Arc::new(super::web::ExaCredential::new(
            "snapshot-only-canary".to_string(),
        )));
        let hidden = super::execute_tool(
            "web_search",
            serde_json::json!({"query":"must not reach Exa"}),
            &runtime,
            &crate::model::ModelClient::new_for_test(),
        )
        .await;
        assert!(hidden.is_error);
        assert_eq!(
            hidden.content.as_text(),
            Some("Error: unknown tool 'web_search' is not available to this agent")
        );

        runtime.allowed_tools = Some(Arc::new(HashSet::from(["web_search".to_string()])));
        runtime.web_credential = None;
        let missing_snapshot_credential = super::execute_tool(
            "web_search",
            serde_json::json!({"query":"must not reach Exa"}),
            &runtime,
            &crate::model::ModelClient::new_for_test(),
        )
        .await;
        assert!(missing_snapshot_credential.is_error);
        assert_eq!(
            missing_snapshot_credential.content.as_text(),
            Some("Error: web_search is unavailable in this capability snapshot")
        );
    }

    #[test]
    fn read_description_advertises_images_only_when_supported() {
        let description = |image_read| {
            worker_tool_definitions(image_read)
                .into_iter()
                .find(|definition| definition.function.name == "read")
                .unwrap()
                .function
                .description
        };
        assert!(description(true).contains("PNG"));
        assert!(!description(false).contains("image"));
    }

    #[test]
    fn worker_registry_preserves_definition_order_and_declares_admission() {
        let registry = worker_tool_registry(false).unwrap();
        let snapshot = registry
            .snapshot(super::WORKER_TOOL_NAMES)
            .expect("complete worker capabilities");
        assert_eq!(
            snapshot
                .definitions()
                .into_iter()
                .map(|definition| definition.function.name)
                .collect::<Vec<_>>(),
            super::WORKER_TOOL_NAMES
        );
        let admissions = snapshot
            .descriptors_for_test()
            .into_iter()
            .map(|descriptor| (descriptor.definition.function.name, descriptor.admission))
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(admissions["read"], kernel::ToolAdmission::Parallel);
        assert_eq!(admissions["glob"], kernel::ToolAdmission::Parallel);
        assert_eq!(admissions["write"], kernel::ToolAdmission::Exclusive);
        assert_eq!(admissions["exec_command"], kernel::ToolAdmission::Exclusive);
    }

    #[test]
    fn exec_binding_rewrites_authorized_paths_and_workdir_into_the_invocation() {
        let mut input = serde_json::json!({
            "cmd": "rg needle outside-link/secret",
            "workdir": "/workspace-link"
        });
        let resources = vec![
            kernel::PermissionResource::new("execute", "command:[rg][needle][outside-link/secret]"),
            kernel::PermissionResource::new("execute_path", "/outside/secret"),
            kernel::PermissionResource::new("external_directory", "/outside/secret"),
            kernel::PermissionResource::new("execute_cwd", "/workspace"),
        ];

        super::bind_legacy_authorized_resources(5, &mut input, &resources).unwrap();

        assert_eq!(input["cmd"], "rg needle /outside/secret");
        assert_eq!(input["workdir"], "/workspace");
    }

    #[test]
    fn direct_registries_preserve_exact_topology_capabilities() {
        let worker = worker_tool_definitions(false)
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>();
        let direct = direct_tool_definitions(false)
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>();
        let delegating = super::direct_with_orchestrator_tool_definitions(false)
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>();
        let direct_web = super::direct_tool_definitions_with_web(false, true)
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>();
        let delegating_web = super::direct_with_orchestrator_tool_definitions_with_web(false, true)
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>();
        assert_eq!(worker, super::WORKER_TOOL_NAMES);
        assert_eq!(direct, super::DIRECT_TOOL_NAMES);
        assert_eq!(delegating, super::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES);
        assert_eq!(&delegating[14..], super::ORCHESTRATOR_CONTROL_TOOL_NAMES);
        assert_eq!(&direct_web[..super::DIRECT_TOOL_NAMES.len()], &direct);
        assert_eq!(
            &direct_web[super::DIRECT_TOOL_NAMES.len()..],
            super::WEB_TOOL_NAMES
        );
        assert_eq!(
            &delegating_web[..super::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES.len()],
            &delegating
        );
        assert_eq!(
            &delegating_web[super::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES.len()..],
            super::WEB_TOOL_NAMES
        );
    }

    #[tokio::test]
    async fn registered_read_supports_native_and_model_boundary_calls() {
        let directory = std::env::temp_dir().join(format!("nac-kernel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("fixture.txt"), "native kernel\n").unwrap();
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = directory.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
        let client = crate::model::ModelClient::new_for_test();
        let registry = worker_tool_registry(false).unwrap();
        let handle = registry.native_handle::<ReadTool>().unwrap();
        let context = kernel::ToolCallContext::default();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };

        let native = handle
            .invoke(
                crate::tools::read::ReadInput::new("fixture.txt"),
                services,
                &context,
            )
            .await;
        assert!(!native.is_error, "{}", native.content);
        assert!(native.content.contains("native kernel"));

        let prepared = registry
            .snapshot(["read"])
            .unwrap()
            .prepare("read", serde_json::json!({"path":"fixture.txt"}), services)
            .unwrap();
        let canonical_fixture = directory.canonicalize().unwrap().join("fixture.txt");
        assert_eq!(
            prepared.permission_resources(),
            &[
                kernel::PermissionResource::new("read", canonical_fixture.display().to_string())
                    .with_save_resource(canonical_fixture.display().to_string())
            ]
        );
        let dynamic = prepared.invoke(services, &context).await;
        assert!(!dynamic.is_error, "{}", dynamic.content);
        assert!(dynamic.content.contains("native kernel"));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn approved_mutation_executes_against_the_bound_canonical_target() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "nac-bound-authorized-target-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let link = workspace.join("link");
        symlink(&first, &link).unwrap();

        let store_path = root.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session-a");
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            store_path.clone(),
            "session-a".to_string(),
            crate::permissions::PermissionBackend::Local,
            0,
            [crate::permissions::PermissionRule::new(
                "edit",
                "*",
                crate::permissions::PermissionEffect::Ask,
            )],
        ));
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = workspace.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace);
        runtime.store_path = store_path;
        runtime.session_id = Some("session-a".to_string());
        runtime.permission_broker = Some(Arc::clone(&broker));
        let client = crate::model::ModelClient::new_for_test();

        let call = super::execute_tool(
            "write",
            serde_json::json!({
                "path":"link/result.txt",
                "content":"bound\n",
                "expected_revision":null
            }),
            &runtime,
            &client,
        );
        let approve = async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    std::fs::remove_file(&link).unwrap();
                    symlink(&second, &link).unwrap();
                    broker
                        .reply(&request.id, crate::permissions::PermissionReply::Once)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        };
        let (result, ()) = tokio::join!(call, approve);
        assert!(!result.is_error, "{}", result.content);
        assert_eq!(
            std::fs::read_to_string(first.join("result.txt")).unwrap(),
            "bound\n"
        );
        assert!(!second.join("result.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn approved_mutation_rejects_an_ancestor_swap_after_resource_binding() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "nac-bound-authorized-swap-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let safe = workspace.join("safe");
        let git = workspace.join(".git");
        std::fs::create_dir_all(&safe).unwrap();
        std::fs::create_dir_all(&git).unwrap();
        let target = safe.canonicalize().unwrap().join("result.txt");
        let (entered, release) =
            crate::tools::mutation::gate_before_bound_local_open(target.clone());

        let store_path = root.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session-a");
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            store_path.clone(),
            "session-a".to_string(),
            crate::permissions::PermissionBackend::Local,
            0,
            [crate::permissions::PermissionRule::new(
                "edit",
                "*",
                crate::permissions::PermissionEffect::Ask,
            )],
        ));
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = workspace.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace);
        runtime.store_path = store_path;
        runtime.session_id = Some("session-a".to_string());
        runtime.permission_broker = Some(Arc::clone(&broker));
        let client = crate::model::ModelClient::new_for_test();

        let attack_broker = Arc::clone(&broker);
        let attack_workspace = workspace.clone();
        let attack_safe = safe.clone();
        let attack_git = git.clone();
        let attack = std::thread::spawn(move || {
            let request = loop {
                if let Some(request) = attack_broker.pending().pop() {
                    break request;
                }
                std::thread::yield_now();
            };
            attack_broker
                .reply(&request.id, crate::permissions::PermissionReply::Once)
                .unwrap();
            entered.recv().unwrap();
            std::fs::rename(&attack_safe, attack_workspace.join("safe-before-swap")).unwrap();
            symlink(&attack_git, &attack_safe).unwrap();
            release.send(()).unwrap();
        });
        let result = super::execute_tool(
            "write",
            serde_json::json!({
                "path":"safe/result.txt",
                "content":"must not escape\n",
                "expected_revision":null
            }),
            &runtime,
            &client,
        )
        .await;
        attack.join().unwrap();
        assert!(result.is_error, "{}", result.content);
        assert!(!git.join("result.txt").exists());
        assert!(!workspace.join("safe-before-swap/result.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn prepared_builtin_calls_project_validated_correlated_permission_resources() {
        let directory =
            std::env::temp_dir().join(format!("nac-kernel-resources-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = directory.clone();
        runtime.store_path = directory.join("store.db");
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
        let client = crate::model::ModelClient::new_for_test();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let registry = worker_tool_registry(false).unwrap();
        let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();

        let write = snapshot
            .prepare(
                "write",
                serde_json::json!({
                    "path":".git/config",
                    "content":"unsafe",
                    "expected_revision":null
                }),
                services,
            )
            .unwrap();
        assert_eq!(write.permission_resources()[0].action, "edit");
        assert!(write.permission_resources()[0].hard_denial.is_some());

        let shell = snapshot
            .prepare(
                "exec_command",
                serde_json::json!({"cmd":"git status --short && cargo test -p nac-core"}),
                services,
            )
            .unwrap();
        assert_eq!(
            shell
                .permission_resources()
                .iter()
                .map(|resource| resource.resource.clone())
                .collect::<Vec<_>>(),
            vec![
                "command:[git][status][--short]".to_string(),
                "command:[git][status][--short]".to_string(),
                "command:[cargo][test][-p][nac-core]".to_string(),
                "command:[cargo][test][-p][nac-core]".to_string(),
                directory.canonicalize().unwrap().display().to_string(),
            ]
        );

        let invalid = snapshot
            .prepare(
                "glob",
                serde_json::json!({"pattern":"*", "root": 7}),
                services,
            )
            .err()
            .expect("invalid permission-relevant root must fail before authorization");
        assert!(invalid.is_error);
        for (tool, input) in [
            (
                "write",
                serde_json::json!({"path":"file", "expected_revision":null}),
            ),
            (
                "edit",
                serde_json::json!({"path":"file", "expected_revision":"rev", "edits":[]}),
            ),
            ("glob", serde_json::json!({"pattern":"", "root":"."})),
            (
                "grep",
                serde_json::json!({"pattern":"needle", "roots":[], "context":101}),
            ),
            (
                "exec_command",
                serde_json::json!({"cmd":"git status", "tty":"yes"}),
            ),
            (
                "write_stdin",
                serde_json::json!({"session_id":"shell-test", "retain":"yes"}),
            ),
            (
                "write_stdin",
                serde_json::json!({
                    "session_id":"shell-test",
                    "chars":"answer<RET>",
                    "retain":true
                }),
            ),
            (
                "read_command_output",
                serde_json::json!({"output_id":"output", "limit":0}),
            ),
        ] {
            let error = snapshot
                .prepare(tool, input, services)
                .err()
                .unwrap_or_else(|| panic!("{tool} must fully decode before authorization"));
            assert!(error.is_error, "{tool}: {}", error.content);
        }

        for (tool, input) in [
            (
                "exec_command",
                serde_json::json!({"cmd":"git status", "unknown":true}),
            ),
            (
                "write_stdin",
                serde_json::json!({"session_id":"shell-test", "unknown":true}),
            ),
            (
                "read_command_output",
                serde_json::json!({"output_id":"output", "unknown":true}),
            ),
        ] {
            let error = snapshot
                .prepare(tool, input, services)
                .err()
                .unwrap_or_else(|| panic!("{tool} must reject unknown input before authorization"));
            assert!(error.is_error, "{tool}: {}", error.content);
        }

        let observe = snapshot
            .prepare(
                "write_stdin",
                serde_json::json!({"session_id":"shell-test", "chars":""}),
                services,
            )
            .unwrap();
        assert_eq!(observe.permission_resources()[0].action, "terminal_observe");
        let input = snapshot
            .prepare(
                "write_stdin",
                serde_json::json!({"session_id":"shell-test", "chars":"help<RET>"}),
                services,
            )
            .unwrap();
        assert_eq!(input.permission_resources()[0].action, "terminal_input");
        assert!(input.permission_resources()[0].hard_denial.is_some());
        let retain = snapshot
            .prepare(
                "write_stdin",
                serde_json::json!({
                    "session_id":"shell-test",
                    "chars":"",
                    "retain":true
                }),
                services,
            )
            .unwrap();
        assert_eq!(retain.permission_resources()[0].action, "terminal_retain");
        assert!(retain.permission_resources()[0].hard_denial.is_none());
        let interactive_shell = snapshot
            .prepare(
                "exec_command",
                serde_json::json!({"cmd":"bash", "tty":true}),
                services,
            )
            .unwrap();
        assert!(interactive_shell
            .permission_resources()
            .iter()
            .any(|resource| resource.hard_denial.is_some()));
        let bounded_pty = snapshot
            .prepare(
                "exec_command",
                serde_json::json!({"cmd":"cargo test", "tty":true}),
                services,
            )
            .unwrap();
        assert!(bounded_pty
            .permission_resources()
            .iter()
            .any(|resource| resource.hard_denial.is_some()));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn brokerless_worker_model_calls_still_enforce_native_hard_denials() {
        let directory =
            std::env::temp_dir().join(format!("nac-worker-hard-denial-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = directory.clone();
        runtime.store_path = directory.join("store.db");
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
        assert!(runtime.permission_broker.is_none());
        let client = crate::model::ModelClient::new_for_test();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let registry = worker_tool_registry(false).unwrap();
        let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();
        let context = kernel::ToolCallContext {
            call_id: Some("call-worker-denied".to_string()),
            thread_name: Some("worker".to_string()),
        };

        for (tool, input, denial) in [
            (
                "write_stdin",
                serde_json::json!({"session_id":"shell-test", "chars":"help<RET>"}),
                "nonempty terminal input is unavailable to brokerless workers",
            ),
            (
                "exec_command",
                serde_json::json!({"cmd":"bash", "tty":true}),
                "interactive opaque commands and broad interpreters are unavailable to brokerless workers",
            ),
        ] {
            let result = snapshot.invoke(tool, input, services, &context).await;
            assert!(result.is_error, "{tool} unexpectedly executed");
            assert!(
                result.content.to_string().contains(denial),
                "{tool}: {}",
                result.content
            );
        }
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn direct_terminal_input_requires_once_only_approval_for_the_exact_handle() {
        let root = std::env::temp_dir().join(format!(
            "nac-direct-terminal-input-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session-a");
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            store_path.clone(),
            "session-a".to_string(),
            crate::permissions::PermissionBackend::Local,
            0,
            [
                crate::permissions::PermissionRule::new(
                    "execute",
                    "*",
                    crate::permissions::PermissionEffect::Allow,
                ),
                crate::permissions::PermissionRule::new(
                    "execute_opaque",
                    "*",
                    crate::permissions::PermissionEffect::Allow,
                ),
            ],
        ));
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.store_path = store_path;
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
        runtime.session_id = Some("session-a".to_string());
        runtime.permission_broker = Some(Arc::clone(&broker));
        let client = crate::model::ModelClient::new_for_test();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let registry = worker_tool_registry(false).unwrap();
        let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();
        let context = kernel::ToolCallContext {
            call_id: Some("call-terminal-input".to_string()),
            thread_name: None,
        };

        let started = snapshot
            .invoke(
                "exec_command",
                serde_json::json!({
                    "cmd":"read value; printf 'got:%s\\n' \"$value\"",
                    "tty":true,
                    "yield_time_ms":50
                }),
                services,
                &context,
            )
            .await;
        assert!(!started.is_error, "{}", started.content);
        let started: serde_json::Value =
            serde_json::from_str(started.content.as_text().unwrap()).unwrap();
        let handle = started["session_name"].as_str().unwrap().to_string();

        let input = snapshot.invoke(
            "write_stdin",
            serde_json::json!({
                "session_id":handle,
                "chars":"answer<RET>",
                "yield_time_ms":2_000
            }),
            services,
            &context,
        );
        let approve = async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    assert_eq!(request.resources.len(), 1);
                    assert_eq!(request.resources[0].action, "terminal_input");
                    assert_eq!(request.resources[0].resource, handle);
                    assert!(request.resources[0].display.contains("local backend"));
                    assert!(request.resources[0].display.contains("\"answer<RET>\""));
                    assert!(request.resources[0].save_resource.is_none());
                    broker
                        .reply(&request.id, crate::permissions::PermissionReply::Always)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        };
        let (continued, ()) = tokio::join!(input, approve);
        assert!(!continued.is_error, "{}", continued.content);
        assert!(continued.content.to_string().contains("got:answer"));
        assert!(broker.grants().unwrap().is_empty());
        runtime.terminal_manager.remove_all().await.unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn brokerless_opaque_redirect_cannot_mutate_git_through_a_symlink() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "nac-worker-opaque-redirect-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/config"), "original\n").unwrap();
        symlink(root.join(".git/config"), root.join("config-link")).unwrap();
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.store_path = root.join("store.db");
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
        assert!(runtime.permission_broker.is_none());
        let client = crate::model::ModelClient::new_for_test();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let registry = worker_tool_registry(false).unwrap();
        let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();
        let result = snapshot
            .invoke(
                "exec_command",
                serde_json::json!({"cmd":"printf pwned > config-link"}),
                services,
                &kernel::ToolCallContext::default(),
            )
            .await;
        assert!(result.is_error, "opaque redirect unexpectedly executed");
        assert!(result.content.to_string().contains("redirection"));
        assert_eq!(
            std::fs::read_to_string(root.join(".git/config")).unwrap(),
            "original\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn brokerless_direct_shell_path_fails_before_process_side_effects() {
        let root = std::env::temp_dir().join(format!(
            "nac-worker-shell-path-denial-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join("safe")).unwrap();
        let target = root.join("safe/config");
        std::fs::write(&target, "original\n").unwrap();
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.store_path = root.join("store.db");
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
        let client = crate::model::ModelClient::new_for_test();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let registry = worker_tool_registry(false).unwrap();
        let result = registry
            .snapshot(super::WORKER_TOOL_NAMES)
            .unwrap()
            .invoke(
                "exec_command",
                serde_json::json!({"cmd":"rm safe/config"}),
                services,
                &kernel::ToolCallContext::default(),
            )
            .await;
        assert!(result.is_error, "direct shell path unexpectedly executed");
        assert!(result
            .content
            .to_string()
            .contains("concurrent ancestor replacement"));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "original\n");
        let _ = std::fs::remove_dir_all(root);
    }
}

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
