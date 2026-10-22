//! Explicit capacity data for a future closed construction owner.
//!
//! Validation establishes only completeness and machine representability. It
//! does not authenticate a policy source, select values, establish a lifetime,
//! construct a ledger, or issue any runtime/publication capability. The actual
//! policy source/revision/retirement contract is still unselected.
use super::ScopeLimits;
use anyhow::{Context, Result};
use std::num::NonZeroUsize;

/// Internal ingestion shape, not a wire DTO or public configuration format.
/// Missing fields must refuse rather than inherit unrelated resource defaults.
#[derive(Clone, Copy)]
pub(super) struct ScopeCapacityInput {
    pub endpoints: Option<u64>,
    pub live_jobs: Option<u64>,
    pub native_payload_bytes: Option<u64>,
    pub captured_results: Option<u64>,
    pub captured_bytes: Option<u64>,
}

/// Session means one ledger allocation. Mapping product-session generations
/// and physical endpoints onto those allocations remains construction policy.
pub(super) struct CapacityInput {
    pub host: Option<ScopeCapacityInput>,
    pub session: Option<ScopeCapacityInput>,
    pub max_sessions: Option<u64>,
}

/// Still data, never a trusted policy or admission token. In particular this
/// type has no constructor for HostAdmission or any positive execution owner.
pub(super) struct ValidatedCapacityInput {
    pub host: ScopeLimits,
    pub session: ScopeLimits,
    pub max_sessions: NonZeroUsize,
}

fn required(value: Option<u64>, scope: &str, dimension: &str) -> Result<usize> {
    let value = value.with_context(|| format!("missing protected {scope} {dimension}"))?;
    usize::try_from(value)
        .with_context(|| format!("protected {scope} {dimension} exceeds machine capacity"))
}

impl ScopeCapacityInput {
    fn validate(self, scope: &str) -> Result<ScopeLimits> {
        Ok(ScopeLimits {
            endpoints: required(self.endpoints, scope, "endpoints")?,
            live_jobs: required(self.live_jobs, scope, "live_jobs")?,
            native_payload_bytes: required(
                self.native_payload_bytes,
                scope,
                "native_payload_bytes",
            )?,
            captured_results: required(self.captured_results, scope, "captured_results")?,
            captured_bytes: required(self.captured_bytes, scope, "captured_bytes")?,
        })
    }
}

impl CapacityInput {
    pub(super) fn validate(self) -> Result<ValidatedCapacityInput> {
        let host = self
            .host
            .context("missing protected host capacity")?
            .validate("host")?;
        let session = self
            .session
            .context("missing protected session capacity")?
            .validate("session")?;
        let max_sessions = NonZeroUsize::new(required(self.max_sessions, "host", "max_sessions")?)
            .context("protected max_sessions must be nonzero")?;
        // A zero dimension is an explicit refusal ceiling, not missing policy.
        // Host and session ceilings are independent. Their reservations enforce
        // the aggregate atomically; do not multiply per-session ceilings here.
        Ok(ValidatedCapacityInput {
            host,
            session,
            max_sessions,
        })
    }
}

#[cfg(test)]
#[path = "protected_capacity_input_tests.rs"]
mod tests;
