use super::*;

async fn wait_until_operation_lease_busy(path: &std::path::Path, session_id: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        match sessions::SessionOperationLease::try_acquire(path, session_id) {
            Err(sessions::SessionOperationLeaseError::Busy(_)) => return,
            Ok(lease) => drop(lease),
            Err(error) => panic!("unexpected lease error: {error:#}"),
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{session_id} operation lease never became busy"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// Lifecycle gates are ordered parent before orchestrator. A monitor that
/// settled its orchestrator used to keep that gate while attaching the
/// idle-evicted parent, whose deletion held the parent gate while cascading
/// into the orchestrator gate: each waited on the other forever.
#[tokio::test]
async fn managed_monitor_and_queued_parent_delete_keep_lifecycle_gate_order() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_monitor_parent_delete_gate_order");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("gate-order-test-key"));
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://example.invalid/v1".to_owned(),
    );
    let manager = test_manager(&root);
    let orchestrator = manager
        .create_managed_orchestrator_session("delegating", "gate order")
        .await
        .unwrap();
    let path = root.join("store.db");
    let relation = nac_core::store::begin_managed_orchestrator_run(
        &path,
        &orchestrator,
        "gate-order-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            &orchestrator,
            0,
            &Message::User {
                content: "background work".to_owned(),
            },
            "gate-order-run",
        )
        .unwrap();

    // Ordinary idle eviction leaves the parent uncached, so delivering the
    // completion has to attach it again.
    manager.sweep_idle_sessions(None).await;
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("delegating"));

    // Hold the orchestrator gate only long enough to queue the monitor first
    // and the parent deletion second, then let them race.
    let orchestrator_gate = manager.lifecycle_gate(&orchestrator);
    let parent_gate = manager.lifecycle_gate("delegating");
    let ordering = orchestrator_gate.clone().lock_owned().await;
    let monitor = tokio::spawn({
        let manager = manager.clone();
        let orchestrator = orchestrator.clone();
        let generation = relation.generation;
        async move {
            manager
                .monitor_managed_orchestrator(&orchestrator, generation)
                .await
        }
    });
    // The monitor owns the orchestrator's operation lease and waits on its gate.
    wait_until_operation_lease_busy(&path, &orchestrator).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    let delete = tokio::spawn({
        let manager = manager.clone();
        async move { manager.delete_session("delegating").await }
    });
    // The deletion owns the parent gate and leases and waits on the
    // orchestrator gate through its cascade.
    wait_until_operation_lease_busy(&path, "delegating").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    drop(ordering);

    let (monitor, delete) = tokio::time::timeout(Duration::from_secs(10), async {
        (monitor.await.unwrap(), delete.await.unwrap())
    })
    .await
    .expect("managed monitor and parent deletion deadlocked on lifecycle gates");

    // The monitor settled first; the deletion then removed the settled
    // orchestrator together with the parent and the completion it received.
    let settled = monitor.expect("monitor must report its settlement");
    assert_eq!(settled.orchestrator_session_id, orchestrator);
    assert_eq!(settled.generation, relation.generation);
    assert!(settled.status.is_terminal(), "{:?}", settled.status);
    assert!(settled.completion_inbox_id.is_some());
    delete.expect("parent deletion must complete after settlement");
    assert!(!sessions::session_exists(&path, "delegating").unwrap());
    assert!(!sessions::session_exists(&path, &orchestrator).unwrap());
    assert!(
        nac_core::store::load_managed_orchestrator(&path, &orchestrator)
            .unwrap()
            .is_none()
    );
    assert!(orchestrator_gate.try_lock().is_ok());
    assert!(parent_gate.try_lock().is_ok());
    let _ = std::fs::remove_dir_all(root);
}

/// Settlement releases the orchestrator gate before waking the parent, so the
/// parent can be deleted while still cached, after the wake has already seen
/// its pending work. That parent took the completion with it, so waking it is
/// not a monitor failure.
#[tokio::test]
async fn waking_a_parent_deleted_after_settlement_is_nothing_to_do() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("wake_deleted_cached_parent");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("wake-deleted-parent-key"));
    seed_direct_session(&root, "parent");
    let manager = test_manager(&root);
    let path = root.join("store.db");
    let _cached = manager.attach_session("parent").await.unwrap();
    // Work the wake will see, then the session row gone underneath the cache.
    nac_core::store::create_session_inbox_item(
        &path,
        "parent",
        InboxDelivery::Queue,
        "completion",
        None,
        None,
    )
    .unwrap();
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch(
            "PRAGMA foreign_keys = OFF; DELETE FROM sessions WHERE session_id = 'parent';",
        )
        .unwrap();

    manager
        .wake_managed_orchestrator_parent("parent")
        .await
        .expect("a parent deleted after settlement has nothing left to wake");
    let _ = std::fs::remove_dir_all(root);
}
