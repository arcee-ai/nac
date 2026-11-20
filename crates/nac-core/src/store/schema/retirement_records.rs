//! Read-only recognition of retained Podman creation authority during retirement.

use super::*;

/// A matching creation record can outlive the launching process and even lack
/// a committed session row. Do not remove it or infer that a container is gone.
#[cfg(unix)]
pub(super) fn ensure_no_creation_records(
    root: &Path,
    store: &Path,
    doomed: &std::collections::BTreeSet<String>,
) -> Result<()> {
    use std::ffi::CString;
    use std::fs::{File, OpenOptions};
    use std::io::Read;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let store = store.canonicalize()?;
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("nac-podman-create-")
        {
            continue;
        }
        let metadata = match std::fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        // SAFETY: geteuid has no arguments or memory preconditions.
        if metadata.uid() != unsafe { libc::geteuid() } {
            continue;
        }
        anyhow::ensure!(
            metadata.is_dir() && !metadata.file_type().is_symlink(),
            "invalid Podman creation authority"
        );
        let directory = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(entry.path())
        {
            Ok(directory) => directory,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let opened = directory.metadata()?;
        anyhow::ensure!(
            opened.uid() == metadata.uid()
                && opened.dev() == metadata.dev()
                && opened.ino() == metadata.ino(),
            "Podman creation authority changed during inspection"
        );
        anyhow::ensure!(
            opened.mode() & 0o077 == 0,
            "Podman creation authority is not private"
        );
        let read_record = |name: &str| -> Result<Option<Vec<u8>>> {
            let name = CString::new(name)?;
            // SAFETY: directory is a live descriptor and name is a NUL-terminated
            // component. The flags prohibit symlink traversal.
            let fd = unsafe {
                libc::openat(
                    directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                )
            };
            if fd < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::NotFound {
                    return Ok(None);
                }
                return Err(error.into());
            }
            // SAFETY: successful openat returned a new descriptor owned here.
            let file = unsafe { File::from_raw_fd(fd) };
            let metadata = file.metadata()?;
            anyhow::ensure!(
                metadata.is_file()
                    && metadata.uid() == opened.uid()
                    && metadata.mode() & 0o077 == 0,
                "invalid Podman creation authority binding"
            );
            let mut bytes = Vec::new();
            file.take(16_385).read_to_end(&mut bytes)?;
            anyhow::ensure!(
                bytes.len() <= 16_384,
                "oversized Podman creation authority binding"
            );
            Ok(Some(bytes))
        };
        let Some(bytes) = read_record("store.path")? else {
            // Non-durable launches have no store binding. Their exact session
            // key distinguishes unrelated records without removing authority.
            let key = read_record("session.key")?
                .ok_or_else(|| anyhow!("unresolved Podman creation authority"))?;
            let key = std::str::from_utf8(&key)?.trim();
            anyhow::ensure!(!key.is_empty(), "unresolved Podman creation authority");
            if doomed.contains(key) {
                anyhow::bail!("unresolved Podman creation authority; drain using a compatible prior NAC binary or reset a disposable store");
            }
            continue;
        };
        let recorded_store: PathBuf = serde_json::from_slice(&bytes)
            .map_err(|_| anyhow!("unresolved Podman creation store binding"))?;
        if recorded_store == store {
            anyhow::bail!("pending Podman creation authority; drain using a compatible prior NAC binary or reset a disposable store");
        }
    }
    Ok(())
}

#[cfg(not(unix))]
pub(super) fn ensure_no_creation_records(
    _root: &Path,
    _store: &Path,
    _doomed: &std::collections::BTreeSet<String>,
) -> Result<()> {
    anyhow::bail!("cannot verify Podman creation authority on this platform")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn matching_and_unresolved_records_refuse_without_modifying_authority() {
        let root = std::env::temp_dir().join(format!(
            "nac-retirement-record-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let store = root.join("store.db");
        std::fs::write(&store, "").unwrap();
        let record = root.join("nac-podman-create-fixture");
        std::fs::create_dir(&record).unwrap();
        std::fs::set_permissions(&record, std::fs::Permissions::from_mode(0o700)).unwrap();
        let binding = record.join("store.path");
        let doomed = ["retired".to_owned()].into_iter().collect();
        let other = root.join("other.db");
        std::fs::write(&binding, serde_json::to_vec(&other).unwrap()).unwrap();
        std::fs::set_permissions(&binding, std::fs::Permissions::from_mode(0o600)).unwrap();
        ensure_no_creation_records(&root, &store, &doomed).unwrap();
        let bytes = serde_json::to_vec(&store.canonicalize().unwrap()).unwrap();
        std::fs::write(&binding, &bytes).unwrap();
        assert!(ensure_no_creation_records(&root, &store, &doomed).is_err());
        assert_eq!(std::fs::read(&binding).unwrap(), bytes);
        std::fs::remove_file(&binding).unwrap();
        assert!(ensure_no_creation_records(&root, &store, &doomed).is_err());
        let key = record.join("session.key");
        std::fs::write(&key, "other\n").unwrap();
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
        ensure_no_creation_records(&root, &store, &doomed).unwrap();
        std::fs::write(&key, "retired\n").unwrap();
        assert!(ensure_no_creation_records(&root, &store, &doomed).is_err());
        symlink(&store, &binding).unwrap();
        assert!(ensure_no_creation_records(&root, &store, &doomed).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
