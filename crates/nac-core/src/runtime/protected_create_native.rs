//! Consuming cross-crate Native construction, without any public mint.
use super::*;

/// Actual Native construction retains this one original scope. It does not
/// serialize it into the runner; the selected Native adapter must retain the
/// original actor/channel and supplies its actual PeerLifetime and RAW port.
/// No caller can construct, clone or decode a construction capability.
/// A Native adapter can consume only the opaque owner issued by Core:
/// ```no_run
/// use nac_core::runtime::{CreateFactoryOwner, NativeCreateConstruction, NativeCreateCurrentness};
/// use std::sync::Arc;
/// fn observe(owner: &Arc<CreateFactoryOwner>, construction: &NativeCreateConstruction) -> anyhow::Result<NativeCreateCurrentness> {
///     anyhow::ensure!(construction.belongs_to(owner), "different original factory");
///     construction.check_current()?;
///     let observed = construction.currentness();
///     observed.check_create_current()?;
///     let _original_policy = construction.policy_source()?;
///     let _correlations = construction.binding();
///     Ok(observed)
/// }
/// ```
/// ```compile_fail
/// use nac_core::runtime::NativeCreateConstruction;
/// let _ = NativeCreateConstruction {};
/// ```
/// ```compile_fail
/// use nac_core::runtime::NativeCreateConstruction;
/// fn cloneable<T: Clone>() {}
/// cloneable::<NativeCreateConstruction>();
/// ```
pub struct NativeCreateConstruction {
    pub(super) owner: Arc<CreateFactoryOwner>,
    pub(super) admissions: Option<BoundaryAdmissions>,
    pub(super) storage: Option<[CompartmentStorageHold; 2]>,
    pub(super) issued: bool,
}
impl NativeCreateConstruction {
    pub fn take_storage(&mut self) -> Result<[CompartmentStorageHold; 2]> {
        let mut attempt = DenyOnUnknown {
            owner: &self.owner,
            completed: false,
        };
        self.owner.check_create()?;
        let storage = self
            .storage
            .take()
            .ok_or_else(|| anyhow::anyhow!("original Native storage already moved"));
        attempt.completed = storage.is_ok();
        storage
    }
    pub fn finish_native(
        &mut self,
        transport: Box<dyn ExecutionCompartmentTransport>,
        peer: nac_process::peer_channel::PeerLifetime,
    ) -> Result<CreatePublicationCustody> {
        self.finish_with_peer(transport, peer::BoundaryPeer::Captured(peer))
    }
    pub(super) fn finish_with_peer(
        &mut self,
        transport: Box<dyn ExecutionCompartmentTransport>,
        peer: peer::BoundaryPeer,
    ) -> Result<CreatePublicationCustody> {
        let mut attempt = DenyOnUnknown {
            owner: &self.owner,
            completed: false,
        };
        let result = (|| {
            self.owner.revalidate_outside_store()?;
            ensure!(
                self.storage.is_none(),
                "Native has not consumed original endpoint storage"
            );
            let admissions = self
                .admissions
                .take()
                .ok_or_else(|| anyhow::anyhow!("original boundary issuance already consumed"))?;
            let state = &self.owner.admission.state;
            let boundary = ProtectedExecutionBoundary::from_parts(
                Arc::clone(&state.backend),
                state.identity,
                Box::new(Arc::clone(&self.owner)),
                transport,
                peer,
                admissions,
            )?;
            *self
                .owner
                .boundary
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(Arc::downgrade(&boundary.state));
            self.owner.check_create()?;
            let context = Arc::new(ProtectedExecutionContext::from_boundary(
                Arc::clone(&state.backend),
                state.identity,
                boundary,
            )?);
            Ok(CreatePublicationCustody {
                owner: Arc::clone(&self.owner),
                context,
            })
        })();
        attempt.completed = result.is_ok();
        self.issued = result.is_ok();
        result
    }
}
impl Drop for NativeCreateConstruction {
    fn drop(&mut self) {
        // Once issuance succeeded, the actual context owns runtime lifetime.
        // Otherwise loss of the construction attempt is an unknown outcome.
        if !self.issued {
            self.owner.deny_runtime();
        }
    }
}

/// Borrowed correlations only. These values cannot construct or renew admission.
/// The Native parent retains the original factory/construction; no Rust owner
/// crosses the child channel, and matching metadata cannot qualify a boundary.
/// source_id/source_generation are Native-local and never AFM source lineage.
pub struct NativeCreateBinding<'a> {
    pub operation_id: uuid::Uuid,
    pub session_id: &'a str,
    pub claim_sequence: u64,
    pub source_id: uuid::Uuid,
    pub source_generation: i64,
    pub intent_sha256: [u8; 32],
    pub configuration_sha256: [u8; 32],
}

impl NativeCreateConstruction {
    /// Association veto only. A shared policy or identical operation bindings
    /// cannot substitute for the exact pre-registered factory allocation.
    pub fn belongs_to(&self, owner: &Arc<CreateFactoryOwner>) -> bool {
        Arc::ptr_eq(&self.owner, owner)
    }
    /// Physical revalidation, outside SQLite/credential locks, before Native's
    /// one-use preparation effects. This does not issue admission.
    pub fn check_current(&self) -> Result<()> {
        let mut attempt = DenyOnUnknown {
            owner: &self.owner,
            completed: false,
        };
        self.owner.revalidate_outside_store()?;
        attempt.completed = true;
        Ok(())
    }
    /// Observe this original allocation without retaining its resource owners.
    pub fn currentness(&self) -> NativeCreateCurrentness {
        NativeCreateCurrentness {
            owner: Arc::downgrade(&self.owner),
            state: Arc::downgrade(&self.owner.admission.state),
        }
    }
    /// SAME retained policy allocation, not a reload or a new ledger. Physical
    /// checks run here; do not call this under SQLite/credential locks.
    pub fn policy_source(&self) -> Result<Arc<nac_capacity_policy::PolicySource>> {
        self.owner.check_create()?;
        self.owner.capacity.source_view()
    }
    pub fn binding(&self) -> NativeCreateBinding<'_> {
        self.owner.binding()
    }
}

impl CreateFactoryOwner {
    /// Compare the fresh opaque ACK against this original participant.
    pub(crate) fn check_ack_exchange(
        &self,
        ack: &nac_runtime_auth::CreateAckExchange,
    ) -> Result<()> {
        self.admission
            .state
            .participant
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("original CREATE participant unavailable"))?
            .check_ack_exchange(ack)
    }
    /// Borrow SAME immutable operation correlations. No currentness or renewal
    /// is inferred from DATA returned by an old or denied allocation.
    pub fn binding(&self) -> NativeCreateBinding<'_> {
        let state = &self.admission.state;
        NativeCreateBinding {
            operation_id: state.binding.operation_id,
            session_id: &state.binding.session_id,
            claim_sequence: state.claim_sequence,
            source_id: state.binding.source_id,
            source_generation: state.binding.source_generation,
            intent_sha256: state.intent_sha256,
            configuration_sha256: state.configuration_sha256,
        }
    }
}

/// Weak observation and denial only, never admission or resource custody.
/// Resource checks deliberately do not call the execution resource box: the
/// original Native preparation allocation may itself retain this observer.
/// Runtime observation survives successful one-use publication retirement.
#[derive(Clone)]
pub struct NativeCreateCurrentness {
    owner: Weak<CreateFactoryOwner>,
    state: Weak<AdmissionState>,
}
impl NativeCreateCurrentness {
    fn owner(&self) -> Result<Arc<CreateFactoryOwner>> {
        let owner = self
            .owner
            .upgrade()
            .ok_or_else(|| anyhow::anyhow!("original CREATE resource owner unavailable"))?;
        ensure!(
            owner.admission.state.creator_process == std::process::id(),
            "original CREATE process changed"
        );
        Ok(owner)
    }
    /// Bounded in-memory runtime vetoes only; no filesystem, SQL or resource
    /// check callbacks. Physical policy/resource checks remain on construction and
    /// original actors, and policy retirement is observed by invalidated().
    pub fn check_current(&self) -> Result<()> {
        let owner = self.owner()?;
        let state = &owner.admission.state;
        state.capacity_source.check_denial()?;
        if let Some(participant) = &state.participant {
            participant.check_runtime_denial()?;
        }
        let cutoff = owner.runtime_deadline();
        ensure!(
            !state.runtime_denied.load(Ordering::Acquire) && Instant::now() < cutoff,
            "original CREATE runtime scope unavailable"
        );
        Ok(())
    }
    /// Additional one-use CREATE/source vetoes. Do not use this to govern the
    /// active runtime after publication; its lifetime is independent.
    pub fn check_create_current(&self) -> Result<()> {
        self.check_current()?;
        let owner = self.owner()?;
        let state = &owner.admission.state;
        ensure!(
            !state.create_denied.load(Ordering::Acquire)
                && Instant::now() < self.create_cutoff()?,
            "original CREATE publication scope unavailable"
        );
        owner.source()?.check_denial()
    }
    /// Original minimum retained cutoff, still readable after denial for
    /// cleanup. Observing a later instant can never renew this allocation.
    pub fn runtime_cutoff(&self) -> Result<Instant> {
        Ok(self.owner()?.runtime_deadline())
    }
    pub fn create_cutoff(&self) -> Result<Instant> {
        let owner = self.owner()?;
        Ok(owner
            .runtime_deadline()
            .min(owner.admission.state.create_cutoff)
            .min(owner.source()?.original_cutoff()))
    }
    pub fn deny(&self) {
        if let Some(state) = self.state.upgrade() {
            state.deny_runtime();
        }
    }
    /// Wait for original runtime invalidation without owning its resources.
    /// Register before checking to close denial/tightening notification races.
    /// Policy's original watcher also detects unannounced file replacement;
    /// neither watcher reloads policy or starts a new acceptance budget.
    pub async fn invalidated(&self) {
        let Some(state) = self.state.upgrade() else {
            return;
        };
        loop {
            let changed = state.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.check_current().is_err() {
                return;
            }
            let Ok(cutoff) = self.runtime_cutoff() else {
                return;
            };
            tokio::select! {
                _ = &mut changed => {},
                _ = state.capacity_source.retired() => { self.deny(); return; },
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(cutoff)) => {},
            }
        }
    }
}
