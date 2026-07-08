use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};

use crate::process::{isolate_process_group, terminate_child_tree};
use crate::sandbox::ExecutionBackend;

use super::keyparse::parse_keys;
use super::session::{terminal_env_owned, TerminalSession};
use super::{TerminalInfo, TerminalOutput};

struct SpawnOpts<'a> {
    background: bool,
    command: Option<&'a str>,
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    max_sessions: usize,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::with_max_sessions(16)
    }

    pub fn with_max_sessions(max_sessions: usize) -> Self {
        TerminalManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            max_sessions,
        }
    }

    pub async fn create(
        &self,
        name: String,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
    ) -> Result<TerminalInfo> {
        self.create_inner(
            name,
            cwd,
            cols,
            rows,
            backend,
            SpawnOpts {
                background: false,
                command: None,
            },
        )
        .await
    }

    /// Spawn a PTY session for a long-running background command and return
    /// immediately — no initial output wait. The command (if any) is written
    /// to the shell followed by a carriage return. The session is flagged as
    /// background, which exempts it from LRU eviction while its process is
    /// alive. The PTY child runs in its own session/process group (portable_pty
    /// calls setsid on spawn) and the command is built via the sandbox
    /// backend's `terminal_pty_command`, so podman/smolvm/ssh keep working.
    // TODO(background-exec tool layer): remove this allow once the tool wires
    // in background spawning.
    #[allow(dead_code)]
    pub async fn spawn_background(
        &self,
        name: String,
        command: Option<&str>,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
    ) -> Result<TerminalInfo> {
        self.create_inner(
            name,
            cwd,
            cols,
            rows,
            backend,
            SpawnOpts {
                background: true,
                command,
            },
        )
        .await
    }

    async fn create_inner(
        &self,
        name: String,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        backend: &Arc<ExecutionBackend>,
        opts: SpawnOpts<'_>,
    ) -> Result<TerminalInfo> {
        let old = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(&name)
        };
        if let Some(mut old) = old {
            let _ = old.kill().await;
        }

        let evicted = self.evict_for_capacity().await;
        for mut s in evicted {
            let _ = s.kill().await;
        }

        let mut session = TerminalSession::spawn(name.clone(), cwd, cols, rows, backend)?;
        session.background = opts.background;
        if let Some(command) = opts.command {
            if !command.trim().is_empty() {
                session.write(format!("{}\r", command).as_bytes())?;
            }
        }
        let info = self.session_info(&name, &session);
        self.sessions.lock().await.insert(name, session);
        Ok(info)
    }

    /// Eviction policy when at capacity: exited sessions go first (oldest
    /// created first), then the oldest-idle live non-background session.
    /// Live background sessions are never evicted — if only those remain,
    /// the cap is exceeded rather than killing a background server.
    async fn evict_for_capacity(&self) -> Vec<TerminalSession> {
        let mut sessions = self.sessions.lock().await;
        let mut evicted = Vec::new();
        while sessions.len() >= self.max_sessions {
            for session in sessions.values_mut() {
                session.refresh_status();
            }
            let victim = sessions
                .iter()
                .filter(|(_, s)| !s.is_alive())
                .min_by_key(|(_, s)| s.created_at)
                .map(|(k, _)| k.clone())
                .or_else(|| {
                    sessions
                        .iter()
                        .filter(|(_, s)| !s.background)
                        .min_by_key(|(_, s)| s.last_output_at)
                        .map(|(k, _)| k.clone())
                });
            match victim {
                Some(key) => {
                    if let Some(s) = sessions.remove(&key) {
                        evicted.push(s);
                    }
                }
                None => break,
            }
        }
        evicted
    }

    /// Kill a session and its full process tree (backend pidfile kill →
    /// SIGTERM descendants + process group → 500ms grace → SIGKILL → reap).
    /// Returns `Ok(true)` if the process was still alive when the kill was
    /// issued, `Ok(false)` if it had already exited.
    // TODO(background-exec tool layer): remove this allow once the tool wires
    // in session killing.
    #[allow(dead_code)]
    pub async fn kill_session(&self, name: &str) -> Result<bool> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(name)
        };
        let mut session =
            session.with_context(|| format!("terminal session '{}' not found", name))?;
        session.refresh_status();
        let was_alive = session.is_alive();
        session.kill().await?;
        Ok(was_alive)
    }

    pub async fn write_stdin(
        &self,
        name: &str,
        input: &str,
        yield_ms: u64,
        max_output: usize,
    ) -> Result<TerminalOutput> {
        let start = Instant::now();
        let bytes = parse_keys(input);

        {
            let mut sessions = self.sessions.lock().await;
            let session = sessions
                .get_mut(name)
                .with_context(|| format!("terminal session '{}' not found", name))?;
            session.refresh_status();
            if !session.is_alive() && !bytes.is_empty() {
                return Err(anyhow!("terminal session '{}' has already exited", name));
            }
            if !bytes.is_empty() {
                session.write(&bytes)?;
            }
        }

        if !bytes.is_empty() {
            sleep(Duration::from_millis(50)).await;
        }

        let output = self.collect_output(name, yield_ms, start).await?;

        let ended_session = {
            let mut sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get_mut(name) {
                session.refresh_status();
                if session.is_alive() {
                    None
                } else {
                    sessions.remove(name)
                }
            } else {
                None
            }
        };

        let (session_name, exit_code) = if let Some(mut session) = ended_session {
            (
                None,
                session
                    .wait_for_exit_code()
                    .await
                    .or_else(|| session.exit_code()),
            )
        } else {
            (Some(name.to_string()), None)
        };

        let (output_text, truncated) = head_tail_truncate(&output, max_output);
        Ok(TerminalOutput {
            output: output_text,
            exit_code,
            session_name,
            wall_time_ms: start.elapsed().as_millis() as u64,
            output_truncated: truncated,
        })
    }

    pub async fn exec_one_shot(
        &self,
        cmd: &str,
        cwd: Option<PathBuf>,
        _cols: u16,
        _rows: u16,
        yield_ms: u64,
        max_output: usize,
        backend: &ExecutionBackend,
    ) -> Result<TerminalOutput> {
        let start = Instant::now();
        let outcome = run_pipe_command(cmd, cwd, Duration::from_millis(yield_ms), backend).await?;
        let (exit_code, combined) = match outcome {
            PipeCommandOutcome::Completed(output) => {
                let mut combined = String::new();
                combined.push_str(&String::from_utf8_lossy(&output.stdout));
                combined.push_str(&String::from_utf8_lossy(&output.stderr));
                (Some(output.status.code().unwrap_or(-1)), combined)
            }
            PipeCommandOutcome::TimedOut { stdout, stderr } => {
                let mut combined = format!("Command timed out after {yield_ms}ms\n");
                combined.push_str(&String::from_utf8_lossy(&stdout));
                combined.push_str(&String::from_utf8_lossy(&stderr));
                (None, combined)
            }
        };

        let (output_text, truncated) = head_tail_truncate(&combined, max_output);
        Ok(TerminalOutput {
            output: output_text,
            exit_code,
            session_name: None,
            wall_time_ms: start.elapsed().as_millis() as u64,
            output_truncated: truncated,
        })
    }

    #[cfg(test)]
    pub async fn remove(&self, name: &str) -> Result<()> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(name)
        };
        if let Some(mut session) = session {
            session.kill().await?;
        }
        Ok(())
    }

    pub async fn remove_all(&self) {
        let sessions: Vec<TerminalSession> = {
            let mut sessions = self.sessions.lock().await;
            sessions.drain().map(|(_, s)| s).collect()
        };
        for mut session in sessions {
            let _ = session.kill().await;
        }
    }

    pub async fn get(&self, name: &str) -> Option<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        sessions.get_mut(name).map(|s| {
            s.refresh_status();
            self.session_info(&s.name, s)
        })
    }

    fn session_info(&self, name: &str, session: &TerminalSession) -> TerminalInfo {
        TerminalInfo {
            name: name.to_string(),
            cwd: session.cwd.clone(),
            cols: session.cols,
            rows: session.rows,
            alive: session.is_alive(),
            idle_ms: session.idle_duration().as_millis() as u64,
            pid: session.pid(),
        }
    }

    async fn collect_output(&self, name: &str, yield_ms: u64, start: Instant) -> Result<String> {
        let deadline = start + Duration::from_millis(yield_ms);
        let mut output = String::new();

        let notify = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(name)
                .ok_or_else(|| anyhow!("session vanished"))?
                .output_notify()
                .clone()
        };

        loop {
            let (current, alive) = {
                let mut sessions = self.sessions.lock().await;
                let session = sessions
                    .get_mut(name)
                    .ok_or_else(|| anyhow!("session vanished"))?;
                session.refresh_status();
                let current = session.read_output();
                let alive = session.is_alive();
                (current, alive)
            };

            if !current.is_empty() {
                output.push_str(&current);
                if Instant::now() >= deadline {
                    return Ok(output);
                }
                tokio::task::yield_now().await;
                continue;
            }

            if !alive {
                return Ok(output);
            }

            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining == Duration::ZERO {
                return Ok(output);
            }

            tokio::select! {
                _ = notify.notified() => continue,
                _ = sleep(remaining) => return Ok(output),
            }
        }
    }
}

async fn run_pipe_command(
    cmd: &str,
    cwd: Option<PathBuf>,
    timeout_duration: Duration,
    backend: &ExecutionBackend,
) -> Result<PipeCommandOutcome> {
    let envs = terminal_env_owned();
    let (mut command, pidfile) = backend.terminal_pipe_command(cmd, cwd.as_deref(), &envs);
    isolate_process_group(&mut command);

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().context("failed to spawn command")?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture command stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture command stderr"))?;

    let stdout_handle = tokio::spawn(read_all(stdout));
    let stderr_handle = tokio::spawn(read_all(stderr));

    let status = match timeout(timeout_duration, child.wait()).await {
        Ok(status) => status.context("failed to wait for command")?,
        Err(_) => {
            if let Some(pidfile) = pidfile.as_deref() {
                let _ = backend.terminal_pipe_kill(pidfile).await;
            }
            terminate_child_tree(&mut child).await;
            return Ok(PipeCommandOutcome::TimedOut {
                stdout: stdout_handle.await.unwrap_or_default(),
                stderr: stderr_handle.await.unwrap_or_default(),
            });
        }
    };
    Ok(PipeCommandOutcome::Completed(Output {
        status,
        stdout: stdout_handle.await.unwrap_or_default(),
        stderr: stderr_handle.await.unwrap_or_default(),
    }))
}

enum PipeCommandOutcome {
    Completed(Output),
    TimedOut { stdout: Vec<u8>, stderr: Vec<u8> },
}

async fn read_all<R>(mut reader: R) -> Vec<u8>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let _ = reader.read_to_end(&mut output).await;
    output
}

fn head_tail_truncate(text: &str, max_chars: usize) -> (String, bool) {
    if text.len() <= max_chars {
        return (text.to_string(), false);
    }
    if max_chars == 0 {
        return (String::new(), true);
    }

    let half = max_chars / 2;
    let head = if let Some(idx) = text.char_indices().nth(half).map(|(i, _)| i) {
        &text[..idx]
    } else {
        text
    };
    let tail_start = if let Some(idx) = text
        .char_indices()
        .nth_back(half.saturating_sub(1))
        .map(|(i, _)| i)
    {
        idx
    } else {
        text.len()
    };
    let truncated = format!(
        "{}...\n...[{} chars truncated]...\n{}",
        head,
        text.len().saturating_sub(max_chars),
        &text[tail_start..]
    );
    (truncated, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{
        SandboxSession, SandboxSpec, DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR,
    };

    fn test_backend() -> Arc<ExecutionBackend> {
        crate::sandbox::execution_backend_from_sandbox(
            None,
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
        )
    }

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
    async fn spawn_background_returns_while_process_runs() {
        let manager = TerminalManager::new();
        let backend = test_backend();
        let start = Instant::now();
        let info = manager
            .spawn_background(
                "bg-run".to_string(),
                Some("sleep 30"),
                None,
                120,
                40,
                &backend,
            )
            .await
            .unwrap();
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "spawn_background blocked waiting for output"
        );
        assert!(info.alive);
        assert!(info.pid.is_some());

        let got = manager.get("bg-run").await.expect("session registered");
        assert!(got.alive, "background session should still be running");

        let was_alive = manager.kill_session("bg-run").await.unwrap();
        assert!(was_alive, "session was running when killed");
        assert!(manager.get("bg-run").await.is_none());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn kill_session_reaps_full_process_group() {
        let manager = TerminalManager::new();
        let backend = test_backend();
        manager
            .spawn_background(
                "bg-kill".to_string(),
                Some("sleep 30 & echo NAC_CHILD:$!"),
                None,
                120,
                40,
                &backend,
            )
            .await
            .unwrap();

        let mut collected = String::new();
        let mut child_pid = None;
        for _ in 0..40 {
            let out = manager
                .write_stdin("bg-kill", "", 100, 100_000)
                .await
                .unwrap();
            collected.push_str(&out.output);
            child_pid = parse_child_pid(&collected);
            if child_pid.is_some() {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        let child_pid =
            child_pid.unwrap_or_else(|| panic!("child pid not found in: {collected:?}"));
        assert!(process_exists(child_pid), "child exited too early");

        let was_alive = manager.kill_session("bg-kill").await.unwrap();
        assert!(was_alive);
        assert!(manager.get("bg-kill").await.is_none());

        let mut orphaned = true;
        for _ in 0..40 {
            orphaned = process_exists(child_pid);
            if !orphaned {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        if orphaned {
            unsafe {
                libc::kill(child_pid as libc::pid_t, libc::SIGKILL);
            }
        }
        assert!(!orphaned, "kill_session left an orphaned descendant");
    }

    #[tokio::test]
    async fn kill_session_unknown_name_errors() {
        let manager = TerminalManager::new();
        let err = manager.kill_session("nope").await.unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[tokio::test]
    async fn poll_dead_session_reports_exit_code_and_removes_entry() {
        let manager = TerminalManager::new();
        let backend = test_backend();
        manager
            .spawn_background(
                "bg-exit".to_string(),
                Some("exit 7"),
                None,
                120,
                40,
                &backend,
            )
            .await
            .unwrap();

        let mut observed = None;
        for _ in 0..40 {
            match manager.write_stdin("bg-exit", "", 100, 8000).await {
                Ok(out) if out.session_name.is_none() => {
                    observed = Some(out);
                    break;
                }
                Ok(_) => sleep(Duration::from_millis(50)).await,
                Err(_) => break,
            }
        }
        let out = observed.expect("poll never observed session exit");
        assert_eq!(out.exit_code, Some(7), "exit code must be live-derived");
        assert!(
            manager.get("bg-exit").await.is_none(),
            "dead session entry must be removed after poll"
        );
    }

    #[tokio::test]
    async fn live_background_session_survives_lru_pressure() {
        let manager = TerminalManager::with_max_sessions(3);
        let backend = test_backend();
        manager
            .spawn_background(
                "bg-server".to_string(),
                Some("sleep 60"),
                None,
                120,
                40,
                &backend,
            )
            .await
            .unwrap();

        for i in 0..5 {
            manager
                .create(format!("churn-{i}"), None, 120, 40, &backend)
                .await
                .unwrap();
        }

        let info = manager
            .get("bg-server")
            .await
            .expect("background session was evicted under LRU pressure");
        assert!(info.alive, "background session should still be running");
        manager.remove_all().await;
    }

    #[tokio::test]
    async fn eviction_prefers_exited_sessions_over_live_ones() {
        let manager = TerminalManager::with_max_sessions(2);
        let backend = test_backend();
        manager
            .create("live-old".to_string(), None, 120, 40, &backend)
            .await
            .unwrap();
        sleep(Duration::from_millis(10)).await;
        manager
            .create("dead-new".to_string(), None, 120, 40, &backend)
            .await
            .unwrap();

        // Ask the shell to exit without letting write_stdin observe the
        // death (yield 0), so the exited entry stays in the map.
        manager
            .write_stdin("dead-new", "exit\r", 0, 8000)
            .await
            .unwrap();
        let mut dead = false;
        for _ in 0..40 {
            if let Some(info) = manager.get("dead-new").await {
                if !info.alive {
                    dead = true;
                    break;
                }
            } else {
                dead = true;
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        assert!(dead, "shell did not exit in time");

        manager
            .create("third".to_string(), None, 120, 40, &backend)
            .await
            .unwrap();

        let live_old = manager
            .get("live-old")
            .await
            .expect("live session evicted while an exited session existed");
        assert!(live_old.alive);
        assert!(manager.get("dead-new").await.is_none());
        manager.remove_all().await;
    }

    #[test]
    fn terminal_pipe_command_delegates_to_sandbox_session() {
        let sandbox = SandboxSession::new_for_test(SandboxSpec {
            backend: crate::sandbox::SandboxBackendType::Podman,
            image: DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: Vec::new(),
            workdir: DEFAULT_SANDBOX_WORKDIR.into(),
            gpu_devices: Vec::new(),
            shm_size: None,
            cpus: 2,
            memory_mib: 2048,
        });

        let envs = terminal_env_owned();
        let (command, pidfile) = sandbox.terminal_pipe_command("echo hello", None, &envs);

        assert!(pidfile.starts_with("/tmp/nac-exec-"));
        assert!(pidfile.ends_with(".pid"));

        let debug = format!("{command:?}");
        assert!(debug.contains("podman"), "expected podman command: {debug}");
        assert!(debug.contains("exec"), "expected exec subcommand: {debug}");
        assert!(debug.contains("TERM=dumb"), "expected TERM=dumb: {debug}");
    }
}
