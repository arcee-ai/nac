use anyhow::{anyhow, ensure, Context, Result};
use std::path::PathBuf;
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

/// How long a Codex or Arcee token refresh, sign-in or logout waits for
/// another NAC process that holds the same credential lock, unless
/// config.toml sets `[auth] lock_timeout_ms`.
pub(super) const DEFAULT_CREDENTIAL_LOCK_TIMEOUT: Duration = Duration::from_millis(15_000);
/// Same bounds as the MCP timeouts in config.toml.
const MIN_CREDENTIAL_LOCK_TIMEOUT_MS: u64 = 100;
const MAX_CREDENTIAL_LOCK_TIMEOUT_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Default, serde::Deserialize)]
struct AuthConfigFile {
    #[serde(default)]
    auth: AuthConfigSection,
}

#[derive(Debug, Default, serde::Deserialize)]
struct AuthConfigSection {
    lock_timeout_ms: Option<u64>,
}

/// Resolves the credential lock wait from config.toml. The read is async so
/// a caller never blocks a Tokio worker, and it takes no config lease. A
/// missing config file or `[auth]` section keeps the default; an
/// out-of-range value is an error rather than being silently ignored.
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
            return Err(error).with_context(|| format!("failed to read config {}", path.display()));
        }
    };
    credential_lock_timeout_from_config(&raw)
        .with_context(|| format!("invalid config {}", path.display()))
}

fn credential_lock_timeout_from_config(raw: &str) -> Result<Duration> {
    let config: AuthConfigFile = toml::from_str(raw).context("failed to parse config")?;
    let Some(milliseconds) = config.auth.lock_timeout_ms else {
        return Ok(DEFAULT_CREDENTIAL_LOCK_TIMEOUT);
    };
    ensure!(
        (MIN_CREDENTIAL_LOCK_TIMEOUT_MS..=MAX_CREDENTIAL_LOCK_TIMEOUT_MS).contains(&milliseconds),
        "auth.lock_timeout_ms must be between {MIN_CREDENTIAL_LOCK_TIMEOUT_MS} and {MAX_CREDENTIAL_LOCK_TIMEOUT_MS} milliseconds"
    );
    Ok(Duration::from_millis(milliseconds))
}

#[cfg(test)]
#[path = "auth_store_tests.rs"]
mod tests;
