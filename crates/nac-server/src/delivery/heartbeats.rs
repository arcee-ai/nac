use crate::{
    application::heartbeats::{HeartbeatApplication, HeartbeatInspection},
    ApiError, ApiErrorBody, SessionManager,
};
use axum::{
    extract::{rejection::JsonRejection, Path, Query, State},
    Json,
};
use nac_core::store::{HeartbeatAction, HeartbeatReceipt, HeartbeatSchedule};

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub(crate) struct InventoryQuery {
    session_id: Option<String>,
}
#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct HeartbeatControlRequest {
    request_id: String,
    operation: HeartbeatAction,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct HeartbeatAttentionAcknowledgement {
    through_sequence: i64,
}

#[utoipa::path(post,path="/sessions/{session_id}/heartbeats/attention",tag="sessions",params(("session_id"=String,Path)),request_body=HeartbeatAttentionAcknowledgement,responses((status=204),(status=400,body=ApiErrorBody)))]
pub(crate) async fn acknowledge(
    State(manager): State<SessionManager>,
    Path(session): Path<String>,
    payload: Result<Json<HeartbeatAttentionAcknowledgement>, JsonRejection>,
) -> Result<axum::http::StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    HeartbeatApplication::new(&manager)
        .acknowledge(&session, request.through_sequence)
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[utoipa::path(get,path="/heartbeats",tag="sessions",params(InventoryQuery),responses((status=200,body=Vec<HeartbeatSchedule>),(status=400,body=ApiErrorBody)))]
pub(crate) async fn inventory(
    State(manager): State<SessionManager>,
    Query(query): Query<InventoryQuery>,
) -> Result<Json<Vec<HeartbeatSchedule>>, ApiError> {
    Ok(Json(
        HeartbeatApplication::new(&manager)
            .inventory(query.session_id)
            .await?,
    ))
}
#[utoipa::path(get,path="/sessions/{session_id}/heartbeats/{schedule_id}",tag="sessions",params(("session_id"=String,Path),("schedule_id"=String,Path)),responses((status=200,body=HeartbeatInspection),(status=404,body=ApiErrorBody)))]
pub(crate) async fn inspect(
    State(manager): State<SessionManager>,
    Path((session, schedule)): Path<(String, String)>,
) -> Result<Json<HeartbeatInspection>, ApiError> {
    HeartbeatApplication::new(&manager)
        .inspect(session, schedule)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(axum::http::StatusCode::NOT_FOUND, error.to_string()))
}
#[utoipa::path(post,path="/sessions/{session_id}/heartbeats/control",tag="sessions",params(("session_id"=String,Path)),request_body=HeartbeatControlRequest,responses((status=200,body=HeartbeatReceipt),(status=400,body=ApiErrorBody),(status=409,body=ApiErrorBody)))]
pub(crate) async fn control(
    State(manager): State<SessionManager>,
    Path(session): Path<String>,
    payload: Result<Json<HeartbeatControlRequest>, JsonRejection>,
) -> Result<Json<HeartbeatReceipt>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    HeartbeatApplication::new(&manager)
        .control(&session, request.request_id, request.operation)
        .await
        .map(Json)
        .map_err(|error| {
            let message = format!("{error:#}");
            if message.contains("conflict") {
                ApiError::new(axum::http::StatusCode::CONFLICT, message)
            } else {
                ApiError::bad_request(message)
            }
        })
}
