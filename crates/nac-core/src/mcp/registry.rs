use super::capabilities::{
    capability_tool_definition, capability_tool_definitions, MAX_PROMPT_ARGUMENTS,
    MAX_PROMPT_NAME_CHARS,
};
use super::*;

const MAX_DISCOVERED_PROMPTS: usize = 256;
const MAX_PROMPT_DISCOVERY_PAGES: usize = 32;

#[derive(Clone)]
pub struct McpRegistry {
    pub(super) tools: Arc<HashMap<String, Arc<McpToolBinding>>>,
    pub(super) servers: Arc<BTreeMap<String, Arc<McpServer>>>,
    pub(super) prompt_commands: Arc<HashMap<String, McpPromptCommand>>,
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
pub(super) struct McpToolBinding {
    tool_name: String,
    definition: ToolDefinition,
    server: Arc<McpServer>,
    execution_timeout: Duration,
}

pub(super) struct McpServer {
    pub(super) name: String,
    service: tokio::sync::RwLock<SharedMcpService>,
    refresh: tokio::sync::Mutex<()>,
    config: McpServerConfig,
    handler: NacMcpClientHandler,
    cwd: PathBuf,
    startup_timeout: Duration,
    pub(super) capabilities: rmcp::model::ServerCapabilities,
    pub(super) instructions: Option<String>,
}

impl McpServer {
    pub(super) async fn current_service(&self) -> SharedMcpService {
        self.service.read().await.clone()
    }
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

async fn close_mounted_services(services: &mut Vec<SharedMcpService>) {
    while let Some(service) = services.pop() {
        close_shared_mcp_service(service).await;
    }
}

/// Servers defined in `config.toml`, plus a synthetic skip when the file is
/// unreadable or invalid — a broken file disables MCP rather than failing the
/// session, but the caller still gets a reason to surface.
fn file_servers_for_policy(
    paths: &PathContext,
    transport_policy: McpTransportPolicy,
) -> (
    McpDefaults,
    BTreeMap<String, McpServerConfig>,
    Option<McpSkippedServer>,
) {
    let Some(path) = default_config_path(paths) else {
        return (McpDefaults::default(), BTreeMap::new(), None);
    };
    if !super::file_config::mcp_configuration_state_exists(&path) {
        return (McpDefaults::default(), BTreeMap::new(), None);
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
                McpDefaults::default(),
                BTreeMap::new(),
                Some(McpSkippedServer {
                    name: path.display().to_string(),
                    reason,
                }),
            );
        }
    };
    match mcp_config_for_policy(&raw, transport_policy) {
        Ok(config) => (config.mcp, config.mcp_servers, None),
        Err(error) => {
            let reason = format!("invalid config: {error:#}");
            eprintln!(
                "MCP config at '{}' is invalid; its servers will be skipped: {:#}",
                path.display(),
                error
            );
            (
                McpDefaults::default(),
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
            servers: Arc::new(BTreeMap::new()),
            prompt_commands: Arc::new(HashMap::new()),
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
        let (defaults, servers, config_error) = file_servers_for_policy(paths, transport_policy);
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
        let mut mounted_services = Vec::new();
        let mut mounted_servers = BTreeMap::new();
        let mut prompt_commands = HashMap::new();
        let mut skipped = Vec::new();
        let mut seen_names = HashMap::<String, usize>::new();
        let mut seen_endpoints = HashMap::<String, String>::new();

        for (server_name, server_config) in servers {
            if !server_config.enabled {
                continue;
            }
            // Two names for the same endpoint would mount the same advertised
            // capability surface twice under different provenance, so only a
            // successfully connected server claims the endpoint.
            let endpoint = endpoint_key(&server_config.transport);
            if let Some(existing) = seen_endpoints.get(&endpoint) {
                let reason = format!("same endpoint as server '{existing}'");
                if server_config.required {
                    close_mounted_services(&mut mounted_services).await;
                    bail!("required MCP server '{server_name}' cannot mount: {reason}");
                }
                eprintln!("Skipping MCP server '{server_name}': {reason}");
                skipped.push(McpSkippedServer {
                    name: server_name,
                    reason,
                });
                continue;
            }

            let resolved_timeouts = (|| {
                Ok::<_, anyhow::Error>((
                    server_config.startup_timeout(&defaults)?,
                    server_config.catalog_timeout(&defaults)?,
                    server_config.execution_timeout(&defaults)?,
                ))
            })();
            let (startup_timeout, catalog_timeout, execution_timeout) = match resolved_timeouts {
                Ok(timeouts) => timeouts,
                Err(error) => {
                    let reason = format!("invalid timeout configuration: {error:#}");
                    if server_config.required {
                        close_mounted_services(&mut mounted_services).await;
                        bail!("required MCP server '{server_name}' {reason}");
                    }
                    skipped.push(McpSkippedServer {
                        name: server_name,
                        reason,
                    });
                    continue;
                }
            };
            let mut service =
                match connect_server(&server_name, &server_config, &handler, cwd, startup_timeout)
                    .await
                {
                    Ok(service) => service,
                    Err(error) => {
                        let reason = format!("{error:#}");
                        if server_config.required {
                            close_mounted_services(&mut mounted_services).await;
                            bail!(
                                "required MCP server '{server_name}' failed to connect: {reason}"
                            );
                        }
                        eprintln!(
                        "MCP server '{server_name}' is unavailable and will be skipped: {reason}"
                    );
                        skipped.push(McpSkippedServer {
                            name: server_name,
                            reason,
                        });
                        continue;
                    }
                };

            let peer_info = match service.peer_info() {
                Some(peer_info) => peer_info,
                None => {
                    let reason = "completed initialization without peer info".to_string();
                    close_mcp_service(&mut service).await;
                    if server_config.required {
                        close_mounted_services(&mut mounted_services).await;
                        bail!("required MCP server '{server_name}' {reason}");
                    }
                    eprintln!("MCP server '{server_name}' {reason} and will be skipped");
                    skipped.push(McpSkippedServer {
                        name: server_name,
                        reason,
                    });
                    continue;
                }
            };
            let capabilities = peer_info.capabilities.clone();
            let listed_tools = if capabilities.tools.is_none() {
                Vec::new()
            } else {
                match timeout(catalog_timeout, service.list_all_tools()).await {
                    Ok(Ok(tools)) => tools,
                    Ok(Err(error)) => {
                        let reason = format!("failed to list tools: {error:#}");
                        close_mcp_service(&mut service).await;
                        if server_config.required {
                            close_mounted_services(&mut mounted_services).await;
                            bail!("required MCP server '{server_name}' {reason}");
                        }
                        eprintln!(
                            "MCP server '{server_name}' could not list tools and will be skipped: {reason}"
                        );
                        skipped.push(McpSkippedServer {
                            name: server_name,
                            reason,
                        });
                        continue;
                    }
                    Err(_) => {
                        let reason = format!(
                            "timed out while listing tools after {}ms",
                            catalog_timeout.as_millis()
                        );
                        close_mcp_service(&mut service).await;
                        if server_config.required {
                            close_mounted_services(&mut mounted_services).await;
                            bail!("required MCP server '{server_name}' {reason}");
                        }
                        eprintln!("MCP server '{server_name}' {reason} and will be skipped");
                        skipped.push(McpSkippedServer {
                            name: server_name,
                            reason,
                        });
                        continue;
                    }
                }
            };

            let listed_prompts = if capabilities.prompts.is_none() {
                Vec::new()
            } else {
                match timeout(catalog_timeout, list_bounded_prompts(&service)).await {
                    Ok(Ok(prompts)) => prompts,
                    Ok(Err(error)) => {
                        let reason = format!("could not list prompts: {error:#}");
                        if server_config.required {
                            close_mcp_service(&mut service).await;
                            close_mounted_services(&mut mounted_services).await;
                            bail!("required MCP server '{server_name}' {reason}");
                        }
                        eprintln!(
                            "MCP server '{server_name}' {reason}; prompt commands will be unavailable"
                        );
                        skipped.push(McpSkippedServer {
                            name: server_name.clone(),
                            reason,
                        });
                        Vec::new()
                    }
                    Err(_) => {
                        let reason = format!(
                            "timed out while listing prompts after {}ms",
                            catalog_timeout.as_millis()
                        );
                        if server_config.required {
                            close_mcp_service(&mut service).await;
                            close_mounted_services(&mut mounted_services).await;
                            bail!("required MCP server '{server_name}' {reason}");
                        }
                        eprintln!(
                            "MCP server '{server_name}' {reason}; prompt commands will be unavailable"
                        );
                        skipped.push(McpSkippedServer {
                            name: server_name.clone(),
                            reason,
                        });
                        Vec::new()
                    }
                }
            };

            seen_endpoints.insert(endpoint, server_name.clone());
            let service = Arc::new(tokio::sync::RwLock::new(service));
            let server = Arc::new(McpServer {
                name: server_name.clone(),
                service: tokio::sync::RwLock::new(Arc::clone(&service)),
                refresh: tokio::sync::Mutex::new(()),
                config: server_config.clone(),
                handler: handler.clone(),
                cwd: cwd.to_path_buf(),
                startup_timeout,
                capabilities,
                instructions: peer_info.instructions.clone(),
            });
            for tool in listed_tools {
                let qualified_name = allocate_tool_name(&server_name, &tool.name, &mut seen_names);
                let mut definition = tool_definition(&qualified_name, &server_name, &tool);
                if definition.function.parameters["properties"]
                    .as_object()
                    .is_some_and(|properties| properties.contains_key("_nac"))
                {
                    skipped.push(McpSkippedServer {
                        name: qualified_name.clone(),
                        reason: "tool capability skipped: input schema already defines reserved property '_nac'"
                            .to_string(),
                    });
                    continue;
                }
                if let Err(reason) = crate::tools::kernel::decorate_timeout_schema(
                    &mut definition.function.parameters,
                ) {
                    skipped.push(McpSkippedServer {
                        name: qualified_name.clone(),
                        reason: format!("tool capability skipped: {reason}"),
                    });
                    continue;
                }
                tools.insert(
                    qualified_name,
                    Arc::new(McpToolBinding {
                        tool_name: tool.name.to_string(),
                        definition,
                        server: Arc::clone(&server),
                        execution_timeout,
                    }),
                );
            }
            for prompt in listed_prompts {
                if prompt.name.is_empty() || prompt.name.chars().count() > MAX_PROMPT_NAME_CHARS {
                    skipped.push(McpSkippedServer {
                        name: server_name.clone(),
                        reason: format!(
                            "prompt capability skipped: name must contain 1..={MAX_PROMPT_NAME_CHARS} characters"
                        ),
                    });
                    continue;
                }
                if prompt.arguments.as_ref().is_some_and(|arguments| {
                    arguments.len() > MAX_PROMPT_ARGUMENTS
                        || arguments.iter().any(|argument| {
                            argument.name.is_empty()
                                || argument.name.chars().count() > MAX_PROMPT_NAME_CHARS
                        })
                }) {
                    skipped.push(McpSkippedServer {
                        name: server_name.clone(),
                        reason: format!(
                            "prompt capability '{}' skipped: arguments exceed NAC count or name bounds",
                            prompt.name
                        ),
                    });
                    continue;
                }
                let command_name = allocate_tool_name(&server_name, &prompt.name, &mut seen_names);
                let command = McpPromptCommand::from_prompt(
                    command_name.clone(),
                    server_name.clone(),
                    prompt,
                );
                prompt_commands.insert(command_name, command);
            }
            mounted_services.push(service);
            mounted_servers.insert(server_name, server);
        }

        let registry = if mounted_servers.is_empty() {
            None
        } else {
            Some(Arc::new(Self {
                tools: Arc::new(tools),
                servers: Arc::new(mounted_servers),
                prompt_commands: Arc::new(prompt_commands),
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

    pub fn model_tool_definitions(&self) -> Vec<ToolDefinition> {
        let mut definitions = self.tool_definitions();
        definitions.extend(capability_tool_definitions());
        definitions.sort_by(|left, right| left.function.name.cmp(&right.function.name));
        definitions
    }

    pub(crate) fn tool_definition(&self, name: &str) -> Option<ToolDefinition> {
        self.tools
            .get(name)
            .map(|binding| binding.definition.clone())
            .or_else(|| capability_tool_definition(name))
    }

    pub(crate) fn execution_timeout(&self, name: &str) -> Option<Duration> {
        self.tools
            .get(name)
            .map(|binding| binding.execution_timeout)
    }

    pub async fn call_tool(&self, name: &str, args: Value, image_results: bool) -> ToolResult {
        let Some(binding) = self.tools.get(name) else {
            return ToolResult {
                content: format!("Error: unknown MCP tool '{name}'").into(),
                is_error: true,
            };
        };

        let arguments = match args {
            Value::Object(map) => Some(map),
            Value::Null => None,
            _ => {
                return ToolResult {
                    content: format!("Error: MCP tool '{name}' requires object arguments").into(),
                    is_error: true,
                }
            }
        };

        let mut params = CallToolRequestParams::new(binding.tool_name.clone());
        if let Some(arguments) = arguments {
            params = params.with_arguments(arguments);
        }
        // Keep the high-level 3.x call: it resolves protocol-version-specific
        // multi-round responses and returns only the final CallToolResult.
        let service = binding.server.service.read().await.clone();
        let first_result = service.read().await.call_tool(params.clone()).await;
        match first_result {
            Ok(result) => flatten_tool_result(result, image_results).await,
            Err(error)
                if binding.server.config.has_header_helper() && authorization_required(&error) =>
            {
                let _refresh = binding.server.refresh.lock().await;
                let refreshed_service = {
                    let current = binding.server.service.read().await.clone();
                    if Arc::ptr_eq(&current, &service) {
                        match connect_server(
                            &binding.server.name,
                            &binding.server.config,
                            &binding.server.handler,
                            &binding.server.cwd,
                            binding.server.startup_timeout,
                        )
                        .await
                        {
                            Ok(refreshed) => {
                                let refreshed = Arc::new(tokio::sync::RwLock::new(refreshed));
                                let replaced = {
                                    let mut current = binding.server.service.write().await;
                                    std::mem::replace(&mut *current, Arc::clone(&refreshed))
                                };
                                close_shared_mcp_service(replaced).await;
                                refreshed
                            }
                            Err(refresh_error) => {
                                return ToolResult {
                                    content: format!(
                                        "Error calling MCP tool '{name}': authentication refresh failed: {refresh_error:#}"
                                    )
                                    .into(),
                                    is_error: true,
                                };
                            }
                        }
                    } else {
                        current
                    }
                };
                let refreshed_result = refreshed_service.read().await.call_tool(params).await;
                match refreshed_result {
                    Ok(result) => flatten_tool_result(result, image_results).await,
                    Err(error) => ToolResult {
                        content: format!(
                            "Error calling MCP tool '{name}' after authentication refresh: {error}"
                        )
                        .into(),
                        is_error: true,
                    },
                }
            }
            Err(error) => ToolResult {
                content: format!("Error calling MCP tool '{name}': {error}").into(),
                is_error: true,
            },
        }
    }
}

async fn list_bounded_prompts(service: &McpService) -> Result<Vec<rmcp::model::Prompt>> {
    let mut prompts = Vec::new();
    let mut cursor = None;
    let mut seen_cursors = std::collections::HashSet::new();
    for _ in 0..MAX_PROMPT_DISCOVERY_PAGES {
        let result = service
            .list_prompts(Some(
                rmcp::model::PaginatedRequestParams::default().with_cursor(cursor.clone()),
            ))
            .await?;
        let remaining = MAX_DISCOVERED_PROMPTS.saturating_sub(prompts.len());
        prompts.extend(result.prompts.into_iter().take(remaining));
        if prompts.len() == MAX_DISCOVERED_PROMPTS {
            break;
        }
        let Some(next_cursor) = result.next_cursor else {
            break;
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            bail!("prompt discovery returned a repeated pagination cursor");
        }
        cursor = Some(next_cursor);
    }
    Ok(prompts)
}

impl ClientHandler for NacMcpClientHandler {
    #[expect(
        clippy::expect_used,
        reason = "the locally constructed MCP capability object matches the protocol schema"
    )]
    fn get_info(&self) -> ClientConfig {
        let capabilities = if self.roots.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::json!({
                "roots": {
                    "listChanged": true
                }
            })
        };
        ClientConfig::new(
            serde_json::from_value(capabilities).expect("valid MCP client capabilities"),
            mcp_implementation(nac_contracts::PRODUCT_VERSION),
        )
        .with_protocol_version(ProtocolVersion::LATEST_WITH_INITIALIZE)
    }

    async fn list_roots(
        &self,
        _request_context: rmcp::service::RequestContext<RoleClient>,
    ) -> std::result::Result<ListRootsResult, rmcp::model::ErrorData> {
        Ok(ListRootsResult::new(self.roots.clone()))
    }
}

fn mcp_implementation(product_version: &str) -> Implementation {
    Implementation::new("nac", product_version)
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
        .map(std::string::ToString::to_string)
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

#[cfg(test)]
mod product_identity_tests {
    use super::*;

    #[test]
    fn simulated_product_version_bump_updates_mcp_registration_exactly() {
        let implementation = mcp_implementation("9.8.7");
        assert_eq!(implementation.name, "nac");
        assert_eq!(implementation.version, "9.8.7");
    }

    #[test]
    fn outbound_mcp_client_preserves_the_latest_initialize_lifecycle() {
        let info = NacMcpClientHandler { roots: Vec::new() }.get_info();

        assert_eq!(
            info.protocol_version,
            ProtocolVersion::LATEST_WITH_INITIALIZE
        );
        assert!(info.protocol_version.has_initialize());
        assert!(!ProtocolVersion::LATEST.has_initialize());
    }
}
