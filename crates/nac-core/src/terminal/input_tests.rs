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
