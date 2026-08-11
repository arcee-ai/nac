//! MCP (Model Context Protocol) server module.
//!
//! Exposes nac session management as 11 MCP tools served over the
//! streamable-http transport at `/mcp`.

use crate::{
    CreateSessionRequest, OrchestratorSteeringRequest, RequestField, SessionManager,
    SubmitPromptRequest, ThreadSteeringRequest, UpdateConfigRequest,
};

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content};
use rmcp::schemars;
use rmcp::tool;
use rmcp::tool_handler;
use rmcp::tool_router;
use rmcp::ErrorData;
use rmcp::ServerHandler;
use rmcp::transport::StreamableHttpServerConfig;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::StreamableHttpService;

use serde::Deserialize;
use serde_json::json;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct NacMcpService {
    manager: SessionManager,
}

// ---------------------------------------------------------------------------
// Parameter structs
// ---------------------------------------------------------------------------

#[derive(Deserialize, schemars::JsonSchema)]
struct CreateSessionParams {
    #[schemars(description = "Working directory for the session")]
    cwd: Option<String>,
    #[schemars(description = "Model id, e.g. \"claude-sonnet-4-20250514\"")]
    model: Option<String>,
    #[schemars(description = "Backend kind: \"anthropic\", \"openai\", \"deepseek\", etc.")]
    backend: Option<String>,
    #[schemars(description = "Reasoning effort: \"low\", \"medium\", or \"high\"")]
    reasoning_effort: Option<String>,
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
    #[schemars(description = "Include system messages")]
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
    #[tool(name = "create_session", description = "Create a new nac session with optional model, backend, and reasoning effort overrides.")]
    async fn create_session(
        &self,
        Parameters(params): Parameters<CreateSessionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = CreateSessionRequest {
            cwd: params.cwd.map(std::path::PathBuf::from),
            model: field(params.model),
            base_url: RequestField::Omitted,
            backend: field(params.backend),
            reasoning_effort: field(params.reasoning_effort),
            api_key_env: RequestField::Omitted,
            extra_headers: RequestField::Omitted,
            orchestrator_compaction_threshold: RequestField::Omitted,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            sandbox: Default::default(),
        };
        match self.manager.create_session(request).await {
            Ok(snapshot) => {
                let session_id = snapshot.metadata.session_id.clone();
                let model = snapshot.metadata.model.clone();
                let result = json!({
                    "session_id": session_id,
                    "model": model,
                });
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "list_sessions", description = "List all nac sessions with their id, title, active status, and active run prompt.")]
    async fn list_sessions(
        &self,
        Parameters(params): Parameters<ListSessionsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self
            .manager
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
                    serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "get_session_status", description = "Get the status of a session: active run, active threads, and thread summaries.")]
    async fn get_session_status(
        &self,
        Parameters(params): Parameters<GetSessionStatusParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.manager.snapshot(&params.session_id).await {
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
                    serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "send_message", description = "Submit a prompt to a session and start a run.")]
    async fn send_message(
        &self,
        Parameters(params): Parameters<SendMessageParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self
            .manager
            .submit_prompt(&params.session_id, SubmitPromptRequest { prompt: params.prompt })
            .await
        {
            Ok(response) => {
                let result = json!({
                    "run_id": response.run_id,
                    "display_prompt": response.display_prompt,
                });
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "steer", description = "Queue a steering instruction for a session, optionally targeting a specific thread.")]
    async fn steer(
        &self,
        Parameters(params): Parameters<SteerParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = if let Some(thread_name) = params.thread_name {
            self.manager
                .queue_thread_steering(
                    &params.session_id,
                    &thread_name,
                    ThreadSteeringRequest {
                        instruction: params.instruction,
                    },
                )
                .await
                .map(|r| {
                    json!({
                        "steering_id": r.steering_id,
                        "status": r.status,
                    })
                })
        } else {
            self.manager
                .queue_orchestrator_steering(
                    &params.session_id,
                    OrchestratorSteeringRequest {
                        instruction: params.instruction,
                    },
                )
                .await
                .map(|r| {
                    json!({
                        "steering_id": r.steering_id,
                        "status": r.status,
                    })
                })
        };
        match result {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "get_messages", description = "Get a page of messages from a session transcript.")]
    async fn get_messages(
        &self,
        Parameters(params): Parameters<GetMessagesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        use nac_core::session_service::MessagePageRequest;
        match self
            .manager
            .messages_page(
                &params.session_id,
                MessagePageRequest {
                    before: params.before,
                    limit: params.limit.unwrap_or(24),
                    include_system: params.include_system.unwrap_or(false),
                },
            )
            .await
        {
            Ok(page) => {
                let messages: Vec<_> = page
                    .messages
                    .iter()
                    .enumerate()
                    .map(|(i, msg)| {
                        json!({
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
                    serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error serializing: {e}")),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "get_thread_episodes", description = "Get retained episodes for a thread (or all threads) in a session.")]
    async fn get_thread_episodes(
        &self,
        Parameters(params): Parameters<GetThreadEpisodesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let store_path = self.manager.store_info().store_path;
        let session_id = params.session_id;
        let thread_name = params.thread_name;
        let result = tokio::task::spawn_blocking(move || {
            if let Some(thread_name) = thread_name {
                nac_core::store::thread_read(&store_path, &session_id, &thread_name)
                    .map(|episodes| {
                        let entries: Vec<_> = episodes
                            .iter()
                            .map(|e| {
                                json!({
                                    "thread_name": e.thread_name,
                                    "action": e.action,
                                    "content": e.content,
                                    "created_at": e.created_at,
                                })
                            })
                            .collect();
                        json!({ "episodes": entries })
                    })
            } else {
                nac_core::store::load_all_episodes(&store_path, &session_id).map(|grouped| {
                    let mut all: Vec<_> = Vec::new();
                    for (_thread, episodes) in &grouped {
                        for e in episodes {
                            all.push(json!({
                                "thread_name": e.thread_name,
                                "action": e.action,
                                "content": e.content,
                                "created_at": e.created_at,
                            }));
                        }
                    }
                    json!({ "episodes": all })
                })
            }
        })
        .await;
        match result {
            Ok(Ok(value)) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Ok(Err(e)) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "get_thread_events", description = "Get recent events for a thread (or all threads from the snapshot) in a session.")]
    async fn get_thread_events(
        &self,
        Parameters(params): Parameters<GetThreadEventsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = if let Some(thread_name) = params.thread_name {
            self.manager
                .thread_events(
                    &params.session_id,
                    &thread_name,
                    params.before_id,
                    params.limit.unwrap_or(24),
                )
                .await
                .map(|page| {
                    let events: Vec<_> = page
                        .events
                        .iter()
                        .map(|item| {
                            json!({
                                "id": item.id,
                                "created_at": item.created_at,
                                "event": item.event,
                            })
                        })
                        .collect();
                    json!({
                        "events": events,
                        "has_older": page.has_older,
                        "next_before_id": page.next_before_id,
                    })
                })
        } else {
            self.manager
                .snapshot(&params.session_id)
                .await
                .map(|snapshot| {
                    json!({
                        "thread_events": snapshot.thread_events,
                    })
                })
        };
        match result {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "session_action", description = "Perform a lifecycle action on a session: compact, cancel, delete, or revert.")]
    async fn session_action(
        &self,
        Parameters(params): Parameters<SessionActionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = match params.action.as_str() {
            "compact" => self
                .manager
                .compact_session(&params.session_id)
                .await
                .map(|r| serde_json::to_value(&r).unwrap_or(json!({"status": "done"})))
                .map_err(|e| anyhow::anyhow!("{e}")),
            "cancel" => self
                .manager
                .cancel_active_run(&params.session_id)
                .await
                .map(|_| json!({"status": "cancelled"}))
                .map_err(|e| anyhow::anyhow!("{e}")),
            "delete" => self
                .manager
                .delete_session(&params.session_id)
                .await
                .map(|_| json!({"status": "deleted"}))
                .map_err(|e| anyhow::anyhow!("{e}")),
            "revert" => {
                let message_idx = params.message_idx.ok_or_else(|| {
                    anyhow::anyhow!("message_idx is required for revert action")
                });
                match message_idx {
                    Ok(idx) => self
                        .manager
                        .revert_session(&params.session_id, idx)
                        .await
                        .map(|r| serde_json::to_value(&r).unwrap_or(json!({"status": "reverted"})))
                        .map_err(|e| anyhow::anyhow!("{e}")),
                    Err(e) => Err(e),
                }
            }
            other => Err(anyhow::anyhow!(
                "unknown action '{other}': expected compact, cancel, delete, or revert"
            )),
        };
        match result {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|e| format!("Error serializing: {e}")),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {e}"
            ))])),
        }
    }

    #[tool(name = "update_session", description = "Update model configuration for an inactive session.")]
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
        };
        match self
            .manager
            .update_session_config(&params.session_id, request)
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

    #[tool(name = "list_models", description = "List available model providers and their models.")]
    async fn list_models(&self) -> Result<CallToolResult, ErrorData> {
        let listing = nac_core::model::api_listing();
        let providers: Vec<_> = listing
            .providers
            .iter()
            .map(|p| {
                let models: Vec<_> = p
                    .models
                    .iter()
                    .map(|m| {
                        json!({
                            "id": m.id,
                            "display_name": m.display_name,
                            "context_window": m.context_window,
                        })
                    })
                    .collect();
                json!({
                    "id": p.id,
                    "models": models,
                })
            })
            .collect();
        let result = json!({ "providers": providers });
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error serializing: {e}")),
        )]))
    }
}

#[tool_handler]
impl ServerHandler for NacMcpService {}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

pub fn streamable_http_service(
    manager: SessionManager,
) -> StreamableHttpService<NacMcpService, LocalSessionManager> {
    StreamableHttpService::new(
        move || Ok(NacMcpService { manager: manager.clone() }),
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
        nac_core::types::Message::System { content } => content.clone(),
        nac_core::types::Message::User { content } => content.clone(),
        nac_core::types::Message::Assistant { content, .. } => {
            content.clone().unwrap_or_default()
        }
        nac_core::types::Message::Tool { content, .. } => content.clone(),
    }
}
