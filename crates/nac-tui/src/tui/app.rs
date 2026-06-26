use super::*;
use nac_core::commands::{self as core_commands, FrontendCommand, PreparedUserInput};

pub(super) struct App {
    pub(super) metadata: TuiMetadata,
    pub(super) read_service: Option<SessionService>,
    pub(super) composer: TextArea<'static>,
    pub(super) composer_notice: Option<ComposerNotice>,
    pub(super) active_run_id: Option<SessionRunId>,
    pub(super) quit: bool,
    pub(super) working_started_at: Option<Instant>,
    pub(super) restored_message_count: usize,
    pub(super) prompts: Vec<String>,
    pub(super) selected_prompt: Option<usize>,
    pub(super) responses: Vec<ResponseEntry>,
    pub(super) selected_response: Option<usize>,
    pub(super) timeline: VecDeque<TimelineEntry>,
    pub(super) threads: HashMap<String, ThreadView>,
    pub(super) all_episodes: HashMap<String, Vec<EpisodeSnapshot>>,
    pub(super) episode_markdown_cache: HashMap<String, Vec<Line<'static>>>,
    pub(super) response_markdown_cache: Option<(usize, String, usize, Vec<Line<'static>>)>,
    pub(super) selected_thread: Option<String>,
    pub(super) tool_event_contexts: HashMap<String, ToolEventContext>,
    pub(super) workspace: WorkspaceSnapshot,
    pub(super) worksets: WorksetsSnapshot,
    pub(super) last_workspace_refresh_at: Instant,
    pub(super) workspace_tx: Option<mpsc::Sender<WorkspaceSnapshot>>,
    pub(super) workspace_rx: Option<mpsc::Receiver<WorkspaceSnapshot>>,
    pub(super) workspace_refresh_pending: bool,
    pub(super) workspace_refresh_deadline: Option<Instant>,
    pub(super) panel_scrolls: HashMap<PanelId, usize>,
    pub(super) panel_views: HashMap<PanelId, PanelView>,
    pub(super) suppress_mouse_scroll_until: Option<Instant>,
    pub(super) selection: Option<SelectionState>,
    pub(super) help_visible: bool,
    pub(super) screen: ScreenMode,
    pub(super) session_picker: SessionPickerState,
    pub(super) clipboard: Option<arboard::Clipboard>,
}

fn load_workspace_snapshot(
    read_service: Option<&SessionService>,
    metadata: &TuiMetadata,
) -> WorkspaceSnapshot {
    read_service
        .map(SessionService::workspace_snapshot)
        .unwrap_or_else(|| {
            core_view::workspace_snapshot(&metadata.cwd, metadata.workspace_host_path.as_deref())
        })
}

fn load_worksets_snapshot(
    read_service: Option<&SessionService>,
    metadata: &TuiMetadata,
) -> WorksetsSnapshot {
    read_service
        .map(SessionService::worksets_snapshot)
        .unwrap_or_else(|| {
            core_view::worksets_snapshot(&metadata.store_path, metadata.session_id.as_deref())
        })
}

impl App {
    #[cfg(test)]
    pub(super) fn new(
        metadata: TuiMetadata,
        restored_messages: &[Message],
        start_in_session_picker: bool,
    ) -> Self {
        Self::new_inner(None, metadata, restored_messages, start_in_session_picker)
    }

    pub(super) fn new_with_service(
        service: SessionService,
        metadata: TuiMetadata,
        restored_messages: &[Message],
        start_in_session_picker: bool,
    ) -> Self {
        Self::new_inner(
            Some(service),
            metadata,
            restored_messages,
            start_in_session_picker,
        )
    }

    fn new_inner(
        read_service: Option<SessionService>,
        metadata: TuiMetadata,
        restored_messages: &[Message],
        start_in_session_picker: bool,
    ) -> Self {
        let workspace = load_workspace_snapshot(read_service.as_ref(), &metadata);
        let worksets = load_worksets_snapshot(read_service.as_ref(), &metadata);

        let mut panel_scrolls = HashMap::new();
        panel_scrolls.insert(PanelId::Prompt, 0);
        panel_scrolls.insert(PanelId::Events, 0);
        panel_scrolls.insert(PanelId::Threads, 0);
        panel_scrolls.insert(PanelId::Response, 0);
        panel_scrolls.insert(PanelId::Workspace, 0);
        panel_scrolls.insert(PanelId::Worksets, 0);
        panel_scrolls.insert(PanelId::ThreadList, 0);
        panel_scrolls.insert(PanelId::ThreadEpisodes, 0);

        let mut app = Self {
            metadata,
            read_service,
            composer: build_composer(),
            composer_notice: None,
            active_run_id: None,
            quit: false,
            working_started_at: None,
            restored_message_count: visible_restored_message_count(restored_messages),
            prompts: Vec::new(),
            selected_prompt: None,
            responses: Vec::new(),
            selected_response: None,
            timeline: VecDeque::new(),
            threads: HashMap::new(),
            all_episodes: HashMap::new(),
            episode_markdown_cache: HashMap::new(),
            response_markdown_cache: None,
            selected_thread: None,
            tool_event_contexts: HashMap::new(),
            workspace,
            worksets,
            last_workspace_refresh_at: Instant::now(),
            workspace_tx: None,
            workspace_rx: None,
            workspace_refresh_pending: false,
            workspace_refresh_deadline: None,
            panel_scrolls,
            panel_views: HashMap::new(),
            suppress_mouse_scroll_until: None,
            selection: None,
            help_visible: false,
            screen: ScreenMode::Dashboard,
            session_picker: SessionPickerState::default(),
            clipboard: arboard::Clipboard::new().ok(),
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

    pub(super) fn prompt(&self) -> String {
        self.composer.lines().join("\n")
    }

    pub(super) fn is_run_active(&self) -> bool {
        self.active_run_id.is_some()
    }

    pub(super) fn prepare_user_input(&self, input: &str) -> PreparedUserInput {
        self.read_service
            .as_ref()
            .map(|service| service.prepare_user_input(input))
            .unwrap_or_else(|| core_commands::prepare_user_input(input))
    }

    pub(super) fn clear_composer(&mut self) {
        self.composer = build_composer();
        self.composer_notice = None;
    }

    pub(super) fn clear_composer_notice(&mut self) {
        self.composer_notice = None;
    }

    pub(super) fn show_composer_notice(&mut self, text: impl Into<String>, tone: Tone) {
        self.composer_notice = Some(ComposerNotice {
            text: text.into(),
            tone,
            expires_at: Instant::now() + Duration::from_secs(2),
        });
    }

    pub(super) fn maybe_expire_composer_notice(&mut self) {
        if self
            .composer_notice
            .as_ref()
            .is_some_and(|notice| Instant::now() >= notice.expires_at)
        {
            self.composer_notice = None;
        }
    }

    pub(super) fn handle_paste(&mut self, text: &str) -> AppAction {
        if self.help_visible || matches!(self.screen, ScreenMode::SessionPicker { .. }) {
            return AppAction::None;
        }
        if self.is_run_active() {
            return AppAction::None;
        }

        self.clear_composer_notice();
        self.composer.insert_str(&normalize_paste(text));
        AppAction::None
    }

    pub(super) fn scroll_reset_state(
        &self,
    ) -> (
        ScreenMode,
        bool,
        Option<String>,
        usize,
        Option<usize>,
        Option<usize>,
    ) {
        (
            self.screen,
            self.help_visible,
            self.selected_thread.clone(),
            self.session_picker.selected,
            self.selected_prompt,
            self.selected_response,
        )
    }

    pub(super) fn handle_key_event(&mut self, key: KeyEvent) -> AppAction {
        let before = self.scroll_reset_state();
        let action = self.handle_key_event_inner(key);
        if self.scroll_reset_state() != before {
            self.request_scroll_event_reset();
        }
        action
    }

    pub(super) fn handle_key_event_inner(&mut self, key: KeyEvent) -> AppAction {
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
                self.toggle_focus_panel(FocusPanel::Prompt);
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
                code: KeyCode::Char('w'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.toggle_focus_panel(FocusPanel::Workspace);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Char('k'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                self.toggle_focus_panel(FocusPanel::Worksets);
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Esc, ..
            } if matches!(self.screen, ScreenMode::Focused(_)) => {
                if matches!(self.screen, ScreenMode::Focused(FocusPanel::Response)) {
                    self.select_latest_response();
                } else if matches!(self.screen, ScreenMode::Focused(FocusPanel::Prompt)) {
                    self.select_latest_prompt();
                } else {
                    self.selection = None;
                }
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
                code: KeyCode::Left,
                ..
            } if matches!(self.screen, ScreenMode::Focused(FocusPanel::Response)) => {
                self.select_older_response();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Right,
                ..
            } if matches!(self.screen, ScreenMode::Focused(FocusPanel::Response)) => {
                self.select_newer_response();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Left,
                ..
            } if matches!(self.screen, ScreenMode::Focused(FocusPanel::Prompt)) => {
                self.select_older_prompt();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Right,
                ..
            } if matches!(self.screen, ScreenMode::Focused(FocusPanel::Prompt)) => {
                self.select_newer_prompt();
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
                if !self.is_run_active() {
                    self.composer.insert_newline();
                }
                AppAction::None
            }
            // Some terminals encode Shift+Enter as LF, which crossterm reports as Ctrl+J in raw mode.
            KeyEvent {
                code: KeyCode::Char('j'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL)
                && !modifiers.contains(KeyModifiers::ALT) =>
            {
                if !self.is_run_active() {
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
                if trimmed.is_empty() || self.is_run_active() {
                    return AppAction::None;
                }

                match self.prepare_user_input(&prompt) {
                    PreparedUserInput::Empty => AppAction::None,
                    PreparedUserInput::FrontendCommand(FrontendCommand::Exit) => {
                        self.quit = true;
                        AppAction::Quit
                    }
                    PreparedUserInput::FrontendCommand(FrontendCommand::Sessions) => {
                        self.open_session_picker(false);
                        self.clear_composer();
                        AppAction::None
                    }
                    PreparedUserInput::SubmitPrompt(prompt) => AppAction::Submit(prompt),
                    PreparedUserInput::InvalidSlashCommand { message } => {
                        self.show_composer_notice(message, Tone::Warning);
                        AppAction::None
                    }
                }
            }
            // Cmd+C (macOS) or Super+C: copy selection, don't type "c"
            KeyEvent {
                code: KeyCode::Char('c'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::SUPER)
                && !modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.copy_selection_to_clipboard();
                AppAction::None
            }
            // All other SUPER-modified keys: don't type into composer
            KeyEvent { modifiers, .. } if modifiers.contains(KeyModifiers::SUPER) => {
                AppAction::None
            }
            _ => {
                if !self.is_run_active() {
                    self.clear_composer_notice();
                    self.composer.input(key);
                }
                AppAction::None
            }
        }
    }

    pub(super) fn handle_mouse_event(&mut self, mouse: MouseEvent) {
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
                if !self.suppressing_mouse_scroll() {
                    if let Some(panel) = self.panel_at(mouse.column, mouse.row) {
                        self.scroll_panel(panel, -3);
                    }
                }
            }
            MouseEventKind::ScrollDown => {
                if !self.suppressing_mouse_scroll() {
                    if let Some(panel) = self.panel_at(mouse.column, mouse.row) {
                        self.scroll_panel(panel, 3);
                    }
                }
            }
            _ => {}
        }
    }

    pub(super) fn handle_crossterm_event(&mut self, event: CrosstermEvent) -> Option<AppAction> {
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

    pub(super) fn hydrate_from_messages(&mut self, messages: &[Message]) {
        for message in messages {
            match message {
                Message::User { content } => {
                    self.prompts
                        .push(core_commands::display_prompt_from_message(content));
                    self.selected_prompt = self.latest_prompt_index();
                }
                Message::Assistant {
                    content,
                    tool_calls,
                    ..
                } if tool_calls.as_ref().map_or(true, |tc| tc.is_empty()) => {
                    self.responses.push(ResponseEntry {
                        content: content
                            .clone()
                            .unwrap_or_else(|| "[No response]".to_string()),
                        duration: None,
                    });
                    self.selected_response = self.latest_response_index();
                    self.response_markdown_cache = None;
                }
                _ => {}
            }
        }
    }

    pub(super) fn restore_response_duration_history(
        &mut self,
        response_durations: Option<&[Option<Duration>]>,
        last_response_duration: Option<Duration>,
        previous_response_duration: Option<Duration>,
    ) {
        if let Some(response_durations) = response_durations {
            for response in &mut self.responses {
                response.duration = None;
            }
            for (response, duration) in self
                .responses
                .iter_mut()
                .zip(response_durations.iter().copied())
            {
                response.duration = duration;
            }
        } else {
            self.restore_response_durations(last_response_duration, previous_response_duration);
        }
    }

    pub(super) fn restore_response_durations(
        &mut self,
        last_response_duration: Option<Duration>,
        previous_response_duration: Option<Duration>,
    ) {
        let len = self.responses.len();
        if let Some(last) = len.checked_sub(1) {
            self.responses[last].duration = last_response_duration;
        }
        if len >= 2 {
            self.responses[len - 2].duration = previous_response_duration;
        }
    }

    pub(super) fn complete_top_level_response(&mut self, content: String, duration: Duration) {
        self.responses.push(ResponseEntry {
            content: content.clone(),
            duration: Some(duration),
        });
        self.selected_response = self.latest_response_index();
        self.response_markdown_cache = None;
        self.selection = None;
        self.panel_scrolls.insert(PanelId::Response, 0);
        self.push_timeline(
            "assistant",
            format!("reply • {}", fit_text(&content, 110)),
            Tone::Success,
        );
    }

    pub(super) fn handle_session_picker_key_event(&mut self, key: KeyEvent) -> AppAction {
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

    pub(super) fn open_session_picker(&mut self, startup: bool) {
        self.refresh_session_picker();
        self.selection = None;
        self.screen = ScreenMode::SessionPicker { startup };
    }

    pub(super) fn toggle_focus_panel(&mut self, panel: FocusPanel) {
        let was_prompt_focused = matches!(self.screen, ScreenMode::Focused(FocusPanel::Prompt));
        let was_response_focused = matches!(self.screen, ScreenMode::Focused(FocusPanel::Response));
        self.selection = None;
        self.screen = match self.screen {
            ScreenMode::Focused(current) if current == panel => ScreenMode::Dashboard,
            _ => {
                if matches!(panel, FocusPanel::Events) {
                    self.panel_scrolls.insert(PanelId::Events, usize::MAX);
                }
                if matches!(panel, FocusPanel::Prompt) {
                    self.ensure_selected_prompt();
                }
                if matches!(panel, FocusPanel::Response) {
                    self.ensure_selected_response();
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
        if was_prompt_focused && !matches!(self.screen, ScreenMode::Focused(FocusPanel::Prompt)) {
            self.select_latest_prompt();
        }
        if was_response_focused && !matches!(self.screen, ScreenMode::Focused(FocusPanel::Response))
        {
            self.select_latest_response();
        }
    }

    pub(super) fn primary_scroll_panel(&self) -> PanelId {
        match self.screen {
            ScreenMode::Focused(FocusPanel::Prompt) => PanelId::Prompt,
            ScreenMode::Focused(FocusPanel::Events) => PanelId::Events,
            ScreenMode::Focused(FocusPanel::Threads) => PanelId::ThreadEpisodes,
            ScreenMode::Focused(FocusPanel::Workspace) => PanelId::Workspace,
            ScreenMode::Focused(FocusPanel::Worksets) => PanelId::Worksets,
            _ => PanelId::Response,
        }
    }

    pub(super) fn request_scroll_event_reset(&mut self) {
        self.suppress_mouse_scroll_until = Some(Instant::now() + VIEW_CHANGE_SCROLL_SUPPRESS);
    }

    pub(super) fn suppressing_mouse_scroll(&mut self) -> bool {
        let Some(until) = self.suppress_mouse_scroll_until else {
            return false;
        };

        if Instant::now() < until {
            return true;
        }

        self.suppress_mouse_scroll_until = None;
        false
    }

    pub(super) fn refresh_session_picker(&mut self) {
        let sessions = self
            .read_service
            .as_ref()
            .map(SessionService::list_sessions)
            .unwrap_or_else(|| core_view::list_sessions(&self.metadata.store_path));
        match sessions {
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

    pub(super) fn hydrate_threads_from_store(&mut self) {
        let Ok(threads) = self
            .read_service
            .as_ref()
            .map(SessionService::list_threads)
            .unwrap_or_else(|| {
                core_view::list_threads(
                    &self.metadata.store_path,
                    self.metadata.session_id.as_deref(),
                )
            })
        else {
            return;
        };

        for thread in threads {
            let ts = parse_timestamp_to_unix(&thread.updated_at).unwrap_or_else(current_unix_ts);
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
                    updated_at_ts: ts,
                    episodes: thread.episode_count,
                    summary: format!("{} episode(s)", thread.episode_count),
                });
            if matches!(entry.state, ThreadState::Idle) {
                if let Some(action) = thread.latest_action {
                    entry.action = action;
                }
                entry.updated_at = short_clock(&thread.updated_at);
                entry.updated_at_ts =
                    parse_timestamp_to_unix(&thread.updated_at).unwrap_or_else(current_unix_ts);
                entry.episodes = thread.episode_count;
                entry.summary = format!("{} episode(s)", thread.episode_count);
            }
        }
    }

    pub(super) fn hydrate_all_episodes(&mut self) {
        if let Ok(episodes) = self
            .read_service
            .as_ref()
            .map(SessionService::all_thread_episodes)
            .unwrap_or_else(|| {
                core_view::load_all_thread_episodes(
                    &self.metadata.store_path,
                    self.metadata.session_id.as_deref(),
                )
            })
        {
            self.all_episodes = episodes;
        }
        self.episode_markdown_cache.clear();
    }

    pub(super) fn refresh_worksets(&mut self) {
        self.worksets = load_worksets_snapshot(self.read_service.as_ref(), &self.metadata);
    }

    pub(super) fn maybe_refresh_workspace(&mut self) {
        if self.last_workspace_refresh_at.elapsed() >= WORKSPACE_REFRESH_INTERVAL {
            self.last_workspace_refresh_at = Instant::now();
            self.request_workspace_refresh();
        }
    }

    pub(super) fn request_workspace_refresh(&mut self) {
        if self.workspace_refresh_pending {
            return;
        }
        let tx = match &self.workspace_tx {
            Some(tx) => tx.clone(),
            None => return,
        };
        let service = self.read_service.clone();
        let metadata = self.metadata.clone();
        self.workspace_refresh_pending = true;
        self.workspace_refresh_deadline = Some(Instant::now() + Duration::from_secs(5));
        tokio::task::spawn_blocking(move || {
            let snapshot = load_workspace_snapshot(service.as_ref(), &metadata);
            let _ = tx.blocking_send(snapshot);
        });
    }

    pub(super) fn check_workspace_channel(&mut self) {
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

    pub(super) fn note_prompt_submitted(&mut self, prompt: &str) {
        self.prompts.push(prompt.to_string());
        self.select_latest_prompt();
        self.push_timeline(
            "user",
            format!("prompt • {}", fit_text(prompt, 110)),
            Tone::Info,
        );
    }

    pub(super) fn note_send_error(&mut self, error: String) {
        self.push_timeline("send", format!("error • {error}"), Tone::Error);
    }

    pub(super) fn apply_agent_event(&mut self, event: AgentEvent) {
        match event {
            AgentEvent::RunStarted {
                thread_name,
                prompt_preview,
            } => {
                if thread_name.is_none() && self.prompts.is_empty() {
                    self.prompts.push(prompt_preview.clone());
                    self.selected_prompt = self.latest_prompt_index();
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
                ..
            } => {
                if thread_name.is_none() && name == "thread" {
                    return;
                }

                self.tool_event_contexts.insert(
                    call_id,
                    ToolEventContext {
                        thread_name: thread_name.clone(),
                        name: name.clone(),
                        target: args_preview.clone(),
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

                let context = self.tool_event_contexts.remove(&call_id);
                let actor = thread_name
                    .clone()
                    .or_else(|| context.as_ref().and_then(|tool| tool.thread_name.clone()))
                    .unwrap_or_else(|| "orchestrator".to_string());
                let tool_name = context
                    .as_ref()
                    .map(|tool| tool.name.clone())
                    .unwrap_or(name);
                let target = context
                    .as_ref()
                    .map(|tool| tool.target.clone())
                    .unwrap_or_default();

                if matches!(tool_name.as_str(), "write" | "edit" | "exec_command")
                    || is_error
                    || content_preview.starts_with("Exit code:")
                {
                    self.request_workspace_refresh();
                }
                if tool_name.starts_with("workset_") {
                    self.refresh_worksets();
                }

                let detail = if target.is_empty() {
                    content_preview.clone()
                } else {
                    format!("{target} • {content_preview}")
                };
                self.push_timeline(
                    actor,
                    format!("{tool_name} • {detail}"),
                    tool_finish_tone(is_error, &content_preview),
                );
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
                        updated_at_ts: current_unix_ts(),
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
                timeout_reason,
                ..
            } => {
                let entry = self
                    .threads
                    .entry(name.clone())
                    .or_insert_with(|| ThreadView {
                        name: name.clone(),
                        action: "thread run".to_string(),
                        state: ThreadState::Idle,
                        updated_at: utc_hms(),
                        updated_at_ts: current_unix_ts(),
                        episodes: 0,
                        summary: String::new(),
                    });
                entry.state = ThreadState::Idle;
                entry.updated_at = utc_hms();
                entry.updated_at_ts = current_unix_ts();
                entry.summary = if timed_out {
                    "timed out".to_string()
                } else {
                    format!("exit {exit_code}")
                };

                self.request_workspace_refresh();
                self.hydrate_threads_from_store();
                self.hydrate_all_episodes();

                let detail = if timed_out {
                    match timeout_reason {
                        Some(reason) => format!(
                            "thread complete • timed out • {}",
                            fit_text(&reason.replace('\n', " "), 110)
                        ),
                        None => "thread complete • timed out".to_string(),
                    }
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
                ..
            } => match thread_name {
                Some(thread_name) => {
                    if let Some(thread) = self.threads.get_mut(&thread_name) {
                        thread.updated_at = utc_hms();
                        thread.updated_at_ts = current_unix_ts();
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
                None => {}
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

    pub(super) fn push_timeline(
        &mut self,
        actor: impl Into<String>,
        detail: impl Into<String>,
        tone: Tone,
    ) {
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

    pub(super) fn active_thread_count(&self) -> usize {
        self.threads
            .values()
            .filter(|thread| matches!(thread.state, ThreadState::Active))
            .count()
    }

    pub(super) fn sorted_thread_names(&self) -> Vec<String> {
        let mut threads: Vec<&ThreadView> = self.threads.values().collect();
        threads.sort_by(|left, right| {
            matches!(right.state, ThreadState::Active)
                .cmp(&matches!(left.state, ThreadState::Active))
                .then_with(|| right.updated_at_ts.cmp(&left.updated_at_ts))
                .then_with(|| left.name.cmp(&right.name))
        });
        threads.into_iter().map(|t| t.name.clone()).collect()
    }

    pub(super) fn latest_prompt_index(&self) -> Option<usize> {
        self.prompts.len().checked_sub(1)
    }

    pub(super) fn latest_prompt(&self) -> Option<&str> {
        self.prompts.last().map(String::as_str)
    }

    pub(super) fn ensure_selected_prompt(&mut self) {
        match (self.selected_prompt, self.latest_prompt_index()) {
            (_, None) => self.selected_prompt = None,
            (Some(selected), Some(latest)) if selected <= latest => {}
            (_, Some(latest)) => self.selected_prompt = Some(latest),
        }
    }

    pub(super) fn select_latest_prompt(&mut self) {
        self.selected_prompt = self.latest_prompt_index();
        self.selection = None;
        self.panel_scrolls.insert(PanelId::Prompt, 0);
    }

    pub(super) fn displayed_prompt_index(&self) -> Option<usize> {
        let latest = self.latest_prompt_index()?;
        if matches!(self.screen, ScreenMode::Focused(FocusPanel::Prompt)) {
            self.selected_prompt
                .filter(|selected| *selected <= latest)
                .or(Some(latest))
        } else {
            Some(latest)
        }
    }

    pub(super) fn select_older_prompt(&mut self) {
        self.ensure_selected_prompt();
        let Some(selected) = self.selected_prompt else {
            return;
        };
        let new_selected = selected.saturating_sub(1);
        if new_selected != selected {
            self.selected_prompt = Some(new_selected);
            self.selection = None;
            self.panel_scrolls.insert(PanelId::Prompt, 0);
        }
    }

    pub(super) fn select_newer_prompt(&mut self) {
        self.ensure_selected_prompt();
        let (Some(selected), Some(latest)) = (self.selected_prompt, self.latest_prompt_index())
        else {
            return;
        };
        let new_selected = (selected + 1).min(latest);
        if new_selected != selected {
            self.selected_prompt = Some(new_selected);
            self.selection = None;
            self.panel_scrolls.insert(PanelId::Prompt, 0);
        }
    }

    pub(super) fn latest_response_index(&self) -> Option<usize> {
        self.responses.len().checked_sub(1)
    }

    pub(super) fn ensure_selected_response(&mut self) {
        match (self.selected_response, self.latest_response_index()) {
            (_, None) => self.selected_response = None,
            (Some(selected), Some(latest)) if selected <= latest => {}
            (_, Some(latest)) => self.selected_response = Some(latest),
        }
    }

    pub(super) fn select_latest_response(&mut self) {
        self.selected_response = self.latest_response_index();
        self.response_markdown_cache = None;
        self.selection = None;
        self.panel_scrolls.insert(PanelId::Response, 0);
    }

    pub(super) fn displayed_response_index(&self) -> Option<usize> {
        let latest = self.latest_response_index()?;
        if matches!(self.screen, ScreenMode::Focused(FocusPanel::Response)) {
            self.selected_response
                .filter(|selected| *selected <= latest)
                .or(Some(latest))
        } else {
            Some(latest)
        }
    }

    pub(super) fn select_older_response(&mut self) {
        self.ensure_selected_response();
        let Some(selected) = self.selected_response else {
            return;
        };
        let new_selected = selected.saturating_sub(1);
        if new_selected != selected {
            self.selected_response = Some(new_selected);
            self.response_markdown_cache = None;
            self.selection = None;
            self.panel_scrolls.insert(PanelId::Response, 0);
        }
    }

    pub(super) fn select_newer_response(&mut self) {
        self.ensure_selected_response();
        let (Some(selected), Some(latest)) = (self.selected_response, self.latest_response_index())
        else {
            return;
        };
        let new_selected = (selected + 1).min(latest);
        if new_selected != selected {
            self.selected_response = Some(new_selected);
            self.response_markdown_cache = None;
            self.selection = None;
            self.panel_scrolls.insert(PanelId::Response, 0);
        }
    }

    pub(super) fn select_previous_thread(&mut self) {
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

    pub(super) fn select_next_thread(&mut self) {
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

    pub(super) fn displayed_run_duration(&self) -> Option<Duration> {
        self.working_started_at
            .map(|started| started.elapsed())
            .or_else(|| self.responses.last().and_then(|response| response.duration))
    }

    #[cfg(test)]
    pub(super) fn response_duration_snapshot_ms(&self) -> (Option<u64>, Option<u64>) {
        let last_response_duration = self
            .responses
            .last()
            .and_then(|response| response.duration)
            .map(duration_to_millis_u64);
        let previous_response_duration = self
            .responses
            .len()
            .checked_sub(2)
            .and_then(|index| self.responses.get(index))
            .and_then(|response| response.duration)
            .map(duration_to_millis_u64);
        (last_response_duration, previous_response_duration)
    }

    #[cfg(test)]
    pub(super) fn response_duration_history_snapshot_ms(&self) -> Vec<Option<u64>> {
        self.responses
            .iter()
            .map(|response| response.duration.map(duration_to_millis_u64))
            .collect()
    }

    pub(super) fn render(&mut self, frame: &mut ratatui::Frame) {
        self.panel_views.clear();

        let area = frame.area();
        let (min_width, min_height) = self.minimum_terminal_size();
        if area.width < min_width || area.height < min_height {
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
                FocusPanel::Prompt => self.render_focused_prompt(frame, sections[1]),
                FocusPanel::Events => self.render_focused_events(frame, sections[1]),
                FocusPanel::Response => self.render_focused_response(frame, sections[1]),
                FocusPanel::Threads => self.render_focused_threads(frame, sections[1]),
                FocusPanel::Workspace => self.render_focused_workspace(frame, sections[1]),
                FocusPanel::Worksets => self.render_focused_worksets(frame, sections[1]),
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

    pub(super) fn minimum_terminal_size(&self) -> (u16, u16) {
        (MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT)
    }

    pub(super) fn render_focused_prompt(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        self.render_prompt_panel(frame, area);
    }

    pub(super) fn render_focused_events(&mut self, frame: &mut ratatui::Frame, area: Rect) {
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

    pub(super) fn render_focused_response(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        self.render_responses_panel(frame, area);
    }

    pub(super) fn render_focused_workspace(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(6), Constraint::Min(6)])
            .split(area);

        self.render_workspace_panel(frame, sections[0]);
        self.render_file_changes_panel(frame, sections[1]);
    }

    pub(super) fn render_focused_worksets(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        self.render_worksets_panel(frame, area);
    }

    pub(super) fn render_too_small(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block("NAC");
        let inner = block.inner(area);
        frame.render_widget(block, area);

        let mut lines = vec![
            Line::from(Span::styled(
                "Terminal too small for this TUI.",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(format!(
                "Resize to at least {}x{}.",
                self.minimum_terminal_size().0,
                self.minimum_terminal_size().1
            )),
        ];
        if let Some(prompt) = self.latest_prompt() {
            lines.push(Line::from(""));
            lines.push(Line::from(vec![
                Span::styled("last prompt ", Style::default().fg(Color::DarkGray)),
                Span::raw(fit_text(prompt, inner.width.saturating_sub(12) as usize)),
            ]));
        }

        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
    }

    pub(super) fn render_header(&self, frame: &mut ratatui::Frame, area: Rect) {
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
        let runtime_duration = self.displayed_run_duration();
        let runtime = format_optional_runtime(runtime_duration);
        let run_state = if self.is_run_active() {
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
                Style::default().fg(if runtime_duration.is_none() {
                    Color::DarkGray
                } else if self.is_run_active() {
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

    pub(super) fn render_session_picker(&self, frame: &mut ratatui::Frame, area: Rect) {
        let left_width = (area.width as f64 * 0.33) as u16;
        let left_width = left_width.max(20);
        let right_width = area.width.saturating_sub(left_width + 1);

        let left_area = Rect::new(area.x, area.y, left_width, area.height);
        let right_area = Rect::new(area.x + left_width + 1, area.y, right_width, area.height);

        self.render_session_picker_list(frame, left_area);
        self.render_session_picker_detail(frame, right_area);
    }

    pub(super) fn render_session_picker_list(&self, frame: &mut ratatui::Frame, area: Rect) {
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
            let visible_height = inner.height as usize;
            let start = self
                .session_picker
                .selected
                .saturating_sub(visible_height.saturating_sub(1));
            for (offset, session) in self
                .session_picker
                .sessions
                .iter()
                .skip(start)
                .take(visible_height)
                .enumerate()
            {
                let index = start + offset;
                let selected = index == self.session_picker.selected;
                let style = if selected {
                    Style::default()
                        .fg(Color::White)
                        .bg(Color::DarkGray)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                let session_label = fit_text(&session.session_id, 18);
                let cwd_label = compact_path(
                    &session.cwd.display().to_string(),
                    inner.width.saturating_sub(24) as usize,
                );
                if selected {
                    lines.push(Line::styled(
                        format!(
                            "› {}  {:<18}  {}",
                            short_timestamp(&session.updated_at),
                            session_label,
                            cwd_label,
                        ),
                        style,
                    ));
                } else {
                    lines.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(
                            format!("{}  ", short_timestamp(&session.updated_at)),
                            Style::default().fg(Color::DarkGray),
                        ),
                        Span::styled(format!("{:<18}", session_label), style),
                        Span::raw("  "),
                        Span::styled(cwd_label, Style::default().fg(Color::DarkGray)),
                    ]));
                }
            }
        }

        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
    }

    pub(super) fn render_session_picker_detail(&self, frame: &mut ratatui::Frame, area: Rect) {
        let selected_session = self
            .session_picker
            .sessions
            .get(self.session_picker.selected);
        let title = match selected_session {
            Some(session) => panel_title_segments(vec![
                Span::styled(
                    "SESSION — ".to_string(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(short_session(&session.session_id)),
            ]),
            None => panel_title("SESSION"),
        };
        let block = panel_block_with_title(title);
        let inner = block.inner(area);
        frame.render_widget(block, area);
        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let lines = if let Some(session) = selected_session {
            let last_prompt = session
                .last_user_prompt
                .as_deref()
                .unwrap_or("No user prompt recorded.");
            let detail = format!(
                "# Session: {}\n\
                 Updated: {}  |  Created: {}  |  Messages: {}  |  Sandbox: {}  |  SSH: {}\n\
                 Model: {}  |  Backend: {}\n\
                 Cwd: {}\n\n\
                 ---\n\n\
                 ### Last prompt\n\n\
                 {}",
                session.session_id,
                session.updated_at,
                session.created_at,
                session.visible_message_count,
                if session.sandboxed { "on" } else { "off" },
                session.ssh_host.as_deref().unwrap_or("local"),
                session.model,
                session.backend,
                session.cwd.display(),
                last_prompt,
            );
            render_markdown_lines(&detail, Some(inner.width as usize))
        } else {
            vec![Line::from(Span::styled(
                "Select a session to inspect.",
                Style::default().fg(Color::DarkGray),
            ))]
        };

        frame.render_widget(
            Paragraph::new(Text::from(lines)).wrap(ratatui::widgets::Wrap { trim: false }),
            inner,
        );
    }

    pub(super) fn render_session_picker_footer(&self, frame: &mut ratatui::Frame, area: Rect) {
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

    pub(super) fn render_left_column(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(10), Constraint::Min(10)])
            .split(area);

        self.render_prompt_panel(frame, sections[0]);
        self.render_events_panel(frame, sections[1]);
    }

    pub(super) fn render_center_column(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(7),
                Constraint::Length(6),
                Constraint::Min(14),
            ])
            .split(area);

        self.render_threads_panel(frame, sections[0]);
        self.render_workspace_panel(frame, sections[1]);
        self.render_responses_panel(frame, sections[2]);
    }

    pub(super) fn render_right_column(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let sections = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(8), Constraint::Length(9)])
            .split(area);

        self.render_worksets_panel(frame, sections[0]);
        self.render_file_changes_panel(frame, sections[1]);
    }

    pub(super) fn prompt_panel_title(&self) -> Line<'static> {
        let position = match self.displayed_prompt_index() {
            Some(index) => format!(" {}/{}", index + 1, self.prompts.len()),
            None => " 0/0".to_string(),
        };
        panel_title_segments(vec![
            Span::styled(
                "PROMPTS".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(position, Style::default().fg(Color::DarkGray)),
        ])
    }

    pub(super) fn composer_panel_title(&self) -> Line<'static> {
        if !self.is_run_active() {
            return panel_title("ASK");
        }

        let label_style = Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD);
        let timer_style = Style::default().fg(Color::Green);
        let runtime =
            format_optional_runtime(self.working_started_at.map(|started| started.elapsed()));
        panel_title_segments(vec![
            Span::styled("ASK", label_style),
            Span::raw(" "),
            Span::styled(runtime, timer_style),
        ])
    }

    pub(super) fn render_prompt_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = match self
            .displayed_prompt_index()
            .and_then(|index| self.prompts.get(index))
        {
            Some(prompt) => split_preserving_empty(prompt),
            None => vec!["Waiting for the first orchestrator prompt.".to_string()],
        };
        let title = self.prompt_panel_title();
        self.render_selectable_panel_with_title(frame, area, PanelId::Prompt, title, lines);
    }

    pub(super) fn render_workspace_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let lines = vec![
            format!("workspace  {}", self.workspace.workspace_display),
            match self.workspace.host_root.as_ref() {
                Some(path) => format!("source     {}", path.display()),
                None => "source     remote/sandbox-only".to_string(),
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

    pub(super) fn render_help_overlay(&self, frame: &mut ratatui::Frame, area: Rect) {
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
                    "Ctrl-T / Ctrl-E / Ctrl-P / Ctrl-R",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    " focus threads / events / prompts / responses",
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(vec![
                Span::styled(
                    "← / →",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    " older / newer prompt or response while focused",
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(vec![
                Span::styled(
                    "Ctrl-W / Ctrl-K",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    " focus workspace / worksets",
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
                    "/plan /run",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" plan or run a workset", Style::default().fg(Color::White)),
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

    pub(super) fn render_threads_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
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
                .then_with(|| right.updated_at_ts.cmp(&left.updated_at_ts))
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

    pub(super) fn render_events_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
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

    pub(super) fn render_responses_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let available_width = area.width.saturating_sub(2) as usize;
        let displayed_index = self.displayed_response_index();
        let lines = match displayed_index {
            Some(index) => self.rendered_response_lines(index, available_width),
            None if self.is_run_active() => vec![Line::from(Span::styled(
                "Awaiting orchestrator reply.",
                Style::default().fg(Color::DarkGray),
            ))],
            None => vec![Line::from(Span::styled(
                "No orchestrator replies yet.",
                Style::default().fg(Color::DarkGray),
            ))],
        };
        let (runtime_duration, runtime_is_live) = self.response_panel_runtime(displayed_index);
        let runtime = format_optional_runtime(runtime_duration);
        let position = match displayed_index {
            Some(index) => format!(" {}/{}", index + 1, self.responses.len()),
            None => " 0/0".to_string(),
        };
        let title = panel_title_segments(vec![
            Span::styled(
                "RESPONSES".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(position, Style::default().fg(Color::DarkGray)),
            Span::raw(" "),
            Span::styled(
                runtime,
                Style::default().fg(if runtime_duration.is_none() {
                    Color::DarkGray
                } else if runtime_is_live {
                    Color::Green
                } else {
                    Color::Yellow
                }),
            ),
        ]);
        self.render_selectable_rich_panel_with_title(frame, area, PanelId::Response, title, lines);
    }

    pub(super) fn rendered_response_lines(
        &mut self,
        index: usize,
        available_width: usize,
    ) -> Vec<Line<'static>> {
        let Some(response) = self
            .responses
            .get(index)
            .map(|response| response.content.clone())
        else {
            return Vec::new();
        };
        match &self.response_markdown_cache {
            Some((cached_index, cached_text, cached_width, cached_lines))
                if *cached_index == index
                    && cached_text == &response
                    && *cached_width == available_width =>
            {
                cached_lines.clone()
            }
            _ => {
                let lines = render_markdown_lines(&response, Some(available_width));
                self.response_markdown_cache =
                    Some((index, response, available_width, lines.clone()));
                lines
            }
        }
    }

    pub(super) fn response_panel_runtime(
        &self,
        displayed_index: Option<usize>,
    ) -> (Option<Duration>, bool) {
        if let Some(index) = displayed_index {
            return (
                self.responses
                    .get(index)
                    .and_then(|response| response.duration),
                false,
            );
        }

        if self.is_run_active() {
            return (
                self.working_started_at.map(|started| started.elapsed()),
                true,
            );
        }

        (None, false)
    }

    pub(super) fn render_focused_threads(&mut self, frame: &mut ratatui::Frame, body: Rect) {
        let left_width = (body.width as f64 * 0.33) as u16;
        let left_width = left_width.max(20);
        let right_width = body.width.saturating_sub(left_width + 1);

        let left_area = Rect::new(body.x, body.y, left_width, body.height);
        let right_area = Rect::new(body.x + left_width + 1, body.y, right_width, body.height);

        self.render_thread_list_pane(frame, left_area);
        self.render_episode_detail_pane(frame, right_area);
    }

    pub(super) fn render_thread_list_pane(&mut self, frame: &mut ratatui::Frame, area: Rect) {
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
            let action_width = width.saturating_sub(max_name_width + 8);
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

    pub(super) fn render_episode_detail_pane(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let available_width = area.width.saturating_sub(2) as usize;
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
                    lines.extend(render_markdown_lines(&header, Some(available_width)));
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
                let cache_key = format!("{}:{}", thread_name, available_width);
                match self.episode_markdown_cache.get(&cache_key) {
                    Some(cached) => cached.clone(),
                    None => {
                        let rendered = render_markdown_lines(&combined, Some(available_width));
                        self.episode_markdown_cache
                            .insert(cache_key, rendered.clone());
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
                lines.extend(render_markdown_lines(&header, Some(available_width)));
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

    pub(super) fn events_panel_title(&self) -> Line<'static> {
        let dot_color = if self.is_run_active() {
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

    pub(super) fn render_worksets_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let width = inner_width(area);
        let mut lines = Vec::new();

        if let Some(error) = self.worksets.error.as_deref() {
            push_wrapped_prefixed_lines(
                &mut lines,
                "",
                error,
                width,
                Style::default().fg(Color::DarkGray),
                Style::default().fg(Color::DarkGray),
            );
        } else if self.worksets.items.is_empty() {
            lines.push(Line::from(Span::styled(
                "No worksets yet.",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            for (index, workset) in self.worksets.items.iter().enumerate() {
                if index > 0 {
                    lines.push(workset_separator_line(width));
                }
                lines.push(render_workset_header_line(workset, width));
                if !workset.summary.is_empty() {
                    push_workset_labeled_lines(
                        &mut lines,
                        "  ",
                        "GOAL",
                        &workset.summary,
                        width,
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                        Style::default().fg(Color::DarkGray),
                    );
                }
                if let Some(recipe) = workset.verification_recipe.as_deref() {
                    push_workset_labeled_lines(
                        &mut lines,
                        "  ",
                        "CHECK",
                        &one_line(recipe),
                        width,
                        Style::default()
                            .fg(Color::Green)
                            .add_modifier(Modifier::BOLD),
                        Style::default().fg(Color::DarkGray),
                    );
                }
                for item in &workset.items {
                    lines.extend(render_workset_item_lines(item, width));
                }
            }
        }

        let title = panel_title_segments(vec![
            Span::styled(
                "WORKSETS".to_string(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(
                self.worksets.items.len().to_string(),
                Style::default().fg(Color::DarkGray),
            ),
        ]);
        self.render_scrollable_lines_panel_with_title(frame, area, PanelId::Worksets, title, lines);
    }

    pub(super) fn render_file_changes_panel(&mut self, frame: &mut ratatui::Frame, area: Rect) {
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
                    Span::styled(pad_cell("T", 1), Style::default().fg(Color::DarkGray)),
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

    pub(super) fn render_composer(&mut self, frame: &mut ratatui::Frame, area: Rect) {
        let block = panel_block_with_title(self.composer_panel_title());
        let inner = block.inner(area);
        frame.render_widget(block, area);

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        if self.is_run_active() {
            let line = Line::from(Span::styled(
                fit_text(RUNNING_COMPOSER_PLACEHOLDER, inner.width as usize),
                Style::default().fg(Color::DarkGray),
            ));
            frame.render_widget(Paragraph::new(line), inner);
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

    pub(super) fn render_selectable_panel(
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

    pub(super) fn render_selectable_panel_with_title(
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

    pub(super) fn render_selectable_rich_panel_with_title(
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

    pub(super) fn render_scrollable_lines_panel(
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

    pub(super) fn render_scrollable_lines_panel_with_title(
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

    pub(super) fn selection_point_at(&self, column: u16, row: u16) -> Option<SelectionPoint> {
        let panel = self.panel_at(column, row)?;
        if !panel_is_selectable(panel) {
            return None;
        }
        self.selection_point_for_panel(panel, column, row)
    }

    pub(super) fn panel_at(&self, column: u16, row: u16) -> Option<PanelId> {
        self.panel_views.iter().find_map(|(panel_id, view)| {
            contains_point(view.inner, column, row).then_some(*panel_id)
        })
    }

    pub(super) fn selection_point_for_panel(
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

    pub(super) fn autoscroll_drag_selection(&mut self, panel: PanelId, _column: u16, row: u16) {
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

    pub(super) fn scroll_panel(&mut self, panel: PanelId, delta_lines: isize) {
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

    pub(super) fn copy_selection_to_clipboard(&mut self) {
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
        if let Some(ref mut clipboard) = self.clipboard {
            let _ = copy_text_to_clipboard(clipboard, &text);
        }
    }
}
