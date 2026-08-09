use std::collections::HashMap;
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
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use fs2::FileExt;
use serde_json::Value;
use tokio::sync::Mutex;

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

#[derive(Debug)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

#[derive(Default)]
pub struct ActiveThreadRegistry {
    dispatches: StdMutex<HashMap<String, String>>,
}

impl ActiveThreadRegistry {
    pub fn names(&self) -> Vec<String> {
        self.lock().keys().cloned().collect()
    }

    pub fn is_active(&self, thread_name: &str) -> bool {
        self.lock().contains_key(thread_name)
    }

    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let mut dispatches = self.lock();
        if dispatches.contains_key(thread_name) {
            false
        } else {
            dispatches.insert(thread_name.to_string(), dispatch_id.to_string());
            true
        }
    }

    pub fn queue(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        instruction: &str,
    ) -> anyhow::Result<Option<crate::store::ThreadSteeringRecord>> {
        let dispatches = self.lock();
        let Some(dispatch_id) = dispatches.get(thread_name) else {
            return Ok(None);
        };
        crate::store::queue_thread_steering(
            store_path,
            session_id,
            thread_name,
            dispatch_id,
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
        let mut dispatches = self.lock();
        if dispatches.get(thread_name).map(String::as_str) != Some(dispatch_id) {
            return Ok(Vec::new());
        }
        let expired = crate::store::expire_thread_steering(store_path, session_id, dispatch_id)?;
        dispatches.remove(thread_name);
        Ok(expired)
    }

    pub fn close_all(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut dispatches = self.lock();
        let targets = dispatches
            .iter()
            .map(|(name, dispatch_id)| (name.clone(), dispatch_id.clone()))
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        for (name, dispatch_id) in targets {
            expired.extend(crate::store::expire_thread_steering(
                store_path,
                session_id,
                &dispatch_id,
            )?);
            if dispatches.get(&name) == Some(&dispatch_id) {
                dispatches.remove(&name);
            }
        }
        Ok(expired)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.dispatches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The three tier worker clients a mixed-mode session resolves at
/// launch/resume. Each client carries its own catalog metadata, so the
/// dispatch tool can enumerate and validate per-tier reasoning efforts.
#[derive(Clone)]
pub struct MixedDispatchClients {
    pub easy: crate::model::ModelClient,
    pub medium: crate::model::ModelClient,
    pub hard: crate::model::ModelClient,
}

impl MixedDispatchClients {
    pub fn for_tier(
        &self,
        complexity: crate::model::ThreadComplexity,
    ) -> &crate::model::ModelClient {
        match complexity {
            crate::model::ThreadComplexity::Easy => &self.easy,
            crate::model::ThreadComplexity::Medium => &self.medium,
            crate::model::ThreadComplexity::Hard => &self.hard,
        }
    }

    /// `(tier label, client)` pairs in easy → hard order, for schema and
    /// prompt descriptions.
    pub fn tiers(&self) -> [(crate::model::ThreadComplexity, &crate::model::ModelClient); 3] {
        [
            (crate::model::ThreadComplexity::Easy, &self.easy),
            (crate::model::ThreadComplexity::Medium, &self.medium),
            (crate::model::ThreadComplexity::Hard, &self.hard),
        ]
    }

    /// One "- easy: model (effort: low, ~$0.25/$1.25 per 1M tokens)" line
    /// per tier, shared by the dispatch tool schema and the orchestrator
    /// system prompt. Catalog cost rates, when known, give the classifier a
    /// real signal for what each tier spends.
    pub fn describe_tiers(&self) -> String {
        let mut description = String::new();
        for (complexity, client) in self.tiers() {
            let mut traits = Vec::new();
            if let Some(effort) = client.reasoning_effort() {
                traits.push(format!("effort: {effort}"));
            }
            let cost = client.cost_rates();
            if cost.input > 0.0 || cost.output > 0.0 {
                traits.push(format!(
                    "~${}/${} per 1M tokens in/out",
                    cost.input, cost.output
                ));
            }
            let traits = if traits.is_empty() {
                String::new()
            } else {
                format!(" ({})", traits.join(", "))
            };
            description.push_str(&format!(
                "\n- {}: {}{}",
                complexity.as_str(),
                client.model,
                traits
            ));
        }
        description
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
    /// Mixed-mode tier worker clients; `None` keeps single-model dispatch.
    pub mixed_clients: Option<Arc<MixedDispatchClients>>,
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

pub fn orchestrator_tool_definitions(
    skills: Option<&SkillRegistry>,
    mixed: Option<&MixedDispatchClients>,
) -> Vec<ToolDefinition> {
    vec![
        thread::dispatch_definition(skills, mixed),
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
        mixed_clients: None,
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
