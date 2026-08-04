//! Everything nac writes to the user's repository on its own initiative.
//!
//! Two kinds of write live here and they carry very different weight. The
//! branch and commit operations below change what the user's checkout is, so
//! each one is deliberately narrow, and whether it is allowed at all — no run
//! in flight, nothing uncommitted — is decided by the caller, because only it
//! can see the other sessions sharing this checkout. The revision captures in
//! the submodule change nothing the user can observe: they only add objects and
//! one ref under `refs/nac/`.

use std::path::Path;
use std::process::Command as StdCommand;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

mod revisions;

pub use revisions::{capture, forget, RevisionCapture};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Branch {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BranchList {
    /// None on a detached HEAD or in a repository without commits.
    pub current: Option<String>,
    pub branches: Vec<Branch>,
    /// Tracked files differ from HEAD, which makes switching unsafe.
    pub dirty: bool,
}

/// Local branches, most recently used first, plus the state of the tree.
pub fn list_branches(root: &Path) -> Result<BranchList> {
    let raw = run_git(
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads",
        ],
    )?;
    let current = run_git(root, &["branch", "--show-current"])?;
    let current = (!current.is_empty()).then_some(current);

    let branches = raw
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| Branch {
            is_current: Some(name) == current.as_deref(),
            name: name.to_string(),
        })
        .collect();

    Ok(BranchList {
        current,
        branches,
        dirty: is_dirty(root)?,
    })
}

/// Create a branch off the current HEAD and switch to it, carrying any
/// uncommitted work along, which is what makes this safe on a dirty tree.
pub fn create_branch(root: &Path, name: &str) -> Result<BranchList> {
    let name = validate_branch_name(root, name)?;
    run_git(root, &["switch", "--create", &name])?;
    list_branches(root)
}

/// Switch to an existing branch. The caller must have established that the
/// tree is clean; git is still the final arbiter and its refusal is passed on.
pub fn switch_branch(root: &Path, name: &str) -> Result<BranchList> {
    let name = validate_branch_name(root, name)?;
    run_git(root, &["switch", &name])?;
    list_branches(root)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitOutcome {
    pub sha: String,
    /// None on a detached HEAD.
    pub branch: Option<String>,
    pub files_changed: usize,
    pub additions: u64,
    pub deletions: u64,
}

/// Stage the whole checkout and commit it.
///
/// This is the user's own commit, so it runs against the ordinary index and
/// leaves their identity, hooks and signing configuration to decide the rest;
/// whatever git refuses is passed back verbatim. Everything is staged because
/// the panel that calls this offers no way to pick a subset.
pub fn commit_all(root: &Path, message: &str) -> Result<CommitOutcome> {
    let message = message.trim();
    if message.is_empty() {
        return Err(anyhow!("commit message is empty"));
    }

    run_git(root, &["add", "--all"])?;
    // Committing an empty index either fails or, with a hook in play, succeeds
    // confusingly, so the caller is told plainly instead.
    if run_git(root, &["diff", "--cached", "--name-only"])?.is_empty() {
        return Err(anyhow!("nothing to commit: the checkout matches HEAD"));
    }
    run_git(root, &["commit", "--message", message])?;

    let branch = run_git(root, &["branch", "--show-current"])?;
    let (files_changed, additions, deletions) =
        sum_numstat(&run_git(root, &["show", "--numstat", "--format=", "HEAD"])?);
    Ok(CommitOutcome {
        sha: run_git(root, &["rev-parse", "HEAD"])?,
        branch: (!branch.is_empty()).then_some(branch),
        files_changed,
        additions,
        deletions,
    })
}

/// Totals over `git show --numstat` output, whose lines are additions, then
/// deletions, then the path, tab separated. A binary file reports `-` for both
/// counts, so it is counted as a file that changed by nothing.
fn sum_numstat(raw: &str) -> (usize, u64, u64) {
    let mut files = 0;
    let mut additions = 0;
    let mut deletions = 0;

    for line in raw.lines() {
        let mut fields = line.split('\t');
        let (Some(added), Some(removed), Some(_path)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        files += 1;
        additions += added.parse::<u64>().unwrap_or(0);
        deletions += removed.parse::<u64>().unwrap_or(0);
    }

    (files, additions, deletions)
}

fn is_dirty(root: &Path) -> Result<bool> {
    // Untracked files travel across a switch untouched, so they do not count;
    // git refuses on its own in the rare case one would be overwritten.
    let status = run_git(root, &["status", "--porcelain", "--untracked-files=no"])?;
    Ok(!status.trim().is_empty())
}

fn validate_branch_name(root: &Path, name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(anyhow!("invalid branch name: the name is empty"));
    }
    // Checked before anything reaches git, so a name can never be read as a
    // flag by the very command that is meant to validate it.
    if name.starts_with('-') {
        return Err(anyhow!("invalid branch name: it may not start with '-'"));
    }
    if name.chars().any(char::is_whitespace) {
        return Err(anyhow!("invalid branch name: it may not contain spaces"));
    }
    if run_git(root, &["check-ref-format", "--branch", name]).is_err() {
        return Err(anyhow!("invalid branch name: git rejected '{}'", name));
    }
    Ok(name.to_string())
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| anyhow!("could not run git: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("git reported no details");
        return Err(anyhow!("git {} failed: {}", args[0], message));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}
