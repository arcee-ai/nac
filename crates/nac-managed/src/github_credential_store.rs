//! Owner-only persistence adapter for managed GitHub authorization.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use nac_credential_store::{
    acquire_credential_lock, read_auth_string_from_path, remove_auth_file_from_path,
    try_acquire_credential_lock, write_auth_string_to_path, FileLock,
};
use serde::{Deserialize, Serialize};

pub(crate) const AUTH_STORE_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct GitHubCredentialStore {
    path: PathBuf,
    lock_path: PathBuf,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredGitHubAuth {
    pub(crate) version: u32,
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) access_expires_at_ms: u64,
    pub(crate) refresh_expires_at_ms: u64,
    pub(crate) identity: GitHubIdentity,
    pub(crate) organization: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct GitHubIdentity {
    pub(crate) id: u64,
    pub(crate) login: String,
    pub(crate) name: Option<String>,
    pub(crate) avatar_url: Option<String>,
}

impl GitHubCredentialStore {
    pub(crate) fn new(state_root: &Path) -> Self {
        Self {
            path: state_root.join("managed_github_auth.json"),
            lock_path: state_root.join("managed_github_auth.json.lock"),
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn acquire(&self) -> Result<FileLock> {
        acquire_credential_lock(&self.lock_path)
    }

    pub(crate) fn try_acquire(&self) -> Result<Option<FileLock>> {
        try_acquire_credential_lock(&self.lock_path)
    }

    pub(crate) fn load(&self, expected_organization: &str) -> Result<Option<StoredGitHubAuth>> {
        let Some(raw) = read_auth_string_from_path(&self.path)? else {
            return Ok(None);
        };
        let stored: StoredGitHubAuth = serde_json::from_str(&raw)
            .map_err(|_| anyhow!("managed GitHub credential file is not valid JSON"))?;
        if stored.version != AUTH_STORE_VERSION {
            bail!(
                "unsupported managed GitHub credential version {}",
                stored.version
            );
        }
        if stored.access_token.is_empty()
            || stored.refresh_token.is_empty()
            || stored.identity.login.trim().is_empty()
            || !stored
                .organization
                .eq_ignore_ascii_case(expected_organization)
        {
            bail!("managed GitHub credential file is incomplete");
        }
        Ok(Some(stored))
    }

    pub(crate) fn save(&self, stored: &StoredGitHubAuth) -> Result<()> {
        write_auth_string_to_path(
            &self.path,
            &serde_json::to_string_pretty(stored)
                .context("failed to encode managed GitHub authorization")?,
        )
    }

    pub(crate) fn remove(&self) -> Result<bool> {
        remove_auth_file_from_path(&self.path)
    }
}
