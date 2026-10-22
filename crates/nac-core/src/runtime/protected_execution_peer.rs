//! Actual kernel-peer retention, separate from Root and isolation qualification.
use super::ExecutionCompartmentTransport;
#[cfg(unix)]
use anyhow::ensure;
use anyhow::Result;
use std::time::Instant;

pub(super) enum BoundaryPeer {
    #[cfg(unix)]
    Captured(nac_process::peer_channel::PeerLifetime),
    // Only Core unit tests can substitute a synthetic owner. There is no
    // production/test-support constructor from metadata or a liveness callback.
    #[cfg(test)]
    Synthetic,
    #[cfg(not(unix))]
    #[expect(dead_code, reason = "protected peer construction is unavailable here")]
    Unsupported,
}

impl BoundaryPeer {
    pub(super) async fn invalidated(&self) {
        match self {
            #[cfg(unix)]
            Self::Captured(peer) => peer.invalidated().await,
            #[cfg(test)]
            Self::Synthetic => std::future::pending().await,
            #[cfg(not(unix))]
            Self::Unsupported => {}
        }
    }

    pub(super) fn check(&self, _transport: &dyn ExecutionCompartmentTransport) -> Result<()> {
        match self {
            #[cfg(unix)]
            Self::Captured(peer) => {
                peer.check_current()?;
                ensure!(
                    _transport.peer_binding().as_ref() == Some(&peer.binding()),
                    "protected execution peer association unavailable"
                );
                peer.check_current()?;
                Ok(())
            }
            #[cfg(test)]
            Self::Synthetic => Ok(()),
            #[cfg(not(unix))]
            Self::Unsupported => anyhow::bail!("protected execution peer unavailable"),
        }
    }

    pub(super) fn cutoff(&self, source: Instant) -> Instant {
        match self {
            #[cfg(unix)]
            Self::Captured(peer) => source.min(peer.original_cutoff()),
            #[cfg(test)]
            Self::Synthetic => source,
            #[cfg(not(unix))]
            Self::Unsupported => source,
        }
    }

    pub(super) fn deny(&self) {
        match self {
            #[cfg(unix)]
            Self::Captured(peer) => peer.deny(),
            #[cfg(test)]
            Self::Synthetic => {}
            #[cfg(not(unix))]
            Self::Unsupported => {}
        }
    }
}

impl Drop for BoundaryPeer {
    fn drop(&mut self) {
        self.deny();
    }
}
