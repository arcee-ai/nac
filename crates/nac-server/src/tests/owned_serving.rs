use super::*;

#[tokio::test(flavor = "current_thread")]
async fn owned_managed_probes_remain_responsive_while_a_write_is_blocked() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_managed_blocked_write_probes");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let fixture = test_managed_manager(&root);
    let config = fixture.managed_host().unwrap().clone();
    drop(fixture);
    seed_session(&root, "pending", "2026-01-01 00:00:00.000000000");
    let mut snapshot = sessions::load_session(&root.join("store.db"), "pending").unwrap();
    snapshot.session_id = "newly-admitted".into();
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        managed_host: Some(config),
    })
    .await
    .unwrap();
    let connection = rusqlite::Connection::open(root.join("store.db")).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    let writer_manager = manager.clone();
    let writer = tokio::spawn(async move {
        writer_manager
            .inner
            ._store_ownership
            .coordinator()
            .unwrap()
            .create_session(snapshot)
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while manager
            .inner
            ._store_ownership
            .coordinator()
            .unwrap()
            .stats()
            .executing
            != 1
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let app = router(manager.clone());
    let probes = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        let health = get_response(app.clone(), "/healthz", None).await;
        let ready = response_json(get_response(app, "/readyz", None).await).await;
        (health.status(), ready)
    })
    .await;
    // Always unblock the real write before asserting the regression outcome.
    connection.execute_batch("ROLLBACK").unwrap();
    drop(connection);
    writer.await.unwrap().unwrap();
    manager.drain_persistence().await.unwrap();
    assert!(
        probes.is_ok(),
        "managed probes waited behind the blocked write"
    );
    let (health, ready) = probes.unwrap();
    assert_eq!(health, StatusCode::OK);
    // Local host tools/UID may fail production readiness; the store and
    // maintenance checks must observe committed WAL state without that write.
    for name in ["store", "maintenance"] {
        let check = ready["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap();
        assert_eq!(check["ready"], true, "{name}: {ready}");
    }
    assert_eq!(ready["migration_state"], "current");
    assert_eq!(ready["maintenance_state"], "serving");
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}
