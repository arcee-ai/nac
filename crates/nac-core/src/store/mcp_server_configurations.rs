use std::collections::BTreeMap;

use super::*;

/// A named MCP server the dashboard manages, merged over `config.toml` at
/// session start. A stored server overrides a file-defined server with the
/// same name.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct McpServerConfigurationRecord {
    pub config_id: String,
    pub name: String,
    pub enabled: bool,
    /// `stdio` or `streamable_http`.
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
    /// Library catalog entry this server was created from, when it was.
    pub library_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMcpServerConfiguration {
    pub name: String,
    pub enabled: bool,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub library_id: Option<String>,
}

#[derive(Debug)]
pub enum McpServerConfigurationStoreError {
    InvalidInput(String),
    DuplicateName(String),
    NotFound(String),
    Store(anyhow::Error),
}

impl std::fmt::Display for McpServerConfigurationStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::DuplicateName(name) => {
                write!(formatter, "an MCP server named '{name}' already exists")
            }
            Self::NotFound(id) => write!(formatter, "MCP server '{id}' was not found"),
            Self::Store(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for McpServerConfigurationStoreError {}

impl From<anyhow::Error> for McpServerConfigurationStoreError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

type ConfigurationResult<T> = std::result::Result<T, McpServerConfigurationStoreError>;

pub const MCP_TRANSPORT_STDIO: &str = "stdio";
pub const MCP_TRANSPORT_STREAMABLE_HTTP: &str = "streamable_http";

/// Longest accepted display name. Names are shown in a list, so a runaway
/// paste is rejected rather than truncated.
const MAX_NAME_LEN: usize = 120;

fn nonblank(value: &str, field: &str) -> ConfigurationResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(McpServerConfigurationStoreError::InvalidInput(format!(
            "{field} must not be blank"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_name(name: &str) -> ConfigurationResult<String> {
    let name = nonblank(name, "server name")?;
    if name.chars().count() > MAX_NAME_LEN {
        return Err(McpServerConfigurationStoreError::InvalidInput(format!(
            "server name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::ConstraintViolation)
    )
}

fn to_json<T: serde::Serialize>(value: &T, field: &str) -> ConfigurationResult<String> {
    serde_json::to_string(value).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!("failed to serialize {field}: {error}"))
    })
}

fn from_json<T: serde::de::DeserializeOwned + Default>(value: Option<String>) -> T {
    value
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default()
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpServerConfigurationRecord> {
    Ok(McpServerConfigurationRecord {
        config_id: row.get(0)?,
        name: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        transport: row.get(3)?,
        command: row.get(4)?,
        args: from_json(row.get(5)?),
        env: from_json(row.get(6)?),
        url: row.get(7)?,
        headers: from_json(row.get(8)?),
        library_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const SELECT_COLUMNS: &str = "config_id, name, enabled, transport, command, args_json, env_json, \
                              url, headers_json, library_id, created_at, updated_at";

pub fn list_mcp_server_configurations(
    path: &Path,
) -> ConfigurationResult<Vec<McpServerConfigurationRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM mcp_server_configurations ORDER BY created_at, name"
        ))
        .map_err(|error| McpServerConfigurationStoreError::Store(error.into()))?;
    let records = statement
        .query_map([], row_to_record)
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|error| McpServerConfigurationStoreError::Store(error.into()))?;
    Ok(records)
}

pub fn load_mcp_server_configuration(
    path: &Path,
    config_id: &str,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let conn = open_runtime_connection(path)?;
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM mcp_server_configurations WHERE config_id = ?1"),
        params![config_id],
        row_to_record,
    )
    .optional()
    .map_err(|error| McpServerConfigurationStoreError::Store(error.into()))?
    .ok_or_else(|| McpServerConfigurationStoreError::NotFound(config_id.to_string()))
}

/// Checks the fields a row must carry and settles the optional ones, so insert
/// and update reject the same input for the same reason.
fn validated_record(
    config_id: &str,
    configuration: NewMcpServerConfiguration,
    created_at: String,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let transport = configuration.transport.trim().to_string();
    let (command, url) = match transport.as_str() {
        MCP_TRANSPORT_STDIO => (
            Some(nonblank(
                configuration.command.as_deref().unwrap_or(""),
                "command",
            )?),
            None,
        ),
        MCP_TRANSPORT_STREAMABLE_HTTP => (
            None,
            Some(nonblank(configuration.url.as_deref().unwrap_or(""), "url")?),
        ),
        other => {
            return Err(McpServerConfigurationStoreError::InvalidInput(format!(
                "transport must be '{MCP_TRANSPORT_STDIO}' or \
                 '{MCP_TRANSPORT_STREAMABLE_HTTP}', not '{other}'"
            )))
        }
    };
    Ok(McpServerConfigurationRecord {
        config_id: nonblank(config_id, "configuration id")?,
        name: validate_name(&configuration.name)?,
        enabled: configuration.enabled,
        transport,
        command,
        args: configuration.args,
        env: configuration.env,
        url,
        headers: configuration.headers,
        library_id: configuration
            .library_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty()),
        created_at,
        updated_at: now_utc(),
    })
}

pub fn insert_mcp_server_configuration(
    path: &Path,
    config_id: &str,
    configuration: NewMcpServerConfiguration,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let record = validated_record(config_id, configuration, now_utc())?;

    let conn = open_runtime_connection(path)?;
    conn.execute(
        "INSERT INTO mcp_server_configurations
         (config_id, name, enabled, transport, command, args_json, env_json,
          url, headers_json, library_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            record.config_id,
            record.name,
            record.enabled as i64,
            record.transport,
            record.command,
            to_json(&record.args, "args")?,
            to_json(&record.env, "env")?,
            record.url,
            to_json(&record.headers, "headers")?,
            record.library_id,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|error| {
        if is_unique_violation(&error) {
            McpServerConfigurationStoreError::DuplicateName(record.name.clone())
        } else {
            McpServerConfigurationStoreError::Store(error.into())
        }
    })?;

    Ok(record)
}

/// Replaces every stored field of an existing configuration.
///
/// The caller passes a whole configuration rather than a patch: it has already
/// read the row to decide what a partial request leaves alone.
/// `created_at` survives, because the identity of the server does not change.
pub fn update_mcp_server_configuration(
    path: &Path,
    config_id: &str,
    configuration: NewMcpServerConfiguration,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let existing = load_mcp_server_configuration(path, config_id)?;
    let record = validated_record(config_id, configuration, existing.created_at)?;

    let conn = open_runtime_connection(path)?;
    let updated = conn
        .execute(
            "UPDATE mcp_server_configurations
             SET name = ?2, enabled = ?3, transport = ?4, command = ?5, args_json = ?6,
                 env_json = ?7, url = ?8, headers_json = ?9, library_id = ?10, updated_at = ?11
             WHERE config_id = ?1",
            params![
                record.config_id,
                record.name,
                record.enabled as i64,
                record.transport,
                record.command,
                to_json(&record.args, "args")?,
                to_json(&record.env, "env")?,
                record.url,
                to_json(&record.headers, "headers")?,
                record.library_id,
                record.updated_at,
            ],
        )
        .map_err(|error| {
            if is_unique_violation(&error) {
                McpServerConfigurationStoreError::DuplicateName(record.name.clone())
            } else {
                McpServerConfigurationStoreError::Store(error.into())
            }
        })?;
    if updated == 0 {
        return Err(McpServerConfigurationStoreError::NotFound(
            config_id.to_string(),
        ));
    }

    Ok(record)
}

/// Returns whether a configuration was actually removed.
pub fn delete_mcp_server_configuration(path: &Path, config_id: &str) -> ConfigurationResult<bool> {
    let conn = open_runtime_connection(path)?;
    let removed = conn
        .execute(
            "DELETE FROM mcp_server_configurations WHERE config_id = ?1",
            params![config_id],
        )
        .map_err(|error| McpServerConfigurationStoreError::Store(error.into()))?;
    Ok(removed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir().join(format!("nac-mcp-configs-{unique}/store.db"))
    }

    fn http_server(name: &str) -> NewMcpServerConfiguration {
        NewMcpServerConfiguration {
            name: name.to_string(),
            enabled: true,
            transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
            command: None,
            args: Vec::new(),
            env: BTreeMap::new(),
            url: Some("https://mcp.example.com/mcp".to_string()),
            headers: BTreeMap::from([(
                "Authorization".to_string(),
                "Bearer secret-token".to_string(),
            )]),
            library_id: Some("example".to_string()),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let store_path = temp_store();
        initialize(&store_path).unwrap();

        let created =
            insert_mcp_server_configuration(&store_path, "id-1", http_server("example")).unwrap();
        assert_eq!(created.name, "example");
        assert_eq!(created.url.as_deref(), Some("https://mcp.example.com/mcp"));
        assert!(created.enabled);

        let listed = list_mcp_server_configurations(&store_path).unwrap();
        assert_eq!(listed, vec![created.clone()]);

        let mut edited = http_server("renamed");
        edited.enabled = false;
        let updated = update_mcp_server_configuration(&store_path, "id-1", edited).unwrap();
        assert_eq!(updated.name, "renamed");
        assert!(!updated.enabled);
        assert_eq!(updated.created_at, created.created_at);

        assert!(delete_mcp_server_configuration(&store_path, "id-1").unwrap());
        assert!(list_mcp_server_configurations(&store_path)
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let store_path = temp_store();
        initialize(&store_path).unwrap();

        insert_mcp_server_configuration(&store_path, "id-1", http_server("example")).unwrap();
        let error = insert_mcp_server_configuration(&store_path, "id-2", http_server("example"))
            .unwrap_err();
        assert!(matches!(
            error,
            McpServerConfigurationStoreError::DuplicateName(_)
        ));
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn transport_fields_are_validated() {
        let store_path = temp_store();
        initialize(&store_path).unwrap();

        let mut missing_url = http_server("bad");
        missing_url.url = None;
        assert!(matches!(
            insert_mcp_server_configuration(&store_path, "id-1", missing_url).unwrap_err(),
            McpServerConfigurationStoreError::InvalidInput(_)
        ));

        let mut bad_transport = http_server("bad");
        bad_transport.transport = "websocket".to_string();
        assert!(matches!(
            insert_mcp_server_configuration(&store_path, "id-2", bad_transport).unwrap_err(),
            McpServerConfigurationStoreError::InvalidInput(_)
        ));

        let stdio = NewMcpServerConfiguration {
            name: "local".to_string(),
            enabled: true,
            transport: MCP_TRANSPORT_STDIO.to_string(),
            command: Some("npx".to_string()),
            args: vec!["-y".to_string(), "some-mcp".to_string()],
            env: BTreeMap::from([("TOKEN".to_string(), "${TOKEN}".to_string())]),
            url: None,
            headers: BTreeMap::new(),
            library_id: None,
        };
        let record = insert_mcp_server_configuration(&store_path, "id-3", stdio).unwrap();
        assert_eq!(record.command.as_deref(), Some("npx"));
        assert!(record.url.is_none());
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
