//! Per-session git worktrees backing sandboxed sessions.
//!
//! A sandboxed session must never write the user's live checkout: the
//! container's `/workspace` is a throwaway worktree forked from HEAD on a
//! `nac/<id>` branch instead. Everything here is a thin wrapper over the git
//! CLI — the sandbox layer creates and destroys these, and the branch a
//! session leaves behind is how its committed work is handed back.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Output, Stdio};

use anyhow::{anyhow, bail, Context, Result};

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

/// The checkout identity Git records for a linked worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeCheckout {
    Branch(String),
    Detached(String),
}

impl WorktreeCheckout {
    pub fn display(&self) -> &str {
        match self {
            Self::Branch(branch) | Self::Detached(branch) => branch,
        }
    }
}

/// Locates the repository containing `cwd`. Returns `None` for directories
/// outside any repository and for repositories without commits (an unborn HEAD
/// has nothing to fork from); both fall back to mounting the live directory.
pub fn find_repo(cwd: &Path) -> Result<Option<RepoInfo>> {
    let root = match rev_parse_path(cwd, "--show-toplevel")? {
        Some(path) => absolutize(cwd, &path)?,
        None => return Ok(None),
    };
    let common_git_dir = match rev_parse_path(cwd, "--git-common-dir")? {
        Some(path) => absolutize(cwd, &path)?,
        None => return Ok(None),
    };
    let head = run_git(cwd, &["rev-parse", "--verify", "HEAD"])
        .context("failed to execute 'git rev-parse'")?;
    if !head.status.success() {
        return Ok(None);
    }
    let head = String::from_utf8(head.stdout)
        .context("git returned a non-UTF-8 commit id")?
        .trim()
        .to_string();
    Ok(Some(RepoInfo {
        root,
        common_git_dir,
        head,
    }))
}

#[cfg(test)]
/// Forks `branch` from HEAD into a new, populated worktree at `path`.
pub fn create(repo_root: &Path, path: &Path, branch: &str) -> Result<()> {
    create_inner(repo_root, path, branch, false)
}

/// Registers `branch` at `path` without checking files out on the host.
pub fn create_without_checkout(repo_root: &Path, path: &Path, branch: &str) -> Result<()> {
    create_inner(repo_root, path, branch, true)
}

fn create_inner(repo_root: &Path, path: &Path, branch: &str, no_checkout: bool) -> Result<()> {
    let mut command = git_command(repo_root);
    command.args(["worktree", "add"]);
    if no_checkout {
        command.arg("--no-checkout");
    }
    let output = command
        .arg(path)
        .args(["-b", branch, "HEAD"])
        .output()
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

/// Re-attaches an existing checkout at `path`. `--force` overrides the stale
/// administrative entry an externally deleted directory leaves behind.
pub fn re_add(
    repo_root: &Path,
    path: &Path,
    checkout: &WorktreeCheckout,
    no_checkout: bool,
) -> Result<()> {
    let mut command = git_command(repo_root);
    command.args(["worktree", "add", "--force"]);
    if no_checkout {
        command.arg("--no-checkout");
    }
    if matches!(checkout, WorktreeCheckout::Detached(_)) {
        command.arg("--detach");
    }
    let output = command
        .arg(path)
        .arg(checkout.display())
        .output()
        .context("failed to execute 'git worktree add'")?;
    if !output.status.success() {
        bail!(
            "failed to restore session worktree '{}' at '{}': {}",
            path.display(),
            checkout.display(),
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
}

/// Whether `path` is a working worktree right now. Process failures are not
/// staleness: callers must preserve the error rather than deleting data.
pub fn is_usable(path: &Path) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    let output =
        run_git(path, &["rev-parse", "--git-dir"]).context("failed to inspect git worktree")?;
    Ok(output.status.success())
}

/// Lets Git repair the `.git` pointer/admin linkage without replacing files.
pub fn repair(repo_root: &Path, path: &Path) -> Result<()> {
    let output = git_command(repo_root)
        .args(["worktree", "repair"])
        .arg(path)
        .output()
        .context("failed to execute 'git worktree repair'")?;
    if !output.status.success() {
        bail!(
            "failed to repair session worktree '{}': {}",
            path.display(),
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
}

/// Removes a registered session worktree. An unregistered path is left alone;
/// the session layer owns the stricter scratch-directory decision for it.
pub fn remove(repo_root: &Path, path: &Path) -> Result<()> {
    if registered_checkout(repo_root, path)?.is_none() {
        return Ok(());
    }
    let output = git_command(repo_root)
        .args(["worktree", "remove", "--force"])
        .arg(path)
        .output()
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

/// The branch or detached commit currently recorded for `path`.
pub fn registered_checkout(repo_root: &Path, path: &Path) -> Result<Option<WorktreeCheckout>> {
    let output = run_git(repo_root, &["worktree", "list", "--porcelain", "-z"])
        .context("failed to execute 'git worktree list'")?;
    if !output.status.success() {
        bail!(
            "failed to inspect registered worktrees: {}",
            first_stderr_line(&output.stderr)
        );
    }

    let mut record_path: Option<PathBuf> = None;
    let mut head = None;
    let mut branch = None;
    let mut detached = false;
    for field in output.stdout.split(|byte| *byte == 0) {
        if field.is_empty() {
            if record_path
                .as_ref()
                .is_some_and(|registered| paths_match(registered, path))
            {
                return match (branch.take(), detached, head.take()) {
                    (Some(branch), _, _) => Ok(Some(WorktreeCheckout::Branch(branch))),
                    (None, true, Some(head)) => Ok(Some(WorktreeCheckout::Detached(head))),
                    _ => Err(anyhow!(
                        "registered worktree '{}' has no checkout identity",
                        path.display()
                    )),
                };
            }
            record_path = None;
            head = None;
            branch = None;
            detached = false;
            continue;
        }
        if let Some(raw) = field.strip_prefix(b"worktree ") {
            record_path = Some(path_from_git_bytes(raw)?);
        } else if let Some(raw) = field.strip_prefix(b"HEAD ") {
            head = Some(
                String::from_utf8(raw.to_vec())
                    .context("git returned a non-UTF-8 worktree HEAD")?,
            );
        } else if let Some(raw) = field.strip_prefix(b"branch refs/heads/") {
            branch = Some(
                String::from_utf8(raw.to_vec()).context("git returned a non-UTF-8 branch name")?,
            );
        } else if field == b"detached" {
            detached = true;
        }
    }
    Ok(None)
}

fn paths_match(left: &Path, right: &Path) -> bool {
    canonicalize_with_missing(left)
        .zip(canonicalize_with_missing(right))
        .is_some_and(|(left, right)| left == right)
}

fn canonicalize_with_missing(path: &Path) -> Option<PathBuf> {
    let mut current = path;
    let mut missing = Vec::new();
    while !current.exists() {
        missing.push(current.file_name()?.to_os_string());
        current = current.parent()?;
    }
    let mut canonical = current.canonicalize().ok()?;
    for component in missing.iter().rev() {
        canonical.push(component);
    }
    Some(canonical)
}

/// The commit a branch points at, or `None` when the branch is gone.
pub fn branch_head(repo_root: &Path, branch: &str) -> Option<String> {
    let reference = format!("refs/heads/{branch}");
    let output = run_git(repo_root, &["rev-parse", "--verify", "--quiet", &reference]).ok()?;
    if !output.status.success() {
        return None;
    }
    let head = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!head.is_empty()).then_some(head)
}

/// Moves a session recovery branch to a detached commit.
pub fn update_branch(repo_root: &Path, branch: &str, head: &str) -> Result<()> {
    let reference = format!("refs/heads/{branch}");
    let output = run_git(repo_root, &["update-ref", &reference, head])
        .context("failed to execute 'git update-ref'")?;
    if !output.status.success() {
        bail!(
            "failed to preserve detached session commit on '{}': {}",
            branch,
            first_stderr_line(&output.stderr)
        );
    }
    Ok(())
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

/// Administrative git directory for a linked worktree.
pub fn git_dir(path: &Path) -> Result<PathBuf> {
    let raw = rev_parse_path(path, "--git-dir")?
        .ok_or_else(|| anyhow!("'{}' is not a git worktree", path.display()))?;
    absolutize(path, &raw)
}

fn rev_parse_path(cwd: &Path, flag: &str) -> Result<Option<PathBuf>> {
    let output = run_git(cwd, &["rev-parse", flag]).context("failed to execute 'git rev-parse'")?;
    if !output.status.success() {
        return Ok(None);
    }
    let bytes = output.stdout.strip_suffix(b"\n").unwrap_or(&output.stdout);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    Ok(Some(path_from_git_bytes(bytes)?))
}

fn run_git(cwd: &Path, args: &[&str]) -> std::io::Result<Output> {
    git_command(cwd).args(args).output()
}

fn git_command(cwd: &Path) -> StdCommand {
    // Hooks are disabled on nac's own git invocations: the sandbox shares
    // selected repository metadata with the container, so a hook planted
    // there must never execute on the host with the user's privileges.
    let mut command = StdCommand::new("git");
    command
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .arg("-C")
        .arg(cwd)
        .stdin(Stdio::null());
    command
}

fn absolutize(base: &Path, path: &Path) -> Result<PathBuf> {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    };
    joined
        .canonicalize()
        .with_context(|| format!("failed to resolve git dir '{}'", joined.display()))
}

#[cfg(unix)]
fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    Ok(PathBuf::from(OsString::from_vec(bytes.to_vec())))
}

#[cfg(not(unix))]
fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf> {
    Ok(PathBuf::from(
        String::from_utf8(bytes.to_vec()).context("git returned a non-UTF-8 path")?,
    ))
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
    fn remove_clears_the_stale_entry_of_an_externally_deleted_worktree() {
        let repo = TestRepo::new("stale-entry");
        repo.commit_file("a.txt", "a");
        let info = find_repo(&repo.root).unwrap().unwrap();
        let worktree = repo.worktree_path("session");

        create(&info.root, &worktree, "nac/test789").unwrap();
        // Deleting the directory externally — not `git worktree remove` —
        // leaves the worktree registered, so git still considers the branch
        // checked out and would refuse to delete it.
        std::fs::remove_dir_all(&worktree).unwrap();

        remove(&info.root, &worktree).unwrap();
        delete_branch(&info.root, "nac/test789").unwrap();
        assert_eq!(branch_head(&info.root, "nac/test789"), None);
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
        assert!(!is_usable(&worktree).unwrap());
        let checkout = registered_checkout(&info.root, &worktree)
            .unwrap()
            .expect("stale entry retains its checkout");
        remove(&info.root, &worktree).unwrap();
        re_add(&info.root, &worktree, &checkout, false).unwrap();
        assert!(worktree.join("b.txt").exists());
        assert!(is_usable(&worktree).unwrap());
        assert_eq!(branch_head(&info.root, "nac/test456"), Some(committed));

        remove(&info.root, &worktree).unwrap();
        delete_branch(&info.root, "nac/test456").unwrap();
    }
}
