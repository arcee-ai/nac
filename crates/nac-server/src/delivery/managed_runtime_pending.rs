//! Local borrowed observation; no current-policy proof or operation grant.
use super::*;
use nac_core::store::{PendingRuntimeChallenge, RuntimeLeaseClock, StoreCoordinator};

impl IssuerControlDialog {
    /// Retain the actual dialog, actual initial Pending and selected store across
    /// waits. A replacement connection cannot adopt the old Pending channel.
    pub(crate) async fn initial_pending_available(
        &self,
        pending: &PendingRuntimeChallenge,
        store: &StoreCoordinator,
    ) -> Result<bool> {
        let peer = self.peer();
        peer.check_live()?;
        if !pending.is_initial_for_channel(peer.channel_id()) {
            return Ok(false);
        }
        let clock = RuntimeLeaseClock::capture()?;
        let available = tokio::select! {
            biased;
            () = peer.wait_for_close() => bail!("issuer control channel unavailable"),
            observed = store.check_managed_runtime_initial_pending(pending, clock) => observed?,
        };
        peer.check_live()?;
        Ok(available && pending.is_initial_for_channel(peer.channel_id()))
    }
}

#[cfg(test)]
#[path = "managed_runtime_pending_tests.rs"]
mod tests;
