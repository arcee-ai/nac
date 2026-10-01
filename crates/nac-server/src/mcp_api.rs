//! HTTP surface for the MCP library and the servers in `config.toml`.
//!
//! Servers live in the same `config.toml` a session parses when a worker
//! launches, keyed by name; a save is visible to the next worker launch, and
//! the process-local operational connection can be explicitly reloaded. Secret
//! handling mirrors the credential endpoints: header and env
//! values are write-only. A response only ever carries a `${ENV_VAR}`
//! reference verbatim or a masked preview of a literal, and an update request
//! may send null for a value to keep what is stored.

use std::collections::{BTreeMap, HashMap};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::Duration;

use axum::extract::{rejection::JsonRejection, Path as AxumPath, RawQuery, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use nac_core::mcp_configurations::{
    self as mcp, McpHeaderHelperConfig, McpProbeResult, McpProbedTool, McpProtocolSelection,
    McpServerConfig, McpServerConfigurationRecord, McpServerConfigurationStoreError,
    McpToolApproval, McpTransportConfig, MCP_TRANSPORT_STDIO, MCP_TRANSPORT_STREAMABLE_HTTP,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

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
    pub protocol: McpProtocolSelection,
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
    pub allowed_tools: Option<Vec<String>>,
    pub denied_tools: Vec<String>,
    pub approval: McpToolApproval,
    pub tool_approvals: BTreeMap<String, McpToolApproval>,
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
    #[serde(default)]
    pub protocol: McpProtocolSelection,
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
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub denied_tools: Vec<String>,
    #[serde(default)]
    pub approval: McpToolApproval,
    #[serde(default)]
    pub tool_approvals: BTreeMap<String, McpToolApproval>,
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
    pub protocol: RequestField<McpProtocolSelection>,
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
    #[serde(default)]
    pub allowed_tools: RequestField<Vec<String>>,
    #[serde(default)]
    pub denied_tools: RequestField<Vec<String>>,
    #[serde(default)]
    pub approval: RequestField<McpToolApproval>,
    #[serde(default)]
    pub tool_approvals: RequestField<BTreeMap<String, McpToolApproval>>,
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
    pub protocol: Option<McpProtocolSelection>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct TestMcpServerResponse {
    pub connected: bool,
    pub auth_required: bool,
    pub error: Option<String>,
    pub tools: Vec<McpProbedTool>,
    pub probe: Option<McpProbeResult>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ConfigureMcpOAuthRequest {
    #[serde(default)]
    pub registration: Option<McpOAuthRegistrationRequest>,
    #[serde(default)]
    #[schema(write_only, deprecated)]
    pub client_id_credential: Option<String>,
    #[serde(default)]
    #[schema(write_only, deprecated)]
    pub client_secret_credential: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub authorization_metadata: Option<McpOAuthAuthorizationMetadataRequest>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpOAuthRegistrationRequest {
    PreRegistered {
        #[schema(write_only)]
        client_id_credential: String,
        #[serde(default)]
        #[schema(write_only)]
        client_secret_credential: Option<String>,
    },
    ClientMetadata {
        url: String,
    },
    Dynamic {
        #[serde(default)]
        client_name: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct McpOAuthAuthorizationMetadataRequest {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub registration_endpoint: Option<String>,
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub jwks_uri: Option<String>,
    #[serde(default)]
    pub scopes_supported: Option<Vec<String>>,
    #[serde(default)]
    pub response_types_supported: Option<Vec<String>>,
    #[serde(default)]
    pub code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(flatten)]
    #[schema(additional_properties = true)]
    pub additional_fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthPublicStatus {
    NeedsConfiguration,
    NeedsAuthorization,
    Connecting,
    Connected,
    Failed,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct McpOAuthStatusResponse {
    pub status: McpOAuthPublicStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct AuthenticateMcpOAuthResponse {
    pub status: McpOAuthPublicStatus,
    pub authorization_url: String,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct AuthenticateMcpOAuthRequest {
    #[serde(default)]
    pub additional_scopes: Vec<String>,
}

enum OAuthFlowState {
    Connecting {
        generation: u64,
        authorization_url: String,
        task: Option<tokio::task::JoinHandle<()>>,
    },
    Failed,
}

type OAuthFlowKey = (PathBuf, String);

static OAUTH_FLOWS: LazyLock<tokio::sync::Mutex<HashMap<OAuthFlowKey, OAuthFlowState>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));
static OAUTH_FLOW_GENERATION: AtomicU64 = AtomicU64::new(1);
pub const MCP_OAUTH_CALLBACK_ORIGIN_ENV: &str = "NAC_MCP_OAUTH_CALLBACK_ORIGIN";

enum OAuthCallbackTarget {
    Loopback,
    Remote { redirect_uri: String },
}

fn oauth_flow_key(manager: &SessionManager, server_name: &str) -> OAuthFlowKey {
    (manager.root_cwd().to_path_buf(), server_name.to_string())
}

async fn remove_oauth_flow(flow_key: &OAuthFlowKey) {
    let flow = OAUTH_FLOWS.lock().await.remove(flow_key);
    if let Some(OAuthFlowState::Connecting {
        task: Some(task), ..
    }) = flow
    {
        task.abort();
        let _ = task.await;
    }
}

async fn fail_oauth_flow_if_current(flow_key: OAuthFlowKey, generation: u64, endpoint: &str) {
    let mut flows = OAUTH_FLOWS.lock().await;
    let authorization_url = match flows.get(&flow_key) {
        Some(OAuthFlowState::Connecting {
            generation: value,
            authorization_url,
            ..
        }) if *value == generation => authorization_url.clone(),
        _ => return,
    };
    match mcp::fail_mcp_oauth_authorization(
        &flow_key.0,
        &flow_key.1,
        endpoint,
        Some(&authorization_url),
    ) {
        Ok(true) => {
            flows.insert(flow_key, OAuthFlowState::Failed);
        }
        Ok(false) => {
            flows.remove(&flow_key);
        }
        Err(error) => {
            eprintln!(
                "MCP server '{}': failed to clear abandoned OAuth authorization: {error:#}",
                flow_key.1
            );
            flows.insert(flow_key, OAuthFlowState::Failed);
        }
    }
}

#[cfg(test)]
pub(crate) async fn fail_current_oauth_flow_for_test(manager: &SessionManager, server_name: &str) {
    let flow_key = oauth_flow_key(manager, server_name);
    let generation = {
        let flows = OAUTH_FLOWS.lock().await;
        match flows.get(&flow_key) {
            Some(OAuthFlowState::Connecting { generation, .. }) => *generation,
            _ => panic!("expected a current OAuth flow"),
        }
    };
    let endpoint = oauth_endpoint(manager, server_name).expect("expected an OAuth endpoint");
    fail_oauth_flow_if_current(flow_key, generation, &endpoint).await;
}

fn callback_matches_authorization_state(authorization_url: &str, callback_url: &str) -> bool {
    let Ok(authorization_url) = url::Url::parse(authorization_url) else {
        return false;
    };
    let Ok(callback_url) = url::Url::parse(callback_url) else {
        return false;
    };
    let mut expected_values = authorization_url
        .query_pairs()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| value.into_owned());
    let Some(expected) = expected_values.next() else {
        return false;
    };
    if expected_values.next().is_some() {
        return false;
    }
    let mut actual_values = callback_url
        .query_pairs()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| value.into_owned());
    matches!(actual_values.next(), Some(actual) if actual == expected)
        && actual_values.next().is_none()
}

fn callback_matches_pending_authorization(
    pending_authorization_url: Option<&str>,
    callback_url: &str,
) -> bool {
    pending_authorization_url
        .is_some_and(|url| callback_matches_authorization_state(url, callback_url))
}

fn callback_reports_oauth_error(callback_url: &str) -> bool {
    url::Url::parse(callback_url).is_ok_and(|url| {
        url.query_pairs()
            .any(|(name, value)| name == "error" && !value.is_empty())
    })
}

fn remote_callback_uri(origin: &str, server_name: &str) -> Result<String, ApiError> {
    let mut url = url::Url::parse(origin)
        .map_err(|_| ApiError::bad_request("the OAuth callback origin is invalid".to_string()))?;
    let loopback = match url.host() {
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(ApiError::bad_request(
            "the OAuth callback origin must use HTTPS".to_string(),
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(ApiError::bad_request(
            "the OAuth callback origin must contain only a scheme and authority".to_string(),
        ));
    }
    url.set_path("");
    {
        let mut path = url.path_segments_mut().map_err(|_| {
            ApiError::bad_request("the OAuth callback origin cannot be a base URL".to_string())
        })?;
        path.extend(["mcp_library", "servers", server_name, "oauth", "callback"]);
    }
    Ok(url.to_string())
}

fn oauth_callback_target(
    manager: &SessionManager,
    server_name: &str,
) -> Result<OAuthCallbackTarget, ApiError> {
    if let Some(managed) = manager.managed_host() {
        return remote_callback_uri(&format!("https://{}", managed.public_hostname), server_name)
            .map(|redirect_uri| OAuthCallbackTarget::Remote { redirect_uri });
    }
    match std::env::var(MCP_OAUTH_CALLBACK_ORIGIN_ENV) {
        Ok(origin) if !origin.trim().is_empty() => remote_callback_uri(&origin, server_name)
            .map(|redirect_uri| OAuthCallbackTarget::Remote { redirect_uri }),
        _ => Ok(OAuthCallbackTarget::Loopback),
    }
}

fn oauth_redirect_uri(manager: &SessionManager, server_name: &str) -> Result<String, ApiError> {
    Ok(match oauth_callback_target(manager, server_name)? {
        OAuthCallbackTarget::Loopback => mcp::MCP_OAUTH_REDIRECT_URI.to_string(),
        OAuthCallbackTarget::Remote { redirect_uri } => redirect_uri,
    })
}

pub(crate) fn synchronize_mcp_oauth_redirect_uris(manager: &SessionManager) -> Result<(), String> {
    let Some(config_path) = mcp::mcp_config_path(manager.root_cwd()) else {
        return Ok(());
    };
    let servers = mcp::list_mcp_server_configurations(&config_path)
        .map_err(|error| format!("MCP server configuration could not be read: {error}"))?;
    let mut errors = Vec::new();
    for server in servers {
        if server.transport != MCP_TRANSPORT_STREAMABLE_HTTP {
            continue;
        }
        match mcp::has_mcp_oauth_profile(manager.root_cwd(), &server.name) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(error) => {
                errors.push(format!(
                    "MCP OAuth profile for '{}' could not be read: {error:#}",
                    server.name
                ));
                continue;
            }
        }
        let Some(endpoint) = server.url.as_deref() else {
            continue;
        };
        let redirect_uri = match oauth_redirect_uri(manager, &server.name) {
            Ok(redirect_uri) => redirect_uri,
            Err(_) => {
                errors.push(format!(
                    "MCP OAuth callback origin for '{}' is invalid",
                    server.name
                ));
                continue;
            }
        };
        if let Err(error) = mcp::set_mcp_oauth_redirect_uri(
            manager.root_cwd(),
            &server.name,
            endpoint,
            &redirect_uri,
        ) {
            errors.push(format!(
                "MCP OAuth redirect URI for '{}' could not be synchronized: {error:#}",
                server.name
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
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
        protocol: record.protocol,
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
        allowed_tools: record.allowed_tools,
        denied_tools: record.denied_tools,
        approval: record.approval,
        tool_approvals: record.tool_approvals,
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

fn approval_update(
    sent: RequestField<McpToolApproval>,
    stored: McpToolApproval,
) -> McpToolApproval {
    match sent {
        RequestField::Value(approval) => approval,
        RequestField::Null => McpToolApproval::default(),
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
        protocol: request.protocol,
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
        allowed_tools: request.allowed_tools,
        denied_tools: request.denied_tools,
        approval: request.approval,
        tool_approvals: request.tool_approvals,
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
        protocol: match request.protocol {
            RequestField::Value(protocol) => protocol,
            RequestField::Null | RequestField::Omitted => existing.protocol,
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
        allowed_tools: match request.allowed_tools {
            RequestField::Value(tools) => Some(tools),
            RequestField::Null => None,
            RequestField::Omitted => existing.allowed_tools,
        },
        denied_tools: match request.denied_tools {
            RequestField::Value(tools) => tools,
            RequestField::Null => Vec::new(),
            RequestField::Omitted => existing.denied_tools,
        },
        approval: approval_update(request.approval, existing.approval),
        tool_approvals: match request.tool_approvals {
            RequestField::Value(approvals) => approvals,
            RequestField::Null => BTreeMap::new(),
            RequestField::Omitted => existing.tool_approvals,
        },
    };

    let record = mcp::update_mcp_server_configuration_at_revision(
        &path,
        &server_name,
        configuration,
        revision,
    )?;
    if server_name != record.name {
        remove_oauth_flow(&oauth_flow_key(&manager, &server_name)).await;
        remove_oauth_flow(&oauth_flow_key(&manager, &record.name)).await;
        let redirect_uri = oauth_redirect_uri(&manager, &record.name)?;
        mcp::rename_mcp_oauth_profile(
            manager.root_cwd(),
            &server_name,
            &record.name,
            &redirect_uri,
        )
        .map_err(|_| {
            oauth_error(
                StatusCode::CONFLICT,
                "MCP OAuth configuration could not be renamed",
            )
        })?;
    }
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
    remove_oauth_flow(&oauth_flow_key(&manager, &server_name)).await;
    mcp::delete_mcp_oauth_profile(manager.root_cwd(), &server_name).map_err(|_| {
        oauth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "MCP OAuth cleanup failed",
        )
    })?;
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
    let protocol = request
        .protocol
        .or_else(|| stored.as_ref().map(|record| record.protocol))
        .unwrap_or_default();

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
                protocol,
                allowed_tools: None,
                denied_tools: Vec::new(),
                approval: McpToolApproval::Ask,
                tool_approvals: BTreeMap::new(),
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
                protocol,
                allowed_tools: None,
                denied_tools: Vec::new(),
                approval: McpToolApproval::Ask,
                tool_approvals: BTreeMap::new(),
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

fn oauth_endpoint(manager: &SessionManager, server_name: &str) -> Result<String, ApiError> {
    let record = mcp::load_mcp_server_configuration(&config_path(manager)?, server_name)?;
    if record.transport != MCP_TRANSPORT_STREAMABLE_HTTP {
        return Err(ApiError::bad_request(
            "OAuth is available only for streamable HTTP MCP servers".to_string(),
        ));
    }
    record
        .url
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("the MCP server URL is missing".to_string()))
}

fn oauth_error(status: StatusCode, message: &'static str) -> ApiError {
    ApiError::new(status, message.to_string())
}

fn public_oauth_status(status: mcp::McpOAuthStatus) -> McpOAuthPublicStatus {
    match status {
        mcp::McpOAuthStatus::NeedsConfiguration => McpOAuthPublicStatus::NeedsConfiguration,
        mcp::McpOAuthStatus::NeedsAuthorization => McpOAuthPublicStatus::NeedsAuthorization,
        mcp::McpOAuthStatus::Connected => McpOAuthPublicStatus::Connected,
    }
}

fn oauth_registration(
    request: ConfigureMcpOAuthRequest,
) -> Result<
    (
        mcp::McpOAuthRegistration,
        Vec<String>,
        Option<mcp::McpOAuthAuthorizationMetadata>,
    ),
    ApiError,
> {
    let registration = match request.registration {
        Some(McpOAuthRegistrationRequest::PreRegistered {
            client_id_credential,
            client_secret_credential,
        }) => mcp::McpOAuthRegistration::PreRegistered {
            client_id_credential,
            client_secret_credential,
        },
        Some(McpOAuthRegistrationRequest::ClientMetadata { url }) => {
            mcp::McpOAuthRegistration::ClientMetadata { url }
        }
        Some(McpOAuthRegistrationRequest::Dynamic { client_name }) => {
            mcp::McpOAuthRegistration::Dynamic { client_name }
        }
        None => {
            let client_id_credential = request.client_id_credential.ok_or_else(|| {
                ApiError::bad_request("an OAuth registration method is required".to_string())
            })?;
            mcp::McpOAuthRegistration::PreRegistered {
                client_id_credential,
                client_secret_credential: request.client_secret_credential,
            }
        }
    };
    let metadata = request
        .authorization_metadata
        .map(|value| mcp::McpOAuthAuthorizationMetadata {
            authorization_endpoint: value.authorization_endpoint,
            token_endpoint: value.token_endpoint,
            registration_endpoint: value.registration_endpoint,
            issuer: value.issuer,
            jwks_uri: value.jwks_uri,
            scopes_supported: value.scopes_supported,
            response_types_supported: value.response_types_supported,
            code_challenge_methods_supported: value.code_challenge_methods_supported,
            additional_fields: value.additional_fields.into_iter().collect(),
        });
    Ok((registration, request.scopes, metadata))
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/{server_name}/oauth/configure",
    operation_id = "post_mcp_library_servers_server_name_oauth_configure",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    request_body(content = ConfigureMcpOAuthRequest, content_type = "application/json"),
    responses((status = 200, description = "OAuth configuration saved", body = McpOAuthStatusResponse, content_type = "application/json"), (status = 400, description = "Configuration rejected", body = crate::ApiErrorBody, content_type = "application/json"), (status = 404, description = "MCP server not found", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn configure_oauth_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
    payload: Result<Json<ConfigureMcpOAuthRequest>, JsonRejection>,
) -> Result<Json<McpOAuthStatusResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let endpoint = oauth_endpoint(&manager, &server_name)?;
    let (registration, scopes, authorization_metadata) = oauth_registration(request)?;
    let redirect_uri = oauth_redirect_uri(&manager, &server_name)?;
    mcp::configure_mcp_oauth(
        manager.root_cwd(),
        &server_name,
        &endpoint,
        mcp::McpOAuthConfiguration {
            registration,
            scopes,
            authorization_metadata,
        },
    )
    .map_err(|_| {
        oauth_error(
            StatusCode::BAD_REQUEST,
            "MCP OAuth configuration was rejected",
        )
    })?;
    mcp::set_mcp_oauth_redirect_uri(manager.root_cwd(), &server_name, &endpoint, &redirect_uri)
        .map_err(|_| {
            oauth_error(
                StatusCode::BAD_REQUEST,
                "MCP OAuth callback could not be configured",
            )
        })?;
    let status = mcp::mcp_oauth_status(manager.root_cwd(), &server_name, &endpoint)
        .map_err(|_| oauth_error(StatusCode::BAD_REQUEST, "MCP OAuth status is unavailable"))?;
    remove_oauth_flow(&oauth_flow_key(&manager, &server_name)).await;
    Ok(Json(McpOAuthStatusResponse {
        status: public_oauth_status(status),
        message: None,
        authorization_url: None,
    }))
}

#[utoipa::path(
    get,
    path = "/mcp_library/servers/{server_name}/oauth/status",
    operation_id = "get_mcp_library_servers_server_name_oauth_status",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 200, description = "OAuth status", body = McpOAuthStatusResponse, content_type = "application/json"), (status = 404, description = "MCP server not found", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn oauth_status_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
) -> Result<Json<McpOAuthStatusResponse>, ApiError> {
    let endpoint = oauth_endpoint(&manager, &server_name)?;
    let flow_key = oauth_flow_key(&manager, &server_name);
    let (active_authorization_url, flow_failed) = {
        let flows = OAUTH_FLOWS.lock().await;
        match flows.get(&flow_key) {
            Some(OAuthFlowState::Connecting {
                authorization_url, ..
            }) => (Some(authorization_url.clone()), false),
            Some(OAuthFlowState::Failed) => (None, true),
            None => (None, false),
        }
    };
    let (active_authorization_url, pending_authorization_url) = reconcile_oauth_status_urls(
        active_authorization_url,
        mcp::mcp_oauth_pending_authorization_url(manager.root_cwd(), &server_name, &endpoint),
    )
    .map_err(|_| oauth_error(StatusCode::BAD_REQUEST, "MCP OAuth status is unavailable"))?;
    if let Some(active_authorization_url) = active_authorization_url {
        return Ok(Json(McpOAuthStatusResponse {
            status: McpOAuthPublicStatus::Connecting,
            message: None,
            authorization_url: Some(active_authorization_url),
        }));
    }
    let status = mcp::mcp_oauth_status(manager.root_cwd(), &server_name, &endpoint)
        .map_err(|_| oauth_error(StatusCode::BAD_REQUEST, "MCP OAuth status is unavailable"))?;
    if flow_failed
        && pending_authorization_url.is_none()
        && !matches!(status, mcp::McpOAuthStatus::Connected)
    {
        return Ok(Json(McpOAuthStatusResponse {
            status: McpOAuthPublicStatus::Failed,
            message: Some(
                "OAuth authorization did not complete; start authentication again".to_string(),
            ),
            authorization_url: None,
        }));
    }
    let authorization_url = if matches!(
        oauth_callback_target(&manager, &server_name)?,
        OAuthCallbackTarget::Remote { .. }
    ) {
        pending_authorization_url
    } else {
        None
    };
    Ok(Json(McpOAuthStatusResponse {
        status: public_oauth_status(status),
        message: None,
        authorization_url,
    }))
}

fn reconcile_oauth_status_urls(
    active_authorization_url: Option<String>,
    pending_authorization_url: anyhow::Result<Option<String>>,
) -> anyhow::Result<(Option<String>, Option<String>)> {
    let pending_authorization_url = pending_authorization_url?;
    let active_authorization_url = active_authorization_url
        .filter(|active| pending_authorization_url.as_deref() == Some(active.as_str()));
    Ok((active_authorization_url, pending_authorization_url))
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/{server_name}/oauth/authenticate",
    operation_id = "post_mcp_library_servers_server_name_oauth_authenticate",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    request_body(content = AuthenticateMcpOAuthRequest, content_type = "application/json"),
    responses((status = 200, description = "OAuth browser authorization ready", body = AuthenticateMcpOAuthResponse, content_type = "application/json"), (status = 400, description = "Authentication could not start", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Loopback callback is unavailable", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn authenticate_oauth_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
    payload: Option<Json<AuthenticateMcpOAuthRequest>>,
) -> Result<Json<AuthenticateMcpOAuthResponse>, ApiError> {
    let endpoint = oauth_endpoint(&manager, &server_name)?;
    let flow_key = oauth_flow_key(&manager, &server_name);
    let request = payload.map(|Json(value)| value).unwrap_or_default();
    let callback = oauth_callback_target(&manager, &server_name)?;

    remove_oauth_flow(&flow_key).await;

    let (listeners, redirect_uri) = match callback {
        OAuthCallbackTarget::Loopback => {
            let listeners = OAuthCallbackListeners::bind(1456).await.map_err(|_| {
                oauth_error(
                    StatusCode::CONFLICT,
                    "the local OAuth callback port is unavailable",
                )
            })?;
            (Some(listeners), mcp::MCP_OAUTH_REDIRECT_URI.to_string())
        }
        OAuthCallbackTarget::Remote { redirect_uri } => (None, redirect_uri),
    };
    let session = mcp::begin_mcp_oauth_authorization(
        manager.root_cwd(),
        &server_name,
        &endpoint,
        &redirect_uri,
        &request.additional_scopes,
    )
    .await
    .map_err(|_| {
        oauth_error(
            StatusCode::BAD_REQUEST,
            "MCP OAuth authentication could not start",
        )
    })?;
    let authorization_url = session.authorization_url().to_string();
    let generation = OAUTH_FLOW_GENERATION.fetch_add(1, Ordering::Relaxed);
    let completion_key = flow_key.clone();
    let completion_endpoint = endpoint.clone();
    let (start_sender, start_receiver) = tokio::sync::oneshot::channel();
    let task = match listeners {
        Some(listeners) => Some(tokio::spawn(async move {
            if start_receiver.await.is_err() {
                return;
            }
            let success = run_oauth_callback(listeners, session).await;
            if success {
                let mut flows = OAUTH_FLOWS.lock().await;
                if matches!(flows.get(&completion_key), Some(OAuthFlowState::Connecting { generation: value, .. }) if *value == generation)
                {
                    flows.remove(&completion_key);
                }
            } else {
                fail_oauth_flow_if_current(completion_key, generation, &completion_endpoint).await;
            }
        })),
        None => Some(tokio::spawn(async move {
            if start_receiver.await.is_err() {
                return;
            }
            drop(session);
            tokio::time::sleep(mcp::MCP_OAUTH_STATE_TTL).await;
            fail_oauth_flow_if_current(completion_key, generation, &completion_endpoint).await;
        })),
    };
    OAUTH_FLOWS.lock().await.insert(
        flow_key,
        OAuthFlowState::Connecting {
            generation,
            authorization_url: authorization_url.clone(),
            task,
        },
    );
    let _ = start_sender.send(());
    Ok(Json(AuthenticateMcpOAuthResponse {
        status: McpOAuthPublicStatus::Connecting,
        authorization_url,
    }))
}

struct OAuthCallbackListeners {
    ipv4: TcpListener,
    ipv6: Option<TcpListener>,
}

impl OAuthCallbackListeners {
    async fn bind(port: u16) -> std::io::Result<Self> {
        let ipv4 = TcpListener::bind(("127.0.0.1", port)).await?;
        let port = ipv4.local_addr()?.port();
        let ipv6 = match TcpListener::bind(("::1", port)).await {
            Ok(listener) => Some(listener),
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::AddrNotAvailable | ErrorKind::Unsupported
                ) =>
            {
                None
            }
            Err(error) => return Err(error),
        };
        Ok(Self { ipv4, ipv6 })
    }

    async fn accept(&self) -> std::io::Result<TcpStream> {
        if let Some(ipv6) = &self.ipv6 {
            tokio::select! {
                accepted = self.ipv4.accept() => accepted.map(|(stream, _)| stream),
                accepted = ipv6.accept() => accepted.map(|(stream, _)| stream),
            }
        } else {
            self.ipv4.accept().await.map(|(stream, _)| stream)
        }
    }
}

#[utoipa::path(
    get,
    path = "/mcp_library/servers/{server_name}/oauth/callback",
    operation_id = "get_mcp_library_servers_server_name_oauth_callback",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 200, description = "OAuth authorization complete", content_type = "text/plain"), (status = 400, description = "OAuth callback rejected", content_type = "text/plain"))
)]
pub async fn oauth_callback_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
    RawQuery(query): RawQuery,
) -> Response {
    let result = async {
        let endpoint = oauth_endpoint(&manager, &server_name)?;
        let flow_key = oauth_flow_key(&manager, &server_name);
        let OAuthCallbackTarget::Remote { redirect_uri } =
            oauth_callback_target(&manager, &server_name)?
        else {
            return Err(ApiError::bad_request(
                "remote MCP OAuth callbacks are not configured".to_string(),
            ));
        };
        let callback_url = match query {
            Some(query) => format!("{redirect_uri}?{query}"),
            None => redirect_uri,
        };
        let completion = mcp::complete_mcp_oauth_authorization(
            manager.root_cwd(),
            &server_name,
            &endpoint,
            &callback_url,
        )
        .await;
        let mut flows = OAUTH_FLOWS.lock().await;
        match completion {
            Ok(()) => {
                flows.remove(&flow_key);
                Ok::<_, ApiError>(())
            }
            Err(_) => {
                let pending_authorization_url = mcp::mcp_oauth_pending_authorization_url(
                    manager.root_cwd(),
                    &server_name,
                    &endpoint,
                )
                .map_err(|_| {
                    oauth_error(StatusCode::BAD_REQUEST, "MCP OAuth callback was rejected")
                })?;
                let matches_current = callback_matches_pending_authorization(
                    pending_authorization_url.as_deref(),
                    &callback_url,
                );
                let retryable = mcp::mcp_oauth_callback_is_retryable(
                    manager.root_cwd(),
                    &server_name,
                    &endpoint,
                    &callback_url,
                )
                .unwrap_or(false);
                if (callback_reports_oauth_error(&callback_url) || !retryable)
                    && matches_current
                {
                    match mcp::fail_mcp_oauth_authorization(
                        manager.root_cwd(),
                        &server_name,
                        &endpoint,
                        pending_authorization_url.as_deref(),
                    ) {
                        Ok(true) => { flows.insert(flow_key, OAuthFlowState::Failed); }
                        Ok(false) => { flows.remove(&flow_key); }
                        Err(error) => eprintln!(
                            "MCP server '{server_name}': failed to clear rejected OAuth authorization: {error:#}"
                        ),
                    }
                }
                Err(ApiError::bad_request(
                    "MCP OAuth callback was rejected".to_string(),
                ))
            }
        }
    }
    .await;

    let (status, body) = match result {
        Ok(()) => (
            StatusCode::OK,
            "Authorization complete. You can close this window.",
        ),
        Err(_) => (
            StatusCode::BAD_REQUEST,
            "Authorization could not be completed. Return to NAC and try again.",
        ),
    };
    let mut response = (status, body).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn run_oauth_callback(
    listeners: OAuthCallbackListeners,
    session: mcp::McpOAuthAuthorizationSession,
) -> bool {
    let deadline = tokio::time::Instant::now() + mcp::MCP_OAUTH_STATE_TTL;
    loop {
        let Ok(Ok(mut stream)) = tokio::time::timeout_at(deadline, listeners.accept()).await else {
            return false;
        };
        let mut request = vec![0_u8; 8192];
        let read_deadline = std::cmp::min(
            deadline,
            tokio::time::Instant::now() + Duration::from_secs(5),
        );
        let Ok(Ok(read)) = tokio::time::timeout_at(read_deadline, stream.read(&mut request)).await
        else {
            continue;
        };
        let Some(target) = oauth_callback_request_target(&request[..read]) else {
            write_oauth_callback_response(
                &mut stream,
                "404 Not Found",
                "This is not an active OAuth callback.",
            )
            .await;
            continue;
        };
        let callback_url = format!("http://localhost:1456{target}");
        if !session.matches_callback_state(&callback_url) {
            write_oauth_callback_response(
                &mut stream,
                "400 Bad Request",
                "This OAuth callback is stale or invalid. Return to NAC and try again.",
            )
            .await;
            continue;
        }
        let success = session.handle_callback_url(&callback_url).await.is_ok();
        let (status, body) = if success {
            (
                "200 OK",
                "Authorization complete. You can close this window.",
            )
        } else {
            (
                "400 Bad Request",
                "Authorization could not be completed. Return to NAC and try again.",
            )
        };
        write_oauth_callback_response(&mut stream, status, body).await;
        return success;
    }
}

fn oauth_callback_request_target(request: &[u8]) -> Option<&str> {
    if request.is_empty() || request.len() == 8192 {
        return None;
    }
    let request = std::str::from_utf8(request).ok()?;
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    let (Some("GET"), Some(target), Some(version)) = (parts.next(), parts.next(), parts.next())
    else {
        return None;
    };
    (version.starts_with("HTTP/1.")
        && parts.next().is_none()
        && target.split('?').next() == Some(mcp::MCP_OAUTH_CALLBACK_PATH))
    .then_some(target)
}

async fn write_oauth_callback_response(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[utoipa::path(
    post,
    path = "/mcp_library/servers/{server_name}/oauth/logout",
    operation_id = "post_mcp_library_servers_server_name_oauth_logout",
    tag = "mcp-library",
    params(("server_name" = String, Path)),
    responses((status = 200, description = "OAuth credentials cleared", body = McpOAuthStatusResponse, content_type = "application/json"), (status = 404, description = "MCP server not found", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub async fn logout_oauth_handler(
    State(manager): State<SessionManager>,
    AxumPath(server_name): AxumPath<String>,
) -> Result<Json<McpOAuthStatusResponse>, ApiError> {
    let _ = oauth_endpoint(&manager, &server_name)?;
    remove_oauth_flow(&oauth_flow_key(&manager, &server_name)).await;
    let status = mcp::clear_mcp_oauth(manager.root_cwd(), &server_name).map_err(|_| {
        oauth_error(
            StatusCode::BAD_REQUEST,
            "MCP OAuth logout could not complete",
        )
    })?;
    Ok(Json(McpOAuthStatusResponse {
        status: public_oauth_status(status),
        message: None,
        authorization_url: None,
    }))
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
