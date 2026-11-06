use crate::{
    application::fresh_task_schedules::{
        FreshTaskScheduleApplication, FreshTaskScheduleInspection,
    },
    ApiError, ApiErrorBody, SessionManager,
};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    Json,
};
use nac_core::store::{FreshTaskDestination, HeartbeatAction, HeartbeatReceipt, HeartbeatSchedule};
use nac_core::store::{FreshTaskRetainedAllowanceChange, FreshTaskRetainedAllowanceReceipt};

#[utoipa::path(post,path="/projects/{project_id}/task-schedules/retained-allowance",operation_id="change_project_task_retained_allowance",tag="projects",params(("project_id"=String,Path)),request_body=FreshTaskRetainedAllowanceChange,responses((status=200,body=FreshTaskRetainedAllowanceReceipt),(status=400,body=ApiErrorBody),(status=409,body=ApiErrorBody)))]
pub(crate) async fn change_retained_allowance(
    State(manager): State<SessionManager>,
    Path(project): Path<String>,
    payload: Result<Json<FreshTaskRetainedAllowanceChange>, JsonRejection>,
) -> Result<Json<FreshTaskRetainedAllowanceReceipt>, ApiError> {
    let Json(change) = payload.map_err(ApiError::from)?;
    FreshTaskScheduleApplication::new(&manager)
        .change_retained_allowance(project, change)
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

#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct FreshTaskScheduleControlRequest {
    request_id: String,
    operation: HeartbeatAction,
    destination: Option<FreshTaskDestination>,
    creator_session_id: Option<String>,
}

#[utoipa::path(get,path="/projects/{project_id}/task-schedules",operation_id="get_project_task_schedules",tag="projects",params(("project_id"=String,Path)),responses((status=200,body=Vec<HeartbeatSchedule>),(status=400,body=ApiErrorBody)))]
pub(crate) async fn inventory(
    State(manager): State<SessionManager>,
    Path(project): Path<String>,
) -> Result<Json<Vec<HeartbeatSchedule>>, ApiError> {
    FreshTaskScheduleApplication::new(&manager)
        .inventory(project)
        .await
        .map(Json)
        .map_err(|error| ApiError::bad_request(error.to_string()))
}
#[utoipa::path(get,path="/projects/{project_id}/task-schedules/{schedule_id}",operation_id="get_project_task_schedule",tag="projects",params(("project_id"=String,Path),("schedule_id"=String,Path)),responses((status=200,body=FreshTaskScheduleInspection),(status=404,body=ApiErrorBody)))]
pub(crate) async fn inspect(
    State(manager): State<SessionManager>,
    Path((project, schedule)): Path<(String, String)>,
) -> Result<Json<FreshTaskScheduleInspection>, ApiError> {
    FreshTaskScheduleApplication::new(&manager)
        .inspect(project, schedule)
        .await
        .map(Json)
        .map_err(|error| ApiError::new(axum::http::StatusCode::NOT_FOUND, error.to_string()))
}
#[utoipa::path(post,path="/projects/{project_id}/task-schedules/control",operation_id="control_project_task_schedule",tag="projects",params(("project_id"=String,Path)),request_body=FreshTaskScheduleControlRequest,responses((status=200,body=HeartbeatReceipt),(status=400,body=ApiErrorBody),(status=409,body=ApiErrorBody)))]
pub(crate) async fn control(
    State(manager): State<SessionManager>,
    Path(project): Path<String>,
    payload: Result<Json<FreshTaskScheduleControlRequest>, JsonRejection>,
) -> Result<Json<HeartbeatReceipt>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    FreshTaskScheduleApplication::new(&manager)
        .control(
            project,
            request.request_id,
            request.operation,
            request.destination,
            request.creator_session_id,
        )
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
