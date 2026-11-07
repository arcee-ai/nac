use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::application::project_folders::NewFolder;
use crate::{ApiError, ApiErrorBody, SessionManager, SshRequest};

/// One folder to create inside the directory the picker is listing.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateFolderRequest {
    /// The listed directory, exactly as the listing reported it.
    pub parent: String,
    /// One folder name: no separators, no `.`/`..`, no surrounding spaces.
    pub name: String,
}

/// The same, on the SSH host the picker is browsing.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateSshFolderRequest {
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    pub parent: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct CreatedFolder {
    /// Absolute path of the folder that was created.
    pub path: String,
}

/// Create one named folder inside a listed local directory.
///
/// Nothing is created recursively and nothing is replaced: an existing name is
/// a conflict. Hard and configured Deny apply; this human request never asks
/// for agent approval.
#[utoipa::path(
    post,
    path = "/fs/folders",
    operation_id = "post_fs_folders",
    tag = "filesystem",
    request_body(content = CreateFolderRequest, content_type = "application/json"),
    responses((status = 201, description = "Created", body = CreatedFolder, content_type = "application/json"), (status = 400, description = "Invalid folder name or parent", body = ApiErrorBody, content_type = "application/json"), (status = 403, description = "Denied by permission policy or by the filesystem", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Parent folder no longer exists", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Name already exists, or the parent moved since it was listed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Outcome could not be confirmed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_local_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateFolderRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<CreatedFolder>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let path = manager
        .project_folders()
        .create_local(NewFolder {
            parent: request.parent,
            name: request.name,
        })
        .await?;
    Ok((StatusCode::CREATED, Json(CreatedFolder { path })))
}

/// Create one named folder inside a listed directory on an SSH host, never on
/// this machine.
#[utoipa::path(
    post,
    path = "/ssh/folders",
    operation_id = "post_ssh_folders",
    tag = "filesystem",
    request_body(content = CreateSshFolderRequest, content_type = "application/json"),
    responses((status = 201, description = "Created", body = CreatedFolder, content_type = "application/json"), (status = 400, description = "Invalid folder name, parent or connection", body = ApiErrorBody, content_type = "application/json"), (status = 403, description = "Denied by permission policy or by the host", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Parent folder no longer exists", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Name already exists, or the parent moved since it was listed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Host unreachable; the outcome is unknown", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Outcome could not be confirmed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_ssh_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateSshFolderRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<CreatedFolder>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let path = manager
        .project_folders()
        .create_ssh(
            SshRequest {
                host: request.ssh_host,
                port: request.ssh_port,
                identity_file: request.ssh_identity_file,
            },
            NewFolder {
                parent: request.parent,
                name: request.name,
            },
        )
        .await?;
    Ok((StatusCode::CREATED, Json(CreatedFolder { path })))
}
