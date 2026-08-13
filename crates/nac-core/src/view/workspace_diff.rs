use std::path::{Component, Path, PathBuf};
use std::process::Output;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::workspace::{GitTarget, WorktreeRead};

const WORKSPACE_DIFF_MAX_FILE_BYTES: u64 = 512 * 1024;
const WORKSPACE_DIFF_MAX_HUNKS: usize = 256;
const WORKSPACE_DIFF_MAX_LINES: usize = 5_000;
const WORKSPACE_DIFF_MAX_LINE_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub sections: Vec<WorkspaceDiffSection>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceDiffSection {
    pub stage: String,
    pub status: String,
    pub binary: bool,
    pub too_large: bool,
    pub truncated: bool,
    pub additions: u64,
    pub deletions: u64,
    pub hunks: Vec<WorkspaceDiffHunk>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceDiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub function_context: Option<String>,
    pub lines: Vec<WorkspaceDiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceDiffLine {
    pub kind: String,
    pub old_lineno: Option<usize>,
    pub new_lineno: Option<usize>,
    pub content: String,
    pub has_trailing_newline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceDiffStage {
    All,
    Staged,
    Unstaged,
    Untracked,
}

impl WorkspaceDiffStage {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "all" => Ok(Self::All),
            "staged" => Ok(Self::Staged),
            "unstaged" => Ok(Self::Unstaged),
            "untracked" => Ok(Self::Untracked),
            _ => bail!("invalid workspace diff stage '{}'", value),
        }
    }
}

pub fn workspace_file_diff(
    target: &GitTarget,
    path: &str,
    stage: WorkspaceDiffStage,
    context: usize,
) -> Result<WorkspaceFileDiff> {
    let relpath = validate_workspace_relpath(path)?;
    let repo_root = target.repo_root()?;
    let repo = Repo {
        target,
        root: &repo_root,
    };
    let head_blob = git_head_blob(repo, &relpath)?;
    let index_blob = git_index_blob(repo, &relpath)?;
    let has_unstaged = git_path_list_contains_exact(
        repo,
        &[
            "--literal-pathspecs",
            "ls-files",
            "-z",
            "-m",
            "-d",
            "--",
            &relpath,
        ],
        &relpath,
    )?;
    let is_untracked = git_path_list_contains_exact(
        repo,
        &[
            "--literal-pathspecs",
            "ls-files",
            "-z",
            "--others",
            "--exclude-standard",
            "--",
            &relpath,
        ],
        &relpath,
    )?;

    let mut sections = Vec::new();
    if matches!(stage, WorkspaceDiffStage::All | WorkspaceDiffStage::Staged)
        && blob_changed(head_blob.as_ref(), index_blob.as_ref())
    {
        sections.push(build_diff_section(
            repo,
            &relpath,
            "staged",
            staged_status(head_blob.as_ref(), index_blob.as_ref()),
            blob_side(head_blob.clone()),
            blob_side(index_blob.clone()),
            context,
        ));
    }

    if matches!(
        stage,
        WorkspaceDiffStage::All | WorkspaceDiffStage::Unstaged
    ) && has_unstaged
    {
        sections.push(build_diff_section(
            repo,
            &relpath,
            "unstaged",
            unstaged_status(repo, index_blob.as_ref(), &relpath),
            blob_side(index_blob.clone()),
            DiffSide::Worktree,
            context,
        ));
    }

    if matches!(
        stage,
        WorkspaceDiffStage::All | WorkspaceDiffStage::Untracked
    ) && is_untracked
    {
        sections.push(build_diff_section(
            repo,
            &relpath,
            "untracked",
            "untracked",
            DiffSide::Empty,
            DiffSide::Worktree,
            context,
        ));
    }

    Ok(WorkspaceFileDiff {
        path: relpath,
        old_path: None,
        sections,
        error: None,
    })
}

/// What one file looked like before and after a captured revision.
///
/// Unlike the working-tree diff there is nothing staged or untracked to
/// separate here: a revision is a single frozen tree, so the answer is always
/// at most one section.
pub fn revision_file_diff(
    target: &GitTarget,
    base: Option<&str>,
    commit: &str,
    path: &str,
    context: usize,
) -> Result<WorkspaceFileDiff> {
    let relpath = validate_workspace_relpath(path)?;
    let repo_root = target.repo_root()?;
    let repo = Repo {
        target,
        root: &repo_root,
    };
    let old_blob = match base {
        Some(base) => git_tree_blob(repo, base, &relpath)?,
        None => None,
    };
    let new_blob = git_tree_blob(repo, commit, &relpath)?;

    let mut sections = Vec::new();
    if blob_changed(old_blob.as_ref(), new_blob.as_ref()) {
        sections.push(build_diff_section(
            repo,
            &relpath,
            "revision",
            staged_status(old_blob.as_ref(), new_blob.as_ref()),
            blob_side(old_blob),
            blob_side(new_blob),
            context,
        ));
    }

    Ok(WorkspaceFileDiff {
        path: relpath,
        old_path: None,
        sections,
        error: None,
    })
}

/// A repository and where its git runs. The two always travel together — every
/// command below needs both — and resolving the root costs a round trip on a
/// remote checkout, so it is resolved once per request and carried.
#[derive(Debug, Clone, Copy)]
struct Repo<'a> {
    target: &'a GitTarget,
    root: &'a Path,
}

#[derive(Debug, Clone)]
struct GitBlobRef {
    oid: String,
    mode: String,
}

#[derive(Debug, Clone)]
enum DiffSide {
    Empty,
    Blob(GitBlobRef),
    Worktree,
}

#[derive(Debug)]
enum LimitedBytes {
    Bytes(Vec<u8>),
    TooLarge,
}

#[derive(Debug)]
struct DiffHunksResult {
    hunks: Vec<WorkspaceDiffHunk>,
    additions: u64,
    deletions: u64,
    truncated: bool,
}

pub fn validate_workspace_relpath(path: &str) -> Result<String> {
    if path.is_empty() {
        bail!("invalid path: path is empty");
    }
    if path.contains('\0') {
        bail!("invalid path: path contains NUL");
    }

    let raw = Path::new(path);
    if raw.is_absolute() {
        bail!("invalid path: absolute paths are not allowed");
    }

    let mut normalized = PathBuf::new();
    let mut saw_normal = false;
    for component in raw.components() {
        match component {
            Component::Normal(part) => {
                normalized.push(part);
                saw_normal = true;
            }
            Component::CurDir => {
                bail!("invalid path: current-directory components are not allowed")
            }
            Component::ParentDir => {
                bail!("invalid path: parent-directory components are not allowed")
            }
            Component::RootDir | Component::Prefix(_) => {
                bail!("invalid path: absolute paths are not allowed")
            }
        }
    }

    if !saw_normal {
        bail!("invalid path: path is empty");
    }

    normalized
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("invalid path: path must be UTF-8"))
}

fn git_head_blob(repo: Repo<'_>, relpath: &str) -> Result<Option<GitBlobRef>> {
    let Some(raw) = run_git_bytes_optional_missing_head(
        repo,
        &[
            "--literal-pathspecs",
            "ls-tree",
            "-z",
            "HEAD",
            "--",
            relpath,
        ],
    )?
    else {
        return Ok(None);
    };
    parse_ls_tree_blob(&raw)
}

fn git_tree_blob(repo: Repo<'_>, rev: &str, relpath: &str) -> Result<Option<GitBlobRef>> {
    let raw = run_git_bytes(
        repo,
        &["--literal-pathspecs", "ls-tree", "-z", rev, "--", relpath],
    )?;
    parse_ls_tree_blob(&raw)
}

fn git_index_blob(repo: Repo<'_>, relpath: &str) -> Result<Option<GitBlobRef>> {
    let raw = run_git_bytes(
        repo,
        &["--literal-pathspecs", "ls-files", "-z", "-s", "--", relpath],
    )?;
    parse_ls_files_stage0_blob(&raw)
}

fn parse_ls_tree_blob(raw: &[u8]) -> Result<Option<GitBlobRef>> {
    for record in nul_records(raw) {
        let (meta, _) = split_once_byte(record, b'\t')
            .ok_or_else(|| anyhow!("unexpected git ls-tree output"))?;
        let meta = std::str::from_utf8(meta).context("git ls-tree output is not valid UTF-8")?;
        let mut parts = meta.split_whitespace();
        let mode = parts
            .next()
            .ok_or_else(|| anyhow!("unexpected git ls-tree mode"))?;
        let kind = parts
            .next()
            .ok_or_else(|| anyhow!("unexpected git ls-tree object type"))?;
        let oid = parts
            .next()
            .ok_or_else(|| anyhow!("unexpected git ls-tree object id"))?;
        if kind == "blob" {
            return Ok(Some(GitBlobRef {
                oid: oid.to_string(),
                mode: mode.to_string(),
            }));
        }
    }
    Ok(None)
}

fn parse_ls_files_stage0_blob(raw: &[u8]) -> Result<Option<GitBlobRef>> {
    for record in nul_records(raw) {
        let (meta, _) = split_once_byte(record, b'\t')
            .ok_or_else(|| anyhow!("unexpected git ls-files output"))?;
        let meta = std::str::from_utf8(meta).context("git ls-files output is not valid UTF-8")?;
        let mut parts = meta.split_whitespace();
        let mode = parts
            .next()
            .ok_or_else(|| anyhow!("unexpected git ls-files mode"))?;
        let oid = parts
            .next()
            .ok_or_else(|| anyhow!("unexpected git ls-files object id"))?;
        let stage = parts
            .next()
            .ok_or_else(|| anyhow!("unexpected git ls-files stage"))?;
        if stage == "0" {
            return Ok(Some(GitBlobRef {
                oid: oid.to_string(),
                mode: mode.to_string(),
            }));
        }
    }
    Ok(None)
}

fn nul_records(raw: &[u8]) -> impl Iterator<Item = &[u8]> {
    raw.split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
}

fn split_once_byte(bytes: &[u8], needle: u8) -> Option<(&[u8], &[u8])> {
    let index = bytes.iter().position(|byte| *byte == needle)?;
    Some((&bytes[..index], &bytes[index + 1..]))
}

fn git_path_list_contains_exact(repo: Repo<'_>, args: &[&str], relpath: &str) -> Result<bool> {
    let raw = run_git_bytes(repo, args)?;
    let relpath = relpath.as_bytes();
    let contains = nul_records(&raw).any(|record| record == relpath);
    Ok(contains)
}

fn blob_changed(left: Option<&GitBlobRef>, right: Option<&GitBlobRef>) -> bool {
    match (left, right) {
        (None, None) => false,
        (Some(left), Some(right)) => left.oid != right.oid || left.mode != right.mode,
        _ => true,
    }
}

fn blob_side(blob: Option<GitBlobRef>) -> DiffSide {
    blob.map(DiffSide::Blob).unwrap_or(DiffSide::Empty)
}

fn staged_status(head: Option<&GitBlobRef>, index: Option<&GitBlobRef>) -> &'static str {
    match (head, index) {
        (None, Some(_)) => "added",
        (Some(_), None) => "deleted",
        _ => "modified",
    }
}

fn unstaged_status(repo: Repo<'_>, index: Option<&GitBlobRef>, relpath: &str) -> &'static str {
    if index.is_none() {
        return "added";
    }
    if repo.target.worktree_exists(repo.root, relpath) {
        "modified"
    } else {
        "deleted"
    }
}

fn build_diff_section(
    repo: Repo<'_>,
    relpath: &str,
    stage: &str,
    status: &str,
    old_side: DiffSide,
    new_side: DiffSide,
    context: usize,
) -> WorkspaceDiffSection {
    let mut section = WorkspaceDiffSection {
        stage: stage.to_string(),
        status: status.to_string(),
        binary: false,
        too_large: false,
        truncated: false,
        additions: 0,
        deletions: 0,
        hunks: Vec::new(),
        error: None,
    };

    let old_bytes = match read_diff_side(repo, relpath, old_side) {
        Ok(LimitedBytes::Bytes(bytes)) => bytes,
        Ok(LimitedBytes::TooLarge) => {
            section.too_large = true;
            return section;
        }
        Err(error) => {
            section.error = Some(error.to_string());
            return section;
        }
    };
    let new_bytes = match read_diff_side(repo, relpath, new_side) {
        Ok(LimitedBytes::Bytes(bytes)) => bytes,
        Ok(LimitedBytes::TooLarge) => {
            section.too_large = true;
            return section;
        }
        Err(error) => {
            section.error = Some(error.to_string());
            return section;
        }
    };

    if old_bytes.contains(&0) || new_bytes.contains(&0) {
        section.binary = true;
        return section;
    }

    let old_text = match String::from_utf8(old_bytes) {
        Ok(text) => text,
        Err(_) => {
            section.binary = true;
            return section;
        }
    };
    let new_text = match String::from_utf8(new_bytes) {
        Ok(text) => text,
        Err(_) => {
            section.binary = true;
            return section;
        }
    };

    let result = diff_text_to_hunks(relpath, &old_text, &new_text, context);
    section.hunks = result.hunks;
    section.additions = result.additions;
    section.deletions = result.deletions;
    section.truncated = result.truncated;
    section
}

fn read_diff_side(repo: Repo<'_>, relpath: &str, side: DiffSide) -> Result<LimitedBytes> {
    match side {
        DiffSide::Empty => Ok(LimitedBytes::Bytes(Vec::new())),
        DiffSide::Blob(blob) => read_git_blob(repo, &blob),
        DiffSide::Worktree => read_worktree_file(repo, relpath),
    }
}

fn read_git_blob(repo: Repo<'_>, blob: &GitBlobRef) -> Result<LimitedBytes> {
    let size_raw = run_git_bytes(repo, &["cat-file", "-s", &blob.oid])?;
    let size = String::from_utf8_lossy(&size_raw)
        .trim()
        .parse::<u64>()
        .with_context(|| format!("failed to parse git blob size for {}", blob.oid))?;
    if size > WORKSPACE_DIFF_MAX_FILE_BYTES {
        return Ok(LimitedBytes::TooLarge);
    }
    let bytes = run_git_bytes(repo, &["cat-file", "blob", &blob.oid])?;
    if bytes.len() as u64 > WORKSPACE_DIFF_MAX_FILE_BYTES {
        return Ok(LimitedBytes::TooLarge);
    }
    Ok(LimitedBytes::Bytes(bytes))
}

/// The working-tree side of a diff. A file that is gone is the empty side,
/// because that is exactly what a deletion looks like; a path that resolves out
/// of the repository is refused instead of served.
fn read_worktree_file(repo: Repo<'_>, relpath: &str) -> Result<LimitedBytes> {
    match repo
        .target
        .read_worktree(repo.root, relpath, WORKSPACE_DIFF_MAX_FILE_BYTES)?
    {
        WorktreeRead::Missing => Ok(LimitedBytes::Bytes(Vec::new())),
        WorktreeRead::NotRegular => bail!("path '{}' is not a regular file", relpath),
        WorktreeRead::Symlink { escapes: true, .. }
        | WorktreeRead::Regular { escapes: true, .. } => {
            bail!("invalid path: path escapes repository root")
        }
        WorktreeRead::Symlink { target, .. } => Ok(limited(target)),
        WorktreeRead::Regular { bytes: None, .. } => Ok(LimitedBytes::TooLarge),
        WorktreeRead::Regular {
            bytes: Some(bytes), ..
        } => Ok(limited(bytes)),
    }
}

fn limited(bytes: Vec<u8>) -> LimitedBytes {
    if bytes.len() as u64 > WORKSPACE_DIFF_MAX_FILE_BYTES {
        LimitedBytes::TooLarge
    } else {
        LimitedBytes::Bytes(bytes)
    }
}

fn diff_text_to_hunks(
    relpath: &str,
    old_text: &str,
    new_text: &str,
    context: usize,
) -> DiffHunksResult {
    let mut options = diffy::DiffOptions::new();
    options
        .set_context_len(context.min(100))
        .set_original_filename(format!("a/{relpath}"))
        .set_modified_filename(format!("b/{relpath}"));
    let patch = options.create_patch(old_text, new_text);
    let mut additions = 0u64;
    let mut deletions = 0u64;
    let mut hunks = Vec::new();
    let mut rendered_lines = 0usize;
    let mut truncated = false;

    for hunk in patch.hunks() {
        let old_range = hunk.old_range();
        let new_range = hunk.new_range();
        let mut old_lineno = old_range.start();
        let mut new_lineno = new_range.start();
        let store_hunk =
            hunks.len() < WORKSPACE_DIFF_MAX_HUNKS && rendered_lines < WORKSPACE_DIFF_MAX_LINES;
        let mut lines = Vec::new();

        if !store_hunk {
            truncated = true;
        }

        for line in hunk.lines() {
            match line {
                diffy::Line::Context(content) => {
                    if store_hunk && rendered_lines < WORKSPACE_DIFF_MAX_LINES {
                        let (content, has_trailing_newline, line_truncated) =
                            diff_line_content(content);
                        truncated |= line_truncated;
                        lines.push(WorkspaceDiffLine {
                            kind: "context".to_string(),
                            old_lineno: Some(old_lineno),
                            new_lineno: Some(new_lineno),
                            content,
                            has_trailing_newline,
                        });
                        rendered_lines += 1;
                    } else {
                        truncated = true;
                    }
                    old_lineno += 1;
                    new_lineno += 1;
                }
                diffy::Line::Delete(content) => {
                    if store_hunk && rendered_lines < WORKSPACE_DIFF_MAX_LINES {
                        let (content, has_trailing_newline, line_truncated) =
                            diff_line_content(content);
                        truncated |= line_truncated;
                        lines.push(WorkspaceDiffLine {
                            kind: "delete".to_string(),
                            old_lineno: Some(old_lineno),
                            new_lineno: None,
                            content,
                            has_trailing_newline,
                        });
                        rendered_lines += 1;
                    } else {
                        truncated = true;
                    }
                    deletions = deletions.saturating_add(1);
                    old_lineno += 1;
                }
                diffy::Line::Insert(content) => {
                    if store_hunk && rendered_lines < WORKSPACE_DIFF_MAX_LINES {
                        let (content, has_trailing_newline, line_truncated) =
                            diff_line_content(content);
                        truncated |= line_truncated;
                        lines.push(WorkspaceDiffLine {
                            kind: "insert".to_string(),
                            old_lineno: None,
                            new_lineno: Some(new_lineno),
                            content,
                            has_trailing_newline,
                        });
                        rendered_lines += 1;
                    } else {
                        truncated = true;
                    }
                    additions = additions.saturating_add(1);
                    new_lineno += 1;
                }
            }
        }

        if store_hunk {
            let mut function_context = None;
            if let Some(content) = hunk.function_context() {
                let (content, _, context_truncated) = diff_line_content(content);
                truncated |= context_truncated;
                function_context = Some(content);
            }
            hunks.push(WorkspaceDiffHunk {
                old_start: old_range.start(),
                old_lines: old_range.len(),
                new_start: new_range.start(),
                new_lines: new_range.len(),
                function_context,
                lines,
            });
        }
    }

    DiffHunksResult {
        hunks,
        additions,
        deletions,
        truncated,
    }
}

fn diff_line_content(line: &str) -> (String, bool, bool) {
    let has_trailing_newline = line.ends_with('\n');
    let content = if has_trailing_newline {
        &line[..line.len() - 1]
    } else {
        line
    };
    let content = content.strip_suffix('\r').unwrap_or(content);
    let mut chars = content.chars();
    let limited: String = chars.by_ref().take(WORKSPACE_DIFF_MAX_LINE_CHARS).collect();
    let truncated = chars.next().is_some();
    (limited, has_trailing_newline, truncated)
}

fn run_git_bytes(repo: Repo<'_>, args: &[&str]) -> Result<Vec<u8>> {
    let output = run_git_output(repo, args)?;
    if !output.status.success() {
        return Err(git_failure(repo.target, args, &output));
    }
    Ok(output.stdout)
}

fn run_git_bytes_optional_missing_head(repo: Repo<'_>, args: &[&str]) -> Result<Option<Vec<u8>>> {
    let output = run_git_output(repo, args)?;
    if output.status.success() {
        return Ok(Some(output.stdout));
    }
    if git_error_is_missing_head(&output.stderr) {
        return Ok(None);
    }
    Err(git_failure(repo.target, args, &output))
}

fn run_git_output(repo: Repo<'_>, args: &[&str]) -> Result<Output> {
    repo.target
        .output(repo.root, args)
        .with_context(|| format!("failed to run git {}", args.join(" ")))
}

fn git_error_is_missing_head(stderr: &[u8]) -> bool {
    let stderr = String::from_utf8_lossy(stderr);
    stderr.contains("Not a valid object name HEAD")
        || stderr.contains("ambiguous argument 'HEAD'")
        || stderr.contains("bad revision 'HEAD'")
}

fn git_failure(target: &GitTarget, args: &[&str], output: &Output) -> anyhow::Error {
    if let Some(reason) = target.unavailable_reason(output) {
        return anyhow!("{reason}");
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        anyhow!("git {} failed", args.join(" "))
    } else {
        anyhow!("git {} failed: {}", args.join(" "), stderr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_diff_path_validation_rejects_unsafe_paths() {
        assert_eq!(
            validate_workspace_relpath("src/lib.rs").unwrap(),
            "src/lib.rs"
        );
        assert!(validate_workspace_relpath("").is_err());
        assert!(validate_workspace_relpath("/tmp/file").is_err());
        assert!(validate_workspace_relpath("../file").is_err());
        assert!(validate_workspace_relpath("src/../file").is_err());
        assert!(validate_workspace_relpath("src\0file").is_err());
    }

    #[test]
    fn diff_text_to_hunks_records_line_numbers_and_newline_state() {
        let result = diff_text_to_hunks("file.txt", "one\ntwo\nthree", "one\nTWO\nthree", 1);

        assert_eq!(result.additions, 1);
        assert_eq!(result.deletions, 1);
        assert!(!result.truncated);
        assert_eq!(result.hunks.len(), 1);
        assert_eq!(result.hunks[0].lines[1].kind, "delete");
        assert_eq!(result.hunks[0].lines[1].old_lineno, Some(2));
        assert_eq!(result.hunks[0].lines[1].new_lineno, None);
        assert_eq!(result.hunks[0].lines[2].kind, "insert");
        assert_eq!(result.hunks[0].lines[2].old_lineno, None);
        assert_eq!(result.hunks[0].lines[2].new_lineno, Some(2));
        assert!(result.hunks[0].lines[2].has_trailing_newline);
        assert_eq!(result.hunks[0].lines[3].content, "three");
        assert!(!result.hunks[0].lines[3].has_trailing_newline);
    }

    #[test]
    fn diff_text_to_hunks_truncates_rendered_lines_and_long_line_content() {
        let long_line = format!("{}\n", "x".repeat(WORKSPACE_DIFF_MAX_LINE_CHARS + 1));
        let result = diff_text_to_hunks("long.txt", "", &long_line, 0);

        assert_eq!(result.additions, 1);
        assert!(result.truncated);
        assert_eq!(result.hunks.len(), 1);
        assert_eq!(result.hunks[0].lines.len(), 1);
        assert_eq!(
            result.hunks[0].lines[0].content.chars().count(),
            WORKSPACE_DIFF_MAX_LINE_CHARS
        );

        let many_lines = (0..=WORKSPACE_DIFF_MAX_LINES)
            .map(|line| format!("line-{line}\n"))
            .collect::<String>();
        let result = diff_text_to_hunks("many.txt", "", &many_lines, 0);

        assert_eq!(result.additions, (WORKSPACE_DIFF_MAX_LINES + 1) as u64);
        assert!(result.truncated);
        assert_eq!(
            result
                .hunks
                .iter()
                .map(|hunk| hunk.lines.len())
                .sum::<usize>(),
            WORKSPACE_DIFF_MAX_LINES
        );
    }

    #[test]
    fn diff_text_to_hunks_truncates_hunks() {
        let mut old_text = String::new();
        let mut new_text = String::new();
        for index in 0..=WORKSPACE_DIFF_MAX_HUNKS {
            old_text.push_str(&format!("same-{index}\nold-{index}\n"));
            new_text.push_str(&format!("same-{index}\nnew-{index}\n"));
        }

        let result = diff_text_to_hunks("hunks.txt", &old_text, &new_text, 0);

        assert_eq!(result.additions, (WORKSPACE_DIFF_MAX_HUNKS + 1) as u64);
        assert_eq!(result.deletions, (WORKSPACE_DIFF_MAX_HUNKS + 1) as u64);
        assert!(result.truncated);
        assert_eq!(result.hunks.len(), WORKSPACE_DIFF_MAX_HUNKS);
    }

    #[test]
    fn workspace_file_diff_returns_staged_unstaged_and_untracked_sections() {
        let root = temp_repo("workspace_diff_sections");
        git(&root, &["init"]);
        git(&root, &["config", "user.email", "test@example.com"]);
        git(&root, &["config", "user.name", "Test"]);
        std::fs::write(root.join("file.txt"), "one\ntwo\n").unwrap();
        std::fs::write(root.join("space [x].txt"), "old\n").unwrap();
        git(&root, &["add", "file.txt", "space [x].txt"]);
        git(&root, &["commit", "-m", "initial"]);

        std::fs::write(root.join("file.txt"), "one\nTWO\n").unwrap();
        git(&root, &["add", "file.txt"]);
        std::fs::write(root.join("file.txt"), "one\nTWO\nthree\n").unwrap();
        std::fs::write(root.join("new.txt"), "new\n").unwrap();

        let file_diff =
            workspace_file_diff(&target(&root), "file.txt", WorkspaceDiffStage::All, 0).unwrap();
        assert_eq!(file_diff.path, "file.txt");
        assert_eq!(file_diff.old_path, None);
        assert_eq!(file_diff.sections.len(), 2);
        assert_eq!(file_diff.sections[0].stage, "staged");
        assert_eq!(file_diff.sections[0].status, "modified");
        assert_eq!(file_diff.sections[0].additions, 1);
        assert_eq!(file_diff.sections[0].deletions, 1);
        assert_eq!(file_diff.sections[1].stage, "unstaged");
        assert_eq!(file_diff.sections[1].status, "modified");
        assert_eq!(file_diff.sections[1].additions, 1);
        assert_eq!(file_diff.sections[1].deletions, 0);

        let untracked =
            workspace_file_diff(&target(&root), "new.txt", WorkspaceDiffStage::All, 3).unwrap();
        assert_eq!(untracked.old_path, None);
        assert_eq!(untracked.sections.len(), 1);
        assert_eq!(untracked.sections[0].stage, "untracked");
        assert_eq!(untracked.sections[0].status, "untracked");
        assert_eq!(untracked.sections[0].additions, 1);
        assert_eq!(untracked.sections[0].deletions, 0);

        std::fs::write(root.join("space [x].txt"), "new\n").unwrap();
        let literal_path =
            workspace_file_diff(&target(&root), "space [x].txt", WorkspaceDiffStage::All, 3)
                .unwrap();
        assert_eq!(literal_path.old_path, None);
        assert_eq!(literal_path.sections.len(), 1);
        assert_eq!(literal_path.sections[0].stage, "unstaged");
        assert_eq!(literal_path.sections[0].additions, 1);
        assert_eq!(literal_path.sections[0].deletions, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_file_diff_marks_binary_and_too_large_without_hunks() {
        let root = temp_repo("workspace_diff_binary_large");
        git(&root, &["init"]);
        git(&root, &["config", "user.email", "test@example.com"]);
        git(&root, &["config", "user.name", "Test"]);
        std::fs::write(root.join("empty.txt"), "\n").unwrap();
        git(&root, &["add", "empty.txt"]);
        git(&root, &["commit", "-m", "initial"]);

        std::fs::write(root.join("binary.bin"), b"a\0b").unwrap();
        std::fs::write(
            root.join("large.txt"),
            vec![b'x'; (WORKSPACE_DIFF_MAX_FILE_BYTES as usize) + 1],
        )
        .unwrap();

        let binary =
            workspace_file_diff(&target(&root), "binary.bin", WorkspaceDiffStage::All, 3).unwrap();
        assert_eq!(binary.sections.len(), 1);
        assert!(binary.sections[0].binary);
        assert!(binary.sections[0].hunks.is_empty());

        let large =
            workspace_file_diff(&target(&root), "large.txt", WorkspaceDiffStage::All, 3).unwrap();
        assert_eq!(large.sections.len(), 1);
        assert!(large.sections[0].too_large);
        assert!(large.sections[0].hunks.is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_file_diff_handles_unborn_head_as_missing_optional_ref() {
        let root = temp_repo("workspace_diff_unborn_head");
        git(&root, &["init"]);
        std::fs::write(root.join("new.txt"), "new\n").unwrap();

        let diff =
            workspace_file_diff(&target(&root), "new.txt", WorkspaceDiffStage::All, 3).unwrap();

        assert_eq!(diff.old_path, None);
        assert_eq!(diff.sections.len(), 1);
        assert_eq!(diff.sections[0].stage, "untracked");
        assert_eq!(diff.sections[0].additions, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    fn temp_repo(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_core_{}_{}", label, unique));
        std::fs::create_dir_all(&root).expect("create temp repo");
        root
    }

    fn target(root: &Path) -> GitTarget {
        GitTarget::local(root)
    }

    fn git(cwd: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
