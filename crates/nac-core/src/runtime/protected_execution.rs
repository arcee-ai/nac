//! Protected dispatch cannot fall back to concrete Local builders/native I/O.
//! Positive qualification is intentionally unavailable until the real resource
//! and source-authority join exists; raw transports and observations never mint.
use super::protected_execution_io::*;
#[cfg(test)]
use super::protected_execution_resources::BoundaryAdmission;
use super::protected_execution_resources::{BoundaryAdmissions, ProtectedExecutionOutput};
use crate::sandbox::ExecutionBackend;
use anyhow::{bail, Result};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use uuid::Uuid;

#[cfg(unix)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "genuine Native admission verifier and protected runtime builder remain disconnected"
    )
)]
#[path = "protected_create_owner.rs"]
pub(crate) mod create_owner;

#[path = "protected_execution_cancellation.rs"]
mod cancellation;
#[cfg(unix)]
#[path = "protected_guidance_capture.rs"]
pub(in crate::runtime) mod guidance_capture;
pub use cancellation::ProtectedExecutionCancellation;
#[path = "protected_execution_peer.rs"]
mod peer;
use peer::BoundaryPeer;
#[path = "protected_execution_wait.rs"]
mod wait;

/// Read-only expected binding, not evidence of any real runtime or key owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProtectedExecutionIdentity {
    pub runtime_id: Uuid,
    pub runtime_generation: u64,
    pub execution_owner_id: Uuid,
    pub process_generation: u64,
    pub trusted_key_owner_id: Uuid,
    pub key_generation: u64,
}

// Only the Core-owned actual admission/probe factory can implement this private
// resource owner. Native supplies raw channel/IO, not an `isolated=true` adapter.
// Checks and poisoning must remain bounded synchronous observations/denial.
// Remote I/O and cleanup belong to the retained infrastructure actors; poisoning
// never waits for their settlement or releases upstream restorative claims.
trait VerifiedBoundaryResources: Send + Sync {
    fn check_current(&self) -> Result<()>;
    fn original_deadline(&self) -> Instant;
    fn poison(&self);
}
struct BoundaryState {
    selected_backend: Arc<ExecutionBackend>,
    identity: ProtectedExecutionIdentity,
    resources: Box<dyn VerifiedBoundaryResources>,
    transport: Box<dyn ExecutionCompartmentTransport>,
    admission: BoundaryAdmissions,
    peer: BoundaryPeer,
    cutoff: Mutex<Instant>,
    denied: AtomicBool,
    changed: tokio::sync::Notify,
}

/// Nonclone/nonserializable construction capability. There is currently NO
/// public positive factory. Actual Root/D candidate authority, kernel-bound
/// original peer/pidfd and real isolation probes must supply its private owner.
/// No config, boolean, copied tuple, transport implementation or row can do so.
///
/// ```compile_fail
/// use nac_core::runtime::ProtectedExecutionBoundary;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<ProtectedExecutionBoundary>();
/// ```
/// ```compile_fail
/// use nac_core::runtime::ProtectedExecutionBoundary;
/// let _: ProtectedExecutionBoundary = serde_json::from_str("{}").unwrap();
/// ```
pub struct ProtectedExecutionBoundary {
    state: Arc<BoundaryState>,
}
impl ProtectedExecutionBoundary {
    #[cfg(unix)]
    #[cfg_attr(
        any(not(test), not(target_os = "linux")),
        expect(
            dead_code,
            reason = "positive qualification stays unavailable until the actual source/peer/probe factory is installed"
        )
    )]
    fn from_verified_resources(
        selected_backend: Arc<ExecutionBackend>,
        identity: ProtectedExecutionIdentity,
        resources: Box<dyn VerifiedBoundaryResources>,
        transport: Box<dyn ExecutionCompartmentTransport>,
        peer: nac_process::peer_channel::PeerLifetime,
        admission: impl Into<BoundaryAdmissions>,
    ) -> Result<Self> {
        Self::from_parts(
            selected_backend,
            identity,
            resources,
            transport,
            BoundaryPeer::Captured(peer),
            admission,
        )
    }

    fn from_parts(
        selected_backend: Arc<ExecutionBackend>,
        identity: ProtectedExecutionIdentity,
        resources: Box<dyn VerifiedBoundaryResources>,
        transport: Box<dyn ExecutionCompartmentTransport>,
        peer: BoundaryPeer,
        admission: impl Into<BoundaryAdmissions>,
    ) -> Result<Self> {
        let checks = (|| {
            peer.check(transport.as_ref())?;
            resources.check_current()?;
            let cutoff = peer.cutoff(resources.original_deadline());
            if Instant::now() >= cutoff {
                bail!("protected execution boundary expired");
            }
            peer.check(transport.as_ref())?;
            Ok(cutoff)
        })();
        let cutoff = match checks {
            Ok(cutoff) => cutoff,
            Err(error) => {
                peer.deny();
                resources.poison();
                return Err(error);
            }
        };
        Ok(Self {
            state: Arc::new(BoundaryState {
                selected_backend,
                identity,
                resources,
                transport,
                admission: admission.into(),
                peer,
                cutoff: Mutex::new(cutoff),
                denied: AtomicBool::new(false),
                changed: tokio::sync::Notify::new(),
            }),
        })
    }
}
impl BoundaryState {
    fn original_deadline(&self) -> Result<Instant> {
        // External owner sampling must never run under our cutoff mutex.
        let observed = self.peer.cutoff(self.resources.original_deadline());
        let update = self
            .cutoff
            .lock()
            .map(|mut cutoff| {
                let tightened = observed < *cutoff;
                *cutoff = (*cutoff).min(observed);
                (*cutoff, tightened)
            })
            .map_err(|_| anyhow::anyhow!("protected execution cutoff unavailable"));
        match update {
            Ok((cutoff, tightened)) => {
                // Wake all pending operations after releasing the mutex. Each
                // retains its original effect and recomputes the shared minimum.
                if tightened {
                    self.changed.notify_waiters();
                }
                Ok(cutoff)
            }
            Err(error) => {
                self.poison();
                Err(error)
            }
        }
    }
    fn cleanup_deadline(&self) -> Instant {
        // Poisoned local state cannot reopen effects, but must not obstruct
        // explicit cleanup. Recover only the retained value, never a new budget.
        let observed = self.peer.cutoff(self.resources.original_deadline());
        let mut retained = self
            .cutoff
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let tightened = observed < *retained;
        *retained = (*retained).min(observed);
        let cutoff = *retained;
        drop(retained);
        if tightened {
            self.changed.notify_waiters();
        }
        cutoff
    }
    fn begin_close(&self, requested: Instant) -> Instant {
        let observed = self.peer.cutoff(self.resources.original_deadline());
        let mut retained = self
            .cutoff
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let cutoff = (*retained).min(observed).min(requested);
        let tightened = cutoff < *retained;
        *retained = cutoff;
        // Publish both facts before any notification can reenter this owner.
        let newly_denied = !self.denied.swap(true, Ordering::AcqRel);
        drop(retained);
        if newly_denied {
            self.notify_denial();
        } else if tightened {
            self.changed.notify_waiters();
        }
        cutoff
    }
    fn finish_close(&self) -> Result<()> {
        let observed = self.peer.cutoff(self.resources.original_deadline());
        let mut retained = self
            .cutoff
            .lock()
            .map_err(|_| anyhow::anyhow!("protected execution cutoff unavailable"))?;
        let tightened = observed < *retained;
        *retained = (*retained).min(observed);
        let current = Instant::now() < *retained;
        // A concurrent close can retain a tighter cutoff before forwarding it
        // to RAW. Validate and publish the local join under the same lock as
        // that update, so an older RAW success cannot restore stale capacity.
        // joined() only stores the private atomic latch; it runs no callbacks.
        if current {
            self.admission.joined();
        }
        drop(retained);
        if tightened {
            self.changed.notify_waiters();
        }
        if !current {
            bail!("protected cleanup original cutoff expired");
        }
        Ok(())
    }
    fn check_effect(&self, permit: &ProtectedExecutionPermit) -> Result<()> {
        self.check(&permit.selected_backend, permit.identity)?;
        if Instant::now() >= permit.deadline {
            self.poison();
            bail!("protected effect expired");
        }
        if let Err(error) = permit.resources.check_current() {
            self.poison();
            return Err(error);
        }
        Ok(())
    }
    fn check(
        &self,
        selected: &Arc<ExecutionBackend>,
        identity: ProtectedExecutionIdentity,
    ) -> Result<()> {
        let result = (|| {
            if self.denied.load(Ordering::Acquire)
                || !Arc::ptr_eq(selected, &self.selected_backend)
                || identity != self.identity
                || Instant::now() >= self.original_deadline()?
            {
                bail!("protected execution boundary unavailable");
            }
            self.peer.check(self.transport.as_ref())?;
            self.resources.check_current()?;
            self.peer.check(self.transport.as_ref())?;
            if self.denied.load(Ordering::Acquire) {
                bail!("protected execution boundary unavailable");
            }
            Ok(())
        })();
        if result.is_err() {
            self.poison();
        }
        result
    }
    fn poison(&self) {
        if !self.denied.swap(true, Ordering::AcqRel) {
            self.notify_denial();
        }
    }
    fn notify_denial(&self) {
        self.changed.notify_waiters();
        self.peer.deny();
        self.resources.poison();
    }
}
impl Drop for BoundaryState {
    fn drop(&mut self) {
        self.poison();
    }
}

// An interrupted dispatch has an unknown effect outcome. Invalidating this
// owner prevents reuse; transport-owned cleanup still has to reap descendants.
struct PendingDispatch {
    state: Arc<BoundaryState>,
    complete: bool,
}
impl PendingDispatch {
    fn new(state: &Arc<BoundaryState>) -> Self {
        Self {
            state: Arc::clone(state),
            complete: false,
        }
    }
    fn finish(mut self) {
        self.complete = true;
    }
}
impl Drop for PendingDispatch {
    fn drop(&mut self) {
        if !self.complete {
            self.state.poison();
        }
    }
}

/// Guards isolation at each stage; it does not itself grant Ready or an effect.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtectedExecutionStage {
    Prepare,
    Activate,
    Effect,
}

/// Core-private admitted effect resources. The future real consume service
/// retains its current Ready/source/cancellation owner here, not a receipt.
trait ConsumedEffectResources: Send + Sync {
    fn check_current(&self) -> Result<()>;
    fn poison(&self);
}
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "actual durable effect issuer is not installed")
)]
enum PreparedOperation {
    Execute(CompartmentCommand),
    Pipe(CompartmentCommand),
    Pty(CompartmentCommand, CompartmentPtySize),
    FileIo(CompartmentFileIoCommand),
}
/// One-use prepared effect, private-constructor and nonserializable. Current
/// production has no minting path until actual durable source/local consume.
/// Command/file scope is retained inside it, so dispatch cannot swap payloads.
///
/// ```compile_fail
/// use nac_core::runtime::ProtectedExecutionPermit;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<ProtectedExecutionPermit>();
/// ```
/// ```compile_fail
/// use nac_core::runtime::ProtectedExecutionPermit;
/// let _: ProtectedExecutionPermit = serde_json::from_str("{}").unwrap();
/// ```
pub struct ProtectedExecutionPermit {
    selected_backend: Arc<ExecutionBackend>,
    identity: ProtectedExecutionIdentity,
    deadline: Instant,
    operation: Option<PreparedOperation>,
    resources: Box<dyn ConsumedEffectResources>,
}
impl Drop for ProtectedExecutionPermit {
    fn drop(&mut self) {
        self.resources.poison();
    }
}

pub struct ProtectedExecutionContext {
    selected_backend: Arc<ExecutionBackend>,
    identity: ProtectedExecutionIdentity,
    boundary: Option<ProtectedExecutionBoundary>,
}
impl Drop for ProtectedExecutionContext {
    fn drop(&mut self) {
        if let Some(boundary) = &self.boundary {
            boundary.state.poison();
        }
    }
}
impl ProtectedExecutionContext {
    /// Capture the actual preselected backend without granting any execution.
    pub fn unqualified(
        selected_backend: Arc<ExecutionBackend>,
        identity: ProtectedExecutionIdentity,
    ) -> Self {
        Self {
            selected_backend,
            identity,
            boundary: None,
        }
    }
    pub fn from_boundary(
        selected_backend: Arc<ExecutionBackend>,
        identity: ProtectedExecutionIdentity,
        boundary: ProtectedExecutionBoundary,
    ) -> Result<Self> {
        boundary.state.check(&selected_backend, identity)?;
        Ok(Self {
            selected_backend,
            identity,
            boundary: Some(boundary),
        })
    }
    pub(crate) fn selected_backend(&self) -> &Arc<ExecutionBackend> {
        &self.selected_backend
    }
    pub fn identity(&self) -> ProtectedExecutionIdentity {
        self.identity
    }
    /// Obtain denial for this exact owner without requiring it to remain
    /// current. The handle grants no execution and retains no live resources.
    pub fn cancellation(&self) -> Result<ProtectedExecutionCancellation> {
        Ok(ProtectedExecutionCancellation {
            state: Arc::downgrade(self.state()?),
        })
    }
    pub fn check_stage(&self, _stage: ProtectedExecutionStage) -> Result<()> {
        self.state()?.check(&self.selected_backend, self.identity)
    }
    fn state(&self) -> Result<&Arc<BoundaryState>> {
        self.boundary
            .as_ref()
            .map(|b| &b.state)
            .ok_or_else(|| anyhow::anyhow!("protected execution boundary is not installed"))
    }
    fn admit(&self, permit: &ProtectedExecutionPermit) -> Result<Arc<BoundaryState>> {
        self.check_stage(ProtectedExecutionStage::Effect)?;
        let state = self.state()?;
        if !Arc::ptr_eq(&permit.selected_backend, &self.selected_backend)
            || permit.identity != self.identity
            || Instant::now() >= permit.deadline
        {
            state.poison();
            bail!("protected effect scope unavailable");
        }
        if let Err(error) = permit.resources.check_current() {
            state.poison();
            return Err(error);
        }
        Ok(Arc::clone(state))
    }
    /// Captured bytes cannot escape their Core storage reservation.
    ///
    /// ```compile_fail
    /// use nac_core::runtime::{ProtectedExecutionContext, ProtectedExecutionPermit};
    /// async fn detach(context: &ProtectedExecutionContext, permit: ProtectedExecutionPermit)
    ///     -> anyhow::Result<Vec<u8>> {
    ///     Ok(context.execute(permit).await?.stdout)
    /// }
    /// ```
    pub async fn execute(
        &self,
        mut permit: ProtectedExecutionPermit,
    ) -> Result<ProtectedExecutionOutput> {
        let state = self.admit(&permit)?;
        permit.deadline = permit.deadline.min(state.original_deadline()?);
        let Some(PreparedOperation::Execute(command)) = permit.operation.take() else {
            state.poison();
            bail!("protected effect kind mismatch");
        };
        let capture = state
            .admission
            .capture(command.stdout_limit, command.stderr_limit)?;
        let pending = PendingDispatch::new(&state);
        let result = state
            .guard_effect(&permit, state.transport.execute(command, permit.deadline))
            .await?;
        let output = capture.finish(result)?;
        pending.finish();
        Ok(output)
    }
    pub async fn spawn_pipe(
        &self,
        mut permit: ProtectedExecutionPermit,
    ) -> Result<CompartmentPipe> {
        let state = self.admit(&permit)?;
        permit.deadline = permit.deadline.min(state.original_deadline()?);
        let Some(PreparedOperation::Pipe(command)) = permit.operation.take() else {
            state.poison();
            bail!("protected effect kind mismatch");
        };
        let pending = PendingDispatch::new(&state);
        let mut result = state
            .guard_effect(
                &permit,
                state.transport.spawn_pipe(command, permit.deadline),
            )
            .await?;
        result.process = Box::new(OwnedPipeProcess {
            process: result.process,
            state,
            permit,
            cleanup_completed: AtomicBool::new(false),
        });
        pending.finish();
        Ok(result)
    }
    pub async fn spawn_pty(&self, mut permit: ProtectedExecutionPermit) -> Result<CompartmentPty> {
        let state = self.admit(&permit)?;
        permit.deadline = permit.deadline.min(state.original_deadline()?);
        let Some(PreparedOperation::Pty(command, size)) = permit.operation.take() else {
            state.poison();
            bail!("protected effect kind mismatch");
        };
        let pending = PendingDispatch::new(&state);
        let mut result = state
            .guard_effect(
                &permit,
                state.transport.spawn_pty(command, size, permit.deadline),
            )
            .await?;
        result.process = Box::new(OwnedPtyProcess {
            process: result.process,
            state,
            permit,
            cleanup_completed: AtomicBool::new(false),
        });
        pending.finish();
        Ok(result)
    }
    pub async fn native_file_io(
        &self,
        mut permit: ProtectedExecutionPermit,
    ) -> Result<ProtectedExecutionOutput> {
        let state = self.admit(&permit)?;
        permit.deadline = permit.deadline.min(state.original_deadline()?);
        let Some(PreparedOperation::FileIo(operation)) = permit.operation.take() else {
            state.poison();
            bail!("protected effect kind mismatch");
        };
        let (stdout_limit, stderr_limit) = operation.capture_limits();
        let capture = state.admission.capture(stdout_limit, stderr_limit)?;
        let pending = PendingDispatch::new(&state);
        let result = state
            .guard_effect(
                &permit,
                state.transport.native_file_io(operation, permit.deadline),
            )
            .await?;
        // Native drains beyond the independent capture ceilings. A completed
        // process can therefore return partial protocol/file bytes; neither
        // stream may be interpreted as a complete file-operation result. The
        // consumed effect cannot be retried to reconstruct an unknown outcome.
        if result.stdout_truncated || result.stderr_truncated {
            state.poison();
            bail!("protected native file output incomplete");
        }
        let output = capture.finish(result)?;
        pending.finish();
        Ok(output)
    }
    pub fn close_and_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()> {
        let state = match self.state() {
            Ok(state) => state,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        // Invocation denies and retains the minimum even if the returned
        // future is never polled. Only the actual awaited join releases below.
        let cutoff = state.begin_close(original_deadline);
        let cleanup = state.transport.close_and_reap(cutoff);
        Box::pin(async move {
            cleanup.await?;
            // RAW join success alone is insufficient for release: Native's pool
            // and every escaping storage owner must also retire their actual hold.
            state.finish_close()
        })
    }
}

// Only an awaited successful explicit cleanup retires this handle's Drop
// obligation. Exit observation, stop requests and interrupted cleanup do not.
// This local fact neither restores source authority nor settles a Root slot.
struct OwnedPipeProcess {
    process: Box<dyn CompartmentProcess>,
    state: Arc<BoundaryState>,
    permit: ProtectedExecutionPermit,
    cleanup_completed: AtomicBool,
}
struct OwnedPtyProcess {
    process: Box<dyn CompartmentPtyProcess>,
    state: Arc<BoundaryState>,
    permit: ProtectedExecutionPermit,
    cleanup_completed: AtomicBool,
}
impl Drop for OwnedPipeProcess {
    fn drop(&mut self) {
        if !self.cleanup_completed.load(Ordering::Acquire) {
            self.state.poison();
        }
    }
}
impl Drop for OwnedPtyProcess {
    fn drop(&mut self) {
        if !self.cleanup_completed.load(Ordering::Acquire) {
            self.state.poison();
        }
    }
}
impl CompartmentProcess for OwnedPipeProcess {
    fn wait(&self) -> CompartmentFuture<'_, CompartmentExit> {
        Box::pin(async move {
            let pending = PendingDispatch::new(&self.state);
            let result = self
                .state
                .guard_effect(&self.permit, self.process.wait())
                .await?;
            pending.finish();
            Ok(result)
        })
    }
    fn terminate_and_reap(&self, deadline: Instant) -> CompartmentFuture<'_, ()> {
        let cleanup = self.process.terminate_and_reap(
            deadline
                .min(self.permit.deadline)
                .min(self.state.cleanup_deadline()),
        );
        Box::pin(async move {
            cleanup.await?;
            self.cleanup_completed.store(true, Ordering::Release);
            Ok(())
        })
    }
}
impl CompartmentProcess for OwnedPtyProcess {
    fn wait(&self) -> CompartmentFuture<'_, CompartmentExit> {
        Box::pin(async move {
            let pending = PendingDispatch::new(&self.state);
            let result = self
                .state
                .guard_effect(&self.permit, self.process.wait())
                .await?;
            pending.finish();
            Ok(result)
        })
    }
    fn terminate_and_reap(&self, deadline: Instant) -> CompartmentFuture<'_, ()> {
        let cleanup = self.process.terminate_and_reap(
            deadline
                .min(self.permit.deadline)
                .min(self.state.cleanup_deadline()),
        );
        Box::pin(async move {
            cleanup.await?;
            self.cleanup_completed.store(true, Ordering::Release);
            Ok(())
        })
    }
}
impl CompartmentPtyProcess for OwnedPtyProcess {
    fn resize(&self, size: CompartmentPtySize) -> CompartmentFuture<'_, ()> {
        Box::pin(async move {
            let pending = PendingDispatch::new(&self.state);
            self.state
                .guard_effect(&self.permit, self.process.resize(size))
                .await?;
            pending.finish();
            Ok(())
        })
    }
}

#[cfg(test)]
#[path = "protected_execution_tests.rs"]
mod tests;
