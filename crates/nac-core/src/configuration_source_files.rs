//! Shared no-follow source descriptors for configuration and catalog owners.
//! These are filesystem resources, never admission or runtime authority.
use anyhow::{anyhow, ensure, Result};
use fs2::FileExt;
use std::{
    ffi::{CString, OsStr},
    fs::File,
    os::{
        fd::{AsRawFd, FromRawFd, RawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::Path,
};
mod directory_path;
pub(crate) use directory_path::DirectoryPath;

fn unavailable() -> anyhow::Error {
    anyhow!("original source unavailable")
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Identity {
    device: u64,
    inode: u64,
    mode: u32,
    uid: u32,
    gid: u32,
}
impl Identity {
    pub(crate) fn read(file: &File) -> Result<Self> {
        let m = file.metadata()?;
        Ok(Self {
            device: m.dev(),
            inode: m.ino(),
            mode: m.mode(),
            uid: m.uid(),
            gid: m.gid(),
        })
    }
}
struct Directory {
    file: File,
    name: Option<CString>,
    identity: Identity,
}
pub(crate) struct ParentAnchor {
    directories: Vec<Directory>,
}
pub(crate) fn name(value: &OsStr) -> Result<CString> {
    let bytes = value.as_bytes();
    ensure!(
        !bytes.is_empty() && bytes != b"." && bytes != b".." && !bytes.contains(&b'/'),
        "invalid source component"
    );
    Ok(CString::new(bytes)?)
}
fn open_at(parent: RawFd, name: &CString, flags: i32) -> std::io::Result<File> {
    // SAFETY: name owns a NUL-terminated component for this call. parent is an
    // original live descriptor (or AT_FDCWD); openat returns a new owned fd.
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            flags | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: a successful openat above returned a fresh descriptor. This is
    // its sole owner; the File closes it exactly once.
    Ok(unsafe { File::from_raw_fd(fd) })
}
impl ParentAnchor {
    pub(crate) fn capture(path: &Path) -> Result<Self> {
        let mut components = path.components();
        ensure!(
            matches!(components.next(), Some(std::path::Component::RootDir)),
            "source parent must be absolute"
        );
        let root_name = CString::new("/")?;
        let root = open_at(
            libc::AT_FDCWD,
            &root_name,
            libc::O_RDONLY | libc::O_DIRECTORY,
        )?;
        let identity = Identity::read(&root)?;
        let mut directories = vec![Directory {
            file: root,
            name: None,
            identity,
        }];
        for component in components {
            let std::path::Component::Normal(component) = component else {
                anyhow::bail!("invalid source ancestor");
            };
            let component = name(component)?;
            let file = open_at(
                directories.last().ok_or_else(unavailable)?.file.as_raw_fd(),
                &component,
                libc::O_RDONLY | libc::O_DIRECTORY,
            )?;
            let identity = Identity::read(&file)?;
            directories.push(Directory {
                file,
                name: Some(component),
                identity,
            });
        }
        let anchor = Self { directories };
        anchor.check()?;
        Ok(anchor)
    }
    fn parent(&self) -> Result<RawFd> {
        Ok(self
            .directories
            .last()
            .ok_or_else(unavailable)?
            .file
            .as_raw_fd())
    }
    pub(crate) fn check(&self) -> Result<()> {
        for (index, directory) in self.directories.iter().enumerate() {
            ensure!(
                Identity::read(&directory.file)? == directory.identity,
                "original source ancestor changed"
            );
            if let Some(name) = &directory.name {
                let current = open_at(
                    self.directories[index - 1].file.as_raw_fd(),
                    name,
                    libc::O_RDONLY | libc::O_DIRECTORY,
                )?;
                ensure!(
                    Identity::read(&current)? == directory.identity,
                    "source ancestor name changed"
                );
            }
        }
        Ok(())
    }
    pub(crate) fn try_clone(&self) -> Result<Self> {
        Ok(Self {
            directories: self
                .directories
                .iter()
                .map(|directory| {
                    Ok(Directory {
                        file: directory.file.try_clone()?,
                        name: directory.name.clone(),
                        identity: directory.identity,
                    })
                })
                .collect::<Result<Vec<_>>>()?,
        })
    }
    pub(crate) fn directory_identity(&self) -> Result<Identity> {
        Ok(self.directories.last().ok_or_else(unavailable)?.identity)
    }
    pub(crate) fn directory_file(&self) -> Result<&File> {
        Ok(&self.directories.last().ok_or_else(unavailable)?.file)
    }
    pub(crate) fn child(&self, component: &CString) -> Result<Option<Self>> {
        let file = match open_at(
            self.parent()?,
            component,
            libc::O_RDONLY | libc::O_DIRECTORY,
        ) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let identity = Identity::read(&file)?;
        let mut directories = self
            .directories
            .iter()
            .map(|directory| {
                Ok(Directory {
                    file: directory.file.try_clone()?,
                    name: directory.name.clone(),
                    identity: directory.identity,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        directories.push(Directory {
            file,
            name: Some(component.clone()),
            identity,
        });
        let anchor = Self { directories };
        anchor.check()?;
        Ok(Some(anchor))
    }
    pub(crate) fn regular(&self, name: &CString, flags: i32) -> Result<Option<File>> {
        let file = match open_at(self.parent()?, name, flags) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let m = file.metadata()?;
        ensure!(
            m.is_file() && m.nlink() == 1,
            "original source file unavailable"
        );
        Ok(Some(file))
    }
}

/// Advisory publication fence on the SAME retained directory incarnation.
/// Independent shared readers coexist; an actual publisher tries exclusive.
pub(crate) struct DirectoryFence {
    anchor: ParentAnchor,
    creator: u32,
}
impl DirectoryFence {
    pub(crate) fn shared(path: &Path) -> Result<Self> {
        let anchor = ParentAnchor::capture(path)?;
        FileExt::try_lock_shared(anchor.directory_file()?)?;
        let owner = Self {
            anchor,
            creator: std::process::id(),
        };
        owner.anchor.check()?;
        Ok(owner)
    }
    pub(crate) fn exclusive(path: &Path) -> Result<Self> {
        let anchor = ParentAnchor::capture(path)?;
        FileExt::try_lock_exclusive(anchor.directory_file()?)?;
        let owner = Self {
            anchor,
            creator: std::process::id(),
        };
        owner.anchor.check()?;
        Ok(owner)
    }
    pub(crate) fn anchor(&self) -> &ParentAnchor {
        &self.anchor
    }
}
impl Drop for DirectoryFence {
    fn drop(&mut self) {
        if self.creator == std::process::id() {
            if let Ok(file) = self.anchor.directory_file() {
                let _ = FileExt::unlock(file);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_fence_drop_unlocks_inherited_open_file_description() {
        let path = std::env::temp_dir().join(format!("directory-fence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let path = path.canonicalize().unwrap();
        let owner = DirectoryFence::shared(&path).unwrap();
        let inherited = owner
            .anchor()
            .directory_file()
            .unwrap()
            .try_clone()
            .unwrap();
        assert!(DirectoryFence::exclusive(&path).is_err());
        drop(owner);
        let writer = DirectoryFence::exclusive(&path).unwrap();
        drop(inherited);
        drop(writer);
        std::fs::remove_dir(&path).unwrap();
    }
}
