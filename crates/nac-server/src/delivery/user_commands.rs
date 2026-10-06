use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use nac_core::session_service::UserCommandSnapshot;

use crate::{
    application::user_commands::UserCommandOutputRequest, ApiError, ApiErrorBody, SessionManager,
    SubmitUserCommandRequest, UserCommandOutputPage, UserCommandOutputQuery,
};

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/user-commands",
    operation_id = "post_sessions_session_id_user_commands",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = SubmitUserCommandRequest, content_type = "application/json"),
    responses(
        (status = 202, description = "Command admitted", body = UserCommandSnapshot, content_type = "application/json"),
        (status = 200, description = "Request ID already admitted with the same command and timeout; current snapshot replayed", body = UserCommandSnapshot, content_type = "application/json"),
        (status = 400, description = "Invalid request or session is not a direct primary session", content((ApiErrorBody = "application/json"), (String = "text/plain"))),
        (status = 404, description = "Session not found or delegated", body = ApiErrorBody, content_type = "application/json"),
        (status = 409, description = "Session busy, or request ID reused with a different command or timeout", body = ApiErrorBody, content_type = "application/json"),
        (status = 413, description = "Request body too large", body = String, content_type = "text/plain"),
        (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"),
        (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"),
    )
)]
pub(crate) async fn submit_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: Result<Json<SubmitUserCommandRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<UserCommandSnapshot>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let (command, replayed) = manager
        .session_user_commands()
        .submit(&session_id, request.into_core())
        .await?;
    let status = if replayed {
        StatusCode::OK
    } else {
        StatusCode::ACCEPTED
    };
    Ok((status, Json(command)))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/user-commands/{request_id}",
    operation_id = "get_sessions_session_id_user_commands_request_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("request_id" = String, Path)),
    responses(
        (status = 200, description = "Current command snapshot", body = UserCommandSnapshot, content_type = "application/json"),
        (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"),
        (status = 404, description = "Session or command not found", body = ApiErrorBody, content_type = "application/json"),
        (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"),
    )
)]
pub(crate) async fn lookup_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, request_id)): AxumPath<(String, String)>,
) -> Result<Json<UserCommandSnapshot>, ApiError> {
    Ok(Json(
        manager
            .session_user_commands()
            .lookup(&session_id, &request_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/user-commands/{request_id}/cancel",
    operation_id = "post_sessions_session_id_user_commands_request_id_cancel",
    tag = "conversation",
    params(("session_id" = String, Path), ("request_id" = String, Path)),
    responses(
        (status = 200, description = "Cancellation requested for an active command, or terminal snapshot returned unchanged", body = UserCommandSnapshot, content_type = "application/json"),
        (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"),
        (status = 404, description = "Session or command not found", body = ApiErrorBody, content_type = "application/json"),
        (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"),
    )
)]
pub(crate) async fn cancel_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, request_id)): AxumPath<(String, String)>,
) -> Result<Json<UserCommandSnapshot>, ApiError> {
    Ok(Json(
        manager
            .session_user_commands()
            .cancel(&session_id, &request_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/user-commands/{request_id}/output",
    operation_id = "get_sessions_session_id_user_commands_request_id_output",
    tag = "conversation",
    params(("session_id" = String, Path), ("request_id" = String, Path), UserCommandOutputQuery),
    responses(
        (status = 200, description = "Redacted page of retained command output", body = UserCommandOutputPage, content_type = "application/json"),
        (status = 400, description = "Invalid stream, offset, or limit", content((ApiErrorBody = "application/json"), (String = "text/plain"))),
        (status = 404, description = "Session or command not found", body = ApiErrorBody, content_type = "application/json"),
        (status = 410, description = "Command output is no longer retained", body = ApiErrorBody, content_type = "application/json"),
        (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"),
    )
)]
pub(crate) async fn output_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, request_id)): AxumPath<(String, String)>,
    Query(query): Query<UserCommandOutputQuery>,
) -> Result<Json<UserCommandOutputPage>, ApiError> {
    let page = manager
        .session_user_commands()
        .output(
            &session_id,
            &request_id,
            UserCommandOutputRequest {
                stream: query.stream,
                offset: query.offset,
                limit: query.limit,
            },
        )
        .await?;
    Ok(Json(page))
}
