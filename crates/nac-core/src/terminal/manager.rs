use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
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

const NONINTERACTIVE_PROMPT_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "0"),
    ("GH_PROMPT_DISABLED", "1"),
];

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    create_gate: Arc<Mutex<()>>,
    completed_sessions: Arc<Mutex<VecDeque<(String, CompletedTerminal)>>>,
    max_sessions: usize,
    isolate_process_groups: bool,
    output_registry: OutputRegistry,
    preserve_retained_on_settlement: bool,
    instance_id: Arc<str>,
}

#[derive(Clone)]
struct CompletedTerminal {
    output_id: String,
    preview_cursor: u64,
    exit_code: Option<i32>,
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
            create_gate: Arc::new(Mutex::new(())),
            completed_sessions: Arc::new(Mutex::new(VecDeque::new())),
            max_sessions: 16,
            isolate_process_groups,
            output_registry: OutputRegistry::new(limits)?,
            preserve_retained_on_settlement,
            instance_id: Arc::from(uuid::Uuid::new_v4().to_string()),
        })
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

    pub async fn create(
        &self,
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
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
            self.kill_owned_session(&name).await.with_context(|| {
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
                .kill_owned_session(&name)
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
            self.kill_owned_session(&oldest_key)
                .await
                .with_context(|| {
                    format!("terminal session '{oldest_key}' cleanup incomplete during eviction")
                })?;
        }

        let session = TerminalSession::spawn(
            name.clone(),
            command,
            cwd,
            cols,
            rows,
            backend,
            self.output_registry.clone(),
        )?;
        let info = self.session_info(&name, &session);
        self.sessions.lock().await.insert(name, session);
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
        let (output_id, start_cursor, notify) = {
            let mut sessions = self.sessions.lock().await;
            let session = sessions
                .get_mut(name)
                .with_context(|| format!("terminal session '{name}' not found"))?;
            session.refresh_status();
            if !session.is_alive() && !bytes.is_empty() {
                return Err(anyhow!("terminal session '{name}' has already exited"));
            }
            if !bytes.is_empty() {
                session.write(&bytes)?;
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
                .kill_owned_session(name)
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
    pub async fn exec_one_shot(
        &self,
        cmd: &str,
        cwd: Option<PathBuf>,
        _cols: u16,
        _rows: u16,
        yield_ms: u64,
        max_output: usize,
        backend: &ExecutionBackend,
        cancellation: Option<&ThreadCancellation>,
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
        let (mut command, pidfile) = backend.terminal_pipe_command(cmd, cwd.as_deref(), &envs);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let spawned = if self.isolate_process_groups {
            ProcessTreeGuard::spawn_supervised(&mut command)
        } else {
            command.spawn().map(|child| {
                let guard = ProcessTreeGuard::for_child(&child);
                (child, guard)
            })
        };
        let (mut child, mut process_tree) = match spawned {
            Ok(spawned) => spawned,
            Err(error) => {
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
        let output_id = self.output_registry.create(ArtifactKind::Command);
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
            if let Some(pidfile) = pidfile.as_deref() {
                if let Err(error) = backend.terminal_pipe_kill(pidfile).await {
                    runtime_error = Some(format!("remote command cleanup incomplete: {error}"));
                }
            }
            match process_tree.terminate(&mut child).await {
                Ok(()) => force_reader_shutdown = true,
                Err(error) => {
                    reader_shutdown.cancel();
                    let cleanup_error = format!("command cleanup incomplete: {error}");
                    runtime_error = Some(match runtime_error.take() {
                        Some(existing) => format!("{existing}\n{cleanup_error}"),
                        None => cleanup_error,
                    });
                }
            }
            exit_code = None;
        } else if self.isolate_process_groups {
            // A successful shell leader can leave background descendants.
            // The dedicated owned group leader prevents pgid reuse while we
            // tear down that group after reaping the requested command.
            process_tree.mark_leader_reaped();
            process_tree.finish().await;
            force_reader_shutdown = true;
        } else {
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
            if let Err(error) = self.kill_owned_session(&name).await {
                cleanup_errors.push(format!(
                    "terminal session '{name}' cleanup incomplete during removal: {error:#}"
                ));
            }
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
            if let Err(error) = self.kill_owned_session(&name).await {
                cleanup_errors.push(format!(
                    "foreground terminal session '{name}' cleanup incomplete: {error:#}"
                ));
            }
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
    async fn kill_owned_session(&self, name: &str) -> Result<Option<TerminalSession>> {
        let mut sessions = self.sessions.lock().await;
        let Some(session) = sessions.get_mut(name) else {
            return Ok(None);
        };
        session.kill().await?;
        Ok(sessions.remove(name))
    }

    pub async fn retain(&self, name: &str) -> Result<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !session.is_alive() {
            return Err(anyhow!("terminal session '{name}' has already exited"));
        }
        session.retain();
        Ok(self.session_info(name, session))
    }

    pub fn has_retained(&self) -> bool {
        self.sessions
            .try_lock()
            .map(|mut sessions| {
                sessions.values_mut().any(|session| {
                    session.refresh_status();
                    session.is_retained() && session.is_alive()
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
mod tests {

    #[tokio::test]
    async fn pipe_reader_shutdown_preserves_queued_output_and_closes_channel() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, reader) = tokio::io::duplex(64);
        let (sender, mut receiver) = mpsc::channel(1);
        let shutdown = ThreadCancellation::default();
        let handle = tokio::spawn(read_chunks(
            reader,
            OutputStream::Stdout,
            sender,
            shutdown.clone(),
        ));

        writer.write_all(b"before shutdown").await.unwrap();
        let chunk = receiver.recv().await.unwrap();
        assert_eq!(chunk.bytes, b"before shutdown");

        shutdown.cancel();
        tokio::time::timeout(Duration::from_secs(1), handle)
            .await
            .expect("reader did not stop")
            .unwrap()
            .unwrap();
        assert!(receiver.recv().await.is_none());
    }
    use super::*;
    use crate::paths::PathContext;
    use crate::sandbox::{
        select_execution_backend, SandboxSession, SandboxSpec, SshConnection, DEFAULT_SANDBOX_IMAGE,
    };

    fn backend() -> Arc<ExecutionBackend> {
        crate::sandbox::execution_backend_from_sandbox(
            None,
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
        )
    }

    #[cfg(unix)]
    fn current_thread_cpu_time() -> Duration {
        let mut time = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        let result = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut time) };
        assert_eq!(result, 0, "failed to read thread CPU clock");
        Duration::new(time.tv_sec as u64, time.tv_nsec as u32)
    }

    #[tokio::test]
    async fn one_shot_preserves_separate_streams_and_nonzero_exit() {
        let manager = TerminalManager::new();
        let output = manager
            .exec_one_shot(
                "printf out; printf err >&2; exit 7",
                None,
                120,
                40,
                5_000,
                8_000,
                &backend(),
                None,
            )
            .await;
        assert_eq!(output.status, CommandStatus::Completed);
        assert_eq!(output.exit_code, Some(7));
        assert_eq!(output.stdout_preview, "out");
        assert_eq!(output.stderr_preview, "err");
        let id = output.output_id.unwrap();
        assert_eq!(
            manager
                .read_output(&id, OutputStream::Combined, 0, 32)
                .unwrap()
                .content,
            "outerr"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_one_shot_kills_background_descendants() {
        let manager = TerminalManager::new();
        let root =
            std::env::temp_dir().join(format!("nac-one-shot-descendant-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pid_path = root.join("pid");
        let command = format!(
            "sh -c 'trap \"\" HUP TERM; printf %s $$ > {}; exec sleep 30' </dev/null >/dev/null 2>&1 & while [ ! -s {} ]; do sleep 0.01; done",
            pid_path.display(),
            pid_path.display(),
        );
        let output = manager
            .exec_one_shot(&command, None, 120, 40, 5_000, 8_000, &backend(), None)
            .await;
        assert_eq!(output.status, CommandStatus::Completed);
        assert_eq!(output.exit_code, Some(0));
        let pid = std::fs::read_to_string(&pid_path)
            .unwrap()
            .parse::<libc::pid_t>()
            .unwrap();
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "descendant survived");
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn worker_one_shot_does_not_hang_on_descendant_inherited_pipes() {
        let manager =
            TerminalManager::for_worker_with_limits(CommandOutputLimits::default()).unwrap();
        let root = std::env::temp_dir().join(format!(
            "nac-worker-one-shot-pipes-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let pid_path = root.join("pid");
        let command = format!(
            "sh -c 'trap \"\" HUP TERM; printf %s $$ > {}; sleep 30' & while [ ! -s {} ]; do sleep 0.01; done",
            pid_path.display(),
            pid_path.display(),
        );
        let output = tokio::time::timeout(
            Duration::from_secs(2),
            manager.exec_one_shot(&command, None, 120, 40, 5_000, 8_000, &backend(), None),
        )
        .await
        .expect("worker one-shot remained blocked on descendant-owned pipes");
        assert_eq!(output.status, CommandStatus::Completed);
        assert_eq!(output.exit_code, Some(0));
        let pid = std::fs::read_to_string(&pid_path)
            .unwrap()
            .parse::<libc::pid_t>()
            .unwrap();
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "descendant survived");
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_settlement_surfaces_remote_cleanup_failure() {
        use std::os::unix::fs::PermissionsExt;

        struct RestorePath(Option<std::ffi::OsString>);
        impl Drop for RestorePath {
            fn drop(&mut self) {
                unsafe {
                    match self.0.take() {
                        Some(path) => std::env::set_var("PATH", path),
                        None => std::env::remove_var("PATH"),
                    }
                }
            }
        }

        let _environment = crate::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_path = std::env::var_os("PATH");
        let _restore = RestorePath(original_path.clone());
        let root = std::env::temp_dir().join(format!(
            "nac-terminal-cleanup-error-{}",
            uuid::Uuid::new_v4()
        ));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let podman = bin.join("podman");
        let calls = root.join("calls");
        std::fs::write(
            &podman,
            format!(
                "#!/bin/sh\nif [ ! -e '{}' ]; then touch '{}'; exit 23; fi\nexit 0\n",
                calls.display(),
                calls.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut paths = vec![bin];
        if let Some(path) = original_path.as_ref() {
            paths.extend(std::env::split_paths(path));
        }
        unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

        let manager = TerminalManager::new();
        manager
            .create("remote".to_string(), "sleep 30", None, 120, 40, &backend())
            .await
            .unwrap();
        let remote_backend = crate::sandbox::execution_backend_from_sandbox(
            Some(SandboxSession::new_for_test(SandboxSpec {
                workdir: root.clone(),
                ..Default::default()
            })),
            &root,
        );
        manager
            .sessions
            .lock()
            .await
            .get_mut("remote")
            .unwrap()
            .set_backend_cleanup_for_test(remote_backend, "/tmp/nac-test.pid".to_string());

        let error = manager.settle_run().await.unwrap_err().to_string();
        assert!(
            error.contains("Podman command cleanup exited with status"),
            "unexpected settlement error: {error}"
        );
        assert!(manager.sessions.lock().await.contains_key("remote"));
        manager.settle_run().await.unwrap();
        assert!(manager.sessions.lock().await.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cleanup_cancellation_preserves_ownership_and_parallel_create_keeps_capacity() {
        use std::os::unix::fs::PermissionsExt;

        struct RestorePath(Option<std::ffi::OsString>);
        impl Drop for RestorePath {
            fn drop(&mut self) {
                unsafe {
                    match self.0.take() {
                        Some(path) => std::env::set_var("PATH", path),
                        None => std::env::remove_var("PATH"),
                    }
                }
            }
        }

        let _environment = crate::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_path = std::env::var_os("PATH");
        let _restore = RestorePath(original_path.clone());
        let root =
            std::env::temp_dir().join(format!("nac-terminal-cancel-safe-{}", uuid::Uuid::new_v4()));
        let bin = root.join("bin");
        let started = root.join("cleanup-started");
        std::fs::create_dir_all(&bin).unwrap();
        let podman = bin.join("podman");
        std::fs::write(
            &podman,
            format!(
                "#!/bin/sh\nif [ ! -e '{}' ]; then touch '{}'; sleep 1; fi\nexit 0\n",
                started.display(),
                started.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut paths = vec![bin];
        if let Some(path) = original_path.as_ref() {
            paths.extend(std::env::split_paths(path));
        }
        unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

        let mut manager = TerminalManager::new();
        manager.max_sessions = 1;
        manager
            .create("first".to_string(), "sleep 30", None, 120, 40, &backend())
            .await
            .unwrap();
        let remote_backend = crate::sandbox::execution_backend_from_sandbox(
            Some(SandboxSession::new_for_test(SandboxSpec {
                workdir: root.clone(),
                ..Default::default()
            })),
            &root,
        );
        manager
            .set_backend_cleanup_for_test(
                "first",
                remote_backend,
                "/tmp/nac-cancel-safe.pid".to_string(),
            )
            .await
            .unwrap();

        let cleanup_manager = manager.clone();
        let cleanup = tokio::spawn(async move { cleanup_manager.settle_run().await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !started.exists() {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        cleanup.abort();
        assert!(cleanup.await.unwrap_err().is_cancelled());
        assert!(manager.get("first").await.is_some());

        // Let the abandoned helper exit, then force the eviction cleanup in
        // the first create to pause again while a second create arrives.
        sleep(Duration::from_millis(1100)).await;
        std::fs::remove_file(&started).unwrap();
        let create_a_manager = manager.clone();
        let local_backend = backend();
        let create_a_backend = local_backend.clone();
        let create_a = tokio::spawn(async move {
            create_a_manager
                .create(
                    "second".to_string(),
                    "sleep 30",
                    None,
                    120,
                    40,
                    &create_a_backend,
                )
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !started.exists() {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let create_b_manager = manager.clone();
        let create_b_backend = local_backend;
        let create_b = tokio::spawn(async move {
            create_b_manager
                .create(
                    "third".to_string(),
                    "sleep 30",
                    None,
                    120,
                    40,
                    &create_b_backend,
                )
                .await
        });
        create_a.await.unwrap().unwrap();
        create_b.await.unwrap().unwrap();

        let sessions = manager.sessions.lock().await;
        assert_eq!(sessions.len(), 1);
        assert!(sessions.contains_key("third"));
        drop(sessions);
        manager.remove_all().await.unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn one_shot_timeout_is_structured() {
        let manager = TerminalManager::new();
        let output = manager
            .exec_one_shot("sleep 5", None, 120, 40, 20, 8_000, &backend(), None)
            .await;

        assert_eq!(output.status, CommandStatus::TimedOut);
        assert_eq!(output.exit_code, None);
    }

    #[cfg(target_os = "linux")]
    async fn run_one_shot_with_pidfd_failure(cancel: bool) -> CommandOutput {
        let _test_lock = crate::process::PIDFD_OPEN_FAILURE_LOCK.lock().await;
        let manager = TerminalManager::new();
        let root = std::env::temp_dir().join(format!("nac-pidfd-failure-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pidfile = root.join("descendant-pid");
        let command = format!(
            "setsid sh -c 'printf $$ > {pidfile}; printf child-output; \
             printf child-error >&2; trap \"\" TERM; sleep 30' & \
             printf parent-output; printf parent-error >&2; sleep 30",
            pidfile = pidfile.display()
        );
        let cancellation = ThreadCancellation::default();
        let task_cancellation = cancellation.clone();
        let task_manager = manager.clone();
        let task_backend = backend();
        let timeout_ms = if cancel { 5_000 } else { 200 };
        let task = tokio::spawn(async move {
            task_manager
                .exec_one_shot(
                    &command,
                    None,
                    120,
                    40,
                    timeout_ms,
                    8_000,
                    &task_backend,
                    cancel.then_some(&task_cancellation),
                )
                .await
        });

        let descendant_pid = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Ok(pid) = std::fs::read_to_string(&pidfile) {
                    break pid.parse::<libc::pid_t>().unwrap();
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("isolated descendant did not publish its pid");
        struct PidfdFailureReset;
        impl Drop for PidfdFailureReset {
            fn drop(&mut self) {
                crate::process::set_pidfd_open_failure_for_test(0);
            }
        }
        let _failure_reset = PidfdFailureReset;
        crate::process::set_pidfd_open_failure_for_test(descendant_pid);
        if cancel {
            cancellation.cancel();
        }

        let output = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("one-shot cleanup remained blocked on inherited pipes")
            .unwrap();

        assert_eq!(output.exit_code, None);
        assert!(output.stdout_preview.contains("parent-output"));
        assert!(output.stdout_preview.contains("child-output"));
        assert!(output.stderr_preview.contains("parent-error"));
        assert!(output.stderr_preview.contains("child-error"));
        assert!(output.stderr_preview.contains("command cleanup incomplete"));

        unsafe {
            libc::kill(descendant_pid, libc::SIGKILL);
        }
        let _ = std::fs::remove_dir_all(root);
        output
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn one_shot_pidfd_failure_is_bounded_and_preserves_timeout_output() {
        let output = run_one_shot_with_pidfd_failure(false).await;
        assert_eq!(output.status, CommandStatus::TimedOut);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn one_shot_pidfd_failure_is_bounded_and_preserves_cancellation_output() {
        let output = run_one_shot_with_pidfd_failure(true).await;
        assert_eq!(output.status, CommandStatus::Cancelled);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn one_shot_closed_pipes_do_not_busy_spin() {
        let manager = TerminalManager::new();
        let wall_start = Instant::now();
        let cpu_start = current_thread_cpu_time();
        let output = manager
            .exec_one_shot(
                "printf retained; exec 1>&- 2>&-; sleep 0.3",
                None,
                120,
                40,
                1_000,
                8_000,
                &backend(),
                None,
            )
            .await;
        let wall_elapsed = wall_start.elapsed();
        let cpu_elapsed = current_thread_cpu_time().saturating_sub(cpu_start);

        assert_eq!(output.status, CommandStatus::Completed);
        assert_eq!(
            manager
                .read_output(
                    output.output_id.as_deref().unwrap(),
                    OutputStream::Stdout,
                    0,
                    32,
                )
                .unwrap()
                .content,
            "retained"
        );
        assert!(
            cpu_elapsed < wall_elapsed / 2,
            "closed output pipes consumed {cpu_elapsed:?} CPU over {wall_elapsed:?} wall time"
        );
    }

    #[tokio::test]
    async fn one_shot_closed_pipes_still_time_out() {
        let manager = TerminalManager::new();
        let output = manager
            .exec_one_shot(
                "exec 1>&- 2>&-; sleep 5",
                None,
                120,
                40,
                20,
                8_000,
                &backend(),
                None,
            )
            .await;

        assert_eq!(output.status, CommandStatus::TimedOut);
        assert_eq!(output.exit_code, None);
    }

    #[tokio::test]
    async fn one_shot_closed_pipes_still_cancel() {
        let manager = TerminalManager::new();
        let cancellation = ThreadCancellation::default();
        let task_manager = manager.clone();
        let task_backend = backend();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            task_manager
                .exec_one_shot(
                    "exec 1>&- 2>&-; sleep 5",
                    None,
                    120,
                    40,
                    5_000,
                    8_000,
                    task_backend.as_ref(),
                    Some(&task_cancellation),
                )
                .await
        });

        sleep(Duration::from_millis(50)).await;
        cancellation.cancel();
        let output = task.await.unwrap();
        assert_eq!(output.status, CommandStatus::Cancelled);
        assert_eq!(output.exit_code, None);
    }

    #[tokio::test]
    async fn one_shot_spawn_failure_is_structured() {
        let manager = TerminalManager::new();
        let missing =
            std::env::temp_dir().join(format!("nac-missing-command-cwd-{}", uuid::Uuid::new_v4()));
        let output = manager
            .exec_one_shot(
                "printf unreachable",
                Some(missing),
                120,
                40,
                1_000,
                1_000,
                &backend(),
                None,
            )
            .await;
        assert_eq!(output.status, CommandStatus::SpawnError);
        assert_eq!(output.exit_code, None);
        assert!(output.stderr_preview.contains("spawn"));
    }

    #[tokio::test]
    async fn one_shot_output_is_bounded_while_retaining_middle() {
        let manager = TerminalManager::with_limits(CommandOutputLimits {
            per_command_bytes: 3 * 1024 * 1024,
            per_session_bytes: 4 * 1024 * 1024,
        })
        .unwrap();
        let counter =
            std::env::temp_dir().join(format!("nac-command-once-{}", uuid::Uuid::new_v4()));
        let command = format!(
            "python3 -c 'from pathlib import Path; import sys; p=Path(r\"{}\"); p.write_text(\"1\" if not p.exists() else p.read_text()+\"1\"); sys.stdout.write(\"a\"*(1024*1024)+\"UNIQUE_DIAGNOSTIC\"+\"z\"*(1024*1024))'",
            counter.display()
        );
        let output = manager
            .exec_one_shot(&command, None, 120, 40, 10_000, 1_000, &backend(), None)
            .await;
        assert!(output.truncated);
        assert!(!output.stdout_preview.contains("UNIQUE_DIAGNOSTIC"));
        let id = output.output_id.unwrap();
        let page = manager
            .read_output(&id, OutputStream::Stdout, 1024 * 1024 - 8, 64)
            .unwrap();
        assert!(page.content.contains("UNIQUE_DIAGNOSTIC"));
        assert_eq!(std::fs::read_to_string(&counter).unwrap(), "1");
        let _ = std::fs::remove_file(counter);
    }

    #[tokio::test]
    async fn noisy_producer_never_retains_more_than_the_configured_cap() {
        let manager = TerminalManager::with_limits(CommandOutputLimits {
            per_command_bytes: 64 * 1024,
            per_session_bytes: 64 * 1024,
        })
        .unwrap();
        let output = manager
            .exec_one_shot(
                "python3 -c 'import sys; sys.stdout.write(\"x\"*(2*1024*1024))'",
                None,
                120,
                40,
                10_000,
                100,
                &backend(),
                None,
            )
            .await;
        assert!(output.overflowed);
        let page = manager
            .read_output(
                output.output_id.as_deref().unwrap(),
                OutputStream::Stdout,
                0,
                64 * 1024,
            )
            .unwrap();
        assert_eq!(page.retained_end - page.retained_start, 64 * 1024);
        assert_eq!(page.content.len(), 64 * 1024);
    }

    #[tokio::test]
    async fn explicit_cancellation_is_structured_and_stops_late_side_effects() {
        let manager = TerminalManager::new();
        let cancellation = ThreadCancellation::default();
        let path = std::env::temp_dir().join(format!("nac-command-cancel-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let command = format!("sleep 1; printf late > {}", path.display());
        let task_manager = manager.clone();
        let task_backend = backend();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            task_manager
                .exec_one_shot(
                    &command,
                    None,
                    120,
                    40,
                    5_000,
                    8_000,
                    task_backend.as_ref(),
                    Some(&task_cancellation),
                )
                .await
        });

        sleep(Duration::from_millis(50)).await;
        cancellation.cancel();
        let output = task.await.unwrap();
        assert_eq!(output.status, CommandStatus::Cancelled);
        assert_eq!(output.exit_code, None);
        sleep(Duration::from_millis(100)).await;
        assert!(
            !path.exists(),
            "cancelled command produced a late side effect"
        );
    }

    #[tokio::test]
    async fn registry_clear_terminates_an_active_one_shot_command() {
        let manager = TerminalManager::new();
        let path = std::env::temp_dir().join(format!(
            "nac-command-registry-clear-{}",
            uuid::Uuid::new_v4()
        ));
        let command = format!(
            "python3 -c 'from pathlib import Path; from threading import Timer; import sys; \
             Timer(1,lambda:Path(r\"{}\").write_text(\"late\")).start(); \
             exec(\"while True:\\n sys.stdout.write(\\\"x\\\"*65536)\\n sys.stdout.flush()\")'",
            path.display()
        );
        let task_manager = manager.clone();
        let task_backend = backend();
        let task = tokio::spawn(async move {
            task_manager
                .exec_one_shot(
                    &command,
                    None,
                    120,
                    40,
                    5_000,
                    8_000,
                    task_backend.as_ref(),
                    None,
                )
                .await
        });

        sleep(Duration::from_millis(50)).await;
        manager.remove_all().await.unwrap();
        let output = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("one-shot command stalled after registry clear")
            .unwrap();
        assert_eq!(output.status, CommandStatus::SpawnError);
        sleep(Duration::from_millis(1_100)).await;
        assert!(
            !path.exists(),
            "registry-cleared command produced a late side effect"
        );
    }

    #[tokio::test]
    async fn cancellation_before_spawn_never_starts_the_command() {
        let manager = TerminalManager::new();
        let cancellation = ThreadCancellation::default();
        cancellation.cancel();
        let path =
            std::env::temp_dir().join(format!("nac-command-pre-cancel-{}", uuid::Uuid::new_v4()));
        let output = manager
            .exec_one_shot(
                &format!("printf late > {}", path.display()),
                None,
                120,
                40,
                5_000,
                8_000,
                &backend(),
                Some(&cancellation),
            )
            .await;
        assert_eq!(output.status, CommandStatus::Cancelled);
        assert_eq!(output.output_id, None);
        assert!(!path.exists(), "pre-cancelled command was spawned");
    }

    #[tokio::test]
    async fn pty_cancellation_stops_waiting_and_late_side_effects() {
        let manager = TerminalManager::new();
        let backend = backend();
        manager
            .create("pty-cancel".to_string(), "bash", None, 120, 40, &backend)
            .await
            .unwrap();
        let cancellation = ThreadCancellation::default();
        let path = std::env::temp_dir().join(format!("nac-pty-cancel-{}", uuid::Uuid::new_v4()));
        let command = format!("sleep 1; printf late > {}<RET>", path.display());
        let task_manager = manager.clone();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            task_manager
                .write_stdin(
                    "pty-cancel",
                    &command,
                    5_000,
                    8_000,
                    Some(&task_cancellation),
                )
                .await
        });
        sleep(Duration::from_millis(50)).await;
        cancellation.cancel();
        let error = task.await.unwrap().unwrap_err();
        assert!(error.to_string().contains("cancelled"));
        sleep(Duration::from_millis(1_100)).await;
        assert!(!path.exists(), "cancelled PTY produced a late side effect");
        assert!(manager.get("pty-cancel").await.is_none());
    }

    #[tokio::test]
    async fn direct_run_settlement_keeps_only_explicitly_retained_terminals() {
        let manager = TerminalManager::for_direct();
        let backend = backend();
        let foreground = manager.next_session_name();
        let retained = manager.next_session_name();
        manager
            .create(foreground.clone(), "bash", None, 120, 40, &backend)
            .await
            .unwrap();
        manager
            .create(retained.clone(), "bash", None, 120, 40, &backend)
            .await
            .unwrap();
        let info = manager.retain(&retained).await.unwrap();
        assert!(info.retained);

        manager.settle_run().await.unwrap();
        assert!(manager.get(&foreground).await.is_none());
        assert!(manager.get(&retained).await.unwrap().retained);
        manager.remove_all().await.unwrap();
    }

    #[tokio::test]
    async fn exited_retained_terminals_do_not_exhaust_live_capacity() {
        let manager = TerminalManager::for_direct();
        let backend = backend();
        let marker =
            std::env::temp_dir().join(format!("nac-retained-capacity-{}", uuid::Uuid::new_v4()));
        let command = format!("while [ ! -e {} ]; do sleep 0.01; done", marker.display());
        let mut names = Vec::new();
        for _ in 0..manager.max_sessions {
            let name = manager.next_session_name();
            manager
                .create(name.clone(), &command, None, 120, 40, &backend)
                .await
                .unwrap();
            manager.retain(&name).await.unwrap();
            names.push(name);
        }
        std::fs::write(&marker, b"done").unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let mut all_exited = true;
                for name in &names {
                    all_exited &= manager.get(name).await.is_some_and(|info| !info.alive);
                }
                if all_exited {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("retained commands did not exit");

        let replacement = manager.next_session_name();
        manager
            .create(replacement.clone(), "sleep 30", None, 120, 40, &backend)
            .await
            .expect("exited retained handles must be reaped before capacity is checked");
        assert!(manager.get(&replacement).await.is_some());
        let completed = manager
            .write_stdin(&names[0], "", 0, 8_000, None)
            .await
            .expect("reaped retained status remains observable through a bounded tombstone");
        assert_eq!(completed.exit_code, Some(0));
        assert!(completed.session_name.is_none());
        manager.remove_all().await.unwrap();
        let _ = std::fs::remove_file(marker);
    }

    #[tokio::test]
    async fn direct_cancellation_stops_foreground_and_preserves_retained_terminal() {
        let manager = TerminalManager::for_direct();
        let backend = backend();
        let foreground = manager.next_session_name();
        let retained = manager.next_session_name();
        manager
            .create(foreground.clone(), "bash", None, 120, 40, &backend)
            .await
            .unwrap();
        manager
            .create(retained.clone(), "bash", None, 120, 40, &backend)
            .await
            .unwrap();
        manager.retain(&retained).await.unwrap();
        let cancellation = ThreadCancellation::default();
        cancellation.cancel();
        assert!(manager
            .write_stdin(&foreground, "", 10, 100, Some(&cancellation))
            .await
            .unwrap_err()
            .to_string()
            .contains("cancelled"));
        assert!(manager.get(&foreground).await.is_none());
        assert!(manager.get(&retained).await.is_some());
        manager.remove_all().await.unwrap();
    }

    #[test]
    fn stale_terminal_handle_reports_process_local_restart_loss() {
        let prior = TerminalManager::for_direct();
        let stale = prior.next_session_name();
        let current = TerminalManager::for_direct();
        assert!(current
            .missing_session_error(&stale)
            .to_string()
            .contains("previous nac service instance"));
        assert!(current
            .missing_session_error(&current.next_session_name())
            .to_string()
            .contains("closed or expired"));
    }

    #[tokio::test]
    async fn pty_preview_does_not_destroy_omitted_output() {
        let manager = TerminalManager::new();
        let backend = backend();
        manager
            .create("pty-recovery".to_string(), "bash", None, 120, 40, &backend)
            .await
            .unwrap();
        let output = manager
            .write_stdin(
                "pty-recovery",
                "python3 -c 'print(\"a\"*9000+bytes([80,84,89,95,68,73,65,71,78,79,83,84,73,67]).decode()+\"z\"*9000)'<RET>",
                1_000,
                100,
                None,
            )
            .await
            .unwrap();
        assert!(output.truncated);
        assert!(!output.content_preview.contains("PTY_DIAGNOSTIC"));

        let first = manager
            .read_output(
                &output.output_id,
                OutputStream::Combined,
                output.start_cursor,
                32 * 1024,
            )
            .unwrap();
        let repeated = manager
            .read_output(
                &output.output_id,
                OutputStream::Combined,
                output.start_cursor,
                32 * 1024,
            )
            .unwrap();
        assert_eq!(first.content, repeated.content);
        assert!(first.content.contains("PTY_DIAGNOSTIC"));
        manager.remove_all().await.unwrap();
    }

    #[tokio::test]
    async fn remove_all_expires_command_output() {
        let manager = TerminalManager::new();
        let output = manager
            .exec_one_shot(
                "printf hello",
                None,
                120,
                40,
                1_000,
                8_000,
                &backend(),
                None,
            )
            .await;
        let id = output.output_id.unwrap();
        manager.remove_all().await.unwrap();
        assert!(manager
            .read_output(&id, OutputStream::Combined, 0, 32)
            .is_err());
    }

    async fn assert_remote_backend_output_contract(backend: Arc<ExecutionBackend>) {
        let manager = TerminalManager::with_limits(CommandOutputLimits {
            per_command_bytes: 3 * 1024 * 1024,
            per_session_bytes: 4 * 1024 * 1024,
        })
        .unwrap();
        let marker = format!("/tmp/nac-command-once-{}", uuid::Uuid::new_v4());
        let command = format!(
            "python3 -c 'from pathlib import Path; import sys; p=Path(\"{marker}\"); p.write_text(\"1\" if not p.exists() else p.read_text()+\"1\"); sys.stdout.write(\"a\"*(1024*1024)+\"REMOTE_DIAGNOSTIC\"+\"z\"*(1024*1024)); sys.stderr.write(\"remote-err\\n\"); raise SystemExit(7)'"
        );
        let output = manager
            .exec_one_shot(
                &command,
                None,
                120,
                40,
                30_000,
                1_000,
                backend.as_ref(),
                None,
            )
            .await;
        assert_eq!(output.status, CommandStatus::Completed);
        assert_eq!(output.exit_code, Some(7));
        assert!(output.truncated);
        assert!(!output.stdout_preview.contains("REMOTE_DIAGNOSTIC"));
        assert_eq!(output.stderr_preview, "remote-err\n");
        let output_id = output.output_id.unwrap();
        let diagnostic = manager
            .read_output(&output_id, OutputStream::Stdout, 1024 * 1024 - 8, 64)
            .unwrap();
        assert!(diagnostic.content.contains("REMOTE_DIAGNOSTIC"));

        let mut offset = 0;
        let mut total = 0;
        loop {
            let page = manager
                .read_output(&output_id, OutputStream::Combined, offset, 32 * 1024)
                .unwrap();
            assert_eq!(page.offset, offset);
            total += page.content.len();
            offset = page.next_offset;
            if page.eof {
                break;
            }
        }
        assert_eq!(total, 2 * 1024 * 1024 + "REMOTE_DIAGNOSTIC".len() + 11);

        let counter = manager
            .exec_one_shot(
                &format!("cat {marker}; rm -f {marker}"),
                None,
                120,
                40,
                10_000,
                1_000,
                backend.as_ref(),
                None,
            )
            .await;
        assert_eq!(counter.stdout_preview, "1");

        let cancellation = ThreadCancellation::default();
        let cancellation_marker = format!("/tmp/nac-command-cancel-{}", uuid::Uuid::new_v4());
        let task_manager = manager.clone();
        let task_backend = Arc::clone(&backend);
        let task_cancellation = cancellation.clone();
        let task_marker = cancellation_marker.clone();
        let task = tokio::spawn(async move {
            task_manager
                .exec_one_shot(
                    &format!("trap '' TERM; sleep 1; printf late > {task_marker}"),
                    None,
                    120,
                    40,
                    10_000,
                    1_000,
                    task_backend.as_ref(),
                    Some(&task_cancellation),
                )
                .await
        });
        sleep(Duration::from_millis(50)).await;
        cancellation.cancel();
        let cancelled = task.await.unwrap();
        assert_eq!(cancelled.status, CommandStatus::Cancelled);
        sleep(Duration::from_millis(1_100)).await;
        let side_effect_check = manager
            .exec_one_shot(
                &format!(
                    "test ! -e {cancellation_marker}; status=$?; rm -f {cancellation_marker}; exit $status"
                ),
                None,
                120,
                40,
                10_000,
                1_000,
                backend.as_ref(),
                None,
            )
            .await;
        assert_eq!(
            side_effect_check.exit_code,
            Some(0),
            "cancelled remote command produced a late side effect"
        );

        let timed_out = manager
            .exec_one_shot("sleep 5", None, 120, 40, 100, 1_000, backend.as_ref(), None)
            .await;
        assert_eq!(timed_out.status, CommandStatus::TimedOut);
        assert_eq!(timed_out.exit_code, None);
    }

    #[tokio::test]
    #[ignore = "requires a running Podman machine and the configured image"]
    async fn podman_backend_preserves_output_contract() {
        let image = std::env::var("NAC_TEST_PODMAN_IMAGE")
            .unwrap_or_else(|_| DEFAULT_SANDBOX_IMAGE.to_string());
        let sandbox = SandboxSession::create(
            SandboxSpec {
                image,
                ..Default::default()
            },
            format!("output-artifacts-test-{}", uuid::Uuid::new_v4()),
            true,
            "output-artifacts-test".to_string(),
        )
        .await
        .unwrap();
        assert_remote_backend_output_contract(crate::sandbox::execution_backend_from_sandbox(
            Some(sandbox),
            &std::env::current_dir().unwrap(),
        ))
        .await;
    }

    #[tokio::test]
    #[ignore = "requires NAC_TEST_SSH_HOST, NAC_TEST_SSH_PORT, and NAC_TEST_SSH_KEY"]
    async fn openssh_backend_preserves_output_contract() {
        let connection = SshConnection {
            host: std::env::var("NAC_TEST_SSH_HOST").unwrap(),
            port: Some(std::env::var("NAC_TEST_SSH_PORT").unwrap().parse().unwrap()),
            identity_file: Some(PathBuf::from(std::env::var("NAC_TEST_SSH_KEY").unwrap())),
        };
        let cwd = PathBuf::from("/tmp");
        let paths = PathContext::new(std::env::current_dir().unwrap());
        let backend =
            select_execution_backend(Some(connection), None, &cwd, &paths).expect("SSH backend");
        backend.ensure_ready().await.unwrap();
        assert_remote_backend_output_contract(backend).await;
    }
}
