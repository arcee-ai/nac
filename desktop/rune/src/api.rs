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
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct PermissionRequest {
    pub id: String,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub resources: Vec<PermissionResource>,
}

#[derive(Deserialize)]
struct PermissionState {
    #[serde(default)]
    requests: Vec<PermissionRequest>,
}

#[derive(Deserialize)]
pub struct Provider {
    pub id: String,
    #[serde(default)]
    auth_status: String,
    #[serde(default)]
    pub models: Vec<ProviderModel>,
}

#[derive(Deserialize)]
pub struct ProviderModel {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
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
        Self::finish(self.agent.post(format!("{}{path}", self.base)).content_type("application/json").send(body.to_string()))
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
    /// requests still arrive as `permission_asked` events, so a failure is an empty list.
    pub fn permissions(&self, id: &str) -> Vec<PermissionRequest> {
        self.get::<PermissionState>(&format!("/sessions/{}/permissions", encode(id))).map(|s| s.requests).unwrap_or_default()
    }

    /// `POST /sessions/{id}/permissions/{request_id}` with `once` or `reject`.
    pub fn reply_permission(&self, id: &str, request: &str, approve: bool) -> Result<(), String> {
        let reply = if approve { "once" } else { "reject" };
        self.post(&format!("/sessions/{}/permissions/{}", encode(id), encode(request)), &json!({ "reply": reply })).map(drop)
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
