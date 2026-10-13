use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{Path, State},
    Json,
};
use nac_core::session_service::ExecutionHistory;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub(crate) struct ExecutionHistoryResponse {
    pub protocol_version: u8,
    pub history: ExecutionHistory,
}

#[utoipa::path(get, path = "/sessions/{session_id}/executions/history", operation_id = "get_sessions_session_id_executions_history", tag = "conversation",
    params(("session_id" = String, Path)), responses((status = 200, description = "Bounded existing activity and canonical command previews without recovery", body = ExecutionHistoryResponse), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Owner unavailable", body = ApiErrorBody)))]
pub(crate) async fn list(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
) -> Result<Json<ExecutionHistoryResponse>, ApiError> {
    Ok(Json(ExecutionHistoryResponse {
        protocol_version: 1,
        history: manager
            .session_terminals()
            .execution_history(&session_id)
            .await?,
    }))
}
