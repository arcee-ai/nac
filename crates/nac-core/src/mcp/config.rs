use super::*;

#[derive(Debug, Default, Deserialize)]
pub(super) struct McpConfigFile {
    #[serde(default)]
    pub(super) mcp: McpDefaults,
    #[serde(default)]
    pub(super) mcp_servers: BTreeMap<String, McpServerConfig>,
}

#[derive(Debug, Default, Deserialize)]
struct RawMcpConfigFile {
    #[serde(default)]
    mcp: McpDefaults,
    #[serde(default)]
    mcp_servers: BTreeMap<String, toml::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McpServerConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Library catalog entry the dashboard created this server from. Only the
    /// dashboard reads it; the connect path ignores it.
    #[serde(default)]
    pub library_id: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub startup_timeout_ms: Option<u64>,
    #[serde(default)]
    pub catalog_timeout_ms: Option<u64>,
    #[serde(default)]
    pub execution_timeout_ms: Option<u64>,
    #[serde(flatten)]
    pub transport: McpTransportConfig,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct McpDefaults {
    #[serde(default)]
    pub startup_timeout_ms: Option<u64>,
    #[serde(default)]
    pub catalog_timeout_ms: Option<u64>,
    #[serde(default)]
    pub execution_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize, serde::Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct McpHeaderHelperConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub env_vars: Vec<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default)]
        env_vars: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
    },
    StreamableHttp {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        env_headers: BTreeMap<String, String>,
        #[serde(default)]
        bearer_token_env_var: Option<String>,
        #[serde(default)]
        header_helper: Option<McpHeaderHelperConfig>,
    },
}

impl McpServerConfig {
    pub(super) fn has_header_helper(&self) -> bool {
        matches!(
            &self.transport,
            McpTransportConfig::StreamableHttp {
                header_helper: Some(_),
                ..
            }
        )
    }

    pub(super) fn startup_timeout(&self, defaults: &McpDefaults) -> Result<Duration> {
        timeout_value(
            self.startup_timeout_ms.or(defaults.startup_timeout_ms),
            MCP_CONNECT_TIMEOUT,
            "startup_timeout_ms",
        )
    }

    pub(super) fn catalog_timeout(&self, defaults: &McpDefaults) -> Result<Duration> {
        timeout_value(
            self.catalog_timeout_ms.or(defaults.catalog_timeout_ms),
            MCP_TOOL_INVENTORY_TIMEOUT,
            "catalog_timeout_ms",
        )
    }

    pub fn execution_timeout(&self, defaults: &McpDefaults) -> Result<Duration> {
        timeout_value(
            self.execution_timeout_ms.or(defaults.execution_timeout_ms),
            MCP_EXECUTION_TIMEOUT,
            "execution_timeout_ms",
        )
    }
}

pub(super) fn timeout_value(
    value: Option<u64>,
    default: Duration,
    field: &str,
) -> Result<Duration> {
    let Some(milliseconds) = value else {
        return Ok(default);
    };
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&milliseconds) {
        bail!("{field} must be between {MIN_TIMEOUT_MS} and {MAX_TIMEOUT_MS} milliseconds");
    }
    Ok(Duration::from_millis(milliseconds))
}

pub(super) fn default_config_path(paths: &PathContext) -> Option<PathBuf> {
    paths.nac_config_path()
}

pub(super) fn mcp_config_for_policy(
    raw: &str,
    transport_policy: McpTransportPolicy,
) -> Result<McpConfigFile> {
    match transport_policy {
        McpTransportPolicy::All => toml::from_str(raw).context("failed to parse MCP config"),
        McpTransportPolicy::StreamableHttpOnly => streamable_http_config_from_raw(raw),
    }
}

fn streamable_http_config_from_raw(raw: &str) -> Result<McpConfigFile> {
    let raw_config: RawMcpConfigFile = toml::from_str(raw).context("failed to parse MCP config")?;
    let mut config = McpConfigFile {
        mcp: raw_config.mcp,
        ..McpConfigFile::default()
    };
    for (server_name, server_value) in raw_config.mcp_servers {
        if !raw_transport_is_streamable_http(&server_value) {
            eprintln!("Skipping MCP server '{server_name}': transport is not streamable_http");
            continue;
        }
        let server_config = server_value.try_into().with_context(|| {
            format!("failed to parse streamable_http MCP server '{server_name}'")
        })?;
        config.mcp_servers.insert(server_name, server_config);
    }
    Ok(config)
}

fn raw_transport_is_streamable_http(value: &toml::Value) -> bool {
    value.get("transport").and_then(toml::Value::as_str) == Some("streamable_http")
}

fn default_enabled() -> bool {
    true
}

pub(super) fn expand_strings(values: &[String]) -> Result<Vec<String>> {
    values.iter().map(|value| expand_env(value)).collect()
}

pub(super) fn expand_map(values: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>> {
    let mut expanded = BTreeMap::new();
    for (key, value) in values {
        expanded.insert(key.clone(), expand_env(value)?);
    }
    Ok(expanded)
}

pub(super) fn expand_env(input: &str) -> Result<String> {
    let mut out = String::new();
    let mut rest = input;

    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find('}') else {
            bail!("invalid environment placeholder '{input}'");
        };
        let name = &after_start[..end];
        let value =
            env::var(name).with_context(|| format!("environment variable '{name}' is not set"))?;
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
    fn server_timeout_overrides_global_default_and_legacy_defaults_remain() {
        let config: McpConfigFile = toml::from_str(
            r#"
[mcp]
startup_timeout_ms = 2300
catalog_timeout_ms = 3400
execution_timeout_ms = 4500

[mcp_servers.local]
transport = "stdio"
command = "server"
catalog_timeout_ms = 5600
"#,
        )
        .unwrap();
        let server = &config.mcp_servers["local"];
        assert_eq!(
            server.startup_timeout(&config.mcp).unwrap(),
            Duration::from_millis(2300)
        );
        assert_eq!(
            server.catalog_timeout(&config.mcp).unwrap(),
            Duration::from_millis(5600)
        );
        assert_eq!(
            server.execution_timeout(&config.mcp).unwrap(),
            Duration::from_millis(4500)
        );

        let legacy: McpConfigFile =
            toml::from_str("[mcp_servers.local]\ntransport = \"stdio\"\ncommand = \"server\"\n")
                .unwrap();
        let legacy_server = &legacy.mcp_servers["local"];
        assert_eq!(
            legacy_server.startup_timeout(&legacy.mcp).unwrap(),
            MCP_CONNECT_TIMEOUT
        );
        assert_eq!(
            legacy_server.catalog_timeout(&legacy.mcp).unwrap(),
            MCP_TOOL_INVENTORY_TIMEOUT
        );
        assert_eq!(
            legacy_server.execution_timeout(&legacy.mcp).unwrap(),
            MCP_EXECUTION_TIMEOUT
        );
    }

    #[test]
    fn timeout_bounds_are_rejected() {
        assert!(timeout_value(Some(99), Duration::from_secs(1), "timeout").is_err());
        assert!(
            timeout_value(Some(MAX_TIMEOUT_MS + 1), Duration::from_secs(1), "timeout").is_err()
        );
    }
}
