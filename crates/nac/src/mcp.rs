use std::collections::{BTreeMap, HashMap};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
use url::Url;

use crate::sandbox::SandboxSession;
use crate::tools::ToolResult;
use crate::types::{FunctionDef, ToolDefinition};

type McpService = RunningService<RoleClient, NacMcpClientHandler>;

#[derive(Clone)]
pub struct McpRegistry {
    tools: Arc<HashMap<String, Arc<McpToolBinding>>>,
}

#[derive(Clone)]
struct McpToolBinding {
    tool_name: String,
    definition: ToolDefinition,
    server: Arc<McpServer>,
}

struct McpServer {
    _service: Arc<McpService>,
}

#[derive(Clone)]
struct NacMcpClientHandler {
    root_uri: String,
    root_name: String,
}

#[derive(Debug, Default, Deserialize)]
struct McpConfigFile {
    #[serde(default)]
    mcp_servers: BTreeMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Deserialize)]
struct McpServerConfig {
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(flatten)]
    transport: McpTransportConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    StreamableHttp {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

impl McpRegistry {
    pub async fn load(cwd: &Path, sandbox: Option<&SandboxSession>) -> Result<Option<Arc<Self>>> {
        let Some(path) = default_config_path() else {
            return Ok(None);
        };
        if !path.exists() {
            return Ok(None);
        }

        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read MCP config at {}", path.display()))?;
        let config: McpConfigFile = toml::from_str(&raw)
            .with_context(|| format!("failed to parse MCP config at {}", path.display()))?;

        let root_uri = if sandbox.is_some() {
            "file:///workspace".to_string()
        } else {
            Url::from_directory_path(cwd)
                .map_err(|_| anyhow!("failed to build file:// root for {}", cwd.display()))?
                .to_string()
        };
        let root_name = if sandbox.is_some() {
            "workspace".to_string()
        } else {
            cwd.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("workspace")
                .to_string()
        };

        let handler = NacMcpClientHandler {
            root_uri,
            root_name,
        };

        let mut tools = HashMap::new();
        let mut seen_names = HashMap::<String, usize>::new();

        for (server_name, server_config) in config.mcp_servers {
            if !server_config.enabled {
                continue;
            }

            let service =
                match connect_server(&server_name, &server_config, &handler, sandbox).await {
                    Ok(service) => Arc::new(service),
                    Err(error) => {
                        eprintln!(
                            "MCP server '{}' is unavailable and will be skipped: {:#}",
                            server_name, error
                        );
                        continue;
                    }
                };

            let listed_tools = match service.list_all_tools().await {
                Ok(tools) => tools,
                Err(error) => {
                    eprintln!(
                        "MCP server '{}' could not list tools and will be skipped: {:#}",
                        server_name, error
                    );
                    continue;
                }
            };

            let server = Arc::new(McpServer {
                _service: service.clone(),
            });
            for tool in listed_tools {
                let qualified_name = allocate_tool_name(&server_name, &tool.name, &mut seen_names);
                let definition = tool_definition(&qualified_name, &server_name, &tool);
                tools.insert(
                    qualified_name,
                    Arc::new(McpToolBinding {
                        tool_name: tool.name.to_string(),
                        definition,
                        server: server.clone(),
                    }),
                );
            }
        }

        if tools.is_empty() {
            return Ok(None);
        }

        Ok(Some(Arc::new(Self {
            tools: Arc::new(tools),
        })))
    }

    pub fn tool_definitions(&self) -> Vec<ToolDefinition> {
        let mut definitions: Vec<ToolDefinition> = self
            .tools
            .values()
            .map(|binding| binding.definition.clone())
            .collect();
        definitions.sort_by(|left, right| left.function.name.cmp(&right.function.name));
        definitions
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> ToolResult {
        let Some(binding) = self.tools.get(name) else {
            return ToolResult {
                content: format!("Error: unknown MCP tool '{}'", name),
                is_error: true,
            };
        };

        let arguments = match args {
            Value::Object(map) => Some(map),
            Value::Null => None,
            _ => {
                return ToolResult {
                    content: format!("Error: MCP tool '{}' requires object arguments", name),
                    is_error: true,
                }
            }
        };

        let mut params = CallToolRequestParams::new(binding.tool_name.clone());
        if let Some(arguments) = arguments {
            params = params.with_arguments(arguments);
        }
        match binding.server._service.call_tool(params).await {
            Ok(result) => flatten_tool_result(result),
            Err(error) => ToolResult {
                content: format!("Error calling MCP tool '{}': {}", name, error),
                is_error: true,
            },
        }
    }

    pub fn has_tool(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }
}

impl ClientHandler for NacMcpClientHandler {
    fn get_info(&self) -> ClientInfo {
        ClientInfo::new(
            serde_json::from_value(serde_json::json!({
                "roots": {
                    "listChanged": true
                }
            }))
            .expect("valid MCP client capabilities"),
            Implementation::new("nac", env!("CARGO_PKG_VERSION")),
        )
    }

    async fn list_roots(
        &self,
        _request_context: rmcp::service::RequestContext<RoleClient>,
    ) -> std::result::Result<ListRootsResult, rmcp::model::ErrorData> {
        Ok(ListRootsResult::new(vec![
            Root::new(self.root_uri.clone()).with_name(self.root_name.clone())
        ]))
    }
}

async fn connect_server(
    name: &str,
    config: &McpServerConfig,
    handler: &NacMcpClientHandler,
    sandbox: Option<&SandboxSession>,
) -> Result<McpService> {
    match config.transport.clone() {
        McpTransportConfig::Stdio { command, args, env } => {
            let command = expand_env(&command)?;
            let args = expand_strings(&args)?;
            let env = expand_map(&env)?;
            let transport =
                TokioChildProcess::new(build_stdio_command(&command, &args, &env, sandbox)?)?;
            handler
                .clone()
                .serve(transport)
                .await
                .with_context(|| format!("failed to connect stdio MCP server '{}'", name))
        }
        McpTransportConfig::StreamableHttp { url, headers } => {
            let url = expand_env(&url)?;
            let transport = StreamableHttpClientTransport::from_config(
                build_http_transport_config(&url, &headers)?,
            );
            handler
                .clone()
                .serve(transport)
                .await
                .with_context(|| format!("failed to connect HTTP MCP server '{}'", name))
        }
    }
}

fn build_stdio_command(
    program: &str,
    args: &[String],
    envs: &BTreeMap<String, String>,
    sandbox: Option<&SandboxSession>,
) -> Result<Command> {
    let env_pairs: Vec<(String, String)> = envs
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();

    if let Some(sandbox) = sandbox {
        return Ok(sandbox.child_process_command(program, args, &env_pairs));
    }

    let mut command = Command::new(program);
    command.args(args);
    command.envs(envs);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::inherit());
    Ok(command)
}

fn build_http_transport_config(
    url: &str,
    headers: &BTreeMap<String, String>,
) -> Result<StreamableHttpClientTransportConfig> {
    let mut custom_headers = HashMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("invalid HTTP header name '{}'", name))?;
        let value = HeaderValue::from_str(&expand_env(value)?)
            .with_context(|| format!("invalid HTTP header value for '{}'", name))?;
        custom_headers.insert(name, value);
    }
    Ok(StreamableHttpClientTransportConfig::with_uri(url).custom_headers(custom_headers))
}

fn tool_definition(full_name: &str, server_name: &str, tool: &Tool) -> ToolDefinition {
    let description = tool
        .description
        .as_ref()
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("MCP tool '{}' from server '{}'", tool.name, server_name));
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: full_name.to_string(),
            description,
            parameters: tool.schema_as_json_value(),
        },
    }
}

fn allocate_tool_name(
    server_name: &str,
    tool_name: &str,
    seen_names: &mut HashMap<String, usize>,
) -> String {
    let base = format!(
        "mcp__{}__{}",
        sanitize_identifier(server_name),
        sanitize_identifier(tool_name)
    );
    let count = seen_names.entry(base.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        base
    } else {
        format!("{}__{}", base, count)
    }
}

fn sanitize_identifier(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

fn flatten_tool_result(result: rmcp::model::CallToolResult) -> ToolResult {
    let mut sections = Vec::new();

    for content in result.content {
        if let Some(text) = content.as_text() {
            sections.push(text.text.clone());
            continue;
        }

        if let Some(resource) = content.as_resource() {
            if let rmcp::model::ResourceContents::TextResourceContents { text, .. } =
                &resource.resource
            {
                sections.push(text.clone());
                continue;
            }
        }

        if let Some(link) = content.as_resource_link() {
            sections.push(format!("Resource: {}", link.uri));
            continue;
        }

        match serde_json::to_string_pretty(&content) {
            Ok(rendered) => sections.push(rendered),
            Err(_) => sections.push("[unsupported MCP content]".to_string()),
        }
    }

    if let Some(structured) = result.structured_content {
        match serde_json::to_string_pretty(&structured) {
            Ok(rendered) => sections.push(rendered),
            Err(_) => sections.push(structured.to_string()),
        }
    }

    if sections.is_empty() {
        sections.push("[empty MCP tool result]".to_string());
    }

    ToolResult {
        content: sections.join("\n\n"),
        is_error: result.is_error.unwrap_or(false),
    }
}

fn default_config_path() -> Option<PathBuf> {
    if let Some(xdg_config_home) = env::var_os("XDG_CONFIG_HOME") {
        return Some(
            PathBuf::from(xdg_config_home)
                .join("nac")
                .join("config.toml"),
        );
    }

    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".config").join("nac").join("config.toml"))
}

fn default_enabled() -> bool {
    true
}

fn expand_strings(values: &[String]) -> Result<Vec<String>> {
    values.iter().map(|value| expand_env(value)).collect()
}

fn expand_map(values: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>> {
    let mut expanded = BTreeMap::new();
    for (key, value) in values {
        expanded.insert(key.clone(), expand_env(value)?);
    }
    Ok(expanded)
}

fn expand_env(input: &str) -> Result<String> {
    let mut out = String::new();
    let mut rest = input;

    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find('}') else {
            bail!("invalid environment placeholder '{}'", input);
        };
        let name = &after_start[..end];
        let value = env::var(name)
            .with_context(|| format!("environment variable '{}' is not set", name))?;
        out.push_str(&value);
        rest = &after_start[end + 1..];
    }

    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_identifier_collapses_symbols() {
        assert_eq!(sanitize_identifier("GitHub.com"), "github_com");
        assert_eq!(sanitize_identifier("search/issues"), "search_issues");
    }

    #[test]
    fn env_expansion_replaces_placeholders() {
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
}
