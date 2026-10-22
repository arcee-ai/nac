//! Initial import completion from private authority, never from receipt projection.
use super::*;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};

/// Nonserializable, noncloneable local custody completion. This is neither Ready
/// nor an inference/runtime grant. Trusted composition supplies current fences.
/// Production callers cannot use a callback to manufacture private custody.
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
    denied: AtomicBool,
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
            denied: AtomicBool::new(false),
        };
        completion.check_current(check_current)?;
        Ok(completion)
    }
}

impl InitialHostKeyCustody {
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
        let result = self.store.with_bound_authority(&self.binding, |authority| {
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
            self.denied.store(true, Ordering::Release);
        }
        result
    }
}

// Private comparison only. The digest includes private slot/history bytes and
// is never returned in the public proof, Debug output or controller Evidence.
fn state_digest(authority: &Authority) -> Result<[u8; 32]> {
    let raw = serde_json::to_vec(authority)
        .map_err(|_| anyhow!("initial custody private state unavailable"))?;
    Ok(Sha256::digest(raw).into())
}
