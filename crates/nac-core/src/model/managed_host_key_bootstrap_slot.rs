//! Original pre-provider slot resources. No provider/import/runtime grant.
use super::*;
use crate::runtime::CreateGlobalSourceRoots;
use nac_credential_store::CredentialSlotReservation;
use std::{
    ffi::OsStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
/// Original provisional DATA. Provider key identity deliberately does not exist.
/// The actual enrolled source/primary join must authenticate these observations.
pub struct InitialBootstrapSlotBinding {
    pub operation_id: Uuid,
    pub bootstrap_id: Uuid,
    pub managed_host_id: Uuid,
    pub host_incarnation_id: String,
    pub pvc_uid: String,
    pub organization_id: Uuid,
    pub owner_epoch: u64,
    pub key_generation: u64,
    pub local_key_id: Uuid,
    pub clerk_instance_id: String,
    pub inference_origin: String,
    pub intent_sha256: [u8; 32],
    pub request_nonce: [u8; 32],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialBootstrapSlotRefusal {
    Occupied,
    Unavailable,
}
impl std::fmt::Display for InitialBootstrapSlotRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Occupied => "initial bootstrap slot occupied",
            Self::Unavailable => "initial bootstrap slot unavailable",
        })
    }
}
impl std::error::Error for InitialBootstrapSlotRefusal {}
/// Same startup roots, exclusive writer fence and one-shot import continuation.
/// Capture is resource custody only, not eligibility or permission to create a
/// provider key. Retain this SAME Arc before transport and any remote work.
/// Unknown/cancel/drop keeps the durable quarantine; rows cannot reconstruct it.
/// ```compile_fail
/// fn cloneable<T:Clone>(){} cloneable::<nac_core::model::InitialBootstrapSlot>();
/// ```
/// ```compile_fail
/// let _ = nac_core::model::InitialBootstrapSlot {};
/// ```
pub struct InitialBootstrapSlot {
    roots: Arc<CreateGlobalSourceRoots>,
    directory: CredentialSlotReservation,
    store: ManagedHostKeyStore,
    binding: InitialBootstrapSlotBinding,
    transferred: AtomicBool,
    imported: AtomicBool,
    denied: AtomicBool,
}
impl InitialBootstrapSlotBinding {
    fn validate(&self) -> Result<()> {
        ensure!(
            [
                self.operation_id,
                self.bootstrap_id,
                self.managed_host_id,
                self.organization_id,
                self.local_key_id
            ]
            .iter()
            .all(|id| !id.is_nil())
                && self.intent_sha256 != [0; 32]
                && self.request_nonce != [0; 32],
            "bootstrap slot binding unavailable"
        );
        ensure!(
            [
                &self.host_incarnation_id,
                &self.pvc_uid,
                &self.clerk_instance_id
            ]
            .iter()
            .all(|s| !s.is_empty()
                && s.len() <= 256
                && !s.chars().any(|c| c.is_whitespace() || c.is_control())),
            "bootstrap slot identity unavailable"
        );
        ensure!(
            (1..=i64::MAX as u64).contains(&self.owner_epoch)
                && (1..=i64::MAX as u64).contains(&self.key_generation),
            "bootstrap slot generation unavailable"
        );
        let origin = super::super::arcee::validate_stored_base_url(&self.inference_origin)?;
        ensure!(
            origin.origin().ascii_serialization() == self.inference_origin,
            "bootstrap slot origin unavailable"
        );
        Ok(())
    }
    fn matches(&self, b: &ManagedHostKeyBinding) -> bool {
        self.bootstrap_id.to_string() == b.bootstrap_id
            && self.managed_host_id.to_string() == b.managed_host_id
            && self.host_incarnation_id == b.host_incarnation_id
            && self.pvc_uid == b.pvc_uid
            && self.organization_id.to_string() == b.organization_id
            && self.owner_epoch == b.owner_epoch
            && self.key_generation == b.key_generation
            && self.local_key_id.to_string() == b.local_key_id
            && self.clerk_instance_id == b.clerk_instance_id
            && self.inference_origin == b.inference_origin
    }
}
impl InitialBootstrapSlot {
    pub(crate) fn original_roots(&self) -> &Arc<CreateGlobalSourceRoots> {
        &self.roots
    }

    /// Borrow the actual NAC_HOME descriptor from SAME startup namespace owner;
    /// no configured-path reopen, directory creation or provider key is involved.
    pub fn capture(
        roots: Arc<CreateGlobalSourceRoots>,
        binding: InitialBootstrapSlotBinding,
        original_cutoff: Instant,
    ) -> std::result::Result<Arc<Self>, InitialBootstrapSlotRefusal> {
        let result = (|| -> Result<Arc<Self>> {
            binding.validate()?;
            let (directory, path) = roots.original_nac_home_directory()?;
            let store = ManagedHostKeyStore::new(path);
            let reservation = CredentialSlotReservation::capture(directory, original_cutoff)?;
            let slot = Arc::new(Self {
                roots,
                directory: reservation,
                store,
                binding,
                transferred: AtomicBool::new(false),
                imported: AtomicBool::new(false),
                denied: AtomicBool::new(false),
            });
            let occupied = slot.directory.with_credential_lock(
                OsStr::new("arcee_auth.json.lock"),
                |directory| {
                    for name in [
                        "managed_host_key.json",
                        "managed_host_key_receipt.json",
                        "arcee_auth.json",
                    ] {
                        if directory.exists(OsStr::new(name))? {
                            return Ok(true);
                        }
                    }
                    Ok(false)
                },
            )?;
            if occupied {
                slot.directory.finish_known_import()?; // known local negative; no provider work exists
                return Err(InitialBootstrapSlotRefusal::Occupied.into());
            }
            slot.check_current()?;
            Ok(slot)
        })();
        result.map_err(|error| {
            error
                .downcast_ref::<InitialBootstrapSlotRefusal>()
                .copied()
                .unwrap_or(InitialBootstrapSlotRefusal::Unavailable)
        })
    }
    /// Bounded veto only, suitable inside existing Core locks.
    pub fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "initial bootstrap slot denied"
        );
        self.roots.check_denial()?;
        self.directory.check_denial()
    }
    /// Physical original-namespace checks; never call while SQL/key-locked.
    pub fn check_current(&self) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            self.roots.check_current()?;
            self.directory.check_current()?;
            self.check_denial()
        })();
        if checked.is_err() {
            self.deny();
        }
        checked
    }
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        self.directory.deny();
    }
    pub fn binding(&self) -> &InitialBootstrapSlotBinding {
        &self.binding
    }
    pub fn original_cutoff(&self) -> Instant {
        self.directory.original_cutoff()
    }
    pub(crate) fn transfer(
        self: &Arc<Self>,
        source: Option<&Arc<Self>>,
        store: &ManagedHostKeyStore,
        binding: &ManagedHostKeyBinding,
        deadline: Instant,
    ) -> Result<()> {
        let result = (|| {
            self.check_current()?;
            binding.validate()?;
            ensure!(
                source.is_some_and(|original| Arc::ptr_eq(self, original))
                    && store == &self.store
                    && self.binding.matches(binding)
                    && deadline <= self.original_cutoff(),
                "bootstrap slot original continuation differs"
            );
            ensure!(
                self.transferred
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok(),
                "bootstrap slot continuation already transferred"
            );
            Ok(())
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
    pub(crate) fn import(
        self: &Arc<Self>,
        expected: &ManagedHostKeyBinding,
        input: &Path,
        mut current: impl FnMut() -> Result<()>,
    ) -> Result<InitialHostKeyCustody> {
        self.check_current()?;
        ensure!(
            self.transferred.load(Ordering::Acquire) && self.binding.matches(expected),
            "bootstrap slot not transferred"
        );
        ensure!(
            self.imported
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok(),
            "bootstrap slot import already attempted"
        );
        let private_state = self.directory.with_credential_lock(
            OsStr::new("arcee_auth.json.lock"),
            |directory| {
                self.check_denial()?;
                current()?;
                for name in [
                    "managed_host_key.json",
                    "managed_host_key_receipt.json",
                    "arcee_auth.json",
                ] {
                    ensure!(
                        !directory.exists(OsStr::new(name))?,
                        "bootstrap slot no longer empty"
                    );
                }
                let authority = Authority {
                    version: RECORD_VERSION,
                    binding: expected.clone(),
                    api_key: Some(read_delivery(input, expected)?),
                    consumed_bootstrap_ids: vec![expected.bootstrap_id.clone()],
                    generation_watermark: expected.key_generation,
                };
                authority.validate()?;
                current()?;
                self.check_denial()?;
                directory.write(
                    OsStr::new("managed_host_key.json"),
                    &serde_json::to_string(&authority)?,
                )?;
                current()?;
                self.check_denial()?;
                let receipt = Receipt {
                    version: 3,
                    binding: expected,
                    credential_kind: KIND,
                    scopes: [SCOPE],
                    disposition: "imported",
                };
                directory.write(
                    OsStr::new("managed_host_key_receipt.json"),
                    &serde_json::to_string(&receipt)?,
                )?;
                current()?;
                self.check_denial()?;
                initial_custody::state_digest(&authority)
            },
        )?;
        self.check_current()?;
        Ok(initial_custody::from_bootstrap_slot(
            self.store.clone(),
            expected.clone(),
            private_state,
            Arc::clone(self),
        ))
    }
    pub(super) fn with_bound_authority<T>(
        &self,
        expected: &ManagedHostKeyBinding,
        operation: impl FnOnce(Authority) -> Result<T>,
    ) -> Result<T> {
        self.check_current()?;
        self.directory
            .with_credential_lock(OsStr::new("arcee_auth.json.lock"), |directory| {
                self.check_denial()?;
                ensure!(
                    !directory.exists(OsStr::new("arcee_auth.json"))?,
                    "legacy authorization blocks bootstrap slot"
                );
                let raw = directory
                    .read(OsStr::new("managed_host_key.json"), 256 * 1024)?
                    .ok_or_else(|| anyhow!("bootstrap slot authority unavailable"))?;
                let authority: Authority = serde_json::from_slice(&raw)
                    .map_err(|_| anyhow!("bootstrap slot authority unavailable"))?;
                authority.validate()?;
                require_binding(&authority, expected)?;
                let result = operation(authority);
                self.check_denial()?;
                result
            })
    }
    pub(crate) fn finish_known_import(&self) -> Result<()> {
        self.check_current()?;
        ensure!(
            self.imported.load(Ordering::Acquire),
            "bootstrap slot private import absent"
        );
        self.directory.finish_known_import()?;
        Ok(())
    }
}
impl Drop for InitialBootstrapSlot {
    fn drop(&mut self) {
        self.deny();
    }
}
use anyhow::ensure;
