use std::{collections::BTreeMap, path::PathBuf};

use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use nac_core::projects::ProjectRecord;
use serde::{Deserialize, Serialize};

use crate::{application, ApiError, ApiErrorBody, RequestField, SessionManager};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ProjectList {
    pub projects: Vec<ProjectRecord>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    #[schema(value_type = String)]
    pub cwd: PathBuf,
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    pub default_model_config_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateProjectRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub description: RequestField<String>,
    #[serde(default)]
    pub default_model_config_id: RequestField<String>,
    /// Toggling this moves the project to the end of the target pin group and
    /// bumps `presentation_version`.
    #[serde(default)]
    pub pinned: RequestField<bool>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct AssignSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ReorderProjectsRequest {
    pub pinned: bool,
    pub project_ids: Vec<String>,
    pub expected_versions: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReorderProjectsResponse {
    pub pinned: bool,
    pub projects: Vec<ProjectRecord>,
}

/// What a project delete does with the chats inside it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeleteProjectSessions {
    /// Hand them back as unassigned, so nothing said in them is lost.
    #[default]
    Keep,
    /// Delete them along with the project.
    Delete,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DeleteProjectQuery {
    #[serde(default)]
    pub sessions: DeleteProjectSessions,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DeleteProjectResponse {
    /// Sessions that stayed behind and are now unassigned.
    pub released_session_ids: Vec<String>,
    /// Sessions deleted along with the project.
    pub deleted_session_ids: Vec<String>,
}

fn project_field<T>(field: RequestField<T>) -> application::projects::ProjectField<T> {
    match field {
        RequestField::Omitted => application::projects::ProjectField::Unchanged,
        RequestField::Null => application::projects::ProjectField::Clear,
        RequestField::Value(value) => application::projects::ProjectField::Set(value),
    }
}

#[utoipa::path(
    get,
    path = "/projects",
    operation_id = "get_projects",
    tag = "projects",
    responses((status = 200, description = "Success", body = ProjectList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<ProjectList>, ApiError> {
    Ok(Json(ProjectList {
        projects: manager.projects().list()?,
    }))
}

#[utoipa::path(
    post,
    path = "/projects",
    operation_id = "post_projects",
    tag = "projects",
    request_body(content = CreateProjectRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = ProjectRecord, content_type = "application/json"), (status = 400, description = "Invalid project metadata or location", body = ApiErrorBody, content_type = "application/json"), (status = 403, description = "Remote directory is unreadable", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Directory or default model configuration was not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "A project already uses this canonical location", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Remote host or command failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateProjectRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ProjectRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let command = application::projects::CreateProject {
        name: request.name,
        description: request.description,
        cwd: request.cwd,
        ssh_host: request.ssh_host,
        ssh_port: request.ssh_port,
        ssh_identity_file: request.ssh_identity_file,
        default_model_config_id: request.default_model_config_id,
    };
    Ok((
        StatusCode::CREATED,
        Json(manager.projects().create(command).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/projects/{project_id}",
    operation_id = "patch_projects_project_id",
    tag = "projects",
    params(("project_id" = String, Path)),
    request_body(content = UpdateProjectRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ProjectRecord, content_type = "application/json"), (status = 400, description = "Invalid project metadata", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Project or default model configuration was not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_handler(
    State(manager): State<SessionManager>,
    AxumPath(project_id): AxumPath<String>,
    payload: Result<Json<UpdateProjectRequest>, JsonRejection>,
) -> Result<Json<ProjectRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.projects().update(
        &project_id,
        application::projects::UpdateProject {
            name: project_field(request.name),
            description: project_field(request.description),
            default_model_config_id: project_field(request.default_model_config_id),
            pinned: project_field(request.pinned),
        },
    )?))
}

/// Remove a project, by default without touching the work done inside it.
///
/// Its sessions are released rather than deleted, so they reappear in the
/// listing as unassigned and can be assigned somewhere else. Pass
/// `?sessions=delete` to take them down with the project instead.
#[utoipa::path(
    delete,
    path = "/projects/{project_id}",
    operation_id = "delete_projects_project_id",
    tag = "projects",
    params(DeleteProjectQuery, ("project_id" = String, Path)),
    responses((status = 200, description = "Success", body = DeleteProjectResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Project was not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_handler(
    State(manager): State<SessionManager>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<DeleteProjectQuery>,
) -> Result<Json<DeleteProjectResponse>, ApiError> {
    let sessions = match query.sessions {
        DeleteProjectSessions::Keep => application::projects::ProjectSessionDisposition::Keep,
        DeleteProjectSessions::Delete => application::projects::ProjectSessionDisposition::Delete,
    };
    let outcome = manager.projects().delete(&project_id, sessions).await?;
    Ok(Json(DeleteProjectResponse {
        released_session_ids: outcome.released_session_ids,
        deleted_session_ids: outcome.deleted_session_ids,
    }))
}

/// Attach an existing session to a project.
///
/// Membership is set once: an already-assigned session conflicts, and so does a
/// session whose working directory is not the project's location.
#[utoipa::path(
    post,
    path = "/projects/{project_id}/sessions",
    operation_id = "post_projects_project_id_sessions",
    tag = "projects",
    params(("project_id" = String, Path)),
    request_body(content = AssignSessionRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ProjectRecord, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Project or session was not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Session is already assigned or runs elsewhere", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn assign_session_handler(
    State(manager): State<SessionManager>,
    AxumPath(project_id): AxumPath<String>,
    payload: Result<Json<AssignSessionRequest>, JsonRejection>,
) -> Result<Json<ProjectRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .projects()
            .assign_session(&project_id, &request.session_id)?,
    ))
}

/// Rewrite the order of one pin group.
#[utoipa::path(
    put,
    path = "/projects/order",
    operation_id = "put_projects_order",
    tag = "projects",
    request_body(content = ReorderProjectsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ReorderProjectsResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn reorder_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<ReorderProjectsRequest>, JsonRejection>,
) -> Result<Json<ReorderProjectsResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let projects = manager.projects().reorder(
        request.pinned,
        &request.project_ids,
        &request.expected_versions,
    )?;
    Ok(Json(ReorderProjectsResponse {
        pinned: request.pinned,
        projects,
    }))
}
