//! Optional, content-free observation of authoritative lifecycle dispositions.
//!
//! These are inward composition contracts, not HTTP schemas or permission
//! capabilities. No existing `SessionEvent` is implicitly promoted into one of
//! these facts. Producers must publish after their actual settlement/decision
//! boundary; a successful automatic goal turn is not completed work.

use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttentionFacet {
    Available,
    Unknown,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttentionAvailability {
    pub work: AttentionFacet,
    pub questions: AttentionFacet,
    pub permissions: AttentionFacet,
    pub reviews: AttentionFacet,
    pub topology: AttentionFacet,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionSource {
    pub session_id: String,
    /// One normalized projection owner; a dormant baseline can hand off to
    /// the actual service without attaching it for observation.
    pub epoch: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionGoal {
    pub id: String,
    pub version: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettledWorkDisposition {
    /// The canonical continuation boundary establishes meaningful completion.
    Completed,
    /// More automatic work is admitted or remains eligible to continue.
    Continuing,
    /// A current question/decision gates continuation; its identity is separate.
    WaitingForDecision,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettledWork {
    pub run_id: String,
    pub goal: Option<AttentionGoal>,
    pub disposition: SettledWorkDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionDecision {
    // Live permission/review owners do not currently supply a run binding.
    Permission {
        request_id: String,
    },
    Review {
        review_id: String,
    },
    Question {
        request_id: String,
        run_id: String,
        generation: String,
        revision: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionSourceSnapshot {
    pub source: AttentionSource,
    /// Snapshot/install must be linearized with subsequent producer facts.
    pub revision: u64,
    pub work: Option<SettledWork>,
    pub pending: Vec<AttentionDecision>,
    pub availability: AttentionAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionChange {
    WorkSettled(SettledWork),
    WorkCleared,
    DecisionPending(AttentionDecision),
    DecisionResolved(AttentionDecision),
    /// Published only after successful canonical deletion, including cascades.
    SessionDeleted,
    Availability(AttentionAvailability),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionOperation {
    Idle,
    Run(String),
    Manual(String),
    Compaction(String),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionServiceSnapshot {
    pub epoch: Uuid,
    pub revision: u64,
    pub operation: AttentionOperation,
    pub settled: Option<SettledWork>,
}

/// Optional local producer sink. Implementations only copy bounded metadata;
/// they cannot call the service/store back while a source guard is held.
pub trait AttentionServiceObserver: Send + Sync {
    fn service_changed(&self, session_id: &str, snapshot: AttentionServiceSnapshot);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionFact {
    pub source: AttentionSource,
    /// Contiguous within a source. Omitted publication must cause a reset,
    /// rather than silently claiming complete observation.
    pub revision: u64,
    pub change: AttentionChange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttentionUnavailable {
    Initial,
    Reset,
    SourceGap,
    Capacity,
    InvalidMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttentionApply {
    Applied,
    Duplicate,
    StaleSource,
    Unavailable(AttentionUnavailable),
}

/// Optional producer port. Implementations perform only bounded synchronous
/// metadata work. They must never call back into a service, store or network.
/// A producer must not hold a lock whose acquisition depends on this observer.
/// Omitting this port leaves ordinary execution and approval behavior unchanged.
pub trait AttentionObserver: Send + Sync {
    /// Compare-and-replace an owner using its canonical atomic snapshot. A stale
    /// registration cannot replace a newer owner. Initial registration uses None.
    fn replace_source(
        &self,
        expected: Option<&AttentionSource>,
        current: AttentionSourceSnapshot,
    ) -> AttentionApply;

    fn observe(&self, fact: AttentionFact) -> AttentionApply;
}
