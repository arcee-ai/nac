use super::*;

#[derive(Debug, Default, Deserialize)]
pub(super) struct McpConfigFile {
    #[serde(default)]
    pub(super) mcp_servers: BTreeMap<String, McpServerConfig>,
}

#[derive(Debug, Default, Deserialize)]
struct RawMcpConfigFile {
    #[serde(default)]
    mcp_servers: BTreeMap<String, toml::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McpServerConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(flatten)]
    pub transport: McpTransportConfig,
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
    },
    StreamableHttp {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

/// A stored server row as the connect path understands it. The row was
/// validated on the way into the store, so a malformed one is a bug reported
/// rather than silently skipped by the caller.
pub(super) fn server_config_from_record(
    record: &crate::store::McpServerConfigurationRecord,
) -> Result<McpServerConfig> {
    let transport = match record.transport.as_str() {
        crate::store::MCP_TRANSPORT_STDIO => McpTransportConfig::Stdio {
            command: record
                .command
                .clone()
                .ok_or_else(|| anyhow!("stored stdio MCP server carries no command"))?,
            args: record.args.clone(),
            env: record.env.clone(),
        },
        crate::store::MCP_TRANSPORT_STREAMABLE_HTTP => McpTransportConfig::StreamableHttp {
            url: record
                .url
                .clone()
                .ok_or_else(|| anyhow!("stored HTTP MCP server carries no url"))?,
            headers: record.headers.clone(),
        },
        other => bail!("stored MCP server has unsupported transport '{other}'"),
    };
    Ok(McpServerConfig {
        enabled: record.enabled,
        transport,
    })
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
    let mut config = McpConfigFile::default();
    for (server_name, server_value) in raw_config.mcp_servers {
        if !raw_transport_is_streamable_http(&server_value) {
            eprintln!(
                "Skipping MCP server '{}': transport is not streamable_http",
                server_name
            );
            continue;
        }
        let server_config = server_value.try_into().with_context(|| {
            format!(
                "failed to parse streamable_http MCP server '{}'",
                server_name
            )
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
