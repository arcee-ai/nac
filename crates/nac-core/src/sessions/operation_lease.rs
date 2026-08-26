use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use fs2::FileExt;
use sha2::{Digest, Sha256};

/// A process-wide, crash-safe exclusive lease for one persisted session operation.
///
/// The lease is an advisory OS file lock. It is released when this value is
/// dropped or when the owning process exits, including abnormal termination.
#[derive(Debug)]
pub struct SessionOperationLease {
    _file: File,
    canonical_store: PathBuf,
    session_id: String,
}

/// Cross-process exclusion for mutations of a session's owned child set.
/// This is deliberately distinct from the run/compaction lease: a parent run
/// must be able to create a child while still preventing deletion from taking
/// its descendant snapshot concurrently.
#[derive(Debug)]
pub struct SessionRelationshipLease {
    _file: File,
}

/// Shared authority retained for the lifetime of an explicitly retained
/// terminal. Branch/commit mutations take the exclusive twin.
#[derive(Debug)]
pub struct WorkspaceActivityLease {
    _file: File,
}

/// Cross-process exclusion for a checkout-wide branch or commit mutation.
#[derive(Debug)]
pub struct WorkspaceMutationLease {
    _file: File,
}

/// Shared cross-process ownership retained while a process-local terminal can
/// still mutate resources on behalf of one durable session.
#[derive(Debug)]
pub struct SessionResourceLease {
    _file: File,
}

/// Exclusive twin used by lifecycle operations that would otherwise orphan
/// process-local resources owned by a peer process.
#[derive(Debug)]
pub struct SessionResourceMutationLease {
    _file: File,
}

impl Drop for SessionRelationshipLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

impl Drop for SessionOperationLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

impl Drop for WorkspaceActivityLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

impl Drop for WorkspaceMutationLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

impl Drop for SessionResourceLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

impl Drop for SessionResourceMutationLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

#[derive(Debug)]
pub enum SessionOperationLeaseError {
    Busy(String),
    Store(anyhow::Error),
}

impl fmt::Display for SessionOperationLeaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(session_id) => write!(
                formatter,
                "session '{session_id}' is busy with an active operation in another process"
            ),
            // Store errors can contain canonical paths. Keep them in `source()`
            // for internal diagnostics, but never include them in Display text
            // consumed by API and interactive clients.
            Self::Store(_) => formatter.write_str("session operation lease failed"),
        }
    }
}

impl std::error::Error for SessionOperationLeaseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Busy(_) => None,
            Self::Store(error) => Some(error.as_ref()),
        }
    }
}

#[derive(Debug)]
pub enum SessionOperationLeaseValidationError {
    Store(anyhow::Error),
    IdentityMismatch,
}

impl fmt::Display for SessionOperationLeaseValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // As with acquisition failures, the source is retained for logs and
            // error chains while client-visible text remains path-free.
            Self::Store(_) => formatter.write_str("failed to validate session operation lease"),
            Self::IdentityMismatch => formatter.write_str(
                "supplied session operation lease belongs to a different store or session",
            ),
        }
    }
}

impl std::error::Error for SessionOperationLeaseValidationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            Self::IdentityMismatch => None,
        }
    }
}

impl SessionOperationLease {
    /// Attempts to acquire a per-session lease without waiting.
    pub fn try_acquire(
        store_path: &Path,
        session_id: &str,
    ) -> Result<Self, SessionOperationLeaseError> {
        let canonical_store = canonical_store(store_path).map_err(store_error)?;
        let lock_path = secure_lock_path(&canonical_store, session_id).map_err(store_error)?;
        let file = secure_open_lock_file(&lock_path).map_err(store_error)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self {
                _file: file,
                canonical_store,
                session_id: session_id.to_string(),
            }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(SessionOperationLeaseError::Busy(session_id.to_string()))
            }
            Err(error) => Err(store_error(
                anyhow::Error::new(error)
                    .context(format!("failed to lock {}", lock_path.display())),
            )),
        }
    }

    pub fn validate(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> Result<(), SessionOperationLeaseValidationError> {
        let canonical_store =
            canonical_store(store_path).map_err(SessionOperationLeaseValidationError::Store)?;
        if self.canonical_store == canonical_store && self.session_id == session_id {
            Ok(())
        } else {
            Err(SessionOperationLeaseValidationError::IdentityMismatch)
        }
    }
}

impl SessionRelationshipLease {
    pub fn try_acquire(
        store_path: &Path,
        session_id: &str,
    ) -> Result<Self, SessionOperationLeaseError> {
        let canonical_store = canonical_store(store_path).map_err(store_error)?;
        // Keep this suffix short: persisted identifiers are hex encoded and
        // may be 120 bytes, so the complete component must remain below the
        // common 255-byte filesystem limit.
        let lock_path = secure_lock_path_with_suffix(&canonical_store, session_id, ".rel")
            .map_err(store_error)?;
        let file = secure_open_lock_file(&lock_path).map_err(store_error)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(SessionOperationLeaseError::Busy(session_id.to_string()))
            }
            Err(error) => Err(store_error(
                anyhow::Error::new(error)
                    .context(format!("failed to lock {}", lock_path.display())),
            )),
        }
    }
}

impl WorkspaceActivityLease {
    pub fn try_acquire(
        store_path: &Path,
        workspace_identity: &[u8],
    ) -> Result<Self, SessionOperationLeaseError> {
        let file = open_workspace_lock_file(store_path, workspace_identity)?;
        match FileExt::try_lock_shared(&file) {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Err(
                SessionOperationLeaseError::Busy("workspace mutation".to_string()),
            ),
            Err(error) => Err(store_error(
                anyhow::Error::new(error).context("failed to lock workspace activity lease"),
            )),
        }
    }
}

impl WorkspaceMutationLease {
    pub fn try_acquire(
        store_path: &Path,
        workspace_identity: &[u8],
    ) -> Result<Self, SessionOperationLeaseError> {
        let file = open_workspace_lock_file(store_path, workspace_identity)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Err(
                SessionOperationLeaseError::Busy("retained workspace terminal".to_string()),
            ),
            Err(error) => Err(store_error(
                anyhow::Error::new(error).context("failed to lock workspace mutation lease"),
            )),
        }
    }
}

impl SessionResourceLease {
    pub fn try_acquire(
        store_path: &Path,
        session_id: &str,
    ) -> Result<Self, SessionOperationLeaseError> {
        let canonical_store = canonical_store(store_path).map_err(store_error)?;
        let lock_path = secure_lock_path_with_suffix(&canonical_store, session_id, ".resource")
            .map_err(store_error)?;
        let file = secure_open_lock_file(&lock_path).map_err(store_error)?;
        match FileExt::try_lock_shared(&file) {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(SessionOperationLeaseError::Busy(session_id.to_string()))
            }
            Err(error) => Err(store_error(
                anyhow::Error::new(error).context("failed to lock session resource lease"),
            )),
        }
    }
}

impl SessionResourceMutationLease {
    pub fn try_acquire(
        store_path: &Path,
        session_id: &str,
    ) -> Result<Self, SessionOperationLeaseError> {
        let canonical_store = canonical_store(store_path).map_err(store_error)?;
        let lock_path = secure_lock_path_with_suffix(&canonical_store, session_id, ".resource")
            .map_err(store_error)?;
        let file = secure_open_lock_file(&lock_path).map_err(store_error)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(SessionOperationLeaseError::Busy(session_id.to_string()))
            }
            Err(error) => Err(store_error(
                anyhow::Error::new(error).context("failed to lock session resource mutation lease"),
            )),
        }
    }
}

fn open_workspace_lock_file(
    store_path: &Path,
    workspace_identity: &[u8],
) -> Result<File, SessionOperationLeaseError> {
    let canonical_store = canonical_store(store_path).map_err(store_error)?;
    let digest = Sha256::digest(workspace_identity);
    let key = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let lock_path =
        secure_lock_path_with_suffix(&canonical_store, &key, ".workspace").map_err(store_error)?;
    secure_open_lock_file(&lock_path).map_err(store_error)
}

fn canonical_store(store_path: &Path) -> anyhow::Result<PathBuf> {
    fs::canonicalize(store_path).map_err(anyhow::Error::new)
}

fn store_error(error: anyhow::Error) -> SessionOperationLeaseError {
    SessionOperationLeaseError::Store(error)
}

fn secure_lock_path(canonical_store: &Path, session_id: &str) -> anyhow::Result<PathBuf> {
    secure_lock_path_with_suffix(canonical_store, session_id, ".lock")
}

fn secure_lock_path_with_suffix(
    canonical_store: &Path,
    session_id: &str,
    suffix: &str,
) -> anyhow::Result<PathBuf> {
    let file_name = canonical_store.file_name().ok_or_else(|| {
        anyhow::anyhow!("store path has no file name: {}", canonical_store.display())
    })?;
    let mut lock_dir_name = file_name.to_os_string();
    // Keep the historical directory name so rolling upgrades still contend on
    // the same lock files even though the lease now covers every operation.
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
    Ok(lock_dir.join(format!("{encoded_id}{suffix}")))
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
        Ok(file)
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
            .join(format!("nac_operation_lease_{label}_{unique}"))
            .join("store.db")
    }

    #[test]
    fn store_failure_display_is_path_safe_while_error_chains_retain_the_source() {
        const CANARY: &str = "/private/operation-lease-path-canary/store.db";

        let acquire = SessionOperationLeaseError::Store(anyhow::anyhow!(
            "failed to create lock directory beside {CANARY}"
        ));
        assert_eq!(acquire.to_string(), "session operation lease failed");
        assert!(!acquire.to_string().contains(CANARY));
        assert!(std::error::Error::source(&acquire)
            .unwrap()
            .to_string()
            .contains(CANARY));
        let chained = anyhow::Error::new(acquire);
        assert_eq!(chained.to_string(), "session operation lease failed");
        assert!(format!("{chained:#}").contains(CANARY));

        let validate = SessionOperationLeaseValidationError::Store(anyhow::anyhow!(
            "failed to canonicalize {CANARY}"
        ));
        assert_eq!(
            validate.to_string(),
            "failed to validate session operation lease"
        );
        assert!(!validate.to_string().contains(CANARY));
        assert!(std::error::Error::source(&validate)
            .unwrap()
            .to_string()
            .contains(CANARY));

        let legacy_alias: sessions::SessionRunLeaseError =
            SessionOperationLeaseError::Store(anyhow::anyhow!("legacy source: {CANARY}"));
        assert_eq!(legacy_alias.to_string(), "session operation lease failed");
    }

    #[test]
    fn lease_is_exclusive_and_drop_releases_it() {
        let store_path = test_store("drop");
        store::initialize(&store_path).unwrap();
        let lease = SessionOperationLease::try_acquire(&store_path, "../unsafe/session").unwrap();
        assert!(matches!(
            SessionOperationLease::try_acquire(&store_path, "../unsafe/session"),
            Err(SessionOperationLeaseError::Busy(_))
        ));
        drop(lease);
        SessionOperationLease::try_acquire(&store_path, "../unsafe/session").unwrap();
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn relationship_lease_is_distinct_exclusive_and_supports_maximum_ids() {
        let store_path = test_store("relationship");
        store::initialize(&store_path).unwrap();
        let session_id = "s".repeat(120);

        let operation = SessionOperationLease::try_acquire(&store_path, &session_id).unwrap();
        let relationship = SessionRelationshipLease::try_acquire(&store_path, &session_id).unwrap();
        assert!(matches!(
            SessionRelationshipLease::try_acquire(&store_path, &session_id),
            Err(SessionOperationLeaseError::Busy(_))
        ));

        drop(relationship);
        SessionRelationshipLease::try_acquire(&store_path, &session_id).unwrap();
        drop(operation);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn lock_paths_are_private_and_reject_symlink_files() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let store_path = test_store("secure_path");
        store::initialize(&store_path).unwrap();
        let canonical_store = fs::canonicalize(&store_path).unwrap();
        let lock_path = secure_lock_path(&canonical_store, "../../session").unwrap();
        assert_eq!(
            fs::metadata(lock_path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let expected_lock_dir = canonical_store.with_file_name("store.db.run-locks");
        assert_eq!(lock_path.parent(), Some(expected_lock_dir.as_path()));

        let target = store_path.parent().unwrap().join("must-not-lock");
        fs::write(&target, b"unchanged").unwrap();
        symlink(&target, &lock_path).unwrap();
        assert!(matches!(
            SessionOperationLease::try_acquire(&store_path, "../../session"),
            Err(SessionOperationLeaseError::Store(_))
        ));
        assert_eq!(fs::read(&target).unwrap(), b"unchanged");
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn lease_process_helper() {
        let Some(store_path) = std::env::var_os("NAC_TEST_OPERATION_LEASE_STORE") else {
            return;
        };
        let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_OPERATION_LEASE_READY").unwrap());
        let _lease =
            SessionOperationLease::try_acquire(Path::new(&store_path), "crash-session").unwrap();
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
                "sessions::operation_lease::tests::lease_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_OPERATION_LEASE_STORE", &store_path)
            .env("NAC_TEST_OPERATION_LEASE_READY", &ready_path)
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
            SessionOperationLease::try_acquire(&store_path, "crash-session"),
            Err(SessionOperationLeaseError::Busy(_))
        ));

        child.kill().unwrap();
        child.wait().unwrap();
        SessionOperationLease::try_acquire(&store_path, "crash-session").unwrap();
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn resource_lease_process_helper() {
        let Some(store_path) = std::env::var_os("NAC_TEST_RESOURCE_LEASE_STORE") else {
            return;
        };
        let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_RESOURCE_LEASE_READY").unwrap());
        let _lease =
            SessionResourceLease::try_acquire(Path::new(&store_path), "retained-session").unwrap();
        fs::write(ready_path, b"ready").unwrap();
        thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn peer_resource_lease_blocks_lifecycle_mutation_until_process_death() {
        let store_path = test_store("resource_process_death");
        store::initialize(&store_path).unwrap();
        let ready_path = store_path.parent().unwrap().join("resource-ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "sessions::operation_lease::tests::resource_lease_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_RESOURCE_LEASE_STORE", &store_path)
            .env("NAC_TEST_RESOURCE_LEASE_READY", &ready_path)
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
                "resource lease helper exited early"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            ready_path.exists(),
            "resource lease helper never became ready"
        );
        assert!(matches!(
            SessionResourceMutationLease::try_acquire(&store_path, "retained-session"),
            Err(SessionOperationLeaseError::Busy(_))
        ));

        child.kill().unwrap();
        child.wait().unwrap();
        SessionResourceMutationLease::try_acquire(&store_path, "retained-session").unwrap();
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

        let lease = SessionOperationLease::try_acquire(&store_path, "session").unwrap();
        assert!(matches!(
            SessionOperationLease::try_acquire(&alias, "session"),
            Err(SessionOperationLeaseError::Busy(_))
        ));
        drop(lease);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn lease_validation_binds_canonical_store_and_session() {
        let store_path = test_store("identity");
        let other_store = test_store("other_identity");
        store::initialize(&store_path).unwrap();
        store::initialize(&other_store).unwrap();
        let alias = store_path.parent().unwrap().join("store-alias.db");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&store_path, &alias).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&store_path, &alias).unwrap();

        let lease = SessionOperationLease::try_acquire(&store_path, "session-a").unwrap();
        lease.validate(&alias, "session-a").unwrap();
        assert!(matches!(
            lease.validate(&store_path, "session-b"),
            Err(SessionOperationLeaseValidationError::IdentityMismatch)
        ));
        assert!(matches!(
            lease.validate(&other_store, "session-a"),
            Err(SessionOperationLeaseValidationError::IdentityMismatch)
        ));

        drop(lease);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
        let _ = fs::remove_dir_all(other_store.parent().unwrap());
    }

    #[test]
    fn lease_does_not_change_session_data() {
        let store_path = test_store("data");
        store::initialize(&store_path).unwrap();
        assert!(sessions::list_sessions(&store_path).unwrap().is_empty());
        let lease = SessionOperationLease::try_acquire(&store_path, "session").unwrap();
        assert!(sessions::list_sessions(&store_path).unwrap().is_empty());
        drop(lease);
        let _ = fs::remove_dir_all(store_path.parent().unwrap());
    }
}
