//! The app's state, the actions handlers call, and the reducer for session events.
//!
//! Handlers and `AppHandle::update` closures run on the UI thread and only change state. Every
//! request goes through [`App::spawn`], which runs it on a worker thread and lands the answer
//! with `AppHandle::update`.

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rune::{AppHandle, PopupAnchor, PopupItem, PopupMenu, TextEdit, Tx, popup_menu_supported};
use rune_kit::shell::PaneState;
use serde_json::Value;

use crate::api::{Boundary, Client, ManagedSession, PermissionRequest, Project, Provider, Snapshot};
use crate::stream::{self, Link, Msg};
use crate::transcript::{self, Item, Tool, ToolStatus};

/// The session behaviors New session offers when the server enables orchestration, labelled as
/// the web client's New session is.
const BEHAVIORS: [(&str, &str); 3] =
    [("direct", "Agent Session"), ("direct-with-orchestrator", "Agent + Orchestrator Session"), ("orchestrator", "Orchestrator Session")];

#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    Overview,
    Session(String),
    Settings,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Conn {
    /// Attaching to `--server`, or starting the `nac-web` child.
    Starting,
    Ready,
    Failed(String),
    /// Fixture scenes and headless runs without `--server`: nothing is requested.
    Offline,
}

pub struct OpenSession {
    pub id: String,
    pub loading: bool,
    pub error: Option<String>,
    pub model: String,
    pub project_id: Option<String>,
    /// The stored transcript, from the last snapshot.
    pub items: Vec<Item>,
    /// This run's tool calls as events report them, until the snapshot stores them.
    pub live_tools: Vec<Tool>,
    pub stream_text: String,
    pub stream_reasoning: String,
    /// The prompt just sent, drawn until the snapshot stores it.
    pub pending_user: Option<String>,
    pub running: bool,
    pub run_started_ms: Option<i64>,
    /// A failed run's summary and diagnostic.
    pub failure: Option<(String, String)>,
    pub permissions: Vec<PermissionRequest>,
    pub link: Link,
    /// Keys of expanded tool and reasoning rows.
    pub expanded: HashSet<String>,
    stream_stop: Option<Arc<AtomicBool>>,
    fetching: bool,
    refetch: bool,
}

impl OpenSession {
    pub fn new(id: &str) -> OpenSession {
        OpenSession {
            id: id.to_owned(),
            loading: true,
            error: None,
            model: String::new(),
            project_id: None,
            items: Vec::new(),
            live_tools: Vec::new(),
            stream_text: String::new(),
            stream_reasoning: String::new(),
            pending_user: None,
            running: false,
            run_started_ms: None,
            failure: None,
            permissions: Vec::new(),
            link: Link::Connecting,
            expanded: HashSet::new(),
            stream_stop: None,
            fetching: false,
            refetch: false,
        }
    }

    fn clear_live(&mut self) {
        self.live_tools.clear();
        self.stream_text.clear();
        self.stream_reasoning.clear();
    }
}

impl Drop for OpenSession {
    fn drop(&mut self) {
        if let Some(stop) = &self.stream_stop {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

pub struct App {
    pub sidebar: PaneState,
    /// None follows the system appearance.
    pub theme: Option<bool>,
    pub route: Route,
    pub conn: Conn,
    pub server: String,
    pub version: String,
    pub projects: Vec<Project>,
    pub sessions: Vec<ManagedSession>,
    /// The lists were loaded at least once, so an empty one means "none" rather than "not yet".
    pub loaded: bool,
    pub open: Option<OpenSession>,
    pub composer: TextEdit,
    pub search_open: bool,
    pub search: TextEdit,
    /// Projects whose sessions the sidebar hides.
    pub collapsed: HashSet<String>,
    pub project_name: TextEdit,
    pub project_dir: TextEdit,
    /// The last failed request, shown as a dismissible banner.
    pub notice: Option<String>,
    /// A session or project is being created.
    pub busy: bool,
    /// The backend and model of the last session created here, checked in the model menu.
    pub model: Option<(String, String)>,
    /// The server enables orchestration. Without it every new session is `direct` and only direct
    /// sessions are listed, as in the web client.
    pub orchestration: bool,
    /// The behavior the next session gets, chosen in the model menu when orchestration is enabled.
    pub behavior: String,
    pub now_ms: i64,
    ticks: u32,
    pub client: Option<Client>,
    pub handle: Option<AppHandle<App>>,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

impl App {
    pub fn new(handle: Option<AppHandle<App>>) -> App {
        App {
            sidebar: PaneState::new(272.0).range(220.0, 480.0),
            theme: None,
            route: Route::Overview,
            conn: Conn::Offline,
            server: String::new(),
            version: String::new(),
            projects: Vec::new(),
            sessions: Vec::new(),
            loaded: false,
            open: None,
            composer: TextEdit::new(""),
            search_open: false,
            search: TextEdit::new(""),
            collapsed: HashSet::new(),
            project_name: TextEdit::new(""),
            project_dir: TextEdit::new(""),
            notice: None,
            busy: false,
            model: None,
            orchestration: false,
            behavior: "direct".to_owned(),
            now_ms: now_ms(),
            ticks: 0,
            client: None,
            handle,
        }
    }

    /// Runs `work` on a worker thread and `done` with its answer on the UI thread.
    fn spawn<T: Send + 'static>(&self, work: impl FnOnce(&Client) -> T + Send + 'static, done: impl FnOnce(&mut App, T) + Send + 'static) {
        let (Some(client), Some(handle)) = (self.client.clone(), self.handle.clone()) else { return };
        std::thread::spawn(move || {
            let out = work(&client);
            handle.update(move |s, _| done(s, out));
        });
    }

    pub fn connected(&mut self, url: &str, version: String) {
        self.client = Some(Client::new(url));
        self.server = url.to_owned();
        self.version = version;
        self.conn = Conn::Ready;
        // The server reads its policy once at startup, so one request is enough.
        self.spawn(Client::orchestration_enabled, |s, enabled| {
            s.orchestration = enabled;
            s.refresh();
        });
    }

    pub fn set_lists(&mut self, projects: Vec<Project>, mut sessions: Vec<ManagedSession>) {
        if !self.orchestration {
            sessions.retain(|m| m.summary.behavior == "direct" && m.lineage.as_ref().is_none_or(|l| l.kind != "managed-orchestrator"));
        }
        self.projects = projects;
        self.sessions = sessions;
        self.loaded = true;
    }

    /// `GET /projects` and `GET /sessions`.
    pub fn refresh(&mut self) {
        self.spawn(
            |c| c.projects().and_then(|p| c.sessions().map(|s| (p, s))),
            |s, lists| match lists {
                Ok((projects, sessions)) => s.set_lists(projects, sessions),
                Err(e) if !s.loaded => s.notice = Some(e),
                // A later poll failing is the server restarting or busy; the next one says.
                Err(_) => {}
            },
        );
    }

    /// Once a second from the ticker thread. Returns whether anything on screen changed.
    pub fn tick(&mut self) -> bool {
        self.ticks = self.ticks.wrapping_add(1);
        if self.conn == Conn::Ready && self.ticks.is_multiple_of(5) {
            self.refresh();
        }
        let running = self.open.as_ref().is_some_and(|o| o.running) || self.sessions.iter().any(|m| m.active_run.is_some());
        // Elapsed timers tick each second; relative times only need the minute.
        if running || self.ticks.is_multiple_of(30) {
            self.now_ms = now_ms();
            return true;
        }
        false
    }

    pub fn go_overview(&mut self) {
        self.route = Route::Overview;
        self.open = None;
    }

    pub fn open_session(&mut self, id: &str) {
        if self.open.as_ref().is_none_or(|o| o.id != id) {
            self.open = Some(OpenSession::new(id));
            self.composer = TextEdit::new("");
            self.composer.focused = true;
            self.load_snapshot();
            let id = id.to_owned();
            self.spawn(move |c| c.permissions(&id), |s, requests| {
                if let Some(o) = &mut s.open {
                    o.permissions = requests;
                }
            });
        }
        self.route = Route::Session(id.to_owned());
    }

    /// `GET /sessions/{id}` for the open session. Requests made while one is in flight collapse
    /// into one more after it lands.
    fn load_snapshot(&mut self) {
        let Some(o) = &mut self.open else { return };
        if o.fetching {
            o.refetch = true;
            return;
        }
        o.fetching = true;
        let id = o.id.clone();
        let wanted = id.clone();
        self.spawn(
            move |c| c.snapshot(&id),
            move |s, snapshot| {
                let Some(o) = s.open.as_mut().filter(|o| o.id == wanted) else { return };
                o.fetching = false;
                match snapshot {
                    Ok(snapshot) => s.apply_snapshot(snapshot),
                    Err(e) => {
                        o.loading = false;
                        o.error = Some(e);
                    }
                }
                if s.open.as_mut().is_some_and(|o| std::mem::take(&mut o.refetch)) {
                    s.load_snapshot();
                }
            },
        );
    }

    pub fn apply_snapshot(&mut self, snapshot: Snapshot) {
        let now = self.now_ms;
        let Some(o) = &mut self.open else { return };
        o.loading = false;
        o.error = None;
        o.model = snapshot.metadata.model;
        o.project_id = snapshot.metadata.project_id;
        o.items = transcript::items(&snapshot.messages);
        match &snapshot.active_run {
            Some(run) => {
                o.running = true;
                o.run_started_ms = Some(run.started_at_epoch_ms).filter(|ms| *ms > 0).or(o.run_started_ms).or(Some(now));
                if let Some(sent) = &run.submitted_user_message {
                    o.pending_user = Some(sent.content.clone());
                }
            }
            None => {
                o.running = false;
                o.run_started_ms = None;
                o.clear_live();
                o.pending_user = None;
            }
        }
        if let Some(f) = snapshot.run_failure {
            o.failure = Some((f.summary, f.diagnostic));
        } else if o.running {
            o.failure = None;
        }
        // Stored calls take over from the live copies of the same calls.
        let stored: HashSet<&str> = o.items.iter().filter_map(|i| if let Item::Tool(t) = i { Some(t.call_id.as_str()) } else { None }).collect();
        let finished: Vec<(String, ToolStatus, Option<String>)> =
            o.live_tools.iter().filter(|t| stored.contains(t.call_id.as_str())).map(|t| (t.call_id.clone(), t.status, t.output.clone())).collect();
        for item in &mut o.items {
            if let Item::Tool(t) = item
                && t.output.is_none()
            {
                match finished.iter().find(|f| f.0 == t.call_id) {
                    Some((_, status, output)) => (t.status, t.output) = (*status, output.clone()),
                    None => t.status = if o.running { ToolStatus::Running } else { ToolStatus::Done },
                }
            }
        }
        o.live_tools.retain(|t| !finished.iter().any(|f| f.0 == t.call_id));
        if o.stream_stop.is_none() {
            self.start_stream(snapshot.thread_event_boundary);
        }
    }

    /// The event stream for the open session, resuming after the snapshot's boundary so no
    /// event between the snapshot and the connection is lost.
    fn start_stream(&mut self, boundary: Boundary) {
        let (Some(client), Some(handle), Some(o)) = (self.client.clone(), self.handle.clone(), self.open.as_mut()) else { return };
        let stop = Arc::new(AtomicBool::new(false));
        o.stream_stop = Some(stop.clone());
        let id = o.id.clone();
        std::thread::spawn(move || {
            let deliver = |msg: Msg| {
                let (id, token) = (id.clone(), stop.clone());
                handle.update(move |s, _| s.on_stream(&id, &token, msg));
            };
            stream::run(&client, &id, Some(boundary), &stop, &deliver);
        });
    }

    fn on_stream(&mut self, id: &str, token: &Arc<AtomicBool>, msg: Msg) {
        let Some(o) = self.open.as_mut().filter(|o| o.id == id && o.stream_stop.as_ref().is_some_and(|t| Arc::ptr_eq(t, token))) else { return };
        match msg {
            Msg::Link(link) => o.link = link,
            Msg::Resync => self.load_snapshot(),
            Msg::Delta(delta) => {
                // Worker threads' output belongs to their own transcripts.
                if !delta["thread_name"].is_null() {
                    return;
                }
                if delta["reset"].as_bool() == Some(true) {
                    o.stream_text.clear();
                    o.stream_reasoning.clear();
                }
                if let Some(t) = delta["text"].as_str() {
                    o.stream_text.push_str(t);
                }
                if let Some(t) = delta["reasoning"].as_str() {
                    o.stream_reasoning.push_str(t);
                }
            }
            Msg::Event(event) => self.on_event(&event),
        }
    }

    /// One `SessionEvent` for the open session.
    pub fn on_event(&mut self, event: &Value) {
        let now = self.now_ms;
        let Some(o) = &mut self.open else { return };
        let mut lists = false;
        match event["type"].as_str().unwrap_or_default() {
            "run_started" => {
                o.running = true;
                o.run_started_ms = event["started_at_epoch_ms"].as_i64().or(Some(now));
                o.failure = None;
                o.clear_live();
                if let Some(sent) = event["submitted_user_message"]["content"].as_str() {
                    o.pending_user = Some(sent.to_owned());
                }
                lists = true;
            }
            "run_completed" => {
                o.running = false;
                // The run's own answer stands in until the snapshot stores it.
                if let Some(response) = event["response"].as_str() {
                    o.stream_text = response.to_owned();
                }
                lists = true;
            }
            "run_failed" => {
                o.running = false;
                let failure = &event["failure"];
                let summary = failure["summary"].as_str().or(event["message"].as_str()).unwrap_or("The run failed.");
                o.failure = Some((summary.to_owned(), failure["diagnostic"].as_str().unwrap_or_default().to_owned()));
                lists = true;
            }
            "run_cancelled" => {
                o.running = false;
                lists = true;
            }
            "transcript_appended" => {
                // A message was stored, so the streamed copy of it describes the past.
                o.stream_text.clear();
                o.stream_reasoning.clear();
            }
            "transcript_reverted" => o.clear_live(),
            "snapshot_saved" => {}
            "permission_asked" => {
                if let Ok(request) = serde_json::from_value::<PermissionRequest>(event["request"].clone())
                    && !o.permissions.iter().any(|p| p.id == request.id)
                {
                    o.permissions.push(request);
                }
                return;
            }
            "permission_replied" | "permission_dismissed" => {
                let id = event["request_id"].as_str().unwrap_or_default();
                o.permissions.retain(|p| p.id != id);
                return;
            }
            "agent" => {
                let agent = &event["event"];
                if !agent["thread_name"].is_null() {
                    return;
                }
                let text = |key: &str| agent[key].as_str().unwrap_or_default().to_owned();
                match agent["type"].as_str().unwrap_or_default() {
                    "tool_call_started" => {
                        let call_id = text("call_id");
                        let stored = o.items.iter_mut().any(|i| matches!(i, Item::Tool(t) if t.call_id == call_id));
                        if !stored && !o.live_tools.iter().any(|t| t.call_id == call_id) {
                            let args = agent["args_detail"].as_str().unwrap_or(agent["args_preview"].as_str().unwrap_or_default());
                            let target = agent["key_arg_preview"].as_str().map(str::to_owned).unwrap_or_else(|| transcript::target(args));
                            o.live_tools.push(Tool { call_id, name: text("name"), target, args: args.to_owned(), output: None, status: ToolStatus::Running });
                        }
                    }
                    "tool_call_finished" => {
                        let call_id = text("call_id");
                        let status = if agent["is_error"].as_bool() == Some(true) { ToolStatus::Failed } else { ToolStatus::Done };
                        let stored = o.items.iter_mut().filter_map(|i| if let Item::Tool(t) = i { Some(t) } else { None });
                        if let Some(t) = stored.chain(o.live_tools.iter_mut()).find(|t| t.call_id == call_id) {
                            t.status = status;
                            if t.output.is_none() {
                                t.output = Some(text("content_preview"));
                            }
                        }
                    }
                    _ => {}
                }
                return;
            }
            _ => return,
        }
        self.load_snapshot();
        if lists {
            self.refresh();
        }
    }

    /// `POST /sessions/{id}/runs` with the composer's text.
    pub fn send(&mut self) {
        let Some(o) = &mut self.open else { return };
        let prompt = self.composer.text.trim().to_owned();
        if prompt.is_empty() || o.running || o.loading {
            return;
        }
        self.composer.clear();
        o.pending_user = Some(prompt.clone());
        o.failure = None;
        let id = o.id.clone();
        self.spawn(
            move |c| c.submit(&id, &prompt).map_err(|e| (e, prompt)),
            |s, sent| {
                if let Err((e, prompt)) = sent {
                    s.notice = Some(format!("The message was not sent. {e}"));
                    if let Some(o) = &mut s.open {
                        o.pending_user = None;
                    }
                    // Hand the text back rather than lose it.
                    if s.composer.text.is_empty() {
                        s.composer.replace_text(prompt);
                    }
                }
            },
        );
    }

    /// `POST /sessions/{id}/cancel-active-run`.
    pub fn stop_run(&mut self) {
        let Some(id) = self.open.as_ref().map(|o| o.id.clone()) else { return };
        self.spawn(move |c| c.cancel(&id), |s, r| {
            if let Err(e) = r {
                s.notice = Some(format!("The run was not stopped. {e}"));
            }
        });
    }

    /// `POST /sessions/{id}/permissions/{request_id}`.
    pub fn reply_permission(&mut self, request: &str, approve: bool) {
        let Some(id) = self.open.as_ref().map(|o| o.id.clone()) else { return };
        let request = request.to_owned();
        let replied = request.clone();
        self.spawn(move |c| c.reply_permission(&id, &request, approve), move |s, r| match r {
            Ok(()) => {
                if let Some(o) = &mut s.open {
                    o.permissions.retain(|p| p.id != replied);
                }
            }
            Err(e) => s.notice = Some(format!("The reply was not delivered. {e}")),
        });
    }

    /// A new session in `project`, or in the open session's project, or in the first one. Asks
    /// for its behavior and model in a menu at `anchor`.
    pub fn new_session(&mut self, project: Option<&str>, anchor: impl Into<PopupAnchor>) {
        let project = project
            .map(str::to_owned)
            .or_else(|| self.open.as_ref().and_then(|o| o.project_id.clone()))
            .or_else(|| self.projects.first().map(|p| p.project_id.clone()));
        let Some(project) = project else {
            // No project yet: Overview's empty state creates one.
            self.go_overview();
            return;
        };
        let (Some(client), Some(handle)) = (self.client.clone(), self.handle.clone()) else { return };
        if self.busy {
            return;
        }
        self.busy = true;
        let anchor = anchor.into();
        // Not `spawn`: opening the menu needs the update's `Tx`.
        std::thread::spawn(move || {
            let providers = client.models();
            handle.update(move |s, tx| s.pick_model(project, providers, anchor, tx));
        });
    }

    /// The model menu: each provider that has a credential and its models, under a submenu for
    /// the session's behavior when the server enables orchestration.
    fn pick_model(&mut self, project: String, providers: Result<Vec<Provider>, String>, anchor: PopupAnchor, tx: &mut Tx) {
        self.busy = false;
        let providers = match providers {
            Ok(providers) => providers,
            Err(e) => {
                self.notice = Some(format!("The session was not created. {e}"));
                return;
            }
        };
        // One model, or a platform without native menus: there is nothing to ask.
        if !popup_menu_supported() || matches!(providers.as_slice(), [only] if only.models.len() == 1) {
            return self.create_session(project, providers[0].id.clone(), providers[0].models[0].id.clone());
        }
        let mut menu = PopupMenu::new();
        if self.orchestration {
            let mut behaviors = PopupMenu::new();
            let mut current = "";
            for (id, label) in BEHAVIORS {
                let checked = self.behavior == id;
                if checked {
                    current = label;
                }
                behaviors = behaviors.item(PopupItem::new(format!("behavior {id}"), label).checked(checked));
            }
            menu = menu.submenu(current, behaviors);
        }
        for (i, provider) in providers.iter().enumerate() {
            if self.orchestration || i > 0 {
                menu = menu.separator();
            }
            menu = menu.item(PopupItem::new(format!("provider {}", provider.id), provider.id.clone()).enabled(false));
            for model in &provider.models {
                let checked = self.model.as_ref().is_some_and(|(b, m)| *b == provider.id && *m == model.id);
                // Backend ids have no space, so the id splits back into the pair.
                let id = format!("{} {}", provider.id, model.id);
                menu = menu.item(PopupItem::new(id, model.display_name.clone().unwrap_or_else(|| model.id.clone())).checked(checked));
            }
        }
        tx.popup_menu(menu, anchor.clone(), move |s: &mut App, picked, tx| match picked.and_then(|id| id.split_once(' ')) {
            // A behavior only changes what the next pick creates, so the menu opens again.
            Some(("behavior", behavior)) => {
                s.behavior = behavior.to_owned();
                s.pick_model(project, Ok(providers), anchor, tx);
            }
            Some((backend, model)) => s.create_session(project, backend.to_owned(), model.to_owned()),
            None => {}
        });
    }

    fn create_session(&mut self, project: String, backend: String, model: String) {
        self.busy = true;
        self.model = Some((backend.clone(), model.clone()));
        let behavior = if self.orchestration { self.behavior.clone() } else { "direct".to_owned() };
        self.spawn(move |c| c.create_session(&project, &behavior, &backend, &model), |s, created| {
            s.busy = false;
            match created {
                Ok(id) => {
                    s.refresh();
                    s.open_session(&id);
                }
                Err(e) => s.notice = Some(format!("The session was not created. {e}")),
            }
        });
    }

    /// `POST /projects` from the empty state's form.
    pub fn create_project(&mut self) {
        let cwd = self.project_dir.text.trim().to_owned();
        let mut name = self.project_name.text.trim().to_owned();
        if cwd.is_empty() || self.busy {
            return;
        }
        if name.is_empty() {
            name = cwd.trim_end_matches('/').rsplit('/').next().unwrap_or("project").to_owned();
        }
        self.busy = true;
        self.spawn(move |c| c.create_project(&name, &cwd), |s, created| {
            s.busy = false;
            match created {
                Ok(_) => {
                    s.project_name.clear();
                    s.project_dir.clear();
                    s.refresh();
                }
                Err(e) => s.notice = Some(format!("The project was not created. {e}")),
            }
        });
    }

    pub fn toggle_search(&mut self) {
        self.search_open = !self.search_open;
        self.search = TextEdit::new("");
        self.search.focused = self.search_open;
    }

    pub fn toggle_project(&mut self, id: &str) {
        if !self.collapsed.remove(id) {
            self.collapsed.insert(id.to_owned());
        }
    }

    pub fn toggle_expanded(&mut self, key: &str) {
        if let Some(o) = &mut self.open
            && !o.expanded.remove(key)
        {
            o.expanded.insert(key.to_owned());
        }
    }

    pub fn project_name_of(&self, id: Option<&str>) -> &str {
        id.and_then(|id| self.projects.iter().find(|p| p.project_id == id)).map_or("No project", |p| p.name.as_str())
    }

    /// The sessions the sidebar and Overview list: all of them, newest first, narrowed by the
    /// search field when it is open.
    pub fn visible_sessions(&self) -> Vec<&ManagedSession> {
        let query = if self.search_open { self.search.text.trim().to_lowercase() } else { String::new() };
        let mut out: Vec<&ManagedSession> = self.sessions.iter().filter(|m| query.is_empty() || title(m).to_lowercase().contains(&query)).collect();
        out.sort_by(|a, b| b.summary.updated_at.cmp(&a.summary.updated_at));
        out
    }
}

/// A session's title: the stored one, else the first line of its last prompt.
pub fn title(m: &ManagedSession) -> String {
    let s = &m.summary;
    s.title
        .as_deref()
        .or(s.last_user_prompt.as_deref())
        .map(|t| t.trim().lines().next().unwrap_or_default().to_owned())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "New session".to_owned())
}

/// The server's `YYYY-MM-DD HH:MM:SS[.fraction]` (UTC) as milliseconds since the epoch.
pub fn parse_utc(stamp: &str) -> Option<i64> {
    let (date, time) = stamp.trim().split_once([' ', 'T'])?;
    let mut d = date.split('-').map(str::parse::<i64>);
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let clock = time.trim_end_matches('Z').split('.').next()?;
    let mut t = clock.split(':').map(str::parse::<i64>);
    let (h, min, sec) = (t.next()?.ok()?, t.next()?.ok()?, t.next().and_then(Result::ok).unwrap_or(0));
    // Days from civil (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some((days * 86_400 + h * 3_600 + min * 60 + sec) * 1_000)
}

/// "now", "5m", "2h", "3d" or "6w".
pub fn relative(now_ms: i64, stamp: &str) -> String {
    let Some(then) = parse_utc(stamp) else { return String::new() };
    let minutes = (now_ms - then).max(0) / 60_000;
    match minutes {
        0 => "now".into(),
        1..60 => format!("{minutes}m"),
        60..1_440 => format!("{}h", minutes / 60),
        1_440..20_160 => format!("{}d", minutes / 1_440),
        _ => format!("{}w", minutes / 10_080),
    }
}

/// "42s" or "3m 05s".
pub fn elapsed(now_ms: i64, started_ms: i64) -> String {
    let seconds = (now_ms - started_ms).max(0) / 1_000;
    if seconds < 60 { format!("{seconds}s") } else { format!("{}m {:02}s", seconds / 60, seconds % 60) }
}
