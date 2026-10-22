//! Actual issuer-process custody. Nothing in this module consumes a lifecycle
//! lease, proves isolation, installs a runner executable or grants execution.
use super::{
    construction::{ConstructionFailure, NativeCleanup},
    resources::{ResourcePlan, StorageCharge},
    stop::RawRunnerCleanup,
};
use crate::execution_supervision::task_set::TaskSet;
use anyhow::{ensure, Result};
use nac_core::runtime::{CompartmentFuture, CompartmentStorageHold};
use nac_process::{peer_channel::PeerLifetime, NativePipe, NativePipeOwner};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tokio::{process::Command, sync::Notify};

/// Owns an actual spawned direct child and both supplied endpoint charges
/// in the ISSUER. Neither the hold nor PolicySource is copied into the child.
pub(in super::super) struct IssuerRunnerCustody {
    plan: ResourcePlan,
    storage: CompartmentStorageHold,
    client_storage: CompartmentStorageHold,
    tasks: Arc<TaskSet>,
    process: Mutex<ProcessState>,
    stop: Arc<StopState>,
}
enum ProcessState {
    NotStarted,
    Unknown,
    Started(Arc<NativePipeOwner>),
}
struct StopState {
    cutoff: Mutex<Instant>,
    stopping: AtomicBool,
    changed: Notify,
}

impl IssuerRunnerCustody {
    /// Caller must already own the original consumed lifecycle and distinct
    /// client/runner Core reservations before FIRST construction. This private
    /// lower seam accepts a real OS command, not a DTO/callback grant. The
    /// genuine factory must itself build a qualified exec-in-place launcher.
    pub(in super::super) fn spawn(
        command: Command,
        plan: ResourcePlan,
        client_storage: CompartmentStorageHold,
        storage: CompartmentStorageHold,
        original_cutoff: Instant,
    ) -> std::result::Result<Arc<Self>, ConstructionFailure> {
        let owner = Self::prepare(plan, client_storage, storage, original_cutoff);
        match owner.start(command) {
            Ok(()) => Ok(owner),
            Err(error) => Err(owner.failed(error)),
        }
    }
    fn prepare(
        plan: ResourcePlan,
        client_storage: CompartmentStorageHold,
        storage: CompartmentStorageHold,
        original_cutoff: Instant,
    ) -> Arc<Self> {
        let cutoff = plan.policy_cutoff(original_cutoff);
        Arc::new(Self {
            tasks: TaskSet::new(StorageCharge::Accounted(storage.clone())),
            plan,
            storage,
            client_storage,
            process: Mutex::new(ProcessState::NotStarted),
            stop: Arc::new(StopState {
                cutoff: Mutex::new(cutoff),
                stopping: AtomicBool::new(false),
                changed: Notify::new(),
            }),
        })
    }
    fn start(self: &Arc<Self>, command: Command) -> Result<()> {
        let owner = self;
        let cutoff = self.original_cutoff();
        (|| {
            owner.check_current()?;
            ensure!(
                owner.plan.declaration() == owner.storage.declaration()
                    && owner.plan.declaration() == owner.client_storage.declaration(),
                "runner plan differs from Core storage"
            );
            {
                let mut state = owner
                    .process
                    .lock()
                    .map_err(|_| anyhow::anyhow!("runner custody unavailable"))?;
                ensure!(
                    matches!(*state, ProcessState::NotStarted),
                    "original runner spawn already attempted"
                );
                *state = ProcessState::Unknown;
            }
            let process = match NativePipe::spawn_silent_peer_runner(command, cutoff.into()) {
                Ok(pipe) => pipe,
                Err(failure) => {
                    if let Some(process) = failure.process {
                        *owner
                            .process
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner) =
                            ProcessState::Started(Arc::new(process));
                    }
                    return Err(failure.error.into());
                }
            };
            let process = Arc::new(process);
            // Publish actual custody before any further task allocation/failure.
            *owner
                .process
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                ProcessState::Started(Arc::clone(&process));
            let source = owner.plan.retained_policy_source()?;
            let stop = Arc::clone(&owner.stop);
            let _observer = owner
                .tasks
                .spawn(&tokio::runtime::Handle::current(), async move {
                    let changed = stop.changed.notified();
                    tokio::pin!(changed);
                    changed.as_mut().enable();
                    if !stop.stopping.load(Ordering::Acquire) {
                        tokio::select! {
                            _ = source.retired() => {},
                            _ = &mut changed => {},
                            _ = tokio::time::sleep_until(cutoff.into()) => {},
                        }
                    }
                    process.request_stop_until(source.cutoff(stop.cutoff(cutoff)).into());
                })?;
            owner.check_current()
        })()
    }
    fn failed(self: Arc<Self>, error: anyhow::Error) -> ConstructionFailure {
        let cutoff = self.original_cutoff();
        let storage = StorageCharge::Accounted(self.storage.clone());
        NativeCleanup::new(self, storage, cutoff).failed(error)
    }
    fn check_current(&self) -> Result<()> {
        self.plan.retained_policy_source()?;
        ensure!(
            !self.stop.stopping.load(Ordering::Acquire) && Instant::now() < self.original_cutoff(),
            "runner original custody stopped"
        );
        Ok(())
    }
    pub(in super::super) fn original_cutoff(&self) -> Instant {
        self.plan.policy_cutoff(
            *self
                .stop
                .cutoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }
    pub(in super::super) fn client_storage(&self) -> CompartmentStorageHold {
        self.client_storage.clone()
    }
    /// Original child pidfd AND original same-socket peer pidfd must be live.
    /// Copied kernel credentials, a PID string, or a foreign peer never suffice.
    pub(in super::super) fn require_peer(
        &self,
        peer: &PeerLifetime,
        plan: &ResourcePlan,
    ) -> Result<()> {
        self.check_current()?;
        let original = self.plan.retained_policy_source()?;
        let client = plan.retained_policy_source()?;
        ensure!(
            Arc::ptr_eq(&original, &client) && plan.declaration() == self.plan.declaration(),
            "different original runner policy/plan"
        );
        ensure!(
            peer.original_cutoff() <= self.original_cutoff(),
            "peer renewed original runner cutoff"
        );
        let state = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("runner custody unavailable"))?;
        let ProcessState::Started(process) = &*state else {
            anyhow::bail!("original runner process absent");
        };
        process.require_original_peer(peer)?;
        drop(state);
        self.check_current()
    }
}
impl StopState {
    fn cutoff(&self, original: Instant) -> Instant {
        original.min(
            *self
                .cutoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }
}
impl RawRunnerCleanup for IssuerRunnerCustody {
    fn request_stop(&self, original: Instant) {
        let cutoff = {
            let mut cutoff = self
                .stop
                .cutoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *cutoff = self.plan.policy_cutoff((*cutoff).min(original));
            *cutoff
        };
        self.stop.stopping.store(true, Ordering::Release);
        let process = {
            let state = self
                .process
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match &*state {
                ProcessState::Started(p) => Some(Arc::clone(p)),
                _ => None,
            }
        };
        if let Some(process) = process {
            process.request_stop_until(cutoff.into());
        }
        self.stop.changed.notify_waiters();
    }
    fn wait_for_reap(&self, original: Instant) -> CompartmentFuture<'_, ()> {
        self.request_stop(original); // Also records stop for an unpolled wait.
        Box::pin(async move {
            let process = {
                let state = self
                    .process
                    .lock()
                    .map_err(|_| anyhow::anyhow!("runner custody unavailable"))?;
                match &*state {
                    ProcessState::NotStarted => None,
                    ProcessState::Unknown => anyhow::bail!("runner spawn outcome unknown"),
                    ProcessState::Started(p) => Some(Arc::clone(p)),
                }
            };
            let initial = self.original_cutoff();
            let cleanup = async {
                if let Some(process) = process {
                    process.terminate_until(initial.into()).await?;
                }
                self.tasks.join(initial).await?;
                Ok::<(), anyhow::Error>(())
            };
            tokio::pin!(cleanup);
            loop {
                let changed = self.stop.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                let cutoff = self.original_cutoff();
                ensure!(
                    Instant::now() < cutoff,
                    "runner original cleanup cutoff expired"
                );
                tokio::select! { biased;
                    _ = tokio::time::sleep_until(cutoff.into()) => anyhow::bail!("runner original cleanup cutoff expired"),
                    _ = &mut changed => continue,
                    result = &mut cleanup => {
                        result?;
                        ensure!(Instant::now() < self.original_cutoff(), "runner cleanup completed after cutoff");
                        return Ok(());
                    }
                }
            }
        })
    }
}
impl Drop for IssuerRunnerCustody {
    fn drop(&mut self) {
        self.request_stop(self.original_cutoff());
    }
}
#[cfg(test)]
mod tests;

mod bootstrap;
pub use bootstrap::{
    NativeCreateFailure, NativeCreateJoin, NativeCreateLaunch, NativeCreateResources,
};
