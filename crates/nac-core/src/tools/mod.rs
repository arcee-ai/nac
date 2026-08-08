use std::collections::{HashMap, HashSet, VecDeque};
#[cfg(unix)]
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use fs2::FileExt;
use serde_json::Value;
use tokio::sync::{Mutex, Notify};
use tokio::task::AbortHandle;

use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::sandbox::ExecutionBackend;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::ToolDefinition;

const FILE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(1);
pub(crate) const REMOTE_FILE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(10);
const REMOTE_FILE_LOCK_BUSY_EXIT_CODE: i32 = 75;
const REMOTE_FILE_LOCK_BUSY_MARKER: &str = "NAC_FILE_LOCK_BUSY";

pub mod edit;
pub mod exec_command;
pub mod read;
pub mod thread;
pub mod workset;
pub mod write;

#[cfg(test)]
mod file_lock_benchmark;

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
    cancellation: ThreadCancellation,
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

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let activity = self.activity.notified();
            if self.is_cancelled() {
                return;
            }
            activity.await;
        }
    }
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
            live_thread_updates: AtomicBool::new(false),
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
                    cancellation: ThreadCancellation::default(),
                },
            );
            true
        }
    }

    pub(crate) fn cancellation(
        &self,
        thread_name: &str,
        dispatch_id: &str,
    ) -> Option<ThreadCancellation> {
        self.lock()
            .dispatches
            .get(thread_name)
            .filter(|dispatch| dispatch.dispatch_id == dispatch_id)
            .map(|dispatch| dispatch.cancellation.clone())
    }

    pub(crate) fn cancel(&self, thread_name: &str) -> bool {
        let cancellation = self
            .lock()
            .dispatches
            .get(thread_name)
            .map(|dispatch| dispatch.cancellation.clone());
        if let Some(cancellation) = cancellation {
            cancellation.cancel();
            true
        } else {
            false
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

    pub(crate) fn forget_completion(&self, thread_name: &str) {
        self.lock()
            .completions
            .retain(|completion| completion.thread_name != thread_name);
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
                    dispatch.cancellation.clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        let mut first_error = None;
        for (name, dispatch_id, abort_handle, cancellation) in targets {
            cancellation.cancel();
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

pub(crate) fn resolve_workspace_path(runtime: &ToolRuntime, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        runtime.workspace_cwd.join(path)
    }
}

#[derive(Clone, Copy)]
pub(crate) enum FileLockAccess {
    Write,
    ReadWrite,
}

/// Opens and exclusively locks a target file for a complete mutation.
///
/// The advisory lock belongs to the file and is therefore shared by all NAC
/// sessions and worker processes that access the same filesystem object.
/// Acquisition is polled so cancellation drops the file handle instead of
/// leaving a blocking-pool task that can acquire the lock and mutate later.
pub(crate) async fn open_locked_file(
    path: PathBuf,
    create: bool,
    access: FileLockAccess,
) -> io::Result<File> {
    let file = tokio::task::spawn_blocking(move || {
        let mut options = OpenOptions::new();
        options.write(true).create(create);
        if matches!(access, FileLockAccess::ReadWrite) {
            options.read(true);
        }
        options.open(path)
    })
    .await
    .map_err(|error| io::Error::other(format!("file-open task failed: {error}")))??;
    lock_file(file).await
}

/// Opens a mounted host file without following symlinks beneath the mount root.
///
/// `None` asks the caller to preserve guest symlink semantics by using remote
/// execution instead. Directory descriptors keep the traversal confined even
/// if a sandbox process swaps a later path component during the open.
pub(crate) async fn open_locked_file_beneath(
    root: PathBuf,
    relative: PathBuf,
    create_parents: bool,
    create_file: bool,
    access: FileLockAccess,
) -> io::Result<Option<File>> {
    let file = tokio::task::spawn_blocking(move || {
        open_file_beneath(root, relative, create_parents, create_file, access)
    })
    .await
    .map_err(|error| io::Error::other(format!("mounted file-open task failed: {error}")))??;
    match file {
        Some(file) => lock_file(file).await.map(Some),
        None => Ok(None),
    }
}

async fn lock_file(file: File) -> io::Result<File> {
    loop {
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                tokio::time::sleep(FILE_LOCK_POLL_INTERVAL).await;
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(unix)]
fn open_file_beneath(
    root: PathBuf,
    relative: PathBuf,
    create_parents: bool,
    create_file: bool,
    access: FileLockAccess,
) -> io::Result<Option<File>> {
    if relative.as_os_str().is_empty() {
        return open_mount_root(root, access);
    }

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut directory = options.open(root)?;
    let mut components = relative.components().peekable();

    while let Some(component) = components.next() {
        let std::path::Component::Normal(part) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "mounted file path must be relative",
            ));
        };
        let name = CString::new(part.as_bytes()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "mounted file path contains a NUL byte",
            )
        })?;

        if components.peek().is_none() {
            return open_file_at(&directory, &name, create_file, access);
        }

        match open_directory_at(&directory, &name) {
            Ok(next) => directory = next,
            Err(error) if is_symlink_or_non_directory(&error) => return Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound && create_parents => {
                let result = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o777) };
                if result == -1 {
                    let error = io::Error::last_os_error();
                    if error.kind() != io::ErrorKind::AlreadyExists {
                        return Err(error);
                    }
                }
                match open_directory_at(&directory, &name) {
                    Ok(next) => directory = next,
                    Err(error) if is_symlink_or_non_directory(&error) => return Ok(None),
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "mounted file path does not name a file",
    ))
}

#[cfg(unix)]
fn open_mount_root(root: PathBuf, access: FileLockAccess) -> io::Result<Option<File>> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    if matches!(access, FileLockAccess::ReadWrite) {
        options.read(true);
    }
    match options.open(root) {
        Ok(file) => Ok(Some(file)),
        Err(error) if is_symlink_or_non_directory(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn open_directory_at(directory: &File, name: &CString) -> io::Result<File> {
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_file_at(
    directory: &File,
    name: &CString,
    create: bool,
    access: FileLockAccess,
) -> io::Result<Option<File>> {
    let access_flag = match access {
        FileLockAccess::Write => libc::O_WRONLY,
        FileLockAccess::ReadWrite => libc::O_RDWR,
    };
    let create_flag = if create { libc::O_CREAT } else { 0 };
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            access_flag | create_flag | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o666,
        )
    };
    if descriptor == -1 {
        let error = io::Error::last_os_error();
        return if is_symlink_or_non_directory(&error) {
            Ok(None)
        } else {
            Err(error)
        };
    }
    Ok(Some(unsafe { File::from_raw_fd(descriptor) }))
}

#[cfg(unix)]
fn is_symlink_or_non_directory(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code) if code == libc::ELOOP || code == libc::ENOTDIR
    )
}

#[cfg(not(unix))]
fn open_file_beneath(
    _root: PathBuf,
    _relative: PathBuf,
    _create_parents: bool,
    _create_file: bool,
    _access: FileLockAccess,
) -> io::Result<Option<File>> {
    Ok(None)
}

pub(crate) fn remote_file_lock_busy(output: &std::process::Output) -> bool {
    output.status.code() == Some(REMOTE_FILE_LOCK_BUSY_EXIT_CODE)
        && String::from_utf8_lossy(&output.stdout).trim() == REMOTE_FILE_LOCK_BUSY_MARKER
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

#[cfg(test)]
mod live_thread_update_tests {
    use super::ActiveThreadRegistry;

    #[test]
    fn new_registry_buffers_thread_updates_by_default() {
        assert!(!ActiveThreadRegistry::default().live_thread_updates());
    }
}

#[cfg(test)]
mod file_lock_tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn file_lock_process_helper() {
        let Some(target) = std::env::var_os("NAC_TEST_FILE_LOCK_TARGET") else {
            return;
        };
        let ready = PathBuf::from(std::env::var_os("NAC_TEST_FILE_LOCK_READY").unwrap());
        let locked = OpenOptions::new()
            .write(true)
            .create(true)
            .open(Path::new(&target))
            .unwrap();
        FileExt::lock_exclusive(&locked).unwrap();
        std::fs::write(ready, b"ready").unwrap();
        thread::sleep(Duration::from_secs(30));
    }

    #[tokio::test]
    async fn mutation_locks_are_cross_process_and_per_file() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "nac_file_mutation_lock_{}_{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target.txt");
        let unrelated = dir.join("unrelated.txt");
        let ready = dir.join("ready");

        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::file_lock_tests::file_lock_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_FILE_LOCK_TARGET", &target)
            .env("NAC_TEST_FILE_LOCK_READY", &ready)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        for _ in 0..200 {
            if ready.exists() {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "file-lock helper exited early"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready.exists(), "file-lock helper never became ready");

        let same_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&target)
            .unwrap();
        let contention = FileExt::try_lock_exclusive(&same_file);
        assert!(
            matches!(contention, Err(error) if error.kind() == io::ErrorKind::WouldBlock),
            "same file should be locked by the other process"
        );

        let unrelated_file = open_locked_file(unrelated, true, FileLockAccess::Write)
            .await
            .expect("an unrelated file must remain independently lockable");

        child.kill().unwrap();
        child.wait().unwrap();
        FileExt::try_lock_exclusive(&same_file)
            .expect("the target lock should be released when its process exits");

        drop(same_file);
        drop(unrelated_file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cancelling_a_waiter_releases_it_without_delayed_acquisition() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_cancelled_file_lock_{}_{unique}",
            std::process::id()
        ));
        let held = open_locked_file(path.clone(), true, FileLockAccess::Write)
            .await
            .unwrap();

        let waiter_path = path.clone();
        let waiter = tokio::spawn(async move {
            open_locked_file(waiter_path, true, FileLockAccess::Write).await
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        drop(held);

        let reacquired = tokio::time::timeout(
            Duration::from_secs(1),
            open_locked_file(path.clone(), true, FileLockAccess::Write),
        )
        .await
        .expect("a cancelled waiter must not acquire the lock later")
        .unwrap();
        drop(reacquired);
        let _ = std::fs::remove_file(path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_file_open_never_follows_a_symlinked_parent() {
        use std::os::unix::fs::symlink;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nac_mounted_file_open_{}_{unique}",
            std::process::id()
        ));
        let mount_root = root.join("mount");
        let outside = root.join("outside");
        std::fs::create_dir_all(&mount_root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, mount_root.join("escape")).unwrap();

        let opened = open_locked_file_beneath(
            mount_root,
            PathBuf::from("escape/file.txt"),
            true,
            true,
            FileLockAccess::Write,
        )
        .await
        .unwrap();

        assert!(opened.is_none());
        assert!(!outside.join("file.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_file_open_supports_a_single_file_mount_root() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_single_file_mount_{}_{unique}.txt",
            std::process::id()
        ));
        std::fs::write(&path, "before").unwrap();

        let opened = open_locked_file_beneath(
            path.clone(),
            PathBuf::new(),
            true,
            true,
            FileLockAccess::Write,
        )
        .await;

        let _ = std::fs::remove_file(path);
        assert!(matches!(opened, Ok(Some(_))));
    }
}
