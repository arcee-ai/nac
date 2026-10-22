//! One process's genuine initial-import driver. History cannot reconstruct it.
//! This is distinct from Ready, runtime admission and execution qualification.
use crate::{
    model::{InitialCustodyInvalidator, InitialHostKeyCustody, ManagedHostKeyStore},
    store::{
        self, EnrollmentAttempt, EnrollmentSnapshot, InitialImportProofRecord,
        InitialImportSnapshot, InitialImportState,
    },
};
use anyhow::{bail, ensure, Result};
use nac_contracts::ProtectedImportPhase;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    time::Instant,
};

#[path = "initial_import_work.rs"]
mod work;
pub use work::{
    InitialImportIoOutcome, InitialImportIoTerminal, InitialImportStartObservation,
    InitialImportWork, InitialImportWorkBinding, InitialImportWorkResult,
};

/// Nonsecret observations. Copying/deserializing them supplies no authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InitialImportAuthoritySnapshot {
    pub enrollment: EnrollmentAttempt,
    pub proof: InitialImportProofRecord,
}

/// Trusted infrastructure port, implemented ONLY by the closed Native driver
/// factory retaining its actual crypto verifier, original actively polled TLS
/// channel and genuine Root consumed/current loan fence. Request/model/tool
/// input cannot select an implementation. There is no closure adapter.
///
/// A signed point-in-time proof, DTO, local open flag or all-equal checker is
/// insufficient. No positive production factory may be installed until the
/// actual primary consume/current fence and Native/D owners are joined.
/// Methods check the exact retained phase snapshot synchronously; all remote
/// waits happen in the owning actor outside Core's credential/store locks.
pub trait InitialImportAuthority: Send + Sync {
    /// Resource identity only. New bootstrap continuation requires the SAME
    /// original slot retained by the genuine enrolled source actor. Default
    /// initial imports have no provisional owner and cannot auto-select one.
    /// The closed producer must additionally authenticate the original
    /// operation/intent/provisional nonce and all settled binding fields; this
    /// borrowed resource identity is never a replacement for that source join.
    #[cfg(unix)]
    fn bootstrap_slot(&self) -> Option<&Arc<crate::model::InitialBootstrapSlot>> {
        None
    }
    /// SAME startup namespace allocation held by the actual source actor, not
    /// a recreated path or a new capture. Optional for legacy initial imports;
    /// positive post-import runtime requires this original association.
    #[cfg(unix)]
    fn global_roots(&self) -> Option<&Arc<super::CreateGlobalSourceRoots>> {
        None
    }
    fn snapshot(&self) -> Result<InitialImportAuthoritySnapshot>;
    fn original_deadline(&self) -> Instant;
    fn check_current(&self, expected: &InitialImportAuthoritySnapshot) -> Result<()>;
    /// Permanently deny positive authority on failure or uncertainty. This
    /// does not prove I/O settled or release upstream writer exclusion. Keep
    /// denial-only work joining/retirement ownership separate from this latch.
    fn poison(&self);
}

struct OriginalImportDeadline(Mutex<Instant>);
impl OriginalImportDeadline {
    fn new(deadline: Instant) -> Self {
        Self(Mutex::new(deadline))
    }
    fn snapshot(&self) -> Result<Instant> {
        self.0
            .lock()
            .map(|deadline| *deadline)
            .map_err(|_| anyhow::anyhow!("initial import deadline unavailable"))
    }
    fn check(&self, source: &dyn InitialImportAuthority) -> Result<()> {
        // Never call the source while holding this owner's cutoff lock.
        // A later source sample cannot extend an already observed cutoff.
        let observed = source.original_deadline();
        let mut deadline = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("initial import deadline unavailable"))?;
        *deadline = (*deadline).min(observed);
        ensure!(Instant::now() < *deadline, "initial import owner expired");
        Ok(())
    }
}

struct AuthorityOwner(Box<dyn InitialImportAuthority>);
impl Drop for AuthorityOwner {
    fn drop(&mut self) {
        self.0.poison();
    }
}

/// Denial only; clones cannot advance a phase or construct custody. Keep a
/// drop guard OUTSIDE queued blocking work so caller cancellation denies that
/// work even while the worker still owns the attempt or waits for capacity.
#[derive(Clone)]
pub struct InitialImportCancellation {
    denied: Arc<AtomicBool>,
    authority: Weak<AuthorityOwner>,
}
impl InitialImportCancellation {
    pub fn cancel(&self) {
        self.denied.store(true, Ordering::Release);
        if let Some(authority) = self.authority.upgrade() {
            authority.0.poison();
        }
    }
}
pub struct InitialImportCancelGuard {
    cancellation: InitialImportCancellation,
    armed: bool,
}
impl InitialImportCancelGuard {
    /// Disarm only once the returned owner was actually adopted by its caller.
    pub fn disarm(mut self) {
        self.armed = false;
    }
}
impl Drop for InitialImportCancelGuard {
    fn drop(&mut self) {
        if self.armed {
            self.cancellation.cancel();
        }
    }
}

/// Owns the sole process-local attempt from phase0 through7. A restart or
/// exact replay cannot construct it. Native drives remote phases on the same
/// retained actor and calls these synchronous methods off its I/O reactor.
///
/// ```compile_fail
/// use nac_core::runtime::InitialImportAttempt;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<InitialImportAttempt>();
/// ```
/// ```compile_fail
/// use nac_core::runtime::InitialImportAttempt;
/// let _: InitialImportAttempt = serde_json::from_str("{}").unwrap();
/// ```
pub struct InitialImportAttempt {
    store_path: PathBuf,
    key_store: ManagedHostKeyStore,
    #[cfg(unix)]
    bootstrap_slot: Option<Arc<crate::model::InitialBootstrapSlot>>,
    #[cfg(unix)]
    global_roots: Option<Arc<super::CreateGlobalSourceRoots>>,
    input: PathBuf,
    authority: Option<Arc<AuthorityOwner>>,
    original: InitialImportAuthoritySnapshot,
    deadline: OriginalImportDeadline,
    next_sequence: u8,
    journal_started: bool,
    denied: Arc<AtomicBool>,
    completed: bool,
    custody: Option<InitialHostKeyCustody>,
    invalidator: Option<InitialCustodyInvalidator>,
    consumed_proof: Option<InitialImportProofRecord>,
    start_observation: InitialImportStartObservation,
}

/// Actual custody plus its immutable local import audit, transferred once only
/// after phase3. The still-live attempt can deny it until the full join ends.
pub struct ImportedInitialCustody {
    custody: InitialHostKeyCustody,
    enrollment: EnrollmentSnapshot,
}
impl ImportedInitialCustody {
    pub fn into_parts(self) -> (InitialHostKeyCustody, EnrollmentSnapshot) {
        (self.custody, self.enrollment)
    }
}

/// Nonreconstructable initial completion. This grants no Ready or execution.
/// Retain it for the separate runtime-preparation join; drop denies transferred
/// custody and closes the original source actor. A row cannot replace it.
///
/// ```compile_fail
/// use nac_core::runtime::CompletedInitialImport;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<CompletedInitialImport>();
/// ```
/// ```compile_fail
/// use nac_core::runtime::CompletedInitialImport;
/// let _: CompletedInitialImport = serde_json::from_str("{}").unwrap();
/// ```
pub struct CompletedInitialImport {
    authority: Arc<AuthorityOwner>,
    invalidator: InitialCustodyInvalidator,
    snapshot: InitialImportSnapshot,
    last: InitialImportAuthoritySnapshot,
    deadline: OriginalImportDeadline,
    store_path: PathBuf,
}
impl CompletedInitialImport {
    /// Historical original-owner association only, never Ready or a renewed
    /// initial-import clock. Runtime eligibility is independently qualified.
    pub fn check_custody_association(&self, custody: &InitialHostKeyCustody) -> Result<()> {
        ensure!(
            custody.belongs_to_initial_completion(&self.invalidator)
                && !self.invalidator.is_denied()
                && self.snapshot.state == InitialImportState::Imported
                && self.snapshot.proofs.len() == 8
                && self.snapshot.proofs.last() == Some(&self.last.proof)
                && self.snapshot.enrollment.attempt == self.last.enrollment
                && &self.snapshot.enrollment.attempt.binding == custody.binding()
                && self.snapshot.enrollment.import_audit_id.is_some(),
            "original imported host owner differs"
        );
        Ok(())
    }
    /// Original retained store selection, not a reopened import authority.
    pub(in crate::runtime) fn original_store_path(&self) -> &std::path::Path {
        &self.store_path
    }
    pub fn snapshot(&self) -> &InitialImportSnapshot {
        &self.snapshot
    }
    pub fn check_current(&self) -> Result<()> {
        let result = (|| {
            ensure!(
                !self.invalidator.is_denied(),
                "initial import completion unavailable"
            );
            self.deadline.check(self.authority.0.as_ref())?;
            self.authority.0.check_current(&self.last)?;
            ensure!(
                store::read_initial_import_grant(
                    &self.store_path,
                    &self.last.enrollment.attempt_id
                )?
                .as_ref()
                    == Some(&self.snapshot),
                "initial import completion locally fenced"
            );
            self.authority.0.check_current(&self.last)?;
            self.deadline.check(self.authority.0.as_ref())?;
            ensure!(
                !self.invalidator.is_denied(),
                "initial import completion unavailable"
            );
            Ok(())
        })();
        if result.is_err() {
            self.invalidator.deny();
            self.authority.0.poison();
        }
        result
    }
}
impl Drop for CompletedInitialImport {
    fn drop(&mut self) {
        self.invalidator.deny();
    }
}

impl InitialImportAttempt {
    /// Production composition must supply the actual closed-factory resource,
    /// never an implementation selected from request bytes or a proof receipt.
    /// Upstream/current Native resources must already be retained before entry.
    /// Authority observations cannot acquire them under Core store/key locks.
    /// This initial-import journal is not a runtime/capacity consume or an
    /// authenticated upstream settlement receipt.
    /// Store initialization/configuration precede this method; no private input
    /// is read until phase2 wins the local start transaction.
    pub fn begin(
        store_path: &Path,
        key_store: ManagedHostKeyStore,
        input: &Path,
        authority: Box<dyn InitialImportAuthority>,
    ) -> Result<Self> {
        Self::begin_owned(
            store_path,
            key_store,
            input,
            authority,
            #[cfg(unix)]
            None,
        )
    }
    /// Explicit provisional continuation. The serving supervisor already
    /// retains the SAME slot Arc and genuine source actor before this call;
    /// an error cannot be used to discard/quarantine-reset either original.
    /// No mode sniff, reconstructed slot or renewed cutoff is accepted.
    #[cfg(unix)]
    pub fn begin_from_bootstrap_slot(
        store_path: &Path,
        key_store: ManagedHostKeyStore,
        input: &Path,
        authority: Box<dyn InitialImportAuthority>,
        slot: Arc<crate::model::InitialBootstrapSlot>,
    ) -> Result<Self> {
        Self::begin_owned(store_path, key_store, input, authority, Some(slot))
    }
    fn begin_owned(
        store_path: &Path,
        key_store: ManagedHostKeyStore,
        input: &Path,
        authority: Box<dyn InitialImportAuthority>,
        #[cfg(unix)] slot: Option<Arc<crate::model::InitialBootstrapSlot>>,
    ) -> Result<Self> {
        let authority = Arc::new(AuthorityOwner(authority));
        // Retain the actual original allocation before snapshot validation or IO.
        #[cfg(unix)]
        let global_roots = authority.0.global_roots().cloned();
        #[cfg(unix)]
        if let Some(roots) = &global_roots {
            let (_, home) = roots.original_nac_home_directory()?;
            ensure!(
                key_store == ManagedHostKeyStore::new(home),
                "initial import original home differs"
            );
        }
        ensure!(
            store_path.is_absolute() && input.is_absolute(),
            "initial import configured paths unavailable"
        );
        #[cfg(unix)]
        if let (Some(slot), Some(roots)) = (&slot, &global_roots) {
            ensure!(
                Arc::ptr_eq(slot.original_roots(), roots),
                "initial import original slot roots differ"
            );
        }
        let original = authority.0.snapshot()?;
        original.proof.validate()?;
        ensure!(
            original.proof.phase == ProtectedImportPhase::Issue
                && original.proof.attempt_id == original.enrollment.attempt_id,
            "initial import original issue unavailable"
        );
        let deadline = authority.0.original_deadline();
        #[cfg(unix)]
        match &slot {
            Some(slot) => slot.transfer(
                authority.0.bootstrap_slot(),
                &key_store,
                &original.enrollment.binding,
                deadline,
            )?,
            None => ensure!(
                authority.0.bootstrap_slot().is_none(),
                "bootstrap slot requires explicit continuation"
            ),
        }
        let mut attempt = Self {
            store_path: store_path.into(),
            key_store,
            #[cfg(unix)]
            bootstrap_slot: slot,
            #[cfg(unix)]
            global_roots,
            input: input.into(),
            authority: Some(authority),
            original,
            deadline: OriginalImportDeadline::new(deadline),
            next_sequence: 1,
            journal_started: false,
            denied: Arc::new(AtomicBool::new(false)),
            completed: false,
            custody: None,
            invalidator: None,
            consumed_proof: None,
            start_observation: InitialImportStartObservation::NotAttempted,
        };
        attempt.checked(|s| {
            let current = s.current(ProtectedImportPhase::Issue)?;
            ensure!(
                store::begin_initial_import_grant(
                    &s.store_path,
                    &current.enrollment,
                    &current.proof
                )?,
                "initial import is readback only"
            );
            s.journal_started = true;
            s.check_observation(&current)
        })?;
        Ok(attempt)
    }

    pub fn accept_consumed(&mut self) -> Result<()> {
        self.checked(|s| {
            s.consumed_proof = Some(s.advance(ProtectedImportPhase::Consume)?.proof);
            Ok(())
        })
    }

    pub fn cancellation(&self) -> Result<InitialImportCancellation> {
        let authority = self
            .authority
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("initial import owner unavailable"))?;
        Ok(InitialImportCancellation {
            denied: Arc::clone(&self.denied),
            authority: Arc::downgrade(authority),
        })
    }

    /// Observe the retained minimum cutoff; callers cannot renew it by moving
    /// the attempt into an async adapter or supplying a later transport budget.
    pub fn original_deadline(&mut self) -> Result<Instant> {
        self.checked(|s| {
            s.deadline.check(s.source()?)?;
            s.deadline.snapshot()
        })
    }
    pub fn cancel_on_drop(&self) -> Result<InitialImportCancelGuard> {
        Ok(InitialImportCancelGuard {
            cancellation: self.cancellation()?,
            armed: true,
        })
    }

    /// No key bytes leave Core. The winning phase2 start is durable BEFORE
    /// private file I/O; late failure retains consumed history and no loan.
    pub fn import_once(&mut self) -> Result<()> {
        self.checked(|s| {
            let current = s.advance(ProtectedImportPhase::PreImport)?;
            #[cfg(unix)]
            let reserved = if let Some(slot) = &s.bootstrap_slot {
                Some(slot.import(&s.original.enrollment.binding, &s.input, || {
                    s.check_bounded_observation(&current)
                })?)
            } else {
                None
            };
            #[cfg(not(unix))]
            let reserved: Option<InitialHostKeyCustody> = None;
            let mut custody = match reserved {
                Some(custody) => custody,
                None => s.key_store.import_initial_custody(
                    &s.original.enrollment.binding,
                    &s.input,
                    || s.check_observation(&current),
                )?,
            };
            #[cfg(unix)]
            custody.retain_original_roots(s.global_roots.clone())?;
            custody.bind_initial_lifetime(Arc::clone(&s.denied));
            s.invalidator = Some(custody.invalidation_handle());
            s.custody = Some(custody);
            s.check_observation(&current)
        })
    }

    /// Native may bind its distinct Imported-purpose physical listener only
    /// from this actual custody result, after same-channel phase3 verification.
    pub fn accept_post_import(&mut self) -> Result<ImportedInitialCustody> {
        self.checked(|s| {
            ensure!(
                s.next_sequence == 3,
                "initial import postcheck order unavailable"
            );
            let current = s.current(ProtectedImportPhase::PostImport)?;
            s.custody
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("initial private custody unavailable"))?
                .check_current(|| s.check_credential_observation(&current))?;
            s.advance(ProtectedImportPhase::PostImport)?;
            s.custody
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("initial private custody unavailable"))?
                .check_current(|| s.check_credential_observation(&current))?;
            let snapshot =
                store::read_initial_import_grant(&s.store_path, &s.original.enrollment.attempt_id)?
                    .ok_or_else(|| anyhow::anyhow!("initial import receipt unavailable"))?;
            ensure!(
                snapshot.enrollment.import_audit_id.is_some(),
                "initial import audit unavailable"
            );
            let custody = s
                .custody
                .take()
                .ok_or_else(|| anyhow::anyhow!("initial private custody unavailable"))?;
            Ok(ImportedInitialCustody {
                custody,
                enrollment: snapshot.enrollment,
            })
        })
    }

    /// Phases4..7 must wrap actual distinct Imported serving/check observations
    /// in the Native factory; the phase label itself cannot prove those effects.
    pub fn record_imported_check(&mut self, phase: ProtectedImportPhase) -> Result<()> {
        let binding = self.original.enrollment.binding.clone();
        let check = *self.original.enrollment.original_check_sha256.as_bytes();
        self.record_imported_check_for(phase, &binding, check)
    }

    /// Bind the actual carrier's original Check/custody observations to this
    /// attempt before recording its next phase. These arguments are comparisons
    /// only: they cannot supply a proof or replace the retained current source.
    /// Native calls this off its I/O reactor after reaching the real barrier.
    pub fn record_imported_check_for(
        &mut self,
        phase: ProtectedImportPhase,
        binding: &crate::model::ManagedHostKeyBinding,
        original_check_sha256: [u8; 32],
    ) -> Result<()> {
        self.checked(|s| {
            ensure!(
                binding == &s.original.enrollment.binding
                    && original_check_sha256
                        == *s.original.enrollment.original_check_sha256.as_bytes(),
                "initial import carrier scope mismatch"
            );
            ensure!(
                (4..=7).contains(&phase.sequence()),
                "initial import check phase invalid"
            );
            s.advance(phase)?;
            Ok(())
        })
    }

    pub fn finish(mut self) -> Result<CompletedInitialImport> {
        let (snapshot, last, deadline) = self.checked(|s| {
            ensure!(s.next_sequence == 8, "initial import checks incomplete");
            let last = s.current(ProtectedImportPhase::AfterFreshImported)?;
            let snapshot =
                store::read_initial_import_grant(&s.store_path, &s.original.enrollment.attempt_id)?
                    .ok_or_else(|| anyhow::anyhow!("initial import completion unavailable"))?;
            ensure!(
                snapshot.state == InitialImportState::Imported
                    && snapshot.proofs.len() == 8
                    && snapshot.proofs.last() == Some(&last.proof),
                "initial import completion conflicts"
            );
            s.check_observation(&last)?;
            Ok((snapshot, last, s.deadline.snapshot()?))
        })?;
        let authority = self
            .authority
            .take()
            .ok_or_else(|| anyhow::anyhow!("initial import owner unavailable"))?;
        let invalidator = self
            .invalidator
            .take()
            .ok_or_else(|| anyhow::anyhow!("initial custody owner unavailable"))?;
        #[cfg(unix)]
        if let Some(slot) = &self.bootstrap_slot {
            slot.finish_known_import()?;
        }
        self.completed = true;
        Ok(CompletedInitialImport {
            authority,
            invalidator,
            snapshot,
            last,
            deadline: OriginalImportDeadline::new(deadline),
            store_path: self.store_path.clone(),
        })
    }

    /// Explicit cancellation records a terminal audit. Drop only closes local
    /// authority; pending/consumed/started history stays readback-only even if
    /// the process dies before it can commit a terminal observation.
    pub fn cancel(&mut self) -> Result<()> {
        self.poison();
        store::terminate_initial_import_grant(&self.store_path, &self.original.enrollment)
    }

    fn source(&self) -> Result<&dyn InitialImportAuthority> {
        self.authority
            .as_ref()
            .map(|v| v.0.as_ref())
            .ok_or_else(|| anyhow::anyhow!("initial import owner unavailable"))
    }
    fn check_credential_observation(
        &self,
        expected: &InitialImportAuthoritySnapshot,
    ) -> Result<()> {
        #[cfg(unix)]
        if self.bootstrap_slot.is_some() {
            return self.check_bounded_observation(expected);
        }
        self.check_observation(expected)
    }
    #[cfg(unix)]
    fn check_bounded_observation(&self, expected: &InitialImportAuthoritySnapshot) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "initial import owner unavailable"
        );
        self.deadline.check(self.source()?)?;
        self.source()?.check_current(expected)?;
        if let Some(slot) = &self.bootstrap_slot {
            slot.check_denial()?;
        }
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "initial import owner unavailable"
        );
        Ok(())
    }
    fn check_observation(&self, expected: &InitialImportAuthoritySnapshot) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "initial import owner unavailable"
        );
        self.deadline.check(self.source()?)?;
        self.source()?.check_current(expected)?;
        if self.journal_started {
            let local = store::read_initial_import_grant(
                &self.store_path,
                &self.original.enrollment.attempt_id,
            )?
            .ok_or_else(|| anyhow::anyhow!("initial import local owner unavailable"))?;
            ensure!(
                local.enrollment.attempt == self.original.enrollment
                    && local.grant_id == self.original.proof.grant_id
                    && local.state != InitialImportState::Terminal
                    && local.enrollment.phase
                        == if local.proofs.len() < 4 {
                            store::EnrollmentPhase::Pending
                        } else {
                            store::EnrollmentPhase::Imported
                        }
                    && local.proofs.len() == usize::from(self.next_sequence),
                "initial import locally fenced"
            );
            if expected.proof.phase.sequence() + 1 == self.next_sequence {
                ensure!(
                    local.proofs.last() == Some(&expected.proof),
                    "initial import local proof conflicts"
                );
            }
        }
        self.source()?.check_current(expected)?;
        self.deadline.check(self.source()?)?;
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "initial import owner unavailable"
        );
        Ok(())
    }
    fn current(&mut self, phase: ProtectedImportPhase) -> Result<InitialImportAuthoritySnapshot> {
        self.deadline.check(self.source()?)?;
        let snapshot = self.source()?.snapshot()?;
        snapshot.proof.validate()?;
        ensure!(
            snapshot.enrollment == self.original.enrollment
                && snapshot.proof.attempt_id == self.original.enrollment.attempt_id
                && snapshot.proof.grant_id == self.original.proof.grant_id
                && snapshot.proof.issued_proof_sha256 == self.original.proof.proof_sha256
                && snapshot.proof.phase == phase,
            "initial import current scope unavailable"
        );
        self.check_observation(&snapshot)?;
        Ok(snapshot)
    }
    fn advance(&mut self, phase: ProtectedImportPhase) -> Result<InitialImportAuthoritySnapshot> {
        ensure!(
            self.next_sequence == phase.sequence(),
            "initial import phase order unavailable"
        );
        let current = self.current(phase)?;
        if phase == ProtectedImportPhase::PreImport {
            // Until a successful acknowledgment, a start commit is unknown.
            self.start_observation = InitialImportStartObservation::Unknown;
        }
        let recorded = store::record_initial_import_phase(
            &self.store_path,
            &current.enrollment,
            &current.proof,
        )?;
        ensure!(recorded, "initial import phase is readback only");
        if phase == ProtectedImportPhase::PreImport {
            self.start_observation = InitialImportStartObservation::Claimed;
        }
        self.next_sequence += 1;
        self.check_observation(&current)?;
        Ok(current)
    }
    fn checked<T>(&mut self, operation: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        if self.denied.load(Ordering::Acquire) {
            bail!("initial import owner unavailable");
        }
        let result = operation(self);
        if result.is_err() {
            self.poison();
        }
        result
    }
    fn poison(&mut self) {
        #[cfg(unix)]
        if let Some(slot) = &self.bootstrap_slot {
            slot.deny();
        }
        self.denied.store(true, Ordering::Release);
        if let Some(invalidator) = &self.invalidator {
            invalidator.deny();
        }
        if let Some(authority) = &self.authority {
            authority.0.poison();
        }
    }
}
impl Drop for InitialImportAttempt {
    fn drop(&mut self) {
        if !self.completed {
            self.poison();
        }
    }
}

#[cfg(test)]
#[path = "initial_import_admission_tests.rs"]
pub(crate) mod tests;
