//! HTTP surface for the MCP library and the stored MCP servers.
//!
//! Secret handling mirrors the credential endpoints: header and env values are
//! write-only. A response only ever carries a `${ENV_VAR}` reference verbatim
//! or a masked preview of a literal, and an update request may send null for a
//! value to keep what is stored.

use std::collections::BTreeMap;

use axum::extract::{rejection::JsonRejection, Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use nac_core::mcp_configurations::{
    self as mcp, McpProbedTool, McpServerConfig, McpServerConfigurationRecord,
    McpServerConfigurationStoreError, McpTransportConfig, NewMcpServerConfiguration,
    MCP_TRANSPORT_STDIO, MCP_TRANSPORT_STREAMABLE_HTTP,
};
use serde::{Deserialize, Serialize};

use crate::{ApiError, RequestField, SessionManager};

#[derive(Debug, Clone, Serialize)]
pub struct McpLibraryEntryView {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub transport: &'static str,
    pub url: &'static str,
    pub auth: mcp::McpLibraryAuth,
    pub auth_header: Option<&'static str>,
    pub auth_hint: Option<&'static str>,
    pub docs_url: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpLibraryResponse {
    pub entries: Vec<McpLibraryEntryView>,
}

/// A stored server as the dashboard sees it: env and header values are
/// redacted, everything else round-trips.
#[derive(Debug, Clone, Serialize)]
pub struct McpServerView {
    pub config_id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub library_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerList {
    pub servers: Vec<McpServerView>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMcpServerRequest {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    #[serde(default)]
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
#[derive(Debug, Clone, Default, Deserialize)]
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
    pub env: RequestField<BTreeMap<String, Option<String>>>,
    #[serde(default)]
    pub url: RequestField<String>,
    #[serde(default)]
    pub headers: RequestField<BTreeMap<String, Option<String>>>,
    #[serde(default)]
    pub library_id: RequestField<String>,
}

/// Probes a server before anything is saved. Either names a stored server or
/// carries the draft inline; inline map values may be null to borrow the
/// stored value when `config_id` is also given.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TestMcpServerRequest {
    pub config_id: Option<String>,
    pub name: Option<String>,
    pub transport: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, Option<String>>>,
    pub url: Option<String>,
    pub headers: Option<BTreeMap<String, Option<String>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestMcpServerResponse {
    pub tools: Vec<McpProbedTool>,
}

/// A literal never leaves the process whole: only a `${ENV_VAR}` reference —
/// which carries no secret — echoes back unchanged.
fn redact_value(value: &str) -> String {
    if value.contains("${") {
        return value.to_string();
    }
    let chars: Vec<char> = value.chars().collect();
    if chars.len() > 8 {
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
        config_id: record.config_id,
        name: record.name,
        enabled: record.enabled,
        transport: record.transport,
        command: record.command,
        args: record.args,
        url: record.url,
        library_id: record.library_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
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

pub async fn library_handler() -> Json<McpLibraryResponse> {
    let entries = mcp::library_entries()
        .iter()
        .map(|entry| McpLibraryEntryView {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            transport: entry.transport,
            url: entry.url,
            auth: entry.auth,
            auth_header: entry.auth_header,
            auth_hint: entry.auth_hint,
            docs_url: entry.docs_url,
        })
        .collect();
    Json(McpLibraryResponse { entries })
}

pub async fn list_servers_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<McpServerList>, ApiError> {
    let servers = mcp::list_mcp_server_configurations(manager.store_path())?
        .into_iter()
        .map(view)
        .collect();
    Ok(Json(McpServerList { servers }))
}

pub async fn create_server_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<CreateMcpServerRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<McpServerView>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let id = uuid::Uuid::new_v4();
    let configuration = NewMcpServerConfiguration {
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
    let record =
        mcp::insert_mcp_server_configuration(manager.store_path(), &id.to_string(), configuration)?;
    Ok((StatusCode::CREATED, Json(view(record))))
}

pub async fn update_server_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
    payload: Result<Json<UpdateMcpServerRequest>, JsonRejection>,
) -> Result<Json<McpServerView>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let existing = mcp::load_mcp_server_configuration(manager.store_path(), &config_id)?;

    let configuration = NewMcpServerConfiguration {
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
            RequestField::Omitted => existing.library_id.clone(),
        },
    };

    let record =
        mcp::update_mcp_server_configuration(manager.store_path(), &config_id, configuration)?;
    Ok(Json(view(record)))
}

pub async fn delete_server_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    mcp::load_mcp_server_configuration(manager.store_path(), &config_id)?;
    mcp::delete_mcp_server_configuration(manager.store_path(), &config_id)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn test_server_handler(
    State(manager): State<SessionManager>,
    payload: Result<Json<TestMcpServerRequest>, JsonRejection>,
) -> Result<Json<TestMcpServerResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;

    let stored = match request.config_id.as_deref() {
        Some(config_id) => Some(mcp::load_mcp_server_configuration(
            manager.store_path(),
            config_id,
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
            let env = match request.env {
                Some(env) => merge_map(env, stored_env.unwrap_or(&empty))?,
                None => stored_env.cloned().unwrap_or_default(),
            };
            McpServerConfig {
                enabled: true,
                transport: McpTransportConfig::Stdio { command, args, env },
            }
        }
        MCP_TRANSPORT_STREAMABLE_HTTP => {
            let url = request
                .url
                .or_else(|| stored.as_ref().and_then(|record| record.url.clone()))
                .filter(|url| !url.trim().is_empty())
                .ok_or_else(|| ApiError::bad_request("a url is required".to_string()))?;
            let headers = match request.headers {
                Some(headers) => merge_map(headers, stored_headers.unwrap_or(&empty))?,
                None => stored_headers.cloned().unwrap_or_default(),
            };
            McpServerConfig {
                enabled: true,
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
            McpServerConfigurationStoreError::DuplicateName(_) => StatusCode::CONFLICT,
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
    fn references_pass_through_and_literals_are_masked() {
        assert_eq!(
            redact_value("Bearer ${GITHUB_TOKEN}"),
            "Bearer ${GITHUB_TOKEN}"
        );
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
