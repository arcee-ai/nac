use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::io;
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
use tokio::sync::{broadcast, mpsc};
use tokio::time::{self, MissedTickBehavior};

use nac_core::commands::PreparedPrompt;
use nac_core::events::{AgentEvent, SessionEvent, SessionEventEnvelope, SessionRunId};
use nac_core::session_service::{
    SessionEventReceiver, SessionMetadata, SessionService, SessionServiceInit, SessionSubmitError,
};
use nac_core::types::Message;
use nac_core::view::{
    self as core_view, ChangedFileStat, EpisodeSnapshot, SessionSummarySnapshot,
    WorksetItemSnapshot, WorksetSnapshot, WorksetsSnapshot, WorkspaceSnapshot,
};

mod app;
mod commands;
mod markdown;
mod render;
mod selection;
mod state;
mod style;
mod terminal;
mod time_utils;
mod util;
mod wrap;

use app::*;
use commands::*;
use markdown::*;
use render::*;
use selection::*;
use state::*;
use style::*;
use terminal::*;
use time_utils::*;
use util::*;
use wrap::*;

const COMPOSER_HEIGHT: u16 = 6;
const MIN_TERMINAL_WIDTH: u16 = 72;
const MIN_TERMINAL_HEIGHT: u16 = 22;
const TIMELINE_LIMIT: usize = 220;
const FILE_CHANGE_LIMIT: usize = 36;
const WORKSPACE_REFRESH_INTERVAL: Duration = Duration::from_millis(400);
const VIEW_CHANGE_SCROLL_SUPPRESS: Duration = Duration::from_millis(750);
const PROMPT_SEPARATOR: &str = " › ";
const COMMAND_SEPARATOR: &str = " / ";
const CONTINUATION_PREFIX: &str = "   ";
const RUNNING_COMPOSER_PLACEHOLDER: &str = "Awaiting orchestrator reply.";

type UiTerminal = Terminal<CrosstermBackend<io::Stdout>>;

pub type TuiMetadata = SessionMetadata;

#[derive(Debug)]
enum AppAction {
    None,
    Quit,
    Submit(PreparedPrompt),
    ResumeSession(String),
}

fn next_queued_input_event(
    input_rx: &mut mpsc::UnboundedReceiver<CrosstermEvent>,
    drop_scroll_events: bool,
) -> Option<CrosstermEvent> {
    while let Ok(event) = input_rx.try_recv() {
        if drop_scroll_events
            && matches!(
                event,
                CrosstermEvent::Mouse(MouseEvent {
                    kind: MouseEventKind::ScrollUp
                        | MouseEventKind::ScrollDown
                        | MouseEventKind::ScrollLeft
                        | MouseEventKind::ScrollRight,
                    ..
                })
            )
        {
            continue;
        }
        return Some(event);
    }
    None
}

pub enum TuiOutcome {
    Exit,
    ResumeSession(String),
}

pub async fn run(
    service: SessionService,
    init: SessionServiceInit,
    mut event_rx: SessionEventReceiver,
    start_in_session_picker: bool,
) -> Result<TuiOutcome> {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<CrosstermEvent>();
    let SessionServiceInit {
        metadata,
        restored_messages,
        response_timing,
    } = init;

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

    let response_duration_history =
        response_timing
            .response_durations_ms
            .as_ref()
            .map(|durations| {
                durations
                    .iter()
                    .map(|duration| duration.map(Duration::from_millis))
                    .collect::<Vec<_>>()
            });
    let last_response_duration = response_timing
        .last_response_duration_ms
        .map(Duration::from_millis);
    let previous_response_duration = response_timing
        .previous_response_duration_ms
        .map(Duration::from_millis);
    let mut app = App::new_with_service(
        service.clone(),
        metadata,
        &restored_messages,
        start_in_session_picker,
    );
    app.restore_response_duration_history(
        response_duration_history.as_deref(),
        last_response_duration,
        previous_response_duration,
    );
    let (ws_tx, ws_rx) = mpsc::channel::<WorkspaceSnapshot>(1);
    app.workspace_tx = Some(ws_tx);
    app.workspace_rx = Some(ws_rx);
    let mut ui_tick = time::interval(Duration::from_millis(75));
    ui_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    terminal.draw(|frame| app.render(frame))?;

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
                                        submit_prompt(prompt, &service, &mut app, &mut terminal)?;
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
                            let mut drop_queued_scroll_events = app.suppressing_mouse_scroll();
                            if !terminal_action {
                                while let Some(next_event) = next_queued_input_event(
                                    &mut input_rx,
                                    drop_queued_scroll_events,
                                ) {
                                    if let Some(action) = app.handle_crossterm_event(next_event) {
                                        match action {
                                            AppAction::Submit(prompt) => {
                                                submit_prompt(prompt, &service, &mut app, &mut terminal)?;
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
                                    if app.suppressing_mouse_scroll() {
                                        drop_queued_scroll_events = true;
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
                event = event_rx.recv() => {
                    match event {
                        Ok(envelope) => {
                            handle_session_event(&mut app, envelope);
                        }
                        Err(broadcast::error::RecvError::Lagged(count)) => {
                            app.push_timeline(
                                "events",
                                format!("lagged • missed {count} event(s)"),
                                Tone::Warning,
                            );
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            eprintln!("ERROR: session event bus closed unexpectedly, shutting down");
                            app.push_timeline(
                                "events",
                                "event source closed".to_string(),
                                Tone::Error,
                            );
                            app.quit = true;
                        }
                    }
                }
                _ = ui_tick.tick() => {
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

fn handle_session_event(app: &mut App, envelope: SessionEventEnvelope) {
    match envelope.event {
        SessionEvent::Agent { event } => {
            app.apply_agent_event(event);
        }
        SessionEvent::RunStarted {
            prompt_preview,
            submitted_user_message: _,
            started_at_epoch_ms: _,
        } => {
            if let Some(run_id) = envelope.run_id {
                begin_top_level_run(app, run_id, prompt_preview);
            }
        }
        SessionEvent::RunCompleted {
            response,
            duration_ms,
        } => {
            if should_finish_run(app, envelope.run_id.as_ref()) {
                finish_top_level_run(app, Ok((response, duration_ms)));
            }
        }
        SessionEvent::RunFailed { message } => {
            if should_finish_run(app, envelope.run_id.as_ref()) {
                finish_top_level_run(app, Err(message));
            }
        }
        SessionEvent::SnapshotSaved { .. } => {}
    }
}

fn should_finish_run(app: &App, event_run_id: Option<&SessionRunId>) -> bool {
    event_run_id.is_some_and(|event_run_id| app.active_run_id.as_ref() == Some(event_run_id))
}

fn begin_top_level_run(app: &mut App, run_id: SessionRunId, prompt_preview: String) {
    if app.active_run_id.as_ref() == Some(&run_id) {
        return;
    }

    app.active_run_id = Some(run_id);
    app.working_started_at = Some(Instant::now());
    if app.prompts.is_empty() {
        app.prompts.push(prompt_preview);
        app.selected_prompt = app.latest_prompt_index();
    }
}

fn finish_top_level_run(app: &mut App, result: std::result::Result<(String, Option<u64>), String>) {
    if !app.is_run_active() {
        return;
    }

    let completed_duration = app
        .working_started_at
        .map(|started| started.elapsed())
        .unwrap_or_default();
    app.active_run_id = None;
    app.working_started_at = None;
    match result {
        Ok((response, duration_ms)) => {
            let completed_duration = duration_ms
                .map(Duration::from_millis)
                .unwrap_or(completed_duration);
            app.complete_top_level_response(response, completed_duration);
        }
        Err(error) => {
            app.note_send_error(error);
        }
    }
}

fn submit_prompt(
    prompt: PreparedPrompt,
    service: &SessionService,
    app: &mut App,
    terminal: &mut UiTerminal,
) -> Result<()> {
    let display_prompt = prompt.display_prompt.clone();
    match service.try_submit_prepared_prompt(prompt) {
        Ok(handle) => {
            app.note_prompt_submitted(&display_prompt);
            app.clear_composer();
            begin_top_level_run(app, handle.run_id, display_prompt);
        }
        Err(SessionSubmitError::Busy { .. }) => {
            app.show_composer_notice("session is busy; wait for the current reply", Tone::Warning);
        }
    }

    terminal.draw(|frame| app.render(frame))?;
    Ok(())
}

fn build_composer() -> TextArea<'static> {
    TextArea::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEventState;
    use nac_core::commands::{
        build_plan_command_prompt, build_run_command_prompt, display_prompt_from_message,
        expand_user_prompt,
    };
    use nac_core::test_support::{sessions, store};
    use ratatui::backend::TestBackend;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
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
            backend: "openai-responses".to_string(),
            session_id: None,
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            base_url: String::new(),
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::new(),
        }
    }

    fn test_thread_view(name: &str, updated_at_ts: u64) -> ThreadView {
        ThreadView {
            name: name.to_string(),
            action: format!("inspect {name}"),
            state: ThreadState::Idle,
            updated_at: format!("00:00:{updated_at_ts:02}"),
            updated_at_ts,
            episodes: 1,
            summary: String::new(),
        }
    }

    fn test_scroll_event(kind: MouseEventKind) -> CrosstermEvent {
        CrosstermEvent::Mouse(MouseEvent {
            kind,
            column: 0,
            row: 0,
            modifiers: KeyModifiers::NONE,
        })
    }

    fn press_key(app: &mut App, code: KeyCode, modifiers: KeyModifiers) {
        assert!(matches!(
            app.handle_key_event(KeyEvent::new(code, modifiers)),
            AppAction::None
        ));
    }

    fn rendered_symbols(terminal: &Terminal<TestBackend>) -> String {
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect()
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
    fn control_j_inserts_newline_without_deleting_text() {
        let dir = temp_dir("ctrl-j-newline");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("hello");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('j'), KeyModifiers::CONTROL));

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
            AppAction::Submit(prompt) => assert_eq!(prompt.raw_prompt, "hello"),
            _ => panic!("expected submit"),
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plan_command_submits_raw_prompt() {
        let dir = temp_dir("plan-submit");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/plan refresh auth flow");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match action {
            AppAction::Submit(prompt) => assert_eq!(prompt.raw_prompt, "/plan refresh auth flow"),
            _ => panic!("expected submit"),
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn run_command_submits_raw_prompt() {
        let dir = temp_dir("run-submit");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/run auth-refresh");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match action {
            AppAction::Submit(prompt) => assert_eq!(prompt.raw_prompt, "/run auth-refresh"),
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
    fn run_command_requires_workset() {
        let dir = temp_dir("run-usage");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/run");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        let notice = app
            .composer_notice
            .as_ref()
            .expect("expected composer notice");
        assert_eq!(notice.text, "usage: /run <workset>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn run_command_rejects_freeform_instruction() {
        let dir = temp_dir("run-freeform");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/run refresh auth flow");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        let notice = app
            .composer_notice
            .as_ref()
            .expect("expected composer notice");
        assert_eq!(notice.text, "usage: /run <workset>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plan_command_expands_to_workset_prompt() {
        let expanded = expand_user_prompt("/plan refresh auth flow");

        assert!(expanded.contains("# /plan: Workset Planning"));
        assert!(expanded.contains("workset_define"));
        assert!(expanded.contains("goal"));
        assert!(expanded.contains("role"));
        assert!(expanded.contains("depends_on"));
        assert!(expanded.contains("acceptance"));
        assert!(expanded.contains("refresh auth flow"));
        assert!(expanded.contains("Do not do mutating implementation work in this step."));
        assert!(!expanded.contains("thread_name"));
    }

    #[test]
    fn run_command_expands_to_existing_workset_prompt() {
        let expanded = expand_user_prompt("/run auth-refresh");

        assert!(expanded.contains("# /run: Workset Execution"));
        assert!(expanded.contains("workset_read"));
        assert!(expanded.contains("auth-refresh"));
        assert!(expanded.contains("run `/plan <instruction>` first"));
        assert!(expanded.contains("Use `thread` for implementation and verification work."));
        assert!(!expanded.contains("Create exactly one durable"));
    }

    fn define_test_workset(path: &Path, session_id: &str, id: &str) {
        store::define_workset(
            path,
            session_id,
            &store::WorksetDefinition {
                id: id.to_string(),
                goal: "refresh auth flow".to_string(),
                status: "planned".to_string(),
                summary: "Auth work units.".to_string(),
                verification_recipe: Some("cargo test".to_string()),
                items: vec![
                    store::WorksetItemDefinition {
                        title: "Inspect auth flow".to_string(),
                        scope: "crates/nac-core/src".to_string(),
                        description: "Find auth flow entry points.".to_string(),
                        role: "research".to_string(),
                        depends_on: Vec::new(),
                        acceptance: "Auth entry points are identified.".to_string(),
                        notes: None,
                    },
                    store::WorksetItemDefinition {
                        title: "Apply auth flow update".to_string(),
                        scope: "crates/nac-tui/src/tui/mod.rs".to_string(),
                        description: "Make the scoped auth UI change.".to_string(),
                        role: "implement".to_string(),
                        depends_on: vec!["Inspect auth flow".to_string()],
                        acceptance: "The auth UI change is implemented.".to_string(),
                        notes: None,
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
        define_test_workset(&store_path, session_id, "plan-auth");
        let mut metadata = metadata_for(&dir);
        metadata.store_path = store_path.clone();
        metadata.session_id = Some(session_id.to_string());

        let app = App::new(metadata, &[], false);

        assert_eq!(app.worksets.items.len(), 1);
        assert_eq!(app.worksets.items[0].id, "plan-auth");
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
    fn workset_item_lines_include_role_scope_title_and_acceptance() {
        let item = WorksetItemSnapshot {
            position: 1,
            title: "Apply auth flow update".to_string(),
            scope: "crates/nac-tui/src/tui/mod.rs".to_string(),
            description: "Make the scoped auth UI change.".to_string(),
            role: "implement".to_string(),
            depends_on: vec!["Inspect auth flow".to_string()],
            acceptance: "The auth UI change is implemented.".to_string(),
            notes: None,
            updated_at: "2026-04-23 00:00:00".to_string(),
        };

        let rendered = render_workset_item_lines(&item, 80)
            .iter()
            .map(line_to_plain_text)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(rendered.contains("IMPLEMENT"));
        assert!(rendered.contains("SCOPE"));
        assert!(rendered.contains("DEPS"));
        assert!(rendered.contains("PASS"));
        assert!(rendered.contains("Inspect auth flow"));
        assert!(rendered.contains("Apply auth flow update"));
        assert!(rendered.contains("crates/nac-tui/src/tui/mod.rs"));
        assert!(rendered.contains("The auth UI change is implemented."));
    }

    #[test]
    fn workset_item_lines_wrap_long_fields() {
        let item = WorksetItemSnapshot {
            position: 1,
            title: "Apply auth flow update with long title".to_string(),
            scope: "crates/nac-tui/src/tui and crates/nac-core/src/store".to_string(),
            description: "Make the scoped auth UI change.".to_string(),
            role: "implement".to_string(),
            depends_on: vec!["Inspect auth flow before implementation starts".to_string()],
            acceptance: "The auth UI change is implemented and verified with targeted tests."
                .to_string(),
            notes: Some("Keep unrelated worktree changes intact while editing.".to_string()),
            updated_at: "2026-04-23 00:00:00".to_string(),
        };

        let rendered = render_workset_item_lines(&item, 39)
            .iter()
            .map(line_to_plain_text)
            .collect::<Vec<_>>();
        let joined = rendered.join("\n");

        assert!(rendered.len() > 6);
        assert!(joined.contains("update with long"));
        assert!(joined.contains("crates/nac-tui/src/tui"));
        assert!(joined.contains("crates/nac-core/src/store"));
        assert!(joined.contains("targeted"));
        assert!(joined.contains("tests."));
        assert!(!joined.contains('…'));
    }

    #[test]
    fn wrapped_prefixed_lines_use_continuation_indent() {
        let mut lines = Vec::new();
        push_wrapped_prefixed_lines(
            &mut lines,
            "  verify ",
            "cargo test -p nac-tui plus a focused manual check",
            28,
            Style::default().fg(Color::DarkGray),
            Style::default().fg(Color::DarkGray),
        );

        let rendered = lines.iter().map(line_to_plain_text).collect::<Vec<_>>();

        assert!(rendered.len() > 1);
        assert!(rendered[0].starts_with("  verify "));
        assert!(rendered[1].starts_with("         "));
        assert!(!rendered.join("\n").contains('…'));
    }

    #[test]
    fn workset_prompt_displays_as_original_slash_command() {
        let expanded = build_plan_command_prompt("split this into reviewable units");
        let expanded_run = build_run_command_prompt("auth-refresh");

        assert_eq!(
            display_prompt_from_message(&expanded),
            "/plan split this into reviewable units"
        );
        assert_eq!(
            display_prompt_from_message(&expanded_run),
            "/run auth-refresh"
        );
    }

    #[test]
    fn run_started_does_not_replace_submitted_prompt() {
        let dir = temp_dir("run-started-prompt");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.note_prompt_submitted("/plan refresh auth flow");

        app.apply_agent_event(AgentEvent::RunStarted {
            thread_name: None,
            prompt_preview: "# /plan: Workset Planning".to_string(),
        });

        assert_eq!(app.prompts, vec!["/plan refresh auth flow".to_string()]);
        assert_eq!(app.selected_prompt, Some(0));
        assert_eq!(app.displayed_prompt_index(), Some(0));

        let mut fallback_app = App::new(metadata_for(&dir), &[], false);
        fallback_app.apply_agent_event(AgentEvent::RunStarted {
            thread_name: None,
            prompt_preview: "restored run preview".to_string(),
        });
        fallback_app.apply_agent_event(AgentEvent::RunStarted {
            thread_name: Some("worker".to_string()),
            prompt_preview: "worker preview".to_string(),
        });
        assert_eq!(
            fallback_app.prompts,
            vec!["restored run preview".to_string()]
        );
        assert_eq!(fallback_app.selected_prompt, Some(0));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn prompt_history_hydrates_user_messages_and_slash_display_mapping() {
        let dir = temp_dir("prompt-history-hydrate");
        let messages = vec![
            Message::User {
                content: "first prompt".to_string(),
            },
            Message::Assistant {
                content: Some("reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::User {
                content: build_plan_command_prompt("split this into reviewable units"),
            },
            Message::User {
                content: build_run_command_prompt("auth-refresh"),
            },
        ];

        let app = App::new(metadata_for(&dir), &messages, false);

        assert_eq!(
            app.prompts,
            vec![
                "first prompt".to_string(),
                "/plan split this into reviewable units".to_string(),
                "/run auth-refresh".to_string(),
            ]
        );
        assert_eq!(app.selected_prompt, Some(2));
        assert_eq!(app.displayed_prompt_index(), Some(2));
        assert!(line_to_plain_text(&app.prompt_panel_title()).contains("PROMPTS 3/3"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn composer_title_shows_timer_only_while_run_is_active() {
        let dir = temp_dir("composer-title-timer");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let idle_text = line_to_plain_text(&app.composer_panel_title());
        assert_eq!(idle_text, " [ ASK ] ");
        assert!(!idle_text.contains("T+"));

        app.active_run_id = Some(SessionRunId::new());
        app.working_started_at = Some(Instant::now() - Duration::from_secs(3));

        let running_title = app.composer_panel_title();
        let running_text = line_to_plain_text(&running_title);
        assert!(running_text.starts_with(" [ ASK T+"));
        assert!(running_text.ends_with(" ] "));
        assert!(running_title.spans.iter().any(|span| {
            span.content.as_ref().contains("ASK")
                && span.style.fg == Some(Color::Cyan)
                && span.style.add_modifier.contains(Modifier::BOLD)
        }));
        assert!(running_title.spans.iter().any(|span| {
            span.content.as_ref().starts_with("T+") && span.style.fg == Some(Color::Green)
        }));

        app.active_run_id = None;
        app.working_started_at = None;
        app.complete_top_level_response("done".to_string(), Duration::from_secs(7));
        assert_eq!(
            app.responses.last().and_then(|response| response.duration),
            Some(Duration::from_secs(7))
        );

        let idle_again_text = line_to_plain_text(&app.composer_panel_title());
        assert_eq!(idle_again_text, " [ ASK ] ");
        assert!(!idle_again_text.contains("T+"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn running_composer_renders_static_placeholder_without_life_background() {
        let dir = temp_dir("running-composer-placeholder");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.active_run_id = Some(SessionRunId::new());

        let mut terminal = Terminal::new(TestBackend::new(80, COMPOSER_HEIGHT)).unwrap();
        terminal
            .draw(|frame| app.render_composer(frame, Rect::new(0, 0, 80, COMPOSER_HEIGHT)))
            .unwrap();

        let screen = rendered_symbols(&terminal);
        assert!(screen.contains(RUNNING_COMPOSER_PLACEHOLDER));
        assert!(!screen
            .chars()
            .any(|ch| ('\u{2800}'..='\u{28ff}').contains(&ch)));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn running_composer_still_ignores_input_and_paste() {
        let dir = temp_dir("running-composer-input");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("draft");
        app.active_run_id = Some(SessionRunId::new());

        assert!(matches!(app.handle_paste(" pasted"), AppAction::None));
        assert_eq!(app.prompt(), "draft");
        assert!(matches!(
            app.handle_key_event(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
            AppAction::None
        ));
        assert_eq!(app.prompt(), "draft");
        assert!(matches!(
            app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            AppAction::None
        ));
        assert_eq!(app.prompt(), "draft");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn prompt_history_focus_navigation_guard_and_reset_to_latest() {
        let dir = temp_dir("prompt-history-nav");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.note_prompt_submitted("one");
        app.note_prompt_submitted("two");
        app.note_prompt_submitted("three");

        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        assert_eq!(app.selected_prompt, Some(2));

        press_key(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
        assert!(matches!(
            app.screen,
            ScreenMode::Focused(FocusPanel::Prompt)
        ));
        assert_eq!(app.displayed_prompt_index(), Some(2));

        app.panel_scrolls.insert(PanelId::Prompt, 12);
        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        assert_eq!(app.selected_prompt, Some(1));
        assert_eq!(app.panel_scrolls.get(&PanelId::Prompt), Some(&0));
        assert!(line_to_plain_text(&app.prompt_panel_title()).contains("PROMPTS 2/3"));

        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        assert_eq!(app.selected_prompt, Some(0));

        press_key(&mut app, KeyCode::Right, KeyModifiers::NONE);
        press_key(&mut app, KeyCode::Right, KeyModifiers::NONE);
        press_key(&mut app, KeyCode::Right, KeyModifiers::NONE);
        assert_eq!(app.selected_prompt, Some(2));

        app.selected_prompt = Some(0);
        press_key(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
        assert_eq!(app.screen, ScreenMode::Dashboard);
        assert_eq!(app.selected_prompt, Some(2));
        assert_eq!(app.displayed_prompt_index(), Some(2));

        press_key(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        assert_eq!(app.selected_prompt, Some(1));
        press_key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
        assert_eq!(app.screen, ScreenMode::Dashboard);
        assert_eq!(app.selected_prompt, Some(2));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn switching_focus_from_prompt_returns_display_to_latest() {
        let dir = temp_dir("prompt-focus-switch");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.note_prompt_submitted("one");
        app.note_prompt_submitted("two");
        app.complete_top_level_response("reply".to_string(), Duration::from_secs(1));
        app.screen = ScreenMode::Focused(FocusPanel::Prompt);
        app.selected_prompt = Some(0);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        assert!(matches!(action, AppAction::None));
        assert!(matches!(
            app.screen,
            ScreenMode::Focused(FocusPanel::Response)
        ));
        assert_eq!(app.selected_prompt, Some(1));
        assert_eq!(app.displayed_prompt_index(), Some(1));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn primary_scroll_panel_uses_prompt_when_prompt_focused() {
        let dir = temp_dir("prompt-primary-scroll");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.screen = ScreenMode::Focused(FocusPanel::Prompt);

        assert_eq!(app.primary_scroll_panel(), PanelId::Prompt);
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
    fn test_help_slash_command_opens_overlay() {
        let dir = temp_dir("help-command-opens-overlay");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/help");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        assert!(app.help_visible);
        assert!(app.prompt().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_help_slash_command_with_args_is_invalid() {
        let dir = temp_dir("help-command-args-invalid");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.composer.insert_str("/help extra");

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(action, AppAction::None));
        assert!(!app.help_visible);
        assert!(app.composer_notice.is_some());
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
    fn response_history_focus_navigation_and_reset_to_latest() {
        let dir = temp_dir("response-history-nav");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.complete_top_level_response("one".to_string(), Duration::from_secs(1));
        app.complete_top_level_response("two".to_string(), Duration::from_secs(2));
        app.complete_top_level_response("three".to_string(), Duration::from_secs(3));

        press_key(&mut app, KeyCode::Char('r'), KeyModifiers::CONTROL);
        assert!(matches!(
            app.screen,
            ScreenMode::Focused(FocusPanel::Response)
        ));
        assert_eq!(app.displayed_response_index(), Some(2));

        app.panel_scrolls.insert(PanelId::Response, 12);
        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        assert_eq!(app.selected_response, Some(1));
        assert_eq!(app.panel_scrolls.get(&PanelId::Response), Some(&0));
        assert_eq!(app.displayed_response_index(), Some(1));

        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        press_key(&mut app, KeyCode::Left, KeyModifiers::NONE);
        assert_eq!(app.selected_response, Some(0));

        press_key(&mut app, KeyCode::Right, KeyModifiers::NONE);
        press_key(&mut app, KeyCode::Right, KeyModifiers::NONE);
        press_key(&mut app, KeyCode::Right, KeyModifiers::NONE);
        assert_eq!(app.selected_response, Some(2));

        app.selected_response = Some(0);
        press_key(&mut app, KeyCode::Char('r'), KeyModifiers::CONTROL);
        assert_eq!(app.screen, ScreenMode::Dashboard);
        assert_eq!(app.selected_response, Some(2));
        assert_eq!(app.displayed_response_index(), Some(2));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ctrl_o_no_longer_focuses_a_panel() {
        let dir = temp_dir("tools-focus-removed");
        let mut app = App::new(metadata_for(&dir), &[], false);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('o'), KeyModifiers::CONTROL));
        assert!(matches!(action, AppAction::None));
        assert_eq!(app.screen, ScreenMode::Dashboard);
        assert!(app.prompt().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn dashboard_and_help_do_not_show_tools_panel_or_shortcut() {
        let dir = temp_dir("tools-panel-removed");
        let mut app = App::new(metadata_for(&dir), &[], false);
        let mut terminal = Terminal::new(TestBackend::new(120, 40)).unwrap();

        terminal.draw(|frame| app.render(frame)).unwrap();
        let dashboard = rendered_symbols(&terminal);
        assert!(!dashboard.contains("TOOLS"));
        assert!(!dashboard.contains("Ctrl-O"));

        app.help_visible = true;
        terminal.draw(|frame| app.render(frame)).unwrap();
        let help = rendered_symbols(&terminal);
        assert!(!help.contains("TOOLS"));
        assert!(!help.contains("Ctrl-O"));
        assert!(!help.contains("focus tools"));
        assert!(help.contains("Ctrl-W / Ctrl-K"));

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
            timeout_reason: None,
            usage: None,
        });
        let thread = app.threads.get("auth").unwrap();
        assert_eq!(thread.state, ThreadState::Idle);
        assert_eq!(thread.summary, "exit 0");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn thread_navigation_requests_scroll_reset() {
        let dir = temp_dir("thread-scroll-suppress");
        let mut app = App::new(metadata_for(&dir), &[], false);
        app.screen = ScreenMode::Focused(FocusPanel::Threads);
        app.threads
            .insert("first".to_string(), test_thread_view("first", 2));
        app.threads
            .insert("second".to_string(), test_thread_view("second", 1));
        app.selected_thread = Some("first".to_string());
        app.panel_scrolls.insert(PanelId::ThreadEpisodes, 20);

        let action = app.handle_key_event(KeyEvent::new(KeyCode::Char('j'), KeyModifiers::NONE));
        assert!(matches!(action, AppAction::None));
        assert_eq!(app.selected_thread.as_deref(), Some("second"));
        assert_eq!(app.panel_scrolls.get(&PanelId::ThreadEpisodes), Some(&0));
        assert!(app.suppressing_mouse_scroll());
        app.suppress_mouse_scroll_until = Some(Instant::now() - Duration::from_millis(1));
        assert!(!app.suppressing_mouse_scroll());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn queued_scroll_filter_drops_only_pending_scroll_events() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        for kind in [MouseEventKind::ScrollDown, MouseEventKind::ScrollRight] {
            tx.send(test_scroll_event(kind)).unwrap();
        }
        tx.send(CrosstermEvent::Key(KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
        )))
        .unwrap();
        drop(tx);

        assert!(matches!(
            next_queued_input_event(&mut rx, true),
            Some(CrosstermEvent::Key(KeyEvent {
                code: KeyCode::Char('x'),
                ..
            }))
        ));
        assert!(next_queued_input_event(&mut rx, true).is_none());
    }

    #[test]
    fn tool_events_update_timeline_and_clear_context() {
        let dir = temp_dir("tool");
        let mut app = App::new(metadata_for(&dir), &[], false);

        app.apply_agent_event(AgentEvent::ToolCallStarted {
            thread_name: Some("coder-1".to_string()),
            call_id: "call-1".to_string(),
            name: "edit".to_string(),
            args_preview: "crates/nac-tui/src/tui/mod.rs".to_string(),
            args_detail: None,
        });
        let context = app.tool_event_contexts.get("call-1").unwrap();
        assert_eq!(context.name, "edit");
        assert_eq!(context.target, "crates/nac-tui/src/tui/mod.rs");

        app.apply_agent_event(AgentEvent::ToolCallFinished {
            thread_name: Some("coder-1".to_string()),
            call_id: "call-1".to_string(),
            name: "edit".to_string(),
            content_preview: "ok".to_string(),
            is_error: false,
        });

        assert!(app.tool_event_contexts.is_empty());
        let entries = app.timeline.iter().collect::<Vec<_>>();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].actor, "coder-1");
        assert_eq!(entries[0].detail, "edit • crates/nac-tui/src/tui/mod.rs");
        assert_eq!(entries[0].tone, Tone::Info);
        assert_eq!(entries[1].actor, "coder-1");
        assert_eq!(
            entries[1].detail,
            "edit • crates/nac-tui/src/tui/mod.rs • ok"
        );
        assert_eq!(entries[1].tone, Tone::Success);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn response_history_tracks_runtime_snapshots_and_ignored_event() {
        let dir = temp_dir("response-runtime");
        let mut app = App::new(metadata_for(&dir), &[], false);

        assert_eq!(
            format_optional_runtime(app.displayed_run_duration()),
            "T+--:--:--"
        );
        assert_eq!(app.response_duration_snapshot_ms(), (None, None));
        assert_eq!(
            app.response_duration_history_snapshot_ms(),
            Vec::<Option<u64>>::new()
        );

        app.apply_agent_event(AgentEvent::AssistantMessage {
            thread_name: None,
            content: "ignored".to_string(),
            usage: None,
        });
        assert!(app.responses.is_empty());

        app.active_run_id = Some(SessionRunId::new());
        app.working_started_at = Some(Instant::now() - Duration::from_secs(3));
        let (runtime, is_live) = app.response_panel_runtime(None);
        assert!(runtime.is_some());
        assert!(is_live);
        app.active_run_id = None;
        app.working_started_at = None;

        app.complete_top_level_response("first reply".to_string(), Duration::from_secs(1));
        assert_eq!(app.responses.len(), 1);
        assert_eq!(app.responses[0].content, "first reply");
        assert_eq!(app.responses[0].duration, Some(Duration::from_secs(1)));
        assert_eq!(app.selected_response, Some(0));
        assert_eq!(app.response_duration_snapshot_ms(), (Some(1_000), None));
        assert_eq!(
            app.response_duration_history_snapshot_ms(),
            vec![Some(1_000)]
        );

        app.note_prompt_submitted("second prompt");
        assert_eq!(app.responses.len(), 1);
        assert_eq!(app.displayed_response_index(), Some(0));

        app.complete_top_level_response("second reply".to_string(), Duration::from_secs(2));
        assert_eq!(app.responses.len(), 2);
        assert_eq!(app.responses[1].content, "second reply");
        assert_eq!(app.responses[1].duration, Some(Duration::from_secs(2)));
        assert_eq!(app.selected_response, Some(1));
        assert_eq!(
            app.response_duration_snapshot_ms(),
            (Some(2_000), Some(1_000))
        );
        assert_eq!(
            app.response_duration_history_snapshot_ms(),
            vec![Some(1_000), Some(2_000)]
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn response_duration_history_round_trips_through_session_snapshot_and_resume_restore() {
        let dir = temp_dir("response-duration-round-trip");
        let mut metadata = metadata_for(&dir);
        let messages = vec![
            Message::Assistant {
                content: Some("first reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: Some("second reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: Some("third reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
        ];
        let session_id = "session-response-durations".to_string();
        metadata.session_id = Some(session_id.clone());
        let mut snapshot = sessions::new_snapshot(
            session_id.clone(),
            dir.clone(),
            metadata.model.clone(),
            "https://example.com/v1".to_string(),
            nac_core::model::BackendKind::OpenAiResponses,
            None,
            None,
            None,
            messages,
        None,
        BTreeMap::new(),
        );
        snapshot.last_response_duration_ms = Some(3_333);
        snapshot.previous_response_duration_ms = Some(2_222);
        snapshot.response_durations_ms = Some(vec![Some(1_111), Some(2_222), Some(3_333)]);
        sessions::create_session(&metadata.store_path, &snapshot).unwrap();

        let loaded = sessions::load_session(&metadata.store_path, &session_id).unwrap();
        assert_eq!(
            loaded.response_durations_ms,
            Some(vec![Some(1_111), Some(2_222), Some(3_333)])
        );
        let restored_durations = loaded.response_durations_ms.as_ref().map(|durations| {
            durations
                .iter()
                .map(|duration| duration.map(Duration::from_millis))
                .collect::<Vec<_>>()
        });
        let mut app = App::new(metadata, &loaded.messages, false);
        app.restore_response_duration_history(
            restored_durations.as_deref(),
            loaded.last_response_duration_ms.map(Duration::from_millis),
            loaded
                .previous_response_duration_ms
                .map(Duration::from_millis),
        );

        let contents = app
            .responses
            .iter()
            .map(|response| response.content.as_str())
            .collect::<Vec<_>>();
        assert_eq!(contents, vec!["first reply", "second reply", "third reply"]);
        assert_eq!(
            app.response_duration_history_snapshot_ms(),
            vec![Some(1_111), Some(2_222), Some(3_333)]
        );
        assert_eq!(
            app.response_duration_snapshot_ms(),
            (Some(3_333), Some(2_222))
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn response_duration_history_restore_prefers_full_vector() {
        let dir = temp_dir("response-runtime-full-history");
        let metadata = metadata_for(&dir);
        let messages = vec![
            Message::Assistant {
                content: Some("first reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: Some("tool call carrier".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![nac_core::types::ToolCall {
                    id: "call-1".to_string(),
                    call_type: "function".to_string(),
                    function: nac_core::types::FunctionCall {
                        name: "read".to_string(),
                        arguments: "{}".to_string(),
                    },
                }]),
            },
            Message::Assistant {
                content: Some("second reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("reasoning-only final".to_string()),
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: Some("third reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(Vec::new()),
            },
        ];

        let mut app = App::new(metadata, &messages, false);
        let response_durations = vec![
            Some(Duration::from_secs(1)),
            None,
            Some(Duration::from_secs(3)),
            Some(Duration::from_secs(4)),
        ];
        app.restore_response_duration_history(
            Some(response_durations.as_slice()),
            Some(Duration::from_secs(9)),
            Some(Duration::from_secs(4)),
        );

        let contents = app
            .responses
            .iter()
            .map(|response| response.content.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            contents,
            vec![
                "first reply",
                "second reply",
                "[No response]",
                "third reply"
            ]
        );
        assert_eq!(app.responses[0].duration, Some(Duration::from_secs(1)));
        assert_eq!(app.responses[1].duration, None);
        assert_eq!(app.responses[2].duration, Some(Duration::from_secs(3)));
        assert_eq!(app.responses[3].duration, Some(Duration::from_secs(4)));
        assert_eq!(
            app.response_duration_history_snapshot_ms(),
            vec![Some(1_000), None, Some(3_000), Some(4_000)]
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn response_durations_restore_with_hydrated_response_history() {
        let dir = temp_dir("response-runtime-hydrate");
        let metadata = metadata_for(&dir);
        let messages = vec![
            Message::Assistant {
                content: Some("first reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: Some("tool call carrier".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![nac_core::types::ToolCall {
                    id: "call-1".to_string(),
                    call_type: "function".to_string(),
                    function: nac_core::types::FunctionCall {
                        name: "read".to_string(),
                        arguments: "{}".to_string(),
                    },
                }]),
            },
            Message::Assistant {
                content: Some("second reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::Assistant {
                content: Some("third reply".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(Vec::new()),
            },
        ];

        let mut app = App::new(metadata, &messages, false);
        app.restore_response_duration_history(
            None,
            Some(Duration::from_secs(9)),
            Some(Duration::from_secs(4)),
        );

        let contents = app
            .responses
            .iter()
            .map(|response| response.content.as_str())
            .collect::<Vec<_>>();
        assert_eq!(contents, vec!["first reply", "second reply", "third reply"]);
        assert_eq!(app.responses[0].duration, None);
        assert_eq!(app.responses[1].duration, Some(Duration::from_secs(4)));
        assert_eq!(app.responses[2].duration, Some(Duration::from_secs(9)));
        assert_eq!(app.selected_response, Some(2));

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
        let snapshot = core_view::workspace_snapshot("/workspace/project", None);
        assert!(snapshot.error.is_some());
        assert_eq!(snapshot.host_root, None);
    }

    #[test]
    fn markdown_renderer_formats_common_blocks() {
        let rendered = render_markdown_lines(
            "# Heading\n- item\n> quote\nLink to [site](https://example.com)\n| Name | Value |\n| --- | --- |\n| one | 1 |\n```rust\nfn main() {}\n```",
            None,
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
            core_view::parse_remote_label("git@github.com:arcee-ai/nac.git").as_deref(),
            Some("arcee-ai/nac")
        );
    }

    #[test]
    fn parse_status_porcelain_tracks_untracked_and_staged() {
        let raw = "M  crates/nac-tui/src/tui/mod.rs\nA  README.md\n?? notes.txt\n";
        let (counts, files) = core_view::parse_status_porcelain(raw);

        assert_eq!(counts.modified, 1);
        assert_eq!(counts.added, 1);
        assert_eq!(counts.untracked, 1);
        assert_eq!(counts.staged, 2);
        assert!(files.contains_key("notes.txt"));
    }

    #[test]
    fn markdown_table_without_delimiter_renders_as_table() {
        // LLMs frequently omit the `|---|---|` delimiter row.
        // The renderer should fall back to treating two consecutive
        // pipe-delimited rows with matching column counts as a table.
        let rendered =
            render_markdown_lines("| Name | Value |\n| one  | 1     |\n| two  | 2     |", None);
        let plain: Vec<String> = rendered.iter().map(line_to_plain_text).collect();

        // Should produce box-drawing table borders, not raw pipe text
        assert_eq!(plain[0], "┌──────┬───────┐");
        assert_eq!(plain[1], "│ Name │ Value │");
        assert_eq!(plain[2], "├──────┼───────┤");
        assert_eq!(plain[3], "│ one  │ 1     │");
        assert_eq!(plain[4], "│ two  │ 2     │");
        assert_eq!(plain[5], "└──────┴───────┘");
    }

    #[test]
    fn markdown_table_without_delimiter_single_column_skips_fallback() {
        // Single-column pipe-delimited text is ambiguous (could be inline
        // pipe emphasis). Require at least two columns for the fallback.
        let rendered = render_markdown_lines("| single |\n| column |", None);
        let plain: Vec<String> = rendered.iter().map(line_to_plain_text).collect();
        // Should render as plain paragraphs (raw pipes), not a table
        assert!(
            plain.iter().any(|l| l.contains('|')),
            "single-column pipe lines should fall through to paragraph rendering"
        );
    }

    #[test]
    fn markdown_table_row_respects_escaped_and_code_pipes() {
        assert_eq!(
            parse_markdown_table_row(r"| a \| b | `x|y` | c |"),
            Some(vec![
                r"a \| b".to_string(),
                "`x|y`".to_string(),
                "c".to_string()
            ])
        );
        assert_eq!(
            parse_markdown_table_row(r"a | b \|"),
            Some(vec!["a".to_string(), r"b \|".to_string()])
        );
    }

    #[test]
    fn markdown_table_preserves_inline_styles_in_cells() {
        let rendered = render_markdown_lines(
            "| Col A |\n| --- |\n| **bold** text |\n| [site](https://example.com) |",
            None,
        );
        let plain: Vec<String> = rendered.iter().map(line_to_plain_text).collect();
        assert_eq!(plain[3], "│ bold text                  │");
        assert_eq!(plain[4], "│ site <https://example.com> │");

        let has_bold = rendered[3]
            .spans
            .iter()
            .any(|s| s.style.add_modifier.contains(Modifier::BOLD));
        assert!(has_bold, "cell with **bold** should contain a BOLD span");

        let has_underlined = rendered[4]
            .spans
            .iter()
            .any(|s| s.style.add_modifier.contains(Modifier::UNDERLINED));
        assert!(
            has_underlined,
            "cell with [link]() should contain an UNDERLINED span"
        );
    }

    #[test]
    fn markdown_table_keeps_rows_with_escaped_pipes_in_same_table() {
        let rendered = render_markdown_lines(
            "| Feature | Input syntax | Status |\n\
|---|---|---|\n\
| Standard table | \\| a \\| b \\| with \\|---\\| row | ✅ Working |\n\
| Bold text | **double asterisks** | ✅ Preserved |\n\
| Italic text | *single asterisks* | ✅ Preserved |\n\
| inline code | `backticks` | ✅ Preserved |\n\
| Links <https://example.com> | [text](url) | ✅ Preserved |\n\
| Pipes in cells: |---| | Literal \\| in content | ✅ Not split |",
            None,
        );
        let plain: Vec<String> = rendered.iter().map(line_to_plain_text).collect();

        assert_eq!(plain.iter().filter(|line| line.starts_with('┌')).count(), 1);
        assert!(!plain
            .iter()
            .any(|line| line.starts_with("| Standard table")));
        assert!(plain.iter().any(
            |line| line.contains("Standard table") && line.contains("| a | b | with |---| row")
        ));
        assert!(plain
            .iter()
            .any(|line| line.contains("Pipes in cells:|---|")
                && line.contains("Literal | in content")));
    }

    #[test]
    fn markdown_table_uses_terminal_display_width_for_emoji() {
        let rendered = render_markdown_lines(
            "| Emoji | Meaning |\n\
| 🔴 | High severity |\n\
| 🟡 | Medium severity |\n\
| ⚪ | Low / cosmetic |\n\
| ✅ | Verified fixed |",
            None,
        );
        let plain: Vec<String> = rendered.iter().map(line_to_plain_text).collect();
        let widths: Vec<usize> = plain.iter().map(|line| display_width(line)).collect();

        assert!(widths.iter().all(|width| *width == widths[0]));
    }
}
