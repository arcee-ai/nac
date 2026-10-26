use super::task_launches::{fixture, launch_status};
use super::*;
use nac_core::store::TaskLaunchPhase;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

struct GitGate {
    ready: PathBuf,
    release: PathBuf,
    environment: Vec<(&'static str, Option<std::ffi::OsString>)>,
}
impl GitGate {
    fn install(root: &Path, source_resolution: bool) -> Self {
        let old_path = std::env::var_os("PATH").unwrap();
        let git = std::env::split_paths(&old_path)
            .map(|p| p.join("git"))
            .find(|p| p.is_file())
            .unwrap();
        let bin = root.join("bin");
        std::fs::create_dir(&bin).unwrap();
        let selector = if source_resolution {
            "rev-parse --show-toplevel"
        } else {
            "worktree add"
        };
        let shim = bin.join("git");
        std::fs::write(&shim, format!("#!/bin/sh\ncase \"$*\" in *'{selector}'*) trap '' TERM; /bin/sleep 1000 & echo $! > \"$NAC_TEST_TASK_GIT_READY.child\"; echo $$ > \"$NAC_TEST_TASK_GIT_READY\"; while [ ! -f \"$NAC_TEST_TASK_GIT_RELEASE\" ]; do /bin/sleep 0.01; done ;; esac\nexec \"$NAC_TEST_TASK_REAL_GIT\" \"$@\"\n")).unwrap();
        std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o700)).unwrap();
        let ready = root.join("git-ready");
        let release = root.join("git-release");
        let mut paths = vec![bin];
        paths.extend(std::env::split_paths(&old_path));
        let values = [
            ("PATH", std::env::join_paths(paths).unwrap()),
            ("NAC_TEST_TASK_REAL_GIT", git.into_os_string()),
            ("NAC_TEST_TASK_GIT_READY", ready.clone().into_os_string()),
            (
                "NAC_TEST_TASK_GIT_RELEASE",
                release.clone().into_os_string(),
            ),
        ];
        let environment = values
            .iter()
            .map(|(name, _)| (*name, std::env::var_os(name)))
            .collect();
        for (name, value) in values {
            unsafe {
                std::env::set_var(name, value);
            }
        }
        Self {
            ready,
            release,
            environment,
        }
    }
}
impl Drop for GitGate {
    fn drop(&mut self) {
        let _ = std::fs::write(&self.release, "release fixture on failure");
        for (name, value) in self.environment.drain(..) {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}
async fn until(mut predicate: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !predicate() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}
fn process_live(pid: i32) -> bool {
    // These PIDs come only from this fixture's owned, unreleased Git gate.
    unsafe { libc::kill(pid, 0) == 0 }
}
async fn owned_manager(root: &Path) -> SessionManager {
    SessionManager::new_async(ServerOptions {
        root_cwd: root.into(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap()
}
async fn shutdown_git(source_resolution: bool) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_shutdown_git");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let setup = test_manager(&root);
    let request = fixture(&root, &setup).await;
    drop(setup);
    let manager = owned_manager(&root).await;
    let app = router(manager.clone());
    let gate = GitGate::install(&root, source_resolution);
    let call_app = app.clone();
    let data = serde_json::to_value(&request).unwrap();
    let call = tokio::spawn(async move { post_json(call_app, "/task-launches", data).await });
    until(|| gate.ready.exists()).await;
    let pid: i32 = std::fs::read_to_string(&gate.ready)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let child: i32 = std::fs::read_to_string(gate.ready.with_extension("child"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(process_live(pid));
    assert!(process_live(child));
    if source_resolution {
        call.abort();
        let _ = call.await;
    } else {
        assert_eq!(call.await.unwrap().status(), StatusCode::OK);
    }
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(
            &manager.inner.store_path,
            &format!("task-launch:{}", request.request_id)
        ),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let forced = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mark = forced.clone();
    serve_listener_with_shutdown(
        listener,
        None,
        manager.clone(),
        async {},
        Duration::from_secs(5),
        move || {
            mark.store(true, std::sync::atomic::Ordering::Release);
        },
    )
    .await
    .unwrap();
    assert!(!forced.load(std::sync::atomic::Ordering::Acquire));
    assert!(!gate.release.exists());
    assert!(
        !process_live(pid),
        "Git must be reaped before complete shutdown"
    );
    until(|| !process_live(child)).await;
    let lease = sessions::SessionOperationLease::try_acquire(
        &manager.inner.store_path,
        &format!("task-launch:{}", request.request_id),
    )
    .unwrap();
    drop(lease);
    let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let (phase, input): (String, Option<i64>) = if source_resolution {
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM task_launches", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        ("unreserved".into(), None)
    } else {
        connection
            .query_row(
                "SELECT phase,first_input_id FROM task_launches WHERE request_id=?1",
                [&request.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
    };
    assert_eq!(
        phase,
        if source_resolution {
            "unreserved"
        } else {
            "failed"
        }
    );
    assert!(input.is_none());
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    std::fs::write(&gate.release, "release after shutdown").unwrap();
    assert!(!root
        .join("task-worktrees")
        .read_dir()
        .is_ok_and(|paths| paths
            .flatten()
            .any(|p| p.path().join("nested/file").exists())));
    drop(connection);
    drop(gate);
    drop(app);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shutdown_terminates_retained_git_before_store_drain() {
    shutdown_git(false).await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aborted_http_source_resolution_stays_owned_until_shutdown_reaps_git() {
    shutdown_git(true).await;
}

async fn shutdown_publication(watchdog: bool) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_shutdown_publication");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let setup = test_manager(&root);
    let request = fixture(&root, &setup).await;
    drop(setup);
    let manager = owned_manager(&root).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(gate.clone());
    let app = router(manager.clone());
    assert_eq!(
        post_json(
            app.clone(),
            "/task-launches",
            serde_json::to_value(&request).unwrap()
        )
        .await
        .status(),
        StatusCode::OK
    );
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    let record = launch_status(app.clone(), &request.request_id).await;
    assert!(record.workspace_path.join("nested/file").exists());
    assert_eq!(record.phase, TaskLaunchPhase::PreparingRuntime);
    let forced = Arc::new(tokio::sync::Notify::new());
    let mark = forced.clone();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let owner = manager.clone();
    let server = tokio::spawn(serve_listener_with_shutdown(
        listener,
        None,
        owner,
        async {},
        if watchdog {
            Duration::from_millis(100)
        } else {
            Duration::from_secs(5)
        },
        move || {
            mark.notify_one();
        },
    ));
    until(|| manager.inner.task_preparations.git.check_running().is_err()).await;
    assert!(!server.is_finished());
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(
            &manager.inner.store_path,
            &format!("task-launch:{}", request.request_id)
        ),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    let mut other = request.clone();
    other.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        post_json(
            app.clone(),
            "/task-launches",
            serde_json::to_value(other).unwrap()
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    if watchdog {
        tokio::time::timeout(Duration::from_secs(2), forced.notified())
            .await
            .unwrap();
        assert!(
            !server.is_finished(),
            "watchdog must still cover preparation settlement"
        );
    }
    gate.resume.notify_one();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM session_inbox", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let phase: String = connection
        .query_row(
            "SELECT phase FROM task_launches WHERE request_id=?1",
            [&request.request_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(phase, "failed");
    assert!(record.workspace_path.join("nested/file").exists());
    let lease = sessions::SessionOperationLease::try_acquire(
        &manager.inner.store_path,
        &format!("task-launch:{}", request.request_id),
    )
    .unwrap();
    drop(lease);
    drop(connection);
    drop(app);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shutdown_fences_task_publication_and_new_initial_input() {
    shutdown_publication(false).await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn complete_shutdown_watchdog_remains_armed_during_task_publication() {
    shutdown_publication(true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn committed_task_input_stays_pending_through_late_publication_and_shutdown() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_shutdown_after_commit");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let setup = test_manager(&root);
    let request = fixture(&root, &setup).await;
    drop(setup);
    let manager = owned_manager(&root).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_after_persistence
        .lock()
        .unwrap() = Some(gate.clone());
    let app = router(manager.clone());
    assert_eq!(
        post_json(
            app.clone(),
            "/task-launches",
            serde_json::to_value(&request).unwrap()
        )
        .await
        .status(),
        StatusCode::OK
    );
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    let record = launch_status(app.clone(), &request.request_id).await;
    assert_eq!(record.phase, TaskLaunchPhase::Ready);
    assert!(record.first_input_id.is_some());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let owner = manager.clone();
    let server = tokio::spawn(serve_listener_with_shutdown(
        listener,
        None,
        owner,
        async {},
        Duration::from_secs(5),
        || panic!("shutdown watchdog reached"),
    ));
    until(|| manager.inner.task_preparations.git.check_running().is_err()).await;
    assert!(!server.is_finished());
    // Attach while the real committed creation is still unpublished. This must
    // expose the existing receipt without claiming its pending initial input.
    manager.snapshot(&record.session_id).await.unwrap();
    assert!(manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&record.session_id)
        .unwrap()
        .active_run()
        .is_none());
    gate.resume.notify_one();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let (status, runs): (String, i64) = connection.query_row(
        "SELECT i.status,s.run_count FROM session_inbox i JOIN sessions s ON s.session_id=i.session_id WHERE i.id=?1",
        [record.first_input_id.unwrap()], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(status, "pending");
    assert_eq!(runs, 0);
    assert!(record.workspace_path.join("nested/file").exists());
    drop(connection);
    drop(app);
    drop(manager);
    let manager = owned_manager(&root).await;
    let retry = application::task_launches::TaskLaunchApplication::new(&manager)
        .start(request)
        .await
        .unwrap();
    assert_eq!(retry.session_id, record.session_id);
    assert_eq!(retry.first_input_id, record.first_input_id);
    manager.snapshot(&record.session_id).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
            let runs: i64 = connection
                .query_row(
                    "SELECT run_count FROM sessions WHERE session_id=?1",
                    [&record.session_id],
                    |r| r.get(0),
                )
                .unwrap();
            if runs == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
