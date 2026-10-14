//! Private native filesystem facts. These observations never authorize a human,
//! issue public references, select a backend, or admit an operation.
use std::{fs::File, path::PathBuf};

use crate::{filesystem, SessionManager};

/// Bounded native selectors: never a browser path or a public location ID.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManagedLocationSelector {
    RepositoryRoot,
    RegisteredProject { project_id: String },
}

/// Actual configured identity and running binary tuple, not caller expectations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedLocationBinding {
    pub logical_host_id: String,
    pub host_incarnation_id: String,
    pub configured_owner: String,
    pub release_id: String,
    pub product_version: String,
    pub build_id: String,
    pub source_revision: String,
    pub build_track: String,
    pub supported_schema_version: i64,
}

/// Actual opened directory identity. A controller still binds its own PVC UID;
/// native stat values must never be relabelled as Kubernetes PVC identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedDirectoryIdentity {
    pub device: u64,
    pub inode: u64,
    pub owner_uid: u32,
    pub owner_gid: u32,
    pub mode: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedProjectLocationIdentity {
    pub project_id: String,
    pub presentation_version: i64,
    pub created_at: String,
}

/// Trusted application output for the private issuer adapter only. It contains
/// native paths; delivery must never project this object into the public UI.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedLocationFact {
    pub binding: ManagedLocationBinding,
    pub selector: ManagedLocationSelector,
    pub repository_root: PathBuf,
    pub canonical_cwd: PathBuf,
    pub repository_identity: ManagedDirectoryIdentity,
    pub directory_identity: ManagedDirectoryIdentity,
    pub project: Option<ManagedProjectLocationIdentity>,
}

/// Pinned directories plus a freshly matched observation. This is not a lease
/// or a user grant. A mutating owner must retain its existing workspace/process
/// admission and revalidate immediately before its effect; a path alone never
/// promises atomic protection against later filesystem changes.
#[derive(Debug)]
pub struct ManagedLocationResolution {
    fact: ManagedLocationFact,
    _repository: File,
    directory: File,
}

impl ManagedLocationResolution {
    pub fn fact(&self) -> &ManagedLocationFact {
        &self.fact
    }
    pub fn directory_handle(&self) -> &File {
        &self.directory
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagedLocationFactError {
    Unmanaged,
    UnboundHost,
    InvalidSelector,
    ProjectUnavailable,
    RemoteProject,
    OutsideRepository,
    DirectoryUnavailable,
    Changed,
}

impl std::fmt::Display for ManagedLocationFactError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unmanaged => "managed location facts are unavailable on this host",
            Self::UnboundHost => "managed location host identity is incomplete",
            Self::InvalidSelector => "managed location selector is invalid",
            Self::ProjectUnavailable => "registered project location is unavailable",
            Self::RemoteProject => "registered project is not a local managed location",
            Self::OutsideRepository => "registered project is outside the managed repository root",
            Self::DirectoryUnavailable => "managed directory is unavailable or noncanonical",
            Self::Changed => "managed location fact changed; obtain a fresh observation",
        })
    }
}
impl std::error::Error for ManagedLocationFactError {}

impl SessionManager {
    /// Observe one real managed root/project. No directory listing, public ID,
    /// recovery, process launch, configuration write, or agent approval occurs.
    pub async fn managed_location_fact(
        &self,
        selector: ManagedLocationSelector,
    ) -> Result<ManagedLocationFact, ManagedLocationFactError> {
        let manager = self.clone();
        self.inner
            ._store_ownership
            .call_legacy(move || {
                manager
                    .observe_managed_location(selector)
                    .map(|resolved| resolved.fact)
            })
            .await
            .map_err(|_| ManagedLocationFactError::ProjectUnavailable)?
    }

    /// Re-read the native row, configuration/binary binding and directory
    /// identities; any changed value invalidates the prior fact. This does not
    /// resolve an opaque public ref or replace fresh resource authorization.
    pub async fn resolve_managed_location_fact(
        &self,
        expected: ManagedLocationFact,
    ) -> Result<ManagedLocationResolution, ManagedLocationFactError> {
        let manager = self.clone();
        self.inner
            ._store_ownership
            .call_legacy(move || {
                let actual = manager.observe_managed_location(expected.selector.clone())?;
                if actual.fact != expected {
                    return Err(ManagedLocationFactError::Changed);
                }
                Ok(actual)
            })
            .await
            .map_err(|_| ManagedLocationFactError::ProjectUnavailable)?
    }

    fn observe_managed_location(
        &self,
        selector: ManagedLocationSelector,
    ) -> Result<ManagedLocationResolution, ManagedLocationFactError> {
        use ManagedLocationFactError as Error;
        let config = self.managed_host().ok_or(Error::Unmanaged)?;
        let nonblank = |value: Option<&str>| {
            value
                .filter(|value| !value.trim().is_empty())
                .ok_or(Error::UnboundHost)
                .map(str::to_owned)
        };
        let host = nonblank(Some(&config.logical_host_id))?;
        let incarnation = nonblank(config.host_incarnation_id.as_deref())?;
        let owner = nonblank(config.owner.as_deref())?;
        let build = crate::build_identity::current();
        let target = crate::managed_running_target().map_err(|_| Error::UnboundHost)?;
        let binding = ManagedLocationBinding {
            logical_host_id: host,
            host_incarnation_id: incarnation,
            configured_owner: owner,
            release_id: target.release_id,
            product_version: build.product_version.to_owned(),
            build_id: build.build_id.to_owned(),
            source_revision: build.source_revision.to_owned(),
            build_track: build.track.to_owned(),
            supported_schema_version: nac_core::store::schema_version(),
        };
        let root = filesystem::open_absolute_directory(&config.repository_root)
            .map_err(|_| Error::DirectoryUnavailable)?;
        let repository_identity = directory_identity(&root)?;
        let (cwd, project) = match &selector {
            ManagedLocationSelector::RepositoryRoot => (config.repository_root.clone(), None),
            ManagedLocationSelector::RegisteredProject { project_id } => {
                if project_id.is_empty() || project_id.len() > 256 {
                    return Err(Error::InvalidSelector);
                }
                let context = nac_core::projects::load_project_launch_context(
                    &self.inner.store_path,
                    project_id,
                )
                .map_err(|_| Error::ProjectUnavailable)?;
                let project = context.project;
                if project.ssh_host.is_some()
                    || project.ssh_port.is_some()
                    || project.ssh_identity_file.is_some()
                {
                    return Err(Error::RemoteProject);
                }
                (
                    project.cwd,
                    Some(ManagedProjectLocationIdentity {
                        project_id: project.project_id,
                        presentation_version: project.presentation_version,
                        created_at: project.created_at,
                    }),
                )
            }
        };
        // The configured root is an observation selector, never a default grant.
        let relative = cwd
            .strip_prefix(&config.repository_root)
            .map_err(|_| Error::OutsideRepository)?;
        let directory = filesystem::open_directory_beneath(&root, relative)
            .map_err(|_| Error::DirectoryUnavailable)?;
        let identity = directory_identity(&directory)?;
        // Reopen through the actual names to catch root/project replacement or
        // relocation during observation; retained descriptors pin the observed objects.
        let root_now = filesystem::open_absolute_directory(&config.repository_root)
            .map_err(|_| Error::Changed)?;
        let cwd_now = filesystem::open_absolute_directory(&cwd).map_err(|_| Error::Changed)?;
        if directory_identity(&root_now)? != repository_identity
            || directory_identity(&cwd_now)? != identity
        {
            return Err(Error::Changed);
        }
        let fact = ManagedLocationFact {
            binding,
            selector,
            repository_root: config.repository_root.clone(),
            canonical_cwd: cwd,
            repository_identity,
            directory_identity: identity,
            project,
        };
        Ok(ManagedLocationResolution {
            fact,
            _repository: root,
            directory,
        })
    }
}

#[cfg(unix)]
fn directory_identity(
    directory: &File,
) -> Result<ManagedDirectoryIdentity, ManagedLocationFactError> {
    use std::os::unix::fs::MetadataExt;
    let metadata = directory
        .metadata()
        .map_err(|_| ManagedLocationFactError::DirectoryUnavailable)?;
    Ok(ManagedDirectoryIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        owner_uid: metadata.uid(),
        owner_gid: metadata.gid(),
        mode: metadata.mode(),
    })
}
#[cfg(not(unix))]
fn directory_identity(
    _directory: &File,
) -> Result<ManagedDirectoryIdentity, ManagedLocationFactError> {
    Err(ManagedLocationFactError::DirectoryUnavailable)
}

#[cfg(all(test, unix))]
#[path = "managed_locations_tests.rs"]
mod tests;
