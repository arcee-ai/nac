use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use nac_core::store::StoreCoordinator;

#[cfg(test)]
std::thread_local! {
    static BYPASS_STORE_OWNERSHIP: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Application ownership of the selected store for one serving lifetime.
///
/// Core owns the generic crash-safe lease primitive. The server application
/// owns when to acquire it and retains it across every delivery surface.
pub(crate) struct StoreOwnership {
    coordinator: Option<Arc<StoreCoordinator>>,
}

pub(crate) fn acquire_store(store_path: &Path) -> Result<(StoreOwnership, PathBuf)> {
    #[cfg(test)]
    if BYPASS_STORE_OWNERSHIP.with(std::cell::Cell::get) {
        return Ok((
            StoreOwnership { coordinator: None },
            store_path.to_path_buf(),
        ));
    }
    let coordinator = StoreCoordinator::acquire(store_path)?;
    let canonical = coordinator.store_path().to_path_buf();
    Ok((
        StoreOwnership {
            coordinator: Some(coordinator),
        },
        canonical,
    ))
}
impl StoreOwnership {
    /// A serving owner moves legacy waits off the runtime. Explicit unowned
    /// fixtures retain their original polling and telemetry observation point.
    pub(crate) async fn call_legacy<F, R>(&self, operation: F) -> Result<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        if self.coordinator.is_some() {
            nac_core::store::spawn_blocking_store_caller(operation).await
        } else {
            Ok(operation())
        }
    }

    pub(crate) fn coordinator(&self) -> Option<&StoreCoordinator> {
        self.coordinator.as_ref().map(AsRef::as_ref)
    }
    pub(crate) async fn drain(&self) -> Result<()> {
        if let Some(owner) = &self.coordinator {
            owner.shutdown().await?;
        }
        Ok(())
    }
}

pub(crate) enum OperationSessionScope {
    Persisted,
    Primary,
    Direct,
}

impl crate::SessionManager {
    pub(crate) async fn stop_local_run_admission(&self) {
        let services = self
            .inner
            .active_sessions
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for service in services {
            if let Err(error) = service.stop_run_admission().await {
                eprintln!("nac: failed to stop local run admission: {error:#}");
            }
        }
    }

    /// Delivery has drained, so no new services can be published by requests.
    /// Wait for finishing commits, including runs whose cancellation correctly
    /// returned NotActive because terminal settlement already owns them. The
    /// server's independent outer watchdog bounds this complete shutdown.
    pub(crate) async fn quiesce_persistence_callers(&self) {
        self.stop_local_run_admission().await;
        loop {
            self.cancel_local_active_runs_for_shutdown().await;
            let services = self
                .inner
                .active_sessions
                .read()
                .await
                .values()
                .cloned()
                .collect::<Vec<_>>();
            if services
                .iter()
                .all(|service| !service.has_active_operation())
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    }

    pub(crate) async fn validate_operation_session(
        &self,
        session_id: &str,
        scope: OperationSessionScope,
    ) -> Result<()> {
        let manager = self.clone();
        let session_id = session_id.to_owned();
        self.inner
            ._store_ownership
            .call_legacy(move || match scope {
                OperationSessionScope::Persisted => {
                    manager.require_persisted_operation_session(&session_id)
                }
                OperationSessionScope::Primary => {
                    manager.require_primary_operation_session(&session_id)
                }
                OperationSessionScope::Direct => {
                    manager.require_primary_direct_session(&session_id)
                }
            })
            .await?
    }

    pub(crate) async fn repair_orphaned_completion_suppressions_async(
        &self,
        parent_session_id: &str,
    ) -> Result<()> {
        let manager = self.clone();
        let parent_session_id = parent_session_id.to_owned();
        self.inner
            ._store_ownership
            .call_legacy(move || {
                manager.repair_orphaned_completion_suppressions(&parent_session_id)
            })
            .await?
    }

    /// Construct owned persistence without blocking an async runtime worker.
    pub async fn new_async(options: crate::ServerOptions) -> Result<Self> {
        nac_core::store::spawn_blocking_store_caller(move || Self::new(options))
            .await
            .context("server persistence construction task failed")?
    }

    /// Drain persistence after stopping admission, settling local runs, and
    /// draining delivery. Accepted transactions retain store ownership until
    /// acknowledgement or an explicitly lost acknowledgement.
    pub async fn drain_persistence(&self) -> Result<()> {
        self.inner._store_ownership.drain().await
    }
}

#[cfg(test)]
pub(crate) fn without_store_ownership<T>(operation: impl FnOnce() -> T) -> T {
    struct Reset(bool);
    impl Drop for Reset {
        fn drop(&mut self) {
            BYPASS_STORE_OWNERSHIP.with(|bypass| bypass.set(self.0));
        }
    }

    BYPASS_STORE_OWNERSHIP.with(|bypass| {
        let reset = Reset(bypass.replace(true));
        let result = operation();
        drop(reset);
        result
    })
}
