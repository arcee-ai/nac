//! NAC-local CREATE ownership and private boundary issuance.
//!
//! Proposed private issuer consumes the concrete retained CreateParticipant.
//! This artifact is not registered or compiled. Wire data, mTLS metadata, a
//! callback and AFM's borrowed PG object cannot create this owner.
//! No test-support or public positive constructor is exposed by this module.
use super::*;
use crate::{
    runtime::protected_execution_resources::{
        capacity_source::RetainedCapacityInput, BoundaryAdmissions, CompartmentResourceDeclaration,
        CompartmentStorageHold,
    },
    session_service::ProtectedPreparationInput,
    store::native_source_reservation::{NativeSourceBinding, NativeSourceReservation},
};
use anyhow::ensure;
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{OnceLock, Weak},
};

/// Internal nominal input to the consuming factory, never an AFM wire object.
/// Its production verifier/conversion is intentionally disconnected. Keep all
/// fields private: an adapter must not manufacture this from caller values.
pub(crate) struct LocalCreateAdmission {
    state: Arc<AdmissionState>,
}
struct AdmissionState {
    participant: Option<Arc<crate::runtime::create_participant::CreateParticipant>>,
    binding: NativeSourceBinding,
    store_path: PathBuf,
    capacity_source: Arc<nac_capacity_policy::PolicySource>,
    claim_sequence: u64,
    canonical_intent: Box<[u8]>,
    intent_sha256: [u8; 32],
    configuration_sha256: [u8; 32],
    backend: Arc<ExecutionBackend>,
    identity: ProtectedExecutionIdentity,
    creator_process: u32,
    create_cutoff: Instant,
    runtime_cutoff: Mutex<Instant>,
    create_denied: AtomicBool,
    runtime_denied: AtomicBool,
    started: AtomicBool,
    owner: Mutex<Weak<CreateFactoryOwner>>,
    changed: tokio::sync::Notify,
}
impl AdmissionState {
    fn runtime_deadline(&self) -> Instant {
        match self.runtime_cutoff.lock() {
            Ok(cutoff) => *cutoff,
            Err(poisoned) => {
                let cutoff = **poisoned.get_ref();
                drop(poisoned);
                self.deny_runtime();
                cutoff
            }
        }
    }
    fn deny_runtime(&self) {
        if !self.runtime_denied.swap(true, Ordering::AcqRel) {
            self.changed.notify_waiters();
            let owner = self
                .owner
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            if let Some(owner) = owner.upgrade() {
                owner.deny_resources_and_boundary();
            }
        }
    }
}
pub(crate) struct CreateAdmissionDenial(Weak<AdmissionState>);
impl LocalCreateAdmission {
    pub(in crate::runtime) fn from_participant(
        participant: Arc<crate::runtime::create_participant::CreateParticipant>,
    ) -> Result<Self> {
        let parts = participant.admission_parts()?;
        let store_path = participant.original_store()?;
        Ok(Self {
            state: Arc::new(AdmissionState {
                participant: Some(participant),
                binding: parts.binding,
                store_path,
                capacity_source: parts.capacity_source,
                claim_sequence: parts.claim_sequence,
                canonical_intent: parts.canonical_intent,
                intent_sha256: parts.intent_sha256,
                configuration_sha256: parts.configuration_sha256,
                backend: parts.backend,
                identity: parts.identity,
                creator_process: std::process::id(),
                create_cutoff: parts.create_cutoff,
                runtime_cutoff: Mutex::new(parts.runtime_cutoff),
                create_denied: AtomicBool::new(false),
                runtime_denied: AtomicBool::new(false),
                started: AtomicBool::new(false),
                owner: Mutex::new(Weak::new()),
                changed: tokio::sync::Notify::new(),
            }),
        })
    }
    pub(crate) fn denial(&self) -> CreateAdmissionDenial {
        CreateAdmissionDenial(Arc::downgrade(&self.state))
    }
}
impl CreateAdmissionDenial {
    pub(crate) fn deny(&self) {
        if let Some(state) = self.0.upgrade() {
            state.deny_runtime();
        }
    }
    pub(crate) fn tighten_cutoff(&self, original: Instant) {
        if let Some(state) = self.0.upgrade() {
            {
                let mut cutoff = state
                    .runtime_cutoff
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                *cutoff = (*cutoff).min(original);
            }
            state.changed.notify_waiters();
            let owner = state
                .owner
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            if let Some(owner) = owner.upgrade() {
                let boundary = owner
                    .boundary
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone();
                if let Some(boundary) = boundary.and_then(|value| value.upgrade()) {
                    boundary.changed.notify_waiters();
                }
            }
            if Instant::now() >= state.runtime_deadline() {
                state.deny_runtime();
            }
        }
    }
}
impl Drop for LocalCreateAdmission {
    fn drop(&mut self) {
        self.state.create_denied.store(true, Ordering::Release);
        self.state.deny_runtime();
    }
}

/// The serving construction supervisor retains this SAME allocation before any
/// preparation effect. Every fallible method borrows it; discarding an error
/// cannot drop the original filesystem/execution/SQLite/policy owners.
struct DenyOnUnknown<'a> {
    owner: &'a CreateFactoryOwner,
    completed: bool,
}
impl Drop for DenyOnUnknown<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.owner.deny_runtime();
        }
    }
}
/// Opaque original Core preparation owner. The serving supervisor registers
/// this SAME allocation before any preparation effects. There is no public
/// constructor; a policy view and copied bindings cannot manufacture it.
/// ```compile_fail
/// use nac_core::runtime::CreateFactoryOwner;
/// let _ = CreateFactoryOwner {};
/// ```
pub struct CreateFactoryOwner {
    admission: LocalCreateAdmission,
    source: OnceLock<Arc<NativeSourceReservation>>,
    local_plan: NativeSourceBinding,
    store_path: PathBuf,
    resources: ProtectedPreparationInput,
    capacity: Arc<RetainedCapacityInput>,
    boundary: Mutex<Option<Weak<BoundaryState>>>,
}
impl CreateFactoryOwner {
    /// Original policy for Native's concrete plan BEFORE paired reservation.
    /// Run physical checks outside SQLite/credential locks. The caller retains
    /// this SAME owner, builds Native's plan, then passes its declaration to
    /// prepare_protected_create; Core never duplicates Native's sizing math.
    pub fn policy_source(&self) -> Result<Arc<nac_capacity_policy::PolicySource>> {
        let mut attempt = DenyOnUnknown {
            owner: self,
            completed: false,
        };
        self.validate_before_reservation()?;
        let source = self.capacity.source_view()?;
        attempt.completed = true;
        Ok(source)
    }
    /// Core-private custody move only. Register this allocation in the original
    /// supervisor before calling prepare_protected_create. This grants nothing.
    pub(in crate::runtime) fn retain(
        admission: LocalCreateAdmission,
        local_plan: NativeSourceBinding,
        store_path: PathBuf,
        resources: ProtectedPreparationInput,
        capacity: Arc<RetainedCapacityInput>,
    ) -> Arc<Self> {
        let owner = Arc::new(Self {
            admission,
            source: OnceLock::new(),
            local_plan,
            store_path,
            resources,
            capacity,
            boundary: Mutex::new(None),
        });
        *owner
            .admission
            .state
            .owner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Arc::downgrade(&owner);
        owner
    }
    pub(crate) fn owns_source(&self, source: &Arc<NativeSourceReservation>) -> bool {
        self.admission.state.creator_process == std::process::id()
            && self
                .source
                .get()
                .is_some_and(|original| Arc::ptr_eq(original, source))
    }
    fn source(&self) -> Result<&Arc<NativeSourceReservation>> {
        self.source
            .get()
            .ok_or_else(|| anyhow::anyhow!("original local source is not reserved"))
    }
    fn runtime_deadline(&self) -> Instant {
        self.capacity
            .minimum_cutoff(self.admission.state.runtime_deadline())
    }
    fn check_runtime(&self) -> Result<()> {
        let state = &self.admission.state;
        let deadline = self.runtime_deadline();
        ensure!(
            state.creator_process == std::process::id()
                && !state.runtime_denied.load(Ordering::Acquire)
                && Instant::now() < deadline,
            "original CREATE runtime scope unavailable"
        );
        match &state.participant {
            Some(participant) => participant.check_runtime_denial()?,
            #[cfg(test)]
            None => {} // Existing private mechanical fixtures are not verifier proof.
            #[cfg(not(test))]
            None => anyhow::bail!("original CREATE participant absent"),
        }
        self.resources.check_denial()
    }
    fn check_admission(&self) -> Result<()> {
        self.check_runtime()?;
        let state = &self.admission.state;
        ensure!(
            !state.create_denied.load(Ordering::Acquire) && Instant::now() < state.create_cutoff,
            "original CREATE publication scope unavailable"
        );
        Ok(())
    }
    fn check_create(&self) -> Result<()> {
        self.check_admission()?;
        self.source()?.check_denial()
    }
    fn check_binding(&self) -> Result<()> {
        let state = &self.admission.state;
        let policy = self.capacity.source_view()?;
        if let Some(source) = self.source.get() {
            ensure!(
                source.binding() == &self.local_plan
                    && source.bound_store_path() == self.store_path,
                "captured local source owner changed"
            );
        }
        ensure!(
            Arc::ptr_eq(&state.capacity_source, &policy)
                && state.binding == self.local_plan
                && state.store_path == self.store_path
                && state.claim_sequence > 0
                && i64::try_from(state.claim_sequence).is_ok()
                && !state.canonical_intent.is_empty()
                && state.canonical_intent.len() <= 2 * 1024 * 1024
                && state.configuration_sha256 != [0; 32]
                && <[u8; 32]>::from(Sha256::digest(&state.canonical_intent)) == state.intent_sha256,
            "original CREATE source/intent binding mismatch"
        );
        Ok(())
    }
    fn validate_before_reservation(&self) -> Result<()> {
        self.check_binding()?;
        self.check_admission()?;
        if let Some(participant) = &self.admission.state.participant {
            participant.check_preparation_current()?;
        }
        self.resources.check_outside_store()?;
        self.check_admission()
    }
    fn revalidate_outside_store(&self) -> Result<()> {
        self.validate_before_reservation()?;
        self.source()?.check_current()?;
        self.check_create()
    }
    fn deny_resources_and_boundary(&self) {
        self.resources.deny();
        if let Some(source) = self.source.get() {
            source.deny();
        }
        let boundary = self
            .boundary
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(boundary) = boundary.and_then(|owner| owner.upgrade()) {
            boundary.poison();
        }
    }
    /// Negative-only cancellation before or after preparation. This keeps the
    /// SAME original resource allocation and unresolved source/capacity holds;
    /// denial cannot establish cleanup, release or authenticated settlement.
    pub fn deny_runtime(&self) {
        self.admission.state.deny_runtime();
    }
    /// Only the local verifier may bind this original policy view. Source
    /// retirement must drive its original denial state; copied pins never do.
    /// Consuming preparation uses the original source reservation and host
    /// ledger. The nominal admission can start at most once, even after error.
    pub fn prepare_protected_create(
        self: &Arc<Self>,
        declaration: CompartmentResourceDeclaration,
    ) -> Result<NativeCreateConstruction> {
        let mut attempt = DenyOnUnknown {
            owner: self,
            completed: false,
        };
        let result = (|| {
            ensure!(
                !self.admission.state.started.swap(true, Ordering::AcqRel),
                "CREATE preparation already consumed"
            );
            self.validate_before_reservation()?;
            let pair = self.capacity.prepare_native_pair(declaration)?;
            let cutoff = self
                .runtime_deadline()
                .min(self.admission.state.create_cutoff);
            let source = Arc::new(NativeSourceReservation::reserve(
                &self.store_path,
                self.local_plan.clone(),
                cutoff,
            )?);
            self.source
                .set(source)
                .map_err(|_| anyhow::anyhow!("local CREATE source already captured"))?;
            if let Err(error) = self.check_binding().and_then(|()| self.check_create()) {
                self.source()?.deny();
                return Err(error);
            }
            self.source()?.begin_preparation()?;
            let (admissions, storage) = pair.begin()?;
            self.check_create()?;
            Ok(NativeCreateConstruction {
                owner: Arc::clone(self),
                admissions: Some(admissions),
                storage: Some(storage),
                issued: false,
            })
        })();
        attempt.completed = result.is_ok();
        result
    }
}
impl Drop for CreateFactoryOwner {
    fn drop(&mut self) {
        self.admission.state.deny_runtime();
        self.resources.deny();
        if let Some(source) = self.source.get() {
            source.deny();
        }
    }
}
impl VerifiedBoundaryResources for Arc<CreateFactoryOwner> {
    fn check_current(&self) -> Result<()> {
        self.check_runtime()
    }
    fn original_deadline(&self) -> Instant {
        self.runtime_deadline()
    }
    fn poison(&self) {
        self.deny_runtime();
    }
}

#[path = "protected_create_native.rs"]
mod native;
pub use native::{NativeCreateBinding, NativeCreateConstruction, NativeCreateCurrentness};

pub(crate) struct PublicationAttemptGuard {
    owner: Arc<CreateFactoryOwner>,
    completed: bool,
}
impl PublicationAttemptGuard {
    pub(crate) fn complete(&mut self) {
        self.completed = true;
    }
}
impl Drop for PublicationAttemptGuard {
    fn drop(&mut self) {
        if !self.completed {
            self.owner.deny_runtime();
        }
    }
}

/// Separate one-use publication lifetime, retaining the SAME runtime/resources.
/// Retiring publication must not revoke a successfully transferred active
/// runtime. Its actual currentness owner and explicit cleanup govern that scope.
pub struct CreatePublicationCustody {
    owner: Arc<CreateFactoryOwner>,
    context: Arc<ProtectedExecutionContext>,
}
impl CreatePublicationCustody {
    pub(crate) fn belongs_to(&self, owner: &Arc<CreateFactoryOwner>) -> bool {
        Arc::ptr_eq(&self.owner, owner)
    }
    pub(crate) fn publication_attempt(&self) -> PublicationAttemptGuard {
        PublicationAttemptGuard {
            owner: Arc::clone(&self.owner),
            completed: false,
        }
    }
    pub(crate) fn check_current(&self) -> Result<()> {
        self.owner.check_create()?;
        self.context.check_stage(ProtectedExecutionStage::Prepare)
    }
    pub(crate) fn original_deadline(&self) -> Instant {
        self.owner
            .runtime_deadline()
            .min(self.owner.admission.state.create_cutoff)
            .min(
                self.owner
                    .source
                    .get()
                    .map_or(self.owner.admission.state.create_cutoff, |source| {
                        source.original_cutoff()
                    }),
            )
    }
    pub(crate) fn retire(&self) {
        self.owner
            .admission
            .state
            .create_denied
            .store(true, Ordering::Release);
        self.owner.admission.state.changed.notify_waiters();
        if let Some(source) = self.owner.source.get() {
            source.deny();
        }
    }
    pub(crate) fn deny_runtime(&self) {
        self.owner.deny_runtime();
    }
    pub(crate) fn source(&self) -> Result<Arc<NativeSourceReservation>> {
        Ok(Arc::clone(self.owner.source()?))
    }
    pub(crate) fn context(&self) -> &Arc<ProtectedExecutionContext> {
        &self.context
    }
}
impl Drop for CreatePublicationCustody {
    fn drop(&mut self) {
        self.retire();
    }
}

#[cfg(test)]
#[path = "protected_create_owner_tests.rs"]
pub(crate) mod tests;
