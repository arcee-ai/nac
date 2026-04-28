use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tokio::sync::{mpsc, Notify};
use vt100::Parser;

use crate::sandbox::SandboxSession;

pub struct TerminalSession {
    pub name: String,
    writer: Box<dyn Write + Send>,
    output_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    output_notify: Arc<Notify>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    _pty_pair: portable_pty::PtyPair,
    _reader_thread: std::thread::JoinHandle<()>,
    pub created_at: Instant,
    pub last_output_at: Instant,
    alive: Arc<AtomicBool>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    /// Lightweight parser for tracking terminal state (application cursor mode, etc.).
    /// Not used for output collection — output uses a fresh parser each read_screen call.
    state: Parser,
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
        cmd.env("TERM", "dumb");
        cmd.env("PAGER", "cat");
        cmd.env("GIT_PAGER", "cat");
        cmd.env("GH_PAGER", "cat");
        cmd.env("LANG", "C.UTF-8");
        cmd.env("LC_ALL", "C.UTF-8");
        cmd.env("COLORTERM", "");
        cmd.env("NO_COLOR", "1");

        let resolved_cwd: PathBuf;

        if let Some(sb) = sandbox {
            // Build: podman exec -it --workdir <workdir> <container> bash
            cmd = CommandBuilder::new("podman");
            cmd.arg("exec");
            cmd.arg("-it");
            cmd.arg("--workdir");
            let wd = match &cwd {
                Some(p) => p.display().to_string(),
                None => sb.workdir_display(),
            };
            cmd.arg(&wd);
            cmd.arg(sb.container_name());
            cmd.arg("bash");
            cmd.env("TERM", "dumb");
            cmd.env("PAGER", "cat");
            cmd.env("GIT_PAGER", "cat");
            cmd.env("GH_PAGER", "cat");
            cmd.env("LANG", "C.UTF-8");
            cmd.env("LC_ALL", "C.UTF-8");
            cmd.env("COLORTERM", "");
            cmd.env("NO_COLOR", "1");
            resolved_cwd = PathBuf::from(wd);
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
        let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let notify = Arc::new(Notify::new());
        let notify_clone = notify.clone();

        let reader_thread = std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        alive_clone.store(false, Ordering::SeqCst);
                        break;
                    }
                    Ok(n) => {
                        let _ = tx.send(buf[..n].to_vec());
                        notify_clone.notify_one();
                    }
                }
            }
        });

        Ok(TerminalSession {
            name,
            writer,
            output_rx: rx,
            output_notify: notify,
            child,
            _pty_pair: pty_pair,
            _reader_thread: reader_thread,
            created_at: Instant::now(),
            last_output_at: Instant::now(),
            alive,
            cwd: resolved_cwd,
            cols,
            rows,
            state: Parser::new(rows, cols, 0),
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

    pub fn read_screen(&mut self) -> String {
        let mut buf = Vec::new();
        while let Ok(chunk) = self.output_rx.try_recv() {
            buf.extend_from_slice(&chunk);
        }
        if buf.is_empty() {
            return String::new();
        }
        self.last_output_at = Instant::now();
    
        // Feed state tracker (for application_cursor, etc.)
        self.state.process(&buf);

        // Fresh parser per read — strips ANSI, no scrollback accumulation
        let mut parser = Parser::new(self.rows, self.cols, 0);
        parser.process(&buf);
        Self::screen_to_text(&parser)
    }

    /// Returns a reference to the Notify that fires when the reader thread
    /// pushes new output chunks into the channel.
    pub fn output_notify(&self) -> &Arc<Notify> {
        &self.output_notify
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn idle_duration(&self) -> Duration {
        self.last_output_at.elapsed()
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.process_id()
    }

    /// Check if the terminal application (e.g., less) has enabled
    /// application cursor keys mode (DECCKM). When true, arrow keys
    /// should use SS3 sequences (\x1bOA) instead of ANSI (\x1b[A).
    pub fn application_cursor_active(&self) -> bool {
        self.state.screen().application_cursor()
    }

    pub fn kill(&mut self) -> Result<()> {
        self.kill_process_group();
        self.reap_child();
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    #[cfg(unix)]
    fn kill_process_group(&self) {
        if let Some(pid) = self.child.process_id() {
            unsafe {
                let pgid = libc::getpgid(pid as libc::pid_t);
                if pgid > 0 {
                    libc::kill(-pgid, libc::SIGTERM);
                    std::thread::sleep(Duration::from_millis(500));
                    if libc::kill(-pgid, 0) == 0 {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                }
            }
        }
    }

    #[cfg(not(unix))]
    fn kill_process_group(&self) {}

    fn reap_child(&mut self) {
        for _ in 0..10 {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        for _ in 0..20 {
            match self.child.try_wait() {
                Ok(Some(_)) | Err(_) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            }
        }
    }

    fn screen_to_text(parser: &vt100::Parser) -> String {
        let screen = parser.screen();
        let (_rows, cols) = screen.size();
        let rows: Vec<String> = screen
            .rows(0, cols)
            .collect();
        let mut lines: Vec<String> = rows
            .into_iter()
            .map(|row| row.trim_end().to_string())
            .collect();
        while lines.last().map_or(false, |l| l.is_empty()) {
            lines.pop();
        }
        lines.join("\n")
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = self.writer.flush();
        self.alive.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_to_text_visible_only() {
        // Even with many lines fed to a scrollback-capable parser,
        // screen_to_text only returns the visible screen rows.
        let mut parser = Parser::new(5, 40, 100);
        for i in 1..=25 {
            parser.process(format!("line{}\r\n", i).as_bytes());
        }
        // screen_to_text takes &Parser, visible screen is 5 rows.
        // The trailing \r\n after line25 scrolls the screen, pushing
        // line21 into scrollback. Visible: lines 22-25 (4 rows).
        let text = TerminalSession::screen_to_text(&parser);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 4, "got {}: {:?}", lines.len(), lines);
        for i in 0..4 {
            let expected = format!("line{}", 22 + i);
            assert_eq!(lines[i], expected, "line {} mismatch", i);
        }
    }

    #[test]
    fn screen_to_text_empty() {
        let parser = Parser::new(24, 80, 100);
        let text = TerminalSession::screen_to_text(&parser);
        assert!(text.is_empty(), "Expected empty, got: {:?}", text);
    }

    #[test]
    fn screen_to_text_single_line() {
        let mut parser = Parser::new(24, 80, 100);
        parser.process(b"hello\r\n");
        let text = TerminalSession::screen_to_text(&parser);
        assert_eq!(text, "hello");
    }
}
