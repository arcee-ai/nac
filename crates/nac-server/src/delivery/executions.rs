//! Existing executions use the same bounded byte/ACK observer contract.
use super::user_terminals::{
    cursor, identifier, version, AttachUserTerminalRequest, PullUserTerminalRequest,
    UserTerminalFrameResponse, UserTerminalObserverResponse,
};
use crate::application::terminal_observation::{RenderAcknowledgement, TerminalFrame};
use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::StatusCode,
    Json,
};
use nac_core::session_service::{ExecutionStatus, UserTerminalStatus};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub(crate) struct ExecutionListResponse {
    pub protocol_version: u8,
    pub executions: Vec<ExecutionStatus>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ExecutionOutputSegment {
    pub stream: String,
    pub sequence: String,
    pub combined_start: String,
    pub combined_end: String,
    pub stream_start: String,
    pub stream_end: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ExecutionFrameResponse {
    pub protocol_version: u8,
    pub observer_id: String,
    pub terminal: super::user_terminals::UserTerminalResponse,
    pub execution: ExecutionStatus,
    pub bytes: Vec<u8>,
    pub offset: String,
    pub next_offset: String,
    pub retained_start: String,
    pub retained_end: String,
    pub gap: bool,
    pub caught_up: bool,
    pub requires_ack: bool,
    pub segments: Vec<ExecutionOutputSegment>,
}

impl ExecutionFrameResponse {
    fn from_frame(observer: uuid::Uuid, frame: TerminalFrame) -> Result<Self, ApiError> {
        let execution = frame
            .execution
            .clone()
            .ok_or_else(|| ApiError::bad_request("execution observer unavailable".into()))?;
        let segments = frame
            .page
            .segments
            .iter()
            .map(|segment| ExecutionOutputSegment {
                stream: serde_json::to_value(segment.stream)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                sequence: segment.sequence.to_string(),
                combined_start: segment.combined_start.to_string(),
                combined_end: segment.combined_end.to_string(),
                stream_start: segment.stream_start.to_string(),
                stream_end: segment.stream_end.to_string(),
            })
            .collect();
        let wire = UserTerminalFrameResponse::from_frame(observer, frame);
        Ok(Self {
            protocol_version: wire.protocol_version,
            observer_id: wire.observer_id,
            terminal: wire.terminal,
            execution,
            bytes: wire.bytes,
            offset: wire.offset,
            next_offset: wire.next_offset,
            retained_start: wire.retained_start,
            retained_end: wire.retained_end,
            gap: wire.gap,
            caught_up: wire.caught_up,
            requires_ack: wire.requires_ack,
            segments,
        })
    }
}

// Keep the established transport shape so the native observation state machine
// can serve every source without duplicating ACK/replay/disposal ownership.
#[utoipa::path(get, path = "/sessions/{session_id}/executions", operation_id = "get_sessions_session_id_executions", tag = "conversation",
    params(("session_id" = String, Path)), responses((status = 200, description = "Existing current-chat executions without attachment or recovery", body = ExecutionListResponse), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Owner unavailable", body = ApiErrorBody)))]
pub(crate) async fn list(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
) -> Result<Json<ExecutionListResponse>, ApiError> {
    Ok(Json(ExecutionListResponse {
        protocol_version: 1,
        executions: manager
            .session_terminals()
            .list_executions(&session_id)
            .await?,
    }))
}

#[utoipa::path(post, path = "/sessions/{session_id}/executions/{execution_id}/observers", operation_id = "post_sessions_session_id_executions_execution_id_observers", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path)), request_body = AttachUserTerminalRequest,
    responses((status = 200, description = "Attach observer to same existing execution", body = UserTerminalObserverResponse), (status = 400, description = "Invalid protocol/bounds", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Execution unavailable", body = ApiErrorBody), (status = 429, description = "Observer capacity", body = ApiErrorBody)))]
pub(crate) async fn attach(
    State(manager): State<SessionManager>,
    Path((session, id)): Path<(String, String)>,
    payload: Result<Json<AttachUserTerminalRequest>, JsonRejection>,
) -> Result<Json<UserTerminalObserverResponse>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    let (observer, execution) = manager
        .session_terminals()
        .attach_execution(&session, &id, request.page_limit as usize)
        .await?;
    Ok(Json(UserTerminalObserverResponse {
        protocol_version: 1,
        observer_id: observer.to_string(),
        idle_expiry_ms: 30_000,
        terminal: UserTerminalStatus {
            id: execution.id,
            cols: execution.cols,
            rows: execution.rows,
            alive: execution.alive,
            exit_code: execution.exit_code,
            output_complete: execution.output_complete,
            output_error: execution.output_error,
        }
        .into(),
    }))
}

#[utoipa::path(post, path = "/sessions/{session_id}/executions/{execution_id}/observers/{observer_id}/read", operation_id = "post_sessions_session_id_executions_execution_id_observers_observer_id_read", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path), ("observer_id" = String, Path)), request_body = PullUserTerminalRequest,
    responses((status = 200, description = "Immutable sanitized frame until render ACK; gap needs reset", body = ExecutionFrameResponse), (status = 400, description = "Invalid acknowledgement", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Observer unavailable", body = ApiErrorBody), (status = 429, description = "Concurrent read", body = ApiErrorBody)))]
pub(crate) async fn pull(
    State(manager): State<SessionManager>,
    Path((session, id, observer)): Path<(String, String, String)>,
    payload: Result<Json<PullUserTerminalRequest>, JsonRejection>,
) -> Result<Json<ExecutionFrameResponse>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    let ack = request
        .acknowledge_offset
        .map(|offset| {
            cursor(&offset).map(|offset| RenderAcknowledgement {
                offset,
                reset: request.acknowledge_reset,
            })
        })
        .transpose()?;
    if ack.is_none() && request.acknowledge_reset {
        return Err(ApiError::bad_request("reset requires a cursor".into()));
    }
    let observer = identifier(&observer)?;
    let frame = manager
        .session_terminals()
        .pull_execution(&session, &id, observer, ack, request.wait_ms)
        .await?;
    Ok(Json(ExecutionFrameResponse::from_frame(observer, frame)?))
}

#[utoipa::path(delete, path = "/sessions/{session_id}/executions/{execution_id}/observers/{observer_id}", operation_id = "delete_sessions_session_id_executions_execution_id_observers_observer_id", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path), ("observer_id" = String, Path)), responses((status = 204, description = "Detach observation only"), (status = 400, description = "Invalid observer", body = ApiErrorBody)))]
pub(crate) async fn detach(
    State(manager): State<SessionManager>,
    Path((session, id, observer)): Path<(String, String, String)>,
) -> Result<StatusCode, ApiError> {
    manager
        .session_terminals()
        .detach_user(&session, &id, identifier(&observer)?)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/sessions/{session_id}/executions/{execution_id}/stop", operation_id = "post_sessions_session_id_executions_execution_id_stop", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path)), responses((status = 204, description = "Stop only the selected owned execution"), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Execution unavailable", body = ApiErrorBody)))]
pub(crate) async fn stop(
    State(manager): State<SessionManager>,
    Path((session, id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    manager
        .session_terminals()
        .stop_execution(&session, &id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
