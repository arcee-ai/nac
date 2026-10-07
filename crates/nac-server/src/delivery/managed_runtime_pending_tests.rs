//! Actual enrolled TLS owners paired with disposable delivered SQLite Pending.
use super::*;
use nac_core::store::{
    self, ActiveRuntimeLease, ManagedRuntimeObservation, RuntimeChallengeSpec, RuntimeLeaseBinding,
    RuntimeLeaseReservationOutcome, RuntimeLeaseResponse, RuntimeLeaseSnapshot,
};
use rusqlite::Connection;
use std::future::Future;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;

struct ConnectionOwner {
    peer: AuthenticatedIssuerControlPeer,
    socket: Option<tokio_rustls::client::TlsStream<TcpStream>>,
    io: Option<JoinHandle<std::io::Result<usize>>>,
}

impl ConnectionOwner {
    async fn new() -> Self {
        let (mut stream, socket) = super::super::channel_tests::connected_stream().await;
        let peer = stream.peer();
        // Poll the actual accepted stream, as the future canonical dialog loop
        // must do; an unpolled socket cannot independently detect client EOF.
        let io = tokio::spawn(async move {
            let mut byte = [0];
            stream.read(&mut byte).await
        });
        Self {
            peer,
            socket: Some(socket),
            io: Some(io),
        }
    }

    async fn disconnect(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            socket.shutdown().await.unwrap();
        }
        tokio::time::timeout(Duration::from_secs(2), self.peer.wait_for_close())
            .await
            .unwrap();
        assert_eq!(self.io.take().unwrap().await.unwrap().unwrap(), 0);
    }

    async fn finish(mut self) {
        if let Some(mut socket) = self.socket.take() {
            socket.shutdown().await.unwrap();
        }
        if let Some(io) = self.io.take() {
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), io)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap(),
                0
            );
        }
    }
}

impl Drop for ConnectionOwner {
    fn drop(&mut self) {
        if let Some(io) = self.io.take() {
            io.abort();
        }
    }
}

struct Fixture {
    root: PathBuf,
    path: PathBuf,
    store: Arc<StoreCoordinator>,
    binding: RuntimeLeaseBinding,
    challenge: RuntimeChallengeSpec,
    pending: Option<PendingRuntimeChallenge>,
}

impl Fixture {
    async fn new(channel_id: Uuid, original_ms: i64, challenge_ms: i64) -> Self {
        let root = std::env::temp_dir().join(format!("nac-dialog-pending-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("store.db");
        store::initialize(&path).unwrap();
        let store = StoreCoordinator::acquire(&path).unwrap();
        let clock = RuntimeLeaseClock::capture().unwrap();
        // Explicit synthetic native fixture binding; no current facts producer.
        let binding = RuntimeLeaseBinding {
            identity: store::ManagedRuntimeOperationIdentity {
                operation_id: Uuid::new_v4(),
                full_input_sha256: [17; 32],
            },
            assignment_sha256: [18; 32],
            serving_lifetime_id: Uuid::new_v4(),
            original_expires_ms: clock.wall_ms() + original_ms,
        };
        let RuntimeLeaseReservationOutcome::Fresh(fresh) = store
            .reserve_managed_runtime_lease(binding.clone(), clock)
            .await
            .unwrap()
        else {
            panic!("new committed and delivered fixture reservation")
        };
        let challenge = RuntimeChallengeSpec {
            channel_id,
            challenge_sha256: [19; 32],
            expires_ms: clock.wall_ms() + challenge_ms,
        };
        let pending = store
            .challenge_managed_runtime_initial(
                fresh,
                challenge.clone(),
                RuntimeLeaseClock::capture().unwrap(),
            )
            .await
            .unwrap();
        Self {
            root,
            path,
            store,
            binding,
            challenge,
            pending: Some(pending),
        }
    }

    fn pending(&self) -> &PendingRuntimeChallenge {
        self.pending.as_ref().unwrap()
    }

    fn challenge_row(&self) -> (String, String, String, i64, String) {
        Connection::open(&self.path)
            .unwrap()
            .query_row(
                "SELECT reservation_id, channel_id, challenge_sha256, challenge_expires_ms, phase
             FROM managed_runtime_leases WHERE operation_id = ?1",
                [self.binding.identity.operation_id.to_string()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap()
    }

    fn phase(&self) -> String {
        Connection::open(&self.path)
            .unwrap()
            .query_row(
                "SELECT phase FROM managed_runtime_leases WHERE operation_id = ?1",
                [self.binding.identity.operation_id.to_string()],
                |row| row.get(0),
            )
            .unwrap()
    }

    async fn duplicate(&self) {
        assert!(matches!(
            self.store
                .reserve_managed_runtime_lease(
                    self.binding.clone(),
                    RuntimeLeaseClock::capture().unwrap(),
                )
                .await
                .unwrap(),
            RuntimeLeaseReservationOutcome::Readback(_)
        ));
    }

    async fn consume(&mut self) -> ActiveRuntimeLease {
        let clock = RuntimeLeaseClock::capture().unwrap();
        self.store
            .consume_managed_runtime_challenge(
                self.pending.take().unwrap(),
                RuntimeLeaseResponse {
                    channel_id: self.challenge.channel_id,
                    challenge_sha256: self.challenge.challenge_sha256,
                    lease: RuntimeLeaseSnapshot {
                        lease_id: Uuid::new_v4(),
                        sequence: 1,
                        expires_ms: clock.wall_ms() + 20_000,
                    },
                    observed_ms: clock.wall_ms(),
                },
                clock,
            )
            .await
            .unwrap()
    }

    async fn finish(self) {
        self.store.shutdown().await.unwrap();
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

fn hold_transaction(fixture: &Fixture) -> Connection {
    let connection = Connection::open(&fixture.path).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    connection
}

async fn wait_store_execution(store: &StoreCoordinator) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while store.stats().executing == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(store.stats().executing, 1);
}

#[tokio::test]
async fn dialog_pending_same_original_repeats_reject_wrong_pair_and_readback() {
    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let mut fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let row = fixture.challenge_row();
    for _ in 0..3 {
        assert!(dialog
            .initial_pending_available(fixture.pending(), &fixture.store)
            .await
            .unwrap());
        assert_eq!(fixture.challenge_row(), row);
        fixture.duplicate().await;
    }
    let wrong = ConnectionOwner::new().await;
    let wrong_dialog = wrong.peer.claim_dialog().unwrap();
    assert!(!wrong_dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    assert_eq!(fixture.challenge_row(), row);
    assert!(dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    let active = fixture.consume().await;
    assert!(
        fixture.pending.is_none(),
        "actual consume moves the only Pending"
    );
    assert_eq!(fixture.phase(), "active");
    fixture.duplicate().await;
    let native = ManagedRuntimeObservation::Run {
        session_id: Uuid::new_v4(),
        run_id: Uuid::new_v4(),
    };
    fixture
        .store
        .acknowledge_managed_runtime_operation(fixture.binding.identity.clone(), native.clone())
        .await
        .unwrap();
    let clock = RuntimeLeaseClock::capture().unwrap();
    let renewal = fixture
        .store
        .challenge_managed_runtime_renewal(
            &active,
            native,
            RuntimeChallengeSpec {
                channel_id: connection.peer.channel_id(),
                challenge_sha256: [20; 32],
                expires_ms: clock.wall_ms() + 5_000,
            },
            clock,
        )
        .await
        .unwrap();
    assert!(!dialog
        .initial_pending_available(&renewal, &fixture.store)
        .await
        .unwrap());
    assert_eq!(fixture.phase(), "active");
    drop(renewal);
    drop(active);
    drop(wrong_dialog);
    wrong.finish().await;
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn dialog_pending_actual_eof_drop_and_replacement_never_adopt_old_pending() {
    let mut connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let row = fixture.challenge_row();
    assert!(dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    connection.disconnect().await;
    assert!(dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .is_err());
    let replacement = ConnectionOwner::new().await;
    let next = replacement.peer.claim_dialog().unwrap();
    assert_ne!(replacement.peer.channel_id(), connection.peer.channel_id());
    assert!(!next
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    assert_eq!(fixture.challenge_row(), row);
    drop(next);
    replacement.finish().await;
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;

    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    drop(dialog);
    assert!(connection.peer.check_live().is_err());
    assert!(connection.peer.claim_dialog().is_err());
    assert!(
        fixture
            .store
            .check_managed_runtime_initial_pending(
                fixture.pending(),
                RuntimeLeaseClock::capture().unwrap(),
            )
            .await
            .unwrap(),
        "store observation alone cannot prove the dropped dialog"
    );
    connection.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn dialog_pending_close_races_actual_store_transaction_wait() {
    let mut connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let gate = hold_transaction(&fixture);
    let mut observing =
        Box::pin(dialog.initial_pending_available(fixture.pending(), &fixture.store));
    std::future::poll_fn(|cx| {
        assert!(observing.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    wait_store_execution(&fixture.store).await;
    let before = fixture.store.stats();
    let mut queued = Box::pin(dialog.initial_pending_available(fixture.pending(), &fixture.store));
    std::future::poll_fn(|cx| {
        assert!(queued.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert_eq!(fixture.store.stats().queued, 1);
    connection.disconnect().await;
    assert!(
        tokio::time::timeout(Duration::from_millis(500), queued.as_mut())
            .await
            .unwrap()
            .is_err()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(500), observing.as_mut())
            .await
            .unwrap()
            .is_err(),
        "actual close returns before the SQLite wait is released"
    );
    drop(observing);
    drop(queued);
    gate.execute_batch("ROLLBACK").unwrap();
    drop(gate);
    fixture.duplicate().await; // executor barrier after any admitted observation
    assert_eq!(
        fixture.store.stats().cancelled_before_execution,
        before.cancelled_before_execution + 1
    );
    assert_eq!(fixture.phase(), "challenged");
    assert!(dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .is_err());
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn dialog_pending_dropped_observer_keeps_original_owner_without_consumption() {
    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let mut fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let row = fixture.challenge_row();
    let gate = hold_transaction(&fixture);
    let mut observing =
        Box::pin(dialog.initial_pending_available(fixture.pending(), &fixture.store));
    std::future::poll_fn(|cx| {
        assert!(observing.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    wait_store_execution(&fixture.store).await;
    let before = fixture.store.stats();
    drop(observing);
    gate.execute_batch("ROLLBACK").unwrap();
    drop(gate);
    fixture.duplicate().await;
    assert_eq!(
        fixture.store.stats().acknowledgements_lost,
        before.acknowledgements_lost + 1
    );
    assert_eq!(fixture.challenge_row(), row);
    connection.peer.check_live().unwrap();
    assert!(dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    let active = fixture.consume().await;
    fixture.duplicate().await;
    assert_eq!(fixture.phase(), "active");
    assert!(fixture
        .store
        .check_managed_runtime_lease(&active, RuntimeLeaseClock::capture().unwrap())
        .await
        .unwrap());
    drop(active);
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn dialog_pending_task_abort_closes_actual_owner_and_lost_pending_is_readback_only() {
    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let mut fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let gate = hold_transaction(&fixture);
    let pending = fixture.pending.take().unwrap();
    let store = fixture.store.clone();
    let (polled, did_poll) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let mut observing = Box::pin(dialog.initial_pending_available(&pending, &store));
        std::future::poll_fn(|cx| {
            assert!(observing.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        polled.send(()).unwrap();
        observing.await
    });
    did_poll.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(connection.peer.check_live().is_err());
    assert!(connection.peer.claim_dialog().is_err());
    gate.execute_batch("ROLLBACK").unwrap();
    drop(gate);
    fixture.duplicate().await;
    assert_eq!(fixture.phase(), "challenged");
    connection.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn dialog_pending_original_expiry_after_transaction_wait_and_terminal_stay_closed() {
    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let fixture = Fixture::new(connection.peer.channel_id(), 1_000, 1_000).await;
    let gate = hold_transaction(&fixture);
    let mut observing =
        Box::pin(dialog.initial_pending_available(fixture.pending(), &fixture.store));
    std::future::poll_fn(|cx| {
        assert!(observing.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    wait_store_execution(&fixture.store).await;
    let remaining =
        fixture.binding.original_expires_ms - RuntimeLeaseClock::capture().unwrap().wall_ms();
    if remaining > 0 {
        tokio::time::sleep(Duration::from_millis(remaining as u64 + 10)).await;
    }
    gate.execute_batch("ROLLBACK").unwrap();
    drop(gate);
    assert!(!observing.await.unwrap());
    assert_eq!(fixture.phase(), "terminal");
    assert!(!dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    fixture.duplicate().await;
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;

    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    fixture
        .store
        .terminate_managed_runtime_lease(fixture.binding.clone())
        .await
        .unwrap();
    assert!(!dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    assert_eq!(fixture.phase(), "terminal");
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;
}

#[tokio::test]
async fn dialog_pending_wrong_selected_store_never_adopts_another_reservation() {
    let connection = ConnectionOwner::new().await;
    let dialog = connection.peer.claim_dialog().unwrap();
    let fixture = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let other = Fixture::new(connection.peer.channel_id(), 30_000, 10_000).await;
    let original = fixture.challenge_row();
    let unrelated = other.challenge_row();
    assert!(dialog
        .initial_pending_available(fixture.pending(), &other.store)
        .await
        .is_err());
    assert_eq!(fixture.challenge_row(), original);
    assert_eq!(other.challenge_row(), unrelated);
    assert!(dialog
        .initial_pending_available(fixture.pending(), &fixture.store)
        .await
        .unwrap());
    assert!(dialog
        .initial_pending_available(other.pending(), &other.store)
        .await
        .unwrap());
    drop(dialog);
    connection.finish().await;
    fixture.finish().await;
    other.finish().await;
}
