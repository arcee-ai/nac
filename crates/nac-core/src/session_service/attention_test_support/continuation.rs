//! Exact successful-settlement preflight -> operation-lease test cutpoint.
use super::*;

#[derive(Default)]
struct Preflight {
    arrived: Notify,
    release: Notify,
    observed: StdMutex<Option<bool>>,
    released: AtomicBool,
}
static PREFLIGHTS: LazyLock<StdMutex<HashMap<Key, Weak<Preflight>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

pub(crate) struct AttentionPreflightBarrier {
    key: Key,
    state: Arc<Preflight>,
}
impl AttentionPreflightBarrier {
    pub(crate) async fn arrived(&self) -> bool {
        tokio::time::timeout(Duration::from_secs(5), self.state.arrived.notified())
            .await
            .unwrap();
        self.state.observed.lock().unwrap().unwrap()
    }
    pub(crate) fn release(&self) {
        self.state.released.store(true, Ordering::Release);
        self.state.release.notify_one();
    }
}
impl Drop for AttentionPreflightBarrier {
    fn drop(&mut self) {
        self.release();
        let mut entries = PREFLIGHTS.lock().unwrap();
        if entries
            .get(&self.key)
            .is_some_and(|old| old.ptr_eq(&Arc::downgrade(&self.state)))
        {
            entries.remove(&self.key);
        }
    }
}
impl SessionService {
    pub(crate) fn hold_attention_preflight_for_test(
        &self,
        run: &SessionRunId,
    ) -> AttentionPreflightBarrier {
        let key = Key {
            kind: Kind::IdlePublication,
            store: self.metadata.store_path.canonicalize().unwrap(),
            session: self.metadata.session_id.clone().unwrap(),
            run: run.to_string(),
        };
        let state = Arc::new(Preflight::default());
        let mut entries = PREFLIGHTS.lock().unwrap();
        entries.retain(|_, value| value.strong_count() != 0);
        assert!(entries.len() < 64 && !entries.contains_key(&key));
        entries.insert(key.clone(), Arc::downgrade(&state));
        AttentionPreflightBarrier { key, state }
    }
    pub(crate) async fn wait_attention_preflight_for_test(
        &self,
        run: Option<&SessionRunId>,
        has_work: bool,
    ) {
        let Some(run) = run else { return };
        let key = Key {
            kind: Kind::IdlePublication,
            store: self.metadata.store_path.canonicalize().unwrap(),
            session: self.metadata.session_id.clone().unwrap(),
            run: run.to_string(),
        };
        let state = PREFLIGHTS
            .lock()
            .unwrap()
            .remove(&key)
            .and_then(|state| state.upgrade());
        let Some(state) = state else { return };
        *state.observed.lock().unwrap() = Some(has_work);
        state.arrived.notify_one();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while !state.released.load(Ordering::Acquire)
            && !self.stopping_admission.load(Ordering::Acquire)
        {
            tokio::select! {
                () = state.release.notified() => {},
                () = tokio::time::sleep_until(deadline) => break,
                () = tokio::time::sleep(Duration::from_millis(10)) => {},
            }
        }
    }
}

// Characterization only: exact original-run continuation caller, before owner lookup.
// This file is cfg(test)-only. No shipping/test-support API is added.
struct ContinuationIo {
    entered: Notify,
    returned: Notify,
    began: AtomicBool,
    outcome: StdMutex<Option<bool>>,
    complete: AtomicBool,
    timed_out: AtomicBool,
    release: std::sync::mpsc::SyncSender<()>,
    wait: StdMutex<std::sync::mpsc::Receiver<()>>,
}
static CONTINUATION_IO: LazyLock<StdMutex<HashMap<Key, Weak<ContinuationIo>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
pub(crate) struct AttentionContinuationIoBarrier {
    key: Key,
    state: Arc<ContinuationIo>,
}
impl AttentionContinuationIoBarrier {
    pub(crate) async fn entered(&self) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(5), self.state.entered.notified()).await?;
        Ok(())
    }
    pub(crate) fn release(&self) {
        let _ = self.state.release.try_send(());
    }
    pub(crate) async fn returned(&self) -> Result<bool> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let notification = self.state.returned.notified();
                tokio::pin!(notification);
                notification.as_mut().enable();
                if self.state.complete.load(Ordering::Acquire) {
                    break;
                }
                notification.await;
            }
        })
        .await?;
        anyhow::ensure!(
            !self.state.timed_out.load(Ordering::Acquire),
            "original caller release timed out"
        );
        self.state
            .outcome
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .ok_or_else(|| anyhow::anyhow!("original continuation caller unwound before returning"))
    }
}
impl Drop for AttentionContinuationIoBarrier {
    fn drop(&mut self) {
        self.release();
        let mut entries = CONTINUATION_IO
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if entries
            .get(&self.key)
            .is_some_and(|old| old.ptr_eq(&Arc::downgrade(&self.state)))
        {
            entries.remove(&self.key);
        }
    }
}
pub(crate) struct ContinuationIoWitness(Arc<ContinuationIo>);
impl ContinuationIoWitness {
    pub(crate) fn call(self, operation: impl FnOnce() -> Result<bool>) -> Result<bool> {
        let guard = self.enter();
        let result = operation();
        *guard
            .0
            .outcome
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(result.is_ok());
        result
    }
    fn enter(self) -> Self {
        self.0.began.store(true, Ordering::Release);
        self.0.entered.notify_one();
        if self
            .0
            .wait
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .recv_timeout(Duration::from_secs(5))
            .is_err()
        {
            self.0.timed_out.store(true, Ordering::Release);
        }
        self
    }
}
impl Drop for ContinuationIoWitness {
    fn drop(&mut self) {
        // Dropping a closure rejected before caller admission is not a return
        // receipt from an accepted original caller.
        if self.0.began.load(Ordering::Acquire) {
            self.0.complete.store(true, Ordering::Release);
            self.0.returned.notify_one();
        }
    }
}
impl SessionService {
    pub(crate) fn hold_attention_continuation_io_for_test(
        &self,
        run: &SessionRunId,
    ) -> AttentionContinuationIoBarrier {
        let key = Key {
            kind: Kind::IdlePublication,
            store: self.metadata.store_path.canonicalize().unwrap(),
            session: self.metadata.session_id.clone().unwrap(),
            run: run.to_string(),
        };
        let (release, wait) = std::sync::mpsc::sync_channel(1);
        let state = Arc::new(ContinuationIo {
            entered: Notify::new(),
            returned: Notify::new(),
            began: AtomicBool::new(false),
            outcome: StdMutex::new(None),
            complete: AtomicBool::new(false),
            timed_out: AtomicBool::new(false),
            release,
            wait: StdMutex::new(wait),
        });
        let mut entries = CONTINUATION_IO.lock().unwrap();
        entries.retain(|_, value| value.strong_count() != 0);
        assert!(entries.len() < 64 && !entries.contains_key(&key));
        entries.insert(key.clone(), Arc::downgrade(&state));
        AttentionContinuationIoBarrier { key, state }
    }
    pub(crate) fn take_attention_continuation_io_for_test(
        &self,
        run: Option<&SessionRunId>,
    ) -> Option<ContinuationIoWitness> {
        let run = run?;
        if CONTINUATION_IO.lock().unwrap().is_empty() {
            return None;
        }
        let key = Key {
            kind: Kind::IdlePublication,
            store: self.metadata.store_path.canonicalize().ok()?,
            session: self.metadata.session_id.clone()?,
            run: run.to_string(),
        };
        CONTINUATION_IO
            .lock()
            .unwrap()
            .remove(&key)
            .and_then(|w| w.upgrade())
            .map(ContinuationIoWitness)
    }
}
