//! Browsing the session's checkout: which files the project has, and what is
//! inside one of them.
//!
//! The listing comes from git rather than a directory walk, so it inherits
//! `.gitignore` for free and never wanders into `target/` or `node_modules/`.
//! Contents are read from the working tree, because that is the state the agent
//! is acting on; the committed side is the diff viewer's job.

use std::fs;
use std::io;
use std::path::Path;
use std::process::Command as StdCommand;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::workspace_diff::{resolve_git_root, validate_workspace_relpath};

/// Enough for any repository a person browses by hand; past this the tree is
/// unusable as a list anyway.
const MAX_LISTED_FILES: usize = 20_000;
/// Matches the diff viewer's ceiling, for the same reason: the browser has to
/// lay every line out.
const MAX_FILE_BYTES: u64 = 512 * 1024;
/// A NUL this early means no text editor would show the file either.
const BINARY_SNIFF_BYTES: usize = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceFileList {
    pub files: Vec<String>,
    /// The repository has more files than were returned.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
pub fn list_files(host_root: &Path) -> Result<WorkspaceFileList> {
    let raw = run_git(
        host_root,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--full-name",
        ],
    )?;

    let mut files: Vec<String> = raw
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| String::from_utf8_lossy(record).into_owned())
        .collect();
    files.sort();
    files.dedup();

    let truncated = files.len() > MAX_LISTED_FILES;
    files.truncate(MAX_LISTED_FILES);

    Ok(WorkspaceFileList { files, truncated })
}

/// Working-tree contents of one file, refusing anything that is not plain text
/// small enough to render.
pub fn read_file(host_root: &Path, path: &str) -> Result<WorkspaceFileContent> {
    let relpath = validate_workspace_relpath(path)?;
    let repo_root = resolve_git_root(host_root)?;
    let full = repo_root.join(&relpath);

    // symlink_metadata does not follow links, so a link pointing outside the
    // repository is reported as what it is and never read through.
    let metadata = match fs::symlink_metadata(&full) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            bail!("file not found: '{}'", relpath)
        }
        Err(error) => return Err(error).with_context(|| format!("cannot stat '{}'", relpath)),
    };
    if !metadata.is_file() {
        bail!("invalid path: '{}' is not a regular file", relpath);
    }

    let size = metadata.len();
    if size > MAX_FILE_BYTES {
        return Ok(WorkspaceFileContent {
            path: relpath,
            content: None,
            size,
            binary: false,
            too_large: true,
        });
    }

    let bytes = fs::read(&full).with_context(|| format!("cannot read '{}'", relpath))?;
    let binary = bytes
        .iter()
        .take(BINARY_SNIFF_BYTES)
        .any(|byte| *byte == 0);
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

fn run_git(cwd: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| anyhow!("could not run git: {}", error))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "git {} failed: {}",
            args[0],
            stderr.lines().next().unwrap_or("git reported no details")
        );
    }
    Ok(output.stdout)
}
