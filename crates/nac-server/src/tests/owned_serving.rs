use super::*;

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_managed_admission_and_resteering_keep_identity() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_managed_admission");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let fixture = test_managed_manager(&root);
    let config = fixture.managed_host().unwrap().clone();
    drop(fixture);
    let mut parent = sessions::new_snapshot(
        "parent".into(),
        root.clone(),
        "model-a".into(),
        "https://api.openai.com/v1".into(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    parent.behavior = sessions::SessionBehavior::DirectWithOrchestrator;
    sessions::create_session(&root.join("store.db"), &parent).unwrap();
    seed_session(&root, "orchestrator", "2026-01-01 00:00:00.000000000");
    nac_core::store::create_managed_orchestrator_relationship(
        &root.join("store.db"),
        "parent",
        "orchestrator",
        "work",
    )
    .unwrap();
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: Some(config),
    })
    .await
    .unwrap();
    let admission = manager
        .managed_work_admission_async()
        .await
        .unwrap()
        .unwrap();
    let owner = manager.inner._store_ownership.coordinator().unwrap();
    let relation = owner
        .begin_managed_orchestrator_run(
            "orchestrator".into(),
            "run".into(),
            nac_core::store::ManagedOrchestratorExecutionMode::Background,
        )
        .await
        .unwrap();
    let steer = manager
        .queue_managed_orchestrator_steering_async("parent", "orchestrator", "change direction")
        .await
        .unwrap();
    assert!(manager
        .queue_managed_orchestrator_steering_async("wrong-parent", "orchestrator", "do not deliver")
        .await
        .is_err());
    drop(admission);
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let conn = rusqlite::Connection::open(root.join("store.db")).unwrap();
    let (id, dispatch): (i64, String) = conn
        .query_row(
            "SELECT id, dispatch_id FROM thread_steering WHERE session_id = 'orchestrator'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(id, steer.steering_id);
    assert_eq!(dispatch, relation.run_id.unwrap());
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM thread_steering WHERE session_id = 'orchestrator'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    drop(conn);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_orchestrator_steering_awaits_durable_admission() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_orchestrator_steering");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-key"));
    seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
    let provider = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let submitted = manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "hold run".into(),
            },
        )
        .await
        .unwrap();
    let steer = manager
        .queue_orchestrator_steering(
            "session",
            OrchestratorSteeringRequest {
                instruction: "change direction".into(),
            },
        )
        .await
        .unwrap();
    manager.cancel_active_run("session").await.unwrap();
    provider.abort();
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let conn = rusqlite::Connection::open(root.join("store.db")).unwrap();
    let (id, dispatch): (i64, String) = conn
        .query_row(
            "SELECT id, dispatch_id FROM thread_steering WHERE session_id = 'session'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(id, steer.steering_id);
    assert_eq!(dispatch, submitted.run_id);
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM thread_steering WHERE session_id = 'session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    drop(conn);
    let _ = std::fs::remove_dir_all(root);
}
