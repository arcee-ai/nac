//! MCP (Model Context Protocol) server module.
//!
//! Exposes nac session management as 11 MCP tools served over the
//! streamable-http transport at `/mcp`.

use crate::orchestration::OrchestrationOperations;
use crate::{
    CreateSessionRequest, HeadersRequest, RequestField, SandboxRequest, SessionManager,
    SubmitPromptRequest, UpdateConfigRequest,
};

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content};
use rmcp::schemars;
use rmcp::tool;
use rmcp::tool_handler;
use rmcp::tool_router;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::StreamableHttpService;
use rmcp::transport::StreamableHttpServerConfig;
use rmcp::ErrorData;
use rmcp::ServerHandler;

use serde::Deserialize;
use serde_json::json;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct NacMcpService {
    operations: OrchestrationOperations,
}

// ---------------------------------------------------------------------------
// Parameter structs
// ---------------------------------------------------------------------------

#[derive(Deserialize, schemars::JsonSchema)]
struct CreateSessionParams {
    #[schemars(
        description = "Project id. When set, the project supplies the working directory and any default model configuration."
    )]
    project_id: Option<String>,
    #[schemars(description = "Working directory for the session")]
    cwd: Option<String>,
    #[schemars(
        description = "Model id, e.g. \"claude-sonnet-4-20250514\". Call list_models first."
    )]
    model: Option<String>,
    #[schemars(description = "Backend kind: \"anthropic\", \"openai\", \"deepseek\", etc.")]
    backend: Option<String>,
    #[schemars(
        description = "Reasoning effort level. Valid values: none, minimal, low, medium, high, xhigh, max. Not all models support all levels — check list_models output."
    )]
    reasoning_effort: Option<String>,
    #[schemars(description = "Base URL for the model API endpoint")]
    base_url: Option<String>,
    #[schemars(description = "Environment variable name for the API key")]
    api_key_env: Option<String>,
    #[schemars(description = "SSH host for remote sessions (e.g. \"user@host\")")]
    ssh_host: Option<String>,
    #[schemars(description = "SSH port (default 22)")]
    ssh_port: Option<u16>,
    #[schemars(description = "Path to SSH identity file")]
    ssh_identity_file: Option<String>,
    #[schemars(description = "Enable sandbox mode (restricts file access and tool execution)")]
    sandbox: Option<bool>,
    #[schemars(
        description = "Extra HTTP headers to send with model API requests (JSON object of header name to value)"
    )]
    extra_headers: Option<serde_json::Value>,
    #[schemars(
        description = "Compaction threshold in tokens (0 disables, blank defaults to 70% of context window)"
    )]
    compaction_threshold: Option<u64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ListSessionsParams {
    #[schemars(description = "Include workspace diff stats (slower)")]
    include_workspace_stats: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct GetSessionStatusParams {
    #[schemars(description = "Session id")]
    session_id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SendMessageParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "Prompt text to submit")]
    prompt: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SteerParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "Steering instruction")]
    instruction: String,
    #[schemars(description = "Thread name to steer; omit for orchestrator-level steering")]
    thread_name: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct GetMessagesParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "Maximum messages to return (default 24)")]
    limit: Option<usize>,
    #[schemars(description = "Return messages before this index (cursor)")]
    before: Option<usize>,
    #[schemars(
        description = "Include system messages (default true). When true, transcript_index values are raw transcript positions usable directly with session_action(revert). Setting false breaks the transcript_index ↔ revert mapping."
    )]
    include_system: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct GetThreadEpisodesParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "Thread name; omit for all threads")]
    thread_name: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct GetThreadEventsParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "Thread name; omit for all threads from snapshot")]
    thread_name: Option<String>,
    #[schemars(description = "Maximum events to return (default 24)")]
    limit: Option<usize>,
    #[schemars(description = "Return events before this id (cursor)")]
    before_id: Option<i64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SessionActionParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "Action: \"compact\", \"cancel\", \"delete\", or \"revert\"")]
    action: String,
    #[schemars(description = "Message index (required for \"revert\")")]
    message_idx: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct UpdateSessionParams {
    #[schemars(description = "Session id")]
    session_id: String,
    #[schemars(description = "New model id")]
    model: Option<String>,
    #[schemars(description = "New backend kind")]
    backend: Option<String>,
    #[schemars(description = "New reasoning effort")]
    reasoning_effort: Option<String>,
}

// ---------------------------------------------------------------------------
// Tool router — 11 tools
// ---------------------------------------------------------------------------

#[tool_router]
impl NacMcpService {
    #[tool(
        name = "create_session",
        description = "Create a new nac session. Call list_models first to see available model IDs and their supported reasoning efforts. You only need to pass model — the backend is auto-detected from the model ID. Pass reasoning_effort only if the model supports it. Valid efforts: none, minimal, low, medium, high, xhigh, max. Pass project_id by itself to use a project's directory and defaults; do not combine it with cwd or SSH fields. For remote sessions, pass ssh_host (and optionally ssh_port, ssh_identity_file). For sandboxed sessions, pass sandbox: true."
    )]
    async fn create_session(
        &self,
        Parameters(params): Parameters<CreateSessionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let extra_headers = match params.extra_headers {
            None => RequestField::Omitted,
            Some(v) => {
                let map: std::collections::BTreeMap<String, String> =
                    match serde_json::from_value(v) {
                        Ok(map) => map,
                        Err(e) => {
                            return Ok(CallToolResult::error(vec![Content::text(format!(
                                "Invalid extra_headers: {e}"
                            ))]));
                        }
                    };
                RequestField::Value(HeadersRequest(map))
            }
        };
        let request = CreateSessionRequest {
            behavior: nac_core::sessions::SessionBehavior::Orchestrator,
            first_chat: false,
            project_id: params.project_id,
            cwd: params.cwd.map(std::path::PathBuf::from),
            model: field(params.model),
            base_url: field(params.base_url),
            backend: field(params.backend),
            reasoning_effort: field(params.reasoning_effort),
            api_key_env: field(params.api_key_env),
            extra_headers,
            orchestrator_compaction_threshold: params
                .compaction_threshold
                .map(RequestField::Value)
                .unwrap_or(RequestField::Omitted),
            light_model: RequestField::Omitted,
            ssh_host: params.ssh_host,
            ssh_port: params.ssh_port,
            ssh_identity_file: params.ssh_identity_file,
            sandbox: SandboxRequest {
                enabled: params.sandbox.unwrap_or(false),
                ..Default::default()
            },
        };
        match self.operations.create_session(request).await {
            Ok(snapshot) => {
                let session_id = snapshot.metadata.session_id.clone();
                let model = snapshot.metadata.model.clone();
                let result = json!({
                    "session_id": session_id,
                    "model": model,
                    "project_id": snapshot.metadata.project_id,
                });
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result)
                        .unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "list_sessions",
        description = "List all nac sessions with their id, title, active status, and active run prompt."
    )]
    async fn list_sessions(
        &self,
        Parameters(params): Parameters<ListSessionsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self
            .operations
            .list_sessions(params.include_workspace_stats.unwrap_or(false))
            .await
        {
            Ok(sessions) => {
                let entries: Vec<_> = sessions
                    .into_iter()
                    .map(|s| {
                        json!({
                            "session_id": s.summary.session_id,
                            "title": s.summary.title,
                            "active": s.active,
                            "active_run_prompt": s.active_run.as_ref().map(|r| &r.prompt_preview),
                        })
                    })
                    .collect();
                let result = json!(entries);
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result)
                        .unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "get_session_status",
        description = "Get a lightweight status snapshot: active_run, active_threads, and thread summaries. Use this for polling — it does not include messages or episode content. When active_run is null, the run is complete."
    )]
    async fn get_session_status(
        &self,
        Parameters(params): Parameters<GetSessionStatusParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.operations.snapshot(&params.session_id).await {
            Ok(snapshot) => {
                let active_run = snapshot.active_run.as_ref().map(|r| {
                    json!({
                        "run_id": r.run_id.to_string(),
                        "prompt_preview": r.prompt_preview,
                        "started_at_epoch_ms": r.started_at_epoch_ms,
                    })
                });
                let threads: Vec<_> = snapshot
                    .threads
                    .iter()
                    .map(|t| {
                        json!({
                            "name": t.name,
                            "episode_count": t.episode_count,
                            "latest_action": t.latest_action,
                        })
                    })
                    .collect();
                let result = json!({
                    "session_id": snapshot.metadata.session_id,
                    "active_run": active_run,
                    "active_threads": snapshot.active_threads,
                    "threads": threads,
                });
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result)
                        .unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "send_message",
        description = "Submit a prompt to a session and start a run. Returns immediately with a run_id — the run continues asynchronously. Poll get_session_status to check completion."
    )]
    async fn send_message(
        &self,
        Parameters(params): Parameters<SendMessageParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self
            .operations
            .submit_prompt(
                &params.session_id,
                SubmitPromptRequest {
                    prompt: params.prompt,
                },
            )
            .await
        {
            Ok(response) => {
                let result = json!({
                    "run_id": response.run_id,
                    "display_prompt": response.display_prompt,
                });
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result)
                        .unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "steer",
        description = "Inject guidance into a running session without stopping it. Target the orchestrator (omit thread_name) or a specific worker thread. The instruction is delivered on the next iteration."
    )]
    async fn steer(
        &self,
        Parameters(params): Parameters<SteerParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = if let Some(thread_name) = params.thread_name {
            self.operations
                .steer(&params.session_id, params.instruction, Some(thread_name))
                .await
        } else {
            self.operations
                .steer(&params.session_id, params.instruction, None)
                .await
        };
        match result {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "get_messages",
        description = "Get a page of messages from a session transcript. Each message includes a transcript_index — the raw transcript position that can be passed to session_action(action=\"revert\", message_idx=transcript_index) to roll back to that point. System messages are included by default so that transcript_index values match raw transcript positions used by revert."
    )]
    async fn get_messages(
        &self,
        Parameters(params): Parameters<GetMessagesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        use nac_core::session_service::MessagePageRequest;
        let include_system = params.include_system.unwrap_or(true);
        match self
            .operations
            .messages_page(
                &params.session_id,
                MessagePageRequest {
                    before: params.before,
                    limit: params.limit.unwrap_or(24),
                    include_system,
                },
            )
            .await
        {
            Ok(page) => {
                let base = page.page.start;
                let messages: Vec<_> = page
                    .messages
                    .iter()
                    .enumerate()
                    .map(|(i, msg)| {
                        json!({
                            "transcript_index": base + i,
                            "role": message_role(msg),
                            "content": message_content(msg),
                            "created_at": page.created_at.get(i).and_then(|c| c.as_ref()),
                        })
                    })
                    .collect();
                let result = json!({
                    "messages": messages,
                    "page": {
                        "start": page.page.start,
                        "end": page.page.end,
                        "total": page.page.total,
                        "has_older": page.page.has_older,
                    },
                });
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result)
                        .unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "get_thread_episodes",
        description = "Get the retained output from worker threads. Each episode contains the thread's action (its task prompt) and content (its final response). Pass thread_name for one thread, or omit for all threads."
    )]
    async fn get_thread_episodes(
        &self,
        Parameters(params): Parameters<GetThreadEpisodesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self
            .operations
            .thread_episodes(&params.session_id, params.thread_name)
            .await
        {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "get_thread_events",
        description = "Get recent activity for worker threads: tool calls, tool results, errors, and completion status. Pass thread_name for one thread, or omit for all threads."
    )]
    async fn get_thread_events(
        &self,
        Parameters(params): Parameters<GetThreadEventsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = self
            .operations
            .thread_events(
                &params.session_id,
                params.thread_name,
                params.before_id,
                params.limit.unwrap_or(24),
            )
            .await;
        match result {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "session_action",
        description = "Perform a lifecycle action: 'compact' (reduce context), 'cancel' (stop active run), 'delete' (remove session), or 'revert' (roll back to a message index, requires message_idx)."
    )]
    async fn session_action(
        &self,
        Parameters(params): Parameters<SessionActionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = self
            .operations
            .session_action(&params.session_id, &params.action, params.message_idx)
            .await;
        match result {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "update_session",
        description = "Update model configuration for an inactive session."
    )]
    async fn update_session(
        &self,
        Parameters(params): Parameters<UpdateSessionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = UpdateConfigRequest {
            model: field(params.model),
            base_url: RequestField::Omitted,
            backend: field(params.backend),
            reasoning_effort: field(params.reasoning_effort),
            api_key_env: RequestField::Omitted,
            extra_headers: RequestField::Omitted,
            orchestrator_compaction_threshold: RequestField::Omitted,
            light_model: RequestField::Omitted,
        };
        match self
            .operations
            .update_session(&params.session_id, request)
            .await
        {
            Ok(()) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&json!({"status": "ok"}))
                    .unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(
        name = "list_models",
        description = "List available model providers and their models. Each model includes supported reasoning efforts and context window. Use the model id when calling create_session — the backend is auto-detected."
    )]
    async fn list_models(&self) -> Result<CallToolResult, ErrorData> {
        let result = OrchestrationOperations::model_listing();
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result)
                .unwrap_or_else(|e| format!("Error serializing: {e}")),
        )]))
    }
}

#[tool_handler(
    instructions = "nac is an AI coding agent orchestrator. It manages coding sessions where an orchestrator agent receives your prompt, plans the work, and dispatches worker threads to execute tasks autonomously. Each worker operates independently — reading files, writing code, running commands, and calling tools — then reports back with its results. The orchestrator reviews thread output, compacts context when approaching the model's context window limit, and either dispatches more threads or produces a final response. Each worker's final output is retained as an episode you can inspect.\n\nSessions are asynchronous: send_message returns immediately with a run_id and the work continues in the background. Poll get_session_status to check completion, use steer to guide running tasks mid-flight, and inspect results with get_messages, get_thread_episodes, and get_thread_events. Sessions persist across server restarts and you can manage multiple simultaneously."
)]
impl ServerHandler for NacMcpService {}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

pub fn streamable_http_service(
    manager: SessionManager,
) -> StreamableHttpService<NacMcpService, LocalSessionManager> {
    StreamableHttpService::new(
        move || {
            Ok(NacMcpService {
                operations: OrchestrationOperations::new(manager.clone()),
            })
        },
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default(),
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Converts an `Option<String>` into a `RequestField<String>`:
/// `Some(v)` → `Value(v)`, `None` → `Omitted`.
fn field(v: Option<String>) -> RequestField<String> {
    match v {
        Some(v) => RequestField::Value(v),
        None => RequestField::Omitted,
    }
}

/// Returns the role label for a `Message`.
fn message_role(msg: &nac_core::types::Message) -> &'static str {
    match msg {
        nac_core::types::Message::System { .. } => "system",
        nac_core::types::Message::User { .. } => "user",
        nac_core::types::Message::Assistant { .. } => "assistant",
        nac_core::types::Message::Tool { .. } => "tool",
    }
}

/// Returns the primary text content of a `Message`.
fn message_content(msg: &nac_core::types::Message) -> String {
    match msg {
        nac_core::types::Message::System { content }
        | nac_core::types::Message::User { content } => content.clone(),
        nac_core::types::Message::Assistant { content, .. } => content.clone().unwrap_or_default(),
        nac_core::types::Message::Tool { content, .. } => content.preview(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_session_schema_exposes_optional_project_id() {
        let schema = serde_json::to_value(schemars::schema_for!(CreateSessionParams)).unwrap();
        let properties = schema["properties"].as_object().unwrap();
        assert!(properties.contains_key("project_id"));
        assert!(properties.contains_key("cwd"));
        assert!(!schema["required"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|field| field == "project_id"));
    }
}
