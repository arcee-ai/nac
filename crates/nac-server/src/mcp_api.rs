//! HTTP surface for the MCP library and the servers in `config.toml`.
//!
//! Servers live in the same `config.toml` a session parses when a worker
//! launches, keyed by name; a save is visible to the next worker launch, and
//! the process-local operational connection can be explicitly reloaded. Secret
//! handling mirrors the credential endpoints: header and env
//! values are write-only. A response only ever carries a `${ENV_VAR}`
//! reference verbatim or a masked preview of a literal, and an update request
//! may send null for a value to keep what is stored.

use std::collections::BTreeMap;
use std::path::PathBuf;

use axum::extract::{rejection::JsonRejection, Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use nac_core::mcp_configurations::{
    self as mcp, McpHeaderHelperConfig, McpProbeResult, McpProbedTool, McpServerConfig,
    McpServerConfigurationRecord, McpServerConfigurationStoreError, McpTransportConfig,
    MCP_TRANSPORT_STDIO, MCP_TRANSPORT_STREAMABLE_HTTP,
};
use serde::{Deserialize, Serialize};

use crate::{ApiError, RequestField, SessionManager};

#[derive(utoipa::ToSchema)]
#[schema(rename_all = "snake_case")]
#[allow(
    dead_code,
    reason = "OpenAPI owns this enum while runtime validation preserves the existing string DTO"
)]
enum McpTransportSchema {
    Stdio,
    StreamableHttp,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct McpLibraryResponse {
    pub entries: Vec<mcp::McpLibraryEntry>,
}

/// A saved server as the dashboard sees it: env and header values are
/// redacted, everything else round-trips.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct McpServerView {
    pub name: String,
    pub enabled: bool,
    pub required: bool,
    pub startup_timeout_ms: Option<u64>,
    pub catalog_timeout_ms: Option<u64>,
    pub execution_timeout_ms: Option<u64>,
    #[schema(value_type = McpTransportSchema)]
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub env_vars: Vec<String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub env_headers: BTreeMap<String, String>,
    pub bearer_token_env_var: Option<String>,
    pub header_helper: Option<McpHeaderHelperConfig>,
    pub library_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct McpServerList {
    pub servers: Vec<McpServerView>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateMcpServerRequest {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub required: bool,
    pub startup_timeout_ms: Option<u64>,
    pub catalog_timeout_ms: Option<u64>,
    pub execution_timeout_ms: Option<u64>,
    #[schema(value_type = McpTransportSchema)]
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    #[schema(write_only, example = json!({"TOKEN": "fake-token"}))]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub env_vars: Vec<String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    #[schema(write_only, example = json!({"Authorization": "Bearer fake-token"}))]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env_headers: BTreeMap<String, String>,
    pub bearer_token_env_var: Option<String>,
    pub header_helper: Option<McpHeaderHelperConfig>,
    pub library_id: Option<String>,
}

fn default_enabled() -> bool {
    true
}

/// Edits a stored server in place. Every field is tri-state: omit it to keep
/// what is stored, send null to clear it, send a value to replace it.
///
/// `env` and `headers` replace the whole map when sent, except that a null
/// value under a key keeps the stored value for that key — the stored value
/// is never echoed back, so this is how an untouched secret survives an edit.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateMcpServerRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub enabled: RequestField<bool>,
    #[serde(default)]
    pub required: RequestField<bool>,
    #[serde(default)]
    pub startup_timeout_ms: RequestField<u64>,
    #[serde(default)]
    pub catalog_timeout_ms: RequestField<u64>,
    #[serde(default)]
    pub execution_timeout_ms: RequestField<u64>,
    #[serde(default)]
    pub transport: RequestField<String>,
    #[serde(default)]
    pub command: RequestField<String>,
    #[serde(default)]
    pub args: RequestField<Vec<String>>,
    #[serde(default)]
    #[schema(write_only, example = json!({"TOKEN": "fake-replacement-token"}))]
    pub env: RequestField<BTreeMap<String, Option<String>>>,
    #[serde(default)]
    pub env_vars: RequestField<Vec<String>>,
    #[serde(default)]
    pub cwd: RequestField<String>,
    #[serde(default)]
    pub url: RequestField<String>,
    #[serde(default)]
    #[schema(write_only, example = json!({"Authorization": "Bearer fake-replacement-token"}))]
    pub headers: RequestField<BTreeMap<String, Option<String>>>,
    #[serde(default)]
    pub env_headers: RequestField<BTreeMap<String, String>>,
    #[serde(default)]
    pub bearer_token_env_var: RequestField<String>,
    #[serde(default)]
    pub header_helper: RequestField<UpdateMcpHeaderHelperRequest>,
    #[serde(default)]
    pub library_id: RequestField<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateMcpHeaderHelperRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    #[schema(write_only)]
    pub env: BTreeMap<String, Option<String>>,
    #[serde(default)]
    pub env_vars: Vec<String>,
    pub timeout_ms: Option<u64>,
}

/// Probes a server before anything is saved. Either names a saved server or
/// carries the draft inline; inline map values may be null to borrow the
/// stored value when `stored_name` is also given.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct TestMcpServerRequest {
    pub stored_name: Option<String>,
    pub name: Option<String>,
    pub transport: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env_vars: Option<Vec<String>>,
    #[schema(write_only, example = json!({"TOKEN": "fake-probe-token"}))]
    pub env: Option<BTreeMap<String, Option<String>>>,
    pub url: Option<String>,
    #[schema(write_only, example = json!({"Authorization": "Bearer fake-probe-token"}))]
    pub headers: Option<BTreeMap<String, Option<String>>>,
    pub env_headers: Option<BTreeMap<String, String>>,
    pub bearer_token_env_var: Option<String>,
    pub header_helper: Option<UpdateMcpHeaderHelperRequest>,
    pub startup_timeout_ms: Option<u64>,
    pub catalog_timeout_ms: Option<u64>,
    pub execution_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct TestMcpServerResponse {
    pub connected: bool,
    pub auth_required: bool,
    pub error: Option<String>,
    pub tools: Vec<McpProbedTool>,
    pub probe: Option<McpProbeResult>,
}

/// True when the whole value is one `${ENV_VAR}` reference and nothing else.
fn is_env_reference(value: &str) -> bool {
    value
        .strip_prefix("${")
        .and_then(|rest| rest.strip_suffix('}'))
        .is_some_and(|name| {
            !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

/// A literal never leaves the process whole: only a pure `${ENV_VAR}`
/// reference — which carries no secret — echoes back unchanged. Anything
/// else containing `${` is fully masked, since its literal parts may be
/// secret; a plain literal keeps a short suffix so it stays identifiable.
fn redact_value(value: &str) -> String {
    if is_env_reference(value) {
        return value.to_string();
    }
    let chars: Vec<char> = value.chars().collect();
    if !value.contains("${") && chars.len() > 8 {
        let suffix: String = chars[chars.len() - 4..].iter().collect();
        format!("****{suffix}")
    } else {
        "****".to_string()
    }
}

fn redact_map(values: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    values
        .iter()
        .map(|(key, value)| (key.clone(), redact_value(value)))
        .collect()
}

fn view(record: McpServerConfigurationRecord) -> McpServerView {
    let mut header_helper = record.header_helper;
    if let Some(helper) = &mut header_helper {
        helper.env = redact_map(&helper.env);
    }
    McpServerView {
        env: redact_map(&record.env),
        headers: redact_map(&record.headers),
        name: record.name,
        enabled: record.enabled,
        required: record.required,
        startup_timeout_ms: record.startup_timeout_ms,
        catalog_timeout_ms: record.catalog_timeout_ms,
        execution_timeout_ms: record.execution_timeout_ms,
        transport: record.transport,
        command: record.command,
        args: record.args,
        env_vars: record.env_vars,
        cwd: record.cwd,
        url: record.url,
        env_headers: record.env_headers,
        bearer_token_env_var: record.bearer_token_env_var,
        header_helper,
        library_id: record.library_id,
    }
}

fn config_path(manager: &SessionManager) -> Result<PathBuf, ApiError> {
    mcp::mcp_config_path(manager.root_cwd()).ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "no home directory to resolve config.toml under".to_string(),
        )
    })
}

/// Serializes config.toml edits: each write rewrites the whole file from a
/// fresh read, so two concurrent saves must not interleave.
static CONFIG_WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn optional_update<T>(sent: RequestField<T>, stored: Option<T>) -> Option<T> {
    match sent {
        RequestField::Value(value) => Some(value),
        RequestField::Null => None,
        RequestField::Omitted => stored,
    }
}

/// Settles a map edit against the stored map: the sent map replaces the whole
/// thing, but a null value borrows the stored value for that key.
fn merge_map(
    sent: BTreeMap<String, Option<String>>,
    stored: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, ApiError> {
    let mut merged = BTreeMap::new();
    for (key, value) in sent {
        match value {
            Some(value) => {
                merged.insert(key, value);
            }
            None => match stored.get(&key) {
                Some(stored_value) => {
                    merged.insert(key, stored_value.clone());
                }
                None => {
                    return Err(ApiError::bad_request(format!(
                        "no stored value under '{key}' to keep"
                    )));
                }
            },
        }
    }
    Ok(merged)
}

fn require_stored_http_origin(
    borrowed: bool,
    stored: Option<&McpServerConfigurationRecord>,
    url: &str,
) -> Result<(), ApiError> {
    if !borrowed {
        return Ok(());
    }
    let record = stored.ok_or_else(|| {
        ApiError::bad_request("borrowed HTTP credentials require a stored server".to_string())
    })?;
    if record.transport != MCP_TRANSPORT_STREAMABLE_HTTP || record.url.as_deref() != Some(url) {
        return Err(ApiError::bad_request(
            "stored HTTP credentials can only be tested against the stored URL".to_string(),
        ));
    }
    Ok(())
}

#[utoipa::path(
    get,
    path = "/mcp_library/servers",
    operation_id = "get_mcp_library_servers",
    tag = "mcp-library",
    responses((status = 200, description = "Success", body = McpServerList, content_type = "application/json"), (status = 409, description = "Configuration recovery is required", body = crate::ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn list_servers_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<McpServerList>, ApiError> {
    let servers = mcp::list_mcp_server_configurations(&config_path(&manager)?)?
        .into_iter()
        .map(view)
        .collect();
    Ok(Json(McpServerList { servers }))
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers",
    operation_id = "post_mcp_library_servers",
    tag = "mcp-library",
    request_body(content = CreateMcpServerRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = McpServerView, content_type = "application/json"), (status = 400, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn create_server_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateMcpServerRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<McpServerView>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let configuration = McpServerConfigurationRecord {
        name: request.name,
        enabled: request.enabled,
        required: request.required,
        startup_timeout_ms: request.startup_timeout_ms,
        catalog_timeout_ms: request.catalog_timeout_ms,
        execution_timeout_ms: request.execution_timeout_ms,
        transport: request.transport,
        command: request.command,
        args: request.args,
        env: request.env,
        env_vars: request.env_vars,
        cwd: request.cwd,
        url: request.url,
        headers: request.headers,
        env_headers: request.env_headers,
        bearer_token_env_var: request.bearer_token_env_var,
        header_helper: request.header_helper,
        library_id: request.library_id,
    };
    let _write = CONFIG_WRITE.lock().await;
    let path = config_path(&manager)?;
    let _cross_process = mcp::acquire_mcp_configuration_write_lease(&path)?;
    let record = mcp::insert_mcp_server_configuration(&path, configuration)?;
    Ok((StatusCode::CREATED, Json(view(record))))
}

#[utoipa::path(
    patch,
    path = "/mcp_library/servers/{server_name}",
    operation_id = "patch_mcp_library_servers_server_name",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    request_body(content = UpdateMcpServerRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = McpServerView, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((crate::ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn update_server_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
    payload: Result<Json<UpdateMcpServerRequest>, JsonRejection>,
) -> Result<Json<McpServerView>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let path = config_path(&manager)?;
    let _write = CONFIG_WRITE.lock().await;
    let _cross_process = mcp::acquire_mcp_configuration_write_lease(&path)?;
    let (existing, revision) = mcp::load_mcp_server_configuration_snapshot(&path, &server_name)?;

    let configuration = McpServerConfigurationRecord {
        name: match request.name {
            RequestField::Value(name) => name,
            RequestField::Null | RequestField::Omitted => existing.name.clone(),
        },
        enabled: match request.enabled {
            RequestField::Value(enabled) => enabled,
            RequestField::Null | RequestField::Omitted => existing.enabled,
        },
        required: match request.required {
            RequestField::Value(required) => required,
            RequestField::Null | RequestField::Omitted => existing.required,
        },
        startup_timeout_ms: optional_update(
            request.startup_timeout_ms,
            existing.startup_timeout_ms,
        ),
        catalog_timeout_ms: optional_update(
            request.catalog_timeout_ms,
            existing.catalog_timeout_ms,
        ),
        execution_timeout_ms: optional_update(
            request.execution_timeout_ms,
            existing.execution_timeout_ms,
        ),
        transport: match request.transport {
            RequestField::Value(transport) => transport,
            RequestField::Null | RequestField::Omitted => existing.transport.clone(),
        },
        command: match request.command {
            RequestField::Value(command) => Some(command),
            RequestField::Null => None,
            RequestField::Omitted => existing.command.clone(),
        },
        args: match request.args {
            RequestField::Value(args) => args,
            RequestField::Null => Vec::new(),
            RequestField::Omitted => existing.args.clone(),
        },
        env: match request.env {
            RequestField::Value(env) => merge_map(env, &existing.env)?,
            RequestField::Null => BTreeMap::new(),
            RequestField::Omitted => existing.env.clone(),
        },
        env_vars: match request.env_vars {
            RequestField::Value(values) => values,
            RequestField::Null => Vec::new(),
            RequestField::Omitted => existing.env_vars.clone(),
        },
        cwd: optional_update(request.cwd, existing.cwd.clone()),
        url: match request.url {
            RequestField::Value(url) => Some(url),
            RequestField::Null => None,
            RequestField::Omitted => existing.url.clone(),
        },
        headers: match request.headers {
            RequestField::Value(headers) => merge_map(headers, &existing.headers)?,
            RequestField::Null => BTreeMap::new(),
            RequestField::Omitted => existing.headers.clone(),
        },
        env_headers: match request.env_headers {
            RequestField::Value(values) => values,
            RequestField::Null => BTreeMap::new(),
            RequestField::Omitted => existing.env_headers.clone(),
        },
        bearer_token_env_var: optional_update(
            request.bearer_token_env_var,
            existing.bearer_token_env_var.clone(),
        ),
        header_helper: match request.header_helper {
            RequestField::Value(helper) => {
                let stored = existing.header_helper.as_ref();
                let borrowed = helper.env.values().any(Option::is_none);
                if borrowed
                    && !stored.is_some_and(|stored| {
                        stored.command == helper.command
                            && stored.args == helper.args
                            && stored.cwd == helper.cwd
                    })
                {
                    return Err(ApiError::bad_request(
                        "stored header-helper environment values can only be kept for the stored helper command"
                            .to_string(),
                    ));
                }
                Some(McpHeaderHelperConfig {
                    command: helper.command,
                    args: helper.args,
                    cwd: helper.cwd,
                    env: merge_map(
                        helper.env,
                        stored.map(|stored| &stored.env).unwrap_or(&BTreeMap::new()),
                    )?,
                    env_vars: helper.env_vars,
                    timeout_ms: helper.timeout_ms,
                })
            }
            RequestField::Null => None,
            RequestField::Omitted => existing.header_helper.clone(),
        },
        library_id: match request.library_id {
            RequestField::Value(id) => Some(id),
            RequestField::Null => None,
            RequestField::Omitted => existing.library_id,
        },
    };

    let record = mcp::update_mcp_server_configuration_at_revision(
        &path,
        &server_name,
        configuration,
        revision,
    )?;
    manager.mcp_runtime().forget(&server_name).await;
    Ok(Json(view(record)))
}

#[utoipa::path(
    delete,
    path = "/mcp_library/servers/{server_name}",
    operation_id = "delete_mcp_library_servers_server_name",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Configuration recovery is required", body = crate::ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn delete_server_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let _write = CONFIG_WRITE.lock().await;
    let path = config_path(&manager)?;
    let _cross_process = mcp::acquire_mcp_configuration_write_lease(&path)?;
    if !mcp::delete_mcp_server_configuration(&path, &server_name)? {
        return Err(McpServerConfigurationStoreError::NotFound(server_name).into());
    }
    manager.mcp_runtime().forget(&server_name).await;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/test",
    operation_id = "post_mcp_library_servers_test",
    tag = "mcp-library",
    request_body(content = TestMcpServerRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = TestMcpServerResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Configuration recovery is required", body = crate::ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn test_server_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<TestMcpServerRequest>, JsonRejection>,
) -> Result<Json<TestMcpServerResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;

    let stored = match request.stored_name.as_deref() {
        Some(stored_name) => Some(mcp::load_mcp_server_configuration(
            &config_path(&manager)?,
            stored_name,
        )?),
        None => None,
    };

    let name = request
        .name
        .or_else(|| stored.as_ref().map(|record| record.name.clone()))
        .unwrap_or_else(|| "draft".to_string());
    let transport = request
        .transport
        .or_else(|| stored.as_ref().map(|record| record.transport.clone()))
        .ok_or_else(|| ApiError::bad_request("a transport is required".to_string()))?;

    let stored_env = stored.as_ref().map(|record| &record.env);
    let stored_headers = stored.as_ref().map(|record| &record.headers);
    let empty = BTreeMap::new();
    let startup_timeout_ms = request
        .startup_timeout_ms
        .or_else(|| stored.as_ref().and_then(|record| record.startup_timeout_ms));
    let catalog_timeout_ms = request
        .catalog_timeout_ms
        .or_else(|| stored.as_ref().and_then(|record| record.catalog_timeout_ms));
    let execution_timeout_ms = request.execution_timeout_ms.or_else(|| {
        stored
            .as_ref()
            .and_then(|record| record.execution_timeout_ms)
    });

    let config = match transport.as_str() {
        MCP_TRANSPORT_STDIO => {
            let command = request
                .command
                .or_else(|| stored.as_ref().and_then(|record| record.command.clone()))
                .filter(|command| !command.trim().is_empty())
                .ok_or_else(|| ApiError::bad_request("a command is required".to_string()))?;
            let args = request
                .args
                .or_else(|| stored.as_ref().map(|record| record.args.clone()))
                .unwrap_or_default();
            let cwd = request
                .cwd
                .or_else(|| stored.as_ref().and_then(|record| record.cwd.clone()));
            let (env_vars, borrowed_env_vars) = match request.env_vars {
                Some(values) => (values, false),
                None => {
                    let values = stored
                        .as_ref()
                        .map(|record| record.env_vars.clone())
                        .unwrap_or_default();
                    let borrowed = !values.is_empty();
                    (values, borrowed)
                }
            };
            let (env, borrowed) = match request.env {
                Some(env) => {
                    let borrowed = env.values().any(Option::is_none);
                    (merge_map(env, stored_env.unwrap_or(&empty))?, borrowed)
                }
                None => {
                    let env = stored_env.cloned().unwrap_or_default();
                    let borrowed = !env.is_empty();
                    (env, borrowed)
                }
            };
            // Borrowed secrets end up in the spawned process's environment,
            // so they may only run the command they were stored for.
            if borrowed || borrowed_env_vars {
                let record = stored.as_ref().ok_or_else(|| {
                    ApiError::bad_request(
                        "borrowed environment values require a stored server".to_string(),
                    )
                })?;
                if record.transport != MCP_TRANSPORT_STDIO
                    || record.command.as_deref() != Some(command.as_str())
                    || record.args != args
                    || record.cwd != cwd
                {
                    return Err(ApiError::bad_request(
                        "stored environment credentials can only be tested with the stored command"
                            .to_string(),
                    ));
                }
            }
            McpServerConfig {
                enabled: true,
                library_id: None,
                required: false,
                startup_timeout_ms,
                catalog_timeout_ms,
                execution_timeout_ms,
                transport: McpTransportConfig::Stdio {
                    command,
                    args,
                    env,
                    env_vars,
                    cwd,
                },
            }
        }
        MCP_TRANSPORT_STREAMABLE_HTTP => {
            let url = request
                .url
                .or_else(|| stored.as_ref().and_then(|record| record.url.clone()))
                .filter(|url| !url.trim().is_empty())
                .ok_or_else(|| ApiError::bad_request("a url is required".to_string()))?;
            let (headers, borrowed_headers) = match request.headers {
                Some(headers) => {
                    let borrowed = headers.values().any(Option::is_none);
                    (
                        merge_map(headers, stored_headers.unwrap_or(&empty))?,
                        borrowed,
                    )
                }
                None => {
                    let headers = stored_headers.cloned().unwrap_or_default();
                    let borrowed = !headers.is_empty();
                    (headers, borrowed)
                }
            };
            let (env_headers, borrowed_env_headers) = match request.env_headers {
                Some(values) => (values, false),
                None => {
                    let values = stored
                        .as_ref()
                        .map(|record| record.env_headers.clone())
                        .unwrap_or_default();
                    let borrowed = !values.is_empty();
                    (values, borrowed)
                }
            };
            let (bearer_token_env_var, borrowed_bearer) = match request.bearer_token_env_var {
                Some(variable) => (Some(variable), false),
                None => {
                    let variable = stored
                        .as_ref()
                        .and_then(|record| record.bearer_token_env_var.clone());
                    let borrowed = variable.is_some();
                    (variable, borrowed)
                }
            };
            let stored_helper = stored
                .as_ref()
                .and_then(|record| record.header_helper.as_ref());
            let (header_helper, borrowed_helper) = match request.header_helper {
                Some(helper) => {
                    let borrowed = helper.env.values().any(Option::is_none);
                    if borrowed
                        && !stored_helper.is_some_and(|stored| {
                            stored.command == helper.command
                                && stored.args == helper.args
                                && stored.cwd == helper.cwd
                        })
                    {
                        return Err(ApiError::bad_request(
                            "stored header-helper environment values can only be tested with the stored helper command"
                                .to_string(),
                        ));
                    }
                    let env = merge_map(
                        helper.env,
                        stored_helper
                            .map(|stored| &stored.env)
                            .unwrap_or(&BTreeMap::new()),
                    )?;
                    (
                        Some(McpHeaderHelperConfig {
                            command: helper.command,
                            args: helper.args,
                            cwd: helper.cwd,
                            env,
                            env_vars: helper.env_vars,
                            timeout_ms: helper.timeout_ms,
                        }),
                        borrowed,
                    )
                }
                None => (stored_helper.cloned(), stored_helper.is_some()),
            };
            // Borrowed secrets and secret-producing helpers may only be used
            // against the exact URL they were stored for. A caller can still
            // explicitly supply new credential references for a new draft.
            require_stored_http_origin(
                borrowed_headers || borrowed_env_headers || borrowed_bearer || borrowed_helper,
                stored.as_ref(),
                &url,
            )?;
            McpServerConfig {
                enabled: true,
                library_id: None,
                required: false,
                startup_timeout_ms,
                catalog_timeout_ms,
                execution_timeout_ms,
                transport: McpTransportConfig::StreamableHttp {
                    url,
                    headers,
                    env_headers,
                    bearer_token_env_var,
                    header_helper,
                },
            }
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "transport must be '{MCP_TRANSPORT_STDIO}' or \
             '{MCP_TRANSPORT_STREAMABLE_HTTP}', not '{other}'"
            )));
        }
    };

    let defaults = mcp::load_mcp_defaults(&config_path(&manager)?)?;
    match mcp::probe_mcp_server(&name, &config, &defaults, manager.root_cwd()).await {
        Ok(probe) => Ok(Json(TestMcpServerResponse {
            connected: true,
            auth_required: false,
            error: None,
            tools: probe.tools.clone(),
            probe: Some(probe),
        })),
        Err(error) => {
            let auth_required = mcp::mcp_error_requires_authorization(&error);
            let message = if auth_required {
                "authentication required; refresh the configured credentials and retry".to_string()
            } else {
                format!("{error:#}")
            };
            Ok(Json(TestMcpServerResponse {
                connected: false,
                auth_required,
                error: Some(message),
                tools: Vec::new(),
                probe: None,
            }))
        }
    }
}

impl From<McpServerConfigurationStoreError> for ApiError {
    fn from(error: McpServerConfigurationStoreError) -> Self {
        let status = match &error {
            McpServerConfigurationStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            McpServerConfigurationStoreError::DuplicateName(_)
            | McpServerConfigurationStoreError::ConcurrentModification
            | McpServerConfigurationStoreError::RecoveryRequired { .. } => StatusCode::CONFLICT,
            McpServerConfigurationStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            McpServerConfigurationStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self::new(status, error.to_string())
    }
}

#[cfg(test)]
mod tests;
