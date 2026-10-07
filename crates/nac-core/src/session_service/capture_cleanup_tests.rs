use super::capture_cleanup::CaptureCleanups;
use super::*;
use nac_process::ProcessTreeGuard;
use std::{
    future::{poll_fn, Future},
    process::Stdio,
    task::Poll,
};

#[tokio::test]
async fn dropped_cleanup_caller_keeps_actual_owner_until_owned_task_finishes() {
    let root = std::env::temp_dir().join(format!("nac-capture-cleanup-drop-{}", Uuid::new_v4()));
    let path = root.join("store.db");
    crate::store::initialize(&path).unwrap();
    let session = Uuid::new_v4().to_string();
    let lease = Arc::new(sessions::SessionOperationLease::try_acquire(&path, &session).unwrap());
    let run = SessionRunId::from_stored(Uuid::new_v4().to_string());
    let registry = Arc::new(CaptureCleanups::default());
    let mut command = tokio::process::Command::new("/bin/sleep");
    command
        .arg("30")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let (child, tree) = ProcessTreeGuard::spawn_supervised(&mut command).unwrap();
    let (_, owner) = registry.register(run.clone(), lease, None, child, tree);
    let weak = Arc::downgrade(&owner);
    let locked = owner.process.lock().await;
    let mut caller = Box::pin(registry.retry_run(&run));
    // The first poll dispatches the owned retry and reaches its JoinHandle.
    // The held real process lock prevents completion before caller drop.
    poll_fn(|cx| {
        assert!(caller.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(caller);
    assert_eq!(registry.pending(&run), 1);
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&path, &session),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    drop(locked);
    drop(owner);
    tokio::time::timeout(Duration::from_secs(5), async {
        while registry.pending(&run) > 0 || weak.upgrade().is_some() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned cleanup task survives dropped caller");
    sessions::SessionOperationLease::try_acquire(&path, &session).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
