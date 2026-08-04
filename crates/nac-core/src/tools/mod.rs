use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tokio::sync::{Mutex, Notify};
use tokio::task::AbortHandle;

use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::sandbox::ExecutionBackend;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::ToolDefinition;

pub mod edit;
pub mod exec_command;
pub mod read;
pub mod thread;
pub mod workset;
pub mod write;

#[derive(Debug, Clone)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadCompletion {
    pub thread_name: String,
    pub dispatch_id: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Default)]
struct ActiveThreadState {
    dispatches: HashMap<String, ActiveThreadDispatch>,
    completions: VecDeque<ThreadCompletion>,
}

struct ActiveThreadDispatch {
    dispatch_id: String,
    abort_handle: Option<AbortHandle>,
}

pub struct ActiveThreadRegistry {
    state: StdMutex<ActiveThreadState>,
    activity: Notify,
    live_thread_updates: AtomicBool,
}

impl Default for ActiveThreadRegistry {
    fn default() -> Self {
        Self {
            state: StdMutex::new(ActiveThreadState::default()),
            activity: Notify::new(),
            live_thread_updates: AtomicBool::new(true),
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

    pub fn matches(&self, thread_name: &str, dispatch_id: &str) -> bool {
        self.lock()
            .dispatches
            .get(thread_name)
            .is_some_and(|dispatch| dispatch.dispatch_id == dispatch_id)
    }

    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let mut state = self.lock();
        if state.dispatches.contains_key(thread_name) {
            false
        } else {
            state.dispatches.insert(
                thread_name.to_string(),
                ActiveThreadDispatch {
                    dispatch_id: dispatch_id.to_string(),
                    abort_handle: None,
                },
            );
            true
        }
    }

    pub fn attach_abort_handle(
        &self,
        thread_name: &str,
        dispatch_id: &str,
        abort_handle: AbortHandle,
    ) -> bool {
        let mut state = self.lock();
        let Some(dispatch) = state.dispatches.get_mut(thread_name) else {
            abort_handle.abort();
            return false;
        };
        if dispatch.dispatch_id != dispatch_id {
            abort_handle.abort();
            return false;
        }
        dispatch.abort_handle = Some(abort_handle);
        true
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

    #[cfg(test)]
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
        let expired = crate::store::expire_thread_steering(store_path, session_id, dispatch_id)?;
        state.dispatches.remove(thread_name);
        drop(state);
        self.activity.notify_one();
        Ok(expired)
    }

    pub fn complete(
        &self,
        store_path: &Path,
        session_id: &str,
        completion: ThreadCompletion,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        if state
            .dispatches
            .get(&completion.thread_name)
            .map(|dispatch| dispatch.dispatch_id.as_str())
            != Some(completion.dispatch_id.as_str())
        {
            return Ok(Vec::new());
        }
        let expired =
            crate::store::expire_thread_steering(store_path, session_id, &completion.dispatch_id);
        state.dispatches.remove(&completion.thread_name);
        state.completions.push_back(completion);
        drop(state);
        self.activity.notify_one();
        expired
    }

    pub fn take_completions(&self, thread_names: &HashSet<String>) -> Vec<ThreadCompletion> {
        let mut state = self.lock();
        if thread_names.is_empty() {
            return state.completions.drain(..).collect();
        }

        let mut matching = Vec::new();
        let mut retained = VecDeque::new();
        while let Some(completion) = state.completions.pop_front() {
            if thread_names.contains(&completion.thread_name) {
                matching.push(completion);
            } else {
                retained.push_back(completion);
            }
        }
        state.completions = retained;
        matching
    }

    pub fn has_completions(&self) -> bool {
        !self.lock().completions.is_empty()
    }

    pub fn active_names_matching(&self, thread_names: &HashSet<String>) -> Vec<String> {
        let state = self.lock();
        state
            .dispatches
            .keys()
            .filter(|name| thread_names.is_empty() || thread_names.contains(*name))
            .cloned()
            .collect()
    }

    pub fn signal_activity(&self) {
        self.activity.notify_one();
    }

    pub fn live_thread_updates(&self) -> bool {
        self.live_thread_updates.load(Ordering::Acquire)
    }

    pub fn set_live_thread_updates(&self, enabled: bool) {
        self.live_thread_updates.store(enabled, Ordering::Release);
        // A mode change must wake a parked thread_wait so switching from
        // all-at-once to live can immediately deliver buffered completions.
        self.activity.notify_one();
    }

    pub async fn wait_for_activity(&self) {
        self.activity.notified().await;
    }

    pub fn close_all(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        let targets = state
            .dispatches
            .iter()
            .map(|(name, dispatch)| {
                (
                    name.clone(),
                    dispatch.dispatch_id.clone(),
                    dispatch.abort_handle.clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        let mut first_error = None;
        for (name, dispatch_id, abort_handle) in targets {
            if let Some(abort_handle) = abort_handle {
                abort_handle.abort();
            }
            match crate::store::expire_thread_steering(store_path, session_id, &dispatch_id) {
                Ok(records) => expired.extend(records),
                Err(error) if first_error.is_none() => first_error = Some(error),
                Err(_) => {}
            }
            if state
                .dispatches
                .get(&name)
                .is_some_and(|dispatch| dispatch.dispatch_id == dispatch_id)
            {
                state.dispatches.remove(&name);
            }
        }
        state.completions.clear();
        drop(state);
        self.activity.notify_one();
        match first_error {
            Some(error) => Err(error),
            None => Ok(expired),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ActiveThreadState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
    pub thread_timeout_secs: u64,
    /// Accumulated worker token usage from thread dispatches.  The agent
    /// loop reads and resets this after each tool-execution round so worker
    /// API costs are included in the session totals.  `orchestrator_context_tokens` is
    /// intentionally NOT accumulated here — it stays orchestrator-only.
    pub worker_usage: Arc<Mutex<crate::model::TokenUsage>>,
}

static WRITE_LOCK: Mutex<()> = Mutex::const_new(());

pub(crate) fn resolve_workspace_path(runtime: &ToolRuntime, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        runtime.workspace_cwd.join(path)
    }
}

pub async fn acquire_write_lock() -> tokio::sync::MutexGuard<'static, ()> {
    WRITE_LOCK.lock().await
}

pub fn worker_tool_definitions() -> Vec<ToolDefinition> {
    use serde_json::json;

    let mut tools = vec![
        def(
            "read",
            "Read file contents with line numbers. Supports offset and limit.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "offset": { "type": "integer", "description": "Line number to start from (0-indexed, optional)" },
                    "limit": { "type": "integer", "description": "Max lines to read (optional, default 2000)" }
                },
                "required": ["path"]
            }),
        ),
        def(
            "write",
            "Write content to a file. Creates parent directories automatically.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }),
        ),
        def(
            "edit",
            "Replace exact text in a file.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "old_text": { "type": "string", "description": "Text to find and replace" },
                    "new_text": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        ),
    ];

    tools.push(exec_command::exec_command_definition());
    tools.push(exec_command::write_stdin_definition());

    tools
}

pub fn orchestrator_tool_definitions(skills: Option<&SkillRegistry>) -> Vec<ToolDefinition> {
    vec![
        thread::dispatch_definition(skills),
        thread::threads_definition(),
        thread::thread_wait_definition(),
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
            content: format!("Error: '{}' argument required", key),
            is_error: true,
        })
}

pub fn require_string_array(args: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };

    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: format!("Error: '{}' must be an array of strings", key),
            is_error: true,
        });
    };

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(value) = item.as_str() else {
            return Err(ToolResult {
                content: format!("Error: '{}' must be an array of strings", key),
                is_error: true,
            });
        };
        out.push(value.to_string());
    }

    Ok(out)
}

pub async fn execute_tool(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
) -> ToolResult {
    if name.starts_with("mcp__") {
        let Some(registry) = &runtime.mcp else {
            return ToolResult {
                content: format!("Error: MCP tool '{}' is not available", name),
                is_error: true,
            };
        };
        return registry.call_tool(name, args).await;
    }

    match name {
        "read" => read::execute(args, runtime).await,
        "write" => write::execute(args, runtime).await,
        "edit" => edit::execute(args, runtime).await,
        "exec_command" => match exec_command::execute_exec_command(&args, runtime).await {
            Ok(content) => ToolResult {
                content,
                is_error: false,
            },
            Err(e) => ToolResult {
                content: format!("Error: {:#}", e),
                is_error: true,
            },
        },
        "write_stdin" => match exec_command::execute_write_stdin(&args, runtime).await {
            Ok(content) => ToolResult {
                content,
                is_error: false,
            },
            Err(e) => ToolResult {
                content: format!("Error: {:#}", e),
                is_error: true,
            },
        },
        "thread" => thread::execute_dispatch(args, runtime, client).await,
        "threads" => thread::execute_threads(runtime).await,
        "thread_wait" => thread::execute_thread_wait(args, runtime).await,
        "thread_read" => thread::execute_thread_read(args, runtime).await,
        "thread_delete" => thread::execute_thread_delete(args, runtime).await,
        "workset_define" => workset::execute_define(args, runtime).await,
        "workset_read" => workset::execute_read(args, runtime).await,
        "workset_list" => workset::execute_list(args, runtime).await,
        unknown => ToolResult {
            content: format!("Error: unknown tool '{}'", unknown),
            is_error: true,
        },
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
    }
}
