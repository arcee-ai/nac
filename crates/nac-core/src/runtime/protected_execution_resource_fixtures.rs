//! Capacity-only cross-crate fixtures, available only with `test-support`.
//! These resources cannot construct a Boundary, Ready/source/effect/backend
//! capability or a production host/session issuer. A RAW cleanup success here
//! accounts for a test's storage only; it never qualifies that RAW implementation.
use super::{
    BoundaryAdmission, CompartmentResourceDeclaration, CompartmentStorageHold, HostAdmission,
    ScopeLimits, SessionAdmission,
};
use crate::runtime::{CompartmentFuture, ExecutionCompartmentTransport};
use anyhow::Result;
use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex},
    time::Instant,
};

/// Explicit fixture policy; no numeric defaults or serialized selectors.
#[derive(Clone, Copy)]
pub struct FixtureScopeLimits {
    pub endpoints: usize,
    pub live_jobs: usize,
    pub native_payload_bytes: usize,
    pub captured_results: usize,
    pub captured_bytes: usize,
}
impl From<FixtureScopeLimits> for ScopeLimits {
    fn from(limits: FixtureScopeLimits) -> Self {
        Self {
            endpoints: limits.endpoints,
            live_jobs: limits.live_jobs,
            native_payload_bytes: limits.native_payload_bytes,
            captured_results: limits.captured_results,
            captured_bytes: limits.captured_bytes,
        }
    }
}

pub struct FixtureHost(Arc<HostAdmission>);
pub struct FixtureSession(Arc<SessionAdmission>);
pub struct FixtureReservation {
    admission: BoundaryAdmission,
    cutoff: Mutex<Option<Instant>>,
}

impl FixtureHost {
    pub fn new(limits: FixtureScopeLimits, max_sessions: NonZeroUsize) -> Self {
        Self(HostAdmission::new(limits.into(), max_sessions))
    }
    /// Every returned scope shares this exact host owner; labels cannot rebind it.
    pub fn session(&self, limits: FixtureScopeLimits) -> Result<FixtureSession> {
        self.0.session(limits.into()).map(FixtureSession)
    }
}
impl FixtureSession {
    /// Call before the first channel/driver/task is created. After this returns,
    /// a partial failure needs an independently retained cleanup owner. Dropping
    /// the fixture reservation without a confirmed join keeps its charge parked.
    pub fn reserve_endpoint(
        &self,
        declaration: CompartmentResourceDeclaration,
    ) -> Result<(FixtureReservation, CompartmentStorageHold)> {
        let (admission, hold) = self.0.reserve_endpoint(declaration)?.begin();
        Ok((
            FixtureReservation {
                admission,
                cutoff: Mutex::new(None),
            },
            hold,
        ))
    }
    /// Probe using a known no-start preparation. No storage token escapes and
    /// dropping this temporary preparation rolls back both scopes atomically.
    pub fn probe_endpoint(&self, declaration: CompartmentResourceDeclaration) -> Result<()> {
        drop(self.0.reserve_endpoint(declaration)?);
        Ok(())
    }
}
impl FixtureReservation {
    /// Forward the original cutoff at call time, even if this future is never
    /// polled. Only the awaited successful RAW cleanup sets the private join
    /// latch. Failure/cancellation/Drop cannot set it or renew the deadline.
    /// The actual Native pool and all escaping storage holds must retire too.
    pub fn close_and_reap<'a>(
        &'a self,
        transport: &'a dyn ExecutionCompartmentTransport,
        original_deadline: Instant,
    ) -> CompartmentFuture<'a, ()> {
        let cutoff = {
            let mut retained = self
                .cutoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let cutoff = retained.map_or(original_deadline, |old| old.min(original_deadline));
            *retained = Some(cutoff);
            cutoff
        };
        let cleanup = transport.close_and_reap(cutoff);
        Box::pin(async move {
            cleanup.await?;
            let retained = self
                .cutoff
                .lock()
                .map_err(|_| anyhow::anyhow!("fixture cleanup cutoff unavailable"))?;
            anyhow::ensure!(
                retained.is_some_and(|deadline| Instant::now() < deadline),
                "fixture cleanup original cutoff expired"
            );
            // Validate and publish under the same lock as cutoff updates.
            // This private atomic store invokes no RAW/owner callbacks.
            self.admission.joined();
            drop(retained);
            Ok(())
        })
    }
}

#[cfg(test)]
#[path = "protected_execution_resource_fixture_tests.rs"]
mod tests;
