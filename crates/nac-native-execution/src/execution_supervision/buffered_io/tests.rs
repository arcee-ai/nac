use super::*;
use nac_process::peer_channel::{self, PeerConnection, PeerLifetime};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    task::{Wake, Waker},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
};

fn captured() -> (PeerConnection, PeerLifetime, UnixStream) {
    let (stream, other) = UnixStream::pair().unwrap();
    let (connection, owner) =
        peer_channel::capture(stream, Instant::now() + Duration::from_secs(3)).unwrap();
    (connection, owner, other)
}

fn guarded<T>(inner: T, connection: &PeerConnection, owner: &PeerLifetime) -> Guarded<T> {
    Guarded::new(
        inner,
        connection.io_gate(),
        owner.denial_handle(),
        owner.original_cutoff(),
    )
}

#[tokio::test]
async fn queued_duplex_bytes_are_inert_after_either_unique_owner_drops() {
    for drop_connection in [false, true] {
        let (connection, owner, _other) = captured();
        let (mut producer, buffered) = tokio::io::duplex(32);
        producer.write_all(b"stale buffered bytes").await.unwrap();
        let mut reader = guarded(buffered, &connection, &owner);
        if drop_connection {
            drop(connection);
        } else {
            drop(owner);
        }
        // The duplex still has bytes and an open writer; shutdown alone would
        // allow them to drain. The actual weak physical check refuses them.
        let mut output = [0; 32];
        assert_eq!(
            reader.read(&mut output).await.unwrap_err().kind(),
            io::ErrorKind::BrokenPipe
        );
        assert_eq!(output, [0; 32]);
    }
}

struct DenyOnRead(PeerDenial);
impl AsyncRead for DenyOnRead {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        output.put_slice(b"stale");
        self.0.deny();
        Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn denial_during_inner_read_cannot_publish_any_new_filled_bytes() {
    let (connection, owner, _other) = captured();
    let mut reader = guarded(DenyOnRead(owner.denial_handle()), &connection, &owner);
    let mut bytes = [0; 32];
    let mut output = ReadBuf::new(&mut bytes);
    output.put_slice(b"kept");
    let waker = Waker::noop();
    let mut cx = Context::from_waker(waker);
    assert!(matches!(
        Pin::new(&mut reader).poll_read(&mut cx, &mut output),
        Poll::Ready(Err(_))
    ));
    assert_eq!(output.filled(), b"kept");
    assert!(owner.check_current().is_err());
}

#[derive(Default)]
struct WakeCount(AtomicUsize);
impl Wake for WakeCount {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn pending_buffered_read_and_full_write_wake_on_actual_owner_denial() {
    for writing in [false, true] {
        let (connection, owner, _other) = captured();
        let (mut buffered, _held) = tokio::io::duplex(1);
        if writing {
            buffered.write_all(b"x").await.unwrap();
        }
        let mut stream = guarded(buffered, &connection, &owner);
        let wakes = Arc::new(WakeCount::default());
        let waker = Waker::from(Arc::clone(&wakes));
        let mut cx = Context::from_waker(&waker);
        let mut bytes = [0; 1];
        if writing {
            assert!(Pin::new(&mut stream).poll_write(&mut cx, b"y").is_pending());
        } else {
            assert!(Pin::new(&mut stream)
                .poll_read(&mut cx, &mut ReadBuf::new(&mut bytes))
                .is_pending());
        }
        owner.deny();
        assert!(wakes.0.load(Ordering::SeqCst) > 0);
        if writing {
            assert!(matches!(
                Pin::new(&mut stream).poll_write(&mut cx, b"y"),
                Poll::Ready(Err(_))
            ));
        } else {
            assert!(matches!(
                Pin::new(&mut stream).poll_read(&mut cx, &mut ReadBuf::new(&mut bytes)),
                Poll::Ready(Err(_))
            ));
        }
    }
}

async fn both_pending_directions_are_woken(deny: bool) {
    let (connection, owner, _other) = captured();
    let (mut buffered, _held) = tokio::io::duplex(1);
    buffered.write_all(b"x").await.unwrap();
    let cutoff = if deny {
        owner.original_cutoff()
    } else {
        Instant::now() + Duration::from_millis(100)
    };
    let stream = Guarded::new(
        buffered,
        connection.io_gate(),
        owner.denial_handle(),
        cutoff,
    );
    let (mut reader, mut writer) = tokio::io::split(stream);
    let read_wakes = Arc::new(WakeCount::default());
    let write_wakes = Arc::new(WakeCount::default());
    let read_waker = Waker::from(Arc::clone(&read_wakes));
    let write_waker = Waker::from(Arc::clone(&write_wakes));
    let mut read_cx = Context::from_waker(&read_waker);
    let mut write_cx = Context::from_waker(&write_waker);
    let mut bytes = [0; 1];
    assert!(Pin::new(&mut reader)
        .poll_read(&mut read_cx, &mut ReadBuf::new(&mut bytes))
        .is_pending());
    assert!(Pin::new(&mut writer)
        .poll_write(&mut write_cx, b"y")
        .is_pending());
    if deny {
        owner.deny();
    } else {
        tokio::time::sleep_until((cutoff + Duration::from_millis(10)).into()).await;
    }
    assert!(
        read_wakes.0.load(Ordering::SeqCst) > 0,
        "pending reader lost its invalidation/cutoff waker"
    );
    assert!(
        write_wakes.0.load(Ordering::SeqCst) > 0,
        "pending writer lost its invalidation/cutoff waker"
    );
    assert!(matches!(
        Pin::new(&mut writer).poll_write(&mut write_cx, b"y"),
        Poll::Ready(Err(_))
    ));
    assert!(matches!(
        Pin::new(&mut reader).poll_read(&mut read_cx, &mut ReadBuf::new(&mut bytes)),
        Poll::Ready(Err(_))
    ));
}

#[tokio::test]
async fn simultaneous_pending_read_and_write_keep_distinct_denial_wakers() {
    both_pending_directions_are_woken(true).await;
}

#[tokio::test]
async fn simultaneous_pending_read_and_write_keep_distinct_cutoff_wakers() {
    both_pending_directions_are_woken(false).await;
}

#[tokio::test]
async fn original_job_deadline_wakes_a_pending_read_and_denies_the_actual_peer() {
    let (connection, owner, _other) = captured();
    let (buffered, _held) = tokio::io::duplex(1);
    let cutoff = Instant::now() + Duration::from_millis(40);
    let mut reader = Guarded::new(
        buffered,
        connection.io_gate(),
        owner.denial_handle(),
        cutoff,
    );
    let mut output = [0; 1];
    let result = tokio::time::timeout(Duration::from_millis(500), reader.read(&mut output))
        .await
        .unwrap();
    assert_eq!(result.unwrap_err().kind(), io::ErrorKind::BrokenPipe);
    assert!(Instant::now() >= cutoff);
    assert!(owner.check_current().is_err());
}

struct DenyOnWrite {
    denial: PeerDenial,
    writes: Arc<AtomicUsize>,
}
impl AsyncWrite for DenyOnWrite {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        input: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.denial.deny();
        Poll::Ready(Ok(input.len()))
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn denial_during_write_cannot_report_success_or_start_another_operation() {
    let (connection, owner, _other) = captured();
    let writes = Arc::new(AtomicUsize::new(0));
    let inner = DenyOnWrite {
        denial: owner.denial_handle(),
        writes: Arc::clone(&writes),
    };
    let mut writer = guarded(inner, &connection, &owner);
    assert!(writer.write_all(b"x").await.is_err());
    assert!(writer.write_all(b"y").await.is_err());
    assert!(writer.flush().await.is_err());
    assert!(writer.shutdown().await.is_err());
    assert_eq!(writes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_buffered_poll_preserves_bytes_and_bounds_delivery_independently_of_capture() {
    let (connection, owner, _other) = captured();
    let size = super::super::protocol::MAX_DATA;
    let (mut producer, buffered) = tokio::io::duplex(size * 2);
    producer.write_all(&vec![0xa5; size * 2]).await.unwrap();
    let mut reader = guarded(buffered, &connection, &owner);
    let mut output = vec![0; size * 2];
    assert_eq!(reader.read(&mut output).await.unwrap(), size);
    assert_eq!(&output[..size], &vec![0xa5; size]);
    assert_eq!(&output[size..], &vec![0; size]);
    assert_eq!(reader.read(&mut output[size..]).await.unwrap(), size);
    assert!(output.iter().all(|b| *b == 0xa5));
}

// A caller clone callback may reenter peer denial. It must execute before the
// internal Notified poll takes any notification lock.
struct CloneDenial(PeerDenial);
unsafe fn clone_deny(ptr: *const ()) -> std::task::RawWaker {
    let owner = std::mem::ManuallyDrop::new(unsafe { Arc::<CloneDenial>::from_raw(ptr.cast()) });
    owner.0.deny();
    std::task::RawWaker::new(
        Arc::into_raw(Arc::<CloneDenial>::clone(&owner)).cast(),
        &DENY_VTABLE,
    )
}
unsafe fn drop_deny(ptr: *const ()) {
    drop(unsafe { Arc::<CloneDenial>::from_raw(ptr.cast()) });
}
unsafe fn wake_deny(ptr: *const ()) {
    unsafe { drop_deny(ptr) };
}
unsafe fn wake_deny_ref(_: *const ()) {}
static DENY_VTABLE: std::task::RawWakerVTable =
    std::task::RawWakerVTable::new(clone_deny, wake_deny, wake_deny_ref, drop_deny);

#[tokio::test]
async fn caller_clone_can_reenter_actual_denial_without_notification_lock_deadlock() {
    let (connection, owner, _other) = captured();
    let (queue, _held) = tokio::io::duplex(1);
    let mut writer = guarded(queue, &connection, &owner);
    let callback = Arc::new(CloneDenial(owner.denial_handle()));
    let waker = unsafe {
        Waker::from_raw(std::task::RawWaker::new(
            Arc::into_raw(callback).cast(),
            &DENY_VTABLE,
        ))
    };
    let mut cx = Context::from_waker(&waker);
    assert!(matches!(
        Pin::new(&mut writer).poll_write(&mut cx, b"late"),
        Poll::Ready(Err(_))
    ));
    assert!(owner.check_current().is_err());
}
