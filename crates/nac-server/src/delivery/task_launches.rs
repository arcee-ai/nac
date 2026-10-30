//! Authenticated HTTP adapters for retained Local task preparation.
use crate::{
    application::task_launches::TaskLaunchApplication, ApiError, ApiErrorBody, SessionManager,
};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    Json,
};
use nac_core::store::{TaskLaunchRecord, TaskLaunchRequest};

#[utoipa::path(post, path="/task-launches", tag="sessions", request_body=TaskLaunchRequest,
    responses((status=200,body=TaskLaunchRecord),(status=400,body=ApiErrorBody),(status=409,body=ApiErrorBody)))]
pub(crate) async fn start(
    State(manager): State<SessionManager>,
    payload: Result<Json<TaskLaunchRequest>, JsonRejection>,
) -> Result<Json<TaskLaunchRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        TaskLaunchApplication::new(&manager)
            .start(request)
            .await
            .map_err(launch_error)?,
    ))
}

#[utoipa::path(get, path="/task-launches/{request_id}", tag="sessions", params(("request_id"=String,Path)),
    responses((status=200,body=TaskLaunchRecord),(status=404,body=ApiErrorBody)))]
pub(crate) async fn status(
    State(manager): State<SessionManager>,
    Path(request_id): Path<String>,
) -> Result<Json<TaskLaunchRecord>, ApiError> {
    Ok(Json(
        TaskLaunchApplication::new(&manager)
            .status(request_id)
            .await?,
    ))
}

#[utoipa::path(post, path="/task-launches/{request_id}/cancel", tag="sessions", params(("request_id"=String,Path)),
    responses((status=200,body=TaskLaunchRecord),(status=404,body=ApiErrorBody)))]
pub(crate) async fn cancel(
    State(manager): State<SessionManager>,
    Path(request_id): Path<String>,
) -> Result<Json<TaskLaunchRecord>, ApiError> {
    Ok(Json(
        TaskLaunchApplication::new(&manager)
            .cancel(request_id)
            .await?,
    ))
}

#[utoipa::path(get, path="/projects/{project_id}/task-launches", tag="projects", params(("project_id"=String,Path)),
    responses((status=200,body=Vec<TaskLaunchRecord>),(status=404,body=ApiErrorBody)))]
pub(crate) async fn inventory(
    State(manager): State<SessionManager>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<TaskLaunchRecord>>, ApiError> {
    Ok(Json(
        TaskLaunchApplication::new(&manager)
            .inventory(project_id)
            .await?,
    ))
}

#[utoipa::path(get, path="/projects/{project_id}/task-launch-source", tag="projects", params(("project_id"=String,Path)),
    responses((status=200,body=crate::application::task_launches::TaskLaunchSourceInfo),(status=404,body=ApiErrorBody)))]
pub(crate) async fn source_info(
    State(manager): State<SessionManager>,
    Path(project_id): Path<String>,
) -> Result<Json<crate::application::task_launches::TaskLaunchSourceInfo>, ApiError> {
    Ok(Json(
        TaskLaunchApplication::new(&manager)
            .source_info(project_id)
            .await?,
    ))
}

fn launch_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.starts_with("conflict:") {
        ApiError::new(axum::http::StatusCode::CONFLICT, message)
    } else if message.starts_with("invalid request:") {
        ApiError::bad_request(message)
    } else {
        ApiError::from(error)
    }
}
