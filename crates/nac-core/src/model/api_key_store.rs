//! Optional at-rest storage for provider API keys.
//!
//! The environment stays authoritative: a stored key is consulted only when
//! the configured `api_key_env` is absent from the process environment, so
//! servers and CI keep behaving exactly as before. Storage exists so a desktop
//! user can supply a key from the app instead of restarting the process with a
//! new environment.
//!
//! Secrets live in a single `0600` file in NAC home, written through the same
//! atomic, symlink-rejecting machinery as the managed OAuth credentials.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::auth_store::{
    read_auth_string_from_path, with_credential_lock, write_auth_string_to_path,
};
use super::backend::is_valid_env_name;

/// Longest accepted secret. Real provider keys are far shorter; the bound
/// stops a stray paste from being written into the credential file.
const MAX_API_KEY_LEN: usize = 4096;

/// Below this length a suffix would describe too much of the secret.
const MIN_LEN_FOR_SUFFIX_HINT: usize = 12;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoredApiKeys {
    #[serde(default)]
    api_keys: BTreeMap<String, String>,
}

/// What the HTTP API may reveal about a stored key.
#[derive(Debug, Clone)]
pub struct StoredApiKeySummary {
    pub name: String,
    /// Last four characters, or empty when the secret is too short to hint at.
    pub last_four: String,
}

fn store_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("credentials.json"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for API key storage"))
}

fn lock_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("credentials.json.lock"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for API key storage"))
}

fn load(path: &Path) -> Result<StoredApiKeys> {
    let Some(raw) = read_auth_string_from_path(path)? else {
        return Ok(StoredApiKeys::default());
    };
    if raw.trim().is_empty() {
        return Ok(StoredApiKeys::default());
    }
    // The parse error is deliberately not propagated: it can quote file
    // contents, and those contents are secrets.
    serde_json::from_str(&raw)
        .map_err(|_| anyhow!("stored API key file {} is not valid JSON", path.display()))
}

fn save(path: &Path, keys: &StoredApiKeys) -> Result<()> {
    let raw = serde_json::to_string_pretty(keys).context("failed to encode stored API keys")?;
    write_auth_string_to_path(path, &raw)
}

fn validate_name(name: &str) -> Result<()> {
    if !is_valid_env_name(name) {
        return Err(anyhow!(
            "invalid credential name '{}'; expected [A-Za-z_][A-Za-z0-9_]*",
            name
        ));
    }
    Ok(())
}

fn validate_value(value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("API key must not be blank"));
    }
    if value.len() > MAX_API_KEY_LEN {
        return Err(anyhow!("API key must be at most {} bytes", MAX_API_KEY_LEN));
    }
    // A control character would be smuggled straight into an HTTP header.
    if value.chars().any(char::is_control) {
        return Err(anyhow!("API key must not contain control characters"));
    }
    Ok(())
}

fn last_four(value: &str) -> String {
    let characters: Vec<char> = value.chars().collect();
    if characters.len() < MIN_LEN_FOR_SUFFIX_HINT {
        return String::new();
    }
    characters[characters.len() - 4..].iter().collect()
}

/// Resolve a stored key by the same name the session uses for its env var.
pub(super) fn read_stored_api_key(name: &str) -> Result<Option<String>> {
    let path = store_path()?;
    Ok(load(&path)?.api_keys.remove(name))
}

pub fn list_stored_api_keys() -> Result<Vec<StoredApiKeySummary>> {
    let path = store_path()?;
    Ok(load(&path)?
        .api_keys
        .into_iter()
        .map(|(name, value)| StoredApiKeySummary {
            name,
            last_four: last_four(&value),
        })
        .collect())
}

pub fn store_api_key(name: &str, value: &str) -> Result<()> {
    validate_name(name)?;
    validate_value(value)?;
    let path = store_path()?;
    with_credential_lock(&lock_path()?, || {
        let mut keys = load(&path)?;
        keys.api_keys.insert(name.to_string(), value.to_string());
        save(&path, &keys)
    })
}

/// Returns whether a key was actually removed.
pub fn remove_api_key(database_path: &Path, name: &str) -> Result<bool> {
    validate_name(name)?;
    if crate::store::credential_selector_is_referenced(database_path, name)? {
        return Err(anyhow!(
            "credential '{name}' is still referenced by a session or model configuration"
        ));
    }
    let path = store_path()?;
    with_credential_lock(&lock_path()?, || {
        let mut keys = load(&path)?;
        let removed = keys.api_keys.remove(name).is_some();
        if removed {
            save(&path, &keys)?;
        }
        Ok(removed)
    })
}
