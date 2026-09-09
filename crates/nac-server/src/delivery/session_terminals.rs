use axum::{extract::Path as AxumPath, extract::State, http::StatusCode};

use crate::{ApiError, ApiErrorBody, SessionManager};

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/terminals/{terminal_id}",
    operation_id = "delete_sessions_session_id_terminals_terminal_id",
    tag = "conversation",
    params(
        ("session_id" = String, Path),
        ("terminal_id" = String, Path),
    ),
    responses(
        (status = 204, description = "Terminal stopped; repeated requests for the same current-service handle are safe"),
        (status = 400, description = "Path extraction or terminal identity validation failed", body = String, content_type = "text/plain"),
        (status = 404, description = "Session or terminal was not found", body = ApiErrorBody, content_type = "application/json"),
        (status = 409, description = "Terminal belongs to another or previous service owner", body = ApiErrorBody, content_type = "application/json"),
        (status = 500, description = "Terminal cleanup failed", body = ApiErrorBody, content_type = "application/json"),
    )
)]
pub(crate) async fn terminate_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, terminal_id)): AxumPath<(String, String)>,
) -> std::result::Result<StatusCode, ApiError> {
    manager
        .terminate_terminal(&session_id, &terminal_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
