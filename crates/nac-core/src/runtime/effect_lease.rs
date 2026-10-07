//! Inward per-call lease port, independent of host keys, provider and transport.
use std::{future::Future, pin::Pin, sync::Arc};

pub type RuntimeEffectLeaseHandle = Arc<dyn RuntimeEffectLease>;

/// Selected mediated execution must require this port; absent authority must
/// never fall back to standalone behavior. Final synchronous checks also run
/// after waits, immediately at credential/send/mutation/output boundaries.
/// Implementations are operation scoped and never revoke the global host key.
pub trait RuntimeEffectLease: Send + Sync {
    fn check_available(&self) -> anyhow::Result<()>;
    fn check_current(&self) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + '_>>;
    fn wait_for_denial(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}
