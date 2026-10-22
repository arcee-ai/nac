use anyhow::{ensure, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Weak,
};
use tokio::sync::Notify;
use uuid::Uuid;

/// Observations from this actual handshake and listener. Copying these values
/// cannot construct a peer, exchange, or serving owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IssuerView {
    pub client_leaf_sha256: [u8; 32],
    pub client_ca_sha256: [u8; 32],
    pub serving_leaf_sha256: [u8; 32],
    pub serving_incarnation: Uuid,
    pub connection_incarnation: Uuid,
}

#[derive(Debug)]
pub(crate) struct ServingState {
    pub live: AtomicBool,
    pub changed: Notify,
    pub incarnation: Uuid,
    pub serving_pin: [u8; 32],
    pub client_ca_pin: [u8; 32],
    pub create_issuer: bool,
}
impl ServingState {
    pub fn close(&self) {
        if self.live.swap(false, Ordering::AcqRel) {
            self.changed.notify_waiters();
        }
    }
}

#[derive(Debug)]
pub(crate) struct ConnectionState {
    pub serving: Weak<ServingState>,
    pub live: AtomicBool,
    pub create_started: AtomicBool,
    pub changed: Notify,
    pub issuer: IssuerView,
    pub process: u32,
}
impl ConnectionState {
    pub fn check(&self) -> Result<()> {
        ensure!(
            self.process == std::process::id() && self.live.load(Ordering::Acquire),
            "original authenticated connection ended"
        );
        ServingCurrentness(Weak::clone(&self.serving)).check_current()
    }
    pub fn close(&self) {
        if self.live.swap(false, Ordering::AcqRel) {
            self.changed.notify_waiters();
        }
    }
}

/// Weak observation of an actual accepted stream, never a metadata constructor.
#[derive(Clone, Debug)]
pub struct AuthenticatedPeer(pub(crate) Weak<ConnectionState>);
impl AuthenticatedPeer {
    pub fn check_current(&self) -> Result<()> {
        self.connection()?.check()
    }
    pub fn issuer(&self) -> Result<IssuerView> {
        let connection = self.connection()?;
        connection.check()?;
        Ok(connection.issuer)
    }
    pub fn create_enrolled(&self) -> Result<bool> {
        let connection = self.connection()?;
        connection.check()?;
        Ok(connection
            .serving
            .upgrade()
            .is_some_and(|state| state.create_issuer))
    }
    pub(crate) fn connection(&self) -> Result<Arc<ConnectionState>> {
        self.0
            .upgrade()
            .ok_or_else(|| anyhow::anyhow!("original authenticated stream unavailable"))
    }
}

/// Host/listener currentness only. It grants no operation or fresh human
/// eligibility, and normal completion of one HTTP exchange does not retire it.
#[derive(Clone, Debug)]
pub struct ServingCurrentness(pub(crate) Weak<ServingState>);
impl ServingCurrentness {
    pub fn check_current(&self) -> Result<()> {
        ensure!(
            self.0
                .upgrade()
                .is_some_and(|state| state.live.load(Ordering::Acquire)),
            "original authenticated serving owner ended"
        );
        Ok(())
    }
    pub async fn invalidated(&self) {
        let Some(state) = self.0.upgrade() else {
            return;
        };
        loop {
            let changed = state.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.check_current().is_err() {
                return;
            }
            changed.await;
        }
    }
}
