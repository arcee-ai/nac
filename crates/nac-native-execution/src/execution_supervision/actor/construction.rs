//! Retained cleanup for every partial construction stage, including wire tasks.
use super::{
    resources::StorageCharge,
    stop::{RawRunnerCleanup, StopScope},
};
use crate::execution_supervision::task_set::TaskSet;
use anyhow::{ensure, Result};
use nac_core::runtime::*;
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

pub(in super::super) struct ConstructionFailure {
    pub error: anyhow::Error,
    pub cleanup: NativeCleanup,
}
impl std::fmt::Debug for ConstructionFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConstructionFailure")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}
impl std::fmt::Display for ConstructionFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}
impl std::error::Error for ConstructionFailure {}

pub(in super::super) struct NativeCleanup {
    runner: Arc<dyn RawRunnerCleanup>,
    pub(super) tasks: Arc<TaskSet>,
    pub(super) scope: Option<Arc<StopScope>>,
    cutoff: Mutex<Instant>,
    armed: bool,
    pub(super) storage: StorageCharge,
}
impl NativeCleanup {
    pub(super) fn new(
        runner: Arc<dyn RawRunnerCleanup>,
        storage: StorageCharge,
        cutoff: Instant,
    ) -> Self {
        Self {
            runner,
            tasks: TaskSet::new(storage.clone()),
            scope: None,
            cutoff: Mutex::new(cutoff),
            armed: true,
            storage,
        }
    }
    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
    pub(super) fn failed(self, error: anyhow::Error) -> ConstructionFailure {
        self.stop(self.cutoff());
        ConstructionFailure {
            error,
            cleanup: self,
        }
    }
    fn cutoff(&self) -> Instant {
        *self
            .cutoff
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    fn effective_cutoff(&self) -> Result<Instant> {
        let cutoff = self.cutoff();
        Ok(match &self.scope {
            Some(scope) => cutoff.min(scope.cleanup_cutoff()?),
            None => cutoff,
        })
    }
    fn stop(&self, deadline: Instant) {
        let cutoff = {
            let mut current = self
                .cutoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *current = (*current).min(deadline);
            *current
        };
        if let Some(scope) = &self.scope {
            scope.stop(cutoff);
        } else {
            self.runner.request_stop(cutoff);
        }
    }
}
impl Drop for NativeCleanup {
    fn drop(&mut self) {
        if self.armed {
            self.stop(self.cutoff());
        }
    }
}

// This port cannot run a job or construct a positive Boundary. It only lets
// the construction owner await the actual same driver/tasks after an error.
impl ExecutionCompartmentTransport for NativeCleanup {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { anyhow::bail!("Native construction failed") })
    }
    fn native_file_io(
        &self,
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { anyhow::bail!("Native construction failed") })
    }
    fn spawn_pipe(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        Box::pin(async { anyhow::bail!("Native construction failed") })
    }
    fn spawn_pty(
        &self,
        _: CompartmentCommand,
        _: CompartmentPtySize,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        Box::pin(async { anyhow::bail!("Native construction failed") })
    }
    fn close_and_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()> {
        self.stop(original_deadline);
        crate::execution_supervision::poll_wake::future(async move {
            let cutoff = self.effective_cutoff()?;
            if let Some(scope) = &self.scope {
                tokio::try_join!(scope.close_and_reap(cutoff), self.tasks.join(cutoff))?;
            } else {
                tokio::try_join!(self.runner.wait_for_reap(cutoff), self.tasks.join(cutoff))?;
            }
            ensure!(
                Instant::now() < self.effective_cutoff()?,
                "Native partial cleanup original cutoff expired"
            );
            Ok(())
        })
    }
}

pub(super) enum BuildControl {
    Normal,
    #[cfg(test)]
    FailAfterWire,
}
impl BuildControl {
    pub(super) fn after_wire(&self) -> Result<()> {
        match self {
            Self::Normal => Ok(()),
            #[cfg(test)]
            Self::FailAfterWire => {
                anyhow::bail!("injected Native construction failure after wire tasks")
            }
        }
    }
}

#[cfg(test)]
mod tests;
