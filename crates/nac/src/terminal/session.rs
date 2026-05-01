use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tokio::sync::Notify;

use crate::sandbox::SandboxSession;

const MAX_SESSION_OUTPUT_BYTES: usize = 1024 * 1024;

pub struct TerminalSession {
    pub name: String,
    writer: Box<dyn Write + Send>,
    output: Arc<StdMutex<OutputBuffer>>,
    output_notify: Arc<Notify>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    _pty_pair: portable_pty::PtyPair,
    _reader_thread: std::thread::JoinHandle<()>,
    pub created_at: Instant,
    pub last_output_at: Instant,
    alive: Arc<AtomicBool>,
    exit_code: Option<i32>,
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
        sandbox: Option<&SandboxSession>,
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

        let mut cmd = CommandBuilder::new("bash");
        for (key, value) in terminal_env() {
            cmd.env(key, value);
        }

        let resolved_cwd: PathBuf;

        if let Some(sb) = sandbox {
            // resolved_cwd mirrors the --workdir fallback inside terminal_pty_command.
            // Both use cwd if provided, otherwise the sandbox workdir. Keep these in sync.
            resolved_cwd = match cwd.as_ref() {
                Some(p) => p.clone(),
                None => PathBuf::from(sb.workdir_display()),
            };

            let envs = terminal_env_owned();

            cmd = sb.terminal_pty_command(cwd.as_deref(), &envs);
        } else {
            if let Some(ref p) = cwd {
                cmd.cwd(p);
            }
            resolved_cwd = match cwd {
                Some(p) => p,
                None => std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
            };
        }

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
        let output = Arc::new(StdMutex::new(OutputBuffer::new(MAX_SESSION_OUTPUT_BYTES)));
        let output_clone = output.clone();
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
                        if let Ok(mut output) = output_clone.lock() {
                            output.push(&buf[..n]);
                        }
                        notify_clone.notify_one();
                    }
                }
            }
        });

        Ok(TerminalSession {
            name,
            writer,
            output,
            output_notify: notify,
            child,
            _pty_pair: pty_pair,
            _reader_thread: reader_thread,
            created_at: Instant::now(),
            last_output_at: Instant::now(),
            alive,
            exit_code: None,
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

    pub fn read_output(&mut self) -> String {
        let buf = self
            .output
            .lock()
            .map(|mut output| output.take())
            .unwrap_or_default();
        if buf.is_empty() {
            return String::new();
        }
        self.last_output_at = Instant::now();
        String::from_utf8_lossy(&buf).into_owned()
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
        self.kill_process_group();
        tokio::time::sleep(Duration::from_millis(500)).await;

        #[cfg(unix)]
        if let Some(pid) = self.child.process_id() {
            unsafe {
                let pgid = libc::getpgid(pid as libc::pid_t);
                if pgid > 0 && libc::kill(-pgid, 0) == 0 {
                    libc::kill(-pgid, libc::SIGKILL);
                }
            }
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
    fn kill_process_group(&self) {
        if let Some(pid) = self.child.process_id() {
            unsafe {
                let pgid = libc::getpgid(pid as libc::pid_t);
                if pgid > 0 {
                    libc::kill(-pgid, libc::SIGTERM);
                }
            }
        }
    }

    #[cfg(not(unix))]
    fn kill_process_group(&self) {}

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
        self.kill_process_group();
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
        ("LC_ALL", "C.UTF-8"),
        ("COLORTERM", ""),
        ("NO_COLOR", "1"),
    ]
}

pub(crate) fn terminal_env_owned() -> Vec<(String, String)> {
    terminal_env().iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

struct OutputBuffer {
    bytes: VecDeque<u8>,
    capacity: usize,
    dropped_bytes: usize,
}

impl OutputBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(capacity.min(8192)),
            capacity,
            dropped_bytes: 0,
        }
    }

    fn push(&mut self, chunk: &[u8]) {
        if self.capacity == 0 {
            self.dropped_bytes = self.dropped_bytes.saturating_add(chunk.len());
            return;
        }

        if chunk.len() >= self.capacity {
            let dropped = self
                .bytes
                .len()
                .saturating_add(chunk.len())
                .saturating_sub(self.capacity);
            self.dropped_bytes = self.dropped_bytes.saturating_add(dropped);
            self.bytes.clear();
            self.bytes
                .extend(chunk[chunk.len() - self.capacity..].iter().copied());
            return;
        }

        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(self.capacity);
        if overflow > 0 {
            for _ in 0..overflow {
                self.bytes.pop_front();
            }
            self.dropped_bytes = self.dropped_bytes.saturating_add(overflow);
        }
        self.bytes.extend(chunk.iter().copied());
    }

    fn take(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        if self.dropped_bytes > 0 {
            out.extend_from_slice(
                format!("\n...[{} bytes omitted]...\n", self.dropped_bytes).as_bytes(),
            );
            self.dropped_bytes = 0;
        }
        out.extend(self.bytes.drain(..));
        out
    }
}
