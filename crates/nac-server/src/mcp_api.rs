//! HTTP surface for the MCP library and the servers in `config.toml`.
//!
//! Servers live in the same `config.toml` a session parses when a worker
//! launches, keyed by name; a save is visible to the next run with no reload
//! step. Secret handling mirrors the credential endpoints: header and env
//! values are write-only. A response only ever carries a `${ENV_VAR}`
//! reference verbatim or a masked preview of a literal, and an update request
//! may send null for a value to keep what is stored.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use axum::extract::{rejection::JsonRejection, Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use nac_core::mcp_configurations::{
    self as mcp, McpProbedTool, McpServerConfig, McpServerConfigurationRecord,
    McpServerConfigurationStoreError, McpTransportConfig, MCP_TRANSPORT_STDIO,
    MCP_TRANSPORT_STREAMABLE_HTTP,
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
    #[schema(value_type = McpTransportSchema)]
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
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
    #[schema(value_type = McpTransportSchema)]
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    #[schema(write_only, example = json!({"TOKEN": "fake-token"}))]
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    #[serde(default)]
    #[schema(write_only, example = json!({"Authorization": "Bearer fake-token"}))]
    pub headers: BTreeMap<String, String>,
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
    pub transport: RequestField<String>,
    #[serde(default)]
    pub command: RequestField<String>,
    #[serde(default)]
    pub args: RequestField<Vec<String>>,
    #[serde(default)]
    #[schema(write_only, example = json!({"TOKEN": "fake-replacement-token"}))]
    pub env: RequestField<BTreeMap<String, Option<String>>>,
    #[serde(default)]
    pub url: RequestField<String>,
    #[serde(default)]
    #[schema(write_only, example = json!({"Authorization": "Bearer fake-replacement-token"}))]
    pub headers: RequestField<BTreeMap<String, Option<String>>>,
    #[serde(default)]
    pub library_id: RequestField<String>,
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
    #[schema(write_only, example = json!({"TOKEN": "fake-probe-token"}))]
    pub env: Option<BTreeMap<String, Option<String>>>,
    pub url: Option<String>,
    #[schema(write_only, example = json!({"Authorization": "Bearer fake-probe-token"}))]
    pub headers: Option<BTreeMap<String, Option<String>>>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct TestMcpServerResponse {
    pub tools: Vec<McpProbedTool>,
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
    McpServerView {
        env: redact_map(&record.env),
        headers: redact_map(&record.headers),
        name: record.name,
        enabled: record.enabled,
        transport: record.transport,
        command: record.command,
        args: record.args,
        url: record.url,
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

/// How long a registry answer keeps serving before the next request refetches
/// it. A failed refetch keeps the previous answer and resets the clock, so an
/// unreachable registry costs one attempt per interval, never the catalog.
const LIBRARY_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

static LIBRARY_CACHE: tokio::sync::Mutex<Option<(Instant, Vec<mcp::McpLibraryEntry>)>> =
    tokio::sync::Mutex::const_new(None);

/// The embedded catalog, extended by verified servers from the Smithery
/// registry when it answers in time.
#[utoipa::path(
    get,
    path = "/mcp_library/library",
    operation_id = "get_mcp_library_library",
    tag = "mcp-library",
    responses((status = 200, description = "Success", body = McpLibraryResponse, content_type = "application/json"))
)]
pub async fn library_handler() -> Json<McpLibraryResponse> {
    Json(McpLibraryResponse {
        entries: library_entries().await,
    })
}

/// Fills the library cache ahead of the first request, so opening the picker
/// shows the full catalog immediately instead of waiting on the registry.
pub async fn warm_library_cache() {
    let _ = library_entries().await;
}

/// Serializes refreshes without holding `LIBRARY_CACHE` across the fetch, so
/// readers keep getting the cached catalog while a refresh is in flight.
static LIBRARY_REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn library_entries() -> Vec<mcp::McpLibraryEntry> {
    if let Some((fetched_at, entries)) = LIBRARY_CACHE.lock().await.as_ref() {
        if fetched_at.elapsed() < LIBRARY_CACHE_TTL {
            return entries.clone();
        }
        // An expired catalog still answers this request; the refresh runs in
        // the background for a later one. The task carries the guard, so a
        // second expired read cannot schedule another.
        if let Ok(refresh) = LIBRARY_REFRESH.try_lock() {
            tokio::spawn(async move {
                refresh_library_cache(refresh).await;
            });
        }
        return entries.clone();
    }
    let refresh = LIBRARY_REFRESH.lock().await;
    refresh_library_cache(refresh).await
}

async fn refresh_library_cache(
    _refresh: tokio::sync::MutexGuard<'static, ()>,
) -> Vec<mcp::McpLibraryEntry> {
    if let Some((fetched_at, entries)) = LIBRARY_CACHE.lock().await.as_ref() {
        if fetched_at.elapsed() < LIBRARY_CACHE_TTL {
            return entries.clone();
        }
    }
    let entries = match mcp::fetch_smithery_library_entries().await {
        Ok(remote) => mcp::merge_library_entries(remote),
        Err(error) => {
            eprintln!("MCP library registry fetch failed: {error:#}");
            // The catalog is renewed in place so no reader sees it missing.
            let mut cache = LIBRARY_CACHE.lock().await;
            return match cache.as_mut() {
                Some((fetched_at, stale)) => {
                    *fetched_at = Instant::now();
                    stale.clone()
                }
                None => {
                    let embedded = mcp::embedded_library_entries();
                    *cache = Some((Instant::now(), embedded.clone()));
                    embedded
                }
            };
        }
    };
    *LIBRARY_CACHE.lock().await = Some((Instant::now(), entries.clone()));
    entries
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
        transport: request.transport,
        command: request.command,
        args: request.args,
        env: request.env,
        url: request.url,
        headers: request.headers,
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
            if borrowed {
                let record = stored.as_ref().ok_or_else(|| {
                    ApiError::bad_request(
                        "borrowed environment values require a stored server".to_string(),
                    )
                })?;
                if record.transport != MCP_TRANSPORT_STDIO
                    || record.command.as_deref() != Some(command.as_str())
                    || record.args != args
                {
                    return Err(ApiError::bad_request(
                        "stored env values can only be tested with the stored command".to_string(),
                    ));
                }
            }
            McpServerConfig {
                enabled: true,
                library_id: None,
                transport: McpTransportConfig::Stdio { command, args, env },
            }
        }
        MCP_TRANSPORT_STREAMABLE_HTTP => {
            let url = request
                .url
                .or_else(|| stored.as_ref().and_then(|record| record.url.clone()))
                .filter(|url| !url.trim().is_empty())
                .ok_or_else(|| ApiError::bad_request("a url is required".to_string()))?;
            let (headers, borrowed) = match request.headers {
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
            // Borrowed secrets are sent with the request, so they may only
            // travel to the URL they were stored for.
            if borrowed {
                let record = stored.as_ref().ok_or_else(|| {
                    ApiError::bad_request(
                        "borrowed header values require a stored server".to_string(),
                    )
                })?;
                if record.transport != MCP_TRANSPORT_STREAMABLE_HTTP
                    || record.url.as_deref() != Some(url.as_str())
                {
                    return Err(ApiError::bad_request(
                        "stored header values can only be tested against the stored URL"
                            .to_string(),
                    ));
                }
            }
            McpServerConfig {
                enabled: true,
                library_id: None,
                transport: McpTransportConfig::StreamableHttp { url, headers },
            }
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "transport must be '{MCP_TRANSPORT_STDIO}' or \
             '{MCP_TRANSPORT_STREAMABLE_HTTP}', not '{other}'"
            )));
        }
    };

    let tools = mcp::probe_mcp_server(&name, &config, manager.root_cwd())
        .await
        .map_err(|error| ApiError::bad_request(format!("{error:#}")))?;
    Ok(Json(TestMcpServerResponse { tools }))
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
mod tests {
    use super::*;

    #[test]
    fn recoverable_publication_conflicts_remain_http_conflicts() {
        let error: ApiError = McpServerConfigurationStoreError::RecoveryRequired {
            config: PathBuf::from("/tmp/config.toml"),
            preserved: PathBuf::from("/tmp/config.toml.saved.tmp"),
        }
        .into();
        assert_eq!(error.status, StatusCode::CONFLICT);
        assert!(error.message.contains("removes the preserved file"));
        assert!(error.message.contains("byte-identical"));
    }

    #[test]
    fn references_pass_through_and_literals_are_masked() {
        assert_eq!(redact_value("${GITHUB_TOKEN}"), "${GITHUB_TOKEN}");
        assert_eq!(redact_value("Bearer ${GITHUB_TOKEN}"), "****");
        assert_eq!(redact_value("sk-secret${odd"), "****");
        assert_eq!(redact_value("sk-1234567890abcdef"), "****cdef");
        assert_eq!(redact_value("short"), "****");
    }

    #[test]
    fn merge_map_keeps_stored_values_for_null_entries() {
        let stored = BTreeMap::from([("Authorization".to_string(), "Bearer real".to_string())]);
        let sent = BTreeMap::from([
            ("Authorization".to_string(), None),
            ("X-Extra".to_string(), Some("literal".to_string())),
        ]);
        let merged = merge_map(sent, &stored).unwrap();
        assert_eq!(merged.get("Authorization").unwrap(), "Bearer real");
        assert_eq!(merged.get("X-Extra").unwrap(), "literal");

        let missing = BTreeMap::from([("Unknown".to_string(), None)]);
        assert!(merge_map(missing, &stored).is_err());
    }
}
