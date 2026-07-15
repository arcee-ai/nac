use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use fs2::FileExt;

/// A process-wide, crash-safe exclusive lease for one persisted session run.
///
/// The lease is an advisory OS file lock. It is released when this value is
/// dropped or when the owning process exits, including abnormal termination.
#[derive(Debug)]
pub struct SessionRunLease {
    _file: File,
}

impl Drop for SessionRunLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

#[derive(Debug)]
pub enum SessionRunLeaseError {
    Busy(String),
    Store(anyhow::Error),
}

impl fmt::Display for SessionRunLeaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(session_id) => write!(
                formatter,
                "session '{session_id}' is busy with an active run in another process"
            ),
            Self::Store(error) => write!(formatter, "session run lease failed: {error}"),
        }
    }
}

impl std::error::Error for SessionRunLeaseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Busy(_) => None,
            Self::Store(error) => Some(error.as_ref()),
        }
    }
}

impl SessionRunLease {
    /// Attempts to acquire a per-session lease without waiting.
    pub fn try_acquire(store_path: &Path, session_id: &str) -> Result<Self, SessionRunLeaseError> {
        let lock_path = secure_lock_path(store_path, session_id).map_err(store_error)?;
        let file = secure_open_lock_file(&lock_path).map_err(store_error)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(SessionRunLeaseError::Busy(session_id.to_string()))
            }
            Err(error) => Err(store_error(
                anyhow::Error::new(error)
                    .context(format!("failed to lock {}", lock_path.display())),
            )),
        }
    }
}

fn store_error(error: anyhow::Error) -> SessionRunLeaseError {
    SessionRunLeaseError::Store(error)
}

fn secure_lock_path(store_path: &Path, session_id: &str) -> anyhow::Result<PathBuf> {
    // Canonicalizing the existing database ensures aliases and symlinks to the
    // same store coordinate through one lock directory.
    let canonical_store = fs::canonicalize(store_path).map_err(anyhow::Error::new)?;
    let file_name = canonical_store
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("store path has no file name: {}", store_path.display()))?;
    let mut lock_dir_name = file_name.to_os_string();
    lock_dir_name.push(".run-locks");
    let lock_dir = canonical_store.with_file_name(lock_dir_name);
    secure_create_lock_dir(&lock_dir)?;

    // Hex encoding makes arbitrary persisted IDs safe as a single path
    // component without relying on a restricted session-id alphabet.
    let encoded_id = session_id
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(lock_dir.join(format!("{encoded_id}.lock")))
}

fn secure_create_lock_dir(path: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            anyhow::bail!(
                "session lock path is not a real directory: {}",
                path.display()
            );
        }
        if metadata.uid() != unsafe { libc::geteuid() } {
            anyhow::bail!("session lock directory is not owned by the current user");
        }
        if metadata.permissions().mode() & 0o777 != 0o700 {
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
    }

    #[cfg(not(unix))]
    {
        match fs::create_dir(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        if !fs::symlink_metadata(path)?.is_dir() {
            anyhow::bail!("session lock path is not a directory: {}", path.display());
        }
    }

    Ok(())
}

fn secure_open_lock_file(path: &Path) -> anyhow::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};

        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        let file = options.open(path)?;
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.nlink() != 1
        {
            anyhow::bail!(
                "session lock file is not a single-link regular file owned by the current user"
            );
        }
        if metadata.permissions().mode() & 0o777 != 0o600 {
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        return Ok(file);
    }

    #[cfg(not(unix))]
    {
        let file = options.open(path)?;
        if !file.metadata()?.is_file() {
            anyhow::bail!(
                "session lock path is not a regular file: {}",
                path.display()
            );
        }
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;
    use crate::store;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn test_store(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_run_lease_{label}_{unique}"))
            .join("store.db")
    }

    #[test]
    fn lease_is_exclusive_and_drop_releases_it() {
        let store_path = test_store("drop");
        store::initialize(&store_path).unwrap();
        let lease = SessionRunLease::try_acquire(&store_path, "../unsafe/session").unwrap();
        assert!(matches!(
            SessionRunLease::try_acquire(&store_path, "../unsafe/session"),
            Err(SessionRunLeaseError::Busy(_))
        ));
        drop(lease);
        SessionRunLease::try_acquire(&store_path, "../unsafe/session").unwrap();
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn lock_paths_are_private_and_reject_symlink_files() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let store_path = test_store("secure_path");
        store::initialize(&store_path).unwrap();
        let lock_path = secure_lock_path(&store_path, "../../session").unwrap();
        assert_eq!(
            fs::metadata(lock_path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let canonical_store = fs::canonicalize(&store_path).unwrap();
        let expected_lock_dir = canonical_store.with_file_name("store.db.run-locks");
        assert_eq!(lock_path.parent(), Some(expected_lock_dir.as_path()));

        let target = store_path.parent().unwrap().join("must-not-lock");
        fs::write(&target, b"unchanged").unwrap();
        symlink(&target, &lock_path).unwrap();
        assert!(matches!(
            SessionRunLease::try_acquire(&store_path, "../../session"),
            Err(SessionRunLeaseError::Store(_))
        ));
        assert_eq!(fs::read(&target).unwrap(), b"unchanged");
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn lease_process_helper() {
        let Some(store_path) = std::env::var_os("NAC_TEST_RUN_LEASE_STORE") else {
            return;
        };
        let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_RUN_LEASE_READY").unwrap());
        let _lease = SessionRunLease::try_acquire(Path::new(&store_path), "crash-session").unwrap();
        fs::write(ready_path, b"ready").unwrap();
        thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn process_death_releases_lease() {
        let store_path = test_store("process_death");
        store::initialize(&store_path).unwrap();
        let ready_path = store_path.parent().unwrap().join("ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "sessions::run_lease::tests::lease_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_RUN_LEASE_STORE", &store_path)
            .env("NAC_TEST_RUN_LEASE_READY", &ready_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        for _ in 0..200 {
            if ready_path.exists() {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "lease helper exited early"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready_path.exists(), "lease helper never became ready");
        assert!(matches!(
            SessionRunLease::try_acquire(&store_path, "crash-session"),
            Err(SessionRunLeaseError::Busy(_))
        ));

        child.kill().unwrap();
        child.wait().unwrap();
        SessionRunLease::try_acquire(&store_path, "crash-session").unwrap();
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn lock_aliases_resolve_to_same_canonical_store() {
        let store_path = test_store("alias");
        store::initialize(&store_path).unwrap();
        let alias = store_path.parent().unwrap().join("store-alias.db");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&store_path, &alias).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&store_path, &alias).unwrap();

        let lease = SessionRunLease::try_acquire(&store_path, "session").unwrap();
        assert!(matches!(
            SessionRunLease::try_acquire(&alias, "session"),
            Err(SessionRunLeaseError::Busy(_))
        ));
        drop(lease);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn lease_does_not_change_session_data() {
        let store_path = test_store("data");
        store::initialize(&store_path).unwrap();
        assert!(sessions::list_sessions(&store_path).unwrap().is_empty());
        let lease = SessionRunLease::try_acquire(&store_path, "session").unwrap();
        assert!(sessions::list_sessions(&store_path).unwrap().is_empty());
        drop(lease);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }
}
