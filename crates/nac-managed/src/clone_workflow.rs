//! Restart-honest managed repository clone operations.
//!
//! The live process is intentionally not restart durable. A versioned
//! filesystem record and operation-owned staging marker let a later process
//! classify interruption and remove only staging it can prove it owns.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::clone_operation_store::{
    CloneOperationStore, DestinationReservation, OPERATION_VERSION,
};
#[cfg(test)]
use crate::clone_process::canonical_remote_identity;
use crate::clone_process::{sanitize_error, CloneCancellation, CloneProgress, GitCloneProcess};
use crate::github::ManagedGitHubAuth;
use nac_contracts::{NewProject, ProjectRecord};

/// Application port used by clone completion and restart reconciliation.
///
/// Implementations own project persistence and transactional validation; the
/// managed workflow never opens the harness database directly.
pub trait ProjectRegistrar: Send + Sync {
    fn list_projects(&self) -> Result<Vec<ProjectRecord>>;
    fn register_project(&self, project: NewProject) -> Result<ProjectRecord>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ManagedCloneStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

impl ManagedCloneStatus {
    pub fn is_terminal(&self) -> bool {
        !matches!(self, Self::Running)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManagedCloneOperation {
    pub version: u32,
    pub operation_id: String,
    pub status: ManagedCloneStatus,
    pub repository_id: u64,
    pub repository: String,
    pub source_identity: String,
    pub branch: String,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub destination: PathBuf,
    pub project_id: String,
    pub project_name: String,
    pub project: Option<ProjectRecord>,
    pub progress: String,
    pub error: Option<String>,
    pub reused_existing_checkout: bool,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
}

#[derive(Debug, Clone)]
pub struct ManagedCloneRequest {
    pub repository_id: u64,
    pub repository: String,
    pub clone_url: String,
    pub branch: String,
    pub destination: PathBuf,
    pub project_id: String,
    pub project_name: String,
    pub project_description: Option<String>,
}

#[derive(Clone)]
pub struct ManagedCloneService {
    inner: Arc<ManagedCloneServiceInner>,
}

struct ManagedCloneServiceInner {
    repository_root: PathBuf,
    operation_store: CloneOperationStore,
    project_registrar: Arc<dyn ProjectRegistrar>,
    git: GitCloneProcess,
    github: Option<ManagedGitHubAuth>,
    live: StdMutex<HashMap<String, LiveClone>>,
}

#[derive(Clone)]
struct LiveClone {
    cancellation: CloneCancellation,
    progress: CloneProgress,
}

struct PreparedClone {
    operation: ManagedCloneOperation,
    request: ManagedCloneRequest,
    destination: PathBuf,
    staging_root: PathBuf,
    checkout: PathBuf,
    source_identity: String,
    destination_reservation: DestinationReservation,
}

impl ManagedCloneService {
    pub fn new(
        repository_root: impl AsRef<Path>,
        state_root: impl AsRef<Path>,
        home_root: impl AsRef<Path>,
        project_registrar: Arc<dyn ProjectRegistrar>,
        github: Option<ManagedGitHubAuth>,
    ) -> Result<Self> {
        Self::new_with_git_executable(
            repository_root,
            state_root,
            home_root,
            project_registrar,
            github,
            PathBuf::from("git"),
        )
    }

    fn new_with_git_executable(
        repository_root: impl AsRef<Path>,
        state_root: impl AsRef<Path>,
        home_root: impl AsRef<Path>,
        project_registrar: Arc<dyn ProjectRegistrar>,
        github: Option<ManagedGitHubAuth>,
        git_executable: PathBuf,
    ) -> Result<Self> {
        std::fs::create_dir_all(repository_root.as_ref()).with_context(|| {
            format!(
                "failed to create managed repository root {}",
                repository_root.as_ref().display()
            )
        })?;
        let repository_root =
            std::fs::canonicalize(repository_root.as_ref()).with_context(|| {
                format!(
                    "failed to canonicalize managed repository root {}",
                    repository_root.as_ref().display()
                )
            })?;
        std::fs::create_dir_all(home_root.as_ref()).with_context(|| {
            format!(
                "failed to create managed home root {}",
                home_root.as_ref().display()
            )
        })?;
        let operation_store =
            CloneOperationStore::new(state_root.as_ref(), repository_root.clone())?;
        let service = Self {
            inner: Arc::new(ManagedCloneServiceInner {
                repository_root,
                operation_store,
                project_registrar,
                git: GitCloneProcess::new(git_executable, home_root.as_ref().to_path_buf()),
                github,
                live: StdMutex::new(HashMap::new()),
            }),
        };
        service.reconcile_interrupted()?;
        Ok(service)
    }

    pub fn repository_root(&self) -> &Path {
        &self.inner.repository_root
    }

    pub fn start(&self, request: ManagedCloneRequest) -> Result<ManagedCloneOperation> {
        let identity = validate_github_clone_request(&request)?;
        self.start_validated(request, identity)
    }

    fn start_validated(
        &self,
        request: ManagedCloneRequest,
        source_identity: String,
    ) -> Result<ManagedCloneOperation> {
        validate_branch(&request.branch)?;
        validate_project_fields(&request)?;
        let destination = self.resolve_destination(&request.destination)?;
        let destination_reservation = self
            .inner
            .operation_store
            .reserve_destination(&destination)?
            .ok_or_else(|| {
                anyhow!(
                    "another managed clone already reserves destination '{}'",
                    destination.display()
                )
            })?;

        if destination.exists() {
            bail!(
                "managed clone destination '{}' already exists; choose another destination or create an ordinary Project from the existing checkout",
                destination.display()
            );
        }

        let operation_id = uuid::Uuid::new_v4().simple().to_string();
        let staging_root = self
            .inner
            .repository_root
            .join(format!(".nac-clone-{operation_id}"));
        if staging_root.exists() {
            bail!("managed clone staging collision; retry the operation");
        }
        std::fs::create_dir(&staging_root).with_context(|| {
            format!("failed to create clone staging {}", staging_root.display())
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staging_root, std::fs::Permissions::from_mode(0o700))
                .with_context(|| {
                    format!("failed to protect clone staging {}", staging_root.display())
                })?;
        }
        let checkout = staging_root.join("checkout");
        self.inner.operation_store.save_staging_marker(
            &staging_root,
            &operation_id,
            &destination,
            &source_identity,
        )?;
        let now = now_ms()?;
        let operation = ManagedCloneOperation {
            version: OPERATION_VERSION,
            operation_id: operation_id.clone(),
            status: ManagedCloneStatus::Running,
            repository_id: request.repository_id,
            repository: request.repository.clone(),
            source_identity: source_identity.clone(),
            branch: request.branch.clone(),
            destination: destination.clone(),
            project_id: request.project_id.clone(),
            project_name: request.project_name.clone(),
            project: None,
            progress: "Preparing clone".to_string(),
            error: None,
            reused_existing_checkout: false,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        };
        self.inner.operation_store.save(&operation)?;

        let cancellation = CloneCancellation::default();
        let progress = Arc::new(StdMutex::new(operation.progress.clone()));
        self.inner
            .live
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                operation_id.clone(),
                LiveClone {
                    cancellation: cancellation.clone(),
                    progress: Arc::clone(&progress),
                },
            );
        let prepared = PreparedClone {
            operation: operation.clone(),
            request,
            destination,
            staging_root,
            checkout,
            source_identity,
            destination_reservation,
        };
        let service = self.clone();
        tokio::spawn(async move {
            service.run_clone(prepared, cancellation, progress).await;
            service
                .inner
                .live
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&operation_id);
        });
        Ok(operation)
    }

    pub fn operation(&self, operation_id: &str) -> Result<Option<ManagedCloneOperation>> {
        let mut operation = self.inner.operation_store.load(operation_id)?;
        if let Some(operation) = operation.as_mut() {
            if let Some(live) = self
                .inner
                .live
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(operation_id)
            {
                operation.progress = live
                    .progress
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone();
            }
        }
        Ok(operation)
    }

    pub fn cancel(&self, operation_id: &str) -> Result<bool> {
        self.inner.operation_store.validate_id(operation_id)?;
        let live = self
            .inner
            .live
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(operation_id)
            .cloned();
        if let Some(live) = live {
            live.cancellation.cancel();
            *live
                .progress
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                "Cancelling clone".to_string();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn reconcile_interrupted(&self) -> Result<usize> {
        let mut reconciled = 0;
        for mut operation in self.inner.operation_store.all()? {
            if operation.status != ManagedCloneStatus::Running {
                continue;
            }
            let Some(_destination_reservation) = self
                .inner
                .operation_store
                .reserve_destination(&operation.destination)?
            else {
                // Another NAC process still owns this operation. Its durable
                // record remains running and that process remains responsible
                // for progress, completion, and cancellation.
                continue;
            };
            if let Some(project) = self
                .inner
                .project_registrar
                .list_projects()?
                .into_iter()
                .find(|project| project.project_id == operation.project_id)
            {
                if project.cwd == operation.destination
                    && self
                        .inner
                        .git
                        .repository_identity(&operation.destination)?
                        .as_deref()
                        == Some(operation.source_identity.as_str())
                {
                    operation.status = ManagedCloneStatus::Completed;
                    operation.project = Some(project);
                    operation.progress = "Clone complete".to_string();
                    operation.error = None;
                    operation.updated_at_unix_ms = now_ms()?;
                    self.inner.operation_store.save(&operation)?;
                    reconciled += 1;
                    continue;
                }
            }
            let staging_root = self
                .inner
                .repository_root
                .join(format!(".nac-clone-{}", operation.operation_id));
            self.inner
                .operation_store
                .cleanup_owned_staging(&staging_root, &operation.operation_id)?;
            operation.status = ManagedCloneStatus::Interrupted;
            operation.error =
                Some("Clone was interrupted by NAC restart; retry safely".to_string());
            operation.progress = "Interrupted".to_string();
            operation.updated_at_unix_ms = now_ms()?;
            self.inner.operation_store.save(&operation)?;
            reconciled += 1;
        }
        Ok(reconciled)
    }

    async fn run_clone(
        &self,
        mut prepared: PreparedClone,
        cancellation: CloneCancellation,
        progress: Arc<StdMutex<String>>,
    ) {
        let result = self
            .run_clone_inner(&prepared, &cancellation, Arc::clone(&progress))
            .await;
        match result {
            Ok(project) => {
                prepared.operation.status = ManagedCloneStatus::Completed;
                prepared.operation.project = Some(project);
                prepared.operation.progress = "Clone complete".to_string();
            }
            Err(error) => {
                let cancelled = cancellation.is_cancelled() && !prepared.destination.exists();
                let _ = self.inner.operation_store.cleanup_owned_staging(
                    &prepared.staging_root,
                    &prepared.operation.operation_id,
                );
                prepared.operation.status = if cancelled {
                    ManagedCloneStatus::Cancelled
                } else {
                    ManagedCloneStatus::Failed
                };
                prepared.operation.progress = if cancelled {
                    "Cancelled".to_string()
                } else {
                    "Clone failed".to_string()
                };
                prepared.operation.error = Some(sanitize_error(&error.to_string(), None));
            }
        }
        prepared.operation.updated_at_unix_ms = now_ms().unwrap_or(u64::MAX);
        if let Err(error) = self.inner.operation_store.save(&prepared.operation) {
            eprintln!(
                "nac: failed to persist managed clone operation {}: {error:#}",
                prepared.operation.operation_id
            );
        }
        drop(prepared.destination_reservation);
    }

    async fn run_clone_inner(
        &self,
        prepared: &PreparedClone,
        cancellation: &CloneCancellation,
        progress: Arc<StdMutex<String>>,
    ) -> Result<ProjectRecord> {
        if cancellation.is_cancelled() {
            bail!("clone cancelled before process spawn");
        }
        let token = match self.inner.github.as_ref() {
            Some(github) => github.current_token().await?,
            None => None,
        };
        self.inner
            .git
            .run(
                &prepared.request.clone_url,
                &prepared.request.branch,
                &prepared.checkout,
                cancellation,
                progress,
                token.as_ref(),
            )
            .await?;
        if cancellation.is_cancelled() {
            bail!("clone cancelled before publication");
        }
        let cloned_identity = self.inner.git.repository_identity(&prepared.checkout)?;
        if cloned_identity.as_deref() != Some(prepared.source_identity.as_str()) {
            bail!("cloned checkout origin does not match the requested repository");
        }
        if prepared.destination.exists() {
            bail!("managed clone destination collided before publication");
        }
        std::fs::rename(&prepared.checkout, &prepared.destination).with_context(|| {
            format!(
                "failed to publish cloned checkout to {}",
                prepared.destination.display()
            )
        })?;
        std::fs::remove_file(prepared.staging_root.join("owner.json"))?;
        std::fs::remove_dir(&prepared.staging_root)?;
        self.create_project(&prepared.request, &prepared.destination)
    }

    fn create_project(
        &self,
        request: &ManagedCloneRequest,
        destination: &Path,
    ) -> Result<ProjectRecord> {
        self.inner.project_registrar.register_project(NewProject {
            project_id: request.project_id.clone(),
            name: Some(request.project_name.clone()),
            description: request.project_description.clone(),
            cwd: destination.to_path_buf(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        })
    }

    fn resolve_destination(&self, relative: &Path) -> Result<PathBuf> {
        if relative.as_os_str().is_empty() || relative.is_absolute() {
            bail!("managed clone destination must be a nonempty relative path");
        }
        let components = relative.components().collect::<Vec<_>>();
        if components.len() != 1 || !matches!(components[0], Component::Normal(_)) {
            bail!(
                "managed clone destination must be one directory name beneath the repository root"
            );
        }
        let name = components[0].as_os_str().to_string_lossy();
        if name.starts_with(".nac-clone-") || name.starts_with(".nac-destination-") {
            bail!("managed clone destination uses a reserved NAC name");
        }
        let destination = self.inner.repository_root.join(relative);
        match std::fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                bail!("managed clone destination cannot be a symlink")
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(destination)
    }
}

fn validate_github_clone_request(request: &ManagedCloneRequest) -> Result<String> {
    let (owner, repository) = request
        .repository
        .split_once('/')
        .ok_or_else(|| anyhow!("managed repository must use owner/name form"))?;
    validate_repo_component(owner)?;
    validate_repo_component(repository)?;
    if !owner.eq_ignore_ascii_case("arcee-ai") {
        bail!("managed repository owner must be arcee-ai");
    }
    let url = Url::parse(&request.clone_url).context("invalid managed repository clone URL")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("managed repository clone URL must be canonical GitHub HTTPS");
    }
    let segments = url
        .path_segments()
        .ok_or_else(|| anyhow!("managed repository clone URL has no path"))?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        bail!("managed repository clone URL must name exactly one repository");
    }
    let url_repository = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    if !segments[0].eq_ignore_ascii_case(owner) || !url_repository.eq_ignore_ascii_case(repository)
    {
        bail!("managed repository clone URL does not match the selected repository");
    }
    Ok(format!(
        "github.com/{}/{}",
        owner.to_ascii_lowercase(),
        repository.to_ascii_lowercase()
    ))
}

fn validate_repo_component(value: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.chars().any(char::is_whitespace)
    {
        bail!("invalid managed repository name");
    }
    Ok(())
}

fn validate_branch(branch: &str) -> Result<()> {
    if branch.trim().is_empty()
        || branch.len() > 255
        || branch.starts_with('-')
        || branch.chars().any(char::is_control)
    {
        bail!("invalid managed repository branch");
    }
    Ok(())
}

fn validate_project_fields(request: &ManagedCloneRequest) -> Result<()> {
    if request.project_id.trim().is_empty() || request.project_name.trim().is_empty() {
        bail!("managed clone project id and name must not be blank");
    }
    if request.project_name.chars().count() > 120
        || request.project_name.chars().any(char::is_control)
    {
        bail!("managed clone Project name is invalid");
    }
    if let Some(description) = request.project_description.as_deref() {
        if description.trim().chars().count() > 2_000
            || description
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
        {
            bail!("managed clone Project description is invalid");
        }
    }
    Ok(())
}

fn now_ms() -> Result<u64> {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock is before the Unix epoch")?
            .as_millis(),
    )
    .context("system clock value does not fit in u64")
}

#[cfg(test)]
#[path = "clone_workflow_tests.rs"]
mod tests;
