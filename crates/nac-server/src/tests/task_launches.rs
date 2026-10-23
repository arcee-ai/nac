use super::*;
use nac_core::store::{TaskLaunchPhase, TaskLaunchRecord, TaskLaunchRequest};

fn git(root: &std::path::Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn fixture(root: &std::path::Path, manager: &SessionManager) -> TaskLaunchRequest {
    let repo = root.join("repo");
    std::fs::create_dir_all(repo.join("nested")).unwrap();
    git(&repo, &["init", "-b", "dev"]);
    std::fs::write(repo.join("nested/file"), "committed").unwrap();
    git(&repo, &["add", "."]);
    git(
        &repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "seed",
        ],
    );
    model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        "task-config",
        model_configurations::NewModelConfiguration {
            name: "Task fixture".into(),
            backend: "openai-responses".into(),
            model: "gpt-5.2".into(),
            base_url: "http://127.0.0.1:9/v1".into(),
            allow_insecure_http: false,
            api_key_env: Some("OPENAI_API_KEY".into()),
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Retained fixture".into()),
            description: None,
            cwd: repo.join("nested"),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("task-config".into()),
        })
        .await
        .unwrap();
    TaskLaunchRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        project_id: project.project_id,
        invoking_session_id: None,
        git_ref: Some("dev".into()),
        default_ref: Some("dev".into()),
        title: "Task".into(),
        prompt: "One initial brief".into(),
    }
}

async fn launch_status(app: Router, id: &str) -> TaskLaunchRecord {
    let response = get_response(app, &format!("/task-launches/{id}"), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&response_body(response).await).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retained_task_http_cancel_before_commit_retains_workspace_and_rejects_changed_retry() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_task_cancel");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let request = fixture(&root, &manager).await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(gate.clone());
    let app = router(manager.clone());
    let response = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&request).unwrap(),
    )
    .await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&response_body(response).await)
    );
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    let record = launch_status(app.clone(), &request.request_id).await;
    assert_eq!(record.phase, TaskLaunchPhase::PreparingRuntime);
    assert!(!record.session_present);
    assert!(record.workspace_path.join("nested/file").exists());
    // Passive status did not publish/admit the initial input.
    assert!(!sessions::session_exists(&manager.inner.store_path, &record.session_id).unwrap());
    let mut changed = request.clone();
    changed.prompt.push('!');
    let conflict = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&changed).unwrap(),
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let cancel = post_json(
        app.clone(),
        &format!("/task-launches/{}/cancel", request.request_id),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(cancel.status(), StatusCode::OK);
    gate.resume.notify_one();
    let retry = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&request).unwrap(),
    )
    .await;
    assert_eq!(retry.status(), StatusCode::OK);
    assert_eq!(
        launch_status(app, &request.request_id).await.phase,
        TaskLaunchPhase::Cancelled
    );
    assert!(!sessions::session_exists(&manager.inner.store_path, &record.session_id).unwrap());
    assert!(record.workspace_path.join("nested/file").exists());
    // Do not tear down files until the already-authorized preparation releases
    // its cross-process lease after observing the cancellation transaction.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if sessions::SessionOperationLease::try_acquire(
                &manager.inner.store_path,
                &format!("task-launch:{}", request.request_id),
            )
            .is_ok()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retained_task_concurrent_first_launches_publish_distinct_sessions_and_initial_inputs() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_task_concurrent");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let first = fixture(&root, &manager).await;
    let mut second = first.clone();
    second.request_id = uuid::Uuid::new_v4().to_string();
    let app = router(manager.clone());
    let (a, b) = tokio::join!(
        post_json(
            app.clone(),
            "/task-launches",
            serde_json::to_value(&first).unwrap()
        ),
        post_json(
            app.clone(),
            "/task-launches",
            serde_json::to_value(&second).unwrap()
        )
    );
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);
    let records = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let a = launch_status(app.clone(), &first.request_id).await;
            let b = launch_status(app.clone(), &second.request_id).await;
            assert_ne!(a.phase, TaskLaunchPhase::Failed, "{:?}", a.error);
            assert_ne!(b.phase, TaskLaunchPhase::Failed, "{:?}", b.error);
            if a.phase == TaskLaunchPhase::Ready && b.phase == TaskLaunchPhase::Ready {
                break [a, b];
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_ne!(records[0].session_id, records[1].session_id);
    assert_ne!(records[0].workspace_path, records[1].workspace_path);
    assert_ne!(records[0].first_input_id, records[1].first_input_id);
    for record in &records {
        assert!(record.session_present);
        assert_eq!(
            nac_core::store::list_session_inbox(&manager.inner.store_path, &record.session_id)
                .unwrap()
                .len(),
            1
        );
    }
    for record in &records {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if sessions::SessionOperationLease::try_acquire(
                    &manager.inner.store_path,
                    &format!("task-launch:{}", record.request.request_id),
                )
                .is_ok()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        manager.delete_session(&record.session_id).await.unwrap();
        assert!(record.workspace_path.join("nested/file").is_file());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn retained_task_bound_missing_git_source_never_advertises_existing_checkout_fallback() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_task_source_probe");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let request = fixture(&root, &manager).await;
    let project = nac_core::projects::load_project_launch_context(
        &manager.inner.store_path,
        &request.project_id,
    )
    .unwrap()
    .project;
    let source =
        nac_core::workspace::task_worktree::resolve_source(&project, &request, None, None).unwrap();
    nac_core::store::reserve_task_launch(&manager.inner.store_path, request.clone(), source)
        .unwrap();
    std::fs::rename(root.join("repo/.git"), root.join("retained-git-metadata")).unwrap();
    let app = router(manager.clone());
    let response = get_response(
        app.clone(),
        &format!("/projects/{}/task-launch-source", request.project_id),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let info: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(
        info["eligible"], true,
        "bound Git source must stay on the isolated path and fail visibly"
    );
    let response = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&request).unwrap(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let record = launch_status(app.clone(), &request.request_id).await;
            if record.phase == TaskLaunchPhase::Failed {
                assert!(!record.session_present);
                assert!(record.error.is_some());
                assert!(!record.workspace_path.exists());
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(sessions::list_sessions(&manager.inner.store_path)
        .unwrap()
        .is_empty());
    std::fs::remove_dir_all(root).unwrap();
}
