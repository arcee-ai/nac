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
        let response = post_json(
            app.clone(),
            &format!("/task-launches/{}/cancel", record.request.request_id),
            serde_json::json!({}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(record.workspace_path.join("nested/file").is_file());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn retained_task_invalid_ref_or_title_is_a_request_error_without_reservation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_task_invalid_input");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let request = fixture(&root, &manager).await;
    let app = router(manager.clone());
    for field in ["git_ref", "default_ref", "title", "option_ref"] {
        let mut invalid = serde_json::to_value(&request).unwrap();
        let key = if field == "option_ref" {
            "git_ref"
        } else {
            field
        };
        invalid[key] = if field == "title" {
            "x".repeat(121).into()
        } else if field == "option_ref" {
            "--help".into()
        } else {
            "missing-branch".into()
        };
        let response = post_json(app.clone(), "/task-launches", invalid).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    assert!(
        nac_core::store::list_task_launches(&manager.inner.store_path, &request.project_id)
            .unwrap()
            .is_empty()
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn retained_task_unbound_broken_git_pointer_never_advertises_existing_checkout_fallback() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_task_broken_pointer");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let request = fixture(&root, &manager).await;
    std::fs::rename(root.join("repo/.git"), root.join("retained-git-metadata")).unwrap();
    std::fs::write(root.join("repo/.git"), "gitdir: /missing-nac-gitdir\n").unwrap();
    let response = get_response(
        router(manager.clone()),
        &format!("/projects/{}/task-launch-source", request.project_id),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(sessions::list_sessions(&manager.inner.store_path)
        .unwrap()
        .is_empty());
    assert!(
        nac_core::store::list_task_launches(&manager.inner.store_path, &request.project_id)
            .unwrap()
            .is_empty()
    );
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

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retained_task_cancel_during_real_git_effect_keeps_inventory_and_never_admits_input() {
    use std::os::unix::fs::PermissionsExt;
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("retained_task_git_cancel");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let request = fixture(&root, &manager).await;
    let original_path = std::env::var_os("PATH");
    let git = std::env::split_paths(original_path.as_ref().unwrap())
        .map(|p| p.join("git"))
        .find(|p| p.is_file())
        .unwrap();
    let bin = root.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let shim = bin.join("git");
    std::fs::write(&shim,"#!/bin/sh\ncase \"$*\" in *'worktree add'*) : > \"$NAC_TEST_TASK_GIT_READY\"; while [ ! -f \"$NAC_TEST_TASK_GIT_RELEASE\" ]; do /bin/sleep 0.01; done ;; esac\nexec \"$NAC_TEST_TASK_REAL_GIT\" \"$@\"\n").unwrap();
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o700)).unwrap();
    let ready = root.join("git-ready");
    let release = root.join("git-release");
    struct Environment(Vec<(&'static str, Option<std::ffi::OsString>)>);
    impl Drop for Environment {
        fn drop(&mut self) {
            for (name, value) in self.0.drain(..) {
                unsafe {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
            }
        }
    }
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(original_path.as_ref().unwrap()));
    let values = [
        ("PATH", std::env::join_paths(paths).unwrap()),
        ("NAC_TEST_TASK_REAL_GIT", git.into_os_string()),
        ("NAC_TEST_TASK_GIT_READY", ready.clone().into_os_string()),
        (
            "NAC_TEST_TASK_GIT_RELEASE",
            release.clone().into_os_string(),
        ),
    ];
    let environment = Environment(
        values
            .iter()
            .map(|(name, _)| (*name, std::env::var_os(name)))
            .collect(),
    );
    for (name, value) in values {
        unsafe {
            std::env::set_var(name, value);
        }
    }
    struct ReleaseOnDrop(std::path::PathBuf);
    impl Drop for ReleaseOnDrop {
        fn drop(&mut self) {
            let _ = std::fs::write(&self.0, "release interrupted fixture");
        }
    }
    let _release_on_drop = ReleaseOnDrop(release.clone());
    let app = router(manager.clone());
    let response = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&request).unwrap(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    tokio::time::timeout(Duration::from_secs(5), async {
        while !ready.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let record = launch_status(app.clone(), &request.request_id).await;
    assert_eq!(record.phase, TaskLaunchPhase::PreparingWorkspace);
    let cancelled = post_json(
        app.clone(),
        &format!("/task-launches/{}/cancel", request.request_id),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        cancelled.status(),
        StatusCode::OK,
        "Git must not hold the DB transaction during effects"
    );
    assert_eq!(
        launch_status(app.clone(), &request.request_id).await.phase,
        TaskLaunchPhase::Cancelled
    );
    std::fs::write(release, "resume real Git").unwrap();
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
    let settled = launch_status(app, &request.request_id).await;
    assert_eq!(settled.phase, TaskLaunchPhase::Cancelled);
    assert!(settled.first_input_id.is_none());
    assert!(!settled.session_present);
    assert_eq!(
        std::fs::read_to_string(record.workspace_path.join("nested/file")).unwrap(),
        "committed"
    );
    assert!(sessions::list_sessions(&manager.inner.store_path)
        .unwrap()
        .is_empty());
    drop(environment);
    std::fs::remove_dir_all(root).unwrap();
}
