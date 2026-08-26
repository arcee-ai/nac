use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use anyhow::anyhow;
use anyhow::{Context, Result};
use portable_pty::{NativePtySystem, PtySize, PtySystem};
use tokio::sync::Notify;

use super::{ArtifactKind, OutputRegistry, OutputStream};
#[cfg(all(unix, not(target_os = "linux")))]
use crate::process::signal_descendants;
#[cfg(target_os = "linux")]
use crate::process::{process_start_time, signal_descendants};
use crate::sandbox::ExecutionBackend;

pub struct TerminalSession {
    pub name: String,
    writer: Box<dyn Write + Send>,
    output_id: String,
    preview_cursor: u64,
    output_notify: Arc<Notify>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    #[cfg(target_os = "linux")]
    root_start_time: u64,
    #[cfg(unix)]
    process_group_id: Option<libc::pid_t>,
    _pty_pair: portable_pty::PtyPair,
    _reader_thread: std::thread::JoinHandle<()>,
    pub created_at: Instant,
    pub last_output_at: Instant,
    alive: Arc<AtomicBool>,
    exit_code: Option<i32>,
    retained: bool,
    /// Remote process-tree cleanup: backends that return a pidfile from
    /// `terminal_pty_command` get a backend-side kill on session teardown.
    backend_cleanup: Option<(Arc<ExecutionBackend>, String)>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSession {
    pub fn spawn(
        name: String,
        command: &str,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        output_registry: OutputRegistry,
    ) -> Result<Self> {
        let pty_system = NativePtySystem::default();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY pair")?;

        let envs = terminal_env_owned();
        let (cmd, pidfile) = backend.terminal_pty_command(command, cwd.as_deref(), &envs);
        // resolved_cwd mirrors the default-workdir fallback inside each
        // backend's terminal_pty_command: explicit cwd if provided, otherwise
        // the backend's default terminal directory. Keep these in sync.
        let resolved_cwd = cwd.unwrap_or_else(|| backend.default_terminal_cwd());
        let backend_cleanup = pidfile.map(|pidfile| (Arc::clone(backend), pidfile));

        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command in PTY")?;
        #[cfg(target_os = "linux")]
        let mut child = child;
        #[cfg(target_os = "linux")]
        let root_start_time = {
            let start_time = child
                .process_id()
                .and_then(|pid| process_start_time(pid as libc::pid_t));
            let Some(start_time) = start_time else {
                let _ = child.kill();
                return Err(anyhow!("Failed to capture PTY root process identity"));
            };
            start_time
        };
        #[cfg(unix)]
        let process_group_id = child.process_id().and_then(|pid| {
            let pid = pid as libc::pid_t;
            let group = unsafe { libc::getpgid(pid) };
            (group == pid).then_some(group)
        });

        let reader = pty_pair
            .master
            .try_clone_reader()
            .context("Failed to clone PTY reader")?;
        let writer = pty_pair
            .master
            .take_writer()
            .context("Failed to take PTY writer")?;

        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();
        let output_id = output_registry.create(ArtifactKind::Pty);
        let reader_output_id = output_id.clone();
        let reader_output_registry = output_registry.clone();
        let notify = Arc::new(Notify::new());
        let notify_clone = notify.clone();

        let reader_thread = std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        alive_clone.store(false, Ordering::SeqCst);
                        notify_clone.notify_one();
                        break;
                    }
                    Ok(n) => {
                        let _ = reader_output_registry.append(
                            &reader_output_id,
                            OutputStream::Combined,
                            buf[..n].to_vec(),
                        );
                        notify_clone.notify_one();
                    }
                }
            }
        });

        Ok(TerminalSession {
            name,
            writer,
            output_id,
            preview_cursor: 0,
            output_notify: notify,
            child,
            #[cfg(target_os = "linux")]
            root_start_time,
            #[cfg(unix)]
            process_group_id,
            _pty_pair: pty_pair,
            _reader_thread: reader_thread,
            created_at: Instant::now(),
            last_output_at: Instant::now(),
            alive,
            exit_code: None,
            retained: false,
            backend_cleanup,
            cwd: resolved_cwd,
            cols,
            rows,
        })
    }

    pub fn write(&mut self, data: &[u8]) -> Result<()> {
        self.writer
            .write_all(data)
            .context("Failed to write to PTY")?;
        self.writer.flush().context("Failed to flush PTY")?;
        self.last_output_at = Instant::now();
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
        self.alive.load(Ordering::SeqCst)
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
        let mut info = unsafe { std::mem::zeroed::<libc::siginfo_t>() };
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        result == 0 && unsafe { info.si_pid() } == pid
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }

    pub fn retain(&mut self) {
        self.retained = true;
    }

    pub fn is_retained(&self) -> bool {
        self.retained
    }

    pub fn idle_duration(&self) -> Duration {
        self.last_output_at.elapsed()
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.process_id()
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
        unsafe {
            libc::kill(-pgid, signal);
        }
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    fn signal_process_group(&self, signal: libc::c_int) {
        if let Some(pgid) = self.process_group_id {
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
        let _ = self.writer.flush();
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

pub(crate) fn terminal_env_owned() -> Vec<(String, String)> {
    terminal_env()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    fn process_running(pid: u32) -> bool {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        stat.rsplit_once(") ")
            .and_then(|(_, fields)| fields.split_whitespace().next())
            != Some("Z")
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    fn process_running(pid: u32) -> bool {
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    #[cfg(unix)]
    fn parse_child_pid(output: &str) -> Option<u32> {
        output.lines().find_map(|line| {
            line.split_once("NAC_CHILD:").and_then(|(_, rest)| {
                rest.chars()
                    .take_while(|ch| ch.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .ok()
            })
        })
    }

    #[test]
    #[cfg(unix)]
    fn exited_pty_descendant_helper() {
        if std::env::var_os("NAC_EXITED_PTY_DESCENDANT_HELPER").is_none() {
            return;
        }
        let pid = unsafe { libc::getpid() };
        let parent = unsafe { libc::getppid() };
        let group = unsafe { libc::getpgid(parent) };
        assert!(group > 0);
        assert_eq!(unsafe { libc::setpgid(0, group) }, 0);
        unsafe {
            libc::signal(libc::SIGHUP, libc::SIG_IGN);
        }
        println!("NAC_CHILD:{pid}");
        std::io::stdout().flush().unwrap();
        unsafe {
            libc::close(libc::STDIN_FILENO);
            libc::close(libc::STDOUT_FILENO);
            libc::close(libc::STDERR_FILENO);
        }
        std::thread::sleep(Duration::from_secs(30));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn kill_removes_background_jobs_from_pty_shell() {
        let backend = crate::sandbox::execution_backend_from_sandbox(
            None,
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
        );
        let registry =
            OutputRegistry::new(crate::terminal::CommandOutputLimits::default()).unwrap();
        let mut session = TerminalSession::spawn(
            "test".to_string(),
            "bash",
            None,
            120,
            40,
            &backend,
            registry.clone(),
        )
        .unwrap();
        // The PTY uses the account's configured login shell, which may not
        // support POSIX job syntax (for example, Fish has no `$!`). Run the
        // process-tree fixture through `sh` so the test is shell-independent.
        session
            .write(b"sh -c 'sleep 30 & echo NAC_CHILD:$!; wait'\r")
            .unwrap();

        let mut cursor = 0;
        let mut output = String::new();
        let mut child_pid = None;
        for _ in 0..40 {
            let page = registry
                .page(
                    session.output_id(),
                    OutputStream::Combined,
                    cursor,
                    32 * 1024,
                )
                .unwrap();
            cursor = page.next_offset;
            output.push_str(&page.content);
            child_pid = parse_child_pid(&output);
            if child_pid.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let child_pid = child_pid.unwrap_or_else(|| panic!("child pid not found in: {output:?}"));
        assert!(
            process_running(child_pid),
            "background child exited too early"
        );

        session.kill().await.unwrap();

        let mut still_running = false;
        for _ in 0..40 {
            still_running = process_running(child_pid);
            if !still_running {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if still_running {
            unsafe {
                libc::kill(child_pid as libc::pid_t, libc::SIGKILL);
            }
        }
        assert!(!still_running, "background child survived PTY cleanup");
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn completed_pty_root_kills_surviving_process_group() {
        let backend = crate::sandbox::execution_backend_from_sandbox(
            None,
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
        );
        let registry =
            OutputRegistry::new(crate::terminal::CommandOutputLimits::default()).unwrap();
        let executable = std::env::current_exe().unwrap();
        let executable = format!(
            "'{}'",
            executable.display().to_string().replace('\'', "'\"'\"'")
        );
        let command = format!(
            "NAC_EXITED_PTY_DESCENDANT_HELPER=1 {executable} --exact terminal::session::tests::exited_pty_descendant_helper --nocapture & sleep 0.2"
        );
        let mut session = TerminalSession::spawn(
            "exited-root".to_string(),
            &command,
            None,
            120,
            40,
            &backend,
            registry.clone(),
        )
        .unwrap();

        let mut cursor = 0;
        let mut output = String::new();
        let mut child_pid = None;
        for _ in 0..40 {
            let page = registry
                .page(
                    session.output_id(),
                    OutputStream::Combined,
                    cursor,
                    32 * 1024,
                )
                .unwrap();
            cursor = page.next_offset;
            output.push_str(&page.content);
            child_pid = parse_child_pid(&output);
            if child_pid.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let child_pid = child_pid.unwrap_or_else(|| panic!("child pid not found in: {output:?}"));
        assert!(
            process_running(child_pid),
            "background child exited too early"
        );

        for _ in 0..40 {
            session.refresh_status();
            if session.exit_code().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(session.exit_code().is_some(), "PTY root did not exit");

        let mut still_running = false;
        for _ in 0..40 {
            still_running = process_running(child_pid);
            if !still_running {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if still_running {
            unsafe {
                libc::kill(child_pid as libc::pid_t, libc::SIGKILL);
            }
        }
        assert!(
            !still_running,
            "background child survived exited-root PTY cleanup"
        );
    }
}
