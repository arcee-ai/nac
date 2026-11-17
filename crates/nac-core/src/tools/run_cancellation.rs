use super::*;

#[derive(Default)]
struct RunCancellationState {
    cancelled: AtomicBool,
    activity: Notify,
    mutation_gate: StdMutex<()>,
}

#[derive(Clone, Default)]
pub(crate) struct RunCancellation {
    state: Arc<RunCancellationState>,
    parent: Option<Arc<RunCancellation>>,
}

impl RunCancellation {
    /// Create a cancellation domain that can be stopped independently while
    /// still observing the owning run's stop signal.
    pub(crate) fn child(&self) -> Self {
        Self {
            state: Arc::new(RunCancellationState::default()),
            parent: Some(Arc::new(self.clone())),
        }
    }

    pub(crate) fn cancel(&self) {
        // Synchronous process creation and terminal writes take this same
        // short-lived gate for their final check plus mutation. Whichever side
        // acquires it first defines the boundary: after cancellation wins, no
        // new PTY or terminal input can pass an earlier observation.
        let _mutation = self
            .state
            .mutation_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !self.state.cancelled.swap(true, Ordering::AcqRel) {
            self.state.activity.notify_waiters();
        }
    }

    /// A final mutation gate can be held by an admitted caller awaiting SQL.
    /// Cancellation owns one local obligation and waits off the runtime.
    pub(crate) async fn cancel_async(&self) {
        loop {
            let cancellation = self.clone();
            match crate::store::spawn_blocking_store_caller(move || cancellation.cancel()).await {
                Err(error)
                    if matches!(
                        error.downcast_ref::<crate::store::PersistenceAdmissionError>(),
                        Some(crate::store::PersistenceAdmissionError::CallerOverloaded)
                    ) =>
                {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                Err(error) => {
                    eprintln!("nac: cancellation gate task failed: {error:#}");
                    break;
                }
                Ok(()) => break,
            }
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::Acquire)
            || self
                .parent
                .as_deref()
                .is_some_and(RunCancellation::is_cancelled)
    }

    pub(crate) fn run_if_active<T>(&self, operation: impl FnOnce() -> T) -> Option<T> {
        let mut lineage = Vec::new();
        let mut current = Some(self);
        while let Some(cancellation) = current {
            lineage.push(cancellation);
            current = cancellation.parent.as_deref();
        }
        let _guards = lineage
            .iter()
            .rev()
            .map(|cancellation| {
                cancellation
                    .state
                    .mutation_gate
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
            })
            .collect::<Vec<_>>();
        (!lineage
            .iter()
            .any(|cancellation| cancellation.state.cancelled.load(Ordering::Acquire)))
        .then(operation)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.state.activity.notified();
            if self.is_cancelled() {
                return;
            }
            if let Some(parent) = self.parent.as_deref() {
                tokio::select! {
                    () = notified => {}
                    () = Box::pin(parent.cancelled()) => {}
                }
            } else {
                notified.await;
            }
        }
    }
}
