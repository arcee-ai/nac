use std::collections::BTreeMap;

use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    Json,
};
use nac_core::view::SessionSummarySnapshot;
use serde::{Deserialize, Serialize};

use crate::{ApiError, ApiErrorBody, ManagedSessionSummary, SessionManager};

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListSessionsQuery {
    pub project_id: Option<String>,
    #[serde(default)]
    pub workspace_stats: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateSessionPresentationRequest {
    pub title: String,
    pub pinned: bool,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ReorderSessionsRequest {
    pub pinned: bool,
    pub session_ids: Vec<String>,
    pub expected_versions: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReorderSessionsResponse {
    pub pinned: bool,
    pub sessions: Vec<SessionSummarySnapshot>,
}

#[utoipa::path(
    get,
    path = "/sessions",
    operation_id = "get_sessions",
    tag = "sessions",
    params(ListSessionsQuery),
    responses((status = 200, description = "Success", body = Vec<ManagedSessionSummary>, content_type = "application/json"), (status = 400, description = "Query extraction failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_handler(
    State(manager): State<SessionManager>,
    Query(query): Query<ListSessionsQuery>,
) -> Result<Json<Vec<ManagedSessionSummary>>, ApiError> {
    Ok(Json(
        manager
            .session_catalog()
            .list_for_project(query.workspace_stats, query.project_id.as_deref())
            .await?,
    ))
}

#[utoipa::path(
    put,
    path = "/sessions/{session_id}/presentation",
    operation_id = "put_sessions_session_id_presentation",
    tag = "sessions",
    params(("session_id" = String, Path)),
    request_body(content = UpdateSessionPresentationRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = SessionSummarySnapshot, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_presentation_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: Result<Json<UpdateSessionPresentationRequest>, JsonRejection>,
) -> Result<Json<SessionSummarySnapshot>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .session_catalog()
            .update_presentation(
                &session_id,
                &request.title,
                request.pinned,
                request.expected_version,
            )
            .await?,
    ))
}

#[utoipa::path(
    put,
    path = "/sessions/order",
    operation_id = "put_sessions_order",
    tag = "sessions",
    request_body(content = ReorderSessionsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ReorderSessionsResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn reorder_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<ReorderSessionsRequest>, JsonRejection>,
) -> Result<Json<ReorderSessionsResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let sessions = manager
        .session_catalog()
        .reorder(
            request.pinned,
            &request.session_ids,
            &request.expected_versions,
        )
        .await?;
    Ok(Json(ReorderSessionsResponse {
        pinned: request.pinned,
        sessions,
    }))
}
