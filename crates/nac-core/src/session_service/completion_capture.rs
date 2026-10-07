//! Best-effort completion capture under the same active original and OS lease.
use super::*;
use crate::runtime::{ManagedRuntimeLeaseGuard, RuntimeEffectLease};
use crate::workspace::{capture_with_executor, CaptureExecutor};
use anyhow::{anyhow, bail, Context};
use nac_process::ProcessTreeGuard;
use std::process::{Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncRead, AsyncReadExt};

// This bounds optional capture, never the original job or its renewed lifetime.
const CAPTURE_BUDGET: Duration = Duration::from_secs(30);
const OUTPUT_LIMIT: u64 = 8 * 1024 * 1024;

struct CompletionCapture {
    service: SessionService,
    run_id: SessionRunId,
    original: Arc<ManagedRuntimeLeaseGuard>,
    lease: Arc<sessions::SessionOperationLease>,
    deadline: tokio::time::Instant,
    executor: tokio::runtime::Handle,
    failed: AtomicBool,
}

impl SessionService {
    pub(super) async fn capture_runtime_completion(
        &self,
        run_id: &SessionRunId,
    ) -> Result<Option<crate::store::NewWorkspaceRevision>> {
        let (Some(session_id), Some(target)) =
            (self.metadata.session_id.clone(), self.workspace_git.clone())
        else {
            return Ok(None);
        };
        // Until an exact remote receipt and retryable cleanup owner are composed,
        // selected SSH capture stays closed. It must never execute on the host.
        if !matches!(target, GitTarget::Local { .. }) {
            bail!("protected SSH revision capture requires remote cleanup ownership");
        }
        let (original, lease, label) = {
            let active = self.lock_active_operation();
            let Some(ActiveSessionOperation::Run(run)) = active.as_ref() else {
                bail!("completion run unavailable");
            };
            anyhow::ensure!(
                &run.snapshot.run_id == run_id && !run.finishing,
                "completion run unavailable"
            );
            let original = run
                .runtime_original
                .as_ref()
                .ok_or_else(|| anyhow!("completion original unavailable"))?;
            (
                Arc::clone(&original.guard),
                Arc::clone(
                    run._operation_lease
                        .as_ref()
                        .ok_or_else(|| anyhow!("completion OS lease unavailable"))?,
                ),
                run.snapshot.prompt_preview.clone(),
            )
        };
        let scope = CompletionCapture {
            service: self.clone(),
            run_id: run_id.clone(),
            original,
            lease,
            deadline: tokio::time::Instant::now() + CAPTURE_BUDGET,
            executor: tokio::runtime::Handle::current(),
            failed: AtomicBool::new(false),
        };
        scope.current().await?;
        let transcript_len = self.transcript_len().await.ok();
        scope.current().await?;
        crate::store::spawn_blocking_store_caller(move || {
            let previous = crate::store::latest_workspace_revision(
                &scope.service.metadata.store_path,
                &session_id,
            )?
            .map(|revision| revision.commit_sha);
            scope.check()?;
            let captured =
                capture_with_executor(&target, &scope, &session_id, previous.as_deref())?;
            // All Git reads/writes and output release completed while live. This
            // value is terminal bookkeeping, never authority for later Git work.
            scope.check()?;
            Ok(Some(crate::store::NewWorkspaceRevision {
                run_id: scope.run_id.to_string(),
                commit_sha: captured.commit,
                base_sha: captured.base,
                branch: captured.branch,
                label,
                additions: captured.additions,
                deletions: captured.deletions,
                changed_files: captured.changed_files,
                transcript_len,
            }))
        })
        .await?
    }

    pub(super) async fn retain_completed_revision(
        &self,
        revision: crate::store::NewWorkspaceRevision,
    ) -> Result<()> {
        let path = self.metadata.store_path.clone();
        let session = self
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("completion session unavailable"))?;
        crate::store::spawn_blocking_store_caller(move || {
            crate::store::append_workspace_revision(&path, &session, revision)
        })
        .await??;
        Ok(())
    }
}

impl CompletionCapture {
    fn selected(&self, active: &Option<ActiveSessionOperation>) -> Result<()> {
        anyhow::ensure!(
            tokio::time::Instant::now() < self.deadline,
            "workspace capture deadline elapsed"
        );
        let Some(ActiveSessionOperation::Run(run)) = active else {
            bail!("completion run unavailable");
        };
        anyhow::ensure!(
            run.snapshot.run_id == self.run_id && !run.finishing,
            "completion run unavailable"
        );
        let original = run
            .runtime_original
            .as_ref()
            .ok_or_else(|| anyhow!("completion original unavailable"))?;
        anyhow::ensure!(
            Arc::ptr_eq(&original.guard, &self.original)
                && run
                    ._operation_lease
                    .as_ref()
                    .is_some_and(|lease| Arc::ptr_eq(lease, &self.lease)),
            "completion ownership changed"
        );
        self.lease
            .validate(&self.service.metadata.store_path, &original.session_id)?;
        self.original.check_now()
    }

    async fn current(&self) -> Result<()> {
        anyhow::ensure!(
            !self.failed.load(Ordering::Acquire),
            "workspace capture stopped"
        );
        tokio::time::timeout_at(self.deadline, self.original.check_current()).await??;
        self.selected(&self.service.lock_active_operation())
    }

    async fn command(&self, cwd: &Path, envs: &[(&str, &str)], args: &[&str]) -> Result<Output> {
        self.current().await?;
        let mut command = tokio::process::Command::new("git");
        command
            .current_dir(cwd)
            .args(args)
            .envs(envs.iter().copied());
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Cancellation takes the same canonical ownership lock. It is free to
        // win during waits, but cannot mark finishing between this check/spawn.
        let (mut child, mut tree) = {
            let active = self.service.lock_active_operation();
            self.selected(&active)?;
            ProcessTreeGuard::spawn_supervised(&mut command)?
        };
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("capture stdout unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("capture stderr unavailable"))?;
        let result = tokio::select! {
            biased;
            () = self.original.wait_for_denial() => Err(anyhow!("workspace capture original denied")),
            result = tokio::time::timeout_at(self.deadline, async {
                let wait = async {
                    let status = child.wait().await?;
                    // Successful leaders can leave escaped descendants. Use
                    // identity/tag cleanup on success as well as on denial.
                    tree.mark_leader_reaped();
                    tree.terminate(&mut child).await?;
                    Ok::<_, anyhow::Error>(status)
                };
                let (status, stdout, stderr) = tokio::join!(wait, limited_output(stdout), limited_output(stderr));
                Ok::<_, anyhow::Error>(Output { status: status?, stdout: stdout?, stderr: stderr? })
            }) => result.map_err(Into::into).and_then(|output| output),
        };
        if result.is_err() {
            // Owned cleanup remains permitted after denial; no Git rollback or
            // readback occurs. The blocking caller retains the actual OS lease.
            tree.terminate(&mut child)
                .await
                .context("workspace capture cleanup incomplete")?;
        }
        let output = result?;
        self.current().await?;
        Ok(output)
    }
}

async fn limited_output(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .await?;
    anyhow::ensure!(
        bytes.len() as u64 <= OUTPUT_LIMIT,
        "workspace capture output limit exceeded"
    );
    Ok(bytes)
}

impl CaptureExecutor for CompletionCapture {
    fn check(&self) -> Result<()> {
        self.executor.block_on(self.current())
    }
    fn repo_root(&self, target: &GitTarget) -> Result<PathBuf> {
        let output = self.output(
            target,
            target.root(),
            &[],
            &["rev-parse", "--show-toplevel"],
        )?;
        anyhow::ensure!(output.status.success(), "workspace is not a Git repository");
        let raw = String::from_utf8(output.stdout)?;
        anyhow::ensure!(
            !raw.trim_end().is_empty(),
            "Git repository root unavailable"
        );
        self.check()?;
        PathBuf::from(raw.trim_end())
            .canonicalize()
            .context("failed to resolve Git repository root")
    }
    fn mkdir(&self, _target: &GitTarget, path: &Path) -> Result<()> {
        self.check()?;
        let active = self.service.lock_active_operation();
        self.selected(&active)?;
        std::fs::create_dir_all(path).context("failed to create revision index directory")
    }
    fn output(
        &self,
        target: &GitTarget,
        cwd: &Path,
        envs: &[(&str, &str)],
        args: &[&str],
    ) -> Result<Output> {
        anyhow::ensure!(
            matches!(target, GitTarget::Local { .. }),
            "protected capture target unavailable"
        );
        let result = self.executor.block_on(self.command(cwd, envs, args));
        if result.is_err() {
            self.failed.store(true, Ordering::Release);
        }
        result
    }
}
