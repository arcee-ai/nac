use std::collections::BTreeMap;
use std::path::PathBuf;

use nac_core::projects::{self, ProjectRecord, ProjectStoreError};
use nac_core::{runtime, sessions, view};

use super::Field;
use crate::filesystem::{self, BrowseKind, BrowseQuery};
use crate::{SessionManager, SshRequest};

/// Application command for registering one existing local or SSH directory as
/// an ordinary NAC project. Transport adapters are responsible for decoding
/// their wire format into this command.
pub(crate) struct CreateProject {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) cwd: PathBuf,
    pub(crate) ssh_host: Option<String>,
    pub(crate) ssh_port: Option<u16>,
    pub(crate) ssh_identity_file: Option<String>,
    pub(crate) default_model_config_id: Option<String>,
}

pub(crate) struct UpdateProject {
    pub(crate) name: Field<String>,
    pub(crate) description: Field<String>,
    pub(crate) default_model_config_id: Field<String>,
    pub(crate) pinned: Field<bool>,
}

#[derive(Clone, Copy)]
pub(crate) enum ProjectSessionDisposition {
    Keep,
    Delete,
}

pub(crate) struct DeleteProjectOutcome {
    pub(crate) released_session_ids: Vec<String>,
    pub(crate) deleted_session_ids: Vec<String>,
}

#[derive(Debug)]
pub(crate) enum ProjectApplicationError {
    InvalidInput(String),
    Project(ProjectStoreError),
    LocalBrowse(filesystem::BrowseError),
    RemoteBrowse(runtime::RemoteBrowseError),
    Session(anyhow::Error),
}

impl std::fmt::Display for ProjectApplicationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::Project(error) => error.fmt(formatter),
            Self::LocalBrowse(error) => error.fmt(formatter),
            Self::RemoteBrowse(error) => error.fmt(formatter),
            Self::Session(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for ProjectApplicationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidInput(_) => None,
            Self::Project(error) => Some(error),
            Self::LocalBrowse(error) => Some(error),
            Self::RemoteBrowse(error) => Some(error),
            Self::Session(error) => Some(error.as_ref()),
        }
    }
}

impl From<ProjectStoreError> for ProjectApplicationError {
    fn from(error: ProjectStoreError) -> Self {
        Self::Project(error)
    }
}

impl From<filesystem::BrowseError> for ProjectApplicationError {
    fn from(error: filesystem::BrowseError) -> Self {
        Self::LocalBrowse(error)
    }
}

impl From<runtime::RemoteBrowseError> for ProjectApplicationError {
    fn from(error: runtime::RemoteBrowseError) -> Self {
        Self::RemoteBrowse(error)
    }
}

impl From<anyhow::Error> for ProjectApplicationError {
    fn from(error: anyhow::Error) -> Self {
        Self::Session(error)
    }
}

/// Focused project use cases. This facade owns project validation and store
/// ordering while delegating session teardown to the existing lifecycle owner.
/// The latter remains intentionally inside `SessionManager` until the session
/// application seam is extracted.
pub(crate) struct ProjectApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> ProjectApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) fn list(&self) -> Result<Vec<ProjectRecord>, ProjectApplicationError> {
        Ok(projects::list_projects(&self.manager.inner.store_path)?)
    }

    pub(crate) async fn create(
        &self,
        command: CreateProject,
    ) -> Result<ProjectRecord, ProjectApplicationError> {
        let requested_cwd = command.cwd.as_os_str().to_string_lossy().trim().to_string();
        if requested_cwd.is_empty() {
            return Err(ProjectApplicationError::InvalidInput(
                "project cwd must not be empty or whitespace-only".to_string(),
            ));
        }

        let ssh = SshRequest {
            host: command.ssh_host,
            port: command.ssh_port,
            identity_file: command.ssh_identity_file,
        }
        .into_options();
        let host = ssh.host();
        let (cwd, ssh_host, ssh_port, ssh_identity_file) = if host.is_some() {
            let listing = runtime::browse_ssh_directory(
                &ssh,
                Some(&requested_cwd),
                false,
                &self.manager.inner.root_cwd,
            )
            .await?;
            let connection = ssh
                .resolved_connection(&self.manager.inner.root_cwd)
                .expect("normalized SSH host must produce a connection");
            (
                PathBuf::from(listing.path),
                Some(connection.host),
                connection.port,
                connection
                    .identity_file
                    .map(|path| path.to_string_lossy().into_owned()),
            )
        } else {
            if ssh.port.is_some() || ssh.identity_file.is_some() {
                return Err(ProjectApplicationError::InvalidInput(
                    "an ssh port or private key needs an ssh host as well".to_string(),
                ));
            }
            let listing = filesystem::browse(
                &BrowseQuery {
                    path: Some(requested_cwd),
                    kind: BrowseKind::Directory,
                    hidden: false,
                },
                &self.manager.inner.root_cwd,
            )?;
            (PathBuf::from(listing.path), None, None, None)
        };

        // A local checkout is named after its origin remote (`owner/repo`),
        // which reads better than the bare folder the store would fall back to.
        let name = command.name.or_else(|| {
            ssh_host
                .is_none()
                .then(|| view::local_repo_label(&cwd))
                .flatten()
        });

        Ok(projects::insert_project(
            &self.manager.inner.store_path,
            projects::NewProject {
                project_id: uuid::Uuid::new_v4().to_string(),
                name,
                description: command.description,
                cwd,
                ssh_host,
                ssh_port,
                ssh_identity_file,
                default_model_config_id: command.default_model_config_id,
            },
        )?)
    }

    pub(crate) fn update(
        &self,
        project_id: &str,
        command: UpdateProject,
    ) -> Result<ProjectRecord, ProjectApplicationError> {
        let name = required_patch(command.name, "project name")?;
        let pinned = required_patch(command.pinned, "project pinned")?;
        Ok(projects::update_project(
            &self.manager.inner.store_path,
            project_id,
            projects::ProjectPatch {
                name,
                description: optional_patch(command.description),
                default_model_config_id: optional_patch(command.default_model_config_id),
                pinned,
            },
        )?)
    }

    /// Applies one complete project-removal use case. Session lifecycle remains
    /// ordered before project deletion so a refusal cannot orphan membership.
    pub(crate) async fn delete(
        &self,
        project_id: &str,
        sessions: ProjectSessionDisposition,
    ) -> Result<DeleteProjectOutcome, ProjectApplicationError> {
        match sessions {
            ProjectSessionDisposition::Keep => Ok(DeleteProjectOutcome {
                released_session_ids: projects::delete_project(
                    &self.manager.inner.store_path,
                    project_id,
                )?,
                deleted_session_ids: Vec::new(),
            }),
            ProjectSessionDisposition::Delete => {
                let session_ids: Vec<String> =
                    sessions::list_sessions(&self.manager.inner.store_path)?
                        .into_iter()
                        .filter(|summary| summary.project_id.as_deref() == Some(project_id))
                        .map(|summary| summary.session_id)
                        .collect();
                for session_id in &session_ids {
                    let still_exists = sessions::list_sessions(&self.manager.inner.store_path)?
                        .into_iter()
                        .any(|summary| summary.session_id == *session_id);
                    if !still_exists {
                        // An earlier parent can recursively remove delegated
                        // sessions that were present in the original snapshot.
                        continue;
                    }
                    if let Err(error) = self.manager.delete_session(session_id).await {
                        let still_exists = sessions::list_sessions(&self.manager.inner.store_path)?
                            .into_iter()
                            .any(|summary| summary.session_id == *session_id);
                        if still_exists {
                            return Err(ProjectApplicationError::Session(error));
                        }
                    }
                }
                projects::delete_project(&self.manager.inner.store_path, project_id)?;
                Ok(DeleteProjectOutcome {
                    released_session_ids: Vec::new(),
                    deleted_session_ids: session_ids,
                })
            }
        }
    }

    pub(crate) fn assign_session(
        &self,
        project_id: &str,
        session_id: &str,
    ) -> Result<ProjectRecord, ProjectApplicationError> {
        Ok(projects::assign_session_to_project(
            &self.manager.inner.store_path,
            project_id,
            session_id,
        )?)
    }

    pub(crate) fn reorder(
        &self,
        pinned: bool,
        project_ids: &[String],
        expected_versions: &BTreeMap<String, i64>,
    ) -> Result<Vec<ProjectRecord>, ProjectApplicationError> {
        Ok(projects::reorder_projects(
            &self.manager.inner.store_path,
            pinned,
            project_ids,
            expected_versions,
        )?)
    }
}

fn required_patch<T>(field: Field<T>, name: &str) -> Result<Option<T>, ProjectApplicationError> {
    match field {
        Field::Unchanged => Ok(None),
        Field::Clear => Err(ProjectApplicationError::InvalidInput(format!(
            "{name} cannot be null"
        ))),
        Field::Set(value) => Ok(Some(value)),
    }
}

fn optional_patch<T>(field: Field<T>) -> Option<Option<T>> {
    match field {
        Field::Unchanged => None,
        Field::Clear => Some(None),
        Field::Set(value) => Some(Some(value)),
    }
}
