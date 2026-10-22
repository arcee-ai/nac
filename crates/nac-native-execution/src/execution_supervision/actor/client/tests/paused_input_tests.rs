//! Pause through an actual caller waker clone, outside all Native state locks.
use super::*;
use std::{
    mem::ManuallyDrop,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Condvar, Mutex,
    },
    task::{Context, Poll, RawWaker, RawWakerVTable, Waker},
};
use tokio::io::{AsyncWrite, AsyncWriteExt};

struct Pause {
    armed: AtomicBool,
    entered: mpsc::Sender<()>,
    resumed: Mutex<bool>,
    changed: Condvar,
}
impl Pause {
    fn resume(&self) {
        *self.resumed.lock().unwrap() = true;
        self.changed.notify_all();
    }
}
struct Resume(Arc<Pause>);
impl Drop for Resume {
    fn drop(&mut self) {
        self.0.resume();
    }
}
unsafe fn clone_waker(ptr: *const ()) -> RawWaker {
    // Every raw pointer owns one Arc; clone preserves the caller's ownership.
    let shared = ManuallyDrop::new(unsafe { Arc::<Pause>::from_raw(ptr.cast()) });
    if shared.armed.swap(false, Ordering::SeqCst) {
        shared.entered.send(()).unwrap();
        let mut resumed = shared.resumed.lock().unwrap();
        while !*resumed {
            resumed = shared.changed.wait(resumed).unwrap();
        }
    }
    RawWaker::new(Arc::into_raw(Arc::<Pause>::clone(&shared)).cast(), &VTABLE)
}
unsafe fn drop_waker(ptr: *const ()) {
    drop(unsafe { Arc::<Pause>::from_raw(ptr.cast()) });
}
unsafe fn wake_waker(ptr: *const ()) {
    unsafe { drop_waker(ptr) };
}
unsafe fn wake_by_ref(_: *const ()) {}
static VTABLE: RawWakerVTable =
    RawWakerVTable::new(clone_waker, wake_waker, wake_by_ref, drop_waker);

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn in_flight_input_polls_cannot_revive_a_completed_cutoff() {
    for operation in 0..3 {
        let fixture = Fixture::new(1024, 2).await;
        let release = std::env::temp_dir().join(format!("native-input-pause-{}", Uuid::new_v4()));
        let script = format!(
            "while [ ! -e '{}' ]; do /bin/sleep 0.01; done",
            release.display()
        );
        let old_deadline = Instant::now() + Duration::from_secs(1);
        let mut old = fixture
            .client
            .spawn_pipe(command("/bin/sh", &["-c", &script]), old_deadline)
            .await
            .unwrap();
        let mut input = old.stdin;
        let (entered, receive) = mpsc::channel();
        let pause = Arc::new(Pause {
            armed: AtomicBool::new(true),
            entered,
            resumed: Mutex::new(false),
            changed: Condvar::new(),
        });
        let release_pause = Resume(Arc::clone(&pause));
        let thread_pause = Arc::clone(&pause);
        let thread = std::thread::spawn(move || {
            let raw = RawWaker::new(Arc::into_raw(thread_pause).cast(), &VTABLE);
            let waker = unsafe { Waker::from_raw(raw) };
            let mut cx = Context::from_waker(&waker);
            let result = match operation {
                0 => std::pin::Pin::new(&mut input)
                    .poll_write(&mut cx, b"late")
                    .map(|r| r.map(|_| ())),
                1 => std::pin::Pin::new(&mut input).poll_flush(&mut cx),
                _ => std::pin::Pin::new(&mut input).poll_shutdown(&mut cx),
            };
            (input, result)
        });
        // Outer input_open() has succeeded; the physical guard is registering
        // this real caller waker. Its clone can reenter completion independently.
        receive.recv_timeout(Duration::from_secs(1)).unwrap();
        std::fs::write(&release, b"exit").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (a, b, exit) = tokio::join!(
            old.stdout.read_to_end(&mut out),
            old.stderr.read_to_end(&mut err),
            old.process.wait()
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(exit.unwrap().code, Some(0));
        std::fs::remove_file(release).unwrap();
        let mut next = fixture
            .client
            .spawn_pipe(
                command("/bin/sh", &["-c", "/bin/sleep 1.4; printf successor"]),
                deadline(),
            )
            .await
            .unwrap();
        drop(next.stdin);
        tokio::time::sleep_until((old_deadline + Duration::from_millis(50)).into()).await;
        assert!(fixture.peer.check_current().is_ok());
        drop(release_pause);
        let (mut input, result) = thread.join().unwrap();
        if operation == 0 {
            assert!(matches!(result, Poll::Ready(Err(_))));
        } else {
            assert!(matches!(result, Poll::Ready(Ok(()))));
        }
        input.shutdown().await.unwrap();
        assert!(fixture.peer.check_current().is_ok());
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (a, b, exit) = tokio::join!(
            next.stdout.read_to_end(&mut out),
            next.stderr.read_to_end(&mut err),
            next.process.wait()
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(exit.unwrap().code, Some(0));
        assert_eq!(out, b"successor");
    }
}
