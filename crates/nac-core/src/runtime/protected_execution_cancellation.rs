//! Denial only, bound to one actual boundary allocation rather than its labels.
use super::BoundaryState;
use std::sync::Weak;

/// Cloneable process-local denial only. It cannot reconstruct a boundary,
/// grant an effect, switch a backend or keep resources alive. Durable Root
/// denial and authenticated work settlement remain separate responsibilities.
///
/// ```compile_fail
/// use nac_core::runtime::ProtectedExecutionCancellation;
/// let _: ProtectedExecutionCancellation = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Clone)]
pub struct ProtectedExecutionCancellation {
    pub(super) state: Weak<BoundaryState>,
}

impl ProtectedExecutionCancellation {
    /// Permanently deny this whole owner and its original peer, waking pending
    /// Core waits. It does not establish that work stopped or settle a loan.
    /// A dropped owner makes cancellation an idempotent no-op.
    pub fn cancel(&self) {
        if let Some(state) = self.state.upgrade() {
            state.poison();
        }
    }
}
