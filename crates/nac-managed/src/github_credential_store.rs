//! Owner-only persistence adapter for managed GitHub authorization.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, PoisonError, Weak};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use nac_credential_store::{
    read_auth_string_from_path, remove_auth_file_from_path, try_acquire_credential_lock,
    write_auth_string_to_path, FileLock,
};
use serde::{Deserialize, Serialize};

pub(crate) const AUTH_STORE_VERSION: u32 = 1;
const LOCK_RETRY: Duration = Duration::from_millis(25);

/// In-process async gates keyed by credential lock path. Waiting on a gate
/// yields the executor; only the admitted task then polls the cross-process
/// file lock, so concurrent callers never park Tokio workers in flock(2).
type CredentialGates = HashMap<PathBuf, Weak<tokio::sync::Mutex<()>>>;
static CREDENTIAL_GATES: LazyLock<Mutex<CredentialGates>> = LazyLock::new(Mutex::default);

fn credential_gate(lock_path: &Path) -> Arc<tokio::sync::Mutex<()>> {
    let mut gates = CREDENTIAL_GATES
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if let Some(gate) = gates.get(lock_path).and_then(Weak::upgrade) {
        return gate;
    }
    gates.retain(|_, gate| gate.strong_count() > 0);
    let gate = Arc::new(tokio::sync::Mutex::new(()));
    gates.insert(lock_path.to_path_buf(), Arc::downgrade(&gate));
    gate
}

/// Exclusive access to the stored authorization. The file lock is released
/// before the in-process gate admits the next waiter.
pub(crate) struct CredentialGuard {
    _lock: FileLock,
    _gate: tokio::sync::OwnedMutexGuard<()>,
}

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

    /// Serializes a credential read-modify-write within this process (async
    /// gate) and across processes (non-blocking file lock polled until
    /// `timeout`). Refreshes hold the guard across their token request.
    pub(crate) async fn lock(&self, timeout: Duration) -> Result<CredentialGuard> {
        let gate = credential_gate(&self.lock_path).lock_owned().await;
        let started = Instant::now();
        loop {
            let attempt = try_acquire_credential_lock(&self.lock_path)?;
            if let Some(lock) = attempt {
                return Ok(CredentialGuard {
                    _lock: lock,
                    _gate: gate,
                });
            }
            if started.elapsed() >= timeout {
                bail!(
                    "timed out waiting for the managed GitHub credential lock; another nac process may be refreshing it"
                );
            }
            tokio::time::sleep(LOCK_RETRY).await;
        }
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
