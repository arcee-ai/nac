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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum PanelId {
    Prompt,
    Events,
    Threads,
    Response,
    Workspace,
    Worksets,
    ThreadList,
    ThreadEpisodes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResponseEntry {
    pub(super) content: String,
    pub(super) duration: Option<Duration>,
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
    pub(super) updated_at: String,
    pub(super) updated_at_ts: u64,
    pub(super) episodes: i64,
    pub(super) summary: String,
}

#[derive(Debug, Clone)]
pub(super) struct ToolEventContext {
    pub(super) thread_name: Option<String>,
    pub(super) name: String,
    pub(super) target: String,
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
    Prompt,
    Events,
    Response,
    Threads,
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
    pub(super) sessions: Vec<SessionSummarySnapshot>,
    pub(super) selected: usize,
    pub(super) error: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ComposerNotice {
    pub(super) text: String,
    pub(super) tone: Tone,
    pub(super) expires_at: Instant,
}
