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
