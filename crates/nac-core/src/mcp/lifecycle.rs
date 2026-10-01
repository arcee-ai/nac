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
    service: Option<SharedMcpService>,
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
        let handler = NacMcpClientHandler::unbound(mcp_roots_for_policy(
            &self.cwd,
            None,
            McpRootPolicy::None,
        )?);
        let mut service =
            match connect_server(name, &config, &handler, &self.cwd, startup_timeout).await {
                Ok(service) => service,
                Err(error) => return Ok(self.record_failure(name, &config, error).await),
            };
        let tools = match timeout(catalog_timeout, service.list_all_tools()).await {
            Ok(Ok(tools)) => tools,
            Ok(Err(error)) => {
                close_mcp_service(&mut service).await;
                return Ok(self
                    .record_failure(
                        name,
                        &config,
                        anyhow!(error).context("failed to list tools"),
                    )
                    .await);
            }
            Err(_) => {
                close_mcp_service(&mut service).await;
                return Ok(self
                    .record_failure(
                        name,
                        &config,
                        anyhow!(
                            "timed out listing tools after {}ms",
                            catalog_timeout.as_millis()
                        ),
                    )
                    .await);
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
        let service = Arc::new(tokio::sync::RwLock::new(service));
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
        self.remove_entry(name).await;
        self.connect_inner(name).await
    }

    pub async fn forget(&self, name: &str) {
        let _operation = self.operation.lock().await;
        self.remove_entry(name).await;
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

    async fn set_entry(&self, status: McpRuntimeStatus, service: Option<SharedMcpService>) {
        let replaced = self
            .entries
            .write()
            .await
            .insert(status.name.clone(), RuntimeEntry { status, service })
            .and_then(|entry| entry.service);
        if let Some(replaced) = replaced {
            close_shared_mcp_service(replaced).await;
        }
    }

    async fn remove_entry(&self, name: &str) {
        let removed = self
            .entries
            .write()
            .await
            .remove(name)
            .and_then(|entry| entry.service);
        if let Some(removed) = removed {
            close_shared_mcp_service(removed).await;
        }
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

    #[cfg(unix)]
    #[tokio::test]
    async fn disconnect_closes_and_reaps_stdio_server() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let root = crate::mcp::test_support::unique_temp_dir("nac-mcp-runtime-close");
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("fake-mcp.sh");
        let pid_file = root.join("server.pid");
        std::fs::write(
            &script,
            r#"#!/bin/sh
printf '%s' "$$" > "$MCP_PID_FILE"
while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"stdio-close-test","version":"0.1.0"}}}\n' "$id"
      ;;
    *'"method":"tools/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[]}}\n' "$id"
      ;;
  esac
done
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("config.toml"),
            format!(
                r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = [{}]
env = {{ MCP_PID_FILE = {} }}
"#,
                serde_json::to_string(&script.display().to_string()).unwrap(),
                serde_json::to_string(&pid_file.display().to_string()).unwrap(),
            ),
        )
        .unwrap();
        unsafe { env::set_var("NAC_HOME", &root) };

        let manager = McpRuntimeManager::new(root.clone());
        let connected = manager.connect("local").await.unwrap();
        assert_eq!(connected.state, McpRuntimeState::Connected);
        let pid = std::fs::read_to_string(&pid_file)
            .unwrap()
            .parse::<libc::pid_t>()
            .unwrap();
        assert_eq!(unsafe { libc::kill(pid, 0) }, 0);

        let disconnected = manager.disconnect("local").await.unwrap();
        assert_eq!(disconnected.state, McpRuntimeState::Disconnected);
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline && unsafe { libc::kill(pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_ne!(
            unsafe { libc::kill(pid, 0) },
            0,
            "disconnect left the stdio MCP child running"
        );

        crate::mcp::test_support::restore_env("NAC_HOME", original_nac_home);
        crate::mcp::test_support::restore_env("XDG_CONFIG_HOME", original_xdg);
        let _ = std::fs::remove_dir_all(root);
    }
}
