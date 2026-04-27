use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering as AtomicOrdering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{
    self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
    Event as CrosstermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
    KeyboardEnhancementFlags, MouseButton, MouseEvent, MouseEventKind, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, supports_keyboard_enhancement, EnterAlternateScreen,
    LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Terminal;
use ratatui_textarea::TextArea;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{self, MissedTickBehavior};

use crate::agent::Agent;
use crate::events::{AgentEvent, EventSink};
use crate::life::LifeField;
use crate::sessions::{self, SessionSnapshot};
use crate::store;
use crate::types::Message;

const COMPOSER_HEIGHT: u16 = 6;
const MIN_TERMINAL_WIDTH: u16 = 72;
const MIN_TERMINAL_HEIGHT: u16 = 22;
const TIMELINE_LIMIT: usize = 220;
const TOOL_HISTORY_LIMIT: usize = 20;
const FILE_CHANGE_LIMIT: usize = 36;
const WORKSPACE_REFRESH_INTERVAL: Duration = Duration::from_millis(400);
const WORKING_TIMEOUT: Duration = Duration::from_secs(600);
const PROMPT_SEPARATOR: &str = " › ";
const COMMAND_SEPARATOR: &str = " / ";
const CONTINUATION_PREFIX: &str = "   ";

type UiTerminal = Terminal<CrosstermBackend<io::Stdout>>;

#[derive(Clone)]
pub struct TuiMetadata {
    pub cwd: String,
    pub workspace_host_path: Option<PathBuf>,
    pub store_path: PathBuf,
    pub model: String,
    pub base_url: String,
    pub backend: String,
    pub reasoning_effort: Option<String>,
    pub session_id: Option<String>,
    pub sandbox_status: String,
    pub agents_md_status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tone {
    Info,
    Success,
    Warning,
    Error,
    Muted,
}

impl Tone {
    fn color(self) -> Color {
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
enum ThreadState {
    Active,
    Idle,
}

impl ThreadState {
    fn label(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Idle => "IDLE",
        }
    }

    fn tone(self) -> Tone {
        match self {
            Self::Active => Tone::Success,
            Self::Idle => Tone::Muted,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolStatus {
    Running,
    Ok,
    Failed,
    Error,
    TimedOut,
}

impl ToolStatus {
    fn label(self) -> &'static str {
        match self {
            Self::Running => "RUN",
            Self::Ok => "OK",
            Self::Failed => "FAIL",
            Self::Error => "ERR",
            Self::TimedOut => "TIME",
        }
    }

    fn tone(self) -> Tone {
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
enum PanelId {
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
}

#[derive(Debug, Clone)]
struct TimelineEntry {
    timestamp: String,
    actor: String,
    detail: String,
    tone: Tone,
}

#[derive(Debug, Clone)]
struct ThreadView {
    name: String,
    action: String,
    state: ThreadState,
    updated_at: String,
    episodes: i64,
    summary: String,
}

#[derive(Debug, Clone)]
struct ActiveTool {
    thread_name: Option<String>,
    name: String,
    target: String,
    started_at: Instant,
}

#[derive(Debug, Clone)]
struct ToolRecord {
    thread_name: Option<String>,
    name: String,
    target: String,
    status: ToolStatus,
    duration: Duration,
    summary: String,
}

#[derive(Debug, Clone, Default)]
struct GitStatusCounts {
    modified: usize,
    staged: usize,
    untracked: usize,
    added: usize,
    deleted: usize,
    renamed: usize,
}

#[derive(Debug, Clone)]
struct ChangedFileStat {
    status: String,
    path: String,
    additions: Option<u64>,
    deletions: Option<u64>,
}

#[derive(Debug, Clone)]
struct WorkspaceSnapshot {
    host_root: Option<PathBuf>,
    workspace_display: String,
    repo_label: Option<String>,
    branch: Option<String>,
    changed_files: Vec<ChangedFileStat>,
    total_additions: u64,
    total_deletions: u64,
    error: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct WorksetSnapshot {
    items: Vec<store::WorksetRecord>,
    error: Option<String>,
}

impl WorksetSnapshot {
    fn load(store_path: &Path, session_id: Option<&str>) -> Self {
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
    let summaries = store::list_worksets(store_path, session_id, None)?;
    let mut worksets = Vec::with_capacity(summaries.len());
    for summary in summaries {
        if let Some(workset) = store::read_workset(store_path, session_id, &summary.id)? {
            worksets.push(workset);
        }
    }
    Ok(worksets)
}

impl WorkspaceSnapshot {
    fn load(workspace_display: &str, host_root: Option<&Path>) -> Self {
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
                    status: "MOD".to_string(),
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
struct StyledSegment {
    text: String,
    style: Style,
}

#[derive(Debug, Clone)]
struct WrappedRow {
    logical_line: usize,
    start_char: usize,
    end_char: usize,
    text: String,
    spans: Vec<StyledSegment>,
}

#[derive(Debug, Clone)]
struct PanelView {
    id: PanelId,
    inner: Rect,
    logical_lines: Vec<String>,
    rows: Vec<WrappedRow>,
    scroll_offset: usize,
    visible_rows: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SelectionPoint {
    panel: PanelId,
    logical_line: usize,
    char_index: usize,
}

#[derive(Debug, Clone)]
struct SelectionState {
    anchor: SelectionPoint,
    focus: SelectionPoint,
    dragging: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FocusPanel {
    Events,
    Response,
    PreviousResponse,
    Threads,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScreenMode {
    Dashboard,
    Focused(FocusPanel),
    SessionPicker { startup: bool },
}

#[derive(Debug, Clone, Default)]
struct SessionPickerState {
    sessions: Vec<sessions::SessionSummary>,
    selected: usize,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct ComposerNotice {
    text: String,
    tone: Tone,
    expires_at: Instant,
}

struct App {
    metadata: TuiMetadata,
    inspect_root: Option<PathBuf>,
    composer: TextArea<'static>,
    composer_notice: Option<ComposerNotice>,
    result_rx: Option<tokio::sync::oneshot::Receiver<Result<String, String>>>,
    quit: bool,
    working_started_at: Option<Instant>,
    working_frame: usize,
    last_response_duration: Duration,
    restored_message_count: usize,
    last_prompt: Option<String>,
    last_response: Option<String>,
    previous_response: Option<String>,
    timeline: VecDeque<TimelineEntry>,
    threads: HashMap<String, ThreadView>,
    all_episodes: HashMap<String, Vec<store::EpisodeRecord>>,
    episode_markdown_cache: HashMap<String, Vec<Line<'static>>>,
    response_markdown_cache: Option<(String, Vec<Line<'static>>)>,
    selected_thread: Option<String>,
    active_tools: HashMap<String, ActiveTool>,
    recent_tools: VecDeque<ToolRecord>,
    workspace: WorkspaceSnapshot,
    worksets: WorksetSnapshot,
    last_workspace_refresh_at: Instant,
    workspace_tx: Option<mpsc::Sender<WorkspaceSnapshot>>,
    workspace_rx: Option<mpsc::Receiver<WorkspaceSnapshot>>,
    workspace_refresh_pending: bool,
    workspace_refresh_deadline: Option<Instant>,
    panel_scrolls: HashMap<PanelId, usize>,
    panel_views: HashMap<PanelId, PanelView>,
    selection: Option<SelectionState>,
    help_visible: bool,
    screen: ScreenMode,
    session_picker: SessionPickerState,
    life_field: LifeField,
    current_prompt: String,
}

impl App {
    fn new(
        metadata: TuiMetadata,
        restored_messages: &[Message],
        start_in_session_picker: bool,
    ) -> Self {
        let inspect_root = metadata.workspace_host_path.clone();
        let workspace = WorkspaceSnapshot::load(&metadata.cwd, inspect_root.as_deref());
        let worksets = WorksetSnapshot::load(&metadata.store_path, metadata.session_id.as_deref());

        let mut panel_scrolls = HashMap::new();
        panel_scrolls.insert(PanelId::Prompt, 0);
        panel_scrolls.insert(PanelId::Events, 0);
        panel_scrolls.insert(PanelId::Threads, 0);
        panel_scrolls.insert(PanelId::Response, 0);
        panel_scrolls.insert(PanelId::PreviousResponse, 0);
        panel_scrolls.insert(PanelId::Workspace, 0);
        panel_scrolls.insert(PanelId::Tools, 0);
        panel_scrolls.insert(PanelId::Worksets, 0);
        panel_scrolls.insert(PanelId::ThreadList, 0);
        panel_scrolls.insert(PanelId::ThreadEpisodes, 0);

        let mut app = Self {
            metadata,
            inspect_root,
            composer: build_composer(),
            composer_notice: None,
            result_rx: None,
            quit: false,
            working_started_at: None,
            working_frame: 0,
            last_response_duration: Duration::default(),
            restored_message_count: visible_restored_message_count(restored_messages),
            last_prompt: None,
            last_response: None,
            previous_response: None,
            timeline: VecDeque::new(),
            threads: HashMap::new(),
            all_episodes: HashMap::new(),
            episode_markdown_cache: HashMap::new(),
            response_markdown_cache: None,
            selected_thread: None,
            active_tools: HashMap::new(),
            recent_tools: VecDeque::new(),
            workspace,
            worksets,
            last_workspace_refresh_at: Instant::now(),
            workspace_tx: None,
            workspace_rx: None,
            workspace_refresh_pending: false,
            workspace_refresh_deadline: None,
            panel_scrolls,
            panel_views: HashMap::new(),
            selection: None,
            help_visible: false,
            screen: ScreenMode::Dashboard,
            session_picker: SessionPickerState::default(),
            life_field: LifeField::default(),
            current_prompt: String::new(),
        };

        app.hydrate_threads_from_store();
        app.hydrate_all_episodes();
        app.hydrate_from_messages(restored_messages);
        if app.restored_message_count > 0 {
            app.push_timeline(
                "system",
                format!(
                    "restored {} message(s) into the session",
                    app.restored_message_count
                ),
                Tone::Muted,
            );
        }
        if start_in_session_picker {
            app.open_session_picker(true);
        }
        app
    }

    fn prompt(&self) -> String {
        self.composer.lines().join("\n")
    }

    fn clear_composer(&mut self) {
        self.composer = build_composer();
        self.composer_notice = None;
    }

    fn clear_composer_notice(&mut self) {
        self.composer_notice = None;
    }

    fn show_composer_notice(&mut self, text: impl Into<String>, tone: Tone) {
        self.composer_notice = Some(ComposerNotice {
            text: text.into(),
            tone,
            expires_at: Instant::now() + Duration::from_secs(2),
        });
    }

    fn maybe_expire_composer_notice(&mut self) {
        if self
            .composer_notice
            .as_ref()
            .is_some_and(|notice| Instant::now() >= notice.expires_at)
        {
            self.composer_notice = None;
        }
    }

    fn handle_paste(&mut self, text: &str) -> AppAction {
        if self.help_visible || matches!(self.screen, ScreenMode::SessionPicker { .. }) {
            return AppAction::None;
        }
        if self.result_rx.is_some() {
            return AppAction::None;
        }

        self.clear_composer_notice();
        self.composer.insert_str(&normalize_paste(text));
        AppAction::None
    }

    fn handle_key_event(&mut self, key: KeyEvent) -> AppAction {
        if key.kind == KeyEventKind::Release {
            return AppAction::None;
        }

        if matches!(self.screen, ScreenMode::SessionPicker { .. }) {
            return self.handle_session_picker_key_event(key);
        }

        if self.help_visible {
            return match key {
                KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers,
                    ..
                } if modifiers.contains(KeyModifiers::CONTROL) => {
                    self.quit = true;
                    AppAction::Quit
                }
                KeyEvent {
                    code: KeyCode::Esc, ..
                }
                | KeyEvent {
                    code: KeyCode::Char('?'),
                    ..
                } => {
                    self.help_visible = false;
                    AppAction::None
                }
                _ => AppAction::None,
            };
        }

        match key {
            KeyEvent {
                code: KeyCode::Char('c'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.quit = true;
                AppAction::Quit
            }
            KeyEvent {
                code: KeyCode::Char('?'),
                ..
            } if self.prompt().is_empty() => {
                self.selection = None;
                self.help_visible = true;
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Char('e'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.toggle_focus_panel(FocusPanel::Events);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Char('r'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.toggle_focus_panel(FocusPanel::Response);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Char('p'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.toggle_focus_panel(FocusPanel::PreviousResponse);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Char('t'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.toggle_focus_panel(FocusPanel::Threads);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Esc, ..
            } if matches!(self.screen, ScreenMode::Focused(_)) => {
                self.selection = None;
                self.screen = ScreenMode::Dashboard;
                AppAction::None
            }
            // Navigation in focused Threads mode
            KeyEvent {
                code: KeyCode::Up, ..
            }
            | KeyEvent {
                code: KeyCode::Char('k'),
                ..
            } if matches!(self.screen, ScreenMode::Focused(FocusPanel::Threads)) => {
                self.select_previous_thread();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Down,
                ..
            }
            | KeyEvent {
                code: KeyCode::Char('j'),
                ..
            } if matches!(self.screen, ScreenMode::Focused(FocusPanel::Threads)) => {
                self.select_next_thread();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::PageUp,
                ..
            } => {
                self.scroll_panel(self.primary_scroll_panel(), -3);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::PageDown,
                ..
            } => {
                self.scroll_panel(self.primary_scroll_panel(), 3);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Enter,
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::SHIFT) => {
                if self.result_rx.is_none() {
                    self.composer.insert_newline();
                }
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Enter,
                ..
            } => {
                let prompt = self.prompt();
                let trimmed = prompt.trim();
                if trimmed.is_empty() || self.result_rx.is_some() {
                    return AppAction::None;
                }

                if let Some(command) = parse_slash_command(&prompt) {
                    match command {
                        Ok(SlashCommand::Exit) => {
                            self.quit = true;
                            return AppAction::Quit;
                        }
                        Ok(SlashCommand::Sessions) => {
                            self.open_session_picker(false);
                            self.clear_composer();
                            return AppAction::None;
                        }
                        Ok(
                            SlashCommand::Batch { .. }
                            | SlashCommand::BatchRun { .. }
                            | SlashCommand::Plan { .. }
                            | SlashCommand::Review { .. },
                        ) => {}
                        Err(message) => {
                            self.show_composer_notice(message, Tone::Warning);
                            return AppAction::None;
                        }
                    }
                }

                AppAction::Submit(prompt)
            }
            _ => {
                if self.result_rx.is_none() {
                    self.clear_composer_notice();
                    self.composer.input(key);
                }
                AppAction::None
            }
        }
    }

    fn handle_mouse_event(&mut self, mouse: MouseEvent) {
        if self.help_visible || matches!(self.screen, ScreenMode::SessionPicker { .. }) {
            return;
        }

        match mouse.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                if let Some(point) = self.selection_point_at(mouse.column, mouse.row) {
                    self.selection = Some(SelectionState {
                        anchor: point.clone(),
                        focus: point,
                        dragging: true,
                    });
                } else {
                    self.selection = None;
                }
            }
            MouseEventKind::Drag(MouseButton::Left) => {
                let panel = self
                    .selection
                    .as_ref()
                    .map(|selection| selection.anchor.panel);
                if let Some(panel) = panel {
                    self.autoscroll_drag_selection(panel, mouse.column, mouse.row);
                    let point = self.selection_point_for_panel(panel, mouse.column, mouse.row);
                    if let Some(selection) = self.selection.as_mut() {
                        if let Some(point) = point {
                            selection.focus = point;
                        }
                    }
                }
            }
            MouseEventKind::Up(MouseButton::Left) => {
                if let Some(selection) = self.selection.as_mut() {
                    selection.dragging = false;
                }
                self.copy_selection_to_clipboard();
            }
            MouseEventKind::ScrollUp => {
                if let Some(panel) = self.panel_at(mouse.column, mouse.row) {
                    self.scroll_panel(panel, -3);
                }
            }
            MouseEventKind::ScrollDown => {
                if let Some(panel) = self.panel_at(mouse.column, mouse.row) {
                    self.scroll_panel(panel, 3);
                }
            }
            _ => {}
        }
    }

    fn handle_crossterm_event(&mut self, event: CrosstermEvent) -> Option<AppAction> {
        match event {
            CrosstermEvent::Key(key) => Some(self.handle_key_event(key)),
            CrosstermEvent::Mouse(mouse) => {
                self.handle_mouse_event(mouse);
                None
            }
            CrosstermEvent::Paste(text) => {
                let _ = self.handle_paste(&text);
                None
            }
            CrosstermEvent::Resize(_, _) => None,
            _ => None,
        }
    }

    fn hydrate_from_messages(&mut self, messages: &[Message]) {
        for message in messages {
            match message {
                Message::User { content } => {
                    self.last_prompt = Some(display_prompt_from_message(content));
                }
                Message::Assistant {
                    content: Some(content),
                    ..
                } => {
                    if let Some(previous) = self.last_response.replace(content.clone()) {
                        self.previous_response = Some(previous);
                    }
                    self.response_markdown_cache = None;
                }
                _ => {}
            }
        }
    }

    fn handle_session_picker_key_event(&mut self, key: KeyEvent) -> AppAction {
        match key {
            KeyEvent {
                code: KeyCode::Char('c'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.quit = true;
                AppAction::Quit
            }
            KeyEvent {
                code: KeyCode::Esc, ..
            }
            | KeyEvent {
                code: KeyCode::Char('q'),
                ..
            } => {
                if matches!(self.screen, ScreenMode::SessionPicker { startup: true }) {
                    self.quit = true;
                    AppAction::Quit
                } else {
                    self.screen = ScreenMode::Dashboard;
                    AppAction::None
                }
            }
            KeyEvent {
                code: KeyCode::Up, ..
            }
            | KeyEvent {
                code: KeyCode::Char('k'),
                ..
            } => {
                self.session_picker.selected = self.session_picker.selected.saturating_sub(1);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Down,
                ..
            }
            | KeyEvent {
                code: KeyCode::Char('j'),
                ..
            } => {
                if !self.session_picker.sessions.is_empty() {
                    self.session_picker.selected = self
                        .session_picker
                        .selected
                        .saturating_add(1)
                        .min(self.session_picker.sessions.len().saturating_sub(1));
                }
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Char('r'),
                ..
            } => {
                self.refresh_session_picker();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Enter,
                ..
            } => self
                .session_picker
                .sessions
                .get(self.session_picker.selected)
                .map(|session| AppAction::ResumeSession(session.session_id.clone()))
                .unwrap_or(AppAction::None),
            _ => AppAction::None,
        }
    }

    fn open_session_picker(&mut self, startup: bool) {
        self.refresh_session_picker();
        self.selection = None;
        self.screen = ScreenMode::SessionPicker { startup };
    }

    fn toggle_focus_panel(&mut self, panel: FocusPanel) {
        self.selection = None;
        self.screen = match self.screen {
            ScreenMode::Focused(current) if current == panel => ScreenMode::Dashboard,
            _ => {
                if matches!(panel, FocusPanel::Events) {
                    self.panel_scrolls.insert(PanelId::Events, usize::MAX);
                }
                if matches!(panel, FocusPanel::Threads) && self.selected_thread.is_none() {
                    let names = self.sorted_thread_names();
                    if !names.is_empty() {
                        self.selected_thread = Some(names[0].clone());
                    }
                    self.panel_scrolls.insert(PanelId::ThreadList, 0);
                    self.panel_scrolls.insert(PanelId::ThreadEpisodes, 0);
                }
                ScreenMode::Focused(panel)
            }
        };
    }

    fn primary_scroll_panel(&self) -> PanelId {
        match self.screen {
            ScreenMode::Focused(FocusPanel::Events) => PanelId::Events,
            ScreenMode::Focused(FocusPanel::PreviousResponse) => PanelId::PreviousResponse,
            ScreenMode::Focused(FocusPanel::Threads) => PanelId::ThreadEpisodes,
            _ => PanelId::Response,
        }
    }

    fn refresh_session_picker(&mut self) {
        match sessions::list_sessions() {
            Ok(sessions) => {
                let current_session = self.metadata.session_id.as_deref();
                let selected = current_session
                    .and_then(|current| {
                        sessions
                            .iter()
                            .position(|session| session.session_id == current)
                    })
                    .unwrap_or(0);
                self.session_picker.sessions = sessions;
                self.session_picker.selected =
                    selected.min(self.session_picker.sessions.len().saturating_sub(1));
                self.session_picker.error = None;
            }
            Err(error) => {
                self.session_picker.sessions.clear();
                self.session_picker.selected = 0;
                self.session_picker.error = Some(error.to_string());
            }
        }
    }

    fn hydrate_threads_from_store(&mut self) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        let Ok(threads) = store::list_threads(&self.metadata.store_path, session_id) else {
            return;
        };

        for thread in threads {
            let entry = self
                .threads
                .entry(thread.name.clone())
                .or_insert_with(|| ThreadView {
                    name: thread.name.clone(),
                    action: thread
                        .latest_action
                        .clone()
                        .unwrap_or_else(|| "retained history".to_string()),
                    state: ThreadState::Idle,
                    updated_at: short_clock(&thread.updated_at),
                    episodes: thread.episode_count,
                    summary: format!("{} episode(s)", thread.episode_count),
                });
            if matches!(entry.state, ThreadState::Idle) {
                if let Some(action) = thread.latest_action {
                    entry.action = action;
                }
                entry.updated_at = short_clock(&thread.updated_at);
                entry.episodes = thread.episode_count;
                entry.summary = format!("{} episode(s)", thread.episode_count);
            }
        }
    }

    fn hydrate_all_episodes(&mut self) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        if let Ok(episodes) = store::load_all_episodes(&self.metadata.store_path, session_id) {
            self.all_episodes = episodes;
        }
        self.episode_markdown_cache.clear();
    }

    fn refresh_worksets(&mut self) {
        self.worksets = WorksetSnapshot::load(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        );
    }

    fn maybe_refresh_workspace(&mut self) {
        if self.last_workspace_refresh_at.elapsed() >= WORKSPACE_REFRESH_INTERVAL {
            self.last_workspace_refresh_at = Instant::now();
            self.request_workspace_refresh();
        }
    }

    fn request_workspace_refresh(&mut self) {
        if self.workspace_refresh_pending {
            return;
        }
        let tx = match &self.workspace_tx {
            Some(tx) => tx.clone(),
            None => return,
        };
        let cwd = self.metadata.cwd.clone();
        let inspect_root = self.inspect_root.clone();
        self.workspace_refresh_pending = true;
        self.workspace_refresh_deadline = Some(Instant::now() + Duration::from_secs(5));
        tokio::task::spawn_blocking(move || {
            let snapshot = WorkspaceSnapshot::load(&cwd, inspect_root.as_deref());
            let _ = tx.blocking_send(snapshot);
        });
    }

    fn check_workspace_channel(&mut self) {
        let rx = match &mut self.workspace_rx {
            Some(rx) => rx,
            None => return,
        };
        match rx.try_recv() {
            Ok(snapshot) => {
                self.workspace = snapshot;
                self.workspace_refresh_pending = false;
                self.workspace_refresh_deadline = None;
            }
            Err(mpsc::error::TryRecvError::Empty) => {
                if self.workspace_refresh_pending {
                    if let Some(deadline) = self.workspace_refresh_deadline {
                        if Instant::now() >= deadline {
                            self.workspace_refresh_pending = false;
                            self.workspace_refresh_deadline = None;
                        }
                    }
                }
            }
            Err(mpsc::error::TryRecvError::Disconnected) => {
                self.workspace_rx = None;
                self.workspace_refresh_pending = false;
                self.workspace_refresh_deadline = None;
            }
        }
    }

    fn note_prompt_submitted(&mut self, prompt: &str) {
        self.last_prompt = Some(prompt.to_string());
        self.panel_scrolls.insert(PanelId::Prompt, 0);
        self.push_timeline(
            "user",
            format!("prompt • {}", fit_text(prompt, 110)),
            Tone::Info,
        );
    }

    fn note_send_error(&mut self, error: String) {
        self.push_timeline("send", format!("error • {error}"), Tone::Error);
    }

    fn apply_agent_event(&mut self, event: AgentEvent) {
        match event {
            AgentEvent::RunStarted {
                thread_name,
                prompt_preview,
            } => {
                if thread_name.is_none() && self.last_prompt.is_none() {
                    self.last_prompt = Some(prompt_preview.clone());
                }
                let actor = thread_name.unwrap_or_else(|| "orchestrator".to_string());
                self.push_timeline(
                    actor,
                    format!("run started • {}", prompt_preview),
                    Tone::Muted,
                );
            }
            AgentEvent::ModelCallStarted {
                thread_name,
                iteration,
            } => {
                let actor = thread_name.unwrap_or_else(|| "model".to_string());
                self.push_timeline(actor, format!("model turn {iteration}"), Tone::Muted);
            }
            AgentEvent::ToolCallStarted {
                thread_name,
                call_id,
                name,
                args_preview,
            } => {
                if thread_name.is_none() && name == "thread" {
                    return;
                }

                self.active_tools.insert(
                    call_id,
                    ActiveTool {
                        thread_name: thread_name.clone(),
                        name: name.clone(),
                        target: args_preview.clone(),
                        started_at: Instant::now(),
                    },
                );
                let actor = thread_name.unwrap_or_else(|| "orchestrator".to_string());
                self.push_timeline(actor, format!("{name} • {args_preview}"), Tone::Info);
            }
            AgentEvent::ToolCallFinished {
                thread_name,
                call_id,
                name,
                content_preview,
                is_error,
            } => {
                if thread_name.is_none() && name == "thread" {
                    return;
                }

                let actor = thread_name
                    .clone()
                    .unwrap_or_else(|| "orchestrator".to_string());
                let active = self.active_tools.remove(&call_id);
                let duration = active
                    .as_ref()
                    .map(|tool| tool.started_at.elapsed())
                    .unwrap_or_default();
                let target = active
                    .as_ref()
                    .map(|tool| tool.target.clone())
                    .unwrap_or_default();
                let status = classify_tool_status(is_error, &content_preview);
                let record = ToolRecord {
                    thread_name: active
                        .as_ref()
                        .and_then(|tool| tool.thread_name.clone())
                        .or(thread_name.clone()),
                    name: active
                        .as_ref()
                        .map(|tool| tool.name.clone())
                        .unwrap_or_else(|| name.clone()),
                    target: target.clone(),
                    status,
                    duration,
                    summary: content_preview.clone(),
                };
                self.recent_tools.push_front(record.clone());
                while self.recent_tools.len() > TOOL_HISTORY_LIMIT {
                    self.recent_tools.pop_back();
                }

                if matches!(record.name.as_str(), "write" | "edit")
                    || record.name == "bash"
                    || matches!(record.status, ToolStatus::Failed | ToolStatus::Error)
                {
                    self.request_workspace_refresh();
                }
                if record.name.starts_with("workset_") {
                    self.refresh_worksets();
                }

                let detail = if target.is_empty() {
                    record.summary.clone()
                } else {
                    format!("{target} • {}", record.summary)
                };
                self.push_timeline(actor, format!("{name} • {detail}"), status.tone());
            }
            AgentEvent::ThreadStarted {
                name,
                action,
                source_threads,
            } => {
                self.threads.insert(
                    name.clone(),
                    ThreadView {
                        name: name.clone(),
                        action: action.clone(),
                        state: ThreadState::Active,
                        updated_at: utc_hms(),
                        episodes: self
                            .threads
                            .get(&name)
                            .map(|thread| thread.episodes)
                            .unwrap_or(0),
                        summary: "running".to_string(),
                    },
                );

                let detail = if source_threads.is_empty() {
                    format!("thread dispatch • action: {action}")
                } else {
                    format!(
                        "thread dispatch • action: {} • sources: {}",
                        action,
                        source_threads.join(", ")
                    )
                };
                self.push_timeline(name, detail, Tone::Success);
            }
            AgentEvent::ThreadLog { name, line } => {
                self.push_timeline(name, format!("log • {}", fit_text(&line, 110)), Tone::Muted);
            }
            AgentEvent::ThreadFinished {
                name,
                exit_code,
                timed_out,
            } => {
                let entry = self
                    .threads
                    .entry(name.clone())
                    .or_insert_with(|| ThreadView {
                        name: name.clone(),
                        action: "thread run".to_string(),
                        state: ThreadState::Idle,
                        updated_at: utc_hms(),
                        episodes: 0,
                        summary: String::new(),
                    });
                entry.state = ThreadState::Idle;
                entry.updated_at = utc_hms();
                entry.summary = if timed_out {
                    "timed out".to_string()
                } else {
                    format!("exit {exit_code}")
                };

                self.request_workspace_refresh();
                self.hydrate_threads_from_store();
                self.hydrate_all_episodes();

                let detail = if timed_out {
                    "thread complete • timed out".to_string()
                } else {
                    format!("thread complete • exit {exit_code}")
                };
                self.push_timeline(
                    name,
                    detail,
                    if timed_out {
                        Tone::Warning
                    } else {
                        Tone::Success
                    },
                );
            }
            AgentEvent::AssistantMessage {
                thread_name,
                content,
            } => match thread_name {
                Some(thread_name) => {
                    if let Some(thread) = self.threads.get_mut(&thread_name) {
                        thread.updated_at = utc_hms();
                        thread.summary = truncate_episode_preview(&content);
                    }
                    self.hydrate_all_episodes();
                    self.push_timeline(
                        thread_name,
                        format!(
                            "retained episode • {}",
                            fit_text(&truncate_episode_preview(&content), 110)
                        ),
                        Tone::Muted,
                    );
                }
                None => {
                    if let Some(previous) = self.last_response.replace(content.clone()) {
                        self.previous_response = Some(previous);
                    }
                    self.response_markdown_cache = None;
                    self.panel_scrolls.insert(PanelId::Response, 0);
                    self.panel_scrolls.insert(PanelId::PreviousResponse, 0);
                    self.push_timeline(
                        "assistant",
                        format!("reply • {}", fit_text(&content, 110)),
                        Tone::Success,
                    );
                }
            },
            AgentEvent::Error {
                thread_name,
                message,
            } => {
                let actor = thread_name.unwrap_or_else(|| "run".to_string());
                self.push_timeline(actor, format!("error • {message}"), Tone::Error);
            }
            AgentEvent::RunFinished { thread_name } => {
                if thread_name.is_none() {
                    self.refresh_worksets();
                }
                let actor = thread_name.unwrap_or_else(|| "run".to_string());
                self.push_timeline(actor, "run finished".to_string(), Tone::Muted);
            }
        }
    }

    fn push_timeline(&mut self, actor: impl Into<String>, detail: impl Into<String>, tone: Tone) {
        self.timeline.push_back(TimelineEntry {
            timestamp: utc_hms(),
            actor: actor.into(),
            detail: detail.into(),
            tone,
        });
        while self.timeline.len() > TIMELINE_LIMIT {
            self.timeline.pop_front();
        }
    }

    fn active_thread_count(&self) -> usize {
        self.threads
            .values()
            .filter(|thread| matches!(thread.state, ThreadState::Active))
            .count()
    }

    fn sorted_thread_names(&self) -> Vec<String> {
        let mut threads: Vec<&ThreadView> = self.threads.values().collect();
        threads.sort_by(|left, right| {
            matches!(right.state, ThreadState::Active)
                .cmp(&matches!(left.state, ThreadState::Active))
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.name.cmp(&right.name))
        });
        threads.into_iter().map(|t| t.name.clone()).collect()
    }

    fn select_previous_thread(&mut self) {
        let names = self.sorted_thread_names();
        if names.is_empty() {
            self.selected_thread = None;
            return;
        }
        let current_idx = self
            .selected_thread
            .as_ref()
            .and_then(|sel| names.iter().position(|n| n == sel))
            .unwrap_or(0);
        let new_idx = current_idx.saturating_sub(1);
        self.selected_thread = Some(names[new_idx].clone());
        self.panel_scrolls.insert(PanelId::ThreadEpisodes, 0);
    }

    fn select_next_thread(&mut self) {
        let names = self.sorted_thread_names();
        if names.is_empty() {
            self.selected_thread = None;
            return;
        }
        let current_idx = self
            .selected_thread
            .as_ref()
            .and_then(|sel| names.iter().position(|n| n == sel))
            .unwrap_or(0);
        let new_idx = (current_idx + 1).min(names.len().saturating_sub(1));
        self.selected_thread = Some(names[new_idx].clone());
        self.panel_scrolls.insert(PanelId::ThreadEpisodes, 0);
    }

    fn displayed_run_duration(&self) -> Duration {
        self.working_started_at
            .map(|started| started.elapsed())
            .unwrap_or(self.last_response_duration)
    }

    fn reset_life(&mut self) {
        // Get the panel size from the last render or use defaults
        let width = self
            .panel_views
            .get(&PanelId::Prompt)
            .map(|p| p.inner.width as usize * 2)
            .unwrap_or(160);
        let height = self
            .panel_views
            .get(&PanelId::Prompt)
            .map(|p| p.inner.height as usize * 4)
            .unwrap_or(96);
        self.life_field = LifeField::from_seed(&self.current_prompt, width, height);
    }

    fn advance_life(&mut self) {
        self.life_field.step();
    }

    fn render(&mut self, frame: &mut ratatui::Frame) {
        self.panel_views.clear();

        let area = frame.area();
        if area.width < MIN_TERMINAL_WIDTH || area.height < MIN_TERMINAL_HEIGHT {
            self.render_too_small(frame, area);
            return;
        }

        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(12),
                Constraint::Length(COMPOSER_HEIGHT),
            ])
            .split(area);

        self.render_header(frame, sections[0]);

        if matches!(self.screen, ScreenMode::SessionPicker { .. }) {
            self.render_session_picker(frame, sections[1]);
            self.render_session_picker_footer(frame, sections[2]);
            return;
        }

        if let ScreenMode::Focused(panel) = self.screen {
            match panel {
                FocusPanel::Events => self.render_focused_events(frame, sections[1]),
                FocusPanel::Response => self.render_focused_response(frame, sections[1]),
                FocusPanel::PreviousResponse => {
                    self.render_focused_previous_response(frame, sections[1])
                }
                FocusPanel::Threads => self.render_focused_threads(frame, sections[1]),
            }
            self.render_composer(frame, sections[2]);
            if self.help_visible {
                self.render_help_overlay(frame, sections[1]);
            }
            return;
        }

        let body = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(27),
                Constraint::Percentage(43),
                Constraint::Percentage(30),
            ])
            .split(sections[1]);

        self.render_left_column(frame, body[0]);
        self.render_center_column(frame, body[1]);
        self.render_right_column(frame, body[2]);
        self.render_composer(frame, sections[2]);

        if self.help_visible {
            self.render_help_overlay(frame, sections[1]);
        }
    }

    fn render_focused_events(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let mut lines: Vec<Line<'static>> = self
            .timeline
            .iter()
            .map(|entry| render_event_line(entry, width))
            .collect();
        if lines.is_empty() {
            lines.push(Line::from(Span::styled(
                "Waiting for activity.",
                Style::default().fg(Color::DarkGray),
            )));
        }

        self.render_scrollable_lines_panel_with_title(
            frame,
            area,
            PanelId::Events,
            self.events_panel_title(),
            lines,
        );
    }

    fn render_focused_response(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        self.render_response_panel(frame, area);
    }

    fn render_focused_previous_response(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        self.render_previous_response_panel(frame, area);
    }

    fn render_too_small(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block("NAC");
        let inner = block.inner(area);
        frame.render_widget(block, area);

        let mut lines = vec![
            Line::from(Span::styled(
                "Terminal too small for the managed dashboard.",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(format!(
                "Resize to at least {}x{}.",
                MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT
            )),
        ];
        if let Some(prompt) = self.last_prompt.as_deref() {
            lines.push(Line::from(""));
            lines.push(Line::from(vec![
                Span::styled("last prompt ", Style::default().fg(Color::DarkGray)),
                Span::raw(fit_text(prompt, inner.width.saturating_sub(12) as usize)),
            ]));
        }

        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
    }

    fn render_header(&self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block("NAC");
        let inner = block.inner(area);
        frame.render_widget(block, area);

        let repo = self
            .workspace
            .repo_label
            .as_deref()
            .unwrap_or("no git repo");
        let branch = self.workspace.branch.as_deref().unwrap_or("detached");
        let workspace = compact_path(&self.metadata.cwd, 28);
        let session = self
            .metadata
            .session_id
            .as_deref()
            .map(short_session)
            .unwrap_or_else(|| "-".to_string());
        let runtime = format_runtime(self.displayed_run_duration());
        let run_state = if self.result_rx.is_some() {
            ("RUNNING", Tone::Success)
        } else {
            ("IDLE", Tone::Muted)
        };

        let top = Line::from(vec![
            Span::styled("repo ", Style::default().fg(Color::DarkGray)),
            Span::styled(repo.to_string(), Style::default().fg(Color::White)),
            Span::styled("  |  branch ", Style::default().fg(Color::DarkGray)),
            Span::styled(branch.to_string(), Style::default().fg(Color::White)),
            Span::styled("  |  workspace ", Style::default().fg(Color::DarkGray)),
            Span::styled(workspace, Style::default().fg(Color::White)),
            Span::styled("  |  session ", Style::default().fg(Color::DarkGray)),
            Span::styled(session, Style::default().fg(Color::White)),
            Span::styled("  |  model ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                self.metadata.model.clone(),
                Style::default().fg(Color::White),
            ),
        ]);

        let bottom = Line::from(vec![
            status_span(run_state.0, run_state.1),
            Span::styled("  sandbox ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                self.metadata.sandbox_status.clone(),
                Style::default().fg(Color::White),
            ),
            Span::styled("  |  backend ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                self.metadata.backend.clone(),
                Style::default().fg(Color::White),
            ),
            Span::styled("  |  agents ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                self.metadata.agents_md_status.clone(),
                Style::default().fg(Color::White),
            ),
            Span::styled("  |  threads ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{}/{}", self.active_thread_count(), self.threads.len()),
                Style::default().fg(Color::White),
            ),
            Span::styled("  |  runtime ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                runtime,
                Style::default().fg(if self.result_rx.is_some() {
                    Color::Green
                } else {
                    Color::White
                }),
            ),
            Span::styled(
                "  |  mouse drag copies pane text",
                Style::default().fg(Color::DarkGray),
            ),
        ]);

        frame.render_widget(Paragraph::new(Text::from(vec![top, bottom])), inner);
    }

    fn render_session_picker(&self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
            .split(area);

        self.render_session_picker_list(frame, sections[0]);
        self.render_session_picker_detail(frame, sections[1]);
    }

    fn render_session_picker_list(&self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block("SESSIONS");
        let inner = block.inner(area);
        frame.render_widget(block, area);
        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let mut lines = Vec::new();
        if let Some(error) = self.session_picker.error.as_deref() {
            lines.push(Line::from(Span::styled(
                fit_text(error, inner.width as usize),
                Style::default().fg(Color::Red),
            )));
        } else if self.session_picker.sessions.is_empty() {
            lines.push(Line::from(Span::styled(
                "No resumable sessions found.",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for (index, session) in self
                .session_picker
                .sessions
                .iter()
                .take(inner.height as usize)
                .enumerate()
            {
                let selected = index == self.session_picker.selected;
                let style = if selected {
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Cyan)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                let session_label = fit_text(&session.session_id, 18);
                let cwd_label = compact_path(
                    &session.cwd.display().to_string(),
                    inner.width.saturating_sub(24) as usize,
                );
                lines.push(Line::from(vec![
                    Span::styled(if selected { "› " } else { "  " }, style),
                    Span::styled(format!("{}  ", short_timestamp(&session.updated_at)), style),
                    Span::styled(session_label, style),
                    Span::styled("  ", style),
                    Span::styled(cwd_label, style),
                ]));
            }
        }

        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
    }

    fn render_session_picker_detail(&self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block("SESSION DETAIL");
        let inner = block.inner(area);
        frame.render_widget(block, area);
        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let mut lines = Vec::new();
        if let Some(session) = self
            .session_picker
            .sessions
            .get(self.session_picker.selected)
        {
            lines.push(Line::from(vec![
                Span::styled("session  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    session.session_id.clone(),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("updated  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    session.updated_at.clone(),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("created  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    session.created_at.clone(),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("cwd      ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    compact_path(
                        &session.cwd.display().to_string(),
                        inner.width.saturating_sub(9) as usize,
                    ),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("model    ", Style::default().fg(Color::DarkGray)),
                Span::styled(session.model.clone(), Style::default().fg(Color::White)),
            ]));
            lines.push(Line::from(vec![
                Span::styled("backend  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    session.backend.as_str().to_string(),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("sandbox  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    if session.sandboxed { "on" } else { "off" },
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("messages ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    session.visible_message_count.to_string(),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "last prompt",
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            )));
            let prompt_lines = session
                .last_user_prompt
                .as_deref()
                .map(split_preserving_empty)
                .unwrap_or_else(|| vec!["No user prompt recorded.".to_string()]);
            for line in prompt_lines {
                lines.push(Line::from(Span::styled(
                    line,
                    Style::default().fg(Color::DarkGray),
                )));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "Select a session to inspect.",
                Style::default().fg(Color::DarkGray),
            )));
        }

        frame.render_widget(
            Paragraph::new(Text::from(lines)).wrap(ratatui::widgets::Wrap { trim: false }),
            inner,
        );
    }

    fn render_session_picker_footer(&self, frame: &mut ratatui::Frame, area: Rect) {
        let title = if matches!(self.screen, ScreenMode::SessionPicker { startup: true }) {
            "RESUME"
        } else {
            "SESSIONS"
        };
        let lines = vec![
            Line::from(vec![
                Span::styled(
                    "Enter",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" resume  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    "↑/↓",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" navigate  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    "r",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" refresh  ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    "Esc",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    if matches!(self.screen, ScreenMode::SessionPicker { startup: true }) {
                        " exit"
                    } else {
                        " back"
                    },
                    Style::default().fg(Color::DarkGray),
                ),
            ]),
            Line::from(Span::styled(
                "Use /sessions from the composer to return here later.",
                Style::default().fg(Color::DarkGray),
            )),
        ];
        render_lines_panel(frame, area, title, lines);
    }

    fn render_left_column(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(10), Constraint::Min(10)])
            .split(area);

        self.render_prompt_panel(frame, sections[0]);
        self.render_events_panel(frame, sections[1]);
    }

    fn render_center_column(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(7),
                Constraint::Length(6),
                Constraint::Min(14),
                Constraint::Length(8),
            ])
            .split(area);

        self.render_threads_panel(frame, sections[0]);
        self.render_workspace_panel(frame, sections[1]);
        self.render_response_panel(frame, sections[2]);
        self.render_previous_response_panel(frame, sections[3]);
    }

    fn render_right_column(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(7),
                Constraint::Min(8),
                Constraint::Length(9),
            ])
            .split(area);

        self.render_tools_panel(frame, sections[0]);
        self.render_worksets_panel(frame, sections[1]);
        self.render_file_changes_panel(frame, sections[2]);
    }

    fn render_prompt_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = match self.last_prompt.as_deref() {
            Some(prompt) => split_preserving_empty(prompt),
            None => vec!["Waiting for the first orchestrator prompt.".to_string()],
        };
        self.render_selectable_panel(frame, area, PanelId::Prompt, "PROMPT", lines);
    }

    fn render_workspace_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = vec![
            format!("workspace  {}", self.workspace.workspace_display),
            match self.workspace.host_root.as_ref() {
                Some(path) => format!("source     {}", path.display()),
                None => "source     sandbox-only".to_string(),
            },
            format!(
                "repo       {}",
                self.workspace
                    .repo_label
                    .as_deref()
                    .unwrap_or("no git repo")
            ),
            format!(
                "branch     {}",
                self.workspace.branch.as_deref().unwrap_or("detached")
            ),
        ];

        self.render_selectable_panel(frame, area, PanelId::Workspace, "WORKSPACE", lines);
    }

    fn render_help_overlay(&self, frame: &mut ratatui::Frame, area: Rect) {
        let overlay_width = area.width.saturating_sub(12).min(68).max(44);
        let overlay_height = area.height.saturating_sub(8).min(16).max(12);
        let overlay = centered_rect(overlay_width, overlay_height, area);
        let block = panel_block("HELP");
        let inner = block.inner(overlay);
        frame.render_widget(Clear, overlay);
        frame.render_widget(block, overlay);
        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let lines = vec![
            Line::from(vec![
                Span::styled(
                    "Enter",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" run prompt", Style::default().fg(Color::White)),
            ]),
            Line::from(vec![
                Span::styled(
                    "Shift+Enter",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" newline", Style::default().fg(Color::White)),
            ]),
            Line::from(vec![
                Span::styled(
                    "Ctrl-T / Ctrl-E / Ctrl-R / Ctrl-P",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    " focus threads / events / response / previous",
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(vec![
                Span::styled(
                    "PageUp / PageDown",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" scroll focused pane", Style::default().fg(Color::White)),
            ]),
            Line::from(vec![
                Span::styled(
                    "Mouse wheel",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" scroll hovered pane", Style::default().fg(Color::White)),
            ]),
            Line::from(vec![
                Span::styled(
                    "/sessions",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" open session picker", Style::default().fg(Color::White)),
            ]),
            Line::from(vec![
                Span::styled(
                    "/batch /batch-run /plan /review",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    " create durable worksets",
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(""),
            Line::from(Span::styled(
                "? or Esc closes this overlay.",
                Style::default().fg(Color::DarkGray),
            )),
        ];

        frame.render_widget(
            Paragraph::new(Text::from(lines)).wrap(ratatui::widgets::Wrap { trim: false }),
            inner,
        );
    }

    fn render_threads_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let state_width = 8usize;
        let thread_width = width.min(18).max(10);
        let updated_width = 8usize;
        let action_width = width
            .saturating_sub(state_width + thread_width + updated_width + 3)
            .max(8);

        let mut lines = vec![header_line(
            &[
                ("STATE", state_width),
                ("THREAD", thread_width),
                ("ACTION", action_width),
                ("UPDATED", updated_width),
            ],
            width,
        )];

        let mut threads: Vec<&ThreadView> = self.threads.values().collect();
        threads.sort_by(|left, right| {
            matches!(right.state, ThreadState::Active)
                .cmp(&matches!(left.state, ThreadState::Active))
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.name.cmp(&right.name))
        });

        if threads.is_empty() {
            lines.push(Line::from(Span::styled(
                "No threads in this session yet.",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for thread in threads {
                let name = fit_text(&thread.name, thread_width);
                let action = fit_text(&thread.action, action_width);
                let updated = fit_text(&thread.updated_at, updated_width);
                lines.push(Line::from(vec![
                    status_span(thread.state.label(), thread.state.tone()),
                    Span::raw(pad_to(
                        "",
                        state_width.saturating_sub(thread.state.label().len()),
                    )),
                    Span::raw(" "),
                    Span::raw(pad_cell(&name, thread_width)),
                    Span::raw(" "),
                    Span::raw(pad_cell(&action, action_width)),
                    Span::raw(" "),
                    Span::styled(updated, Style::default().fg(Color::DarkGray)),
                ]));
            }
        }

        self.render_scrollable_lines_panel(frame, area, PanelId::Threads, "THREADS", lines);
    }

    fn render_events_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let height = area.height.saturating_sub(2) as usize;
        let lines: Vec<Line<'static>> = self
            .timeline
            .iter()
            .rev()
            .take(height.max(1))
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|entry| render_event_line(entry, inner_width(area)))
            .collect();

        let lines = if lines.is_empty() {
            vec![Line::from(Span::styled(
                "Waiting for activity.",
                Style::default().fg(Color::DarkGray),
            ))]
        } else {
            lines
        };

        let title = self.events_panel_title();

        render_lines_panel_with_title(frame, area, title, lines);
    }

    fn render_response_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = match self.last_response.as_deref() {
            Some(response) => {
                match &self.response_markdown_cache {
                    Some((cached_text, cached_lines)) if cached_text == response => {
                        cached_lines.clone()
                    }
                    _ => {
                        let lines = render_markdown_lines(response);
                        self.response_markdown_cache = Some((response.to_string(), lines.clone()));
                        lines
                    }
                }
            }
            None => vec![Line::from(Span::styled(
                "Waiting for the first orchestrator reply.",
                Style::default().fg(Color::DarkGray),
            ))],
        };
        let runtime = format_runtime(self.displayed_run_duration());
        let title = panel_title_segments(vec![
            Span::styled(
                "RESPONSE".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(
                runtime,
                Style::default().fg(if self.result_rx.is_some() {
                    Color::Green
                } else {
                    Color::Yellow
                }),
            ),
        ]);
        self.render_selectable_rich_panel_with_title(frame, area, PanelId::Response, title, lines);
    }

    fn render_previous_response_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = match self.previous_response.as_deref() {
            Some(response) => render_markdown_lines(response),
            None => vec![Line::from(Span::styled(
                "No previous orchestrator reply yet.",
                Style::default().fg(Color::DarkGray),
            ))],
        };
        self.render_selectable_rich_panel(
            frame,
            area,
            PanelId::PreviousResponse,
            "PREVIOUS RESPONSE",
            lines,
        );
    }

    fn render_focused_threads(&mut self, frame: &mut ratatui::Frame, body: Rect) {
        let left_width = (body.width as f64 * 0.33) as u16;
        let left_width = left_width.max(20);
        let right_width = body.width.saturating_sub(left_width + 1);

        let left_area = Rect::new(body.x, body.y, left_width, body.height);
        let right_area = Rect::new(body.x + left_width + 1, body.y, right_width, body.height);

        self.render_thread_list_pane(frame, left_area);
        self.render_episode_detail_pane(frame, right_area);
    }

    fn render_thread_list_pane(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let thread_names = self.sorted_thread_names();

        // Auto-select first thread if nothing selected
        if self.selected_thread.is_none() && !thread_names.is_empty() {
            self.selected_thread = Some(thread_names[0].clone());
        }

        // Auto-scroll to keep selected thread visible
        if let Some(ref selected) = self.selected_thread {
            if let Some(pos) = thread_names.iter().position(|n| n == selected) {
                let scroll = self.panel_scrolls.entry(PanelId::ThreadList).or_insert(0);
                let visible_height = area.height.saturating_sub(2) as usize;
                if pos < *scroll {
                    *scroll = pos;
                } else if pos >= *scroll + visible_height {
                    *scroll = pos.saturating_sub(visible_height - 1);
                }
            }
        }

        // Build styled lines for each thread
        let mut lines: Vec<Line<'static>> = Vec::new();
        let max_name_width = 18usize;
        let width = inner_width(area);

        for name in &thread_names {
            let thread = &self.threads[name];
            let is_selected = self.selected_thread.as_deref() == Some(name.as_str());

            let state_icon = match thread.state {
                ThreadState::Active => "●",
                ThreadState::Idle => "○",
            };

            let state_color = match thread.state {
                ThreadState::Active => Color::Green,
                ThreadState::Idle => Color::Gray,
            };

            let display_name = fit_text(name, max_name_width);
            let ep_count = format!("{:>3}e", thread.episodes);
            let action_width = width
                .saturating_sub(max_name_width + 8);
            let display_action = fit_text(&thread.action, action_width);

            let line_str = format!(
                "{} {:<max_name_width$} {}  {}",
                state_icon,
                display_name,
                ep_count,
                display_action,
                max_name_width = max_name_width,
            );

            if is_selected {
                lines.push(Line::styled(
                    line_str,
                    Style::default().fg(Color::White).bg(Color::DarkGray),
                ));
            } else {
                // Style state icon with state color, rest default
                let mut spans = vec![Span::styled(
                    state_icon.to_string(),
                    Style::default().fg(state_color),
                )];
                let rest = &line_str[state_icon.len()..];
                spans.push(Span::raw(rest.to_string()));
                lines.push(Line::from(spans));
            }
        }

        if lines.is_empty() {
            lines.push(Line::from(Span::styled(
                "No threads yet",
                Style::default().fg(Color::DarkGray),
            )));
        }

        self.render_scrollable_lines_panel_with_title(
            frame,
            area,
            PanelId::ThreadList,
            panel_title("THREADS"),
            lines,
        );
    }

    fn render_episode_detail_pane(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let episodes = self
            .selected_thread
            .as_ref()
            .and_then(|name| self.all_episodes.get(name));

        let thread_name = self.selected_thread.as_deref().unwrap_or("none");

        // Build lines, bypassing the markdown pipeline and cache for empty states
        // so that placeholder messages use the muted DarkGray style.
        let lines: Vec<Line<'static>> = if let Some(eps) = episodes {
            if eps.is_empty() {
                let mut lines = Vec::new();
                if let Some(thread) = self
                    .selected_thread
                    .as_ref()
                    .and_then(|name| self.threads.get(name))
                {
                    let mut header = String::new();
                    header.push_str(&format!("# Thread: {}\n", thread.name));
                    header.push_str(&format!(
                        "Action: {}  |  Episodes: {}  |  State: {:?}  |  Updated: {}\n",
                        thread.action, thread.episodes, thread.state, thread.updated_at
                    ));
                    header.push_str("\n---\n\n");
                    lines.extend(render_markdown_lines(&header));
                }
                lines.push(Line::from(Span::styled(
                    "No episodes yet.",
                    Style::default().fg(Color::DarkGray),
                )));
                lines
            } else {
                let mut combined = String::new();
                if let Some(thread) = self
                    .selected_thread
                    .as_ref()
                    .and_then(|name| self.threads.get(name))
                {
                    combined.push_str(&format!("# Thread: {}\n", thread.name));
                    combined.push_str(&format!(
                        "Action: {}  |  Episodes: {}  |  State: {:?}  |  Updated: {}\n",
                        thread.action, thread.episodes, thread.state, thread.updated_at
                    ));
                    combined.push_str("\n---\n\n");
                }
                for (i, ep) in eps.iter().enumerate() {
                    combined.push_str(&format!(
                        "### Episode {} | {} | action: {}\n\n",
                        i + 1,
                        ep.created_at,
                        ep.action
                    ));
                    combined.push_str(&ep.content);
                    if i < eps.len() - 1 {
                        combined.push_str("\n\n---\n\n");
                    }
                }
                match self.episode_markdown_cache.get(thread_name) {
                    Some(cached) => cached.clone(),
                    None => {
                        let rendered = render_markdown_lines(&combined);
                        self.episode_markdown_cache
                            .insert(thread_name.to_string(), rendered.clone());
                        rendered
                    }
                }
            }
        } else if self.selected_thread.is_some() {
            let mut lines = Vec::new();
            if let Some(thread) = self
                .selected_thread
                .as_ref()
                .and_then(|name| self.threads.get(name))
            {
                let mut header = String::new();
                header.push_str(&format!("# Thread: {}\n", thread.name));
                header.push_str(&format!(
                    "Action: {}  |  Episodes: {}  |  State: {:?}  |  Updated: {}\n",
                    thread.action, thread.episodes, thread.state, thread.updated_at
                ));
                header.push_str("\n---\n\n");
                lines.extend(render_markdown_lines(&header));
            }
            lines.push(Line::from(Span::styled(
                "Thread is running... no episodes yet.",
                Style::default().fg(Color::DarkGray),
            )));
            lines
        } else {
            vec![Line::from(Span::styled(
                "Select a thread to view episodes.",
                Style::default().fg(Color::DarkGray),
            ))]
        };
        let title = panel_title_segments(vec![
            Span::styled(
                "EPISODES — ".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(thread_name.to_string()),
        ]);
        self.render_selectable_rich_panel_with_title(
            frame,
            area,
            PanelId::ThreadEpisodes,
            title,
            lines,
        );
    }

    fn events_panel_title(&self) -> Line<'static> {
        let dot_color = if self.result_rx.is_some() {
            Color::Green
        } else {
            Color::Yellow
        };
        panel_title_segments(vec![
            Span::styled(
                "EVENTS".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled("●".to_string(), Style::default().fg(dot_color)),
        ])
    }

    fn render_tools_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let tool_width = width.min(14).max(9);
        let stat_width = 5usize;
        let duration_width = 8usize;
        let target_width = width
            .saturating_sub(tool_width + stat_width + duration_width + 3) // 3 = three 1-space gaps
            .max(8);
        let mut lines = vec![header_line(
            &[
                ("STAT", 5),
                ("TOOL", tool_width),
                ("TARGET", target_width),
                ("TIME", duration_width),
            ],
            width,
        )];

        let mut active: Vec<&ActiveTool> = self.active_tools.values().collect();
        active.sort_by(|left, right| left.name.cmp(&right.name));
        for tool in active {
            let label = tool_label(tool.thread_name.as_deref(), &tool.name);
            let stat_label = ToolStatus::Running.label();
            lines.push(Line::from(vec![
                status_span(stat_label, ToolStatus::Running.tone()),
                Span::raw(pad_to("", stat_width.saturating_sub(stat_label.len()))),
                Span::raw(" "),
                Span::raw(pad_cell(&fit_text(&label, tool_width), tool_width)),
                Span::raw(" "),
                Span::styled(
                    pad_cell(&fit_text(&tool.target, target_width), target_width),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::raw(" "),
                Span::styled(
                    pad_cell(&format_duration(tool.started_at.elapsed()), duration_width),
                    Style::default().fg(Color::Gray),
                ),
            ]));
        }

        for tool in self
            .recent_tools
            .iter()
            .take(area.height.saturating_sub(2) as usize)
        {
            let label = tool_label(tool.thread_name.as_deref(), &tool.name);
            let stat_label = tool.status.label();
            lines.push(Line::from(vec![
                status_span(stat_label, tool.status.tone()),
                Span::raw(pad_to("", stat_width.saturating_sub(stat_label.len()))),
                Span::raw(" "),
                Span::raw(pad_cell(&fit_text(&label, tool_width), tool_width)),
                Span::raw(" "),
                Span::styled(
                    pad_cell(&fit_text(&tool.target, target_width), target_width),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::raw(" "),
                Span::styled(
                    pad_cell(&format_duration(tool.duration), duration_width),
                    Style::default().fg(Color::Gray),
                ),
            ]));
        }

        if lines.len() == 1 {
            lines.push(Line::from(Span::styled(
                "No tool activity yet.",
                Style::default().fg(Color::DarkGray),
            )));
        }

        render_lines_panel(frame, area, "TOOLS", lines);
    }

    fn render_worksets_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let kind_width = 6usize;
        let status_width = 9usize;
        let count_width = 3usize;
        let id_width = width
            .saturating_sub(kind_width + status_width + count_width + 3)
            .max(8);
        let mut lines = vec![header_line(
            &[
                ("KIND", kind_width),
                ("STATUS", status_width),
                ("N", count_width),
                ("ID", id_width),
            ],
            width,
        )];

        if let Some(error) = self.worksets.error.as_deref() {
            lines.push(Line::from(Span::styled(
                fit_text(error, width),
                Style::default().fg(Color::DarkGray),
            )));
        } else if self.worksets.items.is_empty() {
            lines.push(Line::from(Span::styled(
                "No worksets yet.",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for workset in &self.worksets.items {
                let item_count = workset.items.len();
                lines.push(Line::from(vec![
                    Span::styled(
                        pad_cell(&fit_text(&workset.kind, kind_width), kind_width),
                        workset_kind_style(&workset.kind),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        pad_cell(&fit_text(&workset.status, status_width), status_width),
                        workset_status_style(&workset.status),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        pad_cell(&item_count.to_string(), count_width),
                        Style::default().fg(Color::Gray),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        fit_text(&workset.id, id_width),
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    ),
                ]));
                if !workset.summary.is_empty() {
                    lines.push(Line::from(Span::styled(
                        fit_text(&format!("  {}", workset.summary), width),
                        Style::default().fg(Color::DarkGray),
                    )));
                }
                if let Some(recipe) = workset.verification_recipe.as_deref() {
                    lines.push(Line::from(Span::styled(
                        fit_text(&format!("  verify {}", one_line(recipe)), width),
                        Style::default().fg(Color::DarkGray),
                    )));
                }
                for item in &workset.items {
                    lines.extend(render_workset_item_lines(item, width));
                }
            }
        }

        self.render_scrollable_lines_panel(frame, area, PanelId::Worksets, "WORKSETS", lines);
    }

    fn render_file_changes_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let height = area.height.saturating_sub(2) as usize;
        let width = inner_width(area);
        let mut lines = Vec::new();

        if let Some(error) = self.workspace.error.as_deref() {
            lines.push(Line::from(Span::styled(
                fit_text(error, width),
                Style::default().fg(Color::DarkGray),
            )));
        } else if self.workspace.changed_files.is_empty() {
            lines.push(Line::from(Span::styled(
                "Working tree clean.",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            let reserve_total = usize::from(height > 2);
            let visible_files = height.saturating_sub(reserve_total).min(FILE_CHANGE_LIMIT);
            for file in self.workspace.changed_files.iter().take(visible_files) {
                lines.push(render_file_change_line(file, width));
            }
            if reserve_total == 1 {
                lines.push(Line::from(vec![
                    Span::styled(
                        pad_cell("T", 1),
                        Style::default().fg(Color::DarkGray),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        format!(
                            "{:>width$}",
                            format!("+{}", self.workspace.total_additions),
                            width = 5
                        ),
                        Style::default().fg(Color::Green),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        format!(
                            "{:>width$}",
                            format!("-{}", self.workspace.total_deletions),
                            width = 5
                        ),
                        Style::default().fg(Color::Red),
                    ),
                ]));
            }
        }

        render_lines_panel(frame, area, "FILE CHANGES", lines);
    }

    fn render_composer(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block("ASK");
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        if self.result_rx.is_some() {
            self.life_field
                .ensure_size(inner.width as usize * 2, inner.height as usize * 4);
            let lines = self
                .life_field
                .render_lines(inner.width as usize, inner.height as usize);
            frame.render_widget(
                Paragraph::new(Text::from(lines)).style(Style::default().fg(Color::Green)),
                inner,
            );
            return;
        }

        self.maybe_expire_composer_notice();
        let show_notice = self.composer_notice.is_some() && inner.height > 1;
        let composer_area = Rect {
            x: inner.x,
            y: inner.y,
            width: inner.width,
            height: inner.height.saturating_sub(u16::from(show_notice)).max(1),
        };
        let view = wrapped_composer_view(
            self.composer.lines(),
            self.composer.cursor(),
            composer_area.width,
            composer_area.height,
        );

        frame.render_widget(
            Paragraph::new(Text::from(view.lines.clone())).style(Style::default().fg(Color::White)),
            composer_area,
        );
        frame.set_cursor_position((
            composer_area.x + view.cursor_col.min(composer_area.width.saturating_sub(1)),
            composer_area.y + view.cursor_row.min(composer_area.height.saturating_sub(1)),
        ));

        if let Some(notice) = self.composer_notice.as_ref().filter(|_| show_notice) {
            let notice_area = Rect {
                x: inner.x,
                y: inner.bottom().saturating_sub(1),
                width: inner.width,
                height: 1,
            };
            let notice_line = Line::from(Span::styled(
                fit_text(&notice.text, notice_area.width as usize),
                Style::default()
                    .fg(notice.tone.color())
                    .add_modifier(Modifier::BOLD),
            ));
            frame.render_widget(Paragraph::new(notice_line), notice_area);
        }
    }

    fn render_selectable_panel(
        &mut self,
        frame: &mut ratatui::Frame,
        area: Rect,
        panel_id: PanelId,
        title: &'static str,
        logical_lines: Vec<String>,
    ) {
        self.render_selectable_panel_with_title(
            frame,
            area,
            panel_id,
            panel_title(title),
            logical_lines,
        );
    }

    fn render_selectable_rich_panel(
        &mut self,
        frame: &mut ratatui::Frame,
        area: Rect,
        panel_id: PanelId,
        title: &'static str,
        lines: Vec<Line<'static>>,
    ) {
        self.render_selectable_rich_panel_with_title(
            frame,
            area,
            panel_id,
            panel_title(title),
            lines,
        );
    }

    fn render_selectable_panel_with_title(
        &mut self,
        frame: &mut ratatui::Frame,
        area: Rect,
        panel_id: PanelId,
        title: Line<'static>,
        logical_lines: Vec<String>,
    ) {
        let block = panel_block_with_title(title);
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let rows = wrap_logical_lines(&logical_lines, inner.width as usize);
        let total_rows = rows.len().max(1);
        let visible_rows = inner.height as usize;
        let max_scroll = total_rows.saturating_sub(visible_rows);
        let scroll = self.panel_scrolls.entry(panel_id).or_insert(0);
        *scroll = (*scroll).min(max_scroll);
        let start = *scroll;
        let end = (start + visible_rows).min(rows.len());
        let visible = rows[start..end].to_vec();

        let selected = selection_bounds_for_panel(self.selection.as_ref(), panel_id);
        let mut rendered = Vec::new();
        for row in &visible {
            rendered.push(render_wrapped_row(row, selected.clone()));
        }
        while rendered.len() < visible_rows {
            rendered.push(Line::from(""));
        }

        self.panel_views.insert(
            panel_id,
            PanelView {
                id: panel_id,
                inner,
                logical_lines: logical_lines.clone(),
                rows,
                scroll_offset: *scroll,
                visible_rows,
            },
        );

        frame.render_widget(Paragraph::new(Text::from(rendered)), inner);
    }

    fn render_selectable_rich_panel_with_title(
        &mut self,
        frame: &mut ratatui::Frame,
        area: Rect,
        panel_id: PanelId,
        title: Line<'static>,
        lines: Vec<Line<'static>>,
    ) {
        let block = panel_block_with_title(title);
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let logical_lines: Vec<String> = lines.iter().map(line_to_plain_text).collect();
        let rows = wrap_styled_lines(&lines, inner.width as usize);
        let total_rows = rows.len().max(1);
        let visible_rows = inner.height as usize;
        let max_scroll = total_rows.saturating_sub(visible_rows);
        let scroll = self.panel_scrolls.entry(panel_id).or_insert(0);
        *scroll = (*scroll).min(max_scroll);
        let start = *scroll;
        let end = (start + visible_rows).min(rows.len());
        let visible = rows[start..end].to_vec();

        let selected = selection_bounds_for_panel(self.selection.as_ref(), panel_id);
        let mut rendered = Vec::new();
        for row in &visible {
            rendered.push(render_wrapped_row(row, selected.clone()));
        }
        while rendered.len() < visible_rows {
            rendered.push(Line::from(""));
        }

        self.panel_views.insert(
            panel_id,
            PanelView {
                id: panel_id,
                inner,
                logical_lines,
                rows,
                scroll_offset: *scroll,
                visible_rows,
            },
        );

        frame.render_widget(Paragraph::new(Text::from(rendered)), inner);
    }

    fn render_scrollable_lines_panel(
        &mut self,
        frame: &mut ratatui::Frame,
        area: Rect,
        panel_id: PanelId,
        title: &'static str,
        lines: Vec<Line<'static>>,
    ) {
        self.render_scrollable_lines_panel_with_title(
            frame,
            area,
            panel_id,
            panel_title(title),
            lines,
        );
    }

    fn render_scrollable_lines_panel_with_title(
        &mut self,
        frame: &mut ratatui::Frame,
        area: Rect,
        panel_id: PanelId,
        title: Line<'static>,
        lines: Vec<Line<'static>>,
    ) {
        let block = panel_block_with_title(title);
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let logical_lines: Vec<String> = lines.iter().map(line_to_plain_text).collect();
        let mut rows: Vec<WrappedRow> = logical_lines
            .iter()
            .enumerate()
            .map(|(index, text)| WrappedRow {
                logical_line: index,
                start_char: 0,
                end_char: text.chars().count(),
                text: text.clone(),
                spans: vec![StyledSegment {
                    text: text.clone(),
                    style: Style::default().fg(Color::Gray),
                }],
            })
            .collect();
        if rows.is_empty() {
            rows.push(WrappedRow {
                logical_line: 0,
                start_char: 0,
                end_char: 0,
                text: String::new(),
                spans: Vec::new(),
            });
        }

        let visible_rows = inner.height as usize;
        let max_scroll = rows.len().saturating_sub(visible_rows);
        let scroll = self.panel_scrolls.entry(panel_id).or_insert(0);
        *scroll = (*scroll).min(max_scroll);
        let start = *scroll;
        let mut visible: Vec<Line<'static>> =
            lines.into_iter().skip(start).take(visible_rows).collect();
        while visible.len() < visible_rows {
            visible.push(Line::from(""));
        }

        self.panel_views.insert(
            panel_id,
            PanelView {
                id: panel_id,
                inner,
                logical_lines,
                rows,
                scroll_offset: *scroll,
                visible_rows,
            },
        );

        frame.render_widget(Paragraph::new(Text::from(visible)), inner);
    }

    fn selection_point_at(&self, column: u16, row: u16) -> Option<SelectionPoint> {
        let panel = self.panel_at(column, row)?;
        if !panel_is_selectable(panel) {
            return None;
        }
        self.selection_point_for_panel(panel, column, row)
    }

    fn panel_at(&self, column: u16, row: u16) -> Option<PanelId> {
        self.panel_views.iter().find_map(|(panel_id, view)| {
            contains_point(view.inner, column, row).then_some(*panel_id)
        })
    }

    fn selection_point_for_panel(
        &self,
        panel: PanelId,
        column: u16,
        row: u16,
    ) -> Option<SelectionPoint> {
        let view = self.panel_views.get(&panel)?;
        let clamped_x = column.clamp(view.inner.x, view.inner.right().saturating_sub(1));
        let clamped_y = row.clamp(view.inner.y, view.inner.bottom().saturating_sub(1));
        let row_offset = clamped_y.saturating_sub(view.inner.y) as usize;
        let scroll_offset = self
            .panel_scrolls
            .get(&panel)
            .copied()
            .unwrap_or(view.scroll_offset);
        let row_index = (scroll_offset + row_offset).min(view.rows.len().saturating_sub(1));
        let wrapped = view.rows.get(row_index)?;
        let width = wrapped.text.chars().count();
        let col_offset = clamped_x.saturating_sub(view.inner.x) as usize;
        let char_in_row = col_offset.min(width);
        Some(SelectionPoint {
            panel,
            logical_line: wrapped.logical_line,
            char_index: wrapped.start_char + char_in_row,
        })
    }

    fn autoscroll_drag_selection(&mut self, panel: PanelId, _column: u16, row: u16) {
        let Some((top, bottom)) = self
            .panel_views
            .get(&panel)
            .map(|view| (view.inner.y, view.inner.bottom().saturating_sub(1)))
        else {
            return;
        };

        if row <= top {
            self.scroll_panel(panel, -1);
        } else if row >= bottom {
            self.scroll_panel(panel, 1);
        }
    }

    fn scroll_panel(&mut self, panel: PanelId, delta_lines: isize) {
        let Some(view) = self.panel_views.get(&panel) else {
            return;
        };
        let max_scroll = view.rows.len().saturating_sub(view.visible_rows);
        let entry = self.panel_scrolls.entry(panel).or_insert(0);
        if delta_lines.is_negative() {
            *entry = entry.saturating_sub(delta_lines.unsigned_abs());
        } else {
            *entry = (*entry)
                .saturating_add(delta_lines as usize)
                .min(max_scroll);
        }
    }

    fn copy_selection_to_clipboard(&mut self) {
        let Some(selection) = self.selection.as_ref() else {
            return;
        };
        if selection.anchor.panel != selection.focus.panel {
            return;
        }
        let Some(view) = self.panel_views.get(&selection.anchor.panel) else {
            return;
        };
        let text = extract_selection_text(view, selection);
        if text.is_empty() {
            return;
        }
        let _ = copy_text_to_clipboard(&text);
    }
}

#[derive(Debug)]
enum AppAction {
    None,
    Quit,
    Submit(String),
    ResumeSession(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SlashCommand {
    Exit,
    Sessions,
    Batch { instruction: String },
    BatchRun { instruction: String },
    Plan { instruction: String },
    Review { instruction: String },
}

pub enum TuiOutcome {
    Exit,
    ResumeSession(String),
}

pub async fn run(
    mut agent: Agent,
    initial_prompt: Option<String>,
    metadata: TuiMetadata,
    restored_messages: Vec<Message>,
    mut session_snapshot: Option<SessionSnapshot>,
    start_in_session_picker: bool,
) -> Result<TuiOutcome> {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<CrosstermEvent>();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AgentEvent>();

    agent.set_event_sink(EventSink::channel(event_tx));
    let agent = Arc::new(Mutex::new(agent));

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    crossterm::execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.hide_cursor()?;

    let keyboard_enhancements_enabled = enable_keyboard_enhancements(&mut terminal);
    let bracketed_paste_enabled = enable_bracketed_paste(&mut terminal);
    let mouse_capture_enabled = enable_mouse_capture(&mut terminal);

    let running = Arc::new(AtomicBool::new(true));
    let input_thread = spawn_input_thread(running.clone(), input_tx);

    let mut app = App::new(metadata, &restored_messages, start_in_session_picker);
    let (ws_tx, ws_rx) = mpsc::channel::<WorkspaceSnapshot>(1);
    app.workspace_tx = Some(ws_tx);
    app.workspace_rx = Some(ws_rx);
    let mut animation_tick = time::interval(Duration::from_millis(75));
    animation_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    terminal.draw(|frame| app.render(frame))?;

    if let Some(prompt) = initial_prompt {
        submit_prompt(
            prompt,
            agent.clone(),
            &mut app,
            &mut terminal,
        )?;
    }

    let mut outcome = TuiOutcome::Exit;

    let loop_result = async {
        while !app.quit {
            tokio::select! {
                event = input_rx.recv() => {
                    match event {
                        Some(event) => {
                            let mut terminal_action = false;
                            if let Some(action) = app.handle_crossterm_event(event) {
                                match action {
                                    AppAction::Submit(prompt) => {
                                        submit_prompt(prompt, agent.clone(), &mut app, &mut terminal)?;
                                        terminal_action = true;
                                    }
                                    AppAction::ResumeSession(session_id) => {
                                        outcome = TuiOutcome::ResumeSession(session_id);
                                        app.quit = true;
                                        terminal_action = true;
                                    }
                                    AppAction::Quit | AppAction::None => {}
                                }
                            }
                            if !terminal_action {
                                while let Ok(next_event) = input_rx.try_recv() {
                                    if let Some(action) = app.handle_crossterm_event(next_event) {
                                        match action {
                                            AppAction::Submit(prompt) => {
                                                submit_prompt(prompt, agent.clone(), &mut app, &mut terminal)?;
                                                break;
                                            }
                                            AppAction::ResumeSession(session_id) => {
                                                outcome = TuiOutcome::ResumeSession(session_id);
                                                app.quit = true;
                                                break;
                                            }
                                            AppAction::Quit => {
                                                app.quit = true;
                                                break;
                                            }
                                            AppAction::None => {}
                                        }
                                    }
                                }
                            }
                        }
                        None => {
                            eprintln!("ERROR: input thread terminated unexpectedly, shutting down");
                            app.quit = true;
                        }
                    }
                }
                Some(agent_event) = event_rx.recv() => {
                    app.apply_agent_event(agent_event);
                }
                result = async {
                    match app.result_rx.as_mut() {
                        Some(rx) => match rx.await {
                            Ok(val) => Some(val),
                            Err(_) => Some(Err("Internal error: agent task terminated unexpectedly".to_string())),
                        },
                        None => std::future::pending::<Option<Result<String, String>>>().await,
                    }
                } => {
                    if let Some(result) = result {
                        let completed_duration = app
                            .working_started_at
                            .map(|started| started.elapsed())
                            .unwrap_or_default();
                        app.result_rx = None;
                        app.working_frame = 0;
                        app.working_started_at = None;
                        app.reset_life();
                        if let Some(snapshot) = session_snapshot.as_mut() {
                            let agent = agent.lock().await;
                            persist_session_snapshot(snapshot, &agent)?;
                        }
                        match result {
                            Ok(_) => {
                                app.last_response_duration = completed_duration;
                            }
                            Err(error) => {
                                app.note_send_error(error);
                            }
                        }
                    }
                }
                _ = animation_tick.tick() => {
                    if app.result_rx.is_some() {
                        app.working_frame = app.working_frame.wrapping_add(1);
                        app.advance_life();
                    }
                    app.maybe_refresh_workspace();
                }
            }

            app.check_workspace_channel();
            terminal.draw(|frame| app.render(frame))?;
        }

        Ok::<(), anyhow::Error>(())
    }
    .await;

    running.store(false, AtomicOrdering::SeqCst);
    let _ = input_thread.join();

    let cleanup_result = (|| -> io::Result<()> {
        if keyboard_enhancements_enabled {
            let _ = crossterm::execute!(terminal.backend_mut(), PopKeyboardEnhancementFlags);
        }
        if bracketed_paste_enabled {
            let _ = crossterm::execute!(terminal.backend_mut(), DisableBracketedPaste);
        }
        if mouse_capture_enabled {
            let _ = crossterm::execute!(terminal.backend_mut(), DisableMouseCapture);
        }
        terminal.show_cursor()?;
        crossterm::execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
        disable_raw_mode()
    })();

    loop_result?;
    cleanup_result?;
    Ok(outcome)
}

fn submit_prompt(
    prompt: String,
    agent: Arc<Mutex<Agent>>,
    app: &mut App,
    terminal: &mut UiTerminal,
) -> Result<()> {
    let agent_prompt = expand_user_prompt(&prompt);
    app.note_prompt_submitted(&prompt);
    app.current_prompt = prompt;
    app.clear_composer();
    app.working_frame = 0;
    app.working_started_at = Some(Instant::now());
    app.reset_life();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.result_rx = Some(rx);

    tokio::spawn(async move {
        let result = {
            let mut agent = agent.lock().await;
            match tokio::time::timeout(WORKING_TIMEOUT, agent.send(&agent_prompt)).await {
                Ok(send_result) => send_result.map_err(|error| error.to_string()),
                Err(_elapsed) => Err("Request timed out after 10 minutes".to_string()),
            }
        };
        let _ = tx.send(result);
    });

    terminal.draw(|frame| app.render(frame))?;
    Ok(())
}

fn build_composer() -> TextArea<'static> {
    TextArea::default()
}

fn render_lines_panel(
    frame: &mut ratatui::Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
) {
    render_lines_panel_with_title(frame, area, panel_title(title), lines);
}

fn render_lines_panel_with_title(
    frame: &mut ratatui::Frame,
    area: Rect,
    title: Line<'static>,
    lines: Vec<Line<'static>>,
) {
    let block = panel_block_with_title(title);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    frame.render_widget(Clear, inner);
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
fn render_event_line(entry: &TimelineEntry, width: usize) -> Line<'static> {
    let (action, detail) = entry
        .detail
        .split_once(" • ")
        .map(|(action, detail)| (action.to_string(), detail.to_string()))
        .unwrap_or_else(|| (entry.detail.clone(), String::new()));

    let timestamp = fit_text(&entry.timestamp, 8);
    let actor = fit_text(&entry.actor, (width / 5).clamp(8, 16));
    let action = fit_text(&action, (width / 4).clamp(10, 20));

    let action_style = match entry.tone {
        Tone::Muted => Style::default()
            .fg(Color::Gray)
            .add_modifier(Modifier::BOLD),
        _ => Style::default()
            .fg(entry.tone.color())
            .add_modifier(Modifier::BOLD),
    };

    let prefix_width = timestamp.chars().count()
        + tone_glyph(entry.tone).chars().count()
        + actor.chars().count()
        + action.chars().count()
        + 10;
    let detail_width = width.saturating_sub(prefix_width);

    let mut spans = vec![
        Span::styled(timestamp, Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled(
            tone_glyph(entry.tone),
            Style::default().fg(entry.tone.color()),
        ),
        Span::raw(" "),
        Span::styled(
            actor,
            Style::default()
                .fg(actor_color(&entry.actor, entry.tone))
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" • ", Style::default().fg(Color::DarkGray)),
        Span::styled(action, action_style),
    ];

    if detail_width > 0 && !detail.is_empty() {
        spans.push(Span::styled(" • ", Style::default().fg(Color::DarkGray)));
        spans.push(Span::styled(
            fit_text(&detail, detail_width),
            Style::default().fg(Color::DarkGray),
        ));
    }

    Line::from(spans)
}

fn render_file_change_line(file: &ChangedFileStat, width: usize) -> Line<'static> {
    let status_width = 1usize;
    let delta_width = 5usize;
    let path_width = width.saturating_sub(status_width + delta_width * 2 + 3);
    let additions = file
        .additions
        .map(|value| format!("+{value}"))
        .unwrap_or_else(|| "+-".to_string());
    let deletions = file
        .deletions
        .map(|value| format!("-{value}"))
        .unwrap_or_else(|| "--".to_string());

    Line::from(vec![
        Span::styled(
            pad_cell(&file.status, status_width),
            file_status_style(&file.status),
        ),
        Span::raw(" "),
        Span::styled(
            format!("{additions:>width$}", width = delta_width),
            Style::default().fg(Color::Green),
        ),
        Span::raw(" "),
        Span::styled(
            format!("{deletions:>width$}", width = delta_width),
            Style::default().fg(Color::Red),
        ),
        Span::raw(" "),
        Span::styled(
            compact_path(&file.path, path_width),
            Style::default().fg(Color::Gray),
        ),
    ])
}

fn render_workset_item_lines(item: &store::WorksetItemRecord, width: usize) -> Vec<Line<'static>> {
    let status_width = 9usize;
    let kind_width = 9usize;
    let thread_width = width.saturating_sub(status_width + kind_width + 10).max(10);
    let title_width = width.saturating_sub(2);
    let scope_width = width.saturating_sub(8);
    let mut lines = vec![Line::from(vec![
        Span::styled("  ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            pad_cell(&fit_text(&item.status, status_width), status_width),
            workset_status_style(&item.status),
        ),
        Span::raw(" "),
        Span::styled(
            pad_cell(&fit_text(&item.item_kind, kind_width), kind_width),
            Style::default().fg(Color::Cyan),
        ),
        Span::raw(" "),
        Span::styled(
            fit_text(&item.thread_name, thread_width),
            Style::default().fg(Color::White),
        ),
    ])];

    lines.push(Line::from(vec![
        Span::styled("    ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            fit_text(&item.title, title_width),
            Style::default()
                .fg(Color::Gray)
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    if !item.scope.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("    @ ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                fit_text(&item.scope, scope_width),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    lines
}

fn panel_block(title: &str) -> Block<'static> {
    panel_block_with_title(panel_title(title))
}

fn panel_block_with_title(title: Line<'static>) -> Block<'static> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
}

fn panel_title(title: &str) -> Line<'static> {
    panel_title_segments(vec![Span::styled(
        title.to_string(),
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )])
}

fn panel_title_segments(segments: Vec<Span<'static>>) -> Line<'static> {
    let mut spans = Vec::with_capacity(segments.len() + 2);
    let border_style = Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::BOLD);
    spans.push(Span::styled(" [ ", border_style));
    spans.extend(segments);
    spans.push(Span::styled(" ] ", border_style));
    Line::from(spans)
}

fn header_line(columns: &[(&str, usize)], width: usize) -> Line<'static> {
    let mut content = String::new();
    for (index, (label, column_width)) in columns.iter().enumerate() {
        if index > 0 {
            content.push_str(" ");
        }
        content.push_str(&pad_cell(label, *column_width));
    }
    Line::from(Span::styled(
        fit_text(&content, width),
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
    ))
}

fn render_wrapped_row(
    row: &WrappedRow,
    selection: Option<(SelectionPoint, SelectionPoint)>,
) -> Line<'static> {
    let selected_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    let Some((start, end)) = selection else {
        if row.spans.is_empty() {
            return Line::from("");
        }
        return Line::from(
            row.spans
                .iter()
                .map(|segment| Span::styled(segment.text.clone(), segment.style))
                .collect::<Vec<_>>(),
        );
    };
    let Some((selection_start, selection_end)) = selection_overlap_for_row(row, &start, &end)
    else {
        if row.spans.is_empty() {
            return Line::from("");
        }
        return Line::from(
            row.spans
                .iter()
                .map(|segment| Span::styled(segment.text.clone(), segment.style))
                .collect::<Vec<_>>(),
        );
    };

    if row.text.is_empty() || selection_start == selection_end {
        if row.spans.is_empty() {
            return Line::from("");
        }
        return Line::from(
            row.spans
                .iter()
                .map(|segment| Span::styled(segment.text.clone(), segment.style))
                .collect::<Vec<_>>(),
        );
    }

    let mut spans = Vec::new();
    let mut offset = 0usize;
    for segment in &row.spans {
        let segment_len = segment.text.chars().count();
        let segment_start = offset;
        let segment_end = offset + segment_len;
        let overlap_start = selection_start.max(segment_start);
        let overlap_end = selection_end.min(segment_end);

        if overlap_start >= overlap_end {
            if !segment.text.is_empty() {
                spans.push(Span::styled(segment.text.clone(), segment.style));
            }
            offset = segment_end;
            continue;
        }

        let before_len = overlap_start.saturating_sub(segment_start);
        let selected_len = overlap_end.saturating_sub(overlap_start);
        let after_len = segment_end.saturating_sub(overlap_end);

        if before_len > 0 {
            spans.push(Span::styled(
                take_chars(&segment.text, before_len),
                segment.style,
            ));
        }
        if selected_len > 0 {
            let selected_text: String = segment
                .text
                .chars()
                .skip(before_len)
                .take(selected_len)
                .collect();
            spans.push(Span::styled(selected_text, selected_style));
        }
        if after_len > 0 {
            let after_text: String = segment
                .text
                .chars()
                .skip(before_len + selected_len)
                .take(after_len)
                .collect();
            spans.push(Span::styled(after_text, segment.style));
        }
        offset = segment_end;
    }
    if spans.is_empty() {
        Line::from("")
    } else {
        Line::from(spans)
    }
}

fn selection_bounds_for_panel(
    selection: Option<&SelectionState>,
    panel: PanelId,
) -> Option<(SelectionPoint, SelectionPoint)> {
    let selection = selection?;
    if selection.anchor.panel != panel || selection.focus.panel != panel {
        return None;
    }
    let (start, end) = ordered_points(&selection.anchor, &selection.focus);
    Some((start.clone(), end.clone()))
}

fn ordered_points<'a>(
    left: &'a SelectionPoint,
    right: &'a SelectionPoint,
) -> (&'a SelectionPoint, &'a SelectionPoint) {
    if compare_points(left, right).is_le() {
        (left, right)
    } else {
        (right, left)
    }
}

fn compare_points(left: &SelectionPoint, right: &SelectionPoint) -> Ordering {
    left.logical_line
        .cmp(&right.logical_line)
        .then_with(|| left.char_index.cmp(&right.char_index))
}

fn selection_overlap_for_row(
    row: &WrappedRow,
    start: &SelectionPoint,
    end: &SelectionPoint,
) -> Option<(usize, usize)> {
    if row.logical_line < start.logical_line || row.logical_line > end.logical_line {
        return None;
    }

    let row_start = row.start_char;
    let mut row_end = row.end_char;
    if row_start == row_end && row.text.is_empty() {
        row_end = row_start;
    }

    let selection_start = if row.logical_line == start.logical_line {
        start.char_index.max(row_start)
    } else {
        row_start
    };
    let selection_end = if row.logical_line == end.logical_line {
        end.char_index.min(row_end)
    } else {
        row_end
    };

    if selection_start >= selection_end {
        return None;
    }

    Some((
        selection_start.saturating_sub(row.start_char),
        selection_end.saturating_sub(row.start_char),
    ))
}

fn extract_selection_text(view: &PanelView, selection: &SelectionState) -> String {
    let (start, end) = ordered_points(&selection.anchor, &selection.focus);
    if start.panel != view.id || end.panel != view.id {
        return String::new();
    }
    if compare_points(start, end) == Ordering::Equal {
        return String::new();
    }

    let mut out = String::new();
    for logical_line in start.logical_line..=end.logical_line {
        let Some(line) = view.logical_lines.get(logical_line) else {
            continue;
        };
        let line_len = line.chars().count();
        let start_char = if logical_line == start.logical_line {
            start.char_index.min(line_len)
        } else {
            0
        };
        let end_char = if logical_line == end.logical_line {
            end.char_index.min(line_len)
        } else {
            line_len
        };
        if end_char > start_char {
            out.push_str(&slice_chars(line, start_char, end_char));
        }
        if logical_line < end.logical_line {
            out.push('\n');
        }
    }
    out
}

fn slice_chars(text: &str, start: usize, end: usize) -> String {
    text.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn classify_tool_status(is_error: bool, preview: &str) -> ToolStatus {
    if is_error {
        return ToolStatus::Error;
    }
    if preview.starts_with("Command timed out after") {
        return ToolStatus::TimedOut;
    }
    if preview.starts_with("Exit code:") {
        return ToolStatus::Failed;
    }
    ToolStatus::Ok
}

fn panel_is_selectable(panel: PanelId) -> bool {
    matches!(
        panel,
        PanelId::Prompt | PanelId::Response | PanelId::PreviousResponse | PanelId::Workspace
    )
}

fn line_to_plain_text(line: &Line<'_>) -> String {
    line.spans
        .iter()
        .map(|span| span.content.as_ref())
        .collect::<Vec<_>>()
        .join("")
}

fn status_span(label: &str, tone: Tone) -> Span<'static> {
    Span::styled(
        label.to_string(),
        Style::default()
            .fg(tone.color())
            .add_modifier(Modifier::BOLD),
    )
}

fn tool_label(thread_name: Option<&str>, tool_name: &str) -> String {
    match thread_name {
        Some(thread_name) => format!("{thread_name}/{tool_name}"),
        None => tool_name.to_string(),
    }
}

fn format_duration(duration: Duration) -> String {
    if duration.as_secs() >= 60 {
        let minutes = duration.as_secs() / 60;
        let seconds = duration.as_secs() % 60;
        format!("{minutes}m{seconds:02}s")
    } else if duration.as_secs() > 0 {
        format!("{:.1}s", duration.as_secs_f64())
    } else {
        format!("{}ms", duration.as_millis())
    }
}

fn format_runtime(duration: Duration) -> String {
    let total_seconds = duration.as_secs();
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;
    format!("{hours:02}h{minutes:02}m{seconds:02}s")
}

fn compact_path(path: &str, max_width: usize) -> String {
    if path.chars().count() <= max_width {
        return path.to_string();
    }
    if max_width <= 1 {
        return "…".to_string();
    }
    let suffix_len = max_width.saturating_sub(1);
    let suffix: String = path
        .chars()
        .rev()
        .take(suffix_len)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("…{suffix}")
}

fn fit_text(text: &str, max_width: usize) -> String {
    if text.chars().count() <= max_width {
        return text.to_string();
    }
    if max_width == 0 {
        return String::new();
    }
    if max_width == 1 {
        return "…".to_string();
    }
    let mut out = take_chars(text, max_width - 1);
    out.push('…');
    out
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn pad_cell(text: &str, width: usize) -> String {
    format!("{:<width$}", fit_text(text, width), width = width)
}

fn pad_to(text: &str, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    format!("{text:<width$}")
}

fn inner_width(area: Rect) -> usize {
    area.width.saturating_sub(2) as usize
}

fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    let overlay_width = width.min(area.width);
    let overlay_height = height.min(area.height);
    let x = area.x + area.width.saturating_sub(overlay_width) / 2;
    let y = area.y + area.height.saturating_sub(overlay_height) / 2;
    Rect::new(x, y, overlay_width, overlay_height)
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

fn parse_remote_label(remote: &str) -> Option<String> {
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

fn parse_status_porcelain(raw: &str) -> (GitStatusCounts, HashMap<String, ChangedFileStat>) {
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
            "??".to_string()
        } else {
            let x = status.chars().next().unwrap_or(' ');
            let y = status.chars().nth(1).unwrap_or(' ');
            if x != ' ' {
                counts.staged += 1;
            }
            if status.contains('R') {
                counts.renamed += 1;
                "REN".to_string()
            } else if status.contains('A') {
                counts.added += 1;
                "ADD".to_string()
            } else if status.contains('D') {
                counts.deleted += 1;
                "DEL".to_string()
            } else {
                if x != ' ' || y != ' ' {
                    counts.modified += 1;
                }
                "MOD".to_string()
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

fn parse_numstat_pairs(
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

struct WrappedComposerView {
    lines: Vec<Line<'static>>,
    cursor_row: u16,
    cursor_col: u16,
}

fn wrapped_composer_view(
    lines: &[String],
    cursor: (usize, usize),
    width: u16,
    height: u16,
) -> WrappedComposerView {
    let prefix_width = composer_prefix_width();
    let content_width = width.max(1) as usize;
    let effective_width = content_width.saturating_sub(prefix_width).max(1);
    let slash_mode = composer_is_slash_mode(lines);

    if lines.len() == 1 && lines.first().is_some_and(|line| line.is_empty()) {
        return WrappedComposerView {
            lines: vec![prompt_line(true, "", false)],
            cursor_row: 0,
            cursor_col: prefix_width as u16,
        };
    }

    let mut visual_lines = Vec::new();
    let mut cursor_row = 0usize;
    let mut cursor_col = 0usize;
    let mut cursor_set = false;

    for (row, line) in lines.iter().enumerate() {
        let display_line = if slash_mode && row == 0 {
            line.strip_prefix('/').unwrap_or(line)
        } else {
            line.as_str()
        };
        let display_cursor = if slash_mode && row == 0 {
            cursor.1.saturating_sub(1)
        } else {
            cursor.1
        };
        let segments = wrap_soft_line(display_line, effective_width);
        let mut start = 0usize;
        for (segment_index, segment) in segments.iter().enumerate() {
            let segment_len = segment.chars().count();
            let end = start + segment_len;
            if !cursor_set && row == cursor.0 {
                let is_last_segment = segment_index + 1 == segments.len();
                if display_cursor <= end || is_last_segment {
                    cursor_row = visual_lines.len();
                    cursor_col =
                        prefix_width + display_cursor.saturating_sub(start).min(segment_len);
                    cursor_set = true;
                }
            }
            let is_first_visual = visual_lines.is_empty();
            visual_lines.push((is_first_visual, segment.clone()));
            start = end;
        }

        if !cursor_set && row == cursor.0 && line.is_empty() {
            cursor_row = visual_lines.len().saturating_sub(1);
            cursor_col = prefix_width;
            cursor_set = true;
        }
    }

    if !cursor_set {
        cursor_row = visual_lines.len().saturating_sub(1);
        cursor_col = visual_lines
            .last()
            .map(|(_, line)| prefix_width + line.chars().count())
            .unwrap_or(prefix_width);
    }

    let height = height.max(1) as usize;
    let scroll_top = cursor_row.saturating_sub(height.saturating_sub(1));
    let visible = visual_lines
        .into_iter()
        .skip(scroll_top)
        .take(height)
        .map(|(is_first, line)| prompt_line(is_first, &line, slash_mode))
        .collect();

    WrappedComposerView {
        lines: visible,
        cursor_row: cursor_row.saturating_sub(scroll_top) as u16,
        cursor_col: cursor_col as u16,
    }
}

fn wrap_logical_lines(lines: &[String], width: usize) -> Vec<WrappedRow> {
    let mut rows = Vec::new();
    for (logical_line, line) in lines.iter().enumerate() {
        let wrapped = wrap_soft_line_with_ranges(line, width);
        if wrapped.is_empty() {
            rows.push(WrappedRow {
                logical_line,
                start_char: 0,
                end_char: 0,
                text: String::new(),
                spans: Vec::new(),
            });
            continue;
        }
        for (start_char, end_char, text) in wrapped {
            rows.push(WrappedRow {
                logical_line,
                start_char,
                end_char,
                spans: vec![StyledSegment {
                    text: text.clone(),
                    style: Style::default().fg(Color::Gray),
                }],
                text,
            });
        }
    }
    if rows.is_empty() {
        rows.push(WrappedRow {
            logical_line: 0,
            start_char: 0,
            end_char: 0,
            text: String::new(),
            spans: Vec::new(),
        });
    }
    rows
}

fn wrap_styled_lines(lines: &[Line<'static>], width: usize) -> Vec<WrappedRow> {
    let mut rows = Vec::new();
    for (logical_line, line) in lines.iter().enumerate() {
        let plain = line_to_plain_text(line);
        if plain.is_empty() {
            rows.push(WrappedRow {
                logical_line,
                start_char: 0,
                end_char: 0,
                text: String::new(),
                spans: Vec::new(),
            });
            continue;
        }

        let wrapped_ranges = wrap_soft_line_with_ranges(&plain, width);
        let chars = flatten_line_chars(line);
        for (start_char, end_char, text) in wrapped_ranges {
            rows.push(WrappedRow {
                logical_line,
                start_char,
                end_char,
                spans: group_styled_chars(&chars[start_char..end_char]),
                text,
            });
        }
    }

    if rows.is_empty() {
        rows.push(WrappedRow {
            logical_line: 0,
            start_char: 0,
            end_char: 0,
            text: String::new(),
            spans: Vec::new(),
        });
    }

    rows
}

fn flatten_line_chars(line: &Line<'static>) -> Vec<(char, Style)> {
    let mut chars = Vec::new();
    for span in &line.spans {
        for ch in span.content.chars() {
            chars.push((ch, span.style));
        }
    }
    chars
}

fn group_styled_chars(chars: &[(char, Style)]) -> Vec<StyledSegment> {
    let mut segments = Vec::new();
    let mut current_style = None;
    let mut current_text = String::new();

    for (ch, style) in chars {
        match current_style {
            Some(existing) if existing == *style => current_text.push(*ch),
            Some(existing) => {
                segments.push(StyledSegment {
                    text: std::mem::take(&mut current_text),
                    style: existing,
                });
                current_style = Some(*style);
                current_text.push(*ch);
            }
            None => {
                current_style = Some(*style);
                current_text.push(*ch);
            }
        }
    }

    if let Some(style) = current_style {
        segments.push(StyledSegment {
            text: current_text,
            style,
        });
    }

    segments
}

fn wrap_soft_line_with_ranges(line: &str, width: usize) -> Vec<(usize, usize, String)> {
    if width == 0 {
        return vec![(0, 0, String::new())];
    }
    if line.is_empty() {
        return vec![(0, 0, String::new())];
    }

    let chars: Vec<char> = line.chars().collect();
    let mut segments = Vec::new();
    let mut start = 0usize;

    while start < chars.len() {
        let remaining = chars.len() - start;
        if remaining <= width {
            segments.push((start, chars.len(), chars[start..].iter().collect()));
            break;
        }

        let slice_end = start + width;
        let mut split = None;
        for idx in (start..slice_end).rev() {
            if chars[idx].is_whitespace() {
                split = Some(idx + 1);
                break;
            }
        }

        let end = split.unwrap_or(slice_end);
        if end == start {
            let forced_end = (start + width).min(chars.len());
            segments.push((start, forced_end, chars[start..forced_end].iter().collect()));
            start = forced_end;
        } else {
            segments.push((start, end, chars[start..end].iter().collect()));
            start = end;
        }
    }

    if segments.is_empty() {
        segments.push((0, 0, String::new()));
    }
    segments
}

fn composer_prefix_width() -> usize {
    PROMPT_SEPARATOR.chars().count()
}

fn composer_is_slash_mode(lines: &[String]) -> bool {
    lines.first().is_some_and(|line| line.starts_with('/'))
}

fn parse_slash_command(prompt: &str) -> Option<Result<SlashCommand, String>> {
    let trimmed = prompt.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    let body = trimmed.trim_start_matches('/');
    let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
    let name = &body[..name_end];
    let args = body[name_end..].trim();

    Some(match name {
        "exit" if args.is_empty() => Ok(SlashCommand::Exit),
        "sessions" if args.is_empty() => Ok(SlashCommand::Sessions),
        "batch" => parse_workset_slash_command("batch", args, |instruction| SlashCommand::Batch {
            instruction,
        }),
        "batch-run" => parse_workset_slash_command("batch-run", args, |instruction| {
            SlashCommand::BatchRun { instruction }
        }),
        "plan" => parse_workset_slash_command("plan", args, |instruction| SlashCommand::Plan {
            instruction,
        }),
        "review" => parse_workset_slash_command("review", args, |instruction| {
            SlashCommand::Review { instruction }
        }),
        _ => Err(format!("unknown slash command: /{}", name)),
    })
}

fn parse_workset_slash_command<F>(
    name: &str,
    args: &str,
    constructor: F,
) -> Result<SlashCommand, String>
where
    F: FnOnce(String) -> SlashCommand,
{
    if args.is_empty() {
        Err(format!("usage: /{} <instruction>", name))
    } else {
        Ok(constructor(args.to_string()))
    }
}

fn expand_user_prompt(prompt: &str) -> String {
    match parse_slash_command(prompt) {
        Some(Ok(SlashCommand::Batch { instruction })) => {
            build_workset_command_prompt("batch", &instruction)
        }
        Some(Ok(SlashCommand::BatchRun { instruction })) => {
            build_workset_command_prompt_with_mode("batch-run", "batch", &instruction, true)
        }
        Some(Ok(SlashCommand::Plan { instruction })) => {
            build_workset_command_prompt("plan", &instruction)
        }
        Some(Ok(SlashCommand::Review { instruction })) => {
            build_workset_command_prompt("review", &instruction)
        }
        _ => prompt.to_string(),
    }
}

fn build_workset_command_prompt(kind: &str, instruction: &str) -> String {
    build_workset_command_prompt_with_mode(kind, kind, instruction, false)
}

fn build_workset_command_prompt_with_mode(
    command: &str,
    workset_kind: &str,
    instruction: &str,
    auto_execute: bool,
) -> String {
    let guidance = match command {
        "batch" => "Break the work into independently executable units suitable for later parallel thread execution. Favor per-directory or per-module slices over arbitrary file lists, and keep scopes non-overlapping where practical.",
        "batch-run" => "Break the work into independently executable units suitable for immediate parallel thread execution. Favor per-directory or per-module slices over arbitrary file lists, and keep scopes non-overlapping where practical.",
        "plan" => "Optimize for a durable execution plan that can survive session boundaries. Sequence items clearly, note dependencies, and only introduce parallel tracks when they materially improve progress.",
        "review" => "Optimize for code review. Break the requested change into smaller, manageably scoped, human-reviewable items with minimal surface area, explicit risk areas, and concrete verification for each item.",
        _ => "Create a concise, durable structured plan.",
    };
    let execution_guidance = if auto_execute {
        "- Do planning and research as needed.\n\
         - Persist the workset with `workset_define` before dispatching mutating implementation threads.\n\
         - Then execute the workset: dispatch the implementation and verification threads that are ready to run.\n\
         - Each worker action must include its owned scope and a warning that it is not alone in the codebase and must not overwrite unrelated edits.\n\
         - You may dispatch independent items in parallel when their scopes are non-overlapping.\n\
         - End by summarizing what was launched, what completed, and the current workset status.\n"
    } else {
        "- Do planning and research only.\n\
         - You may dispatch research, setup, or verification threads if needed to understand the codebase.\n\
         - Do not dispatch mutating implementation threads yet.\n\
         - End by presenting the structured plan in normal prose, explicitly including the chosen workset id and the next sensible approval or execution step.\n"
    };

    format!(
        "# Workset Command: /{command}\n\n\
         The user explicitly invoked the `/{command}` slash command. Treat this as a request to create exactly one durable workset using the `workset_define` tool.\n\n\
         User instruction:\n\
         {instruction}\n\n\
         Requirements:\n\
         - Research the codebase as needed, using threads for bounded research or setup work when that will materially improve the plan.\n\
         - Create exactly one workset with `kind: \"{workset_kind}\"`.\n\
         - Choose a short stable workset id and mention it clearly in your final response.\n\
         - Persist the workset with `workset_define`, including a concise summary, a verification recipe when you can determine one, and ordered items.\n\
         - Every workset item must include: `title`, `thread_name`, `scope`, `description`, `item_kind`, `status`, `source_threads`, and optional `last_summary`.\n\
         - Prefer stable thread names that communicate role and ownership.\n\
         - Worker threads are not alone in the codebase. Scopes should be explicit, non-overlapping where practical, and written so later execution can warn workers not to trample unrelated edits.\n\
         - Do not create a workset for trivial one-off work unless the user explicitly asked for one. Here, the user did explicitly ask.\n\n\
         Guidance for this command:\n\
         {guidance}\n\n\
         At this stage:\n\
         {execution_guidance}"
    )
}

fn display_prompt_from_message(content: &str) -> String {
    workset_command_display_prompt(content).unwrap_or_else(|| content.to_string())
}

fn workset_command_display_prompt(content: &str) -> Option<String> {
    let header = content.lines().next()?;
    let kind = header.strip_prefix("# Workset Command: /")?.trim();
    if !matches!(kind, "batch" | "batch-run" | "plan" | "review") {
        return None;
    }
    let instruction = content
        .split_once("User instruction:\n")?
        .1
        .split_once("\n\nRequirements:")?
        .0
        .trim();
    if instruction.is_empty() {
        None
    } else {
        Some(format!("/{kind} {instruction}"))
    }
}

fn prompt_line(is_first: bool, content: &str, slash_mode: bool) -> Line<'static> {
    let mut spans = Vec::new();
    if is_first {
        let (prefix, color) = if slash_mode {
            (COMMAND_SEPARATOR, Color::Yellow)
        } else {
            (PROMPT_SEPARATOR, Color::Cyan)
        };
        spans.push(Span::styled(
            prefix,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ));
    } else {
        spans.push(Span::styled(
            CONTINUATION_PREFIX.to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }
    spans.push(Span::styled(
        content.to_string(),
        Style::default().fg(if slash_mode {
            Color::Yellow
        } else {
            Color::White
        }),
    ));
    Line::from(spans)
}

fn wrap_soft_line(line: &str, width: usize) -> Vec<String> {
    wrap_soft_line_with_ranges(line, width)
        .into_iter()
        .map(|(_, _, text)| text)
        .collect()
}

fn normalize_paste(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn truncate_episode_preview(content: &str) -> String {
    let mut lines = Vec::new();
    let mut char_count = 0usize;
    let mut truncated = false;

    for (index, line) in content.split('\n').enumerate() {
        if index >= 8 {
            truncated = true;
            break;
        }

        let line_chars = line.chars().count();
        let remaining_chars = 700usize.saturating_sub(char_count);
        if line_chars > remaining_chars {
            lines.push(take_chars(line, remaining_chars));
            truncated = true;
            break;
        }

        lines.push(line.to_string());
        char_count = char_count.saturating_add(line_chars);
        if char_count >= 700 {
            truncated = true;
            break;
        }
    }

    if lines.is_empty() && !content.is_empty() {
        lines.push(take_chars(content, 700));
        truncated = content.chars().count() > 700;
    }

    if truncated {
        lines.push("… [truncated retained episode preview]".to_string());
    }

    lines.join("\n")
}

fn take_chars(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
}

fn render_markdown_lines(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return vec![Line::from("")];
    }

    let raw_lines: Vec<&str> = text.split('\n').collect();
    let mut rendered = Vec::new();
    let mut index = 0usize;

    while index < raw_lines.len() {
        let raw_line = raw_lines[index];
        let trimmed = raw_line.trim();

        if let Some(info) = trimmed.strip_prefix("```") {
            let (next_index, code_lines) =
                render_markdown_code_block(&raw_lines, index, info.trim().to_string());
            rendered.extend(code_lines);
            index = next_index;
            continue;
        }

        if let Some((next_index, table_lines)) = render_markdown_table_block(&raw_lines, index) {
            rendered.extend(table_lines);
            index = next_index;
            continue;
        }

        if trimmed.is_empty() {
            rendered.push(Line::from(""));
            index += 1;
            continue;
        }

        if is_markdown_rule(trimmed) {
            rendered.push(Line::from(Span::styled(
                "─".repeat(24),
                Style::default().fg(Color::DarkGray),
            )));
            index += 1;
            continue;
        }

        if let Some((level, content)) = parse_markdown_heading(trimmed) {
            rendered.push(render_markdown_heading_line(level, content));
            index += 1;
            continue;
        }

        if let Some((quote_level, content)) = parse_markdown_quote(trimmed) {
            rendered.push(render_markdown_quote_line(quote_level, content));
            index += 1;
            continue;
        }

        if let Some(line) = render_markdown_list_item(raw_line) {
            rendered.push(line);
            index += 1;
            continue;
        }

        rendered.push(Line::from(render_inline_markdown(
            raw_line.trim_end(),
            Style::default().fg(Color::White),
        )));
        index += 1;
    }

    if rendered.is_empty() {
        vec![Line::from("")]
    } else {
        rendered
    }
}

fn is_markdown_rule(line: &str) -> bool {
    let compact: String = line.chars().filter(|char| !char.is_whitespace()).collect();
    matches!(compact.as_str(), "---" | "***" | "___")
}

fn parse_markdown_heading(line: &str) -> Option<(usize, &str)> {
    let level = line.chars().take_while(|char| *char == '#').count();
    if !(1..=6).contains(&level) || line.chars().nth(level) != Some(' ') {
        return None;
    }
    Some((level, line[level + 1..].trim()))
}

fn parse_markdown_quote(line: &str) -> Option<(usize, &str)> {
    let mut level = 0usize;
    let mut rest = line;
    while let Some(stripped) = rest.strip_prefix('>') {
        level = level.saturating_add(1);
        rest = stripped.trim_start();
    }
    (level > 0).then_some((level, rest))
}

fn render_markdown_list_item(line: &str) -> Option<Line<'static>> {
    let indent = line.chars().take_while(|char| char.is_whitespace()).count() / 2;
    let trimmed = line.trim_start();

    if let Some(content) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .or_else(|| trimmed.strip_prefix("+ "))
    {
        let mut spans = vec![
            Span::raw("  ".repeat(indent)),
            Span::styled("• ", Style::default().fg(Color::DarkGray)),
        ];
        spans.extend(render_inline_markdown(
            content.trim_end(),
            Style::default().fg(Color::White),
        ));
        return Some(Line::from(spans));
    }

    let digits = trimmed
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .count();
    if digits == 0 {
        return None;
    }

    let marker = trimmed.chars().nth(digits)?;
    if !matches!(marker, '.' | ')') || trimmed.chars().nth(digits + 1) != Some(' ') {
        return None;
    }

    let number = &trimmed[..digits];
    let content = trimmed[digits + 2..].trim_end();
    let mut spans = vec![
        Span::raw("  ".repeat(indent)),
        Span::styled(format!("{number}. "), Style::default().fg(Color::DarkGray)),
    ];
    spans.extend(render_inline_markdown(
        content,
        Style::default().fg(Color::White),
    ));
    Some(Line::from(spans))
}

fn render_inline_markdown(text: &str, base_style: Style) -> Vec<Span<'static>> {
    let chars: Vec<char> = text.chars().collect();
    let mut spans = Vec::new();
    let mut buffer = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        if chars[index] == '\\' && index + 1 < chars.len() {
            buffer.push(chars[index + 1]);
            index += 2;
            continue;
        }

        if chars[index] == '!' && index + 1 < chars.len() && chars[index + 1] == '[' {
            if let Some((next_index, rendered)) =
                parse_markdown_link(&chars, index + 1, true, base_style)
            {
                push_styled_text(&mut spans, &mut buffer, base_style);
                spans.extend(rendered);
                index = next_index;
                continue;
            }
        }

        if chars[index] == '[' {
            if let Some((next_index, rendered)) =
                parse_markdown_link(&chars, index, false, base_style)
            {
                push_styled_text(&mut spans, &mut buffer, base_style);
                spans.extend(rendered);
                index = next_index;
                continue;
            }
        }

        if chars[index] == '`' {
            if let Some(close_offset) = chars[index + 1..].iter().position(|char| *char == '`') {
                push_styled_text(&mut spans, &mut buffer, base_style);
                let code: String = chars[index + 1..index + 1 + close_offset].iter().collect();
                spans.push(Span::styled(code, markdown_code_style()));
                index += close_offset + 2;
                continue;
            }
            buffer.push(chars[index]);
            index += 1;
            continue;
        }

        if index + 1 < chars.len()
            && matches!((chars[index], chars[index + 1]), ('*', '*') | ('_', '_'))
        {
            if let Some(close_index) =
                find_closing_marker(&chars, index + 2, &[chars[index], chars[index + 1]])
            {
                push_styled_text(&mut spans, &mut buffer, base_style);
                let inner: String = chars[index + 2..close_index].iter().collect();
                spans.extend(render_inline_markdown(
                    &inner,
                    base_style.add_modifier(Modifier::BOLD),
                ));
                index = close_index + 2;
                continue;
            }
        }

        if index + 1 < chars.len() && chars[index] == '~' && chars[index + 1] == '~' {
            if let Some(close_index) = find_closing_marker(&chars, index + 2, &['~', '~']) {
                push_styled_text(&mut spans, &mut buffer, base_style);
                let inner: String = chars[index + 2..close_index].iter().collect();
                spans.extend(render_inline_markdown(
                    &inner,
                    base_style.add_modifier(Modifier::CROSSED_OUT),
                ));
                index = close_index + 2;
                continue;
            }
        }

        if matches!(chars[index], '*' | '_') {
            if let Some(close_index) = find_closing_marker(&chars, index + 1, &[chars[index]]) {
                push_styled_text(&mut spans, &mut buffer, base_style);
                let inner: String = chars[index + 1..close_index].iter().collect();
                spans.extend(render_inline_markdown(
                    &inner,
                    base_style.add_modifier(Modifier::ITALIC),
                ));
                index = close_index + 1;
                continue;
            }
        }

        buffer.push(chars[index]);
        index += 1;
    }

    push_styled_text(&mut spans, &mut buffer, base_style);
    spans
}

fn parse_markdown_link(
    chars: &[char],
    start: usize,
    is_image: bool,
    base_style: Style,
) -> Option<(usize, Vec<Span<'static>>)> {
    let bracket_start = if is_image { start } else { start };
    if chars.get(bracket_start)? != &'[' {
        return None;
    }

    let label_end = chars[bracket_start + 1..]
        .iter()
        .position(|char| *char == ']')?
        + bracket_start
        + 1;
    if chars.get(label_end + 1)? != &'(' {
        return None;
    }
    let target_end = chars[label_end + 2..]
        .iter()
        .position(|char| *char == ')')?
        + label_end
        + 2;

    let label: String = chars[bracket_start + 1..label_end].iter().collect();
    let target: String = chars[label_end + 2..target_end].iter().collect();
    let mut spans = Vec::new();
    if is_image {
        spans.push(Span::styled(
            "image: ".to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }

    if label.trim().is_empty() {
        spans.push(Span::styled(target.clone(), markdown_link_style()));
    } else {
        spans.extend(render_inline_markdown(
            &label,
            base_style
                .fg(Color::Cyan)
                .add_modifier(Modifier::UNDERLINED),
        ));
        spans.push(Span::styled(
            format!(" <{target}>"),
            Style::default().fg(Color::DarkGray),
        ));
    }

    Some((target_end + 1, spans))
}

fn render_markdown_heading_line(level: usize, content: &str) -> Line<'static> {
    let mut spans = vec![Span::styled(
        "#".repeat(level),
        markdown_heading_hash_style(level),
    )];
    spans.push(Span::raw(" "));
    spans.extend(render_inline_markdown(
        content,
        markdown_heading_text_style(level),
    ));
    Line::from(spans)
}

fn render_markdown_quote_line(level: usize, content: &str) -> Line<'static> {
    let mut spans = vec![Span::styled(
        format!("{} ", ">".repeat(level)),
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
    )];
    spans.extend(render_inline_markdown(
        content,
        Style::default().fg(Color::Rgb(200, 200, 200)),
    ));
    Line::from(spans)
}

fn render_markdown_code_block(
    raw_lines: &[&str],
    start: usize,
    info: String,
) -> (usize, Vec<Line<'static>>) {
    let mut lines = Vec::new();
    let mut index = start + 1;

    let mut fence = vec![Span::styled(
        "```".to_string(),
        Style::default().fg(Color::DarkGray),
    )];
    if !info.is_empty() {
        fence.push(Span::styled(
            info,
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
    }
    lines.push(Line::from(fence));

    while index < raw_lines.len() {
        let trimmed = raw_lines[index].trim();
        if trimmed.starts_with("```") {
            lines.push(Line::from(Span::styled(
                "```".to_string(),
                Style::default().fg(Color::DarkGray),
            )));
            return (index + 1, lines);
        }

        lines.push(Line::from(Span::styled(
            raw_lines[index].to_string(),
            markdown_code_style(),
        )));
        index += 1;
    }

    (index, lines)
}

fn render_markdown_table_block(
    raw_lines: &[&str],
    start: usize,
) -> Option<(usize, Vec<Line<'static>>)> {
    if start + 1 >= raw_lines.len() {
        return None;
    }

    let header = parse_markdown_table_row(raw_lines[start])?;
    let delimiter = parse_markdown_table_delimiter(raw_lines[start + 1])?;
    if header.len() != delimiter {
        return None;
    }

    let mut rows = Vec::new();
    let mut index = start + 2;
    while index < raw_lines.len() {
        let Some(row) = parse_markdown_table_row(raw_lines[index]) else {
            break;
        };
        if row.len() != delimiter {
            break;
        }
        rows.push(row);
        index += 1;
    }

    let header_cells: Vec<String> = header
        .iter()
        .map(|cell| inline_plain_text(&render_inline_markdown(cell, Style::default())))
        .collect();
    let body_cells: Vec<Vec<String>> = rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| inline_plain_text(&render_inline_markdown(cell, Style::default())))
                .collect()
        })
        .collect();

    let mut widths = vec![0usize; delimiter];
    for (idx, cell) in header_cells.iter().enumerate() {
        widths[idx] = widths[idx].max(cell.chars().count());
    }
    for row in &body_cells {
        for (idx, cell) in row.iter().enumerate() {
            widths[idx] = widths[idx].max(cell.chars().count());
        }
    }

    let mut lines = Vec::new();
    lines.push(render_table_border(&widths, '┌', '┬', '┐'));
    lines.push(render_table_row(
        &header_cells,
        &widths,
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    ));
    lines.push(render_table_border(&widths, '├', '┼', '┤'));
    for row in &body_cells {
        lines.push(render_table_row(
            row,
            &widths,
            Style::default().fg(Color::White),
        ));
    }
    lines.push(render_table_border(&widths, '└', '┴', '┘'));

    Some((index, lines))
}

fn parse_markdown_table_row(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.contains('|') {
        return None;
    }

    let inner = trimmed.trim_matches('|');
    let cells: Vec<String> = inner
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect();
    (!cells.is_empty()).then_some(cells)
}

fn parse_markdown_table_delimiter(line: &str) -> Option<usize> {
    let cells = parse_markdown_table_row(line)?;
    let valid = cells.iter().all(|cell| {
        let compact: String = cell.chars().filter(|char| !char.is_whitespace()).collect();
        compact.len() >= 3 && compact.trim_matches(':').chars().all(|char| char == '-')
    });
    valid.then_some(cells.len())
}

fn render_table_border(widths: &[usize], left: char, middle: char, right: char) -> Line<'static> {
    let mut text = String::new();
    text.push(left);
    for (index, width) in widths.iter().enumerate() {
        text.push_str(&"─".repeat(width.saturating_add(2)));
        if index + 1 < widths.len() {
            text.push(middle);
        }
    }
    text.push(right);
    Line::from(Span::styled(text, Style::default().fg(Color::DarkGray)))
}

fn render_table_row(cells: &[String], widths: &[usize], cell_style: Style) -> Line<'static> {
    let mut spans = vec![Span::styled(
        "│".to_string(),
        Style::default().fg(Color::DarkGray),
    )];
    for (index, (cell, width)) in cells.iter().zip(widths.iter()).enumerate() {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("{cell:<width$}", width = *width),
            cell_style,
        ));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            "│".to_string(),
            Style::default().fg(Color::DarkGray),
        ));
        if index + 1 == cells.len() {
            continue;
        }
    }
    Line::from(spans)
}

fn push_styled_text(spans: &mut Vec<Span<'static>>, buffer: &mut String, style: Style) {
    if !buffer.is_empty() {
        spans.push(Span::styled(std::mem::take(buffer), style));
    }
}

fn find_closing_marker(chars: &[char], start: usize, marker: &[char]) -> Option<usize> {
    let width = marker.len();
    let mut index = start;
    while index + width <= chars.len() {
        if chars[index..index + width] == *marker {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn inline_plain_text(spans: &[Span<'static>]) -> String {
    spans
        .iter()
        .map(|span| span.content.as_ref())
        .collect::<Vec<_>>()
        .join("")
}

fn markdown_heading_hash_style(level: usize) -> Style {
    let color = match level {
        1 | 2 => Color::Blue,
        3 | 4 => Color::DarkGray,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn markdown_heading_text_style(level: usize) -> Style {
    match level {
        1 => Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        2 => Style::default()
            .fg(Color::LightBlue)
            .add_modifier(Modifier::BOLD),
        3 => Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
        _ => Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    }
}

fn markdown_code_style() -> Style {
    Style::default().fg(Color::Yellow)
}

fn markdown_link_style() -> Style {
    Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::UNDERLINED)
}

fn split_preserving_empty(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    text.split('\n').map(|line| line.to_string()).collect()
}

fn visible_restored_message_count(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| match message {
            Message::User { .. } => true,
            Message::Assistant { content, .. } => content.is_some(),
            _ => false,
        })
        .count()
}

fn short_session(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

fn short_clock(timestamp: &str) -> String {
    timestamp
        .rsplit_once(' ')
        .map(|(_, time)| time.to_string())
        .unwrap_or_else(|| fit_text(timestamp, 8))
}

fn short_timestamp(timestamp: &str) -> String {
    fit_text(timestamp, 19)
}

fn utc_hms() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let rem = d.as_secs() % 86_400;
    let hours = rem / 3_600;
    let minutes = (rem % 3_600) / 60;
    let seconds = rem % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

fn tone_glyph(tone: Tone) -> &'static str {
    match tone {
        Tone::Info => "•",
        Tone::Success => "+",
        Tone::Warning => "!",
        Tone::Error => "×",
        Tone::Muted => "·",
    }
}

fn actor_color(actor: &str, tone: Tone) -> Color {
    if actor == "user" {
        Color::Yellow
    } else if actor == "assistant" {
        Color::Green
    } else if actor == "orchestrator" || actor.starts_with("coder") {
        Color::Cyan
    } else if actor == "model" || actor == "docs" {
        Color::Magenta
    } else if actor == "system" {
        Color::Blue
    } else if actor == "git" {
        Color::Green
    } else if actor.starts_with("tester") {
        Color::Yellow
    } else {
        tone.color()
    }
}

fn file_status_style(status: &str) -> Style {
    let color = match status {
        "ADD" => Color::Green,
        "DEL" => Color::Red,
        "REN" => Color::Magenta,
        "??" => Color::Cyan,
        "MOD" => Color::Yellow,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn workset_kind_style(kind: &str) -> Style {
    let color = match kind {
        "batch" => Color::Magenta,
        "plan" => Color::Cyan,
        "review" => Color::Yellow,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn workset_status_style(status: &str) -> Style {
    let color = match status {
        "done" | "complete" | "completed" => Color::Green,
        "failed" | "error" => Color::Red,
        "cancelled" | "skipped" => Color::DarkGray,
        "running" | "active" => Color::Green,
        "planned" | "planning" | "awaiting_approval" => Color::Yellow,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn enable_keyboard_enhancements(terminal: &mut UiTerminal) -> bool {
    let supports = supports_keyboard_enhancement().unwrap_or(false);
    if !supports {
        return false;
    }

    crossterm::execute!(
        terminal.backend_mut(),
        PushKeyboardEnhancementFlags(
            KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
                | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
                | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
        )
    )
    .is_ok()
}

fn enable_bracketed_paste(terminal: &mut UiTerminal) -> bool {
    crossterm::execute!(terminal.backend_mut(), EnableBracketedPaste).is_ok()
}

fn enable_mouse_capture(terminal: &mut UiTerminal) -> bool {
    crossterm::execute!(terminal.backend_mut(), EnableMouseCapture).is_ok()
}

fn spawn_input_thread(
    running: Arc<AtomicBool>,
    input_tx: mpsc::UnboundedSender<CrosstermEvent>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        while running.load(AtomicOrdering::SeqCst) {
            match event::poll(Duration::from_millis(100)) {
                Ok(true) => match event::read() {
                    Ok(event) => {
                        if input_tx.send(event).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                },
                Ok(false) => {}
                Err(_) => break,
            }
        }
    })
}

fn persist_session_snapshot(snapshot: &mut SessionSnapshot, agent: &Agent) -> Result<()> {
    let refreshed = sessions::refresh_snapshot(snapshot, agent.messages.clone());
    sessions::save_session(&refreshed)?;
    *snapshot = refreshed;
    Ok(())
}

fn contains_point(area: Rect, column: u16, row: u16) -> bool {
    column >= area.x && column < area.right() && row >= area.y && row < area.bottom()
}

fn copy_text_to_clipboard(text: &str) -> io::Result<()> {
    let mut child = StdCommand::new("pbcopy")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes())?;
    }
    let _ = child.wait()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEventState;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_tui_{label}_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn metadata_for(path: &Path) -> TuiMetadata {
        TuiMetadata {
            cwd: path.display().to_string(),
            workspace_host_path: Some(path.to_path_buf()),
            store_path: path.join(".nac").join("store.db"),
            model: "gpt-test".to_string(),
            base_url: "https://example.com/v1".to_string(),
            backend: "openai-responses".to_string(),
            reasoning_effort: Some("medium".to_string()),
            session_id: None,
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
        }
    }

    #[test]
    fn shift_enter_inserts_newline() {
        let dir = temp_dir("newline");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("hello");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::SHIFT));

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "hello\n");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn enter_submits_prompt() {
        let dir = temp_dir("submit");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("hello");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match action {
            AppAction::Submit(prompt) => assert_eq!(prompt, "hello"),
            _ => panic!("expected submit"),
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn batch_command_submits_raw_prompt() {
        let dir = temp_dir("batch-submit");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/batch refresh auth flow");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match action {
            AppAction::Submit(prompt) => assert_eq!(prompt, "/batch refresh auth flow"),
            _ => panic!("expected submit"),
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn batch_run_command_submits_raw_prompt() {
        let dir = temp_dir("batch-run-submit");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/batch-run refresh auth flow");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match action {
            AppAction::Submit(prompt) => assert_eq!(prompt, "/batch-run refresh auth flow"),
            _ => panic!("expected submit"),
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn slash_exit_quits() {
        let dir = temp_dir("exit");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/exit");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::Quit));
        assert!(app.quit);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn repeat_backspace_is_processed() {
        let dir = temp_dir("backspace");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("ab");

        let action = app.handle_key_event(KeyEvent {
            code: KeyCode::Backspace,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Repeat,
            state: KeyEventState::NONE,
        });

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "a");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn multiline_paste_inserts_newlines_without_submit() {
        let dir = temp_dir("paste");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let action = app.handle_paste("hello\nworld");

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "hello\nworld");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pasted_crlf_is_normalized_to_newlines() {
        let dir = temp_dir("paste-crlf");
        let mut app = App::new(metadata_for(&dir), &[], false);

        app.handle_paste("hello\r\nworld\rtest");

        assert_eq!(app.prompt(), "hello\nworld\ntest");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn slash_command_mode_uses_command_prefix() {
        let view = wrapped_composer_view(&["/sessions".to_string()], (0, 9), 20, 4);

        assert_eq!(line_to_plain_text(&view.lines[0]), " / sessions");
        assert_eq!(view.lines[0].spans[0].style.fg, Some(Color::Yellow));
        assert_eq!(view.lines[0].spans[1].style.fg, Some(Color::Yellow));
        assert_eq!(view.cursor_col, composer_prefix_width() as u16 + 8);
    }

    #[test]
    fn normal_prompt_prefix_returns_after_slash_removed() {
        let slash = wrapped_composer_view(&["/".to_string()], (0, 1), 20, 4);
        let normal = wrapped_composer_view(&["".to_string()], (0, 0), 20, 4);

        assert_eq!(line_to_plain_text(&slash.lines[0]), " / ");
        assert_eq!(line_to_plain_text(&normal.lines[0]), " › ");
        assert_eq!(normal.lines[0].spans[0].style.fg, Some(Color::Cyan));
        assert_eq!(normal.lines[0].spans[1].style.fg, Some(Color::White));
    }

    #[test]
    fn invalid_slash_command_shows_composer_notice() {
        let dir = temp_dir("invalid-command");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/bogus");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "/bogus");
        let notice = app
            .composer_notice
            .as_ref()
            .expect("expected composer notice");
        assert_eq!(notice.text, "unknown slash command: /bogus");
        assert_eq!(notice.tone, Tone::Warning);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn review_command_requires_instruction() {
        let dir = temp_dir("review-usage");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/review");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        let notice = app
            .composer_notice
            .as_ref()
            .expect("expected composer notice");
        assert_eq!(notice.text, "usage: /review <instruction>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn batch_command_expands_to_workset_prompt() {
        let expanded = expand_user_prompt("/batch refresh auth flow");

        assert!(expanded.contains("Workset Command: /batch"));
        assert!(expanded.contains("workset_define"));
        assert!(expanded.contains("kind: \"batch\""));
        assert!(expanded.contains("refresh auth flow"));
        assert!(expanded.contains("Do not dispatch mutating implementation threads yet."));
    }

    #[test]
    fn batch_run_command_expands_to_executing_workset_prompt() {
        let expanded = expand_user_prompt("/batch-run refresh auth flow");

        assert!(expanded.contains("Workset Command: /batch-run"));
        assert!(expanded.contains("workset_define"));
        assert!(expanded.contains("kind: \"batch\""));
        assert!(expanded.contains("refresh auth flow"));
        assert!(expanded.contains("Then execute the workset"));
        assert!(expanded.contains("dispatch the implementation and verification threads"));
        assert!(!expanded.contains("Do not dispatch mutating implementation threads yet."));
    }

    fn define_test_workset(path: &Path, session_id: &str, id: &str) {
        store::define_workset(
            path,
            session_id,
            &store::WorksetDefinition {
                id: id.to_string(),
                kind: "batch".to_string(),
                instruction: "refresh auth flow".to_string(),
                status: "planned".to_string(),
                summary: "Reviewable auth work units.".to_string(),
                verification_recipe: Some("cargo test".to_string()),
                items: vec![
                    store::WorksetItemDefinition {
                        title: "Inspect auth flow".to_string(),
                        thread_name: "research/auth".to_string(),
                        scope: "crates/nac/src".to_string(),
                        description: "Find auth flow entry points.".to_string(),
                        item_kind: "research".to_string(),
                        status: "planned".to_string(),
                        source_threads: Vec::new(),
                        last_summary: None,
                    },
                    store::WorksetItemDefinition {
                        title: "Apply auth flow update".to_string(),
                        thread_name: "impl/auth".to_string(),
                        scope: "crates/nac/src/tui.rs".to_string(),
                        description: "Make the scoped auth UI change.".to_string(),
                        item_kind: "implement".to_string(),
                        status: "planned".to_string(),
                        source_threads: vec!["research/auth".to_string()],
                        last_summary: None,
                    },
                ],
            },
        )
        .unwrap();
    }

    #[test]
    fn app_loads_worksets_for_session() {
        let dir = temp_dir("workset-panel");
        let store_path = dir.join("store.db");
        let session_id = "session-worksets";
        define_test_workset(&store_path, session_id, "batch-auth");
        let mut metadata = metadata_for(&dir);
        metadata.store_path = store_path.clone();
        metadata.session_id = Some(session_id.to_string());

        let app = App::new(metadata, &[], false);

        assert_eq!(app.worksets.items.len(), 1);
        assert_eq!(app.worksets.items[0].id, "batch-auth");
        assert_eq!(app.worksets.items[0].items.len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn workset_tool_finish_refreshes_worksets() {
        let dir = temp_dir("workset-refresh");
        let store_path = dir.join("store.db");
        let session_id = "session-workset-refresh";
        let mut metadata = metadata_for(&dir);
        metadata.store_path = store_path.clone();
        metadata.session_id = Some(session_id.to_string());
        let mut app = App::new(metadata, &[], false);
        assert!(app.worksets.items.is_empty());

        define_test_workset(&store_path, session_id, "plan-ui");
        app.apply_agent_event(AgentEvent::ToolCallFinished {
            thread_name: None,
            call_id: "call-workset".to_string(),
            name: "workset_define".to_string(),
            content_preview: "Saved workset 'plan-ui' with 1 item(s).".to_string(),
            is_error: false,
        });

        assert_eq!(app.worksets.items.len(), 1);
        assert_eq!(app.worksets.items[0].id, "plan-ui");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn workset_item_lines_include_thread_scope_and_title() {
        let item = store::WorksetItemRecord {
            position: 1,
            title: "Apply auth flow update".to_string(),
            thread_name: "impl/auth".to_string(),
            scope: "crates/nac/src/tui.rs".to_string(),
            description: "Make the scoped auth UI change.".to_string(),
            item_kind: "implement".to_string(),
            status: "planned".to_string(),
            source_threads: vec!["research/auth".to_string()],
            last_summary: None,
            updated_at: "2026-04-23 00:00:00".to_string(),
        };

        let rendered = render_workset_item_lines(&item, 80)
            .iter()
            .map(line_to_plain_text)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(rendered.contains("planned"));
        assert!(rendered.contains("implement"));
        assert!(rendered.contains("impl/auth"));
        assert!(rendered.contains("Apply auth flow update"));
        assert!(rendered.contains("crates/nac/src/tui.rs"));
    }

    #[test]
    fn workset_prompt_displays_as_original_slash_command() {
        let expanded = build_workset_command_prompt("review", "split this into reviewable units");
        let expanded_run =
            build_workset_command_prompt_with_mode("batch-run", "batch", "do the sweep", true);

        assert_eq!(
            display_prompt_from_message(&expanded),
            "/review split this into reviewable units"
        );
        assert_eq!(
            display_prompt_from_message(&expanded_run),
            "/batch-run do the sweep"
        );
    }

    #[test]
    fn run_started_does_not_replace_submitted_prompt() {
        let dir = temp_dir("run-started-prompt");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.note_prompt_submitted("/batch refresh auth flow");

        app.apply_agent_event(AgentEvent::RunStarted {
            thread_name: None,
            prompt_preview: "# Workset Command: /batch".to_string(),
        });

        assert_eq!(app.last_prompt.as_deref(), Some("/batch refresh auth flow"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn restored_message_count_ignores_system_and_tool_messages() {
        let messages = vec![
            Message::System {
                content: "system".to_string(),
            },
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "tool result".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("thinking".to_string()),
                reasoning_details: None,
                tool_calls: None,
            },
            Message::User {
                content: "hello".to_string(),
            },
        ];

        assert_eq!(visible_restored_message_count(&messages), 1);
    }

    #[test]
    fn sessions_command_opens_picker() {
        let dir = temp_dir("sessions-command");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/sessions");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        assert!(matches!(
            app.screen,
            ScreenMode::SessionPicker { startup: false }
        ));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn question_mark_toggles_help_when_composer_is_empty() {
        let dir = temp_dir("help-toggle");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE));
        assert!(matches!(action, AppAction::None));
        assert!(app.help_visible);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE));
        assert!(matches!(action, AppAction::None));
        assert!(!app.help_visible);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn question_mark_inserts_into_nonempty_composer() {
        let dir = temp_dir("help-literal-question-mark");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("why");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE));
        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "why?");
        assert!(!app.help_visible);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ctrl_e_toggles_events_focus() {
        let dir = temp_dir("events-focus");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::CONTROL));
        assert!(matches!(action, AppAction::None));
        assert!(matches!(
            app.screen,
            ScreenMode::Focused(FocusPanel::Events)
        ));

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::CONTROL));
        assert!(matches!(action, AppAction::None));
        assert_eq!(app.screen, ScreenMode::Dashboard);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ctrl_r_focuses_response_and_escape_returns_dashboard() {
        let dir = temp_dir("response-focus");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        assert!(matches!(action, AppAction::None));
        assert!(matches!(
            app.screen,
            ScreenMode::Focused(FocusPanel::Response)
        ));

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(matches!(action, AppAction::None));
        assert_eq!(app.screen, ScreenMode::Dashboard);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ctrl_p_focuses_previous_response_and_escape_returns_dashboard() {
        let dir = temp_dir("previous-response-focus");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL));
        assert!(matches!(action, AppAction::None));
        assert!(matches!(
            app.screen,
            ScreenMode::Focused(FocusPanel::PreviousResponse)
        ));

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(matches!(action, AppAction::None));
        assert_eq!(app.screen, ScreenMode::Dashboard);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn thread_lifecycle_switches_active_to_idle() {
        let dir = temp_dir("thread");
        let mut app = App::new(metadata_for(&dir), &[], false);

        app.apply_agent_event(AgentEvent::ThreadStarted {
            name: "auth".to_string(),
            action: "inspect auth flow".to_string(),
            source_threads: vec!["tests".to_string()],
        });
        let thread = app.threads.get("auth").unwrap();
        assert_eq!(thread.state, ThreadState::Active);
        assert_eq!(thread.action, "inspect auth flow");

        app.apply_agent_event(AgentEvent::ThreadFinished {
            name: "auth".to_string(),
            exit_code: 0,
            timed_out: false,
        });
        let thread = app.threads.get("auth").unwrap();
        assert_eq!(thread.state, ThreadState::Idle);
        assert_eq!(thread.summary, "exit 0");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tool_finishes_into_recent_history() {
        let dir = temp_dir("tool");
        let mut app = App::new(metadata_for(&dir), &[], false);

        app.apply_agent_event(AgentEvent::ToolCallStarted {
            thread_name: Some("coder-1".to_string()),
            call_id: "call-1".to_string(),
            name: "edit".to_string(),
            args_preview: "crates/nac/src/tui.rs".to_string(),
        });
        app.apply_agent_event(AgentEvent::ToolCallFinished {
            thread_name: Some("coder-1".to_string()),
            call_id: "call-1".to_string(),
            name: "edit".to_string(),
            content_preview: "ok".to_string(),
            is_error: false,
        });

        assert!(app.active_tools.is_empty());
        assert_eq!(app.recent_tools.len(), 1);
        assert_eq!(app.recent_tools[0].name, "edit");
        assert_eq!(app.recent_tools[0].status, ToolStatus::Ok);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn top_level_responses_shift_into_previous_response() {
        let dir = temp_dir("responses");
        let mut app = App::new(metadata_for(&dir), &[], false);

        app.apply_agent_event(AgentEvent::AssistantMessage {
            thread_name: None,
            content: "first reply".to_string(),
        });
        assert_eq!(app.last_response.as_deref(), Some("first reply"));
        assert_eq!(app.previous_response, None);

        app.apply_agent_event(AgentEvent::AssistantMessage {
            thread_name: None,
            content: "second reply".to_string(),
        });
        assert_eq!(app.last_response.as_deref(), Some("second reply"));
        assert_eq!(app.previous_response.as_deref(), Some("first reply"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn selection_extract_preserves_original_newlines_only() {
        let lines = vec![
            "alpha beta gamma delta".to_string(),
            "second line".to_string(),
        ];
        let rows = wrap_logical_lines(&lines, 8);
        let view = PanelView {
            id: PanelId::Response,
            inner: Rect::new(0, 0, 20, 10),
            logical_lines: lines,
            rows,
            scroll_offset: 0,
            visible_rows: 10,
        };
        let selection = SelectionState {
            anchor: SelectionPoint {
                panel: PanelId::Response,
                logical_line: 0,
                char_index: 6,
            },
            focus: SelectionPoint {
                panel: PanelId::Response,
                logical_line: 1,
                char_index: 6,
            },
            dragging: false,
        };

        let extracted = extract_selection_text(&view, &selection);
        assert_eq!(extracted, "beta gamma delta\nsecond");
    }

    #[test]
    fn workspace_without_host_path_is_unavailable() {
        let snapshot = WorkspaceSnapshot::load("/workspace/project", None);
        assert!(snapshot.error.is_some());
        assert_eq!(snapshot.host_root, None);
    }

    #[test]
    fn markdown_renderer_formats_common_blocks() {
        let rendered = render_markdown_lines(
            "# Heading\n- item\n> quote\nLink to [site](https://example.com)\n| Name | Value |\n| --- | --- |\n| one | 1 |\n```rust\nfn main() {}\n```",
        );
        let plain: Vec<String> = rendered.iter().map(line_to_plain_text).collect();

        assert_eq!(plain[0], "# Heading");
        assert_eq!(plain[1], "• item");
        assert_eq!(plain[2], "> quote");
        assert_eq!(plain[3], "Link to site <https://example.com>");
        assert_eq!(plain[4], "┌──────┬───────┐");
        assert_eq!(plain[5], "│ Name │ Value │");
        assert_eq!(plain[6], "├──────┼───────┤");
        assert_eq!(plain[7], "│ one  │ 1     │");
        assert_eq!(plain[8], "└──────┴───────┘");
        assert_eq!(plain[9], "```rust");
        assert_eq!(plain[10], "fn main() {}");
        assert_eq!(plain[11], "```");
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
        let raw = "M  crates/nac/src/tui.rs\nA  README.md\n?? notes.txt\n";
        let (counts, files) = parse_status_porcelain(raw);

        assert_eq!(counts.modified, 1);
        assert_eq!(counts.added, 1);
        assert_eq!(counts.untracked, 1);
        assert_eq!(counts.staged, 2);
        assert!(files.contains_key("notes.txt"));
    }
}
