//! Shared views of the SAME original location/execution allocations. These
//! resource vetoes cannot issue Core/Native admission or an effect permit.
use super::prepared_location_custody::PreparedLocationCustody;
use nac_core::{runtime::PreparationResourceCustody, session_service::ProtectedPreparationInput};
use std::sync::Arc;

pub(super) struct ManagedCreateResources {
    location: Arc<PreparedLocationCustody>,
    execution: Arc<dyn PreparationResourceCustody>,
}
impl ManagedCreateResources {
    /// Consume actual owners captured before preparation, never facts/receipts.
    pub(super) fn retain(
        location: PreparedLocationCustody,
        execution: Arc<dyn PreparationResourceCustody>,
    ) -> Self {
        Self {
            location: Arc::new(location),
            execution,
        }
    }
    pub(super) fn preparation(&self) -> ProtectedPreparationInput {
        ProtectedPreparationInput::new(
            Box::new(ResourceView(Arc::clone(&self.location))),
            Box::new(ResourceView(Arc::clone(&self.execution))),
        )
    }
    pub(super) fn publication(
        &self,
    ) -> (
        Arc<PreparedLocationCustody>,
        Box<dyn PreparationResourceCustody>,
    ) {
        (
            Arc::clone(&self.location),
            Box::new(ResourceView(Arc::clone(&self.execution))),
        )
    }
}
// Clone only the pointer to an existing resource owner, with all checks and
// denial forwarded to it. No configurable predicate or positive constructor.
struct ResourceView<T: PreparationResourceCustody + ?Sized>(Arc<T>);
impl<T: PreparationResourceCustody + ?Sized> PreparationResourceCustody for ResourceView<T> {
    fn check_outside_store(&self) -> anyhow::Result<()> {
        self.0.check_outside_store()
    }
    fn check_denial(&self) -> anyhow::Result<()> {
        self.0.check_denial()
    }
    fn deny(&self) {
        self.0.deny();
    }
}
