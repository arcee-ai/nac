//! Original authenticated CREATE carriage, distinct from cleanup ACK carriage.
use crate::{
    control_exchange::{BoundExchange, ExchangeStart},
    AuthenticatedPeer, IssuerView, ServingCurrentness, MAX_CREATE_BODY_BYTES,
};
use anyhow::Result;
use std::time::Instant;
use uuid::Uuid;

/// Original pre-body acceptance budget. Neither cloneable nor decodable.
pub struct CreateExchangeStart(ExchangeStart);
impl AuthenticatedPeer {
    /// Reserve one actual CREATE-enrolled connection before body IO. No retry
    /// or later deadline renews this original operation budget.
    pub fn begin_create(
        &self,
        request_id: Uuid,
        original_expiry_epoch_ms: i64,
    ) -> Result<CreateExchangeStart> {
        self.begin_control_exchange(request_id, original_expiry_epoch_ms)
            .map(CreateExchangeStart)
    }
}
impl CreateExchangeStart {
    pub fn original_cutoff(&self) -> Instant {
        self.0.original_cutoff()
    }
    pub fn original_expiry_epoch_ms(&self) -> i64 {
        self.0.original_expiry_epoch_ms()
    }
    pub fn bind_body(self, payload: Box<[u8]>) -> Result<CreateExchange> {
        self.0
            .bind_body(payload, MAX_CREATE_BODY_BYTES)
            .map(CreateExchange)
    }
}
/// Authenticated immutable carriage from one actual enrolled TLS exchange.
/// This is NOT Core admission, AFM PG custody, or a terminal settlement receipt.
/// Only Core's concrete verifier consumes it with local source/resources.
/// ```compile_fail
/// use nac_runtime_auth::CreateExchange;
/// let _ = CreateExchange {};
/// ```
/// ```compile_fail
/// use nac_runtime_auth::CreateExchange;
/// fn cloneable<T: Clone>() {}
/// cloneable::<CreateExchange>();
/// ```
/// ```compile_fail
/// fn serialize(value: &nac_runtime_auth::CreateExchange) {
///     let _ = serde_json::to_vec(value);
/// }
/// ```
pub struct CreateExchange(BoundExchange);
impl CreateExchange {
    pub fn payload(&self) -> &[u8] {
        self.0.payload()
    }
    pub fn request_id(&self) -> Uuid {
        self.0.request_id()
    }
    pub fn original_cutoff(&self) -> Instant {
        self.0.original_cutoff()
    }
    pub fn original_expiry_epoch_ms(&self) -> i64 {
        self.0.original_expiry_epoch_ms()
    }
    pub fn issuer(&self) -> IssuerView {
        self.0.issuer()
    }
    pub fn check_current(&self) -> Result<()> {
        self.0.check_current()
    }
    /// Negative-only veto, never settlement or unresolved resource release.
    pub fn deny(&self) {
        self.0.deny();
    }
    pub fn serving_currentness(&self) -> ServingCurrentness {
        self.0.serving_currentness()
    }
    pub async fn invalidated(&self) {
        self.0.invalidated().await;
    }
}
