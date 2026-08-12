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

configuration_store_error!(SshConfigurationStoreError);

type ConfigurationResult<T> = std::result::Result<T, SshConfigurationStoreError>;

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
        config_id: configuration_common::nonblank(
            config_id,
            "configuration id",
            SshConfigurationStoreError::InvalidInput,
        )?,
        name: configuration_common::validate_name(
            &configuration.name,
            SshConfigurationStoreError::InvalidInput,
        )?,
        ssh_host: configuration_common::nonblank(
            &configuration.ssh_host,
            "ssh_host",
            SshConfigurationStoreError::InvalidInput,
        )?,
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
        if configuration_common::is_constraint_violation(&error) {
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
            if configuration_common::is_constraint_violation(&error) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn initialized_store(label: &str) -> PathBuf {
        let path = crate::test_utils::temp_store_path(label);
        initialize(&path).unwrap();
        path
    }

    fn configuration(name: &str) -> NewSshConfiguration {
        NewSshConfiguration {
            name: name.to_string(),
            ssh_host: "user@example.com".to_string(),
            ssh_port: Some(2222),
            ssh_identity_file: Some(" ~/.ssh/id_ed25519 ".to_string()),
        }
    }

    #[test]
    fn a_saved_configuration_reads_back_normalized_fields() {
        let path = initialized_store("ssh_round_trip");
        let inserted = insert_ssh_configuration(&path, "ssh-1", configuration(" Work ")).unwrap();
        assert_eq!(load_ssh_configuration(&path, "ssh-1").unwrap(), inserted);
        assert_eq!(inserted.name, "Work");
        assert_eq!(
            inserted.ssh_identity_file.as_deref(),
            Some("~/.ssh/id_ed25519")
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn duplicate_names_have_the_ssh_error_identity() {
        let path = initialized_store("ssh_duplicate");
        insert_ssh_configuration(&path, "ssh-1", configuration("Work")).unwrap();
        let error = insert_ssh_configuration(&path, "ssh-2", configuration(" Work ")).unwrap_err();
        assert!(
            matches!(error, SshConfigurationStoreError::DuplicateName(ref name) if name == "Work")
        );
        let _: &dyn std::error::Error = &error;
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn invalid_shared_and_ssh_specific_fields_are_rejected() {
        let path = initialized_store("ssh_invalid");
        for (id, configuration, field) in [
            (" ", configuration("Work"), "configuration id"),
            ("ssh-1", configuration(" "), "configuration name"),
            (
                "ssh-1",
                NewSshConfiguration {
                    ssh_host: " ".into(),
                    ..configuration("Work")
                },
                "ssh_host",
            ),
            (
                "ssh-1",
                NewSshConfiguration {
                    ssh_port: Some(0),
                    ..configuration("Work")
                },
                "ssh_port",
            ),
        ] {
            let error = insert_ssh_configuration(&path, id, configuration).unwrap_err();
            assert!(
                matches!(error, SshConfigurationStoreError::InvalidInput(ref message) if message.contains(field))
            );
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn unknown_load_and_idempotent_delete_match_model_store_behavior() {
        let path = initialized_store("ssh_missing");
        let error = load_ssh_configuration(&path, "missing").unwrap_err();
        assert!(matches!(error, SshConfigurationStoreError::NotFound(ref id) if id == "missing"));
        insert_ssh_configuration(&path, "ssh-1", configuration("Work")).unwrap();
        assert!(delete_ssh_configuration(&path, "ssh-1").unwrap());
        assert!(!delete_ssh_configuration(&path, "ssh-1").unwrap());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
