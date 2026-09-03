use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{application::credentials::CredentialApplication, ApiError, ApiErrorBody};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct StoredCredentialSummary {
    pub name: String,
    /// Empty when the secret is too short for a suffix to be safe to show.
    pub last_four: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct StoredCredentialList {
    pub credentials: Vec<StoredCredentialSummary>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct StoreCredentialRequest {
    #[schema(write_only, example = "fake-credential-value")]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GeneratedCredential {
    pub name: String,
}

/// Stored credentials are write-only over HTTP: only redacted metadata leaves
/// the process.
#[utoipa::path(
    get,
    path = "/credentials",
    operation_id = "get_credentials",
    tag = "credentials",
    responses((status = 200, description = "Success", body = StoredCredentialList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_handler() -> Result<Json<StoredCredentialList>, ApiError> {
    let credentials = CredentialApplication::list()?
        .into_iter()
        .map(|entry| StoredCredentialSummary {
            name: entry.name,
            last_four: entry.last_four,
        })
        .collect();
    Ok(Json(StoredCredentialList { credentials }))
}

#[utoipa::path(
    put,
    path = "/credentials/{name}",
    operation_id = "put_credentials_name",
    tag = "credentials",
    params(("name" = String, Path)),
    request_body(content = StoreCredentialRequest, content_type = "application/json"),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn put_handler(
    AxumPath(name): AxumPath<String>,
    payload: Result<Json<StoreCredentialRequest>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    CredentialApplication::put(&name, &request.value)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/credentials",
    operation_id = "post_credentials",
    tag = "credentials",
    request_body(content = StoreCredentialRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = GeneratedCredential, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn generate_handler(
    payload: Result<Json<StoreCredentialRequest>, JsonRejection>,
) -> Result<Json<GeneratedCredential>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(GeneratedCredential {
        name: CredentialApplication::generate(&request.value)?,
    }))
}

#[utoipa::path(
    delete,
    path = "/credentials/{name}",
    operation_id = "delete_credentials_name",
    tag = "credentials",
    params(("name" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_handler(
    AxumPath(name): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    if CredentialApplication::delete(&name)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("no stored credential named '{name}' was found"),
        ))
    }
}
