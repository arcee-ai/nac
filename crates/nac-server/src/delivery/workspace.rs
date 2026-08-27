use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    Json,
};
use nac_core::{view, workspace};
use serde::Deserialize;

use crate::{application, ApiError, ApiErrorBody, SessionManager};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct SwitchBranchRequest {
    pub name: String,
    /// Make the branch first, off the current HEAD.
    #[serde(default)]
    pub create: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CommitWorkspaceRequest {
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WorkspaceDiffQuery {
    pub path: String,
    pub stage: Option<String>,
    pub context: Option<usize>,
    /// Look at a captured revision instead of the working tree.
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WorkspaceFileQuery {
    pub path: String,
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct OpenWorkspacePathRequest {
    pub path: String,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WorkspaceRevisionQuery {
    pub revision: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/diff",
    operation_id = "get_sessions_session_id_workspace_diff",
    tag = "workspace",
    params(WorkspaceDiffQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceFileDiff, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn workspace_diff(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceDiffQuery>,
) -> std::result::Result<Json<view::WorkspaceFileDiff>, ApiError> {
    Ok(Json(
        manager
            .workspace()
            .workspace_file_diff(
                &session_id,
                application::workspace::WorkspaceDiffRequest {
                    path: query.path,
                    stage: query.stage,
                    context: query.context,
                    revision: query.revision,
                },
            )
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/files",
    operation_id = "get_sessions_session_id_workspace_files",
    tag = "workspace",
    params(WorkspaceRevisionQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceFileList, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn workspace_files(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceRevisionQuery>,
) -> std::result::Result<Json<view::WorkspaceFileList>, ApiError> {
    Ok(Json(
        manager
            .workspace()
            .workspace_files(&session_id, query.revision)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/file",
    operation_id = "get_sessions_session_id_workspace_file",
    tag = "workspace",
    params(WorkspaceFileQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceFileContent, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn workspace_file(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceFileQuery>,
) -> std::result::Result<Json<view::WorkspaceFileContent>, ApiError> {
    Ok(Json(
        manager
            .workspace()
            .workspace_file(&session_id, query.path, query.revision)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/workspace/open",
    operation_id = "post_sessions_session_id_workspace_open",
    tag = "workspace",
    params(("session_id" = String, Path)),
    request_body(content = OpenWorkspacePathRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = view::OpenLocalPathResult, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 501, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn open_workspace_path(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<OpenWorkspacePathRequest>, JsonRejection>,
) -> std::result::Result<Json<view::OpenLocalPathResult>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .workspace()
            .open_workspace_path(&session_id, request.path)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/revisions",
    operation_id = "get_sessions_session_id_workspace_revisions",
    tag = "workspace",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<view::WorkspaceRevisionRecord>, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn workspace_revisions(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<view::WorkspaceRevisionRecord>>, ApiError> {
    Ok(Json(manager.workspace().workspace_revisions(&session_id)?))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/revisions/{revision_id}/changes",
    operation_id = "get_sessions_session_id_workspace_revisions_revision_id_changes",
    tag = "workspace",
    params(("session_id" = String, Path), ("revision_id" = i64, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceRevisionChanges, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn workspace_revision_changes(
    State(manager): State<SessionManager>,
    AxumPath((session_id, revision_id)): AxumPath<(String, i64)>,
) -> std::result::Result<Json<view::WorkspaceRevisionChanges>, ApiError> {
    Ok(Json(
        manager
            .workspace()
            .workspace_revision_changes(&session_id, revision_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/branches",
    operation_id = "get_sessions_session_id_workspace_branches",
    tag = "workspace",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = workspace::BranchList, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn workspace_branches(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<workspace::BranchList>, ApiError> {
    Ok(Json(
        manager.workspace().workspace_branches(&session_id).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/workspace/branches",
    operation_id = "post_sessions_session_id_workspace_branches",
    tag = "workspace",
    params(("session_id" = String, Path)),
    request_body(content = SwitchBranchRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = workspace::BranchList, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn switch_workspace_branch(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<SwitchBranchRequest>, JsonRejection>,
) -> std::result::Result<Json<workspace::BranchList>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .workspace()
            .switch_workspace_branch(
                &session_id,
                application::workspace::SwitchBranch {
                    name: request.name,
                    create: request.create,
                },
            )
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/workspace/commit",
    operation_id = "post_sessions_session_id_workspace_commit",
    tag = "workspace",
    params(("session_id" = String, Path)),
    request_body(content = CommitWorkspaceRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = workspace::CommitOutcome, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn commit_workspace(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CommitWorkspaceRequest>, JsonRejection>,
) -> std::result::Result<Json<workspace::CommitOutcome>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .workspace()
            .commit_workspace(
                &session_id,
                application::workspace::CommitWorkspace {
                    message: request.message,
                },
            )
            .await?,
    ))
}
