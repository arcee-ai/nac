//! Git process execution, cancellation, progress retention, and remote identity.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};

use anyhow::{bail, Context, Result};
use nac_process::ProcessTreeGuard;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Notify;
use url::Url;

use crate::GitHubAccessToken;

const MAX_PROGRESS_BYTES: usize = 64 * 1024;

pub(crate) type CloneProgress = Arc<StdMutex<String>>;

#[derive(Clone, Default)]
pub(crate) struct CloneCancellation {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    activity: Arc<Notify>,
}

#[derive(Clone)]
pub(crate) struct GitCloneProcess {
    executable: PathBuf,
    home_root: PathBuf,
}

impl CloneCancellation {
    pub(crate) fn cancel(&self) {
        if !self
            .cancelled
            .swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            self.activity.notify_waiters();
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::Acquire)
    }

    async fn cancelled(&self) {
        loop {
            let notified = self.activity.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

impl GitCloneProcess {
    pub(crate) fn new(executable: PathBuf, home_root: PathBuf) -> Self {
        Self {
            executable,
            home_root,
        }
    }

    pub(crate) async fn run(
        &self,
        clone_url: &str,
        branch: &str,
        checkout: &Path,
        cancellation: &CloneCancellation,
        progress: CloneProgress,
        token: Option<&GitHubAccessToken>,
    ) -> Result<()> {
        let mut command = Command::new(&self.executable);
        command
            .arg("clone")
            .arg("--progress")
            .arg("--single-branch")
            .arg("--branch")
            .arg(branch)
            .arg("--")
            .arg(clone_url)
            .arg(checkout)
            .env("HOME", &self.home_root)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "0")
            .env("GH_PROMPT_DISABLED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (mut child, mut process_tree) = ProcessTreeGuard::spawn_supervised(&mut command)
            .context("failed to spawn managed Git clone")?;
        let stdout = child
            .stdout
            .take()
            .context("managed Git clone did not expose piped stdout")?;
        let stderr = child
            .stderr
            .take()
            .context("managed Git clone did not expose piped stderr")?;
        let stdout_reader = tokio::spawn(read_progress(stdout, Arc::clone(&progress)));
        let stderr_reader = tokio::spawn(read_progress(stderr, progress));
        let (status, was_cancelled) = tokio::select! {
            status = child.wait() => (
                status.context("failed to wait for managed Git clone")?,
                false,
            ),
            _ = cancellation.cancelled() => {
                process_tree
                    .terminate(&mut child)
                    .await
                    .context("failed to terminate cancelled Git clone")?;
                let status = child
                    .wait()
                    .await
                    .context("failed to reap cancelled Git clone")?;
                (status, true)
            }
        };
        process_tree.mark_leader_reaped();
        process_tree.finish().await;
        let stdout = stdout_reader.await.context("Git stdout reader stopped")??;
        let stderr = stderr_reader.await.context("Git stderr reader stopped")??;
        if was_cancelled {
            bail!("clone cancelled");
        }
        if !status.success() {
            let diagnostic = if stderr.trim().is_empty() {
                stdout
            } else {
                stderr
            };
            bail!(
                "Git clone failed with status {}: {}",
                status,
                sanitize_error(&diagnostic, token.map(GitHubAccessToken::secret))
            );
        }
        Ok(())
    }

    pub(crate) fn repository_identity(&self, destination: &Path) -> Result<Option<String>> {
        if !destination.exists() {
            return Ok(None);
        }
        let output = std::process::Command::new(&self.executable)
            .arg("-C")
            .arg(destination)
            .args(["config", "--get", "remote.origin.url"])
            .output()
            .context("failed to inspect existing clone destination")?;
        if !output.status.success() {
            return Ok(None);
        }
        let remote =
            String::from_utf8(output.stdout).context("existing Git remote is not valid UTF-8")?;
        canonical_remote_identity(remote.trim()).map(Some)
    }
}

pub(crate) fn canonical_remote_identity(remote: &str) -> Result<String> {
    if let Some(path) = remote.strip_prefix("git@github.com:") {
        return canonical_github_path(path);
    }
    if let Ok(url) = Url::parse(remote) {
        if url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
        {
            let safe_https = url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none();
            let safe_ssh = url.scheme() == "ssh"
                && matches!(url.username(), "" | "git")
                && url.password().is_none()
                && url.port().is_none();
            if (!safe_https && !safe_ssh) || url.query().is_some() || url.fragment().is_some() {
                bail!("unsupported or credential-bearing GitHub remote identity");
            }
            return canonical_github_path(url.path());
        }
        if url.scheme() == "file"
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
        {
            return Ok(format!("file:{}", url.path()));
        }
    }
    let path = Path::new(remote);
    if path.is_absolute() {
        return Ok(format!("file:{}", std::fs::canonicalize(path)?.display()));
    }
    bail!("unsupported Git remote identity")
}

pub(crate) fn sanitize_error(message: &str, token: Option<&str>) -> String {
    let mut sanitized = message.to_string();
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        sanitized = sanitized.replace(token, "[REDACTED]");
    }
    if sanitized.len() > 4_000 {
        sanitized.truncate(4_000);
        sanitized.push('…');
    }
    sanitized
}

async fn read_progress<R>(mut reader: R, progress: CloneProgress) -> Result<String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut retained = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        retained.extend_from_slice(&buffer[..read]);
        if retained.len() > MAX_PROGRESS_BYTES {
            let excess = retained.len() - MAX_PROGRESS_BYTES;
            retained.drain(..excess);
        }
        let preview = String::from_utf8_lossy(&retained)
            .chars()
            .rev()
            .take(2_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        *progress
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = preview;
    }
    Ok(String::from_utf8_lossy(&retained).into_owned())
}

fn canonical_github_path(path: &str) -> Result<String> {
    let segments = path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        bail!("invalid GitHub remote identity");
    }
    let repository = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    validate_repo_component(segments[0])?;
    validate_repo_component(repository)?;
    Ok(format!(
        "github.com/{}/{}",
        segments[0].to_ascii_lowercase(),
        repository.to_ascii_lowercase()
    ))
}

fn validate_repo_component(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 100
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        bail!("invalid GitHub repository identity");
    }
    Ok(())
}
