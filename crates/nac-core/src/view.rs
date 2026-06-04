use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use crate::{sessions, store};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionSummarySnapshot {
    pub session_id: String,
    pub cwd: PathBuf,
    pub model: String,
    pub backend: String,
    pub visible_message_count: usize,
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
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

impl From<sessions::SessionSummary> for SessionSummarySnapshot {
    fn from(summary: sessions::SessionSummary) -> Self {
        Self {
            session_id: summary.session_id,
            cwd: summary.cwd,
            model: summary.model,
            backend: summary.backend.as_str().to_string(),
            visible_message_count: summary.visible_message_count,
            last_user_prompt: summary.last_user_prompt,
            sandboxed: summary.sandboxed,
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
                "workspace '{}' is sandbox-only; host-side inspection unavailable",
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

pub fn parse_numstat_pairs(
    raw: &str,
    cached_raw: &str,
) -> (HashMap<String, (Option<u64>, Option<u64>)>, u64, u64) {
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
}
