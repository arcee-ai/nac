//! Inward ownership port for resources captured before protected preparation.
//!
//! Delivery adapters move their original concrete allocation into this port;
//! Core must not depend on their filesystem or managed-host transport types.
use anyhow::Result;

/// Resource custody only, never authenticated admission or execution authority.
///
/// An adapter owns the same directory/host allocation captured before the first
/// preparation effect, together with the context needed to revalidate it. Move
/// that adapter by value into the compound owner as a boxed trait object. Do not
/// recapture resources after preparation or replace the original allocation.
///
/// A successful check cannot issue a publication, boundary or effect permit.
/// The private production factory must independently retain the real consumed
/// lifecycle/source authority and runtime/capacity owners. This port supplies no
/// constructor, grant, settlement proof or release operation.
///
/// The actual compound owner must retain this same allocation through accepted
/// work and unknown outcomes until authenticated terminal settlement. Denial,
/// a local error, publication completion or dropping an observation is not such
/// settlement. This port does not establish that any effect has stopped.
pub trait PreparationResourceCustody: Send + Sync {
    /// Revalidate original resource identity and names before an effect.
    /// May perform filesystem I/O; call outside SQLite and credential locks.
    /// Failure must permanently latch denial on this same allocation.
    fn check_outside_store(&self) -> Result<()>;

    /// Bounded in-memory veto only, suitable inside existing locked stages.
    /// Must not open files, acquire a database transaction or perform remote I/O.
    fn check_denial(&self) -> Result<()>;

    /// Permanently veto future effects while retaining the original resources.
    /// Must be bounded and must not release, replace or settle resource custody.
    fn deny(&self);
}
