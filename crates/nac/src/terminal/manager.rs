use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};

use crate::process::{isolate_process_group, terminate_child_tree};
use crate::sandbox::SandboxSession;

use super::keyparse::parse_keys;
use super::session::TerminalSession;
use super::{TerminalInfo, TerminalOutput};

const SANDBOX_EXEC_WRAPPER: &str = r#"pidfile=$2
if command -v setsid >/dev/null 2>&1; then
  setsid bash -c "$1" &
else
  set -m
  bash -c "$1" &
fi
pid=$!
printf '%s' "$pid" > "$pidfile"
wait "$pid"
status=$?
rm -f "$pidfile"
exit "$status""#;

const SANDBOX_KILL_WRAPPER: &str = r#"pidfile=$1
pid=$(cat "$pidfile" 2>/dev/null) || exit 0
if [ -n "$pid" ]; then
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  sleep 0.5
  kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
fi
rm -f "$pidfile""#;

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    max_sessions: usize,
}

impl TerminalManager {
    pub fn new() -> Self {
        TerminalManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            max_sessions: 16,
        }
    }

    pub async fn create(
        &self,
        name: String,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
        sandbox: Option<&SandboxSession>,
    ) -> Result<TerminalInfo> {
        let old = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(&name)
        };
        if let Some(mut old) = old {
            let _ = old.kill().await;
        }

        let evicted: Vec<TerminalSession> = {
            let mut sessions = self.sessions.lock().await;
            let mut evicted = Vec::new();
            while sessions.len() >= self.max_sessions {
                let oldest_key = sessions
                    .iter()
                    .min_by_key(|(_, s)| s.created_at)
                    .map(|(k, _)| k.clone());
                if let Some(key) = oldest_key {
                    if let Some(s) = sessions.remove(&key) {
                        evicted.push(s);
                    }
                } else {
                    break;
                }
            }
            evicted
        };
        for mut s in evicted {
            let _ = s.kill().await;
        }

        let session = TerminalSession::spawn(name.clone(), cwd, cols, rows, sandbox)?;
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
        sandbox: Option<&SandboxSession>,
    ) -> Result<TerminalOutput> {
        let start = Instant::now();
        let outcome = run_pipe_command(cmd, cwd, Duration::from_millis(yield_ms), sandbox).await?;
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

    pub async fn list(&self) -> Vec<TerminalInfo> {
        let mut sessions = self.sessions.lock().await;
        sessions
            .iter_mut()
            .map(|(name, s)| {
                s.refresh_status();
                self.session_info(name, s)
            })
            .collect()
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
    sandbox: Option<&SandboxSession>,
) -> Result<PipeCommandOutcome> {
    let sandbox_pidfile = sandbox.map(|_| make_sandbox_pidfile());
    let mut command = if let Some(sb) = sandbox {
        let mut command = Command::new("podman");
        command.arg("exec").arg("--workdir");
        let wd = cwd
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| sb.workdir_display());
        command.arg(wd);
        for (key, value) in terminal_env() {
            command.arg("--env").arg(format!("{key}={value}"));
        }
        command
            .arg(sb.container_name())
            .arg("bash")
            .arg("-lc")
            .arg(SANDBOX_EXEC_WRAPPER)
            .arg("nac-exec")
            .arg(cmd)
            .arg(sandbox_pidfile.as_deref().expect("sandbox pidfile exists"));
        isolate_process_group(&mut command);
        command
    } else {
        let mut command = Command::new("bash");
        command.arg("-c").arg(cmd);
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        for (key, value) in terminal_env() {
            command.env(key, value);
        }
        isolate_process_group(&mut command);
        command
    };

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
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
            if let (Some(sb), Some(pidfile)) = (sandbox, sandbox_pidfile.as_deref()) {
                terminate_sandbox_command(sb, pidfile).await;
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

async fn terminate_sandbox_command(sandbox: &SandboxSession, pidfile: &str) {
    let mut command = Command::new("podman");
    command
        .arg("exec")
        .arg(sandbox.container_name())
        .arg("sh")
        .arg("-c")
        .arg(SANDBOX_KILL_WRAPPER)
        .arg("nac-kill")
        .arg(pidfile)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let _ = timeout(Duration::from_secs(2), command.status()).await;
}

fn make_sandbox_pidfile() -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    format!("/tmp/nac-exec-{}-{id}.pid", std::process::id())
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

fn terminal_env() -> &'static [(&'static str, &'static str)] {
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

    #[test]
    fn sandbox_pidfile_path_is_container_tmp_path() {
        let path = make_sandbox_pidfile();
        assert!(path.starts_with("/tmp/nac-exec-"));
        assert!(path.ends_with(".pid"));
    }

    #[test]
    fn sandbox_wrappers_track_and_kill_process_group() {
        assert!(SANDBOX_EXEC_WRAPPER.contains("setsid bash -c"));
        assert!(SANDBOX_EXEC_WRAPPER.contains("printf '%s' \"$pid\" > \"$pidfile\""));
        assert!(SANDBOX_KILL_WRAPPER.contains("kill -TERM \"-$pid\""));
        assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"-$pid\""));

        let _sandbox = SandboxSession::new_for_test(SandboxSpec {
            image: DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: Vec::new(),
            workdir: DEFAULT_SANDBOX_WORKDIR.into(),
            gpu_devices: Vec::new(),
            shm_size: None,
        });
    }
}
