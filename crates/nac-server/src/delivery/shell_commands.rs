use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::StatusCode,
    Json,
};
use nac_core::session_service::{ShellCommandRequest, ShellCommandSnapshot};

#[utoipa::path(post, path = "/sessions/{session_id}/user-commands",
    operation_id = "post_sessions_session_id_user_commands", tag = "conversation",
    params(("session_id" = String, Path)), request_body = ShellCommandRequest,
    responses((status = 202, description = "Durable command accepted", body = ShellCommandSnapshot),
        (status = 200, description = "Identical request reconciled", body = ShellCommandSnapshot),
        (status = 400, description = "Invalid or unsupported command", body = ApiErrorBody),
        (status = 409, description = "Busy or conflicting identity", body = ApiErrorBody),
        (status = 500, description = "Command admission failed", body = ApiErrorBody))) ]
pub(crate) async fn submit_handler(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
    payload: Result<Json<ShellCommandRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ShellCommandSnapshot>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let (snapshot, replay) = manager
        .shell_commands()
        .submit(&session_id, request)
        .await?;
    Ok((
        if replay {
            StatusCode::OK
        } else {
            StatusCode::ACCEPTED
        },
        Json(snapshot),
    ))
}

#[utoipa::path(get, path = "/sessions/{session_id}/user-commands/{request_id}",
    operation_id = "get_sessions_session_id_user_commands_request_id", tag = "conversation",
    params(("session_id" = String, Path), ("request_id" = String, Path)),
    responses((status = 200, description = "Durable command outcome", body = ShellCommandSnapshot),
        (status = 404, description = "Command not found", body = ApiErrorBody),
        (status = 500, description = "Lookup failed", body = ApiErrorBody))) ]
pub(crate) async fn lookup_handler(
    State(manager): State<SessionManager>,
    Path((session_id, request_id)): Path<(String, String)>,
) -> Result<Json<ShellCommandSnapshot>, ApiError> {
    let snapshot = manager
        .shell_commands()
        .lookup(&session_id, &request_id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "command not found".into()))?;
    Ok(Json(snapshot))
}

#[utoipa::path(post, path = "/sessions/{session_id}/user-commands/{request_id}/cancel",
    operation_id = "post_sessions_session_id_user_commands_request_id_cancel", tag = "conversation",
    params(("session_id" = String, Path), ("request_id" = String, Path)),
    responses((status = 200, description = "Cancellation requested or already settled", body = ShellCommandSnapshot),
        (status = 404, description = "Command not found", body = ApiErrorBody),
        (status = 500, description = "Cancellation failed", body = ApiErrorBody))) ]
pub(crate) async fn cancel_handler(
    State(manager): State<SessionManager>,
    Path((session_id, request_id)): Path<(String, String)>,
) -> Result<Json<ShellCommandSnapshot>, ApiError> {
    let snapshot = manager
        .shell_commands()
        .cancel(&session_id, &request_id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "command not found".into()))?;
    Ok(Json(snapshot))
}

#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ShellOutputQuery {
    pub stream: Option<String>,
    pub offset: Option<u64>,
    pub limit: Option<usize>,
}

#[utoipa::path(get, path = "/sessions/{session_id}/user-commands/{request_id}/output",
    operation_id = "get_sessions_session_id_user_commands_request_id_output", tag = "conversation",
    params(("session_id" = String, Path), ("request_id" = String, Path), ShellOutputQuery),
    responses((status = 200, description = "Page of redacted retained output", body = nac_core::session_service::ShellOutputPage),
        (status = 410, description = "Output not retained or not yet settled", body = ApiErrorBody),
        (status = 500, description = "Output lookup failed", body = ApiErrorBody))) ]
pub(crate) async fn output_handler(
    State(manager): State<SessionManager>,
    Path((session_id, request_id)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<ShellOutputQuery>,
) -> Result<Json<nac_core::session_service::ShellOutputPage>, ApiError> {
    let limit = query.limit.unwrap_or(16_384);
    if !(1..=65_536).contains(&limit) {
        return Err(ApiError::bad_request(
            "output limit must be between 1 and 65536".into(),
        ));
    }
    let stream = query.stream.as_deref().unwrap_or("combined");
    if !matches!(stream, "combined" | "stdout" | "stderr") {
        return Err(ApiError::bad_request("invalid output stream".into()));
    }
    let page = manager
        .shell_commands()
        .output(
            &session_id,
            &request_id,
            stream,
            query.offset.unwrap_or(0),
            limit,
        )
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::GONE, "command output is not retained".into()))?;
    Ok(Json(page))
}
