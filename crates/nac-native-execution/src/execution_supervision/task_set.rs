//! Joinable ownership of private adapter tasks, including never-polled futures.
use super::actor::resources::StorageCharge;
use anyhow::{ensure, Context, Result};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    task::{Context as TaskContext, Poll},
    time::Instant,
};
use tokio::{runtime::Handle, sync::Notify, task::JoinHandle};

pub(super) struct TaskSet {
    pending: AtomicUsize,
    changed: Notify,
    _storage: StorageCharge,
}
struct OwnedTask<F> {
    future: Option<Pin<Box<F>>>,
    tasks: Arc<TaskSet>,
}
impl TaskSet {
    pub(super) fn new(storage: StorageCharge) -> Arc<Self> {
        Arc::new(Self {
            pending: AtomicUsize::new(0),
            changed: Notify::new(),
            _storage: storage,
        })
    }
    #[cfg(test)]
    pub(super) fn unaccounted_for_test() -> Arc<Self> {
        Self::new(StorageCharge::Unaccounted)
    }
    pub(super) fn spawn<F>(
        self: &Arc<Self>,
        runtime: &Handle,
        future: F,
    ) -> Result<JoinHandle<F::Output>>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        let mut count = self.pending.load(Ordering::Acquire);
        loop {
            let next = count
                .checked_add(1)
                .ok_or_else(|| anyhow::anyhow!("Native task ownership count exhausted"))?;
            match self.pending.compare_exchange_weak(
                count,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(observed) => count = observed,
            }
        }
        // Construction occurs BEFORE spawn. Tokio dropping an unpolled task
        // still drops its actual owned future before publishing task settlement.
        let owned = OwnedTask {
            future: Some(Box::pin(future)),
            tasks: Arc::clone(self),
        };
        Ok(runtime.spawn(owned))
    }
    pub(super) async fn join(&self, original_deadline: Instant) -> Result<()> {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            ensure!(
                Instant::now() < original_deadline,
                "Native task cleanup original cutoff expired"
            );
            if self.pending.load(Ordering::Acquire) == 0 {
                return Ok(());
            }
            tokio::time::timeout_at(original_deadline.into(), changed)
                .await
                .context("Native task cleanup original cutoff expired")?;
        }
    }
}
impl<F: Future> Future for OwnedTask<F> {
    type Output = F::Output;
    fn poll(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Self::Output> {
        let Some(future) = self.future.as_mut() else {
            panic!("completed Native task repolled")
        };
        match future.as_mut().poll(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(value) => {
                drop(self.future.take());
                Poll::Ready(value)
            }
        }
    }
}
impl<F> Drop for OwnedTask<F> {
    fn drop(&mut self) {
        // No counter-based claim while a connection/pipe/task capture survives.
        drop(self.future.take());
        self.tasks.pending.fetch_sub(1, Ordering::AcqRel);
        self.tasks.changed.notify_waiters();
    }
}

#[cfg(test)]
mod tests;
