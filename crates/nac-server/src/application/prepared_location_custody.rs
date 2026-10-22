//! Original Native filesystem/host resources for the actual preparation owner.
//! No authority is created from a location fact, a Ready row or this container.
use crate::{
    managed_status::{managed_binding_snapshot, ManagedBindingSnapshot},
    ManagedLocationFact, ManagedLocationResolution, SessionManager,
};
use anyhow::{ensure, Result};
use nac_core::session_service::AdmittedSessionPublication;
use std::sync::atomic::{AtomicBool, Ordering};

/// Move this same allocation into the genuine preparation/publication owner.
/// It must be captured before preparation, not reconstructed after an effect.
/// Host replacement exclusion and directory handles are distinct from Core's
/// source reservation, capacity holds and authenticated terminal settlement.
pub(crate) struct PreparedLocationCustody {
    // Preserve the supplied original directory allocation; no file reopening
    // supplies a replacement owner after a refusal.
    location: ManagedLocationResolution,
    host: ManagedBindingSnapshot,
    store_path: std::path::PathBuf,
    // The serving root retains this owner. A strong back-reference would form
    // a cycle when resources move into its active/unknown custody registry.
    original_manager: std::sync::Weak<crate::SessionManagerInner>,
    configured_location: Option<super::configured_working_locations::ConfiguredLocationCustody>,
    denied: AtomicBool,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "actual admitted preparation factory is not installed"
    )
)]
impl PreparedLocationCustody {
    pub(crate) async fn retain(
        manager: &SessionManager,
        location: ManagedLocationResolution,
    ) -> Result<Self> {
        location.check_directories_current()?;
        // This guard is the actual existing replacement file lease. It is not
        // a new readiness grant, upstream source lease or operation clock.
        let host = managed_binding_snapshot(manager.clone()).await?;
        ensure!(host.store_ready, "native store is not serving");
        ensure!(
            host.binding == location.fact().binding,
            "native host resource binding changed"
        );
        let retained = Self {
            location,
            host,
            store_path: manager.inner.store_path.clone(),
            original_manager: std::sync::Arc::downgrade(&manager.inner),
            configured_location: None,
            denied: AtomicBool::new(false),
        };
        retained.check_outside_store(manager)?;
        Ok(retained)
    }

    pub(crate) fn fact(&self) -> &ManagedLocationFact {
        self.location.fact()
    }

    pub(super) fn with_configured_location(
        mut self,
        configured: super::configured_working_locations::ConfiguredLocationCustody,
    ) -> Self {
        self.configured_location = Some(configured);
        self
    }

    /// Pair the actual prepared service with resources captured before prep.
    /// This only vetoes a mismatch: it cannot establish that earlier capture
    /// occurred or replace the genuine factory's retained owner. Call outside
    /// SQLite/credential locks; the snapshot read may await and names reopen.
    pub(crate) async fn verify_prepared(
        &self,
        manager: &SessionManager,
        admitted: &AdmittedSessionPublication,
    ) -> Result<()> {
        let checked = async {
            self.check_outside_store(manager)?;
            admitted.check_current()?;
            ensure!(
                admitted.store_path().as_os_str() == self.store_path.as_os_str(),
                "prepared runtime resource store mismatch"
            );
            ensure!(
                admitted.project_id()
                    == self
                        .fact()
                        .project
                        .as_ref()
                        .map(|project| project.project_id.as_str()),
                "prepared runtime resource project mismatch"
            );
            let cwd = admitted.local_working_directory().await?;
            ensure!(
                cwd.as_os_str() == self.fact().canonical_cwd.as_os_str(),
                "prepared runtime resource directory mismatch"
            );
            self.check_outside_store(manager)?;
            admitted.check_current()
        }
        .await;
        if checked.is_err() {
            self.deny();
            admitted.retirement().retire();
        }
        checked
    }

    /// Opens filesystem names. The genuine owner calls this outside all SQLite
    /// and credential locks, before entering a prepared effect boundary. Its
    /// bounded in-memory denial observation can be used inside those locks.
    pub(crate) fn check_outside_store(&self, manager: &SessionManager) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            ensure!(
                manager.inner.store_path == self.store_path,
                "native resource store changed"
            );
            ensure!(
                manager.managed_location_binding()? == self.host.binding,
                "native running host binding changed"
            );
            self.location.check_directories_current()?;
            if let Some(configured) = &self.configured_location {
                configured.check_current(manager)?;
            }
            self.check_denial()
        })();
        if checked.is_err() {
            self.deny();
        }
        checked
    }

    pub(crate) fn check_denial(&self) -> Result<()> {
        if self.original_manager.strong_count() == 0 {
            self.deny();
        }
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "native resource owner denied"
        );
        if let Some(configured) = &self.configured_location {
            configured.check_denial()?;
        }
        Ok(())
    }

    /// Denial never releases real host/directory resources or establishes
    /// cleanup. They remain in this same owner through original settlement.
    pub(crate) fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
}

// Resource-only outward adapter. The genuine factory moves this SAME owner by
// value into its custody; these vetoes never issue consumed/source authority.
impl nac_core::runtime::PreparationResourceCustody for PreparedLocationCustody {
    fn check_outside_store(&self) -> Result<()> {
        let Some(inner) = self.original_manager.upgrade() else {
            self.deny();
            anyhow::bail!("original Native serving owner ended");
        };
        PreparedLocationCustody::check_outside_store(self, &SessionManager { inner })
    }

    fn check_denial(&self) -> Result<()> {
        PreparedLocationCustody::check_denial(self)
    }

    fn deny(&self) {
        PreparedLocationCustody::deny(self);
    }
}

#[cfg(all(test, unix))]
mod tests;
