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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use fs2::FileExt;
use serde_json::Value;
use tokio::sync::{Mutex, Notify};
use tokio::task::AbortHandle;

use crate::events::{EventSink, SessionRunId};
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

#[derive(Debug)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ThreadDispatchKey {
    pub run_id: SessionRunId,
    pub thread_name: String,
    pub dispatch_id: String,
    pub tool_call_id: String,
}

impl ThreadDispatchKey {
    pub fn new(
        run_id: SessionRunId,
        thread_name: impl Into<String>,
        dispatch_id: impl Into<String>,
        tool_call_id: impl Into<String>,
    ) -> Self {
        Self {
            run_id,
            thread_name: thread_name.into(),
            dispatch_id: dispatch_id.into(),
            tool_call_id: tool_call_id.into(),
        }
    }

    // Temporary bridge for the foreground DAG. Background dispatch integration
    // replaces this with authoritative run and model tool-call identities.
    fn foreground_compat(thread_name: &str, dispatch_id: &str) -> Self {
        Self::new(
            SessionRunId::from_string("foreground-compat".to_string()),
            thread_name,
            dispatch_id,
            dispatch_id,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadDispatchState {
    PendingDependency,
    Running,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveThreadDispatchSnapshot {
    pub key: ThreadDispatchKey,
    pub state: ThreadDispatchState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadCompletion {
    pub key: ThreadDispatchKey,
    pub content: String,
    pub is_error: bool,
}

struct ActiveThreadDispatch {
    key: ThreadDispatchKey,
    state: ThreadDispatchState,
    coordinator_abort: Option<AbortHandle>,
    worker_abort: Option<AbortHandle>,
}

#[derive(Default)]
struct ActiveThreadState {
    active_by_name: HashMap<String, ActiveThreadDispatch>,
    completions: VecDeque<ThreadCompletion>,
    shutting_down: bool,
}

#[allow(dead_code)] // Exact background APIs are wired by subsequent integration commits.
pub struct ActiveThreadRegistry {
    state: StdMutex<ActiveThreadState>,
    activity: Notify,
    activity_epoch: AtomicU64,
    live_thread_updates: AtomicBool,
}

impl Default for ActiveThreadRegistry {
    fn default() -> Self {
        Self {
            state: StdMutex::new(ActiveThreadState::default()),
            activity: Notify::new(),
            activity_epoch: AtomicU64::new(0),
            live_thread_updates: AtomicBool::new(false),
        }
    }
}

#[allow(dead_code)] // Exact background APIs are wired by subsequent integration commits.
impl ActiveThreadRegistry {
    pub fn names(&self) -> Vec<String> {
        self.lock().active_by_name.keys().cloned().collect()
    }

    pub fn active_dispatches(&self) -> Vec<ActiveThreadDispatchSnapshot> {
        self.lock()
            .active_by_name
            .values()
            .map(|dispatch| ActiveThreadDispatchSnapshot {
                key: dispatch.key.clone(),
                state: dispatch.state,
            })
            .collect()
    }

    pub fn is_active(&self, thread_name: &str) -> bool {
        self.lock().active_by_name.contains_key(thread_name)
    }

    pub fn matches(&self, key: &ThreadDispatchKey) -> bool {
        self.lock()
            .active_by_name
            .get(&key.thread_name)
            .is_some_and(|dispatch| dispatch.key == *key)
    }

    pub fn try_accept(&self, key: ThreadDispatchKey) -> bool {
        self.try_accept_batch(vec![key])
            .into_iter()
            .next()
            .unwrap_or(false)
    }

    /// Atomically reserve every available thread name in one parsed batch.
    /// The returned flags correspond to `keys`; a name already active (or a
    /// duplicate in the supplied batch) is rejected without allowing another
    /// launcher to interleave between reservations.
    pub fn try_accept_batch(&self, keys: Vec<ThreadDispatchKey>) -> Vec<bool> {
        let mut state = self.lock();
        let mut accepted_names = HashSet::new();
        let mut accepted = Vec::with_capacity(keys.len());
        for key in keys {
            let available = !state.shutting_down
                && !state.active_by_name.contains_key(&key.thread_name)
                && accepted_names.insert(key.thread_name.clone());
            if available {
                state.active_by_name.insert(
                    key.thread_name.clone(),
                    ActiveThreadDispatch {
                        key,
                        state: ThreadDispatchState::PendingDependency,
                        coordinator_abort: None,
                        worker_abort: None,
                    },
                );
            }
            accepted.push(available);
        }
        drop(state);
        if accepted.iter().any(|accepted| *accepted) {
            self.notify_activity();
        }
        accepted
    }

    pub fn mark_running(&self, key: &ThreadDispatchKey) -> bool {
        let mut state = self.lock();
        let Some(dispatch) = state.active_by_name.get_mut(&key.thread_name) else {
            return false;
        };
        if dispatch.key != *key {
            return false;
        }
        dispatch.state = ThreadDispatchState::Running;
        true
    }

    pub fn attach_coordinator(&self, key: &ThreadDispatchKey, abort: AbortHandle) -> bool {
        self.attach_abort(key, abort, false)
    }

    pub fn attach_worker(&self, key: &ThreadDispatchKey, abort: AbortHandle) -> bool {
        self.attach_abort(key, abort, true)
    }

    fn attach_abort(&self, key: &ThreadDispatchKey, abort: AbortHandle, worker: bool) -> bool {
        let mut state = self.lock();
        let Some(dispatch) = state.active_by_name.get_mut(&key.thread_name) else {
            abort.abort();
            return false;
        };
        if dispatch.key != *key {
            abort.abort();
            return false;
        }
        let slot = if worker {
            &mut dispatch.worker_abort
        } else {
            &mut dispatch.coordinator_abort
        };
        if let Some(previous) = slot.replace(abort) {
            previous.abort();
        }
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
        let Some(dispatch) = state.active_by_name.get(thread_name) else {
            return Ok(None);
        };
        crate::store::queue_thread_steering(
            store_path,
            session_id,
            thread_name,
            &dispatch.key.dispatch_id,
            instruction,
        )
        .map(Some)
    }

    pub fn close(
        &self,
        store_path: &Path,
        session_id: &str,
        key: &ThreadDispatchKey,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        if !state
            .active_by_name
            .get(&key.thread_name)
            .is_some_and(|dispatch| dispatch.key == *key)
        {
            return Ok(Vec::new());
        }
        let expired =
            crate::store::expire_thread_steering(store_path, session_id, &key.dispatch_id)?;
        state.active_by_name.remove(&key.thread_name);
        drop(state);
        self.notify_activity();
        Ok(expired)
    }

    pub fn complete(
        &self,
        store_path: &Path,
        session_id: &str,
        completion: ThreadCompletion,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        if !state
            .active_by_name
            .get(&completion.key.thread_name)
            .is_some_and(|dispatch| dispatch.key == completion.key)
        {
            return Ok(Vec::new());
        }
        let expired = crate::store::expire_thread_steering(
            store_path,
            session_id,
            &completion.key.dispatch_id,
        )?;
        state.active_by_name.remove(&completion.key.thread_name);
        state.completions.push_back(completion);
        drop(state);
        self.notify_activity();
        Ok(expired)
    }

    pub fn take_completions(
        &self,
        run_id: &SessionRunId,
        thread_names: &HashSet<String>,
    ) -> Vec<ThreadCompletion> {
        let mut state = self.lock();
        let mut matching = Vec::new();
        let mut retained = VecDeque::new();
        while let Some(completion) = state.completions.pop_front() {
            if completion.key.run_id == *run_id
                && (thread_names.is_empty() || thread_names.contains(&completion.key.thread_name))
            {
                matching.push(completion);
            } else {
                retained.push_back(completion);
            }
        }
        state.completions = retained;
        matching
    }

    pub fn active_for_run(
        &self,
        run_id: &SessionRunId,
        thread_names: &HashSet<String>,
    ) -> Vec<ActiveThreadDispatchSnapshot> {
        self.lock()
            .active_by_name
            .values()
            .filter(|dispatch| {
                dispatch.key.run_id == *run_id
                    && (thread_names.is_empty() || thread_names.contains(&dispatch.key.thread_name))
            })
            .map(|dispatch| ActiveThreadDispatchSnapshot {
                key: dispatch.key.clone(),
                state: dispatch.state,
            })
            .collect()
    }

    pub fn has_completions_for_run(&self, run_id: &SessionRunId) -> bool {
        self.lock()
            .completions
            .iter()
            .any(|completion| completion.key.run_id == *run_id)
    }

    /// Atomically observes whether a run still owns active work or buffered
    /// terminal results. Used by the agent finish guard and service invariant.
    pub fn has_work_for_run(&self, run_id: &SessionRunId) -> bool {
        let state = self.lock();
        state
            .active_by_name
            .values()
            .any(|dispatch| dispatch.key.run_id == *run_id)
            || state
                .completions
                .iter()
                .any(|completion| completion.key.run_id == *run_id)
    }

    pub fn live_thread_updates(&self) -> bool {
        self.live_thread_updates.load(Ordering::Acquire)
    }

    pub fn set_live_thread_updates(&self, enabled: bool) {
        self.live_thread_updates.store(enabled, Ordering::Release);
        self.notify_activity();
    }

    #[allow(dead_code)] // Used by guidance wakeup integration in a later commit.
    pub fn signal_activity(&self) {
        self.notify_activity();
    }

    pub fn activity_epoch(&self) -> u64 {
        self.activity_epoch.load(Ordering::Acquire)
    }

    pub async fn wait_for_activity_since(&self, observed: u64) {
        loop {
            let notified = self.activity.notified();
            if self.activity_epoch() != observed {
                return;
            }
            notified.await;
            if self.activity_epoch() != observed {
                return;
            }
        }
    }

    pub async fn wait_for_activity(&self) {
        let observed = self.activity_epoch();
        self.wait_for_activity_since(observed).await;
    }

    fn notify_activity(&self) {
        self.activity_epoch.fetch_add(1, Ordering::AcqRel);
        self.activity.notify_waiters();
    }

    pub fn abort_run(
        &self,
        store_path: &Path,
        session_id: &str,
        run_id: &SessionRunId,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        self.abort_matching(store_path, session_id, Some(run_id))
    }

    pub fn shutdown(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        {
            let mut state = self.lock();
            state.shutting_down = true;
        }
        self.abort_matching(store_path, session_id, None)
    }

    fn abort_matching(
        &self,
        store_path: &Path,
        session_id: &str,
        run_id: Option<&SessionRunId>,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        let keys = state
            .active_by_name
            .values()
            .filter(|dispatch| run_id.is_none_or(|run_id| dispatch.key.run_id == *run_id))
            .map(|dispatch| dispatch.key.clone())
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        let mut first_error = None;
        for key in keys {
            if let Some(dispatch) = state.active_by_name.remove(&key.thread_name) {
                if let Some(abort) = dispatch.worker_abort {
                    abort.abort();
                }
                if let Some(abort) = dispatch.coordinator_abort {
                    abort.abort();
                }
            }
            match crate::store::expire_thread_steering(store_path, session_id, &key.dispatch_id) {
                Ok(records) => expired.extend(records),
                Err(error) if first_error.is_none() => first_error = Some(error),
                Err(_) => {}
            }
        }
        state
            .completions
            .retain(|completion| run_id.is_some_and(|run_id| completion.key.run_id != *run_id));
        drop(state);
        self.notify_activity();
        first_error.map_or(Ok(expired), Err)
    }

    // Compatibility for the foreground DAG until background execution supplies
    // authoritative run and tool-call identities.
    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let key = ThreadDispatchKey::foreground_compat(thread_name, dispatch_id);
        let accepted = self.try_accept(key.clone());
        if accepted {
            self.mark_running(&key);
        }
        accepted
    }

    pub fn close_compat(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        dispatch_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        self.close(
            store_path,
            session_id,
            &ThreadDispatchKey::foreground_compat(thread_name, dispatch_id),
        )
    }

    pub fn close_all(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        self.abort_matching(store_path, session_id, None)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ActiveThreadState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for ActiveThreadRegistry {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (_, dispatch) in state.active_by_name.drain() {
            if let Some(abort) = dispatch.worker_abort {
                abort.abort();
            }
            if let Some(abort) = dispatch.coordinator_abort {
                abort.abort();
            }
        }
        state.completions.clear();
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
mod active_thread_registry_tests {
    use super::*;
    use std::future::pending;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn key(run: &SessionRunId, name: &str, dispatch: &str, call: &str) -> ThreadDispatchKey {
        ThreadDispatchKey::new(run.clone(), name, dispatch, call)
    }

    fn test_store() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_active_registry_{}_{}.db",
            std::process::id(),
            unique
        ));
        crate::store::initialize(&path).unwrap();
        path
    }

    fn completion(key: ThreadDispatchKey, content: &str) -> ThreadCompletion {
        ThreadCompletion {
            key,
            content: content.to_string(),
            is_error: false,
        }
    }

    #[test]
    fn exact_key_and_name_exclusion_preserve_pending_running_state() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::new();
        let accepted = key(&run, "worker", "dispatch-a", "call-a");
        let same_name = key(&SessionRunId::new(), "worker", "dispatch-b", "call-b");

        assert!(registry.try_accept(accepted.clone()));
        assert!(!registry.try_accept(same_name));
        assert!(registry.matches(&accepted));
        assert_eq!(
            registry.active_dispatches(),
            vec![ActiveThreadDispatchSnapshot {
                key: accepted.clone(),
                state: ThreadDispatchState::PendingDependency,
            }]
        );
        assert!(registry.mark_running(&accepted));
        assert_eq!(
            registry.active_dispatches()[0].state,
            ThreadDispatchState::Running
        );

        for stale in [
            key(&SessionRunId::new(), "worker", "dispatch-a", "call-a"),
            key(&run, "worker", "dispatch-other", "call-a"),
            key(&run, "worker", "dispatch-a", "call-other"),
        ] {
            assert!(!registry.matches(&stale));
            assert!(!registry.mark_running(&stale));
        }
    }

    #[test]
    fn stale_close_and_completion_cannot_remove_or_buffer_for_reused_name() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::new();
        let current = key(&run, "worker", "dispatch-new", "call-new");
        let stale = key(&run, "worker", "dispatch-old", "call-old");
        assert!(registry.try_accept(current.clone()));

        let missing = Path::new("/store/must/not/be/opened");
        assert!(registry
            .close(missing, "session", &stale)
            .unwrap()
            .is_empty());
        assert!(registry
            .complete(missing, "session", completion(stale, "stale"))
            .unwrap()
            .is_empty());
        assert!(registry.matches(&current));
        assert!(!registry.has_completions_for_run(&run));
    }

    #[test]
    fn exact_close_releases_name_for_reuse_without_buffering_completion() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let first = key(&run, "worker", "dispatch-first", "call-first");
        let second = key(&run, "worker", "dispatch-second", "call-second");
        assert!(registry.try_accept(first.clone()));

        assert!(registry
            .close(&store, "session", &first)
            .unwrap()
            .is_empty());
        assert!(!registry.matches(&first));
        assert!(!registry.has_completions_for_run(&run));
        assert!(registry.try_accept(second.clone()));
        assert!(registry.matches(&second));
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn completions_are_fifo_run_scoped_filtered_and_exactly_once() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run_a = SessionRunId::new();
        let run_b = SessionRunId::new();
        let a1 = key(&run_a, "a1", "dispatch-a1", "call-a1");
        let b1 = key(&run_b, "b1", "dispatch-b1", "call-b1");
        let a2 = key(&run_a, "a2", "dispatch-a2", "call-a2");
        for key in [&a1, &b1, &a2] {
            assert!(registry.try_accept(key.clone()));
        }
        registry
            .complete(&store, "session", completion(a1, "first"))
            .unwrap();
        registry
            .complete(&store, "session", completion(b1, "foreign"))
            .unwrap();
        registry
            .complete(&store, "session", completion(a2, "second"))
            .unwrap();

        let selected = HashSet::from(["a2".to_string()]);
        let taken = registry.take_completions(&run_a, &selected);
        assert_eq!(
            taken
                .iter()
                .map(|item| item.content.as_str())
                .collect::<Vec<_>>(),
            ["second"]
        );
        assert!(registry.take_completions(&run_a, &selected).is_empty());
        let remaining_a = registry.take_completions(&run_a, &HashSet::new());
        assert_eq!(remaining_a[0].content, "first");
        let remaining_b = registry.take_completions(&run_b, &HashSet::new());
        assert_eq!(remaining_b[0].content, "foreign");
        assert!(!registry.has_completions_for_run(&run_a));
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn abort_handle_attachment_is_exact_and_replacement_aborts_old_owner() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::new();
        let current = key(&run, "worker", "dispatch", "call");
        let stale = key(&run, "worker", "other", "call");
        assert!(registry.try_accept(current.clone()));

        let stale_task = tokio::spawn(pending::<()>());
        assert!(!registry.attach_worker(&stale, stale_task.abort_handle()));
        assert!(stale_task.await.unwrap_err().is_cancelled());

        let first = tokio::spawn(pending::<()>());
        assert!(registry.attach_worker(&current, first.abort_handle()));
        let replacement = tokio::spawn(pending::<()>());
        assert!(registry.attach_worker(&current, replacement.abort_handle()));
        assert!(first.await.unwrap_err().is_cancelled());
        replacement.abort();
    }

    #[tokio::test]
    async fn abort_run_cleans_only_exact_run_tasks_and_completions() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run_a = SessionRunId::new();
        let run_b = SessionRunId::new();
        let active_a = key(&run_a, "active-a", "dispatch-aa", "call-aa");
        let done_a = key(&run_a, "done-a", "dispatch-da", "call-da");
        let active_b = key(&run_b, "active-b", "dispatch-ab", "call-ab");
        let done_b = key(&run_b, "done-b", "dispatch-db", "call-db");
        for key in [&active_a, &done_a, &active_b, &done_b] {
            assert!(registry.try_accept(key.clone()));
        }
        let coordinator = tokio::spawn(pending::<()>());
        let worker = tokio::spawn(pending::<()>());
        assert!(registry.attach_coordinator(&active_a, coordinator.abort_handle()));
        assert!(registry.attach_worker(&active_a, worker.abort_handle()));
        registry
            .complete(&store, "session", completion(done_a, "done-a"))
            .unwrap();
        registry
            .complete(&store, "session", completion(done_b, "done-b"))
            .unwrap();

        registry.abort_run(&store, "session", &run_a).unwrap();
        assert!(coordinator.await.unwrap_err().is_cancelled());
        assert!(worker.await.unwrap_err().is_cancelled());
        assert!(registry.active_for_run(&run_a, &HashSet::new()).is_empty());
        assert!(!registry.has_completions_for_run(&run_a));
        assert!(registry.matches(&active_b));
        assert_eq!(
            registry.take_completions(&run_b, &HashSet::new())[0].content,
            "done-b"
        );
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn shutdown_aborts_all_owners_clears_buffers_and_rejects_new_dispatches() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let active = key(&run, "active", "dispatch-active", "call-active");
        let done = key(&run, "done", "dispatch-done", "call-done");
        assert!(registry.try_accept(active.clone()));
        assert!(registry.try_accept(done.clone()));
        let coordinator = tokio::spawn(pending::<()>());
        assert!(registry.attach_coordinator(&active, coordinator.abort_handle()));
        registry
            .complete(&store, "session", completion(done, "done"))
            .unwrap();

        registry.shutdown(&store, "session").unwrap();
        assert!(coordinator.await.unwrap_err().is_cancelled());
        assert!(registry.names().is_empty());
        assert!(!registry.has_completions_for_run(&run));
        assert!(!registry.try_accept(key(&run, "later", "dispatch", "call")));
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn notify_and_live_mode_default_are_observable() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        assert!(!registry.live_thread_updates());
        let waiter_registry = registry.clone();
        let waiter = tokio::spawn(async move { waiter_registry.wait_for_activity().await });
        tokio::task::yield_now().await;
        registry.set_live_thread_updates(true);
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert!(registry.live_thread_updates());
    }

    #[tokio::test]
    async fn drop_is_a_synchronous_abort_fallback() {
        let run = SessionRunId::new();
        let task = tokio::spawn(pending::<()>());
        {
            let registry = ActiveThreadRegistry::default();
            let key = key(&run, "worker", "dispatch", "call");
            assert!(registry.try_accept(key.clone()));
            assert!(registry.attach_worker(&key, task.abort_handle()));
        }
        assert!(task.await.unwrap_err().is_cancelled());
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
