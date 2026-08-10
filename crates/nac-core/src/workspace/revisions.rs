//! Capturing what the checkout looked like at the end of a run.
//!
//! A revision is an ordinary git commit that nac builds on the side. Nothing
//! the user owns is touched: the staging happens in nac's own index file, the
//! commit is written with `commit-tree` rather than `git commit`, and the
//! result is parked under `refs/nac/`, far away from `refs/heads/`. The user's
//! index, HEAD and branches come out of a capture exactly as they went in.
//!
//! Going through git rather than copying files elsewhere is what makes the rest
//! of the feature cheap: listing a revision is `ls-tree`, reading a file from it
//! is `cat-file`, and comparing two of them is `diff`. Unchanged files cost
//! nothing to store, because both revisions point at the same blobs.
//!
//! All of it runs wherever the checkout is, so a remote session records its
//! revisions in the remote repository rather than shipping trees across the
//! connection.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};

use super::{first_stderr_line, GitTarget};

/// What a capture wrote, and what it was taken against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionCapture {
    pub commit: String,
    /// The commit this revision is compared against to show "what changed".
    /// None only in a repository that has no commits yet.
    pub base: Option<String>,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
}

/// Record the current working tree as a revision of `session_id`.
///
/// `previous` is the last revision captured for this session; it becomes both
/// the parent of the new commit — which is what keeps the whole chain alive
/// under one ref — and the baseline the change counts are measured against.
pub fn capture(
    target: &GitTarget,
    session_id: &str,
    previous: Option<&str>,
) -> Result<RevisionCapture> {
    let repo_root = target.repo_root()?;
    let index = index_path(target, &repo_root, session_id)?;

    // Staging into a private index is the whole safety story here, so it is
    // worth being explicit: the only commands below that write an index get
    // this path, and neither of them can reach the user's own.
    git_with_index(target, &repo_root, &index, &["add", "--all"])
        .context("failed to stage the working tree for a workspace revision")?;
    let tree = git_with_index(target, &repo_root, &index, &["write-tree"])
        .context("failed to write a workspace revision tree")?;

    let head = git(target, &repo_root, &["rev-parse", "HEAD"], None, false).ok();
    let branch = git(
        target,
        &repo_root,
        &["branch", "--show-current"],
        None,
        false,
    )
    .ok()
    .filter(|value| !value.is_empty());

    let mut args = vec!["commit-tree", tree.as_str(), "-m", "nac workspace revision"];
    if let Some(previous) = previous {
        args.push("-p");
        args.push(previous);
    }
    let commit =
        git_as_nac(target, &repo_root, &args).context("failed to record a workspace revision")?;

    // The ref exists purely so that git's garbage collection leaves the chain
    // alone; moving it to the newest commit keeps every older one reachable.
    git(
        target,
        &repo_root,
        &["update-ref", &ref_name(session_id), &commit],
        None,
        false,
    )
    .context("failed to publish a workspace revision")?;

    let base = previous.map(str::to_string).or_else(|| head.clone());
    let (additions, deletions, changed_files) = match base.as_deref() {
        Some(base) => diff_totals(target, &repo_root, base, &commit)?,
        None => (0, 0, 0),
    };

    Ok(RevisionCapture {
        commit,
        base,
        head,
        branch,
        additions,
        deletions,
        changed_files,
    })
}

/// Put the working tree back to what `commit` captured.
///
/// The safety story is the one `capture` tells: the user's own index, HEAD and
/// branches come out untouched, because the only index this reads and writes is
/// nac's private one. What does change is the files — that is the point — so a
/// caller must have established that nobody is working in the checkout.
///
/// The two-tree form of `read-tree` is what makes this a restore rather than an
/// overlay: given where the tree is now and where it should be, git also
/// removes the files the revision never had.
pub fn restore(target: &GitTarget, session_id: &str, commit: &str) -> Result<()> {
    let repo_root = target.repo_root()?;
    let index = index_path(target, &repo_root, session_id)?;

    git_with_index(target, &repo_root, &index, &["add", "--all"])
        .context("failed to record the working tree before restoring a revision")?;
    let current = git_with_index(target, &repo_root, &index, &["write-tree"])
        .context("failed to write the working tree before restoring a revision")?;
    git_with_index(
        target,
        &repo_root,
        &index,
        &["read-tree", "-m", "-u", current.as_str(), commit],
    )
    .context("failed to restore the working tree to a workspace revision")?;
    Ok(())
}

/// Point a session's revision ref back at `commit`, so the revisions dropped by
/// a revert stop pinning objects git could otherwise reclaim.
pub fn rewind_ref(target: &GitTarget, session_id: &str, commit: &str) -> Result<()> {
    let repo_root = target.repo_root()?;
    git(
        target,
        &repo_root,
        &["update-ref", &ref_name(session_id), commit],
        None,
        false,
    )
    .context("failed to rewind a workspace revision chain")?;
    Ok(())
}

/// Drop a session's revision chain, letting git reclaim the objects it pinned.
pub fn forget(target: &GitTarget, session_id: &str) -> Result<()> {
    let repo_root = target.repo_root()?;
    let reference = ref_name(session_id);
    if git(
        target,
        &repo_root,
        &["rev-parse", "--verify", "--quiet", &reference],
        None,
        false,
    )
    .is_err()
    {
        return Ok(());
    }
    git(
        target,
        &repo_root,
        &["update-ref", "-d", &reference],
        None,
        false,
    )
    .context("failed to delete a workspace revision chain")?;
    let _ = target.remove_file(&index_path(target, &repo_root, session_id)?);
    Ok(())
}

fn diff_totals(
    target: &GitTarget,
    repo_root: &Path,
    base: &str,
    commit: &str,
) -> Result<(u64, u64, u64)> {
    let raw = git(
        target,
        repo_root,
        &["diff", "--numstat", base, commit],
        None,
        false,
    )
    .context("failed to measure a workspace revision")?;
    let mut additions = 0u64;
    let mut deletions = 0u64;
    let mut files = 0u64;
    for line in raw.lines().filter(|line| !line.trim().is_empty()) {
        let mut columns = line.split('\t');
        // Binary files report "-" for both counts, which parses to nothing and
        // leaves the totals alone while still counting the file.
        additions = additions.saturating_add(parse_count(columns.next()));
        deletions = deletions.saturating_add(parse_count(columns.next()));
        files = files.saturating_add(1);
    }
    Ok((additions, deletions, files))
}

fn parse_count(column: Option<&str>) -> u64 {
    column
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

/// A per-session index file inside the git directory. Keeping it around between
/// captures is what makes them fast: git can trust the recorded stat data and
/// only rehash the files that actually moved, instead of the whole checkout.
fn index_path(target: &GitTarget, repo_root: &Path, session_id: &str) -> Result<PathBuf> {
    let git_dir = git(
        target,
        repo_root,
        &["rev-parse", "--absolute-git-dir"],
        None,
        false,
    )?;
    let dir = PathBuf::from(git_dir).join("nac-revisions");
    target.mkdir_p(&dir)?;
    Ok(dir.join(format!("index-{}", slug(session_id))))
}

fn ref_name(session_id: &str) -> String {
    format!("refs/nac/revisions/{}", slug(session_id))
}

/// Session ids reach us from the outside and this one ends up in a ref name, so
/// nothing but the characters that are unambiguously safe there survives.
fn slug(session_id: &str) -> String {
    let slug: String = session_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    if slug.is_empty() {
        "session".to_string()
    } else {
        slug
    }
}

fn git_with_index(
    target: &GitTarget,
    repo_root: &Path,
    index: &Path,
    args: &[&str],
) -> Result<String> {
    git(target, repo_root, args, Some(index), false)
}

fn git_as_nac(target: &GitTarget, repo_root: &Path, args: &[&str]) -> Result<String> {
    git(target, repo_root, args, None, true)
}

fn git(
    target: &GitTarget,
    repo_root: &Path,
    args: &[&str],
    index: Option<&Path>,
    identity: bool,
) -> Result<String> {
    let index = index.map(|index| index.display().to_string());
    let mut envs: Vec<(&str, &str)> = Vec::new();
    if let Some(index) = index.as_deref() {
        envs.push(("GIT_INDEX_FILE", index));
    }
    if identity {
        // Revisions have to be recordable on a machine where nobody ever set
        // user.email, and they are not the user's commits anyway.
        envs.extend([
            ("GIT_AUTHOR_NAME", "nac"),
            ("GIT_AUTHOR_EMAIL", "nac@localhost"),
            ("GIT_COMMITTER_NAME", "nac"),
            ("GIT_COMMITTER_EMAIL", "nac@localhost"),
        ]);
    }

    let output = target.output_with_env(repo_root, &envs, args)?;
    if !output.status.success() {
        if let Some(reason) = target.unavailable_reason(&output) {
            return Err(anyhow!("{reason}"));
        }
        return Err(anyhow!(
            "git {} failed: {}",
            args[0],
            first_stderr_line(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}
