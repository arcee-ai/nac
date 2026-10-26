use super::*;
use crate::workspace::{run_git, GitTarget};

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}
fn is_git_project(cwd: &Path) -> Result<bool> {
    run(TaskGit::default().is_git_project(cwd))
}
fn resolve_common_git_dir(cwd: &Path) -> Result<PathBuf> {
    run(TaskGit::default().resolve_common_git_dir(cwd))
}
fn resolve_source(
    project: &crate::projects::ProjectRecord,
    request: &TaskLaunchRequest,
    bound: Option<&TaskLaunchSource>,
    invoking: Option<&crate::sessions::SessionSnapshot>,
) -> Result<TaskLaunchSource> {
    run(TaskGit::default().resolve_source(project, request, bound, invoking))
}
fn prepare_workspace(launch: &TaskLaunchRecord) -> Result<PathBuf> {
    run(TaskGit::default().prepare_workspace(launch))
}

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
fn source_probe_distinguishes_discovery_from_broken_consulted_metadata() {
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
        // Git deliberately ignores a dangling symlink as repository metadata.
        assert!(!is_git_project(&nested).unwrap());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn source_probe_respects_git_discovery_ceiling_and_explicit_gitdir_errors() {
    let (root, project, _) = fixture();
    let ceiling = root.join("repo");
    assert!(is_git_project(&project.cwd).unwrap());
    let target = GitTarget::local(&project.cwd);
    let output = target
        .output_with_env(
            &project.cwd,
            &[
                ("LC_ALL", "C"),
                ("GIT_CEILING_DIRECTORIES", ceiling.to_str().unwrap()),
            ],
            &["rev-parse", "--show-toplevel"],
        )
        .unwrap();
    assert!(!git_probe_result(output).unwrap());
    let output = target
        .output_with_env(
            &project.cwd,
            &[("LC_ALL", "C"), ("GIT_DIR", "/missing-nac-gitdir")],
            &["rev-parse", "--show-toplevel"],
        )
        .unwrap();
    assert!(git_probe_result(output).is_err());
    assert_eq!(
        resolve_common_git_dir(&project.cwd).unwrap(),
        canonical(&ceiling.join(".git")).unwrap()
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn interrupted_materialization_with_valid_head_never_resumes_as_ready() {
    let (root, project, request) = fixture();
    let source = resolve_source(&project, &request, None, None).unwrap();
    let launch = store::reserve_task_launch(&root.join("store.db"), request, source).unwrap();
    let parent = launch.workspace_path.parent().unwrap();
    std::fs::create_dir_all(parent).unwrap();
    std::fs::write(
        parent.join(format!("{}.owner", launch.session_id)),
        &launch.request.request_id,
    )
    .unwrap();
    git(
        &root.join("repo"),
        &[
            "worktree",
            "add",
            "--no-checkout",
            "--detach",
            launch.workspace_path.to_str().unwrap(),
            &launch.source.commit,
        ],
    );
    assert_eq!(
        git(&launch.workspace_path, &["rev-parse", "HEAD"]),
        launch.source.commit
    );
    std::fs::write(launch.workspace_path.join("keep"), "partial user work").unwrap();
    assert!(prepare_workspace(&launch)
        .unwrap_err()
        .to_string()
        .contains("materialization"));
    assert!(!launch.workspace_path.join("nested/file").exists());
    assert_eq!(
        std::fs::read_to_string(launch.workspace_path.join("keep")).unwrap(),
        "partial user work"
    );
    std::fs::write(
        parent.join(format!("{}.materialized", launch.session_id)),
        "wrong-checkpoint",
    )
    .unwrap();
    assert!(prepare_workspace(&launch).is_err());
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
    // Proof persisted but its acknowledgement/phase update may be lost. Retry
    // reuses the materialized checkout, including newer user edits.
    std::fs::write(cwd.join("work"), "retained").unwrap();
    store::reconcile_task_launches(&root.join("store.db")).unwrap();
    let launch = store::load_task_launch(&root.join("store.db"), &launch.request.request_id)
        .unwrap()
        .unwrap();
    assert_eq!(launch.phase, store::TaskLaunchPhase::Failed);
    assert_eq!(prepare_workspace(&launch).unwrap(), cwd);
    assert!(cwd.join("work").is_file());
    let proof = launch
        .workspace_path
        .parent()
        .unwrap()
        .join(format!("{}.materialized", launch.session_id));
    let inside_checkout = cwd.join("materialized-proof");
    std::fs::rename(&proof, &inside_checkout).unwrap();
    assert!(
        prepare_workspace(&launch).is_err(),
        "a checkout entry is never materialization authority"
    );
    assert!(cwd.join("work").is_file());
    std::fs::rename(inside_checkout, proof).unwrap();
    assert_eq!(prepare_workspace(&launch).unwrap(), cwd);
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

#[test]
fn saved_default_rejects_dynamic_and_symbolic_aliases_but_explicit_head_is_valid() {
    let (root, project, mut request) = fixture();
    let repo = root.join("repo");
    git(
        &repo,
        &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/heads/dev"],
    );
    git(
        &repo,
        &["symbolic-ref", "refs/heads/alias", "refs/heads/dev"],
    );
    for name in [
        "HEAD",
        "@",
        "@{-1}",
        "origin/HEAD",
        "refs/remotes/origin/HEAD",
        "alias",
    ] {
        request.default_ref = Some(name.into());
        assert!(
            resolve_source(&project, &request, None, None).is_err(),
            "{name}"
        );
    }
    request.default_ref = Some("dev".into());
    request.git_ref = Some("HEAD".into());
    let source = resolve_source(&project, &request, None, None).unwrap();
    assert_eq!(source.default_ref, "refs/heads/dev");
    assert_eq!(source.selected_ref, "HEAD");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn saved_branch_identity_survives_checkout_switch_and_resolves_moving_branch() {
    let (root, project, mut request) = fixture();
    let repo = root.join("repo");
    request.git_ref = None;
    let source = resolve_source(&project, &request, None, None).unwrap();
    let first =
        store::reserve_task_launch(&root.join("store.db"), request.clone(), source).unwrap();
    git(&repo, &["checkout", "-b", "unrelated"]);
    std::fs::write(repo.join("nested/file"), "unrelated commit").unwrap();
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
            "unrelated",
        ],
    );
    request.request_id = uuid::Uuid::new_v4().to_string();
    request.default_ref = Some("refs/heads/dev".into());
    let second = resolve_source(&project, &request, Some(&first.source), None).unwrap();
    assert_eq!(second.commit, first.source.commit);
    assert_eq!(second.selected_ref, "refs/heads/dev");
    git(&repo, &["checkout", "--detach", "HEAD"]);
    assert_eq!(
        resolve_source(&project, &request, Some(&first.source), None)
            .unwrap()
            .commit,
        first.source.commit
    );
    let moved = git(&repo, &["rev-parse", "HEAD"]);
    git(&repo, &["update-ref", "refs/heads/dev", &moved]);
    assert_eq!(
        resolve_source(&project, &request, Some(&first.source), None)
            .unwrap()
            .commit,
        moved
    );
    assert_eq!(
        store::reserve_task_launch(&root.join("store.db"), first.request.clone(), second).unwrap(),
        first
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_named_binding_is_anchored_without_rewriting_old_receipts_or_proof() {
    let (root, project, mut request) = fixture();
    let path = root.join("store.db");
    let source = resolve_source(&project, &request, None, None).unwrap();
    let mut legacy = source.clone();
    legacy.default_ref = "dev".into();
    let first = store::reserve_task_launch(&path, request.clone(), legacy).unwrap();
    let cwd = prepare_workspace(&first).unwrap();
    std::fs::write(cwd.join("file"), "newer task edits").unwrap();
    request.request_id = uuid::Uuid::new_v4().to_string();
    let source = resolve_source(&project, &request, Some(&first.source), None).unwrap();
    store::reserve_task_launch(&path, request, source).unwrap();
    assert_eq!(
        store::load_project_git_source(&path, &project.project_id)
            .unwrap()
            .unwrap()
            .default_ref,
        "refs/heads/dev"
    );
    assert_eq!(
        store::load_task_launch(&path, &first.request.request_id)
            .unwrap()
            .unwrap(),
        first
    );
    assert_eq!(prepare_workspace(&first).unwrap(), cwd);
    assert_eq!(
        std::fs::read_to_string(cwd.join("file")).unwrap(),
        "newer task edits"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn remote_default_keeps_its_namespace_and_explicit_ref_survives_deleted_default() {
    let (root, project, mut request) = fixture();
    let repo = root.join("repo");
    git(&repo, &["update-ref", "refs/remotes/origin/dev", "HEAD"]);
    request.default_ref = Some("origin/dev".into());
    request.git_ref = None;
    let source = resolve_source(&project, &request, None, None).unwrap();
    assert_eq!(source.default_ref, "refs/remotes/origin/dev");
    git(&repo, &["checkout", "-b", "origin/dev"]);
    std::fs::write(repo.join("nested/file"), "other").unwrap();
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
            "other",
        ],
    );
    assert_eq!(
        resolve_source(&project, &request, Some(&source), None)
            .unwrap()
            .commit,
        source.commit
    );
    git(&repo, &["update-ref", "-d", "refs/remotes/origin/dev"]);
    request.git_ref = Some("HEAD".into());
    assert_eq!(
        resolve_source(&project, &request, Some(&source), None)
            .unwrap()
            .commit,
        git(&repo, &["rev-parse", "HEAD"])
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn deleted_legacy_default_allows_explicit_ref_without_guessing_or_rebinding() {
    let (root, project, mut request) = fixture();
    let path = root.join("store.db");
    let mut legacy = resolve_source(&project, &request, None, None).unwrap();
    legacy.default_ref = "dev".into();
    let first = store::reserve_task_launch(&path, request.clone(), legacy).unwrap();
    let repo = root.join("repo");
    git(&repo, &["checkout", "--detach", "HEAD"]);
    git(&repo, &["branch", "-D", "dev"]);
    request.request_id = uuid::Uuid::new_v4().to_string();
    request.default_ref = None;
    request.git_ref = Some("HEAD".into());
    let source = resolve_source(&project, &request, Some(&first.source), None).unwrap();
    assert_eq!(source.commit, first.source.commit);
    assert_eq!(source.default_ref, "dev");
    store::reserve_task_launch(&path, request.clone(), source).unwrap();
    request.git_ref = None;
    assert!(resolve_source(&project, &request, Some(&first.source), None).is_err());
    assert_eq!(
        store::load_task_launch(&path, &first.request.request_id)
            .unwrap()
            .unwrap(),
        first
    );
    std::fs::remove_dir_all(root).unwrap();
}
