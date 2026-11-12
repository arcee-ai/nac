//! What the open session can be told: messages while it runs, answers to its questions, permission
//! replies, its approval mode, and its model and effort between runs.
//!
//! Questions, the inbox and subagents have no session events, so [`App::poll`] asks for them.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rune::{PopupAnchor, PopupItem, PopupMenu, Tx};
use serde_json::{Value, json};

use crate::api::{Child, Client, InboxItem, PermissionRequest, PermissionState, Provider, ProviderModel, Question};
use crate::state::{App, menus};
use crate::stream;

/// The approval modes of a direct session, labelled for the mode menu. `auto_approve` answers
/// ordinary requests for the session and its subagents; denials the server holds still apply.
pub const MODES: [(&str, &str); 3] = [("manual", "Manual"), ("auto_approve", "Full access"), ("review", "Approve for me")];
/// The efforts offered when the catalog does not list a model's.
const EFFORTS: [&str; 7] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
/// The longest answer the server takes.
pub const ANSWER_LIMIT: usize = 4_000;
const NO_MENUS: &str = "Menus need macOS or Windows.";

pub fn mode_label(mode: &str) -> &'static str {
    MODES.iter().find(|(id, _)| *id == mode).map_or("Manual", |(_, label)| label)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SendRoute {
    /// `POST /runs`: the session is idle.
    Run,
    /// `POST /inbox` with this delivery: a direct session is running.
    Inbox(&'static str),
    /// `POST /steering`: an orchestrator session is running.
    Steering,
}

/// Where the composer's text goes, as the web client's `deliverPrompt` decides it.
pub fn send_route(direct: bool, running: bool, queue: bool) -> SendRoute {
    match (running, direct) {
        (false, _) => SendRoute::Run,
        (true, true) => SendRoute::Inbox(if queue { "queue" } else { "steer" }),
        (true, false) => SendRoute::Steering,
    }
}

/// The `PATCH /config` body that moves a session on `backend` to `model`, as the web client's
/// model picker builds it. The effort carries over only when the new model takes it.
pub fn model_patch(backend: &str, effort: Option<&str>, provider: &Provider, model: &ProviderModel) -> Result<Value, String> {
    let effort = effort.filter(|e| model.supported_efforts.iter().any(|s| s == e));
    if provider.id == backend {
        return Ok(json!({ "model": model.id, "reasoning_effort": effort }));
    }
    let connection = provider.connection.as_ref();
    let base_url = [connection.map(|c| c.base_url.as_str()), provider.managed_base_url.as_deref(), provider.default_base_url.as_deref()].into_iter().flatten().find(|url| !url.is_empty());
    let Some(base_url) = base_url else { return Err(format!("{} has no address yet. Set one in the web client.", provider.id)) };
    Ok(json!({
        "backend": provider.id,
        "model": model.id,
        "base_url": base_url,
        "api_key_env": connection.and_then(|c| c.api_key_env.clone()),
        "reasoning_effort": effort,
        "extra_headers": null,
    }))
}

/// One poll's answers; `None` is a request that failed, which leaves what is shown alone.
struct Polled {
    own: Option<PermissionState>,
    questions: Option<Vec<Question>>,
    inbox: Option<Vec<InboxItem>>,
    children: Option<Vec<Child>>,
    child_requests: Vec<PermissionRequest>,
}

fn ask(c: &Client, id: &str, direct: bool) -> Polled {
    let children = c.children(id).ok();
    // A running subagent's requests are answered here, in its parent.
    let running = children.iter().flatten().filter(|k| k.status == "running");
    let child_requests = running.flat_map(|k| c.permissions(&k.child_session_id).map(|p| p.requests).unwrap_or_default()).collect();
    Polled { own: c.permissions(id).ok(), questions: c.questions(id).ok(), inbox: if direct { c.inbox(id).ok() } else { None }, children, child_requests }
}

/// A session's backend, model and effort.
type Config = (String, String, Option<String>);

impl App {
    /// Asks what the open session is waiting on: permission requests (its own and its running
    /// subagents'), questions, undelivered messages and subagents. A call while one is in flight
    /// makes that one's answer stale: it is dropped and asked again.
    pub fn poll(&mut self) {
        let Some(o) = &mut self.open else { return };
        if o.polling {
            o.repoll = true;
            return;
        }
        o.polling = true;
        let (id, direct) = (o.id.clone(), o.direct());
        let wanted = id.clone();
        self.spawn(move |c| ask(c, &id, direct), move |s, p| {
            let Some(o) = s.open.as_mut().filter(|o| o.id == wanted) else { return };
            o.polling = false;
            if std::mem::take(&mut o.repoll) {
                return s.poll();
            }
            // Orchestrator sessions answer 400 for their own list; events keep it instead.
            let mut requests = match p.own {
                Some(state) => {
                    o.approval_mode = state.approval_mode;
                    state.requests
                }
                None => std::mem::take(&mut o.permissions).into_iter().filter(|r| r.session_id == o.id).collect(),
            };
            requests.extend(p.child_requests);
            o.permissions = requests;
            if let Some(questions) = p.questions {
                o.questions = questions;
            }
            if let Some(inbox) = p.inbox {
                o.inbox = inbox;
            }
            if let Some(children) = p.children {
                o.children = children;
            }
            s.hold_child_streams();
        });
    }

    /// The server refuses a subagent's permission request after five seconds unless a client
    /// holds that subagent's event stream, so each running one's is held while its parent is open.
    fn hold_child_streams(&mut self) {
        let (Some(client), Some(o)) = (self.client.clone(), self.open.as_mut()) else { return };
        let running: Vec<&str> = o.children.iter().filter(|k| k.status == "running").map(|k| k.child_session_id.as_str()).collect();
        o.child_streams.retain(|id, stop| {
            let keep = running.contains(&id.as_str());
            stop.store(!keep, Ordering::Relaxed);
            keep
        });
        for id in running {
            if o.child_streams.contains_key(id) {
                continue;
            }
            let stop = Arc::new(AtomicBool::new(false));
            o.child_streams.insert(id.to_owned(), stop.clone());
            let (client, id) = (client.clone(), id.to_owned());
            // Only the connection matters: the poll reads the requests themselves.
            std::thread::spawn(move || stream::run(&client, &id, None, &stop, &|_| {}));
        }
    }

    /// Sends the composer's text: a new run when the session is idle, else a message for the
    /// running one (`queue` holds it for the next run instead of steering this one).
    pub fn send(&mut self, queue: bool) {
        let Some(o) = &mut self.open else { return };
        let prompt = self.composer.text.trim().to_owned();
        if prompt.is_empty() || o.loading {
            return;
        }
        let route = send_route(o.direct(), o.running, queue);
        self.composer.clear();
        if route == SendRoute::Run {
            o.pending_user = Some(prompt.clone());
            o.failure = None;
        }
        let id = o.id.clone();
        self.spawn(
            move |c| {
                let sent = match route {
                    SendRoute::Run => c.submit(&id, &prompt),
                    SendRoute::Inbox(delivery) => c.add_inbox(&id, delivery, &prompt),
                    SendRoute::Steering => c.steer(&id, &prompt),
                };
                sent.map_err(|e| (e, prompt))
            },
            move |s, sent| {
                if let Err((e, prompt)) = sent {
                    s.notice = Some(format!("The message was not sent. {e}"));
                    if let Some(o) = s.open.as_mut().filter(|_| route == SendRoute::Run) {
                        o.pending_user = None;
                    }
                    // Hand the text back rather than lose it.
                    if s.composer.text.is_empty() {
                        s.composer.replace_text(prompt);
                    }
                }
                s.poll();
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

    /// Replies `once`, `always` or `reject` to a request, on the session that asked.
    pub fn reply_permission(&mut self, request: &str, reply: &'static str) {
        let Some(session) = self.open.as_ref().and_then(|o| o.permissions.iter().find(|p| p.id == request)).map(|p| p.session_id.clone()) else { return };
        let request = request.to_owned();
        let replied = request.clone();
        self.spawn(move |c| c.reply_permission(&session, &request, reply), move |s, r| {
            match r {
                Ok(()) => {
                    if let Some(o) = &mut s.open {
                        o.permissions.retain(|p| p.id != replied);
                    }
                }
                Err(e) => s.notice = Some(format!("The reply was not delivered. {e}")),
            }
            s.poll();
        });
    }

    /// `PUT /sessions/{id}/permissions/mode` for the open session.
    pub fn set_mode(&mut self, mode: &str) {
        let Some(id) = self.open.as_ref().map(|o| o.id.clone()) else { return };
        let mode = mode.to_owned();
        self.spawn(move |c| c.set_approval_mode(&id, &mode).map(|()| (id, mode)), |s, set| {
            match set {
                Ok((id, mode)) => {
                    // Another session may have been opened meanwhile; its mode is its own.
                    if let Some(o) = s.open.as_mut().filter(|o| o.id == id) {
                        o.approval_mode = mode;
                    }
                }
                Err(e) => s.notice = Some(format!("The approval mode was not changed. {e}")),
            }
            // Full access also answers the requests already waiting.
            s.poll();
        });
    }

    pub fn mode_menu(&mut self, tx: &mut Tx) {
        let Some(o) = &self.open else { return };
        if !menus() {
            return self.notice = Some(NO_MENUS.to_owned());
        }
        tx.popup_menu(PopupMenu::picker(MODES, &o.approval_mode), "mode", |s: &mut App, picked, _| {
            if let Some(mode) = picked {
                s.set_mode(mode);
            }
        });
    }

    /// Answers the first pending question with the answer field's text.
    pub fn answer_question(&mut self) {
        let Some((id, question)) = self.open.as_ref().and_then(|o| Some((o.id.clone(), o.questions.first()?.clone()))) else { return };
        let answer = self.answer.text.trim().to_owned();
        if answer.is_empty() || answer.chars().count() > ANSWER_LIMIT {
            return;
        }
        self.spawn(move |c| c.answer_question(&id, &question, &answer).map(|()| question), |s, r| s.question_settled(r, "The answer was not sent."));
    }

    /// Cancels the first pending question; the agent goes on without an answer.
    pub fn cancel_question(&mut self) {
        let Some((id, question)) = self.open.as_ref().and_then(|o| Some((o.id.clone(), o.questions.first()?.clone()))) else { return };
        self.spawn(move |c| c.cancel_question(&id, &question).map(|()| question), |s, r| s.question_settled(r, "The question was not cancelled."));
    }

    fn question_settled(&mut self, settled: Result<Question, String>, failure: &str) {
        match settled {
            Ok(done) => {
                self.answer.clear();
                if let Some(o) = &mut self.open {
                    o.questions.retain(|q| q.request.request_id != done.request.request_id);
                }
            }
            Err(e) => self.notice = Some(format!("{failure} {e}")),
        }
        self.poll();
    }

    /// Switches a waiting message between steering this run and waiting for the next.
    pub fn toggle_inbox(&mut self, item: i64) {
        let Some((id, item)) = self.open.as_ref().and_then(|o| Some((o.id.clone(), o.inbox.iter().find(|i| i.id == item)?.clone()))) else { return };
        let delivery = if item.delivery == "queue" { "steer" } else { "queue" };
        self.spawn(move |c| c.set_inbox_delivery(&id, &item, delivery), |s, r| s.inbox_settled(r));
    }

    /// Withdraws a waiting message.
    pub fn cancel_inbox(&mut self, item: i64) {
        let Some((id, item)) = self.open.as_ref().and_then(|o| Some((o.id.clone(), o.inbox.iter().find(|i| i.id == item)?.clone()))) else { return };
        self.spawn(move |c| c.cancel_inbox(&id, &item), |s, r| s.inbox_settled(r));
    }

    fn inbox_settled(&mut self, settled: Result<(), String>) {
        // A refusal is usually a message delivered in the meantime; the poll shows which.
        if let Err(e) = settled {
            self.notice = Some(format!("The message was not changed. {e}"));
        }
        self.poll();
    }

    /// The open session's model menu: every provider with a credential and its models.
    pub fn model_menu(&mut self, tx: &mut Tx) {
        self.config_menu(tx, "model", |o, providers| {
            let mut menu = PopupMenu::new();
            for (i, provider) in providers.iter().enumerate() {
                if i > 0 {
                    menu = menu.separator();
                }
                menu = menu.item(PopupItem::new(format!("provider {}", provider.id), provider.id.clone()).enabled(false));
                for model in &provider.models {
                    // Backend ids have no space, so the id splits back into the pair.
                    let item = PopupItem::new(format!("{} {}", provider.id, model.id), model.display_name.clone().unwrap_or_else(|| model.id.clone()));
                    menu = menu.item(item.checked(provider.id == o.0 && model.id == o.1));
                }
            }
            menu
        });
    }

    /// The open session's effort menu: the model's efforts, and Default for none in particular.
    pub fn effort_menu(&mut self, tx: &mut Tx) {
        self.config_menu(tx, "effort", |o, providers| {
            let listed = providers.iter().filter(|p| p.id == o.0).flat_map(|p| &p.models).find(|m| m.id == o.1).map(|m| m.supported_efforts.clone()).unwrap_or_default();
            let efforts = if listed.is_empty() { EFFORTS.map(str::to_owned).to_vec() } else { listed };
            let options = std::iter::once(("effort default".to_owned(), "Default".to_owned())).chain(efforts.into_iter().map(|e| (format!("effort {e}"), e)));
            PopupMenu::picker(options, &format!("effort {}", o.2.as_deref().unwrap_or("default")))
        });
    }

    /// Fetches the providers, opens the menu `build` makes of them at `anchor`, and patches the
    /// open session's configuration with the pick. `build` gets the session's backend, model
    /// and effort.
    fn config_menu(&mut self, tx: &mut Tx, anchor: &'static str, build: fn(&Config, &[Provider]) -> PopupMenu) {
        let Some(o) = &self.open else { return };
        if !menus() {
            return self.notice = Some(NO_MENUS.to_owned());
        }
        let now = (o.backend.clone(), o.model.clone(), o.effort.clone());
        self.spawn_tx(tx, Client::models, move |s, providers, tx| {
            let providers = match providers {
                Ok(providers) => providers,
                Err(e) => return s.notice = Some(e),
            };
            tx.popup_menu(build(&now, &providers), PopupAnchor::from(anchor), move |s: &mut App, picked, _| {
                let patch = match picked.and_then(|id| id.split_once(' ')) {
                    Some(("effort", level)) => Ok(json!({ "reasoning_effort": if level == "default" { None } else { Some(level) } })),
                    Some((backend, model)) => match providers.iter().find(|p| p.id == backend).and_then(|p| Some((p, p.models.iter().find(|m| m.id == model)?))) {
                        Some((provider, picked)) => {
                            s.set_model(backend, model);
                            model_patch(&now.0, now.2.as_deref(), provider, picked)
                        }
                        None => return,
                    },
                    None => return,
                };
                match patch {
                    Ok(patch) => s.patch_config(patch),
                    Err(e) => s.notice = Some(format!("The model was not changed. {e}")),
                }
            });
        });
    }

    /// `PATCH /sessions/{id}/config`, then the snapshot and lists that show the result.
    fn patch_config(&mut self, patch: Value) {
        let Some(id) = self.open.as_ref().map(|o| o.id.clone()) else { return };
        self.spawn(move |c| c.patch_config(&id, &patch), |s, r| match r {
            Ok(()) => {
                s.load_snapshot();
                s.refresh();
            }
            Err(e) => s.notice = Some(format!("The session was not changed. {e}")),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Connection;

    #[test]
    fn a_running_session_is_steered_or_queued_and_an_idle_one_starts_a_run() {
        assert_eq!(send_route(true, false, true), SendRoute::Run);
        assert_eq!(send_route(true, true, false), SendRoute::Inbox("steer"));
        assert_eq!(send_route(true, true, true), SendRoute::Inbox("queue"));
        // An orchestrator session has no inbox: Queue Next has nothing to queue into.
        assert_eq!(send_route(false, true, true), SendRoute::Steering);
    }

    #[test]
    fn a_model_patch_names_the_backend_only_when_it_changes() {
        let model = ProviderModel { id: "m2".into(), supported_efforts: vec!["low".into(), "high".into()], ..Default::default() };
        let connection = Connection { base_url: String::new(), api_key_env: Some("KEY".into()) };
        let mut provider = Provider::default();
        provider.id = "b".into();
        provider.connection = Some(connection);
        provider.default_base_url = Some("https://b.example/v1".into());

        // Same backend: the model, and the effort only because the new model takes it.
        assert_eq!(model_patch("b", Some("high"), &provider, &model).unwrap(), json!({ "model": "m2", "reasoning_effort": "high" }));
        assert_eq!(model_patch("b", Some("max"), &provider, &model).unwrap(), json!({ "model": "m2", "reasoning_effort": null }));
        // Another backend: its connection too, with the first address that is not empty.
        assert_eq!(
            model_patch("a", None, &provider, &model).unwrap(),
            json!({ "backend": "b", "model": "m2", "base_url": "https://b.example/v1", "api_key_env": "KEY", "reasoning_effort": null, "extra_headers": null })
        );
        provider.default_base_url = None;
        assert!(model_patch("a", None, &provider, &model).is_err());
    }
}
