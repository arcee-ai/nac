use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::workspace::GitTarget;
use crate::{sessions, store};

pub use store::WorkspaceRevisionRecord;

mod workspace_diff;
mod workspace_files;

pub use workspace_diff::{
    revision_file_diff, validate_workspace_relpath, workspace_file_diff, WorkspaceDiffHunk,
    WorkspaceDiffLine, WorkspaceDiffSection, WorkspaceDiffStage, WorkspaceFileDiff,
};
pub use workspace_files::{
    list_files, list_revision_files, open_local_path, read_file, read_revision_file,
    OpenLocalPathResult, WorkspaceFileContent, WorkspaceFileList,
};

pub type NumstatPairs = HashMap<String, (Option<u64>, Option<u64>)>;
pub type NumstatSummary = (NumstatPairs, u64, u64);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionSummarySnapshot {
    pub session_id: String,
    #[serde(default)]
    pub behavior: sessions::SessionBehavior,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub cwd: PathBuf,
    #[serde(skip)]
    #[cfg_attr(feature = "openapi", schema(ignore))]
    pub workspace_host_path: Option<PathBuf>,
    pub model: String,
    pub backend: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_config_error: Option<String>,
    pub visible_message_count: usize,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
    /// OpenSSH/freeform target the session runs on; `None` = local session.
    #[cfg_attr(feature = "openapi", schema(required))]
    pub ssh_host: Option<String>,
    /// Port and key the session was created with, so anything rebuilding the
    /// connection reaches the same machine the same way. Omitted when the
    /// session leaves them to ssh, which is what older snapshots always did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_identity_file: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(required))]
    pub title: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub presentation_version: i64,
    pub created_at: String,
    pub updated_at: String,
    /// Billable tokens accumulated over the session. Omitted when unknown, so
    /// older stored snapshots keep deserializing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    /// Micro-USD spend for the session. Omitted when no usage was recorded;
    /// zero means the catalog had no rates for the model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_cost_micros: Option<u64>,
    /// Runs ever started in this session. Older stored snapshots default to 0.
    #[serde(default)]
    pub run_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ThreadSnapshot {
    pub name: String,
    pub session_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub episode_count: i64,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub latest_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct EpisodeSnapshot {
    pub id: i64,
    pub thread_name: String,
    pub session_id: String,
    pub action: String,
    pub content: String,
    /// `ok` for a retained handoff, otherwise how the dispatch died. Snapshots
    /// written before dispatch outcomes were recorded only held handoffs.
    #[serde(default = "retained_episode_status")]
    #[cfg_attr(
        feature = "openapi",
        schema(required, value_type = store::EpisodeStatus)
    )]
    pub status: String,
    pub created_at: String,
}

fn retained_episode_status() -> String {
    store::EpisodeStatus::Ok.as_str().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorksetSummarySnapshot {
    pub id: String,
    pub status: String,
    pub summary: String,
    pub item_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorksetsSnapshot {
    pub items: Vec<WorksetSnapshot>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GitStatusCounts {
    pub modified: usize,
    pub staged: usize,
    pub untracked: usize,
    pub added: usize,
    pub deleted: usize,
    pub renamed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ChangedFileStat {
    pub status: String,
    pub path: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceDiffTotals {
    pub total_additions: u64,
    pub total_deletions: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceRevisionChanges {
    pub changed_files: Vec<ChangedFileStat>,
    pub total_additions: u64,
    pub total_deletions: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceSnapshot {
    #[cfg_attr(feature = "openapi", schema(value_type = Option<String>))]
    pub host_root: Option<PathBuf>,
    pub workspace_display: String,
    pub repo_label: Option<String>,
    pub branch: Option<String>,
    pub changed_files: Vec<ChangedFileStat>,
    pub total_additions: u64,
    pub total_deletions: u64,
    pub error: Option<String>,
}

impl From<sessions::SessionSummary> for SessionSummarySnapshot {
    fn from(summary: sessions::SessionSummary) -> Self {
        Self {
            session_id: summary.session_id,
            behavior: summary.behavior,
            project_id: summary.project_id,
            cwd: summary.cwd,
            workspace_host_path: summary.workspace_host_path,
            model: summary.model,
            backend: summary.backend,
            model_config_error: summary.model_config_error,
            visible_message_count: summary.visible_message_count,
            last_user_prompt: summary.last_user_prompt,
            sandboxed: summary.sandboxed,
            ssh_host: summary
                .ssh
                .as_ref()
                .map(|connection| connection.host.clone()),
            ssh_port: summary.ssh.as_ref().and_then(|connection| connection.port),
            ssh_identity_file: summary.ssh.as_ref().and_then(|connection| {
                connection
                    .identity_file
                    .as_ref()
                    .map(|path| path.display().to_string())
            }),
            title: summary.title,
            pinned: summary.pinned,
            sort_order: summary.sort_order,
            presentation_version: summary.presentation_version,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
            total_tokens: summary.total_tokens,
            total_cost_micros: summary.total_cost_micros,
            run_count: summary.run_count,
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
            status: episode.status,
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

pub(crate) fn list_sessions_with_connection(
    conn: &rusqlite::Connection,
) -> Result<Vec<SessionSummarySnapshot>> {
    sessions::list_sessions_with_connection(conn)
        .map(|sessions| sessions.into_iter().map(Into::into).collect())
}

pub fn delete_session(store_path: &Path, session_id: &str) -> Result<bool> {
    sessions::delete_session(store_path, session_id)
}

/// Captured states of a session's checkout, newest first.
pub fn list_workspace_revisions(
    store_path: &Path,
    session_id: &str,
) -> Result<Vec<WorkspaceRevisionRecord>> {
    store::list_workspace_revisions(store_path, session_id)
}

pub fn read_workspace_revision(
    store_path: &Path,
    session_id: &str,
    id: i64,
) -> Result<Option<WorkspaceRevisionRecord>> {
    store::read_workspace_revision(store_path, session_id, id)
}

pub fn list_threads(store_path: &Path, session_id: Option<&str>) -> Result<Vec<ThreadSnapshot>> {
    let Some(session_id) = session_id else {
        return Ok(Vec::new());
    };
    store::list_threads(store_path, session_id)
        .map(|threads| threads.into_iter().map(Into::into).collect())
}

pub(crate) fn list_threads_with_connection(
    conn: &rusqlite::Connection,
    session_id: Option<&str>,
) -> Result<Vec<ThreadSnapshot>> {
    let Some(session_id) = session_id else {
        return Ok(Vec::new());
    };
    store::list_threads_with_connection(conn, session_id)
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
    store::thread_dispatches(store_path, session_id, thread_name)
        .map(|episodes| episodes.into_iter().map(Into::into).collect())
}

pub fn load_all_thread_episodes(
    store_path: &Path,
    session_id: Option<&str>,
) -> Result<HashMap<String, Vec<EpisodeSnapshot>>> {
    let Some(session_id) = session_id else {
        return Ok(HashMap::new());
    };
    let episodes = store::load_all_dispatches(store_path, session_id)?;
    Ok(episodes
        .into_iter()
        .map(|(thread, episodes)| (thread, episodes.into_iter().map(Into::into).collect()))
        .collect())
}

pub(crate) fn load_all_thread_episodes_with_connection(
    conn: &rusqlite::Connection,
    session_id: Option<&str>,
) -> Result<HashMap<String, Vec<EpisodeSnapshot>>> {
    let Some(session_id) = session_id else {
        return Ok(HashMap::new());
    };
    let episodes = store::load_all_dispatches_with_connection(conn, session_id)?;
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

pub(crate) fn worksets_snapshot_with_connection(
    conn: &rusqlite::Connection,
    session_id: Option<&str>,
) -> WorksetsSnapshot {
    let Some(session_id) = session_id else {
        return WorksetsSnapshot {
            items: Vec::new(),
            error: Some("no active session".to_string()),
        };
    };

    match load_workset_records_with_connection(conn, session_id) {
        Ok(items) => WorksetsSnapshot { items, error: None },
        Err(error) => WorksetsSnapshot {
            items: Vec::new(),
            error: Some(error.to_string()),
        },
    }
}

fn load_workset_records(store_path: &Path, session_id: &str) -> Result<Vec<WorksetSnapshot>> {
    let conn = store::open_runtime_connection(store_path)?;
    load_workset_records_with_connection(&conn, session_id)
}

fn load_workset_records_with_connection(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<WorksetSnapshot>> {
    let summaries = store::list_worksets_with_connection(conn, session_id)?;
    let mut worksets = Vec::with_capacity(summaries.len());
    for summary in summaries {
        if let Some(workset) = store::read_workset_with_connection(conn, session_id, &summary.id)? {
            worksets.push(workset.into());
        }
    }
    Ok(worksets)
}

pub fn workspace_diff_totals(
    workspace_display: &str,
    target: Option<&GitTarget>,
) -> WorkspaceDiffTotals {
    let Some(target) = target else {
        return WorkspaceDiffTotals {
            total_additions: 0,
            total_deletions: 0,
            error: Some(unreachable_workspace_message(workspace_display)),
        };
    };

    let Some(diff_raw) = run_git(target, &["diff", "--numstat"]) else {
        return WorkspaceDiffTotals {
            total_additions: 0,
            total_deletions: 0,
            error: Some("git diff unavailable".to_string()),
        };
    };
    let Some(cached_raw) = run_git(target, &["diff", "--cached", "--numstat"]) else {
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

pub fn workspace_snapshot(
    workspace_display: &str,
    target: Option<&GitTarget>,
) -> WorkspaceSnapshot {
    let Some(target) = target else {
        return WorkspaceSnapshot {
            host_root: None,
            workspace_display: workspace_display.to_string(),
            repo_label: None,
            branch: None,
            changed_files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
            error: Some(unreachable_workspace_message(workspace_display)),
        };
    };

    let root = run_git(target, &["rev-parse", "--show-toplevel"]).and_then(|path| {
        if path.is_empty() {
            None
        } else {
            Some(PathBuf::from(path))
        }
    });

    let branch = run_git(target, &["branch", "--show-current"]).filter(|value| !value.is_empty());
    let remote = run_git(target, &["config", "--get", "remote.origin.url"]);
    let repo_label = remote.as_deref().and_then(parse_remote_label).or_else(|| {
        root.as_ref()
            .and_then(|path| path.file_name())
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
    });

    let status_raw = match run_git(target, &["status", "--porcelain"]) {
        Some(value) => value,
        None => {
            return WorkspaceSnapshot {
                host_root: Some(target.root().to_path_buf()),
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

    let diff_raw = run_git(target, &["diff", "--numstat"]).unwrap_or_default();
    let cached_raw = run_git(target, &["diff", "--cached", "--numstat"]).unwrap_or_default();

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
        host_root: Some(target.root().to_path_buf()),
        workspace_display: workspace_display.to_string(),
        repo_label,
        branch,
        changed_files,
        total_additions,
        total_deletions,
        error: None,
    }
}

/// Why a session has no checkout nac can look at. The only case left is a
/// sandbox whose working directory is not mounted from the host: its files live
/// inside a container that `podman run --rm` takes away with the session, so
/// there is nothing durable to inspect or restore.
fn unreachable_workspace_message(workspace_display: &str) -> String {
    format!(
        "workspace '{}' lives only inside the sandbox; mount a working directory to inspect it",
        workspace_display
    )
}

/// Which files a captured revision changed, in the same shape the live
/// workspace reports, so the panel can render either without knowing which it
/// is looking at.
pub fn revision_changes(
    target: &GitTarget,
    base: Option<&str>,
    commit: &str,
) -> WorkspaceRevisionChanges {
    // Without a baseline there is nothing to compare against. This only happens
    // for the first revision of a repository that had no commits at the time.
    let Some(base) = base else {
        return WorkspaceRevisionChanges::default();
    };

    let Some(status_raw) = run_git(target, &["diff", "--name-status", base, commit]) else {
        return WorkspaceRevisionChanges {
            error: Some("git diff unavailable".to_string()),
            ..WorkspaceRevisionChanges::default()
        };
    };
    let numstat_raw = run_git(target, &["diff", "--numstat", base, commit]).unwrap_or_default();

    let mut file_map = parse_name_status(&status_raw);
    let (diff_map, total_additions, total_deletions) = parse_numstat_pairs(&numstat_raw, "");
    for (path, (additions, deletions)) in diff_map {
        let entry = file_map
            .entry(path.clone())
            .or_insert_with(|| ChangedFileStat {
                status: "M".to_string(),
                path,
                additions: None,
                deletions: None,
            });
        entry.additions = additions;
        entry.deletions = deletions;
    }

    let mut changed_files: Vec<ChangedFileStat> = file_map.into_values().collect();
    changed_files.sort_by(|left, right| left.path.cmp(&right.path));

    WorkspaceRevisionChanges {
        changed_files,
        total_additions,
        total_deletions,
        error: None,
    }
}

/// `diff --name-status` lines are `<letter>[score] TAB <path>`, and for a rename
/// or copy a second tab-separated path follows, which is the one that exists
/// afterwards and therefore the one worth showing.
fn parse_name_status(raw: &str) -> HashMap<String, ChangedFileStat> {
    let mut file_map = HashMap::new();
    for line in raw.lines() {
        let mut columns = line.split('\t');
        let Some(code) = columns.next().map(str::trim) else {
            continue;
        };
        let Some(first) = columns.next() else {
            continue;
        };
        let path = columns.next().unwrap_or(first).trim().to_string();
        if path.is_empty() {
            continue;
        }

        let status = match code.chars().next() {
            Some('A') => "A",
            Some('D') => "D",
            Some('R') | Some('C') => "R",
            _ => "M",
        };
        file_map.insert(
            path.clone(),
            ChangedFileStat {
                status: status.to_string(),
                path,
                additions: None,
                deletions: None,
            },
        );
    }
    file_map
}

fn run_git(target: &GitTarget, args: &[&str]) -> Option<String> {
    let output = target.output(target.root(), args).ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string(),
    )
}

/// `owner/repo` for a local checkout, taken from its origin remote.
///
/// Returns `None` when the directory is not a git repository or has no origin,
/// which lets callers fall back to naming a location after its folder.
pub fn local_repo_label(cwd: &Path) -> Option<String> {
    let target = GitTarget::local(cwd);
    run_git(&target, &["config", "--get", "remote.origin.url"])
        .as_deref()
        .and_then(parse_remote_label)
}

pub fn parse_remote_label(remote: &str) -> Option<String> {
    let trimmed = remote.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(url) = Url::parse(trimmed) {
        return owner_repo_from_path(url.path());
    }
    owner_repo_from_scp(trimmed)
}

/// `user@host:path` / `host:path` without a URL scheme.
fn owner_repo_from_scp(remote: &str) -> Option<String> {
    if remote.contains("://") {
        return None;
    }
    let path = remote.split_once(':')?.1;
    owner_repo_from_path(path)
}

fn owner_repo_from_path(path: &str) -> Option<String> {
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    if path.is_empty() || path.contains('@') {
        return None;
    }
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    let owner = parts[parts.len() - 2];
    let repo = parts[parts.len() - 1];
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

/// Path a change ends up at. git spells a rename two ways — `old -> new` in
/// porcelain status and `dir/{old => new}` in numstat — and both should resolve
/// to the file that exists now, so the two sources agree on one tree row.
pub fn rename_target(raw: &str) -> String {
    if let Some((_, new)) = raw.split_once(" -> ") {
        return new.trim().to_string();
    }
    if let Some(open) = raw.find('{') {
        if let Some(close) = raw[open..].find('}').map(|offset| open + offset) {
            if let Some((_, new)) = raw[open + 1..close].split_once(" => ") {
                let rebuilt = format!("{}{}{}", &raw[..open], new.trim(), &raw[close + 1..]);
                // `a/{ => b}/c` moves a file into a new directory and leaves a
                // doubled separator behind.
                return rebuilt.replace("//", "/");
            }
        }
    }
    if let Some((_, new)) = raw.split_once(" => ") {
        return new.trim().to_string();
    }
    raw.to_string()
}

pub fn parse_status_porcelain(raw: &str) -> (GitStatusCounts, HashMap<String, ChangedFileStat>) {
    let mut counts = GitStatusCounts::default();
    let mut file_map = HashMap::new();

    for line in raw.lines() {
        if line.len() < 3 {
            continue;
        }

        let status = &line[..2];
        let path = rename_target(line[3..].trim());
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
            path.clone(),
            ChangedFileStat {
                status: normalized_status,
                path,
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
            let path = rename_target(path_raw);

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
    fn session_summary_snapshot_defaults_legacy_presentation_fields() {
        let snapshot: SessionSummarySnapshot = serde_json::from_value(serde_json::json!({
            "session_id": "legacy",
            "cwd": "/repo",
            "model": "model-a",
            "backend": "openai-responses",
            "visible_message_count": 0,
            "last_user_prompt": null,
            "sandboxed": false,
            "ssh_host": null,
            "created_at": "2026-01-01 00:00:00.000000000",
            "updated_at": "2026-01-01 00:00:00.000000000"
        }))
        .unwrap();

        assert_eq!(snapshot.title, None);
        assert_eq!(snapshot.behavior, sessions::SessionBehavior::Orchestrator);
        assert!(!snapshot.pinned);
        assert_eq!(snapshot.sort_order, 0);
        assert_eq!(snapshot.presentation_version, 0);
    }

    #[test]
    fn workspace_without_host_path_is_unavailable() {
        let snapshot = workspace_snapshot("/workspace/project", None);
        assert!(snapshot.error.is_some());
        assert_eq!(snapshot.host_root, None);
    }

    #[test]
    fn parse_remote_label_handles_ssh() {
        assert_eq!(
            parse_remote_label("git@github.com:arcee-ai/nac.git").as_deref(),
            Some("arcee-ai/nac")
        );
        assert_eq!(
            parse_remote_label("https://github.com/arcee-ai/nac.git").as_deref(),
            Some("arcee-ai/nac")
        );
        assert_eq!(
            parse_remote_label("ssh://git@github.com/arcee-ai/nac.git").as_deref(),
            Some("arcee-ai/nac")
        );
        assert_eq!(
            parse_remote_label(
                "https://user:token@github.com/arcee-ai/nac.git?access_token=SECRET#frag"
            )
            .as_deref(),
            Some("arcee-ai/nac")
        );
        assert_eq!(parse_remote_label("not-a-remote"), None);
    }

    #[test]
    fn parse_status_porcelain_tracks_untracked_and_staged() {
        let raw = "M  crates/nac-core/src/view.rs\nA  README.md\n?? notes.txt\n";
        let (counts, files) = parse_status_porcelain(raw);

        assert_eq!(counts.modified, 1);
        assert_eq!(counts.added, 1);
        assert_eq!(counts.untracked, 1);
        assert_eq!(counts.staged, 2);
        assert!(files.contains_key("notes.txt"));
    }
}
