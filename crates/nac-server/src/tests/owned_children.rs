use super::*;

fn init_owned_child_workspace(root: &std::path::Path) {
    std::fs::write(root.join(".gitignore"), "store.db*\nnac-home/\n").unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["add", ".gitignore"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "child fixture",
        ],
    ] {
        assert!(std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn cancelled_owned_child_creation_retains_relationship_lease_until_commit() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cancelled_owned_child_creation");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, None);
    seed_direct_session(&root, "parent");
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let path = manager.inner.store_path.clone();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    *CHILD_CREATION_PAUSE.lock().unwrap() =
        Some((path.clone(), "parent".into(), started_tx, release_rx));
    let creator = manager.clone();
    let task = tokio::spawn(async move {
        creator
            .create_traditional_child_session("parent", "general", "leased creation")
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), started_rx)
        .await
        .unwrap()
        .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(matches!(
        sessions::SessionRelationshipLease::try_acquire(&path, "parent"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match sessions::SessionRelationshipLease::try_acquire(&path, "parent") {
                Ok(lease) => {
                    drop(lease);
                    break;
                }
                Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                    tokio::time::sleep(Duration::from_millis(10)).await
                }
                Err(error) => panic!("relationship lease probe failed: {error}"),
            }
        }
    })
    .await
    .unwrap();
    let children_path = path.clone();
    let children = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_traditional_children(&children_path, "parent")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(children.len(), 1);
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_child_launch_and_wait_use_coordinator() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_current_thread_child");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-fixture-key"));
    init_owned_child_workspace(&root);
    let (base_url, requests) = scripted_direct_responses(&[
        "foreground report",
        "background report",
        "parent acknowledged",
    ]);
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let controller =
        nac_core::traditional_children::controller_for(&manager.inner.store_path).unwrap();
    let start = |child_session_id, execution_mode| {
        nac_core::traditional_children::TraditionalChildStartRequest {
            parent_session_id: "direct".into(),
            child_session_id,
            profile: "general".into(),
            description: Some("owned child fixture".into()),
            prompt: "work".into(),
            origin: nac_core::store::InputOrigin::Automation,
            execution_mode,
        }
    };
    let first = tokio::time::timeout(
        Duration::from_secs(5),
        controller.start(start(None, TraditionalChildExecutionMode::Foreground)),
    )
    .await
    .unwrap()
    .unwrap();
    let first = tokio::time::timeout(
        Duration::from_secs(5),
        controller.wait(&first.child_session_id, first.generation),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(first.report.as_deref(), Some("foreground report"));
    let second = tokio::time::timeout(
        Duration::from_secs(5),
        controller.start(start(
            Some(first.child_session_id.clone()),
            TraditionalChildExecutionMode::Background,
        )),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(second.generation, first.generation + 1);
    let second = tokio::time::timeout(
        Duration::from_secs(5),
        controller.wait(&second.child_session_id, second.generation),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(second.report.as_deref(), Some("background report"));
    let app = crate::delivery::server::build_router(manager.clone());
    assert_eq!(
        get_response(app.clone(), "/sessions/direct/children", None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        get_response(
            app.clone(),
            &format!("/sessions/direct/children/{}", second.child_session_id),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        get_response(
            app,
            &format!("/sessions/other/children/{}", second.child_session_id),
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let path = manager.inner.store_path.clone();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let path = path.clone();
            let inbox = nac_core::store::spawn_blocking_store_caller(move || {
                nac_core::store::list_session_inbox(&path, "direct")
            })
            .await
            .unwrap()
            .unwrap();
            if inbox.len() == 1 && inbox[0].status == nac_core::store::InboxStatus::Delivered {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background completion should be delivered once");
    let parent = manager.attach_session("direct").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while parent.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    tokio::task::spawn_blocking(move || {
        for index in 0..3 {
            assert_eq!(
                requests.recv_timeout(Duration::from_secs(5)).unwrap(),
                index
            );
        }
    })
    .await
    .unwrap();
    manager.drain_persistence().await.unwrap();
    drop(parent);
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_child_cancel_endpoint_preserves_generation() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_current_thread_child_cancel");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("owned-child-cancel-key"));
    init_owned_child_workspace(&root);
    let (base_url, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let app = crate::delivery::server::build_router(manager.clone());
    let start = app.clone().oneshot(Request::builder().method("POST").uri("/sessions/direct/children")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"profile":"general","description":"cancel fixture","prompt":"wait","background":true}"#)).unwrap()).await.unwrap();
    assert_eq!(start.status(), StatusCode::CREATED);
    let running: TraditionalChildRecord =
        serde_json::from_slice(&response_body(start).await).unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0)
    })
    .await
    .unwrap();
    let controller =
        nac_core::traditional_children::controller_for(&manager.inner.store_path).unwrap();
    let stale = controller
        .cancel("direct", &running.child_session_id, running.generation + 1)
        .await
        .unwrap_err();
    assert!(stale.to_string().contains("superseded"));
    let cancel = tokio::time::timeout(
        Duration::from_secs(10),
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/sessions/direct/children/{}/cancel",
                    running.child_session_id
                ))
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancelled: TraditionalChildRecord =
        serde_json::from_slice(&response_body(cancel).await).unwrap();
    assert_eq!(cancelled.generation, running.generation);
    assert_eq!(
        cancelled.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert!(cancelled.completion_inbox_id.is_some());
    release.send(()).unwrap();
    let path = manager.inner.store_path.clone();
    let inbox = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_session_inbox(&path, "direct")
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(cancelled.completion_inbox_id, Some(inbox[0].id));
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let _ = std::fs::remove_dir_all(root);
}
