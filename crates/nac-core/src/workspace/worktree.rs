//! Per-session git worktrees backing sandboxed sessions.
//!
//! A sandboxed session must never write the user's live checkout: the
//! container's `/workspace` is a throwaway worktree forked from HEAD on a
//! `nac/<id>` branch instead. Everything here is a thin wrapper over the git
//! CLI — the sandbox layer creates and destroys these, and the branch a
//! session leaves behind is how its committed work is handed back.

use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Output, Stdio};

use anyhow::{bail, Context, Result};

use super::first_stderr_line;

/// The repository a session cwd belongs to, when it belongs to one at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoInfo {
    /// Working-tree root (`git rev-parse --show-toplevel`).
    pub root: PathBuf,
    /// Shared git dir (`--git-common-dir`, made absolute). For a linked
    /// worktree this is the main checkout's `.git`, which is the directory a
    /// container must be able to reach at its identical host path.
    pub common_git_dir: PathBuf,
    /// HEAD commit at discovery time: the fork point for the session branch.
    pub head: String,
}

/// Locates the repository containing `cwd`. Returns `None` for directories
/// outside any repository and for repositories without commits (an unborn HEAD
/// has nothing to fork from); both fall back to mounting the live directory.
pub fn find_repo(cwd: &Path) -> Result<Option<RepoInfo>> {
    let output = run_git(cwd, &["rev-parse", "--show-toplevel", "--git-common-dir"])
        .context("failed to execute 'git rev-parse'")?;
    if !output.status.success() {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let (Some(root), Some(common)) = (lines.next(), lines.next()) else {
        return Ok(None);
    };
    // --git-common-dir may print relative to the cwd it was queried from.
    let common_git_dir = absolutize(cwd, common)?;
    // Both paths are canonicalized so callers can strip_prefix one from a
    // canonicalized cwd even behind symlinks (macOS /tmp, for one).
    let root = absolutize(cwd, root)?;
    let head = run_git(cwd, &["rev-parse", "--verify", "HEAD"])
        .context("failed to execute 'git rev-parse'")?;
    if !head.status.success() {
        return Ok(None);
    }
    Ok(Some(RepoInfo {
        root,
        common_git_dir,
        head: String::from_utf8_lossy(&head.stdout).trim().to_string(),
    }))
}

/// Forks `branch` from HEAD into a new worktree at `path`.
pub fn create(repo_root: &Path, path: &Path, branch: &str) -> Result<()> {
    let output = run_git(
        repo_root,
        &[
            "worktree",
            "add",
            &path.display().to_string(),
            "-b",
            branch,
            "HEAD",
        ],
    )
    .context("failed to execute 'git worktree add'")?;
    if !output.status.success() {
        bail!(
            "failed to create session worktree '{}': {}",
            path.display(),
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
}

/// Re-attaches an existing session branch at `path`. Used when a session is
/// resumed after its worktree directory was deleted out from under it.
/// `--force` overrides the stale administrative entry such a deletion leaves
/// registered (plain `add` refuses a "missing but already registered" path).
pub fn re_add(repo_root: &Path, path: &Path, branch: &str) -> Result<()> {
    let output = run_git(
        repo_root,
        &[
            "worktree",
            "add",
            "--force",
            &path.display().to_string(),
            branch,
        ],
    )
    .context("failed to execute 'git worktree add'")?;
    if !output.status.success() {
        bail!(
            "failed to restore session worktree '{}' from branch '{}': {}",
            path.display(),
            branch,
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
}

/// Whether `path` is a working worktree right now — false when the directory
/// or its administrative entry under the common git dir was removed
/// externally, in which case a resume should re-attach rather than trust it.
pub fn is_usable(path: &Path) -> bool {
    path.exists()
        && run_git(path, &["rev-parse", "--git-dir"])
            .map(|output| output.status.success())
            .unwrap_or(false)
}

/// Removes a session worktree, best-effort: a path that is already gone is a
/// success.
pub fn remove(repo_root: &Path, path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let output = run_git(
        repo_root,
        &["worktree", "remove", "--force", &path.display().to_string()],
    )
    .context("failed to execute 'git worktree remove'")?;
    if !output.status.success() {
        bail!(
            "failed to remove session worktree '{}': {}",
            path.display(),
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
}

/// The commit a branch points at, or `None` when the branch is gone.
pub fn branch_head(repo_root: &Path, branch: &str) -> Option<String> {
    let reference = format!("refs/heads/{branch}");
    let output = run_git(repo_root, &["rev-parse", "--verify", "--quiet", &reference]).ok()?;
    if !output.status.success() {
        return None;
    }
    let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!head.is_empty()).then_some(head)
}

/// Deletes a session branch, best-effort.
pub fn delete_branch(repo_root: &Path, branch: &str) -> Result<()> {
    let output = run_git(repo_root, &["branch", "-D", branch])
        .context("failed to execute 'git branch -D'")?;
    if !output.status.success() {
        bail!(
            "failed to delete session branch '{}': {}",
            branch,
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
}

fn run_git(cwd: &Path, args: &[&str]) -> std::io::Result<Output> {
    // Hooks are disabled on nac's own git invocations: the sandbox shares the
    // repository's git dir with the container, so a hook planted there must
    // never execute on the host with the user's privileges (worktree add runs
    // post-checkout).
    StdCommand::new("git")
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .stdin(Stdio::null())
        .output()
}

fn absolutize(base: &Path, path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    let joined = if path.is_absolute() {
        path
    } else {
        base.join(path)
    };
    joined
        .canonicalize()
        .with_context(|| format!("failed to resolve git dir '{}'", joined.display()))
}

#[cfg(test)]
pub(crate) mod test_harness {
    use super::*;

    /// A temporary git repository for worktree tests. `base` holds the repo
    /// plus any sibling scratch dirs a test needs (worktrees, a fake nac
    /// home); everything is removed on drop.
    pub(crate) struct TestRepo {
        pub base: PathBuf,
        pub root: PathBuf,
    }

    impl TestRepo {
        pub(crate) fn new(label: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let base = std::env::temp_dir().join(format!(
                "nac-worktree-test-{label}-{}-{unique}",
                std::process::id()
            ));
            let root = base.join("repo");
            std::fs::create_dir_all(&root).unwrap();
            git(&root, &["init", "--quiet"]);
            git(&root, &["config", "user.email", "nac@test"]);
            git(&root, &["config", "user.name", "nac"]);
            Self { base, root }
        }

        pub(crate) fn commit_file(&self, path: &str, contents: &str) {
            let file = self.root.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, contents).unwrap();
            git(&self.root, &["add", path]);
            git(&self.root, &["commit", "--quiet", "-m", path]);
        }

        /// A path for a linked worktree: inside `base` but outside the repo,
        /// since worktrees must not live inside the repository they belong
        /// to.
        pub(crate) fn worktree_path(&self, name: &str) -> PathBuf {
            self.base.join(format!("worktree-{name}"))
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    pub(crate) fn git(cwd: &Path, args: &[&str]) {
        let output = run_git(cwd, args).unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[cfg(test)]
mod tests {
    use super::test_harness::{git, TestRepo};
    use super::*;

    #[test]
    fn find_repo_reports_root_common_dir_and_head() {
        let repo = TestRepo::new("find");
        repo.commit_file("a.txt", "a");

        let info = find_repo(&repo.root.join("."));
        assert!(info.is_ok(), "find_repo failed: {info:?}");
        let info = info.unwrap().expect("a repo with commits must be found");
        assert_eq!(info.root, repo.root.canonicalize().unwrap());
        assert_eq!(
            info.common_git_dir,
            repo.root.join(".git").canonicalize().unwrap()
        );
        assert!(!info.head.is_empty());
    }

    #[test]
    fn find_repo_returns_none_outside_repos_and_before_first_commit() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let plain = std::env::temp_dir().join(format!("nac-worktree-plain-{unique}"));
        std::fs::create_dir_all(&plain).unwrap();
        assert_eq!(find_repo(&plain).unwrap(), None);
        let _ = std::fs::remove_dir_all(&plain);

        let unborn = TestRepo::new("unborn");
        assert_eq!(find_repo(&unborn.root).unwrap(), None);
    }

    #[test]
    fn worktree_lifecycle_forks_tracks_and_cleans_up() {
        let repo = TestRepo::new("lifecycle");
        repo.commit_file("a.txt", "a");
        let info = find_repo(&repo.root).unwrap().unwrap();
        let worktree = repo.worktree_path("session");

        create(&info.root, &worktree, "nac/test123").unwrap();
        assert!(worktree.join("a.txt").exists());
        // A linked worktree's .git is a file pointing at the shared git dir,
        // which is why the container also mounts that dir.
        assert!(worktree.join(".git").is_file());
        assert_eq!(
            branch_head(&info.root, "nac/test123"),
            Some(info.head.clone())
        );

        // A commit made in the worktree advances only the session branch.
        std::fs::write(worktree.join("b.txt"), "b").unwrap();
        git(&worktree, &["add", "b.txt"]);
        git(&worktree, &["commit", "--quiet", "-m", "b"]);
        let advanced = branch_head(&info.root, "nac/test123").unwrap();
        assert_ne!(advanced, info.head);

        remove(&info.root, &worktree).unwrap();
        assert!(!worktree.exists());
        // Removing again is fine: cleanup must be idempotent.
        remove(&info.root, &worktree).unwrap();
        delete_branch(&info.root, "nac/test123").unwrap();
        assert_eq!(branch_head(&info.root, "nac/test123"), None);

        let _ = std::fs::remove_dir_all(&worktree);
    }

    #[test]
    fn re_add_restores_a_deleted_worktree_from_its_branch() {
        let repo = TestRepo::new("re-add");
        repo.commit_file("a.txt", "a");
        let info = find_repo(&repo.root).unwrap().unwrap();
        let worktree = repo.worktree_path("session");

        create(&info.root, &worktree, "nac/test456").unwrap();
        std::fs::write(worktree.join("b.txt"), "b").unwrap();
        git(&worktree, &["add", "b.txt"]);
        git(&worktree, &["commit", "--quiet", "-m", "b"]);
        let committed = branch_head(&info.root, "nac/test456").unwrap();
        // Deleting the directory externally — not `git worktree remove` —
        // leaves the administrative entry registered, which plain
        // `worktree add` refuses; re_add must override it.
        std::fs::remove_dir_all(&worktree).unwrap();
        assert!(!is_usable(&worktree));

        re_add(&info.root, &worktree, "nac/test456").unwrap();
        assert!(worktree.join("b.txt").exists());
        assert!(is_usable(&worktree));
        assert_eq!(branch_head(&info.root, "nac/test456"), Some(committed));

        remove(&info.root, &worktree).unwrap();
        delete_branch(&info.root, "nac/test456").unwrap();
    }
}
