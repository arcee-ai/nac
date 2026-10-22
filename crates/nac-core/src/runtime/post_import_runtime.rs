//! Genuine original post-import runtime supervision, separate from CREATE.
//! Source construction only: this owner cannot execute, mint Ready or publish.
use super::{CompletedInitialImport, CreateGlobalSourceRoots};
use crate::model::InitialHostKeyCustody;
use anyhow::{anyhow, ensure, Result};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use uuid::Uuid;
fn unavailable() -> anyhow::Error {
    anyhow!("original post-import runtime unavailable")
}
/// Opaque same-host supervisor retained by Native after `run_imported`, before
/// SessionManager and acceptance. Original resources are captured infallibly;
/// `try_start` borrows this SAME allocation. An explicit operator lifetime is
/// mandatory; no import/CREATE/ACK clock or request identity is substituted.
/// ```compile_fail
/// let _ = nac_core::runtime::PostImportRuntimeHost {};
/// ```
/// ```compile_fail
/// fn cloneable<T:Clone>(){} cloneable::<nac_core::runtime::PostImportRuntimeHost>();
/// ```
/// ```compile_fail
/// fn encode(value:&nac_core::runtime::PostImportRuntimeHost) {let _=serde_json::to_vec(value);}
/// ```
pub struct PostImportRuntimeHost {
    custody: Arc<InitialHostKeyCustody>,
    completion: Arc<CompletedInitialImport>,
    roots: Arc<CreateGlobalSourceRoots>,
    creator: u32,
    process_incarnation: Uuid,
    runtime_incarnation: Uuid,
    captured: Instant,
    configured: Duration,
    cutoff: Mutex<Option<Instant>>,
    original: AtomicBool,
    attempted: AtomicBool,
    active: AtomicBool,
    denied: AtomicBool,
    changed: Notify,
    create_capacity:
        OnceLock<Arc<super::protected_execution_resources::capacity_source::RetainedCapacityInput>>,
    create_generation: AtomicU64,
}
pub(in crate::runtime) struct CreateHostMaterial<'a> {
    pub key: &'a Arc<InitialHostKeyCustody>,
    pub completion: &'a Arc<CompletedInitialImport>,
    pub roots: &'a Arc<CreateGlobalSourceRoots>,
    pub original_store: &'a std::path::Path,
}
impl PostImportRuntimeHost {
    /// Retain ALL genuine original allocations before checks/IO. The private
    /// one-shot latch belongs to actual custody, so a second wrapper cannot
    /// renew the lifetime even if a prior try_start failed or was cancelled.
    pub fn retain(
        custody: Arc<InitialHostKeyCustody>,
        completion: Arc<CompletedInitialImport>,
        roots: Arc<CreateGlobalSourceRoots>,
        eligibility_lifetime: Duration,
    ) -> Arc<Self> {
        let captured = Instant::now();
        let owner = Arc::new(Self {
            custody,
            completion,
            roots,
            creator: std::process::id(),
            process_incarnation: Uuid::new_v4(),
            runtime_incarnation: Uuid::new_v4(),
            captured,
            configured: eligibility_lifetime,
            cutoff: Mutex::new(captured.checked_add(eligibility_lifetime)),
            original: AtomicBool::new(false),
            attempted: AtomicBool::new(false),
            active: AtomicBool::new(false),
            denied: AtomicBool::new(false),
            changed: Notify::new(),
            create_capacity: OnceLock::new(),
            create_generation: AtomicU64::new(0),
        });
        let original = owner.custody.retain_runtime_owner(Arc::downgrade(&owner));
        owner.original.store(original, Ordering::Release);
        if !original {
            owner.deny();
        }
        owner
    }
    fn retained_deadline(&self) -> Result<Instant> {
        match self.cutoff.lock() {
            Ok(value) => (*value).ok_or_else(unavailable),
            Err(_) => {
                self.deny();
                Err(unavailable())
            }
        }
    }
    fn check_retained(&self) -> Result<()> {
        ensure!(
            self.creator == std::process::id()
                && self.original.load(Ordering::Acquire)
                && !self.denied.load(Ordering::Acquire)
                && !self.configured.is_zero()
                && !self.process_incarnation.is_nil()
                && !self.runtime_incarnation.is_nil()
                && Instant::now() < self.retained_deadline()?,
            "original runtime retention denied"
        );
        self.roots.check_denial()?;
        self.custody.check_denial()?;
        ensure!(
            self.custody.owns_runtime(self),
            "original runtime custody differs"
        );
        Ok(())
    }
    /// Original physical checks run outside SQL/credential locks. Neither a
    /// matching path nor a cloned completion snapshot can replace root/custody
    /// pointer association. A failed attempt denies and retains every original.
    pub fn try_start(&self) -> Result<()> {
        let result = (|| {
            ensure!(
                !self.attempted.swap(true, Ordering::AcqRel),
                "original runtime start already attempted"
            );
            self.check_retained()?;
            self.completion.check_custody_association(&self.custody)?;
            ensure!(
                self.custody
                    .original_global_roots()
                    .is_some_and(|original| Arc::ptr_eq(original, &self.roots)),
                "original imported runtime roots differ"
            );
            self.roots.check_current()?;
            self.custody.check_current(|| self.check_retained())?;
            self.roots.check_current()?;
            self.check_retained()?;
            self.active.store(true, Ordering::Release);
            self.check_denial()
        })();
        if result.is_err() {
            self.deny();
        }
        result.map_err(|_| unavailable())
    }
    /// Bounded cached denial only, suitable within Core resource transactions.
    pub fn check_denial(&self) -> Result<()> {
        let result = (|| {
            ensure!(self.active.load(Ordering::Acquire), "runtime not started");
            self.check_retained()
        })();
        if result.is_err() && self.attempted.load(Ordering::Acquire) {
            self.deny();
        }
        result.map_err(|_| unavailable())
    }
    /// Actual namespace/key currentness, outside Core SQL/key locks.
    pub fn check_current(&self) -> Result<()> {
        let result = (|| {
            self.check_denial()?;
            self.roots.check_current()?;
            self.completion.check_custody_association(&self.custody)?;
            self.custody.check_current(|| self.check_denial())?;
            self.roots.check_current()?;
            self.check_denial()
        })();
        if result.is_err() {
            self.deny();
        }
        result.map_err(|_| unavailable())
    }
    pub fn original_runtime_deadline(&self) -> Result<Instant> {
        self.check_denial()?;
        self.retained_deadline()
    }
    /// Only this SAME original supervisor's negative handle crosses into the
    /// actual Native shutdown-before-drain and host-key/currentness paths.
    pub fn denial(self: &Arc<Self>) -> PostImportRuntimeDenial {
        PostImportRuntimeDenial(Arc::downgrade(self))
    }
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        self.changed.notify_waiters();
        self.custody.deny();
    }
    /// Called only by the original key owner's negative notification. Avoid a
    /// recursive key->runtime->key loop while waking every actual waiter.
    pub(crate) fn key_denied(&self) {
        self.denied.store(true, Ordering::Release);
        self.changed.notify_waiters();
    }
    pub async fn invalidated(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.check_denial().is_err() {
                return;
            }
            let Ok(cutoff) = self.retained_deadline() else {
                return;
            };
            tokio::select! {_ = changed=>{},_ = tokio::time::sleep_until(cutoff.into())=>{}}
        }
    }
    /// Immutable startup observation DATA only, never an execution identity or
    /// permission to reuse another workspace's selected backend allocation.
    pub fn startup_incarnations(&self) -> (Uuid, Uuid, u32) {
        (
            self.process_incarnation,
            self.runtime_incarnation,
            self.creator,
        )
    }
    /// Original startup-only policy owner. One host ledger, never per-operation
    /// reload or replacement. Absence leaves CREATE closed while runtime exists.
    pub fn install_create_policy(&self, policy: nac_capacity_policy::PolicyOwner) -> Result<()> {
        self.check_current()?;
        let config = policy.configuration()?;
        let binding = self.custody.binding();
        ensure!(
            config.scope.managed_host_id == binding.managed_host_id
                && config.scope.host_incarnation_id == binding.host_incarnation_id,
            "CREATE policy differs from original host"
        );
        ensure!(
            self.create_capacity.get().is_none(),
            "CREATE policy already installed"
        );
        let capacity = Arc::new(super::protected_execution_resources::capacity_source::RetainedCapacityInput::from_owner(policy)?);
        self.create_capacity
            .set(capacity)
            .map_err(|_| unavailable())?;
        self.check_current()
    }
    pub(in crate::runtime) fn create_capacity(
        &self,
    ) -> Result<Arc<super::protected_execution_resources::capacity_source::RetainedCapacityInput>>
    {
        self.check_current()?;
        self.create_capacity
            .get()
            .map(Arc::clone)
            .ok_or_else(unavailable)
    }
    /// Local allocation sequence, not AFM source lineage, PID or a kernel proof.
    pub(in crate::runtime) fn next_create_generation(&self) -> Result<u64> {
        self.check_denial()?;
        let mut previous = self.create_generation.load(Ordering::Acquire);
        loop {
            let next = previous
                .checked_add(1)
                .filter(|next| *next <= i64::MAX as u64)
                .ok_or_else(unavailable)?;
            match self.create_generation.compare_exchange_weak(
                previous,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(next),
                Err(observed) => previous = observed,
            }
        }
    }
    pub(in crate::runtime) fn create_material(&self) -> Result<CreateHostMaterial<'_>> {
        self.check_current()?;
        Ok(CreateHostMaterial {
            key: &self.custody,
            completion: &self.completion,
            roots: &self.roots,
            original_store: self.completion.original_store_path(),
        })
    }
    pub fn captured_at(&self) -> Instant {
        self.captured
    }
}
impl Drop for PostImportRuntimeHost {
    fn drop(&mut self) {
        self.deny();
    }
}
/// Non-owning denial/tightening only; it cannot construct or activate an owner.
#[derive(Clone)]
pub struct PostImportRuntimeDenial(Weak<PostImportRuntimeHost>);
impl PostImportRuntimeDenial {
    pub fn deny(&self) {
        if let Some(owner) = self.0.upgrade() {
            owner.deny();
        }
    }
    pub fn tighten_cutoff(&self, earlier: Instant) {
        if let Some(owner) = self.0.upgrade() {
            let updated = {
                match owner.cutoff.lock() {
                    Ok(mut cutoff) => {
                        if let Some(original) = cutoff.as_mut() {
                            *original = (*original).min(earlier);
                            true
                        } else {
                            false
                        }
                    }
                    Err(_) => false,
                }
            };
            if !updated {
                owner.deny();
            }
            owner.changed.notify_waiters();
        }
    }
}
#[cfg(test)]
#[path = "post_import_runtime_tests.rs"]
mod tests;
