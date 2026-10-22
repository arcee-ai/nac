use super::*;
use crate::peer_channel::tests::supported::{finish, fixture};

mod process_cases;

#[test]
fn poll_timeout_rounds_up_and_bounds_without_rebudgeting() {
    assert_eq!(poll_timeout(Duration::ZERO), 0);
    assert_eq!(poll_timeout(Duration::from_nanos(1)), 1);
    assert_eq!(poll_timeout(Duration::from_millis(1)), 1);
    assert_eq!(poll_timeout(Duration::from_micros(1001)), 2);
    assert_eq!(poll_timeout(Duration::MAX), libc::c_int::MAX);
}

#[tokio::test]
async fn descriptors_are_cloexec_and_stream_ofd_flags_are_unchanged() {
    let (stream, _peer) = UnixStream::pair().unwrap();
    let fd = stream.as_raw_fd();
    // SAFETY: observation only, while stream is still owned in this test.
    let before = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    let (connection, owner) = capture(stream, Instant::now() + Duration::from_secs(15)).unwrap();
    assert_eq!(unsafe { libc::fcntl(fd, libc::F_GETFL) }, before);
    require_flags(fd, true).unwrap();
    require_flags(owner.shared.kernel.pidfd.as_raw_fd(), false).unwrap();
    require_flags(owner.shared.kernel.wake_read.as_raw_fd(), true).unwrap();
    require_flags(owner.shared.kernel.wake_write.as_raw_fd(), true).unwrap();
    finish(owner, connection).await;
}

#[tokio::test]
async fn failed_spawn_drops_prepared_guard_and_closes_connection() {
    let (stream, peer) = UnixStream::pair().unwrap();
    FAIL_SPAWN.with(|fail| fail.set(true));
    let result = capture(stream, Instant::now() + Duration::from_secs(15));
    assert!(matches!(result, Err(error) if error.to_string().contains("spawn failure")));
    peer.readable().await.unwrap();
    assert_eq!(peer.try_read(&mut [0]).unwrap(), 0);
}

#[tokio::test]
async fn actual_monitor_panic_or_error_denies_and_releases_resources() {
    for fault in [1, 2] {
        let (connection, mut owner, _peer) = fixture();
        let binding = owner.binding();
        owner
            .shared
            .kernel
            .fault_on_ready
            .store(fault, Ordering::Release);
        owner.shared.kernel.wake();
        tokio::time::timeout(Duration::from_secs(1), owner.invalidated())
            .await
            .unwrap();
        assert!(owner.check_current().is_err());
        let monitor = owner.monitor.take().unwrap();
        drop((owner, connection));
        assert_eq!(monitor.join().is_err(), fault == 1);
        assert!(binding.0.upgrade().is_none());
    }
}
