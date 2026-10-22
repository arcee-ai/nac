use super::*;
use std::future::poll_fn;
use std::time::Duration;

async fn read(stream: &mut (impl AsyncRead + Unpin), bytes: &mut [u8]) -> io::Result<usize> {
    let mut buffer = ReadBuf::new(bytes);
    poll_fn(|cx| Pin::new(&mut *stream).poll_read(cx, &mut buffer)).await?;
    Ok(buffer.filled().len())
}

#[cfg(target_os = "linux")]
async fn write(stream: &mut (impl AsyncWrite + Unpin), bytes: &[u8]) {
    let mut offset = 0;
    while offset < bytes.len() {
        let count = poll_fn(|cx| Pin::new(&mut *stream).poll_write(cx, &bytes[offset..]))
            .await
            .unwrap();
        assert_ne!(count, 0);
        offset += count;
    }
}

#[tokio::test]
#[cfg(not(target_os = "linux"))]
async fn unsupported_capture_consumes_stream_and_fails_closed() {
    let (stream, mut peer) = UnixStream::pair().unwrap();
    let result = capture(stream, Instant::now() + Duration::from_secs(1));
    assert!(matches!(result, Err(error) if error.kind() == io::ErrorKind::Unsupported));
    assert_eq!(read(&mut peer, &mut [0]).await.unwrap(), 0);
}

#[cfg(target_os = "linux")]
pub(super) mod supported {
    use super::*;
    use std::os::fd::AsRawFd;
    use std::sync::atomic::AtomicUsize;
    use std::task::Wake;

    pub(in super::super) fn fixture() -> (PeerConnection, PeerLifetime, UnixStream) {
        let (stream, peer) = UnixStream::pair().unwrap();
        let (connection, owner) =
            capture(stream, Instant::now() + Duration::from_secs(15)).unwrap();
        (connection, owner, peer)
    }

    pub(in super::super) async fn finish(mut owner: PeerLifetime, connection: PeerConnection) {
        let binding = owner.binding();
        owner.deny();
        let monitor = owner.monitor.take().unwrap();
        drop((owner, connection));
        tokio::time::timeout(Duration::from_secs(2), async {
            while !monitor.is_finished() {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("monitor must terminate after denial");
        monitor.join().unwrap();
        assert!(
            binding.0.upgrade().is_none(),
            "observer/binding retained FDs"
        );
    }

    #[tokio::test]
    async fn weak_io_gate_does_not_read_bytes_or_retain_either_unique_owner() {
        let (mut connection, owner, mut peer) = fixture();
        let gate = connection.io_gate();
        write(&mut peer, b"pending").await;
        gate.check_current().unwrap();
        let mut bytes = [0; 7];
        assert_eq!(read(&mut connection, &mut bytes).await.unwrap(), 7);
        assert_eq!(&bytes, b"pending");
        let clone = gate.clone();
        finish(owner, connection).await;
        assert!(gate.shared.upgrade().is_none());
        assert!(gate.check_current().is_err());
        assert!(clone.check_current().is_err());
        clone.invalidated().await;
    }

    #[tokio::test]
    async fn weak_io_gate_refuses_after_either_unique_half_drops() {
        for drop_lifetime_first in [true, false] {
            let (connection, mut owner, _peer) = fixture();
            let gate = connection.io_gate();
            let monitor = owner.monitor.take().unwrap();
            if drop_lifetime_first {
                drop(owner);
                assert!(gate.check_current().is_err());
                drop(connection);
            } else {
                drop(connection);
                assert!(gate.check_current().is_err());
                drop(owner);
            }
            gate.invalidated().await;
            tokio::time::timeout(Duration::from_secs(2), async {
                while !monitor.is_finished() {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await
            .unwrap();
            monitor.join().unwrap();
            assert!(
                gate.shared.upgrade().is_none(),
                "weak I/O gate retained resources"
            );
            assert!(gate.clone().check_current().is_err());
        }
    }

    #[tokio::test]
    async fn weak_io_gate_checks_kernel_half_close_and_original_cutoff_synchronously() {
        let (connection, owner, mut peer) = fixture();
        let gate = connection.io_gate();
        write(&mut peer, b"unread").await;
        // SAFETY: shutdown borrows the live fixture peer. No sleep or runtime
        // poll follows: the gate must inspect the actual socket itself.
        assert_eq!(
            unsafe { libc::shutdown(peer.as_raw_fd(), libc::SHUT_WR) },
            0
        );
        assert!(gate.check_current().is_err());
        finish(owner, connection).await;

        let (stream, _peer) = UnixStream::pair().unwrap();
        let cutoff = Instant::now() + Duration::from_millis(25);
        let (connection, owner) = capture(stream, cutoff).unwrap();
        let gate = connection.io_gate();
        std::thread::sleep(Duration::from_millis(80));
        assert!(gate.check_current().is_err());
        assert_eq!(owner.original_cutoff(), cutoff);
        finish(owner, connection).await;
        assert!(gate.shared.upgrade().is_none());
    }

    #[tokio::test]
    async fn bindings_match_only_original_allocation_and_credentials_are_actual() {
        let (connection, owner, _peer) = fixture();
        let (other, other_owner, _other_peer) = fixture();
        assert!(connection.binding() == owner.binding());
        assert!(owner.binding().clone() == owner.binding());
        assert!(connection.binding() != other.binding());
        // SAFETY: these calls only observe the test process's credentials.
        assert_eq!(owner.credentials().uid, unsafe { libc::geteuid() });
        assert_eq!(owner.credentials().gid, unsafe { libc::getegid() });
        owner.check_current().unwrap();
        finish(owner, connection).await;
        finish(other_owner, other).await;
    }

    #[tokio::test]
    async fn actual_io_is_gated_and_payload_does_not_spin_or_get_consumed() {
        let (mut connection, owner, mut peer) = fixture();
        write(&mut peer, b"buffered payload").await;
        // Block this current-thread reactor: only the OS monitor can run.
        std::thread::sleep(Duration::from_millis(30));
        owner.check_current().unwrap();
        assert!(owner.shared.kernel.polls.load(Ordering::Relaxed) <= 4);
        let mut bytes = [0; 16];
        assert_eq!(read(&mut connection, &mut bytes).await.unwrap(), 16);
        assert_eq!(&bytes, b"buffered payload");
        write(&mut connection, b"reply").await;
        assert_eq!(read(&mut peer, &mut bytes).await.unwrap(), 5);
        assert_eq!(&bytes[..5], b"reply");
        finish(owner, connection).await;
    }

    #[tokio::test]
    async fn buffered_payload_then_half_close_denies_without_caller_polling() {
        let (connection, owner, mut peer) = fixture();
        write(&mut peer, b"unread").await;
        let mut queued: libc::c_int = 0;
        // SAFETY: FIONREAD writes one initialized integer, without reading data.
        assert_eq!(
            unsafe { libc::ioctl(owner.shared.stream.as_raw_fd(), libc::FIONREAD, &mut queued) },
            0
        );
        assert_eq!(queued, 6);
        // SAFETY: shutdown borrows a live test peer socket; the peer process lives.
        assert_eq!(
            unsafe { libc::shutdown(peer.as_raw_fd(), libc::SHUT_WR) },
            0
        );
        std::thread::sleep(Duration::from_millis(30));
        assert!(owner.shared.signal.denied.load(Ordering::Acquire));
        owner.invalidated().await;
        assert!(owner.check_current().is_err());
        finish(owner, connection).await;
    }

    #[tokio::test]
    async fn original_cutoff_expires_with_blocked_runtime_and_cannot_reopen() {
        let (stream, _peer) = UnixStream::pair().unwrap();
        let cutoff = Instant::now() + Duration::from_millis(25);
        let (connection, owner) = capture(stream, cutoff).unwrap();
        assert_eq!(owner.original_cutoff(), cutoff);
        let denial = owner.denial_handle();
        std::thread::sleep(Duration::from_millis(80));
        assert!(owner.shared.signal.denied.load(Ordering::Acquire));
        denial.invalidated().await;
        assert!(owner.check_current().is_err());
        denial.deny();
        assert_eq!(owner.original_cutoff(), cutoff);
        finish(owner, connection).await;
    }

    struct WakeCount(AtomicUsize);
    impl Wake for WakeCount {
        fn wake(self: Arc<Self>) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn registered_invalidation_waiter_is_woken_and_late_waiters_return() {
        use std::future::Future;
        let (connection, owner, _peer) = fixture();
        let denial = owner.denial_handle();
        let count = Arc::new(WakeCount(AtomicUsize::new(0)));
        let waker = Waker::from(Arc::clone(&count));
        let mut cx = Context::from_waker(&waker);
        let waiter = denial.invalidated();
        tokio::pin!(waiter);
        assert!(waiter.as_mut().poll(&mut cx).is_pending());
        owner.deny();
        assert!(count.0.load(Ordering::SeqCst) > 0);
        assert!(waiter.as_mut().poll(&mut cx).is_ready());
        denial.invalidated().await;
        finish(owner, connection).await;
    }

    #[tokio::test]
    async fn owner_drop_wakes_pending_read_with_surviving_observers() {
        let (mut connection, mut owner, _peer) = fixture();
        let denial = owner.denial_handle();
        let binding = owner.binding();
        let monitor = owner.monitor.take().unwrap();
        let count = Arc::new(WakeCount(AtomicUsize::new(0)));
        let waker = Waker::from(Arc::clone(&count));
        let mut cx = Context::from_waker(&waker);
        let mut bytes = [0];
        let mut buffer = ReadBuf::new(&mut bytes);
        assert!(Pin::new(&mut connection)
            .poll_read(&mut cx, &mut buffer)
            .is_pending());
        drop(owner);
        assert!(count.0.load(Ordering::SeqCst) > 0);
        assert!(matches!(
            Pin::new(&mut connection).poll_read(&mut cx, &mut buffer),
            Poll::Ready(Err(_))
        ));
        denial.invalidated().await;
        drop(connection);
        monitor.join().unwrap();
        assert!(binding.0.upgrade().is_none());
        // Cloned signal-only observers still return after all resources close.
        denial.clone().invalidated().await;
        denial.deny();
    }

    #[tokio::test]
    async fn connection_drop_invalidates_lifetime_and_all_waiters() {
        for _ in 0..32 {
            let (connection, mut owner, _peer) = fixture();
            let observer = owner.denial_handle();
            let other = observer.clone();
            let waiter = tokio::spawn(async move { other.invalidated().await });
            drop(connection);
            observer.invalidated().await;
            tokio::time::timeout(Duration::from_secs(1), waiter)
                .await
                .unwrap()
                .unwrap();
            assert!(owner.check_current().is_err());
            let monitor = owner.monitor.take().unwrap();
            drop(owner);
            monitor.join().unwrap();
            assert!(observer.shared.upgrade().is_none());
        }
    }

    #[tokio::test]
    async fn denial_wakes_a_backpressured_writer_and_is_sticky() {
        let (mut connection, owner, _peer) = fixture();
        owner.shared.stream.writable().await.unwrap();
        let bytes = [1; 16 * 1024];
        loop {
            match owner.shared.stream.try_write(&bytes) {
                Ok(count) => assert_ne!(count, 0),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) => panic!("fill socket: {error}"),
            }
        }
        let count = Arc::new(WakeCount(AtomicUsize::new(0)));
        let waker = Waker::from(Arc::clone(&count));
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut connection)
            .poll_write(&mut cx, b"x")
            .is_pending());
        let denial = owner.denial_handle();
        std::thread::spawn(move || denial.deny()).join().unwrap();
        assert!(count.0.load(Ordering::SeqCst) > 0);
        assert!(matches!(
            Pin::new(&mut connection).poll_write(&mut cx, b"x"),
            Poll::Ready(Err(_))
        ));
        finish(owner, connection).await;
    }

    #[tokio::test]
    async fn expired_capture_closes_owned_socket_without_minting_halves() {
        let (stream, mut peer) = UnixStream::pair().unwrap();
        assert!(
            matches!(capture(stream, Instant::now()), Err(error) if error.kind() == io::ErrorKind::TimedOut)
        );
        assert_eq!(read(&mut peer, &mut [0]).await.unwrap(), 0);
    }
}
