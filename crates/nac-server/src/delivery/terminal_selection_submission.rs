//! Explicit identified submission; no command preparation or raw-text persistence.
use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    Json,
};
use nac_core::store::{
    InboxDelivery, InboxStatus, TerminalSelectionDelivery, TerminalSelectionIntent,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct TerminalSelectionSubmissionRequest {
    pub protocol_version: u8,
    pub admission_id: String,
    pub capture_id: String,
    pub expected_owner_instance_id: String,
    pub client_capture_time_ms: Option<String>,
    pub original_selected_text: String,
    pub expected_selection_text: String,
    pub original_user_text: Option<String>,
    pub expected_user_text: Option<String>,
    pub delivery: TerminalSelectionDelivery,
    pub expected_run_id: Option<String>,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct TerminalSelectionSubmissionResponse {
    pub protocol_version: u8,
    pub admission_id: String,
    pub replayed: bool,
    pub inbox_id: String,
    /// Current mutable inbox state, separate from immutable accepted intent.
    pub status: InboxStatus,
    pub version: i64,
    pub current_delivery: InboxDelivery,
    pub current_target_run_id: Option<String>,
    pub delivered_run_id: Option<String>,
    pub accepted_intent: TerminalSelectionIntent,
}
fn uuid(value: &str) -> Result<String, ApiError> {
    let id = uuid::Uuid::parse_str(value)
        .map_err(|_| ApiError::bad_request("invalid selection UUID".into()))?;
    if id.to_string() != value.to_ascii_lowercase() {
        return Err(ApiError::bad_request(
            "selection identity must be a hyphenated UUID".into(),
        ));
    }
    Ok(id.to_string())
}
fn bounded(value: &str) -> Result<(), ApiError> {
    if value.len() > 32768 || value.chars().count() > 8192 {
        return Err(ApiError::bad_request(
            "selection text exceeds limits".into(),
        ));
    }
    Ok(())
}
#[utoipa::path(post, path="/sessions/{session_id}/user-terminals/{terminal_id}/selection-submissions",
    operation_id="post_sessions_session_id_user_terminals_terminal_id_selection_submissions", tag="conversation",
    params(("session_id"=String,Path),("terminal_id"=String,Path)), request_body=TerminalSelectionSubmissionRequest,
    responses((status=200,description="Durable intent receipt; replay never wakes or re-delivers",body=TerminalSelectionSubmissionResponse),
        (status=400,description="Invalid version, identity, text or delivery contract",body=ApiErrorBody),
        (status=409,description="Source, preview, delivery or immutable identity conflict",body=ApiErrorBody),
        (status=500,description="Persistence failure; reconcile the same identity",body=ApiErrorBody)))]
pub(crate) async fn submit(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id)): Path<(String, String)>,
    payload: Result<Json<TerminalSelectionSubmissionRequest>, JsonRejection>,
) -> Result<Json<TerminalSelectionSubmissionResponse>, ApiError> {
    let Json(request) = payload?;
    bounded(&request.original_selected_text)?;
    for value in request
        .original_user_text
        .iter()
        .chain(request.expected_user_text.iter())
    {
        bounded(value)?;
    }
    if request.original_user_text.is_some() != request.expected_user_text.is_some() {
        return Err(ApiError::bad_request(
            "user text requires its exact reviewed preview".into(),
        ));
    }
    let client_time = request
        .client_capture_time_ms
        .map(|time| {
            if time.len() > 20 || time.is_empty() || !time.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(ApiError::bad_request(
                    "invalid client capture-time claim".into(),
                ));
            }
            time.parse::<u64>()
                .map(|value| value.to_string())
                .map_err(|_| ApiError::bad_request("invalid client capture-time claim".into()))
        })
        .transpose()?;
    let intent = TerminalSelectionIntent {
        protocol_version: request.protocol_version,
        source_kind: nac_core::store::TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: uuid(&request.admission_id)?,
        capture_id: uuid(&request.capture_id)?,
        source_session_id: session_id,
        terminal_id,
        owner_instance_id: uuid(&request.expected_owner_instance_id)?,
        client_capture_time_ms: client_time,
        text: request.expected_selection_text,
        user_text: request.expected_user_text,
        initial_delivery: request.delivery,
        initial_expected_run_id: request.expected_run_id.map(|id| uuid(&id)).transpose()?,
    };
    intent
        .validate()
        .map_err(|_| ApiError::bad_request("invalid terminal selection intent".into()))?;
    let receipt = manager
        .terminal_selection()
        .submit(
            crate::application::terminal_selection::TerminalSelectionSubmission {
                intent,
                original_selected_text: request.original_selected_text,
                original_user_text: request.original_user_text,
            },
        )
        .await?;
    Ok(Json(TerminalSelectionSubmissionResponse {
        protocol_version: 1,
        admission_id: receipt.intent.admission_id.clone(),
        replayed: receipt.replayed,
        inbox_id: receipt.record.id.to_string(),
        status: receipt.record.status,
        version: receipt.record.version,
        current_delivery: receipt.record.delivery,
        current_target_run_id: receipt.record.target_run_id,
        delivered_run_id: receipt.record.delivered_run_id,
        accepted_intent: receipt.intent,
    }))
}
