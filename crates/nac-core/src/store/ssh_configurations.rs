use super::*;

/// A named, reusable SSH connection offered by the launch modal.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SshConfigurationRecord {
    pub config_id: String,
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSshConfiguration {
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
}

#[derive(Debug)]
pub enum SshConfigurationStoreError {
    InvalidInput(String),
    DuplicateName(String),
    NotFound(String),
    Store(anyhow::Error),
}

impl std::fmt::Display for SshConfigurationStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::DuplicateName(name) => {
                write!(formatter, "a configuration named '{name}' already exists")
            }
            Self::NotFound(id) => write!(formatter, "configuration '{id}' was not found"),
            Self::Store(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for SshConfigurationStoreError {}

impl From<anyhow::Error> for SshConfigurationStoreError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

type ConfigurationResult<T> = std::result::Result<T, SshConfigurationStoreError>;

/// Longest accepted display name. Names are shown in a dropdown, so a runaway
/// paste is rejected rather than truncated.
const MAX_NAME_LEN: usize = 120;

fn nonblank(value: &str, field: &str) -> ConfigurationResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(SshConfigurationStoreError::InvalidInput(format!(
            "{field} must not be blank"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_name(name: &str) -> ConfigurationResult<String> {
    let name = nonblank(name, "configuration name")?;
    if name.chars().count() > MAX_NAME_LEN {
        return Err(SshConfigurationStoreError::InvalidInput(format!(
            "configuration name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

fn validate_port(port: Option<u16>) -> ConfigurationResult<Option<u16>> {
    match port {
        None => Ok(None),
        Some(0) => Err(SshConfigurationStoreError::InvalidInput(
            "ssh_port must be between 1 and 65535".to_string(),
        )),
        Some(value) => Ok(Some(value)),
    }
}

fn optional_path(value: Option<String>) -> Option<String> {
    value
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::ConstraintViolation)
    )
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SshConfigurationRecord> {
    Ok(SshConfigurationRecord {
        config_id: row.get(0)?,
        name: row.get(1)?,
        ssh_host: row.get(2)?,
        ssh_port: row.get(3)?,
        ssh_identity_file: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const SELECT_COLUMNS: &str =
    "config_id, name, ssh_host, ssh_port, ssh_identity_file, created_at, updated_at";

pub fn list_ssh_configurations(path: &Path) -> ConfigurationResult<Vec<SshConfigurationRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM ssh_configurations ORDER BY created_at, name"
        ))
        .map_err(|error| SshConfigurationStoreError::Store(error.into()))?;
    let records = statement
        .query_map([], row_to_record)
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|error| SshConfigurationStoreError::Store(error.into()))?;
    Ok(records)
}

pub fn load_ssh_configuration(
    path: &Path,
    config_id: &str,
) -> ConfigurationResult<SshConfigurationRecord> {
    let conn = open_runtime_connection(path)?;
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM ssh_configurations WHERE config_id = ?1"),
        params![config_id],
        row_to_record,
    )
    .optional()
    .map_err(|error| SshConfigurationStoreError::Store(error.into()))?
    .ok_or_else(|| SshConfigurationStoreError::NotFound(config_id.to_string()))
}

/// Checks the fields a row must carry and settles the optional ones, so insert
/// and update reject the same input for the same reason.
fn validated_record(
    config_id: &str,
    configuration: NewSshConfiguration,
    created_at: String,
) -> ConfigurationResult<SshConfigurationRecord> {
    Ok(SshConfigurationRecord {
        config_id: nonblank(config_id, "configuration id")?,
        name: validate_name(&configuration.name)?,
        ssh_host: nonblank(&configuration.ssh_host, "ssh_host")?,
        ssh_port: validate_port(configuration.ssh_port)?,
        ssh_identity_file: optional_path(configuration.ssh_identity_file),
        created_at,
        updated_at: now_utc(),
    })
}

pub fn insert_ssh_configuration(
    path: &Path,
    config_id: &str,
    configuration: NewSshConfiguration,
) -> ConfigurationResult<SshConfigurationRecord> {
    let record = validated_record(config_id, configuration, now_utc())?;

    let conn = open_runtime_connection(path)?;
    conn.execute(
        "INSERT INTO ssh_configurations
         (config_id, name, ssh_host, ssh_port, ssh_identity_file, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.config_id,
            record.name,
            record.ssh_host,
            record.ssh_port,
            record.ssh_identity_file,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|error| {
        if is_unique_violation(&error) {
            SshConfigurationStoreError::DuplicateName(record.name.clone())
        } else {
            SshConfigurationStoreError::Store(error.into())
        }
    })?;

    Ok(record)
}

/// Replaces every stored field of an existing configuration.
///
/// The caller passes a whole configuration rather than a patch: it has already
/// read the row to decide what a partial request leaves alone.
/// `created_at` survives, because the identity of the setup does not change.
pub fn update_ssh_configuration(
    path: &Path,
    config_id: &str,
    configuration: NewSshConfiguration,
) -> ConfigurationResult<SshConfigurationRecord> {
    let existing = load_ssh_configuration(path, config_id)?;
    let record = validated_record(config_id, configuration, existing.created_at)?;

    let conn = open_runtime_connection(path)?;
    let updated = conn
        .execute(
            "UPDATE ssh_configurations
             SET name = ?2, ssh_host = ?3, ssh_port = ?4, ssh_identity_file = ?5,
                 updated_at = ?6
             WHERE config_id = ?1",
            params![
                record.config_id,
                record.name,
                record.ssh_host,
                record.ssh_port,
                record.ssh_identity_file,
                record.updated_at,
            ],
        )
        .map_err(|error| {
            if is_unique_violation(&error) {
                SshConfigurationStoreError::DuplicateName(record.name.clone())
            } else {
                SshConfigurationStoreError::Store(error.into())
            }
        })?;
    if updated == 0 {
        return Err(SshConfigurationStoreError::NotFound(config_id.to_string()));
    }

    Ok(record)
}

/// Returns whether a configuration was actually removed.
pub fn delete_ssh_configuration(path: &Path, config_id: &str) -> ConfigurationResult<bool> {
    let conn = open_runtime_connection(path)?;
    let removed = conn
        .execute(
            "DELETE FROM ssh_configurations WHERE config_id = ?1",
            params![config_id],
        )
        .map_err(|error| SshConfigurationStoreError::Store(error.into()))?;
    Ok(removed > 0)
}
