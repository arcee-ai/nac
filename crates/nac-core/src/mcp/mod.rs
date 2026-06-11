use std::collections::{BTreeMap, HashMap};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::header::{HeaderName, HeaderValue};
use rmcp::handler::client::ClientHandler;
use rmcp::model::{CallToolRequestParams, ClientInfo, Implementation, ListRootsResult, Root, Tool};
use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::ServiceExt;
use serde::Deserialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;
use url::Url;

use crate::paths::PathContext;
use crate::sandbox::SandboxSession;
use crate::tools::ToolResult;
use crate::types::{FunctionDef, ToolDefinition};

mod config;
mod naming;
mod registry;
mod result;
mod transport;

pub use registry::{McpRegistry, McpRootPolicy, McpTransportPolicy};

use config::*;
use naming::*;
use registry::*;
use result::*;
use transport::*;

type McpService = RunningService<RoleClient, NacMcpClientHandler>;
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_INVENTORY_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[cfg(test)]
pub(crate) mod test_support {
    use serde_json::{json, Value};
    use std::env;
    use std::ffi::OsString;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
        restore_env, shell_single_quote, start_fake_http_mcp_server, toml_string, unique_temp_dir,
    };
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::fs;

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
        let registry = McpRegistry::load(&cwd, None, &PathContext::new(&cwd))
            .await
            .unwrap();
        assert!(registry.is_none());

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
        let registry = McpRegistry::load_with_policy(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await
        .unwrap();
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
        let registry = McpRegistry::load_with_policy(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await
        .unwrap()
        .expect("HTTP MCP server should load");
        let definitions = registry.tool_definitions();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].function.name, "mcp__http__echo");
        assert_eq!(
            definitions[0].function.description,
            "Echo from fake HTTP MCP"
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
        let strict_registry = McpRegistry::load_with_policy(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::All,
            McpRootPolicy::None,
        )
        .await
        .unwrap();
        assert!(
            strict_registry.is_none(),
            "All policy should preserve whole-file typed deserialization behavior"
        );

        let registry = McpRegistry::load_with_policy(
            &cwd,
            None,
            &PathContext::new(&cwd),
            McpTransportPolicy::StreamableHttpOnly,
            McpRootPolicy::None,
        )
        .await
        .unwrap()
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
