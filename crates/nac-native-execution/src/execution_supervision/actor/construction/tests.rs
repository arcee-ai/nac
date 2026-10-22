//! Reentrant caller wakers must never enter a Native/Tokio notification lock.
use super::*;
use std::{
    mem::ManuallyDrop,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Weak,
    },
    task::{Context, RawWaker, RawWakerVTable, Waker},
    time::Duration,
};
use tokio::sync::Notify;

struct PendingRunner(Notify);
impl RawRunnerCleanup for PendingRunner {
    fn request_stop(&self, _: Instant) {
        self.0.notify_waiters();
    }
    fn wait_for_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async {
            self.0.notified().await;
            Ok(())
        })
    }
}
struct Reenter {
    cleanup: Weak<NativeCleanup>,
    clones: AtomicUsize,
    cutoff: Instant,
}
unsafe fn clone_reentrant(ptr: *const ()) -> RawWaker {
    // SAFETY: Every raw pointer owns an Arc; cloning borrows without consuming it.
    let value = ManuallyDrop::new(unsafe { Arc::<Reenter>::from_raw(ptr.cast()) });
    value.clones.fetch_add(1, Ordering::SeqCst);
    if let Some(cleanup) = value.cleanup.upgrade() {
        drop(cleanup.close_and_reap(value.cutoff));
    }
    RawWaker::new(Arc::into_raw(Arc::clone(&value)).cast(), &VTABLE)
}
unsafe fn drop_reentrant(ptr: *const ()) {
    // SAFETY: Waker Drop consumes precisely this raw pointer's Arc ownership.
    drop(unsafe { Arc::<Reenter>::from_raw(ptr.cast()) });
}
unsafe fn wake_reentrant(ptr: *const ()) {
    // SAFETY: Consuming wake releases precisely this raw pointer's Arc ownership.
    drop(unsafe { Arc::<Reenter>::from_raw(ptr.cast()) });
}
unsafe fn wake_by_ref(_: *const ()) {}
static VTABLE: RawWakerVTable =
    RawWakerVTable::new(clone_reentrant, wake_reentrant, wake_by_ref, drop_reentrant);

#[test]
fn cleanup_waker_clone_can_reenter_stop_without_notification_lock_deadlock() {
    let cutoff = Instant::now() + Duration::from_secs(4);
    let cleanup = Arc::new(NativeCleanup::new(
        Arc::new(PendingRunner(Notify::new())),
        StorageCharge::Unaccounted,
        cutoff,
    ));
    let caller = Arc::new(Reenter {
        cleanup: Arc::downgrade(&cleanup),
        clones: AtomicUsize::new(0),
        cutoff,
    });
    let (sent, received) = mpsc::sync_channel(1);
    let observed = Arc::clone(&caller);
    let worker = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _entered = runtime.enter();
        let raw = RawWaker::new(Arc::into_raw(observed).cast(), &VTABLE);
        // SAFETY: raw was created above from one owned Arc with the matching vtable.
        let waker = unsafe { Waker::from_raw(raw) };
        let mut pending = cleanup.close_and_reap(cutoff);
        let mut initial = Context::from_waker(Waker::noop());
        assert!(pending.as_mut().poll(&mut initial).is_pending());
        // Replacing an already-registered Notify waker exercises its locked
        // update path. The proxy clones this caller before entering that path.
        let mut context = Context::from_waker(&waker);
        assert!(pending.as_mut().poll(&mut context).is_ready());
        drop(pending);
        sent.send(()).unwrap();
    });
    received
        .recv_timeout(Duration::from_secs(2))
        .expect("reentrant cleanup waker deadlocked");
    worker.join().unwrap();
    assert!(caller.clones.load(Ordering::SeqCst) > 0);
}
