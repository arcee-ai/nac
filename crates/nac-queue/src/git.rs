//! Git worktree management for the nac-queue pipeline.
//!
//! Each implementation/verification task runs in its own git worktree on its
//! own branch. This module wraps the plain `git` CLI via `std::process::Command`
//! — simpler than the git2 crate for a PoC.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Information about a single worktree, parsed from `git worktree list --porcelain`.
#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch: String,
    pub head: String,
}

/// Result of attempting a merge.
#[derive(Debug, Clone)]
pub enum MergeResult {
    Success,
    Conflict { files: Vec<String> },
}

/// Generate a branch name from a task id: `nac-queue/{task_id}`.
pub fn make_branch_name(task_id: &str) -> String {
    format!("nac-queue/{task_id}")
}

/// Sanitize a branch name for use as a filesystem directory component.
///
/// Branch names may contain `/` (e.g. `nac-queue/abc123`) but directory names
/// cannot. We replace `/` with `-` so the worktree path is filesystem-safe.
fn sanitize_for_path(branch_name: &str) -> String {
    branch_name.replace('/', "-")
}

/// Run a git command in `repo_path` and return its stdout on success.
///
/// Returns an error if the command exits with a non-zero status, including
/// stderr in the error message.
fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .context("failed to spawn git")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        anyhow::bail!(
            "git {} failed (exit {:?})\nstdout: {}\nstderr: {}",
            args.join(" "),
            output.status.code(),
            stdout.trim(),
            stderr.trim(),
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Create a worktree directory and a new branch from the current HEAD.
///
/// The worktree is placed at `{repo_path}/.nac-queue/worktrees/{sanitized_branch}`.
/// The `.nac-queue/worktrees` directory is created if it does not already exist.
///
/// Runs: `git -C {repo_path} worktree add {worktree_path} -b {branch_name}`
pub fn create_worktree(repo_path: &Path, branch_name: &str) -> Result<PathBuf> {
    let worktrees_dir = repo_path.join(".nac-queue").join("worktrees");
    std::fs::create_dir_all(&worktrees_dir)
        .with_context(|| format!("failed to create {}", worktrees_dir.display()))?;

    let safe_name = sanitize_for_path(branch_name);
    let worktree_path = worktrees_dir.join(&safe_name);

    run_git(
        repo_path,
        &[
            "worktree",
            "add",
            worktree_path.to_str().unwrap_or(""),
            "-b",
            branch_name,
        ],
    )
    .with_context(|| format!("failed to create worktree for branch {branch_name}"))?;

    Ok(worktree_path)
}

/// Remove a worktree (force) and delete its branch.
///
/// Runs:
/// - `git -C {repo_path} worktree remove {worktree_path} --force`
/// - `git -C {repo_path} branch -D {branch_name}`
pub fn remove_worktree(repo_path: &Path, worktree_path: &Path, branch_name: &str) -> Result<()> {
    run_git(
        repo_path,
        &[
            "worktree",
            "remove",
            worktree_path.to_str().unwrap_or(""),
            "--force",
        ],
    )
    .with_context(|| format!("failed to remove worktree {}", worktree_path.display()))?;

    run_git(repo_path, &["branch", "-D", branch_name])
        .with_context(|| format!("failed to delete branch {branch_name}"))?;

    Ok(())
}

/// Attempt a `--no-ff` merge of `branch_name` into the current branch of `repo_path`.
///
/// Returns `MergeResult::Success` on a clean merge, or `MergeResult::Conflict`
/// with the list of conflicted file paths if the merge results in conflicts.
///
/// Note: the actual merge in the pipeline will typically be done by an agentic
/// nac session. This helper is useful for cleanup or an initial attempt.
pub fn merge_branch(repo_path: &Path, branch_name: &str) -> Result<MergeResult> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["merge", "--no-ff", branch_name])
        .output()
        .context("failed to spawn git merge")?;

    if output.status.success() {
        return Ok(MergeResult::Success);
    }

    // Non-zero exit — could be a conflict or a real error.
    // Check for conflicts via `git diff --name-only --diff-filter=U`.
    let diff_output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["diff", "--name-only", "--diff-filter=U"])
        .output()
        .context("failed to spawn git diff for conflict check")?;

    let files: Vec<String> = String::from_utf8_lossy(&diff_output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect();

    if !files.is_empty() {
        Ok(MergeResult::Conflict { files })
    } else {
        // Non-zero exit but no unmerged files — treat as a real error.
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "git merge --no-ff {} failed (exit {:?})\nstderr: {}",
            branch_name,
            output.status.code(),
            stderr.trim(),
        );
    }
}

/// List all worktrees via `git worktree list --porcelain`.
///
/// Porcelain output format (one record per worktree, blank-line separated):
/// ```text
/// worktree /path/to/repo
/// HEAD  abc123...
/// branch refs/heads/main
///
/// worktree /path/to/worktree2
/// HEAD  def456...
/// branch refs/heads/feature
/// ```
pub fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>> {
    let out = run_git(repo_path, &["worktree", "list", "--porcelain"])
        .context("failed to list worktrees")?;

    let mut worktrees = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_head = String::new();
    let mut current_branch = String::new();

    for line in out.lines() {
        if line.is_empty() {
            // End of record — flush.
            if let Some(path) = current_path.take() {
                worktrees.push(WorktreeInfo {
                    path,
                    branch: current_branch.clone(),
                    head: current_head.clone(),
                });
                current_head.clear();
                current_branch.clear();
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("worktree ") {
            current_path = Some(PathBuf::from(rest));
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            current_head = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("branch ") {
            // Strip `refs/heads/` prefix if present.
            current_branch = rest
                .strip_prefix("refs/heads/")
                .unwrap_or(rest)
                .to_string();
        }
        // Other lines (e.g. "detached", "bare") are ignored for now.
    }

    // Flush the last record if the output didn't end with a blank line.
    if let Some(path) = current_path.take() {
        worktrees.push(WorktreeInfo {
            path,
            branch: current_branch,
            head: current_head,
        });
    }

    Ok(worktrees)
}

/// Return the current branch name of `repo_path`.
///
/// Runs: `git -C {repo_path} rev-parse --abbrev-ref HEAD`
pub fn current_branch(repo_path: &Path) -> Result<String> {
    let out = run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .context("failed to get current branch")?;
    Ok(out.trim().to_string())
}

/// Return `true` if the repo has uncommitted changes.
///
/// Runs: `git -C {repo_path} status --porcelain` — non-empty output means
/// there are uncommitted changes.
pub fn has_uncommitted_changes(repo_path: &Path) -> Result<bool> {
    let out = run_git(repo_path, &["status", "--porcelain"])
        .context("failed to check git status")?;
    Ok(!out.trim().is_empty())
}

/// Remove all worktrees that live under `{repo_path}/.nac-queue/worktrees/`.
///
/// Useful for shutdown / reset. Each worktree is force-removed and its branch
/// is deleted.
pub fn cleanup_all_worktrees(repo_path: &Path) -> Result<()> {
    let worktrees_dir = repo_path.join(".nac-queue").join("worktrees");
    if !worktrees_dir.exists() {
        return Ok(());
    }

    let worktrees = list_worktrees(repo_path).context("failed to list worktrees for cleanup")?;

    for wt in worktrees {
        // Only clean up worktrees that are inside our managed directory.
        if !wt.path.starts_with(&worktrees_dir) {
            continue;
        }

        // Use the branch name if we have it; otherwise skip branch deletion.
        let branch = if wt.branch.is_empty() {
            None
        } else {
            Some(wt.branch.as_str())
        };

        // Force-remove the worktree.
        let rm_output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(["worktree", "remove", wt.path.to_str().unwrap_or(""), "--force"])
            .output()
            .context("failed to spawn git worktree remove")?;

        if !rm_output.status.success() {
            tracing::warn!(
                "cleanup: failed to remove worktree {}: {}",
                wt.path.display(),
                String::from_utf8_lossy(&rm_output.stderr).trim()
            );
        }

        // Delete the branch.
        if let Some(b) = branch {
            let br_output = std::process::Command::new("git")
                .arg("-C")
                .arg(repo_path)
                .args(["branch", "-D", b])
                .output()
                .context("failed to spawn git branch -D")?;

            if !br_output.status.success() {
                tracing::warn!(
                    "cleanup: failed to delete branch {b}: {}",
                    String::from_utf8_lossy(&br_output.stderr).trim()
                );
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_branch_name() {
        assert_eq!(make_branch_name("abc123"), "nac-queue/abc123");
    }

    #[test]
    fn test_sanitize_for_path() {
        assert_eq!(sanitize_for_path("nac-queue/abc123"), "nac-queue-abc123");
        assert_eq!(sanitize_for_path("feature/x/y"), "feature-x-y");
        assert_eq!(sanitize_for_path("plain"), "plain");
    }
}