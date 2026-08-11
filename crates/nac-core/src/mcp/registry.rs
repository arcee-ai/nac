use super::*;

#[derive(Clone)]
pub struct McpRegistry {
    tools: Arc<HashMap<String, Arc<McpToolBinding>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpTransportPolicy {
    All,
    StreamableHttpOnly,
}

impl McpTransportPolicy {
    fn allows(self, transport: &McpTransportConfig) -> bool {
        match self {
            Self::All => true,
            Self::StreamableHttpOnly => {
                matches!(transport, McpTransportConfig::StreamableHttp { .. })
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpRootPolicy {
    Workspace,
    None,
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
pub(super) struct NacMcpClientHandler {
    pub(super) roots: Vec<Root>,
}

/// Servers defined in `config.toml`, or an empty map when the file is absent,
/// unreadable or invalid. A broken file only disables the file-defined
/// servers; stored ones still load.
fn file_servers_for_policy(
    paths: &PathContext,
    transport_policy: McpTransportPolicy,
) -> BTreeMap<String, McpServerConfig> {
    let Some(path) = default_config_path(paths) else {
        return BTreeMap::new();
    };
    if !path.exists() {
        return BTreeMap::new();
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            eprintln!(
                "MCP config at '{}' could not be read; its servers will be skipped: {:#}",
                path.display(),
                error
            );
            return BTreeMap::new();
        }
    };
    match mcp_config_for_policy(&raw, transport_policy) {
        Ok(config) => config.mcp_servers,
        Err(error) => {
            eprintln!(
                "MCP config at '{}' is invalid; its servers will be skipped: {:#}",
                path.display(),
                error
            );
            BTreeMap::new()
        }
    }
}

/// Servers saved through the dashboard. A store that cannot be read only
/// costs its own servers, never the file-defined ones.
fn stored_servers(store_path: &Path) -> BTreeMap<String, McpServerConfig> {
    let records = match crate::store::list_mcp_server_configurations(store_path) {
        Ok(records) => records,
        Err(error) => {
            eprintln!("Stored MCP servers could not be read and will be skipped: {error}");
            return BTreeMap::new();
        }
    };
    let mut servers = BTreeMap::new();
    for record in records {
        match server_config_from_record(&record) {
            Ok(config) => {
                servers.insert(record.name, config);
            }
            Err(error) => {
                eprintln!(
                    "Stored MCP server '{}' is malformed and will be skipped: {:#}",
                    record.name, error
                );
            }
        }
    }
    servers
}

impl McpRegistry {
    pub async fn load(
        cwd: &Path,
        sandbox: Option<&SandboxSession>,
        paths: &PathContext,
        store_path: Option<&Path>,
    ) -> Result<Option<Arc<Self>>> {
        Self::load_with_policy(
            cwd,
            sandbox,
            paths,
            store_path,
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await
    }

    pub async fn load_with_policy(
        cwd: &Path,
        sandbox: Option<&SandboxSession>,
        paths: &PathContext,
        store_path: Option<&Path>,
        transport_policy: McpTransportPolicy,
        root_policy: McpRootPolicy,
    ) -> Result<Option<Arc<Self>>> {
        // `config.toml` is the baseline; servers stored by the dashboard merge
        // over it and override a file server with the same name. A stored
        // server the policy disallows is dropped before the merge so it never
        // displaces a usable file server of the same name.
        let mut servers = file_servers_for_policy(paths, transport_policy);
        if let Some(store_path) = store_path {
            for (name, config) in stored_servers(store_path) {
                if !transport_policy.allows(&config.transport) {
                    eprintln!(
                        "Skipping stored MCP server '{name}': transport is disabled by policy"
                    );
                    continue;
                }
                servers.insert(name, config);
            }
        }
        if servers.is_empty() {
            return Ok(None);
        }

        let handler = NacMcpClientHandler {
            roots: mcp_roots_for_policy(cwd, sandbox, root_policy)?,
        };

        let mut tools = HashMap::new();
        let mut seen_names = HashMap::<String, usize>::new();
        let mut seen_endpoints = HashMap::<String, String>::new();

        for (server_name, server_config) in servers {
            if !server_config.enabled {
                continue;
            }
            if !transport_policy.allows(&server_config.transport) {
                eprintln!(
                    "Skipping MCP server '{}': transport is disabled by policy",
                    server_name
                );
                continue;
            }
            // Two names for the same endpoint would mount every tool twice
            // under different prefixes, so only the first name connects.
            let endpoint = endpoint_key(&server_config.transport);
            if let Some(existing) = seen_endpoints.get(&endpoint) {
                eprintln!(
                    "Skipping MCP server '{server_name}': same endpoint as server '{existing}'"
                );
                continue;
            }
            seen_endpoints.insert(endpoint, server_name.clone());

            let service = match timeout(
                MCP_CONNECT_TIMEOUT,
                connect_server(&server_name, &server_config, &handler, cwd, sandbox),
            )
            .await
            {
                Ok(Ok(service)) => Arc::new(service),
                Ok(Err(error)) => {
                    eprintln!(
                        "MCP server '{}' is unavailable and will be skipped: {:#}",
                        server_name, error
                    );
                    continue;
                }
                Err(_) => {
                    eprintln!(
                        "MCP server '{}' timed out during connect after {}s and will be skipped",
                        server_name,
                        MCP_CONNECT_TIMEOUT.as_secs()
                    );
                    continue;
                }
            };

            let listed_tools = match timeout(MCP_TOOL_INVENTORY_TIMEOUT, service.list_all_tools())
                .await
            {
                Ok(Ok(tools)) => tools,
                Ok(Err(error)) => {
                    eprintln!(
                        "MCP server '{}' could not list tools and will be skipped: {:#}",
                        server_name, error
                    );
                    continue;
                }
                Err(_) => {
                    eprintln!(
                        "MCP server '{}' timed out while listing tools after {}s and will be skipped",
                        server_name,
                        MCP_TOOL_INVENTORY_TIMEOUT.as_secs()
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
        match timeout(
            MCP_TOOL_CALL_TIMEOUT,
            binding.server._service.call_tool(params),
        )
        .await
        {
            Ok(Ok(result)) => flatten_tool_result(result),
            Ok(Err(error)) => ToolResult {
                content: format!("Error calling MCP tool '{}': {}", name, error),
                is_error: true,
            },
            Err(_) => ToolResult {
                content: format!(
                    "Error calling MCP tool '{}': timed out after {}s",
                    name,
                    MCP_TOOL_CALL_TIMEOUT.as_secs()
                ),
                is_error: true,
            },
        }
    }
}

impl ClientHandler for NacMcpClientHandler {
    fn get_info(&self) -> ClientInfo {
        let capabilities = if self.roots.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::json!({
                "roots": {
                    "listChanged": true
                }
            })
        };
        ClientInfo::new(
            serde_json::from_value(capabilities).expect("valid MCP client capabilities"),
            Implementation::new("nac", env!("CARGO_PKG_VERSION")),
        )
    }

    async fn list_roots(
        &self,
        _request_context: rmcp::service::RequestContext<RoleClient>,
    ) -> std::result::Result<ListRootsResult, rmcp::model::ErrorData> {
        Ok(ListRootsResult::new(self.roots.clone()))
    }
}

pub(super) fn mcp_roots_for_policy(
    cwd: &Path,
    sandbox: Option<&SandboxSession>,
    root_policy: McpRootPolicy,
) -> Result<Vec<Root>> {
    match root_policy {
        McpRootPolicy::None => Ok(Vec::new()),
        McpRootPolicy::Workspace => {
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
            Ok(vec![Root::new(root_uri).with_name(root_name)])
        }
    }
}

/// The identity a server connects to: the process for stdio, the URL for
/// HTTP. Env vars and headers are credentials for the endpoint, not part of
/// its identity.
fn endpoint_key(transport: &McpTransportConfig) -> String {
    match transport {
        McpTransportConfig::Stdio { command, args, .. } => {
            let mut key = String::from("stdio\0");
            key.push_str(command);
            for arg in args {
                key.push('\0');
                key.push_str(arg);
            }
            key
        }
        McpTransportConfig::StreamableHttp { url, .. } => {
            format!("http\0{}", url.trim_end_matches('/'))
        }
    }
}

pub(super) fn tool_definition(full_name: &str, server_name: &str, tool: &Tool) -> ToolDefinition {
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
