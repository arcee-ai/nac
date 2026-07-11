use anyhow::{anyhow, Context, Result};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .with_context(|| format!("failed to open {}", path.display()))?;
    use std::io::Write;
    file.write_all(raw.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    file.flush()
        .with_context(|| format!("failed to flush {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to chmod {}", path.display()))?;
    }
    Ok(())
}

pub(super) fn remove_arcee_auth_file() -> Result<bool> {
    let path = arcee_auth_file_path()?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

pub(super) struct FileLock {
    file: File,
}

impl FileLock {
    fn acquire(path: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .with_context(|| format!("failed to open auth lock {}", path.display()))?;
        lock_file(&file).with_context(|| format!("failed to lock {}", path.display()))?;
        Ok(Self { file })
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
