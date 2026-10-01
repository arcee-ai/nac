use std::fmt;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use fs2::FileExt;

use super::operation_lease::{secure_lock_path_with_suffix, secure_open_lock_file};

/// Crash-safe exclusive ownership of one canonical store by a serving process.
///
/// This is a construction-time primitive. The application that opens the store
/// retains it for its full serving lifetime; ordinary store operations do not
/// reacquire it. The operating system releases the lock when the owner exits.
#[derive(Debug)]
pub struct StoreProcessLease {
    _file: File,
    canonical_store: PathBuf,
}

impl Drop for StoreProcessLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

#[derive(Debug)]
pub enum StoreProcessLeaseError {
    Busy,
    Store(anyhow::Error),
}

impl fmt::Display for StoreProcessLeaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy => formatter.write_str(
                "store is already owned by another active nac-web process; stop that process or pass --store-path with a different database",
            ),
            Self::Store(_) => formatter.write_str("failed to acquire nac-web store ownership"),
        }
    }
}

impl std::error::Error for StoreProcessLeaseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Busy => None,
            Self::Store(error) => Some(error.as_ref()),
        }
    }
}

impl StoreProcessLease {
    /// Acquire store ownership without waiting for an existing owner.
    ///
    /// The parent directory is created before the database so ownership also
    /// serializes first startup and migration of a previously absent store.
    pub fn try_acquire(store_path: &Path) -> Result<Self, StoreProcessLeaseError> {
        let canonical_store = canonical_store_identity(store_path).map_err(store_error)?;
        let lock_path = secure_lock_path_with_suffix(&canonical_store, "store-owner", ".lock")
            .map_err(store_error)?;
        let file = secure_open_lock_file(&lock_path).map_err(store_error)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self {
                _file: file,
                canonical_store,
            }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(StoreProcessLeaseError::Busy)
            }
            Err(error) => Err(store_error(anyhow::Error::new(error).context(format!(
                "failed to lock store ownership file {}",
                lock_path.display()
            )))),
        }
    }

    pub(crate) fn store_path(&self) -> &Path {
        &self.canonical_store
    }
}

fn canonical_store_identity(store_path: &Path) -> anyhow::Result<PathBuf> {
    canonical_store_identity_with_symlink_budget(store_path, 40)
}

fn canonical_store_identity_with_symlink_budget(
    store_path: &Path,
    remaining_symlinks: usize,
) -> anyhow::Result<PathBuf> {
    match fs::canonicalize(store_path) {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if fs::symlink_metadata(store_path)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                anyhow::ensure!(
                    remaining_symlinks > 0,
                    "store path contains too many symbolic links"
                );
                let target = fs::read_link(store_path)?;
                let target = if target.is_absolute() {
                    target
                } else {
                    store_path
                        .parent()
                        .filter(|parent| !parent.as_os_str().is_empty())
                        .unwrap_or_else(|| Path::new("."))
                        .join(target)
                };
                return canonical_store_identity_with_symlink_budget(
                    &target,
                    remaining_symlinks - 1,
                );
            }
            let file_name = store_path.file_name().ok_or_else(|| {
                anyhow::anyhow!("store path has no file name: {}", store_path.display())
            })?;
            let parent = store_path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            fs::create_dir_all(parent)?;
            Ok(fs::canonicalize(parent)?.join(file_name))
        }
        Err(error) => Err(error.into()),
    }
}

fn store_error(error: anyhow::Error) -> StoreProcessLeaseError {
    StoreProcessLeaseError::Store(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn test_store(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_store_owner_{label}_{unique}"))
            .join("store.db")
    }

    #[test]
    fn second_opener_fails_actionably_and_drop_allows_restart() {
        let store_path = test_store("restart");
        let owner = StoreProcessLease::try_acquire(&store_path).unwrap();
        let error = StoreProcessLease::try_acquire(&store_path).unwrap_err();
        assert!(matches!(error, StoreProcessLeaseError::Busy));
        assert_eq!(
            error.to_string(),
            "store is already owned by another active nac-web process; stop that process or pass --store-path with a different database"
        );

        drop(owner);
        StoreProcessLease::try_acquire(&store_path).unwrap();
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn separate_store_paths_can_be_owned_concurrently() {
        let first_path = test_store("separate_first");
        let second_path = test_store("separate_second");
        let first = StoreProcessLease::try_acquire(&first_path).unwrap();
        let second = StoreProcessLease::try_acquire(&second_path).unwrap();

        drop((first, second));
        let _ = fs::remove_dir_all(first_path.parent().unwrap());
        let _ = fs::remove_dir_all(second_path.parent().unwrap());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn aliases_resolve_to_one_canonical_store_owner() {
        let store_path = test_store("alias");
        crate::store::initialize(&store_path).unwrap();
        let alias = store_path.parent().unwrap().join("store-alias.db");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&store_path, &alias).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&store_path, &alias).unwrap();

        let owner = StoreProcessLease::try_acquire(&store_path).unwrap();
        assert!(matches!(
            StoreProcessLease::try_acquire(&alias),
            Err(StoreProcessLeaseError::Busy)
        ));

        drop(owner);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn dangling_alias_resolves_to_the_absent_target_store_owner() {
        let store_path = test_store("dangling_alias");
        fs::create_dir_all(store_path.parent().unwrap()).unwrap();
        let alias = store_path.parent().unwrap().join("store-alias.db");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&store_path, &alias).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&store_path, &alias).unwrap();

        let owner = StoreProcessLease::try_acquire(&store_path).unwrap();
        assert!(matches!(
            StoreProcessLease::try_acquire(&alias),
            Err(StoreProcessLeaseError::Busy)
        ));

        drop(owner);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn store_owner_process_helper() {
        let Some(store_path) = std::env::var_os("NAC_TEST_STORE_OWNER_PATH") else {
            return;
        };
        let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_STORE_OWNER_READY").unwrap());
        let _owner = StoreProcessLease::try_acquire(Path::new(&store_path)).unwrap();
        fs::write(ready_path, b"ready").unwrap();
        thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn stale_process_owner_is_fenced_until_exit_then_restart_acquires() {
        let store_path = test_store("process_restart");
        fs::create_dir_all(store_path.parent().unwrap()).unwrap();
        let ready_path = store_path.parent().unwrap().join("ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "sessions::store_process_lease::tests::store_owner_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_STORE_OWNER_PATH", &store_path)
            .env("NAC_TEST_STORE_OWNER_READY", &ready_path)
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
                "owner helper exited early"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready_path.exists(), "owner helper never became ready");
        assert!(matches!(
            StoreProcessLease::try_acquire(&store_path),
            Err(StoreProcessLeaseError::Busy)
        ));

        child.kill().unwrap();
        child.wait().unwrap();
        StoreProcessLease::try_acquire(&store_path).unwrap();
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }
}
