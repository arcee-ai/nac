use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    Json,
};
use nac_core::{
    model::{
        provider_default_base_url, provider_uses_api_key, resolve_model_base_url_with_policy,
        store_api_key, BackendKind,
    },
    store::{insert_provider_connection, ProviderConnectionRecord},
};
use serde::{Deserialize, Serialize};

use crate::{ApiError, ApiErrorBody, SessionManager};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct CreateProviderConnectionRequest {
    backend: BackendKind,
    base_url: Option<String>,
    #[serde(default)]
    allow_insecure_http: bool,
    #[schema(write_only, example = "fake-api-key")]
    api_key: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ProviderConnectionCreated {
    connection_id: String,
}

#[utoipa::path(
    post,
    path = "/provider-connections",
    operation_id = "post_provider_connections",
    tag = "credentials",
    request_body(content = CreateProviderConnectionRequest, content_type = "application/json"),
    responses((status = 201, description = "Provider connection saved", body = ProviderConnectionCreated), (status = 400, description = "Invalid provider connection", body = ApiErrorBody), (status = 500, description = "Storage failure", body = ApiErrorBody))
)]
pub(crate) async fn create_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateProviderConnectionRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ProviderConnectionCreated>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    if !provider_uses_api_key(request.backend) || request.api_key.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "A non-empty API key is required for an API-key provider".to_string(),
        ));
    }
    let requested = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .or_else(|| provider_default_base_url(request.backend).map(str::to_owned));
    let base_url =
        resolve_model_base_url_with_policy(request.backend, requested, request.allow_insecure_http)
            .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?;
    let connection_id = uuid::Uuid::new_v4().to_string();
    let selector = format!("NAC_PROVIDER_{}", uuid::Uuid::new_v4().simple());
    let record = ProviderConnectionRecord {
        connection_id: connection_id.clone(),
        backend: request.backend.to_string(),
        base_url,
        allow_insecure_http: request.allow_insecure_http,
        api_key_env: selector,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let path = manager.inner.store_path.clone();
    nac_core::store::spawn_blocking_store_caller(move || {
        store_api_key(&record.api_key_env, request.api_key.trim())?;
        // If the database outcome is uncertain, retain the secret rather than
        // risk deleting a credential referenced by a committed connection.
        insert_provider_connection(&path, &record)
    })
    .await??;
    Ok((
        StatusCode::CREATED,
        Json(ProviderConnectionCreated { connection_id }),
    ))
}
