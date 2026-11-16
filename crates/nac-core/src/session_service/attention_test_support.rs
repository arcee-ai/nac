//! Nonshipping, exact-identity stopped selection -> publication attempt cutpoint.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock, Weak,
};
use tokio::sync::Notify;

#[cfg(test)]
mod continuation;

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum Kind {
    IdlePublication,
    QuestionSettlement,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct Key {
    kind: Kind,
    store: PathBuf,
    session: String,
    run: String,
}
#[derive(Default)]
struct State {
    arrived: Notify,
    release: Notify,
    attempted: Notify,
    selection: StdMutex<Option<AttentionPublicationSelection>>,
    released: AtomicBool,
    question_settled: AtomicBool,
}
static BARRIERS: LazyLock<StdMutex<HashMap<Key, Weak<State>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Owns one bounded test pause. Drop always releases it and removes only this
/// registration; another store/session/run can never consume its notification.
pub struct AttentionPublicationBarrier {
    key: Key,
    state: Arc<State>,
}
/// Exact question-source settlement after continuation selection has returned.
/// Separate registration kind preserves the idle publication hook's exclusions.
pub struct QuestionSettlementBarrier(AttentionPublicationBarrier);
impl QuestionSettlementBarrier {
    pub async fn arrived(&self) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(5), self.0.state.arrived.notified()).await?;
        anyhow::ensure!(
            self.0.state.question_settled.load(Ordering::Acquire),
            "question settlement receipt unavailable"
        );
        Ok(())
    }
    pub fn release(&self) {
        self.0.release();
    }
}

/// Actual stopped continuation selected by settlement, never inferred from
/// session behavior or the completion ledger. This type is nonshipping.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttentionPublicationSelection {
    Idle {
        goal: Option<crate::events::AttentionGoal>,
        last_run: Option<String>,
    },
    IdleUnverified,
}
impl AttentionPublicationSelection {
    fn from_selection(selection: &attention::ContinuationDisposition) -> Option<Self> {
        match selection {
            attention::ContinuationDisposition::Idle { goal, last_run } => Some(Self::Idle {
                goal: goal.clone(),
                last_run: last_run.clone(),
            }),
            attention::ContinuationDisposition::IdleUnverified => Some(Self::IdleUnverified),
            _ => None,
        }
    }
}
impl AttentionPublicationBarrier {
    pub async fn arrived(&self) -> Result<AttentionPublicationSelection> {
        tokio::time::timeout(Duration::from_secs(5), self.state.arrived.notified()).await?;
        self.state
            .selection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| anyhow::anyhow!("attention selection receipt unavailable"))
    }
    /// The ordinary publication call returned. IdleUnverified normally makes
    /// that call a no-op; this receipt never asserts current Completed work.
    pub async fn publication_attempted(&self) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(5), self.state.attempted.notified()).await?;
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
    let state = register_entry(&mut entries, &key)?;
    Ok(AttentionPublicationBarrier { key, state })
}

fn register_entry(entries: &mut HashMap<Key, Weak<State>>, key: &Key) -> Result<Arc<State>> {
    entries.retain(|_, value| value.strong_count() != 0);
    anyhow::ensure!(
        entries.len() < 64 && !entries.contains_key(key),
        "attention test barrier already registered or full"
    );
    let state = Arc::new(State::default());
    entries.insert(key.clone(), Arc::downgrade(&state));
    Ok(state)
}
pub(super) struct AttentionPublicationWitness(Arc<State>);
impl AttentionPublicationWitness {
    pub(super) fn publication_attempted(self) {
        self.0.attempted.notify_one();
    }
}
async fn wait(
    key: &Key,
    selection: &attention::ContinuationDisposition,
    stopping: &AtomicBool,
    bound: Duration,
) -> Option<AttentionPublicationWitness> {
    // Reject other dispositions BEFORE consuming an exact registration.
    let idle_selection = match key.kind {
        Kind::IdlePublication => Some(AttentionPublicationSelection::from_selection(selection)?),
        Kind::QuestionSettlement => {
            if !matches!(
                selection,
                attention::ContinuationDisposition::WaitingForQuestion
            ) {
                return None;
            }
            None
        }
    };
    // Remove and clone under the registry mutex, then release it BEFORE await.
    let state = BARRIERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(key)
        .and_then(|value| value.upgrade());
    let state = state?;
    *state
        .selection
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = idle_selection;
    state
        .question_settled
        .store(key.kind == Kind::QuestionSettlement, Ordering::Release);
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
            kind: Kind::IdlePublication,
            store: self.metadata.store_path.canonicalize()?,
            session: self
                .metadata
                .session_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("persisted session required"))?,
            run: run.to_owned(),
        })
    }
    pub fn hold_question_settlement_for_test(
        &self,
        run: &str,
        generation: &str,
    ) -> Result<QuestionSettlementBarrier> {
        // Direct question generations are their exact immutable source run UUID.
        anyhow::ensure!(
            !run.is_empty() && run == generation,
            "exact question run/generation required"
        );
        register(Key {
            kind: Kind::QuestionSettlement,
            store: self.metadata.store_path.canonicalize()?,
            session: self
                .metadata
                .session_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("persisted session required"))?,
            run: run.to_owned(),
        })
        .map(QuestionSettlementBarrier)
    }
    pub(super) async fn wait_attention_publication_for_test(
        &self,
        run: &SessionRunId,
        selection: &attention::ContinuationDisposition,
    ) -> Option<AttentionPublicationWitness> {
        let (Ok(store), Some(session)) = (
            self.metadata.store_path.canonicalize(),
            self.metadata.session_id.as_ref(),
        ) else {
            return None;
        };
        wait(
            &Key {
                kind: if matches!(
                    selection,
                    attention::ContinuationDisposition::WaitingForQuestion
                ) {
                    Kind::QuestionSettlement
                } else {
                    Kind::IdlePublication
                },
                store,
                session: session.clone(),
                run: run.to_string(),
            },
            selection,
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
    // Distinct keys still share the registry's capacity; isolate both consumers.
    static REGISTRY_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn key() -> Key {
        Key {
            kind: Kind::IdlePublication,
            store: PathBuf::from(format!("/test/{}", Uuid::new_v4())),
            session: "s".into(),
            run: "a".into(),
        }
    }
    fn idle() -> attention::ContinuationDisposition {
        attention::ContinuationDisposition::Idle {
            goal: None,
            last_run: Some("a".into()),
        }
    }
    #[tokio::test]
    async fn attention_publication_barrier_exact_identity_drop_timeout_and_cancellation() {
        let _registry = REGISTRY_TEST_LOCK.lock().await;
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
                wait(
                    &wrong,
                    &idle(),
                    &AtomicBool::new(false),
                    Duration::from_secs(1),
                ),
            )
            .await
            .unwrap();
            assert!(unmatched.is_none());
        }
        assert!(register(key.clone()).is_err());
        let waiting = tokio::spawn({
            let key = key.clone();
            async move {
                wait(
                    &key,
                    &idle(),
                    &AtomicBool::new(false),
                    Duration::from_secs(1),
                )
                .await
            }
        });
        guard.arrived().await.unwrap();
        drop(guard);
        let _ = tokio::time::timeout(Duration::from_millis(100), waiting)
            .await
            .unwrap()
            .unwrap();
        let timed = register(key.clone()).unwrap();
        let witness = wait(
            &key,
            &idle(),
            &AtomicBool::new(false),
            Duration::from_millis(1),
        )
        .await
        .unwrap();
        timed.arrived().await.unwrap();
        witness.publication_attempted();
        timed.publication_attempted().await.unwrap();
        drop(timed);
        let cancelled = register(key.clone()).unwrap();
        let _ = wait(
            &key,
            &attention::ContinuationDisposition::IdleUnverified,
            &AtomicBool::new(true),
            Duration::from_secs(5),
        )
        .await;
        assert_eq!(
            cancelled.arrived().await.unwrap(),
            AttentionPublicationSelection::IdleUnverified
        );
        drop(cancelled);
        assert!(!BARRIERS.lock().unwrap().contains_key(&key));
    }

    #[tokio::test]
    async fn attention_publication_barrier_actual_selections_negative_controls_one_shot_and_cap() {
        let _registry = REGISTRY_TEST_LOCK.lock().await;
        use attention::ContinuationDisposition as D;
        let negatives = [
            D::Busy,
            D::Stopping,
            D::ForeignOwner,
            D::RetryScheduled,
            D::WaitingForQuestion,
            D::Started {
                successor: SessionRunId::from_stored("b".into()),
            },
        ];
        for actual in [idle(), D::IdleUnverified] {
            let key = key();
            let guard = register(key.clone()).unwrap();
            for rejected in &negatives {
                assert!(wait(
                    &key,
                    rejected,
                    &AtomicBool::new(false),
                    Duration::from_secs(1)
                )
                .await
                .is_none());
                assert!(BARRIERS.lock().unwrap().contains_key(&key));
                assert!(guard.state.selection.lock().unwrap().is_none());
            }
            let expected = AttentionPublicationSelection::from_selection(&actual).unwrap();
            let waiting = tokio::spawn({
                let key = key.clone();
                async move {
                    wait(
                        &key,
                        &actual,
                        &AtomicBool::new(false),
                        Duration::from_secs(1),
                    )
                    .await
                }
            });
            assert_eq!(guard.arrived().await.unwrap(), expected);
            assert!(wait(
                &key,
                &idle(),
                &AtomicBool::new(false),
                Duration::from_secs(1)
            )
            .await
            .is_none());
            guard.release();
            waiting.await.unwrap().unwrap().publication_attempted();
            guard.publication_attempted().await.unwrap();
            drop(guard);
        }
        // Other real-service fixtures use the global registry concurrently.
        // Exercise its exact registration logic without consuming their slots.
        let unrelated_key = key();
        let unrelated = register(unrelated_key.clone()).unwrap();
        let mut entries = HashMap::new();
        let states = (0..64)
            .map(|_| register_entry(&mut entries, &key()).unwrap())
            .collect::<Vec<_>>();
        assert!(register_entry(&mut entries, &key()).is_err());
        assert!(BARRIERS
            .lock()
            .unwrap()
            .get(&unrelated_key)
            .is_some_and(|state| state.ptr_eq(&Arc::downgrade(&unrelated.state))));
        drop(states);
        assert!(register_entry(&mut entries, &key()).is_ok());
        drop(unrelated);
    }
}

#[cfg(test)]
mod question_settlement_tests;
