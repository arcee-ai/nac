use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command as StdCommand;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{sessions, store};

pub type NumstatPairs = HashMap<String, (Option<u64>, Option<u64>)>;
pub type NumstatSummary = (NumstatPairs, u64, u64);

const WORKSPACE_DIFF_MAX_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionSummarySnapshot {
    pub session_id: String,
    pub cwd: PathBuf,
    #[serde(skip)]
    pub workspace_host_path: Option<PathBuf>,
    pub model: String,
    pub backend: String,
    pub visible_message_count: usize,
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
    /// OpenSSH/freeform target the session runs on; `None` = local session.
    pub ssh_host: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreadSnapshot {
    pub name: String,
    pub session_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub episode_count: i64,
    pub latest_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EpisodeSnapshot {
    pub id: i64,
    pub thread_name: String,
    pub session_id: String,
    pub action: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorksetSummarySnapshot {
    pub id: String,
    pub status: String,
    pub summary: String,
    pub item_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorksetItemSnapshot {
    pub position: i64,
    pub title: String,
    pub scope: String,
    pub description: String,
    pub role: String,
    pub depends_on: Vec<String>,
    pub acceptance: String,
    pub notes: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorksetSnapshot {
    pub id: String,
    pub session_id: String,
    pub goal: String,
    pub status: String,
    pub summary: String,
    pub verification_recipe: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<WorksetItemSnapshot>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorksetsSnapshot {
    pub items: Vec<WorksetSnapshot>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitStatusCounts {
    pub modified: usize,
    pub staged: usize,
    pub untracked: usize,
    pub added: usize,
    pub deleted: usize,
    pub renamed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChangedFileStat {
    pub status: String,
    pub path: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceDiffTotals {
    pub total_additions: u64,
    pub total_deletions: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSnapshot {
    pub host_root: Option<PathBuf>,
    pub workspace_display: String,
    pub repo_label: Option<String>,
    pub branch: Option<String>,
    pub changed_files: Vec<ChangedFileStat>,
    pub total_additions: u64,
    pub total_deletions: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub sections: Vec<WorkspaceDiffSection>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
pub struct WorkspaceDiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub function_context: Option<String>,
    pub lines: Vec<WorkspaceDiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

impl From<sessions::SessionSummary> for SessionSummarySnapshot {
    fn from(summary: sessions::SessionSummary) -> Self {
        Self {
            session_id: summary.session_id,
            cwd: summary.cwd,
            workspace_host_path: summary.workspace_host_path,
            model: summary.model,
            backend: summary.backend.as_str().to_string(),
            visible_message_count: summary.visible_message_count,
            last_user_prompt: summary.last_user_prompt,
            sandboxed: summary.sandboxed,
            ssh_host: summary.ssh_host,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
        }
    }
}

impl From<store::ThreadRecord> for ThreadSnapshot {
    fn from(thread: store::ThreadRecord) -> Self {
        Self {
            name: thread.name,
            session_id: thread.session_id,
            created_at: thread.created_at,
            updated_at: thread.updated_at,
            episode_count: thread.episode_count,
            latest_action: thread.latest_action,
        }
    }
}

impl From<store::EpisodeRecord> for EpisodeSnapshot {
    fn from(episode: store::EpisodeRecord) -> Self {
        Self {
            id: episode.id,
            thread_name: episode.thread_name,
            session_id: episode.session_id,
            action: episode.action,
            content: episode.content,
            created_at: episode.created_at,
        }
    }
}

impl From<store::WorksetSummary> for WorksetSummarySnapshot {
    fn from(summary: store::WorksetSummary) -> Self {
        Self {
            id: summary.id,
            status: summary.status,
            summary: summary.summary,
            item_count: summary.item_count,
            updated_at: summary.updated_at,
        }
    }
}

impl From<store::WorksetItemRecord> for WorksetItemSnapshot {
    fn from(item: store::WorksetItemRecord) -> Self {
        Self {
            position: item.position,
            title: item.title,
            scope: item.scope,
            description: item.description,
            role: item.role,
            depends_on: item.depends_on,
            acceptance: item.acceptance,
            notes: item.notes,
            updated_at: item.updated_at,
        }
    }
}

impl From<store::WorksetRecord> for WorksetSnapshot {
    fn from(workset: store::WorksetRecord) -> Self {
        Self {
            id: workset.id,
            session_id: workset.session_id,
            goal: workset.goal,
            status: workset.status,
            summary: workset.summary,
            verification_recipe: workset.verification_recipe,
            created_at: workset.created_at,
            updated_at: workset.updated_at,
            items: workset.items.into_iter().map(Into::into).collect(),
        }
    }
}

pub fn list_sessions(store_path: &Path) -> Result<Vec<SessionSummarySnapshot>> {
    sessions::list_sessions(store_path)
        .map(|sessions| sessions.into_iter().map(Into::into).collect())
}

pub fn list_threads(store_path: &Path, session_id: Option<&str>) -> Result<Vec<ThreadSnapshot>> {
    let Some(session_id) = session_id else {
        return Ok(Vec::new());
    };
    store::list_threads(store_path, session_id)
        .map(|threads| threads.into_iter().map(Into::into).collect())
}

pub fn load_thread_episodes(
    store_path: &Path,
    session_id: Option<&str>,
    thread_name: &str,
) -> Result<Vec<EpisodeSnapshot>> {
    let Some(session_id) = session_id else {
        return Ok(Vec::new());
    };
    store::thread_read(store_path, session_id, thread_name)
        .map(|episodes| episodes.into_iter().map(Into::into).collect())
}

pub fn load_all_thread_episodes(
    store_path: &Path,
    session_id: Option<&str>,
) -> Result<HashMap<String, Vec<EpisodeSnapshot>>> {
    let Some(session_id) = session_id else {
        return Ok(HashMap::new());
    };
    let episodes = store::load_all_episodes(store_path, session_id)?;
    Ok(episodes
        .into_iter()
        .map(|(thread, episodes)| (thread, episodes.into_iter().map(Into::into).collect()))
        .collect())
}

pub fn list_worksets(
    store_path: &Path,
    session_id: Option<&str>,
) -> Result<Vec<WorksetSummarySnapshot>> {
    let Some(session_id) = session_id else {
        return Err(anyhow!("no active session"));
    };
    store::list_worksets(store_path, session_id)
        .map(|worksets| worksets.into_iter().map(Into::into).collect())
}

pub fn read_workset(
    store_path: &Path,
    session_id: Option<&str>,
    workset_id: &str,
) -> Result<Option<WorksetSnapshot>> {
    let Some(session_id) = session_id else {
        return Err(anyhow!("no active session"));
    };
    store::read_workset(store_path, session_id, workset_id).map(|workset| workset.map(Into::into))
}

pub fn worksets_snapshot(store_path: &Path, session_id: Option<&str>) -> WorksetsSnapshot {
    let Some(session_id) = session_id else {
        return WorksetsSnapshot {
            items: Vec::new(),
            error: Some("no active session".to_string()),
        };
    };

    match load_workset_records(store_path, session_id) {
        Ok(items) => WorksetsSnapshot { items, error: None },
        Err(error) => WorksetsSnapshot {
            items: Vec::new(),
            error: Some(error.to_string()),
        },
    }
}

fn load_workset_records(store_path: &Path, session_id: &str) -> Result<Vec<WorksetSnapshot>> {
    let summaries = store::list_worksets(store_path, session_id)?;
    let mut worksets = Vec::with_capacity(summaries.len());
    for summary in summaries {
        if let Some(workset) = store::read_workset(store_path, session_id, &summary.id)? {
            worksets.push(workset.into());
        }
    }
    Ok(worksets)
}

pub fn workspace_diff_totals(
    workspace_display: &str,
    host_root: Option<&Path>,
) -> WorkspaceDiffTotals {
    let Some(cwd) = host_root else {
        return WorkspaceDiffTotals {
            total_additions: 0,
            total_deletions: 0,
            error: Some(format!(
                "workspace '{}' is remote/sandbox-only; host-side inspection unavailable",
                workspace_display
            )),
        };
    };

    let Some(diff_raw) = run_git(cwd, &["diff", "--numstat"]) else {
        return WorkspaceDiffTotals {
            total_additions: 0,
            total_deletions: 0,
            error: Some("git diff unavailable".to_string()),
        };
    };
    let Some(cached_raw) = run_git(cwd, &["diff", "--cached", "--numstat"]) else {
        return WorkspaceDiffTotals {
            total_additions: 0,
            total_deletions: 0,
            error: Some("git cached diff unavailable".to_string()),
        };
    };

    let (_, total_additions, total_deletions) = parse_numstat_pairs(&diff_raw, &cached_raw);
    WorkspaceDiffTotals {
        total_additions,
        total_deletions,
        error: None,
    }
}

pub fn workspace_snapshot(workspace_display: &str, host_root: Option<&Path>) -> WorkspaceSnapshot {
    let Some(cwd) = host_root else {
        return WorkspaceSnapshot {
            host_root: None,
            workspace_display: workspace_display.to_string(),
            repo_label: None,
            branch: None,
            changed_files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
            error: Some(format!(
                "workspace '{}' is remote/sandbox-only; host-side inspection unavailable",
                workspace_display
            )),
        };
    };

    let root = run_git(cwd, &["rev-parse", "--show-toplevel"]).and_then(|path| {
        if path.is_empty() {
            None
        } else {
            Some(PathBuf::from(path))
        }
    });

    let branch = run_git(cwd, &["branch", "--show-current"]).filter(|value| !value.is_empty());
    let remote = run_git(cwd, &["config", "--get", "remote.origin.url"]);
    let repo_label = remote.as_deref().and_then(parse_remote_label).or_else(|| {
        root.as_ref()
            .and_then(|path| path.file_name())
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
    });

    let status_raw = match run_git(cwd, &["status", "--porcelain"]) {
        Some(value) => value,
        None => {
            return WorkspaceSnapshot {
                host_root: Some(cwd.to_path_buf()),
                workspace_display: workspace_display.to_string(),
                repo_label,
                branch,
                changed_files: Vec::new(),
                total_additions: 0,
                total_deletions: 0,
                error: Some("git status unavailable".to_string()),
            };
        }
    };

    let diff_raw = run_git(cwd, &["diff", "--numstat"]).unwrap_or_default();
    let cached_raw = run_git(cwd, &["diff", "--cached", "--numstat"]).unwrap_or_default();

    let (_, mut file_map) = parse_status_porcelain(&status_raw);
    let (diff_map, total_additions, total_deletions) = parse_numstat_pairs(&diff_raw, &cached_raw);
    for (path, (additions, deletions)) in diff_map {
        let entry = file_map
            .entry(path.clone())
            .or_insert_with(|| ChangedFileStat {
                status: "M".to_string(),
                path,
                additions: None,
                deletions: None,
            });
        if let Some(value) = additions {
            entry.additions = Some(entry.additions.unwrap_or(0).saturating_add(value));
        }
        if let Some(value) = deletions {
            entry.deletions = Some(entry.deletions.unwrap_or(0).saturating_add(value));
        }
    }

    let mut changed_files: Vec<ChangedFileStat> = file_map.into_values().collect();
    changed_files.sort_by(|left, right| {
        let left_delta = left
            .additions
            .unwrap_or(0)
            .saturating_add(left.deletions.unwrap_or(0));
        let right_delta = right
            .additions
            .unwrap_or(0)
            .saturating_add(right.deletions.unwrap_or(0));
        right_delta
            .cmp(&left_delta)
            .then_with(|| left.path.cmp(&right.path))
    });

    WorkspaceSnapshot {
        host_root: Some(cwd.to_path_buf()),
        workspace_display: workspace_display.to_string(),
        repo_label,
        branch,
        changed_files,
        total_additions,
        total_deletions,
        error: None,
    }
}

pub fn workspace_file_diff(
    host_root: &Path,
    path: &str,
    stage: WorkspaceDiffStage,
    context: usize,
) -> Result<WorkspaceFileDiff> {
    let relpath = validate_workspace_diff_path(path)?;
    let repo_root = resolve_git_root(host_root)?;
    let head_blob = git_head_blob(&repo_root, &relpath);
    let index_blob = git_index_blob(&repo_root, &relpath);
    let has_unstaged = git_path_list_contains_exact(
        &repo_root,
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
    );
    let is_untracked = git_path_list_contains_exact(
        &repo_root,
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
    );

    let mut sections = Vec::new();
    if matches!(stage, WorkspaceDiffStage::All | WorkspaceDiffStage::Staged)
        && blob_changed(head_blob.as_ref(), index_blob.as_ref())
    {
        sections.push(build_diff_section(
            &repo_root,
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
            &repo_root,
            &relpath,
            "unstaged",
            unstaged_status(index_blob.as_ref(), &repo_root, &relpath),
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
            &repo_root,
            &relpath,
            "untracked",
            "untracked",
            DiffSide::Empty,
            DiffSide::Worktree,
            context,
        ));
    }

    Ok(WorkspaceFileDiff {
        path: relpath.clone(),
        old_path: Some(relpath),
        sections,
        error: None,
    })
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

fn validate_workspace_diff_path(path: &str) -> Result<String> {
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

fn resolve_git_root(cwd: &Path) -> Result<PathBuf> {
    let raw = run_git_bytes(cwd, &["rev-parse", "--show-toplevel"])?;
    let path = String::from_utf8(raw)
        .map_err(|_| anyhow!("git repository path is not valid UTF-8"))?
        .trim()
        .to_string();
    if path.is_empty() {
        bail!("git repository not found");
    }
    PathBuf::from(path)
        .canonicalize()
        .with_context(|| "failed to resolve git repository root")
}

fn git_head_blob(repo_root: &Path, relpath: &str) -> Option<GitBlobRef> {
    let raw = run_git_bytes_optional(
        repo_root,
        &[
            "--literal-pathspecs",
            "ls-tree",
            "-z",
            "HEAD",
            "--",
            relpath,
        ],
    )?;
    parse_ls_tree_blob(&raw)
}

fn git_index_blob(repo_root: &Path, relpath: &str) -> Option<GitBlobRef> {
    let raw = run_git_bytes_optional(
        repo_root,
        &["--literal-pathspecs", "ls-files", "-z", "-s", "--", relpath],
    )?;
    parse_ls_files_stage0_blob(&raw)
}

fn parse_ls_tree_blob(raw: &[u8]) -> Option<GitBlobRef> {
    for record in nul_records(raw) {
        let (meta, _) = split_once_byte(record, b'\t')?;
        let meta = std::str::from_utf8(meta).ok()?;
        let mut parts = meta.split_whitespace();
        let mode = parts.next()?;
        let kind = parts.next()?;
        let oid = parts.next()?;
        if kind == "blob" {
            return Some(GitBlobRef {
                oid: oid.to_string(),
                mode: mode.to_string(),
            });
        }
    }
    None
}

fn parse_ls_files_stage0_blob(raw: &[u8]) -> Option<GitBlobRef> {
    for record in nul_records(raw) {
        let (meta, _) = split_once_byte(record, b'\t')?;
        let meta = std::str::from_utf8(meta).ok()?;
        let mut parts = meta.split_whitespace();
        let mode = parts.next()?;
        let oid = parts.next()?;
        let stage = parts.next()?;
        if stage == "0" {
            return Some(GitBlobRef {
                oid: oid.to_string(),
                mode: mode.to_string(),
            });
        }
    }
    None
}

fn nul_records(raw: &[u8]) -> impl Iterator<Item = &[u8]> {
    raw.split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
}

fn split_once_byte(bytes: &[u8], needle: u8) -> Option<(&[u8], &[u8])> {
    let index = bytes.iter().position(|byte| *byte == needle)?;
    Some((&bytes[..index], &bytes[index + 1..]))
}

fn git_path_list_contains_exact(repo_root: &Path, args: &[&str], relpath: &str) -> bool {
    let Some(raw) = run_git_bytes_optional(repo_root, args) else {
        return false;
    };
    let relpath = relpath.as_bytes();
    let contains = nul_records(&raw).any(|record| record == relpath);
    contains
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

fn unstaged_status(index: Option<&GitBlobRef>, repo_root: &Path, relpath: &str) -> &'static str {
    if index.is_none() {
        return "added";
    }
    match fs::symlink_metadata(repo_root.join(relpath)) {
        Ok(_) => "modified",
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "deleted",
        Err(_) => "modified",
    }
}

fn build_diff_section(
    repo_root: &Path,
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

    let old_bytes = match read_diff_side(repo_root, relpath, old_side) {
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
    let new_bytes = match read_diff_side(repo_root, relpath, new_side) {
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

    let (hunks, additions, deletions) = diff_text_to_hunks(relpath, &old_text, &new_text, context);
    section.hunks = hunks;
    section.additions = additions;
    section.deletions = deletions;
    section
}

fn read_diff_side(repo_root: &Path, relpath: &str, side: DiffSide) -> Result<LimitedBytes> {
    match side {
        DiffSide::Empty => Ok(LimitedBytes::Bytes(Vec::new())),
        DiffSide::Blob(blob) => read_git_blob(repo_root, &blob),
        DiffSide::Worktree => read_worktree_file(repo_root, relpath),
    }
}

fn read_git_blob(repo_root: &Path, blob: &GitBlobRef) -> Result<LimitedBytes> {
    let size_raw = run_git_bytes(repo_root, &["cat-file", "-s", &blob.oid])?;
    let size = String::from_utf8_lossy(&size_raw)
        .trim()
        .parse::<u64>()
        .with_context(|| format!("failed to parse git blob size for {}", blob.oid))?;
    if size > WORKSPACE_DIFF_MAX_FILE_BYTES {
        return Ok(LimitedBytes::TooLarge);
    }
    let bytes = run_git_bytes(repo_root, &["cat-file", "blob", &blob.oid])?;
    if bytes.len() as u64 > WORKSPACE_DIFF_MAX_FILE_BYTES {
        return Ok(LimitedBytes::TooLarge);
    }
    Ok(LimitedBytes::Bytes(bytes))
}

fn read_worktree_file(repo_root: &Path, relpath: &str) -> Result<LimitedBytes> {
    let path = repo_root.join(relpath);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LimitedBytes::Bytes(Vec::new()))
        }
        Err(error) => return Err(error).with_context(|| format!("failed to stat {}", relpath)),
    };

    if metadata.file_type().is_symlink() {
        let parent = path.parent().unwrap_or(repo_root);
        let resolved_parent = parent
            .canonicalize()
            .with_context(|| format!("failed to resolve parent for {}", relpath))?;
        if !resolved_parent.starts_with(repo_root) {
            bail!("invalid path: path escapes repository root");
        }
        let target = fs::read_link(&path)
            .with_context(|| format!("failed to read symlink target for {}", relpath))?;
        let bytes = target
            .as_os_str()
            .to_string_lossy()
            .into_owned()
            .into_bytes();
        if bytes.len() as u64 > WORKSPACE_DIFF_MAX_FILE_BYTES {
            return Ok(LimitedBytes::TooLarge);
        }
        return Ok(LimitedBytes::Bytes(bytes));
    }

    if !metadata.is_file() {
        bail!("path '{}' is not a regular file", relpath);
    }
    let resolved = path
        .canonicalize()
        .with_context(|| format!("failed to resolve {}", relpath))?;
    if !resolved.starts_with(repo_root) {
        bail!("invalid path: path escapes repository root");
    }
    if metadata.len() > WORKSPACE_DIFF_MAX_FILE_BYTES {
        return Ok(LimitedBytes::TooLarge);
    }
    let bytes = fs::read(&path).with_context(|| format!("failed to read {}", relpath))?;
    if bytes.len() as u64 > WORKSPACE_DIFF_MAX_FILE_BYTES {
        return Ok(LimitedBytes::TooLarge);
    }
    Ok(LimitedBytes::Bytes(bytes))
}

fn diff_text_to_hunks(
    relpath: &str,
    old_text: &str,
    new_text: &str,
    context: usize,
) -> (Vec<WorkspaceDiffHunk>, u64, u64) {
    let mut options = diffy::DiffOptions::new();
    options
        .set_context_len(context.min(100))
        .set_original_filename(format!("a/{relpath}"))
        .set_modified_filename(format!("b/{relpath}"));
    let patch = options.create_patch(old_text, new_text);
    let mut additions = 0u64;
    let mut deletions = 0u64;
    let mut hunks = Vec::new();

    for hunk in patch.hunks() {
        let old_range = hunk.old_range();
        let new_range = hunk.new_range();
        let mut old_lineno = old_range.start();
        let mut new_lineno = new_range.start();
        let mut lines = Vec::new();

        for line in hunk.lines() {
            match line {
                diffy::Line::Context(content) => {
                    let (content, has_trailing_newline) = diff_line_content(content);
                    lines.push(WorkspaceDiffLine {
                        kind: "context".to_string(),
                        old_lineno: Some(old_lineno),
                        new_lineno: Some(new_lineno),
                        content,
                        has_trailing_newline,
                    });
                    old_lineno += 1;
                    new_lineno += 1;
                }
                diffy::Line::Delete(content) => {
                    let (content, has_trailing_newline) = diff_line_content(content);
                    lines.push(WorkspaceDiffLine {
                        kind: "delete".to_string(),
                        old_lineno: Some(old_lineno),
                        new_lineno: None,
                        content,
                        has_trailing_newline,
                    });
                    deletions = deletions.saturating_add(1);
                    old_lineno += 1;
                }
                diffy::Line::Insert(content) => {
                    let (content, has_trailing_newline) = diff_line_content(content);
                    lines.push(WorkspaceDiffLine {
                        kind: "insert".to_string(),
                        old_lineno: None,
                        new_lineno: Some(new_lineno),
                        content,
                        has_trailing_newline,
                    });
                    additions = additions.saturating_add(1);
                    new_lineno += 1;
                }
            }
        }

        let function_context = hunk
            .function_context()
            .map(|content| diff_line_content(content).0);
        hunks.push(WorkspaceDiffHunk {
            old_start: old_range.start(),
            old_lines: old_range.len(),
            new_start: new_range.start(),
            new_lines: new_range.len(),
            function_context,
            lines,
        });
    }

    (hunks, additions, deletions)
}

fn diff_line_content(line: &str) -> (String, bool) {
    let has_trailing_newline = line.ends_with('\n');
    let content = if has_trailing_newline {
        &line[..line.len() - 1]
    } else {
        line
    };
    let content = content.strip_suffix('\r').unwrap_or(content);
    (content.to_string(), has_trailing_newline)
}

fn run_git_bytes(cwd: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            bail!("git {} failed", args.join(" "));
        }
        bail!("git {} failed: {}", args.join(" "), stderr);
    }
    Ok(output.stdout)
}

fn run_git_bytes_optional(cwd: &Path, args: &[&str]) -> Option<Vec<u8>> {
    run_git_bytes(cwd, args).ok()
}

fn run_git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string(),
    )
}

pub fn parse_remote_label(remote: &str) -> Option<String> {
    let trimmed = remote.trim().trim_end_matches(".git");
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace(':', "/");
    let without_scheme = normalized
        .split_once("://")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or(normalized);
    let parts: Vec<&str> = without_scheme
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() < 2 {
        return None;
    }

    Some(format!(
        "{}/{}",
        parts[parts.len() - 2],
        parts[parts.len() - 1]
    ))
}

pub fn parse_status_porcelain(raw: &str) -> (GitStatusCounts, HashMap<String, ChangedFileStat>) {
    let mut counts = GitStatusCounts::default();
    let mut file_map = HashMap::new();

    for line in raw.lines() {
        if line.len() < 3 {
            continue;
        }

        let status = &line[..2];
        let path = line[3..].trim();
        if path.is_empty() {
            continue;
        }

        let normalized_status = if status == "??" {
            counts.untracked += 1;
            "?".to_string()
        } else {
            let x = status.chars().next().unwrap_or(' ');
            let y = status.chars().nth(1).unwrap_or(' ');
            if x != ' ' {
                counts.staged += 1;
            }
            if status.contains('R') {
                counts.renamed += 1;
                "R".to_string()
            } else if status.contains('A') {
                counts.added += 1;
                "A".to_string()
            } else if status.contains('D') {
                counts.deleted += 1;
                "D".to_string()
            } else {
                if x != ' ' || y != ' ' {
                    counts.modified += 1;
                }
                "M".to_string()
            }
        };

        file_map.insert(
            path.to_string(),
            ChangedFileStat {
                status: normalized_status,
                path: path.to_string(),
                additions: None,
                deletions: None,
            },
        );
    }

    (counts, file_map)
}

pub fn parse_numstat_pairs(raw: &str, cached_raw: &str) -> NumstatSummary {
    let mut map = HashMap::new();
    let mut total_additions = 0u64;
    let mut total_deletions = 0u64;

    for source in [raw, cached_raw] {
        for line in source.lines() {
            let mut parts = line.splitn(3, '\t');
            let additions_raw = parts.next();
            let deletions_raw = parts.next();
            let path_raw = parts.next();
            let (Some(additions_raw), Some(deletions_raw), Some(path_raw)) =
                (additions_raw, deletions_raw, path_raw)
            else {
                continue;
            };

            let additions = additions_raw.parse::<u64>().ok();
            let deletions = deletions_raw.parse::<u64>().ok();
            let path = path_raw.to_string();

            if let Some(value) = additions {
                total_additions = total_additions.saturating_add(value);
            }
            if let Some(value) = deletions {
                total_deletions = total_deletions.saturating_add(value);
            }

            let entry = map.entry(path).or_insert((None, None));
            if let Some(value) = additions {
                entry.0 = Some(entry.0.unwrap_or(0u64).saturating_add(value));
            }
            if let Some(value) = deletions {
                entry.1 = Some(entry.1.unwrap_or(0u64).saturating_add(value));
            }
        }
    }

    (map, total_additions, total_deletions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_without_host_path_is_unavailable() {
        let snapshot = workspace_snapshot("/workspace/project", None);
        assert!(snapshot.error.is_some());
        assert_eq!(snapshot.host_root, None);
    }

    #[test]
    fn parse_remote_label_handles_ssh() {
        assert_eq!(
            parse_remote_label("git@github.com:sapiosaturn/nac.git").as_deref(),
            Some("sapiosaturn/nac")
        );
    }

    #[test]
    fn parse_status_porcelain_tracks_untracked_and_staged() {
        let raw = "M  crates/nac-tui/src/tui/mod.rs\nA  README.md\n?? notes.txt\n";
        let (counts, files) = parse_status_porcelain(raw);

        assert_eq!(counts.modified, 1);
        assert_eq!(counts.added, 1);
        assert_eq!(counts.untracked, 1);
        assert_eq!(counts.staged, 2);
        assert!(files.contains_key("notes.txt"));
    }

    #[test]
    fn workspace_diff_path_validation_rejects_unsafe_paths() {
        assert_eq!(
            validate_workspace_diff_path("src/lib.rs").unwrap(),
            "src/lib.rs"
        );
        assert!(validate_workspace_diff_path("").is_err());
        assert!(validate_workspace_diff_path("/tmp/file").is_err());
        assert!(validate_workspace_diff_path("../file").is_err());
        assert!(validate_workspace_diff_path("src/../file").is_err());
        assert!(validate_workspace_diff_path("src\0file").is_err());
    }

    #[test]
    fn diff_text_to_hunks_records_line_numbers_and_newline_state() {
        let (hunks, additions, deletions) =
            diff_text_to_hunks("file.txt", "one\ntwo\nthree", "one\nTWO\nthree", 1);

        assert_eq!(additions, 1);
        assert_eq!(deletions, 1);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines[1].kind, "delete");
        assert_eq!(hunks[0].lines[1].old_lineno, Some(2));
        assert_eq!(hunks[0].lines[1].new_lineno, None);
        assert_eq!(hunks[0].lines[2].kind, "insert");
        assert_eq!(hunks[0].lines[2].old_lineno, None);
        assert_eq!(hunks[0].lines[2].new_lineno, Some(2));
        assert!(hunks[0].lines[2].has_trailing_newline);
        assert_eq!(hunks[0].lines[3].content, "three");
        assert!(!hunks[0].lines[3].has_trailing_newline);
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

        let file_diff = workspace_file_diff(&root, "file.txt", WorkspaceDiffStage::All, 0).unwrap();
        assert_eq!(file_diff.path, "file.txt");
        assert_eq!(file_diff.sections.len(), 2);
        assert_eq!(file_diff.sections[0].stage, "staged");
        assert_eq!(file_diff.sections[0].status, "modified");
        assert_eq!(file_diff.sections[0].additions, 1);
        assert_eq!(file_diff.sections[0].deletions, 1);
        assert_eq!(file_diff.sections[1].stage, "unstaged");
        assert_eq!(file_diff.sections[1].status, "modified");
        assert_eq!(file_diff.sections[1].additions, 1);
        assert_eq!(file_diff.sections[1].deletions, 0);

        let untracked = workspace_file_diff(&root, "new.txt", WorkspaceDiffStage::All, 3).unwrap();
        assert_eq!(untracked.sections.len(), 1);
        assert_eq!(untracked.sections[0].stage, "untracked");
        assert_eq!(untracked.sections[0].status, "untracked");
        assert_eq!(untracked.sections[0].additions, 1);
        assert_eq!(untracked.sections[0].deletions, 0);

        std::fs::write(root.join("space [x].txt"), "new\n").unwrap();
        let literal_path =
            workspace_file_diff(&root, "space [x].txt", WorkspaceDiffStage::All, 3).unwrap();
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

        let binary = workspace_file_diff(&root, "binary.bin", WorkspaceDiffStage::All, 3).unwrap();
        assert_eq!(binary.sections.len(), 1);
        assert!(binary.sections[0].binary);
        assert!(binary.sections[0].hunks.is_empty());

        let large = workspace_file_diff(&root, "large.txt", WorkspaceDiffStage::All, 3).unwrap();
        assert_eq!(large.sections.len(), 1);
        assert!(large.sections[0].too_large);
        assert!(large.sections[0].hunks.is_empty());

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

    fn git(cwd: &Path, args: &[&str]) {
        let output = StdCommand::new("git")
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
