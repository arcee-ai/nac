//! Versioned finite byte-pull transport. Mutating acknowledgements use POST,
//! so the existing browser Origin/Fetch Metadata admission applies to them.

use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::application::terminal_observation::{RenderAcknowledgement, TerminalFrame};
use crate::{ApiError, ApiErrorBody, SessionManager};
use nac_core::session_service::UserTerminalStatus;

const VERSION: u8 = 1;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct OpenUserTerminalRequest {
    #[schema(minimum = 1, maximum = 1)]
    pub protocol_version: u8,
    pub launch_id: String,
    #[schema(minimum = 2, maximum = 500)]
    pub cols: u16,
    #[schema(minimum = 1, maximum = 300)]
    pub rows: u16,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct UserTerminalResponse {
    pub protocol_version: u8,
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
    pub alive: bool,
    pub exit_code: Option<i32>,
    pub output_complete: bool,
    pub output_error: Option<String>,
}

impl From<UserTerminalStatus> for UserTerminalResponse {
    fn from(status: UserTerminalStatus) -> Self {
        Self {
            protocol_version: VERSION,
            terminal_id: status.id,
            cols: status.cols,
            rows: status.rows,
            alive: status.alive,
            exit_code: status.exit_code,
            output_complete: status.output_complete,
            output_error: status.output_error,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub(crate) struct UserTerminalListResponse {
    pub protocol_version: u8,
    pub terminals: Vec<UserTerminalResponse>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct AttachUserTerminalRequest {
    pub protocol_version: u8,
    #[schema(minimum = 1, maximum = 65536)]
    pub page_limit: u32,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct UserTerminalObserverResponse {
    pub protocol_version: u8,
    pub observer_id: String,
    pub idle_expiry_ms: u32,
    pub terminal: UserTerminalResponse,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct PullUserTerminalRequest {
    pub protocol_version: u8,
    /// Exact decimal byte cursor of the frame the renderer finished processing.
    pub acknowledge_offset: Option<String>,
    /// A replay gap must be acknowledged only after resetting the renderer.
    pub acknowledge_reset: bool,
    #[schema(minimum = 0, maximum = 1000)]
    pub wait_ms: u16,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct UserTerminalFrameResponse {
    pub protocol_version: u8,
    pub observer_id: String,
    pub terminal: UserTerminalResponse,
    /// Sanitized bytes, with no UTF-8 or key-name conversion at delivery.
    pub bytes: Vec<u8>,
    /// Decimal strings preserve exact u64 cursors in JavaScript consumers.
    pub offset: String,
    pub next_offset: String,
    pub retained_start: String,
    pub retained_end: String,
    pub gap: bool,
    pub caught_up: bool,
    pub requires_ack: bool,
}

impl UserTerminalFrameResponse {
    fn from_frame(observer_id: Uuid, frame: TerminalFrame) -> Self {
        Self {
            protocol_version: VERSION,
            observer_id: observer_id.to_string(),
            terminal: frame.terminal.into(),
            bytes: frame.page.bytes,
            offset: frame.page.offset.to_string(),
            next_offset: frame.page.next_offset.to_string(),
            retained_start: frame.page.retained_start.to_string(),
            retained_end: frame.page.retained_end.to_string(),
            gap: frame.page.gap,
            caught_up: frame.page.caught_up,
            requires_ack: frame.requires_ack,
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct UserTerminalInputRequest {
    pub protocol_version: u8,
    pub bytes: Vec<u8>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResizeUserTerminalRequest {
    pub protocol_version: u8,
    pub cols: u16,
    pub rows: u16,
}

fn version(version: u8) -> Result<(), ApiError> {
    if version == VERSION {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "unsupported terminal protocol version".into(),
        ))
    }
}
fn identifier(id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(id)
        .map_err(|_| ApiError::bad_request("invalid terminal launch/observer identity".into()))
}

fn cursor(value: &str) -> Result<u64, ApiError> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(ApiError::bad_request(
            "invalid decimal terminal acknowledgement cursor".into(),
        ));
    }
    value.parse::<u64>().map_err(|_| {
        ApiError::bad_request("invalid decimal terminal acknowledgement cursor".into())
    })
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-terminals", operation_id = "post_sessions_session_id_user_terminals", tag = "conversation",
    params(("session_id" = String, Path)), request_body = OpenUserTerminalRequest,
    responses((status = 200, description = "Session-owned shell opened or live launch retried", body = UserTerminalResponse),
        (status = 400, description = "Malformed request/version", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody),
        (status = 409, description = "Launch rejected by policy, ownership, configuration or capacity", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn open(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
    payload: Result<Json<OpenUserTerminalRequest>, JsonRejection>,
) -> Result<Json<UserTerminalResponse>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    Ok(Json(
        manager
            .session_terminals()
            .open_user(
                &session_id,
                identifier(&request.launch_id)?,
                request.cols,
                request.rows,
            )
            .await?
            .into(),
    ))
}

#[utoipa::path(get, path = "/sessions/{session_id}/user-terminals", operation_id = "get_sessions_session_id_user_terminals", tag = "conversation",
    params(("session_id" = String, Path)), responses((status = 200, description = "Live and bounded completed human terminals", body = UserTerminalListResponse), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn list(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
) -> Result<Json<UserTerminalListResponse>, ApiError> {
    Ok(Json(UserTerminalListResponse {
        protocol_version: VERSION,
        terminals: manager
            .session_terminals()
            .list_users(&session_id)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    }))
}

#[utoipa::path(get, path = "/sessions/{session_id}/user-terminals/{terminal_id}", operation_id = "get_sessions_session_id_user_terminals_terminal_id", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path)), responses((status = 200, description = "Process and output completion are distinct", body = UserTerminalResponse), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Terminal unavailable for this owner", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn status(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id)): Path<(String, String)>,
) -> Result<Json<UserTerminalResponse>, ApiError> {
    Ok(Json(
        manager
            .session_terminals()
            .user_status(&session_id, &terminal_id)
            .await?
            .into(),
    ))
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-terminals/{terminal_id}/observers", operation_id = "post_sessions_session_id_user_terminals_terminal_id_observers", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path)), request_body = AttachUserTerminalRequest,
    responses((status = 200, description = "Independent observer attached; no shell creation or lifetime change", body = UserTerminalObserverResponse), (status = 400, description = "Malformed request/version", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Terminal unavailable for this owner", body = ApiErrorBody), (status = 429, description = "Observer capacity reached", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn attach(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id)): Path<(String, String)>,
    payload: Result<Json<AttachUserTerminalRequest>, JsonRejection>,
) -> Result<Json<UserTerminalObserverResponse>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    let (observer_id, terminal) = manager
        .session_terminals()
        .attach_user(&session_id, &terminal_id, request.page_limit as usize)
        .await?;
    Ok(Json(UserTerminalObserverResponse {
        protocol_version: VERSION,
        observer_id: observer_id.to_string(),
        idle_expiry_ms: 30_000,
        terminal: terminal.into(),
    }))
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-terminals/{terminal_id}/observers/{observer_id}/read", operation_id = "post_sessions_session_id_user_terminals_terminal_id_observers_observer_id_read", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path), ("observer_id" = String, Path)), request_body = PullUserTerminalRequest,
    responses((status = 200, description = "One immutable sanitized frame; pending frames replay until renderer acknowledgement. Gaps carry no bytes and require a reset acknowledgement.", body = UserTerminalFrameResponse), (status = 400, description = "Malformed version/acknowledgement/bounds", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Terminal/observer unavailable for this owner", body = ApiErrorBody), (status = 429, description = "Concurrent observer request", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn pull(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id, observer_id)): Path<(String, String, String)>,
    payload: Result<Json<PullUserTerminalRequest>, JsonRejection>,
) -> Result<Json<UserTerminalFrameResponse>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    let acknowledgement = request
        .acknowledge_offset
        .map(|offset| {
            cursor(&offset).map(|offset| RenderAcknowledgement {
                offset,
                reset: request.acknowledge_reset,
            })
        })
        .transpose()?;
    if acknowledgement.is_none() && request.acknowledge_reset {
        return Err(ApiError::bad_request(
            "reset acknowledgement requires a cursor".into(),
        ));
    }
    let observer_id = identifier(&observer_id)?;
    let frame = manager
        .session_terminals()
        .pull_user(
            &session_id,
            &terminal_id,
            observer_id,
            acknowledgement,
            request.wait_ms,
        )
        .await?;
    Ok(Json(UserTerminalFrameResponse::from_frame(
        observer_id,
        frame,
    )))
}

#[utoipa::path(delete, path = "/sessions/{session_id}/user-terminals/{terminal_id}/observers/{observer_id}", operation_id = "delete_sessions_session_id_user_terminals_terminal_id_observers_observer_id", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path), ("observer_id" = String, Path)), responses((status = 204, description = "Observation detached idempotently; shell and agent remain live"), (status = 400, description = "Malformed observer identity", body = ApiErrorBody)))]
pub(crate) async fn detach(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id, observer_id)): Path<(String, String, String)>,
) -> Result<StatusCode, ApiError> {
    manager
        .session_terminals()
        .detach_user(&session_id, &terminal_id, identifier(&observer_id)?);
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-terminals/{terminal_id}/input", operation_id = "post_sessions_session_id_user_terminals_terminal_id_input", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path)), request_body = UserTerminalInputRequest,
    responses((status = 204, description = "Literal bytes delivered; no key-name or Enter policy parsing"), (status = 400, description = "Malformed request/version or input exceeds 16 KiB", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Input unavailable, queue full, or accepted delivery unconfirmed; never automatically retry bytes", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn input(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id)): Path<(String, String)>,
    payload: Result<Json<UserTerminalInputRequest>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    manager
        .session_terminals()
        .input_user(&session_id, &terminal_id, &request.bytes)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-terminals/{terminal_id}/resize", operation_id = "post_sessions_session_id_user_terminals_terminal_id_resize", tag = "conversation",
    params(("session_id" = String, Path), ("terminal_id" = String, Path)), request_body = ResizeUserTerminalRequest,
    responses((status = 204, description = "Geometry applied to the owned PTY"), (status = 400, description = "Malformed request/version or geometry", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Terminal mutation unavailable", body = ApiErrorBody), (status = 500, description = "Internal failure", body = ApiErrorBody)))]
pub(crate) async fn resize(
    State(manager): State<SessionManager>,
    Path((session_id, terminal_id)): Path<(String, String)>,
    payload: Result<Json<ResizeUserTerminalRequest>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    manager
        .session_terminals()
        .resize_user(&session_id, &terminal_id, request.cols, request.rows)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
