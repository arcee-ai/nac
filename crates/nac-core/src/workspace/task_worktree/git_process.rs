//! Cancellable Local Git effects, using the shared descendant-aware supervisor.
use anyhow::{Context, Result};
use nac_process::ProcessTreeGuard;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::io::AsyncReadExt;
use tokio::sync::Notify;

#[derive(Clone, Default)]
pub struct TaskGit {
    stopping: Arc<AtomicBool>,
    activity: Arc<Notify>,
}

impl TaskGit {
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        self.activity.notify_waiters();
    }

    pub fn check_running(&self) -> Result<()> {
        anyhow::ensure!(
            !self.stopping.load(Ordering::Acquire),
            "conflict: server is stopping; retained task preparation interrupted"
        );
        Ok(())
    }

    async fn stopped(&self) {
        loop {
            let notified = self.activity.notified();
            if self.check_running().is_err() {
                return;
            }
            notified.await;
        }
    }

    pub(super) fn at(&self, cwd: &Path) -> LocalGit<'_> {
        LocalGit {
            cwd: cwd.to_path_buf(),
            owner: self,
        }
    }
}

pub(super) struct LocalGit<'a> {
    cwd: PathBuf,
    owner: &'a TaskGit,
}

impl LocalGit<'_> {
    pub(super) fn root(&self) -> &Path {
        &self.cwd
    }

    pub(super) async fn output(&self, cwd: &Path, args: &[&str]) -> Result<Output> {
        self.output_with_env(cwd, &[], args).await
    }

    pub(super) async fn output_with_env(
        &self,
        cwd: &Path,
        envs: &[(&str, &str)],
        args: &[&str],
    ) -> Result<Output> {
        self.owner.check_running()?;
        let mut command = tokio::process::Command::new("git");
        command
            .arg("-C")
            .arg(cwd)
            .args(args)
            .envs(envs.iter().copied())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (mut child, mut tree) = ProcessTreeGuard::spawn_supervised(&mut command)
            .context("failed to start retained task Git")?;
        let mut stdout = child.stdout.take().context("Git stdout missing")?;
        let mut stderr = child.stderr.take().context("Git stderr missing")?;
        let out = tokio::spawn(async move {
            let mut bytes = Vec::new();
            stdout.read_to_end(&mut bytes).await.map(|_| bytes)
        });
        let err = tokio::spawn(async move {
            let mut bytes = Vec::new();
            stderr.read_to_end(&mut bytes).await.map(|_| bytes)
        });
        let status = tokio::select! {
            status = child.wait() => Some(status),
            _ = self.owner.stopped() => None,
        };
        let status = match status {
            Some(Ok(status)) => {
                tree.mark_leader_reaped();
                // Also reach descendants that escaped the original group after
                // a successful Git leader exit, without waiting on their pipes.
                while tree.finish_checked().await.is_err() {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                status
            }
            _ => {
                if let Err(error) = tree.terminate(&mut child).await {
                    eprintln!("nac: retained Git cleanup is unproven: {error}");
                    // The supervisor attempted cleanup but cannot prove it.
                    // Keep serving ownership/lease under the outer watchdog.
                    std::future::pending::<()>().await;
                }
                child.wait().await.context("failed to reap retained Git")?
            }
        };
        let stdout = out.await.context("Git stdout task stopped")??;
        let stderr = err.await.context("Git stderr task stopped")??;
        self.owner.check_running()?;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    }

    pub(super) async fn run(&self, args: &[&str]) -> Result<String> {
        let output = self.output(&self.cwd, args).await?;
        anyhow::ensure!(
            output.status.success(),
            "git {} failed: {}",
            args[0],
            crate::workspace::first_stderr_line(&output.stderr)
        );
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_owned())
    }

    pub(super) async fn repo_root(&self) -> Result<PathBuf> {
        let output = self
            .output(&self.cwd, &["rev-parse", "--show-toplevel"])
            .await?;
        anyhow::ensure!(
            output.status.success(),
            "source is not a Git repository: {}",
            crate::workspace::first_stderr_line(&output.stderr)
        );
        let raw = String::from_utf8(output.stdout).context("Git repository path is not UTF-8")?;
        super::canonical(Path::new(raw.trim_end()))
    }
}
