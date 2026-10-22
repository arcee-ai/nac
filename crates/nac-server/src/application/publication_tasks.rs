//! Actual original publication task handles owned by the serving root.
//! A completed task is not an authenticated terminal or physical cleanup.
use anyhow::{anyhow, Result};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tokio::task::JoinHandle;

type OriginalTask = Arc<tokio::sync::Mutex<Option<JoinHandle<()>>>>;
#[derive(Default)]
pub(crate) struct PublicationTasks {
    closed: AtomicBool,
    originals: Mutex<Vec<OriginalTask>>,
}
impl PublicationTasks {
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }
    /// Store the actual JoinHandle before returning. Ordinary concurrent spawn
    /// waits only on this short registry lock; it never invents a busy refusal.
    /// Closed-root refusal drops an unstarted future and its original guard.
    pub(crate) fn spawn(&self, work: impl Future<Output = ()> + Send + 'static) -> bool {
        let mut originals = self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        let handle = tokio::spawn(work);
        originals.push(Arc::new(tokio::sync::Mutex::new(Some(handle))));
        true
    }
    pub(crate) async fn drain(&self, original_cutoff: Instant) -> Result<()> {
        self.close();
        let originals = self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let mut first = None;
        for original in originals {
            let joined = tokio::time::timeout_at(original_cutoff.into(), async {
                let mut retained = original.lock().await;
                if let Some(task) = retained.as_mut() {
                    let result = task.await;
                    retained.take(); // Only remove the exact terminal original handle.
                    result.map_err(|_| anyhow!("original publication task failed"))?;
                }
                Ok(())
            })
            .await
            .map_err(|_| anyhow!("original publication task drain cutoff"))
            .and_then(|result| result);
            if let Err(error) = joined {
                if first.is_none() {
                    first = Some(error);
                }
            }
        }
        match first {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Notify;

    #[tokio::test]
    async fn cancelled_drain_retains_original_work_until_its_actual_return() {
        let tasks = Arc::new(PublicationTasks::default());
        let started = Arc::new(Notify::new());
        let finish = Arc::new(Notify::new());
        let completed = Arc::new(AtomicBool::new(false));
        let child_started = Arc::clone(&started);
        let child_finish = Arc::clone(&finish);
        let child_completed = Arc::clone(&completed);
        assert!(tasks.spawn(async move {
            child_started.notify_one();
            child_finish.notified().await;
            child_completed.store(true, Ordering::Release);
        }));
        started.notified().await;
        // Cancel the observer only after it actually borrowed join_next().
        let mut drain = Box::pin(tasks.drain(Instant::now() + std::time::Duration::from_secs(5)));
        std::future::poll_fn(|context| {
            assert!(drain.as_mut().poll(context).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        drop(drain);
        finish.notify_one();
        tasks
            .drain(Instant::now() + std::time::Duration::from_secs(5))
            .await
            .expect("original worker must join");
        assert!(completed.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn closed_root_refuses_unstarted_future_and_runs_its_drop_guard() {
        struct Guard(Arc<AtomicBool>);
        impl Drop for Guard {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let tasks = PublicationTasks::default();
        tasks.close();
        let dropped = Arc::new(AtomicBool::new(false));
        let ran = Arc::new(AtomicBool::new(false));
        let guard = Guard(Arc::clone(&dropped));
        let body = Arc::clone(&ran);
        assert!(!tasks.spawn(async move {
            let _guard = guard;
            body.store(true, Ordering::Release);
        }));
        assert!(dropped.load(Ordering::Acquire));
        assert!(!ran.load(Ordering::Acquire));
        tasks
            .drain(Instant::now())
            .await
            .expect("no task was admitted");
    }
}
