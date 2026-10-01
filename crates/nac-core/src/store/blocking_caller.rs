//! Adapters for legacy synchronous application callers. These tasks never run
//! SQLite themselves for an owned store: its closed typed commands still go
//! through the one bounded persistence executor.
use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, LazyLock};
use std::task::{Context, Poll};
use std::time::Instant;
use tokio::sync::Semaphore;

const MAX_BLOCKING_CALLERS: usize = 128;
static CALLERS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(MAX_BLOCKING_CALLERS)));

/// An immediately admitted caller task, or a predictable capacity rejection.
/// Dropping an admitted task keeps its permit until its operation returns.
pub struct BlockingStoreCaller<R> {
    task: Option<tokio::task::JoinHandle<R>>,
    rejection: Option<anyhow::Error>,
}
impl<R> BlockingStoreCaller<R> {
    /// Detach an admitted operation while reporting an immediate capacity
    /// rejection. Its permit remains held until the operation actually ends.
    pub fn detach(self) -> anyhow::Result<()> {
        match self.rejection {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn is_finished(&self) -> bool {
        self.task
            .as_ref()
            .is_none_or(tokio::task::JoinHandle::is_finished)
    }
}
impl<R> Future for BlockingStoreCaller<R> {
    type Output = anyhow::Result<R>;
    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        if let Some(error) = this.rejection.take() {
            return Poll::Ready(Err(error));
        }
        match this.task.as_mut() {
            Some(task) => Pin::new(task)
                .poll(context)
                .map(|result| result.map_err(Into::into)),
            None => Poll::Ready(Err(super::PersistenceAdmissionError::ExecutorStopped.into())),
        }
    }
}

std::thread_local! {
    static BLOCKING_CALLER: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn is_blocking_caller() -> bool {
    BLOCKING_CALLER.with(Cell::get)
}

/// Move a synchronous application operation off the async runtime before it
/// awaits legacy typed persistence commands. A current-thread runtime's
/// `Handle` is also present on its blocking pool, so runtime flavor alone
/// cannot identify a safe synchronous caller.
///
/// This is a caller adapter, not a persistence command port. The closure has
/// no executor authority and cannot bypass an owned store's typed commands.
pub fn spawn_blocking_store_caller<F, R>(operation: F) -> BlockingStoreCaller<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    #[cfg(test)]
    if let Some(capacity) = TEST_CAPACITY.with(|slot| slot.borrow().clone()) {
        return spawn_with_capacity(operation, capacity, MAX_BLOCKING_CALLERS);
    }
    spawn_with_capacity(operation, Arc::clone(&CALLERS), MAX_BLOCKING_CALLERS)
}

/// Preserve standalone callers' established polling boundary while moving an
/// owned application's synchronous coordination off its async runtime. The
/// closure has no executor authority; its typed store calls still enqueue.
pub(crate) async fn call_legacy_store<F, R>(
    path: &std::path::Path,
    operation: F,
) -> anyhow::Result<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    if super::coordinator::owner_for(path)?.is_some() {
        spawn_blocking_store_caller(operation).await
    } else {
        Ok(operation())
    }
}

fn spawn_with_capacity<F, R>(
    operation: F,
    capacity: Arc<Semaphore>,
    limit: usize,
) -> BlockingStoreCaller<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    let started = Instant::now();
    let admission = Arc::clone(&capacity).try_acquire_owned();
    crate::telemetry::emit_store_duration(
        crate::telemetry::StoreOperation::CallerAdmission,
        crate::telemetry::Correlation::default(),
        started.elapsed(),
        if admission.is_ok() {
            crate::telemetry::TelemetryOutcome::Ok
        } else {
            crate::telemetry::TelemetryOutcome::Conflict
        },
        None,
    );
    crate::telemetry::emit_persistence_caller_counts(
        limit.saturating_sub(capacity.available_permits()),
        limit,
    );
    let permit = match admission {
        Ok(permit) => permit,
        Err(_) => {
            return BlockingStoreCaller {
                task: None,
                rejection: Some(super::PersistenceAdmissionError::CallerOverloaded.into()),
            }
        }
    };
    let task = tokio::task::spawn_blocking(move || {
        struct CallerPermit {
            permit: Option<tokio::sync::OwnedSemaphorePermit>,
            capacity: Arc<Semaphore>,
            limit: usize,
        }
        impl Drop for CallerPermit {
            fn drop(&mut self) {
                self.permit.take();
                crate::telemetry::emit_persistence_caller_counts(
                    self.limit.saturating_sub(self.capacity.available_permits()),
                    self.limit,
                );
            }
        }
        let _permit = CallerPermit {
            permit: Some(permit),
            capacity,
            limit,
        };
        struct Restore(bool);
        impl Drop for Restore {
            fn drop(&mut self) {
                BLOCKING_CALLER.with(|active| active.set(self.0));
            }
        }
        let restore = Restore(BLOCKING_CALLER.with(|active| active.replace(true)));
        let output = operation();
        drop(restore);
        output
    });
    BlockingStoreCaller {
        task: Some(task),
        rejection: None,
    }
}

#[cfg(test)]
std::thread_local! {
    static TEST_CAPACITY: std::cell::RefCell<Option<Arc<Semaphore>>> = const { std::cell::RefCell::new(None) };
}
#[cfg(test)]
pub(crate) struct TestCallerCapacity(Option<Arc<Semaphore>>);
#[cfg(test)]
impl Drop for TestCallerCapacity {
    fn drop(&mut self) {
        TEST_CAPACITY.with(|slot| *slot.borrow_mut() = self.0.take());
    }
}
#[cfg(test)]
pub(crate) fn reject_callers_for_test() -> TestCallerCapacity {
    TestCallerCapacity(TEST_CAPACITY.with(|slot| slot.replace(Some(Arc::new(Semaphore::new(0))))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test(flavor = "current_thread")]
    async fn admission_is_bounded_even_when_an_accepted_waiter_is_dropped() {
        let capacity = Arc::new(Semaphore::new(1));
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let first = spawn_with_capacity(
            move || {
                entered.send(()).unwrap();
                wait.recv().unwrap();
            },
            Arc::clone(&capacity),
            1,
        );
        observed
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        drop(first);
        let executed = Arc::new(AtomicBool::new(false));
        let execution = Arc::clone(&executed);
        let error = spawn_with_capacity(
            move || {
                execution.store(true, Ordering::SeqCst);
            },
            Arc::clone(&capacity),
            1,
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.downcast_ref::<super::super::PersistenceAdmissionError>(),
            Some(&super::super::PersistenceAdmissionError::CallerOverloaded)
        );
        assert!(!executed.load(Ordering::SeqCst));
        release.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while capacity.available_permits() == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(spawn_with_capacity(|| 7, capacity, 1).await.unwrap(), 7);
    }
}
