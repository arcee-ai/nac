use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Tone {
    Info,
    Success,
    Warning,
    Error,
    Muted,
}

impl Tone {
    pub(super) fn color(self) -> Color {
        match self {
            Self::Info => Color::Cyan,
            Self::Success => Color::Green,
            Self::Warning => Color::Yellow,
            Self::Error => Color::Red,
            Self::Muted => Color::DarkGray,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ThreadState {
    Active,
    Idle,
}

impl ThreadState {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Idle => "IDLE",
        }
    }

    pub(super) fn tone(self) -> Tone {
        match self {
            Self::Active => Tone::Success,
            Self::Idle => Tone::Muted,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ToolStatus {
    Running,
    Ok,
    Failed,
    Error,
    TimedOut,
}

impl ToolStatus {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Running => "RUN",
            Self::Ok => "OK",
            Self::Failed => "FAIL",
            Self::Error => "ERR",
            Self::TimedOut => "TIME",
        }
    }

    pub(super) fn tone(self) -> Tone {
        match self {
            Self::Running => Tone::Info,
            Self::Ok => Tone::Success,
            Self::Failed => Tone::Warning,
            Self::Error => Tone::Error,
            Self::TimedOut => Tone::Warning,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum PanelId {
    Prompt,
    Events,
    Threads,
    Response,
    PreviousResponse,
    Workspace,
    Tools,
    Worksets,
    ThreadList,
    ThreadEpisodes,
    CompactStream,
}

#[derive(Debug, Clone)]
pub(super) struct TimelineEntry {
    pub(super) timestamp: String,
    pub(super) actor: String,
    pub(super) detail: String,
    pub(super) tone: Tone,
}

#[derive(Debug, Clone)]
pub(super) struct ThreadView {
    pub(super) name: String,
    pub(super) action: String,
    pub(super) state: ThreadState,
    pub(super) updated_at: String, // Human-readable display (e.g., "14:32:05")
    pub(super) updated_at_ts: u64, // Unix timestamp for correct numeric sorting
    pub(super) episodes: i64,
    pub(super) summary: String,
}

#[derive(Debug, Clone)]
pub(super) struct ActiveTool {
    pub(super) thread_name: Option<String>,
    pub(super) name: String,
    pub(super) target: String,
    pub(super) started_at: Instant,
}

#[derive(Debug, Clone)]
pub(super) struct ToolRecord {
    pub(super) thread_name: Option<String>,
    pub(super) name: String,
    pub(super) target: String,
    pub(super) status: ToolStatus,
    pub(super) duration: Duration,
    pub(super) summary: String,
}

#[derive(Debug, Clone, Default)]
pub(super) struct GitStatusCounts {
    pub(super) modified: usize,
    pub(super) staged: usize,
    pub(super) untracked: usize,
    pub(super) added: usize,
    pub(super) deleted: usize,
    pub(super) renamed: usize,
}

#[derive(Debug, Clone)]
pub(super) struct ChangedFileStat {
    pub(super) status: String,
    pub(super) path: String,
    pub(super) additions: Option<u64>,
    pub(super) deletions: Option<u64>,
}

#[derive(Debug, Clone)]
pub(super) struct WorkspaceSnapshot {
    pub(super) host_root: Option<PathBuf>,
    pub(super) workspace_display: String,
    pub(super) repo_label: Option<String>,
    pub(super) branch: Option<String>,
    pub(super) changed_files: Vec<ChangedFileStat>,
    pub(super) total_additions: u64,
    pub(super) total_deletions: u64,
    pub(super) error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct WorksetSnapshot {
    pub(super) items: Vec<store::WorksetRecord>,
    pub(super) error: Option<String>,
}

impl WorksetSnapshot {
    pub(super) fn load(store_path: &Path, session_id: Option<&str>) -> Self {
        let Some(session_id) = session_id else {
            return Self {
                items: Vec::new(),
                error: Some("no active session".to_string()),
            };
        };

        match load_workset_records(store_path, session_id) {
            Ok(items) => Self { items, error: None },
            Err(error) => Self {
                items: Vec::new(),
                error: Some(error.to_string()),
            },
        }
    }
}

fn load_workset_records(
    store_path: &Path,
    session_id: &str,
) -> anyhow::Result<Vec<store::WorksetRecord>> {
    tokio::task::block_in_place(|| {
        let summaries = store::list_worksets(store_path, session_id)?;
        let mut worksets = Vec::with_capacity(summaries.len());
        for summary in summaries {
            if let Some(workset) = store::read_workset(store_path, session_id, &summary.id)? {
                worksets.push(workset);
            }
        }
        Ok(worksets)
    })
}

impl WorkspaceSnapshot {
    pub(super) fn load(workspace_display: &str, host_root: Option<&Path>) -> Self {
        let Some(cwd) = host_root else {
            return Self {
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
                return Self {
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
        let (diff_map, total_additions, total_deletions) =
            parse_numstat_pairs(&diff_raw, &cached_raw);
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

        Self {
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
}

#[derive(Debug, Clone)]
pub(super) struct StyledSegment {
    pub(super) text: String,
    pub(super) style: Style,
}

#[derive(Debug, Clone)]
pub(super) struct WrappedRow {
    pub(super) logical_line: usize,
    pub(super) start_char: usize,
    pub(super) end_char: usize,
    pub(super) text: String,
    pub(super) spans: Vec<StyledSegment>,
}

#[derive(Debug, Clone)]
pub(super) struct PanelView {
    pub(super) id: PanelId,
    pub(super) inner: Rect,
    pub(super) logical_lines: Vec<String>,
    pub(super) rows: Vec<WrappedRow>,
    pub(super) scroll_offset: usize,
    pub(super) visible_rows: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SelectionPoint {
    pub(super) panel: PanelId,
    pub(super) logical_line: usize,
    pub(super) char_index: usize,
}

#[derive(Debug, Clone)]
pub(super) struct SelectionState {
    pub(super) anchor: SelectionPoint,
    pub(super) focus: SelectionPoint,
    pub(super) dragging: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FocusPanel {
    Events,
    Response,
    PreviousResponse,
    Threads,
    Tools,
    Workspace,
    Worksets,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ScreenMode {
    Dashboard,
    Focused(FocusPanel),
    SessionPicker { startup: bool },
}

#[derive(Debug, Clone, Default)]
pub(super) struct SessionPickerState {
    pub(super) sessions: Vec<sessions::SessionSummary>,
    pub(super) selected: usize,
    pub(super) error: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ComposerNotice {
    pub(super) text: String,
    pub(super) tone: Tone,
    pub(super) expires_at: Instant,
}
