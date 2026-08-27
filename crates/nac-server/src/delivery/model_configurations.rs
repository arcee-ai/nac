use std::collections::BTreeMap;

use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use nac_core::{
    light_model::LightModelSettings,
    model::{BackendKind, ReasoningEffort},
    model_configurations::ModelConfigurationRecord,
};
use serde::{Deserialize, Serialize};

use crate::{application, ApiError, ApiErrorBody, RequestField, SessionManager};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateModelConfigurationRequest {
    pub name: String,
    pub backend: BackendKind,
    pub model: String,
    /// Defaults to the provider's canonical URL.
    pub base_url: Option<String>,
    #[schema(write_only, example = "fake-api-key")]
    pub api_key: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub extra_headers: Option<BTreeMap<String, String>>,
    pub orchestrator_compaction_threshold: Option<u64>,
    pub initial_prompt: Option<String>,
    #[serde(default)]
    pub light_model: Option<LightModelSettings>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateModelConfigurationRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub backend: RequestField<BackendKind>,
    #[serde(default)]
    pub model: RequestField<String>,
    #[serde(default)]
    pub base_url: RequestField<String>,
    #[serde(default)]
    #[schema(write_only, example = "fake-replacement-key")]
    pub api_key: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<ReasoningEffort>,
    #[serde(default)]
    pub extra_headers: RequestField<BTreeMap<String, String>>,
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    #[serde(default)]
    pub initial_prompt: RequestField<String>,
    #[serde(default)]
    pub light_model: RequestField<LightModelSettings>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ModelConfigurationList {
    pub configurations: Vec<ModelConfigurationRecord>,
}

fn field<T>(field: RequestField<T>) -> application::Field<T> {
    match field {
        RequestField::Omitted => application::Field::Unchanged,
        RequestField::Null => application::Field::Clear,
        RequestField::Value(value) => application::Field::Set(value),
    }
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
    post,
    path = "/model-configs",
    operation_id = "post_model_configs",
    tag = "model-configs",
    request_body(content = CreateModelConfigurationRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = ModelConfigurationRecord, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateModelConfigurationRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ModelConfigurationRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let record = manager.model_configurations().create(
        application::model_configurations::CreateModelConfiguration {
            name: request.name,
            backend: request.backend,
            model: request.model,
            base_url: request.base_url,
            api_key: request.api_key,
            reasoning_effort: request.reasoning_effort,
            extra_headers: request.extra_headers,
            orchestrator_compaction_threshold: request.orchestrator_compaction_threshold,
            initial_prompt: request.initial_prompt,
            light_model: request.light_model,
        },
    )?;
    Ok((StatusCode::CREATED, Json(record)))
}

#[utoipa::path(
    patch,
    path = "/model-configs/{config_id}",
    operation_id = "patch_model_configs_config_id",
    tag = "model-configs",
    params(("config_id" = String, Path)),
    request_body(content = UpdateModelConfigurationRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ModelConfigurationRecord, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
    payload: Result<Json<UpdateModelConfigurationRequest>, JsonRejection>,
) -> Result<Json<ModelConfigurationRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.model_configurations().update(
        &config_id,
        application::model_configurations::UpdateModelConfiguration {
            name: field(request.name),
            backend: field(request.backend),
            model: field(request.model),
            base_url: field(request.base_url),
            api_key: field(request.api_key),
            reasoning_effort: field(request.reasoning_effort),
            extra_headers: field(request.extra_headers),
            orchestrator_compaction_threshold: field(request.orchestrator_compaction_threshold),
            initial_prompt: field(request.initial_prompt),
            light_model: field(request.light_model),
        },
    )?))
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
