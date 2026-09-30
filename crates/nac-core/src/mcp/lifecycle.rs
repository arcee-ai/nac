use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum McpRuntimeState {
    Disabled,
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct McpRuntimeStatus {
    pub name: String,
    pub state: McpRuntimeState,
    pub required: bool,
    pub auth_required: bool,
    pub error: Option<String>,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tool_count: usize,
}

struct RuntimeEntry {
    status: McpRuntimeStatus,
    _service: Option<Arc<McpService>>,
}

/// Process-local operational connections for the dashboard. Worker registries
/// remain independently constructed with the selected execution backend.
pub struct McpRuntimeManager {
    cwd: PathBuf,
    operation: tokio::sync::Mutex<()>,
    entries: tokio::sync::RwLock<BTreeMap<String, RuntimeEntry>>,
}

impl McpRuntimeManager {
    pub fn new(cwd: PathBuf) -> Self {
        Self {
            cwd,
            operation: tokio::sync::Mutex::new(()),
            entries: tokio::sync::RwLock::new(BTreeMap::new()),
        }
    }

    pub async fn statuses(&self) -> Result<Vec<McpRuntimeStatus>> {
        let (defaults, servers) = self.configured_servers()?;
        let entries = self.entries.read().await;
        let mut statuses = Vec::with_capacity(servers.len());
        for (name, config) in servers {
            let mut status = entries
                .get(&name)
                .map(|entry| entry.status.clone())
                .unwrap_or_else(|| disconnected_status(&name, &config));
            status.required = config.required;
            if !config.enabled {
                status.state = McpRuntimeState::Disabled;
                status.error = None;
            } else if let Err(error) = validate_timeouts(&config, &defaults) {
                status.state = McpRuntimeState::Failed;
                status.error = Some(format!("invalid timeout configuration: {error:#}"));
            }
            statuses.push(status);
        }
        Ok(statuses)
    }

    pub async fn connect(&self, name: &str) -> Result<McpRuntimeStatus> {
        let _operation = self.operation.lock().await;
        self.connect_inner(name).await
    }

    async fn connect_inner(&self, name: &str) -> Result<McpRuntimeStatus> {
        let (defaults, mut servers) = self.configured_servers()?;
        let config = servers
            .remove(name)
            .with_context(|| format!("MCP server '{name}' was not found"))?;
        if !config.enabled {
            let status = McpRuntimeStatus {
                state: McpRuntimeState::Disabled,
                ..disconnected_status(name, &config)
            };
            self.set_entry(status.clone(), None).await;
            return Ok(status);
        }

        let startup_timeout = config.startup_timeout(&defaults)?;
        let catalog_timeout = config.catalog_timeout(&defaults)?;
        self.set_entry(
            McpRuntimeStatus {
                state: McpRuntimeState::Connecting,
                ..disconnected_status(name, &config)
            },
            None,
        )
        .await;
        let handler = NacMcpClientHandler {
            roots: mcp_roots_for_policy(&self.cwd, None, McpRootPolicy::None)?,
        };
        let service = match timeout(
            startup_timeout,
            connect_server(name, &config, &handler, &self.cwd),
        )
        .await
        {
            Ok(Ok(service)) => Arc::new(service),
            Ok(Err(error)) => return Ok(self.record_failure(name, &config, error).await),
            Err(_) => {
                return Ok(self
                    .record_failure(
                        name,
                        &config,
                        anyhow!(
                            "timed out connecting after {}ms",
                            startup_timeout.as_millis()
                        ),
                    )
                    .await)
            }
        };
        let tools = match timeout(catalog_timeout, service.list_all_tools()).await {
            Ok(Ok(tools)) => tools,
            Ok(Err(error)) => {
                return Ok(self
                    .record_failure(
                        name,
                        &config,
                        anyhow!(error).context("failed to list tools"),
                    )
                    .await)
            }
            Err(_) => {
                return Ok(self
                    .record_failure(
                        name,
                        &config,
                        anyhow!(
                            "timed out listing tools after {}ms",
                            catalog_timeout.as_millis()
                        ),
                    )
                    .await)
            }
        };
        let peer = service.peer_info();
        let status = McpRuntimeStatus {
            name: name.to_string(),
            state: McpRuntimeState::Connected,
            required: config.required,
            auth_required: false,
            error: None,
            protocol_version: peer.as_ref().map(|info| info.protocol_version.to_string()),
            server_name: peer
                .as_ref()
                .and_then(|info| info.server_info.as_ref())
                .map(|info| info.name.clone()),
            server_version: peer
                .as_ref()
                .and_then(|info| info.server_info.as_ref())
                .map(|info| info.version.clone()),
            tool_count: tools.len(),
        };
        self.set_entry(status.clone(), Some(service)).await;
        Ok(status)
    }

    pub async fn disconnect(&self, name: &str) -> Result<McpRuntimeStatus> {
        let _operation = self.operation.lock().await;
        let (_defaults, mut servers) = self.configured_servers()?;
        let config = servers
            .remove(name)
            .with_context(|| format!("MCP server '{name}' was not found"))?;
        let status = if config.enabled {
            disconnected_status(name, &config)
        } else {
            McpRuntimeStatus {
                state: McpRuntimeState::Disabled,
                ..disconnected_status(name, &config)
            }
        };
        self.set_entry(status.clone(), None).await;
        Ok(status)
    }

    pub async fn reload(&self, name: &str) -> Result<McpRuntimeStatus> {
        let _operation = self.operation.lock().await;
        self.entries.write().await.remove(name);
        self.connect_inner(name).await
    }

    pub async fn forget(&self, name: &str) {
        let _operation = self.operation.lock().await;
        self.entries.write().await.remove(name);
    }

    async fn record_failure(
        &self,
        name: &str,
        config: &McpServerConfig,
        error: anyhow::Error,
    ) -> McpRuntimeStatus {
        let auth_required = mcp_error_requires_authorization(&error);
        let message = if auth_required {
            "authentication required; refresh the configured credentials and retry".to_string()
        } else {
            format!("{error:#}")
        };
        let status = McpRuntimeStatus {
            name: name.to_string(),
            state: McpRuntimeState::Failed,
            required: config.required,
            auth_required,
            error: Some(message),
            protocol_version: None,
            server_name: None,
            server_version: None,
            tool_count: 0,
        };
        self.set_entry(status.clone(), None).await;
        status
    }

    async fn set_entry(&self, status: McpRuntimeStatus, service: Option<Arc<McpService>>) {
        self.entries.write().await.insert(
            status.name.clone(),
            RuntimeEntry {
                status,
                _service: service,
            },
        );
    }

    fn configured_servers(&self) -> Result<(McpDefaults, BTreeMap<String, McpServerConfig>)> {
        let paths = PathContext::new(&self.cwd);
        let Some(path) = default_config_path(&paths) else {
            return Ok((McpDefaults::default(), BTreeMap::new()));
        };
        if !super::file_config::mcp_configuration_state_exists(&path) {
            return Ok((McpDefaults::default(), BTreeMap::new()));
        }
        let raw = read_mcp_configuration_consistently(&path)?;
        let config = mcp_config_for_policy(&raw, McpTransportPolicy::All)?;
        Ok((config.mcp, config.mcp_servers))
    }
}

fn validate_timeouts(config: &McpServerConfig, defaults: &McpDefaults) -> Result<()> {
    config.startup_timeout(defaults)?;
    config.catalog_timeout(defaults)?;
    config.execution_timeout(defaults)?;
    Ok(())
}

fn disconnected_status(name: &str, config: &McpServerConfig) -> McpRuntimeStatus {
    McpRuntimeStatus {
        name: name.to_string(),
        state: McpRuntimeState::Disconnected,
        required: config.required,
        auth_required: false,
        error: None,
        protocol_version: None,
        server_name: None,
        server_version: None,
        tool_count: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;

    #[tokio::test]
    async fn disabled_server_status_and_connect_are_deterministic() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let root = crate::mcp::test_support::unique_temp_dir("nac-mcp-runtime-disabled");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("config.toml"),
            r#"
[mcp_servers.disabled]
enabled = false
required = true
transport = "stdio"
command = "never-spawned"
"#,
        )
        .unwrap();
        unsafe { env::set_var("NAC_HOME", &root) };

        let manager = McpRuntimeManager::new(root.clone());
        let statuses = manager.statuses().await.unwrap();
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].state, McpRuntimeState::Disabled);
        assert!(statuses[0].required);
        let connected = manager.connect("disabled").await.unwrap();
        assert_eq!(connected.state, McpRuntimeState::Disabled);

        crate::mcp::test_support::restore_env("NAC_HOME", original_nac_home);
        crate::mcp::test_support::restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = std::fs::remove_dir_all(root);
    }
}
