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
use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::ServiceExt;
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

mod config;
mod file_config;
mod library;
mod lifecycle;
mod naming;
mod registry;
mod result;
mod transport;

pub use config::{McpDefaults, McpHeaderHelperConfig, McpServerConfig, McpTransportConfig};
pub use file_config::{
    acquire_mcp_configuration_write_lease, delete_mcp_server_configuration,
    insert_mcp_server_configuration, list_mcp_server_configurations, load_mcp_server_configuration,
    load_mcp_server_configuration_snapshot, mcp_config_path, read_mcp_configuration_consistently,
    update_mcp_server_configuration, update_mcp_server_configuration_at_revision,
    McpConfigurationWriteLease, McpServerConfigurationRecord, McpServerConfigurationStoreError,
    MCP_TRANSPORT_STDIO, MCP_TRANSPORT_STREAMABLE_HTTP,
};
pub use library::{
    embedded_library_entries, fetch_smithery_library_entries, merge_library_entries,
    McpLibraryAuth, McpLibraryEntry,
};
pub use lifecycle::{McpRuntimeManager, McpRuntimeState, McpRuntimeStatus};
pub use registry::{McpRegistry, McpRootPolicy, McpTransportPolicy};

/// A tool a probe discovered on a server, before anything is saved.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct McpProbedTool {
    pub name: String,
    pub description: Option<String>,
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
}

/// Connects to a single server, lists its tools and disconnects. This is the
/// dashboard's "test connection": it runs against an unsaved draft, so no
/// registry or store is involved and no workspace roots are advertised.
pub async fn probe_mcp_server(
    name: &str,
    config: &McpServerConfig,
    cwd: &Path,
) -> Result<McpProbeResult> {
    let handler = NacMcpClientHandler {
        roots: mcp_roots_for_policy(cwd, None, McpRootPolicy::None)?,
    };
    let defaults = McpDefaults::default();
    let startup_timeout = config.startup_timeout(&defaults)?;
    let catalog_timeout = config.catalog_timeout(&defaults)?;
    let service = timeout(startup_timeout, connect_server(name, config, &handler, cwd))
        .await
        .map_err(|_| {
            anyhow!(
                "timed out connecting after {}ms",
                startup_timeout.as_millis()
            )
        })??;
    let peer = service
        .peer_info()
        .context("MCP server did not provide initialization metadata")?;
    let tools = timeout(catalog_timeout, service.list_all_tools())
        .await
        .map_err(|_| {
            anyhow!(
                "timed out listing tools after {}ms",
                catalog_timeout.as_millis()
            )
        })?
        .context("failed to list tools")?;
    let probed = tools
        .into_iter()
        .map(|tool| McpProbedTool {
            name: tool.name.to_string(),
            description: tool
                .description
                .as_ref()
                .map(std::string::ToString::to_string),
        })
        .collect();
    let prompt_count = if peer.capabilities.prompts.is_some() {
        timeout(catalog_timeout, service.list_all_prompts())
            .await
            .map_err(|_| anyhow!("timed out listing prompts"))??
            .len()
    } else {
        0
    };
    let resource_count = if peer.capabilities.resources.is_some() {
        timeout(catalog_timeout, service.list_all_resources())
            .await
            .map_err(|_| anyhow!("timed out listing resources"))??
            .len()
    } else {
        0
    };
    let resource_template_count = if peer.capabilities.resources.is_some() {
        timeout(catalog_timeout, service.list_all_resource_templates())
            .await
            .map_err(|_| anyhow!("timed out listing resource templates"))??
            .len()
    } else {
        0
    };
    let capabilities = capability_names(&peer.capabilities);
    let result = McpProbeResult {
        protocol_version: peer.protocol_version.to_string(),
        server_name: peer.server_info.as_ref().map(|info| info.name.clone()),
        server_version: peer.server_info.as_ref().map(|info| info.version.clone()),
        instructions: peer.instructions.clone(),
        capabilities,
        tools: probed,
        prompt_count,
        resource_count,
        resource_template_count,
    };
    let _ = service.cancel().await;
    Ok(result)
}

fn capability_names(capabilities: &rmcp::model::ServerCapabilities) -> Vec<String> {
    let mut names = Vec::new();
    for (present, name) in [
        (capabilities.tools.is_some(), "tools"),
        (capabilities.prompts.is_some(), "prompts"),
        (capabilities.resources.is_some(), "resources"),
        (capabilities.logging.is_some(), "logging"),
        (capabilities.completions.is_some(), "completions"),
        (capabilities.experimental.is_some(), "experimental"),
        (capabilities.extensions.is_some(), "extensions"),
    ] {
        if present {
            names.push(name.to_string());
        }
    }
    names
}

pub fn mcp_error_requires_authorization(error: &anyhow::Error) -> bool {
    error.chain().any(authorization_required)
}

use config::*;
use naming::*;
use registry::*;
use result::*;
use transport::*;

type McpService = RunningService<RoleClient, NacMcpClientHandler>;
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_INVENTORY_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_EXECUTION_TIMEOUT: Duration = crate::tools::kernel::DEFAULT_TOOL_TIMEOUT;
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
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{unique}"))
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

    struct FakeHttpRequest {
        method: String,
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
            return Some(FakeHttpRequest { method, body });
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
                            "description": "Echo from fake HTTP MCP",
                            "inputSchema": { "type": "object", "properties": {} }
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
        let content_type = content_type
            .map(|value| format!("Content-Type: {value}\r\n"))
            .unwrap_or_default();
        let response = format!(
            "HTTP/1.1 {status}\r\n{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{
        restore_env, shell_single_quote, start_deadline_http_mcp_server,
        start_fake_http_mcp_server, toml_string, unique_temp_dir,
    };
    use super::*;
    use crate::TEST_ENV_LOCK;
    use serde_json::json;
    use std::fs;

    const MANAGED_EXA_CANARY: &str = "managed-server-mcp-isolation-canary";

    #[tokio::test]
    async fn managed_native_credential_mcp_isolation_helper() {
        let Some(root) = env::var_os("NAC_MANAGED_MCP_ISOLATION_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        fs::create_dir_all(&root).unwrap();
        crate::worker_credentials::capture_managed_native_credentials_from_environment().unwrap();
        assert!(env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
        assert_eq!(
            crate::worker_credentials::managed_exa_api_key().as_deref(),
            Some(MANAGED_EXA_CANARY)
        );

        let http_url = "http://127.0.0.1:9/arbitrary-mcp-endpoint";
        let argv_marker = root.join("stdio-argv-spawned");
        let env_marker = root.join("stdio-env-spawned");
        let argv_shell = format!("printf spawned > {}", shell_single_quote(&argv_marker));
        let env_shell = format!("printf spawned > {}", shell_single_quote(&env_marker));
        fs::write(
            root.join("config.toml"),
            format!(
                r#"
[mcp_servers.stdio_argv]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}, "${{EXA_API_KEY}}"]

[mcp_servers.stdio_env]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
env = {{ MCP_SECRET = "${{EXA_API_KEY}}" }}

[mcp_servers.http_header]
transport = "streamable_http"
url = {}
headers = {{ Authorization = "Bearer ${{EXA_API_KEY}}" }}
"#,
                toml_string(&argv_shell),
                toml_string(&env_shell),
                toml_string(&http_url),
            ),
        )
        .unwrap();
        unsafe { env::set_var("NAC_HOME", &root) };

        let outcome = McpRegistry::load_reporting_skips(
            &root,
            None,
            &PathContext::new(&root),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .unwrap();
        assert!(outcome.registry.is_none());
        assert_eq!(outcome.skipped.len(), 3);
        assert!(!argv_marker.exists());
        assert!(!env_marker.exists());
        assert!(outcome.skipped.iter().all(|skipped| skipped
            .reason
            .contains("environment variable 'EXA_API_KEY' is not set")));
        let rendered = outcome
            .skipped
            .iter()
            .map(|skipped| format!("{}: {}", skipped.name, skipped.reason))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!rendered.contains(MANAGED_EXA_CANARY));
        fs::write(root.join("load-observation"), rendered).unwrap();
    }

    #[test]
    fn managed_server_snapshot_is_hidden_from_stdio_and_http_mcp() {
        let root = unique_temp_dir("nac-managed-mcp-isolation");
        let output = std::process::Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                "mcp::tests::managed_native_credential_mcp_isolation_helper",
                "--nocapture",
            ])
            .env("NAC_MANAGED_MCP_ISOLATION_ROOT", &root)
            .env(crate::model::EXA_API_KEY_ENV, MANAGED_EXA_CANARY)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "managed MCP isolation helper failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains(MANAGED_EXA_CANARY));
        assert!(!String::from_utf8_lossy(&output.stderr).contains(MANAGED_EXA_CANARY));
        for entry in fs::read_dir(&root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                assert!(!fs::read_to_string(path)
                    .unwrap()
                    .contains(MANAGED_EXA_CANARY));
            }
        }
        let _ = fs::remove_dir_all(root);
    }

    async fn load_registry(
        cwd: &Path,
        sandbox: Option<&SandboxSession>,
        paths: &PathContext,
        transport_policy: McpTransportPolicy,
        root_policy: McpRootPolicy,
    ) -> Option<Arc<McpRegistry>> {
        McpRegistry::load_reporting_skips(cwd, sandbox, paths, transport_policy, root_policy)
            .await
            .unwrap()
            .registry
    }

    #[test]
    fn sanitize_identifier_collapses_symbols() {
        assert_eq!(sanitize_identifier("GitHub.com"), "github_com");
        assert_eq!(sanitize_identifier("search/issues"), "search_issues");
    }

    #[test]
    fn env_expansion_replaces_placeholders() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original = env::var("NAC_MCP_TEST").ok();
        unsafe {
            env::set_var("NAC_MCP_TEST", "expanded");
        }

        let expanded = expand_env("Bearer ${NAC_MCP_TEST}").unwrap();
        assert_eq!(expanded, "Bearer expanded");

        if let Some(value) = original {
            unsafe {
                env::set_var("NAC_MCP_TEST", value);
            }
        } else {
            unsafe {
                env::remove_var("NAC_MCP_TEST");
            }
        }
    }

    #[test]
    fn authorization_challenges_are_classified_without_rendering_credentials() {
        let error = rmcp::transport::streamable_http_client::AuthRequiredError::new(
            "Bearer realm=\"mcp\"".to_string(),
        );
        assert!(authorization_required(&error));
        let wrapped = anyhow!(error).context("MCP connection failed");
        assert!(mcp_error_requires_authorization(&wrapped));
    }

    #[test]
    fn allocate_tool_name_suffixes_collisions() {
        let mut seen = HashMap::new();
        assert_eq!(
            allocate_tool_name("github", "search/issues", &mut seen),
            "mcp__github__search_issues"
        );
        assert_eq!(
            allocate_tool_name("github", "search-issues", &mut seen),
            "mcp__github__search_issues__2"
        );
    }

    #[test]
    fn tool_definition_uses_namespaced_name() {
        let tool = Tool::new(
            "search_issues",
            "Search issues",
            serde_json::Map::<String, Value>::new(),
        );
        let definition = tool_definition("mcp__github__search_issues", "github", &tool);
        assert_eq!(definition.function.name, "mcp__github__search_issues");
        assert_eq!(definition.function.description, "Search issues");
    }

    #[tokio::test]
    async fn invalid_global_config_disables_mcp_instead_of_failing() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-test");
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(nac_home.join("config.toml"), "=\n").unwrap();

        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let outcome = McpRegistry::load_reporting_skips(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await
        .unwrap();
        assert!(outcome.registry.is_none());
        assert_eq!(outcome.skipped.len(), 1);
        assert_eq!(
            outcome.skipped[0].name,
            nac_home.join("config.toml").display().to_string()
        );
        assert!(
            outcome.skipped[0].reason.starts_with("invalid config:"),
            "unexpected reason: {}",
            outcome.skipped[0].reason
        );

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn http_only_policy_skips_stdio_without_spawning() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-stdio-skip");
        fs::create_dir_all(&nac_home).unwrap();
        let marker = nac_home.join("stdio-spawned");
        let shell = format!("printf spawned > {}", shell_single_quote(&marker));
        fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
                toml_string(&shell)
            ),
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let registry = load_registry(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await;
        assert!(registry.is_none());
        assert!(
            !marker.exists(),
            "stdio MCP server was spawned despite HTTP-only policy"
        );

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn load_reports_connect_failed_server() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-connect-fail");
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(
            nac_home.join("config.toml"),
            r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", "true"]
"#,
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let outcome = McpRegistry::load_reporting_skips(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .unwrap();
        assert!(outcome.registry.is_none());
        assert_eq!(outcome.skipped.len(), 1);
        assert_eq!(outcome.skipped[0].name, "local");
        assert!(
            outcome.skipped[0]
                .reason
                .contains("failed to connect stdio MCP server 'local'"),
            "unexpected reason: {}",
            outcome.skipped[0].reason
        );

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn required_server_failure_rejects_registry_admission() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-required-fail");
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(
            nac_home.join("config.toml"),
            r#"
[mcp_servers.required_local]
required = true
startup_timeout_ms = 500
transport = "stdio"
command = "/bin/sh"
args = ["-c", "true"]
"#,
        )
        .unwrap();
        unsafe { env::set_var("NAC_HOME", &nac_home) };

        let cwd = std::env::current_dir().unwrap();
        let error = McpRegistry::load_reporting_skips(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .err()
        .expect("required server failure must reject admission");
        assert!(format!("{error:#}").contains("required MCP server 'required_local'"));

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn header_helper_forwards_env_and_parses_bounded_json() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original = env::var_os("NAC_MCP_HELPER_TOKEN");
        unsafe { env::set_var("NAC_MCP_HELPER_TOKEN", "helper-secret") };
        let helper = McpHeaderHelperConfig {
            command: "/bin/sh".to_string(),
            args: vec![
                "-c".to_string(),
                "printf '{\"Authorization\":\"Bearer %s\"}' \"$NAC_MCP_HELPER_TOKEN\"".to_string(),
            ],
            env_vars: vec!["NAC_MCP_HELPER_TOKEN".to_string()],
            timeout_ms: Some(1_000),
            ..McpHeaderHelperConfig::default()
        };
        let headers = run_header_helper(&helper, Path::new("/tmp")).await.unwrap();
        assert_eq!(
            headers.get("Authorization").map(String::as_str),
            Some("Bearer helper-secret")
        );
        restore_env("NAC_MCP_HELPER_TOKEN", original);
    }

    #[tokio::test]
    async fn stdio_server_runs_on_host_when_sandboxed() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-sandbox-stdio");
        fs::create_dir_all(&nac_home).unwrap();
        let marker = nac_home.join("stdio-spawned");
        let shell = format!("printf spawned > {}", shell_single_quote(&marker));
        fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
                toml_string(&shell)
            ),
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
            backend: crate::sandbox::SandboxBackendType::Podman,
            image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: vec![crate::sandbox::MountSpec {
                host: nac_home.clone(),
                guest: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            }],
            workdir: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
            worktree: None,
            gpu_devices: Vec::new(),
            shm_size: Some("0".to_string()),
            cpus: 2,
            memory_mib: 2048,
        });

        let registry = load_registry(
            &nac_home,
            Some(&sandbox),
            &PathContext::new(&nac_home),
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await;
        // The fake stdio server is not a real MCP server, so it is skipped once
        // the connection fails. The assertion that matters is that it was
        // launched on the host (marker written at an absolute host path) rather
        // than via `podman exec` inside the sandbox.
        assert!(registry.is_none());
        assert!(
            marker.exists(),
            "stdio MCP server was not launched on the host in sandbox mode"
        );

        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn per_call_deadline_strips_envelope_and_leaves_http_mcp_usable() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-call-deadline");
        fs::create_dir_all(&nac_home).unwrap();
        let (http_url, http_server, observed) = start_deadline_http_mcp_server();
        fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.hung]
transport = "streamable_http"
url = {}
"#,
                toml_string(&http_url)
            ),
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let outcome = McpRegistry::load_reporting_skips(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .expect("deadline MCP server should load");
        assert_eq!(outcome.skipped.len(), 3);
        assert!(outcome.skipped.iter().any(|skipped| {
            skipped.name == "mcp__hung__reserved_collision"
                && skipped.reason.contains("reserved property '_nac'")
        }));
        assert!(outcome.skipped.iter().any(|skipped| {
            skipped.name == "mcp__hung__reserved_exact_collision"
                && skipped.reason.contains("reserved property '_nac'")
        }));
        assert!(outcome.skipped.iter().any(|skipped| {
            skipped.name == "mcp__hung__non_object" && skipped.reason.contains("type 'object'")
        }));
        let registry = outcome
            .registry
            .expect("valid MCP capability should remain mounted");
        let mut runtime = crate::tools::test_runtime();
        runtime.mcp = Some(registry);
        let client = crate::model::ModelClient::new_for_test();
        let timed_out = crate::tools::execute_tool(
            "mcp__hung__echo",
            json!({"message":"first","_nac":{"timeout_ms":20}}),
            &runtime,
            &client,
        )
        .await;
        assert!(timed_out.is_error);
        let timed_out: Value = serde_json::from_str(timed_out.content.as_text().unwrap()).unwrap();
        assert_eq!(timed_out["_nac"]["status"], "timed_out");
        assert_eq!(timed_out["_nac"]["remote_outcome_uncertain"], true);

        tokio::time::sleep(Duration::from_millis(300)).await;
        let recovered = crate::tools::execute_tool(
            "mcp__hung__echo",
            json!({"message":"second","_nac":{"timeout_ms":1000}}),
            &runtime,
            &client,
        )
        .await;
        assert!(!recovered.is_error, "{}", recovered.content);
        assert!(recovered.content.contains("echoed"));
        let observed = observed.lock().unwrap();
        assert_eq!(
            observed.as_slice(),
            &[json!({"message":"first"}), json!({"message":"second"})]
        );

        http_server.join().unwrap();
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn http_only_policy_loads_streamable_http_tools_and_skips_stdio() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-http-only");
        fs::create_dir_all(&nac_home).unwrap();
        let marker = nac_home.join("stdio-spawned");
        let shell = format!("printf spawned > {}", shell_single_quote(&marker));
        let (http_url, http_server) = start_fake_http_mcp_server();
        fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]

[mcp_servers.http]
transport = "streamable_http"
url = {}
"#,
                toml_string(&shell),
                toml_string(&http_url)
            ),
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let registry = load_registry(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await
        .expect("HTTP MCP server should load");
        let definitions = registry.tool_definitions();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].function.name, "mcp__http__echo");
        assert_eq!(
            definitions[0].function.description,
            "Echo from fake HTTP MCP"
        );
        assert_eq!(
            definitions[0].function.parameters["properties"]["_nac"]["properties"]["timeout_ms"]
                ["maximum"],
            3_600_000
        );
        assert!(
            !marker.exists(),
            "stdio MCP server was spawned despite HTTP-only policy"
        );

        drop(registry);
        http_server.join().unwrap();
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn http_only_policy_ignores_malformed_non_http_entries_before_deserialize() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-http-only-malformed-skip");
        fs::create_dir_all(&nac_home).unwrap();
        let (http_url, http_server) = start_fake_http_mcp_server();
        fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.bad_stdio]
transport = "stdio"
args = ["missing-command-field"]

[mcp_servers.unsupported]
transport = "sse"
url = "https://example.test/sse"

[mcp_servers.http]
transport = "streamable_http"
url = {}
"#,
                toml_string(&http_url)
            ),
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let strict_registry = load_registry(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await;
        assert!(
            strict_registry.is_none(),
            "All policy should preserve whole-file typed deserialization behavior"
        );

        let registry = load_registry(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await
        .expect(
            "HTTP-only policy should load valid HTTP server despite malformed non-HTTP entries",
        );
        let definitions = registry.tool_definitions();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].function.name, "mcp__http__echo");

        drop(registry);
        http_server.join().unwrap();
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn dashboard_saved_server_loads_from_the_file() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-dashboard-save");
        fs::create_dir_all(&nac_home).unwrap();
        let (http_url, http_server) = start_fake_http_mcp_server();
        insert_mcp_server_configuration(
            &nac_home.join("config.toml"),
            McpServerConfigurationRecord {
                name: "saved".to_string(),
                enabled: true,
                transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
                command: None,
                args: Vec::new(),
                env: std::collections::BTreeMap::new(),
                url: Some(http_url),
                headers: std::collections::BTreeMap::new(),
                library_id: Some("saved".to_string()),
                ..McpServerConfigurationRecord::default()
            },
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let registry = load_registry(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .expect("saved HTTP server should load");
        let definitions = registry.tool_definitions();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].function.name, "mcp__saved__echo");

        drop(registry);
        http_server.join().unwrap();
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[tokio::test]
    async fn servers_sharing_an_endpoint_connect_once() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let nac_home = unique_temp_dir("nac-mcp-endpoint-dedup");
        fs::create_dir_all(&nac_home).unwrap();
        let (http_url, http_server) = start_fake_http_mcp_server();
        fs::write(
            nac_home.join("config.toml"),
            format!(
                r#"
[mcp_servers.exa]
transport = "streamable_http"
url = {url}

[mcp_servers.exa_web_search]
transport = "streamable_http"
url = {url}
"#,
                url = toml_string(&http_url)
            ),
        )
        .unwrap();
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let registry = load_registry(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .expect("the endpoint's tools should load once");
        let definitions = registry.tool_definitions();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].function.name, "mcp__exa__echo");

        drop(registry);
        http_server.join().unwrap();
        restore_env("NAC_HOME", original_nac_home);
        restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = fs::remove_dir_all(&nac_home);
    }

    #[test]
    fn no_roots_policy_advertises_no_file_roots_for_tilde_remote_cwd() {
        let roots = mcp_roots_for_policy(Path::new("~"), None, McpRootPolicy::None).unwrap();
        assert!(roots.is_empty());
    }

    #[test]
    fn workspace_roots_preserve_existing_local_file_root_behavior() {
        let cwd = std::env::current_dir().unwrap();
        let roots = mcp_roots_for_policy(&cwd, None, McpRootPolicy::Workspace).unwrap();
        assert_eq!(roots.len(), 1);
        assert!(roots[0].uri.starts_with("file://"));
        assert_eq!(
            roots[0].name.as_deref(),
            cwd.file_name()
                .and_then(|value| value.to_str())
                .or(Some("workspace"))
        );
    }
}
