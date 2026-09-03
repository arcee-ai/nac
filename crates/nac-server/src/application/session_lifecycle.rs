use anyhow::{anyhow, Context, Result};
use nac_core::{runtime, sessions, view, workspace, workspace::GitTarget};

use crate::{CompletionSuppressionRollback, SandboxResourceLeaseRollback, SessionManager};

/// Destructive session lifecycle use cases.
///
/// Deletion owns one ordered authority chain: relationship gate, completion
/// suppression, operation and resource leases, descendant cleanup, sandbox
/// cleanup, durable deletion, revision unpinning, then worktree cleanup.
pub(crate) struct SessionLifecycleApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionLifecycleApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn delete(&self, session_id: &str) -> Result<()> {
        self.manager.require_primary_operation_session(session_id)?;
        // Own deletion in an independent task. Dropping an HTTP/request future
        // cannot drop leases while launched container cleanup continues.
        let manager = self.manager.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            manager
                .session_lifecycle()
                .delete_cascade(&session_id)
                .await
        })
        .await
        .context("session deletion task failed")?
    }

    pub(crate) async fn delete_cascade(&self, session_id: &str) -> Result<()> {
        self.manager
            .require_persisted_operation_session(session_id)?;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let _relationship_lease = sessions::SessionRelationshipLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        )?;
        let service = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        let mut suppression_rollback =
            CompletionSuppressionRollback::new(self.manager.inner.store_path.clone());
        if let Some(service) = service.as_ref() {
            if service.active_compaction().is_some() {
                return Err(anyhow!("session is busy with an active manual compaction"));
            }
            if let Some(active_run) = service.active_run() {
                suppression_rollback.suppress_running(session_id)?;
                if let Err(error) = service
                    .connect_client()
                    .request_cancel(&active_run.run_id)
                    .await
                {
                    if service.active_run().is_some() {
                        return Err(anyhow!(error.to_string()));
                    }
                }
            }
            if service.has_active_operation() {
                return Err(anyhow!("session is busy with an active operation"));
            }
        }
        // Mutation authority is acquired before shared resource ownership is
        // converted, and the rollback guard restores ownership on every exit.
        let _operation_lease = sessions::SessionOperationLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        )?;
        if let Some(service) = service.as_ref() {
            service.release_sandbox_resource_lease();
        }
        let mut sandbox_lease_rollback = SandboxResourceLeaseRollback::new(service.clone());
        let _resource_lease = sessions::SessionResourceMutationLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        )?;
        self.manager
            .require_persisted_operation_session(session_id)?;
        suppression_rollback.suppress_running(session_id)?;

        for assignment in
            nac_core::store::list_session_assignments(&self.manager.inner.store_path, session_id)?
        {
            Box::pin(self.delete_cascade(&assignment.child_session_id)).await?;
        }

        // Snapshot decode failures remain fail-closed so cleanup authority is
        // never erased before its stable container/worktree identity is used.
        let persisted_sandbox =
            sessions::load_session(&self.manager.inner.store_path, session_id)?.sandbox_spec;
        let persisted_worktree = persisted_sandbox
            .as_ref()
            .and_then(|spec| spec.worktree.clone());
        let revision_target = persisted_worktree
            .as_ref()
            .map(|worktree| GitTarget::Local {
                root: worktree.repo_root.clone(),
            });
        let revision_target = match revision_target {
            Some(target) => Some(target),
            None => self
                .manager
                .workspace()
                .workspace_root(session_id)
                .await
                .ok(),
        };
        if let Some(service) = service.as_ref() {
            service.destroy_terminals().await?;
            service.destroy_sandbox().await?;
        } else if persisted_sandbox.is_some() {
            nac_core::destroy_persisted_container(session_id).await?;
        }

        let deleted = view::delete_session(&self.manager.inner.store_path, session_id)?;
        if !deleted {
            return Err(anyhow!("session '{session_id}' was not found"));
        }
        if let Some(target) = revision_target {
            if let Err(error) = workspace::forget(&target, session_id) {
                eprintln!("nac: failed to drop workspace revisions: {error:#}");
            }
        }
        suppression_rollback.disarm();
        self.manager
            .inner
            .active_sessions
            .write()
            .await
            .remove(session_id);
        sandbox_lease_rollback.disarm();
        if let Some(worktree) = persisted_worktree {
            runtime::cleanup_session_worktree(&worktree);
        }
        Ok(())
    }
}
