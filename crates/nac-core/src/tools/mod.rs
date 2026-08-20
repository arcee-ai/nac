use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{Mutex, Notify};

use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::sandbox::ExecutionBackend;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::{ToolContent, ToolDefinition};

pub(crate) const REMOTE_FILE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(10);
const REMOTE_FILE_LOCK_BUSY_EXIT_CODE: i32 = 75;
const REMOTE_FILE_LOCK_BUSY_MARKER: &str = "NAC_FILE_LOCK_BUSY";

mod discovery;
pub mod edit;
pub mod exec_command;
pub mod glob;
pub mod grep;
pub(crate) mod mutation;
pub mod read;
pub mod thread;
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

#[derive(Clone, Default)]
pub(crate) struct ThreadCancellation {
    cancelled: Arc<AtomicBool>,
    activity: Arc<Notify>,
}

impl ThreadCancellation {
    pub(crate) fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::AcqRel) {
            self.activity.notify_waiters();
        }
    }

    pub(crate) fn reset(&self) {
        self.cancelled.store(false, Ordering::Release);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.activity.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Default)]
pub(crate) struct ActiveToolRegistry {
    count: AtomicUsize,
    next_id: AtomicU64,
    abortable: StdMutex<HashMap<u64, ThreadCancellation>>,
    activity: Notify,
}

impl ActiveToolRegistry {
    fn enter(self: &Arc<Self>, abortable: bool) -> (ActiveToolGuard, Option<ThreadCancellation>) {
        self.count.fetch_add(1, Ordering::AcqRel);
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let cancellation = abortable.then(ThreadCancellation::default);
        if let Some(cancellation) = cancellation.as_ref() {
            self.lock_abortable().insert(id, cancellation.clone());
        }
        (
            ActiveToolGuard {
                id,
                registry: Arc::clone(self),
            },
            cancellation,
        )
    }

    pub(crate) fn cancel_abortable(&self) {
        for cancellation in self.lock_abortable().values() {
            cancellation.cancel();
        }
    }

    pub(crate) async fn wait_for_shutdown(&self) {
        loop {
            let notified = self.activity.notified();
            if self.count.load(Ordering::Acquire) == 0 {
                break;
            }
            notified.await;
        }
    }

    fn lock_abortable(&self) -> std::sync::MutexGuard<'_, HashMap<u64, ThreadCancellation>> {
        self.abortable
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

struct ActiveToolGuard {
    id: u64,
    registry: Arc<ActiveToolRegistry>,
}

impl Drop for ActiveToolGuard {
    fn drop(&mut self) {
        self.registry.lock_abortable().remove(&self.id);
        self.registry.count.fetch_sub(1, Ordering::AcqRel);
        self.registry.activity.notify_waiters();
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
    cleanup_failures: Vec<String>,
    cancellation: ThreadCancellation,
    accepting: bool,
}

impl Default for ActiveThreadState {
    fn default() -> Self {
        Self {
            dispatches: HashMap::new(),
            cleanup_failures: Vec::new(),
            cancellation: ThreadCancellation::default(),
            accepting: true,
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

    pub fn begin_run(&self) -> bool {
        let mut state = self.lock();
        if !state.dispatches.is_empty() {
            return false;
        }
        state.cancellation = ThreadCancellation::default();
        state.cleanup_failures.clear();
        state.accepting = true;
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
    ) -> anyhow::Result<Option<crate::store::ThreadSteeringRecord>> {
        let state = self.lock();
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

    pub fn begin_cancellation(
        &self,
        steering_store: Option<(&Path, &str)>,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let targets = {
            let mut state = self.lock();
            state.accepting = false;
            state.cancellation.cancel();
            let targets = state
                .dispatches
                .values()
                .map(|dispatch| dispatch.dispatch_id.clone())
                .collect::<Vec<_>>();
            state
                .dispatches
                .retain(|_, dispatch| dispatch.state == ActiveThreadDispatchState::Running);
            targets
        };
        self.activity.notify_waiters();

        let mut expired = Vec::new();
        let mut steering_error = None;
        if let Some((store_path, session_id)) = steering_store {
            for dispatch_id in targets {
                match crate::store::expire_thread_steering(store_path, session_id, &dispatch_id) {
                    Ok(records) => expired.extend(records),
                    Err(error) if steering_error.is_none() => steering_error = Some(error),
                    Err(_) => {}
                }
            }
        }
        match steering_error {
            Some(error) => Err(error),
            None => Ok(expired),
        }
    }

    pub async fn wait_for_shutdown(&self) -> anyhow::Result<()> {
        loop {
            let notified = self.activity.notified();
            let completed = {
                let state = self.lock();
                state.dispatches.is_empty().then(|| {
                    if state.cleanup_failures.is_empty() {
                        Ok(())
                    } else {
                        Err(anyhow::anyhow!(state.cleanup_failures.join("\n")))
                    }
                })
            };
            if let Some(result) = completed {
                return result;
            }
            notified.await;
        }
    }

    pub(crate) fn record_cleanup_failure(&self, failure: String) {
        self.lock().cleanup_failures.push(failure);
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
    async fn cancellation_waits_for_running_dispatch_shutdown() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        assert!(registry.begin_run());
        assert!(registry.mark("worker", "dispatch"));
        let cancellation = registry.start("worker", "dispatch").unwrap();

        assert!(registry.begin_cancellation(None).unwrap().is_empty());
        assert!(cancellation.is_cancelled());
        assert!(registry.is_active("worker"));
        assert!(!registry.mark("late", "late-dispatch"));

        let waiting_registry = Arc::clone(&registry);
        let waiting = tokio::spawn(async move {
            waiting_registry.wait_for_shutdown().await.unwrap();
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        let missing = Path::new("/store/does/not/exist");
        assert!(registry
            .close(missing, "session", "worker", "dispatch")
            .is_err());
        waiting.await.unwrap();
        assert!(registry.names().is_empty());
    }

    #[tokio::test]
    async fn cancellation_waits_for_detached_tool_shutdown() {
        let registry = Arc::new(ActiveToolRegistry::default());
        let (active, _) = registry.enter(false);
        let waiting_registry = Arc::clone(&registry);
        let waiting = tokio::spawn(async move {
            waiting_registry.wait_for_shutdown().await;
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());

        drop(active);

        waiting.await.unwrap();
    }

    #[tokio::test]
    async fn cancellation_signals_abortable_tools_immediately() {
        assert!(tool_is_abortable("read"));
        assert!(tool_is_abortable("mcp__remote"));
        assert!(!tool_is_abortable("write"));
        assert!(!tool_is_abortable("glob"));
        assert!(!tool_is_abortable("grep"));
        assert!(!tool_is_abortable("thread"));
        let registry = Arc::new(ActiveToolRegistry::default());
        let (active, cancellation) = registry.enter(true);
        let cancellation = cancellation.unwrap();

        registry.cancel_abortable();

        tokio::time::timeout(Duration::from_secs(1), cancellation.cancelled())
            .await
            .expect("abortable tool did not receive cancellation");
        drop(active);
        registry.wait_for_shutdown().await;
    }

    #[test]
    fn command_cancellation_can_reset_for_session_reuse() {
        let cancellation = ThreadCancellation::default();
        cancellation.cancel();
        assert!(cancellation.is_cancelled());

        cancellation.reset();

        assert!(!cancellation.is_cancelled());
    }

    #[test]
    fn stale_close_cannot_remove_same_name_replacement() {
        let registry = ActiveThreadRegistry::default();
        assert!(registry.begin_run());
        assert!(registry.mark("worker", "dispatch-old"));
        let missing = Path::new("/store/does/not/exist");
        assert!(registry
            .close(missing, "session", "worker", "dispatch-old")
            .is_err());

        assert!(registry.begin_run());
        assert!(registry.mark("worker", "dispatch-new"));
        assert!(registry
            .close(missing, "session", "worker", "dispatch-old")
            .unwrap()
            .is_empty());
        assert!(registry.is_active("worker"));
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
    pub active_tools: Arc<ActiveToolRegistry>,
    pub command_cancellation: ThreadCancellation,
    pub thread_timeout_secs: u64,
    /// Accumulated worker token usage from thread dispatches.  The agent
    /// loop reads and resets this after each tool-execution round so worker
    /// API costs are included in the session totals.  `orchestrator_context_tokens` is
    /// intentionally NOT accumulated here — it stays orchestrator-only.
    pub worker_usage: Arc<Mutex<crate::model::TokenUsage>>,
    /// Light worker model client; `None` keeps single-model dispatch.
    pub light_client: Option<Arc<crate::model::ModelClient>>,
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

pub fn worker_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    use serde_json::json;

    let mut tools = vec![
        def(
            "read",
            if image_read {
                "Read and view UTF-8 text or supported PNG, JPEG, WebP, and static GIF image files. Text results include complete-file revision metadata; pass next_offset to continue text files."
            } else {
                "Read UTF-8 file content and return JSON metadata including the complete-file revision. Pass next_offset to continue."
            },
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "offset": { "type": "integer", "minimum": 0, "description": "Zero-based line offset (optional; text files only)" },
                    "limit": { "type": "integer", "minimum": 1, "description": "Maximum lines to read (optional, default 2000; text files only)" }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        ),
        def(
            "write",
            "Atomically create or replace a UTF-8 file. Use expected_revision null only to create a missing file; replacing requires the revision from read.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "content": { "type": "string", "description": "Complete content to write" },
                    "expected_revision": {
                        "type": ["string", "null"],
                        "description": "Revision from read to replace an existing file, or null to create only"
                    }
                },
                "required": ["path", "content", "expected_revision"],
                "additionalProperties": false
            }),
        ),
        def(
            "edit",
            "Atomically apply one or more exact, non-overlapping replacements against one file revision. On stale_revision, read again and retry the complete batch.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "expected_revision": { "type": "string", "description": "Complete-file revision from read" },
                    "edits": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": { "type": "string", "minLength": 1, "description": "Exact text from the original revision" },
                                "new_text": { "type": "string", "description": "Replacement text" }
                            },
                            "required": ["old_text", "new_text"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["path", "expected_revision", "edits"],
                "additionalProperties": false
            }),
        ),
    ];
    tools.push(glob::definition());
    tools.push(grep::definition());

    tools.push(exec_command::exec_command_definition());
    tools.push(exec_command::write_stdin_definition());
    tools.push(exec_command::read_command_output_definition());

    tools
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

fn def(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: crate::types::FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
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
fn tool_is_abortable(name: &str) -> bool {
    !matches!(
        name,
        "write" | "edit" | "glob" | "grep" | "thread" | "thread_delete" | "workset_define"
    )
}

pub async fn execute_tool(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
) -> ToolResult {
    let runtime = runtime.clone();
    let client = client.clone();
    let name = name.to_string();
    let abortable = tool_is_abortable(&name);
    let (active, cancellation) = runtime.active_tools.enter(abortable);
    let task = tokio::spawn(async move {
        let _active = active;
        if let Some(cancellation) = cancellation {
            tokio::select! {
                _ = cancellation.cancelled() => ToolResult::text(
                    crate::types::TOOL_CALL_CANCELLED_MARKER,
                    true,
                ),
                result = execute_tool_inner(&name, args, &runtime, &client) => result,
            }
        } else {
            execute_tool_inner(&name, args, &runtime, &client).await
        }
    });
    match task.await {
        Ok(result) => result,
        Err(error) => ToolResult {
            content: (format!("Tool task failed: {error}")).into(),
            is_error: true,
        },
    }
}

async fn execute_tool_inner(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
) -> ToolResult {
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

    match name {
        "read" => read::execute(args, runtime, client.supports_image_tool_results()).await,
        "write" => write::execute(args, runtime).await,
        "edit" => edit::execute(args, runtime).await,
        "glob" => glob::execute(args, runtime).await,
        "grep" => grep::execute(args, runtime).await,
        "exec_command" => exec_command::execute_exec_command(&args, runtime).await,
        "write_stdin" => exec_command::execute_write_stdin(&args, runtime).await,
        "read_command_output" => exec_command::execute_read_command_output(&args, runtime),
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
    use super::worker_tool_definitions;

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
        active_tools: Arc::new(crate::tools::ActiveToolRegistry::default()),
        thread_timeout_secs: thread::DEFAULT_THREAD_TIMEOUT_SECS,
        worker_usage: Arc::new(Mutex::new(crate::model::TokenUsage::default())),
        light_client: None,
    }
}
