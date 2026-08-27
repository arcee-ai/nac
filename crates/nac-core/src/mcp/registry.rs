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

/// A configured MCP server that could not be loaded for a worker, and why.
#[derive(Debug)]
pub(crate) struct McpSkippedServer {
    pub name: String,
    pub reason: String,
}

/// The result of loading MCP servers: the registry of tools that mounted, plus
/// every server that was skipped so the caller can surface it.
pub(crate) struct McpLoadOutcome {
    pub registry: Option<Arc<McpRegistry>>,
    pub skipped: Vec<McpSkippedServer>,
}

/// Servers defined in `config.toml`, plus a synthetic skip when the file is
/// unreadable or invalid — a broken file disables MCP rather than failing the
/// session, but the caller still gets a reason to surface.
fn file_servers_for_policy(
    paths: &PathContext,
    transport_policy: McpTransportPolicy,
) -> (BTreeMap<String, McpServerConfig>, Option<McpSkippedServer>) {
    let Some(path) = default_config_path(paths) else {
        return (BTreeMap::new(), None);
    };
    if !super::file_config::mcp_configuration_state_exists(&path) {
        return (BTreeMap::new(), None);
    }
    let raw = match super::read_mcp_configuration_consistently(&path) {
        Ok(raw) => raw,
        Err(error) => {
            let reason = format!("could not read config: {error:#}");
            eprintln!(
                "MCP config at '{}' could not be read; its servers will be skipped: {:#}",
                path.display(),
                error
            );
            return (
                BTreeMap::new(),
                Some(McpSkippedServer {
                    name: path.display().to_string(),
                    reason,
                }),
            );
        }
    };
    match mcp_config_for_policy(&raw, transport_policy) {
        Ok(config) => (config.mcp_servers, None),
        Err(error) => {
            let reason = format!("invalid config: {error:#}");
            eprintln!(
                "MCP config at '{}' is invalid; its servers will be skipped: {:#}",
                path.display(),
                error
            );
            (
                BTreeMap::new(),
                Some(McpSkippedServer {
                    name: path.display().to_string(),
                    reason,
                }),
            )
        }
    }
}

impl McpRegistry {
    #[cfg(test)]
    pub(crate) fn empty_for_test() -> Self {
        Self {
            tools: Arc::new(HashMap::new()),
        }
    }

    /// Loads the configured MCP servers and reports every server that was
    /// skipped and why — including a broken `config.toml`, which is reported
    /// as a single skip named after the config path — so the caller can
    /// surface the reason instead of silently dropping the server's tools.
    pub(crate) async fn load_reporting_skips(
        cwd: &Path,
        sandbox: Option<&SandboxSession>,
        paths: &PathContext,
        transport_policy: McpTransportPolicy,
        root_policy: McpRootPolicy,
    ) -> Result<McpLoadOutcome> {
        let (servers, config_error) = file_servers_for_policy(paths, transport_policy);
        if let Some(skipped) = config_error {
            return Ok(McpLoadOutcome {
                registry: None,
                skipped: vec![skipped],
            });
        }
        if servers.is_empty() {
            return Ok(McpLoadOutcome {
                registry: None,
                skipped: Vec::new(),
            });
        }

        let handler = NacMcpClientHandler {
            roots: mcp_roots_for_policy(cwd, sandbox, root_policy)?,
        };

        let mut tools = HashMap::new();
        let mut skipped = Vec::new();
        let mut seen_names = HashMap::<String, usize>::new();
        let mut seen_endpoints = HashMap::<String, String>::new();

        for (server_name, server_config) in servers {
            if !server_config.enabled {
                continue;
            }
            // Two names for the same endpoint would mount every tool twice
            // under different prefixes, so only the first name that mounts
            // tools claims the endpoint; a failed attempt leaves it free for
            // a later twin.
            let endpoint = endpoint_key(&server_config.transport);
            if let Some(existing) = seen_endpoints.get(&endpoint) {
                let reason = format!("same endpoint as server '{existing}'");
                eprintln!("Skipping MCP server '{server_name}': {reason}");
                skipped.push(McpSkippedServer {
                    name: server_name,
                    reason,
                });
                continue;
            }

            let service = match timeout(
                MCP_CONNECT_TIMEOUT,
                connect_server(&server_name, &server_config, &handler, cwd),
            )
            .await
            {
                Ok(Ok(service)) => Arc::new(service),
                Ok(Err(error)) => {
                    let reason = format!("{error:#}");
                    eprintln!(
                        "MCP server '{}' is unavailable and will be skipped: {reason}",
                        server_name
                    );
                    skipped.push(McpSkippedServer {
                        name: server_name,
                        reason,
                    });
                    continue;
                }
                Err(_) => {
                    let reason = format!(
                        "timed out during connect after {}s",
                        MCP_CONNECT_TIMEOUT.as_secs()
                    );
                    eprintln!("MCP server '{}' {reason} and will be skipped", server_name);
                    skipped.push(McpSkippedServer {
                        name: server_name,
                        reason,
                    });
                    continue;
                }
            };

            let listed_tools =
                match timeout(MCP_TOOL_INVENTORY_TIMEOUT, service.list_all_tools()).await {
                    Ok(Ok(tools)) => tools,
                    Ok(Err(error)) => {
                        let reason = format!("{error:#}");
                        eprintln!(
                            "MCP server '{}' could not list tools and will be skipped: {reason}",
                            server_name
                        );
                        skipped.push(McpSkippedServer {
                            name: server_name,
                            reason,
                        });
                        continue;
                    }
                    Err(_) => {
                        let reason = format!(
                            "timed out while listing tools after {}s",
                            MCP_TOOL_INVENTORY_TIMEOUT.as_secs()
                        );
                        eprintln!("MCP server '{}' {reason} and will be skipped", server_name);
                        skipped.push(McpSkippedServer {
                            name: server_name,
                            reason,
                        });
                        continue;
                    }
                };

            seen_endpoints.insert(endpoint, server_name.clone());
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

        let registry = if tools.is_empty() {
            None
        } else {
            Some(Arc::new(Self {
                tools: Arc::new(tools),
            }))
        };

        Ok(McpLoadOutcome { registry, skipped })
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

    pub(crate) fn tool_definition(&self, name: &str) -> Option<ToolDefinition> {
        self.tools
            .get(name)
            .map(|binding| binding.definition.clone())
    }

    pub async fn call_tool(&self, name: &str, args: Value, image_results: bool) -> ToolResult {
        let Some(binding) = self.tools.get(name) else {
            return ToolResult {
                content: format!("Error: unknown MCP tool '{}'", name).into(),
                is_error: true,
            };
        };

        let arguments = match args {
            Value::Object(map) => Some(map),
            Value::Null => None,
            _ => {
                return ToolResult {
                    content: format!("Error: MCP tool '{}' requires object arguments", name).into(),
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
            Ok(Ok(result)) => flatten_tool_result(result, image_results).await,
            Ok(Err(error)) => ToolResult {
                content: format!("Error calling MCP tool '{}': {}", name, error).into(),
                is_error: true,
            },
            Err(_) => ToolResult {
                content: format!(
                    "Error calling MCP tool '{}': timed out after {}s",
                    name,
                    MCP_TOOL_CALL_TIMEOUT.as_secs()
                )
                .into(),
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
