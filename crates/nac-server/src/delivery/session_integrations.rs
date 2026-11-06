use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::StatusCode,
    Json,
};
use nac_core::mcp_configurations::SessionMcpRefreshStatus;
use serde::Deserialize;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct RefreshSessionIntegrationsRequest {
    pub expected_revision: i64,
}

#[utoipa::path(get, path = "/sessions/{session_id}/integrations", operation_id = "get_sessions_session_id_integrations", tag = "conversation",
    params(("session_id" = String, Path)), responses((status = 200, description = "Durable requested revision and process-local application status", body = SessionMcpRefreshStatus), (status = 404, description = "Session unavailable", body = ApiErrorBody)))]
pub(crate) async fn status(
    State(manager): State<SessionManager>,
    Path(session): Path<String>,
) -> Result<Json<SessionMcpRefreshStatus>, ApiError> {
    Ok(Json(manager.session_integrations().status(&session).await?))
}

#[utoipa::path(post, path = "/sessions/{session_id}/integrations/refresh", operation_id = "post_sessions_session_id_integrations_refresh", tag = "conversation",
    params(("session_id" = String, Path)), request_body = RefreshSessionIntegrationsRequest,
    responses((status = 200, description = "Refresh scheduled at each affected agent's next model boundary", body = SessionMcpRefreshStatus), (status = 400, description = "Invalid revision", body = ApiErrorBody), (status = 404, description = "Session unavailable", body = ApiErrorBody), (status = 409, description = "Revision changed", body = ApiErrorBody)))]
pub(crate) async fn refresh(
    State(manager): State<SessionManager>,
    Path(session): Path<String>,
    payload: Result<Json<RefreshSessionIntegrationsRequest>, JsonRejection>,
) -> Result<Json<SessionMcpRefreshStatus>, ApiError> {
    let Json(request) = payload?;
    if request.expected_revision < 0 {
        return Err(ApiError::bad_request(
            "expected_revision must be nonnegative".into(),
        ));
    }
    manager
        .session_integrations()
        .refresh(&session, request.expected_revision)
        .await
        .map(Json)
        .map_err(|error| {
            if error.is::<nac_core::store::SessionMcpRefreshConflict>() {
                ApiError::new(StatusCode::CONFLICT, error.to_string())
            } else {
                error.into()
            }
        })
}
