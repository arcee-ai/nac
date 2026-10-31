//! Restriction-only resolution for Finder reveal. Unlike the established open
//! operation, a missing path never falls back and every component is no-follow.
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

/// Resolve an existing regular file/directory without following links beneath
/// the workspace, then revalidate its pinned identities immediately before the
/// platform handoff. The OS subsequently owns its path-based Finder operation.
pub fn resolve_local_reveal(root: &Path, relative: &str) -> Result<LocalRevealTarget> {
    LocalRevealTarget::resolve(root, relative)
}

pub struct LocalRevealTarget {
    path: PathBuf,
    #[cfg(unix)]
    pinned: Vec<(PathBuf, std::fs::File)>,
}

impl LocalRevealTarget {
    pub async fn reveal(self) -> Result<PathBuf> {
        self.revalidate()?;
        crate::browser::reveal_path(&self.path).await?;
        Ok(self.path)
    }

    #[cfg(unix)]
    fn resolve(root: &Path, relative: &str) -> Result<Self> {
        use std::ffi::CString;
        use std::fs::OpenOptions;
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::{ffi::OsStrExt, fs::OpenOptionsExt};

        let relative = crate::view::validate_workspace_relpath(relative)?;
        if relative.len() > 16_384 {
            bail!("invalid path: reveal path is too long");
        }
        let root_metadata =
            std::fs::symlink_metadata(root).context("workspace reveal root is missing")?;
        if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
            bail!("invalid path: reveal workspace root must be a directory, not a symlink");
        }
        let root = root
            .canonicalize()
            .context("workspace reveal root is missing")?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&root)
            .context("could not open reveal workspace root")?;
        use std::os::unix::fs::MetadataExt;
        let opened = file.metadata()?;
        if opened.dev() != root_metadata.dev() || opened.ino() != root_metadata.ino() {
            bail!("invalid path: reveal workspace root changed");
        }
        let mut pinned = vec![(root.clone(), file)];
        let mut path = root;
        let relative = Path::new(&relative);
        let components: Vec<_> = relative.components().collect();
        for (index, component) in components.iter().enumerate() {
            let std::path::Component::Normal(name) = component else {
                bail!("invalid path: reveal path must be relative");
            };
            let name = CString::new(name.as_bytes())?;
            let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
            if index + 1 < components.len() {
                flags |= libc::O_DIRECTORY;
            }
            // SAFETY: parent is a live pinned descriptor and name is one
            // NUL-terminated relative component. No component follows links.
            let descriptor =
                unsafe { libc::openat(pinned.last().unwrap().1.as_raw_fd(), name.as_ptr(), flags) };
            if descriptor < 0 {
                return Err(std::io::Error::last_os_error())
                    .context("invalid or missing reveal path");
            }
            // SAFETY: openat returned a new owned descriptor exactly once.
            let file = unsafe { std::fs::File::from_raw_fd(descriptor) };
            let metadata = file.metadata()?;
            if !metadata.is_file() && !metadata.is_dir() {
                bail!("invalid path: reveal target must be a regular file or directory");
            }
            path.push(component.as_os_str());
            pinned.push((path.clone(), file));
        }
        let target = Self { path, pinned };
        target.revalidate()?;
        Ok(target)
    }

    #[cfg(not(unix))]
    fn resolve(_root: &Path, _relative: &str) -> Result<Self> {
        bail!("workspace Finder reveal is only supported on macOS")
    }

    fn revalidate(&self) -> Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            for (path, file) in &self.pinned {
                let current = std::fs::symlink_metadata(path)
                    .context("workspace reveal target moved or disappeared")?;
                let pinned = file.metadata()?;
                if current.file_type().is_symlink()
                    || current.dev() != pinned.dev()
                    || current.ino() != pinned.ino()
                {
                    bail!("invalid path: workspace reveal target changed");
                }
            }
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests;
