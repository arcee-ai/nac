use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use portable_pty::{NativePtySystem, PtySize, PtySystem};
use tokio::sync::Notify;

use super::{ArtifactKind, OutputRegistry, OutputStream};
#[cfg(unix)]
use crate::process::{descendant_pids, signal_pids};
use crate::sandbox::ExecutionBackend;

pub struct TerminalSession {
    pub name: String,
    writer: Box<dyn Write + Send>,
    output_id: String,
    preview_cursor: u64,
    output_notify: Arc<Notify>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    _pty_pair: portable_pty::PtyPair,
    _reader_thread: std::thread::JoinHandle<()>,
    pub created_at: Instant,
    pub last_output_at: Instant,
    alive: Arc<AtomicBool>,
    exit_code: Option<i32>,
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
        let (cmd, pidfile) = backend.terminal_pty_command(cwd.as_deref(), &envs);
        // resolved_cwd mirrors the default-workdir fallback inside each
        // backend's terminal_pty_command: explicit cwd if provided, otherwise
        // the backend's default terminal directory. Keep these in sync.
        let resolved_cwd = cwd.unwrap_or_else(|| backend.default_terminal_cwd());
        let backend_cleanup = pidfile.map(|pidfile| (Arc::clone(backend), pidfile));

        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn bash in PTY")?;

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
            _pty_pair: pty_pair,
            _reader_thread: reader_thread,
            created_at: Instant::now(),
            last_output_at: Instant::now(),
            alive,
            exit_code: None,
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

        if let Ok(Some(status)) = self.child.try_wait() {
            self.exit_code = Some(status.exit_code() as i32);
            self.alive.store(false, Ordering::SeqCst);
        }
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }

    pub fn idle_duration(&self) -> Duration {
        self.last_output_at.elapsed()
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.process_id()
    }

    pub async fn kill(&mut self) -> Result<()> {
        if let Some((backend, pidfile)) = &self.backend_cleanup {
            let _ = backend.terminal_pipe_kill(pidfile).await;
        }

        #[cfg(unix)]
        {
            self.signal_descendants(libc::SIGKILL);
            self.signal_process_group(libc::SIGKILL);
        }

        self.reap_child().await;
        self.alive.store(false, Ordering::SeqCst);
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

    #[cfg(unix)]
    fn child_descendant_pids(&self) -> Vec<libc::pid_t> {
        let Some(pid) = self.child.process_id() else {
            return Vec::new();
        };
        descendant_pids(pid as libc::pid_t)
    }

    #[cfg(unix)]
    fn signal_descendants(&self, signal: libc::c_int) {
        signal_pids(&self.child_descendant_pids(), signal);
    }

    #[cfg(not(unix))]
    fn signal_descendants(&self, _signal: i32) {}

    #[cfg(unix)]
    fn signal_process_group(&self, signal: libc::c_int) {
        if let Some(pid) = self.child.process_id() {
            unsafe {
                let pgid = libc::getpgid(pid as libc::pid_t);
                if pgid > 0 {
                    libc::kill(-pgid, signal);
                }
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
        #[cfg(unix)]
        {
            self.signal_descendants(libc::SIGTERM);
            self.signal_process_group(libc::SIGTERM);
        }
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

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
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
            None,
            120,
            40,
            &backend,
            registry.clone(),
        )
        .unwrap();
        session.write(b"sleep 30 & echo NAC_CHILD:$!\r").unwrap();

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
            process_exists(child_pid),
            "background child exited too early"
        );

        session.kill().await.unwrap();

        let mut still_running = false;
        for _ in 0..40 {
            still_running = process_exists(child_pid);
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
}
