use anyhow::{anyhow, Context, Result};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(super) fn arcee_auth_file_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("arcee_auth.json"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for Arcee auth storage"))
}

pub(super) fn legacy_auth_file_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("auth.json"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for legacy auth storage"))
}

fn arcee_auth_lock_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("arcee_auth.json.lock"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for Arcee auth storage"))
}

fn legacy_auth_lock_path() -> Result<PathBuf> {
    // Preserve the historical lock name used for auth.json so migration
    // coordinates with Codex and older NAC versions.
    Ok(legacy_auth_file_path()?.with_extension("auth.json.lock"))
}

fn acquire_arcee_auth_lock() -> Result<FileLock> {
    acquire_lock(&arcee_auth_lock_path()?)
}

fn acquire_legacy_auth_lock() -> Result<FileLock> {
    acquire_lock(&legacy_auth_lock_path()?)
}

fn acquire_lock(path: &Path) -> Result<FileLock> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    FileLock::acquire(path)
}

pub(super) fn with_arcee_auth_lock<T>(operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let lock = acquire_arcee_auth_lock()?;
    let result = operation();
    drop(lock);
    result
}

pub(super) fn with_arcee_migration_locks<T>(operation: impl FnOnce() -> Result<T>) -> Result<T> {
    // All dual-file operations lock auth.json first and arcee_auth.json second.
    // Codex uses the same auth.json lock path and follows this order.
    let legacy_lock = acquire_legacy_auth_lock()?;
    let arcee_lock = acquire_arcee_auth_lock()?;
    let result = operation();
    drop(arcee_lock);
    drop(legacy_lock);
    result
}

pub(super) fn read_arcee_auth_string() -> Result<Option<String>> {
    let path = arcee_auth_file_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
    }
}

pub(super) fn write_arcee_auth_string(raw: &str) -> Result<()> {
    write_auth_string_to_path(&arcee_auth_file_path()?, raw)
}

pub(super) fn write_auth_string_to_path(path: &Path, raw: &str) -> Result<()> {
    atomic_replace_auth_file(path, |file| file.write_all(raw.as_bytes()))
}

fn atomic_replace_auth_file(
    path: &Path,
    write_contents: impl FnOnce(&mut File) -> io::Result<()>,
) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("auth path {} has no parent directory", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("failed to create {}", parent.display()))?;
    validate_regular_destination(path)?;

    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow!("auth path {} has no file name", path.display()))?
        .to_string_lossy();
    let temp_path = parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4().simple()));
    let mut temp = open_private_temp_file(&temp_path)?;
    let mut cleanup = TempFileCleanup::new(temp_path.clone());
    let write_result = (|| -> Result<()> {
        make_file_private(&temp, &temp_path)?;
        ensure_open_file_is_regular(&temp, &temp_path, "temporary auth file")?;
        write_contents(&mut temp).with_context(|| {
            format!(
                "failed to write temporary auth file {}",
                temp_path.display()
            )
        })?;
        temp.flush().with_context(|| {
            format!(
                "failed to flush temporary auth file {}",
                temp_path.display()
            )
        })?;
        temp.sync_all().with_context(|| {
            format!("failed to sync temporary auth file {}", temp_path.display())
        })?;
        Ok(())
    })();
    drop(temp);
    write_result?;

    // Check again immediately before rename. On Unix, rename replaces a final
    // component rather than following it, so a racing symlink cannot modify its target.
    validate_regular_destination(path)?;
    fs::rename(&temp_path, path).with_context(|| {
        format!(
            "failed to atomically replace {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;
    cleanup.disarm();
    sync_parent_directory(parent)
        .with_context(|| format!("failed to sync auth directory {}", parent.display()))?;
    Ok(())
}

fn validate_regular_destination(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(metadata) if metadata.file_type().is_symlink() => Err(anyhow!(
            "refusing to replace symlink credential destination {}",
            path.display()
        )),
        Ok(_) => Err(anyhow!(
            "refusing to replace non-regular credential destination {}",
            path.display()
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {}", path.display())),
    }
}

fn open_private_temp_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    options
        .open(path)
        .with_context(|| format!("failed to create temporary auth file {}", path.display()))
}

#[cfg(unix)]
fn make_file_private(file: &File, path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .with_context(|| format!("failed to chmod {}", path.display()))
}

#[cfg(not(unix))]
fn make_file_private(_file: &File, _path: &Path) -> Result<()> {
    Ok(())
}

fn ensure_open_file_is_regular(file: &File, path: &Path, kind: &str) -> Result<()> {
    let metadata = file
        .metadata()
        .with_context(|| format!("failed to inspect open {kind} {}", path.display()))?;
    if metadata.file_type().is_file() {
        Ok(())
    } else {
        Err(anyhow!(
            "refusing to use non-regular {kind} {}",
            path.display()
        ))
    }
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> io::Result<()> {
    Ok(())
}

struct TempFileCleanup {
    path: PathBuf,
    armed: bool,
}

impl TempFileCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TempFileCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(super) struct FileLock {
    file: File,
}

impl FileLock {
    fn acquire(path: &Path) -> Result<Self> {
        validate_lock_destination(path)?;
        let mut options = OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let file = options
            .open(path)
            .with_context(|| format!("failed to open auth lock {}", path.display()))?;
        ensure_open_file_is_regular(&file, path, "auth lock")?;
        make_file_private(&file, path)?;
        lock_file(&file).with_context(|| format!("failed to lock {}", path.display()))?;
        Ok(Self { file })
    }
}

fn validate_lock_destination(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(metadata) if metadata.file_type().is_symlink() => Err(anyhow!(
            "refusing to use symlink auth lock {}",
            path.display()
        )),
        Ok(_) => Err(anyhow!(
            "refusing to use non-regular auth lock {}",
            path.display()
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("failed to inspect auth lock {}", path.display()))
        }
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = unlock_file(&self.file);
    }
}

#[cfg(unix)]
fn lock_file(file: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn unlock_file(file: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn lock_file(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(not(unix))]
fn unlock_file(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom};
    use std::os::unix::fs::{symlink, PermissionsExt};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "nac-auth-store-{label}-{}",
                Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }

        fn assert_no_temp_files(&self) {
            let names = fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| name.contains(".tmp-"))
                .collect::<Vec<_>>();
            assert!(names.is_empty(), "temporary files remain: {names:?}");
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn arcee_atomic_write_creates_mode_0600_and_replaces_by_rename() {
        let dir = TestDir::new("arcee-replace");
        let path = dir.path("arcee_auth.json");
        fs::write(&path, "old-valid-content").unwrap();
        let mut old_file = File::open(&path).unwrap();

        write_auth_string_to_path(&path, "new-complete-content").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new-complete-content");
        let mut old_contents = String::new();
        old_file.seek(SeekFrom::Start(0)).unwrap();
        old_file.read_to_string(&mut old_contents).unwrap();
        assert_eq!(old_contents, "old-valid-content");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        dir.assert_no_temp_files();
    }

    #[test]
    fn arcee_pre_rename_failure_preserves_existing_file_and_cleans_temp() {
        let dir = TestDir::new("arcee-failure");
        let path = dir.path("arcee_auth.json");
        fs::write(&path, "old-valid-content").unwrap();

        let result = atomic_replace_auth_file(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("injected pre-rename failure"))
        });

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "old-valid-content");
        dir.assert_no_temp_files();
    }

    #[test]
    fn arcee_write_rejects_symlink_destination_without_touching_target() {
        let dir = TestDir::new("arcee-symlink");
        let target = dir.path("target.json");
        let destination = dir.path("arcee_auth.json");
        fs::write(&target, "target-valid-content").unwrap();
        symlink(&target, &destination).unwrap();

        let error = write_auth_string_to_path(&destination, "replacement").unwrap_err();

        assert!(error.to_string().contains("symlink credential destination"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "target-valid-content");
        assert!(fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink());
        dir.assert_no_temp_files();
    }

    #[test]
    fn arcee_lock_is_private_and_rejects_symlink() {
        let dir = TestDir::new("arcee-lock");
        let lock_path = dir.path("arcee_auth.json.lock");
        let lock = FileLock::acquire(&lock_path).unwrap();
        assert_eq!(
            fs::metadata(&lock_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(lock);

        fs::remove_file(&lock_path).unwrap();
        let target = dir.path("lock-target");
        fs::write(&target, "unchanged").unwrap();
        symlink(&target, &lock_path).unwrap();
        let error = FileLock::acquire(&lock_path)
            .err()
            .expect("symlink lock accepted");
        assert!(error.to_string().contains("symlink auth lock"));
        assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
    }
}
