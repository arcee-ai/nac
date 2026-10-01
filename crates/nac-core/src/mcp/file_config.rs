//! CRUD over the `[mcp_servers.*]` tables in `config.toml`.
//!
//! The dashboard edits the same file a user edits by hand, so writes go
//! through `toml_edit` and leave every other line — comments, formatting,
//! unrelated sections — untouched. Servers are keyed by name; there is no
//! separate identifier.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use sha2::{Digest, Sha256};
use toml_edit::{DocumentMut, InlineTable, Item, Table};

use super::*;

pub const MCP_TRANSPORT_STDIO: &str = "stdio";
pub const MCP_TRANSPORT_STREAMABLE_HTTP: &str = "streamable_http";

/// A named MCP server as `config.toml` defines it.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct McpServerConfigurationRecord {
    pub name: String,
    pub enabled: bool,
    pub required: bool,
    pub startup_timeout_ms: Option<u64>,
    pub catalog_timeout_ms: Option<u64>,
    pub execution_timeout_ms: Option<u64>,
    pub protocol: McpProtocolSelection,
    /// `stdio` or `streamable_http`.
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub env_vars: Vec<String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub env_headers: BTreeMap<String, String>,
    pub bearer_token_env_var: Option<String>,
    pub header_helper: Option<McpHeaderHelperConfig>,
    /// Library catalog entry this server was created from, when it was.
    pub library_id: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub denied_tools: Vec<String>,
    pub approval: McpToolApproval,
    pub tool_approvals: BTreeMap<String, McpToolApproval>,
}

#[derive(Debug)]
pub enum McpServerConfigurationStoreError {
    InvalidInput(String),
    DuplicateName(String),
    NotFound(String),
    ConcurrentModification,
    RecoveryRequired { config: PathBuf, preserved: PathBuf },
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
            Self::ConcurrentModification => formatter.write_str(
                "config.toml changed while the MCP update was being prepared; retry the update",
            ),
            Self::RecoveryRequired { config, preserved } => write!(
                formatter,
                "config.toml changed at the publication boundary; NAC preserved canonical {} and displaced {} and will not read the config until an operator either removes the preserved file to keep the canonical document, or atomically saves different intended complete content at the canonical path; re-saving byte-identical canonical content remains intentionally ambiguous",
                config.display(),
                preserved.display()
            ),
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
    let lease = McpConfigurationWriteLease { file };
    recover_pending_transaction_locked(path)?;
    Ok(lease)
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct PublicationTransaction {
    version: u8,
    expected_revision: [u8; 32],
    #[serde(default)]
    expected_identity: Option<FileIdentity>,
    candidate_revision: [u8; 32],
    #[serde(default)]
    candidate_identity: Option<FileIdentity>,
    temp_name: String,
    phase: PublicationPhase,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum PublicationPhase {
    Prepared,
    Conflict {
        displaced_revision: [u8; 32],
        #[serde(default)]
        displaced_identity: Option<FileIdentity>,
    },
}

const PUBLICATION_TRANSACTION_VERSION: u8 = 1;

fn transaction_path(path: &Path) -> PathBuf {
    path.with_extension("toml.nac-txn")
}

pub(super) fn mcp_configuration_state_exists(path: &Path) -> bool {
    path.exists() || transaction_path(path).exists()
}

fn open_private_new(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    options.open(path)
}

fn read_transaction(path: &Path) -> ConfigurationResult<Option<PublicationTransaction>> {
    let marker = transaction_path(path);
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let file = match options.open(&marker) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(McpServerConfigurationStoreError::Store(anyhow!(
                "failed to open MCP publication journal {}: {error}",
                marker.display()
            )))
        }
    };
    let transaction: PublicationTransaction = serde_json::from_reader(file).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "MCP publication journal {} is invalid; preserve it and the config for recovery: {error}",
            marker.display()
        ))
    })?;
    if transaction.version != PUBLICATION_TRANSACTION_VERSION {
        return Err(McpServerConfigurationStoreError::Store(anyhow!(
            "MCP publication journal {} has unsupported version {}; preserve it and the config for recovery",
            marker.display(),
            transaction.version
        )));
    }
    Ok(Some(transaction))
}

fn transaction_temp_path(
    path: &Path,
    transaction: &PublicationTransaction,
) -> ConfigurationResult<PathBuf> {
    let name = Path::new(&transaction.temp_name);
    if name.components().count() != 1 || name.file_name().is_none() {
        return Err(McpServerConfigurationStoreError::Store(anyhow!(
            "MCP publication journal for {} contains an unsafe temp name",
            path.display()
        )));
    }
    let expected_prefix = format!(
        "{}.",
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| McpServerConfigurationStoreError::Store(anyhow!(
                "config path has a non-UTF-8 file name"
            )))?
    );
    if !transaction.temp_name.starts_with(&expected_prefix)
        || !transaction.temp_name.ends_with(".tmp")
    {
        return Err(McpServerConfigurationStoreError::Store(anyhow!(
            "MCP publication journal for {} does not reference a NAC temp file",
            path.display()
        )));
    }
    Ok(path.parent().unwrap_or_else(|| Path::new(".")).join(name))
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
    let (command, cwd, url, bearer_token_env_var, header_helper) = match transport.as_str() {
        MCP_TRANSPORT_STDIO => (
            Some(nonblank(
                configuration.command.as_deref().unwrap_or(""),
                "command",
            )?),
            configuration
                .cwd
                .map(|value| nonblank(&value, "cwd"))
                .transpose()?,
            None,
            None,
            None,
        ),
        MCP_TRANSPORT_STREAMABLE_HTTP => (
            None,
            None,
            Some(nonblank(configuration.url.as_deref().unwrap_or(""), "url")?),
            configuration
                .bearer_token_env_var
                .map(|value| nonblank(&value, "bearer_token_env_var"))
                .transpose()?,
            configuration
                .header_helper
                .map(|mut helper| {
                    helper.command = nonblank(&helper.command, "header_helper.command")?;
                    helper.cwd = helper
                        .cwd
                        .map(|value| nonblank(&value, "header_helper.cwd"))
                        .transpose()?;
                    timeout_value(
                        helper.timeout_ms,
                        Duration::from_secs(5),
                        "header_helper.timeout_ms",
                    )?;
                    Ok::<_, McpServerConfigurationStoreError>(helper)
                })
                .transpose()?,
        ),
        other => {
            return Err(McpServerConfigurationStoreError::InvalidInput(format!(
                "transport must be '{MCP_TRANSPORT_STDIO}' or \
                 '{MCP_TRANSPORT_STREAMABLE_HTTP}', not '{other}'"
            )))
        }
    };
    for (value, field) in [
        (configuration.startup_timeout_ms, "startup_timeout_ms"),
        (configuration.catalog_timeout_ms, "catalog_timeout_ms"),
        (configuration.execution_timeout_ms, "execution_timeout_ms"),
    ] {
        timeout_value(value, Duration::from_secs(1), field)?;
    }
    Ok(McpServerConfigurationRecord {
        name: validate_name(&configuration.name)?,
        enabled: configuration.enabled,
        required: configuration.required,
        startup_timeout_ms: configuration.startup_timeout_ms,
        catalog_timeout_ms: configuration.catalog_timeout_ms,
        execution_timeout_ms: configuration.execution_timeout_ms,
        protocol: configuration.protocol,
        transport,
        command,
        args: configuration.args,
        env: configuration.env,
        env_vars: configuration.env_vars,
        cwd,
        url,
        headers: configuration.headers,
        env_headers: configuration.env_headers,
        bearer_token_env_var,
        header_helper,
        library_id: configuration
            .library_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty()),
        allowed_tools: configuration.allowed_tools,
        denied_tools: configuration.denied_tools,
        approval: configuration.approval,
        tool_approvals: configuration.tool_approvals,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
struct FileIdentity {
    device: u64,
    inode: u64,
    file_type: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DocumentRevision {
    digest: Option<[u8; 32]>,
    identity: Option<FileIdentity>,
}

impl DocumentRevision {
    const fn missing() -> Self {
        Self {
            digest: None,
            identity: None,
        }
    }

    const fn recorded(digest: [u8; 32], identity: Option<FileIdentity>) -> Self {
        Self {
            digest: Some(digest),
            identity,
        }
    }

    fn same_content(self, other: Self) -> bool {
        self.digest == other.digest
    }
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;
    #[cfg(target_os = "linux")]
    let file_type = metadata.mode() & libc::S_IFMT;
    #[cfg(not(target_os = "linux"))]
    let file_type = metadata.mode() & u32::from(libc::S_IFMT);
    FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        file_type,
    }
}

#[cfg(not(unix))]
fn file_identity(_metadata: &std::fs::Metadata) -> FileIdentity {
    FileIdentity {
        device: 0,
        inode: 0,
        file_type: 0,
    }
}

fn read_document_image(path: &Path) -> ConfigurationResult<Option<(Vec<u8>, DocumentRevision)>> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(McpServerConfigurationStoreError::Store(anyhow!(
                "failed to open {}: {error}",
                path.display()
            )))
        }
    };
    let metadata = file.metadata().map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to inspect {}: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(McpServerConfigurationStoreError::Store(anyhow!(
            "{} is not a regular file",
            path.display()
        )));
    }
    let identity = file_identity(&metadata);
    let mut raw = Vec::new();
    file.read_to_end(&mut raw).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to read {}: {error}",
            path.display()
        ))
    })?;
    let revision = DocumentRevision {
        digest: Some(Sha256::digest(&raw).into()),
        identity: Some(identity),
    };
    Ok(Some((raw, revision)))
}

fn read_document_snapshot(path: &Path) -> ConfigurationResult<(DocumentMut, DocumentRevision)> {
    let (raw, revision) = match read_document_image(path)? {
        Some((raw, revision)) => (
            String::from_utf8(raw).map_err(|error| {
                McpServerConfigurationStoreError::InvalidInput(format!(
                    "{} is not valid UTF-8: {error}",
                    path.display()
                ))
            })?,
            revision,
        ),
        None => (String::new(), DocumentRevision::missing()),
    };
    let document = parse_document(path, &raw)?;
    Ok((document, revision))
}

fn parse_document(path: &Path, raw: &str) -> ConfigurationResult<DocumentMut> {
    raw.parse().map_err(|error| {
        McpServerConfigurationStoreError::InvalidInput(format!(
            "{} is not valid TOML: {error}",
            path.display()
        ))
    })
}

fn current_document_revision(path: &Path) -> ConfigurationResult<DocumentRevision> {
    Ok(read_document_image(path)?
        .map(|(_, revision)| revision)
        .unwrap_or_else(DocumentRevision::missing))
}

#[cfg(unix)]
fn exchange_paths(left: &Path, right: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let left = CString::new(left.as_os_str().as_bytes())?;
    let right = CString::new(right.as_os_str().as_bytes())?;
    #[cfg(target_os = "linux")]
    // SAFETY: both paths are live NUL-terminated C strings and `AT_FDCWD`
    // makes them relative to the process cwd; `RENAME_EXCHANGE` is valid here.
    // Calling the kernel entry point keeps this available on musl, whose libc
    // bindings do not expose a `renameat2` wrapper.
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            left.as_ptr(),
            libc::AT_FDCWD,
            right.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    // SAFETY: both arguments are live NUL-terminated C strings and
    // `RENAME_SWAP` is the supported atomic-exchange flag on these targets.
    let result = unsafe { libc::renamex_np(left.as_ptr(), right.as_ptr(), libc::RENAME_SWAP) };
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "ios")))]
    let result = -1;
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn exchange_paths(_left: &Path, _right: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "atomic file exchange is unavailable on this platform",
    ))
}

fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    File::open(parent.unwrap_or_else(|| Path::new(".")))?.sync_all()
}

fn remove_file_if_present(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn persist_transaction(
    path: &Path,
    transaction: &PublicationTransaction,
) -> ConfigurationResult<()> {
    let marker = transaction_path(path);
    let staging = marker.with_extension(format!("nac-txn.{}.tmp", uuid::Uuid::new_v4()));
    let result: ConfigurationResult<()> = (|| {
        let mut file = open_private_new(&staging).map_err(|error| {
            McpServerConfigurationStoreError::Store(anyhow!(
                "failed to create MCP publication journal staging file: {error}"
            ))
        })?;
        let encoded = serde_json::to_vec(transaction).map_err(|error| {
            McpServerConfigurationStoreError::Store(anyhow!(
                "failed to encode MCP publication journal: {error}"
            ))
        })?;
        file.write_all(&encoded).map_err(|error| {
            McpServerConfigurationStoreError::Store(anyhow!(
                "failed to write MCP publication journal: {error}"
            ))
        })?;
        file.sync_all().map_err(|error| {
            McpServerConfigurationStoreError::Store(anyhow!(
                "failed to sync MCP publication journal: {error}"
            ))
        })?;
        std::fs::rename(&staging, &marker).map_err(|error| {
            McpServerConfigurationStoreError::Store(anyhow!(
                "failed to publish MCP publication journal: {error}"
            ))
        })?;
        sync_parent_directory(path).map_err(|error| {
            McpServerConfigurationStoreError::Store(anyhow!(
                "failed to sync MCP publication journal directory: {error}"
            ))
        })?;
        Ok(())
    })();
    if result.is_err() {
        let _ = remove_file_if_present(&staging);
    }
    result
}

fn clear_transaction(path: &Path) -> ConfigurationResult<()> {
    remove_file_if_present(&transaction_path(path)).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to remove MCP publication journal: {error}"
        ))
    })?;
    sync_parent_directory(path).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to sync MCP publication cleanup: {error}"
        ))
    })?;
    Ok(())
}

fn finish_transaction(path: &Path, temp: &Path) -> ConfigurationResult<()> {
    remove_file_if_present(temp).map_err(|error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to remove MCP publication temp: {error}"
        ))
    })?;
    clear_transaction(path)
}

fn unresolved_transaction_error(path: &Path, temp: &Path) -> McpServerConfigurationStoreError {
    McpServerConfigurationStoreError::RecoveryRequired {
        config: path.to_path_buf(),
        preserved: temp.to_path_buf(),
    }
}

fn recover_pending_transaction_locked(path: &Path) -> ConfigurationResult<()> {
    let Some(mut transaction) = read_transaction(path)? else {
        return Ok(());
    };
    let temp = transaction_temp_path(path, &transaction)?;
    let expected =
        DocumentRevision::recorded(transaction.expected_revision, transaction.expected_identity);
    let candidate = DocumentRevision::recorded(
        transaction.candidate_revision,
        transaction.candidate_identity,
    );
    let current = current_document_revision(path)?;
    let temp_revision = current_document_revision(&temp)?;

    match transaction.phase {
        PublicationPhase::Prepared => {
            if current == candidate && temp_revision == expected {
                // The exchange validated successfully before the crash.
                return finish_transaction(path, &temp);
            }
            if current == candidate {
                let Some(payload_revision) = temp_revision.digest else {
                    // Candidate is canonical and its displaced expected file
                    // was already removed, so commit cleanup had completed.
                    return clear_transaction(path);
                };
                transaction.phase = PublicationPhase::Conflict {
                    displaced_revision: payload_revision,
                    displaced_identity: temp_revision.identity,
                };
                persist_transaction(path, &transaction)?;
                return Err(unresolved_transaction_error(path, &temp));
            }
            if transaction.candidate_identity.is_none() && current.same_content(candidate) {
                // Version-one journals written before file identity was
                // recorded cannot prove that the canonical inode is the
                // published candidate. Convert them to an explicit conflict
                // instead of accepting a content-only match; the normal
                // operator recovery choices then remain available.
                let Some(payload_revision) = temp_revision.digest else {
                    return clear_transaction(path);
                };
                transaction.phase = PublicationPhase::Conflict {
                    displaced_revision: payload_revision,
                    displaced_identity: temp_revision.identity,
                };
                persist_transaction(path, &transaction)?;
                return Err(unresolved_transaction_error(path, &temp));
            }
            if temp_revision == candidate || temp_revision == expected {
                // Publication did not happen, rollback completed, or a valid
                // publication was followed by a later editor save. In all
                // three cases the canonical path is authoritative.
                return finish_transaction(path, &temp);
            }
            if transaction.candidate_identity.is_none()
                && temp_revision.same_content(candidate)
                && !current.same_content(candidate)
            {
                // A legacy prepared journal with the candidate still in the
                // temp file did not publish. Keep the current canonical file.
                return finish_transaction(path, &temp);
            }
            if temp_revision == DocumentRevision::missing() {
                return clear_transaction(path);
            }
            Err(unresolved_transaction_error(path, &temp))
        }
        PublicationPhase::Conflict {
            displaced_revision,
            displaced_identity,
        } => {
            if temp_revision == DocumentRevision::missing() {
                // Removing the preserved conflict file explicitly chooses the
                // current canonical document.
                return clear_transaction(path);
            }
            let displaced = DocumentRevision::recorded(displaced_revision, displaced_identity);
            let preserved_matches = if displaced_identity.is_some() {
                temp_revision == displaced
            } else {
                // Journals written before file identity was recorded cannot
                // prove which inode is preserved. Retain their fail-closed
                // conflict state, but allow the documented explicit recovery
                // action once the operator atomically saves distinct complete
                // canonical content.
                temp_revision.same_content(displaced)
            };
            if !preserved_matches {
                return Err(unresolved_transaction_error(path, &temp));
            }
            if !current.same_content(candidate) && !current.same_content(displaced) {
                // There is no automatic rollback in this protocol, so any
                // canonical value distinct from both ambiguous byte images
                // was written after the conflict and is an explicit
                // resolution. Preserve it.
                return finish_transaction(path, &temp);
            }
            Err(unresolved_transaction_error(path, &temp))
        }
    }
}

/// Reads the ambient user-editable config under the same cross-process lock as
/// dashboard publication. Pending crash state is recovered before bytes are
/// exposed, so NAC startup, registry loading, and dashboard reads never retain
/// an unvalidated exchange candidate.
pub fn read_mcp_configuration_consistently(path: &Path) -> ConfigurationResult<String> {
    let _lease = acquire_mcp_configuration_write_lease(path)?;
    match read_document_image(path)? {
        Some((raw, _)) => String::from_utf8(raw).map_err(|error| {
            McpServerConfigurationStoreError::InvalidInput(format!(
                "{} is not valid UTF-8: {error}",
                path.display()
            ))
        }),
        None => Ok(String::new()),
    }
}

/// Reads only the global `[mcp]` defaults without requiring every server entry
/// to deserialize. Dashboard draft probes use this so their inherited budgets
/// match worker admission while preserving tolerant CRUD for unrelated rows.
pub fn load_mcp_defaults(path: &Path) -> ConfigurationResult<McpDefaults> {
    #[derive(Default, serde::Deserialize)]
    struct DefaultsOnly {
        #[serde(default)]
        mcp: McpDefaults,
    }

    let raw = read_mcp_configuration_consistently(path)?;
    toml::from_str::<DefaultsOnly>(&raw)
        .map(|config| config.mcp)
        .map_err(|error| {
            McpServerConfigurationStoreError::InvalidInput(format!(
                "failed to parse global MCP defaults: {error}"
            ))
        })
}

#[cfg(test)]
thread_local! {
    static BEFORE_EXCHANGE_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static AFTER_EXCHANGE_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn run_exchange_test_hook(
    hook: &'static std::thread::LocalKey<std::cell::RefCell<Option<Box<dyn FnOnce()>>>>,
) {
    if let Some(callback) = hook.with(|slot| slot.borrow_mut().take()) {
        callback();
    }
}

/// Publishes complete file images and detects a noncooperating editor at the
/// exchange boundary. Existing files use a recoverable exchange transaction;
/// the kernel has no content-conditioned rename, so any ambiguous exchange
/// race preserves both files and blocks NAC readers. First creation uses the
/// stricter hard-link create-if-absent primitive.
fn publish_if_revision(
    path: &Path,
    temp: &Path,
    expected_revision: &DocumentRevision,
) -> ConfigurationResult<()> {
    match expected_revision.digest {
        None => match std::fs::hard_link(temp, path) {
            Ok(()) => {
                std::fs::remove_file(temp)
                    .map_err(|error| McpServerConfigurationStoreError::Store(anyhow!(error)))?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(McpServerConfigurationStoreError::ConcurrentModification);
            }
            Err(error) => {
                return Err(McpServerConfigurationStoreError::Store(anyhow!(error)));
            }
        },
        Some(expected_revision_bytes) => {
            // Reject the ordinary stale case before publication. A writer can
            // still race the final check because the kernel exchange has no
            // content predicate; the journal makes that state recoverable.
            if current_document_revision(path)? != *expected_revision {
                return Err(McpServerConfigurationStoreError::ConcurrentModification);
            }
            let candidate_revision = current_document_revision(temp)?;
            let candidate_revision_bytes = candidate_revision.digest.ok_or_else(|| {
                McpServerConfigurationStoreError::Store(anyhow!(
                    "MCP publication candidate disappeared before exchange"
                ))
            })?;
            let temp_name = temp
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| {
                    McpServerConfigurationStoreError::Store(anyhow!(
                        "MCP publication temp has a non-UTF-8 file name"
                    ))
                })?
                .to_string();
            let mut transaction = PublicationTransaction {
                version: PUBLICATION_TRANSACTION_VERSION,
                expected_revision: expected_revision_bytes,
                expected_identity: expected_revision.identity,
                candidate_revision: candidate_revision_bytes,
                candidate_identity: candidate_revision.identity,
                temp_name,
                phase: PublicationPhase::Prepared,
            };
            persist_transaction(path, &transaction)?;
            #[cfg(test)]
            run_exchange_test_hook(&BEFORE_EXCHANGE_HOOK);
            exchange_paths(temp, path).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    McpServerConfigurationStoreError::ConcurrentModification
                } else {
                    McpServerConfigurationStoreError::Store(anyhow!(error))
                }
            })?;
            sync_parent_directory(path).map_err(|error| {
                McpServerConfigurationStoreError::Store(anyhow!(
                    "failed to sync MCP publication exchange: {error}"
                ))
            })?;
            #[cfg(test)]
            run_exchange_test_hook(&AFTER_EXCHANGE_HOOK);
            let published_revision = current_document_revision(path)?;
            let displaced_revision = current_document_revision(temp)?;
            if published_revision != candidate_revision || displaced_revision != *expected_revision
            {
                let payload_revision = displaced_revision
                    .digest
                    .ok_or_else(|| unresolved_transaction_error(path, temp))?;
                transaction.phase = PublicationPhase::Conflict {
                    displaced_revision: payload_revision,
                    displaced_identity: displaced_revision.identity,
                };
                persist_transaction(path, &transaction)?;
                return Err(unresolved_transaction_error(path, temp));
            }
            finish_transaction(path, temp)?;
        }
    }
    sync_parent_directory(path)
        .map_err(|error| McpServerConfigurationStoreError::Store(anyhow!(error)))?;
    Ok(())
}

/// Writes through a sibling temp file and a rename, so a crash mid-write
/// never leaves a truncated config behind. Header and env values may be
/// secrets, so both the unique temp and the final file are always `0600`.
fn write_document(
    path: &Path,
    document: &DocumentMut,
    expected_revision: DocumentRevision,
) -> ConfigurationResult<()> {
    let io_error = |error: std::io::Error| {
        McpServerConfigurationStoreError::Store(anyhow!(
            "failed to write {}: {error}",
            path.display()
        ))
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    recover_pending_transaction_locked(path)?;
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
        publish_if_revision(path, &temp, &expected_revision)?;
        Ok(())
    })();
    if result.is_err() && !transaction_path(path).exists() {
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

fn integer_of(item: &Item) -> Option<u64> {
    item.as_integer()
        .and_then(|value| u64::try_from(value).ok())
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

fn approval_of(item: &Item) -> McpToolApproval {
    match item.as_str() {
        Some("allow") => McpToolApproval::Allow,
        _ => McpToolApproval::Ask,
    }
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
        required: field("required").as_bool().unwrap_or(false),
        startup_timeout_ms: integer_of(field("startup_timeout_ms")),
        catalog_timeout_ms: integer_of(field("catalog_timeout_ms")),
        execution_timeout_ms: integer_of(field("execution_timeout_ms")),
        protocol: match field("protocol").as_str() {
            Some("auto") => McpProtocolSelection::Auto,
            Some("current") => McpProtocolSelection::Current,
            _ => McpProtocolSelection::Legacy,
        },
        transport: string_of(field("transport")).unwrap_or_default(),
        command: string_of(field("command")),
        args: strings_of(field("args")),
        env: map_of(field("env")),
        env_vars: strings_of(field("env_vars")),
        cwd: string_of(field("cwd")),
        url: string_of(field("url")),
        headers: map_of(field("headers")),
        env_headers: map_of(field("env_headers")),
        bearer_token_env_var: string_of(field("bearer_token_env_var")),
        header_helper: header_helper_of(field("header_helper")),
        library_id: string_of(field("library_id")),
        allowed_tools: item
            .as_table_like()
            .is_some_and(|table| table.contains_key("allowed_tools"))
            .then(|| strings_of(field("allowed_tools"))),
        denied_tools: strings_of(field("denied_tools")),
        approval: approval_of(field("approval")),
        tool_approvals: approval_map_of(field("tool_approvals")),
    }
}

fn header_helper_of(item: &Item) -> Option<McpHeaderHelperConfig> {
    let table = item.as_table_like()?;
    let empty = Item::None;
    let item = |key: &str| table.get(key).unwrap_or(&empty);
    Some(McpHeaderHelperConfig {
        command: string_of(item("command")).unwrap_or_default(),
        args: strings_of(item("args")),
        cwd: string_of(item("cwd")),
        env: map_of(item("env")),
        env_vars: strings_of(item("env_vars")),
        timeout_ms: integer_of(item("timeout_ms")),
    })
}

fn approval_map_of(item: &Item) -> BTreeMap<String, McpToolApproval> {
    item.as_table_like()
        .map(|table| {
            table
                .iter()
                .filter_map(|(name, value)| {
                    value.as_str().and_then(|value| match value {
                        "allow" => Some((name.to_string(), McpToolApproval::Allow)),
                        "ask" => Some((name.to_string(), McpToolApproval::Ask)),
                        _ => None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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
    if record.required {
        table["required"] = toml_edit::value(true);
    }
    if record.protocol != McpProtocolSelection::default() {
        let value = match record.protocol {
            McpProtocolSelection::Legacy => "legacy",
            McpProtocolSelection::Auto => "auto",
            McpProtocolSelection::Current => "current",
        };
        table["protocol"] = toml_edit::value(value);
    }
    for (key, value) in [
        ("startup_timeout_ms", record.startup_timeout_ms),
        ("catalog_timeout_ms", record.catalog_timeout_ms),
        ("execution_timeout_ms", record.execution_timeout_ms),
    ] {
        if let Some(value) = value {
            table[key] = toml_edit::value(i64::try_from(value).unwrap_or(i64::MAX));
        }
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
            if !record.env_vars.is_empty() {
                table["env_vars"] = toml_edit::value(string_array(&record.env_vars));
            }
            if let Some(cwd) = &record.cwd {
                table["cwd"] = toml_edit::value(cwd.as_str());
            }
        }
        _ => {
            if let Some(url) = &record.url {
                table["url"] = toml_edit::value(url.as_str());
            }
            if !record.headers.is_empty() {
                table["headers"] = toml_edit::value(inline_map(&record.headers));
            }
            if !record.env_headers.is_empty() {
                table["env_headers"] = toml_edit::value(inline_map(&record.env_headers));
            }
            if let Some(variable) = &record.bearer_token_env_var {
                table["bearer_token_env_var"] = toml_edit::value(variable.as_str());
            }
            if let Some(helper) = &record.header_helper {
                table["header_helper"] = toml_edit::value(header_helper_table(helper));
            }
        }
    }
    if let Some(library_id) = &record.library_id {
        table["library_id"] = toml_edit::value(library_id.as_str());
    }
    if let Some(allowed_tools) = &record.allowed_tools {
        let mut values = toml_edit::Array::new();
        for tool in allowed_tools {
            values.push(tool.as_str());
        }
        table["allowed_tools"] = toml_edit::value(values);
    }
    if !record.denied_tools.is_empty() {
        let mut values = toml_edit::Array::new();
        for tool in &record.denied_tools {
            values.push(tool.as_str());
        }
        table["denied_tools"] = toml_edit::value(values);
    }
    if record.approval != McpToolApproval::default() {
        table["approval"] = toml_edit::value("allow");
    }
    if !record.tool_approvals.is_empty() {
        let mut values = InlineTable::new();
        for (name, approval) in &record.tool_approvals {
            let value = match approval {
                McpToolApproval::Allow => "allow",
                McpToolApproval::Ask => "ask",
            };
            values.insert(name, value.into());
        }
        table["tool_approvals"] = toml_edit::value(values);
    }
    table
}

fn string_array(values: &[String]) -> toml_edit::Array {
    let mut array = toml_edit::Array::new();
    for value in values {
        array.push(value.as_str());
    }
    array
}

fn header_helper_table(helper: &McpHeaderHelperConfig) -> InlineTable {
    let mut table = InlineTable::new();
    table.insert("command", helper.command.as_str().into());
    if !helper.args.is_empty() {
        table.insert("args", string_array(&helper.args).into());
    }
    if let Some(cwd) = &helper.cwd {
        table.insert("cwd", cwd.as_str().into());
    }
    if !helper.env.is_empty() {
        table.insert("env", inline_map(&helper.env).into());
    }
    if !helper.env_vars.is_empty() {
        table.insert("env_vars", string_array(&helper.env_vars).into());
    }
    if let Some(timeout_ms) = helper.timeout_ms {
        table.insert(
            "timeout_ms",
            i64::try_from(timeout_ms).unwrap_or(i64::MAX).into(),
        );
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
    let table = item.as_table_mut().ok_or_else(|| {
        McpServerConfigurationStoreError::InvalidInput(
            "'mcp_servers' in config.toml could not be normalized as a table".to_string(),
        )
    })?;
    table.set_implicit(true);
    Ok(table)
}

pub fn list_mcp_server_configurations(
    path: &Path,
) -> ConfigurationResult<Vec<McpServerConfigurationRecord>> {
    let raw = read_mcp_configuration_consistently(path)?;
    let document = parse_document(path, &raw)?;
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
    let raw = read_mcp_configuration_consistently(path)?;
    let document = parse_document(path, &raw)?;
    document
        .get("mcp_servers")
        .and_then(Item::as_table_like)
        .and_then(|servers| servers.get(name))
        .map(|item| record_of(name, item))
        .ok_or_else(|| McpServerConfigurationStoreError::NotFound(name.to_string()))
}

/// Loads one record together with the exact whole-document revision from
/// which its omitted-field values were derived.
pub fn load_mcp_server_configuration_snapshot(
    path: &Path,
    name: &str,
) -> ConfigurationResult<(McpServerConfigurationRecord, DocumentRevision)> {
    let (document, revision) = read_document_snapshot(path)?;
    let record = document
        .get("mcp_servers")
        .and_then(Item::as_table_like)
        .and_then(|servers| servers.get(name))
        .map(|item| record_of(name, item))
        .ok_or_else(|| McpServerConfigurationStoreError::NotFound(name.to_string()))?;
    Ok((record, revision))
}

pub fn insert_mcp_server_configuration(
    path: &Path,
    configuration: McpServerConfigurationRecord,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let record = validated_record(configuration)?;
    let (mut document, revision) = read_document_snapshot(path)?;
    let servers = servers_table(&mut document)?;
    if servers.contains_key(&record.name) {
        return Err(McpServerConfigurationStoreError::DuplicateName(
            record.name.clone(),
        ));
    }
    servers[record.name.as_str()] = Item::Table(table_of(&record));
    write_document(path, &document, revision)?;
    Ok(record)
}

/// Replaces the whole entry under `name`; a different name in the
/// configuration renames it.
pub fn update_mcp_server_configuration(
    path: &Path,
    name: &str,
    configuration: McpServerConfigurationRecord,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let (_, revision) = read_document_snapshot(path)?;
    update_mcp_server_configuration_at_revision(path, name, configuration, revision)
}

/// Replaces an entry only when the whole document is still the revision from
/// which the caller derived its patch. This prevents an API handler from
/// restoring omitted fields read before a noncooperating editor save.
pub fn update_mcp_server_configuration_at_revision(
    path: &Path,
    name: &str,
    configuration: McpServerConfigurationRecord,
    expected_revision: DocumentRevision,
) -> ConfigurationResult<McpServerConfigurationRecord> {
    let record = validated_record(configuration)?;
    let (mut document, revision) = read_document_snapshot(path)?;
    if revision != expected_revision {
        return Err(McpServerConfigurationStoreError::ConcurrentModification);
    }
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
    write_document(path, &document, expected_revision)?;
    Ok(record)
}

/// Returns whether a configuration was actually removed.
pub fn delete_mcp_server_configuration(path: &Path, name: &str) -> ConfigurationResult<bool> {
    let (mut document, revision) = read_document_snapshot(path)?;
    let servers = servers_table(&mut document)?;
    if servers.remove(name).is_none() {
        return Ok(false);
    }
    write_document(path, &document, revision)?;
    Ok(true)
}

#[cfg(test)]
mod policy_tests;

#[cfg(test)]
mod tests;
