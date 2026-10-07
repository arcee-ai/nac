//! Actual owned capture processes survive failed/cancelled cleanup callers.
use super::*;
use nac_process::ProcessTreeGuard;
use tokio::process::Child;

#[derive(Default)]
pub(super) struct CaptureCleanups {
    owners: StdMutex<BTreeMap<Uuid, Arc<CaptureCleanup>>>,
}

pub(super) struct CaptureCleanup {
    pub(super) process: Mutex<CaptureProcess>,
    run_id: SessionRunId,
    // These are the actual selected OS resources, never reconstructed IDs.
    _lease: Arc<sessions::SessionOperationLease>,
    _workspace: Option<Arc<sessions::WorkspaceActivityLease>>,
}

pub(super) struct CaptureProcess {
    pub(super) child: Child,
    pub(super) tree: ProcessTreeGuard,
    pub(super) cleaned: bool,
}

impl CaptureProcess {
    pub(super) async fn cleanup(&mut self) -> Result<()> {
        if !self.cleaned {
            self.tree.terminate(&mut self.child).await?;
            self.cleaned = true;
        }
        Ok(())
    }
}

impl CaptureCleanups {
    pub(super) fn register(
        &self,
        run_id: SessionRunId,
        lease: Arc<sessions::SessionOperationLease>,
        workspace: Option<Arc<sessions::WorkspaceActivityLease>>,
        child: Child,
        tree: ProcessTreeGuard,
    ) -> (Uuid, Arc<CaptureCleanup>) {
        let id = Uuid::new_v4();
        let owner = Arc::new(CaptureCleanup {
            run_id,
            _lease: lease,
            _workspace: workspace,
            process: Mutex::new(CaptureProcess {
                child,
                tree,
                cleaned: false,
            }),
        });
        self.owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, Arc::clone(&owner));
        (id, owner)
    }

    pub(super) fn forget(&self, id: Uuid, expected: &Arc<CaptureCleanup>) {
        let mut owners = self
            .owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if owners
            .get(&id)
            .is_some_and(|owner| Arc::ptr_eq(owner, expected))
        {
            owners.remove(&id);
        }
    }

    pub(super) async fn retry_run(self: &Arc<Self>, run_id: &SessionRunId) -> Result<()> {
        let owners = self
            .owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(_, owner)| owner.run_id == *run_id)
            .map(|(&id, owner)| (id, Arc::clone(owner)))
            .collect::<Vec<_>>();
        let mut failures = Vec::new();
        for (id, owner) in owners {
            let registry = Arc::clone(self);
            // Cleanup owns its future even if a completion task or cancellation
            // caller is dropped. The resource stays discoverable across waits.
            let result = tokio::spawn(async move {
                owner.process.lock().await.cleanup().await?;
                registry.forget(id, &owner);
                Ok::<_, anyhow::Error>(())
            })
            .await;
            match result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(format!("{error:#}")),
                Err(error) => failures.push(error.to_string()),
            }
        }
        anyhow::ensure!(
            failures.is_empty(),
            "capture cleanup incomplete: {}",
            failures.join("; ")
        );
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn pending(&self, run_id: &SessionRunId) -> usize {
        self.owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|owner| owner.run_id == *run_id)
            .count()
    }

    #[cfg(test)]
    pub(super) async fn release_failures(&self, run_id: &SessionRunId) {
        let owners = self
            .owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|owner| owner.run_id == *run_id)
            .cloned()
            .collect::<Vec<_>>();
        for owner in owners {
            owner
                .process
                .lock()
                .await
                .tree
                .fail_cleanup_attempts_for_test(0);
        }
    }
}

impl SessionService {
    #[cfg(test)]
    pub(crate) fn fail_capture_cleanup_attempts_for_test(&self, count: usize) {
        self.capture_cleanup_failures
            .store(count, std::sync::atomic::Ordering::Release);
    }
    #[cfg(test)]
    pub(crate) fn pending_capture_cleanups_for_test(&self, run_id: &SessionRunId) -> usize {
        self.capture_cleanups.pending(run_id)
    }
    #[cfg(test)]
    pub(crate) async fn release_capture_cleanup_failures_for_test(&self, run_id: &SessionRunId) {
        self.capture_cleanups.release_failures(run_id).await;
    }
}
