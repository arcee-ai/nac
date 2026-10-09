//! A preview is user-supplied rendered text, not an authenticated byte interval.
//! It is not an admission receipt, and nothing here writes a draft or context.
use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    Json,
};
use nac_core::session_service::{
    MAX_TERMINAL_SELECTION_SCALARS, MAX_TERMINAL_SELECTION_UTF8_BYTES,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct TerminalSelectionPreviewRequest {
    #[schema(minimum = 1, maximum = 1)]
    pub protocol_version: u8,
    /// Client-assigned hyphenated UUID for one frozen selection, not execution authority.
    pub capture_id: String,
    /// Untrusted optional capture-time claim in exact decimal milliseconds.
    pub client_capture_time_ms: Option<String>,
    #[schema(max_length = 8192)]
    pub selected_text: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TerminalSelectionSourceKind {
    UserSuppliedRenderedSelection,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct TerminalSelectionPreviewResponse {
    pub protocol_version: u8,
    pub capture_id: String,
    pub source_kind: TerminalSelectionSourceKind,
    pub source_session_id: String,
    pub terminal_id: String,
    pub owner_instance_id: String,
    /// The client claim is retained as a claim, never an authoritative capture time.
    pub client_capture_time_ms: Option<String>,
    pub previewed_at_ms: String,
    pub text: String,
    pub input_utf8_bytes: u32,
    pub input_scalars: u32,
    pub text_utf8_bytes: u32,
    pub text_scalars: u32,
    pub controls_removed: u32,
    pub line_endings_normalized: u32,
    pub max_utf8_bytes: u32,
    pub max_scalars: u32,
    /// This endpoint rejects over-limit text; it never silently truncates.
    pub truncated: bool,
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-terminals/{terminal_id}/selection-preview",
    operation_id = "post_sessions_session_id_user_terminals_terminal_id_selection_preview", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path)),
    request_body = TerminalSelectionPreviewRequest,
    responses((status = 200, description = "Finite source-bound preview; no durable input or model run", body = TerminalSelectionPreviewResponse),
        (status = 400, description = "Malformed version/identity/time or text exceeds bounds", body = ApiErrorBody),
        (status = 409, description = "Source/session unavailable for this process owner", body = ApiErrorBody),
        (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn preview(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id)): Path<(String, String)>,
    payload: Result<Json<TerminalSelectionPreviewRequest>, JsonRejection>,
) -> Result<Json<TerminalSelectionPreviewResponse>, ApiError> {
    let Json(request) = payload?;
    if request.protocol_version != 1 {
        return Err(ApiError::bad_request(
            "unsupported terminal selection protocol version".into(),
        ));
    }
    let capture_id = Uuid::parse_str(&request.capture_id)
        .map_err(|_| ApiError::bad_request("invalid terminal selection capture identity".into()))?;
    if request.capture_id.to_ascii_lowercase() != capture_id.to_string() {
        return Err(ApiError::bad_request(
            "terminal selection capture identity must be a hyphenated UUID".into(),
        ));
    }
    let client_time = request
        .client_capture_time_ms
        .map(|value| {
            if value.len() > 20
                || value.is_empty()
                || !value.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(ApiError::bad_request(
                    "invalid client capture-time claim".into(),
                ));
            }
            value
                .parse::<u64>()
                .map(|time| time.to_string())
                .map_err(|_| ApiError::bad_request("invalid client capture-time claim".into()))
        })
        .transpose()?;
    let preview = manager
        .terminal_selection()
        .preview(&session_id, &terminal_id, &request.selected_text)
        .await?;
    let previewed_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(anyhow::Error::new)?
        .as_millis()
        .to_string();
    Ok(Json(TerminalSelectionPreviewResponse {
        protocol_version: 1,
        capture_id: capture_id.to_string(),
        source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        source_session_id: session_id,
        terminal_id: preview.terminal_id,
        owner_instance_id: preview.owner_instance_id,
        client_capture_time_ms: client_time,
        previewed_at_ms,
        text: preview.text,
        input_utf8_bytes: preview.input_utf8_bytes as u32,
        input_scalars: preview.input_scalars as u32,
        text_utf8_bytes: preview.text_utf8_bytes as u32,
        text_scalars: preview.text_scalars as u32,
        controls_removed: preview.controls_removed as u32,
        line_endings_normalized: preview.line_endings_normalized as u32,
        max_utf8_bytes: MAX_TERMINAL_SELECTION_UTF8_BYTES as u32,
        max_scalars: MAX_TERMINAL_SELECTION_SCALARS as u32,
        truncated: false,
    }))
}
