use super::*;

use std::collections::BTreeMap;

/// A named, reusable model setup offered by the launch modal.
///
/// `api_key_env` names the credential rather than holding it: the value lives
/// in the credential store (or the environment), exactly as it does for a
/// configuration written by hand in `config.toml`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ModelConfigurationRecord {
    pub config_id: String,
    pub name: String,
    pub backend: String,
    pub model: String,
    pub base_url: String,
    pub api_key_env: Option<String>,
    pub reasoning_effort: Option<String>,
    pub extra_headers: BTreeMap<String, String>,
    /// Compaction budget a session started from this setup inherits; `None`
    /// falls back to `[compaction].threshold_tokens`.
    pub orchestrator_compaction_threshold: Option<u64>,
    /// Message the launch modal pre-fills when this setup is chosen.
    pub initial_prompt: Option<String>,
    /// Light worker model; `None` keeps single-model behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light_model: Option<crate::light_model::LightModelSettings>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewModelConfiguration {
    pub name: String,
    pub backend: String,
    pub model: String,
    pub base_url: String,
    pub api_key_env: Option<String>,
    pub reasoning_effort: Option<String>,
    pub extra_headers: BTreeMap<String, String>,
    pub orchestrator_compaction_threshold: Option<u64>,
    pub initial_prompt: Option<String>,
    pub light_model: Option<crate::light_model::LightModelSettings>,
}

#[derive(Debug)]
pub enum ModelConfigurationStoreError {
    InvalidInput(String),
    DuplicateName(String),
    InUse(String),
    NotFound(String),
    Store(anyhow::Error),
}

impl std::fmt::Display for ModelConfigurationStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::DuplicateName(name) => {
                write!(formatter, "a configuration named '{name}' already exists")
            }
            Self::InUse(id) => {
                write!(formatter, "configuration '{id}' is used by a project")
            }
            Self::NotFound(id) => write!(formatter, "configuration '{id}' was not found"),
            Self::Store(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for ModelConfigurationStoreError {}

impl From<anyhow::Error> for ModelConfigurationStoreError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

type ConfigurationResult<T> = std::result::Result<T, ModelConfigurationStoreError>;

/// Longest accepted display name. Names are shown in a dropdown, so a runaway
/// paste is rejected rather than truncated.
const MAX_NAME_LEN: usize = 120;

fn nonblank(value: &str, field: &str) -> ConfigurationResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ModelConfigurationStoreError::InvalidInput(format!(
            "{field} must not be blank"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_name(name: &str) -> ConfigurationResult<String> {
    let name = nonblank(name, "configuration name")?;
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ModelConfigurationStoreError::InvalidInput(format!(
            "configuration name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

fn encode_headers(headers: &BTreeMap<String, String>) -> ConfigurationResult<String> {
    serde_json::to_string(headers).map_err(|error| {
        ModelConfigurationStoreError::InvalidInput(format!(
            "could not encode extra headers: {error}"
        ))
    })
}

fn decode_headers(raw: &str) -> BTreeMap<String, String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn encode_light_model(
    light: Option<&crate::light_model::LightModelSettings>,
) -> ConfigurationResult<Option<String>> {
    light
        .map(|config| {
            serde_json::to_string(config).map_err(|error| {
                ModelConfigurationStoreError::InvalidInput(format!(
                    "could not encode light model: {error}"
                ))
            })
        })
        .transpose()
}

/// Only `encode_light_model` ever writes the column, so a row that fails to
/// parse is real corruption; fail the read rather than silently loading the
/// setup as single-model.
fn decode_light_model(
    raw: Option<&str>,
    column_index: usize,
) -> rusqlite::Result<Option<crate::light_model::LightModelSettings>> {
    raw.map(|json| {
        serde_json::from_str(json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                column_index,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    })
    .transpose()
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::ConstraintViolation)
    )
}

pub(crate) fn row_to_record_at(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<ModelConfigurationRecord> {
    let extra_headers: String = row.get(offset + 7)?;
    Ok(ModelConfigurationRecord {
        config_id: row.get(offset)?,
        name: row.get(offset + 1)?,
        backend: row.get(offset + 2)?,
        model: row.get(offset + 3)?,
        base_url: row.get(offset + 4)?,
        api_key_env: row.get(offset + 5)?,
        reasoning_effort: row.get(offset + 6)?,
        extra_headers: decode_headers(&extra_headers),
        orchestrator_compaction_threshold: row.get(offset + 8)?,
        initial_prompt: row.get(offset + 9)?,
        light_model: decode_light_model(
            row.get::<_, Option<String>>(offset + 12)?.as_deref(),
            offset + 12,
        )?,
        created_at: row.get(offset + 10)?,
        updated_at: row.get(offset + 11)?,
    })
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelConfigurationRecord> {
    row_to_record_at(row, 0)
}

const SELECT_COLUMNS: &str = "config_id, name, backend, model, base_url, api_key_env,
     reasoning_effort, extra_headers_json, orchestrator_compaction_threshold,
     initial_prompt, created_at, updated_at, light_model_json";

pub(crate) fn model_configuration_columns(alias: &str) -> String {
    SELECT_COLUMNS
        .split(',')
        .map(|column| format!("{alias}.{}", column.trim()))
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn list_model_configurations(
    path: &Path,
) -> ConfigurationResult<Vec<ModelConfigurationRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM model_configurations ORDER BY created_at, name"
        ))
        .map_err(|error| ModelConfigurationStoreError::Store(error.into()))?;
    let records = statement
        .query_map([], row_to_record)
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|error| ModelConfigurationStoreError::Store(error.into()))?;
    Ok(records)
}

pub fn load_model_configuration(
    path: &Path,
    config_id: &str,
) -> ConfigurationResult<ModelConfigurationRecord> {
    let conn = open_runtime_connection(path)?;
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM model_configurations WHERE config_id = ?1"),
        params![config_id],
        row_to_record,
    )
    .optional()
    .map_err(|error| ModelConfigurationStoreError::Store(error.into()))?
    .ok_or_else(|| ModelConfigurationStoreError::NotFound(config_id.to_string()))
}

/// Checks the fields a row must carry and settles the optional ones, so insert
/// and update reject the same input for the same reason.
fn validated_record(
    config_id: &str,
    configuration: NewModelConfiguration,
    created_at: String,
) -> ConfigurationResult<ModelConfigurationRecord> {
    Ok(ModelConfigurationRecord {
        config_id: nonblank(config_id, "configuration id")?,
        name: validate_name(&configuration.name)?,
        backend: nonblank(&configuration.backend, "backend")?,
        model: nonblank(&configuration.model, "model")?,
        base_url: nonblank(&configuration.base_url, "base_url")?,
        api_key_env: configuration.api_key_env,
        reasoning_effort: configuration.reasoning_effort,
        extra_headers: configuration.extra_headers,
        orchestrator_compaction_threshold: validate_threshold(
            configuration.orchestrator_compaction_threshold,
        )?,
        initial_prompt: configuration
            .initial_prompt
            .map(|prompt| prompt.trim().to_string())
            .filter(|prompt| !prompt.is_empty()),
        light_model: configuration.light_model,
        created_at,
        updated_at: now_utc(),
    })
}

/// Zero is how the API says "no compaction", which the column stores as NULL
/// rather than as a value its CHECK would reject.
fn validate_threshold(threshold: Option<u64>) -> ConfigurationResult<Option<u64>> {
    match threshold {
        None | Some(0) => Ok(None),
        Some(value) if value <= crate::MAX_SUPPORTED_TOKEN_COUNT => Ok(Some(value)),
        Some(value) => Err(ModelConfigurationStoreError::InvalidInput(format!(
            "orchestrator compaction threshold {value} exceeds the supported maximum of {}",
            crate::MAX_SUPPORTED_TOKEN_COUNT
        ))),
    }
}

pub fn insert_model_configuration(
    path: &Path,
    config_id: &str,
    configuration: NewModelConfiguration,
) -> ConfigurationResult<ModelConfigurationRecord> {
    let record = validated_record(config_id, configuration, now_utc())?;

    let conn = open_runtime_connection(path)?;
    conn.execute(
        "INSERT INTO model_configurations
         (config_id, name, backend, model, base_url, api_key_env,
          reasoning_effort, extra_headers_json, orchestrator_compaction_threshold,
          initial_prompt, created_at, updated_at, light_model_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            record.config_id,
            record.name,
            record.backend,
            record.model,
            record.base_url,
            record.api_key_env,
            record.reasoning_effort,
            encode_headers(&record.extra_headers)?,
            record.orchestrator_compaction_threshold,
            record.initial_prompt,
            record.created_at,
            record.updated_at,
            encode_light_model(record.light_model.as_ref())?,
        ],
    )
    .map_err(|error| {
        if is_unique_violation(&error) {
            ModelConfigurationStoreError::DuplicateName(record.name.clone())
        } else {
            ModelConfigurationStoreError::Store(error.into())
        }
    })?;

    Ok(record)
}

/// Replaces every stored field of an existing configuration.
///
/// The caller passes a whole configuration rather than a patch: it has already
/// read the row to decide what a partial request leaves alone, and rewriting
/// the lot keeps the row consistent with the credential it points at.
/// `created_at` survives, because the identity of the setup does not change.
pub fn update_model_configuration(
    path: &Path,
    config_id: &str,
    configuration: NewModelConfiguration,
) -> ConfigurationResult<ModelConfigurationRecord> {
    let existing = load_model_configuration(path, config_id)?;
    let record = validated_record(config_id, configuration, existing.created_at)?;

    let conn = open_runtime_connection(path)?;
    let updated = conn
        .execute(
            "UPDATE model_configurations
             SET name = ?2, backend = ?3, model = ?4, base_url = ?5, api_key_env = ?6,
                 reasoning_effort = ?7, extra_headers_json = ?8,
                 orchestrator_compaction_threshold = ?9, initial_prompt = ?10,
                 updated_at = ?11, light_model_json = ?12
             WHERE config_id = ?1",
            params![
                record.config_id,
                record.name,
                record.backend,
                record.model,
                record.base_url,
                record.api_key_env,
                record.reasoning_effort,
                encode_headers(&record.extra_headers)?,
                record.orchestrator_compaction_threshold,
                record.initial_prompt,
                record.updated_at,
                encode_light_model(record.light_model.as_ref())?,
            ],
        )
        .map_err(|error| {
            if is_unique_violation(&error) {
                ModelConfigurationStoreError::DuplicateName(record.name.clone())
            } else {
                ModelConfigurationStoreError::Store(error.into())
            }
        })?;
    if updated == 0 {
        return Err(ModelConfigurationStoreError::NotFound(
            config_id.to_string(),
        ));
    }

    Ok(record)
}

/// Returns whether a configuration was actually removed.
pub fn delete_model_configuration(path: &Path, config_id: &str) -> ConfigurationResult<bool> {
    let conn = open_runtime_connection(path)?;
    let removed = conn
        .execute(
            "DELETE FROM model_configurations WHERE config_id = ?1",
            params![config_id],
        )
        .map_err(|error| {
            let referenced = matches!(
                &error,
                rusqlite::Error::SqliteFailure(code, message)
                    if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY
                        || (code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_TRIGGER
                            && message
                                .as_deref()
                                .is_some_and(|message| message.contains("FOREIGN KEY")))
            );
            if referenced {
                ModelConfigurationStoreError::InUse(config_id.to_string())
            } else {
                ModelConfigurationStoreError::Store(error.into())
            }
        })?;
    Ok(removed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::store::initialize;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_model_config_test_{label}_{unique}"))
            .join("store.db")
    }

    fn initialized_store(label: &str) -> PathBuf {
        let path = temp_store_path(label);
        initialize(&path).unwrap();
        path
    }

    fn configuration(name: &str) -> NewModelConfiguration {
        NewModelConfiguration {
            name: name.to_string(),
            backend: "openai-responses".to_string(),
            model: "gpt-5.5".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_env: Some("NAC_GENERATED_KEY".to_string()),
            reasoning_effort: Some("high".to_string()),
            extra_headers: BTreeMap::from([("X-Trace".to_string(), "on".to_string())]),
            orchestrator_compaction_threshold: Some(64_000),
            initial_prompt: Some("Review the diff".to_string()),
            light_model: None,
        }
    }

    #[test]
    fn a_saved_configuration_reads_back_field_for_field() {
        let store_path = initialized_store("round_trip");

        let inserted =
            insert_model_configuration(&store_path, "config-1", configuration("Work key")).unwrap();
        let loaded = load_model_configuration(&store_path, "config-1").unwrap();

        assert_eq!(loaded, inserted);
        assert_eq!(loaded.name, "Work key");
        assert_eq!(loaded.api_key_env.as_deref(), Some("NAC_GENERATED_KEY"));
        assert_eq!(loaded.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(loaded.extra_headers["X-Trace"], "on");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn listing_returns_every_saved_configuration() {
        let store_path = initialized_store("list");

        insert_model_configuration(&store_path, "config-1", configuration("Alpha")).unwrap();
        insert_model_configuration(&store_path, "config-2", configuration("Beta")).unwrap();

        let mut names: Vec<String> = list_model_configurations(&store_path)
            .unwrap()
            .into_iter()
            .map(|record| record.name)
            .collect();
        names.sort();

        assert_eq!(names, vec!["Alpha".to_string(), "Beta".to_string()]);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn a_name_may_only_be_used_once() {
        let store_path = initialized_store("duplicate");
        insert_model_configuration(&store_path, "config-1", configuration("Work key")).unwrap();

        let error = insert_model_configuration(&store_path, "config-2", configuration("Work key"))
            .unwrap_err();

        assert!(
            matches!(&error, ModelConfigurationStoreError::DuplicateName(name) if name == "Work key"),
            "unexpected error: {error:?}"
        );
        assert_eq!(list_model_configurations(&store_path).unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn surrounding_whitespace_is_trimmed_before_the_name_is_stored() {
        let store_path = initialized_store("trim");

        let record =
            insert_model_configuration(&store_path, "config-1", configuration("  Work key  "))
                .unwrap();

        assert_eq!(record.name, "Work key");
        // Trimming happens before the uniqueness check, not after it.
        assert!(matches!(
            insert_model_configuration(&store_path, "config-2", configuration("Work key")),
            Err(ModelConfigurationStoreError::DuplicateName(_))
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn incomplete_configurations_are_rejected_with_the_offending_field() {
        let store_path = initialized_store("invalid");

        let blank_fields = [
            ("configuration name", {
                let mut config = configuration("   ");
                config.name = "   ".to_string();
                config
            }),
            ("backend", {
                let mut config = configuration("Blank backend");
                config.backend = String::new();
                config
            }),
            ("model", {
                let mut config = configuration("Blank model");
                config.model = " ".to_string();
                config
            }),
            ("base_url", {
                let mut config = configuration("Blank URL");
                config.base_url = String::new();
                config
            }),
        ];

        for (field, config) in blank_fields {
            let error = insert_model_configuration(&store_path, "config-x", config).unwrap_err();
            assert!(
                matches!(&error, ModelConfigurationStoreError::InvalidInput(message)
                    if message.contains(field)),
                "unexpected error for {field}: {error:?}"
            );
        }

        let error =
            insert_model_configuration(&store_path, "  ", configuration("Blank id")).unwrap_err();
        assert!(
            matches!(&error, ModelConfigurationStoreError::InvalidInput(message)
                if message.contains("configuration id")),
            "unexpected error: {error:?}"
        );

        assert!(list_model_configurations(&store_path).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn a_runaway_name_is_rejected_rather_than_truncated() {
        let store_path = initialized_store("long_name");

        let at_limit = "ą".repeat(MAX_NAME_LEN);
        insert_model_configuration(&store_path, "config-1", configuration(&at_limit)).unwrap();

        let error = insert_model_configuration(
            &store_path,
            "config-2",
            configuration(&"ą".repeat(MAX_NAME_LEN + 1)),
        )
        .unwrap_err();

        assert!(
            matches!(&error, ModelConfigurationStoreError::InvalidInput(message)
                if message.contains("at most")),
            "unexpected error: {error:?}"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn an_unknown_configuration_is_reported_and_deletion_is_idempotent() {
        let store_path = initialized_store("missing");
        insert_model_configuration(&store_path, "config-1", configuration("Work key")).unwrap();

        let error = load_model_configuration(&store_path, "config-missing").unwrap_err();
        assert!(
            matches!(&error, ModelConfigurationStoreError::NotFound(id) if id == "config-missing"),
            "unexpected error: {error:?}"
        );

        assert!(delete_model_configuration(&store_path, "config-1").unwrap());
        assert!(!delete_model_configuration(&store_path, "config-1").unwrap());
        assert!(list_model_configurations(&store_path).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn a_configuration_written_with_corrupt_headers_still_loads() {
        let store_path = initialized_store("corrupt_headers");
        insert_model_configuration(&store_path, "config-1", configuration("Work key")).unwrap();

        let conn = open_runtime_connection(&store_path).unwrap();
        conn.execute(
            "UPDATE model_configurations SET extra_headers_json = 'not json'",
            [],
        )
        .unwrap();
        drop(conn);

        let record = load_model_configuration(&store_path, "config-1").unwrap();

        assert!(record.extra_headers.is_empty());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
