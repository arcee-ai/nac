//! Local retained task workspace preparation. Never captures dirty contents,
//! switches the source checkout, or reclaims a published/uncertain checkout.
use super::{run_git, GitTarget};
use crate::store::{TaskLaunchRecord, TaskLaunchRequest, TaskLaunchSource};
use anyhow::{anyhow, Context, Result};
use std::path::{Component, Path, PathBuf};

fn canonical(path: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(path)
        .with_context(|| format!("source path '{}' is unavailable", path.display()))
}

fn repository_identity(path: &Path) -> Result<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(path)?;
        Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(anyhow!(
            "retained Local worktree identity is unsupported on this platform"
        ))
    }
}

/// Distinguish an ordinary non-Git directory from an unavailable/broken source.
/// A failed probe must never silently select the existing-checkout launch path.
pub fn is_git_project(cwd: &Path) -> Result<bool> {
    let cwd = canonical(cwd)?;
    let target = GitTarget::local(&cwd);
    let output =
        target.output_with_env(&cwd, &[("LC_ALL", "C")], &["rev-parse", "--show-toplevel"])?;
    if output.status.success() {
        return Ok(true);
    }
    let error = String::from_utf8_lossy(&output.stderr);
    if error.contains("not a git repository") {
        return Ok(false);
    }
    Err(anyhow!(
        "Git source probe failed: {}",
        super::first_stderr_line(&output.stderr)
    ))
}

/// Resolve an exact commit once, before any workspace effect. The caller first
/// checks for an existing durable request so retry never consults a moving ref.
pub fn resolve_source(
    project: &crate::projects::ProjectRecord,
    request: &TaskLaunchRequest,
    bound: Option<&TaskLaunchSource>,
    invoking: Option<&crate::sessions::SessionSnapshot>,
) -> Result<TaskLaunchSource> {
    request.validate()?;
    anyhow::ensure!(
        project.project_id == request.project_id && project.ssh_host.is_none(),
        "invalid request: retained task launch supports saved Local projects only"
    );
    let source_cwd = canonical(&project.cwd)?;
    let source_target = GitTarget::local(&source_cwd);
    let repo_root = canonical(&source_target.repo_root()?)?;
    let subdirectory = source_cwd.strip_prefix(&repo_root)?.to_path_buf();
    let common_git_dir = canonical(Path::new(&run_git(
        &source_target,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?))?;
    let repository_identity = repository_identity(&common_git_dir)?;
    let default_ref = bound
        .map(|b| b.default_ref.clone())
        .or_else(|| request.default_ref.clone())
        .ok_or_else(|| {
            anyhow!("invalid request: configure the project's default Git branch before launch")
        })?;
    if let Some(bound) = bound {
        anyhow::ensure!(
            bound.project_cwd == project.cwd
                && bound.source_cwd == source_cwd
                && bound.repo_root == repo_root
                && bound.common_git_dir == common_git_dir
                && bound.repository_identity == repository_identity
                && bound.subdirectory == subdirectory
                && request
                    .default_ref
                    .as_ref()
                    .is_none_or(|value| value == &bound.default_ref),
            "conflict: saved project source repository or default branch changed"
        );
    }
    if bound.is_none() {
        let branch = run_git(
            &source_target,
            &[
                "rev-parse",
                "--symbolic-full-name",
                "--verify",
                "--end-of-options",
                &default_ref,
            ],
        )?;
        anyhow::ensure!(
            branch.starts_with("refs/heads/") || branch.starts_with("refs/remotes/"),
            "invalid request: project default must name a configured Git branch"
        );
    }
    let invoking_ref = if let Some(invoking) = invoking {
        anyhow::ensure!(
            Some(&invoking.session_id) == request.invoking_session_id.as_ref()
                && invoking.ssh.is_none()
                && invoking.sandbox_spec.is_none(),
            "invalid request: invoking task must use the Local backend"
        );
        if invoking.project_id.as_deref() == Some(project.project_id.as_str()) {
            let target = GitTarget::local(canonical(&invoking.cwd)?);
            let common = canonical(Path::new(&run_git(
                &target,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )?))?;
            anyhow::ensure!(
                common == common_git_dir,
                "conflict: invoking task belongs to another repository"
            );
            Some(run_git(
                &target,
                &["rev-parse", "--verify", "HEAD^{commit}"],
            )?)
        } else {
            None
        }
    } else {
        anyhow::ensure!(
            request.invoking_session_id.is_none(),
            "invoking task was not found"
        );
        None
    };
    let selected_ref = request
        .git_ref
        .clone()
        .or(invoking_ref)
        .unwrap_or_else(|| default_ref.clone());
    let commit = run_git(
        &source_target,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{selected_ref}^{{commit}}"),
        ],
    )?;
    // Ref launch excludes edits by construction. Do not scan source file
    // contents or run clean/fsmonitor programs merely to report that policy.
    Ok(TaskLaunchSource {
        project_cwd: project.cwd.clone(),
        source_cwd,
        repo_root,
        common_git_dir,
        repository_identity,
        subdirectory,
        default_ref,
        selected_ref,
        commit,
        excluded_source_edits: true,
    })
}

fn validate_source(source: &TaskLaunchSource) -> Result<GitTarget> {
    anyhow::ensure!(
        canonical(&source.source_cwd)? == source.source_cwd,
        "conflict: source checkout location changed"
    );
    let target = GitTarget::local(&source.source_cwd);
    anyhow::ensure!(
        repository_identity(&source.common_git_dir)? == source.repository_identity,
        "conflict: source repository was replaced"
    );
    anyhow::ensure!(
        canonical(&target.repo_root()?)? == source.repo_root
            && canonical(Path::new(&run_git(
                &target,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"]
            )?))?
                == source.common_git_dir,
        "conflict: source repository changed"
    );
    Ok(target)
}

/// Validate configured denial on exact semantic targets for authenticated human
/// invocation. Ask does not enter the agent approval lifecycle or create grants.
pub fn authorize_human_preparation(
    launch: &TaskLaunchRecord,
    config: &crate::runtime::NacConfig,
    store_path: &Path,
) -> Result<()> {
    use crate::permissions::{PermissionBackend, PermissionEffect, PermissionPolicy};
    use crate::tools::kernel::PermissionResource;
    let backend = crate::sandbox::ExecutionBackend::Local {
        workspace_cwd: launch.source.source_cwd.clone(),
    };
    let mut resources = crate::permissions::file_resources(
        "edit",
        launch.workspace_path.clone(),
        &backend,
        store_path,
        true,
    );
    resources.push(PermissionResource::new(
        "execute",
        format!(
            "git worktree add --detach {} {}",
            launch.workspace_path.display(),
            launch.source.commit
        ),
    ));
    resources.push(PermissionResource::new(
        "execute",
        format!(
            "git update-ref refs/nac/task-launches/{} {}",
            launch.request.request_id, launch.source.commit
        ),
    ));
    let decision =
        PermissionPolicy::for_backend(PermissionBackend::Local, config.permissions.rules.clone())
            .evaluate(&resources, &[]);
    anyhow::ensure!(
        decision.effect != PermissionEffect::Deny,
        "task workspace preparation denied: {}",
        decision
            .hard_denial
            .as_deref()
            .unwrap_or("configured policy")
    );
    Ok(())
}

/// Must run under the launch's cross-process operation lease. Existing paths
/// are inspected, never reset or removed. An ambiguous interrupted Git effect
/// fails visibly with retained inventory for inspection.
pub fn prepare_workspace(launch: &TaskLaunchRecord) -> Result<PathBuf> {
    let target = validate_source(&launch.source)?;
    let parent = launch
        .workspace_path
        .parent()
        .ok_or_else(|| anyhow!("workspace has no parent"))?;
    match std::fs::create_dir(parent) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    anyhow::ensure!(
        canonical(parent)? == parent,
        "workspace root contains a symlink"
    );
    let mut permissions = std::fs::metadata(parent)?.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o700);
        std::fs::set_permissions(parent, permissions)?;
    }
    let marker = parent.join(format!("{}.owner", launch.session_id));
    if !marker.exists() {
        anyhow::ensure!(
            std::fs::symlink_metadata(&launch.workspace_path).is_err(),
            "conflict: unowned workspace already exists"
        );
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)?;
        file.write_all(launch.request.request_id.as_bytes())?;
        file.sync_all()?;
    }
    anyhow::ensure!(
        std::fs::symlink_metadata(&marker)?.is_file()
            && std::fs::read_to_string(&marker)? == launch.request.request_id,
        "conflict: workspace ownership marker changed"
    );
    let pin = format!("refs/nac/task-launches/{}", launch.request.request_id);
    let pinned = target.output(target.root(), &["show-ref", "--verify", "--quiet", &pin])?;
    if pinned.status.success() {
        anyhow::ensure!(
            run_git(&target, &["rev-parse", "--verify", &pin])? == launch.source.commit,
            "conflict: retained launch commit ref changed"
        );
    } else {
        anyhow::ensure!(
            pinned.status.code() == Some(1),
            "could not inspect retained commit ref"
        );
        run_git(
            &target,
            &[
                "-c",
                "core.hooksPath=/dev/null",
                "update-ref",
                &pin,
                &launch.source.commit,
                "",
            ],
        )?;
    }
    if std::fs::symlink_metadata(&launch.workspace_path).is_err() {
        // Preparation executes no repository hooks or content-filter programs.
        // Fetching LFS/submodules and repository setup remain explicit agent work.
        let filters = target.output(
            target.root(),
            &[
                "config",
                "--name-only",
                "--get-regexp",
                "^filter\\..*\\.(smudge|process|required)$",
            ],
        )?;
        anyhow::ensure!(
            filters.status.success() || filters.status.code() == Some(1),
            "could not inspect checkout filters"
        );
        let mut args = vec!["-c".to_owned(), "core.hooksPath=/dev/null".to_owned()];
        for key in String::from_utf8(filters.stdout)?.lines() {
            let value = if key.ends_with(".required") {
                "false"
            } else {
                ""
            };
            args.extend(["-c".to_owned(), format!("{key}={value}")]);
        }
        args.extend([
            "worktree".into(),
            "add".into(),
            "--detach".into(),
            "--".into(),
            launch
                .workspace_path
                .to_str()
                .ok_or_else(|| anyhow!("workspace path must be UTF-8"))?
                .to_owned(),
            launch.source.commit.clone(),
        ]);
        let args = args.iter().map(String::as_str).collect::<Vec<_>>();
        run_git(&target, &args)?;
    }
    anyhow::ensure!(
        canonical(&launch.workspace_path)? == launch.workspace_path,
        "workspace path changed"
    );
    let workspace = GitTarget::local(&launch.workspace_path);
    anyhow::ensure!(
        run_git(&workspace, &["rev-parse", "HEAD"])? == launch.source.commit
            && canonical(Path::new(&run_git(
                &workspace,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"]
            )?))?
                == launch.source.common_git_dir,
        "conflict: retained workspace identity changed; files retained for inspection"
    );
    let mut cwd = launch.workspace_path.clone();
    for component in launch.source.subdirectory.components() {
        let Component::Normal(component) = component else {
            return Err(anyhow!("invalid task subdirectory"));
        };
        cwd.push(component);
        anyhow::ensure!(
            std::fs::symlink_metadata(&cwd)?.is_dir(),
            "task subdirectory is missing or a symlink"
        );
    }
    Ok(cwd)
}

#[cfg(test)]
#[path = "task_worktree_tests.rs"]
mod tests;
