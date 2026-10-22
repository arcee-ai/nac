//! Actual consuming application join, not an envelope-to-admission factory.
//! Root registers this pending output before start; errors retain every owner.
use super::{
    create_transfer::CreateTransferAttempt, managed_create_request::ValidatedManagedCreateRequest,
    prepared_location_custody::PreparedLocationCustody,
    session_creation::SessionCreationApplication,
};
use anyhow::{ensure, Result};
use nac_core::{
    runtime::{CreateFactoryOwner, PreparationResourceCustody},
    session_service::AdmittedSessionPublication,
};
use std::sync::Arc;

pub(crate) struct ManagedCreateProducerOutput {
    parts: Option<Parts>,
    attempted: bool,
}
struct Parts {
    admitted: AdmittedSessionPublication,
    factory: Arc<CreateFactoryOwner>,
    location: Arc<PreparedLocationCustody>,
    execution: Box<dyn PreparationResourceCustody>,
    request: ValidatedManagedCreateRequest,
}
impl ManagedCreateProducerOutput {
    /// Opaque Core output is mandatory. No DTO, receipt, bool or callback may
    /// manufacture it. Move actual outputs into this pending owner before checks.
    pub(crate) fn retain(
        admitted: AdmittedSessionPublication,
        factory: Arc<CreateFactoryOwner>,
        location: Arc<PreparedLocationCustody>,
        execution: Box<dyn PreparationResourceCustody>,
        request: ValidatedManagedCreateRequest,
    ) -> Self {
        Self {
            parts: Some(Parts {
                admitted,
                factory,
                location,
                execution,
                request,
            }),
            attempted: false,
        }
    }
    pub(crate) fn start(
        &mut self,
        application: &SessionCreationApplication<'_>,
    ) -> Result<CreateTransferAttempt> {
        let result = self.start_inner(application);
        if result.is_err() {
            if let Some(parts) = &self.parts {
                parts.admitted.retirement().retire();
            }
        }
        result
    }
    fn start_inner(
        &mut self,
        application: &SessionCreationApplication<'_>,
    ) -> Result<CreateTransferAttempt> {
        ensure!(
            !std::mem::replace(&mut self.attempted, true),
            "Managed CREATE output already attempted"
        );
        let parts = self
            .parts
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Managed CREATE output moved"))?;
        parts.admitted.check_prepared_create_for(&parts.factory)?;
        parts
            .request
            .check_prepared(application.manager, &parts.admitted)
            .map_err(|_| anyhow::anyhow!("Managed CREATE original request changed"))?;
        let native = parts.factory.binding();
        let request = parts.request.binding();
        ensure!(
            native.operation_id == request.operation_id
                && i64::try_from(native.claim_sequence)? == request.claim_sequence
                && native.session_id == request.intended_session_id.to_string()
                && native.intent_sha256 == request.intent_sha256
                && native.configuration_sha256 == request.configuration_sha256,
            "Managed CREATE original producer binding differs"
        );
        let parts = self.parts.take().expect("original checked pending output");
        // Existing method installs original serving transfer custody before
        // spawn/await. It alone performs persistence/cache/lifecycle publication
        // and issues the terminal half; this caller reconstructs no terminal.
        Ok(application.start_bound_admitted_create_transfer(
            parts.admitted,
            parts.factory,
            parts.location,
            parts.execution,
            parts.request,
        ))
    }
}
impl Drop for ManagedCreateProducerOutput {
    fn drop(&mut self) {
        if let Some(parts) = &self.parts {
            parts.admitted.retirement().retire();
        }
        // Root drain still owns real execution/location cleanup. This Drop is
        // denial, not proof of physical cleanup or permission to release claims.
    }
}
