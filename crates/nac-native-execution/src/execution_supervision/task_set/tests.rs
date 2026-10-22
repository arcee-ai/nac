use super::*;
use std::{fs::File, sync::mpsc, time::Duration};
struct HeldFuture {
    _file: File,
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
}
impl Future for HeldFuture {
    type Output = ();
    fn poll(self: Pin<&mut Self>, _cx: &mut TaskContext<'_>) -> Poll<()> {
        Poll::Pending
    }
}
impl Drop for HeldFuture {
    fn drop(&mut self) {
        self.entered.send(()).unwrap();
        self.release.recv().unwrap();
    }
}
#[tokio::test]
async fn task_settlement_is_not_published_before_owned_future_and_descriptor_drop() {
    let tasks = TaskSet::unaccounted_for_test();
    let (entered, observed) = mpsc::sync_channel(1);
    let (release, held) = mpsc::sync_channel(1);
    tasks.pending.store(1, Ordering::Release);
    let future = HeldFuture {
        _file: File::open("/dev/null").unwrap(),
        entered,
        release: held,
    };
    let owned = OwnedTask {
        future: Some(Box::pin(future)),
        tasks: Arc::clone(&tasks),
    };
    let dropping = std::thread::spawn(move || drop(owned));
    observed.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(tasks
        .join(Instant::now() + Duration::from_millis(20))
        .await
        .is_err());
    release.send(()).unwrap();
    dropping.join().unwrap();
    tasks
        .join(Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
}
#[tokio::test]
async fn aborted_never_polled_task_drops_its_owned_resources_before_join_success() {
    struct Marker(Arc<AtomicUsize>);
    impl Drop for Marker {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    let tasks = TaskSet::unaccounted_for_test();
    let dropped = Arc::new(AtomicUsize::new(0));
    let marker = Marker(Arc::clone(&dropped));
    let task = tasks
        .spawn(&Handle::current(), async move {
            let _marker = marker;
            std::future::pending::<()>().await;
        })
        .unwrap();
    task.abort();
    tasks
        .join(Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
}
