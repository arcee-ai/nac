use super::*;
use crate::store::{self, NewProject};

fn git(root: &Path, args: &[&str]) -> String {
    run_git(&GitTarget::local(root), args).unwrap()
}
fn fixture() -> (PathBuf, crate::projects::ProjectRecord, TaskLaunchRequest) {
    let root = std::env::temp_dir().join(format!("nac-task-git-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("repo/nested")).unwrap();
    let repo = root.join("repo");
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
    store::initialize(&root.join("store.db")).unwrap();
    let project = store::insert_project(
        &root.join("store.db"),
        NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: repo.join("nested"),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    let request = TaskLaunchRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        project_id: "project".into(),
        invoking_session_id: None,
        git_ref: Some("dev".into()),
        default_ref: Some("dev".into()),
        title: "Isolated task".into(),
        prompt: "Work".into(),
    };
    (root, project, request)
}

#[test]
fn source_probe_only_falls_back_without_git_metadata() {
    let root = std::env::temp_dir().join(format!("nac-task-probe-{}", uuid::Uuid::new_v4()));
    let nested = root.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    assert!(!is_git_project(&nested).unwrap());
    std::fs::write(root.join(".git"), "gitdir: /missing-nac-gitdir\n").unwrap();
    assert!(is_git_project(&nested).is_err());
    std::fs::write(root.join(".git"), "malformed metadata\n").unwrap();
    assert!(is_git_project(&nested).is_err());
    #[cfg(unix)]
    {
        std::fs::remove_file(root.join(".git")).unwrap();
        std::os::unix::fs::symlink(root.join("missing"), root.join(".git")).unwrap();
        assert!(is_git_project(&nested).is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pins_moving_deleted_ref_and_preserves_dirty_source_head_index_and_files() {
    let (root, project, request) = fixture();
    let repo = root.join("repo");
    git(&repo, &["branch", "topic"]);
    std::fs::write(repo.join("nested/file"), "staged").unwrap();
    git(&repo, &["add", "."]);
    std::fs::write(repo.join("nested/file"), "unstaged").unwrap();
    std::fs::write(repo.join("untracked"), "untracked").unwrap();
    let head = git(&repo, &["rev-parse", "HEAD"]);
    let index = std::fs::read(repo.join(".git/index")).unwrap();
    let mut request = request;
    request.git_ref = Some("topic".into());
    let source = resolve_source(&project, &request, None, None).unwrap();
    assert!(source.excluded_source_edits);
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    git(&repo, &["branch", "-D", "topic"]);
    let cwd = prepare_workspace(&launch).unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("file")).unwrap(),
        "committed"
    );
    assert_eq!(git(&repo, &["rev-parse", "HEAD"]), head);
    assert_eq!(std::fs::read(repo.join(".git/index")).unwrap(), index);
    assert_eq!(
        std::fs::read_to_string(repo.join("nested/file")).unwrap(),
        "unstaged"
    );
    assert_eq!(
        std::fs::read_to_string(repo.join("untracked")).unwrap(),
        "untracked"
    );
    // Restart reconciliation uses the existing owned path without resetting it.
    std::fs::write(cwd.join("work"), "retained").unwrap();
    assert_eq!(prepare_workspace(&launch).unwrap(), cwd);
    assert!(cwd.join("work").is_file());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn wrong_repository_and_unowned_workspace_fail_without_fallback() {
    let (root, project, request) = fixture();
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    std::fs::create_dir_all(&launch.workspace_path).unwrap();
    std::fs::write(launch.workspace_path.join("keep"), "keep").unwrap();
    assert!(prepare_workspace(&launch)
        .unwrap_err()
        .to_string()
        .contains("unowned"));
    assert!(launch.workspace_path.join("keep").exists());
    std::fs::rename(root.join("repo"), root.join("old-repo")).unwrap();
    std::fs::create_dir_all(root.join("repo/nested")).unwrap();
    git(&root.join("repo"), &["init"]);
    assert!(prepare_workspace(&launch).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn configured_deny_prevents_materialization_without_agent_approval() {
    let (root, project, request) = fixture();
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    let mut config = crate::runtime::NacConfig::default();
    config
        .permissions
        .rules
        .push(crate::permissions::PermissionRule::new(
            "execute",
            "git worktree*",
            crate::permissions::PermissionEffect::Deny,
        ));
    assert!(authorize_human_preparation(&launch, &config, &root.join("store.db")).is_err());
    assert!(!launch.workspace_path.exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn preparation_does_not_execute_checkout_filters_or_hooks() {
    let (root, project, request) = fixture();
    let repo = root.join("repo");
    std::fs::write(repo.join(".gitattributes"), "nested/file filter=fixture\n").unwrap();
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
            "attributes",
        ],
    );
    let marker = root.join("filter-ran");
    git(
        &repo,
        &[
            "config",
            "filter.fixture.smudge",
            &format!("touch '{}'; cat", marker.display()),
        ],
    );
    git(&repo, &["config", "filter.fixture.required", "true"]);
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    let cwd = prepare_workspace(&launch).unwrap();
    assert_eq!(
        std::fs::read_to_string(cwd.join("file")).unwrap(),
        "committed"
    );
    assert!(!marker.exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn same_project_uses_invoking_commit_cross_project_uses_saved_branch_and_explicit_ref_wins() {
    let (root, project, mut request) = fixture();
    let repo = root.join("repo");
    let old = git(&repo, &["rev-parse", "HEAD"]);
    git(&repo, &["branch", "predecessor"]);
    std::fs::write(repo.join("nested/file"), "new destination default").unwrap();
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
            "advance default",
        ],
    );
    let new = git(&repo, &["rev-parse", "HEAD"]);
    let invoking_path = root.join("invoking");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "--detach",
            invoking_path.to_str().unwrap(),
            &old,
        ],
    );
    let mut invoking = crate::sessions::new_snapshot(
        "invoking".into(),
        invoking_path.join("nested"),
        "gpt-5.2".into(),
        "https://example.invalid/v1".into(),
        crate::model::provider_for_model("gpt-5.2").unwrap(),
        None,
        None,
        None,
        Vec::new(),
        None,
        Default::default(),
    );
    invoking.project_id = Some(project.project_id.clone());
    request.invoking_session_id = Some("invoking".into());
    request.git_ref = None;
    let same = resolve_source(&project, &request, None, Some(&invoking)).unwrap();
    assert_eq!(same.commit, old);
    invoking.project_id = Some("another-project".into());
    let cross = resolve_source(&project, &request, None, Some(&invoking)).unwrap();
    assert_eq!(cross.commit, new);
    request.git_ref = Some("predecessor".into());
    assert_eq!(
        resolve_source(&project, &request, None, Some(&invoking))
            .unwrap()
            .commit,
        old
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_refs_remote_hosts_and_missing_or_symlinked_subdirectories_fail_visibly() {
    let (root, mut project, mut request) = fixture();
    request.git_ref = Some("missing-ref".into());
    assert!(resolve_source(&project, &request, None, None).is_err());
    request.git_ref = Some("dev".into());
    project.ssh_host = Some("remote".into());
    assert!(resolve_source(&project, &request, None, None)
        .unwrap_err()
        .to_string()
        .contains("Local"));
    project.ssh_host = None;
    let repo = root.join("repo");
    let old = git(&repo, &["rev-parse", "HEAD"]);
    git(&repo, &["rm", "-r", "nested"]);
    git(
        &repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "remove nested",
        ],
    );
    // Resolve from the saved project path after restoring its directory outside
    // Git; that does not make the selected commit contain the effective cwd.
    std::fs::create_dir_all(repo.join("nested")).unwrap();
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch =
        store::reserve_task_launch(&root.join("store.db"), request.clone(), source).unwrap();
    assert!(prepare_workspace(&launch).is_err());
    assert!(launch.workspace_path.exists());
    request.request_id = uuid::Uuid::new_v4().to_string();
    request.git_ref = Some(old);
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    let cwd = prepare_workspace(&launch).unwrap();
    std::fs::remove_dir_all(&cwd).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("repo"), &cwd).unwrap();
        assert!(prepare_workspace(&launch).is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn retained_commit_pin_obeys_configured_deny_and_executes_no_reference_hook() {
    let (root, project, request) = fixture();
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    let mut config = crate::runtime::NacConfig::default();
    config
        .permissions
        .rules
        .push(crate::permissions::PermissionRule::new(
            "execute",
            "git update-ref*",
            crate::permissions::PermissionEffect::Deny,
        ));
    assert!(authorize_human_preparation(&launch, &config, &root.join("store.db")).is_err());
    assert!(!launch.workspace_path.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let hook = root.join("repo/.git/hooks/reference-transaction");
        let marker = root.join("reference-hook-ran");
        std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
        let index = std::fs::read(root.join("repo/.git/index")).unwrap();
        prepare_workspace(&launch).unwrap();
        assert!(!marker.exists());
        assert_eq!(std::fs::read(root.join("repo/.git/index")).unwrap(), index);
    }
    std::fs::remove_dir_all(root).unwrap();
}
