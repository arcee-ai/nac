use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;

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

pub(super) fn arcee_managed_repair_capability_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("arcee_managed_repair.json"))
        .ok_or_else(|| {
            anyhow!("could not determine NAC_HOME or HOME for managed Arcee repair storage")
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

/// How long a Codex token refresh, sign-in or logout, or an Arcee token
/// refresh, waits for another NAC process that holds the same credential
/// lock, unless config.toml sets `[auth] lock_timeout_ms`.
pub(super) const DEFAULT_CREDENTIAL_LOCK_TIMEOUT: Duration = Duration::from_millis(15_000);
/// Same bounds as the MCP timeouts in config.toml.
const MIN_CREDENTIAL_LOCK_TIMEOUT_MS: u64 = 100;
const MAX_CREDENTIAL_LOCK_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// Resolves the credential lock wait from config.toml. The read is async, so
/// a caller never blocks a Tokio worker, and it takes no config lease.
///
/// Sign-in and token refresh must keep working when the rest of config.toml
/// is broken, so a missing, unreadable or unparseable file, or one without
/// `[auth] lock_timeout_ms`, keeps the default; an unreadable or unparseable
/// file also prints a warning. Only an explicit `lock_timeout_ms` that isn't
/// an integer within the bounds is an error, and its message names the key.
pub(super) async fn credential_lock_timeout() -> Result<Duration> {
    let Some(path) = crate::paths::nac_config_path() else {
        return Ok(DEFAULT_CREDENTIAL_LOCK_TIMEOUT);
    };
    let raw = match tokio::fs::read_to_string(&path).await {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DEFAULT_CREDENTIAL_LOCK_TIMEOUT);
        }
        Err(error) => {
            eprintln!(
                "warning: could not read {} ({error}); using the default {} ms credential lock wait",
                path.display(),
                DEFAULT_CREDENTIAL_LOCK_TIMEOUT.as_millis()
            );
            return Ok(DEFAULT_CREDENTIAL_LOCK_TIMEOUT);
        }
    };
    credential_lock_timeout_from_config(&raw, &path)
}

fn credential_lock_timeout_from_config(raw: &str, path: &Path) -> Result<Duration> {
    let config = match raw.parse::<toml::Table>() {
        Ok(config) => config,
        Err(error) => {
            eprintln!(
                "warning: could not parse {} ({}); using the default {} ms credential lock wait",
                path.display(),
                error.message(),
                DEFAULT_CREDENTIAL_LOCK_TIMEOUT.as_millis()
            );
            return Ok(DEFAULT_CREDENTIAL_LOCK_TIMEOUT);
        }
    };
    let Some(value) = config
        .get("auth")
        .and_then(|auth| auth.get("lock_timeout_ms"))
    else {
        return Ok(DEFAULT_CREDENTIAL_LOCK_TIMEOUT);
    };
    value
        .as_integer()
        .and_then(|milliseconds| u64::try_from(milliseconds).ok())
        .filter(|milliseconds| {
            (MIN_CREDENTIAL_LOCK_TIMEOUT_MS..=MAX_CREDENTIAL_LOCK_TIMEOUT_MS).contains(milliseconds)
        })
        .map(Duration::from_millis)
        .ok_or_else(|| {
            anyhow!(
                "auth.lock_timeout_ms in {} must be an integer between {MIN_CREDENTIAL_LOCK_TIMEOUT_MS} and {MAX_CREDENTIAL_LOCK_TIMEOUT_MS} milliseconds",
                path.display()
            )
        })
}

#[cfg(test)]
#[path = "auth_store_tests.rs"]
mod tests;
