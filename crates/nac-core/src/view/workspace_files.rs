//! Browsing the session's checkout: which files the project has, and what is
//! inside one of them.
//!
//! The listing comes from git rather than a directory walk, so it inherits
//! `.gitignore` for free and never wanders into `target/` or `node_modules/`.
//! Contents are read from the working tree, because that is the state the agent
//! is acting on; the committed side is the diff viewer's job.
//!
//! Each function has a twin that answers the same question about a captured
//! revision instead of the working tree. Those read from a git tree, so they
//! see a checkout frozen at the end of some earlier run, and they never touch
//! the disk at all.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::workspace_diff::validate_workspace_relpath;
use crate::workspace::{first_stderr_line, GitTarget, WorktreeRead};

/// Enough for any repository a person browses by hand; past this the tree is
/// unusable as a list anyway.
const MAX_LISTED_FILES: usize = 20_000;
/// Matches the diff viewer's ceiling, for the same reason: the browser has to
/// lay every line out.
const MAX_FILE_BYTES: u64 = 512 * 1024;
/// A NUL this early means no text editor would show the file either.
const BINARY_SNIFF_BYTES: usize = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceFileList {
    pub files: Vec<String>,
    /// The repository has more files than were returned.
    pub truncated: bool,
    /// Origin of these repository-relative identities, when locally available.
    /// A missing legacy/remote/revision context cannot authorize Finder reveal.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(value_type = Option<String>))]
    pub path_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceFileContent {
    pub path: String,
    /// None whenever the file cannot be shown as text.
    pub content: Option<String>,
    pub size: u64,
    pub binary: bool,
    pub too_large: bool,
}

/// Every file git considers part of the project, tracked or not, ignoring the
/// ones it is told to ignore. Paths are relative to the repository root, which
/// is what `git status --porcelain` reports too, so the two line up.
pub fn list_files(target: &GitTarget) -> Result<WorkspaceFileList> {
    let path_root = target
        .local_path()
        .map(|_| target.repo_root())
        .transpose()?;
    let git_dir = if let Some(root) = &path_root {
        Some(
            String::from_utf8(run_git(
                target,
                root,
                "rev-parse",
                &["rev-parse", "--absolute-git-dir"],
            )?)
            .context("git directory is not valid UTF-8")?,
        )
    } else {
        None
    };
    let mut args = Vec::new();
    if let (Some(root), Some(directory)) = (&path_root, &git_dir) {
        // One LF frames Git's record. Every preceding byte is literal path data.
        let directory = directory.strip_suffix('\n').unwrap_or(directory);
        if !root.is_absolute() || !Path::new(directory).is_absolute() {
            bail!("Git file coordinates require absolute roots");
        }
        args.extend([
            "--git-dir",
            directory,
            "--work-tree",
            root.to_str()
                .context("Git worktree root is not valid UTF-8")?,
        ]);
    }
    // Keep the selected cwd and its listing scope. Explicit Git/worktree roots
    // prevent a metadata disappearance or nested repository from changing the
    // coordinate basis between discovery and this command.
    args.extend([
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--full-name",
    ]);
    let raw = run_git(target, target.root(), "ls-files", &args)?;

    let mut files: Vec<String> = raw
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| String::from_utf8_lossy(record).into_owned())
        .collect();
    files.sort();
    files.dedup();

    let truncated = files.len() > MAX_LISTED_FILES;
    files.truncate(MAX_LISTED_FILES);

    Ok(WorkspaceFileList {
        files,
        truncated,
        path_root,
    })
}

/// Working-tree contents of one file, refusing anything that is not plain text
/// small enough to render.
pub fn read_file(target: &GitTarget, path: &str) -> Result<WorkspaceFileContent> {
    let relpath = validate_workspace_relpath(path)?;
    let repo_root = target.repo_root()?;

    // A symlink is reported as what it is and never read through, so a link
    // pointing outside the repository cannot serve its contents from here.
    let bytes = match target.read_worktree(&repo_root, &relpath, MAX_FILE_BYTES)? {
        WorktreeRead::Missing => bail!("file not found: '{relpath}'"),
        WorktreeRead::NotRegular | WorktreeRead::Symlink { .. } => {
            bail!("invalid path: '{relpath}' is not a regular file")
        }
        // Reaching a file through a symlinked directory lands outside the
        // repository just as following a link would, and is refused for the
        // same reason: what is served here has to belong to the workspace.
        WorktreeRead::Regular { escapes: true, .. } => {
            bail!("invalid path: path escapes repository root")
        }
        WorktreeRead::Regular {
            size, bytes: None, ..
        } => {
            return Ok(WorkspaceFileContent {
                path: relpath,
                content: None,
                size,
                binary: false,
                too_large: true,
            })
        }
        WorktreeRead::Regular {
            bytes: Some(bytes), ..
        } => bytes,
    };

    let size = bytes.len() as u64;
    let binary = bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0);
    let content = if binary {
        None
    } else {
        match String::from_utf8(bytes) {
            Ok(text) => Some(text),
            Err(_) => {
                return Ok(WorkspaceFileContent {
                    path: relpath,
                    content: None,
                    size,
                    binary: true,
                    too_large: false,
                })
            }
        }
    };

    Ok(WorkspaceFileContent {
        path: relpath,
        content,
        size,
        binary,
        too_large: false,
    })
}

/// The same listing as [`list_files`], as it stood in a captured revision.
pub fn list_revision_files(target: &GitTarget, commit: &str) -> Result<WorkspaceFileList> {
    let repo_root = target.repo_root()?;
    let raw = run_git(
        target,
        &repo_root,
        "ls-tree",
        &["ls-tree", "-r", "-z", "--full-tree", commit],
    )?;

    let mut files: Vec<String> = raw
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .filter_map(parse_tree_blob_path)
        .collect();
    files.sort();
    files.dedup();

    let truncated = files.len() > MAX_LISTED_FILES;
    files.truncate(MAX_LISTED_FILES);

    Ok(WorkspaceFileList {
        files,
        truncated,
        path_root: None,
    })
}

/// Contents of one file as of a captured revision.
pub fn read_revision_file(
    target: &GitTarget,
    commit: &str,
    path: &str,
) -> Result<WorkspaceFileContent> {
    let relpath = validate_workspace_relpath(path)?;
    let repo_root = target.repo_root()?;
    // A path can never be mistaken for an option here: it is glued behind
    // "<commit>:" and reaches git as a single argument, never a shell word.
    let object = format!("{commit}:{relpath}");

    let Some(kind) = run_git_optional(target, &repo_root, &["cat-file", "-t", &object])? else {
        bail!("file not found: '{relpath}'");
    };
    if String::from_utf8_lossy(&kind).trim() != "blob" {
        bail!("invalid path: '{relpath}' is not a regular file");
    }

    let size = String::from_utf8_lossy(&run_git(
        target,
        &repo_root,
        "cat-file",
        &["cat-file", "-s", &object],
    )?)
    .trim()
    .parse::<u64>()
    .with_context(|| format!("cannot measure '{relpath}'"))?;
    if size > MAX_FILE_BYTES {
        return Ok(WorkspaceFileContent {
            path: relpath,
            content: None,
            size,
            binary: false,
            too_large: true,
        });
    }

    let bytes = run_git(
        target,
        &repo_root,
        "cat-file",
        &["cat-file", "blob", &object],
    )?;
    let binary = bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0);
    let content = if binary {
        None
    } else {
        String::from_utf8(bytes).ok()
    };

    Ok(WorkspaceFileContent {
        path: relpath,
        binary: content.is_none(),
        content,
        size,
        too_large: false,
    })
}

/// `ls-tree` records look like `<mode> SP <type> SP <oid> TAB <path>`. Anything
/// that is not a blob — a submodule, most often — is dropped, because there is
/// nothing to open behind it.
fn parse_tree_blob_path(record: &[u8]) -> Option<String> {
    let tab = record.iter().position(|byte| *byte == b'\t')?;
    let meta = std::str::from_utf8(&record[..tab]).ok()?;
    if meta.split_whitespace().nth(1)? != "blob" {
        return None;
    }
    Some(String::from_utf8_lossy(&record[tab + 1..]).into_owned())
}

fn run_git(target: &GitTarget, cwd: &Path, operation: &str, args: &[&str]) -> Result<Vec<u8>> {
    let output = target.output(cwd, args)?;
    if !output.status.success() {
        if let Some(reason) = target.unavailable_reason(&output) {
            bail!("{reason}");
        }
        bail!(
            "git {} failed: {}",
            operation,
            first_stderr_line(&output.stderr)
        );
    }
    Ok(output.stdout)
}

/// None when git refused, which for an object lookup means "no such object"
/// rather than a real failure. A connection that never reached git is a real
/// failure, so it is reported rather than read as a missing object.
fn run_git_optional(target: &GitTarget, cwd: &Path, args: &[&str]) -> Result<Option<Vec<u8>>> {
    let output = target.output(cwd, args)?;
    if !output.status.success() {
        if let Some(reason) = target.unavailable_reason(&output) {
            bail!("{reason}");
        }
        return Ok(None);
    }
    Ok(Some(output.stdout))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct OpenLocalPathResult {
    /// Absolute path handed to the OS opener.
    pub opened: String,
    /// True when the requested file was missing and its parent was opened.
    pub fell_back_to_parent: bool,
}

fn path_inside_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

/// Resolve `relpath` under a local workspace root and open it with the OS.
///
/// Missing files open the nearest existing parent directory still inside the
/// workspace, so chat links keep working after a model names a path it has not
/// written yet.
pub fn open_local_path(root: &Path, relpath: &str) -> Result<OpenLocalPathResult> {
    let rel = validate_workspace_relpath(relpath)?;
    let root = root
        .canonicalize()
        .with_context(|| format!("failed to resolve workspace root '{}'", root.display()))?;
    let requested = root.join(&rel);

    if requested.exists() {
        return open_resolved(&requested, &root, false);
    }

    let mut parent = requested.parent().map(Path::to_path_buf);
    while let Some(candidate) = parent {
        if !path_inside_root(&candidate, &root) {
            break;
        }
        if candidate.exists() {
            return open_resolved(&candidate, &root, true);
        }
        parent = candidate.parent().map(Path::to_path_buf);
    }
    bail!("file not found: '{rel}'");
}

fn open_resolved(
    target: &Path,
    root: &Path,
    fell_back_to_parent: bool,
) -> Result<OpenLocalPathResult> {
    let canonical = target
        .canonicalize()
        .with_context(|| format!("failed to resolve '{}'", target.display()))?;
    if !path_inside_root(&canonical, root) {
        bail!("invalid path: path escapes repository root");
    }
    crate::browser::open_path(&canonical)?;
    Ok(OpenLocalPathResult {
        opened: canonical.display().to_string(),
        fell_back_to_parent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_listing_binds_literal_coordinates_without_widening_selected_scope() {
        for suffix in [" ", "\t", "\r", "\n"] {
            let parent =
                std::env::temp_dir().join(format!("nac-files-origin-{}", uuid::Uuid::new_v4()));
            let repo = parent.join(format!("repo 日本語{suffix}"));
            let selected = repo.join("packages/app");
            std::fs::create_dir_all(&selected).unwrap();
            std::fs::write(selected.join("file.txt"), "selected").unwrap();
            std::fs::write(repo.join("outside.txt"), "outside selected scope").unwrap();
            std::fs::write(repo.join(".gitignore"), "ignored.txt\n").unwrap();
            std::fs::write(selected.join("ignored.txt"), "ignored").unwrap();
            assert!(std::process::Command::new("git")
                .args(["init", "--quiet"])
                .arg(&repo)
                .status()
                .unwrap()
                .success());
            let listing = list_files(&GitTarget::local(selected)).unwrap();
            assert_eq!(listing.path_root, Some(repo.canonicalize().unwrap()));
            assert_eq!(listing.files, ["packages/app/file.txt"]);
            assert!(!listing.truncated);
            std::fs::remove_dir_all(parent).unwrap();
        }
    }

    #[test]
    fn legacy_listing_has_no_invented_coordinate_origin() {
        let listing: WorkspaceFileList =
            serde_json::from_str(r#"{"files":["file"],"truncated":false}"#).unwrap();
        assert_eq!(listing.path_root, None);
    }
}
