use super::*;

use crate::store::model_configurations::{model_configuration_columns, row_to_record_at};

const MAX_NAME_LEN: usize = 120;
const MAX_DESCRIPTION_LEN: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProjectRecord {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub cwd: PathBuf,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
    pub default_model_config_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewProject {
    pub project_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub cwd: PathBuf,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
    pub default_model_config_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub default_model_config_id: Option<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectLaunchContext {
    pub project: ProjectRecord,
    pub default_model_config: Option<ModelConfigurationRecord>,
}

#[derive(Debug)]
pub enum ProjectStoreError {
    InvalidInput(String),
    DuplicateLocation,
    NotFound(String),
    ModelConfigurationNotFound(String),
    Store(anyhow::Error),
}

impl std::fmt::Display for ProjectStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::DuplicateLocation => formatter.write_str("a project already uses this location"),
            Self::NotFound(id) => write!(formatter, "project '{id}' was not found"),
            Self::ModelConfigurationNotFound(id) => {
                write!(formatter, "model configuration '{id}' was not found")
            }
            Self::Store(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for ProjectStoreError {}

impl From<anyhow::Error> for ProjectStoreError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

impl From<rusqlite::Error> for ProjectStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

type ProjectResult<T> = std::result::Result<T, ProjectStoreError>;

const PROJECT_COLUMNS: &str = "project_id, name, description, cwd, ssh_host, ssh_port,
     ssh_identity_file, default_model_config_id, created_at, updated_at";

fn normalize_name(name: &str) -> ProjectResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ProjectStoreError::InvalidInput(
            "project name must not be blank".to_string(),
        ));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ProjectStoreError::InvalidInput(format!(
            "project name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    if name.chars().any(char::is_control) {
        return Err(ProjectStoreError::InvalidInput(
            "project name must not contain control characters".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn generated_name(cwd: &Path, ssh_host: Option<&str>) -> String {
    let candidate = cwd
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
        .or_else(|| ssh_host.map(str::to_string))
        .unwrap_or_else(|| cwd.display().to_string());
    candidate.chars().take(MAX_NAME_LEN).collect()
}

fn normalize_description(description: Option<String>) -> ProjectResult<Option<String>> {
    let Some(description) = description else {
        return Ok(None);
    };
    let description = description.trim();
    if description.is_empty() {
        return Ok(None);
    }
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(ProjectStoreError::InvalidInput(format!(
            "project description must be at most {MAX_DESCRIPTION_LEN} characters"
        )));
    }
    if description
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(ProjectStoreError::InvalidInput(
            "project description contains an unsupported control character".to_string(),
        ));
    }
    Ok(Some(description.to_string()))
}

fn normalize_optional_nonblank(
    value: Option<String>,
    field: &str,
) -> ProjectResult<Option<String>> {
    value
        .map(|value| {
            let value = value.trim();
            if value.is_empty() {
                Err(ProjectStoreError::InvalidInput(format!(
                    "{field} must not be blank"
                )))
            } else {
                Ok(value.to_string())
            }
        })
        .transpose()
}

fn validated_project(project: NewProject) -> ProjectResult<ProjectRecord> {
    let project_id = project.project_id.trim();
    if project_id.is_empty() {
        return Err(ProjectStoreError::InvalidInput(
            "project id must not be blank".to_string(),
        ));
    }
    let cwd_display = project.cwd.display().to_string();
    if cwd_display.trim().is_empty() {
        return Err(ProjectStoreError::InvalidInput(
            "project cwd must not be blank".to_string(),
        ));
    }
    let ssh_host = normalize_optional_nonblank(project.ssh_host, "ssh_host")?;
    let ssh_identity_file =
        normalize_optional_nonblank(project.ssh_identity_file, "ssh_identity_file")?;
    if ssh_host.is_none() && (project.ssh_port.is_some() || ssh_identity_file.is_some()) {
        return Err(ProjectStoreError::InvalidInput(
            "ssh_port and ssh_identity_file require ssh_host".to_string(),
        ));
    }
    let default_model_config_id =
        normalize_optional_nonblank(project.default_model_config_id, "default_model_config_id")?;
    let name = match project.name {
        Some(name) => normalize_name(&name)?,
        None => generated_name(&project.cwd, ssh_host.as_deref()),
    };
    let now = now_utc();
    Ok(ProjectRecord {
        project_id: project_id.to_string(),
        name,
        description: normalize_description(project.description)?,
        cwd: project.cwd,
        ssh_host,
        ssh_port: project.ssh_port,
        ssh_identity_file,
        default_model_config_id,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn row_to_project_at(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<ProjectRecord> {
    let cwd: String = row.get(offset + 3)?;
    Ok(ProjectRecord {
        project_id: row.get(offset)?,
        name: row.get(offset + 1)?,
        description: row.get(offset + 2)?,
        cwd: PathBuf::from(cwd),
        ssh_host: row.get(offset + 4)?,
        ssh_port: row.get(offset + 5)?,
        ssh_identity_file: row.get(offset + 6)?,
        default_model_config_id: row.get(offset + 7)?,
        created_at: row.get(offset + 8)?,
        updated_at: row.get(offset + 9)?,
    })
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRecord> {
    row_to_project_at(row, 0)
}

fn is_constraint(error: &rusqlite::Error, extended_code: i32) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _) if code.extended_code == extended_code
    )
}

fn map_insert_error(error: rusqlite::Error) -> ProjectStoreError {
    if is_constraint(&error, rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE) {
        ProjectStoreError::DuplicateLocation
    } else {
        ProjectStoreError::Store(error.into())
    }
}

fn ensure_model_configuration(
    conn: &rusqlite::Connection,
    config_id: Option<&str>,
) -> ProjectResult<()> {
    let Some(config_id) = config_id else {
        return Ok(());
    };
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM model_configurations WHERE config_id = ?1)",
        params![config_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(ProjectStoreError::ModelConfigurationNotFound(
            config_id.to_string(),
        ));
    }
    Ok(())
}

fn load_project_with_connection(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> ProjectResult<ProjectRecord> {
    conn.query_row(
        &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE project_id = ?1"),
        params![project_id],
        row_to_project,
    )
    .optional()?
    .ok_or_else(|| ProjectStoreError::NotFound(project_id.to_string()))
}

pub fn list_projects(path: &Path) -> ProjectResult<Vec<ProjectRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn.prepare(&format!(
        "SELECT {PROJECT_COLUMNS} FROM projects ORDER BY created_at, name, project_id"
    ))?;
    let projects = statement
        .query_map([], row_to_project)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(projects)
}

pub fn insert_project(path: &Path, project: NewProject) -> ProjectResult<ProjectRecord> {
    let record = validated_project(project)?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    ensure_model_configuration(&tx, record.default_model_config_id.as_deref())?;
    tx.execute(
        "INSERT INTO projects
         (project_id, name, description, cwd, ssh_host, ssh_port, ssh_identity_file,
          default_model_config_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            record.project_id,
            record.name,
            record.description,
            record.cwd.display().to_string(),
            record.ssh_host,
            record.ssh_port,
            record.ssh_identity_file,
            record.default_model_config_id,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(map_insert_error)?;
    tx.commit()?;
    Ok(record)
}

pub fn update_project(
    path: &Path,
    project_id: &str,
    patch: ProjectPatch,
) -> ProjectResult<ProjectRecord> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing = load_project_with_connection(&tx, project_id)?;
    let name = patch
        .name
        .as_deref()
        .map(normalize_name)
        .transpose()?
        .unwrap_or(existing.name);
    let description = match patch.description {
        Some(description) => normalize_description(description)?,
        None => existing.description,
    };
    let default_model_config_id = match patch.default_model_config_id {
        Some(config_id) => {
            let config_id = normalize_optional_nonblank(config_id, "default_model_config_id")?;
            ensure_model_configuration(&tx, config_id.as_deref())?;
            config_id
        }
        None => existing.default_model_config_id,
    };
    let updated_at = now_utc();
    tx.execute(
        "UPDATE projects
         SET name = ?2, description = ?3, default_model_config_id = ?4, updated_at = ?5
         WHERE project_id = ?1",
        params![
            project_id,
            name,
            description,
            default_model_config_id,
            updated_at
        ],
    )?;
    let updated = load_project_with_connection(&tx, project_id)?;
    tx.commit()?;
    Ok(updated)
}

pub fn load_project_launch_context(
    path: &Path,
    project_id: &str,
) -> ProjectResult<ProjectLaunchContext> {
    let conn = open_runtime_connection(path)?;
    let model_columns = model_configuration_columns("mc");
    conn.query_row(
        &format!(
            "SELECT p.project_id, p.name, p.description, p.cwd, p.ssh_host, p.ssh_port,
                    p.ssh_identity_file, p.default_model_config_id, p.created_at, p.updated_at,
                    {model_columns}
             FROM projects p
             LEFT JOIN model_configurations mc
               ON mc.config_id = p.default_model_config_id
             WHERE p.project_id = ?1"
        ),
        params![project_id],
        |row| {
            let project = row_to_project_at(row, 0)?;
            let default_model_config = if row.get::<_, Option<String>>(10)?.is_some() {
                Some(row_to_record_at(row, 10)?)
            } else {
                None
            };
            Ok(ProjectLaunchContext {
                project,
                default_model_config,
            })
        },
    )
    .optional()?
    .ok_or_else(|| ProjectStoreError::NotFound(project_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_projects_{label}_{unique}"))
            .join("store.db")
    }

    fn new_project(id: &str, cwd: &str) -> NewProject {
        NewProject {
            project_id: id.to_string(),
            name: None,
            description: None,
            cwd: PathBuf::from(cwd),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        }
    }

    fn model_configuration(name: &str) -> NewModelConfiguration {
        NewModelConfiguration {
            name: name.to_string(),
            backend: "openai-responses".to_string(),
            model: "gpt-5.5".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_env: Some("PROJECT_TEST_KEY".to_string()),
            reasoning_effort: Some("high".to_string()),
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: Some(64_000),
            initial_prompt: None,
            light_model: None,
        }
    }

    #[test]
    fn projects_round_trip_patch_and_allow_duplicate_names() {
        let path = temp_store_path("round_trip");
        initialize(&path).unwrap();

        let first = insert_project(&path, new_project("project-a", "/work/alpha")).unwrap();
        assert_eq!(first.name, "alpha");
        let mut second = new_project("project-b", "/other/alpha");
        second.name = Some("alpha".to_string());
        insert_project(&path, second).unwrap();

        let updated = update_project(
            &path,
            "project-a",
            ProjectPatch {
                name: Some("Primary".to_string()),
                description: Some(Some("First\nproject".to_string())),
                default_model_config_id: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Primary");
        assert_eq!(updated.description.as_deref(), Some("First\nproject"));
        assert_eq!(list_projects(&path).unwrap().len(), 2);

        let duplicate = insert_project(&path, new_project("project-c", "/work/alpha"))
            .expect_err("the same location must be unique");
        assert!(matches!(duplicate, ProjectStoreError::DuplicateLocation));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn project_default_load_is_joined_and_restricts_configuration_delete() {
        let path = temp_store_path("default");
        initialize(&path).unwrap();
        insert_model_configuration(&path, "config-a", model_configuration("Project default"))
            .unwrap();
        let mut project = new_project("project-a", "/work/alpha");
        project.default_model_config_id = Some("config-a".to_string());
        insert_project(&path, project).unwrap();

        let context = load_project_launch_context(&path, "project-a").unwrap();
        assert_eq!(
            context
                .default_model_config
                .as_ref()
                .map(|config| config.config_id.as_str()),
            Some("config-a")
        );
        let deletion = delete_model_configuration(&path, "config-a");
        assert!(
            matches!(
                &deletion,
                Err(ModelConfigurationStoreError::InUse(id)) if id == "config-a"
            ),
            "unexpected deletion result: {deletion:?}"
        );
        assert!(load_model_configuration(&path, "config-a").is_ok());

        update_project(
            &path,
            "project-a",
            ProjectPatch {
                default_model_config_id: Some(None),
                ..ProjectPatch::default()
            },
        )
        .unwrap();
        assert!(delete_model_configuration(&path, "config-a").unwrap());
        assert!(load_project_launch_context(&path, "project-a")
            .unwrap()
            .default_model_config
            .is_none());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn project_validation_bounds_generated_and_supplied_metadata() {
        let path = temp_store_path("validation");
        initialize(&path).unwrap();
        let long_component = "x".repeat(MAX_NAME_LEN + 20);
        let generated = insert_project(
            &path,
            new_project("generated", &format!("/work/{long_component}")),
        )
        .unwrap();
        assert_eq!(generated.name.chars().count(), MAX_NAME_LEN);

        let mut invalid = new_project("invalid", "/work/invalid");
        invalid.name = Some("x".repeat(MAX_NAME_LEN + 1));
        assert!(matches!(
            insert_project(&path, invalid),
            Err(ProjectStoreError::InvalidInput(_))
        ));
        assert!(matches!(
            update_project(
                &path,
                "generated",
                ProjectPatch {
                    description: Some(Some("x".repeat(MAX_DESCRIPTION_LEN + 1))),
                    ..ProjectPatch::default()
                },
            ),
            Err(ProjectStoreError::InvalidInput(_))
        ));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
