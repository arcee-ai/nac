//! Owned preparation input; positive admission awaits the actual participant protocol.
use super::AdmittedSessionPublication;
use crate::runtime::PreparationResourceCustody;

/// A refusal is not a runtime, release receipt or authenticated settlement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtectedPreparationRefusal {
    ResourceDenied,
    ParticipantProtocolUnavailable,
}
impl std::fmt::Display for ProtectedPreparationRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::ResourceDenied => "protected preparation resource custody denied",
            Self::ParticipantProtocolUnavailable => {
                "protected preparation requires the original consumed participant protocol"
            }
        })
    }
}
impl std::error::Error for ProtectedPreparationRefusal {}

/// Moves the original location/host and execution/process allocations into Core
/// before preparation. This nonclone, nonserializable input carries resources,
/// never lifecycle, source, Ready, capacity admission or effect authority.
///
/// The application's original terminal owner must retain this same input while
/// any outcome is unknown. Errors borrow this owner rather than consuming it;
/// discarding a refusal does not drop either original resource allocation.
/// Dropping the input is not a settlement operation or proof that work stopped.
///
/// The accepted operation-scoped participant custody type is not implemented
/// upstream. Until it exists, `try_prepare_create` always refuses, without a
/// store reservation, runtime construction or call to the ordinary builder.
/// No identity projection, callback or resource check can enable its success.
pub struct ProtectedPreparationInput {
    location: Box<dyn PreparationResourceCustody>,
    execution: Box<dyn PreparationResourceCustody>,
    refusal: Option<ProtectedPreparationRefusal>,
}
impl ProtectedPreparationInput {
    /// Resource ownership only. Both supplied allocations must have been
    /// captured before the first protected preparation effect, not reconstructed.
    pub fn new(
        location: Box<dyn PreparationResourceCustody>,
        execution: Box<dyn PreparationResourceCustody>,
    ) -> Self {
        Self {
            location,
            execution,
            refusal: None,
        }
    }

    /// Physical revalidation for the private factory, outside SQLite locks.
    pub(crate) fn check_outside_store(&self) -> anyhow::Result<()> {
        self.location.check_outside_store()?;
        self.execution.check_outside_store()?;
        self.check_denial()
    }
    pub(crate) fn check_denial(&self) -> anyhow::Result<()> {
        anyhow::ensure!(self.refusal.is_none(), "preparation input already refused");
        self.location.check_denial()?;
        self.execution.check_denial()
    }
    pub(crate) fn deny(&self) {
        self.location.deny();
        self.execution.deny();
    }

    /// Production caller seam, currently fail-closed on the missing typed
    /// participant input. Run outside SQLite/credential locks: the first checks
    /// perform physical revalidation. Recheck bounded vetoes afterward.
    ///
    /// A refusal permanently denies this input and retains both allocations.
    /// The real factory must consume the original authenticated participant and
    /// boundary/effect owners before it can call the private publication issuer.
    /// This method neither fabricates those types nor wraps an already-prepared
    /// ordinary runtime. It deliberately has no positive constructor path.
    pub fn try_prepare_create(
        &mut self,
    ) -> Result<AdmittedSessionPublication, ProtectedPreparationRefusal> {
        if let Some(refusal) = self.refusal {
            return Err(refusal);
        }
        let current = self
            .location
            .check_outside_store()
            .and_then(|()| self.execution.check_outside_store())
            .and_then(|()| self.location.check_denial())
            .and_then(|()| self.execution.check_denial());
        let refusal = if current.is_err() {
            ProtectedPreparationRefusal::ResourceDenied
        } else {
            ProtectedPreparationRefusal::ParticipantProtocolUnavailable
        };
        self.refusal = Some(refusal);
        self.location.deny();
        self.execution.deny();
        Err(refusal)
    }
}
impl Drop for ProtectedPreparationInput {
    fn drop(&mut self) {
        self.location.deny();
        self.execution.deny();
    }
}

#[cfg(test)]
#[path = "protected_preparation_tests.rs"]
mod tests;
