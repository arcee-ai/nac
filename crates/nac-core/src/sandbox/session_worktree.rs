//! Per-session worktree orchestration for sandboxed sessions.
//!
//! A sandboxed session whose working directory is a git repository runs in a
//! throwaway worktree forked from HEAD rather than the user's live checkout.
//! This module owns that worktree across the session lifecycle: forking at
//! launch, restoring on resume, rolling back when launch fails, and cleaning
//! up when the session is deleted. The git operations themselves live in
//! `crate::workspace::worktree`; what lives here is the session-scoped
//! policy around them.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::{MountSpec, SandboxSession, SandboxSpec, SandboxWorktree, DEFAULT_SANDBOX_WORKDIR};
use crate::paths::PathContext;
use crate::workspace::worktree;

/// The result of forking a session worktree: what to mount where, plus the
/// cleanup metadata to persist with the session.
pub(crate) struct SessionWorktreeFork {
    /// Host directory to mount at the sandbox workdir (the worktree
    /// counterpart of the session cwd).
    pub host: PathBuf,
    pub workdir: PathBuf,
    pub worktree: SandboxWorktree,
    /// Identity mounts exposing only the shared Git data a container needs.
    /// The common git dir is mounted read-only, with objects, refs, reflogs,
    /// and this worktree's administrative dir overlaid read-write. Config,
    /// hooks, packed refs, and other host control files remain read-only.
    pub git_dir_mounts: Vec<MountSpec>,
}

/// What a sandboxed session mounts at its workdir: the live cwd, or — for an
/// owner session whose cwd is a git repository — the forked worktree plus the
/// git-dir identity mounts and cleanup metadata to persist.
pub(crate) struct CwdMount {
    pub host: PathBuf,
    pub workdir: PathBuf,
    pub git_dir_mounts: Vec<MountSpec>,
    pub worktree: Option<SandboxWorktree>,
}

/// Decides the workdir mount for a launching session. Worker subprocesses
/// re-attach to the owner's container and inherit its mounts, so only the
/// owner forks; anything that makes a fork impossible (not a git repo, no
/// commits yet, no nac home, worktree creation failure) falls back to
/// mounting the live cwd.
pub(crate) fn cwd_mount(cwd: &Path, session_key: &str, owner: bool) -> Result<CwdMount> {
    if owner {
        if let Some(fork) = fork(cwd, session_key)? {
            return Ok(CwdMount {
                host: fork.host,
                workdir: fork.workdir,
                git_dir_mounts: fork.git_dir_mounts,
                worktree: Some(fork.worktree),
            });
        }
    }
    Ok(CwdMount {
        host: cwd.to_path_buf(),
        workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
        git_dir_mounts: Vec::new(),
        worktree: None,
    })
}

/// Creates the sandbox for a freshly launched session. When the spec carries
/// a forked worktree and creation fails, the fork is rolled back: it predates
/// the session row, so nothing else would ever clean it up. (Resume takes a
/// different path — `restore` then `SandboxSession::create` directly —
/// because rolling back there would destroy a branch holding session work.)
pub(crate) async fn launch_session(
    spec: SandboxSpec,
    session_key: String,
    owner: bool,
    activity_key: String,
    durable_store_path: Option<PathBuf>,
) -> Result<SandboxSession> {
    let forked = spec.worktree.clone();
    let launched = async {
        let session = if let Some(store_path) = durable_store_path {
            SandboxSession::create_for_durable_launch(
                spec,
                session_key,
                owner,
                activity_key,
                store_path,
            )
            .await?
        } else {
            SandboxSession::create(spec, session_key, owner, activity_key).await?
        };
        if let Some(worktree) = &forked {
            session.materialize_worktree().await?;
            mark_materialized(worktree)?;
        }
        Ok(session)
    }
    .await;
    match launched {
        Ok(session) => Ok(session),
        Err(error) => {
            if let Some(worktree) = &forked {
                rollback(worktree);
            }
            Err(error)
        }
    }
}

/// Owns a fresh fork until the session row durably records its cleanup
/// metadata. Declaring this guard before the sandbox makes Rust drop the
/// container first on an error, then remove the worktree.
pub(crate) struct RollbackGuard(Option<SandboxWorktree>);

impl RollbackGuard {
    pub(crate) fn new(worktree: Option<SandboxWorktree>) -> Self {
        Self(worktree)
    }

    pub(crate) fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for RollbackGuard {
    fn drop(&mut self) {
        if let Some(worktree) = self.0.take() {
            rollback(&worktree);
        }
    }
}

/// Forks the repository containing `cwd` into a per-session worktree, so a
/// sandboxed session writes — and switches branches in — a throwaway checkout
/// rather than the user's live one.
///
/// Returns `None` — and the caller falls back to mounting the live directory —
/// when `cwd` is not in a git repository, the repository has no commits yet,
/// there is no nac home to hold the worktree, or worktree creation fails; the
/// fallback keeps sandboxing available where a worktree is impossible.
pub(crate) fn fork(cwd: &Path, session_key: &str) -> Result<Option<SessionWorktreeFork>> {
    let repo = match worktree::find_repo(cwd) {
        Ok(Some(repo)) => repo,
        Ok(None) => return Ok(None),
        Err(error) => {
            eprintln!("nac: cannot inspect git repository for sandbox worktree: {error:#}");
            return Ok(None);
        }
    };
    let Some(nac_home) = PathContext::new(cwd).nac_home_dir() else {
        eprintln!("nac: no nac home directory; sandbox will mount the live checkout");
        return Ok(None);
    };
    let scratch_root = nac_home.join("worktrees");
    let worktree_path = scratch_root.join(session_key);
    let branch = format!("nac/{session_key:.12}");
    if let Err(error) = worktree::create_without_checkout(&repo.root, &worktree_path, &branch) {
        eprintln!("nac: {error:#}; sandbox will mount the live checkout");
        return Ok(None);
    }
    let scratch_root = match scratch_root.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            eprintln!(
                "nac: failed to resolve worktree scratch directory '{}': {error}; \
                 sandbox will mount the live checkout",
                scratch_root.display()
            );
            let _ = worktree::remove(&repo.root, &worktree_path);
            let _ = worktree::delete_branch(&repo.root, &branch);
            return Ok(None);
        }
    };
    // `cwd` may sit below the repository root; mount the same relative
    // position inside the worktree. A directory new enough to be absent from
    // HEAD is created empty.
    let relative = cwd
        .canonicalize()
        .ok()
        .and_then(|canonical| canonical.strip_prefix(&repo.root).ok().map(PathBuf::from))
        .unwrap_or_default();
    if relative.to_str().is_none() {
        eprintln!(
            "nac: repository path '{}' is not valid UTF-8; sandbox will mount the live checkout",
            relative.display()
        );
        let _ = worktree::remove(&repo.root, &worktree_path);
        let _ = worktree::delete_branch(&repo.root, &branch);
        return Ok(None);
    }
    let host = worktree_path.clone();
    let workdir = PathBuf::from(DEFAULT_SANDBOX_WORKDIR).join(&relative);
    // The whole fork is mounted so Git remains available when `cwd` is a
    // subdirectory. The sandbox still sees only the isolated checkout, never
    // the user's live repository.
    let git_dir_mounts = match isolated_git_dir_mounts(&repo.common_git_dir, &worktree_path) {
        Ok(mounts) => mounts,
        Err(error) => {
            let _ = worktree::remove(&repo.root, &worktree_path);
            let _ = worktree::delete_branch(&repo.root, &branch);
            return Err(error
                .context("refusing to mount a repository with unsafe Git administrative paths"));
        }
    };
    let sandbox_worktree = SandboxWorktree {
        repo_root: repo.root,
        path: worktree_path,
        scratch_root,
        branch,
        fork_point: repo.head,
    };
    if let Err(error) = mark_needs_materialization(&sandbox_worktree) {
        eprintln!("nac: {error:#}; sandbox will mount the live checkout");
        rollback(&sandbox_worktree);
        return Ok(None);
    }
    Ok(Some(SessionWorktreeFork {
        host,
        workdir,
        worktree: sandbox_worktree,
        git_dir_mounts,
    }))
}

fn isolated_git_dir_mounts(common_git_dir: &Path, worktree_path: &Path) -> Result<Vec<MountSpec>> {
    let objects = common_git_dir.join("objects");
    let refs = common_git_dir.join("refs");
    let ref_logs = common_git_dir.join("logs/refs");
    prepare_secure_directory(common_git_dir, &objects, false)?;
    prepare_secure_directory(common_git_dir, &refs, false)?;
    prepare_secure_directory(common_git_dir, &ref_logs, true)?;

    let admin_git_dir = worktree::git_dir(worktree_path)?;
    prepare_secure_directory(common_git_dir, &admin_git_dir, false)?;
    let worktree_config = prepare_worktree_config(common_git_dir, &admin_git_dir)?;

    let mount = |path: PathBuf, read_only| MountSpec {
        guest: path.clone(),
        host: path,
        read_only,
    };
    Ok(vec![
        mount(common_git_dir.to_path_buf(), true),
        mount(objects, false),
        mount(refs, false),
        mount(ref_logs, false),
        mount(admin_git_dir, false),
        mount(worktree_config, true),
    ])
}

fn prepare_secure_directory(common_git_dir: &Path, path: &Path, create: bool) -> Result<()> {
    let relative = path.strip_prefix(common_git_dir).map_err(|_| {
        anyhow::anyhow!(
            "Git administrative directory '{}' resolves outside '{}'",
            path.display(),
            common_git_dir.display()
        )
    })?;
    let mut current = common_git_dir.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(component) = component else {
            anyhow::bail!(
                "Git administrative path '{}' contains an unsafe component",
                path.display()
            );
        };
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                anyhow::bail!(
                    "Git administrative path '{}' contains a symbolic link",
                    current.display()
                );
            }
            Ok(metadata) if !metadata.is_dir() => {
                anyhow::bail!(
                    "Git administrative path '{}' is not a directory",
                    current.display()
                );
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                std::fs::create_dir(&current).with_context(|| {
                    format!(
                        "failed to prepare Git administrative directory '{}'",
                        current.display()
                    )
                })?;
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to inspect Git administrative directory '{}'",
                        current.display()
                    )
                });
            }
        }
    }
    let resolved = path.canonicalize().with_context(|| {
        format!(
            "failed to resolve Git administrative directory '{}'",
            path.display()
        )
    })?;
    if resolved != path {
        anyhow::bail!(
            "Git administrative directory '{}' resolves to unexpected path '{}'",
            path.display(),
            resolved.display()
        );
    }
    Ok(())
}

fn prepare_worktree_config(common_git_dir: &Path, admin_git_dir: &Path) -> Result<PathBuf> {
    prepare_secure_directory(common_git_dir, admin_git_dir, false)?;
    let worktree_config = admin_git_dir.join("config.worktree");
    match std::fs::symlink_metadata(&worktree_config) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            anyhow::bail!(
                "worktree config '{}' is not a regular file",
                worktree_config.display()
            );
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&worktree_config)
                .with_context(|| {
                    format!(
                        "failed to create read-only worktree config '{}'",
                        worktree_config.display()
                    )
                })?;
        }
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "failed to inspect worktree config '{}'",
                    worktree_config.display()
                )
            });
        }
    }
    let resolved = worktree_config.canonicalize().with_context(|| {
        format!(
            "failed to resolve worktree config '{}'",
            worktree_config.display()
        )
    })?;
    if resolved != worktree_config {
        anyhow::bail!(
            "worktree config '{}' resolves to unexpected path '{}'",
            worktree_config.display(),
            resolved.display()
        );
    }
    Ok(worktree_config)
}

fn prepare_restored_worktree_config(worktree: &SandboxWorktree) -> Result<()> {
    let repo = worktree::find_repo(&worktree.repo_root)?.ok_or_else(|| {
        anyhow::anyhow!(
            "sandbox repository '{}' no longer has a commit",
            worktree.repo_root.display()
        )
    })?;
    isolated_git_dir_mounts(&repo.common_git_dir, &worktree.path)?;
    Ok(())
}

/// Brings a resumed session's worktree back into a usable state. An existing
/// path is repaired in place and never deleted. A missing path is re-attached
/// at the branch or detached commit retained in Git's stale administrative
/// record. Forked worktrees use `--no-checkout`; the container materializes
/// them after it starts, outside the host trust boundary.
pub(crate) fn checkout_in_container(spec: &SandboxSpec) -> bool {
    spec.worktree.is_some()
}

pub(crate) fn restore(worktree: &SandboxWorktree, checkout_in_container: bool) -> Result<bool> {
    if worktree::is_usable(&worktree.path)? {
        if checkout_in_container {
            prepare_restored_worktree_config(worktree)?;
            return needs_materialization(worktree);
        }
        return Ok(false);
    }
    if worktree.path.exists() {
        worktree::repair(&worktree.repo_root, &worktree.path)?;
        if worktree::is_usable(&worktree.path)? {
            if checkout_in_container {
                prepare_restored_worktree_config(worktree)?;
                return needs_materialization(worktree);
            }
            return Ok(false);
        }
        anyhow::bail!(
            "sandbox worktree '{}' exists but is not usable after git repair; \
             refusing to replace files that may contain session work",
            worktree.path.display()
        );
    }

    let checkout =
        worktree::registered_checkout(&worktree.repo_root, &worktree.path)?.ok_or_else(|| {
            anyhow::anyhow!(
                "sandbox worktree '{}' is gone and Git no longer records its checkout; \
                 the session workspace cannot be restored safely",
                worktree.path.display()
            )
        })?;
    if checkout_in_container {
        mark_needs_materialization(worktree)?;
    }
    worktree::re_add(
        &worktree.repo_root,
        &worktree.path,
        &checkout,
        checkout_in_container,
    )?;
    if checkout_in_container {
        prepare_restored_worktree_config(worktree)?;
    }
    Ok(checkout_in_container)
}

fn materialization_marker(worktree: &SandboxWorktree) -> Result<PathBuf> {
    if !worktree.path_in_scratch_dir() {
        anyhow::bail!(
            "sandbox worktree '{}' is outside its recorded scratch directory",
            worktree.path.display()
        );
    }
    Ok(worktree.path.with_extension("nac-needs-checkout"))
}

fn mark_needs_materialization(worktree: &SandboxWorktree) -> Result<()> {
    let marker = materialization_marker(worktree)?;
    std::fs::write(&marker, []).with_context(|| {
        format!(
            "failed to record pending container checkout '{}'",
            marker.display()
        )
    })
}

fn needs_materialization(worktree: &SandboxWorktree) -> Result<bool> {
    Ok(materialization_marker(worktree)?.exists())
}

pub(crate) fn mark_materialized(worktree: &SandboxWorktree) -> Result<()> {
    let marker = materialization_marker(worktree)?;
    if marker.exists() {
        std::fs::remove_file(&marker).with_context(|| {
            format!(
                "failed to clear pending container checkout '{}'",
                marker.display()
            )
        })?;
    }
    Ok(())
}

/// Undoes a fork when session launch fails after it. The fork carries no
/// session work yet, so removal is always safe. Best-effort.
pub(crate) fn rollback(worktree: &SandboxWorktree) {
    let _ = mark_materialized(worktree);
    let _ = worktree::remove(&worktree.repo_root, &worktree.path);
    let _ = worktree::delete_branch(&worktree.repo_root, &worktree.branch);
}

/// Removes the worktree a sandboxed session ran in. The initial session branch
/// is deleted only while it still points at the fork commit. A detached commit
/// is first anchored on that branch; a different checked-out branch already
/// preserves its commits and is reported. All best-effort: session deletion
/// must not fail because cleanup did, but inspection/removal errors fail closed
/// rather than risking work.
pub fn cleanup_session_worktree(worktree: &SandboxWorktree) {
    let checkout = match worktree::registered_checkout(&worktree.repo_root, &worktree.path) {
        Ok(checkout) => checkout,
        Err(error) => {
            eprintln!("nac: failed to inspect session worktree during deletion: {error:#}");
            return;
        }
    };
    if checkout.is_none() && worktree.path.exists() {
        eprintln!(
            "nac: session worktree '{}' exists without a Git registration; \
             refusing to delete files that may contain session work",
            worktree.path.display()
        );
        return;
    }
    if let Some(worktree::WorktreeCheckout::Detached(head)) = &checkout {
        if head != &worktree.fork_point {
            if let Err(error) = worktree::update_branch(&worktree.repo_root, &worktree.branch, head)
            {
                eprintln!("nac: failed to preserve detached session commit: {error:#}");
                return;
            }
        }
    }
    if let Err(error) = worktree::remove(&worktree.repo_root, &worktree.path) {
        eprintln!("nac: failed to remove session worktree during deletion: {error:#}");
        return;
    }
    if worktree.path_in_scratch_dir() && worktree.path.exists() {
        if let Err(error) = std::fs::remove_dir_all(&worktree.path) {
            eprintln!(
                "nac: failed to remove unregistered session worktree '{}': {error}",
                worktree.path.display()
            );
            return;
        }
    }
    if let Err(error) = mark_materialized(worktree) {
        eprintln!("nac: failed to clear session worktree state during deletion: {error:#}");
    }
    if let Some(worktree::WorktreeCheckout::Branch(branch)) = checkout {
        if branch != worktree.branch {
            eprintln!(
                "nac: session work remains on branch '{}' in '{}'",
                branch,
                worktree.repo_root.display()
            );
        }
    }
    match worktree::branch_head(&worktree.repo_root, &worktree.branch) {
        Some(head) if head == worktree.fork_point => {
            if let Err(error) = worktree::delete_branch(&worktree.repo_root, &worktree.branch) {
                eprintln!("nac: failed to delete session branch during deletion: {error:#}");
            }
        }
        Some(_) => {
            eprintln!(
                "nac: session work remains on branch '{}' in '{}'",
                worktree.branch,
                worktree.repo_root.display()
            );
        }
        None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::worktree::test_harness::{git, TestRepo};
    use crate::TEST_ENV_LOCK;

    fn git_branch(cwd: &Path) -> String {
        String::from_utf8_lossy(
            &std::process::Command::new("git")
                .arg("-C")
                .arg(cwd)
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .trim()
        .to_string()
    }

    /// A worktree forked from the repo's HEAD on a `nac/<key>` branch, placed
    /// under `nac_home/worktrees` so the scratch-dir guard (anchored to
    /// NAC_HOME) approves its removal.
    fn forked_worktree(repo: &TestRepo, nac_home: &Path, key: &str) -> SandboxWorktree {
        let info = worktree::find_repo(&repo.root).unwrap().unwrap();
        let worktree = SandboxWorktree {
            repo_root: info.root.clone(),
            path: nac_home.join("worktrees").join(key),
            scratch_root: nac_home.join("worktrees").canonicalize().unwrap(),
            branch: format!("nac/{key}"),
            fork_point: info.head,
        };
        worktree::create(&info.root, &worktree.path, &worktree.branch).unwrap();
        worktree
    }

    #[test]
    fn fork_rewrites_the_mount_and_leaves_the_live_checkout_alone() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let repo = TestRepo::new("fork");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::remove_var("XDG_CONFIG_HOME");
        }
        repo.commit_file("a.txt", "a");

        let forked = fork(&repo.root, "sessionkey123")
            .unwrap()
            .expect("git repo must get a worktree");
        assert_eq!(forked.host, forked.worktree.path);
        assert_eq!(
            forked.worktree.path,
            nac_home.join("worktrees/sessionkey123")
        );
        assert_eq!(forked.worktree.branch, "nac/sessionkey12");
        let common_git_dir = repo.root.join(".git").canonicalize().unwrap();
        let common_mount = forked
            .git_dir_mounts
            .first()
            .expect("a repo-root fork mounts the shared git dir");
        assert_eq!(common_mount.host, common_git_dir);
        assert_eq!(common_mount.host, common_mount.guest);
        assert!(common_mount.read_only);
        assert!(forked
            .git_dir_mounts
            .iter()
            .any(|mount| mount.host == common_git_dir.join("objects") && !mount.read_only));
        // Host launch registers the fork without checking out repository
        // content; materialization is deferred to the sandbox container.
        assert!(!forked.worktree.path.join("a.txt").exists());
        assert!(materialization_marker(&forked.worktree).unwrap().exists());
        git(&forked.worktree.path, &["reset", "--hard", "HEAD"]);
        mark_materialized(&forked.worktree).unwrap();
        assert!(forked.worktree.path.join("a.txt").exists());
        git(&repo.root, &["checkout", "--quiet", "-b", "scratch"]);
        assert_eq!(git_branch(&repo.root), "scratch");
        assert_eq!(git_branch(&forked.worktree.path), "nac/sessionkey12");

        // A plain directory gets no worktree: the live mount fallback applies.
        let plain = repo.base.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        assert!(fork(&plain, "otherkey456").unwrap().is_none());

        // A cwd below the repo root mounts the whole isolated checkout and
        // starts the sandbox at the corresponding subdirectory, preserving Git
        // access without exposing the live repository.
        repo.commit_file("crates/child/c.txt", "c");
        let subdir = repo.root.join("crates/child");
        let sub = fork(&subdir, "subdirkey789")
            .unwrap()
            .expect("subdir cwd gets a worktree");
        assert_eq!(sub.host, sub.worktree.path);
        assert_eq!(
            sub.workdir,
            PathBuf::from(DEFAULT_SANDBOX_WORKDIR).join("crates/child")
        );
        assert!(!sub.worktree.path.join("crates/child/c.txt").exists());
        assert!(!sub.git_dir_mounts.is_empty());
        rollback(&sub.worktree);
        rollback(&forked.worktree);

        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
            match original_xdg {
                Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),

                None => std::env::remove_var("XDG_CONFIG_HOME"),
            }
        }
    }
    #[test]
    fn cleanup_preserves_an_unregistered_existing_directory() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let repo = TestRepo::new("cleanup-unregistered");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "unregistered-test");
        let marker = worktree.path.join("uncommitted.txt");
        std::fs::write(&marker, "keep").unwrap();
        let admin = worktree::git_dir(&worktree.path).unwrap();
        std::fs::remove_dir_all(admin).unwrap();

        cleanup_session_worktree(&worktree);

        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "keep");
        assert!(worktree::branch_head(&repo.root, &worktree.branch).is_some());
        std::fs::remove_dir_all(&worktree.path).unwrap();
        worktree::delete_branch(&repo.root, &worktree.branch).unwrap();
    }

    #[test]
    fn fork_does_not_run_checkout_filters_on_the_host() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let repo = TestRepo::new("no-host-checkout");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        unsafe { std::env::set_var("NAC_HOME", &nac_home) };
        repo.commit_file("a.txt", "a");
        std::fs::write(repo.root.join(".gitattributes"), "*.txt filter=pwn\n").unwrap();
        git(&repo.root, &["add", ".gitattributes"]);
        git(&repo.root, &["commit", "--quiet", "-m", "attributes"]);
        let marker = repo.base.join("host-filter-ran");
        let command = format!("touch {}; cat", marker.display());
        git(&repo.root, &["config", "filter.pwn.smudge", &command]);

        let forked = fork(&repo.root, "filter-test")
            .unwrap()
            .expect("git repo must get a worktree");

        assert!(!marker.exists());
        assert!(!forked.worktree.path.join("a.txt").exists());
        rollback(&forked.worktree);
        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
    }
    #[cfg(unix)]
    #[test]
    fn fork_rejects_writable_git_mount_symlinks_without_live_fallback() {
        use std::os::unix::fs::symlink;

        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let repo = TestRepo::new("unsafe-git-mount");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        unsafe { std::env::set_var("NAC_HOME", &nac_home) };
        repo.commit_file("a.txt", "a");
        git(&repo.root, &["config", "core.logAllRefUpdates", "false"]);
        let ref_logs = repo.root.join(".git/logs/refs");
        std::fs::remove_dir_all(&ref_logs).unwrap();
        symlink("../..", &ref_logs).unwrap();

        let error = fork(&repo.root, "unsafe-mount")
            .err()
            .expect("unsafe Git mount must fail closed");

        assert!(error
            .to_string()
            .contains("unsafe Git administrative paths"));
        assert!(!nac_home.join("worktrees/unsafe-mount").exists());
        assert_eq!(worktree::branch_head(&repo.root, "nac/unsafe-mount"), None);
        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
    }

    #[test]
    fn cleanup_deletes_an_untouched_branch() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let repo = TestRepo::new("untouched");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        unsafe { std::env::set_var("NAC_HOME", &nac_home) };
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "cleanup-test");

        cleanup_session_worktree(&worktree);

        assert!(!worktree.path.exists());
        assert_eq!(
            worktree::branch_head(&worktree.repo_root, &worktree.branch),
            None,
            "a branch with no session commits must be deleted"
        );

        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
    }

    #[test]
    fn cleanup_deletes_the_branch_when_the_worktree_dir_was_deleted_externally() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let repo = TestRepo::new("externally-deleted");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        unsafe { std::env::set_var("NAC_HOME", &nac_home) };
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "cleanup-test");
        // Deleting the directory externally leaves a stale administrative
        // entry that counts the branch as checked out; cleanup must clear it
        // or the untouched branch is left behind.
        std::fs::remove_dir_all(&worktree.path).unwrap();

        cleanup_session_worktree(&worktree);

        assert!(!worktree.path.exists());
        assert_eq!(
            worktree::branch_head(&worktree.repo_root, &worktree.branch),
            None,
            "a stale worktree entry must not block deleting an untouched branch"
        );

        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
    }

    #[test]
    fn cleanup_keeps_a_branch_holding_session_commits() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let repo = TestRepo::new("committed");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        unsafe { std::env::set_var("NAC_HOME", &nac_home) };
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "cleanup-test");
        std::fs::write(worktree.path.join("b.txt"), "b").unwrap();
        git(&worktree.path, &["add", "b.txt"]);
        git(&worktree.path, &["commit", "--quiet", "-m", "b"]);

        cleanup_session_worktree(&worktree);

        assert!(!worktree.path.exists());
        assert!(
            worktree::branch_head(&worktree.repo_root, &worktree.branch).is_some(),
            "a branch holding session commits must be kept"
        );
        worktree::delete_branch(&worktree.repo_root, &worktree.branch).unwrap();

        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
    }

    #[test]
    fn cleanup_anchors_a_detached_commit_on_the_session_branch() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let repo = TestRepo::new("detached");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "detached-test");
        git(&worktree.path, &["checkout", "--detach", "--quiet"]);
        std::fs::write(worktree.path.join("detached.txt"), "work").unwrap();
        git(&worktree.path, &["add", "detached.txt"]);
        git(&worktree.path, &["commit", "--quiet", "-m", "detached"]);
        let detached = match worktree::registered_checkout(&repo.root, &worktree.path)
            .unwrap()
            .unwrap()
        {
            worktree::WorktreeCheckout::Detached(head) => head,
            checkout => panic!("expected detached checkout, got {checkout:?}"),
        };

        cleanup_session_worktree(&worktree);

        assert_eq!(
            worktree::branch_head(&repo.root, &worktree.branch),
            Some(detached)
        );
        worktree::delete_branch(&repo.root, &worktree.branch).unwrap();
    }

    #[test]
    fn cleanup_preserves_a_different_checked_out_branch() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let repo = TestRepo::new("switched");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "switched-test");
        git(&worktree.path, &["switch", "-c", "qa/session"]);
        std::fs::write(worktree.path.join("switched.txt"), "work").unwrap();
        git(&worktree.path, &["add", "switched.txt"]);
        git(&worktree.path, &["commit", "--quiet", "-m", "switched"]);

        cleanup_session_worktree(&worktree);

        assert!(worktree::branch_head(&repo.root, "qa/session").is_some());
        assert_eq!(worktree::branch_head(&repo.root, &worktree.branch), None);
        worktree::delete_branch(&repo.root, "qa/session").unwrap();
    }

    #[test]
    fn restore_uses_the_registered_branch_and_defers_checkout() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let repo = TestRepo::new("restore-branch");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "restore-test");
        git(&worktree.path, &["switch", "-c", "qa/resume"]);
        std::fs::write(worktree.path.join("resume.txt"), "work").unwrap();
        git(&worktree.path, &["add", "resume.txt"]);
        git(&worktree.path, &["commit", "--quiet", "-m", "resume"]);
        std::fs::remove_dir_all(&worktree.path).unwrap();

        assert!(restore(&worktree, true).unwrap());
        assert!(materialization_marker(&worktree).unwrap().exists());
        assert!(
            restore(&worktree, true).unwrap(),
            "a failed container launch must retain the deferred checkout"
        );
        assert!(worktree::is_usable(&worktree.path).unwrap());
        assert!(!worktree.path.join("resume.txt").exists());
        git(&worktree.path, &["reset", "--hard", "HEAD"]);
        assert_eq!(git_branch(&worktree.path), "qa/resume");
        assert!(worktree.path.join("resume.txt").exists());
        mark_materialized(&worktree).unwrap();
        assert!(!restore(&worktree, true).unwrap());
        assert!(!materialization_marker(&worktree).unwrap().exists());

        cleanup_session_worktree(&worktree);
        worktree::delete_branch(&repo.root, "qa/resume").unwrap();
    }

    #[test]
    fn restore_preserves_files_when_git_cannot_be_started() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let repo = TestRepo::new("restore-error");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "restore-error");
        let marker = worktree.path.join("uncommitted.txt");
        std::fs::write(&marker, "keep").unwrap();
        let original_path = std::env::var_os("PATH");
        unsafe { std::env::set_var("PATH", "/definitely/missing") };
        let result = restore(&worktree, true);
        unsafe {
            match original_path {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
        }

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "keep");
        cleanup_session_worktree(&worktree);
    }

    #[test]
    fn rollback_guard_removes_an_unpersisted_fork() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let repo = TestRepo::new("rollback-guard");
        let nac_home = repo.base.join("nac-home");
        std::fs::create_dir_all(nac_home.join("worktrees")).unwrap();
        repo.commit_file("a.txt", "a");
        let worktree = forked_worktree(&repo, &nac_home, "rollback-guard");
        {
            let _rollback = RollbackGuard::new(Some(worktree.clone()));
        }
        assert!(!worktree.path.exists());
        assert_eq!(worktree::branch_head(&repo.root, &worktree.branch), None);
    }
}
