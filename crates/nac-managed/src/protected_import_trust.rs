//! Enrolled public trust, reloaded without remote key discovery.
use super::{decode, ImportProofClaims, ImportProofError, Result};
use serde::Deserialize;
use std::{collections::HashSet, path::Path};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PublicTrust {
    version: u32,
    issuer: String,
    audience: String,
    max_proof_lifetime_seconds: i64,
    keys: Vec<TrustKey>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TrustKey {
    kid: String,
    issuer_key_generation: i64,
    public_key_base64url: String,
    not_before_unix_seconds: i64,
    not_after_unix_seconds: i64,
    revoked: bool,
}
pub(super) struct SelectedKey {
    pub public_key: [u8; 32],
}

pub(super) fn load(path: &Path) -> Result<PublicTrust> {
    let raw = read_file(path)?;
    let trust: PublicTrust =
        serde_json::from_slice(&raw).map_err(|_| ImportProofError::TrustUnavailable)?;
    if trust.version != 1
        || trust.max_proof_lifetime_seconds != 60
        || !identifier(&trust.issuer, 512)
        || !identifier(&trust.audience, 512)
        || trust.keys.is_empty()
        || trust.keys.len() > 16
    {
        return Err(ImportProofError::TrustUnavailable);
    }
    let mut kids = HashSet::new();
    let mut generations = HashSet::new();
    for key in &trust.keys {
        if !identifier(&key.kid, 128)
            || key.issuer_key_generation <= 0
            || !kids.insert(&key.kid)
            || !generations.insert(key.issuer_key_generation)
            || key.not_before_unix_seconds <= 0
            || key.not_before_unix_seconds >= key.not_after_unix_seconds
            || key.not_after_unix_seconds.checked_mul(1000).is_none()
            || decode(&key.public_key_base64url).map_or(true, |bytes| bytes.len() != 32)
        {
            return Err(ImportProofError::TrustUnavailable);
        }
    }
    Ok(trust)
}
impl PublicTrust {
    pub(super) fn key(
        &self,
        kid: &str,
        claims: &ImportProofClaims,
        now_unix_ms: i64,
    ) -> Result<SelectedKey> {
        let key = self
            .keys
            .iter()
            .find(|key| key.kid == kid)
            .ok_or(ImportProofError::TrustUnavailable)?;
        if claims.iss != self.issuer
            || claims.aud != self.audience
            || claims.issuer_key_id != kid
            || claims.issuer_key_generation != key.issuer_key_generation
            || key.revoked
            || now_unix_ms <= 0
            || now_unix_ms < key.not_before_unix_seconds * 1000
            || now_unix_ms >= key.not_after_unix_seconds * 1000
            || claims.iat < key.not_before_unix_seconds
            || claims.exp > key.not_after_unix_seconds
        {
            return Err(ImportProofError::TrustUnavailable);
        }
        let public_key = decode(&key.public_key_base64url)
            .map_err(|_| ImportProofError::TrustUnavailable)?
            .try_into()
            .map_err(|_| ImportProofError::TrustUnavailable)?;
        Ok(SelectedKey { public_key })
    }
}

fn identifier(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[cfg(unix)]
fn read_file(path: &Path) -> Result<Vec<u8>> {
    use std::{
        fs::OpenOptions,
        io::Read,
        os::unix::fs::{MetadataExt, OpenOptionsExt},
    };
    const LIMIT: usize = 65_536;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| ImportProofError::TrustUnavailable)?;
    let metadata = file
        .metadata()
        .map_err(|_| ImportProofError::TrustUnavailable)?;
    // SAFETY: geteuid has no arguments or memory preconditions.
    let effective_uid = unsafe { libc::geteuid() };
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > LIMIT as u64
        || metadata.mode() & 0o022 != 0
        || (metadata.uid() != 0 && metadata.uid() != effective_uid)
    {
        return Err(ImportProofError::TrustUnavailable);
    }
    let mut raw = Vec::new();
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|_| ImportProofError::TrustUnavailable)?;
    if raw.is_empty() || raw.len() > LIMIT {
        return Err(ImportProofError::TrustUnavailable);
    }
    Ok(raw)
}
#[cfg(not(unix))]
fn read_file(_path: &Path) -> Result<Vec<u8>> {
    Err(ImportProofError::TrustUnavailable)
}
