use anyhow::{anyhow, Context, Result};
use nac_core::{
    sessions, view,
    workspace::{self, GitTarget},
};

use crate::{git_target_key, SessionManager, WorkspaceMutationAdmission};

pub(crate) struct WorkspaceDiffRequest {
    pub(crate) path: String,
    pub(crate) stage: Option<String>,
    pub(crate) context: Option<usize>,
    pub(crate) revision: Option<i64>,
}

pub(crate) struct SwitchBranch {
    pub(crate) name: String,
    pub(crate) create: bool,
}

pub(crate) struct CommitWorkspace {
    pub(crate) message: String,
}

/// Workspace inspection and mutation use cases. Mutation admission retains the
/// existing process-wide gate plus durable workspace/session leases through
/// the uncancellable Git operation.
pub(crate) struct WorkspaceApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> WorkspaceApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub async fn workspace_file_diff(
        &self,
        session_id: &str,
        query: WorkspaceDiffRequest,
    ) -> Result<view::WorkspaceFileDiff> {
        let stage = view::WorkspaceDiffStage::parse(query.stage.as_deref().unwrap_or("all"))?;
        let context = query.context.unwrap_or(3).min(100);
        let path = query.path;
        let target = self.workspace_root(session_id).await?;

        let revision = self.resolve_revision(session_id, query.revision)?;
        tokio::task::spawn_blocking(move || match revision {
            Some(revision) => view::revision_file_diff(
                &target,
                revision.base_sha.as_deref(),
                &revision.commit_sha,
                &path,
                context,
            ),
            None => view::workspace_file_diff(&target, &path, stage, context),
        })
        .await
        .context("workspace diff task failed")?
    }

    /// The checkout of a session, refusing when an agent could be working in
    /// it. Several sessions may share one checkout, so every one of them has to
    /// be quiet, not just this one — and "the same checkout" means the same
    /// directory *on the same machine*, which is what keeps two sessions on one
    /// remote path from moving each other's branch.
    pub(crate) async fn idle_workspace_root(
        &self,
        session_id: &str,
    ) -> Result<WorkspaceMutationAdmission> {
        let initial_sessions = self.manager.session_catalog().list(false).await?;
        let summary = initial_sessions
            .iter()
            .find(|entry| entry.summary.session_id == session_id)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let target = self.manager.git_target(&summary.summary)?;
        let workspace_gate =
            nac_core::shared_workspace_gate_for(&self.manager.inner.store_path, target.root())
                .write_owned()
                .await;
        let workspace_lease = match sessions::WorkspaceMutationLease::try_acquire(
            &self.manager.inner.store_path,
            &target.lease_identity(),
        ) {
            Ok(lease) => lease,
            Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                return Err(anyhow!(
                    "workspace is busy: a retained terminal may still mutate the checkout"
                ));
            }
            Err(error) => return Err(anyhow::Error::new(error)),
        };

        // Re-read after taking the same process-wide gate used by native file,
        // shell, and terminal-input tools. Then acquire every same-checkout
        // session operation lease in stable order and retain them through Git.
        // This turns the idle observation into an admission boundary: an
        // already-running peer makes acquisition fail, and a new run cannot
        // establish ownership until the branch/commit operation is finished.
        let sessions = self.manager.session_catalog().list(false).await?;
        let current = sessions
            .iter()
            .find(|entry| entry.summary.session_id == session_id)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let current_target = self.manager.git_target(&current.summary)?;
        if git_target_key(&current_target) != git_target_key(&target) {
            return Err(anyhow!("workspace changed during mutation admission"));
        }
        let key = git_target_key(&target);
        let mut session_ids = sessions
            .iter()
            .filter(|entry| {
                self.manager
                    .git_target(&entry.summary)
                    .is_ok_and(|other| git_target_key(&other) == key)
            })
            .map(|entry| entry.summary.session_id.clone())
            .collect::<Vec<_>>();
        session_ids.sort();

        let cached = self.manager.inner.active_sessions.read().await;
        if let Some(retained) = session_ids.iter().find(|candidate| {
            cached
                .get(candidate.as_str())
                .is_some_and(|service| service.has_retained_terminals())
        }) {
            return Err(anyhow!(
                "workspace is busy: session '{retained}' owns a retained terminal"
            ));
        }
        drop(cached);

        let mut session_leases = Vec::with_capacity(session_ids.len());
        for candidate in session_ids {
            match sessions::SessionOperationLease::try_acquire(
                &self.manager.inner.store_path,
                &candidate,
            ) {
                Ok(lease) => session_leases.push(lease),
                Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                    return Err(anyhow!(
                        "workspace is busy: session '{candidate}' has an operation in flight"
                    ));
                }
                Err(error) => return Err(anyhow::Error::new(error)),
            }
        }

        self.manager.ensure_git_ready(&target).await?;
        Ok(WorkspaceMutationAdmission {
            target,
            _workspace_gate: workspace_gate,
            _workspace_lease: workspace_lease,
            _session_leases: session_leases,
        })
    }

    pub(crate) async fn execute_workspace_mutation<T, F>(
        admission: WorkspaceMutationAdmission,
        task_context: &'static str,
        operation: F,
    ) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&GitTarget) -> Result<T> + Send + 'static,
    {
        tokio::task::spawn_blocking(move || {
            // The admission owns every process-local and cross-process lease.
            // Moving it into this uncancellable closure keeps authority alive
            // even if the request future awaiting the JoinHandle is aborted.
            let result = operation(&admission.target);
            drop(admission);
            result
        })
        .await
        .with_context(|| task_context)?
    }

    /// The checkout of a session, for read-only inspection.
    pub(crate) async fn workspace_root(&self, session_id: &str) -> Result<GitTarget> {
        let summary = self
            .manager
            .session_catalog()
            .list(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let target = self.manager.git_target(&summary)?;
        self.manager.ensure_git_ready(&target).await?;
        Ok(target)
    }

    pub async fn workspace_files(
        &self,
        session_id: &str,
        revision: Option<i64>,
    ) -> Result<view::WorkspaceFileList> {
        let target = self.workspace_root(session_id).await?;
        let revision = self.resolve_revision(session_id, revision)?;
        tokio::task::spawn_blocking(move || match revision {
            Some(revision) => view::list_revision_files(&target, &revision.commit_sha),
            None => view::list_files(&target),
        })
        .await
        .context("workspace file listing task failed")?
    }

    pub async fn workspace_file(
        &self,
        session_id: &str,
        path: String,
        revision: Option<i64>,
    ) -> Result<view::WorkspaceFileContent> {
        let target = self.workspace_root(session_id).await?;
        let revision = self.resolve_revision(session_id, revision)?;
        tokio::task::spawn_blocking(move || match revision {
            Some(revision) => view::read_revision_file(&target, &revision.commit_sha, &path),
            None => view::read_file(&target, &path),
        })
        .await
        .context("workspace file read task failed")?
    }

    /// Open a workspace path in the OS file manager / default app. Local
    /// sessions only — an ssh checkout is not a path this machine can open.
    pub async fn open_workspace_path(
        &self,
        session_id: &str,
        path: String,
    ) -> Result<view::OpenLocalPathResult> {
        let summary = self
            .manager
            .session_catalog()
            .list(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        if summary.ssh_host.is_some() {
            anyhow::bail!("opening paths is only available for local sessions");
        }
        let target = self.manager.git_target(&summary)?;
        let root = target
            .local_path()
            .ok_or_else(|| {
                anyhow!(
                    "workspace '{}' lives only inside the sandbox; mount a working directory to open it",
                    summary.cwd.display()
                )
            })?
            .to_path_buf();
        tokio::task::spawn_blocking(move || view::open_local_path(&root, &path))
            .await
            .context("workspace open task failed")?
    }

    pub fn workspace_revisions(
        &self,
        session_id: &str,
    ) -> Result<Vec<view::WorkspaceRevisionRecord>> {
        view::list_workspace_revisions(&self.manager.inner.store_path, session_id)
    }

    /// What the run behind a revision changed, in the shape the live workspace
    /// reports, so the files panel can render either one the same way.
    pub async fn workspace_revision_changes(
        &self,
        session_id: &str,
        revision_id: i64,
    ) -> Result<view::WorkspaceRevisionChanges> {
        let target = self.workspace_root(session_id).await?;
        let revision = self
            .resolve_revision(session_id, Some(revision_id))?
            .ok_or_else(|| anyhow!("revision '{}' was not found", revision_id))?;

        tokio::task::spawn_blocking(move || {
            view::revision_changes(&target, revision.base_sha.as_deref(), &revision.commit_sha)
        })
        .await
        .context("workspace revision task failed")
    }

    /// Revisions are addressed by their store id rather than by commit, so a
    /// request can only ever reach an object this session actually recorded.
    fn resolve_revision(
        &self,
        session_id: &str,
        revision: Option<i64>,
    ) -> Result<Option<view::WorkspaceRevisionRecord>> {
        let Some(revision) = revision else {
            return Ok(None);
        };
        view::read_workspace_revision(&self.manager.inner.store_path, session_id, revision)?
            .ok_or_else(|| anyhow!("revision '{}' was not found", revision))
            .map(Some)
    }

    pub async fn workspace_branches(&self, session_id: &str) -> Result<workspace::BranchList> {
        let target = self.workspace_root(session_id).await?;
        tokio::task::spawn_blocking(move || workspace::list_branches(&target))
            .await
            .context("branch listing task failed")?
    }

    pub async fn switch_workspace_branch(
        &self,
        session_id: &str,
        request: SwitchBranch,
    ) -> Result<workspace::BranchList> {
        self.manager.require_primary_operation_session(session_id)?;
        let admission = self.idle_workspace_root(session_id).await?;

        Self::execute_workspace_mutation(admission, "branch switch task failed", move |target| {
            if request.create {
                // A new branch takes the uncommitted work with it, which is
                // usually the point of making one, so a dirty tree is fine.
                return workspace::create_branch(target, &request.name);
            }
            if workspace::list_branches(target)?.dirty {
                return Err(anyhow!(
                    "workspace has uncommitted changes; commit or stash them before switching"
                ));
            }
            workspace::switch_branch(target, &request.name)
        })
        .await
    }

    /// Commit the whole checkout on the user's behalf. Guarded like a branch
    /// switch: an agent writing files underneath a `git add` would commit a
    /// half-finished tree.
    pub async fn commit_workspace(
        &self,
        session_id: &str,
        request: CommitWorkspace,
    ) -> Result<workspace::CommitOutcome> {
        self.manager.require_primary_operation_session(session_id)?;
        let admission = self.idle_workspace_root(session_id).await?;

        Self::execute_workspace_mutation(admission, "commit task failed", move |target| {
            workspace::commit_all(target, &request.message)
        })
        .await
    }
}
