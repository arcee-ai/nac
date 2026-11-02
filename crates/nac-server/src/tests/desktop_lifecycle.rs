//! Characterize the shared listener and complete-shutdown boundary consumed by
//! the private desktop adapter. These are real listeners and a real owned store.
use super::*;
use crate::application::managed::ManagedReadinessPolicy;
use crate::delivery::server::serve_with_lifecycle;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn desktop_listener_reports_actual_endpoint_only_after_ready_and_accepts_latched_stop() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("desktop_listener_characterization");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let manager = test_manager(&root);
    let path = manager.store_info().store_path;
    let (bound_tx, bound_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(serve_with_lifecycle(
        "127.0.0.1:0".parse().unwrap(),
        BindPolicy::LoopbackOnly,
        manager,
        move |bound| {
            assert!(bound.ip().is_loopback());
            assert_ne!(bound.port(), 0);
            nac_core::store::check_readiness(&path).unwrap();
            bound_tx.send(bound).unwrap();
        },
        ManagedReadinessPolicy::production(),
        async {},
    ));
    bound_rx.await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(COMPLETE_SHUTDOWN_TIMEOUT, Duration::from_secs(20));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn desktop_listener_conflict_never_announces_readiness() {
    let root = temp_root("desktop_listener_conflict");
    let manager = test_manager(&root);
    let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let announced = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mark = announced.clone();
    assert!(serve_with_lifecycle(
        occupied.local_addr().unwrap(),
        BindPolicy::LoopbackOnly,
        manager,
        move |_| {
            mark.store(true, std::sync::atomic::Ordering::SeqCst);
        },
        ManagedReadinessPolicy::production(),
        std::future::pending()
    )
    .await
    .is_err());
    assert!(!announced.load(std::sync::atomic::Ordering::SeqCst));
    std::fs::remove_dir_all(root).unwrap();
}
