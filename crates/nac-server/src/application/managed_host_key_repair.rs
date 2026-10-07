//! Callable host-key lifecycle composition, deliberately absent from startup/routes.

use std::{cell::Cell, path::PathBuf, sync::Arc};

use anyhow::{anyhow, bail, Result};
use nac_core::model::{ManagedHostKeyBinding, ManagedHostKeyStore};
use nac_managed::ManagedHostConfig;

use super::managed::ManagedModelProfile;

/// Borrowed nonsecret application inputs, not a canonical wire or an auth proof.
/// The successor is selected by operator configuration, never a bootstrap body.
#[derive(Clone, Copy, Debug)]
pub enum ManagedHostKeyMutation<'a> {
    RecordRevocation {
        current: &'a ManagedHostKeyBinding,
    },
    Repair {
        predecessor: &'a ManagedHostKeyBinding,
        successor: &'a ManagedHostKeyBinding,
    },
}

/// One synchronous publication callback receiving its fresh authority check.
pub type ManagedHostKeyApply<'a> = dyn FnMut(&mut dyn FnMut() -> Result<()>) -> Result<()> + 'a;

/// Construction-time port for a separately authenticated privileged sender.
///
/// An implementation must bind the accepted canonical lifecycle/readback to the
/// exact mutation, verify current host/PVC/org/owner/key/actor and upstream
/// revocation/issuance proof, and hold its current lifecycle dispatch barrier
/// through `apply`. Departure, revocation and repair must use the same barrier;
/// a point-in-time check followed by an unlocked callback is insufficient.
/// Duplicate delivery also requires fresh authority for that exact operation.
///
/// Pass `apply` a fresh authority check that remains usable under that barrier;
/// it runs after credential-lock wait and immediately before private publication.
/// Expiry must be rechecked even while departure is blocked by the barrier.
/// Invoke `apply` exactly once only while authorized. Never derive permission
/// from a legacy upgrade assertion, startup configuration or local receipt.
/// This port defines no provider credential, callback URI or public wire.
pub trait ManagedHostKeyLifecycleAuthority: Send + Sync {
    fn with_current_authority(
        &self,
        mutation: ManagedHostKeyMutation<'_>,
        apply: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()>;
}

/// Production-safe default until the sender and lifecycle contract are accepted.
#[derive(Default)]
pub struct UnconfiguredManagedHostKeyLifecycleAuthority;

impl ManagedHostKeyLifecycleAuthority for UnconfiguredManagedHostKeyLifecycleAuthority {
    fn with_current_authority(
        &self,
        _mutation: ManagedHostKeyMutation<'_>,
        _apply: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()> {
        bail!("authenticated managed host-key lifecycle sender is unavailable")
    }
}

/// Private mounted-delivery adapter over the existing durable store contract.
///
/// Construction uses validated v3 operator configuration and the fixed private
/// delivery path. There is no arbitrary request path, secret argument, device
/// login, or automatic startup invocation. Successful repair publishes the
/// existing exact receipt; a new serving lifetime must use successor config.
/// Existing latched execution authorities are never reopened by this service.
pub struct ManagedHostKeyRepairService {
    store: ManagedHostKeyStore,
    delivery: PathBuf,
    current: ManagedHostKeyBinding,
    authority: Arc<dyn ManagedHostKeyLifecycleAuthority>,
}

impl ManagedHostKeyRepairService {
    /// Creates a callable boundary whose mutations always deny before private I/O.
    pub fn from_config(config: &ManagedHostConfig) -> Result<Self> {
        Self::with_authority(
            config,
            Arc::new(UnconfiguredManagedHostKeyLifecycleAuthority),
        )
    }

    /// For trusted composition only; no production sender factory is installed.
    /// A supplied port must meet the full current-authority/barrier contract.
    pub fn with_authority(
        config: &ManagedHostConfig,
        authority: Arc<dyn ManagedHostKeyLifecycleAuthority>,
    ) -> Result<Self> {
        let profile = ManagedModelProfile::from_config(config)?;
        let trusted = profile.trusted_managed_host_key().ok_or_else(|| {
            anyhow!("managed host-key lifecycle requires the v3 static-key profile")
        })?;
        Ok(Self {
            store: ManagedHostKeyStore::new(&config.state_root),
            delivery: config.model_credential_file.clone(),
            current: trusted.binding().clone(),
            authority,
        })
    }

    /// Records only an independently authenticated exact-generation cutoff.
    /// This does not revoke a provider key or declare a departed owner eligible.
    pub fn record_revocation(&self) -> Result<()> {
        self.mutate(ManagedHostKeyMutation::RecordRevocation {
            current: &self.current,
        })
    }

    /// Repairs an empty slot using full predecessor CAS and operator successor.
    /// Errors can follow a durable commit (lost response); never roll back or
    /// automatically replay. Retry requires fresh exact-operation authorization.
    pub fn repair(&self, predecessor: &ManagedHostKeyBinding) -> Result<()> {
        self.mutate(ManagedHostKeyMutation::Repair {
            predecessor,
            successor: &self.current,
        })
    }

    fn mutate(&self, mutation: ManagedHostKeyMutation<'_>) -> Result<()> {
        let attempts = Cell::new(0);
        let committed = Cell::new(false);
        let authorized = {
            let mut apply = |check_current: &mut dyn FnMut() -> Result<()>| {
                attempts.set(attempts.get() + 1);
                if attempts.get() != 1 {
                    bail!("managed host-key lifecycle callback was repeated");
                }
                match mutation {
                    ManagedHostKeyMutation::RecordRevocation { current } => {
                        self.store
                            .record_revocation_with_authority_check(current, &mut *check_current)?;
                    }
                    ManagedHostKeyMutation::Repair {
                        predecessor,
                        successor,
                    } => {
                        self.store.repair_with_authority_check(
                            predecessor,
                            successor,
                            &self.delivery,
                            &mut *check_current,
                        )?;
                        // A duplicate projection is not evidence that a slot
                        // cut off after the first repair is still available.
                        self.store.validate_local(successor)?;
                    }
                }
                check_current()?;
                committed.set(true);
                Ok(())
            };
            self.authority.with_current_authority(mutation, &mut apply)
        };
        // Sender errors are opaque: future transport failures may carry private
        // material. A failure after commit remains uncertain, not rolled back.
        if authorized.is_err() || attempts.get() != 1 || !committed.get() {
            bail!("managed host-key lifecycle authority or completion is unavailable");
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "managed_host_key_repair_tests.rs"]
mod tests;
