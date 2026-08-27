use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use nac_core::model_configurations::ModelConfigurationRecord;
use serde::Serialize;

use crate::{ApiError, ApiErrorBody, SessionManager};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ModelConfigurationList {
    pub configurations: Vec<ModelConfigurationRecord>,
}

#[utoipa::path(
    get,
    path = "/model-configs",
    operation_id = "get_model_configs",
    tag = "model-configs",
    responses((status = 200, description = "Success", body = ModelConfigurationList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<ModelConfigurationList>, ApiError> {
    Ok(Json(ModelConfigurationList {
        configurations: manager.model_configurations().list()?,
    }))
}

#[utoipa::path(
    delete,
    path = "/model-configs/{config_id}",
    operation_id = "delete_model_configs_config_id",
    tag = "model-configs",
    params(("config_id" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Configuration is a project default", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    manager.model_configurations().delete(&config_id)?;
    Ok(StatusCode::NO_CONTENT)
}
