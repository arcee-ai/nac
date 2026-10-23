use super::*;

async fn command(label: &str) -> (CreateSessionWithSnapshot, PathBuf) {
    let (parts, path) = crate::session_service::tests::test_active_service(label, "baseline");
    let mut snapshot = sessions::load_session(&path, "baseline").unwrap();
    snapshot.session_id = "fresh".into();
    let mut response = parts.service.frontend_snapshot().await.unwrap();
    response.metadata.session_id = Some(snapshot.session_id.clone());
    (
        CreateSessionWithSnapshot {
            snapshot,
            launch_id: None,
            response,
            resources: Arc::new(StdMutex::new(Some(
                crate::runtime::PreparedSessionResources::for_test(None),
            ))),
            after_commit: None,
        },
        path,
    )
}

fn git(root: &Path, args: &[&str]) -> String {
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
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn resource_worktree(path: &Path) -> crate::sandbox::SandboxWorktree {
    let repo = path.parent().unwrap().join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "--quiet"]);
    std::fs::write(repo.join("seed"), "seed").unwrap();
    git(&repo, &["add", "seed"]);
    git(
        &repo,
        &[
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "user.name=Test",
            "commit",
            "--quiet",
            "-m",
            "seed",
        ],
    );
    let fork_point = git(&repo, &["rev-parse", "HEAD"]);
    let scratch = path.parent().unwrap().join("scratch");
    std::fs::create_dir(&scratch).unwrap();
    let checkout = scratch.join("fresh");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "--quiet",
            "-b",
            "nac/fresh",
            checkout.to_str().unwrap(),
        ],
    );
    crate::sandbox::SandboxWorktree {
        repo_root: repo,
        path: checkout,
        scratch_root: scratch,
        branch: "nac/fresh".into(),
        fork_point,
    }
}

#[tokio::test]
async fn creation_summary_failure_rolls_back_insert_in_the_same_transaction() {
    let (command, path) = command("creation_projection_rollback").await;
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET token_usages_json = 'not-json' WHERE session_id = 'baseline'",
            [],
        )
        .unwrap();
    let error = command.execute(&path).unwrap_err();
    assert!(
        error.downcast_ref::<serde_json::Error>().is_some(),
        "{error:#}"
    );
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE session_id = 'fresh'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "projection failure must roll back the fresh row");
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn creation_cancelled_before_execution_rolls_back_owned_worktree() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let (mut command, path) = command("creation_cancel_before_execution").await;
    let worktree = resource_worktree(&path);
    let checkout = worktree.path.clone();
    command.resources = Arc::new(StdMutex::new(Some(
        crate::runtime::PreparedSessionResources::for_test(Some(worktree)),
    )));
    let owner_path = path.clone();
    let owner = crate::store::spawn_blocking_store_caller(move || {
        crate::store::StoreCoordinator::acquire(&owner_path)
    })
    .await
    .unwrap()
    .unwrap();
    let (gate, release, _) = crate::store::coordinator::block_executor(&owner);
    drop(owner.submit(command).unwrap());
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    owner.shutdown().await.unwrap();
    drop(owner);
    assert!(!sessions::session_exists(&path, "fresh").unwrap());
    assert!(
        !checkout.exists(),
        "unexecuted creation must release its worktree"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn creation_commit_retains_owned_worktree_when_acknowledgement_is_lost() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let (mut command, path) = command("creation_lost_ack_resources").await;
    let worktree = resource_worktree(&path);
    let checkout = worktree.path.clone();
    command.resources = Arc::new(StdMutex::new(Some(
        crate::runtime::PreparedSessionResources::for_test(Some(worktree)),
    )));
    let (reached, observed) = std::sync::mpsc::channel();
    let (resume, release) = std::sync::mpsc::channel();
    command.after_commit = Some((reached, release));
    let owner_path = path.clone();
    let owner = crate::store::spawn_blocking_store_caller(move || {
        crate::store::StoreCoordinator::acquire(&owner_path)
    })
    .await
    .unwrap()
    .unwrap();
    let pending = owner.submit(command).unwrap();
    observed.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(pending);
    resume.send(()).unwrap();
    owner.shutdown().await.unwrap();
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    drop(owner);
    assert!(sessions::session_exists(&path, "fresh").unwrap());
    assert!(
        checkout.is_dir(),
        "committed resource ownership cannot depend on the HTTP waiter"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

async fn retained_command(label: &str) -> (CreateSessionWithSnapshot, PathBuf, String) {
    let (mut command, path) = command(label).await;
    crate::store::insert_project(
        &path,
        crate::store::NewProject {
            project_id: "retained-project".into(),
            name: None,
            description: None,
            cwd: "/repo/nested".into(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    let request = crate::store::TaskLaunchRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        project_id: "retained-project".into(),
        invoking_session_id: None,
        git_ref: Some("dev".into()),
        default_ref: Some("dev".into()),
        title: "é".repeat(120),
        prompt: "One initial input".into(),
    };
    let source = crate::store::TaskLaunchSource {
        project_cwd: "/repo/nested".into(),
        source_cwd: "/repo/nested".into(),
        repo_root: "/repo".into(),
        common_git_dir: "/repo/.git".into(),
        repository_identity: "fixture".into(),
        subdirectory: "nested".into(),
        default_ref: "dev".into(),
        selected_ref: "dev".into(),
        commit: "a".repeat(40),
        excluded_source_edits: false,
    };
    let launch = crate::store::reserve_task_launch(&path, request, source).unwrap();
    crate::store::update_task_launch(
        &path,
        &launch.request.request_id,
        crate::store::TaskLaunchPhase::PreparingRuntime,
        None,
    )
    .unwrap();
    command.snapshot.session_id = launch.session_id.clone();
    command.snapshot.project_id = Some(launch.request.project_id.clone());
    command.snapshot.behavior = sessions::SessionBehavior::Direct;
    command.snapshot.cwd = launch.workspace_path.join("nested");
    command.snapshot.ssh = None;
    command.snapshot.sandbox_spec = None;
    command.response.metadata.session_id = Some(launch.session_id);
    command.launch_id = Some(launch.request.request_id.clone());
    (command, path, launch.request.request_id)
}

#[tokio::test(flavor = "current_thread")]
async fn retained_creation_lost_ack_commits_one_session_and_one_initial_input() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let (mut command, path, id) = retained_command("retained_lost_ack").await;
    let (reached, observed) = std::sync::mpsc::channel();
    let (resume, release) = std::sync::mpsc::channel();
    command.after_commit = Some((reached, release));
    let owner_path = path.clone();
    let owner = crate::store::spawn_blocking_store_caller(move || {
        crate::store::StoreCoordinator::acquire(&owner_path)
    })
    .await
    .unwrap()
    .unwrap();
    let pending = owner.submit(command).unwrap();
    observed.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(pending);
    resume.send(()).unwrap();
    owner.shutdown().await.unwrap();
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    drop(owner);
    let receipt = crate::store::load_task_launch(&path, &id).unwrap().unwrap();
    assert_eq!(receipt.phase, crate::store::TaskLaunchPhase::Ready);
    assert!(sessions::session_exists(&path, &receipt.session_id).unwrap());
    let pinned = sessions::update_session_presentation(
        &path,
        &receipt.session_id,
        &receipt.request.title,
        true,
        0,
    )
    .unwrap();
    assert!(pinned.pinned);
    let inbox = crate::store::list_session_inbox(&path, &receipt.session_id).unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(Some(inbox[0].id), receipt.first_input_id);
    assert_eq!(inbox[0].content, "One initial input");
    let retry =
        crate::store::reserve_task_launch(&path, receipt.request.clone(), receipt.source.clone())
            .unwrap();
    assert_eq!(retry, receipt);
    // Cancel before promotion atomically withdraws the initial input, retaining
    // the session and its durable workspace inventory through later deletion.
    crate::store::update_task_launch(&path, &id, crate::store::TaskLaunchPhase::Cancelled, None)
        .unwrap();
    assert_eq!(
        crate::store::list_session_inbox(&path, &receipt.session_id).unwrap()[0].status,
        crate::store::InboxStatus::Cancelled
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn retained_creation_cancel_before_publication_rolls_back_session_and_input() {
    let (command, path, id) = retained_command("retained_cancel_before_commit").await;
    let session_id = command.snapshot.session_id.clone();
    crate::store::update_task_launch(&path, &id, crate::store::TaskLaunchPhase::Cancelled, None)
        .unwrap();
    assert!(command.execute(&path).is_err());
    assert!(!sessions::session_exists(&path, &session_id).unwrap());
    assert!(crate::store::list_session_inbox(&path, &session_id)
        .unwrap()
        .is_empty());
    assert_eq!(
        crate::store::load_task_launch(&path, &id)
            .unwrap()
            .unwrap()
            .phase,
        crate::store::TaskLaunchPhase::Cancelled
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
