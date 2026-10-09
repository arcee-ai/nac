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
