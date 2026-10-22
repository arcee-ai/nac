use super::*;
use std::{
    mem::ManuallyDrop,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Weak,
    },
    task::{RawWaker, RawWakerVTable},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn exact_window_wraparound_backpressure_and_writer_shutdown_preserve_drain_before_eof() {
    let (mut writer, mut reader) = pair(3).unwrap();
    writer.write_all(&[1, 2, 3]).await.unwrap();
    let mut cx = Context::from_waker(Waker::noop());
    assert!(Pin::new(&mut writer).poll_write(&mut cx, &[4]).is_pending());
    let mut first = [0; 2];
    reader.read_exact(&mut first).await.unwrap();
    assert_eq!(first, [1, 2]);
    assert_eq!(writer.write(&[4, 5, 6]).await.unwrap(), 2);
    writer.shutdown().await.unwrap();
    assert!(writer.write_all(&[7]).await.is_err());
    let mut rest = Vec::new();
    reader.read_to_end(&mut rest).await.unwrap();
    assert_eq!(rest, [3, 4, 5]);
}

struct Probe {
    state: Weak<Mutex<State>>,
    clones: AtomicUsize,
    wakes: AtomicUsize,
    drops: AtomicUsize,
    violations: AtomicUsize,
}
impl Probe {
    fn unlocked(&self) {
        if let Some(state) = self.state.upgrade() {
            if matches!(state.try_lock(), Err(std::sync::TryLockError::WouldBlock)) {
                self.violations.fetch_add(1, Ordering::SeqCst);
            }
        }
    }
}

unsafe fn clone_probe(ptr: *const ()) -> RawWaker {
    let shared = ManuallyDrop::new(unsafe { Arc::<Probe>::from_raw(ptr.cast()) });
    shared.unlocked();
    shared.clones.fetch_add(1, Ordering::SeqCst);
    RawWaker::new(Arc::into_raw(Arc::<Probe>::clone(&shared)).cast(), &VTABLE)
}
unsafe fn drop_probe(ptr: *const ()) {
    let shared = unsafe { Arc::<Probe>::from_raw(ptr.cast()) };
    shared.unlocked();
    shared.drops.fetch_add(1, Ordering::SeqCst);
}
unsafe fn wake_probe(ptr: *const ()) {
    let shared = unsafe { Arc::<Probe>::from_raw(ptr.cast()) };
    shared.unlocked();
    shared.wakes.fetch_add(1, Ordering::SeqCst);
}
unsafe fn wake_probe_ref(ptr: *const ()) {
    let shared = ManuallyDrop::new(unsafe { Arc::<Probe>::from_raw(ptr.cast()) });
    shared.unlocked();
    shared.wakes.fetch_add(1, Ordering::SeqCst);
}
static VTABLE: RawWakerVTable =
    RawWakerVTable::new(clone_probe, wake_probe, wake_probe_ref, drop_probe);
fn probe(writer: &Writer) -> (Arc<Probe>, Waker) {
    let probe = Arc::new(Probe {
        state: Arc::downgrade(&writer.0),
        clones: AtomicUsize::new(0),
        wakes: AtomicUsize::new(0),
        drops: AtomicUsize::new(0),
        violations: AtomicUsize::new(0),
    });
    let raw = RawWaker::new(Arc::into_raw(Arc::clone(&probe)).cast(), &VTABLE);
    (probe, unsafe { Waker::from_raw(raw) })
}
#[test]
fn reader_waker_clone_replace_wake_and_endpoint_drop_callbacks_are_outside_lock() {
    let (mut writer, mut reader) = pair(1).unwrap();
    let (probe, waker) = probe(&writer);
    let mut cx = Context::from_waker(&waker);
    let mut bytes = [0];
    let mut out = ReadBuf::new(&mut bytes);
    for _ in 0..2 {
        assert!(Pin::new(&mut reader)
            .poll_read(&mut cx, &mut out)
            .is_pending());
    }
    assert!(probe.drops.load(Ordering::SeqCst) > 0);
    assert!(matches!(
        Pin::new(&mut writer).poll_write(&mut cx, &[1]),
        Poll::Ready(Ok(1))
    ));
    assert_eq!(probe.wakes.load(Ordering::SeqCst), 1);
    assert!(matches!(
        Pin::new(&mut reader).poll_read(&mut cx, &mut out),
        Poll::Ready(Ok(()))
    ));
    let mut bytes = [0];
    let mut out = ReadBuf::new(&mut bytes);
    assert!(Pin::new(&mut reader)
        .poll_read(&mut cx, &mut out)
        .is_pending());
    drop(writer);
    assert_eq!(probe.wakes.load(Ordering::SeqCst), 2);
    assert!(matches!(
        Pin::new(&mut reader).poll_read(&mut cx, &mut out),
        Poll::Ready(Ok(()))
    ));
    assert!(out.filled().is_empty());
    assert!(probe.clones.load(Ordering::SeqCst) >= 4);
    assert_eq!(probe.violations.load(Ordering::SeqCst), 0);
}
#[test]
fn pending_writer_is_woken_without_callbacks_under_lock_on_space_or_reader_close() {
    let (mut writer, mut reader) = pair(1).unwrap();
    let (probe, waker) = probe(&writer);
    let mut cx = Context::from_waker(&waker);
    assert!(matches!(
        Pin::new(&mut writer).poll_write(&mut cx, &[1]),
        Poll::Ready(Ok(1))
    ));
    for _ in 0..2 {
        assert!(Pin::new(&mut writer).poll_write(&mut cx, &[2]).is_pending());
    }
    let mut bytes = [0];
    let mut out = ReadBuf::new(&mut bytes);
    assert!(matches!(
        Pin::new(&mut reader).poll_read(&mut cx, &mut out),
        Poll::Ready(Ok(()))
    ));
    assert_eq!(probe.wakes.load(Ordering::SeqCst), 1);
    assert!(matches!(
        Pin::new(&mut writer).poll_write(&mut cx, &[2]),
        Poll::Ready(Ok(1))
    ));
    assert!(Pin::new(&mut writer).poll_write(&mut cx, &[3]).is_pending());
    drop(reader);
    assert_eq!(probe.wakes.load(Ordering::SeqCst), 2);
    assert!(matches!(
        Pin::new(&mut writer).poll_write(&mut cx, &[3]),
        Poll::Ready(Err(_))
    ));
    assert!(probe.drops.load(Ordering::SeqCst) > 0);
    assert_eq!(probe.violations.load(Ordering::SeqCst), 0);
}
