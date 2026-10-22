//! An independent original-cutoff observer for the actual selected runner owner.
//! Denial/stop is not reaping; the cleanup implementation retains actual owners.
use anyhow::{ensure, Context, Result};
use nac_core::runtime::CompartmentFuture;
use nac_process::peer_channel::{PeerDenial, PeerIoGate};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::Notify;

pub(in super::super) trait RawRunnerCleanup: Send + Sync {
    /// Bounded, synchronous, idempotent request against the already selected
    /// actual driver. Retain its cleanup across cancellation, errors and Drop.
    fn request_stop(&self, original_deadline: Instant);
    /// Only success reports actual driver/process/descendant reaping. An error
    /// or expired budget leaves the implementation's retained cleanup intact.
    fn wait_for_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()>;
}

impl RawRunnerCleanup for nac_process::NativePipeOwner {
    fn request_stop(&self, original_deadline: Instant) {
        self.request_stop_until(original_deadline.into());
    }
    fn wait_for_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async move { Ok(self.terminate_until(original_deadline.into()).await?) })
    }
}

pub(super) struct StopScope {
    gate: PeerIoGate,
    denial: PeerDenial,
    runner: Arc<dyn RawRunnerCleanup>,
    cutoff: Instant,
    state: Mutex<State>,
    changed: Notify,
}
struct State {
    next: u64,
    jobs: BTreeMap<u64, Instant>,
    stopping: Option<Instant>,
}

/// Construct before spawning the owning async task: even an unpolled task's
/// cancellation must request actual runner stop rather than just drop a future.
pub(super) struct StopOnDrop {
    scope: Arc<StopScope>,
    armed: bool,
}
impl StopOnDrop {
    pub(super) fn new(scope: Arc<StopScope>) -> Self {
        Self { scope, armed: true }
    }
    pub(super) fn disarm(mut self) {
        self.armed = false;
    }
}
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        if self.armed {
            self.scope.stop(self.scope.cutoff);
        }
    }
}
#[derive(Clone)]
pub(super) struct JobCutoff {
    scope: Arc<StopScope>,
    id: u64,
}

pub(super) struct JobDeadline {
    scope: Arc<StopScope>,
    id: u64,
    settled: bool,
}

impl StopScope {
    pub(super) fn start(
        gate: PeerIoGate,
        denial: PeerDenial,
        runner: Arc<dyn RawRunnerCleanup>,
        original_cutoff: Instant,
    ) -> Result<Arc<Self>> {
        let scope = Arc::new(Self {
            gate,
            denial,
            runner,
            cutoff: original_cutoff,
            state: Mutex::new(State {
                next: 0,
                jobs: BTreeMap::new(),
                stopping: None,
            }),
            changed: Notify::new(),
        });
        // Retained native process owners already own cleanup independently.
        // Failure before observer startup still records stop synchronously.
        let pending = StopOnDrop::new(Arc::clone(&scope));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        scope.check()?;
        let observed = Arc::clone(&scope);
        std::thread::Builder::new()
            .name("native-execution-stop".into())
            .spawn(move || {
                let _stop = StopOnDrop::new(Arc::clone(&observed));
                runtime.block_on(observed.observe());
            })
            .context("Native independent stop observer unavailable")?;
        pending.disarm();
        Ok(scope)
    }

    pub(super) async fn invalidated(&self) {
        self.gate.invalidated().await;
    }

    pub(super) fn check(&self) -> Result<()> {
        self.gate.check_current()?;
        ensure!(
            Instant::now() < self.cutoff,
            "Native peer original cutoff expired"
        );
        ensure!(
            self.state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .stopping
                .is_none(),
            "Native runner stopping"
        );
        Ok(())
    }

    /// Call synchronously, after a finite metadata reservation and BEFORE any
    /// queue wait, including before a returned dispatch future is first polled.
    pub(super) fn register(self: &Arc<Self>, original_deadline: Instant) -> Result<JobDeadline> {
        if let Err(error) = self.check() {
            self.stop(original_deadline);
            return Err(error);
        }
        if Instant::now() >= original_deadline {
            self.stop(original_deadline);
            anyhow::bail!("Native job original cutoff expired");
        }
        let id = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            ensure!(state.stopping.is_none(), "Native runner stopping");
            let id = state
                .next
                .checked_add(1)
                .context("Native registration sequence exhausted")?;
            state.next = id;
            state.jobs.insert(id, original_deadline.min(self.cutoff));
            id
        };
        self.changed.notify_waiters();
        // Closes the register/denial race; failure drops a stop-owning entry.
        let registered = JobDeadline {
            scope: Arc::clone(self),
            id,
            settled: false,
        };
        self.check()?;
        Ok(registered)
    }

    pub(super) fn stop(&self, deadline: Instant) {
        let cutoff = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let cutoff = deadline
                .min(self.cutoff)
                .min(state.stopping.unwrap_or(self.cutoff))
                .min(state.jobs.values().copied().min().unwrap_or(self.cutoff));
            state.stopping = Some(cutoff);
            cutoff
        };
        // Never invoke external driver code or wake reentrant I/O under a lock.
        // Install actual retained cleanup before denial wakes arbitrary caller
        // wakers, which can block their own thread indefinitely.
        self.runner.request_stop(cutoff);
        self.denial.deny();
        self.changed.notify_waiters();
    }

    pub(super) async fn close_and_reap(&self, original_deadline: Instant) -> Result<()> {
        self.stop(original_deadline); // even when the caller's deadline expired
        let waiting = self.runner.wait_for_reap(self.cleanup_cutoff()?);
        tokio::pin!(waiting);
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let cutoff = self.cleanup_cutoff()?;
            ensure!(
                Instant::now() < cutoff,
                "Native cleanup original cutoff expired"
            );
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(cutoff.into()) => anyhow::bail!("Native cleanup original cutoff expired"),
                _ = &mut changed => continue,
                result = &mut waiting => {
                    result?;
                    ensure!(Instant::now() < self.cleanup_cutoff()?, "Native cleanup completed after original cutoff");
                    return Ok(());
                }
            }
        }
    }

    pub(super) fn cleanup_cutoff(&self) -> Result<Instant> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .stopping
            .context("Native stop not recorded")
    }

    /// A copied timer is only a wakeup. Commit expiry against the actual
    /// current registry atomically, so a settled registration cannot revive it.
    fn stop_if_expired(&self) -> bool {
        let cutoff = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.stopping.is_some() {
                return true;
            }
            let cutoff = state
                .jobs
                .values()
                .copied()
                .min()
                .unwrap_or(self.cutoff)
                .min(self.cutoff);
            if Instant::now() < cutoff {
                return false;
            }
            state.stopping = Some(cutoff);
            cutoff
        };
        self.stop(cutoff); // callbacks only after the irrevocable locked commit
        true
    }

    async fn observe(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.stop_if_expired() {
                return;
            }
            let cutoff = {
                let state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.stopping.is_some() {
                    return;
                }
                state
                    .jobs
                    .values()
                    .copied()
                    .min()
                    .unwrap_or(self.cutoff)
                    .min(self.cutoff)
            };
            if self.gate.check_current().is_err() {
                self.stop(self.cutoff);
                return;
            }
            tokio::select! {
                biased;
                _ = self.gate.invalidated() => { self.stop(self.cutoff); return; }
                _ = tokio::time::sleep_until(cutoff.into()) => {},
                _ = &mut changed => {}
            }
        }
    }
}
impl JobDeadline {
    /// Actual process/wire/output settlement only; retained closed input heap
    /// storage is charged separately. Never merely after wire enqueue,
    /// cancellation, Exited, a request to stop, or an arbitrary receipt.
    pub(super) fn cutoff_handle(&self) -> JobCutoff {
        JobCutoff {
            scope: Arc::clone(&self.scope),
            id: self.id,
        }
    }
    pub(super) fn settled(mut self) {
        self.settled = true;
    }
}
impl Drop for JobDeadline {
    fn drop(&mut self) {
        let cutoff = self
            .scope
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .jobs
            .remove(&self.id)
            .unwrap_or(self.scope.cutoff);
        if !self.settled {
            self.scope.stop(cutoff);
        }
        self.scope.changed.notify_waiters();
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests;

impl JobCutoff {
    pub(super) fn tighten(&self, original_deadline: Instant) {
        {
            let mut state = self
                .scope
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(cutoff) = state.jobs.get_mut(&self.id) else {
                return;
            };
            *cutoff = (*cutoff).min(original_deadline);
        }
        self.scope.changed.notify_waiters();
        self.scope.stop_if_expired();
    }
    pub(super) fn stop_if_live(&self) {
        let cutoff = {
            let mut state = self
                .scope
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if !state.jobs.contains_key(&self.id) {
                return;
            }
            let cutoff = state
                .jobs
                .values()
                .copied()
                .min()
                .unwrap_or(self.scope.cutoff)
                .min(self.scope.cutoff)
                .min(state.stopping.unwrap_or(self.scope.cutoff));
            state.stopping = Some(cutoff);
            cutoff
        };
        self.scope.stop(cutoff);
    }
}

/// Per-job cancellation is inert after the actual registration settles.
pub(super) struct StopJobOnDrop(Option<JobCutoff>);
impl StopJobOnDrop {
    pub(super) fn new(cutoff: Option<JobCutoff>) -> Self {
        Self(cutoff)
    }
    pub(super) fn disarm(mut self) {
        self.0.take();
    }
}
impl Drop for StopJobOnDrop {
    fn drop(&mut self) {
        if let Some(cutoff) = &self.0 {
            cutoff.stop_if_live();
        }
    }
}
