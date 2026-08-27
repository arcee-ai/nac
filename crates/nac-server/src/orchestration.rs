//! Protocol-independent session operations shared by the outgoing MCP adapter
//! and the native direct-with-orchestrator controller.

use anyhow::{anyhow, Result};
use nac_core::session_service::{
    MessagePageRequest, MessagesPageSnapshot, SessionFrontendSnapshot,
};
use serde_json::{json, Value};

use crate::{
    CreateSessionRequest, OrchestratorSteeringRequest, SessionManager, SubmitPromptRequest,
    SubmitPromptResponse, ThreadSteeringRequest, UpdateConfigRequest,
};

#[derive(Clone)]
pub(crate) struct OrchestrationOperations {
    manager: SessionManager,
}

impl OrchestrationOperations {
    pub(crate) fn new(manager: SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> Result<SessionFrontendSnapshot> {
        self.manager.create_session(request).await
    }

    pub(crate) async fn list_sessions(
        &self,
        include_workspace_stats: bool,
    ) -> Result<Vec<crate::ManagedSessionSummary>> {
        self.manager
            .session_catalog()
            .list(include_workspace_stats)
            .await
    }

    pub(crate) async fn snapshot(&self, session_id: &str) -> Result<SessionFrontendSnapshot> {
        self.manager.snapshot(session_id).await
    }

    pub(crate) async fn submit_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
    ) -> Result<SubmitPromptResponse> {
        self.manager.submit_prompt(session_id, request).await
    }

    pub(crate) async fn steer(
        &self,
        session_id: &str,
        instruction: String,
        thread_name: Option<String>,
    ) -> Result<Value> {
        if let Some(thread_name) = thread_name {
            let response = self
                .manager
                .queue_thread_steering(
                    session_id,
                    &thread_name,
                    ThreadSteeringRequest { instruction },
                )
                .await?;
            Ok(json!({
                "steering_id": response.steering_id,
                "status": response.status,
            }))
        } else {
            let response = self
                .manager
                .queue_orchestrator_steering(
                    session_id,
                    OrchestratorSteeringRequest { instruction },
                )
                .await?;
            Ok(json!({
                "steering_id": response.steering_id,
                "status": response.status,
            }))
        }
    }

    pub(crate) async fn messages_page(
        &self,
        session_id: &str,
        request: MessagePageRequest,
    ) -> Result<MessagesPageSnapshot> {
        self.manager.messages_page(session_id, request).await
    }

    pub(crate) async fn thread_episodes(
        &self,
        session_id: &str,
        thread_name: Option<String>,
    ) -> Result<Value> {
        let store_path = self.manager.store_info().store_path;
        let session_id = session_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut all = if let Some(thread_name) = thread_name {
                nac_core::store::thread_read(&store_path, &session_id, &thread_name)?
            } else {
                nac_core::store::load_all_retained_episodes(&store_path, &session_id)?
                    .into_values()
                    .flatten()
                    .collect()
            };
            all.sort_by(|left, right| {
                left.thread_name
                    .cmp(&right.thread_name)
                    .then(left.id.cmp(&right.id))
            });
            Ok(json!({
                "episodes": all.into_iter().map(|episode| json!({
                    "id": episode.id,
                    "thread_name": episode.thread_name,
                    "action": episode.action,
                    "content": episode.content,
                    "status": episode.status,
                    "created_at": episode.created_at,
                })).collect::<Vec<_>>()
            }))
        })
        .await
        .map_err(|error| anyhow!("episode read task failed: {error}"))?
    }

    pub(crate) async fn thread_events(
        &self,
        session_id: &str,
        thread_name: Option<String>,
        before_id: Option<i64>,
        limit: usize,
    ) -> Result<Value> {
        if let Some(thread_name) = thread_name {
            let page = self
                .manager
                .thread_events(session_id, &thread_name, before_id, limit)
                .await?;
            Ok(json!({
                "events": page.events.into_iter().map(|item| json!({
                    "id": item.id,
                    "created_at": item.created_at,
                    "event": item.event,
                })).collect::<Vec<_>>(),
                "has_older": page.has_older,
                "next_before_id": page.next_before_id,
            }))
        } else {
            let snapshot = self.manager.snapshot(session_id).await?;
            Ok(json!({ "thread_events": snapshot.thread_events }))
        }
    }

    pub(crate) async fn session_action(
        &self,
        session_id: &str,
        action: &str,
        message_idx: Option<usize>,
    ) -> Result<Value> {
        match action {
            "compact" => self
                .manager
                .compact_session(session_id)
                .await
                .map(|response| serde_json::to_value(response).unwrap_or(json!({"status":"done"})))
                .map_err(anyhow::Error::new),
            "cancel" => self
                .manager
                .cancel_active_run(session_id)
                .await
                .map(|()| json!({"status":"cancelled"})),
            "delete" => self
                .manager
                .delete_session(session_id)
                .await
                .map(|()| json!({"status":"deleted"})),
            "revert" => {
                let index = message_idx
                    .ok_or_else(|| anyhow!("message_idx is required for revert action"))?;
                self.manager
                    .revert_session(session_id, index)
                    .await
                    .map(|response| {
                        serde_json::to_value(response).unwrap_or(json!({"status":"reverted"}))
                    })
                    .map_err(anyhow::Error::new)
            }
            other => Err(anyhow!(
                "unknown action '{other}': expected compact, cancel, delete, or revert"
            )),
        }
    }

    pub(crate) async fn update_session(
        &self,
        session_id: &str,
        request: UpdateConfigRequest,
    ) -> Result<()> {
        self.manager
            .update_session_config(session_id, request)
            .await
    }

    pub(crate) fn model_listing() -> Value {
        let listing = nac_core::model::api_listing();
        json!(listing
            .providers
            .iter()
            .map(|provider| json!({
                "provider": provider.id.as_str(),
                "models": provider.models.iter().map(|model| json!({
                    "id": model.id,
                    "display_name": model.display_name,
                    "context_window": model.context_window,
                    "reasoning": model.reasoning,
                    "supported_efforts": model.supported_efforts.iter()
                        .map(|effort| effort.as_str().to_string())
                        .collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            }))
            .collect::<Vec<_>>())
    }
}
