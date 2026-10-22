//! Actual postcommit ACK carriage. It cannot prepare CREATE or grant retirement.
use crate::{
    control_exchange::{BoundExchange, ExchangeStart},
    AuthenticatedPeer, IssuerView, MAX_CREATE_ACK_BODY_BYTES,
};
use anyhow::Result;
use std::time::Instant;
use uuid::Uuid;

/// A separate cleanup budget from a real CREATE-enrolled peer. Captured before
/// body IO; it never renews any earlier CREATE/runtime eligibility window.
pub struct CreateAckExchangeStart(ExchangeStart);
impl AuthenticatedPeer {
    pub fn begin_create_ack(
        &self,
        operation_id: Uuid,
        original_expiry_epoch_ms: i64,
    ) -> Result<CreateAckExchangeStart> {
        self.begin_control_exchange(operation_id, original_expiry_epoch_ms)
            .map(CreateAckExchangeStart)
    }
}
impl CreateAckExchangeStart {
    pub fn original_cutoff(&self) -> Instant {
        self.0.original_cutoff()
    }
    pub fn original_expiry_epoch_ms(&self) -> i64 {
        self.0.original_expiry_epoch_ms()
    }
    pub fn bind_body(self, payload: Box<[u8]>) -> Result<CreateAckExchange> {
        self.0
            .bind_body(payload, MAX_CREATE_ACK_BODY_BYTES)
            .map(CreateAckExchange)
    }
}
/// Nonclone, nonserializable immutable bytes from the original ACK connection.
/// Core still verifies the original factory/source/qualified terminal and actual
/// preparation retirement; this value alone proves neither COMMIT nor release.
/// ```compile_fail
/// let _ = nac_runtime_auth::CreateAckExchange {};
/// ```
/// ```compile_fail
/// fn cloneable<T: Clone>() {}
/// cloneable::<nac_runtime_auth::CreateAckExchange>();
/// ```
/// ```compile_fail
/// fn serialize(value: &nac_runtime_auth::CreateAckExchange) {
///     let _ = serde_json::to_vec(value);
/// }
/// ```
/// ```compile_fail
/// fn prepare(_: nac_runtime_auth::CreateExchange) {}
/// fn cannot_prepare(ack: nac_runtime_auth::CreateAckExchange) { prepare(ack); }
/// ```
pub struct CreateAckExchange(BoundExchange);
impl CreateAckExchange {
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
    /// Denies this ACK only, never the original CREATE/runtime or its resources.
    pub fn deny(&self) {
        self.0.deny();
    }
    pub async fn invalidated(&self) {
        self.0.invalidated().await;
    }
}
