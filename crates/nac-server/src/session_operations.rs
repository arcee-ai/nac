//! Protocol-independent session operations used by the outgoing MCP adapter.

use anyhow::{anyhow, Result};
use nac_core::session_service::{
    MessagePageRequest, MessagesPageSnapshot, SessionFrontendSnapshot,
};
use serde_json::{json, Value};

use crate::{
    CreateInboxItemRequest, CreateSessionRequest, SessionManager, SubmitPromptRequest,
    SubmitPromptResponse, UpdateConfigRequest,
};

#[derive(Clone)]
pub(crate) struct SessionOperations {
    manager: SessionManager,
}

impl SessionOperations {
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
        self.manager
            .submit_prompt(
                session_id,
                request,
                nac_core::store::InputOrigin::Automation,
            )
            .await
    }

    pub(crate) async fn steer(&self, session_id: &str, instruction: String) -> Result<Value> {
        let response = self
            .manager
            .create_direct_inbox_item(
                session_id,
                CreateInboxItemRequest {
                    delivery: nac_core::store::InboxDelivery::Steer,
                    prompt: instruction,
                },
                nac_core::store::InputOrigin::Automation,
            )
            .await?;
        Ok(serde_json::to_value(response)?)
    }

    pub(crate) async fn messages_page(
        &self,
        session_id: &str,
        request: MessagePageRequest,
    ) -> Result<MessagesPageSnapshot> {
        self.manager.messages_page(session_id, request).await
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
