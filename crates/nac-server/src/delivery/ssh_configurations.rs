use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use nac_core::ssh_configurations::SshConfigurationRecord;
use serde::{Deserialize, Serialize};

use crate::application::ssh_aliases::{AliasDiscovery, AliasDiscoveryWarning, SshAliasApplication};
use crate::{application, ApiError, ApiErrorBody, RequestField, SessionManager};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateSshConfigurationRequest {
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
}

/// Edits a saved SSH setup in place. Every field is tri-state: omit it to keep
/// what is stored, send null to clear it, send a value to replace it.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateSshConfigurationRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub ssh_host: RequestField<String>,
    #[serde(default)]
    pub ssh_port: RequestField<u16>,
    #[serde(default)]
    pub ssh_identity_file: RequestField<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SshConfigurationList {
    pub configurations: Vec<SshConfigurationRecord>,
}

/// Literal `Host` aliases from the NAC server user's `~/.ssh/config` and the
/// Include files it names statically. Only alias names are returned; host
/// names, users, keys and file contents never are.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct OpenSshAliasList {
    /// Aliases in first-seen order, without duplicates.
    pub aliases: Vec<String>,
    /// Host patterns present but not listed: wildcards, negations and names
    /// ssh cannot take as a destination. They still work through manual entry.
    pub undiscoverable_patterns: u32,
    /// Why the list may be incomplete. Never names a path or file contents.
    pub warnings: Vec<OpenSshAliasWarning>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OpenSshAliasWarning {
    HomeUnavailable,
    UnreadableFile,
    OversizedFile,
    MissingInclude,
    IncludeCycle,
    IncludeDepthExceeded,
    FileLimitReached,
    AliasLimitReached,
    UnsupportedInclude,
    ConditionalIncludeSkipped,
    MalformedLine,
}

impl From<AliasDiscovery> for OpenSshAliasList {
    fn from(discovery: AliasDiscovery) -> Self {
        Self {
            aliases: discovery.aliases,
            undiscoverable_patterns: u32::try_from(discovery.undiscoverable_patterns)
                .unwrap_or(u32::MAX),
            warnings: discovery
                .warnings
                .into_iter()
                .map(|warning| match warning {
                    AliasDiscoveryWarning::HomeUnavailable => OpenSshAliasWarning::HomeUnavailable,
                    AliasDiscoveryWarning::UnreadableFile => OpenSshAliasWarning::UnreadableFile,
                    AliasDiscoveryWarning::OversizedFile => OpenSshAliasWarning::OversizedFile,
                    AliasDiscoveryWarning::MissingInclude => OpenSshAliasWarning::MissingInclude,
                    AliasDiscoveryWarning::IncludeCycle => OpenSshAliasWarning::IncludeCycle,
                    AliasDiscoveryWarning::IncludeDepthExceeded => {
                        OpenSshAliasWarning::IncludeDepthExceeded
                    }
                    AliasDiscoveryWarning::FileLimitReached => {
                        OpenSshAliasWarning::FileLimitReached
                    }
                    AliasDiscoveryWarning::AliasLimitReached => {
                        OpenSshAliasWarning::AliasLimitReached
                    }
                    AliasDiscoveryWarning::UnsupportedInclude => {
                        OpenSshAliasWarning::UnsupportedInclude
                    }
                    AliasDiscoveryWarning::ConditionalIncludeSkipped => {
                        OpenSshAliasWarning::ConditionalIncludeSkipped
                    }
                    AliasDiscoveryWarning::MalformedLine => OpenSshAliasWarning::MalformedLine,
                })
                .collect(),
        }
    }
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
    path = "/ssh-configs",
    operation_id = "get_ssh_configs",
    tag = "ssh-configs",
    responses((status = 200, description = "Success", body = SshConfigurationList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<SshConfigurationList>, ApiError> {
    Ok(Json(SshConfigurationList {
        configurations: manager.ssh_configurations().list()?,
    }))
}

/// OpenSSH aliases the NAC server's own user has configured. This reads the
/// server machine's `~/.ssh/config`, never the browser's. Discovery problems
/// degrade to a partial list with warnings rather than an error.
#[utoipa::path(
    get,
    path = "/ssh/aliases",
    operation_id = "get_ssh_aliases",
    tag = "ssh-configs",
    responses((status = 200, description = "Success", body = OpenSshAliasList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn aliases_handler() -> Result<Json<OpenSshAliasList>, ApiError> {
    Ok(Json(
        SshAliasApplication::for_server_user()
            .discover()
            .await?
            .into(),
    ))
}

#[utoipa::path(
    post,
    path = "/ssh-configs",
    operation_id = "post_ssh_configs",
    tag = "ssh-configs",
    request_body(content = CreateSshConfigurationRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = SshConfigurationRecord, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateSshConfigurationRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<SshConfigurationRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let record = manager.ssh_configurations().create(
        application::ssh_configurations::CreateSshConfiguration {
            name: request.name,
            ssh_host: request.ssh_host,
            ssh_port: request.ssh_port,
            ssh_identity_file: request.ssh_identity_file,
        },
    )?;
    Ok((StatusCode::CREATED, Json(record)))
}

#[utoipa::path(
    patch,
    path = "/ssh-configs/{config_id}",
    operation_id = "patch_ssh_configs_config_id",
    tag = "ssh-configs",
    params(("config_id" = String, Path)),
    request_body(content = UpdateSshConfigurationRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = SshConfigurationRecord, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
    payload: Result<Json<UpdateSshConfigurationRequest>, JsonRejection>,
) -> Result<Json<SshConfigurationRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.ssh_configurations().update(
        &config_id,
        application::ssh_configurations::UpdateSshConfiguration {
            name: field(request.name),
            ssh_host: field(request.ssh_host),
            ssh_port: field(request.ssh_port),
            ssh_identity_file: field(request.ssh_identity_file),
        },
    )?))
}

#[utoipa::path(
    delete,
    path = "/ssh-configs/{config_id}",
    operation_id = "delete_ssh_configs_config_id",
    tag = "ssh-configs",
    params(("config_id" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    manager.ssh_configurations().delete(&config_id)?;
    Ok(StatusCode::NO_CONTENT)
}
