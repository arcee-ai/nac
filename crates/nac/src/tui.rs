use std::io;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{
    self, Event as CrosstermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
    KeyboardEnhancementFlags, PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
};
use crossterm::terminal::{disable_raw_mode, supports_keyboard_enhancement};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Padding, Paragraph, Widget, Wrap};
use ratatui::{Terminal, TerminalOptions, Viewport};
use ratatui_textarea::TextArea;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{self, MissedTickBehavior};

use crate::agent::Agent;
use crate::events::{AgentEvent, EventSink};

const COMPOSER_VIEWPORT_HEIGHT: u16 = 8;
const EPISODE_PREVIEW_LINE_LIMIT: usize = 8;
const EPISODE_PREVIEW_CHAR_LIMIT: usize = 700;

type UiTerminal = Terminal<CrosstermBackend<io::Stdout>>;

#[derive(Clone)]
pub struct TuiMetadata {
    pub cwd: String,
    pub model: String,
    pub base_url: String,
    pub session_id: Option<String>,
    pub sandbox_status: String,
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

    fn compact(mut self) -> Self {
        self.spacing_after = 0;
        self
    }

    fn muted_body(mut self) -> Self {
        self.muted_body = true;
        self
    }

    fn symbol(mut self, symbol: &'static str) -> Self {
        self.symbol_override = Some(symbol);
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
}

impl App {
    fn new() -> Self {
        Self {
            composer: build_composer(),
            send_state: SendState::Idle,
            quit: false,
            pending_error_reported: false,
            working_frame: 0,
        }
    }

    fn prompt(&self) -> String {
        self.composer.lines().join("\n")
    }

    fn clear_composer(&mut self) {
        self.composer = build_composer();
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
            } => match thread_name {
                Some(thread_name) => vec![UiEntry::new(
                    EntryKind::Assistant,
                    format!("{thread_name} • retained episode"),
                    truncate_episode_preview(&content),
                )
                .muted_body()],
                None => vec![UiEntry::new(EntryKind::Assistant, "response", content)],
            },
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

        let footer_height = 1;
        let max_composer_height = area.height.saturating_sub(footer_height).max(3);
        let content_height =
            composer_content_height(self.composer.lines(), area.width.saturating_sub(2));
        let composer_height = content_height
            .saturating_add(2)
            .clamp(3, max_composer_height);
        let composer_area = Rect::new(area.x, area.y, area.width, composer_height);
        let footer_area = Rect::new(
            area.x,
            area.y.saturating_add(composer_height),
            area.width,
            footer_height.min(area.height.saturating_sub(composer_height)),
        );

        let block = Block::bordered()
            .title(" ask ")
            .border_style(Style::default().fg(Color::DarkGray))
            .padding(Padding::horizontal(1));
        let inner = block.inner(composer_area);
        frame.render_widget(block, composer_area);

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let view = wrapped_composer_view(
            self.composer.lines(),
            self.composer.cursor(),
            inner.width,
            inner.height,
            "",
        );

        let paragraph = Paragraph::new(Text::from(view.lines.clone()))
            .style(Style::default().fg(Color::White))
            .wrap(Wrap { trim: false });
        frame.render_widget(paragraph, inner);
        frame.set_cursor_position((inner.x + view.cursor_col, inner.y + view.cursor_row));

        if footer_area.height > 0 {
            let footer = Paragraph::new(Line::from(vec![
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

        let status = Paragraph::new(working_line(self.working_frame));
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

    let mut terminal = ratatui::try_init_with_options(TerminalOptions {
        viewport: Viewport::Inline(COMPOSER_VIEWPORT_HEIGHT),
    })?;
    terminal.hide_cursor()?;
    let keyboard_enhancements_enabled = enable_keyboard_enhancements(&mut terminal);

    let mut app = App::new();
    print_preamble(&mut terminal, &metadata)?;
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
    let mut wrapped = wrap_with_prefix(&format!("{} ", entry.symbol_text()), &entry.title, width);

    if entry.kind == EntryKind::Log && !entry.body.is_empty() {
        let log_prefix = " ".repeat(entry.symbol_text().chars().count() + 1);
        wrapped.extend(wrap_with_prefix(&log_prefix, &entry.body, width));
    } else if !entry.body.is_empty() {
        for line in entry.body.split('\n') {
            wrapped.extend(wrap_with_prefix("  ", line, width));
        }
    }

    if wrapped.is_empty() {
        wrapped.push(String::new());
    }
    wrapped
}

fn print_preamble(terminal: &mut UiTerminal, metadata: &TuiMetadata) -> Result<()> {
    print_blank_line(terminal)?;
    print_entry(
        terminal,
        &UiEntry::new(EntryKind::Log, "OPENAI_MODEL:", metadata.model.clone())
            .compact()
            .symbol("●"),
    )?;
    print_entry(
        terminal,
        &UiEntry::new(
            EntryKind::Log,
            "OPENAI_BASE_URL:",
            metadata.base_url.clone(),
        )
        .compact()
        .symbol("●"),
    )?;
    print_entry(
        terminal,
        &UiEntry::new(EntryKind::Log, "SANDBOX:", metadata.sandbox_status.clone())
            .compact()
            .symbol("●"),
    )?;
    print_entry(
        terminal,
        &UiEntry::new(EntryKind::Log, "cwd:", metadata.cwd.clone())
            .compact()
            .symbol("●"),
    )?;
    if let Some(session_id) = metadata.session_id.as_deref() {
        print_entry(
            terminal,
            &UiEntry::new(EntryKind::Log, "session:", short_session(session_id))
                .compact()
                .symbol("●"),
        )?;
    }
    print_blank_line(terminal)?;
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
    placeholder: &str,
) -> WrappedComposerView {
    if lines.len() == 1 && lines.first().is_some_and(|line| line.is_empty()) {
        return WrappedComposerView {
            lines: vec![Line::from(Span::styled(
                placeholder.to_string(),
                Style::default().fg(Color::DarkGray),
            ))],
            cursor_row: 0,
            cursor_col: 0,
        };
    }

    let width = width.max(1) as usize;
    let mut visual_lines = Vec::new();
    let mut cursor_row = 0usize;
    let mut cursor_col = 0usize;
    let mut cursor_set = false;

    for (row, line) in lines.iter().enumerate() {
        let segments = wrap_soft_line(line, width);
        let mut start = 0usize;
        for (segment_index, segment) in segments.iter().enumerate() {
            let segment_len = segment.chars().count();
            let end = start + segment_len;
            if !cursor_set && row == cursor.0 {
                let is_last_segment = segment_index + 1 == segments.len();
                if cursor.1 <= end || is_last_segment {
                    cursor_row = visual_lines.len();
                    cursor_col = cursor.1.saturating_sub(start).min(segment_len);
                    cursor_set = true;
                }
            }
            visual_lines.push(segment.clone());
            start = end;
        }

        if !cursor_set && row == cursor.0 && line.is_empty() {
            cursor_row = visual_lines.len().saturating_sub(1);
            cursor_col = 0;
            cursor_set = true;
        }
    }

    if !cursor_set {
        cursor_row = visual_lines.len().saturating_sub(1);
        cursor_col = visual_lines
            .last()
            .map(|line| line.chars().count())
            .unwrap_or(0);
    }

    let height = height.max(1) as usize;
    let scroll_top = cursor_row.saturating_sub(height.saturating_sub(1));
    let visible = visual_lines
        .into_iter()
        .skip(scroll_top)
        .take(height)
        .map(|line| Line::from(Span::styled(line, Style::default().fg(Color::White))))
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
    lines
        .iter()
        .map(|line| wrap_soft_line(line, width).len() as u16)
        .fold(0u16, |acc, count| acc.saturating_add(count))
        .max(1)
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

fn working_line(frame: usize) -> Line<'static> {
    const FRAMES: [&str; 6] = ["●○○○", "○●○○", "○○●○", "○○○●", "○○●○", "○●○○"];
    let glyphs = FRAMES[frame % FRAMES.len()];
    Line::from(vec![
        Span::raw("  "),
        Span::styled("working", Style::default().fg(Color::White)),
        Span::raw(" "),
        Span::styled("[", Style::default().fg(Color::DarkGray)),
        Span::styled(glyphs.to_string(), Style::default().fg(Color::Gray)),
        Span::styled("]", Style::default().fg(Color::DarkGray)),
    ])
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
}
