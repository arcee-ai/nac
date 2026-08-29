//! Continue a conversation in the other session type.
//!
//! Unlike fork, this does not copy the source transcript or its tool history.
//! The new session lands idle with a projected prose brief and waits for the
//! user's first prompt.

use axum::{
    extract::{Path as AxumPath, State},
    response::{IntoResponse, Response},
    Json,
};
use nac_core::{session_handoffs, sessions, store, traditional_children, types::Message};
use serde::{Deserialize, Serialize};

use crate::{ApiErrorBody, SessionManager};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ContinueSessionRequest {
    /// Transcript index of the assistant message to project through.
    pub message_idx: usize,
    /// The other session type. Agent sources continue in NAC; NAC sources
    /// continue in Agent.
    pub target_behavior: sessions::SessionBehavior,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct ContinueSessionResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContinueSessionError {
    NotFound,
    Busy,
    Rejected(String),
    Failed,
}

impl std::fmt::Display for ContinueSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("session not found"),
            Self::Busy => formatter.write_str("session is busy"),
            Self::Rejected(message) => formatter.write_str(message),
            Self::Failed => formatter.write_str("continue failed"),
        }
    }
}

impl std::error::Error for ContinueSessionError {}

impl IntoResponse for ContinueSessionError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Busy => axum::http::StatusCode::CONFLICT,
            Self::Rejected(_) => axum::http::StatusCode::BAD_REQUEST,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ApiErrorBody {
                error: self.to_string(),
            }),
        )
            .into_response()
    }
}

impl SessionManager {
    pub async fn continue_session(
        &self,
        session_id: &str,
        message_idx: usize,
        target_behavior: sessions::SessionBehavior,
    ) -> Result<ContinueSessionResponse, ContinueSessionError> {
        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "verify persisted session", &error))?
        {
            return Err(ContinueSessionError::NotFound);
        }
        if self
            .assignment_is_open(session_id)
            .map_err(|error| report_failure(session_id, "verify assignment status", &error))?
        {
            return Err(ContinueSessionError::NotFound);
        }

        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)
                .map_err(|error| match error {
                    sessions::SessionOperationLeaseError::Busy(_) => ContinueSessionError::Busy,
                    sessions::SessionOperationLeaseError::Store(error) => {
                        report_failure(session_id, "acquire operation lease", &error)
                    }
                })?;

        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "recheck persisted session", &error))?
        {
            return Err(ContinueSessionError::NotFound);
        }
        if self
            .assignment_is_open(session_id)
            .map_err(|error| report_failure(session_id, "recheck assignment status", &error))?
        {
            return Err(ContinueSessionError::NotFound);
        }

        let source = sessions::load_session(&self.inner.store_path, session_id)
            .map_err(|error| report_failure(session_id, "load the source session", &error))?;
        let target = session_handoffs::validate_target_behavior(source.behavior, target_behavior)
            .map_err(|error| ContinueSessionError::Rejected(error.to_string()))?;

        let service = self
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await
            .map_err(|error| report_failure(session_id, "attach current session", &error))?;

        if service.has_active_operation() {
            return Err(ContinueSessionError::Busy);
        }

        let messages = service
            .messages_snapshot()
            .await
            .map_err(|error| report_failure(session_id, "read the transcript", &error))?;
        let working_directory = traditional_children::parent_prompt_working_directory(
            &source.cwd,
            source.sandbox_spec.as_ref(),
        );
        let projected = session_handoffs::project_handoff_messages(
            &messages,
            message_idx,
            session_id,
            target,
            &working_directory,
        )
        .map_err(|error| ContinueSessionError::Rejected(error.to_string()))?;

        let store_path = self.inner.store_path.clone();
        let source_id = session_id.to_string();
        let target_id = uuid::Uuid::new_v4().to_string();
        let persist_target_id = target_id.clone();
        tokio::task::spawn_blocking(move || {
            persist_handoff(
                &store_path,
                &source_id,
                &persist_target_id,
                source,
                target,
                projected,
                message_idx,
            )
        })
        .await
        .map_err(|error| report_failure(session_id, "persist the handoff", &error))??;

        drop(operation_lease);

        Ok(ContinueSessionResponse {
            session_id: target_id,
        })
    }
}

fn persist_handoff(
    store_path: &std::path::Path,
    source_id: &str,
    target_id: &str,
    source: sessions::SessionSnapshot,
    target_behavior: sessions::SessionBehavior,
    messages: Vec<Message>,
    message_idx: usize,
) -> Result<(), ContinueSessionError> {
    let source_behavior = source.behavior;
    let blob_len = leading_system_len(&messages);
    let mut target = sessions::new_snapshot(
        target_id.to_string(),
        source.cwd,
        source.model,
        source.base_url,
        source.backend,
        source.reasoning_effort,
        source.sandbox_spec,
        source.ssh,
        messages[..blob_len].to_vec(),
        source.api_key_env,
        source.extra_headers,
    );
    target.project_id = source.project_id;
    target.behavior = target_behavior;
    target.light_model = source.light_model;
    target.orchestrator_compaction_threshold = source.orchestrator_compaction_threshold;
    if let Some(spec) = target.sandbox_spec.as_mut() {
        spec.worktree = None;
    }

    sessions::create_session(store_path, &target)
        .map_err(|error| report_failure(source_id, "create the handoff session", &error))?;
    if let Err(error) = finish_persisted_handoff(
        store_path,
        source_id,
        target_id,
        source_behavior,
        target_behavior,
        &messages,
        message_idx,
    ) {
        if let Err(cleanup) = sessions::delete_session(store_path, target_id) {
            eprintln!(
                "nac: continue from session {source_id:?} failed after create; cleanup of {target_id:?} also failed: {cleanup}"
            );
        }
        return Err(error);
    }
    Ok(())
}

fn finish_persisted_handoff(
    store_path: &std::path::Path,
    source_id: &str,
    target_id: &str,
    source_behavior: sessions::SessionBehavior,
    target_behavior: sessions::SessionBehavior,
    messages: &[Message],
    message_idx: usize,
) -> Result<(), ContinueSessionError> {
    let blob_len = leading_system_len(messages);
    let start_idx = u64::try_from(blob_len)
        .map_err(|error| report_failure(source_id, "write the handoff transcript log", &error))?;
    store::TranscriptLogWriter::new(store_path)
        .and_then(|writer| writer.append_batch(target_id, start_idx, &messages[blob_len..]))
        .map_err(|error| report_failure(source_id, "write the handoff transcript log", &error))?;
    sessions::update_session_presentation(
        store_path,
        target_id,
        &handoff_presentation_title(target_behavior),
        false,
        0,
    )
    .map_err(|error| report_failure(source_id, "name the handoff session", &error))?;
    store::insert_session_handoff(
        store_path,
        &uuid::Uuid::new_v4().to_string(),
        source_id,
        target_id,
        message_idx,
        source_behavior,
        target_behavior,
    )
    .map_err(|error| report_failure(source_id, "record the handoff link", &error))?;
    Ok(())
}

fn leading_system_len(messages: &[Message]) -> usize {
    messages
        .iter()
        .take_while(|message| matches!(message, Message::System { .. }))
        .count()
}

fn handoff_presentation_title(target: sessions::SessionBehavior) -> String {
    if target.is_nac() {
        "Continue in NAC".to_string()
    } else {
        "Continue in Agent".to_string()
    }
}

fn report_failure(
    session_id: &str,
    operation: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> ContinueSessionError {
    eprintln!("nac: continue from session {session_id:?} failed to {operation}: {error}");
    ContinueSessionError::Failed
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/continue",
    operation_id = "post_sessions_session_id_continue",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = ContinueSessionRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ContinueSessionResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((crate::ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 413, description = "Request body too large", body = String, content_type = "text/plain"), (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"), (status = 422, description = "JSON body validation failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<ContinueSessionRequest>,
) -> Result<Json<ContinueSessionResponse>, ContinueSessionError> {
    Ok(Json(
        manager
            .continue_session(&session_id, request.message_idx, request.target_behavior)
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use nac_core::model::BackendKind;

    use super::*;

    fn assistant(content: &str) -> Message {
        Message::Assistant {
            content: Some(content.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![nac_core::types::ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: nac_core::types::FunctionCall {
                    name: "read".to_string(),
                    arguments: r#"{"path":"/hidden/src.rs"}"#.to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        }
    }

    #[test]
    fn persisted_handoff_is_other_type_without_tool_history() {
        let root = std::env::temp_dir().join(format!("nac-handoff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("store.db");
        store::initialize(&store_path).unwrap();
        let messages = vec![
            Message::System {
                content: "direct policy\n\nProject instruction: keep the API.".to_string(),
            },
            Message::User {
                content: "inspect the crate".to_string(),
            },
            assistant("done"),
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "secret tool output".into(),
            },
        ];
        let mut source = sessions::new_snapshot(
            "source".to_string(),
            root.clone(),
            "model".to_string(),
            "https://example.invalid/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            messages.clone(),
            None,
            BTreeMap::new(),
        );
        source.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(&store_path, &source).unwrap();

        let projected = session_handoffs::project_handoff_messages(
            &messages[..3],
            2,
            "source",
            sessions::SessionBehavior::Orchestrator,
            "/workspace",
        )
        .unwrap();
        persist_handoff(
            &store_path,
            "source",
            "target",
            source,
            sessions::SessionBehavior::Orchestrator,
            projected,
            2,
        )
        .unwrap();

        let target = sessions::load_session(&store_path, "target").unwrap();
        assert_eq!(target.behavior, sessions::SessionBehavior::Orchestrator);
        assert!(target.token_usages.iter().all(Option::is_none));
        let encoded = serde_json::to_string(&target.messages).unwrap();
        assert!(!encoded.contains("/hidden/src.rs"));
        assert!(!encoded.contains("secret tool output"));
        let tail = store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .read_tail_from("target", 1)
            .unwrap();
        let tail_encoded = serde_json::to_string(&tail).unwrap();
        assert!(!tail_encoded.contains("/hidden/src.rs"));
        assert!(!tail_encoded.contains("secret tool output"));
        assert!(tail.iter().any(|(_, message)| matches!(
            message,
            Message::User { content } if content.contains("Wait for the user's next instruction")
        )));
        let links = store::list_session_handoffs(&store_path, "source").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_session_id, "target");
        assert_eq!(
            links[0].target_behavior,
            sessions::SessionBehavior::Orchestrator
        );

        let _ = std::fs::remove_dir_all(root);
    }
}
