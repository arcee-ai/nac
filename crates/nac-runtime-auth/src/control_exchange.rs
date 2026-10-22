use crate::{
    state::ConnectionState, AuthenticatedPeer, IssuerView, ServingCurrentness,
    MAX_CREATE_BODY_BYTES,
};
use anyhow::{ensure, Result};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Notify;
use uuid::Uuid;

struct ExchangeState {
    connection: Arc<ConnectionState>,
    request_id: Uuid,
    original_cutoff: Instant,
    original_expiry_epoch_ms: i64,
    active: AtomicBool,
    changed: Notify,
}
impl ExchangeState {
    fn check(&self) -> Result<()> {
        let checked = (|| {
            self.connection.check()?;
            ensure!(
                self.active.load(Ordering::Acquire)
                    && Instant::now() < self.original_cutoff
                    && self
                        .original_expiry_epoch_ms
                        .checked_sub(utc_epoch_ms()?)
                        .is_some_and(|remaining| (1..=60_000).contains(&remaining)),
                "original control exchange ended"
            );
            Ok(())
        })();
        if checked.is_err() {
            self.deny();
        }
        checked
    }
    fn deny(&self) {
        if self.active.swap(false, Ordering::AcqRel) {
            self.changed.notify_waiters();
        }
    }
}
fn utc_epoch_ms() -> Result<i64> {
    Ok(i64::try_from(
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
    )?)
}

/// Original pre-body acceptance budget. It is neither cloneable nor decodable.
pub(super) struct ExchangeStart {
    state: Arc<ExchangeState>,
    armed: bool,
}
impl AuthenticatedPeer {
    /// Both typed control purposes require actual explicit CREATE enrollment.
    /// One accepted connection gets one attempt, captured before body IO.
    pub(super) fn begin_control_exchange(
        &self,
        request_id: Uuid,
        original_expiry_epoch_ms: i64,
    ) -> Result<ExchangeStart> {
        ensure!(!request_id.is_nil(), "control request identity is empty");
        let connection = self.connection()?;
        connection.check()?;
        ensure!(self.create_enrolled()?, "issuer is not enrolled for CREATE");
        let remaining = original_expiry_epoch_ms
            .checked_sub(utc_epoch_ms()?)
            .filter(|remaining| (1..=60_000).contains(remaining))
            .ok_or_else(|| anyhow::anyhow!("control expiry is invalid"))?;
        let original_cutoff = Instant::now() + Duration::from_millis(remaining as u64);
        ensure!(
            connection
                .create_started
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok(),
            "original connection control exchange already attempted"
        );
        Ok(ExchangeStart {
            state: Arc::new(ExchangeState {
                connection,
                request_id,
                original_cutoff,
                original_expiry_epoch_ms,
                active: AtomicBool::new(true),
                changed: Notify::new(),
            }),
            armed: true,
        })
    }
}
impl ExchangeStart {
    pub fn original_cutoff(&self) -> Instant {
        self.state.original_cutoff
    }
    pub fn original_expiry_epoch_ms(&self) -> i64 {
        self.state.original_expiry_epoch_ms
    }
    pub fn bind_body(mut self, payload: Box<[u8]>, max_body_bytes: usize) -> Result<BoundExchange> {
        ensure!(
            !payload.is_empty() && payload.len() <= max_body_bytes.min(MAX_CREATE_BODY_BYTES),
            "CREATE body size invalid"
        );
        self.state.check()?;
        let state = Arc::clone(&self.state);
        self.armed = false;
        Ok(BoundExchange { state, payload })
    }
}
impl Drop for ExchangeStart {
    fn drop(&mut self) {
        if self.armed {
            self.state.deny();
        }
    }
}

/// Private retained bytes and original control lifetime. Typed public wrappers
/// cannot be converted into one another. This carries no operation admission.
pub(super) struct BoundExchange {
    state: Arc<ExchangeState>,
    payload: Box<[u8]>,
}
impl BoundExchange {
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }
    pub fn request_id(&self) -> Uuid {
        self.state.request_id
    }
    pub fn original_cutoff(&self) -> Instant {
        self.state.original_cutoff
    }
    pub fn original_expiry_epoch_ms(&self) -> i64 {
        self.state.original_expiry_epoch_ms
    }
    pub fn issuer(&self) -> IssuerView {
        self.state.connection.issuer
    }
    pub fn check_current(&self) -> Result<()> {
        self.state.check()
    }
    /// Bounded veto only. Never releases an unresolved local/remote resource.
    pub fn deny(&self) {
        self.state.deny();
    }
    pub fn serving_currentness(&self) -> ServingCurrentness {
        ServingCurrentness(std::sync::Weak::clone(&self.state.connection.serving))
    }
    /// Observe original denial/EOF/serving loss/deadline without renewal.
    pub async fn invalidated(&self) {
        let Some(serving) = self.state.connection.serving.upgrade() else {
            return;
        };
        loop {
            let changed = self.state.changed.notified();
            let connection = self.state.connection.changed.notified();
            let host = serving.changed.notified();
            tokio::pin!(changed, connection, host);
            changed.as_mut().enable();
            connection.as_mut().enable();
            host.as_mut().enable();
            if self.check_current().is_err() {
                return;
            }
            tokio::select! {
                _ = changed => {},
                _ = connection => {},
                _ = host => {},
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(self.original_cutoff())) => {},
            }
        }
    }
}
impl Drop for BoundExchange {
    fn drop(&mut self) {
        self.state.deny();
    }
}
