//! Additive static host-key durability. Local provenance is not upstream eligibility.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Result};
use nac_credential_store::{
    read_auth_bytes_from_path_limited, read_mounted_credential_string, with_credential_lock,
    write_auth_string_to_path,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const RECORD_VERSION: u32 = 1;
const MAX_CONSUMED_IDS: usize = 4096;
const SCOPE: &str = "managed:inference";
const KIND: &str = "clerk_api_key";

/// Controller-authored nonsecret identity, compared before any private write.
/// Product requests and bootstrap bytes cannot supply this authority.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManagedHostKeyBinding {
    pub bootstrap_id: String,
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub pvc_uid: String,
    pub organization_id: String,
    pub owner_epoch: u64,
    pub key_generation: u64,
    pub local_key_id: String,
    pub key_id: String,
    pub clerk_instance_id: String,
    pub inference_origin: String,
}

impl ManagedHostKeyBinding {
    pub fn validate(&self) -> Result<()> {
        for value in [
            &self.bootstrap_id,
            &self.managed_host_id,
            &self.organization_id,
            &self.local_key_id,
        ] {
            canonical_uuid(value)?;
        }
        for value in [
            &self.host_incarnation_id,
            &self.pvc_uid,
            &self.key_id,
            &self.clerk_instance_id,
        ] {
            if value.is_empty()
                || value.len() > 256
                || value.chars().any(char::is_whitespace)
                || value.chars().any(char::is_control)
            {
                bail!("managed host-key identity is invalid");
            }
        }
        if self.owner_epoch == 0
            || self.key_generation == 0
            || self.owner_epoch > i64::MAX as u64
            || self.key_generation > i64::MAX as u64
        {
            bail!("managed host-key generations must be positive");
        }
        let url = super::arcee::validate_stored_base_url(&self.inference_origin)
            .map_err(|_| anyhow!("managed host-key inference origin is not approved"))?;
        if url.origin().ascii_serialization() != self.inference_origin {
            bail!("managed host-key inference origin must be an exact HTTPS origin");
        }
        Ok(())
    }

    fn same_owner(&self, other: &Self) -> bool {
        self.managed_host_id == other.managed_host_id
            && self.host_incarnation_id == other.host_incarnation_id
            && self.pvc_uid == other.pvc_uid
            && self.organization_id == other.organization_id
            && self.owner_epoch == other.owner_epoch
            && self.clerk_instance_id == other.clerk_instance_id
            && self.inference_origin == other.inference_origin
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeliveredKey {
    version: u32,
    bootstrap_id: String,
    managed_host_id: String,
    host_incarnation_id: String,
    pvc_uid: String,
    organization_id: String,
    owner_epoch: u64,
    key_generation: u64,
    local_key_id: String,
    key_id: String,
    clerk_instance_id: String,
    inference_origin: String,
    credential_kind: String,
    scopes: Vec<String>,
    api_key: String,
}

impl DeliveredKey {
    fn into_bound_key(self, expected: &ManagedHostKeyBinding) -> Result<String> {
        if self.version != 3 || self.credential_kind != KIND || self.scopes != [SCOPE] {
            bail!("managed host-key bootstrap class/version/scope is invalid");
        }
        let binding = ManagedHostKeyBinding {
            bootstrap_id: self.bootstrap_id,
            managed_host_id: self.managed_host_id,
            host_incarnation_id: self.host_incarnation_id,
            pvc_uid: self.pvc_uid,
            organization_id: self.organization_id,
            owner_epoch: self.owner_epoch,
            key_generation: self.key_generation,
            local_key_id: self.local_key_id,
            key_id: self.key_id,
            clerk_instance_id: self.clerk_instance_id,
            inference_origin: self.inference_origin,
        };
        binding.validate()?;
        if &binding != expected {
            bail!("managed host-key bootstrap does not match trusted configuration");
        }
        validate_secret(&self.api_key)?;
        Ok(self.api_key)
    }
}

// Secret-bearing records deliberately have no Debug implementation.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Authority {
    version: u32,
    binding: ManagedHostKeyBinding,
    api_key: Option<String>,
    consumed_bootstrap_ids: Vec<String>,
    generation_watermark: u64,
}

impl Authority {
    fn validate(&self) -> Result<()> {
        self.binding.validate()?;
        if self.version != RECORD_VERSION
            || self.generation_watermark != self.binding.key_generation
            || self.consumed_bootstrap_ids.is_empty()
            || self.consumed_bootstrap_ids.len() > MAX_CONSUMED_IDS
            || !self
                .consumed_bootstrap_ids
                .contains(&self.binding.bootstrap_id)
        {
            bail!("managed host-key authority is invalid");
        }
        let mut unique = std::collections::HashSet::new();
        for id in &self.consumed_bootstrap_ids {
            canonical_uuid(id)?;
            if !unique.insert(id) {
                bail!("managed host-key consumed history is invalid");
            }
        }
        if let Some(key) = &self.api_key {
            validate_secret(key)?;
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct Receipt<'a> {
    version: u32,
    #[serde(flatten)]
    binding: &'a ManagedHostKeyBinding,
    credential_kind: &'static str,
    scopes: [&'static str; 1],
    disposition: &'static str,
}

/// A controller-selected durable root. Paths never enter model/session state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedHostKeyStore {
    authority: PathBuf,
    receipt: PathBuf,
    lock: PathBuf,
    legacy_auth: PathBuf,
}

/// Ephemeral construction capability; never deserialized from a session/request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrustedManagedHostKey {
    store: ManagedHostKeyStore,
    binding: ManagedHostKeyBinding,
}

impl TrustedManagedHostKey {
    pub fn new(root: &Path, binding: ManagedHostKeyBinding) -> Result<Self> {
        binding.validate()?;
        if !root.is_absolute() {
            bail!("managed host-key root must be absolute");
        }
        let store = ManagedHostKeyStore::new(root);
        Ok(Self { store, binding })
    }

    pub fn binding(&self) -> &ManagedHostKeyBinding {
        &self.binding
    }

    /// Read-only local availability; never repairs receipt projection or contacts a provider.
    pub fn check_available(&self) -> Result<()> {
        self.read_available_authority().map(|_| ())
    }

    fn read_available_authority(&self) -> Result<Authority> {
        // Atomic publication makes a no-follow read a complete snapshot. This
        // observer must not wait on a credential writer's cross-process lock.
        self.store.ensure_no_legacy_auth()?;
        let authority = self
            .store
            .read_authority()?
            .ok_or_else(|| anyhow!("managed host-key authority is unavailable"))?;
        require_binding(&authority, &self.binding)?;
        if authority.api_key.is_none() {
            bail!("managed host-key is consumed but unavailable");
        }
        Ok(authority)
    }

    pub(crate) fn credential(&self) -> Result<String> {
        self.store.with_bound_authority(&self.binding, |authority| {
            self.store.ensure_no_legacy_auth()?;
            authority
                .api_key
                .ok_or_else(|| anyhow!("managed host-key is consumed but unavailable"))
        })
    }
}

/// Host execution authority is independent of model credentials and selection.
/// A denial is latched for this trusted binding; file restoration cannot clear it.
#[derive(Clone)]
pub struct ManagedHostExecutionAuthority {
    credential: TrustedManagedHostKey,
    denied: std::sync::Arc<std::sync::atomic::AtomicBool>,
    observation: std::sync::Arc<std::sync::Mutex<Option<[u8; 32]>>>,
}

impl std::fmt::Debug for ManagedHostExecutionAuthority {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedHostExecutionAuthority")
            .field("binding", self.binding())
            .field(
                "denied",
                &self.denied.load(std::sync::atomic::Ordering::Acquire),
            )
            .finish_non_exhaustive()
    }
}

impl PartialEq for ManagedHostExecutionAuthority {
    fn eq(&self, other: &Self) -> bool {
        self.credential == other.credential && std::sync::Arc::ptr_eq(&self.denied, &other.denied)
    }
}

impl ManagedHostExecutionAuthority {
    pub fn new(credential: TrustedManagedHostKey) -> Self {
        Self {
            credential,
            denied: Default::default(),
            observation: Default::default(),
        }
    }

    pub fn binding(&self) -> &ManagedHostKeyBinding {
        self.credential.binding()
    }

    pub fn check_available(&self) -> Result<()> {
        use std::sync::atomic::Ordering;
        if self.denied.load(Ordering::Acquire) {
            bail!("managed host execution authority is denied");
        }
        let available = self
            .credential
            .read_available_authority()
            .and_then(|authority| {
                use sha2::Digest;
                let raw = serde_json::to_vec(&authority)
                    .map_err(|_| anyhow!("managed host execution authority cannot be validated"))?;
                let digest: [u8; 32] = sha2::Sha256::digest(raw).into();
                let mut observation = self
                    .observation
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                match *observation {
                    Some(previous) if previous != digest => {
                        bail!("managed host execution authority changed")
                    }
                    None => *observation = Some(digest),
                    _ => {}
                }
                Ok(())
            });
        if available.is_err() {
            self.denied.store(true, Ordering::Release);
            bail!(
                "managed host execution authority is unavailable; new trusted binding is required"
            );
        }
        if self.denied.load(Ordering::Acquire) {
            bail!("managed host execution authority is denied");
        }
        Ok(())
    }
}

impl ManagedHostKeyStore {
    pub fn new(root: &Path) -> Self {
        Self {
            authority: root.join("managed_host_key.json"),
            receipt: root.join("managed_host_key_receipt.json"),
            lock: root.join("arcee_auth.json.lock"),
            legacy_auth: root.join("arcee_auth.json"),
        }
    }

    /// Import once; consumed state never consults the mount, even after revoke.
    /// This proves local binding only. Inference must independently verify policy.
    pub fn import(&self, expected: &ManagedHostKeyBinding, input: &Path) -> Result<()> {
        self.import_with_failpoint(expected, input, || Ok(()))
    }

    fn import_with_failpoint(
        &self,
        expected: &ManagedHostKeyBinding,
        input: &Path,
        after_authority: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
        expected.validate()?;
        with_credential_lock(&self.lock, || {
            self.ensure_no_legacy_auth()?;
            if let Some(authority) = self.read_authority()? {
                require_binding(&authority, expected)?;
                return self.project_receipt(&authority);
            }
            // A projection without its private authority is retained evidence,
            // never permission to replay a mounted generation into a lost slot.
            match std::fs::symlink_metadata(&self.receipt) {
                Ok(_) => {
                    bail!("managed host-key authority is missing; explicit recovery is required")
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => bail!("managed host-key receipt cannot be inspected"),
            }
            let key = read_delivery(input, expected)?;
            let authority = Authority {
                version: RECORD_VERSION,
                binding: expected.clone(),
                api_key: Some(key),
                consumed_bootstrap_ids: vec![expected.bootstrap_id.clone()],
                generation_watermark: expected.key_generation,
            };
            self.write_authority(&authority)?;
            after_authority()?;
            self.project_receipt(&authority)
        })
    }

    /// Offline readiness checks only local provenance and a nonempty key slot.
    pub fn validate_local(&self, expected: &ManagedHostKeyBinding) -> Result<()> {
        self.with_bound_authority(expected, |authority| {
            self.ensure_no_legacy_auth()?;
            if authority.api_key.is_none() {
                bail!("managed host-key is consumed but unavailable; fenced repair is required");
            }
            self.project_receipt(&authority)
        })
    }

    /// Called only after a separately authenticated exact-generation revocation.
    /// Tombstones survive. This method does not revoke the provider key itself.
    pub fn record_revocation(&self, expected: &ManagedHostKeyBinding) -> Result<()> {
        self.record_revocation_with_authority_check(expected, || Ok(()))
    }

    /// Recheck an inward current-authority port after lock wait and before write.
    /// The caller still owns sender authentication and the lifecycle barrier.
    pub fn record_revocation_with_authority_check(
        &self,
        expected: &ManagedHostKeyBinding,
        mut check_current: impl FnMut() -> Result<()>,
    ) -> Result<()> {
        expected.validate()?;
        with_credential_lock(&self.lock, || {
            check_current()?;
            let mut authority = self
                .read_authority()?
                .ok_or_else(|| anyhow!("managed host-key authority is unavailable"))?;
            require_binding(&authority, expected)?;
            authority.api_key = None;
            check_current()?;
            self.write_authority(&authority)?;
            self.project_receipt(&authority)
        })
    }

    /// Same-owner empty-slot repair; caller owns upstream revoke/issuance proof.
    /// Owner transfer and active-slot rotation cannot use this importer.
    pub fn repair(
        &self,
        predecessor: &ManagedHostKeyBinding,
        next: &ManagedHostKeyBinding,
        input: &Path,
    ) -> Result<()> {
        self.repair_with_authority_check(predecessor, next, input, || Ok(()))
    }

    /// Private publication rechecks current authority inside the credential lock.
    /// A callback failure never authorizes stale projection or key publication.
    pub fn repair_with_authority_check(
        &self,
        predecessor: &ManagedHostKeyBinding,
        next: &ManagedHostKeyBinding,
        input: &Path,
        mut check_current: impl FnMut() -> Result<()>,
    ) -> Result<()> {
        predecessor.validate()?;
        next.validate()?;
        if !predecessor.same_owner(next)
            || next.key_generation <= predecessor.key_generation
            || next.bootstrap_id == predecessor.bootstrap_id
        {
            bail!("managed host-key repair requires same-owner successor generation");
        }
        with_credential_lock(&self.lock, || {
            check_current()?;
            self.ensure_no_legacy_auth()?;
            let mut authority = self
                .read_authority()?
                .ok_or_else(|| anyhow!("managed host-key authority is unavailable"))?;
            if authority.binding == *next {
                check_current()?;
                return self.project_receipt(&authority);
            }
            require_binding(&authority, predecessor)?;
            if authority.api_key.is_some() {
                bail!("managed host-key repair preserves an active credential");
            }
            if authority
                .consumed_bootstrap_ids
                .contains(&next.bootstrap_id)
                || authority.consumed_bootstrap_ids.len() >= MAX_CONSUMED_IDS
            {
                bail!("managed host-key generation is consumed or history capacity is exhausted");
            }
            let key = read_delivery(input, next)?;
            authority.binding = next.clone();
            authority.api_key = Some(key);
            authority.generation_watermark = next.key_generation;
            authority
                .consumed_bootstrap_ids
                .push(next.bootstrap_id.clone());
            check_current()?;
            self.write_authority(&authority)?;
            self.project_receipt(&authority)
        })
    }

    fn with_bound_authority<T>(
        &self,
        expected: &ManagedHostKeyBinding,
        operation: impl FnOnce(Authority) -> Result<T>,
    ) -> Result<T> {
        expected.validate()?;
        with_credential_lock(&self.lock, || {
            let authority = self
                .read_authority()?
                .ok_or_else(|| anyhow!("managed host-key authority is unavailable"))?;
            require_binding(&authority, expected)?;
            operation(authority)
        })
    }

    fn ensure_no_legacy_auth(&self) -> Result<()> {
        match std::fs::symlink_metadata(&self.legacy_auth) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => bail!("retained legacy Arcee authorization blocks managed host-key use; explicit clearance is required"),
        }
    }

    fn read_authority(&self) -> Result<Option<Authority>> {
        let Some(raw) = read_auth_bytes_from_path_limited(&self.authority, 256 * 1024)? else {
            return Ok(None);
        };
        let authority: Authority = serde_json::from_slice(&raw)
            .map_err(|_| anyhow!("managed host-key authority is invalid"))?;
        authority.validate()?;
        Ok(Some(authority))
    }

    fn write_authority(&self, authority: &Authority) -> Result<()> {
        authority.validate()?;
        let raw = serde_json::to_string(authority)
            .map_err(|_| anyhow!("failed to serialize managed host-key authority"))?;
        write_auth_string_to_path(&self.authority, &raw)
    }

    fn project_receipt(&self, authority: &Authority) -> Result<()> {
        let receipt = Receipt {
            version: 3,
            binding: &authority.binding,
            credential_kind: KIND,
            scopes: [SCOPE],
            disposition: "imported",
        };
        let raw = serde_json::to_string(&receipt)
            .map_err(|_| anyhow!("failed to serialize managed host-key receipt"))?;
        write_auth_string_to_path(&self.receipt, &raw)
    }
}

fn read_delivery(input: &Path, expected: &ManagedHostKeyBinding) -> Result<String> {
    let raw = read_mounted_credential_string(input)?
        .ok_or_else(|| anyhow!("managed host-key bootstrap is unavailable"))?;
    let delivery: DeliveredKey = serde_json::from_str(&raw)
        .map_err(|_| anyhow!("managed host-key bootstrap is not valid strict v3 JSON"))?;
    delivery.into_bound_key(expected)
}

fn require_binding(authority: &Authority, expected: &ManagedHostKeyBinding) -> Result<()> {
    if &authority.binding != expected {
        bail!("managed host-key authority does not match trusted configuration");
    }
    Ok(())
}

fn canonical_uuid(value: &str) -> Result<()> {
    let uuid = Uuid::parse_str(value)
        .map_err(|_| anyhow!("managed host-key identity must be a canonical UUID"))?;
    if uuid.to_string() != value {
        bail!("managed host-key identity must be a canonical UUID");
    }
    Ok(())
}

fn validate_secret(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 8192
        || value.chars().any(char::is_whitespace)
        || value.chars().any(char::is_control)
    {
        bail!("managed host-key credential is invalid");
    }
    Ok(())
}

#[cfg(test)]
#[path = "managed_host_key_tests.rs"]
mod tests;
