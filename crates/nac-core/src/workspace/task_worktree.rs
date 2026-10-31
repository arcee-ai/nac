//! Local retained task workspace preparation. Never captures dirty contents,
//! switches the source checkout, or reclaims a published/uncertain checkout.
mod git_process;
use crate::store::{TaskLaunchRecord, TaskLaunchRequest, TaskLaunchSource};
use anyhow::{anyhow, Context, Result};
use git_process::LocalGit;
pub use git_process::TaskGit;
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
impl TaskGit {
    pub async fn is_git_project(&self, cwd: &Path) -> Result<bool> {
        let cwd = canonical(cwd)?;
        let target = self.at(&cwd);
        let output = target
            .output_with_env(&cwd, &[("LC_ALL", "C")], &["rev-parse", "--show-toplevel"])
            .await?;
        git_probe_result(output)
    }
}

fn git_probe_result(output: std::process::Output) -> Result<bool> {
    if output.status.success() {
        return Ok(true);
    }
    // Discovery failure has a parenthesized explanation. Broken gitdir
    // pointers use a colon; malformed/unreadable metadata has other errors.
    // Let Git honor discovery ceilings, filesystem boundaries and ignored
    // metadata rather than independently walking ancestors beyond its scope.
    let error = String::from_utf8_lossy(&output.stderr);
    if output.status.code() == Some(128) && error.starts_with("fatal: not a git repository (") {
        return Ok(false);
    }
    Err(anyhow!(
        "Git source probe failed: {}",
        super::first_stderr_line(&output.stderr)
    ))
}

impl TaskGit {
    async fn resolve_common_git_dir(&self, cwd: &Path) -> Result<PathBuf> {
        let output = self
            .at(cwd)
            .output(cwd, &["rev-parse", "--git-common-dir"])
            .await?;
        super::worktree::common_git_dir_from_output(cwd, output)?
            .ok_or_else(|| anyhow!("Git source common directory is unavailable"))
    }

    async fn canonical_default_branch(
        &self,
        target: &LocalGit<'_>,
        spelling: &str,
    ) -> Result<String> {
        let branch = target
            .run(&["rev-parse", "--symbolic-full-name", "--verify", spelling])
            .await
            .map_err(|error| anyhow!("invalid request: cannot resolve default branch: {error}"))?;
        // A saved default names one branch, not a revision expression or an alias
        // whose target can change when a source checkout/remote is retargeted.
        anyhow::ensure!(
            (branch.starts_with("refs/heads/") || branch.starts_with("refs/remotes/"))
                && (spelling == branch
                    || branch == format!("refs/heads/{spelling}")
                    || branch == format!("refs/remotes/{spelling}")),
            "invalid request: project default must directly name a configured Git branch"
        );
        let symbolic = target
            .output(target.root(), &["symbolic-ref", "--quiet", &branch])
            .await?;
        anyhow::ensure!(
            symbolic.status.code() == Some(1),
            "invalid request: project default must name a direct branch, not a symbolic alias"
        );
        Ok(branch)
    }

    /// Resolve an exact commit once, before any workspace effect. The caller first
    /// checks for an existing durable request so retry never consults a moving ref.
    pub async fn resolve_source(
        &self,
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
        let source_target = self.at(&source_cwd);
        let repo_root = canonical(&source_target.repo_root().await?)?;
        let subdirectory = source_cwd.strip_prefix(&repo_root)?.to_path_buf();
        let common_git_dir = self.resolve_common_git_dir(&source_cwd).await?;
        let repository_identity = repository_identity(&common_git_dir)?;
        let default_spelling = bound
            .map(|b| b.default_ref.clone())
            .or_else(|| request.default_ref.clone())
            .ok_or_else(|| {
                anyhow!("invalid request: configure the project's default Git branch before launch")
            })?;
        let default_ref = if bound.is_some()
            && (default_spelling.starts_with("refs/heads/")
                || default_spelling.starts_with("refs/remotes/"))
        {
            default_spelling
        } else {
            match self
                .canonical_default_branch(&source_target, &default_spelling)
                .await
            {
                Ok(branch) => branch,
                Err(_)
                    if bound.is_some()
                        && (request.git_ref.is_some()
                            || invoking.is_some_and(|session| {
                                session.project_id.as_deref() == Some(project.project_id.as_str())
                            })) =>
                {
                    // A legacy short binding may have lost its branch. Explicit
                    // intent still works without guessing/rebinding that lost
                    // identity; only a validated default may be selected below.
                    default_spelling
                }
                Err(error) => return Err(error),
            }
        };
        let same_requested_default = request.default_ref.as_ref().is_none_or(|value| {
            value == &default_ref
                || ["refs/heads/", "refs/remotes/"]
                    .iter()
                    .any(|prefix| default_ref.strip_prefix(prefix) == Some(value.as_str()))
        });
        if let Some(bound) = bound {
            anyhow::ensure!(
                bound.project_cwd == project.cwd
                    && bound.source_cwd == source_cwd
                    && bound.repo_root == repo_root
                    && bound.common_git_dir == common_git_dir
                    && bound.repository_identity == repository_identity
                    && bound.subdirectory == subdirectory
                    && same_requested_default,
                "conflict: saved project source repository or default branch changed"
            );
        }
        let invoking_ref = if let Some(invoking) = invoking {
            anyhow::ensure!(
                Some(&invoking.session_id) == request.invoking_session_id.as_ref(),
                "invalid request: invoking task identity does not match the request"
            );
            if invoking.project_id.as_deref() == Some(project.project_id.as_str()) {
                anyhow::ensure!(
                    invoking.ssh.is_none() && invoking.sandbox_spec.is_none(),
                    "invalid request: invoking task must use the Local backend"
                );
                let target = self.at(&canonical(&invoking.cwd)?);
                let common = self
                    .resolve_common_git_dir(&target.repo_root().await?)
                    .await?;
                anyhow::ensure!(
                    common == common_git_dir,
                    "conflict: invoking task belongs to another repository"
                );
                Some(
                    target
                        .run(&["rev-parse", "--verify", "HEAD^{commit}"])
                        .await?,
                )
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
        if request.git_ref.is_none() && invoking_ref.is_none() {
            anyhow::ensure!(
                default_ref.starts_with("refs/heads/") || default_ref.starts_with("refs/remotes/"),
                "invalid request: saved default lacks a canonical branch identity"
            );
            let symbolic = source_target
                .output(
                    source_target.root(),
                    &["symbolic-ref", "--quiet", &default_ref],
                )
                .await?;
            anyhow::ensure!(
                symbolic.status.code() == Some(1),
                "invalid request: saved default no longer names a direct Git branch"
            );
        }
        let selected_ref = request
            .git_ref
            .clone()
            .or(invoking_ref)
            .unwrap_or_else(|| default_ref.clone());
        let commit = source_target
            .run(&[
                "rev-parse",
                "--verify",
                &format!("{selected_ref}^{{commit}}"),
            ])
            .await
            .map_err(|error| {
                anyhow!("invalid request: cannot resolve selected Git ref: {error}")
            })?;
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

    async fn validate_source(&self, source: &TaskLaunchSource) -> Result<LocalGit<'_>> {
        anyhow::ensure!(
            canonical(&source.source_cwd)? == source.source_cwd,
            "conflict: source checkout location changed"
        );
        let target = self.at(&source.source_cwd);
        anyhow::ensure!(
            repository_identity(&source.common_git_dir)? == source.repository_identity,
            "conflict: source repository was replaced"
        );
        anyhow::ensure!(
            canonical(&target.repo_root().await?)? == source.repo_root
                && self.resolve_common_git_dir(&source.source_cwd).await? == source.common_git_dir,
            "conflict: source repository changed"
        );
        Ok(target)
    }
}

/// Validate configured denial on exact semantic targets for authenticated human
/// invocation. Ask does not enter the agent approval lifecycle or create grants.
pub fn authorize_human_preparation(
    launch: &TaskLaunchRecord,
    config: &crate::runtime::NacConfig,
    store_path: &Path,
) -> Result<()> {
    use crate::permissions::{PermissionBackend, PermissionEffect, PermissionPolicy};
    let backend = crate::sandbox::ExecutionBackend::Local {
        workspace_cwd: launch.source.source_cwd.clone(),
    };
    let resources = preparation_resources(launch, &backend, store_path);
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

/// Exact effects shared by human denial checks and ordinary native agent authorization.
pub(crate) fn preparation_resources(
    launch: &TaskLaunchRecord,
    backend: &crate::sandbox::ExecutionBackend,
    store_path: &Path,
) -> Vec<crate::tools::kernel::PermissionResource> {
    use crate::tools::kernel::PermissionResource;
    let mut resources = crate::permissions::file_resources(
        "edit",
        launch.workspace_path.clone(),
        backend,
        store_path,
        true,
    );
    for tokens in preparation_commands(launch) {
        resources.push(PermissionResource::new("execute", tokens.join(" ")));
    }
    resources
}

/// Semantic argv for policy. The Git adapter additionally disables hooks/filters
/// and supplies its own option separators; these never add caller authority.
pub(crate) fn preparation_commands(launch: &TaskLaunchRecord) -> [Vec<String>; 2] {
    [
        vec![
            "git".into(),
            "worktree".into(),
            "add".into(),
            "--detach".into(),
            launch.workspace_path.to_string_lossy().into_owned(),
            launch.source.commit.clone(),
        ],
        vec![
            "git".into(),
            "update-ref".into(),
            format!("refs/nac/task-launches/{}", launch.request.request_id),
            launch.source.commit.clone(),
        ],
    ]
}

/// Must run under the launch's cross-process operation lease. Existing paths
/// are inspected, never reset or removed. An ambiguous interrupted Git effect
/// fails visibly with retained inventory for inspection.
impl TaskGit {
    pub async fn prepare_workspace(&self, launch: &TaskLaunchRecord) -> Result<PathBuf> {
        let target = self.validate_source(&launch.source).await?;
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
        let creating = match std::fs::symlink_metadata(&launch.workspace_path) {
            Ok(_) => false,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
            Err(error) => return Err(error.into()),
        };
        let marker = parent.join(format!("{}.owner", launch.session_id));
        if !marker.exists() {
            anyhow::ensure!(creating, "conflict: unowned workspace already exists");
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
        let completed = parent.join(format!("{}.materialized", launch.session_id));
        let checkpoint = serde_json::to_vec(&(
            &launch.request.request_id,
            &launch.session_id,
            &launch.workspace_path,
            &launch.source,
        ))?;
        if creating {
            anyhow::ensure!(
            matches!(std::fs::symlink_metadata(&completed), Err(error) if error.kind() == std::io::ErrorKind::NotFound),
            "conflict: materialized workspace is missing; retained inventory requires inspection"
        );
        } else {
            anyhow::ensure!(
            std::fs::symlink_metadata(&completed).is_ok_and(|metadata| metadata.is_file())
                && std::fs::read(&completed)? == checkpoint,
            "conflict: retained checkout materialization is incomplete or uncertain; files retained for inspection"
        );
        }
        let pin = format!("refs/nac/task-launches/{}", launch.request.request_id);
        let pinned = target
            .output(target.root(), &["show-ref", "--verify", "--quiet", &pin])
            .await?;
        if pinned.status.success() {
            anyhow::ensure!(
                target.run(&["rev-parse", "--verify", &pin]).await? == launch.source.commit,
                "conflict: retained launch commit ref changed"
            );
        } else {
            anyhow::ensure!(
                pinned.status.code() == Some(1),
                "could not inspect retained commit ref"
            );
            target
                .run(&[
                    "-c",
                    "core.hooksPath=/dev/null",
                    "update-ref",
                    &pin,
                    &launch.source.commit,
                    "",
                ])
                .await?;
        }
        if creating {
            // Preparation executes no repository hooks or content-filter programs.
            // Fetching LFS/submodules and repository setup remain explicit agent work.
            let filters = target
                .output(
                    target.root(),
                    &[
                        "config",
                        "--name-only",
                        "--get-regexp",
                        "^filter\\..*\\.(smudge|process|required)$",
                    ],
                )
                .await?;
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
            target.run(&args).await?;
        }
        anyhow::ensure!(
            canonical(&launch.workspace_path)? == launch.workspace_path,
            "workspace path changed"
        );
        let workspace = self.at(&launch.workspace_path);
        anyhow::ensure!(
            workspace.run(&["rev-parse", "HEAD"]).await? == launch.source.commit
                && self.resolve_common_git_dir(&launch.workspace_path).await?
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
        if creating {
            // HEAD/common-dir alone do not prove checkout finished: Git writes
            // those before populating files. Publish this checkpoint only after
            // successful materialization and validation, never during recovery.
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(completed)?;
            file.write_all(&checkpoint)?;
            file.sync_all()?;
            std::fs::File::open(parent)?.sync_all()?;
        }
        Ok(cwd)
    }
}

#[cfg(test)]
#[path = "task_worktree_tests.rs"]
mod tests;
