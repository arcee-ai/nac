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
    pub(crate) async fn drain(&self) -> Result<()> {
        if let Some(owner) = &self.coordinator {
            owner.shutdown().await?;
        }
        Ok(())
    }
}

impl crate::SessionManager {
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
