//! Human product routes inherit the server's Host/Origin/Fetch Metadata boundary.
//! There is deliberately no corresponding native tool or public MCP operation.
use crate::{
    application::task_followup_delegations::TaskFollowupDelegationApplication, ApiError,
    ApiErrorBody, SessionManager,
};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::StatusCode,
    Json,
};
use nac_core::store::{TaskFollowupDelegation, TaskFollowupDelegationRequest, TaskFollowupError};

fn failure(error: anyhow::Error) -> ApiError {
    let status = match error.downcast_ref::<TaskFollowupError>() {
        Some(TaskFollowupError::Invalid) => StatusCode::BAD_REQUEST,
        Some(
            TaskFollowupError::Denied
            | TaskFollowupError::OutsideScope
            | TaskFollowupError::AuthorizationRequired,
        ) => StatusCode::FORBIDDEN,
        Some(
            TaskFollowupError::IdentityConflict
            | TaskFollowupError::RunConflict
            | TaskFollowupError::Unavailable
            | TaskFollowupError::Stopping,
        ) => StatusCode::CONFLICT,
        Some(TaskFollowupError::CommitUncertain) => StatusCode::INTERNAL_SERVER_ERROR,
        None => return error.into(),
    };
    ApiError::new(status, error.to_string())
}

fn identifier(value: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() || value.len() > 160 {
        return Err(ApiError::bad_request(
            "invalid delegation identifier".into(),
        ));
    }
    Ok(())
}

#[utoipa::path(post, path = "/sessions/{session_id}/task-followup-delegations",
    operation_id = "post_sessions_session_id_task_followup_delegations", tag = "conversation",
    params(("session_id" = String, Path)), request_body = TaskFollowupDelegationRequest,
    responses((status = 200, description = "Exact human delegation issued or original request reconciled", body = TaskFollowupDelegation),
    (status = 400, description = "Invalid input", body = ApiErrorBody), (status = 403, description = "Policy or scope denies delegation", body = ApiErrorBody),
    (status = 404, description = "Caller unavailable", body = ApiErrorBody), (status = 409, description = "Conflicting identity or current caller owner unavailable", body = ApiErrorBody),
    (status = 500, description = "Unknown commit outcome; retry identical request", body = ApiErrorBody)))]
pub(crate) async fn issue(
    State(manager): State<SessionManager>,
    Path(caller): Path<String>,
    body: Result<Json<TaskFollowupDelegationRequest>, JsonRejection>,
) -> Result<Json<TaskFollowupDelegation>, ApiError> {
    let Json(request) = body.map_err(ApiError::from)?;
    TaskFollowupDelegationApplication::new(&manager)
        .issue(caller, request)
        .await
        .map(Json)
        .map_err(failure)
}

#[utoipa::path(get, path = "/sessions/{session_id}/task-followup-delegations/{delegation_id}",
    operation_id = "get_sessions_session_id_task_followup_delegations_delegation_id", tag = "conversation",
    params(("session_id" = String, Path), ("delegation_id" = String, Path)),
    responses((status = 200, description = "Passive exact delegation evidence", body = TaskFollowupDelegation),
    (status = 400, description = "Invalid identifier", body = ApiErrorBody), (status = 404, description = "Delegation unavailable to this caller", body = ApiErrorBody)))]
pub(crate) async fn read(
    State(manager): State<SessionManager>,
    Path((caller, id)): Path<(String, String)>,
) -> Result<Json<TaskFollowupDelegation>, ApiError> {
    identifier(&id)?;
    TaskFollowupDelegationApplication::new(&manager)
        .read(caller, id)
        .await
        .map_err(failure)?
        .map(Json)
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "delegation not found".into()))
}

#[utoipa::path(delete, path = "/sessions/{session_id}/task-followup-delegations/{delegation_id}",
    operation_id = "delete_sessions_session_id_task_followup_delegations_delegation_id", tag = "conversation",
    params(("session_id" = String, Path), ("delegation_id" = String, Path)),
    responses((status = 200, description = "Delegation revoked; accepted input and audit evidence retained", body = TaskFollowupDelegation),
    (status = 400, description = "Invalid identifier", body = ApiErrorBody), (status = 404, description = "Delegation unavailable to this caller", body = ApiErrorBody),
    (status = 409, description = "Admission is stopping", body = ApiErrorBody)))]
pub(crate) async fn revoke(
    State(manager): State<SessionManager>,
    Path((caller, id)): Path<(String, String)>,
) -> Result<Json<TaskFollowupDelegation>, ApiError> {
    identifier(&id)?;
    TaskFollowupDelegationApplication::new(&manager)
        .revoke(caller, id)
        .await
        .map_err(failure)?
        .map(Json)
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "delegation not found".into()))
}
