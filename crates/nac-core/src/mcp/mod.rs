#![allow(
    deprecated,
    reason = "NAC still advertises the legacy roots capability for backward-compatible MCP clients"
)]

use std::collections::{BTreeMap, HashMap};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::header::{HeaderName, HeaderValue};
use rmcp::handler::client::ClientHandler;
use rmcp::model::{
    CallToolRequestParams, ClientConfig, Implementation, ListRootsResult, ProtocolVersion, Root,
    Tool,
};
use rmcp::service::ClientServiceExt;
use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;
use url::Url;

use crate::paths::PathContext;
use crate::sandbox::SandboxSession;
use crate::tools::ToolResult;
use crate::types::{FunctionDef, ToolDefinition};

pub(crate) mod capabilities;
mod catalog_sync;
mod config;
#[cfg(feature = "test-support")]
mod conformance;
mod file_config;
mod invocation;
mod library;
mod lifecycle;
mod naming;
mod oauth;
mod registry;
mod result;
mod sync;
mod transport;

pub use capabilities::{McpPromptArgument, McpPromptCommand, McpPromptInvocation};
pub use config::{
    McpDefaults, McpHeaderHelperConfig, McpProtocolSelection, McpServerConfig, McpToolApproval,
    McpTransportConfig,
};
#[cfg(feature = "test-support")]
pub use conformance::run_mcp_conformance_client;
pub use file_config::{
    acquire_mcp_configuration_write_lease, delete_mcp_server_configuration,
    insert_mcp_server_configuration, list_mcp_server_configurations, load_mcp_defaults,
    load_mcp_server_configuration, load_mcp_server_configuration_snapshot, mcp_config_path,
    read_mcp_configuration_consistently, update_mcp_server_configuration,
    update_mcp_server_configuration_at_revision, McpConfigurationWriteLease,
    McpServerConfigurationRecord, McpServerConfigurationStoreError, MCP_TRANSPORT_STDIO,
    MCP_TRANSPORT_STREAMABLE_HTTP,
};
pub(crate) use invocation::McpToolCapture;
pub use library::{
    embedded_library_entries, fetch_smithery_library_entries, merge_library_entries,
    McpLibraryAuth, McpLibraryEntry,
};
pub use lifecycle::{McpRuntimeManager, McpRuntimeState, McpRuntimeStatus};
pub use oauth::{
    begin_mcp_oauth_authorization, clear_mcp_oauth, complete_mcp_oauth_authorization,
    configure_mcp_oauth, delete_mcp_oauth_profile, has_mcp_oauth_profile,
    mcp_oauth_pending_authorization_url, mcp_oauth_status, rename_mcp_oauth_profile,
    McpOAuthAuthorizationMetadata, McpOAuthAuthorizationSession, McpOAuthConfiguration,
    McpOAuthRegistration, McpOAuthStatus, MCP_OAUTH_CALLBACK_PATH, MCP_OAUTH_REDIRECT_URI,
};
pub use registry::{McpRegistry, McpRootPolicy, McpToolMetadata, McpTransportPolicy};

/// A tool a probe discovered on a server, before anything is saved.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct McpProbedTool {
    pub name: String,
    pub description: Option<String>,
    pub title: Option<String>,
    pub output_schema: Option<Value>,
    pub annotations: Option<Value>,
    pub icons: Option<Value>,
    #[serde(rename = "_meta")]
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct McpProbeResult {
    pub protocol_version: String,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub instructions: Option<String>,
    pub capabilities: Vec<String>,
    pub tools: Vec<McpProbedTool>,
    pub prompt_count: usize,
    pub resource_count: usize,
    pub resource_template_count: usize,
    /// Best-effort catalog sections that could not be listed after the
    /// required tool catalog had already succeeded.
    pub catalog_warnings: Vec<String>,
}

/// Connects to a single server, lists its tools and disconnects. This is the
/// dashboard's "test connection": it runs against an unsaved draft, so no
/// registry or store is involved and no workspace roots are advertised.
pub async fn probe_mcp_server(
    name: &str,
    config: &McpServerConfig,
    defaults: &McpDefaults,
    cwd: &Path,
) -> Result<McpProbeResult> {
    let redactor = McpRedactor::new(redaction_values(config)?);
    let handler =
        NacMcpClientHandler::unbound(mcp_roots_for_policy(cwd, None, McpRootPolicy::None)?);
    let startup_timeout = config.startup_timeout(defaults)?;
    let catalog_timeout = config.catalog_timeout(defaults)?;
    let mut service = match connect_server(name, config, &handler, cwd, startup_timeout).await {
        Ok(service) => service,
        Err(error) => return Err(redacted_probe_error(&redactor, error)),
    };
    let Some(peer) = service.peer_info() else {
        close_mcp_service(&mut service).await;
        bail!("MCP server did not provide initialization metadata");
    };
    let tools = match timeout(catalog_timeout, service.list_all_tools()).await {
        Ok(Ok(tools)) => tools,
        Ok(Err(error)) => {
            close_mcp_service(&mut service).await;
            return Err(anyhow!(
                "failed to list tools: {}",
                redactor.redact(&format!("{error:#}"))
            ));
        }
        Err(_) => {
            close_mcp_service(&mut service).await;
            bail!(
                "timed out listing tools after {}ms",
                catalog_timeout.as_millis()
            );
        }
    };
    let probed = tools
        .into_iter()
        .map(|tool| {
            let metadata = tool_metadata(&tool, &redactor);
            McpProbedTool {
                name: tool.name.to_string(),
                description: tool
                    .description
                    .as_ref()
                    .map(|value| redactor.safe_text(value)),
                title: metadata.title,
                output_schema: metadata.output_schema,
                annotations: metadata.annotations,
                icons: metadata.icons,
                meta: metadata.meta,
            }
        })
        .collect();
    let mut catalog_warnings = Vec::new();
    let prompt_count = if peer.capabilities.prompts.is_some() {
        match timeout(catalog_timeout, service.list_all_prompts()).await {
            Ok(Ok(prompts)) => prompts.len(),
            Ok(Err(_)) => {
                catalog_warnings.push("prompt listing failed".to_string());
                0
            }
            Err(_) => {
                catalog_warnings.push("prompt listing timed out".to_string());
                0
            }
        }
    } else {
        0
    };
    let resource_count = if peer.capabilities.resources.is_some() {
        match timeout(catalog_timeout, service.list_all_resources()).await {
            Ok(Ok(resources)) => resources.len(),
            Ok(Err(_)) => {
                catalog_warnings.push("resource listing failed".to_string());
                0
            }
            Err(_) => {
                catalog_warnings.push("resource listing timed out".to_string());
                0
            }
        }
    } else {
        0
    };
    let resource_template_count = if peer.capabilities.resources.is_some() {
        match timeout(catalog_timeout, service.list_all_resource_templates()).await {
            Ok(Ok(templates)) => templates.len(),
            Ok(Err(_)) => {
                catalog_warnings.push("resource-template listing failed".to_string());
                0
            }
            Err(_) => {
                catalog_warnings.push("resource-template listing timed out".to_string());
                0
            }
        }
    } else {
        0
    };
    let capabilities = capabilities::capability_names(&peer.capabilities);
    let result = McpProbeResult {
        protocol_version: peer.protocol_version.to_string(),
        server_name: peer.server_info.as_ref().map(|info| info.name.clone()),
        server_version: peer.server_info.as_ref().map(|info| info.version.clone()),
        instructions: redactor.safe_instructions(&peer.instructions),
        capabilities,
        tools: probed,
        prompt_count,
        resource_count,
        resource_template_count,
        catalog_warnings,
    };
    close_mcp_service(&mut service).await;
    Ok(result)
}

pub fn mcp_error_requires_authorization(error: &anyhow::Error) -> bool {
    error.chain().any(authorization_required)
}

use catalog_sync::*;

fn redacted_probe_error(redactor: &McpRedactor, error: anyhow::Error) -> anyhow::Error {
    anyhow!(redactor.redact(&format!("{error:#}")))
}

use config::*;
use naming::*;
use registry::*;
use result::*;
use sync::*;
use transport::*;

type McpService = RunningService<RoleClient, NacMcpClientHandler>;
type SharedMcpService = Arc<tokio::sync::RwLock<McpService>>;
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_INVENTORY_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_EXECUTION_TIMEOUT: Duration = crate::tools::kernel::DEFAULT_TOOL_TIMEOUT;
const MCP_SERVICE_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const MIN_TIMEOUT_MS: u64 = 100;
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1000;

#[cfg(test)]
pub(crate) mod test_support {
    use rmcp::model::ProtocolVersion;
    use serde_json::{json, Value};
    use std::env;
    use std::ffi::OsString;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    pub(crate) fn expand_env(input: &str) -> anyhow::Result<String> {
        super::expand_env(input)
    }

    pub(crate) fn stdio_command(
        program: &str,
        args: &[String],
        envs: &std::collections::BTreeMap<String, String>,
        cwd: &Path,
    ) -> anyhow::Result<tokio::process::Command> {
        super::transport::build_stdio_command(program, args, envs, cwd)
    }

    pub(crate) fn unique_temp_dir(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()))
    }

    pub(crate) fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { env::set_var(name, value) },
            None => unsafe { env::remove_var(name) },
        }
    }

    pub(crate) fn toml_string(value: &str) -> String {
        serde_json::to_string(value).expect("string serializes")
    }

    pub(crate) fn shell_single_quote(value: &Path) -> String {
        format!("'{}'", value.display().to_string().replace('\'', "'\\''"))
    }

    pub(crate) fn start_fake_http_mcp_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake MCP server");
        listener
            .set_nonblocking(true)
            .expect("set fake MCP listener nonblocking");
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        if handle_fake_http_mcp_request(&mut stream) {
                            break;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle)
    }

    pub(crate) fn start_protocol_http_mcp_server(
        current: bool,
    ) -> (String, thread::JoinHandle<()>, Arc<Mutex<Vec<Value>>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind protocol MCP server");
        listener
            .set_nonblocking(true)
            .expect("set protocol MCP listener nonblocking");
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let observed = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&observed);
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let Some(request) = read_fake_http_request(&mut stream) else {
                            continue;
                        };
                        let Some(body) = request.body else {
                            continue;
                        };
                        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
                        captured.lock().unwrap().push(json!({
                            "method": method,
                            "headers": request.headers,
                            "params": body.get("params").cloned().unwrap_or(Value::Null)
                        }));
                        let id = body.get("id").cloned().unwrap_or(Value::Null);
                        let result = match method {
                            "server/discover" if current => json!({
                                "resultType": "complete",
                                "ttlMs": 0,
                                "cacheScope": "private",
                                "supportedVersions": ["2026-07-28"],
                                "capabilities": {"tools": {}},
                                "serverInfo": {"name": "current", "version": "1.0.0"}
                            }),
                            "server/discover" => {
                                let response = json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {"code": -32601, "message": "method not found"}
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                                continue;
                            }
                            "initialize" => json!({
                                "protocolVersion": "2025-11-25",
                                "capabilities": {"tools": {"listChanged": false}},
                                "serverInfo": {"name": "legacy", "version": "1.0.0"}
                            }),
                            "notifications/initialized" => {
                                write_fake_http_response(&mut stream, "202 Accepted", None, "");
                                continue;
                            }
                            "tools/list" => json!({
                                "resultType": "complete",
                                "ttlMs": 60_000,
                                "cacheScope": "private",
                                "tools": []
                            }),
                            _ => json!({}),
                        };
                        let response = json!({"jsonrpc": "2.0", "id": id, "result": result});
                        write_fake_http_response(
                            &mut stream,
                            "200 OK",
                            Some("application/json"),
                            &response.to_string(),
                        );
                        if method == "tools/list" {
                            break;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle, observed)
    }

    pub(crate) fn start_partial_catalog_http_mcp_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind partial MCP server");
        listener
            .set_nonblocking(true)
            .expect("set partial MCP listener nonblocking");
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut failed_catalogs = 0;
            while Instant::now() < deadline && failed_catalogs < 3 {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let Some(request) = read_fake_http_request(&mut stream) else {
                            continue;
                        };
                        let Some(body) = request.body else {
                            continue;
                        };
                        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
                        let id = body.get("id").cloned().unwrap_or(Value::Null);
                        match method {
                            "initialize" => {
                                let response = json!({
                                    "jsonrpc":"2.0",
                                    "id":id,
                                    "result":{
                                        "protocolVersion":"2025-06-18",
                                        "capabilities":{
                                            "tools":{"listChanged":false},
                                            "prompts":{"listChanged":false},
                                            "resources":{"subscribe":false,"listChanged":false}
                                        },
                                        "serverInfo":{"name":"partial-catalog","version":"0.1.0"},
                                        "instructions":"Use Bearer partial-secret for requests"
                                    }
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                            }
                            "notifications/initialized" => {
                                write_fake_http_response(&mut stream, "202 Accepted", None, "");
                            }
                            "tools/list" => {
                                let response = json!({
                                    "jsonrpc":"2.0",
                                    "id":id,
                                    "result":{"tools":[{
                                        "name":"echo",
                                        "description":"Required tool catalog remains usable",
                                        "inputSchema":{"type":"object","properties":{}}
                                    }]}
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                            }
                            "prompts/list" | "resources/list" | "resources/templates/list" => {
                                failed_catalogs += 1;
                                let response = json!({
                                    "jsonrpc":"2.0",
                                    "id":id,
                                    "error":{"code":-32603,"message":"catalog unavailable"}
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                            }
                            _ => write_fake_http_response(&mut stream, "202 Accepted", None, ""),
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle)
    }

    pub(crate) fn start_auth_retry_http_mcp_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind auth retry MCP server");
        listener
            .set_nonblocking(true)
            .expect("set auth retry MCP listener nonblocking");
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut initialize_attempts = 0;
            let mut initialized = false;
            while Instant::now() < deadline && !initialized {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let Some(request) = read_fake_http_request(&mut stream) else {
                            continue;
                        };
                        let Some(body) = request.body else {
                            continue;
                        };
                        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
                        if method == "notifications/initialized" && initialize_attempts == 2 {
                            write_fake_http_response(&mut stream, "202 Accepted", None, "");
                            initialized = true;
                            continue;
                        }
                        if method != "initialize" {
                            write_fake_http_response(&mut stream, "202 Accepted", None, "");
                            continue;
                        }
                        initialize_attempts += 1;
                        thread::sleep(Duration::from_millis(200));
                        if initialize_attempts == 1 {
                            write_fake_http_response_with_headers(
                                &mut stream,
                                "401 Unauthorized",
                                &["WWW-Authenticate: Bearer realm=\"mcp\""],
                                None,
                                "",
                            );
                        } else {
                            let id = body.get("id").cloned().unwrap_or(Value::Null);
                            let response = json!({
                                "jsonrpc":"2.0",
                                "id":id,
                                "result":{
                                    "protocolVersion":"2025-06-18",
                                    "capabilities":{"tools":{"listChanged":false}},
                                    "serverInfo":{"name":"auth-retry","version":"0.1.0"}
                                }
                            });
                            write_fake_http_response(
                                &mut stream,
                                "200 OK",
                                Some("application/json"),
                                &response.to_string(),
                            );
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle)
    }

    pub(crate) fn start_deadline_http_mcp_server(
    ) -> (String, thread::JoinHandle<()>, Arc<Mutex<Vec<Value>>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind deadline MCP server");
        listener
            .set_nonblocking(true)
            .expect("set deadline MCP listener nonblocking");
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let arguments = Arc::new(Mutex::new(Vec::new()));
        let observed = Arc::clone(&arguments);
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut hung_once = false;
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let Some(request) = read_fake_http_request(&mut stream) else {
                            continue;
                        };
                        let Some(body) = request.body else {
                            continue;
                        };
                        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
                        let id = body.get("id").cloned().unwrap_or(Value::Null);
                        match method {
                            "initialize" => {
                                assert_eq!(
                                    body["params"]["protocolVersion"],
                                    ProtocolVersion::LATEST_WITH_INITIALIZE.as_str()
                                );
                                let response = json!({
                                    "jsonrpc":"2.0",
                                    "id":id,
                                    "result":{
                                        "protocolVersion":"2025-06-18",
                                        "capabilities":{"tools":{"listChanged":false}},
                                        "serverInfo":{"name":"deadline-http-mcp","version":"0.1.0"}
                                    }
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                            }
                            "notifications/initialized" => {
                                write_fake_http_response(&mut stream, "202 Accepted", None, "");
                            }
                            "tools/list" => {
                                let response = json!({
                                    "jsonrpc":"2.0",
                                    "id":id,
                                    "result":{"tools":[
                                        {
                                            "name":"echo",
                                            "description":"Deadline test echo",
                                            "inputSchema":{"type":"object","properties":{"message":{"type":"string"}}}
                                        },
                                        {
                                            "name":"reserved_collision",
                                            "description":"Invalid reserved namespace",
                                            "inputSchema":{"type":"object","properties":{"_nac":{"type":"string"}}}
                                        },
                                        {
                                            "name":"reserved_exact_collision",
                                            "description":"Invalid exact reserved namespace",
                                            "inputSchema":{
                                                "type":"object",
                                                "properties":{
                                                    "_nac":{
                                                        "type":["object","null"],
                                                        "additionalProperties":false,
                                                        "properties":{
                                                            "timeout_ms":{"type":"integer","minimum":1,"maximum":3600000}
                                                        },
                                                        "required":["timeout_ms"]
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            "name":"non_object",
                                            "description":"Invalid non-object schema",
                                            "inputSchema":{"type":"string"}
                                        }
                                    ]}
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                            }
                            "tools/call" => {
                                observed.lock().unwrap().push(
                                    body.get("params")
                                        .and_then(|params| params.get("arguments"))
                                        .cloned()
                                        .unwrap_or(Value::Null),
                                );
                                if !hung_once {
                                    hung_once = true;
                                    thread::sleep(Duration::from_millis(250));
                                    continue;
                                }
                                let response = json!({
                                    "jsonrpc":"2.0",
                                    "id":id,
                                    "result":{"content":[{"type":"text","text":"echoed"}],"isError":false}
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                                break;
                            }
                            _ => {
                                write_fake_http_response(&mut stream, "202 Accepted", None, "");
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle, arguments)
    }

    pub(crate) fn start_capability_http_mcp_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind capability MCP server");
        listener
            .set_nonblocking(true)
            .expect("set capability MCP listener nonblocking");
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let Some(request) = read_fake_http_request(&mut stream) else {
                            continue;
                        };
                        let Some(body) = request.body else {
                            continue;
                        };
                        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
                        let id = body.get("id").cloned().unwrap_or(Value::Null);
                        let result = match method {
                            "initialize" => json!({
                                "protocolVersion": "2025-06-18",
                                "capabilities": {
                                    "resources": {"listChanged": false, "subscribe": false},
                                    "prompts": {"listChanged": false},
                                    "completions": {}
                                },
                                "serverInfo": {"name": "capability-http-mcp", "version": "0.1.0"},
                                "instructions": "Use Bearer registry-secret only for documentation lookup."
                            }),
                            "prompts/list" => json!({
                                "prompts": [{
                                    "name": "review",
                                    "description": "Review a document",
                                    "arguments": [{"name": "tone", "required": true}]
                                }]
                            }),
                            "resources/list" => json!({
                                "resources": [{"uri": "doc://guide", "name": "Guide", "_meta": {"sessionId": "hidden"}}],
                                "nextCursor": "resource-page-2"
                            }),
                            "resources/templates/list" => json!({
                                "resourceTemplates": [{"uriTemplate": "doc://{name}", "name": "Document"}],
                                "nextCursor": "template-page-2"
                            }),
                            "resources/read" => json!({
                                "contents": [{"uri": "doc://guide", "mimeType": "text/plain", "text": "remote text", "_meta": {"sessionId": "hidden"}}]
                            }),
                            "prompts/get" => json!({
                                "description": "Resolved review",
                                "messages": [{"role": "user", "content": {"type": "text", "text": "Review strictly"}}],
                                "_meta": {"sessionId": "hidden"}
                            }),
                            "completion/complete" => json!({
                                "completion": {"values": ["strict", "friendly"], "total": 2, "hasMore": false}
                            }),
                            "notifications/initialized" => {
                                write_fake_http_response(&mut stream, "202 Accepted", None, "");
                                continue;
                            }
                            _ => {
                                let response = json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {"code": -32601, "message": "method not found"}
                                });
                                write_fake_http_response(
                                    &mut stream,
                                    "200 OK",
                                    Some("application/json"),
                                    &response.to_string(),
                                );
                                continue;
                            }
                        };
                        let response = json!({"jsonrpc": "2.0", "id": id, "result": result});
                        write_fake_http_response(
                            &mut stream,
                            "200 OK",
                            Some("application/json"),
                            &response.to_string(),
                        );
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (url, handle)
    }

    struct FakeHttpRequest {
        method: String,
        headers: std::collections::BTreeMap<String, String>,
        body: Option<Value>,
    }

    fn read_fake_http_request(stream: &mut TcpStream) -> Option<FakeHttpRequest> {
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = stream.read(&mut chunk).ok()?;
            if read == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..read]);
            let Some(header_end) = buf.windows(4).position(|window| window == b"\r\n\r\n") else {
                continue;
            };
            let header_text = String::from_utf8_lossy(&buf[..header_end]);
            let method = header_text
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().next())
                .unwrap_or("")
                .to_string();
            let headers = header_text
                .lines()
                .skip(1)
                .filter_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    Some((name.to_ascii_lowercase(), value.trim().to_string()))
                })
                .collect();
            let content_length = header_text
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            let body_start = header_end + 4;
            while buf.len() < body_start + content_length {
                let read = stream.read(&mut chunk).ok()?;
                if read == 0 {
                    return None;
                }
                buf.extend_from_slice(&chunk[..read]);
            }
            let body = if content_length == 0 {
                None
            } else {
                serde_json::from_slice(&buf[body_start..body_start + content_length]).ok()
            };
            return Some(FakeHttpRequest {
                method,
                headers,
                body,
            });
        }
    }

    fn handle_fake_http_mcp_request(stream: &mut TcpStream) -> bool {
        let Some(request) = read_fake_http_request(stream) else {
            return false;
        };
        if request.method != "POST" {
            write_fake_http_response(stream, "405 Method Not Allowed", None, "");
            return false;
        }
        let Some(body) = request.body else {
            write_fake_http_response(stream, "400 Bad Request", None, "");
            return false;
        };
        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
        let id = body.get("id").cloned().unwrap_or(Value::Null);
        match method {
            "initialize" => {
                assert_eq!(
                    body["params"]["protocolVersion"],
                    ProtocolVersion::LATEST_WITH_INITIALIZE.as_str()
                );
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": { "name": "fake-http-mcp", "version": "0.1.0" }
                    }
                });
                write_fake_http_response(
                    stream,
                    "200 OK",
                    Some("application/json"),
                    &response.to_string(),
                );
                false
            }
            "notifications/initialized" => {
                write_fake_http_response(stream, "202 Accepted", None, "");
                false
            }
            "tools/list" => {
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [{
                            "name": "echo",
                            "title": "Echo",
                            "description": "Echo from fake HTTP MCP",
                            "inputSchema": { "type": "object", "properties": {} },
                            "outputSchema": { "type": "object", "properties": { "echoed": { "type": "string" } } },
                            "annotations": { "readOnlyHint": true, "openWorldHint": false },
                            "icons": [{ "src": "https://example.test/echo.png", "mimeType": "image/png" }],
                            "_meta": { "vendor": "fake" }
                        }]
                    }
                });
                write_fake_http_response(
                    stream,
                    "200 OK",
                    Some("application/json"),
                    &response.to_string(),
                );
                true
            }
            _ => {
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "method not found" }
                });
                write_fake_http_response(
                    stream,
                    "200 OK",
                    Some("application/json"),
                    &response.to_string(),
                );
                false
            }
        }
    }

    fn write_fake_http_response(
        stream: &mut TcpStream,
        status: &str,
        content_type: Option<&str>,
        body: &str,
    ) {
        write_fake_http_response_with_headers(stream, status, &[], content_type, body);
    }

    fn write_fake_http_response_with_headers(
        stream: &mut TcpStream,
        status: &str,
        headers: &[&str],
        content_type: Option<&str>,
        body: &str,
    ) {
        let content_type = content_type
            .map(|value| format!("Content-Type: {value}\r\n"))
            .unwrap_or_default();
        let headers = headers
            .iter()
            .map(|header| format!("{header}\r\n"))
            .collect::<String>();
        let response = format!(
            "HTTP/1.1 {status}\r\n{headers}{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }
}

#[cfg(test)]
mod policy_tests;

#[cfg(test)]
mod tests;
