use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::{mpsc, Mutex};
use tokio::time::sleep;

use crate::process::ProcessTreeGuard;
use crate::sandbox::ExecutionBackend;
use crate::tools::ThreadCancellation;

use super::keyparse::parse_keys;
use super::session::{terminal_env_owned, TerminalSession};
use super::{
    ArtifactKind, CommandOutput, CommandOutputLimits, CommandStatus, OutputPage, OutputRegistry,
    OutputStream, TerminalInfo, TerminalOutput,
};

const PIPE_CHUNK_BYTES: usize = 16 * 1024;
const PIPE_CHANNEL_CHUNKS: usize = 16;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
const READER_DRAIN_GRACE: Duration = Duration::from_millis(100);
type WorkspaceAuthority = Option<(PathBuf, Vec<u8>)>;
type SessionResourceAuthority = Option<(PathBuf, String)>;

const NONINTERACTIVE_PROMPT_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "0"),
    ("GH_PROMPT_DISABLED", "1"),
];

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pending_remote_cleanups: Arc<StdMutex<HashMap<String, Arc<PendingRemoteCleanup>>>>,
    create_gate: Arc<Mutex<()>>,
    #[cfg(test)]
    one_shot_spawn_gate: Arc<Mutex<()>>,
    completed_sessions: Arc<Mutex<VecDeque<(String, CompletedTerminal)>>>,
    max_sessions: usize,
    isolate_process_groups: bool,
    output_registry: OutputRegistry,
    preserve_retained_on_settlement: bool,
    instance_id: Arc<str>,
    workspace_authority: Arc<StdMutex<WorkspaceAuthority>>,
    session_resource_authority: Arc<StdMutex<SessionResourceAuthority>>,
}

#[derive(Clone)]
struct CompletedTerminal {
    output_id: String,
    preview_cursor: u64,
    exit_code: Option<i32>,
}

struct PendingRemoteCleanup {
    backend: Arc<ExecutionBackend>,
    transport_active: AtomicBool,
}

/// Marks the local SSH/Podman launcher inactive even when the command future
/// is aborted. This value is deliberately created before the child/process
/// guard so Rust's reverse local drop order stops the transport first.
struct RemoteTransportOwnership {
    cleanup: Arc<PendingRemoteCleanup>,
}

impl RemoteTransportOwnership {
    fn stopped(&self) {
        self.cleanup.transport_active.store(false, Ordering::SeqCst);
    }
}

impl Drop for RemoteTransportOwnership {
    fn drop(&mut self) {
        self.stopped();
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::with_process_group_isolation(true, false, CommandOutputLimits::default())
            .expect("default command output limits are valid")
    }

    pub(crate) fn for_direct() -> Self {
        Self::with_process_group_isolation(true, true, CommandOutputLimits::default())
            .expect("default command output limits are valid")
    }

    pub(crate) fn for_worker_with_limits(limits: CommandOutputLimits) -> Result<Self> {
        Self::with_process_group_isolation(true, false, limits)
    }

    #[cfg(test)]
    pub(crate) fn with_limits(limits: CommandOutputLimits) -> Result<Self> {
        Self::with_process_group_isolation(true, false, limits)
    }

    fn with_process_group_isolation(
        isolate_process_groups: bool,
        preserve_retained_on_settlement: bool,
        limits: CommandOutputLimits,
    ) -> Result<Self> {
        Ok(Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_cleanups: Arc::new(StdMutex::new(HashMap::new())),
            create_gate: Arc::new(Mutex::new(())),
            #[cfg(test)]
            one_shot_spawn_gate: Arc::new(Mutex::new(())),
            completed_sessions: Arc::new(Mutex::new(VecDeque::new())),
            max_sessions: 16,
            isolate_process_groups,
            output_registry: OutputRegistry::new(limits)?,
            preserve_retained_on_settlement,
            instance_id: Arc::from(uuid::Uuid::new_v4().to_string()),
            workspace_authority: Arc::new(StdMutex::new(None)),
            session_resource_authority: Arc::new(StdMutex::new(None)),
        })
    }

    pub(crate) fn configure_workspace_authority(
        &self,
        store_path: PathBuf,
        workspace_identity: Vec<u8>,
    ) {
        *self
            .workspace_authority
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some((store_path, workspace_identity));
    }

    pub(crate) fn configure_session_resource_authority(
        &self,
        store_path: PathBuf,
        session_id: String,
    ) {
        *self
            .session_resource_authority
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((store_path, session_id));
    }

    pub(crate) fn acquire_workspace_activity_lease(
        &self,
    ) -> Result<Option<crate::sessions::WorkspaceActivityLease>> {
        let authority = self
            .workspace_authority
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        authority
            .map(|(store_path, workspace_identity)| {
                crate::sessions::WorkspaceActivityLease::try_acquire(
                    &store_path,
                    &workspace_identity,
                )
                .map_err(anyhow::Error::new)
            })
            .transpose()
    }

    fn acquire_session_resource_lease(
        &self,
    ) -> Result<Option<crate::sessions::SessionResourceLease>> {
        let authority = self
            .session_resource_authority
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        authority
            .map(|(store_path, session_id)| {
                crate::sessions::SessionResourceLease::try_acquire(&store_path, &session_id)
                    .map_err(anyhow::Error::new)
            })
            .transpose()
    }

    pub fn next_session_name(&self) -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        format!(
            "shell-{}-{}",
            self.instance_id,
            COUNTER.fetch_add(1, Ordering::SeqCst)
        )
    }

    pub fn missing_session_error(&self, name: &str) -> anyhow::Error {
        if name.starts_with("shell-") && !name.starts_with(&format!("shell-{}-", self.instance_id))
        {
            anyhow!(
                "terminal session '{name}' belonged to a previous nac service instance and was lost when that process-local terminal owner stopped"
            )
        } else {
            anyhow!("terminal session '{name}' not found - it was closed or expired")
        }
    }

    #[cfg(test)]
    pub async fn create(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
    ) -> Result<TerminalInfo> {
        self.create_with_cancellation(name, command, cwd, cols, rows, backend, None)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    pub async fn create_with_cancellation(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<TerminalInfo> {
        self.create_with_environment(name, command, cwd, cols, rows, backend, cancellation, &[])
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_with_environment(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
        extra_envs: &[(String, String)],
    ) -> Result<TerminalInfo> {
        // Capacity accounting, replacement, and insertion form one admission
        // transaction. Cleanup may await a remote backend, so a dedicated
        // gate keeps parallel creates from both consuming the same slot.
        let _create = self.create_gate.lock().await;
        self.completed_sessions
            .lock()
            .await
            .retain(|(session_name, _)| session_name != &name);
        if self.sessions.lock().await.contains_key(&name) {
            self.kill_owned_session(&name, false)
                .await
                .with_context(|| {
                    format!("terminal session '{name}' cleanup incomplete during replacement")
                })?;
        }

        let exited = {
            let mut sessions = self.sessions.lock().await;
            sessions
                .iter_mut()
                .filter_map(|(name, session)| {
                    session.refresh_status();
                    (!session.is_alive()).then(|| name.clone())
                })
                .collect::<Vec<_>>()
        };
        for name in exited {
            if let Some(mut session) = self
                .kill_owned_session(&name, false)
                .await
                .with_context(|| format!("exited terminal session '{name}' cleanup incomplete"))?
            {
                self.remember_completed(&mut session).await;
            }
        }

        loop {
            let oldest_key = {
                let sessions = self.sessions.lock().await;
                if sessions.len() < self.max_sessions {
                    None
                } else {
                    let oldest_key = sessions
                        .iter()
                        .filter(|(_, session)| !session.is_retained())
                        .min_by_key(|(_, session)| session.created_at)
                        .map(|(key, _)| key.clone());
                    if oldest_key.is_none() {
                        return Err(anyhow!(
                        "terminal session limit reached: all {} sessions were explicitly retained",
                        self.max_sessions
                    ));
                    }
                    oldest_key
                }
            };
            let Some(oldest_key) = oldest_key else {
                break;
            };
            self.kill_owned_session(&oldest_key, true)
                .await
                .with_context(|| {
                    format!("terminal session '{oldest_key}' cleanup incomplete during eviction")
                })?;
        }

        // Take the map lock before spawning. `spawn` is synchronous, so there
        // is no cancellation point between acquiring the PTY/process and
        // transferring it into durable manager ownership.
        let mut sessions = self.sessions.lock().await;
        let info = match cancellation {
            Some(cancellation) => cancellation
                .run_if_active(|| {
                    let session = TerminalSession::spawn(
                        name.clone(),
                        command,
                        cwd,
                        cols,
                        rows,
                        backend,
                        self.output_registry.clone(),
                        extra_envs,
                    )?;
                    let info = self.session_info(&name, &session);
                    sessions.insert(name.clone(), session);
                    Ok::<_, anyhow::Error>(info)
                })
                .ok_or_else(|| anyhow!("terminal command cancelled before PTY spawn"))??,
            None => {
                let session = TerminalSession::spawn(
                    name.clone(),
                    command,
                    cwd,
                    cols,
                    rows,
                    backend,
                    self.output_registry.clone(),
                    extra_envs,
                )?;
                let info = self.session_info(&name, &session);
                sessions.insert(name, session);
                info
            }
        };
        Ok(info)
    }

    pub async fn write_stdin(
        &self,
        name: &str,
        input: &str,
        yield_ms: u64,
        max_output: usize,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<TerminalOutput> {
        let start = Instant::now();
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            self.settle_run().await?;
            return Err(anyhow!("terminal command cancelled"));
        }
        let bytes = parse_keys(input);
        let completed = {
            let completed = self.completed_sessions.lock().await;
            completed
                .iter()
                .find(|(session_name, _)| session_name == name)
                .map(|(_, terminal)| terminal.clone())
        };
        if let Some(completed) = completed {
            if !bytes.is_empty() {
                return Err(anyhow!("terminal session '{name}' has already exited"));
            }
            let preview = self.output_registry.preview_since(
                &completed.output_id,
                OutputStream::Combined,
                completed.preview_cursor,
                max_output,
            )?;
            if let Some((_, terminal)) = self
                .completed_sessions
                .lock()
                .await
                .iter_mut()
                .find(|(session_name, _)| session_name == name)
            {
                terminal.preview_cursor = preview.end_offset;
            }
            return Ok(TerminalOutput {
                session_name: None,
                retained: false,
                output_id: completed.output_id,
                start_cursor: preview.start_offset,
                end_cursor: preview.end_offset,
                content_preview: preview.content,
                truncated: preview.truncated,
                overflowed: preview.overflowed,
                exit_code: completed.exit_code,
                wall_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let (output_id, start_cursor, notify) =
            {
                let mut sessions = self.sessions.lock().await;
                let session = sessions
                    .get_mut(name)
                    .ok_or_else(|| self.missing_session_error(name))?;
                session.refresh_status();
                if !session.is_alive() && !bytes.is_empty() {
                    return Err(anyhow!("terminal session '{name}' has already exited"));
                }
                if !bytes.is_empty() {
                    match cancellation {
                        Some(cancellation) => cancellation
                            .run_if_active(|| session.write(&bytes))
                            .ok_or_else(|| anyhow!("terminal command cancelled before input"))??,
                        None => session.write(&bytes)?,
                    }
                }
                (
                    session.output_id().to_string(),
                    session.preview_cursor(),
                    session.output_notify().clone(),
                )
            };

        if !bytes.is_empty() {
            sleep(Duration::from_millis(50)).await;
        }
        let wait_result = self
            .wait_for_pty_output(
                name,
                &output_id,
                start_cursor,
                yield_ms,
                notify,
                cancellation,
            )
            .await;
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            self.settle_run().await?;
            return Err(anyhow!("terminal command cancelled"));
        }
        wait_result?;
        let preview = match self.output_registry.preview_since(
            &output_id,
            OutputStream::Combined,
            start_cursor,
            max_output,
        ) {
            Ok(preview) => preview,
            Err(error) => {
                if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                    self.settle_run().await?;
                    return Err(anyhow!("terminal command cancelled"));
                }
                return Err(error);
            }
        };

        let (ended, retained) = {
            let mut sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get_mut(name) {
                session.set_preview_cursor(preview.end_offset);
                session.refresh_status();
                if session.is_alive() {
                    (false, session.is_retained())
                } else {
                    (true, false)
                }
            } else {
                (false, false)
            }
        };

        let (session_name, exit_code) = if ended {
            let mut session = self
                .kill_owned_session(name, false)
                .await
                .with_context(|| format!("exited terminal session '{name}' cleanup incomplete"))?
                .ok_or_else(|| self.missing_session_error(name))?;
            let exit_code = self.remember_completed(&mut session).await;
            (None, exit_code)
        } else {
            (Some(name.to_string()), None)
        };
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            self.settle_run().await?;
            return Err(anyhow!("terminal command cancelled"));
        }

        Ok(TerminalOutput {
            session_name,
            retained,
            output_id,
            start_cursor: preview.start_offset,
            end_cursor: preview.end_offset,
            content_preview: preview.content,
            truncated: preview.truncated,
            overflowed: preview.overflowed,
            exit_code,
            wall_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    pub async fn exec_one_shot(
        &self,
        cmd: &str,
        cwd: Option<PathBuf>,
        _cols: u16,
        _rows: u16,
        yield_ms: u64,
        max_output: usize,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
    ) -> CommandOutput {
        self.exec_one_shot_with_environment(
            cmd,
            cwd,
            _cols,
            _rows,
            yield_ms,
            max_output,
            backend,
            cancellation,
            &[],
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn exec_one_shot_with_environment(
        &self,
        cmd: &str,
        cwd: Option<PathBuf>,
        _cols: u16,
        _rows: u16,
        yield_ms: u64,
        max_output: usize,
        backend: &Arc<ExecutionBackend>,
        cancellation: Option<&ThreadCancellation>,
        extra_envs: &[(String, String)],
    ) -> CommandOutput {
        let start = Instant::now();
        if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
            return CommandOutput {
                status: CommandStatus::Cancelled,
                exit_code: None,
                wall_time_ms: start.elapsed().as_millis() as u64,
                stdout_preview: String::new(),
                stderr_preview: String::new(),
                output_id: None,
                stdout_bytes: 0,
                stderr_bytes: 0,
                truncated: false,
                overflowed: false,
            };
        }
        let mut envs = terminal_env_owned();
        envs.reserve(NONINTERACTIVE_PROMPT_ENV.len());
        envs.extend(
            NONINTERACTIVE_PROMPT_ENV
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string())),
        );
        envs.extend(extra_envs.iter().cloned());
        let (mut command, pidfile) = backend.terminal_pipe_command(cmd, cwd.as_deref(), &envs);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Reserve bounded output metadata before a process exists. The lease
        // stays active for the full command future (including cancellation)
        // and becomes evictable only after every reader has settled.
        let output_lease = match self.output_registry.create(ArtifactKind::Command) {
            Ok(lease) => lease,
            Err(error) => {
                return CommandOutput {
                    status: CommandStatus::SpawnError,
                    exit_code: None,
                    wall_time_ms: start.elapsed().as_millis() as u64,
                    stdout_preview: String::new(),
                    stderr_preview: error.to_string(),
                    output_id: None,
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    truncated: false,
                    overflowed: false,
                };
            }
        };
        let output_id = output_lease.output_id().to_string();

        #[cfg(test)]
        let _one_shot_spawn = self.one_shot_spawn_gate.lock().await;

        // Registration and spawn are one synchronous cancellation mutation.
        // If cancellation takes the shared gate first, neither a local process
        // nor a remote transport/pidfile owner can appear afterward.
        let mut spawn = || {
            let remote_transport = pidfile.as_deref().map(|pidfile| {
                let cleanup = Arc::new(PendingRemoteCleanup {
                    backend: Arc::clone(backend),
                    transport_active: AtomicBool::new(true),
                });
                self.pending_remote_cleanups
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .insert(pidfile.to_string(), Arc::clone(&cleanup));
                RemoteTransportOwnership { cleanup }
            });
            let spawned = if self.isolate_process_groups {
                ProcessTreeGuard::spawn_supervised(&mut command)
            } else {
                command.spawn().map(|child| {
                    let guard = ProcessTreeGuard::for_child(&child);
                    (child, guard)
                })
            };
            (spawned, remote_transport)
        };
        let admitted = match cancellation {
            Some(cancellation) => cancellation.run_if_active(spawn),
            None => Some(spawn()),
        };
        let Some((spawned, remote_transport)) = admitted else {
            return CommandOutput {
                status: CommandStatus::Cancelled,
                exit_code: None,
                wall_time_ms: start.elapsed().as_millis() as u64,
                stdout_preview: String::new(),
                stderr_preview: String::new(),
                output_id: None,
                stdout_bytes: 0,
                stderr_bytes: 0,
                truncated: false,
                overflowed: false,
            };
        };
        let (mut child, mut process_tree) = match spawned {
            Ok(spawned) => spawned,
            Err(error) => {
                if let Some(remote_transport) = remote_transport.as_ref() {
                    remote_transport.stopped();
                }
                if let Some(pidfile) = pidfile.as_deref() {
                    self.forget_remote_cleanup(pidfile);
                }
                return CommandOutput {
                    status: CommandStatus::SpawnError,
                    exit_code: None,
                    wall_time_ms: start.elapsed().as_millis() as u64,
                    stdout_preview: String::new(),
                    stderr_preview: format!("failed to spawn command: {error}"),
                    output_id: None,
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    truncated: false,
                    overflowed: false,
                };
            }
        };
        let stdout = child.stdout.take().expect("piped stdout is present");
        let stderr = child.stderr.take().expect("piped stderr is present");
        let (sender, mut receiver) = mpsc::channel(PIPE_CHANNEL_CHUNKS);
        let reader_shutdown = ThreadCancellation::default();
        let stdout_reader = tokio::spawn(read_chunks(
            stdout,
            OutputStream::Stdout,
            sender.clone(),
            reader_shutdown.clone(),
        ));
        let stderr_reader = tokio::spawn(read_chunks(
            stderr,
            OutputStream::Stderr,
            sender,
            reader_shutdown.clone(),
        ));

        let deadline = start + Duration::from_millis(yield_ms);
        let mut status = CommandStatus::Completed;
        let mut exit_code = None;
        let mut runtime_error = None;
        let mut process_exited = false;
        let mut readers_open = true;

        while !process_exited {
            match child.try_wait() {
                Ok(Some(process_status)) => {
                    exit_code = Some(process_status.code().unwrap_or(-1));
                    process_exited = true;
                    continue;
                }
                Ok(None) => {}
                Err(error) => {
                    status = CommandStatus::SpawnError;
                    runtime_error = Some(format!("failed to wait for command: {error}"));
                    break;
                }
            }

            if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                status = CommandStatus::Cancelled;
                break;
            }
            if Instant::now() >= deadline {
                status = CommandStatus::TimedOut;
                break;
            }

            tokio::select! {
                chunk = receiver.recv(), if readers_open => {
                    match chunk {
                        Some(chunk) => {
                            if let Err(error) = self.output_registry.append(&output_id, chunk.stream, chunk.bytes) {
                                status = CommandStatus::SpawnError;
                                runtime_error = Some(error.to_string());
                                break;
                            }
                        }
                        None => readers_open = false,
                    }
                }
                _ = sleep(PROCESS_POLL_INTERVAL) => {}
                _ = async {
                    if let Some(cancellation) = cancellation {
                        cancellation.cancelled().await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                } => {
                    status = CommandStatus::Cancelled;
                    break;
                }
            }
        }

        let mut force_reader_shutdown = false;
        if !process_exited {
            // Stop the local transport first. A remote kill that observes no
            // pidfile is authoritative only after SSH/Podman can no longer
            // start the wrapper and create that pidfile afterwards.
            let transport_stopped = match process_tree.terminate(&mut child).await {
                Ok(()) => {
                    force_reader_shutdown = true;
                    true
                }
                Err(error) => {
                    reader_shutdown.cancel();
                    let cleanup_error = format!("command cleanup incomplete: {error}");
                    runtime_error = Some(match runtime_error.take() {
                        Some(existing) => format!("{existing}\n{cleanup_error}"),
                        None => cleanup_error,
                    });
                    false
                }
            };
            if transport_stopped {
                if let Some(remote_transport) = remote_transport.as_ref() {
                    remote_transport.stopped();
                }
            }
            if transport_stopped {
                if let Some(pidfile) = pidfile.as_deref() {
                    if let Err(error) = self.retry_remote_cleanup(pidfile).await {
                        runtime_error = Some(match runtime_error.take() {
                            Some(existing) => {
                                format!("{existing}\nremote command cleanup incomplete: {error}")
                            }
                            None => format!("remote command cleanup incomplete: {error}"),
                        });
                    }
                }
            }
            exit_code = None;
        } else {
            if let Some(remote_transport) = remote_transport.as_ref() {
                remote_transport.stopped();
            }
            if let Some(pidfile) = pidfile.as_deref() {
                if let Err(error) = self.retry_remote_cleanup(pidfile).await {
                    status = CommandStatus::SpawnError;
                    runtime_error = Some(format!(
                        "remote command completion cleanup incomplete: {error}"
                    ));
                }
            }
        }
        if process_exited && self.isolate_process_groups {
            // A successful shell leader can leave background descendants.
            // The dedicated owned group leader prevents pgid reuse while we
            // tear down that group after reaping the requested command.
            process_tree.mark_leader_reaped();
            process_tree.finish().await;
            force_reader_shutdown = true;
        } else if process_exited {
            process_tree.disarm();
        }

        let preserve_status = !process_exited;
        let record_output_error =
            |message: String, status: &mut CommandStatus, runtime_error: &mut Option<String>| {
                if preserve_status {
                    *runtime_error = Some(match runtime_error.take() {
                        Some(existing) => format!("{existing}\n{message}"),
                        None => message,
                    });
                } else {
                    *status = CommandStatus::SpawnError;
                    *runtime_error = Some(message);
                }
            };

        let reader_shutdown_timer = async {
            if force_reader_shutdown {
                sleep(READER_DRAIN_GRACE).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::pin!(reader_shutdown_timer);
        let mut reader_shutdown_pending = force_reader_shutdown;
        let mut append_failed = false;
        loop {
            tokio::select! {
                biased;
                _ = &mut reader_shutdown_timer, if reader_shutdown_pending => {
                    reader_shutdown.cancel();
                    reader_shutdown_pending = false;
                }
                chunk = receiver.recv() => {
                    let Some(chunk) = chunk else {
                        break;
                    };
                    if append_failed {
                        continue;
                    }
                    if let Err(error) = self.output_registry.append(
                        &output_id,
                        chunk.stream,
                        chunk.bytes,
                    ) {
                        record_output_error(error.to_string(), &mut status, &mut runtime_error);
                        append_failed = true;
                    }
                }
            }
        }

        for reader in [stdout_reader, stderr_reader] {
            let message = match reader.await {
                Ok(Ok(())) => None,
                Ok(Err(error)) => Some(format!("failed to read command output: {error}")),
                Err(error) => Some(format!("command output reader failed: {error}")),
            };
            if let Some(message) = message {
                record_output_error(message, &mut status, &mut runtime_error);
            }
        }

        let stats =
            self.output_registry
                .stats(&output_id)
                .unwrap_or(super::output::ArtifactStats {
                    stdout_bytes: 0,
                    stderr_bytes: 0,
                    combined_bytes: 0,
                    retained_bytes: 0,
                    overflowed: false,
                });
        let ((stdout_preview, stdout_truncated), (mut stderr_preview, stderr_truncated)) = self
            .output_registry
            .command_previews(&output_id, max_output)
            .unwrap_or_default();
        if let Some(error) = runtime_error {
            if !stderr_preview.is_empty() {
                stderr_preview.push('\n');
            }
            stderr_preview.push_str(&error);
        }

        CommandOutput {
            status,
            exit_code: if status == CommandStatus::Completed {
                exit_code
            } else {
                None
            },
            wall_time_ms: start.elapsed().as_millis() as u64,
            stdout_preview,
            stderr_preview,
            output_id: Some(output_id),
            stdout_bytes: stats.stdout_bytes,
            stderr_bytes: stats.stderr_bytes,
            truncated: stdout_truncated || stderr_truncated,
            overflowed: stats.overflowed,
        }
    }

    pub fn read_output(
        &self,
        output_id: &str,
        stream: OutputStream,
        offset: u64,
        limit: usize,
    ) -> Result<OutputPage> {
        self.output_registry.page(output_id, stream, offset, limit)
    }

    #[cfg(test)]
    pub(crate) async fn set_backend_cleanup_for_test(
        &self,
        name: &str,
        backend: Arc<ExecutionBackend>,
        pidfile: String,
    ) -> Result<()> {
        self.sessions
            .lock()
            .await
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?
            .set_backend_cleanup_for_test(backend, pidfile);
        Ok(())
    }

    pub async fn remove_all(&self) -> Result<()> {
        let names = self
            .sessions
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut cleanup_errors = Vec::new();
        for name in names {
            if let Err(error) = self.kill_owned_session(&name, false).await {
                cleanup_errors.push(format!(
                    "terminal session '{name}' cleanup incomplete during removal: {error:#}"
                ));
            }
        }
        if let Err(error) = self.retry_pending_remote_cleanups().await {
            cleanup_errors.push(error.to_string());
        }
        if cleanup_errors.is_empty() {
            self.completed_sessions.lock().await.clear();
            self.output_registry.clear();
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("; ")))
        }
    }

    pub async fn settle_run(&self) -> Result<()> {
        if !self.preserve_retained_on_settlement {
            return self.remove_all().await;
        }
        let foreground = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .filter(|(_, session)| !session.is_retained())
                .map(|(name, _)| name.clone())
                .collect::<Vec<_>>()
        };
        let mut cleanup_errors = Vec::new();
        for name in foreground {
            if let Err(error) = self.kill_owned_session(&name, true).await {
                cleanup_errors.push(format!(
                    "foreground terminal session '{name}' cleanup incomplete: {error:#}"
                ));
            }
        }
        if let Err(error) = self.retry_pending_remote_cleanups().await {
            cleanup_errors.push(error.to_string());
        }
        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("; ")))
        }
    }

    /// Kill a session while it remains manager-owned. Holding the map entry
    /// across every await makes dropping the cleanup future cancellation-safe:
    /// a later caller can still find the handle and retry backend cleanup.
    async fn kill_owned_session(
        &self,
        name: &str,
        preserve_if_retained: bool,
    ) -> Result<Option<TerminalSession>> {
        let mut sessions = self.sessions.lock().await;
        let Some(session) = sessions.get_mut(name) else {
            return Ok(None);
        };
        // Selection and cleanup use different lock acquisitions so retain can
        // win in between. Recheck under the same lock held through kill;
        // once retain has reported success, settlement/eviction cannot kill
        // that session.
        if preserve_if_retained && session.is_retained() {
            return Ok(None);
        }
        session.kill().await?;
        Ok(sessions.remove(name))
    }

    fn forget_remote_cleanup(&self, pidfile: &str) {
        self.pending_remote_cleanups
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(pidfile);
    }

    async fn retry_remote_cleanup(&self, pidfile: &str) -> Result<()> {
        let cleanup = self
            .pending_remote_cleanups
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(pidfile)
            .cloned();
        let Some(cleanup) = cleanup else {
            return Ok(());
        };
        if cleanup.transport_active.load(Ordering::SeqCst) {
            return Err(anyhow!(
                "local transport for remote command '{pidfile}' is still active"
            ));
        }
        cleanup.backend.terminal_pipe_kill(pidfile).await?;
        self.forget_remote_cleanup(pidfile);
        Ok(())
    }

    async fn retry_pending_remote_cleanups(&self) -> Result<()> {
        let pidfiles = self
            .pending_remote_cleanups
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut errors = Vec::new();
        for pidfile in pidfiles {
            if let Err(error) = self.retry_remote_cleanup(&pidfile).await {
                errors.push(format!(
                    "remote one-shot command cleanup for '{pidfile}' remains incomplete: {error:#}"
                ));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(errors.join("; ")))
        }
    }

    #[cfg(test)]
    fn pending_remote_cleanup_count(&self) -> usize {
        self.pending_remote_cleanups
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    #[cfg(test)]
    pub async fn retain(&self, name: &str) -> Result<TerminalInfo> {
        self.retain_with_cancellation(name, None).await
    }

    pub(crate) async fn retain_with_cancellation(
        &self,
        name: &str,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !session.is_alive() {
            return Err(anyhow!("terminal session '{name}' has already exited"));
        }
        let workspace_activity = self.acquire_workspace_activity_lease()?;
        let session_resource = self.acquire_session_resource_lease()?;
        match cancellation {
            Some(cancellation) => cancellation
                .run_if_active(|| session.retain(workspace_activity, session_resource))
                .ok_or_else(|| anyhow!("terminal command cancelled before retention"))?,
            None => session.retain(workspace_activity, session_resource),
        }
        Ok(self.session_info(name, session))
    }

    pub fn has_retained(&self) -> bool {
        self.sessions
            .try_lock()
            .map(|mut sessions| {
                sessions.values_mut().any(|session| {
                    session.refresh_status();
                    // An exited remote transport can still own a live backend
                    // process. Keep its service until polling or explicit
                    // teardown runs the pidfile cleanup.
                    session.is_retained()
                })
            })
            // A concurrent terminal operation is not a safe eviction point.
            .unwrap_or(true)
    }

    #[cfg(test)]
    pub(crate) async fn get(&self, name: &str) -> Option<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        sessions.get_mut(name).map(|session| {
            session.refresh_status();
            self.session_info(&session.name, session)
        })
    }

    fn session_info(&self, name: &str, session: &TerminalSession) -> TerminalInfo {
        TerminalInfo {
            name: name.to_string(),
            cwd: session.cwd.clone(),
            cols: session.cols,
            rows: session.rows,
            alive: session.is_alive(),
            retained: session.is_retained(),
            idle_ms: session.idle_duration().as_millis() as u64,
            pid: session.pid(),
        }
    }

    async fn remember_completed(&self, session: &mut TerminalSession) -> Option<i32> {
        let exit_code = session
            .wait_for_exit_code()
            .await
            .or_else(|| session.exit_code());
        let completed = CompletedTerminal {
            output_id: session.output_id().to_string(),
            preview_cursor: session.preview_cursor(),
            exit_code,
        };
        let mut tombstones = self.completed_sessions.lock().await;
        tombstones.retain(|(name, _)| name != &session.name);
        tombstones.push_back((session.name.clone(), completed));
        while tombstones.len() > self.max_sessions {
            tombstones.pop_front();
        }
        exit_code
    }

    async fn wait_for_pty_output(
        &self,
        name: &str,
        output_id: &str,
        start_cursor: u64,
        yield_ms: u64,
        notify: Arc<tokio::sync::Notify>,
        cancellation: Option<&ThreadCancellation>,
    ) -> Result<()> {
        let deadline = Instant::now() + Duration::from_millis(yield_ms);
        loop {
            if cancellation.is_some_and(ThreadCancellation::is_cancelled) {
                return Err(anyhow!("terminal command cancelled"));
            }
            let alive = {
                let mut sessions = self.sessions.lock().await;
                let session = sessions
                    .get_mut(name)
                    .ok_or_else(|| anyhow!("terminal session vanished"))?;
                session.refresh_status();
                session.is_alive()
            };
            let end = self.output_registry.stats(output_id)?.combined_bytes;
            if !alive || Instant::now() >= deadline {
                return Ok(());
            }
            if end > start_cursor {
                tokio::task::yield_now().await;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            tokio::select! {
                biased;
                _ = async {
                    if let Some(cancellation) = cancellation {
                        cancellation.cancelled().await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                } => return Err(anyhow!("terminal command cancelled")),
                _ = notify.notified() => {}
                _ = sleep(remaining) => return Ok(()),
            }
        }
    }
}

struct StreamChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

async fn read_chunks<R>(
    mut reader: R,
    stream: OutputStream,
    sender: mpsc::Sender<StreamChunk>,
    shutdown: ThreadCancellation,
) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
{
    loop {
        let mut bytes = vec![0u8; PIPE_CHUNK_BYTES];
        let read = tokio::select! {
            _ = shutdown.cancelled() => return Ok(()),
            read = reader.read(&mut bytes) => read?,
        };
        if read == 0 {
            return Ok(());
        }
        bytes.truncate(read);
        let sent = tokio::select! {
            _ = shutdown.cancelled() => return Ok(()),
            sent = sender.send(StreamChunk { stream, bytes }) => sent,
        };
        if sent.is_err() {
            return Ok(());
        }
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
