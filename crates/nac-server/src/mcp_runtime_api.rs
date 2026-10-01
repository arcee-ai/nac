//! Process-local MCP connection lifecycle delivery.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use nac_core::mcp_configurations::McpRuntimeStatus;
use serde::Serialize;

use crate::{ApiError, SessionManager};

impl SessionManager {
    pub(crate) fn mcp_runtime(&self) -> &nac_core::mcp_configurations::McpRuntimeManager {
        &self.inner.mcp_runtime
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct McpRuntimeStatusList {
    pub servers: Vec<McpRuntimeStatus>,
}

#[utoipa::path(
    get,
    path = "/mcp_library/servers/status",
    operation_id = "get_mcp_library_servers_status",
    tag = "mcp-library",
    responses((status = 200, description = "Success", body = McpRuntimeStatusList, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn status_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<McpRuntimeStatusList>, ApiError> {
    let servers =
        manager.mcp_runtime().statuses().await.map_err(|error| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("{error:#}"))
        })?;
    Ok(Json(McpRuntimeStatusList { servers }))
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/{server_name}/connect",
    operation_id = "post_mcp_library_servers_server_name_connect",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 200, description = "Success", body = McpRuntimeStatus, content_type = "application/json"), (status = 400, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn connect_handler(
    State(manager): State<SessionManager>,
    Path(server_name): Path<String>,
) -> Result<Json<McpRuntimeStatus>, ApiError> {
    manager
        .mcp_runtime()
        .connect(&server_name)
        .await
        .map(Json)
        .map_err(|error| ApiError::bad_request(format!("{error:#}")))
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/{server_name}/disconnect",
    operation_id = "post_mcp_library_servers_server_name_disconnect",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 200, description = "Success", body = McpRuntimeStatus, content_type = "application/json"), (status = 400, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn disconnect_handler(
    State(manager): State<SessionManager>,
    Path(server_name): Path<String>,
) -> Result<Json<McpRuntimeStatus>, ApiError> {
    manager
        .mcp_runtime()
        .disconnect(&server_name)
        .await
        .map(Json)
        .map_err(|error| ApiError::bad_request(format!("{error:#}")))
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/{server_name}/reload",
    operation_id = "post_mcp_library_servers_server_name_reload",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 200, description = "Success", body = McpRuntimeStatus, content_type = "application/json"), (status = 400, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn reload_handler(
    State(manager): State<SessionManager>,
    Path(server_name): Path<String>,
) -> Result<Json<McpRuntimeStatus>, ApiError> {
    manager
        .mcp_runtime()
        .reload(&server_name)
        .await
        .map(Json)
        .map_err(|error| ApiError::bad_request(format!("{error:#}")))
}
