//! Actual serving/store/task ownership at an unresolved publication drain.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unresolved_publication_keeps_same_store_open_until_original_work_joins() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_create_unknown_shutdown");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let manager = owned_test_manager(&root).unwrap();
    let started = Arc::new(tokio::sync::Notify::new());
    let finish = Arc::new(tokio::sync::Notify::new());
    let worker_started = Arc::clone(&started);
    let worker_finish = Arc::clone(&finish);
    assert!(manager.inner.publication_tasks.spawn(async move {
        worker_started.notify_one();
        worker_finish.notified().await;
    }));
    started.notified().await;
    let forced = Arc::new(AtomicBool::new(false));
    let watchdog_forced = Arc::clone(&forced);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = tokio::spawn(serve_listener_with_shutdown(
        listener,
        None,
        manager.clone(),
        async {},
        Duration::from_millis(100),
        move || {
            watchdog_forced.store(true, Ordering::Release);
        },
    ));
    // The fixture callback records the real watchdog instead of exiting this
    // test process. The original manager remains retained outside the server.
    let outcome = tokio::time::timeout(Duration::from_secs(3), server).await;
    let coordinator = manager.inner._store_ownership.coordinator().unwrap();
    let admitted_before = coordinator.stats().admitted;
    let read = nac_core::sessions::list_sessions(&manager.inner.store_path);
    let admitted_after = coordinator.stats().admitted;
    let forced_observed = forced.load(Ordering::Acquire);
    // Complete/join the SAME worker and real store before assertions propagate.
    finish.notify_one();
    let joined = manager
        .inner
        .publication_tasks
        .drain(std::time::Instant::now() + Duration::from_secs(3))
        .await;
    manager.quiesce_persistence_callers().await;
    let drained = manager.drain_persistence().await;
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
    assert!(
        outcome.unwrap().unwrap().is_err(),
        "unknown work cannot report clean shutdown"
    );
    assert!(
        forced_observed,
        "original watchdog did not enforce the original bound"
    );
    assert!(
        read.is_ok(),
        "persistence closed underneath unresolved publication"
    );
    assert!(
        admitted_after > admitted_before,
        "read did not use the same real store executor"
    );
    joined.unwrap();
    drained.unwrap();
}
