use super::*;

async fn pause_creation(
    manager: &SessionManager,
    root: &std::path::Path,
) -> (
    Arc<application::session_creation::CreationProjectionGate>,
    tokio::task::JoinHandle<Response>,
) {
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(Arc::clone(&gate));
    let manager = manager.clone();
    let cwd = root.to_path_buf();
    let creation = tokio::spawn(async move {
        post_json(
            router(manager),
            "/sessions",
            serde_json::json!({
                "behavior": "direct", "cwd": cwd, "model": "gpt-5.2",
                "backend": "openai-responses", "api_key_env": "OPENAI_API_KEY"
            }),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    (gate, creation)
}

struct ReleaseCallers(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);

impl Drop for ReleaseCallers {
    fn drop(&mut self) {
        let (lock, condition) = &*self.0;
        *lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        condition.notify_all();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rejected_creation_projection_does_not_leave_a_durable_session() {
    // Saturation owns the entire process-wide caller budget. Other parallel
    // tests must not borrow its slots or receive its deliberate rejections.
    const CHILD: &str = "NAC_TEST_CREATION_PROJECTION_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::session_creation_overload::rejected_creation_projection_does_not_leave_a_durable_session",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "saturation child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("caller saturation completed"),
            "saturation child did not execute: {}",
            String::from_utf8_lossy(&output.stdout)
        );
        return;
    }
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("creation_projection_overload");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = owned_test_manager(&root).unwrap();
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(Arc::clone(&gate));
    let creation_manager = manager.clone();
    let cwd = root.clone();
    let creation = tokio::spawn(async move {
        post_json(
            router(creation_manager),
            "/sessions",
            serde_json::json!({
                "behavior": "direct", "cwd": cwd, "model": "gpt-5.2",
                "backend": "openai-responses", "api_key_env": "OPENAI_API_KEY"
            }),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();

    // Occupy the real bounded caller adapter only after runtime construction.
    // The response read must then either succeed or reject without a session row.
    let release = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    // Always release blocking threads before Tokio runtime teardown, including
    // when an assertion fails while the caller budget is saturated.
    let release_guard = ReleaseCallers(Arc::clone(&release));
    let (entered, observed) = std::sync::mpsc::channel();
    let mut callers = Vec::new();
    for _ in 0..128 {
        let release = Arc::clone(&release);
        let entered = entered.clone();
        callers.push(nac_core::store::spawn_blocking_store_caller(move || {
            entered.send(()).unwrap();
            let (lock, condition) = &*release;
            let guard = lock.lock().unwrap();
            drop(condition.wait_while(guard, |released| !*released).unwrap());
        }));
    }
    for _ in 0..128 {
        observed.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    gate.resume.notify_one();
    let response = tokio::time::timeout(Duration::from_secs(5), creation)
        .await
        .unwrap()
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    drop(release_guard);
    for caller in callers {
        caller.await.unwrap();
    }
    let durable = sessions::list_sessions(&manager.inner.store_path).unwrap();
    let acknowledged = if status == StatusCode::CREATED {
        vec![
            serde_json::from_slice::<serde_json::Value>(&body).unwrap()["metadata"]["session_id"]
                .as_str()
                .unwrap()
                .to_owned(),
        ]
    } else {
        assert!(String::from_utf8_lossy(&body).contains("persistence caller capacity is full"));
        Vec::new()
    };
    let stored = durable
        .into_iter()
        .map(|session| session.session_id)
        .collect::<Vec<_>>();
    manager.drain_persistence().await.unwrap();
    assert_eq!(
        stored, acknowledged,
        "rejected creation left a durable orphan: status={status}"
    );
    println!("caller saturation completed");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rejected_creation_queue_does_not_leave_a_durable_session() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("creation_queue_overload");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    seed_session(&root, "baseline", "2026-01-01 00:00:00.000000000");
    let baseline = sessions::load_session(&root.join("store.db"), "baseline").unwrap();
    let manager = owned_test_manager(&root).unwrap();
    let (gate, creation) = pause_creation(&manager, &root).await;
    let connection = rusqlite::Connection::open(root.join("store.db")).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    let writer_manager = manager.clone();
    let writer = tokio::spawn(async move {
        writer_manager
            .inner
            ._store_ownership
            .coordinator()
            .unwrap()
            .save_session(baseline)
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
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
    let mut reads = Vec::new();
    for _ in 0..128 {
        let manager = manager.clone();
        reads.push(tokio::spawn(async move {
            manager
                .inner
                ._store_ownership
                .coordinator()
                .unwrap()
                .list_sessions()
                .await
        }));
    }
    tokio::time::timeout(Duration::from_secs(1), async {
        while manager
            .inner
            ._store_ownership
            .coordinator()
            .unwrap()
            .stats()
            .queued
            != 128
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    gate.resume.notify_one();
    let result = tokio::time::timeout(Duration::from_secs(1), creation).await;
    connection.execute_batch("ROLLBACK").unwrap();
    drop(connection);
    writer.await.unwrap().unwrap();
    for read in reads {
        read.await.unwrap().unwrap();
    }
    let response = result.unwrap().unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    assert!(String::from_utf8_lossy(&body).contains("persistence queue is full"));
    let durable = sessions::list_sessions(&manager.inner.store_path).unwrap();
    assert_eq!(durable.len(), 1);
    assert_eq!(durable[0].session_id, "baseline");
    manager.drain_persistence().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn successful_creation_snapshot_matches_committed_projection() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("creation_response_compatibility");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = owned_test_manager(&root).unwrap();
    for behavior in ["orchestrator", "direct", "direct-with-orchestrator"] {
        let response = post_json(
            router(manager.clone()),
            "/sessions",
            serde_json::json!({
                "behavior": behavior, "cwd": root, "model": "gpt-5.2",
                "backend": "openai-responses", "api_key_env": "OPENAI_API_KEY"
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let created: SessionFrontendSnapshot = serde_json::from_slice(&bytes).unwrap();
        let id = created.metadata.session_id.as_deref().unwrap();
        let committed = manager.snapshot(id).await.unwrap();
        assert_eq!(
            serde_json::to_value(created).unwrap(),
            serde_json::to_value(committed).unwrap()
        );
    }
    manager.drain_persistence().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
