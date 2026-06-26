//! HTTP client for the nac-web server API.
//!
//! [`NacWebClient`] wraps a [`reqwest::Client`] and a base URL, providing
//! typed async methods for every endpoint the pipeline queue needs:
//! session lifecycle, prompt submission, event streaming, and health checks.

use anyhow::{anyhow, Context, Result};
use futures_util::{stream::BoxStream, StreamExt};
use serde::{Deserialize, Serialize};
use tracing::warn;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// Sandbox configuration sent to nac-web when creating a session.
///
/// Mirrors the subset of the server-side `SandboxRequest` that the pipeline
/// queue cares about.  Omitted fields default on the server side.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxConfig {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts_ro: Vec<String>,
}

/// Response from `POST /sessions/{id}/runs`.
#[derive(Debug, Clone, Deserialize)]
pub struct SubmitPromptResponse {
    pub run_id: String,
    pub client_id: Option<String>,
    pub display_prompt: String,
}

// ---------------------------------------------------------------------------
// Event types (match nac-core::events wire format)
// ---------------------------------------------------------------------------

/// Envelope wrapping a single session event with metadata.
///
/// Wire format matches `nac_core::events::SessionEventEnvelope`.
#[derive(Debug, Clone, Deserialize)]
pub struct SessionEventEnvelope {
    pub session_id: Option<String>,
    pub sequence_id: u64,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    pub event: SessionEvent,
}

/// Top-level session event, discriminated by `type`.
///
/// Wire format matches `nac_core::events::SessionEvent`.
/// The `Agent` variant carries a raw [`serde_json::Value`] for now —
/// the pipeline logic only needs `RunCompleted` and `RunFailed`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    Agent {
        event: serde_json::Value,
    },
    RunStarted {
        prompt_preview: String,
        #[serde(default)]
        submitted_user_message: Option<serde_json::Value>,
        started_at_epoch_ms: u64,
    },
    RunCompleted {
        response: String,
        #[serde(default)]
        duration_ms: Option<u64>,
    },
    RunFailed {
        message: String,
    },
    SnapshotSaved {
        session_id: String,
    },
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

/// A single parsed SSE frame (one blank-line-delimited block).
#[derive(Debug, Clone)]
pub struct SseEvent {
    /// Value of the `event:` field (defaults to `"message"` if absent).
    pub event: String,
    /// Value of the `id:` field, if present.
    pub id: Option<String>,
    /// Joined `data:` lines (multiple lines joined with `\n`).
    pub data: String,
}

impl SseEvent {
    /// Parse the `data` payload as a JSON value.
    pub fn data_json(&self) -> Result<serde_json::Value> {
        serde_json::from_str(&self.data).context("failed to parse SSE data as JSON")
    }

    /// Parse the `data` payload as a [`SessionEventEnvelope`].
    ///
    /// Only meaningful when `event == "session_event"`.
    pub fn parse_envelope(&self) -> Result<SessionEventEnvelope> {
        serde_json::from_str(&self.data).context("failed to parse SSE data as SessionEventEnvelope")
    }
}

/// Incremental SSE reader that wraps a `reqwest` response body stream.
///
/// Call [`SseStream::next_event`] in a loop to yield parsed [`SseEvent`]
/// items.  Returns `Ok(None)` when the server closes the stream.
pub struct SseStream {
    stream: BoxStream<'static, Result<bytes::Bytes, reqwest::Error>>,
    buffer: String,
    event_type: Option<String>,
    event_id: Option<String>,
    data_lines: Vec<String>,
}

impl SseStream {
    /// Create an [`SseStream`] from a successful `reqwest::Response`.
    ///
    /// The response should already have a successful status code (the
    /// [`NacWebClient::stream_events`] helper checks this before returning
    /// the response).
    pub fn from_response(response: reqwest::Response) -> Self {
        Self {
            stream: Box::pin(response.bytes_stream()),
            buffer: String::new(),
            event_type: None,
            event_id: None,
            data_lines: Vec::new(),
        }
    }

    /// Attempt to read and parse the next SSE event.
    ///
    /// Returns `Ok(None)` when the underlying stream is exhausted.
    pub async fn next_event(&mut self) -> Result<Option<SseEvent>> {
        loop {
            // Process complete lines already in the buffer.
            while let Some(nl) = self.buffer.find('\n') {
                let line = self.buffer[..nl].trim_end_matches('\r').to_string();
                self.buffer = self.buffer[nl + 1..].to_string();

                if line.is_empty() {
                    // Blank line dispatches the current event (if any data).
                    if !self.data_lines.is_empty() {
                        let event = SseEvent {
                            event: self
                                .event_type
                                .take()
                                .unwrap_or_else(|| "message".to_string()),
                            id: self.event_id.take(),
                            data: self.data_lines.join("\n"),
                        };
                        self.data_lines.clear();
                        return Ok(Some(event));
                    }
                    // No data — reset fields and continue.
                    self.event_type = None;
                    self.event_id = None;
                    continue;
                }

                if line.starts_with(':') {
                    // Comment / keep-alive — ignore.
                    continue;
                }

                if let Some(rest) = line.strip_prefix("event:") {
                    self.event_type = Some(rest.trim().to_string());
                } else if let Some(rest) = line.strip_prefix("data:") {
                    // Per SSE spec: strip one leading space if present.
                    let value = rest.strip_prefix(' ').unwrap_or(rest);
                    self.data_lines.push(value.to_string());
                } else if let Some(rest) = line.strip_prefix("id:") {
                    self.event_id = Some(rest.trim().to_string());
                }
                // Unknown field names are ignored per spec.
            }

            // Buffer has no complete lines — fetch more bytes.
            match self.stream.next().await {
                Some(Ok(chunk)) => {
                    self.buffer.push_str(&String::from_utf8_lossy(&chunk));
                }
                Some(Err(error)) => {
                    return Err(anyhow!("SSE stream error: {error}"));
                }
                None => {
                    // Stream closed — flush any remaining buffered event.
                    if !self.buffer.is_empty() {
                        let line = self.buffer.trim_end_matches('\r').to_string();
                        self.buffer.clear();
                        if !line.is_empty() && !line.starts_with(':') {
                            if let Some(rest) = line.strip_prefix("event:") {
                                self.event_type = Some(rest.trim().to_string());
                            } else if let Some(rest) = line.strip_prefix("data:") {
                                let value = rest.strip_prefix(' ').unwrap_or(rest);
                                self.data_lines.push(value.to_string());
                            } else if let Some(rest) = line.strip_prefix("id:") {
                                self.event_id = Some(rest.trim().to_string());
                            }
                        }
                    }
                    if !self.data_lines.is_empty() {
                        let event = SseEvent {
                            event: self
                                .event_type
                                .take()
                                .unwrap_or_else(|| "message".to_string()),
                            id: self.event_id.take(),
                            data: self.data_lines.join("\n"),
                        };
                        self.data_lines.clear();
                        return Ok(Some(event));
                    }
                    return Ok(None);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// NacWebClient
// ---------------------------------------------------------------------------

/// HTTP client for the nac-web server.
///
/// Cheaply cloneable — `reqwest::Client` is internally `Arc`-based.
#[derive(Clone)]
pub struct NacWebClient {
    client: reqwest::Client,
    base_url: String,
}

impl NacWebClient {
    /// Create a client with a default `reqwest::Client`.
    pub fn new(base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    /// Create a client with a custom `reqwest::Client` (e.g. for timeouts).
    pub fn with_client(base_url: &str, client: reqwest::Client) -> Self {
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    /// Build a full URL by joining `path` to the base URL.
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Check that a response has a successful status, otherwise extract the
    /// error body and return an [`anyhow::Error`] with context.
    async fn ensure_ok(&self, response: reqwest::Response) -> Result<reqwest::Response> {
        let status = response.status();
        if status.is_success() {
            Ok(response)
        } else {
            let url = response.url().to_string();
            let body = response.text().await.unwrap_or_default();
            Err(anyhow!("HTTP {status} from {url}: {body}"))
        }
    }

    // -- Session management --------------------------------------------------

    /// `POST /sessions` — create a new session and return its session ID.
    ///
    /// When `sandbox` is `None`, sends `{"enabled": false}`.
    /// Does not specify model/backend/reasoning_effort — nac-web uses its
    /// config defaults.
    pub async fn create_session(
        &self,
        cwd: &str,
        sandbox: Option<SandboxConfig>,
    ) -> Result<String> {
        #[derive(Serialize)]
        struct Request {
            cwd: String,
            sandbox: SandboxConfig,
        }

        let body = Request {
            cwd: cwd.to_string(),
            sandbox: sandbox.unwrap_or_default(),
        };
        let response = self
            .client
            .post(self.url("/sessions"))
            .json(&body)
            .send()
            .await
            .context("failed to POST /sessions")?;
        let response = self.ensure_ok(response).await?;

        #[derive(Deserialize)]
        struct Metadata {
            session_id: Option<String>,
        }
        #[derive(Deserialize)]
        struct CreateSessionResponse {
            metadata: Metadata,
        }

        let parsed: CreateSessionResponse = response
            .json()
            .await
            .context("failed to parse create_session response")?;
        parsed
            .metadata
            .session_id
            .ok_or_else(|| anyhow!("create_session response missing metadata.session_id"))
    }

    /// `POST /sessions/{id}/runs` — submit a prompt to an existing session.
    pub async fn submit_prompt(
        &self,
        session_id: &str,
        prompt: &str,
    ) -> Result<SubmitPromptResponse> {
        #[derive(Serialize)]
        struct Request {
            prompt: String,
        }

        let response = self
            .client
            .post(self.url(&format!("/sessions/{session_id}/runs")))
            .json(&Request {
                prompt: prompt.to_string(),
            })
            .send()
            .await
            .with_context(|| format!("failed to POST /sessions/{session_id}/runs"))?;
        let response = self.ensure_ok(response).await?;
        response
            .json()
            .await
            .with_context(|| format!("failed to parse submit_prompt response for {session_id}"))
    }

    /// `GET /sessions/{id}` — fetch the full session snapshot as raw JSON.
    pub async fn get_session_snapshot(&self, session_id: &str) -> Result<serde_json::Value> {
        let response = self
            .client
            .get(self.url(&format!("/sessions/{session_id}")))
            .send()
            .await
            .with_context(|| format!("failed to GET /sessions/{session_id}"))?;
        let response = self.ensure_ok(response).await?;
        response
            .json()
            .await
            .with_context(|| format!("failed to parse session snapshot for {session_id}"))
    }

    /// `GET /sessions/{id}/workspace/diff` — fetch workspace diff as raw JSON.
    ///
    /// Note: the server expects a `path` query parameter; this method sends
    /// `path=.` to get the top-level diff.
    pub async fn get_workspace_diff(&self, session_id: &str) -> Result<serde_json::Value> {
        let response = self
            .client
            .get(self.url(&format!(
                "/sessions/{session_id}/workspace/diff?path=."
            )))
            .send()
            .await
            .with_context(|| {
                format!("failed to GET /sessions/{session_id}/workspace/diff")
            })?;
        let response = self.ensure_ok(response).await?;
        response
            .json()
            .await
            .with_context(|| format!("failed to parse workspace diff for {session_id}"))
    }

    /// `DELETE /sessions/{id}` — delete a session and all related data.
    pub async fn delete_session(&self, session_id: &str) -> Result<()> {
        let response = self
            .client
            .delete(self.url(&format!("/sessions/{session_id}")))
            .send()
            .await
            .with_context(|| format!("failed to DELETE /sessions/{session_id}"))?;
        self.ensure_ok(response).await?;
        Ok(())
    }

    /// `POST /sessions/{id}/cancel-active-run` — cancel the active run.
    pub async fn cancel_active_run(&self, session_id: &str) -> Result<()> {
        let response = self
            .client
            .post(self.url(&format!(
                "/sessions/{session_id}/cancel-active-run"
            )))
            .send()
            .await
            .with_context(|| {
                format!("failed to POST /sessions/{session_id}/cancel-active-run")
            })?;
        self.ensure_ok(response).await?;
        Ok(())
    }

    // -- Health --------------------------------------------------------------

    /// `GET /health` — return `true` if the server responds with `{"status":"ok"}`.
    pub async fn check_health(&self) -> Result<bool> {
        let response = self
            .client
            .get(self.url("/health"))
            .send()
            .await
            .context("failed to GET /health")?;
        if !response.status().is_success() {
            warn!("health check returned HTTP {}", response.status());
            return Ok(false);
        }
        #[derive(Deserialize)]
        struct HealthResponse {
            status: String,
        }
        let parsed: HealthResponse = response.json().await.context("failed to parse /health")?;
        Ok(parsed.status == "ok")
    }

    // -- SSE event streaming -------------------------------------------------

    /// `GET /sessions/{id}/events/stream` — open an SSE stream.
    ///
    /// Returns the raw [`reqwest::Response`] so the caller can wrap it in
    /// [`SseStream::from_response`] and iterate over events.
    pub async fn stream_events(
        &self,
        session_id: &str,
        after_sequence_id: Option<u64>,
    ) -> Result<reqwest::Response> {
        let path = match after_sequence_id {
            Some(seq) => format!("/sessions/{session_id}/events/stream?after_sequence_id={seq}"),
            None => format!("/sessions/{session_id}/events/stream"),
        };
        let response = self
            .client
            .get(self.url(&path))
            .send()
            .await
            .with_context(|| {
                format!("failed to GET /sessions/{session_id}/events/stream")
            })?;
        self.ensure_ok(response).await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandbox_config_serializes_disabled() {
        let config = SandboxConfig::default();
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], false);
        assert!(json.get("backend").is_none() || json["backend"].is_null());
    }

    #[test]
    fn sandbox_config_serializes_enabled() {
        let config = SandboxConfig {
            enabled: true,
            backend: Some("smolvm".to_string()),
            workdir: Some("/workspace".to_string()),
            mounts: vec!["/host:/container".to_string()],
            mounts_ro: vec![],
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], true);
        assert_eq!(json["backend"], "smolvm");
        assert_eq!(json["workdir"], "/workspace");
        assert_eq!(json["mounts"][0], "/host:/container");
        // mounts_ro is empty and should be skipped
        assert!(json.get("mounts_ro").is_none() || json["mounts_ro"].is_null());
    }

    #[test]
    fn session_event_envelope_deserializes_run_completed() {
        let json = r#"{
            "session_id": "sess-123",
            "sequence_id": 42,
            "run_id": "run-abc",
            "event": {
                "type": "run_completed",
                "response": "All done",
                "duration_ms": 5000
            }
        }"#;
        let envelope: SessionEventEnvelope = serde_json::from_str(json).unwrap();
        assert_eq!(envelope.session_id.as_deref(), Some("sess-123"));
        assert_eq!(envelope.sequence_id, 42);
        assert_eq!(envelope.run_id.as_deref(), Some("run-abc"));
        assert!(matches!(
            envelope.event,
            SessionEvent::RunCompleted { ref response, duration_ms } if response == "All done" && duration_ms == Some(5000)
        ));
    }

    #[test]
    fn session_event_envelope_deserializes_run_failed() {
        let json = r#"{
            "session_id": null,
            "sequence_id": 7,
            "event": {
                "type": "run_failed",
                "message": "boom"
            }
        }"#;
        let envelope: SessionEventEnvelope = serde_json::from_str(json).unwrap();
        assert!(envelope.session_id.is_none());
        assert_eq!(envelope.sequence_id, 7);
        assert!(matches!(
            envelope.event,
            SessionEvent::RunFailed { ref message } if message == "boom"
        ));
    }

    #[test]
    fn session_event_envelope_deserializes_agent_event() {
        let json = r#"{
            "session_id": "s1",
            "sequence_id": 3,
            "event": {
                "type": "agent",
                "event": {
                    "type": "tool_call_started",
                    "call_id": "c1",
                    "name": "read",
                    "args_preview": "..."
                }
            }
        }"#;
        let envelope: SessionEventEnvelope = serde_json::from_str(json).unwrap();
        assert!(matches!(envelope.event, SessionEvent::Agent { .. }));
    }

    #[test]
    fn session_event_envelope_deserializes_run_started() {
        let json = r#"{
            "session_id": "s1",
            "sequence_id": 1,
            "event": {
                "type": "run_started",
                "prompt_preview": "do the thing",
                "started_at_epoch_ms": 1700000000000
            }
        }"#;
        let envelope: SessionEventEnvelope = serde_json::from_str(json).unwrap();
        assert!(matches!(
            envelope.event,
            SessionEvent::RunStarted { ref prompt_preview, started_at_epoch_ms, .. }
            if prompt_preview == "do the thing" && started_at_epoch_ms == 1700000000000
        ));
    }

    #[test]
    fn session_event_envelope_deserializes_snapshot_saved() {
        let json = r#"{
            "session_id": "s1",
            "sequence_id": 10,
            "event": {
                "type": "snapshot_saved",
                "session_id": "s1"
            }
        }"#;
        let envelope: SessionEventEnvelope = serde_json::from_str(json).unwrap();
        assert!(matches!(
            envelope.event,
            SessionEvent::SnapshotSaved { ref session_id } if session_id == "s1"
        ));
    }

    #[test]
    fn sse_event_parse_envelope_works() {
        let sse = SseEvent {
            event: "session_event".to_string(),
            id: Some("42".to_string()),
            data: r#"{"session_id":"s1","sequence_id":42,"event":{"type":"run_completed","response":"ok"}}"#.to_string(),
        };
        let envelope = sse.parse_envelope().unwrap();
        assert_eq!(envelope.sequence_id, 42);
        assert!(matches!(envelope.event, SessionEvent::RunCompleted { .. }));
    }

    #[test]
    fn sse_event_data_json_works() {
        let sse = SseEvent {
            event: "replay_gap".to_string(),
            id: None,
            data: r#"{"replay_gap":{"missing_from_sequence_id":1,"missing_to_sequence_id":5}}"#.to_string(),
        };
        let json = sse.data_json().unwrap();
        assert_eq!(json["replay_gap"]["missing_from_sequence_id"], 1);
    }
}