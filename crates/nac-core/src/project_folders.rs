//! One project folder, created on purpose by a person in the working-folder
//! picker.
//!
//! The picker lists a directory; the person names one child of it; exactly
//! that child is created, on the filesystem the listing came from. Nothing is
//! created recursively, nothing is replaced, and typing a path never creates
//! anything — only this explicit operation does.
//!
//! Authority is issued here rather than claimed by the caller: a name is
//! validated, the listed parent is bound to its canonical location, and hard and
//! configured Deny are evaluated before an [`AuthorizedLocalFolder`] or
//! [`AuthorizedRemoteFolder`] exists. Those values are the only way to create
//! the folder, and they cannot be built from wire input directly.

use std::path::{Component, Path, PathBuf};

use crate::permissions::{authorize_human_directory_creation, PermissionBackend, PermissionRule};

/// The longest single name most filesystems accept (`NAME_MAX`), in bytes.
pub const MAX_FOLDER_NAME_BYTES: usize = 255;

/// Why a folder was not created. Each variant is a definite answer except
/// [`NewFolderError::Unreachable`] and [`NewFolderError::Failed`], after which
/// the folder may or may not exist and the caller must look before retrying.
#[derive(Debug)]
pub enum NewFolderError {
    /// The name is not exactly one usable folder name.
    InvalidName(String),
    /// The parent is not an absolute, normalized path, or the host was not
    /// described well enough to try.
    InvalidRequest(String),
    /// The listed parent no longer exists.
    ParentNotFound(String),
    /// The listed parent exists but is not a directory.
    ParentNotADirectory(String),
    /// The listed parent now resolves somewhere else: it was moved, or it or
    /// one of its ancestors was replaced by a symlink.
    ParentChanged(String),
    /// Something with this name is already there. It is never replaced.
    AlreadyExists(String),
    /// Hard or configured permission policy refuses this path.
    Denied { path: String, reason: String },
    /// The filesystem refused: no write access, a read-only mount, and so on.
    /// Nothing was created.
    Refused { path: String, reason: String },
    /// The SSH host could not be reached, or stopped answering. The folder may
    /// have been created before the answer was lost.
    Unreachable { host: String, reason: String },
    /// The outcome could not be confirmed.
    Failed(String),
}

impl std::fmt::Display for NewFolderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidName(reason) | Self::InvalidRequest(reason) | Self::Failed(reason) => {
                formatter.write_str(reason)
            }
            Self::ParentNotFound(path) => write!(formatter, "folder '{path}' no longer exists"),
            Self::ParentNotADirectory(path) => {
                write!(formatter, "path '{path}' is not a directory")
            }
            Self::ParentChanged(path) => write!(
                formatter,
                "folder '{path}' has moved or been replaced since it was listed; browse to it again"
            ),
            Self::AlreadyExists(path) => write!(formatter, "'{path}' already exists"),
            Self::Denied { path, reason } => {
                write!(formatter, "creating '{path}' is not allowed: {reason}")
            }
            Self::Refused { path, reason } => {
                write!(formatter, "could not create '{path}': {reason}")
            }
            Self::Unreachable { host, reason } => {
                write!(formatter, "cannot reach ssh host '{host}': {reason}")
            }
        }
    }
}

impl std::error::Error for NewFolderError {}

/// Accepts exactly one folder name and nothing that could name another place.
pub fn validate_folder_name(name: &str) -> Result<(), NewFolderError> {
    let invalid = |reason: &str| Err(NewFolderError::InvalidName(reason.to_string()));
    if name.trim().is_empty() {
        return invalid("a folder name is required");
    }
    if name.trim() != name {
        return invalid("a folder name cannot start or end with a space");
    }
    if name == "." || name == ".." {
        return invalid("'.' and '..' are not folder names");
    }
    if name.contains(['/', '\\']) {
        return invalid("a folder name cannot contain '/' or '\\'; create one folder at a time");
    }
    if name.chars().any(char::is_control) {
        return invalid("a folder name cannot contain control characters");
    }
    if name.len() > MAX_FOLDER_NAME_BYTES {
        return Err(NewFolderError::InvalidName(format!(
            "a folder name can be at most {MAX_FOLDER_NAME_BYTES} bytes long"
        )));
    }
    Ok(())
}

/// The parent must be spelled the way a listing reports it: absolute, with no
/// `.`/`..` segments and no `~`, so it names one place before anything resolves.
fn validate_parent(parent: &str) -> Result<(), NewFolderError> {
    let path = Path::new(parent);
    // `Path::components` quietly drops interior `.` segments, so the raw
    // spelling is checked as well.
    let normalized = path.is_absolute()
        && !parent.contains('\0')
        && !parent
            .split('/')
            .any(|segment| segment == "." || segment == "..")
        && path
            .components()
            .all(|component| matches!(component, Component::RootDir | Component::Normal(_)));
    if normalized {
        Ok(())
    } else {
        Err(NewFolderError::InvalidRequest(format!(
            "parent folder '{parent}' must be an absolute path as listed by the picker"
        )))
    }
}

fn authorize(
    backend: PermissionBackend,
    target: &Path,
    configured_rules: Vec<PermissionRule>,
    store_path: &Path,
) -> Result<(), NewFolderError> {
    authorize_human_directory_creation(backend, target, configured_rules, store_path).map_err(
        |reason| NewFolderError::Denied {
            path: target.display().to_string(),
            reason,
        },
    )
}

/// Authority to create one named child of a canonical local directory.
#[derive(Debug)]
pub struct AuthorizedLocalFolder {
    parent: PathBuf,
    name: String,
}

impl AuthorizedLocalFolder {
    /// Binds `parent` exactly as listed and evaluates policy on the child.
    ///
    /// A listing reports canonical paths, so a parent that no longer
    /// canonicalizes to itself has moved or been swapped for a symlink since the
    /// person saw it, and is refused rather than followed.
    pub fn issue(
        parent: &str,
        name: &str,
        configured_rules: Vec<PermissionRule>,
        store_path: &Path,
    ) -> Result<Self, NewFolderError> {
        validate_folder_name(name)?;
        validate_parent(parent)?;
        let listed = PathBuf::from(parent);
        let canonical = std::fs::canonicalize(&listed).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => NewFolderError::ParentNotFound(parent.to_string()),
            _ => NewFolderError::Refused {
                path: parent.to_string(),
                reason: error.to_string(),
            },
        })?;
        if canonical != listed {
            return Err(NewFolderError::ParentChanged(parent.to_string()));
        }
        if !canonical.is_dir() {
            return Err(NewFolderError::ParentNotADirectory(parent.to_string()));
        }
        authorize(
            PermissionBackend::Local,
            &canonical.join(name),
            configured_rules,
            store_path,
        )?;
        Ok(Self {
            parent: canonical,
            name: name.to_string(),
        })
    }

    /// The folder this authority creates.
    pub fn path(&self) -> PathBuf {
        self.parent.join(&self.name)
    }

    /// Creates the folder and returns its path.
    ///
    /// The parent is reopened from `/` one component at a time without
    /// following symlinks, so a swap after [`Self::issue`] fails instead of
    /// redirecting the write. The child is a single `mkdirat`, which fails on
    /// anything already there — a folder, a file or a dangling symlink.
    #[cfg(unix)]
    pub fn create(self) -> Result<PathBuf, NewFolderError> {
        use std::io::ErrorKind;
        use std::os::fd::AsRawFd;

        let target = self.path();
        let relative = target
            .strip_prefix("/")
            .map_err(|_| NewFolderError::ParentChanged(self.parent.display().to_string()))?;
        let parent_changed = || NewFolderError::ParentChanged(self.parent.display().to_string());
        let (directory, name) = crate::tools::mutation::open_parent_beneath(
            Path::new("/"),
            relative,
            false,
        )
        .map_err(|error| match error.raw_os_error() {
            Some(libc::ELOOP | libc::ENOTDIR) => parent_changed(),
            Some(libc::ENOENT) => NewFolderError::ParentNotFound(self.parent.display().to_string()),
            _ => NewFolderError::Refused {
                path: target.display().to_string(),
                reason: error.to_string(),
            },
        })?;
        // SAFETY: `directory` is a live no-follow directory descriptor and
        // `name` is a NUL-terminated single component without `/`.
        if unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o777) } == -1 {
            let error = std::io::Error::last_os_error();
            return Err(match error.kind() {
                ErrorKind::AlreadyExists => {
                    NewFolderError::AlreadyExists(target.display().to_string())
                }
                _ => NewFolderError::Refused {
                    path: target.display().to_string(),
                    reason: error.to_string(),
                },
            });
        }
        // What was just made must be a real directory in the bound parent.
        crate::tools::mutation::open_directory_at(&directory, &name).map_err(|error| {
            NewFolderError::Failed(format!(
                "created '{}' but could not confirm it is a folder: {error}",
                target.display()
            ))
        })?;
        Ok(target)
    }

    #[cfg(not(unix))]
    pub fn create(self) -> Result<PathBuf, NewFolderError> {
        Err(NewFolderError::Refused {
            path: self.path().display().to_string(),
            reason: "creating folders is only supported on Unix hosts".to_string(),
        })
    }
}

/// Authority to create one named child of a directory on an SSH host.
///
/// The host binds the parent itself: it enters the directory, refuses if its
/// physical path is no longer the listed one, and creates the child relative to
/// where it stands.
#[derive(Debug, Clone)]
pub struct AuthorizedRemoteFolder {
    parent: String,
    name: String,
}

impl AuthorizedRemoteFolder {
    pub fn issue(
        parent: &str,
        name: &str,
        configured_rules: Vec<PermissionRule>,
        store_path: &Path,
    ) -> Result<Self, NewFolderError> {
        validate_folder_name(name)?;
        validate_parent(parent)?;
        // Spelled the way `pwd -P` reports it, which the host compares against.
        let trimmed = parent.trim_end_matches('/');
        let folder = Self {
            parent: if trimmed.is_empty() { "/" } else { trimmed }.to_string(),
            name: name.to_string(),
        };
        authorize(
            PermissionBackend::Ssh,
            Path::new(&folder.path()),
            configured_rules,
            store_path,
        )?;
        Ok(folder)
    }

    pub(crate) fn parent(&self) -> &str {
        &self.parent
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    /// The folder this authority creates. Remote paths are POSIX whatever this
    /// machine is, so they are joined as text.
    pub fn path(&self) -> String {
        if self.parent.ends_with('/') {
            format!("{}{}", self.parent, self.name)
        } else {
            format!("{}/{}", self.parent, self.name)
        }
    }
}

#[cfg(test)]
#[path = "project_folders_tests.rs"]
mod tests;
