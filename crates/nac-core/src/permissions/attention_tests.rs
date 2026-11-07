use super::*;
use crate::events::{AttentionBrokerState, SessionEventBus};
use crate::tools::{kernel::ToolCallContext, ThreadCancellation};

pub(crate) struct Recorder {
    broker: Weak<PermissionBroker>,
    check_locks: bool,
    pub snapshots: StdMutex<Vec<AttentionBrokerSnapshot>>,
}
impl BrokerAttentionObserver for Recorder {
    fn broker_changed(&self, _: Uuid, snapshot: AttentionBrokerSnapshot) {
        if let Some(broker) = self.broker.upgrade().filter(|_| self.check_locks) {
            assert!(
                broker.review.try_lock().is_ok(),
                "review guard leaked into callback"
            );
            assert!(
                broker.state.try_lock().is_ok(),
                "pending guard leaked into callback"
            );
            assert!(
                broker.attention.try_lock().is_ok(),
                "observation guard leaked into callback"
            );
        }
        self.snapshots.lock().unwrap().push(snapshot);
    }
}
pub(crate) fn observe(
    broker: &Arc<PermissionBroker>,
    check_locks: bool,
) -> (Arc<Recorder>, BrokerAttentionInstall) {
    let observer = Arc::new(Recorder {
        broker: Arc::downgrade(broker),
        check_locks,
        snapshots: StdMutex::new(Vec::new()),
    });
    let erased: Arc<dyn BrokerAttentionObserver> = observer.clone();
    let installed = broker
        .replace_attention_observer(None, Arc::downgrade(&erased))
        .unwrap();
    (observer, installed)
}
fn empty(snapshot: &AttentionBrokerSnapshot) -> bool {
    matches!(&snapshot.state, AttentionBrokerState::Current { permissions, authorizable_reviews } if permissions.is_empty() && authorizable_reviews.is_empty())
}
fn ask(broker: &Arc<PermissionBroker>) -> tokio::task::JoinHandle<AuthorizationOutcome> {
    let broker = Arc::clone(broker);
    tokio::spawn(async move {
        broker
            .authorize(
                "exec_command",
                &[PermissionResource::new(
                    "execute",
                    "command:[curl][example.com]",
                )],
                &ToolCallContext::default(),
                &ThreadCancellation::default(),
            )
            .await
    })
}
async fn pending(broker: &PermissionBroker, count: usize) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while broker.pending().len() != count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn actual_ask_reply_and_abort_publish_content_free_membership_after_every_broker_guard() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    let bus = SessionEventBus::new(Some("session-a".into()));
    let interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus.clone());
    let (observer, initial) = observe(&broker, true);
    assert!(empty(&initial.snapshot));
    assert!(
        observer.snapshots.lock().unwrap().is_empty(),
        "install returns silent baseline"
    );
    let request = ask(&broker);
    pending(&broker, 1).await;
    let id = broker.pending()[0].id.clone();
    assert!(
        matches!(&observer.snapshots.lock().unwrap().last().unwrap().state, AttentionBrokerState::Current { permissions, authorizable_reviews } if permissions == &[Uuid::parse_str(&id).unwrap()] && authorizable_reviews.is_empty())
    );
    broker.reply(&id, PermissionReply::Reject).unwrap();
    assert!(matches!(
        request.await.unwrap(),
        AuthorizationOutcome::Denied(_)
    ));
    assert!(empty(observer.snapshots.lock().unwrap().last().unwrap()));
    let count = observer.snapshots.lock().unwrap().len();
    assert!(broker.reply(&id, PermissionReply::Once).is_err());
    assert_eq!(observer.snapshots.lock().unwrap().len(), count);
    let request = ask(&broker);
    pending(&broker, 1).await;
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    assert!(broker.pending().is_empty());
    assert!(empty(observer.snapshots.lock().unwrap().last().unwrap()));
    drop(interactive);
    assert!(!bus.has_interactive_subscribers());
    assert!(!bus.has_subscribers());
    broker.remove_attention_observer(initial.registration);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[tokio::test]
async fn passive_install_does_not_make_headless_ask_interactive_or_change_denial() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    let bus = SessionEventBus::new(Some("session-a".into()));
    broker.attach_event_bus(bus.clone());
    let (observer, _) = observe(&broker, true);
    assert!(
        matches!(ask(&broker).await.unwrap(), AuthorizationOutcome::Denied(reason) if reason.contains("no interactive"))
    );
    assert!(observer.snapshots.lock().unwrap().is_empty());
    assert!(!bus.has_interactive_subscribers());
    assert!(!bus.has_subscribers());
    assert!(broker.pending().is_empty());
    assert!(broker.grants().unwrap().is_empty());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[tokio::test]
async fn snapshot_install_uses_current_membership_and_stale_remove_cannot_detach_replacement() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    let bus = SessionEventBus::new(Some("session-a".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let request = ask(&broker);
    pending(&broker, 1).await;
    let (first, initial) = observe(&broker, true);
    assert!(!empty(&initial.snapshot));
    let replacement = Arc::new(Recorder {
        broker: Arc::downgrade(&broker),
        check_locks: true,
        snapshots: StdMutex::new(Vec::new()),
    });
    let erased: Arc<dyn BrokerAttentionObserver> = replacement.clone();
    assert!(broker
        .replace_attention_observer(None, Arc::downgrade(&erased))
        .is_none());
    let next = broker
        .replace_attention_observer(Some(initial.registration), Arc::downgrade(&erased))
        .unwrap();
    assert_eq!(initial.snapshot.owner, next.snapshot.owner);
    broker.remove_attention_observer(initial.registration);
    request.abort();
    request.await.unwrap_err();
    assert!(first.snapshots.lock().unwrap().is_empty());
    assert!(empty(replacement.snapshots.lock().unwrap().last().unwrap()));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_pending_overflow_only_invalidates_observation_and_never_rejects_waiters() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    let bus = SessionEventBus::new(Some("session-a".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let (observer, initial) = observe(&broker, false);
    let mut requests = Vec::new();
    for count in 1..=MAX_DECISIONS + 1 {
        requests.push(ask(&broker));
        pending(&broker, count).await;
    }
    assert_eq!(broker.pending().len(), MAX_DECISIONS + 1);
    assert!(requests.iter().all(|request| !request.is_finished()));
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let overflowed = observer
                .snapshots
                .lock()
                .unwrap()
                .last()
                .is_some_and(|snapshot| {
                    matches!(
                        snapshot.state,
                        AttentionBrokerState::Unavailable(AttentionUnavailable::Capacity)
                    )
                });
            if overflowed {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    broker.remove_attention_observer(initial.registration);
    for request in requests {
        request.abort();
        let _ = request.await;
    }
    assert!(broker.pending().is_empty());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn exhausted_metadata_revision_and_callback_failure_preserve_real_permission_authority() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    let bus = SessionEventBus::new(Some("session-a".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    broker.attention.lock().unwrap().revision = u64::MAX;
    let (observer, installed) = observe(&broker, true);
    let request = ask(&broker);
    pending(&broker, 1).await;
    assert!(matches!(
        observer.snapshots.lock().unwrap().last().unwrap().state,
        AttentionBrokerState::Unavailable(AttentionUnavailable::SourceGap)
    ));
    let id = broker.pending()[0].id.clone();
    broker.reply(&id, PermissionReply::Reject).unwrap();
    assert!(matches!(
        request.await.unwrap(),
        AuthorizationOutcome::Denied(_)
    ));
    broker.remove_attention_observer(installed.registration);
    struct Panics;
    impl BrokerAttentionObserver for Panics {
        fn broker_changed(&self, _: Uuid, _: AttentionBrokerSnapshot) {
            panic!("observation-only fixture failure");
        }
    }
    let observer: Arc<dyn BrokerAttentionObserver> = Arc::new(Panics);
    broker
        .replace_attention_observer(None, Arc::downgrade(&observer))
        .unwrap();
    let request = ask(&broker);
    pending(&broker, 1).await;
    let id = broker.pending()[0].id.clone();
    assert!(!request.is_finished());
    assert!(broker.attention.lock().unwrap().registration.is_none());
    broker.reply(&id, PermissionReply::Reject).unwrap();
    assert!(matches!(
        request.await.unwrap(),
        AuthorizationOutcome::Denied(_)
    ));
    assert!(broker.grants().unwrap().is_empty());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_ask_racing_atomic_install_is_in_the_baseline_or_a_newer_callback() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    let bus = SessionEventBus::new(Some("session-a".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let observer = Arc::new(Recorder {
        broker: Arc::downgrade(&broker),
        check_locks: false,
        snapshots: StdMutex::new(Vec::new()),
    });
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let installing = {
        let broker = Arc::clone(&broker);
        let barrier = Arc::clone(&barrier);
        let erased: Arc<dyn BrokerAttentionObserver> = observer.clone();
        tokio::task::spawn_blocking(move || {
            barrier.wait();
            broker
                .replace_attention_observer(None, Arc::downgrade(&erased))
                .unwrap()
        })
    };
    let request = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            barrier.wait();
            broker
                .authorize(
                    "exec_command",
                    &[PermissionResource::new(
                        "execute",
                        "command:[curl][example.com]",
                    )],
                    &ToolCallContext::default(),
                    &ThreadCancellation::default(),
                )
                .await
        })
    };
    let installed = installing.await.unwrap();
    pending(&broker, 1).await;
    let id = Uuid::parse_str(&broker.pending()[0].id).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let includes = |snapshot: &AttentionBrokerSnapshot| matches!(&snapshot.state, AttentionBrokerState::Current { permissions, .. } if permissions.contains(&id));
            if includes(&installed.snapshot) || observer.snapshots.lock().unwrap().iter().any(includes) { break; }
            tokio::task::yield_now().await;
        }
    }).await.unwrap();
    broker.remove_attention_observer(installed.registration);
    request.abort();
    let _ = request.await;
    assert!(broker.pending().is_empty());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
