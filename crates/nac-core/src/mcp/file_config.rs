//! CRUD over the `[mcp_servers.*]` tables in `config.toml`.
//!
//! The dashboard edits the same file a user edits by hand, so writes go
//! through `toml_edit` and leave every other line — comments, formatting,
//! unrelated sections — untouched. Servers are keyed by name; there is no
//! separate identifier.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use fs2::FileExt;
use toml_edit::{DocumentMut, InlineTable, Item, Table};

use super::*;

pub const MCP_TRANSPORT_STDIO: &str = "stdio";
pub const MCP_TRANSPORT_STREAMABLE_HTTP: &str = "streamable_http";

/// A named MCP server as `config.toml` defines it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct McpServerConfigurationRecord {
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
            Self::NotFound(name) => write!(formatter, "MCP server '{name}' was not found"),
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

pub struct McpConfigurationWriteLease {
    file: File,
}

impl Drop for McpConfigurationWriteLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

/// Cross-process serialization for the dashboard's whole-document edits.
pub fn acquire_mcp_configuration_write_lease(
    path: &Path,
) -> ConfigurationResult<McpConfigurationWriteLease> {
    let parent = path.parent().ok_or_else(|| {
        McpServerConfigurationStoreError::Store(anyhow!("config path has no parent"))
    })?;
    std::fs::create_dir_all(parent).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to create config directory: {error}"
        ))
    })?;
    let lock_path = path.with_extension("toml.lock");
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let file = options.open(&lock_path).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!("failed to open config lock: {error}"))
    })?;
    file.lock_exclusive().map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!("failed to lock config: {error}"))
    })?;
    Ok(McpConfigurationWriteLease { file })
}

/// The `config.toml` the dashboard edits: the same file every session parses
/// when a worker launches. Resolved through a `PathContext` so a relative
/// `NAC_HOME`/`XDG_CONFIG_HOME` lands on the same file the registry reads.
pub fn mcp_config_path(cwd: &Path) -> Option<PathBuf> {
    crate::paths::PathContext::new(cwd).nac_config_path()
}

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

/// Checks the fields an entry must carry and settles the optional ones, so
/// insert and update reject the same input for the same reason.
fn validated_record(
    configuration: McpServerConfigurationRecord,
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
    })
}

fn read_document(path: &Path) -> ConfigurationResult<DocumentMut> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(McpServerConfigurationStoreError::Store(anyhow!(
                "failed to read {}: {error}",
                path.display()
            )))
        }
    };
    raw.parse().map_err(|error| {
        McpServerConfigurationStoreError::InvalidInput(format!(
            "{} is not valid TOML: {error}",
            path.display()
        ))
    })
}

/// Writes through a sibling temp file and a rename, so a crash mid-write
/// never leaves a truncated config behind. Header and env values may be
/// secrets, so both the unique temp and the final file are always `0600`.
fn write_document(path: &Path, document: &DocumentMut) -> ConfigurationResult<()> {
    let io_error = |error: std::io::Error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to write {}: {error}",
            path.display()
        ))
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    let temp = path.with_extension(format!("toml.{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let result: ConfigurationResult<()> = (|| {
        let mut file = options.open(&temp).map_err(io_error)?;
        file.write_all(document.to_string().as_bytes())
            .map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(io_error)?;
        }
        std::fs::rename(&temp, path).map_err(io_error)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result?;
    Ok(())
}

fn string_of(item: &Item) -> Option<String> {
    item.as_str().map(str::to_string)
}

fn strings_of(item: &Item) -> Vec<String> {
    item.as_array()
        .map(|array| {
            array
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn map_of(item: &Item) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    if let Some(table) = item.as_table_like() {
        for (key, value) in table.iter() {
            if let Some(value) = value.as_str() {
                map.insert(key.to_string(), value.to_string());
            }
        }
    }
    map
}

/// An entry as the file has it. Reads are lenient — a hand-written entry the
/// connect path would reject still shows up in the dashboard, where it can be
/// repaired — while writes validate.
fn record_of(name: &str, item: &Item) -> McpServerConfigurationRecord {
    let empty = Item::None;
    let field = |key: &str| -> &Item {
        item.as_table_like()
            .and_then(|table| table.get(key))
            .unwrap_or(&empty)
    };
    McpServerConfigurationRecord {
        name: name.to_string(),
        enabled: field("enabled").as_bool().unwrap_or(true),
        transport: string_of(field("transport")).unwrap_or_default(),
        command: string_of(field("command")),
        args: strings_of(field("args")),
        env: map_of(field("env")),
        url: string_of(field("url")),
        headers: map_of(field("headers")),
        library_id: string_of(field("library_id")),
    }
}

fn inline_map(values: &BTreeMap<String, String>) -> InlineTable {
    let mut table = InlineTable::new();
    for (key, value) in values {
        table.insert(key, value.as_str().into());
    }
    table
}

fn table_of(record: &McpServerConfigurationRecord) -> Table {
    let mut table = Table::new();
    if !record.enabled {
        table["enabled"] = toml_edit::value(false);
    }
    table["transport"] = toml_edit::value(record.transport.as_str());
    match record.transport.as_str() {
        MCP_TRANSPORT_STDIO => {
            if let Some(command) = &record.command {
                table["command"] = toml_edit::value(command.as_str());
            }
            if !record.args.is_empty() {
                let mut args = toml_edit::Array::new();
                for arg in &record.args {
                    args.push(arg.as_str());
                }
                table["args"] = toml_edit::value(args);
            }
            if !record.env.is_empty() {
                table["env"] = toml_edit::value(inline_map(&record.env));
            }
        }
        _ => {
            if let Some(url) = &record.url {
                table["url"] = toml_edit::value(url.as_str());
            }
            if !record.headers.is_empty() {
                table["headers"] = toml_edit::value(inline_map(&record.headers));
            }
        }
    }
    if let Some(library_id) = &record.library_id {
        table["library_id"] = toml_edit::value(library_id.as_str());
    }
    table
}

/// A hand-written `mcp_servers = { ... }` inline table is converted to a
/// standard table so its entries survive the edit; anything else non-table
/// under the key is rejected rather than silently overwritten.
fn servers_table(document: &mut DocumentMut) -> ConfigurationResult<&mut Table> {
    let item = document
        .as_table_mut()
        .entry("mcp_servers")
        .or_insert(Item::Table(Table::new()));
    if item.as_table_mut().is_none() {
        let inline = item
            .as_value()
            .and_then(|value| value.as_inline_table())
            .cloned()
            .ok_or_else(|| {
                McpServerConfigurationStoreError::InvalidInput(
                    "'mcp_servers' in config.toml is not a table".to_string(),
                )
            })?;
        *item = Item::Table(inline.into_table());
    }
    let table = item.as_table_mut().expect("just ensured a table");
    table.set_implicit(true);
    Ok(table)
}

pub fn list_mcp_server_configurations(
    path: &Path,
) -> ConfigurationResult<Vec<McpServerConfigurationRecord>> {
    let document = read_document(path)?;
    let Some(servers) = document.get("mcp_servers").and_then(Item::as_table_like) else {
        return Ok(Vec::new());
    };
    Ok(servers
        .iter()
        .map(|(name, item)| record_of(name, item))
        .collect())
}

pub fn load_mcp_server_configuration(
    path: &Path,
    name: &str,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let document = read_document(path)?;
    document
        .get("mcp_servers")
        .and_then(Item::as_table_like)
        .and_then(|servers| servers.get(name))
        .map(|item| record_of(name, item))
        .ok_or_else(|| McpServerConfigurationStoreError::NotFound(name.to_string()))
}

pub fn insert_mcp_server_configuration(
    path: &Path,
    configuration: McpServerConfigurationRecord,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let record = validated_record(configuration)?;
    let mut document = read_document(path)?;
    let servers = servers_table(&mut document)?;
    if servers.contains_key(&record.name) {
        return Err(McpServerConfigurationStoreError::DuplicateName(
            record.name.clone(),
        ));
    }
    servers[record.name.as_str()] = Item::Table(table_of(&record));
    write_document(path, &document)?;
    Ok(record)
}

/// Replaces the whole entry under `name`; a different name in the
/// configuration renames it.
pub fn update_mcp_server_configuration(
    path: &Path,
    name: &str,
    configuration: McpServerConfigurationRecord,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let record = validated_record(configuration)?;
    let mut document = read_document(path)?;
    let servers = servers_table(&mut document)?;
    if !servers.contains_key(name) {
        return Err(McpServerConfigurationStoreError::NotFound(name.to_string()));
    }
    if record.name != name && servers.contains_key(&record.name) {
        return Err(McpServerConfigurationStoreError::DuplicateName(
            record.name.clone(),
        ));
    }
    if record.name != name {
        servers.remove(name);
    }
    servers[record.name.as_str()] = Item::Table(table_of(&record));
    write_document(path, &document)?;
    Ok(record)
}

/// Returns whether a configuration was actually removed.
pub fn delete_mcp_server_configuration(path: &Path, name: &str) -> ConfigurationResult<bool> {
    let mut document = read_document(path)?;
    let servers = servers_table(&mut document)?;
    if servers.remove(name).is_none() {
        return Ok(false);
    }
    write_document(path, &document)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config() -> PathBuf {
        crate::mcp::test_support::unique_temp_dir("nac-mcp-file-config").join("config.toml")
    }

    fn http_server(name: &str) -> McpServerConfigurationRecord {
        McpServerConfigurationRecord {
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
        let path = temp_config();

        let created = insert_mcp_server_configuration(&path, http_server("example")).unwrap();
        assert_eq!(created.name, "example");
        assert_eq!(created.url.as_deref(), Some("https://mcp.example.com/mcp"));
        assert!(created.enabled);

        let listed = list_mcp_server_configurations(&path).unwrap();
        assert_eq!(listed, vec![created.clone()]);

        let mut edited = http_server("renamed");
        edited.enabled = false;
        let updated = update_mcp_server_configuration(&path, "example", edited).unwrap();
        assert_eq!(updated.name, "renamed");
        assert!(!updated.enabled);
        assert_eq!(
            load_mcp_server_configuration(&path, "renamed").unwrap(),
            updated
        );

        assert!(delete_mcp_server_configuration(&path, "renamed").unwrap());
        assert!(list_mcp_server_configurations(&path).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn saves_create_and_repair_private_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_config();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        insert_mcp_server_configuration(&path, http_server("example")).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        update_mcp_server_configuration(&path, "example", http_server("example")).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().contains(".tmp")));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn mcp_config_process_helper() {
        let Some(path) = std::env::var_os("NAC_TEST_MCP_CONFIG_PATH") else {
            return;
        };
        let name = std::env::var("NAC_TEST_MCP_CONFIG_NAME").unwrap();
        let path = PathBuf::from(path);
        let _lease = acquire_mcp_configuration_write_lease(&path).unwrap();
        insert_mcp_server_configuration(&path, http_server(&name)).unwrap();
    }

    #[test]
    fn cross_process_writers_preserve_both_whole_document_updates() {
        // Spawning the test binary inherits the process environment. Keep it
        // from racing tests that temporarily redirect NAC_HOME or MCP config.
        let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
        let path = temp_config();
        let executable = std::env::current_exe().unwrap();
        let spawn = |name: &str| {
            std::process::Command::new(&executable)
                .args([
                    "--exact",
                    "mcp::file_config::tests::mcp_config_process_helper",
                    "--nocapture",
                ])
                .env("NAC_TEST_MCP_CONFIG_PATH", &path)
                .env("NAC_TEST_MCP_CONFIG_NAME", name)
                .spawn()
                .unwrap()
        };
        let mut first = spawn("first");
        let mut second = spawn("second");
        assert!(first.wait().unwrap().success());
        assert!(second.wait().unwrap().success());
        let names = list_mcp_server_configurations(&path)
            .unwrap()
            .into_iter()
            .map(|record| record.name)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(names, ["first".to_string(), "second".to_string()].into());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn saved_entries_parse_as_registry_config_and_the_rest_of_the_file_survives() {
        let path = temp_config();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "# hand-written\nmodel = \"gpt\"\n\n[mcp_servers.existing]\ntransport = \"stdio\"\ncommand = \"npx\" # keep me\n",
        )
        .unwrap();

        let stdio = McpServerConfigurationRecord {
            name: "local".to_string(),
            enabled: false,
            transport: MCP_TRANSPORT_STDIO.to_string(),
            command: Some("npx".to_string()),
            args: vec!["-y".to_string(), "some-mcp".to_string()],
            env: BTreeMap::from([("TOKEN".to_string(), "${TOKEN}".to_string())]),
            url: None,
            headers: BTreeMap::new(),
            library_id: None,
        };
        insert_mcp_server_configuration(&path, stdio).unwrap();
        insert_mcp_server_configuration(&path, http_server("example")).unwrap();

        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("# hand-written"));
        assert!(raw.contains("model = \"gpt\""));
        assert!(raw.contains("# keep me"));

        // The connect path parses the same file with the strict typed config.
        let parsed: super::config::McpConfigFile = toml::from_str(&raw).unwrap();
        assert_eq!(parsed.mcp_servers.len(), 3);
        let local = &parsed.mcp_servers["local"];
        assert!(!local.enabled);
        assert!(matches!(
            &local.transport,
            McpTransportConfig::Stdio { command, args, env }
                if command == "npx" && args.len() == 2 && env["TOKEN"] == "${TOKEN}"
        ));
        let example = &parsed.mcp_servers["example"];
        assert!(matches!(
            &example.transport,
            McpTransportConfig::StreamableHttp { url, headers }
                if url == "https://mcp.example.com/mcp"
                    && headers["Authorization"] == "Bearer secret-token"
        ));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_inline_mcp_servers_table_survives_a_save() {
        let path = temp_config();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "mcp_servers = { existing = { transport = \"stdio\", command = \"npx\" } }\n",
        )
        .unwrap();

        insert_mcp_server_configuration(&path, http_server("example")).unwrap();

        let names: Vec<String> = list_mcp_server_configurations(&path)
            .unwrap()
            .into_iter()
            .map(|record| record.name)
            .collect();
        assert_eq!(names, vec!["existing".to_string(), "example".to_string()]);

        std::fs::write(&path, "mcp_servers = \"not a table\"\n").unwrap();
        assert!(matches!(
            insert_mcp_server_configuration(&path, http_server("example")).unwrap_err(),
            McpServerConfigurationStoreError::InvalidInput(_)
        ));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let path = temp_config();

        insert_mcp_server_configuration(&path, http_server("example")).unwrap();
        assert!(matches!(
            insert_mcp_server_configuration(&path, http_server("example")).unwrap_err(),
            McpServerConfigurationStoreError::DuplicateName(_)
        ));

        insert_mcp_server_configuration(&path, http_server("other")).unwrap();
        assert!(matches!(
            update_mcp_server_configuration(&path, "other", http_server("example")).unwrap_err(),
            McpServerConfigurationStoreError::DuplicateName(_)
        ));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transport_fields_are_validated() {
        let path = temp_config();

        let mut missing_url = http_server("bad");
        missing_url.url = None;
        assert!(matches!(
            insert_mcp_server_configuration(&path, missing_url).unwrap_err(),
            McpServerConfigurationStoreError::InvalidInput(_)
        ));

        let mut bad_transport = http_server("bad");
        bad_transport.transport = "websocket".to_string();
        assert!(matches!(
            insert_mcp_server_configuration(&path, bad_transport).unwrap_err(),
            McpServerConfigurationStoreError::InvalidInput(_)
        ));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn missing_entries_report_not_found() {
        let path = temp_config();
        assert!(matches!(
            load_mcp_server_configuration(&path, "ghost").unwrap_err(),
            McpServerConfigurationStoreError::NotFound(_)
        ));
        assert!(matches!(
            update_mcp_server_configuration(&path, "ghost", http_server("ghost")).unwrap_err(),
            McpServerConfigurationStoreError::NotFound(_)
        ));
        assert!(!delete_mcp_server_configuration(&path, "ghost").unwrap());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
