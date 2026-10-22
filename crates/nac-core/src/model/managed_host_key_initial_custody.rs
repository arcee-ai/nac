//! Initial import completion from private authority, never from receipt projection.
use super::*;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Nonserializable, noncloneable local custody completion. This is neither Ready
/// nor an inference/runtime grant. Trusted composition supplies current fences.
/// Production composition cannot manufacture it using an all-equal callback;
/// genuine admission must enter through Core's authority service.
///
/// ```compile_fail
/// use nac_core::model::{ManagedHostKeyBinding, ManagedHostKeyStore};
/// fn forge(store: &ManagedHostKeyStore, binding: &ManagedHostKeyBinding, input: &std::path::Path) {
///     store.import_initial_custody(binding, input, || Ok(())).unwrap();
/// }
/// ```
pub struct InitialHostKeyCustody {
    store: ManagedHostKeyStore,
    binding: ManagedHostKeyBinding,
    private_state: [u8; 32],
    denied: Arc<AtomicBool>,
    #[cfg(unix)]
    bootstrap_slot: Option<Arc<super::InitialBootstrapSlot>>,
    #[cfg(unix)]
    original_roots: Option<Arc<crate::runtime::CreateGlobalSourceRoots>>,
    #[cfg(unix)]
    runtime_owner: Arc<std::sync::OnceLock<std::sync::Weak<crate::runtime::PostImportRuntimeHost>>>,
}

/// Denial only: retaining this cannot read or reconstruct private custody.
pub(crate) struct InitialCustodyInvalidator {
    denied: Arc<AtomicBool>,
    #[cfg(unix)]
    runtime_owner: Arc<std::sync::OnceLock<std::sync::Weak<crate::runtime::PostImportRuntimeHost>>>,
}
impl InitialCustodyInvalidator {
    pub(crate) fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        #[cfg(unix)]
        if let Some(runtime) = self.runtime_owner.get().and_then(std::sync::Weak::upgrade) {
            runtime.key_denied();
        }
    }
    pub(crate) fn is_denied(&self) -> bool {
        self.denied.load(Ordering::Acquire)
    }
}

impl ManagedHostKeyStore {
    /// Complete the actual initial importer under current fences. A late failure
    /// retains consumed private state; it never returns a completion or replays.
    pub(crate) fn import_initial_custody(
        &self,
        expected: &ManagedHostKeyBinding,
        input: &Path,
        mut check_current: impl FnMut() -> Result<()>,
    ) -> Result<InitialHostKeyCustody> {
        self.import_with_current_check(expected, input, &mut check_current, || Ok(()))?;
        let private_state = self.with_bound_authority(expected, |authority| {
            check_current()?;
            self.ensure_no_legacy_auth()?;
            if authority.api_key.is_none() {
                bail!("initial custody private slot unavailable");
            }
            let state = state_digest(&authority)?;
            check_current()?;
            Ok(state)
        })?;
        let completion = InitialHostKeyCustody {
            store: self.clone(),
            binding: expected.clone(),
            private_state,
            denied: Arc::new(AtomicBool::new(false)),
            #[cfg(unix)]
            bootstrap_slot: None,
            #[cfg(unix)]
            original_roots: None,
            #[cfg(unix)]
            runtime_owner: Arc::new(std::sync::OnceLock::new()),
        };
        completion.check_current(check_current)?;
        Ok(completion)
    }
}

#[cfg(unix)]
pub(super) fn from_bootstrap_slot(
    store: ManagedHostKeyStore,
    binding: ManagedHostKeyBinding,
    private_state: [u8; 32],
    slot: Arc<super::InitialBootstrapSlot>,
) -> InitialHostKeyCustody {
    InitialHostKeyCustody {
        store,
        binding,
        private_state,
        denied: Arc::new(AtomicBool::new(false)),
        original_roots: Some(Arc::clone(slot.original_roots())),
        bootstrap_slot: Some(slot),
        runtime_owner: Arc::new(std::sync::OnceLock::new()),
    }
}
impl InitialHostKeyCustody {
    #[cfg(unix)]
    pub(crate) fn retain_runtime_owner(
        &self,
        owner: std::sync::Weak<crate::runtime::PostImportRuntimeHost>,
    ) -> bool {
        self.runtime_owner.set(owner).is_ok()
    }
    #[cfg(unix)]
    pub(crate) fn owns_runtime(&self, owner: &crate::runtime::PostImportRuntimeHost) -> bool {
        self.runtime_owner
            .get()
            .is_some_and(|original| std::ptr::eq(original.as_ptr(), owner))
    }
    #[cfg(unix)]
    pub(crate) fn original_global_roots(
        &self,
    ) -> Option<&Arc<crate::runtime::CreateGlobalSourceRoots>> {
        self.original_roots.as_ref()
    }
    #[cfg(unix)]
    pub(crate) fn retain_original_roots(
        &mut self,
        roots: Option<Arc<crate::runtime::CreateGlobalSourceRoots>>,
    ) -> Result<()> {
        if let Some(roots) = roots {
            anyhow::ensure!(
                self.original_roots
                    .as_ref()
                    .is_none_or(|original| Arc::ptr_eq(original, &roots)),
                "initial custody original roots differ"
            );
            self.original_roots = Some(roots);
        }
        Ok(())
    }

    fn with_bound_authority<T>(&self, operation: impl FnOnce(Authority) -> Result<T>) -> Result<T> {
        #[cfg(unix)]
        if let Some(slot) = &self.bootstrap_slot {
            return slot.with_bound_authority(&self.binding, operation);
        }
        self.store.with_bound_authority(&self.binding, operation)
    }

    /// Negative-only bounded veto on this SAME original imported key owner.
    /// It never releases resources, reads a key, settles work or grants Ready.
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        #[cfg(unix)]
        if let Some(runtime) = self.runtime_owner.get().and_then(std::sync::Weak::upgrade) {
            runtime.key_denied();
        }
    }
    /// Bounded original denial observation, suitable within existing locks.
    /// Physical private-state currentness remains a separate checked operation.
    pub fn check_denial(&self) -> Result<()> {
        let result = (|| {
            if self.denied.load(Ordering::Acquire) {
                bail!("initial custody completion unavailable");
            }
            #[cfg(unix)]
            if let Some(slot) = &self.bootstrap_slot {
                slot.check_denial()?;
            }
            #[cfg(unix)]
            if let Some(roots) = &self.original_roots {
                roots.check_denial()?;
            }
            Ok(())
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
    /// Bind the admitted attempt's denial latch before custody is transferred.
    pub(crate) fn bind_initial_lifetime(&mut self, denied: Arc<AtomicBool>) {
        if self.denied.load(Ordering::Acquire) {
            denied.store(true, Ordering::Release);
        }
        self.denied = denied;
    }
    pub(crate) fn invalidation_handle(&self) -> InitialCustodyInvalidator {
        InitialCustodyInvalidator {
            denied: Arc::clone(&self.denied),
            #[cfg(unix)]
            runtime_owner: Arc::clone(&self.runtime_owner),
        }
    }
    pub(crate) fn belongs_to_initial_completion(
        &self,
        invalidator: &InitialCustodyInvalidator,
    ) -> bool {
        Arc::ptr_eq(&self.denied, &invalidator.denied)
    }
    /// Trusted Core model construction only. Reuse this original imported
    /// private slot under its credential lock; never resolve another source.
    #[cfg(unix)]
    pub(crate) fn model_key(&self, check_current: impl FnMut() -> Result<()>) -> Result<String> {
        self.with_model_authority(check_current, |authority| {
            authority
                .api_key
                .ok_or_else(|| anyhow!("initial custody private slot unavailable"))
        })
    }
    /// A session's own cancellation is not a revocation of the shared host.
    /// Key IO/integrity failures still poison the original custody. This private
    /// distinction is observed inside the actual credential lock, never supplied
    /// as caller metadata or used to overlook a failed check.
    #[cfg(unix)]
    pub(crate) fn check_model_current(
        &self,
        check_current: impl FnMut() -> Result<()>,
    ) -> Result<()> {
        self.with_model_authority(check_current, |_| Ok(()))
    }
    #[cfg(unix)]
    fn with_model_authority<T>(
        &self,
        mut check_current: impl FnMut() -> Result<()>,
        operation: impl FnOnce(Authority) -> Result<T>,
    ) -> Result<T> {
        self.check_denial()?;
        let mut scope_denied = false;
        let mut check_scope = || {
            let result = check_current();
            scope_denied |= result.is_err();
            result
        };
        let result = self.with_bound_authority(|authority| {
            check_scope()?;
            self.store.ensure_no_legacy_auth()?;
            if authority.api_key.is_none() || state_digest(&authority)? != self.private_state {
                bail!("initial custody private slot unavailable");
            }
            self.check_denial()?;
            let value = operation(authority)?;
            check_scope()?;
            self.check_denial()?;
            Ok(value)
        });
        if result.is_err() && !scope_denied {
            self.deny();
        }
        result
    }
    pub fn binding(&self) -> &ManagedHostKeyBinding {
        &self.binding
    }

    /// Read the genuine bound private slot/history without projecting a receipt.
    /// Current-fence checks bracket the read inside the same credential lock.
    /// Missing/revoked/replaced private state latches this completion unavailable.
    pub fn check_current(&self, mut check_current: impl FnMut() -> Result<()>) -> Result<()> {
        if self.denied.load(Ordering::Acquire) {
            bail!("initial custody completion unavailable");
        }
        let result = self.with_bound_authority(|authority| {
            check_current()?;
            self.store.ensure_no_legacy_auth()?;
            if authority.api_key.is_none() || state_digest(&authority)? != self.private_state {
                bail!("initial custody private slot unavailable");
            }
            check_current()?;
            if self.denied.load(Ordering::Acquire) {
                bail!("initial custody completion unavailable");
            }
            Ok(())
        });
        if result.is_err() {
            self.deny();
        }
        result
    }
}

// Private comparison only. The digest includes private slot/history bytes and
// is never returned in the public proof, Debug output or controller Evidence.
pub(super) fn state_digest(authority: &Authority) -> Result<[u8; 32]> {
    let raw = serde_json::to_vec(authority)
        .map_err(|_| anyhow!("initial custody private state unavailable"))?;
    Ok(Sha256::digest(raw).into())
}
