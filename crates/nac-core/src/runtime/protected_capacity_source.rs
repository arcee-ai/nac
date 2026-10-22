//! Original policy and shared host accounting for paired Native construction.
//! These resources do not supply lifecycle, source or peer qualification.
use super::capacity_input::{CapacityInput, ScopeCapacityInput, ValidatedCapacityInput};
use super::{
    BoundaryAdmissions, CompartmentResourceDeclaration, CompartmentStorageHold,
    EndpointPreparation, HostAdmission,
};
use anyhow::Result;
use nac_capacity_policy::{PolicyOwner, PolicySource, ScopeLimits};
use std::sync::Arc;

/// Private source composition only. The eventual actual factory must also
/// retain the genuine original lifecycle/currentness owner and kernel resources.
/// A file, matching pins, a cutoff, or this data cannot supply those capabilities.
pub(in crate::runtime) struct RetainedCapacityInput {
    // Drop the unique owner first, denying all escaping views before retirement
    // of our local data/source storage. An Arc view never renews this owner.
    _owner: PolicyOwner,
    source: Arc<PolicySource>,
    data: ValidatedCapacityInput,
    pub(super) host: Arc<HostAdmission>,
}

fn input(scope: ScopeLimits) -> ScopeCapacityInput {
    ScopeCapacityInput {
        endpoints: Some(scope.endpoints),
        live_jobs: Some(scope.live_jobs),
        native_payload_bytes: Some(scope.native_payload_bytes),
        captured_results: Some(scope.captured_results),
        captured_bytes: Some(scope.captured_bytes),
    }
}

impl RetainedCapacityInput {
    pub(in crate::runtime) fn from_owner(owner: PolicyOwner) -> Result<Self> {
        let source = owner.source();
        let configuration = source.configuration()?;
        let data = CapacityInput {
            host: Some(input(configuration.host)),
            session: Some(input(configuration.session)),
            max_sessions: Some(configuration.max_sessions),
        }
        .validate()?;
        source.check_current()?;
        let host = HostAdmission::new(data.host, data.max_sessions);
        Ok(Self {
            _owner: owner,
            source,
            data,
            host,
        })
    }

    /// Checked data, not admission. The actual factory still has to bind the
    /// selected topology and retain/check the independent original lifecycle.
    pub(super) fn data(&self) -> Result<&ValidatedCapacityInput> {
        self.source.check_current()?;
        Ok(&self.data)
    }

    /// Bounded minimum only; physical policy checks belong outside store locks.
    pub(in crate::runtime) fn minimum_cutoff(
        &self,
        original: std::time::Instant,
    ) -> std::time::Instant {
        self.source.cutoff(original)
    }

    /// Reserve BOTH distinct endpoint allocations from one original session.
    /// Native must use a plan derived from source_view() and consume the exact
    /// declaration before its first allocation. No storage hold can escape
    /// until both reservations succeed. Errors roll back only this no-start path.
    pub(in crate::runtime) fn prepare_native_pair(
        self: &Arc<Self>,
        declaration: CompartmentResourceDeclaration,
    ) -> Result<PreparedNativePair> {
        let session = self.host.session(self.data()?.session)?;
        let client = session.reserve_endpoint(declaration)?;
        let runner = session.reserve_endpoint(declaration)?;
        self.source.check_current()?;
        Ok(PreparedNativePair {
            capacity: Arc::clone(self),
            client,
            runner,
        })
    }

    /// This same allocation is shared with Native's concrete plan. Callers must
    /// keep this original owner alive and independently observe source denial.
    pub(in crate::runtime) fn source_view(&self) -> Result<Arc<PolicySource>> {
        self.source.check_current()?;
        Ok(Arc::clone(&self.source))
    }
}

/// No-start owner. Dropping before begin restores both allocations. Begin is
/// the irreversible preparation boundary, before channels, drivers or processes.
pub(in crate::runtime) struct PreparedNativePair {
    capacity: Arc<RetainedCapacityInput>,
    client: EndpointPreparation,
    runner: EndpointPreparation,
}
impl PreparedNativePair {
    pub(in crate::runtime) fn begin(
        self,
    ) -> Result<(BoundaryAdmissions, [CompartmentStorageHold; 2])> {
        self.capacity.source.check_current()?;
        let (client, client_storage) = self.client.begin();
        let (runner, runner_storage) = self.runner.begin();
        Ok((
            BoundaryAdmissions::paired(client, runner, self.capacity)?,
            [client_storage, runner_storage],
        ))
    }
}

#[cfg(test)]
#[path = "protected_capacity_source_tests.rs"]
pub(in crate::runtime) mod tests;
