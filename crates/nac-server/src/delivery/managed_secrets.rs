use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    application::managed::ManagedSecretsApplication, ApiError, ApiErrorBody, SessionManager,
};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ManagedSecretSummary {
    pub name: String,
    pub updated_at_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ManagedSecretList {
    pub secrets: Vec<ManagedSecretSummary>,
    pub healthy: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PutManagedSecretRequest {
    #[schema(write_only, example = "fake-managed-secret-value")]
    pub value: String,
}

fn application(manager: &SessionManager) -> Result<ManagedSecretsApplication, ApiError> {
    manager
        .managed_host()
        .map(ManagedSecretsApplication::from_config)
        .ok_or_else(|| ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Managed NAC is not configured".to_string(),
        })
}

#[utoipa::path(
    get,
    path = "/managed/secrets",
    operation_id = "get_managed_secrets",
    tag = "managed",
    responses((status = 200, description = "Write-only managed host secret metadata", body = ManagedSecretList, content_type = "application/json"), (status = 404, description = "Managed NAC is not configured", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Secret store unavailable", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<ManagedSecretList>, ApiError> {
    let secrets = application(&manager)?
        .list()?
        .into_iter()
        .map(|secret| ManagedSecretSummary {
            name: secret.name,
            updated_at_unix_ms: secret.updated_at_unix_ms,
        })
        .collect();
    Ok(Json(ManagedSecretList {
        secrets,
        healthy: true,
    }))
}

#[utoipa::path(
    put,
    path = "/managed/secrets/{name}",
    operation_id = "put_managed_secrets_name",
    tag = "managed",
    params(("name" = String, Path)),
    request_body(content = PutManagedSecretRequest, content_type = "application/json"),
    responses((status = 200, description = "Secret created or replaced without returning its value", body = ManagedSecretSummary, content_type = "application/json"), (status = 400, description = "Invalid or reserved secret", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Managed NAC is not configured", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Secret store unavailable", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn put_handler(
    State(manager): State<SessionManager>,
    AxumPath(name): AxumPath<String>,
    payload: Result<Json<PutManagedSecretRequest>, JsonRejection>,
) -> Result<Json<ManagedSecretSummary>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let summary = application(&manager)?
        .put(&name, &request.value)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    Ok(Json(ManagedSecretSummary {
        name: summary.name,
        updated_at_unix_ms: summary.updated_at_unix_ms,
    }))
}

#[utoipa::path(
    delete,
    path = "/managed/secrets/{name}",
    operation_id = "delete_managed_secrets_name",
    tag = "managed",
    params(("name" = String, Path)),
    responses((status = 204, description = "Secret removed from future command environments"), (status = 404, description = "Managed NAC or secret not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Secret store unavailable", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_handler(
    State(manager): State<SessionManager>,
    AxumPath(name): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    if application(&manager)?.delete(&name)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("managed secret '{name}' was not found"),
        })
    }
}
