use super::*;

#[derive(Debug, Default, Deserialize)]
pub(super) struct McpConfigFile {
    #[serde(default)]
    pub(super) mcp_servers: BTreeMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct McpServerConfig {
    #[serde(default = "default_enabled")]
    pub(super) enabled: bool,
    #[serde(flatten)]
    pub(super) transport: McpTransportConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub(super) enum McpTransportConfig {
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

pub(super) fn default_config_path() -> Option<PathBuf> {
    nac_config_path()
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
