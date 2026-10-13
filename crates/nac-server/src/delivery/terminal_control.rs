//! Revision-fenced human ownership actions over an exact execution incarnation.
use super::user_terminals::{cursor, version};
use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    Json,
};
use nac_core::session_service::{InputControlStatus, InputController, InputDeliveryReceipt};
use serde::Deserialize;
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct TransferTerminalControlRequest {
    pub protocol_version: u8,
    pub expected_revision: String,
    pub controller: InputController,
    pub acknowledge_uncertainty: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ControlledTerminalInputRequest {
    pub protocol_version: u8,
    pub expected_revision: String,
    pub bytes: Vec<u8>,
}

#[utoipa::path(get, path = "/sessions/{session_id}/executions/{execution_id}/input-control", operation_id = "get_sessions_session_id_executions_execution_id_input_control", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path)), responses((status = 200, description = "Current input owner and exact decimal revision", body = InputControlStatus), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Read-only or unavailable incarnation", body = ApiErrorBody)))]
pub(crate) async fn status(
    State(manager): State<SessionManager>,
    Path((session, id)): Path<(String, String)>,
) -> Result<Json<InputControlStatus>, ApiError> {
    Ok(Json(
        manager
            .session_terminals()
            .input_control(&session, &id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/sessions/{session_id}/executions/{execution_id}/input-control", operation_id = "post_sessions_session_id_executions_execution_id_input_control", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path)), request_body = TransferTerminalControlRequest, responses((status = 200, description = "Controller revision advanced; an in-flight write may require acknowledgement", body = InputControlStatus), (status = 400, description = "Invalid version or revision", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Controller changed or execution read-only", body = ApiErrorBody)))]
pub(crate) async fn transfer(
    State(manager): State<SessionManager>,
    Path((session, id)): Path<(String, String)>,
    payload: Result<Json<TransferTerminalControlRequest>, JsonRejection>,
) -> Result<Json<InputControlStatus>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    Ok(Json(
        manager
            .session_terminals()
            .transfer_input_control(
                &session,
                &id,
                cursor(&request.expected_revision)?,
                request.controller,
                request.acknowledge_uncertainty,
            )
            .await?,
    ))
}

#[utoipa::path(post, path = "/sessions/{session_id}/executions/{execution_id}/input", operation_id = "post_sessions_session_id_executions_execution_id_input", tag = "conversation",
    params(("session_id" = String, Path), ("execution_id" = String, Path)), request_body = ControlledTerminalInputRequest, responses((status = 200, description = "Explicit written, rejected-before-write or accepted-unconfirmed receipt", body = InputDeliveryReceipt), (status = 400, description = "Malformed or over-limit input", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Stale controller, read-only source or uncertain delivery; never replay", body = ApiErrorBody)))]
pub(crate) async fn input(
    State(manager): State<SessionManager>,
    Path((session, id)): Path<(String, String)>,
    payload: Result<Json<ControlledTerminalInputRequest>, JsonRejection>,
) -> Result<Json<InputDeliveryReceipt>, ApiError> {
    let Json(request) = payload?;
    version(request.protocol_version)?;
    let receipt = manager
        .session_terminals()
        .controlled_input(
            &session,
            &id,
            cursor(&request.expected_revision)?,
            &request.bytes,
        )
        .await?;
    Ok(Json(receipt))
}
