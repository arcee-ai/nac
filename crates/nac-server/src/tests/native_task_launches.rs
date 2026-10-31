use super::*;
use crate::application::native_task_launches::NativeTaskLaunchController;
use nac_core::task_launch_control::{NativeTaskRequest, TaskLaunchController, TaskWorkspace};

fn request(project: Option<String>) -> NativeTaskRequest {
    NativeTaskRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        project_id: project,
        title: "Separate native task".into(),
        prompt: "Only explicit handoff facts".into(),
        skill: Some("qa".into()),
        model: None,
        reasoning_effort: None,
        workspace: TaskWorkspace::Auto,
        git_ref: None,
        default_ref: Some("dev".into()),
    }
}

async fn start(
    controller: &NativeTaskLaunchController,
    caller: &str,
    input: NativeTaskRequest,
    store_path: &std::path::Path,
) -> nac_core::task_launch_control::NativeTaskReceipt {
    let target = controller.resolve(caller, &input).await.unwrap();
    let authorization = nac_core::task_launch_control::NativeTaskAuthorization::for_local_fixture(
        store_path.to_path_buf(),
        caller.to_owned(),
        target.cwd.clone(),
    );
    controller
        .launch(caller, input, target, authorization)
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_same_project_retry_and_non_git_launch_publish_independent_goal_free_tasks() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("native_launch_service");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let manager = test_manager(&root);
    let fixture = task_launches::fixture(&root, &manager).await;
    let caller = manager
        .session_creation()
        .create_session(application::session_creation::SessionCreationCommand {
            behavior: sessions::SessionBehavior::Direct,
            project_id: Some(fixture.project_id.clone()),
            ..Default::default()
        })
        .await
        .unwrap()
        .metadata
        .session_id
        .unwrap();
    let controller = NativeTaskLaunchController::new(&manager);
    let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    conn.execute(
        "UPDATE sessions SET permission_approval_mode='auto_approve' WHERE session_id=?1",
        [&caller],
    )
    .unwrap();
    drop(conn);
    let input = request(None);
    let first = start(
        &controller,
        &caller,
        input.clone(),
        &manager.inner.store_path,
    )
    .await;
    tokio::time::timeout(
        Duration::from_secs(20),
        manager.inner.task_preparations.settle(),
    )
    .await
    .unwrap();
    let ready = controller.status(&caller, &input.request_id).await.unwrap();
    assert_eq!(ready.launch.phase, "ready", "{:?}", ready.launch.error);
    assert_eq!(ready.launch.session_id, first.launch.session_id);
    assert!(
        ready
            .retained_launch
            .as_ref()
            .unwrap()
            .source
            .excluded_source_edits
    );
    assert_eq!(
        ready.retained_launch.as_ref().unwrap().source.selected_ref,
        ready.retained_launch.as_ref().unwrap().source.commit
    );
    let task = ready.task.unwrap();
    assert_eq!(task.behavior, "direct");
    assert!(task.goal.is_none());
    let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let mode: String = conn
        .query_row(
            "SELECT permission_approval_mode FROM sessions WHERE session_id=?1",
            [&first.launch.session_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        mode, "manual",
        "independent tasks do not inherit the caller's human answer policy"
    );
    drop(conn);
    assert_eq!(
        ready.navigation,
        format!("/session/{}", ready.launch.session_id)
    );
    let repeated = start(
        &controller,
        &caller,
        input.clone(),
        &manager.inner.store_path,
    )
    .await;
    assert_eq!(repeated.launch.session_id, first.launch.session_id);
    let mut changed = input.clone();
    changed.prompt.push('!');
    assert!(controller
        .resolve(&caller, &changed)
        .await
        .unwrap_err()
        .to_string()
        .contains("conflict"));
    let mut distinct = input;
    distinct.request_id = uuid::Uuid::new_v4().to_string();
    let other = start(&controller, &caller, distinct, &manager.inner.store_path).await;
    assert_ne!(first.launch.session_id, other.launch.session_id);
    tokio::time::timeout(
        Duration::from_secs(20),
        manager.inner.task_preparations.settle(),
    )
    .await
    .unwrap();

    let predecessor = first.launch.request.clone();
    let pinned = ready
        .retained_launch
        .as_ref()
        .unwrap()
        .source
        .commit
        .clone();
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root.join("repo"))
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "advance caller HEAD",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut explicit = predecessor.clone();
    explicit.request_id = uuid::Uuid::new_v4().to_string();
    explicit.git_ref = Some(pinned.clone());
    let exact = start(
        &controller,
        &caller,
        explicit.clone(),
        &manager.inner.store_path,
    )
    .await;
    tokio::time::timeout(
        Duration::from_secs(20),
        manager.inner.task_preparations.settle(),
    )
    .await
    .unwrap();
    assert_eq!(
        controller
            .status(&caller, &explicit.request_id)
            .await
            .unwrap()
            .retained_launch
            .unwrap()
            .source
            .commit,
        pinned
    );
    assert_ne!(exact.launch.session_id, first.launch.session_id);
    let original_retry = start(&controller, &caller, predecessor, &manager.inner.store_path).await;
    assert_eq!(
        original_retry.retained_launch.unwrap().source.commit,
        pinned,
        "moving HEAD never repins an exact request retry"
    );
    let mut checkout = request(None);
    checkout.workspace = TaskWorkspace::ExistingCheckout;
    checkout.default_ref = None;
    let shared = start(&controller, &caller, checkout, &manager.inner.store_path).await;
    tokio::time::timeout(
        Duration::from_secs(20),
        manager.inner.task_preparations.settle(),
    )
    .await
    .unwrap();
    let shared = controller
        .status(&caller, &shared.launch.request.request_id)
        .await
        .unwrap();
    assert_eq!(shared.launch.phase, "ready", "{:?}", shared.launch.error);
    assert!(shared.retained_launch.is_none());
    assert_eq!(
        sessions::load_session(&manager.inner.store_path, &shared.launch.session_id)
            .unwrap()
            .cwd,
        first.launch.source_cwd
    );

    let local = root.join("ordinary");
    std::fs::create_dir(&local).unwrap();
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Ordinary non-Git".into()),
            description: None,
            cwd: local.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("task-config".into()),
        })
        .await
        .unwrap();
    let mut input = request(Some(project.project_id));
    input.default_ref = None;
    input.model = Some("gpt-5.2".into());
    input.reasoning_effort = Some("low".into());
    let ordinary = start(
        &controller,
        &caller,
        input.clone(),
        &manager.inner.store_path,
    )
    .await;
    tokio::time::timeout(
        Duration::from_secs(20),
        manager.inner.task_preparations.settle(),
    )
    .await
    .unwrap();
    let ordinary = controller
        .status(&caller, &ordinary.launch.request.request_id)
        .await
        .unwrap();
    assert!(controller
        .resolve(&caller, &request(Some("missing-project".into())))
        .await
        .is_err());
    nac_core::projects::insert_project(
        &manager.inner.store_path,
        nac_core::projects::NewProject {
            project_id: "remote-project".into(),
            name: Some("Remote unavailable".into()),
            description: None,
            cwd: "/remote".into(),
            ssh_host: Some("unavailable.invalid".into()),
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("task-config".into()),
        },
    )
    .unwrap();
    let projects = controller.projects(&caller).await.unwrap();
    assert!(
        !projects
            .iter()
            .find(|p| p.project_id == "remote-project")
            .unwrap()
            .eligible
    );
    assert!(controller
        .resolve(&caller, &request(Some("remote-project".into())))
        .await
        .is_err());
    assert_eq!(
        ordinary.launch.phase, "ready",
        "{:?}",
        ordinary.launch.error
    );
    assert!(ordinary.retained_launch.is_none());
    let snapshot =
        sessions::load_session(&manager.inner.store_path, &ordinary.launch.session_id).unwrap();
    assert_eq!(snapshot.cwd, std::fs::canonicalize(local).unwrap());
    assert_eq!(snapshot.behavior, sessions::SessionBehavior::Direct);
    assert_eq!(snapshot.model, "gpt-5.2");
    assert_eq!(snapshot.reasoning_effort.unwrap().as_str(), "low");
    let inbox =
        nac_core::store::list_session_inbox(&manager.inner.store_path, &snapshot.session_id)
            .unwrap();
    assert_eq!(inbox.len(), 1);
    assert!(inbox[0].content.contains("$qa"));
    assert_eq!(
        inbox[0]
            .content
            .matches("Only explicit handoff facts")
            .count(),
        1
    );
    assert!(controller
        .status(
            &ordinary.launch.session_id,
            &ordinary.launch.request.request_id
        )
        .await
        .is_err());
    let projectless = manager
        .session_creation()
        .create_session(application::session_creation::SessionCreationCommand {
            behavior: sessions::SessionBehavior::Direct,
            model: application::Field::Set("gpt-5.2".into()),
            backend: application::Field::Set("openai-responses".into()),
            base_url: application::Field::Set("http://127.0.0.1:9/v1".into()),
            api_key_env: application::Field::Set("OPENAI_API_KEY".into()),
            ..Default::default()
        })
        .await
        .unwrap()
        .metadata
        .session_id
        .unwrap();
    assert!(controller
        .resolve(&projectless, &request(None))
        .await
        .unwrap_err()
        .to_string()
        .contains("missing saved project"));
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    let restarted = test_manager(&root);
    let controller = NativeTaskLaunchController::new(&restarted);
    let retried = start(&controller, &caller, input, &restarted.inner.store_path).await;
    assert_eq!(retried.launch.session_id, ordinary.launch.session_id);
    assert_eq!(
        nac_core::store::list_session_inbox(
            &restarted.inner.store_path,
            &retried.launch.session_id
        )
        .unwrap()
        .len(),
        1
    );
    assert!(
        restarted.inner.active_sessions.read().await.is_empty(),
        "ready retry/status never attaches or wakes a target"
    );
    restarted.stop_local_run_admission().await;
    restarted.cancel_local_active_runs_for_shutdown().await;
    std::fs::remove_dir_all(root).unwrap();
}
