//! Nonshipping, exact-identity Idle -> publication cutpoint; never an HTTP hook.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock, Weak,
};
use tokio::sync::Notify;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct Key {
    store: PathBuf,
    session: String,
    run: String,
}
#[derive(Default)]
struct State {
    arrived: Notify,
    release: Notify,
    published: Notify,
    released: AtomicBool,
}
static BARRIERS: LazyLock<StdMutex<HashMap<Key, Weak<State>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Owns one bounded test pause. Drop always releases it and removes only this
/// registration; another store/session/run can never consume its notification.
pub struct AttentionPublicationBarrier {
    key: Key,
    state: Arc<State>,
}
impl AttentionPublicationBarrier {
    pub async fn arrived(&self) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(5), self.state.arrived.notified()).await?;
        Ok(())
    }
    pub async fn published(&self) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(5), self.state.published.notified()).await?;
        Ok(())
    }
    pub fn release(&self) {
        self.state.released.store(true, Ordering::Release);
        self.state.release.notify_one();
    }
}
impl Drop for AttentionPublicationBarrier {
    fn drop(&mut self) {
        self.release();
        let mut entries = BARRIERS
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

fn register(key: Key) -> Result<AttentionPublicationBarrier> {
    let mut entries = BARRIERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    entries.retain(|_, value| value.strong_count() != 0);
    anyhow::ensure!(
        entries.len() < 64 && !entries.contains_key(&key),
        "attention test barrier already registered or full"
    );
    let state = Arc::new(State::default());
    entries.insert(key.clone(), Arc::downgrade(&state));
    Ok(AttentionPublicationBarrier { key, state })
}
pub(super) struct AttentionPublicationWitness(Arc<State>);
impl AttentionPublicationWitness {
    pub(super) fn published(self) {
        self.0.published.notify_one();
    }
}
async fn wait(
    key: &Key,
    stopping: &AtomicBool,
    bound: Duration,
) -> Option<AttentionPublicationWitness> {
    // Remove and clone under the registry mutex, then release it BEFORE await.
    let state = BARRIERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(key)
        .and_then(|value| value.upgrade());
    let state = state?;
    state.arrived.notify_one();
    let deadline = tokio::time::Instant::now() + bound;
    while !state.released.load(Ordering::Acquire) && !stopping.load(Ordering::Acquire) {
        tokio::select! {
            () = state.release.notified() => {},
            () = tokio::time::sleep_until(deadline) => break,
            () = tokio::time::sleep(Duration::from_millis(10)) => {},
        }
    }
    Some(AttentionPublicationWitness(state))
}
impl SessionService {
    pub fn hold_attention_publication_for_test(
        &self,
        run: &str,
    ) -> Result<AttentionPublicationBarrier> {
        anyhow::ensure!(!run.is_empty(), "exact run required");
        register(Key {
            store: self.metadata.store_path.canonicalize()?,
            session: self
                .metadata
                .session_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("persisted session required"))?,
            run: run.to_owned(),
        })
    }
    pub(super) async fn wait_attention_publication_for_test(
        &self,
        run: &SessionRunId,
    ) -> Option<AttentionPublicationWitness> {
        let (Ok(store), Some(session)) = (
            self.metadata.store_path.canonicalize(),
            self.metadata.session_id.as_ref(),
        ) else {
            return None;
        };
        wait(
            &Key {
                store,
                session: session.clone(),
                run: run.to_string(),
            },
            &self.stopping_admission,
            Duration::from_secs(5),
        )
        .await
    }
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "isolated test synchronization assertions"
)]
mod tests {
    use super::*;
    fn key() -> Key {
        Key {
            store: PathBuf::from(format!("/test/{}", Uuid::new_v4())),
            session: "s".into(),
            run: "a".into(),
        }
    }
    #[tokio::test]
    async fn attention_publication_barrier_exact_identity_drop_timeout_and_cancellation() {
        let key = key();
        let guard = register(key.clone()).unwrap();
        for wrong in [
            Key {
                run: "b".into(),
                ..key.clone()
            },
            Key {
                session: "other".into(),
                ..key.clone()
            },
            Key {
                store: PathBuf::from("/other"),
                ..key.clone()
            },
        ] {
            let unmatched = tokio::time::timeout(
                Duration::from_millis(50),
                wait(&wrong, &AtomicBool::new(false), Duration::from_secs(1)),
            )
            .await
            .unwrap();
            assert!(unmatched.is_none());
        }
        assert!(register(key.clone()).is_err());
        let waiting = tokio::spawn({
            let key = key.clone();
            async move { wait(&key, &AtomicBool::new(false), Duration::from_secs(1)).await }
        });
        guard.arrived().await.unwrap();
        drop(guard);
        let _ = tokio::time::timeout(Duration::from_millis(100), waiting)
            .await
            .unwrap()
            .unwrap();
        let timed = register(key.clone()).unwrap();
        let witness = wait(&key, &AtomicBool::new(false), Duration::from_millis(1))
            .await
            .unwrap();
        timed.arrived().await.unwrap();
        witness.published();
        timed.published().await.unwrap();
        drop(timed);
        let cancelled = register(key.clone()).unwrap();
        let _ = wait(&key, &AtomicBool::new(true), Duration::from_secs(5)).await;
        cancelled.arrived().await.unwrap();
        drop(cancelled);
        assert!(!BARRIERS.lock().unwrap().contains_key(&key));
    }
}
