//! Restart-honest managed repository clone operations.
//!
//! The live process is intentionally not restart durable. A versioned
//! filesystem record and operation-owned staging marker let a later process
//! classify interruption and remove only staging it can prove it owns.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Notify;
use url::Url;

use crate::managed_github::ManagedGitHubAuth;
use crate::model::auth_store::{
    acquire_credential_lock, read_auth_string_from_path, try_acquire_credential_lock,
    write_auth_string_to_path, FileLock,
};
use crate::process::ProcessTreeGuard;
use crate::projects::{self, NewProject, ProjectRecord};

const OPERATION_VERSION: u32 = 1;
const MARKER_VERSION: u32 = 1;
const MAX_PROGRESS_BYTES: usize = 64 * 1024;

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
    operation_root: PathBuf,
    home_root: PathBuf,
    store_path: PathBuf,
    git_executable: PathBuf,
    github: Option<ManagedGitHubAuth>,
    live: StdMutex<HashMap<String, LiveClone>>,
}

#[derive(Clone)]
struct LiveClone {
    cancellation: CloneCancellation,
    progress: Arc<StdMutex<String>>,
}

#[derive(Clone, Default)]
struct CloneCancellation {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    activity: Arc<Notify>,
}

impl CloneCancellation {
    fn cancel(&self) {
        if !self
            .cancelled
            .swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            self.activity.notify_waiters();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::Acquire)
    }

    async fn cancelled(&self) {
        loop {
            let notified = self.activity.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StagingMarker {
    version: u32,
    operation_id: String,
    destination: PathBuf,
    source_identity: String,
}

struct PreparedClone {
    operation: ManagedCloneOperation,
    request: ManagedCloneRequest,
    destination: PathBuf,
    staging_root: PathBuf,
    checkout: PathBuf,
    source_identity: String,
    destination_lock: FileLock,
}

impl ManagedCloneService {
    pub fn new(
        repository_root: impl AsRef<Path>,
        state_root: impl AsRef<Path>,
        home_root: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
        github: Option<ManagedGitHubAuth>,
    ) -> Result<Self> {
        Self::new_with_git_executable(
            repository_root,
            state_root,
            home_root,
            store_path,
            github,
            PathBuf::from("git"),
        )
    }

    fn new_with_git_executable(
        repository_root: impl AsRef<Path>,
        state_root: impl AsRef<Path>,
        home_root: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
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
        let operation_root = state_root.as_ref().join("managed_clone_operations");
        std::fs::create_dir_all(&operation_root).with_context(|| {
            format!(
                "failed to create managed clone operation root {}",
                operation_root.display()
            )
        })?;
        std::fs::create_dir_all(home_root.as_ref()).with_context(|| {
            format!(
                "failed to create managed home root {}",
                home_root.as_ref().display()
            )
        })?;
        let service = Self {
            inner: Arc::new(ManagedCloneServiceInner {
                repository_root,
                operation_root,
                home_root: home_root.as_ref().to_path_buf(),
                store_path: store_path.as_ref().to_path_buf(),
                git_executable,
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
        let lock_path = destination_lock_path(&self.inner.repository_root, &destination);
        let destination_lock = try_acquire_credential_lock(&lock_path)?.ok_or_else(|| {
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
        let marker = StagingMarker {
            version: MARKER_VERSION,
            operation_id: operation_id.clone(),
            destination: destination.clone(),
            source_identity: source_identity.clone(),
        };
        self.save_marker(&staging_root, &marker)?;
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
        self.save_operation(&operation)?;

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
            destination_lock,
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
        validate_operation_id(operation_id)?;
        let mut operation = self.load_operation(operation_id)?;
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
        validate_operation_id(operation_id)?;
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
        for entry in std::fs::read_dir(&self.inner.operation_root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(raw) = read_auth_string_from_path(&path)? else {
                continue;
            };
            let mut operation: ManagedCloneOperation = serde_json::from_str(&raw)
                .map_err(|_| anyhow!("managed clone operation file is not valid JSON"))?;
            if operation.version != OPERATION_VERSION {
                bail!(
                    "unsupported managed clone operation version {}",
                    operation.version
                );
            }
            if operation.status != ManagedCloneStatus::Running {
                continue;
            }
            let destination_lock_path =
                destination_lock_path(&self.inner.repository_root, &operation.destination);
            let Some(_destination_lock) = try_acquire_credential_lock(&destination_lock_path)?
            else {
                // Another NAC process still owns this operation. Its durable
                // record remains running and that process remains responsible
                // for progress, completion, and cancellation.
                continue;
            };
            if let Some(project) = crate::projects::list_projects(&self.inner.store_path)?
                .into_iter()
                .find(|project| project.project_id == operation.project_id)
            {
                if project.cwd == operation.destination
                    && existing_repository_identity(
                        &self.inner.git_executable,
                        &operation.destination,
                    )?
                    .as_deref()
                        == Some(operation.source_identity.as_str())
                {
                    operation.status = ManagedCloneStatus::Completed;
                    operation.project = Some(project);
                    operation.progress = "Clone complete".to_string();
                    operation.error = None;
                    operation.updated_at_unix_ms = now_ms()?;
                    self.save_operation(&operation)?;
                    reconciled += 1;
                    continue;
                }
            }
            let staging_root = self
                .inner
                .repository_root
                .join(format!(".nac-clone-{}", operation.operation_id));
            self.cleanup_owned_staging(&staging_root, &operation.operation_id)?;
            operation.status = ManagedCloneStatus::Interrupted;
            operation.error =
                Some("Clone was interrupted by NAC restart; retry safely".to_string());
            operation.progress = "Interrupted".to_string();
            operation.updated_at_unix_ms = now_ms()?;
            self.save_operation(&operation)?;
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
                let _ = self.cleanup_owned_staging(
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
                prepared.operation.error = Some(sanitize_clone_error(&error.to_string(), None));
            }
        }
        prepared.operation.updated_at_unix_ms = now_ms().unwrap_or(u64::MAX);
        if let Err(error) = self.save_operation(&prepared.operation) {
            eprintln!(
                "nac: failed to persist managed clone operation {}: {error:#}",
                prepared.operation.operation_id
            );
        }
        drop(prepared.destination_lock);
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
        let mut command = Command::new(&self.inner.git_executable);
        command
            .arg("clone")
            .arg("--progress")
            .arg("--single-branch")
            .arg("--branch")
            .arg(&prepared.request.branch)
            .arg("--")
            .arg(&prepared.request.clone_url)
            .arg(&prepared.checkout)
            .env("HOME", &self.inner.home_root)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "0")
            .env("GH_PROMPT_DISABLED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (mut child, mut process_tree) = ProcessTreeGuard::spawn_supervised(&mut command)
            .context("failed to spawn managed Git clone")?;
        let stdout = child.stdout.take().expect("piped Git stdout");
        let stderr = child.stderr.take().expect("piped Git stderr");
        let stdout_progress = Arc::clone(&progress);
        let stderr_progress = Arc::clone(&progress);
        let stdout_reader = tokio::spawn(read_progress(stdout, stdout_progress));
        let stderr_reader = tokio::spawn(read_progress(stderr, stderr_progress));
        let (status, was_cancelled) = tokio::select! {
            status = child.wait() => (
                status.context("failed to wait for managed Git clone")?,
                false,
            ),
            _ = cancellation.cancelled() => {
                process_tree
                    .terminate(&mut child)
                    .await
                    .context("failed to terminate cancelled Git clone")?;
                let status = child
                    .wait()
                    .await
                    .context("failed to reap cancelled Git clone")?;
                (status, true)
            }
        };
        process_tree.mark_leader_reaped();
        process_tree.finish().await;
        let stdout = stdout_reader.await.context("Git stdout reader stopped")??;
        let stderr = stderr_reader.await.context("Git stderr reader stopped")??;
        if was_cancelled {
            bail!("clone cancelled");
        }
        if !status.success() {
            let diagnostic = if stderr.trim().is_empty() {
                stdout
            } else {
                stderr
            };
            bail!(
                "Git clone failed with status {}: {}",
                status,
                sanitize_clone_error(&diagnostic, token.as_ref().map(|token| token.secret()))
            );
        }
        if cancellation.is_cancelled() {
            bail!("clone cancelled before publication");
        }
        let cloned_identity =
            existing_repository_identity(&self.inner.git_executable, &prepared.checkout)?;
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
        projects::insert_project(
            &self.inner.store_path,
            NewProject {
                project_id: request.project_id.clone(),
                name: Some(request.project_name.clone()),
                description: request.project_description.clone(),
                cwd: destination.to_path_buf(),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            },
        )
        .map_err(anyhow::Error::new)
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

    fn save_operation(&self, operation: &ManagedCloneOperation) -> Result<()> {
        validate_operation_id(&operation.operation_id)?;
        let path = self.operation_path(&operation.operation_id);
        let lock_path = path.with_extension("json.lock");
        let _lock = acquire_credential_lock(&lock_path)?;
        write_auth_string_to_path(&path, &serde_json::to_string_pretty(operation)?)
    }

    fn load_operation(&self, operation_id: &str) -> Result<Option<ManagedCloneOperation>> {
        let Some(raw) = read_auth_string_from_path(&self.operation_path(operation_id))? else {
            return Ok(None);
        };
        let operation: ManagedCloneOperation = serde_json::from_str(&raw)
            .map_err(|_| anyhow!("managed clone operation file is not valid JSON"))?;
        if operation.version != OPERATION_VERSION || operation.operation_id != operation_id {
            bail!("managed clone operation identity/version mismatch");
        }
        Ok(Some(operation))
    }

    fn operation_path(&self, operation_id: &str) -> PathBuf {
        self.inner
            .operation_root
            .join(format!("{operation_id}.json"))
    }

    fn save_marker(&self, staging_root: &Path, marker: &StagingMarker) -> Result<()> {
        write_auth_string_to_path(
            &staging_root.join("owner.json"),
            &serde_json::to_string_pretty(marker)?,
        )
    }

    fn cleanup_owned_staging(&self, staging_root: &Path, operation_id: &str) -> Result<bool> {
        let metadata = match std::fs::symlink_metadata(staging_root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            bail!("refusing to clean non-directory managed clone staging path");
        }
        let Some(raw) = read_auth_string_from_path(&staging_root.join("owner.json"))? else {
            bail!("refusing to clean managed clone staging without an ownership marker");
        };
        let marker: StagingMarker = serde_json::from_str(&raw)
            .map_err(|_| anyhow!("managed clone staging ownership marker is invalid"))?;
        if marker.version != MARKER_VERSION || marker.operation_id != operation_id {
            bail!("refusing to clean managed clone staging owned by another operation");
        }
        let expected = self
            .inner
            .repository_root
            .join(format!(".nac-clone-{operation_id}"));
        if staging_root != expected {
            bail!("refusing to clean unexpected managed clone staging path");
        }
        std::fs::remove_dir_all(staging_root)?;
        Ok(true)
    }
}

async fn read_progress<R>(mut reader: R, progress: Arc<StdMutex<String>>) -> Result<String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut retained = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        retained.extend_from_slice(&buffer[..read]);
        if retained.len() > MAX_PROGRESS_BYTES {
            let excess = retained.len() - MAX_PROGRESS_BYTES;
            retained.drain(..excess);
        }
        let preview = String::from_utf8_lossy(&retained)
            .chars()
            .rev()
            .take(2_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        *progress
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = preview;
    }
    Ok(String::from_utf8_lossy(&retained).into_owned())
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

fn validate_operation_id(operation_id: &str) -> Result<()> {
    if operation_id.len() != 32
        || !operation_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        bail!("invalid managed clone operation id");
    }
    Ok(())
}

fn destination_lock_path(repository_root: &Path, destination: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(destination.as_os_str().as_encoded_bytes());
    repository_root.join(format!(".nac-destination-{:x}.lock", digest))
}

fn existing_repository_identity(
    git_executable: &Path,
    destination: &Path,
) -> Result<Option<String>> {
    if !destination.exists() {
        return Ok(None);
    }
    let output = std::process::Command::new(git_executable)
        .arg("-C")
        .arg(destination)
        .args(["config", "--get", "remote.origin.url"])
        .output()
        .context("failed to inspect existing clone destination")?;
    if !output.status.success() {
        return Ok(None);
    }
    let remote =
        String::from_utf8(output.stdout).context("existing Git remote is not valid UTF-8")?;
    canonical_remote_identity(remote.trim()).map(Some)
}

fn canonical_remote_identity(remote: &str) -> Result<String> {
    if let Some(path) = remote.strip_prefix("git@github.com:") {
        return canonical_github_path(path);
    }
    if let Ok(url) = Url::parse(remote) {
        if url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
        {
            let safe_https = url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none();
            let safe_ssh = url.scheme() == "ssh"
                && matches!(url.username(), "" | "git")
                && url.password().is_none()
                && url.port().is_none();
            if (!safe_https && !safe_ssh) || url.query().is_some() || url.fragment().is_some() {
                bail!("unsupported or credential-bearing GitHub remote identity");
            }
            return canonical_github_path(url.path());
        }
        if url.scheme() == "file"
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
        {
            return Ok(format!("file:{}", url.path()));
        }
    }
    let path = Path::new(remote);
    if path.is_absolute() {
        return Ok(format!("file:{}", std::fs::canonicalize(path)?.display()));
    }
    bail!("unsupported Git remote identity")
}

fn canonical_github_path(path: &str) -> Result<String> {
    let segments = path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        bail!("invalid GitHub remote identity");
    }
    let repository = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    validate_repo_component(segments[0])?;
    validate_repo_component(repository)?;
    Ok(format!(
        "github.com/{}/{}",
        segments[0].to_ascii_lowercase(),
        repository.to_ascii_lowercase()
    ))
}

fn sanitize_clone_error(message: &str, token: Option<&str>) -> String {
    let mut sanitized = message.to_string();
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        sanitized = sanitized.replace(token, "[REDACTED]");
    }
    if sanitized.len() > 4_000 {
        sanitized.truncate(4_000);
        sanitized.push('…');
    }
    sanitized
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
mod tests {
    use std::ffi::OsStr;
    use std::process::Command as StdCommand;
    use std::time::Duration;

    use super::*;

    struct Fixture {
        root: PathBuf,
        repository_root: PathBuf,
        state_root: PathBuf,
        home_root: PathBuf,
        store_path: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "nac-managed-clone-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            let repository_root = root.join("repositories");
            let state_root = root.join("state");
            let home_root = root.join("home");
            let store_path = root.join("store.sqlite3");
            for path in [&repository_root, &state_root, &home_root] {
                std::fs::create_dir_all(path).unwrap();
            }
            crate::store::initialize(&store_path).unwrap();
            Self {
                root,
                repository_root,
                state_root,
                home_root,
                store_path,
            }
        }

        fn service(&self) -> ManagedCloneService {
            ManagedCloneService::new(
                &self.repository_root,
                &self.state_root,
                &self.home_root,
                &self.store_path,
                None,
            )
            .unwrap()
        }

        fn service_with_git(&self, git_executable: PathBuf) -> ManagedCloneService {
            ManagedCloneService::new_with_git_executable(
                &self.repository_root,
                &self.state_root,
                &self.home_root,
                &self.store_path,
                None,
                git_executable,
            )
            .unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn run(command: &mut StdCommand) {
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git<I, S>(cwd: Option<&Path>, args: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = StdCommand::new("git");
        if let Some(cwd) = cwd {
            command.arg("-C").arg(cwd);
        }
        command.args(args);
        run(&mut command);
    }

    fn local_remote(root: &Path, name: &str) -> PathBuf {
        let source = root.join(format!("{name}-source"));
        let bare = root.join(format!("{name}.git"));
        std::fs::create_dir_all(&source).unwrap();
        git(Some(&source), ["init", "-b", "main"]);
        git(Some(&source), ["config", "user.name", "NAC Test"]);
        git(Some(&source), ["config", "user.email", "nac@example.test"]);
        std::fs::write(source.join("README.md"), "main\n").unwrap();
        git(Some(&source), ["add", "README.md"]);
        git(Some(&source), ["commit", "-m", "main"]);
        git(Some(&source), ["checkout", "-b", "feature"]);
        std::fs::write(source.join("FEATURE.md"), "feature\n").unwrap();
        git(Some(&source), ["add", "FEATURE.md"]);
        git(Some(&source), ["commit", "-m", "feature"]);
        git(Some(&source), ["checkout", "main"]);
        let mut clone = StdCommand::new("git");
        clone.arg("clone").arg("--bare").arg(&source).arg(&bare);
        run(&mut clone);
        bare
    }

    fn request(remote: &Path, destination: &str, branch: &str) -> ManagedCloneRequest {
        ManagedCloneRequest {
            repository_id: 42,
            repository: "arcee-ai/example".to_string(),
            clone_url: remote.display().to_string(),
            branch: branch.to_string(),
            destination: PathBuf::from(destination),
            project_id: uuid::Uuid::new_v4().to_string(),
            project_name: "Example".to_string(),
            project_description: Some("Managed test clone".to_string()),
        }
    }

    async fn wait_for_terminal(
        service: &ManagedCloneService,
        operation_id: &str,
    ) -> ManagedCloneOperation {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let operation = service.operation(operation_id).unwrap().unwrap();
                if operation.status.is_terminal() {
                    return operation;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("managed clone did not settle")
    }

    #[tokio::test]
    async fn selected_non_default_branch_is_published_before_project_creation() {
        let fixture = Fixture::new("branch");
        let remote = local_remote(&fixture.root, "origin");
        let identity = canonical_remote_identity(&remote.display().to_string()).unwrap();
        let service = fixture.service();
        let started = service
            .start_validated(request(&remote, "example", "feature"), identity)
            .unwrap();
        assert!(crate::projects::list_projects(&fixture.store_path)
            .unwrap()
            .is_empty());

        let completed = wait_for_terminal(&service, &started.operation_id).await;
        assert_eq!(completed.status, ManagedCloneStatus::Completed);
        let destination = service.repository_root().join("example");
        assert!(destination.join("FEATURE.md").is_file());
        let output = StdCommand::new("git")
            .arg("-C")
            .arg(&destination)
            .args(["branch", "--show-current"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "feature");
        let projects = crate::projects::list_projects(&fixture.store_path).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].cwd, destination);
        assert!(!fixture
            .repository_root
            .join(format!(".nac-clone-{}", started.operation_id))
            .exists());
    }

    #[tokio::test]
    async fn every_existing_checkout_is_preserved_and_rejected() {
        let fixture = Fixture::new("existing");
        let remote = local_remote(&fixture.root, "origin");
        let other = local_remote(&fixture.root, "other");
        let destination = fixture.repository_root.join("existing");
        let mut clone = StdCommand::new("git");
        clone.arg("clone").arg(&remote).arg(&destination);
        run(&mut clone);
        std::fs::write(destination.join("LOCAL.md"), "preserve me\n").unwrap();
        let service = fixture.service();
        let identity = canonical_remote_identity(&remote.display().to_string()).unwrap();
        let error = service
            .start_validated(request(&remote, "existing", "main"), identity)
            .unwrap_err();
        assert!(error.to_string().contains("choose another destination"));
        assert!(error.to_string().contains("ordinary Project"));
        assert_eq!(
            std::fs::read_to_string(destination.join("LOCAL.md")).unwrap(),
            "preserve me\n"
        );
        assert!(crate::projects::list_projects(&fixture.store_path)
            .unwrap()
            .is_empty());

        let mismatch_destination = fixture.repository_root.join("mismatch");
        let mut clone = StdCommand::new("git");
        clone.arg("clone").arg(&other).arg(&mismatch_destination);
        run(&mut clone);
        let identity = canonical_remote_identity(&remote.display().to_string()).unwrap();
        let error = service
            .start_validated(request(&remote, "mismatch", "main"), identity)
            .unwrap_err();
        assert!(error.to_string().contains("choose another destination"));
        assert!(mismatch_destination.join("README.md").is_file());
        assert!(crate::projects::list_projects(&fixture.store_path)
            .unwrap()
            .is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_and_destination_race_are_bounded_and_project_last() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("cancel-race");
        let fake_git = fixture.root.join("slow-git");
        std::fs::write(
            &fake_git,
            "#!/bin/sh\nprintf 'waiting for cancellation\\n' >&2\nwhile :; do sleep 1; done\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_git, std::fs::Permissions::from_mode(0o700)).unwrap();
        let source = fixture.root.join("source");
        std::fs::create_dir(&source).unwrap();
        let identity = canonical_remote_identity(&source.display().to_string()).unwrap();
        let first = fixture.service_with_git(fake_git.clone());
        let started = first
            .start_validated(request(&source, "reserved", "main"), identity.clone())
            .unwrap();

        let second = fixture.service_with_git(fake_git);
        let error = second
            .start_validated(request(&source, "reserved", "main"), identity)
            .unwrap_err();
        assert!(error.to_string().contains("already reserves"));
        assert!(crate::projects::list_projects(&fixture.store_path)
            .unwrap()
            .is_empty());
        assert!(first.cancel(&started.operation_id).unwrap());
        let cancelled = wait_for_terminal(&first, &started.operation_id).await;
        assert_eq!(cancelled.status, ManagedCloneStatus::Cancelled);
        assert!(!fixture.repository_root.join("reserved").exists());
        assert!(!fixture
            .repository_root
            .join(format!(".nac-clone-{}", started.operation_id))
            .exists());
        assert!(crate::projects::list_projects(&fixture.store_path)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn startup_reconciliation_cleans_only_owned_staging_and_marks_interrupted() {
        let fixture = Fixture::new("restart");
        let service = fixture.service();
        let operation_id = "0123456789abcdef0123456789abcdef".to_string();
        let destination = fixture.repository_root.join("protected");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("keep"), "do not delete").unwrap();
        let staging = fixture
            .repository_root
            .join(format!(".nac-clone-{operation_id}"));
        std::fs::create_dir(&staging).unwrap();
        std::fs::write(staging.join("partial"), "partial").unwrap();
        service
            .save_marker(
                &staging,
                &StagingMarker {
                    version: MARKER_VERSION,
                    operation_id: operation_id.clone(),
                    destination: destination.clone(),
                    source_identity: "file:/source".to_string(),
                },
            )
            .unwrap();
        let now = now_ms().unwrap();
        service
            .save_operation(&ManagedCloneOperation {
                version: OPERATION_VERSION,
                operation_id: operation_id.clone(),
                status: ManagedCloneStatus::Running,
                repository_id: 42,
                repository: "arcee-ai/example".to_string(),
                source_identity: "file:/source".to_string(),
                branch: "main".to_string(),
                destination: destination.clone(),
                project_id: "project-restart".to_string(),
                project_name: "Restart".to_string(),
                project: None,
                progress: "Cloning".to_string(),
                error: None,
                reused_existing_checkout: false,
                created_at_unix_ms: now,
                updated_at_unix_ms: now,
            })
            .unwrap();

        let restarted = fixture.service();
        let operation = restarted.operation(&operation_id).unwrap().unwrap();
        assert_eq!(operation.status, ManagedCloneStatus::Interrupted);
        assert!(!staging.exists());
        assert_eq!(
            std::fs::read_to_string(destination.join("keep")).unwrap(),
            "do not delete"
        );
    }

    #[test]
    fn startup_reconciliation_recovers_crash_after_project_last_commit() {
        let fixture = Fixture::new("restart-project-last");
        let remote = local_remote(&fixture.root, "origin");
        let destination = fixture.repository_root.join("published");
        let mut clone = StdCommand::new("git");
        clone.arg("clone").arg(&remote).arg(&destination);
        run(&mut clone);
        let project_id = "project-published".to_string();
        let project = crate::projects::insert_project(
            &fixture.store_path,
            NewProject {
                project_id: project_id.clone(),
                name: Some("Published".to_string()),
                description: None,
                cwd: destination.clone(),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            },
        )
        .unwrap();
        let service = fixture.service();
        let operation_id = "abcdef0123456789abcdef0123456789".to_string();
        let now = now_ms().unwrap();
        service
            .save_operation(&ManagedCloneOperation {
                version: OPERATION_VERSION,
                operation_id: operation_id.clone(),
                status: ManagedCloneStatus::Running,
                repository_id: 42,
                repository: "arcee-ai/example".to_string(),
                source_identity: canonical_remote_identity(&remote.display().to_string()).unwrap(),
                branch: "main".to_string(),
                destination,
                project_id,
                project_name: "Published".to_string(),
                project: None,
                progress: "Publishing".to_string(),
                error: None,
                reused_existing_checkout: false,
                created_at_unix_ms: now,
                updated_at_unix_ms: now,
            })
            .unwrap();

        let restarted = fixture.service();
        let operation = restarted.operation(&operation_id).unwrap().unwrap();
        assert_eq!(operation.status, ManagedCloneStatus::Completed);
        assert_eq!(operation.project, Some(project));
    }

    #[cfg(unix)]
    #[test]
    fn destination_validation_rejects_escape_symlink_and_non_git_collision() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("paths");
        let source = fixture.root.join("source");
        std::fs::create_dir(&source).unwrap();
        let identity = canonical_remote_identity(&source.display().to_string()).unwrap();
        let service = fixture.service();
        let error = service
            .start_validated(request(&source, "../escape", "main"), identity.clone())
            .unwrap_err();
        assert!(error.to_string().contains("one directory name"));

        let outside = fixture.root.join("outside");
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, fixture.repository_root.join("link")).unwrap();
        let error = service
            .start_validated(request(&source, "link", "main"), identity.clone())
            .unwrap_err();
        assert!(error.to_string().contains("symlink"));

        let collision = fixture.repository_root.join("collision");
        std::fs::create_dir(&collision).unwrap();
        std::fs::write(collision.join("keep"), "keep").unwrap();
        let error = service
            .start_validated(request(&source, "collision", "main"), identity)
            .unwrap_err();
        assert!(error.to_string().contains("choose another destination"));
        assert!(error.to_string().contains("ordinary Project"));
        assert_eq!(
            std::fs::read_to_string(collision.join("keep")).unwrap(),
            "keep"
        );

        assert_eq!(
            canonical_remote_identity("git@github.com:Arcee-AI/Example.git").unwrap(),
            "github.com/arcee-ai/example"
        );
        assert_eq!(
            canonical_remote_identity("ssh://git@github.com/arcee-ai/example.git").unwrap(),
            "github.com/arcee-ai/example"
        );
        assert!(
            canonical_remote_identity("https://secret@github.com/arcee-ai/example.git").is_err()
        );
    }
}
