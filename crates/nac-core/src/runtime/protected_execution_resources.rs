//! Process-local aggregate accounting, separate from authority and retention.
//! The actual construction issuer is still private/uninstalled. Unknown cleanup
//! keeps its charge; a new ledger must never be used to restore a live owner.
#[path = "protected_capacity_input.rs"]
mod capacity_input;

#[cfg(unix)]
#[path = "protected_capacity_source.rs"]
pub(super) mod capacity_source;

use super::protected_execution_io::{CompartmentExit, CompartmentOutput};
use anyhow::{ensure, Context, Result};
use std::{
    num::NonZeroUsize,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

/// Immutable RAW capacity data, never proof of validation, isolation or cleanup.
/// Native must admit and consume the same private validated concrete plan. Its
/// checked payload calculation stays in Native; Core does not duplicate it or
/// describe it as a complete allocator/RSS bound. Both endpoints need a charge.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompartmentResourceDeclaration {
    live_jobs: NonZeroUsize,
    wire_records: NonZeroUsize,
    flow_window: NonZeroUsize,
    owned_input_bytes: usize,
    capture_bytes: usize,
    accounted_payload_bytes: NonZeroUsize,
}
impl CompartmentResourceDeclaration {
    pub fn from_raw_capacity(
        live_jobs: NonZeroUsize,
        wire_records: NonZeroUsize,
        flow_window: NonZeroUsize,
        owned_input_bytes: usize,
        capture_bytes: usize,
        accounted_payload_bytes: NonZeroUsize,
    ) -> Self {
        Self {
            live_jobs,
            wire_records,
            flow_window,
            owned_input_bytes,
            capture_bytes,
            accounted_payload_bytes,
        }
    }
    pub fn live_jobs(&self) -> NonZeroUsize {
        self.live_jobs
    }
    /// Records in each of the two physical queues, not their combined sum.
    pub fn wire_records(&self) -> NonZeroUsize {
        self.wire_records
    }
    pub fn flow_window(&self) -> NonZeroUsize {
        self.flow_window
    }
    pub fn owned_input_bytes(&self) -> usize {
        self.owned_input_bytes
    }
    pub fn capture_bytes(&self) -> usize {
        self.capture_bytes
    }
    pub fn accounted_payload_bytes(&self) -> NonZeroUsize {
        self.accounted_payload_bytes
    }
}

// Every capacity is explicit construction policy. Counts also bound zero-byte
// result/endpoint metadata; no retention, PTY or blocking-adapter cap is reused.
#[derive(Clone, Copy)]
pub(super) struct ScopeLimits {
    pub endpoints: usize,
    pub live_jobs: usize,
    pub native_payload_bytes: usize,
    pub captured_results: usize,
    pub captured_bytes: usize,
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
struct Usage {
    endpoints: usize,
    live_jobs: usize,
    native_payload_bytes: usize,
    captured_results: usize,
    captured_bytes: usize,
}
impl Usage {
    fn add(self, other: Self, limits: ScopeLimits) -> Result<Self> {
        let next = Self {
            endpoints: self
                .endpoints
                .checked_add(other.endpoints)
                .context("endpoint count overflow")?,
            live_jobs: self
                .live_jobs
                .checked_add(other.live_jobs)
                .context("job count overflow")?,
            native_payload_bytes: self
                .native_payload_bytes
                .checked_add(other.native_payload_bytes)
                .context("Native payload capacity overflow")?,
            captured_results: self
                .captured_results
                .checked_add(other.captured_results)
                .context("capture result count overflow")?,
            captured_bytes: self
                .captured_bytes
                .checked_add(other.captured_bytes)
                .context("capture capacity overflow")?,
        };
        ensure!(
            next.endpoints <= limits.endpoints
                && next.live_jobs <= limits.live_jobs
                && next.native_payload_bytes <= limits.native_payload_bytes
                && next.captured_results <= limits.captured_results
                && next.captured_bytes <= limits.captured_bytes,
            "protected aggregate resources exhausted"
        );
        Ok(next)
    }
    fn subtract(&mut self, other: Self) {
        self.endpoints -= other.endpoints;
        self.live_jobs -= other.live_jobs;
        self.native_payload_bytes -= other.native_payload_bytes;
        self.captured_results -= other.captured_results;
        self.captured_bytes -= other.captured_bytes;
    }
}
struct HostState {
    sessions: usize,
    used: Usage,
}
pub(super) struct HostAdmission {
    limits: ScopeLimits,
    max_sessions: NonZeroUsize,
    state: Mutex<HostState>,
}
pub(super) struct SessionAdmission {
    host: Arc<HostAdmission>,
    limits: ScopeLimits,
    used: Mutex<Usage>,
}
impl HostAdmission {
    pub(super) fn new(limits: ScopeLimits, max_sessions: NonZeroUsize) -> Arc<Self> {
        Arc::new(Self {
            limits,
            max_sessions,
            state: Mutex::new(HostState {
                sessions: 0,
                used: Usage::default(),
            }),
        })
    }
    #[cfg_attr(
        all(not(unix), not(any(test, feature = "test-support"))),
        expect(
            dead_code,
            reason = "actual session-generation construction issuer remains uninstalled"
        )
    )]
    pub(super) fn session(self: &Arc<Self>, limits: ScopeLimits) -> Result<Arc<SessionAdmission>> {
        let mut host = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("aggregate host owner unavailable"))?;
        ensure!(
            host.sessions < self.max_sessions.get(),
            "aggregate session capacity exhausted"
        );
        host.sessions += 1;
        Ok(Arc::new(SessionAdmission {
            host: Arc::clone(self),
            limits,
            used: Mutex::new(Usage::default()),
        }))
    }
}
impl Drop for SessionAdmission {
    fn drop(&mut self) {
        // A lost unknown endpoint keeps this scope's slot as well as its byte
        // and job charges. Dropping the last scope handle cannot create a new
        // session allowance while the old outcome remains unresolved.
        if *self
            .used
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            != Usage::default()
        {
            return;
        }
        self.host
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .sessions -= 1;
    }
}
impl SessionAdmission {
    fn reserve(&self, charge: Usage) -> Result<()> {
        // One fixed lock order and no callbacks. Check both scopes before
        // committing either; a failed session admission never leaks host usage.
        let mut host = self
            .host
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("aggregate host owner unavailable"))?;
        let mut session = self
            .used
            .lock()
            .map_err(|_| anyhow::anyhow!("aggregate session owner unavailable"))?;
        let host_next = host.used.add(charge, self.host.limits)?;
        let session_next = session.add(charge, self.limits)?;
        host.used = host_next;
        *session = session_next;
        Ok(())
    }
    fn release(&self, charge: Usage) {
        let mut host = self
            .host
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut session = self
            .used
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        host.used.subtract(charge);
        session.subtract(charge);
    }
    #[cfg_attr(
        all(not(unix), not(any(test, feature = "test-support"))),
        expect(
            dead_code,
            reason = "Native concrete-plan construction admission remains uninstalled"
        )
    )]
    pub(super) fn reserve_endpoint(
        self: &Arc<Self>,
        declaration: CompartmentResourceDeclaration,
    ) -> Result<EndpointPreparation> {
        let charge = Usage {
            endpoints: 1,
            live_jobs: declaration.live_jobs.get(),
            native_payload_bytes: declaration.accounted_payload_bytes.get(),
            ..Usage::default()
        };
        self.reserve(charge)?;
        let reservation = Arc::new(EndpointReservation {
            session: Arc::clone(self),
            declaration,
            charge,
            joined: AtomicBool::new(false),
        });
        Ok(EndpointPreparation {
            reservation,
            started: false,
        })
    }
}

// A known no-start rollback cannot share a token with an escaping Native owner:
// only begin() makes storage holds available. Call it before the FIRST actual
// channel/driver/task creation, not merely before from_negotiated().
#[cfg_attr(
    all(not(unix), not(any(test, feature = "test-support"))),
    expect(
        dead_code,
        reason = "actual concrete-plan construction issuer remains uninstalled"
    )
)]
pub(super) struct EndpointPreparation {
    reservation: Arc<EndpointReservation>,
    started: bool,
}
impl EndpointPreparation {
    #[cfg_attr(
        all(not(unix), not(any(test, feature = "test-support"))),
        expect(
            dead_code,
            reason = "actual concrete-plan construction issuer remains uninstalled"
        )
    )]
    pub(super) fn begin(mut self) -> (BoundaryAdmission, CompartmentStorageHold) {
        self.started = true;
        (
            BoundaryAdmission(Arc::clone(&self.reservation)),
            CompartmentStorageHold(Arc::clone(&self.reservation)),
        )
    }
}
impl Drop for EndpointPreparation {
    fn drop(&mut self) {
        if !self.started {
            self.reservation.joined.store(true, Ordering::Release);
        }
    }
}

struct EndpointReservation {
    session: Arc<SessionAdmission>,
    declaration: CompartmentResourceDeclaration,
    charge: Usage,
    joined: AtomicBool,
}
impl Drop for EndpointReservation {
    fn drop(&mut self) {
        // Last storage Drop is insufficient without the actual join. If its
        // cleanup capability was lost, leave the scalar charge parked rather
        // than reopening capacity from an unknown outcome. No resource cycle
        // or reference back to a Boundary/transport is needed for this refusal.
        if self.joined.load(Ordering::Acquire) {
            self.session.release(self.charge);
        }
    }
}

/// Opaque nonduplicating storage charge. Native retains clones in its actual
/// pool and all escaping owners. Only private Core admission can create one;
/// it conveys no execution, source, backend or cleanup authority.
#[derive(Clone)]
#[cfg_attr(
    not(feature = "test-support"),
    doc = "\n```compile_fail\nuse nac_core::runtime::compartment_resource_fixtures::FixtureHost;\n```"
)]
pub struct CompartmentStorageHold(Arc<EndpointReservation>);
impl CompartmentStorageHold {
    pub fn declaration(&self) -> CompartmentResourceDeclaration {
        self.0.declaration
    }
}
/// Production boundaries retain the actual two admissions and the unique
/// policy owner that created their shared host/session ledger. There is no
/// constructor from matching declarations or externally supplied storage holds.
pub(super) struct BoundaryAdmissions(AdmissionSet);
enum AdmissionSet {
    #[cfg(unix)]
    Pair {
        client: BoundaryAdmission,
        runner: BoundaryAdmission,
        _capacity: Arc<capacity_source::RetainedCapacityInput>,
    },
    #[cfg(test)]
    Single(BoundaryAdmission),
    #[cfg(all(not(unix), not(test)))]
    Unsupported,
}
#[cfg(test)]
impl From<BoundaryAdmission> for BoundaryAdmissions {
    fn from(admission: BoundaryAdmission) -> Self {
        Self(AdmissionSet::Single(admission))
    }
}
impl BoundaryAdmissions {
    #[cfg(unix)]
    fn paired(
        client: BoundaryAdmission,
        runner: BoundaryAdmission,
        capacity: Arc<capacity_source::RetainedCapacityInput>,
    ) -> Result<Self> {
        ensure!(
            !Arc::ptr_eq(&client.0, &runner.0)
                && Arc::ptr_eq(&client.0.session, &runner.0.session)
                && Arc::ptr_eq(&client.0.session.host, &capacity.host),
            "paired admissions must retain distinct endpoints from the original policy/session"
        );
        Ok(Self(AdmissionSet::Pair {
            client,
            runner,
            _capacity: capacity,
        }))
    }
    /// Called only after the actual whole transport join, under the boundary's
    /// retained cutoff lock. Atomic latches only: no filesystem or remote I/O.
    pub(super) fn joined(&self) {
        match &self.0 {
            #[cfg(unix)]
            AdmissionSet::Pair { client, runner, .. } => {
                client.joined();
                runner.joined();
            }
            #[cfg(test)]
            AdmissionSet::Single(admission) => admission.joined(),
            #[cfg(all(not(unix), not(test)))]
            AdmissionSet::Unsupported => {}
        }
    }
    pub(super) fn capture(&self, stdout: usize, stderr: usize) -> Result<CaptureReservation> {
        match &self.0 {
            #[cfg(unix)]
            AdmissionSet::Pair { client, .. } => client.capture(stdout, stderr),
            #[cfg(test)]
            AdmissionSet::Single(admission) => admission.capture(stdout, stderr),
            #[cfg(all(not(unix), not(test)))]
            AdmissionSet::Unsupported => anyhow::bail!("protected paired admission unavailable"),
        }
    }
}

pub(super) struct BoundaryAdmission(Arc<EndpointReservation>);
impl BoundaryAdmission {
    pub(super) fn joined(&self) {
        self.0.joined.store(true, Ordering::Release);
    }
    pub(super) fn capture(
        &self,
        stdout_limit: usize,
        stderr_limit: usize,
    ) -> Result<CaptureReservation> {
        let bytes = stdout_limit
            .checked_add(stderr_limit)
            .context("capture ceilings overflow")?;
        let charge = Usage {
            captured_results: 1,
            captured_bytes: bytes,
            ..Usage::default()
        };
        self.0.session.reserve(charge)?;
        Ok(CaptureReservation {
            session: Arc::clone(&self.0.session),
            charge,
            stdout_limit,
            stderr_limit,
        })
    }
}

pub(super) struct CaptureReservation {
    session: Arc<SessionAdmission>,
    charge: Usage,
    stdout_limit: usize,
    stderr_limit: usize,
}
impl CaptureReservation {
    pub(super) fn finish(self, output: CompartmentOutput) -> Result<ProtectedExecutionOutput> {
        ensure!(
            output.stdout.capacity() <= self.stdout_limit
                && output.stderr.capacity() <= self.stderr_limit,
            "protected capture allocation exceeds prepared ceilings"
        );
        Ok(ProtectedExecutionOutput {
            output,
            _reservation: self,
        })
    }
}
impl Drop for CaptureReservation {
    fn drop(&mut self) {
        self.session.release(self.charge);
    }
}

/// Core-owned captured bytes, with no bare-vector extraction or growth API.
/// The destination charge is reserved before the RAW call. Raw adapters retain
/// their own capture/endpoint charge until transfer; this owner then holds the
/// actual vector capacities independently of transport/context lifetime.
pub struct ProtectedExecutionOutput {
    // Field order retires actual vectors before their accounting reservation.
    output: CompartmentOutput,
    _reservation: CaptureReservation,
}
impl ProtectedExecutionOutput {
    pub fn exit(&self) -> CompartmentExit {
        self.output.exit
    }
    pub fn stdout(&self) -> &[u8] {
        &self.output.stdout
    }
    pub fn stderr(&self) -> &[u8] {
        &self.output.stderr
    }
    pub fn stdout_truncated(&self) -> bool {
        self.output.stdout_truncated
    }
    pub fn stderr_truncated(&self) -> bool {
        self.output.stderr_truncated
    }
}

#[cfg(test)]
#[path = "protected_execution_resources_tests.rs"]
mod tests;

#[cfg(feature = "test-support")]
#[path = "protected_execution_resource_fixtures.rs"]
pub mod fixtures;
