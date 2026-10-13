use super::*;
use std::io;
use std::sync::{Arc, Mutex};

struct BlockedWriter {
    started: SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
    bytes: Arc<Mutex<Vec<u8>>>,
    blocked: bool,
}

impl Write for BlockedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if !self.blocked {
            self.blocked = true;
            self.started.send(()).unwrap();
            let _ = self.release.recv();
        }
        self.bytes.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn blocked_delivery_has_bounded_fifo_capacity_and_does_not_hold_cancellation() {
    let (started, started_receiver) = sync_channel(1);
    let (release, release_receiver) = sync_channel(1);
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let input = PtyInput::new(
        Box::new(BlockedWriter {
            started,
            release: release_receiver,
            bytes: Arc::clone(&bytes),
            blocked: false,
        }),
        true,
    )
    .unwrap();
    let cancellation = ThreadCancellation::default();
    let first = input.enqueue_user(b"first", &cancellation).unwrap();
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .unwrap();
    let second = input.enqueue_user(b"second", &cancellation).unwrap();
    assert!(input
        .enqueue_user(b"rejected", &cancellation)
        .unwrap_err()
        .to_string()
        .contains("queue is full"));
    // A blocked physical write cannot hold the admission mutation gate.
    cancellation.cancel();
    assert!(input.enqueue_user(b"cancelled", &cancellation).is_err());
    release.send(()).unwrap();
    await_receipt(first).await.unwrap();
    await_receipt(second).await.unwrap();
    assert_eq!(*bytes.lock().unwrap(), b"firstsecond");
}

#[tokio::test]
async fn accepted_input_timeout_reports_uncertainty_without_resending() {
    let (started, started_receiver) = sync_channel(1);
    let (release, release_receiver) = sync_channel(1);
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let input = PtyInput::new(
        Box::new(BlockedWriter {
            started,
            release: release_receiver,
            bytes: Arc::clone(&bytes),
            blocked: false,
        }),
        true,
    )
    .unwrap();
    let receipt = input
        .enqueue_user(b"once", &ThreadCancellation::default())
        .unwrap();
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .unwrap();
    assert!(await_receipt(receipt)
        .await
        .unwrap_err()
        .to_string()
        .contains("delivery is unconfirmed"));
    release.send(()).unwrap();
    let final_receipt = input
        .enqueue_user(b"end", &ThreadCancellation::default())
        .unwrap();
    await_receipt(final_receipt).await.unwrap();
    assert_eq!(*bytes.lock().unwrap(), b"onceend");
}

#[tokio::test]
async fn reclaim_fences_queued_and_future_packets_at_actual_writer_admission() {
    let (started, started_receiver) = sync_channel(1);
    let (release, release_receiver) = sync_channel(1);
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let input = PtyInput::new(
        Box::new(BlockedWriter {
            started,
            release: release_receiver,
            bytes: Arc::clone(&bytes),
            blocked: false,
        }),
        false,
    )
    .unwrap();
    let ticket = input
        .control
        .ticket("process", InputController::Agent)
        .unwrap();
    let cancellation = ThreadCancellation::default();
    let first = input
        .enqueue(b"in-flight", ticket.clone(), &cancellation)
        .unwrap();
    // This barrier is inside Write::write: acceptance alone is insufficient.
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .unwrap();
    let queued = input
        .enqueue(b"stale-queued", ticket.clone(), &cancellation)
        .unwrap();
    let reclaimed = input
        .control
        .transfer(1, InputController::Human, false)
        .unwrap();
    assert!(reclaimed.in_flight && reclaimed.frozen);
    assert_eq!(reclaimed.revision, "2");
    assert!(input
        .enqueue(b"stale-future", ticket, &cancellation)
        .is_err());
    assert!(input
        .control
        .transfer(1, InputController::Agent, false)
        .is_err());
    assert!(input
        .control
        .transfer(2, InputController::Human, true)
        .is_err());
    release.send(()).unwrap();
    await_receipt(first).await.unwrap();
    assert!(await_receipt(queued)
        .await
        .unwrap_err()
        .to_string()
        .contains("not written"));
    assert_eq!(*bytes.lock().unwrap(), b"in-flight");
    input
        .control
        .transfer(2, InputController::Human, true)
        .unwrap();
    // Human strings stay literal. This layer never interprets model key names.
    let fresh = input
        .enqueue_user(
            "<RET> λ\u{1b}[200~paste\u{1b}[201~".as_bytes(),
            &cancellation,
        )
        .unwrap();
    await_receipt(fresh).await.unwrap();
    assert_eq!(
        *bytes.lock().unwrap(),
        "in-flight<RET> λ\u{1b}[200~paste\u{1b}[201~".as_bytes()
    );
}

#[tokio::test]
async fn stop_rejects_queued_input_and_same_controller_handoff_advances_revision() {
    let (started, started_receiver) = sync_channel(1);
    let (release, release_receiver) = sync_channel(1);
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let input = PtyInput::new(
        Box::new(BlockedWriter {
            started,
            release: release_receiver,
            bytes: Arc::clone(&bytes),
            blocked: false,
        }),
        true,
    )
    .unwrap();
    let first = input
        .enqueue_user(b"once", &ThreadCancellation::default())
        .unwrap();
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .unwrap();
    let queued = input
        .enqueue_user(b"never", &ThreadCancellation::default())
        .unwrap();
    input.control.stop();
    release.send(()).unwrap();
    await_receipt(first).await.unwrap();
    assert!(await_receipt(queued).await.is_err());
    assert_eq!(*bytes.lock().unwrap(), b"once");
    let control = InputControl::new(InputController::Human);
    let old = control
        .ticket("incarnation", InputController::Human)
        .unwrap();
    control.transfer(1, InputController::Human, false).unwrap();
    assert!(control.validate(&old).is_err());
}

#[tokio::test]
async fn queued_packet_rechecks_root_liveness_at_the_writer_boundary() {
    let (started, started_receiver) = sync_channel(1);
    let (release, release_receiver) = sync_channel(1);
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let input = PtyInput::new(
        Box::new(BlockedWriter {
            started,
            release: release_receiver,
            bytes: bytes.clone(),
            blocked: false,
        }),
        true,
    )
    .unwrap();
    let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let observed = alive.clone();
    input.control.bind_liveness(Arc::new(move || {
        observed.load(std::sync::atomic::Ordering::SeqCst)
    }));
    let first = input
        .enqueue_user(b"in-flight", &ThreadCancellation::default())
        .unwrap();
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .unwrap();
    let queued = input
        .enqueue_user(b"after-exit", &ThreadCancellation::default())
        .unwrap();
    alive.store(false, std::sync::atomic::Ordering::SeqCst);
    release.send(()).unwrap();
    assert_eq!(
        await_delivery(first).await.outcome,
        super::super::InputDeliveryOutcome::Written
    );
    assert_eq!(
        await_delivery(queued).await.outcome,
        super::super::InputDeliveryOutcome::Rejected
    );
    assert_eq!(*bytes.lock().unwrap(), b"in-flight");
}
