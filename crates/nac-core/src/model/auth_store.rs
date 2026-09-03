use anyhow::{anyhow, Result};
use std::path::PathBuf;

pub(crate) use nac_credential_store::{
    acquire_credential_lock, read_auth_string_from_path, with_credential_lock,
    write_auth_string_to_path, FileLock,
};
pub(super) use nac_credential_store::{
    ensure_open_credential_file_is_safe, read_auth_bytes_from_path,
    UnsafeCredentialPermissionsError,
};

pub(super) fn arcee_auth_file_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("arcee_auth.json"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for Arcee auth storage"))
}

pub(super) fn arcee_auth_lock_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("arcee_auth.json.lock"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for Arcee auth storage"))
}

pub(super) fn arcee_managed_bootstrap_receipt_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("arcee_managed_bootstrap_receipt.json"))
        .ok_or_else(|| {
            anyhow!("could not determine NAC_HOME or HOME for managed Arcee bootstrap storage")
        })
}

fn acquire_arcee_auth_lock() -> Result<FileLock> {
    acquire_credential_lock(&arcee_auth_lock_path()?)
}

pub(super) fn with_arcee_auth_lock<T>(operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let lock = acquire_arcee_auth_lock()?;
    let result = operation();
    drop(lock);
    result
}

#[cfg(test)]
pub(super) fn assert_lock_contention_and_release(
    label: &str,
    lock: fn(&std::fs::File) -> std::io::Result<()>,
    unlock: fn(&std::fs::File) -> std::io::Result<()>,
) {
    use fs2::FileExt;
    use std::fs::OpenOptions;

    let directory = std::env::temp_dir().join(format!(
        "nac-auth-lock-{label}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("auth.lock");
    let first = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    let second = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();

    lock(&first).unwrap();
    let contention = FileExt::try_lock_exclusive(&second);
    assert!(
        contention.is_err(),
        "a second auth lock unexpectedly succeeded while the first was held"
    );

    unlock(&first).unwrap();
    FileExt::try_lock_exclusive(&second).unwrap();
    FileExt::unlock(&second).unwrap();

    drop(second);
    drop(first);
    std::fs::remove_dir_all(directory).unwrap();
}
