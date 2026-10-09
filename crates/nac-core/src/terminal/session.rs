use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use anyhow::anyhow;
use anyhow::{Context, Result};
use portable_pty::{NativePtySystem, PtySize, PtySystem};
use tokio::sync::Notify;

use super::collector::{CollectorState, PtyCollector};
use super::input::PtyInput;
use super::{ArtifactKind, OutputArtifactLease, OutputRegistry};
#[cfg(all(unix, not(target_os = "linux")))]
use crate::process::signal_descendants;
#[cfg(target_os = "linux")]
use crate::process::{process_start_time, signal_descendants};
use crate::sandbox::ExecutionBackend;

pub struct TerminalSession {
    pub name: String,
    writer: PtyInput,
    output_id: String,
    _output_lease: OutputArtifactLease,
    preview_cursor: u64,
    output_notify: Arc<Notify>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    #[cfg(target_os = "linux")]
    root_start_time: u64,
    #[cfg(unix)]
    process_group_id: Option<libc::pid_t>,
    _model_slave: Option<Box<dyn portable_pty::SlavePty + Send>>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    collector_state: CollectorState,
    user_owned: bool,
    _reader_thread: std::thread::JoinHandle<()>,
    pub created_at: Instant,
    pub last_output_at: Instant,
    alive: Arc<AtomicBool>,
    exit_code: Option<i32>,
    retained: bool,
    _workspace_activity: Option<crate::sessions::WorkspaceActivityLease>,
    _session_resource: Option<crate::sessions::SessionResourceLease>,
    _telemetry_child: Option<crate::telemetry::ChildProcessGuard>,
    /// Remote process-tree cleanup: backends that return a pidfile from
    /// `terminal_pty_command` get a backend-side kill on session teardown.
    backend_cleanup: Option<(Arc<ExecutionBackend>, String)>,
    durable_cleanup: Option<(PathBuf, String, String)>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSession {
    #[expect(
        clippy::too_many_arguments,
        reason = "PTY creation keeps command, geometry, backend, output lease, and environment authority explicit"
    )]
    pub fn spawn(
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        output_registry: OutputRegistry,
        extra_envs: &[(String, String)],
        cleanup_authority: Option<(PathBuf, String)>,
    ) -> Result<Self> {
        Self::spawn_with_output(
            name,
            command,
            cwd,
            cols,
            rows,
            backend,
            output_registry,
            extra_envs,
            cleanup_authority,
            None,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "PTY construction keeps output sanitization and execution authority explicit"
    )]
    pub(super) fn spawn_with_output(
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        output_registry: OutputRegistry,
        extra_envs: &[(String, String)],
        cleanup_authority: Option<(PathBuf, String)>,
        user_output: Option<nac_contracts::CommandOutputRedactor>,
    ) -> Result<Self> {
        let user_owned = user_output.is_some();
        let pty_system = NativePtySystem::default();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY pair")?;
        // Reserve bounded output metadata before the command can exist. If
        // every slot belongs to a live command, fail without spawning a PTY
        // process whose output could not be retained.
        let output_lease = output_registry.create(ArtifactKind::Pty)?;
        let output_id = output_lease.output_id().to_string();

        let mut envs = if user_owned {
            user_terminal_env()
        } else {
            terminal_env_owned()
        };
        envs.extend(extra_envs.iter().cloned());
        let (mut cmd, pidfile) = backend.terminal_pty_command(command, cwd.as_deref(), &envs);
        if user_owned && !extra_envs.iter().any(|(name, _)| name == "NO_COLOR") {
            // Presence-based color consumers must not inherit the model/host
            // NO_COLOR setting; an explicit launch snapshot still wins.
            cmd.env_remove("NO_COLOR");
        }
        // resolved_cwd mirrors the default-workdir fallback inside each
        // backend's terminal_pty_command: explicit cwd if provided, otherwise
        // the backend's default terminal directory. Keep these in sync.
        let resolved_cwd = cwd.unwrap_or_else(|| backend.default_terminal_cwd());
        let backend_cleanup = pidfile.map(|pidfile| (Arc::clone(backend), pidfile));
        // Prepare every fallible PTY I/O handle before a child or durable
        // cleanup obligation can exist.
        let reader = pty_pair
            .master
            .try_clone_reader()
            .context("Failed to clone PTY reader")?;
        let writer = pty_pair
            .master
            .take_writer()
            .context("Failed to take PTY writer")?;

        let writer = PtyInput::new(writer, user_owned)?;
        let durable_cleanup = match (backend_cleanup.as_ref(), cleanup_authority) {
            (Some((_, pidfile)), Some((store_path, session_id))) => {
                crate::store::record_terminal_remote_cleanup(&store_path, &session_id, pidfile)?;
                Some((store_path, session_id, pidfile.clone()))
            }
            _ => None,
        };

        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command in PTY");
        let child = match child {
            Ok(child) => child,
            Err(error) => {
                if let Some((store_path, session_id, pidfile)) = durable_cleanup.as_ref() {
                    let _ = crate::store::clear_terminal_remote_cleanup(
                        store_path, session_id, pidfile,
                    );
                }
                return Err(error);
            }
        };
        let portable_pty::PtyPair { master, slave } = pty_pair;
        // The child owns its slave descriptors after spawn. Keeping another
        // slave open in NAC prevents Linux master EOF even after the child
        // exits, withholding the redactor's safe final suffix and leases.
        // Preserve the established model PTY lifetime independently.
        let model_slave = if user_owned {
            drop(slave);
            None
        } else {
            Some(slave)
        };
        #[cfg(target_os = "linux")]
        let mut child = child;
        #[cfg(target_os = "linux")]
        let root_start_time = {
            let start_time = child
                .process_id()
                .and_then(|pid| process_start_time(pid as libc::pid_t));
            let Some(start_time) = start_time else {
                let _ = child.kill();
                if let Some((store_path, session_id, pidfile)) = durable_cleanup.as_ref() {
                    let _ = crate::store::clear_terminal_remote_cleanup(
                        store_path, session_id, pidfile,
                    );
                }
                return Err(anyhow!("Failed to capture PTY root process identity"));
            };
            start_time
        };
        #[cfg(unix)]
        let process_group_id = child.process_id().and_then(|pid| {
            let pid = pid as libc::pid_t;
            // SAFETY: `getpgid` accepts any integer process id; a failed lookup
            // returns -1 and therefore cannot equal the child id.
            let group = unsafe { libc::getpgid(pid) };
            (group == pid).then_some(group)
        });

        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = Arc::clone(&alive);
        let reader_output_id = output_id.clone();
        let reader_output_registry = output_registry;
        let notify = Arc::new(Notify::new());
        let notify_clone = Arc::clone(&notify);

        let collector_state = CollectorState::default();
        let collector = PtyCollector {
            registry: reader_output_registry,
            output_id: reader_output_id,
            redactor: user_output,
            alive: alive_clone,
            notify: notify_clone,
            state: collector_state.clone(),
        };
        let reader_thread = std::thread::spawn(move || collector.collect(reader));

        Ok(TerminalSession {
            name,
            writer,
            output_id,
            _output_lease: output_lease,
            preview_cursor: 0,
            output_notify: notify,
            child,
            #[cfg(target_os = "linux")]
            root_start_time,
            #[cfg(unix)]
            process_group_id,
            _model_slave: model_slave,
            master,
            collector_state,
            user_owned,
            _reader_thread: reader_thread,
            created_at: Instant::now(),
            last_output_at: Instant::now(),
            alive,
            exit_code: None,
            retained: false,
            _workspace_activity: None,
            _session_resource: None,
            _telemetry_child: None,
            backend_cleanup,
            durable_cleanup,
            cwd: resolved_cwd,
            cols,
            rows,
        })
    }

    pub fn write(&mut self, data: &[u8]) -> Result<()> {
        self.writer.write_model(data)?;
        self.last_output_at = Instant::now();
        Ok(())
    }

    pub(super) fn enqueue_user_input(
        &mut self,
        bytes: &[u8],
        cancellation: &crate::tools::ThreadCancellation,
    ) -> Result<tokio::sync::oneshot::Receiver<Result<(), &'static str>>> {
        let receipt = self.writer.enqueue_user(bytes, cancellation)?;
        self.last_output_at = Instant::now();
        Ok(receipt)
    }

    pub(super) fn is_user_owned(&self) -> bool {
        self.user_owned
    }

    pub(super) fn collector_state(&self) -> CollectorState {
        self.collector_state.clone()
    }

    pub(super) fn output_complete(&self) -> bool {
        self.collector_state.complete()
    }

    pub(super) fn output_error(&self) -> Option<&'static str> {
        self.collector_state.error()
    }

    pub(super) fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to resize PTY")?;
        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    pub fn output_id(&self) -> &str {
        &self.output_id
    }

    pub fn preview_cursor(&self) -> u64 {
        self.preview_cursor
    }

    pub fn set_preview_cursor(&mut self, cursor: u64) {
        self.preview_cursor = cursor;
        self.last_output_at = Instant::now();
    }

    pub fn output_notify(&self) -> &Arc<Notify> {
        &self.output_notify
    }

    pub fn is_alive(&self) -> bool {
        if self.user_owned {
            // Reader completion/failure is independent of process liveness.
            // A shell that closes its output can still own descendants.
            self.exit_code.is_none()
        } else {
            self.alive.load(Ordering::SeqCst)
        }
    }

    pub fn refresh_status(&mut self) {
        if self.exit_code.is_some() {
            self.alive.store(false, Ordering::SeqCst);
            return;
        }

        #[cfg(unix)]
        if self.process_group_id.is_some() && self.root_exited_without_reaping() {
            // WNOWAIT leaves the exited group leader as a zombie, so its pid
            // and process-group id cannot be recycled between this ownership
            // check and the signal. This reaches surviving same-group
            // descendants without risking a later kill of an unrelated group.
            self.signal_process_group(libc::SIGKILL);
            self.process_group_id = None;
        }

        if let Ok(Some(status)) = self.child.try_wait() {
            self.exit_code = Some(status.exit_code() as i32);
            #[cfg(unix)]
            {
                // Never retain an id after reaping. If the pre-reap ownership
                // check was unavailable or failed, leaking an unusual
                // descendant is safer than signaling a recycled group id.
                self.process_group_id = None;
            }
            self.alive.store(false, Ordering::SeqCst);
        }
    }

    #[cfg(unix)]
    fn root_exited_without_reaping(&self) -> bool {
        let Some(pid) = self.child.process_id().map(|pid| pid as libc::pid_t) else {
            return false;
        };
        // SAFETY: `siginfo_t` is a C output record for which the all-zero byte
        // pattern is a valid initialized state before `waitid` fills it.
        let mut info = unsafe { std::mem::zeroed::<libc::siginfo_t>() };
        // SAFETY: `info` is writable for one `siginfo_t`, `pid` is an integer
        // child id, and the flag combination requests a non-reaping status read.
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        // SAFETY: `info` is initialized above and either remains zeroed or was
        // populated by `waitid`, so reading its pid field is valid.
        result == 0 && unsafe { info.si_pid() } == pid
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }

    pub fn retain(
        &mut self,
        workspace_activity: Option<crate::sessions::WorkspaceActivityLease>,
        session_resource: Option<crate::sessions::SessionResourceLease>,
    ) {
        if !self.retained {
            self.retained = true;
            self._workspace_activity = workspace_activity;
            self._session_resource = session_resource;
        }
    }

    pub fn is_retained(&self) -> bool {
        self.retained
    }

    pub(super) fn has_backend_cleanup(&self) -> bool {
        self.backend_cleanup.is_some()
    }

    pub fn idle_duration(&self) -> Duration {
        self.last_output_at.elapsed()
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.process_id()
    }

    pub(super) fn attach_child_telemetry(&mut self, correlation: crate::telemetry::Correlation) {
        self._telemetry_child = Some(crate::telemetry::ChildProcessGuard::start(
            self.pid(),
            correlation,
        ));
    }

    #[cfg(test)]
    pub(crate) fn set_backend_cleanup_for_test(
        &mut self,
        backend: Arc<ExecutionBackend>,
        pidfile: String,
    ) {
        self.backend_cleanup = Some((backend, pidfile));
    }

    pub async fn kill(&mut self) -> Result<()> {
        self.refresh_status();
        #[cfg(unix)]
        let descendant_result = if self.exit_code.is_none() {
            self.signal_descendants(libc::SIGKILL)
        } else {
            Ok(())
        };
        #[cfg(unix)]
        self.signal_process_group(libc::SIGKILL);

        self.reap_child().await;
        self.alive.store(false, Ordering::SeqCst);
        // A missing remote pidfile is safe only after the local transport is
        // dead and therefore cannot start the wrapper later.
        let backend_cleanup = if let Some((backend, pidfile)) = &self.backend_cleanup {
            backend.terminal_pipe_kill(pidfile).await
        } else {
            Ok(())
        };
        #[cfg(unix)]
        descendant_result?;
        backend_cleanup.context("remote terminal cleanup incomplete")?;
        if let Some((store_path, session_id, pidfile)) = self.durable_cleanup.as_ref() {
            crate::store::clear_terminal_remote_cleanup(store_path, session_id, pidfile)?;
        }
        Ok(())
    }

    pub async fn wait_for_exit_code(&mut self) -> Option<i32> {
        for _ in 0..10 {
            self.refresh_status();
            if self.exit_code.is_some() {
                return self.exit_code;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.exit_code
    }

    #[cfg(target_os = "linux")]
    fn signal_descendants(&self, signal: libc::c_int) -> std::io::Result<()> {
        if let Some(pid) = self.child.process_id() {
            signal_descendants(pid as libc::pid_t, self.root_start_time, signal)
        } else {
            Ok(())
        }
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    fn signal_descendants(&self, signal: libc::c_int) -> std::io::Result<()> {
        if let Some(pid) = self.child.process_id() {
            signal_descendants(pid as libc::pid_t, signal)
        } else {
            Ok(())
        }
    }

    #[cfg(not(unix))]
    fn signal_descendants(&self, _signal: i32) -> std::io::Result<()> {
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn signal_process_group(&self, signal: libc::c_int) {
        let Some(pgid) = self.process_group_id else {
            return;
        };
        // SAFETY: `pgid` was captured for the owned PTY process group;
        // negative `kill` targets a process group and takes no pointers.
        unsafe {
            libc::kill(-pgid, signal);
        }
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    fn signal_process_group(&self, signal: libc::c_int) {
        if let Some(pgid) = self.process_group_id {
            // SAFETY: `pgid` was captured for the owned PTY process group;
            // negative `kill` targets that group and takes no pointers.
            unsafe {
                libc::kill(-pgid, signal);
            }
        }
    }

    #[cfg(not(unix))]
    fn signal_process_group(&self, _signal: i32) {}

    async fn reap_child(&mut self) {
        for _ in 0..10 {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.exit_code = Some(status.exit_code() as i32);
                    return;
                }
                Ok(None) => tokio::time::sleep(Duration::from_millis(100)).await,
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        for _ in 0..20 {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.exit_code = Some(status.exit_code() as i32);
                    return;
                }
                Ok(None) => tokio::time::sleep(Duration::from_millis(100)).await,
                Err(_) => return,
            }
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        self.writer.flush_model();
        self.refresh_status();
        #[cfg(unix)]
        if self.exit_code.is_none() {
            let _ = self.signal_descendants(libc::SIGTERM);
        }
        #[cfg(unix)]
        self.signal_process_group(libc::SIGTERM);
        self.alive.store(false, Ordering::SeqCst);
    }
}

pub(crate) fn terminal_env() -> &'static [(&'static str, &'static str)] {
    &[
        ("TERM", "dumb"),
        ("PAGER", "cat"),
        ("GIT_PAGER", "cat"),
        ("GH_PAGER", "cat"),
        ("LANG", "C.UTF-8"),
        // Blank instead of "C.UTF-8": an empty LC_ALL is ignored by setlocale,
        // so LANG still wins over whatever the caller inherited, while macOS
        // (which has no C.UTF-8 locale) stops printing a setlocale warning on
        // stderr for every command.
        ("LC_ALL", ""),
        ("COLORTERM", ""),
        ("NO_COLOR", "1"),
    ]
}

fn user_terminal_env() -> Vec<(String, String)> {
    [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("PAGER", "less"),
        ("GIT_PAGER", "less"),
        ("GH_PAGER", "less"),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_owned(), value.to_owned()))
    .collect()
}

pub(crate) fn terminal_env_owned() -> Vec<(String, String)> {
    terminal_env()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
