//! Blocking HTTP client for the `nac-web` API. Every call here runs on a worker thread; results
//! reach the UI thread through `AppHandle::update` (see `App::spawn` in `state.rs`).
//!
//! The contract is `crates/nac-server/web/openapi.json`. Only the fields the app draws are
//! decoded, and every optional field defaults, so a newer server with more fields still loads.

use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

#[derive(Clone)]
pub struct Client {
    pub base: String,
    agent: ureq::Agent,
    stream_agent: ureq::Agent,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Project {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub cwd: String,
}

#[derive(Deserialize)]
struct ProjectsResponse {
    projects: Vec<Project>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct SessionSummary {
    pub session_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub behavior: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub last_user_prompt: Option<String>,
    #[serde(default)]
    pub updated_at: String,
    /// The revision `PUT /sessions/{id}/presentation` checks.
    #[serde(default)]
    pub presentation_version: i64,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct SubmittedUserMessage {
    #[serde(default)]
    pub content: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ActiveRun {
    #[serde(default)]
    pub started_at_epoch_ms: i64,
    #[serde(default)]
    pub submitted_user_message: Option<SubmittedUserMessage>,
}

/// One entry of `GET /sessions`. `active` is true for every loaded session, so "running" is
/// `active_run.is_some()`.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct ManagedSession {
    pub summary: SessionSummary,
    #[serde(default)]
    pub active_run: Option<ActiveRun>,
    /// Set on delegated sessions: `traditional-child` or `managed-orchestrator`.
    #[serde(default)]
    pub lineage: Option<Lineage>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Lineage {
    pub kind: String,
    #[serde(default)]
    pub parent_session_id: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Deserialize)]
struct UiConfig {
    orchestration_enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Boundary {
    pub epoch_id: String,
    pub sequence_id: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Metadata {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub backend: String,
    #[serde(default)]
    pub behavior: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct RunFailure {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub diagnostic: String,
}

/// `GET /sessions/{id}` (`SessionFrontendSnapshot`). Messages stay JSON; `transcript::items` reads them.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Snapshot {
    pub metadata: Metadata,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub active_run: Option<ActiveRun>,
    #[serde(default)]
    pub run_failure: Option<RunFailure>,
    pub thread_event_boundary: Boundary,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct PermissionResource {
    #[serde(default)]
    pub display: String,
    /// Set when the server can remember an approval of this resource ("Always allow").
    #[serde(default)]
    pub save_resource: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct PermissionRequest {
    pub id: String,
    /// The session that asked and that the reply goes to: the open one or one of its children.
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub resources: Vec<PermissionResource>,
}

/// `GET /sessions/{id}/permissions`. `approval_mode` is `manual`, `auto_approve` or `review`.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct PermissionState {
    #[serde(default)]
    pub approval_mode: String,
    #[serde(default)]
    pub requests: Vec<PermissionRequest>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct QuestionRequest {
    pub request_id: String,
    pub run_id: String,
    pub generation: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub choices: Vec<String>,
    /// `information` or `human_decision`.
    #[serde(default)]
    pub responder_class: String,
}

/// One entry of `GET /sessions/{id}/questions`; the app shows the `pending` ones.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Question {
    pub request: QuestionRequest,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub status: String,
}

/// One entry of `GET /sessions/{id}/inbox`: a message waiting for the running direct session.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct InboxItem {
    pub id: i64,
    /// `steer` (delivered at the run's next step) or `queue` (the next run).
    #[serde(default)]
    pub delivery: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub version: i64,
}

/// One entry of `GET /sessions/{id}/children`: a subagent this session started.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Child {
    pub child_session_id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub profile: String,
    /// `idle`, `running`, `completed`, `failed`, `cancelled` or `interrupted`.
    #[serde(default)]
    pub status: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Connection {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key_env: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Provider {
    pub id: String,
    #[serde(default)]
    auth_status: String,
    #[serde(default)]
    pub connection: Option<Connection>,
    #[serde(default)]
    pub managed_base_url: Option<String>,
    #[serde(default)]
    pub default_base_url: Option<String>,
    #[serde(default)]
    pub models: Vec<ProviderModel>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ProviderModel {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    /// The reasoning efforts the model takes; empty when the catalog does not say.
    #[serde(default)]
    pub supported_efforts: Vec<String>,
}

#[derive(Deserialize)]
struct Models {
    #[serde(default)]
    providers: Vec<Provider>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Ready {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub version: String,
}

fn encode(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for b in segment.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

impl Client {
    pub fn new(base: &str) -> Client {
        let agent = |global: Option<Duration>| {
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .timeout_connect(Some(Duration::from_secs(5)))
                .timeout_global(global)
                .build()
                .new_agent()
        };
        Client {
            base: base.trim_end_matches('/').to_owned(),
            agent: agent(Some(Duration::from_secs(20))),
            // The event stream stays open; `stream.rs` bounds each read instead.
            stream_agent: agent(None),
        }
    }

    fn finish(resp: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Result<String, String> {
        let mut resp = resp.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let body = resp.body_mut().read_to_string().map_err(|e| e.to_string())?;
        if (200..300).contains(&status) {
            return Ok(body);
        }
        // `ApiErrorBody { error }`, or plain text for rejected extraction.
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or(body);
        Err(format!("{status}: {}", message.trim()))
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let body = Self::finish(self.agent.get(format!("{}{path}", self.base)).call())?;
        serde_json::from_str(&body).map_err(|e| format!("GET {path}: {e}"))
    }

    fn post(&self, path: &str, body: &Value) -> Result<String, String> {
        self.send("POST", path, Some(body))
    }

    /// Any method, with a JSON body when there is one (`DELETE` takes one for the inbox).
    fn send(&self, method: &str, path: &str, body: Option<&Value>) -> Result<String, String> {
        let request = ureq::http::Request::builder().method(method).uri(format!("{}{path}", self.base));
        let request = match body {
            Some(body) => request.header("content-type", "application/json").body(body.to_string()),
            None => request.body(String::new()),
        };
        Self::finish(self.agent.run(request.map_err(|e| e.to_string())?))
    }

    /// `GET /readyz`
    pub fn ready(&self) -> Result<Ready, String> {
        self.get("/readyz")
    }

    /// `GET /ui-config`: whether the server enables orchestration (`NAC_ORCHESTRATION=1`). A
    /// server that does not say is treated as direct-only, as the web client does.
    pub fn orchestration_enabled(&self) -> bool {
        self.get::<UiConfig>("/ui-config").is_ok_and(|c| c.orchestration_enabled)
    }

    /// `GET /projects`
    pub fn projects(&self) -> Result<Vec<Project>, String> {
        self.get::<ProjectsResponse>("/projects").map(|r| r.projects)
    }

    /// `GET /sessions`
    pub fn sessions(&self) -> Result<Vec<ManagedSession>, String> {
        self.get("/sessions")
    }

    /// `POST /projects`
    pub fn create_project(&self, name: &str, cwd: &str) -> Result<Project, String> {
        let body = self.post("/projects", &json!({ "name": name, "cwd": cwd }))?;
        serde_json::from_str(&body).map_err(|e| format!("POST /projects: {e}"))
    }

    /// `GET /models`: the providers that have a credential, each with its models.
    pub fn models(&self) -> Result<Vec<Provider>, String> {
        let models: Models = self.get("/models")?;
        let ready: Vec<Provider> = models.providers.into_iter().filter(|p| p.auth_status == "ready" && !p.models.is_empty()).collect();
        if ready.is_empty() {
            return Err("No model provider has a credential yet. Add one with nac-web or the web client, then try again.".to_owned());
        }
        Ok(ready)
    }

    /// `POST /sessions`. Creating a session does not call a model.
    pub fn create_session(&self, project_id: &str, behavior: &str, backend: &str, model: &str) -> Result<String, String> {
        let body = self.post("/sessions", &json!({ "project_id": project_id, "behavior": behavior, "backend": backend, "model": model }))?;
        let created: Value = serde_json::from_str(&body).map_err(|e| format!("POST /sessions: {e}"))?;
        created["metadata"]["session_id"].as_str().map(str::to_owned).ok_or_else(|| "POST /sessions returned no session id".to_owned())
    }

    /// `GET /sessions/{id}`
    pub fn snapshot(&self, id: &str) -> Result<Snapshot, String> {
        self.get(&format!("/sessions/{}", encode(id)))
    }

    /// `GET /sessions/{id}/permissions`. Orchestrator-behavior sessions answer 400 here; their
    /// requests still arrive as `permission_asked` events.
    pub fn permissions(&self, id: &str) -> Result<PermissionState, String> {
        let mut state: PermissionState = self.get(&format!("/sessions/{}/permissions", encode(id)))?;
        for request in &mut state.requests {
            request.session_id = id.to_owned();
        }
        Ok(state)
    }

    /// `POST /sessions/{id}/permissions/{request_id}` with `once`, `always` or `reject`.
    pub fn reply_permission(&self, id: &str, request: &str, reply: &str) -> Result<(), String> {
        self.post(&format!("/sessions/{}/permissions/{}", encode(id), encode(request)), &json!({ "reply": reply })).map(drop)
    }

    /// `PUT /sessions/{id}/permissions/mode`: `manual`, `auto_approve` or `review`. Direct sessions only.
    pub fn set_approval_mode(&self, id: &str, mode: &str) -> Result<(), String> {
        self.send("PUT", &format!("/sessions/{}/permissions/mode", encode(id)), Some(&json!({ "mode": mode }))).map(drop)
    }

    /// `GET /sessions/{id}/questions`: the ones still waiting for an answer.
    pub fn questions(&self, id: &str) -> Result<Vec<Question>, String> {
        let all: Vec<Question> = self.get(&format!("/sessions/{}/questions", encode(id)))?;
        Ok(all.into_iter().filter(|q| q.status == "pending").collect())
    }

    /// `POST /sessions/{id}/questions/{request_id}/answer`
    pub fn answer_question(&self, id: &str, q: &Question, answer: &str) -> Result<(), String> {
        let r = &q.request;
        let body = json!({ "request_id": r.request_id, "run_id": r.run_id, "generation": r.generation, "expected_revision": q.revision, "answer": answer });
        self.post(&format!("/sessions/{}/questions/{}/answer", encode(id), encode(&r.request_id)), &body).map(drop)
    }

    /// `POST /sessions/{id}/questions/{request_id}/cancel`
    pub fn cancel_question(&self, id: &str, q: &Question) -> Result<(), String> {
        self.post(&format!("/sessions/{}/questions/{}/cancel", encode(id), encode(&q.request.request_id)), &json!({ "expected_revision": q.revision })).map(drop)
    }

    /// `GET /sessions/{id}/inbox`: the messages not yet delivered. Direct sessions only.
    pub fn inbox(&self, id: &str) -> Result<Vec<InboxItem>, String> {
        let all: Vec<InboxItem> = self.get(&format!("/sessions/{}/inbox", encode(id)))?;
        Ok(all.into_iter().filter(|i| i.status == "pending").collect())
    }

    /// `POST /sessions/{id}/inbox` with `steer` or `queue`.
    pub fn add_inbox(&self, id: &str, delivery: &str, prompt: &str) -> Result<(), String> {
        self.post(&format!("/sessions/{}/inbox", encode(id)), &json!({ "delivery": delivery, "prompt": prompt })).map(drop)
    }

    /// `PATCH /sessions/{id}/inbox/{item}`: changes how a waiting message is delivered.
    pub fn set_inbox_delivery(&self, id: &str, item: &InboxItem, delivery: &str) -> Result<(), String> {
        let body = json!({ "expected_version": item.version, "delivery": delivery });
        self.send("PATCH", &format!("/sessions/{}/inbox/{}", encode(id), item.id), Some(&body)).map(drop)
    }

    /// `DELETE /sessions/{id}/inbox/{item}`
    pub fn cancel_inbox(&self, id: &str, item: &InboxItem) -> Result<(), String> {
        self.send("DELETE", &format!("/sessions/{}/inbox/{}", encode(id), item.id), Some(&json!({ "expected_version": item.version }))).map(drop)
    }

    /// `POST /sessions/{id}/steering`: a message for a running orchestrator-behavior session.
    pub fn steer(&self, id: &str, instruction: &str) -> Result<(), String> {
        self.post(&format!("/sessions/{}/steering", encode(id)), &json!({ "instruction": instruction })).map(drop)
    }

    /// `GET /sessions/{id}/children`
    pub fn children(&self, id: &str) -> Result<Vec<Child>, String> {
        self.get(&format!("/sessions/{}/children", encode(id)))
    }

    /// `PATCH /sessions/{id}/config`. The server refuses it during a run.
    pub fn patch_config(&self, id: &str, patch: &Value) -> Result<(), String> {
        self.send("PATCH", &format!("/sessions/{}/config", encode(id)), Some(patch)).map(drop)
    }

    /// `PUT /sessions/{id}/presentation`: the title, checked against the revision last listed.
    pub fn rename_session(&self, s: &SessionSummary, title: &str) -> Result<(), String> {
        let body = json!({ "title": title, "pinned": s.pinned, "expected_version": s.presentation_version });
        self.send("PUT", &format!("/sessions/{}/presentation", encode(&s.session_id)), Some(&body)).map(drop)
    }

    /// `DELETE /sessions/{id}`
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        self.send("DELETE", &format!("/sessions/{}", encode(id)), None).map(drop)
    }

    /// `PATCH /projects/{id}`
    pub fn rename_project(&self, id: &str, name: &str) -> Result<(), String> {
        self.send("PATCH", &format!("/projects/{}", encode(id)), Some(&json!({ "name": name }))).map(drop)
    }

    /// `DELETE /projects/{id}`: the project's sessions stay, without a project.
    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        self.send("DELETE", &format!("/projects/{}", encode(id)), None).map(drop)
    }

    /// `POST /sessions/{id}/runs`
    pub fn submit(&self, id: &str, prompt: &str) -> Result<(), String> {
        self.post(&format!("/sessions/{}/runs", encode(id)), &json!({ "prompt": prompt })).map(drop)
    }

    /// `POST /sessions/{id}/cancel-active-run`
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        Self::finish(self.agent.post(format!("{}/sessions/{}/cancel-active-run", self.base, encode(id))).send_empty()).map(drop)
    }

    /// `GET /sessions/{id}/events/stream`, resuming after `cursor` when there is one.
    pub fn open_stream(&self, id: &str, cursor: Option<&Boundary>) -> Result<ureq::BodyReader<'static>, String> {
        let mut url = format!("{}/sessions/{}/events/stream", self.base, encode(id));
        if let Some(c) = cursor {
            url.push_str(&format!("?after_epoch_id={}&after_sequence_id={}", encode(&c.epoch_id), c.sequence_id));
        }
        let resp = self
            .stream_agent
            .get(url)
            .header("accept", "text/event-stream")
            .config()
            .timeout_recv_response(Some(Duration::from_secs(15)))
            // The server sends a keep-alive comment every 15 s; three missed ones is a dead link.
            .timeout_per_read(Some(Duration::from_secs(45)))
            .build()
            .call()
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        if status != 200 {
            return Err(format!("event stream answered {status}"));
        }
        Ok(resp.into_body().into_reader())
    }
}
