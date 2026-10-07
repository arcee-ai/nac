//! One delivered original owns existing-session construction and later run admission.
use super::*;
use std::sync::Arc;

/// Sealed, noncloneable pending run admission. Only the guarded existing-session
/// factory creates it; identifiers, bindings and stored observations cannot.
/// Delivery must already match the actual canonical request to this session.
pub struct RuntimeRunAdmission {
    pub(crate) guard: Arc<ManagedRuntimeLeaseGuard>,
    pub(crate) session_id: String,
    pub(crate) operation_lease: Option<sessions::SessionOperationLease>,
}

impl RuntimeRunAdmission {
    pub(crate) async fn check_initial(&self, path: &Path, session_id: &str) -> Result<()> {
        anyhow::ensure!(
            self.session_id == session_id,
            "runtime run admission target mismatch"
        );
        self.operation_lease
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("runtime run admission already consumed"))?
            .validate(path, session_id)?;
        self.guard.check().await?;
        self.guard.check_initial_admission_now()
    }
}

impl Drop for RuntimeRunAdmission {
    fn drop(&mut self) {
        // Lost delivery or failed/finished original run can never become a
        // second admission. This does not destroy the existing durable session.
        self.guard.deny_now();
    }
}
