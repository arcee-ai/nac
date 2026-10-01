use super::*;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::Duration;

struct Gate {
    entered: Sender<std::thread::ThreadId>,
    release: Receiver<()>,
}
impl PersistenceCommand for Gate {
    type Output = ();
    fn correlation(&self) -> Correlation {
        Correlation::default()
    }
    fn execute(self, _: &Path) -> Result<()> {
        self.entered.send(std::thread::current().id())?;
        self.release.recv_timeout(Duration::from_secs(5))?;
        Ok(())
    }
}

struct Record {
    ordinal: usize,
    output: Arc<Mutex<Vec<usize>>>,
}
impl PersistenceCommand for Record {
    type Output = usize;
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, _: &Path) -> Result<usize> {
        self.output.lock().unwrap().push(self.ordinal);
        Ok(self.ordinal)
    }
}

fn path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("nac_coordinator_{}", uuid::Uuid::new_v4()))
        .join("store.db")
}

pub(super) fn block_executor(
    owner: &StoreCoordinator,
) -> (PendingPersistence<()>, Sender<()>, std::thread::ThreadId) {
    let (entered, observed) = channel();
    let (release, wait) = channel();
    let pending = owner
        .submit(Gate {
            entered,
            release: wait,
        })
        .unwrap();
    let thread = observed.recv_timeout(Duration::from_secs(5)).unwrap();
    (pending, release, thread)
}

#[tokio::test(flavor = "current_thread")]
async fn saturation_rejects_without_waiting_and_fifo_drains() {
    let path = path();
    let lease = StoreProcessLease::try_acquire(&path).unwrap();
    let owner = StoreCoordinator::start(path.clone(), Some(lease), 2).unwrap();
    let (gate, release, executor) = block_executor(&owner);
    assert_ne!(executor, std::thread::current().id());
    let output = Arc::new(Mutex::new(Vec::new()));
    let first = owner
        .submit(Record {
            ordinal: 1,
            output: output.clone(),
        })
        .unwrap();
    let second = owner
        .submit(Record {
            ordinal: 2,
            output: output.clone(),
        })
        .unwrap();
    let error = owner
        .submit(Record {
            ordinal: 3,
            output: output.clone(),
        })
        .err()
        .unwrap();
    assert_eq!(
        error.downcast_ref::<PersistenceAdmissionError>(),
        Some(&PersistenceAdmissionError::Overloaded)
    );
    let stats = owner.stats();
    assert_eq!((stats.queued, stats.executing, stats.rejected), (2, 1, 1));
    // A current-thread runtime still drives timers while SQLite's executor is
    // blocked. There is no spawn_blocking task pile waiting for queue admission.
    tokio::time::timeout(
        Duration::from_secs(1),
        tokio::time::sleep(Duration::from_millis(5)),
    )
    .await
    .unwrap();
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    assert_eq!(first.acknowledge().await.unwrap(), 1);
    assert_eq!(second.acknowledge().await.unwrap(), 2);
    owner.shutdown().await.unwrap();
    assert_eq!(*output.lock().unwrap(), vec![1, 2]);
    assert_eq!(owner.stats().completed, 3);
    assert_eq!(owner.stats().queued, 0);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn cancellation_before_execution_does_not_mutate() {
    let path = path();
    let owner = StoreCoordinator::start(path.clone(), None, 1).unwrap();
    let (gate, release, _) = block_executor(&owner);
    let output = Arc::new(Mutex::new(Vec::new()));
    drop(
        owner
            .submit(Record {
                ordinal: 1,
                output: output.clone(),
            })
            .unwrap(),
    );
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    owner.shutdown().await.unwrap();
    assert!(output.lock().unwrap().is_empty());
    assert_eq!(owner.stats().cancelled_before_execution, 1);
}

#[tokio::test(flavor = "current_thread")]
async fn lost_ack_after_execution_is_distinct_from_cancel_before_execution() {
    let path = path();
    let owner = StoreCoordinator::start(path.clone(), None, 1).unwrap();
    let (gate, release, _) = block_executor(&owner);
    drop(gate);
    release.send(()).unwrap();
    owner.shutdown().await.unwrap();
    assert_eq!(owner.stats().completed, 1);
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    assert_eq!(owner.stats().cancelled_before_execution, 0);
}

#[tokio::test(flavor = "current_thread")]
async fn shutdown_rejects_admission_and_retains_ownership_until_drain() {
    let path = path();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    owner.initialize().await.unwrap();
    let (gate, release, _) = block_executor(&owner);
    let mut shutdown = Box::pin(owner.shutdown());
    assert!(
        tokio::time::timeout(Duration::from_millis(5), &mut shutdown)
            .await
            .is_err()
    );
    let output = Arc::new(Mutex::new(Vec::new()));
    let error = owner.submit(Record { ordinal: 1, output }).err().unwrap();
    assert_eq!(
        error.downcast_ref::<PersistenceAdmissionError>(),
        Some(&PersistenceAdmissionError::ShuttingDown)
    );
    assert!(StoreProcessLease::try_acquire(&path).is_err());
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    shutdown.await.unwrap();
    let replacement = StoreCoordinator::acquire(&path).unwrap();
    replacement.initialize().await.unwrap();
    replacement.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn dropping_owner_drains_accepted_work_before_releasing_lease() {
    let path = path();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let (gate, release, _) = block_executor(&owner);
    drop(owner);
    assert!(StoreProcessLease::try_acquire(&path).is_err());
    let error = crate::store::check_readiness(&path).unwrap_err();
    assert_eq!(
        error.downcast_ref::<PersistenceAdmissionError>(),
        Some(&PersistenceAdmissionError::ShuttingDown)
    );
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    // Drain publishes only after releasing the lease; ack can precede that.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(lease) = StoreProcessLease::try_acquire(&path) {
                drop(lease);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn queue_capacity_fails_closed_before_executor_start() {
    for capacity in [0, MAX_QUEUE_CAPACITY + 1] {
        assert!(StoreCoordinator::start(path(), None, capacity).is_err());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn executor_panic_fails_closed_drains_pending_callers_and_preserves_uncertain_commit() {
    struct PanicAfterCommit;
    impl PersistenceCommand for PanicAfterCommit {
        type Output = ();
        fn correlation(&self) -> Correlation {
            Correlation::session(Some("session"))
        }
        fn execute(self, path: &Path) -> Result<()> {
            crate::store::insert_test_session(path, "session");
            crate::store::create_session_inbox_item(
                path,
                "session",
                crate::store::InboxDelivery::Queue,
                "committed before executor panic",
                None,
                None,
            )?;
            panic!("injected executor failure after commit");
        }
    }
    let path = path();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    owner.initialize().await.unwrap();
    let (gate, release, _) = block_executor(&owner);
    let failure = owner.submit(PanicAfterCommit).unwrap();
    let output = Arc::new(Mutex::new(Vec::new()));
    let unexecuted = owner
        .submit(Record {
            ordinal: 9,
            output: output.clone(),
        })
        .unwrap();
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    for error in [
        failure.acknowledge().await.unwrap_err(),
        unexecuted.acknowledge().await.unwrap_err(),
        owner.shutdown().await.unwrap_err(),
    ] {
        assert_eq!(
            error.downcast_ref::<PersistenceAdmissionError>(),
            Some(&PersistenceAdmissionError::ExecutorStopped)
        );
    }
    assert!(output.lock().unwrap().is_empty());
    assert_eq!((owner.stats().queued, owner.stats().executing), (0, 0));
    assert_eq!(owner.stats().cancelled_before_execution, 1);
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    let restarted = StoreCoordinator::acquire(&path).unwrap();
    let retained = restarted
        .list_session_inbox("session".into())
        .await
        .unwrap();
    assert_eq!(retained.len(), 1);
    assert_eq!(retained[0].content, "committed before executor panic");
    restarted.shutdown().await.unwrap();
    drop(restarted);
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
