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
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;
use ratatui_textarea::TextArea;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{self, MissedTickBehavior};

use crate::agent::Agent;
use crate::events::{AgentEvent, EventSink};
use crate::sessions::{self, SessionSnapshot};
use crate::store;
use crate::types::Message;

const COMPOSER_HEIGHT: u16 = 6;
const MIN_TERMINAL_WIDTH: u16 = 72;
const MIN_TERMINAL_HEIGHT: u16 = 22;
const TIMELINE_LIMIT: usize = 220;
const TOOL_HISTORY_LIMIT: usize = 20;
const FILE_CHANGE_LIMIT: usize = 36;
const PROMPT_SEPARATOR: &str = " › ";
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
enum SendState {
    Idle,
    Pending,
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
    Threads,
    Response,
    PreviousResponse,
    Workspace,
    Tools,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum CheckSlot {
    Tests,
    Lint,
    Format,
    Build,
    Last,
}

impl CheckSlot {
    fn label(self) -> &'static str {
        match self {
            Self::Tests => "tests",
            Self::Lint => "lint",
            Self::Format => "format",
            Self::Build => "build",
            Self::Last => "last",
        }
    }
}

#[derive(Debug, Clone)]
struct CheckRecord {
    status: ToolStatus,
    target: String,
    summary: String,
}

#[derive(Debug, Clone, Default)]
struct ChecksState {
    slots: HashMap<CheckSlot, CheckRecord>,
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
struct WrappedRow {
    logical_line: usize,
    start_char: usize,
    end_char: usize,
    text: String,
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
enum ScreenMode {
    Dashboard,
    SessionPicker { startup: bool },
}

#[derive(Debug, Clone, Default)]
struct SessionPickerState {
    sessions: Vec<sessions::SessionSummary>,
    selected: usize,
    error: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct LifeField {
    width: usize,
    height: usize,
    cells: Vec<bool>,
    low_activity_ticks: usize,
    injection_phase: usize,
}

struct App {
    metadata: TuiMetadata,
    inspect_root: Option<PathBuf>,
    composer: TextArea<'static>,
    send_state: SendState,
    quit: bool,
    pending_error_reported: bool,
    working_started_at: Option<Instant>,
    working_frame: usize,
    last_response_duration: Duration,
    restored_message_count: usize,
    last_prompt: Option<String>,
    last_response: Option<String>,
    previous_response: Option<String>,
    timeline: VecDeque<TimelineEntry>,
    threads: HashMap<String, ThreadView>,
    active_tools: HashMap<String, ActiveTool>,
    recent_tools: VecDeque<ToolRecord>,
    checks: ChecksState,
    workspace: WorkspaceSnapshot,
    panel_scrolls: HashMap<PanelId, usize>,
    panel_views: HashMap<PanelId, PanelView>,
    selection: Option<SelectionState>,
    screen: ScreenMode,
    session_picker: SessionPickerState,
    life_field: LifeField,
}

impl App {
    fn new(
        metadata: TuiMetadata,
        restored_messages: &[Message],
        start_in_session_picker: bool,
    ) -> Self {
        let inspect_root = metadata.workspace_host_path.clone();
        let workspace = WorkspaceSnapshot::load(&metadata.cwd, inspect_root.as_deref());

        let mut panel_scrolls = HashMap::new();
        panel_scrolls.insert(PanelId::Prompt, 0);
        panel_scrolls.insert(PanelId::Threads, 0);
        panel_scrolls.insert(PanelId::Response, 0);
        panel_scrolls.insert(PanelId::PreviousResponse, 0);
        panel_scrolls.insert(PanelId::Workspace, 0);
        panel_scrolls.insert(PanelId::Tools, 0);

        let mut app = Self {
            metadata,
            inspect_root,
            composer: build_composer(),
            send_state: SendState::Idle,
            quit: false,
            pending_error_reported: false,
            working_started_at: None,
            working_frame: 0,
            last_response_duration: Duration::default(),
            restored_message_count: visible_restored_message_count(restored_messages),
            last_prompt: None,
            last_response: None,
            previous_response: None,
            timeline: VecDeque::new(),
            threads: HashMap::new(),
            active_tools: HashMap::new(),
            recent_tools: VecDeque::new(),
            checks: ChecksState::default(),
            workspace,
            panel_scrolls,
            panel_views: HashMap::new(),
            selection: None,
            screen: ScreenMode::Dashboard,
            session_picker: SessionPickerState::default(),
            life_field: LifeField::default(),
        };

        app.hydrate_threads_from_store();
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
    }

    fn handle_paste(&mut self, text: &str) -> AppAction {
        if matches!(self.screen, ScreenMode::SessionPicker { .. }) {
            return AppAction::None;
        }
        if matches!(self.send_state, SendState::Pending) {
            return AppAction::None;
        }

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
                code: KeyCode::PageUp,
                ..
            } => {
                self.scroll_panel(PanelId::Response, -3);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::PageDown,
                ..
            } => {
                self.scroll_panel(PanelId::Response, 3);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Enter,
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::SHIFT) => {
                if matches!(self.send_state, SendState::Idle) {
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
                if trimmed.is_empty() || matches!(self.send_state, SendState::Pending) {
                    return AppAction::None;
                }
                if trimmed == "/exit" {
                    self.quit = true;
                    return AppAction::Quit;
                }
                if trimmed == "/sessions" {
                    self.open_session_picker(false);
                    self.clear_composer();
                    return AppAction::None;
                }

                AppAction::Submit(prompt)
            }
            _ => {
                if matches!(self.send_state, SendState::Idle) {
                    self.composer.input(key);
                }
                AppAction::None
            }
        }
    }

    fn handle_mouse_event(&mut self, mouse: MouseEvent) {
        if matches!(self.screen, ScreenMode::SessionPicker { .. }) {
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

    fn hydrate_from_messages(&mut self, messages: &[Message]) {
        for message in messages {
            match message {
                Message::User { content } => self.last_prompt = Some(content.clone()),
                Message::Assistant {
                    content: Some(content),
                    ..
                } => {
                    if let Some(previous) = self.last_response.replace(content.clone()) {
                        self.previous_response = Some(previous);
                    }
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

    fn refresh_workspace(&mut self) {
        self.workspace = WorkspaceSnapshot::load(&self.metadata.cwd, self.inspect_root.as_deref());
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
        self.pending_error_reported = true;
        self.push_timeline("send", format!("error • {error}"), Tone::Error);
    }

    fn apply_agent_event(&mut self, event: AgentEvent) {
        match event {
            AgentEvent::RunStarted {
                thread_name,
                prompt_preview,
            } => {
                if thread_name.is_none() {
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
                self.update_checks(&record);

                if matches!(record.name.as_str(), "write" | "edit")
                    || record.name == "bash"
                    || matches!(record.status, ToolStatus::Failed | ToolStatus::Error)
                {
                    self.refresh_workspace();
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

                self.refresh_workspace();
                self.hydrate_threads_from_store();

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
                self.pending_error_reported = true;
                let actor = thread_name.unwrap_or_else(|| "run".to_string());
                self.push_timeline(actor, format!("error • {message}"), Tone::Error);
            }
            AgentEvent::RunFinished { thread_name } => {
                let actor = thread_name.unwrap_or_else(|| "run".to_string());
                self.push_timeline(actor, "run finished".to_string(), Tone::Muted);
            }
        }
    }

    fn update_checks(&mut self, record: &ToolRecord) {
        if record.name != "bash" {
            return;
        }

        let check = CheckRecord {
            status: record.status,
            target: record.target.clone(),
            summary: record.summary.clone(),
        };
        let slot = classify_check_slot(&record.target);
        self.checks.slots.insert(slot, check.clone());
        self.checks.slots.insert(CheckSlot::Last, check);
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

    fn displayed_run_duration(&self) -> Duration {
        self.working_started_at
            .map(|started| started.elapsed())
            .unwrap_or(self.last_response_duration)
    }

    fn reset_life(&mut self) {
        self.life_field = LifeField::default();
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
        let run_state = if matches!(self.send_state, SendState::Pending) {
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
                Style::default().fg(if matches!(self.send_state, SendState::Pending) {
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
                    Style::default().fg(Color::White),
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
            .constraints([
                Constraint::Length(10),
                Constraint::Min(10),
                Constraint::Length(6),
            ])
            .split(area);

        self.render_prompt_panel(frame, sections[0]);
        self.render_events_panel(frame, sections[1]);
        self.render_hotkeys_panel(frame, sections[2]);
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
                Constraint::Length(5),
            ])
            .split(area);

        self.render_tools_panel(frame, sections[0]);
        self.render_file_changes_panel(frame, sections[1]);
        self.render_checks_panel(frame, sections[2]);
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

    fn render_hotkeys_panel(&self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = vec![
            Line::from("Enter        run prompt"),
            Line::from("Shift+Enter  newline"),
            Line::from("PageUp/Down  scroll response"),
            Line::from("Mouse wheel  scroll hovered pane"),
        ];
        render_lines_panel(frame, area, "HOTKEYS", lines);
    }

    fn render_threads_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let state_width = 8usize;
        let thread_width = width.min(18).max(10);
        let updated_width = 8usize;
        let action_width = width
            .saturating_sub(state_width + thread_width + updated_width + 6)
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
            lines.push(Line::from("No threads in this session yet."));
        } else {
            for thread in threads.into_iter().take(6) {
                let name = fit_text(&thread.name, thread_width);
                let action = fit_text(&thread.action, action_width);
                let updated = fit_text(&thread.updated_at, updated_width);
                lines.push(Line::from(vec![
                    status_span(thread.state.label(), thread.state.tone()),
                    Span::raw(" "),
                    Span::raw(pad_to(
                        "",
                        state_width.saturating_sub(thread.state.label().len()),
                    )),
                    Span::raw("  "),
                    Span::raw(pad_cell(&name, thread_width)),
                    Span::raw("  "),
                    Span::raw(pad_cell(&action, action_width)),
                    Span::raw("  "),
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

        let dot_color = if matches!(self.send_state, SendState::Pending) {
            Color::Green
        } else {
            Color::Yellow
        };
        let title = panel_title_segments(vec![
            Span::styled(
                "EVENTS".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled("●".to_string(), Style::default().fg(dot_color)),
        ]);

        render_lines_panel_with_title(frame, area, title, lines);
    }

    fn render_response_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = match self.last_response.as_deref() {
            Some(response) => split_preserving_empty(response),
            None => vec!["Waiting for the first orchestrator reply.".to_string()],
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
                Style::default().fg(if matches!(self.send_state, SendState::Pending) {
                    Color::Green
                } else {
                    Color::Yellow
                }),
            ),
        ]);
        self.render_selectable_panel_with_title(frame, area, PanelId::Response, title, lines);
    }

    fn render_previous_response_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = match self.previous_response.as_deref() {
            Some(response) => split_preserving_empty(response),
            None => vec!["No previous orchestrator reply yet.".to_string()],
        };
        self.render_selectable_panel(
            frame,
            area,
            PanelId::PreviousResponse,
            "PREVIOUS RESPONSE",
            lines,
        );
    }

    fn render_tools_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let tool_width = width.min(14).max(9);
        let duration_width = 8usize;
        let target_width = width.saturating_sub(tool_width + duration_width + 8).max(8);
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
            lines.push(Line::from(vec![
                status_span(ToolStatus::Running.label(), ToolStatus::Running.tone()),
                Span::raw(" "),
                Span::raw(pad_cell(&fit_text(&label, tool_width), tool_width)),
                Span::raw("  "),
                Span::raw(pad_cell(
                    &fit_text(&tool.target, target_width),
                    target_width,
                )),
                Span::raw("  "),
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
            lines.push(Line::from(vec![
                status_span(tool.status.label(), tool.status.tone()),
                Span::raw(" "),
                Span::raw(pad_cell(&fit_text(&label, tool_width), tool_width)),
                Span::raw("  "),
                Span::raw(pad_cell(
                    &fit_text(&tool.target, target_width),
                    target_width,
                )),
                Span::raw("  "),
                Span::styled(
                    pad_cell(&format_duration(tool.duration), duration_width),
                    Style::default().fg(Color::Gray),
                ),
            ]));
        }

        if lines.len() == 1 {
            lines.push(Line::from("No tool activity yet."));
        }

        self.render_scrollable_lines_panel(frame, area, PanelId::Tools, "TOOLS", lines);
    }

    fn render_checks_panel(&self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let mut lines = Vec::new();
        for slot in [
            CheckSlot::Tests,
            CheckSlot::Lint,
            CheckSlot::Format,
            CheckSlot::Build,
            CheckSlot::Last,
        ] {
            render_check_line(&mut lines, slot, self.checks.slots.get(&slot), width);
        }
        render_lines_panel(frame, area, "CHECKS", lines);
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
                    Span::styled("total", Style::default().fg(Color::DarkGray)),
                    Span::raw(" "),
                    Span::styled(
                        format!("+{}", self.workspace.total_additions),
                        Style::default().fg(Color::Green),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        format!("-{}", self.workspace.total_deletions),
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

        if matches!(self.send_state, SendState::Pending) {
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

        let view = wrapped_composer_view(
            self.composer.lines(),
            self.composer.cursor(),
            inner.width,
            inner.height,
        );

        frame.render_widget(
            Paragraph::new(Text::from(view.lines.clone())).style(Style::default().fg(Color::White)),
            inner,
        );
        frame.set_cursor_position((
            inner.x + view.cursor_col.min(inner.width.saturating_sub(1)),
            inner.y + view.cursor_row.min(inner.height.saturating_sub(1)),
        ));
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
            })
            .collect();
        if rows.is_empty() {
            rows.push(WrappedRow {
                logical_line: 0,
                start_char: 0,
                end_char: 0,
                text: String::new(),
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
    let (result_tx, mut result_rx) = mpsc::unbounded_channel::<Result<String, String>>();

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
    let mut animation_tick = time::interval(Duration::from_millis(75));
    animation_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    terminal.draw(|frame| app.render(frame))?;

    if let Some(prompt) = initial_prompt {
        submit_prompt(
            prompt,
            agent.clone(),
            result_tx.clone(),
            &mut app,
            &mut terminal,
        )?;
    }

    let mut outcome = TuiOutcome::Exit;

    let loop_result = async {
        while !app.quit {
            tokio::select! {
                Some(event) = input_rx.recv() => {
                    match event {
                        CrosstermEvent::Key(key) => {
                            match app.handle_key_event(key) {
                                AppAction::Submit(prompt) => {
                                    submit_prompt(prompt, agent.clone(), result_tx.clone(), &mut app, &mut terminal)?;
                                }
                                AppAction::ResumeSession(session_id) => {
                                    outcome = TuiOutcome::ResumeSession(session_id);
                                    app.quit = true;
                                }
                                AppAction::Quit | AppAction::None => {}
                            }
                        }
                        CrosstermEvent::Mouse(mouse) => {
                            app.handle_mouse_event(mouse);
                        }
                        CrosstermEvent::Paste(text) => {
                            let _ = app.handle_paste(&text);
                        }
                        CrosstermEvent::Resize(_, _) => {}
                        _ => {}
                    }
                }
                Some(agent_event) = event_rx.recv() => {
                    app.apply_agent_event(agent_event);
                }
                Some(result) = result_rx.recv() => {
                    let completed_duration = app
                        .working_started_at
                        .map(|started| started.elapsed())
                        .unwrap_or_default();
                    app.send_state = SendState::Idle;
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
                            if !app.pending_error_reported {
                                app.note_send_error(error);
                            }
                        }
                    }
                }
                _ = animation_tick.tick() => {
                    if matches!(app.send_state, SendState::Pending) {
                        app.working_frame = app.working_frame.wrapping_add(1);
                        app.advance_life();
                    }
                }
            }

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
    result_tx: mpsc::UnboundedSender<Result<String, String>>,
    app: &mut App,
    terminal: &mut UiTerminal,
) -> Result<()> {
    app.note_prompt_submitted(&prompt);
    app.clear_composer();
    app.send_state = SendState::Pending;
    app.pending_error_reported = false;
    app.working_frame = 0;
    app.working_started_at = Some(Instant::now());
    app.reset_life();

    tokio::spawn(async move {
        let result = {
            let mut agent = agent.lock().await;
            agent.send(&prompt).await.map_err(|error| error.to_string())
        };
        let _ = result_tx.send(result);
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
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

impl LifeField {
    fn ensure_size(&mut self, width: usize, height: usize) {
        let width = width.max(2);
        let height = height.max(4);
        if self.width == width && self.height == height && !self.cells.is_empty() {
            return;
        }

        self.width = width;
        self.height = height;
        self.cells = seed_life_cells(width, height);
        self.low_activity_ticks = 0;
        self.injection_phase = 0;
    }

    fn step(&mut self) {
        if self.width == 0 || self.height == 0 || self.cells.is_empty() {
            return;
        }

        let mut next = vec![false; self.cells.len()];
        let mut alive = 0usize;
        let mut changed = 0usize;
        for y in 0..self.height {
            for x in 0..self.width {
                let idx = self.index(x, y);
                let neighbors = self.live_neighbor_count(x, y);
                let next_alive =
                    matches!((self.cells[idx], neighbors), (true, 2 | 3) | (false, 3 | 6));
                next[idx] = next_alive;
                alive += usize::from(next_alive);
                changed += usize::from(self.cells[idx] != next_alive);
            }
        }

        self.cells = if alive == 0 {
            self.low_activity_ticks = 0;
            self.injection_phase = 0;
            seed_life_cells(self.width, self.height)
        } else {
            let low_activity_threshold = (self.width * self.height / 384).max(6);
            if changed <= low_activity_threshold {
                self.low_activity_ticks = self.low_activity_ticks.saturating_add(1);
            } else {
                self.low_activity_ticks = 0;
            }

            if self.low_activity_ticks >= 16 {
                inject_showcase_layout(&mut next, self.width, self.height, self.injection_phase);
                self.injection_phase =
                    (self.injection_phase + 1) % LIFE_INJECTION_LAYOUTS.len().max(1);
                self.low_activity_ticks = 4;
            }

            next
        };
    }

    fn render_lines(&self, char_width: usize, char_height: usize) -> Vec<Line<'static>> {
        let mut lines = Vec::with_capacity(char_height);
        for char_y in 0..char_height {
            let mut text = String::with_capacity(char_width);
            for char_x in 0..char_width {
                let dot_x = char_x * 2;
                let dot_y = char_y * 4;
                text.push(self.braille_char(dot_x, dot_y));
            }
            lines.push(Line::from(Span::raw(text)));
        }
        lines
    }

    fn braille_char(&self, dot_x: usize, dot_y: usize) -> char {
        let mut bits = 0u32;
        for local_y in 0..4 {
            for local_x in 0..2 {
                let x = dot_x + local_x;
                let y = dot_y + local_y;
                if x < self.width && y < self.height && self.cells[self.index(x, y)] {
                    bits |= match (local_x, local_y) {
                        (0, 0) => 0x01,
                        (0, 1) => 0x02,
                        (0, 2) => 0x04,
                        (0, 3) => 0x40,
                        (1, 0) => 0x08,
                        (1, 1) => 0x10,
                        (1, 2) => 0x20,
                        (1, 3) => 0x80,
                        _ => 0,
                    };
                }
            }
        }
        char::from_u32(0x2800 + bits).unwrap_or(' ')
    }

    fn live_neighbor_count(&self, x: usize, y: usize) -> u8 {
        let mut count = 0u8;
        for dy in [-1isize, 0, 1] {
            for dx in [-1isize, 0, 1] {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = wrap_index(x, dx, self.width);
                let ny = wrap_index(y, dy, self.height);
                if self.cells[self.index(nx, ny)] {
                    count += 1;
                }
            }
        }
        count
    }

    fn index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }
}

fn seed_life_cells(width: usize, height: usize) -> Vec<bool> {
    let mut cells = vec![false; width.saturating_mul(height)];
    if width == 0 || height == 0 {
        return cells;
    }

    inject_showcase_layout(&mut cells, width, height, 0);

    cells
}

fn inject_showcase_layout(cells: &mut [bool], width: usize, height: usize, phase: usize) {
    if width == 0 || height == 0 || cells.is_empty() {
        return;
    }

    let layouts_len = LIFE_INJECTION_LAYOUTS.len();
    if layouts_len == 0 {
        return;
    }

    for placement in LIFE_INJECTION_LAYOUTS[phase % layouts_len] {
        inject_pattern(cells, width, height, *placement);
    }
}

#[derive(Clone, Copy)]
struct SeedPattern {
    width: usize,
    height: usize,
    cells: &'static [(usize, usize)],
}

#[derive(Clone, Copy)]
struct PatternPlacement {
    pattern: SeedPattern,
    dx: isize,
    dy: isize,
    rotation: u8,
    flip: bool,
}

const GLIDER_PATTERN: SeedPattern = SeedPattern {
    width: 3,
    height: 3,
    cells: &[(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)],
};

const R_PENTOMINO_PATTERN: SeedPattern = SeedPattern {
    width: 3,
    height: 3,
    cells: &[(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)],
};

const ACORN_PATTERN: SeedPattern = SeedPattern {
    width: 7,
    height: 3,
    cells: &[(1, 0), (3, 1), (0, 2), (1, 2), (4, 2), (5, 2), (6, 2)],
};

const LWSS_PATTERN: SeedPattern = SeedPattern {
    width: 5,
    height: 4,
    cells: &[
        (1, 0),
        (2, 0),
        (3, 0),
        (4, 0),
        (0, 1),
        (4, 1),
        (4, 2),
        (0, 3),
        (3, 3),
    ],
};

const LIFE_LAYOUT_WIDTH_SCALE: isize = 5;

const LIFE_INJECTION_LAYOUTS: &[&[PatternPlacement]] = &[
    &[
        PatternPlacement {
            pattern: GLIDER_PATTERN,
            dx: -14,
            dy: -8,
            rotation: 0,
            flip: false,
        },
        PatternPlacement {
            pattern: GLIDER_PATTERN,
            dx: 14,
            dy: -8,
            rotation: 1,
            flip: false,
        },
        PatternPlacement {
            pattern: GLIDER_PATTERN,
            dx: -14,
            dy: 8,
            rotation: 3,
            flip: false,
        },
        PatternPlacement {
            pattern: GLIDER_PATTERN,
            dx: 14,
            dy: 8,
            rotation: 2,
            flip: false,
        },
        PatternPlacement {
            pattern: ACORN_PATTERN,
            dx: 0,
            dy: -1,
            rotation: 0,
            flip: false,
        },
        PatternPlacement {
            pattern: R_PENTOMINO_PATTERN,
            dx: -5,
            dy: 4,
            rotation: 0,
            flip: false,
        },
        PatternPlacement {
            pattern: R_PENTOMINO_PATTERN,
            dx: 5,
            dy: 4,
            rotation: 2,
            flip: true,
        },
    ],
    &[
        PatternPlacement {
            pattern: LWSS_PATTERN,
            dx: -18,
            dy: -6,
            rotation: 0,
            flip: false,
        },
        PatternPlacement {
            pattern: LWSS_PATTERN,
            dx: 18,
            dy: 6,
            rotation: 2,
            flip: false,
        },
        PatternPlacement {
            pattern: ACORN_PATTERN,
            dx: -8,
            dy: 0,
            rotation: 1,
            flip: false,
        },
        PatternPlacement {
            pattern: ACORN_PATTERN,
            dx: 8,
            dy: 0,
            rotation: 3,
            flip: true,
        },
        PatternPlacement {
            pattern: GLIDER_PATTERN,
            dx: 0,
            dy: -12,
            rotation: 0,
            flip: false,
        },
        PatternPlacement {
            pattern: GLIDER_PATTERN,
            dx: 0,
            dy: 12,
            rotation: 2,
            flip: false,
        },
    ],
    &[
        PatternPlacement {
            pattern: R_PENTOMINO_PATTERN,
            dx: -10,
            dy: -4,
            rotation: 0,
            flip: false,
        },
        PatternPlacement {
            pattern: R_PENTOMINO_PATTERN,
            dx: 10,
            dy: -4,
            rotation: 1,
            flip: false,
        },
        PatternPlacement {
            pattern: R_PENTOMINO_PATTERN,
            dx: -10,
            dy: 4,
            rotation: 3,
            flip: true,
        },
        PatternPlacement {
            pattern: R_PENTOMINO_PATTERN,
            dx: 10,
            dy: 4,
            rotation: 2,
            flip: true,
        },
        PatternPlacement {
            pattern: LWSS_PATTERN,
            dx: 0,
            dy: -10,
            rotation: 1,
            flip: false,
        },
        PatternPlacement {
            pattern: LWSS_PATTERN,
            dx: 0,
            dy: 10,
            rotation: 3,
            flip: false,
        },
    ],
];

fn inject_pattern(cells: &mut [bool], width: usize, height: usize, placement: PatternPlacement) {
    if width == 0 || height == 0 {
        return;
    }

    let center_x = (width / 2) as isize;
    let center_y = (height / 2) as isize;
    let anchor_x = center_x + placement.dx.saturating_mul(LIFE_LAYOUT_WIDTH_SCALE);
    let anchor_y = center_y + placement.dy;
    let (placed_width, placed_height) = rotated_dimensions(
        placement.pattern.width,
        placement.pattern.height,
        placement.rotation,
    );
    let origin_x = anchor_x - placed_width as isize / 2;
    let origin_y = anchor_y - placed_height as isize / 2;

    for &(x, y) in placement.pattern.cells {
        let (mut px, py) = rotate_cell(
            x,
            y,
            placement.pattern.width,
            placement.pattern.height,
            placement.rotation,
        );
        if placement.flip {
            px = placed_width.saturating_sub(1).saturating_sub(px);
        }
        let world_x = wrap_index_signed(origin_x + px as isize, width);
        let world_y = wrap_index_signed(origin_y + py as isize, height);
        cells[world_y * width + world_x] = true;
    }
}

fn wrap_index(index: usize, delta: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    ((index as isize + delta).rem_euclid(len as isize)) as usize
}

fn wrap_index_signed(index: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    index.rem_euclid(len as isize) as usize
}

fn rotated_dimensions(width: usize, height: usize, rotation: u8) -> (usize, usize) {
    if rotation % 2 == 0 {
        (width, height)
    } else {
        (height, width)
    }
}

fn rotate_cell(x: usize, y: usize, width: usize, height: usize, rotation: u8) -> (usize, usize) {
    match rotation % 4 {
        0 => (x, y),
        1 => (height.saturating_sub(1).saturating_sub(y), x),
        2 => (
            width.saturating_sub(1).saturating_sub(x),
            height.saturating_sub(1).saturating_sub(y),
        ),
        _ => (y, width.saturating_sub(1).saturating_sub(x)),
    }
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
        Span::raw("  "),
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
    let status_width = 4usize;
    let delta_width = 6usize;
    let path_width = width.saturating_sub(status_width + delta_width * 2 + 4);
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
            content.push_str("  ");
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

fn render_check_line(
    lines: &mut Vec<Line<'static>>,
    slot: CheckSlot,
    record: Option<&CheckRecord>,
    width: usize,
) {
    match record {
        Some(record) => {
            let detail = if record.summary.is_empty() {
                record.target.clone()
            } else {
                format!("{} • {}", record.target, record.summary)
            };
            lines.push(Line::from(vec![
                status_span(record.status.label(), record.status.tone()),
                Span::raw(" "),
                Span::styled(
                    pad_cell(slot.label(), 7),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                Span::raw(fit_text(&detail, width.saturating_sub(14))),
            ]));
        }
        None => {
            lines.push(Line::from(vec![
                Span::styled("----", Style::default().fg(Color::DarkGray)),
                Span::raw(" "),
                Span::styled(
                    pad_cell(slot.label(), 7),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" waiting"),
            ]));
        }
    }
}

fn render_wrapped_row(
    row: &WrappedRow,
    selection: Option<(SelectionPoint, SelectionPoint)>,
) -> Line<'static> {
    let base_style = Style::default().fg(Color::Gray);
    let selected_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    let Some((start, end)) = selection else {
        return Line::from(Span::styled(row.text.clone(), base_style));
    };
    let Some((selection_start, selection_end)) = selection_overlap_for_row(row, &start, &end)
    else {
        return Line::from(Span::styled(row.text.clone(), base_style));
    };

    if row.text.is_empty() || selection_start == selection_end {
        return Line::from(Span::styled(row.text.clone(), base_style));
    }

    let chars: Vec<char> = row.text.chars().collect();
    let before: String = chars[..selection_start].iter().collect();
    let selected: String = chars[selection_start..selection_end].iter().collect();
    let after: String = chars[selection_end..].iter().collect();

    let mut spans = Vec::new();
    if !before.is_empty() {
        spans.push(Span::styled(before, base_style));
    }
    if !selected.is_empty() {
        spans.push(Span::styled(selected, selected_style));
    }
    if !after.is_empty() {
        spans.push(Span::styled(after, base_style));
    }
    if spans.is_empty() {
        spans.push(Span::styled(row.text.clone(), base_style));
    }
    Line::from(spans)
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

fn classify_check_slot(command: &str) -> CheckSlot {
    let lower = command.to_lowercase();
    if contains_any(
        &lower,
        &[
            "cargo test",
            "pytest",
            "npm test",
            "pnpm test",
            "go test",
            "vitest",
            "jest",
        ],
    ) {
        return CheckSlot::Tests;
    }
    if contains_any(
        &lower,
        &[
            "clippy",
            "eslint",
            "ruff check",
            "flake8",
            "golangci-lint",
            "mypy",
            "tsc",
        ],
    ) {
        return CheckSlot::Lint;
    }
    if contains_any(
        &lower,
        &[
            "cargo fmt",
            "ruff format",
            "prettier",
            "black",
            "gofmt",
            "rustfmt",
        ],
    ) {
        return CheckSlot::Format;
    }
    if contains_any(
        &lower,
        &[
            "cargo build",
            "npm run build",
            "pnpm build",
            "go build",
            "uv run build",
            "make build",
        ],
    ) {
        return CheckSlot::Build;
    }
    CheckSlot::Last
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
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

fn run_git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
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

    if lines.len() == 1 && lines.first().is_some_and(|line| line.is_empty()) {
        return WrappedComposerView {
            lines: vec![prompt_line(true, "")],
            cursor_row: 0,
            cursor_col: prefix_width as u16,
        };
    }

    let mut visual_lines = Vec::new();
    let mut cursor_row = 0usize;
    let mut cursor_col = 0usize;
    let mut cursor_set = false;

    for (row, line) in lines.iter().enumerate() {
        let segments = wrap_soft_line(line, effective_width);
        let mut start = 0usize;
        for (segment_index, segment) in segments.iter().enumerate() {
            let segment_len = segment.chars().count();
            let end = start + segment_len;
            if !cursor_set && row == cursor.0 {
                let is_last_segment = segment_index + 1 == segments.len();
                if cursor.1 <= end || is_last_segment {
                    cursor_row = visual_lines.len();
                    cursor_col = prefix_width + cursor.1.saturating_sub(start).min(segment_len);
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
        .map(|(is_first, line)| prompt_line(is_first, &line))
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
            });
            continue;
        }
        for (start_char, end_char, text) in wrapped {
            rows.push(WrappedRow {
                logical_line,
                start_char,
                end_char,
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
        });
    }
    rows
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

fn prompt_line(is_first: bool, content: &str) -> Line<'static> {
    let mut spans = Vec::new();
    if is_first {
        spans.push(Span::styled(
            PROMPT_SEPARATOR,
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
    } else {
        spans.push(Span::styled(
            CONTINUATION_PREFIX.to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }
    spans.push(Span::styled(
        content.to_string(),
        Style::default().fg(Color::White),
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
