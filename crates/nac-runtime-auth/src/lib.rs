//! Actual enrolled TLS transport and its original resource lifetimes.
//!
//! This crate issues authenticated carriage, never Core operation admission.
//! Native delivery owns HTTP; Core independently verifies the purpose payload,
//! current sources, local reservations, policy, and execution resources.
mod ack_exchange;
mod control_exchange;
mod exchange;
mod identity;
mod listener;
mod state;
mod stream;

pub use ack_exchange::{CreateAckExchange, CreateAckExchangeStart};
pub use exchange::{CreateExchange, CreateExchangeStart};
pub use identity::RuntimeTlsIdentity;
pub use listener::RuntimeTlsAcceptor;
pub use state::{AuthenticatedPeer, IssuerView, ServingCurrentness};
pub use stream::AuthenticatedStream;

/// Existing private protocol purpose. This is not a grant or another codec.
pub const CREATE_PURPOSE: &str = "managed-session-create.v1";
pub const MAX_CREATE_BODY_BYTES: usize = 2 * 1024 * 1024;
pub const CREATE_ACK_PURPOSE: &str = "managed-session-create-ack.v1";
pub const MAX_CREATE_ACK_BODY_BYTES: usize = 32 * 1024;

#[cfg(test)]
mod tests;
