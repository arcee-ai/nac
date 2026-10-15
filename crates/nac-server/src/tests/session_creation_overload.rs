use super::*;

const OVERLOAD_CHILD_ENV: &str = "NAC_TEST_CREATION_OVERLOAD_CHILD";
const OVERLOAD_CASE: &str =
    "tests::session_creation_overload::rejected_creation_projection_does_not_leave_a_durable_session";

struct CallerRelease(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);

impl CallerRelease {
    fn release(&self) {
        let (lock, condition) = &*self.0;
        *lock.lock().unwrap_or_else(|error| error.into_inner()) = true;
        condition.notify_all();
    }
}

impl Drop for CallerRelease {
    fn drop(&mut self) {
        self.release();
    }
}

async fn overload_child(mode: &str) -> (std::process::ExitStatus, String) {
    // A separate process owns the unchanged global caller pool. Parent tests
    // keep running concurrently and cannot consume this case's 128 permits.
    let root = temp_root(&format!("creation_overload_child_{}", uuid::Uuid::new_v4()));
    let log_path = root.join("output.log");
    let log = std::fs::File::create(&log_path).unwrap();
    let mut child = tokio::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", OVERLOAD_CASE, "--nocapture"])
        .env(OVERLOAD_CHILD_ENV, mode)
        .stdin(std::process::Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    // This is a supervisor bound for a broken fixture, not an extension of
    // the five-second candidate assertion inside the actual overload case.
    let result = tokio::time::timeout(Duration::from_secs(60), child.wait()).await;
    let timed_out = result.is_err();
    let status = match result {
        Ok(status) => status.unwrap(),
        Err(_) => {
            child.kill().await.unwrap();
            child.wait().await.unwrap()
        }
    };
    let output = std::fs::read_to_string(log_path).unwrap();
    eprintln!("overload child mode={mode} status={status}:\n{output}");
    std::fs::remove_dir_all(root).unwrap();
    assert!(!timed_out, "overload child exceeded supervisor bound");
    (status, output)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn overload_child_panic_releases_callers_without_poisoning_parent() {
    let (status, output) = overload_child("panic-after-entry").await;
    assert!(!status.success(), "intentional child panic was hidden");
    assert!(output.contains("intentional overload fixture panic"));
    assert!(output.contains("overload fixture joined all 128 callers"));
    assert!(output.contains("test result: FAILED"));
    assert!(!output.contains("test result: ok"));
    // The child deliberately panics while holding this same logical lock.
    // Its poisoning and runtime teardown must stay inside the child process.
    drop(SERVER_MODEL_ENV_LOCK.lock().unwrap());
}

#[tokio::test]
async fn overload_admission_does_not_require_all_blocking_workers_to_start() {
    let (status, output) = overload_child("queued-callers").await;
    assert!(status.success(), "queued-caller fixture failed: {output}");
    assert!(output.contains("overload fixture joined all 128 callers"));
    assert!(output.contains("test result: ok. 1 passed"));
}

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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rejected_creation_projection_does_not_leave_a_durable_session() {
    let Some(mode) = std::env::var_os(OVERLOAD_CHILD_ENV) else {
        let (status, output) = overload_child("run").await;
        assert!(status.success(), "overload child failed: {status}");
        assert!(output.contains("test result: ok. 1 passed"));
        assert!(!output.contains("test result: FAILED"));
        return;
    };
    if mode == "queued-callers" {
        // Exercise all 128 admissions with most closures queued rather than
        // assuming a matching number of available blocking worker threads.
        std::thread::spawn(|| {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(4)
                .max_blocking_threads(2)
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(projection_overload_case(false));
        })
        .join()
        .unwrap();
        return;
    }
    assert!(mode == "run" || mode == "panic-after-entry");
    projection_overload_case(mode == "panic-after-entry").await;
}

async fn projection_overload_case(panic_after_admission: bool) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root(&format!(
        "creation_projection_overload_{}",
        std::process::id()
    ));
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
    let release_guard = CallerRelease(Arc::clone(&release));
    let exercise_release = CallerRelease(Arc::clone(&release));
    let mut callers = Vec::new();
    for _ in 0..128 {
        let release = Arc::clone(&release);
        callers.push(nac_core::store::spawn_blocking_store_caller(move || {
            let (lock, condition) = &*release;
            let guard = lock.lock().unwrap();
            drop(condition.wait_while(guard, |released| !*released).unwrap());
        }));
    }
    // Admission owns each permit synchronously, before a closure is scheduled.
    // Rejection is already finished; admitted closures cannot finish until the
    // release gate opens. All 128 may occupy capacity while most remain queued.
    let all_admitted = callers.iter().all(|caller| !caller.is_finished());
    // Capture assertion panics so every admitted caller is released and joined
    // before propagating failure. The guard also releases on cancellation.
    let exercise = tokio::spawn(async move {
        let _release_guard = exercise_release;
        assert!(all_admitted, "all 128 callers must be admitted");
        assert!(!panic_after_admission, "intentional overload fixture panic");
        gate.resume.notify_one();
        let response = tokio::time::timeout(Duration::from_secs(5), creation)
            .await
            .unwrap()
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, body)
    })
    .await;
    release_guard.release();
    let mut caller_errors = Vec::new();
    for caller in callers {
        if let Err(error) = caller.await {
            caller_errors.push(error);
        }
    }
    assert!(
        caller_errors.is_empty(),
        "caller failures: {caller_errors:?}"
    );
    eprintln!("overload fixture joined all 128 callers");
    let (status, body) = exercise.unwrap();
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
