use std::io;
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event as CrosstermEvent, KeyCode, KeyEvent,
    KeyEventKind, KeyModifiers, KeyboardEnhancementFlags, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::style::Stylize;
use crossterm::terminal::{disable_raw_mode, supports_keyboard_enhancement};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Paragraph, Widget};
use ratatui::{Terminal, TerminalOptions, Viewport};
use ratatui_textarea::TextArea;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{self, MissedTickBehavior};

use crate::agent::Agent;
use crate::events::{AgentEvent, EventSink};
use crate::sessions::{self, SessionSnapshot};
use crate::types::Message;

const COMPOSER_VIEWPORT_HEIGHT: u16 = 6;
const EPISODE_PREVIEW_LINE_LIMIT: usize = 8;
const EPISODE_PREVIEW_CHAR_LIMIT: usize = 700;
const PROMPT_LABEL: &str = "ask";
const PROMPT_SEPARATOR: &str = " › ";
const CONTINUATION_PREFIX: &str = "    · ";

type UiTerminal = Terminal<CrosstermBackend<io::Stdout>>;

#[derive(Clone)]
pub struct TuiMetadata {
    pub cwd: String,
    pub model: String,
    pub base_url: String,
    pub backend: String,
    pub reasoning_effort: Option<String>,
    pub session_id: Option<String>,
    pub sandbox_status: String,
    pub agents_md_status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    User,
    Assistant,
    Tool,
    Thread,
    Error,
    Log,
}

impl EntryKind {
    fn symbol(self) -> &'static str {
        match self {
            EntryKind::User => "●",
            EntryKind::Assistant => "○",
            EntryKind::Tool => "◆",
            EntryKind::Thread => "◇",
            EntryKind::Error => "×",
            EntryKind::Log => "·",
        }
    }

    fn accent(self) -> Color {
        match self {
            EntryKind::User => Color::Cyan,
            EntryKind::Assistant => Color::Green,
            EntryKind::Tool => Color::Yellow,
            EntryKind::Thread => Color::Magenta,
            EntryKind::Error => Color::Red,
            EntryKind::Log => Color::DarkGray,
        }
    }

    fn symbol_style(self) -> Style {
        Style::default()
            .fg(self.accent())
            .add_modifier(Modifier::BOLD)
    }
}

#[derive(Debug, Clone)]
struct UiEntry {
    kind: EntryKind,
    title: String,
    body: String,
    spacing_after: u16,
    muted_body: bool,
    symbol_override: Option<&'static str>,
}

impl UiEntry {
    fn new(kind: EntryKind, title: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            kind,
            title: title.into(),
            body: body.into(),
            spacing_after: 1,
            muted_body: false,
            symbol_override: None,
        }
    }

    fn muted_body(mut self) -> Self {
        self.muted_body = true;
        self
    }

    fn with_spacing_after(mut self, spacing_after: u16) -> Self {
        self.spacing_after = spacing_after;
        self
    }

    fn symbol_text(&self) -> &'static str {
        self.symbol_override.unwrap_or_else(|| self.kind.symbol())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SendState {
    Idle,
    Pending,
}

struct App {
    composer: TextArea<'static>,
    send_state: SendState,
    quit: bool,
    pending_error_reported: bool,
    working_frame: usize,
    working_started_at: Option<Instant>,
}

impl App {
    fn new() -> Self {
        Self {
            composer: build_composer(),
            send_state: SendState::Idle,
            quit: false,
            pending_error_reported: false,
            working_frame: 0,
            working_started_at: None,
        }
    }

    fn prompt(&self) -> String {
        self.composer.lines().join("\n")
    }

    fn clear_composer(&mut self) {
        self.composer = build_composer();
    }

    fn handle_paste(&mut self, text: &str) -> AppAction {
        if matches!(self.send_state, SendState::Pending) {
            return AppAction::None;
        }

        self.composer.insert_str(&normalize_paste(text));
        AppAction::None
    }

    fn apply_agent_event(&mut self, event: AgentEvent) -> Vec<UiEntry> {
        match event {
            AgentEvent::RunStarted { .. } => Vec::new(),
            AgentEvent::ModelCallStarted { .. } => Vec::new(),
            AgentEvent::ToolCallStarted {
                thread_name,
                name,
                args_preview,
            } => {
                if thread_name.is_none() && name == "thread" {
                    return Vec::new();
                }
                let title = match thread_name {
                    Some(thread_name) => format!("{thread_name} · {name}"),
                    None => name,
                };
                vec![UiEntry::new(EntryKind::Tool, title, args_preview)]
            }
            AgentEvent::ToolCallFinished {
                thread_name,
                name,
                content_preview,
                is_error,
            } => {
                if thread_name.is_none() && name == "thread" {
                    return Vec::new();
                }
                let kind = if is_error {
                    self.pending_error_reported = true;
                    EntryKind::Error
                } else {
                    EntryKind::Tool
                };
                let title = match thread_name {
                    Some(thread_name) => format!("{thread_name} · {name}"),
                    None => name,
                };
                vec![UiEntry::new(kind, title, content_preview)]
            }
            AgentEvent::ThreadStarted {
                name,
                action,
                source_threads,
            } => {
                let body = if source_threads.is_empty() {
                    format!("action: {action}")
                } else {
                    format!(
                        "action: {action}\nsource threads: {}",
                        source_threads.join(", ")
                    )
                };
                vec![UiEntry::new(
                    EntryKind::Thread,
                    format!("{name} • thread dispatch"),
                    body,
                )]
            }
            AgentEvent::ThreadLog { name, line } => {
                vec![UiEntry::new(EntryKind::Log, name, line)]
            }
            AgentEvent::ThreadFinished {
                name,
                exit_code,
                timed_out,
            } => {
                let body = if timed_out {
                    "timed out".to_string()
                } else {
                    format!("exit code {exit_code}")
                };
                vec![UiEntry::new(
                    EntryKind::Thread,
                    format!("{name} • thread complete"),
                    body,
                )]
            }
            AgentEvent::AssistantMessage {
                thread_name,
                content,
            } => {
                match thread_name {
                    Some(thread_name) => vec![UiEntry::new(
                        EntryKind::Assistant,
                        format!("{thread_name} • retained episode"),
                        truncate_episode_preview(&content),
                    )
                    .muted_body()],
                    None => vec![UiEntry::new(EntryKind::Assistant, "response", content)
                        .with_spacing_after(2)],
                }
            }
            AgentEvent::Error {
                thread_name,
                message,
            } => {
                self.pending_error_reported = true;
                let title = thread_name.unwrap_or_else(|| "run".to_string());
                vec![UiEntry::new(EntryKind::Error, title, message)]
            }
            AgentEvent::RunFinished { .. } => Vec::new(),
        }
    }

    fn handle_key_event(&mut self, key: KeyEvent) -> AppAction {
        if key.kind == KeyEventKind::Release {
            return AppAction::None;
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
                code: KeyCode::Enter,
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::SHIFT) => {
                self.composer.insert_newline();
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

                AppAction::Submit(prompt)
            }
            _ => {
                self.composer.input(key);
                AppAction::None
            }
        }
    }

    fn render(&mut self, frame: &mut ratatui::Frame) {
        self.render_composer(frame, frame.area());
    }

    fn render_composer(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        if matches!(self.send_state, SendState::Pending) {
            self.render_working(frame, area);
            return;
        }

        if area.width == 0 || area.height == 0 {
            return;
        }

        let footer_height = 1;
        let max_composer_height = area.height.saturating_sub(footer_height).max(1);
        let content_height = composer_content_height(self.composer.lines(), area.width);
        let composer_height = content_height.clamp(1, max_composer_height);
        let composer_area = Rect::new(area.x, area.y, area.width, composer_height);
        let footer_area = Rect::new(
            area.x,
            area.y.saturating_add(composer_height),
            area.width,
            footer_height.min(area.height.saturating_sub(composer_height)),
        );

        let view = wrapped_composer_view(
            self.composer.lines(),
            self.composer.cursor(),
            composer_area.width,
            composer_area.height,
        );

        let paragraph = Paragraph::new(Text::from(view.lines.clone()))
            .style(Style::default().fg(Color::White));
        frame.render_widget(paragraph, composer_area);
        frame.set_cursor_position((
            composer_area.x + view.cursor_col.min(composer_area.width.saturating_sub(1)),
            composer_area.y + view.cursor_row.min(composer_area.height.saturating_sub(1)),
        ));

        if footer_area.height > 0 {
            let footer = Paragraph::new(Line::from(vec![
                Span::raw(" "),
                Span::styled("/exit to quit", Style::default().fg(Color::DarkGray)),
                Span::styled("  ·  ", Style::default().fg(Color::DarkGray)),
                Span::styled("ctrl-c to force quit", Style::default().fg(Color::DarkGray)),
            ]));
            frame.render_widget(footer, footer_area);
        }
    }

    fn render_working(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        if area.height == 0 {
            return;
        }

        let elapsed = self
            .working_started_at
            .map(|started| started.elapsed())
            .unwrap_or_default();
        let status = Paragraph::new(working_line(self.working_frame, elapsed));
        let line_area = Rect::new(area.x, area.y, area.width, 1);
        frame.render_widget(status, line_area);
    }
}

#[derive(Debug)]
enum AppAction {
    None,
    Quit,
    Submit(String),
}

pub async fn run(
    mut agent: Agent,
    initial_prompt: Option<String>,
    metadata: TuiMetadata,
    restored_messages: Vec<Message>,
    mut session_snapshot: Option<SessionSnapshot>,
) -> Result<()> {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<CrosstermEvent>();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AgentEvent>();
    let (result_tx, mut result_rx) = mpsc::unbounded_channel::<Result<String, String>>();

    agent.set_event_sink(EventSink::channel(event_tx));
    let agent = Arc::new(Mutex::new(agent));

    let running = Arc::new(AtomicBool::new(true));
    let input_thread = spawn_input_thread(running.clone(), input_tx);
    let mut animation_tick = time::interval(Duration::from_millis(150));
    animation_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    print_preamble_plain(&metadata)?;
    let mut terminal = ratatui::try_init_with_options(TerminalOptions {
        viewport: Viewport::Inline(COMPOSER_VIEWPORT_HEIGHT),
    })?;
    terminal.hide_cursor()?;
    let keyboard_enhancements_enabled = enable_keyboard_enhancements(&mut terminal);
    let bracketed_paste_enabled = enable_bracketed_paste(&mut terminal);

    let mut app = App::new();
    print_restored_history(&mut terminal, &restored_messages)?;
    terminal.draw(|frame| app.render(frame))?;

    if let Some(prompt) = initial_prompt {
        submit_prompt(
            prompt,
            agent.clone(),
            result_tx.clone(),
            &mut app,
            &mut terminal,
        )?;
        terminal.draw(|frame| app.render(frame))?;
    }

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
                                AppAction::Quit | AppAction::None => {}
                            }
                        }
                        CrosstermEvent::Paste(text) => {
                            let _ = app.handle_paste(&text);
                        }
                        CrosstermEvent::Resize(_, _) => {}
                        _ => {}
                    }
                }
                Some(agent_event) = event_rx.recv() => {
                    for entry in app.apply_agent_event(agent_event) {
                        print_entry(&mut terminal, &entry)?;
                    }
                }
                Some(result) = result_rx.recv() => {
                    app.send_state = SendState::Idle;
                    app.working_frame = 0;
                    app.working_started_at = None;
                    if let Some(snapshot) = session_snapshot.as_mut() {
                        let agent = agent.lock().await;
                        persist_session_snapshot(snapshot, &agent)?;
                    }
                    if let Err(error) = result {
                        if !app.pending_error_reported {
                            print_entry(&mut terminal, &UiEntry::new(EntryKind::Error, "send", error))?;
                        }
                    }
                }
                _ = animation_tick.tick(), if matches!(app.send_state, SendState::Pending) => {
                    app.working_frame = app.working_frame.wrapping_add(1);
                }
            }

            terminal.draw(|frame| app.render(frame))?;
        }

        Ok::<(), anyhow::Error>(())
    }
    .await;

    running.store(false, Ordering::SeqCst);
    let _ = input_thread.join();

    let cleanup_result = (|| -> io::Result<()> {
        if keyboard_enhancements_enabled {
            let _ = crossterm::execute!(terminal.backend_mut(), PopKeyboardEnhancementFlags);
        }
        if bracketed_paste_enabled {
            let _ = crossterm::execute!(terminal.backend_mut(), DisableBracketedPaste);
        }
        terminal.clear()?;
        terminal.show_cursor()?;
        disable_raw_mode()
    })();

    loop_result?;
    cleanup_result?;
    Ok(())
}

fn submit_prompt(
    prompt: String,
    agent: Arc<Mutex<Agent>>,
    result_tx: mpsc::UnboundedSender<Result<String, String>>,
    app: &mut App,
    terminal: &mut UiTerminal,
) -> Result<()> {
    print_entry(terminal, &UiEntry::new(EntryKind::User, "prompt", &prompt))?;
    app.clear_composer();
    app.send_state = SendState::Pending;
    app.pending_error_reported = false;
    app.working_frame = 0;
    app.working_started_at = Some(Instant::now());

    tokio::spawn(async move {
        let result = {
            let mut agent = agent.lock().await;
            agent.send(&prompt).await.map_err(|error| error.to_string())
        };
        let _ = result_tx.send(result);
    });

    Ok(())
}

fn build_composer() -> TextArea<'static> {
    TextArea::default()
}

fn print_entry(terminal: &mut UiTerminal, entry: &UiEntry) -> Result<()> {
    let width = terminal.size()?.width;
    if width == 0 {
        return Ok(());
    }

    let rendered_lines = wrapped_entry_lines(entry, width);
    let widget = build_entry_widget(entry, rendered_lines);
    let body_height = entry_render_height(entry, width);
    let total_height = body_height.saturating_add(entry.spacing_after);
    let spacing_after = entry.spacing_after;

    terminal.insert_before(total_height, move |buf| {
        let area = buf.area;
        let render_height = area.height.saturating_sub(spacing_after);
        if render_height == 0 {
            return;
        }
        let render_area = Rect::new(area.x, area.y, area.width, render_height);
        widget.render(render_area, buf);
    })?;

    Ok(())
}

fn print_blank_line(terminal: &mut UiTerminal) -> Result<()> {
    terminal.insert_before(1, |_| {})?;
    Ok(())
}

fn entry_render_height(entry: &UiEntry, width: u16) -> u16 {
    if width == 0 {
        return 0;
    }

    wrapped_entry_lines(entry, width).len().max(1) as u16
}

fn build_entry_widget(entry: &UiEntry, rendered_lines: Vec<String>) -> Paragraph<'static> {
    let title_style = match entry.kind {
        EntryKind::Log => Style::default().fg(Color::DarkGray),
        _ => Style::default().fg(Color::White),
    };
    let body_style = if entry.muted_body || entry.kind == EntryKind::Log {
        Style::default().fg(Color::DarkGray)
    } else {
        match entry.kind {
            EntryKind::Error => Style::default().fg(Color::Gray),
            _ => Style::default().fg(Color::Gray),
        }
    };

    let mut lines = Vec::new();
    for (index, line) in rendered_lines.into_iter().enumerate() {
        let is_title_line = index == 0;
        if is_title_line {
            let content = line
                .strip_prefix(&format!("{} ", entry.symbol_text()))
                .unwrap_or(&line)
                .to_string();
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{} ", entry.symbol_text()),
                    entry.kind.symbol_style(),
                ),
                Span::styled(content, title_style),
            ]));
            continue;
        }

        if let Some(content) = line.strip_prefix("  ") {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::DarkGray)),
                Span::styled(content.to_string(), body_style),
            ]));
        } else {
            lines.push(Line::from(Span::styled(line, body_style)));
        }
    }

    Paragraph::new(Text::from(lines))
}

fn wrapped_entry_lines(entry: &UiEntry, width: u16) -> Vec<String> {
    if width == 0 {
        return Vec::new();
    }

    let width = width as usize;
    if entry.kind == EntryKind::Log {
        let wrapped = wrap_soft_line(
            &format!("{} {} {}", entry.symbol_text(), entry.title, entry.body),
            width,
        );
        return if wrapped.is_empty() {
            vec![String::new()]
        } else {
            wrapped
        };
    }

    let mut wrapped = wrap_with_prefix(&format!("{} ", entry.symbol_text()), &entry.title, width);

    if !entry.body.is_empty() {
        for line in entry.body.split('\n') {
            wrapped.extend(wrap_with_prefix("  ", line, width));
        }
    }

    if wrapped.is_empty() {
        wrapped.push(String::new());
    }
    wrapped
}

fn print_preamble_plain(metadata: &TuiMetadata) -> Result<()> {
    let mut out = io::stdout().lock();
    writeln!(out)?;
    writeln!(
        out,
        "{}",
        format!("● OPENAI_MODEL: {}", metadata.model).dark_grey()
    )?;
    if let Some(reasoning_effort) = metadata.reasoning_effort.as_deref() {
        writeln!(
            out,
            "{}",
            format!("● effort: {}", reasoning_effort).dark_grey()
        )?;
    }
    writeln!(
        out,
        "{}",
        format!("● OPENAI_BASE_URL: {}", metadata.base_url).dark_grey()
    )?;
    writeln!(
        out,
        "{}",
        format!("● backend: {}", metadata.backend).dark_grey()
    )?;
    writeln!(
        out,
        "{}",
        format!("● sandbox: {}", metadata.sandbox_status).dark_grey()
    )?;
    writeln!(
        out,
        "{}",
        format!("● AGENTS.md: {}", metadata.agents_md_status).dark_grey()
    )?;
    writeln!(out, "{}", format!("● cwd: {}", metadata.cwd).dark_grey())?;
    if let Some(session_id) = metadata.session_id.as_deref() {
        writeln!(
            out,
            "{}",
            format!("● session: {}", short_session(session_id)).dark_grey()
        )?;
    }
    writeln!(out)?;
    out.flush()?;
    Ok(())
}

fn print_restored_history(terminal: &mut UiTerminal, messages: &[Message]) -> Result<()> {
    let mut printed_any = false;
    for message in messages {
        match message {
            Message::User { content } => {
                print_entry(terminal, &UiEntry::new(EntryKind::User, "prompt", content))?;
                printed_any = true;
            }
            Message::Assistant {
                content: Some(content),
                ..
            } => {
                print_entry(
                    terminal,
                    &UiEntry::new(EntryKind::Assistant, "response", content).with_spacing_after(2),
                )?;
                printed_any = true;
            }
            _ => {}
        }
    }
    if printed_any {
        print_blank_line(terminal)?;
    }
    Ok(())
}

fn persist_session_snapshot(snapshot: &mut SessionSnapshot, agent: &Agent) -> Result<()> {
    let refreshed = sessions::refresh_snapshot(snapshot, agent.messages.clone());
    sessions::save_session(&refreshed)?;
    *snapshot = refreshed;
    Ok(())
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

fn composer_content_height(lines: &[String], width: u16) -> u16 {
    if lines.len() == 1 && lines.first().is_some_and(|line| line.is_empty()) {
        return 1;
    }

    let width = width.max(1) as usize;
    let effective_width = width.saturating_sub(composer_prefix_width()).max(1);
    lines
        .iter()
        .map(|line| wrap_soft_line(line, effective_width).len() as u16)
        .fold(0u16, |acc, count| acc.saturating_add(count))
        .max(1)
}

fn composer_prefix_width() -> usize {
    PROMPT_LABEL.chars().count() + PROMPT_SEPARATOR.chars().count()
}

fn prompt_line(is_first: bool, content: &str) -> Line<'static> {
    let mut spans = Vec::new();
    if is_first {
        spans.push(Span::styled(
            PROMPT_LABEL,
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            PROMPT_SEPARATOR,
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
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
    if width == 0 {
        return vec![String::new()];
    }
    if line.is_empty() {
        return vec![String::new()];
    }

    let chars: Vec<char> = line.chars().collect();
    let mut segments = Vec::new();
    let mut start = 0usize;

    while start < chars.len() {
        let remaining = chars.len() - start;
        if remaining <= width {
            segments.push(chars[start..].iter().collect());
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
            segments.push(chars[start..forced_end].iter().collect());
            start = forced_end;
        } else {
            segments.push(chars[start..end].iter().collect());
            start = end;
        }
    }

    if segments.is_empty() {
        segments.push(String::new());
    }

    segments
}

fn wrap_with_prefix(prefix: &str, content: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![String::new()];
    }

    let prefix_width = prefix.chars().count();
    if prefix_width >= width {
        return vec![format!("{prefix}{content}")];
    }

    let mut wrapped = Vec::new();
    let effective_width = width - prefix_width;
    for segment in wrap_soft_line(content, effective_width) {
        wrapped.push(format!("{prefix}{segment}"));
    }
    if wrapped.is_empty() {
        wrapped.push(prefix.to_string());
    }
    wrapped
}

fn short_session(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

fn working_line(frame: usize, elapsed: Duration) -> Line<'static> {
    const FRAMES: [&str; 6] = ["●○○○", "○●○○", "○○●○", "○○○●", "○○●○", "○●○○"];
    let glyphs = FRAMES[frame % FRAMES.len()];
    let elapsed_text = format_elapsed(elapsed);
    Line::from(vec![
        Span::raw("  "),
        Span::styled("working", Style::default().fg(Color::White)),
        Span::raw(" "),
        Span::styled("[", Style::default().fg(Color::DarkGray)),
        Span::styled(glyphs.to_string(), Style::default().fg(Color::Gray)),
        Span::styled("]", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled(elapsed_text, Style::default().fg(Color::DarkGray)),
    ])
}

fn format_elapsed(elapsed: Duration) -> String {
    let total_seconds = elapsed.as_secs();
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{minutes}m{seconds:02}s")
}

fn truncate_episode_preview(content: &str) -> String {
    let mut lines = Vec::new();
    let mut char_count = 0usize;
    let mut truncated = false;

    for (index, line) in content.split('\n').enumerate() {
        if index >= EPISODE_PREVIEW_LINE_LIMIT {
            truncated = true;
            break;
        }

        let line_chars = line.chars().count();
        let remaining_chars = EPISODE_PREVIEW_CHAR_LIMIT.saturating_sub(char_count);
        if line_chars > remaining_chars {
            lines.push(take_chars(line, remaining_chars));
            truncated = true;
            break;
        }

        lines.push(line.to_string());
        char_count = char_count.saturating_add(line_chars);
        if char_count >= EPISODE_PREVIEW_CHAR_LIMIT {
            truncated = true;
            break;
        }
    }

    if lines.is_empty() && !content.is_empty() {
        lines.push(take_chars(content, EPISODE_PREVIEW_CHAR_LIMIT));
        truncated = content.chars().count() > EPISODE_PREVIEW_CHAR_LIMIT;
    }

    if truncated {
        lines.push("… [truncated retained episode preview]".to_string());
    }

    lines.join("\n")
}

fn take_chars(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
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

fn normalize_paste(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn spawn_input_thread(
    running: Arc<AtomicBool>,
    input_tx: mpsc::UnboundedSender<CrosstermEvent>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shift_enter_inserts_newline() {
        let mut app = App::new();
        app.composer.insert_str("hello");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::SHIFT));

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "hello\n");
    }

    #[test]
    fn enter_submits_prompt() {
        let mut app = App::new();
        app.composer.insert_str("hello");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match action {
            AppAction::Submit(prompt) => assert_eq!(prompt, "hello"),
            _ => panic!("expected submit"),
        }
    }

    #[test]
    fn slash_exit_quits() {
        let mut app = App::new();
        app.composer.insert_str("/exit");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::Quit));
        assert!(app.quit);
    }

    #[test]
    fn thread_dispatch_entry_is_labeled_explicitly() {
        let mut app = App::new();
        let entries = app.apply_agent_event(AgentEvent::ThreadStarted {
            name: "auth".to_string(),
            action: "inspect auth flow".to_string(),
            source_threads: vec!["tests".to_string()],
        });

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "auth • thread dispatch");
    }

    #[test]
    fn retained_episode_preview_is_truncated() {
        let mut app = App::new();
        let long = (0..20)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");

        let entries = app.apply_agent_event(AgentEvent::AssistantMessage {
            thread_name: Some("auth".to_string()),
            content: long,
        });

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "auth • retained episode");
        assert!(entries[0]
            .body
            .contains("[truncated retained episode preview]"));
    }

    #[test]
    fn repeat_backspace_is_processed() {
        use crossterm::event::KeyEventState;

        let mut app = App::new();
        app.composer.insert_str("ab");

        let action = app.handle_key_event(KeyEvent {
            code: KeyCode::Backspace,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Repeat,
            state: KeyEventState::NONE,
        });

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "a");
    }

    #[test]
    fn multiline_paste_inserts_newlines_without_submit() {
        let mut app = App::new();

        let action = app.handle_paste("hello\nworld");

        assert!(matches!(action, AppAction::None));
        assert_eq!(app.prompt(), "hello\nworld");
    }

    #[test]
    fn pasted_crlf_is_normalized_to_newlines() {
        let mut app = App::new();

        app.handle_paste("hello\r\nworld\rtest");

        assert_eq!(app.prompt(), "hello\nworld\ntest");
    }
}
