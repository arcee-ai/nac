use std::path::PathBuf;

use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use nac_core::{
    model::{
        list_managed_provider_models, list_provider_models, provider_default_base_url,
        provider_for_model, resolve_backend_api_key, resolve_model_base_url, BackendKind,
        ManagedAuthProvider, ProviderModel, ReasoningEffort,
    },
    model_configurations,
    runtime::NacConfig,
};
use serde::{Deserialize, Serialize};

use crate::{enforce_trusted_base_url, parse_request_enum, ApiError, SessionManager};

#[derive(Debug, Clone, Deserialize)]
pub struct ModelConfigFromFileRequest {
    pub path: String,
}

/// A configuration that has been checked end to end: the destination is
/// approved, the credential resolves, and the provider answered with the
/// models it allows.
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedModelConfiguration {
    pub backend: BackendKind,
    pub model: Option<String>,
    pub base_url: String,
    pub api_key_env: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub models: Vec<ProviderModel>,
    /// Why the list is empty, when a stored login could not be asked. An empty
    /// list without this is a provider that simply offers no index.
    pub models_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderModelsRequest {
    pub backend: BackendKind,
    pub api_key: Option<String>,
    /// Names a key already held in the environment or in NAC home, for a caller
    /// that has one on file and no copy of the secret to send.
    pub api_key_env: Option<String>,
    /// Overrides the provider's canonical URL, for a proxy or a custom gateway.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderModelList {
    /// The URL the models were actually read from, so the caller can persist
    /// the same destination it validated against.
    pub base_url: String,
    pub models: Vec<ProviderModel>,
}

pub(super) fn routes() -> Router<SessionManager> {
    Router::new()
        .route("/providers/models", post(provider_models_handler))
        .route(
            "/model-configs/from-file",
            post(model_config_from_file_handler),
        )
        .route(
            "/model-configs/{config_id}/models",
            post(saved_model_config_models_handler),
        )
}

async fn provider_models_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<ProviderModelsRequest>, JsonRejection>,
) -> Result<Json<ProviderModelList>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let backend = request.backend;
    let api_key = request.api_key.unwrap_or_default();
    let api_key_env = request
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());

    if let Some(provider) = ManagedAuthProvider::for_backend(backend) {
        if !api_key.trim().is_empty() || api_key_env.is_some() {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: format!(
                    "backend '{backend}' authenticates with a stored login and accepts no API key"
                ),
            });
        }
        let models = list_managed_provider_models(provider)
            .await
            .map_err(|error| ApiError {
                status: StatusCode::BAD_GATEWAY,
                message: error.to_string(),
            })?;
        let base_url = provider_default_base_url(backend)
            .map(str::to_string)
            .unwrap_or_default();
        return Ok(Json(ProviderModelList { base_url, models }));
    }

    let api_key = match api_key_env {
        Some(name) if api_key.trim().is_empty() => resolve_backend_api_key(backend, Some(name))
            .map_err(|error| ApiError {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            })?,
        _ => api_key,
    };
    if api_key.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' requires a nonblank API key"),
        });
    }
    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| provider_default_base_url(backend).map(str::to_string))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' has no default base URL; supply one"),
        })?;
    enforce_trusted_base_url(
        Some(backend),
        Some(base_url.as_str()),
        &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
    )?;
    let models = list_provider_models(backend, &base_url, &api_key)
        .await
        .map_err(|error| ApiError {
            status: StatusCode::BAD_GATEWAY,
            message: error.to_string(),
        })?;
    Ok(Json(ProviderModelList { base_url, models }))
}

pub(super) fn settle_base_url(
    manager: &SessionManager,
    backend: BackendKind,
    requested: Option<&str>,
) -> Result<String, ApiError> {
    let base_url = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| provider_default_base_url(backend).map(str::to_string))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' has no default base URL; supply one"),
        })?;
    let base_url = resolve_model_base_url(backend, Some(base_url))?;
    enforce_trusted_base_url(
        Some(backend),
        Some(base_url.as_str()),
        &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
    )?;
    Ok(base_url)
}

async fn model_config_from_file_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<ModelConfigFromFileRequest>, JsonRejection>,
) -> Result<Json<ResolvedModelConfiguration>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let path = PathBuf::from(request.path.trim());
    if path.as_os_str().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "a configuration file path is required".to_string(),
        });
    }
    let config = NacConfig::load_from_file(&path).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: error.to_string(),
    })?;
    let identity = NacConfig::load_model_identity_from_file(&path).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: error.to_string(),
    })?;
    let backend = identity
        .backend
        .or_else(|| config.model.model.as_deref().and_then(provider_for_model))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!(
                "{} names no model the catalog recognizes, so it cannot describe a provider",
                path.display()
            ),
        })?;
    resolve_configuration(
        &manager,
        backend,
        config.model.model,
        identity.base_url,
        identity.api_key_env,
        config.model.reasoning_effort,
    )
    .await
}

async fn saved_model_config_models_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> Result<Json<ResolvedModelConfiguration>, ApiError> {
    let record =
        model_configurations::load_model_configuration(&manager.inner.store_path, &config_id)?;
    let backend: BackendKind = record.backend.parse().map_err(|message: String| ApiError {
        status: StatusCode::BAD_REQUEST,
        message,
    })?;
    let reasoning_effort = record
        .reasoning_effort
        .as_deref()
        .map(|raw| parse_request_enum::<ReasoningEffort>(raw, "reasoning_effort"))
        .transpose()?;
    resolve_configuration(
        &manager,
        backend,
        Some(record.model),
        Some(record.base_url),
        record.api_key_env,
        reasoning_effort,
    )
    .await
}

async fn resolve_configuration(
    manager: &SessionManager,
    backend: BackendKind,
    model: Option<String>,
    base_url: Option<String>,
    api_key_env: Option<String>,
    reasoning_effort: Option<ReasoningEffort>,
) -> Result<Json<ResolvedModelConfiguration>, ApiError> {
    let base_url = settle_base_url(manager, backend, base_url.as_deref())?;
    let mut models_error = None;
    let models = match ManagedAuthProvider::for_backend(backend) {
        Some(provider) => match list_managed_provider_models(provider).await {
            Ok(models) => models,
            Err(error) => {
                models_error = Some(error.to_string());
                Vec::new()
            }
        },
        None => {
            let api_key =
                resolve_backend_api_key(backend, api_key_env.as_deref()).map_err(|error| {
                    ApiError {
                        status: StatusCode::BAD_REQUEST,
                        message: error.to_string(),
                    }
                })?;
            list_provider_models(backend, &base_url, &api_key)
                .await
                .map_err(|error| ApiError {
                    status: StatusCode::BAD_GATEWAY,
                    message: error.to_string(),
                })?
        }
    };
    Ok(Json(ResolvedModelConfiguration {
        backend,
        model,
        base_url,
        api_key_env,
        reasoning_effort,
        models,
        models_error,
    }))
}
