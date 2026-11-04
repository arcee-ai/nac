//! Optional bounded metadata projection. No services, interactive receivers,
//! background tasks or delivery adapters are constructed by this module.
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
};

use nac_core::events::{
    AttentionApply, AttentionAvailability, AttentionChange, AttentionDecision, AttentionFact,
    AttentionObserver, AttentionSource, AttentionSourceSnapshot, AttentionUnavailable, SettledWork,
    SettledWorkDisposition,
};
use tokio::sync::watch;
use uuid::Uuid;

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;

const MAX_ID_BYTES: usize = 512;

#[derive(Clone, Copy)]
pub(crate) struct AttentionLimits {
    pub sources: usize,
    pub identities: usize,
    pub current_bytes: usize,
    pub replay_records: usize,
    pub replay_bytes: usize,
}

impl Default for AttentionLimits {
    fn default() -> Self {
        // Technical retention bounds, not historical-delivery or CPU budgets.
        Self {
            sources: 1024,
            identities: 1024,
            current_bytes: 1024 * 1024,
            replay_records: 256,
            replay_bytes: 256 * 1024,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AttentionBoundary {
    pub engine: Uuid,
    pub epoch: Uuid,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AttentionRecordChange {
    SourceReplaced(AttentionSourceSnapshot),
    Fact(AttentionChange),
    /// Producer revision advanced without changing current semantic state.
    Checkpoint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttentionRecord {
    pub boundary: AttentionBoundary,
    pub source: AttentionSource,
    pub source_revision: u64,
    pub change: AttentionRecordChange,
    /// A deduplicated semantic transition, not an OS delivery instruction.
    pub new_attention: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AttentionReset {
    Incarnation,
    ReplayGap,
    InvalidCursor,
}

pub(crate) struct AttentionInitial {
    pub boundary: AttentionBoundary,
    /// Always silent. Never synthesize missed completion notices from baseline.
    pub baseline: Vec<AttentionSourceSnapshot>,
    pub replay: Vec<Arc<AttentionRecord>>,
    pub reset: Option<AttentionReset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AttentionSubscribeError {
    Busy,
    Unavailable(AttentionUnavailable),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AttentionRead {
    Record(Arc<AttentionRecord>),
    Reset(AttentionReset),
    Closed,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AttentionRetention {
    pub sources: usize,
    pub identities: usize,
    pub current_bytes: usize,
    pub replay_records: usize,
    pub replay_bytes: usize,
    pub subscribers: usize,
    pub wake_receivers: usize,
}

#[derive(Clone)]
struct DecisionState {
    decision: AttentionDecision,
    pending: bool,
}

#[derive(Clone)]
struct SourceState {
    source: AttentionSource,
    revision: u64,
    work: Option<SettledWork>,
    decisions: Vec<DecisionState>,
    completed_runs: BTreeSet<String>,
    deleted: bool,
    availability: AttentionAvailability,
}

impl SourceState {
    fn from_snapshot(snapshot: AttentionSourceSnapshot) -> Self {
        let mut completed_runs = BTreeSet::new();
        if let Some(work) = snapshot
            .work
            .as_ref()
            .filter(|w| w.disposition == SettledWorkDisposition::Completed)
        {
            completed_runs.insert(work.run_id.clone());
        }
        Self {
            source: snapshot.source,
            revision: snapshot.revision,
            work: snapshot.work,
            decisions: snapshot
                .pending
                .into_iter()
                .map(|decision| DecisionState {
                    decision,
                    pending: true,
                })
                .collect(),
            completed_runs,
            deleted: false,
            availability: snapshot.availability,
        }
    }

    fn snapshot(&self) -> AttentionSourceSnapshot {
        AttentionSourceSnapshot {
            source: self.source.clone(),
            revision: self.revision,
            work: self.work.clone(),
            pending: self
                .decisions
                .iter()
                .filter(|d| d.pending)
                .map(|d| d.decision.clone())
                .collect(),
            availability: self.availability,
        }
    }

    fn metrics(&self) -> (usize, usize) {
        let identities =
            usize::from(self.work.is_some()) + self.decisions.len() + self.completed_runs.len();
        let bytes = source_bytes(&self.source)
            + self.source.session_id.len()
            + 16
            + self.work.as_ref().map_or(0, work_bytes)
            + self
                .decisions
                .iter()
                .map(|d| decision_bytes(&d.decision) + 1)
                .sum::<usize>()
            + self
                .completed_runs
                .iter()
                .map(|id| id.len() + 8)
                .sum::<usize>();
        (identities, bytes)
    }
}

struct State {
    boundary: AttentionBoundary,
    unavailable: Option<AttentionUnavailable>,
    sources: BTreeMap<String, SourceState>,
    replay: VecDeque<Arc<AttentionRecord>>,
    replay_bytes: usize,
    subscriber: Option<Uuid>,
}

struct Inner {
    limits: AttentionLimits,
    state: Mutex<State>,
    // Only a boundary wakeup, never a second payload queue or replay ring.
    wake: watch::Sender<AttentionBoundary>,
}

#[derive(Clone)]
pub(crate) struct AttentionHub(Arc<Inner>);

impl AttentionHub {
    pub fn new(engine: Uuid, limits: AttentionLimits) -> Result<Self, AttentionUnavailable> {
        let maximum = AttentionLimits::default();
        if engine.is_nil()
            || [
                limits.sources,
                limits.identities,
                limits.current_bytes,
                limits.replay_records,
                limits.replay_bytes,
            ]
            .contains(&0)
            || limits.sources > maximum.sources
            || limits.identities > maximum.identities
            || limits.current_bytes > maximum.current_bytes
            || limits.replay_records > maximum.replay_records
            || limits.replay_bytes > maximum.replay_bytes
        {
            return Err(AttentionUnavailable::InvalidMetadata);
        }
        let boundary = AttentionBoundary {
            engine,
            epoch: Uuid::new_v4(),
            sequence: 0,
        };
        let (wake, _) = watch::channel(boundary);
        Ok(Self(Arc::new(Inner {
            limits,
            wake,
            state: Mutex::new(State {
                boundary,
                unavailable: Some(AttentionUnavailable::Initial),
                sources: BTreeMap::new(),
                replay: VecDeque::new(),
                replay_bytes: 0,
                subscriber: None,
            }),
        })))
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn boundary(&self) -> AttentionBoundary {
        self.lock().boundary
    }

    #[cfg(test)]
    pub fn retention(&self) -> AttentionRetention {
        let state = self.lock();
        let (identities, current_bytes) = metrics(&state.sources);
        AttentionRetention {
            sources: state.sources.len(),
            identities,
            current_bytes,
            replay_records: state.replay.len(),
            replay_bytes: state.replay_bytes,
            subscribers: usize::from(state.subscriber.is_some()),
            wake_receivers: self.0.wake.receiver_count(),
        }
    }

    /// Full canonical replacement, including an explicitly empty store. The
    /// captured boundary fences late bootstrap/rebaseline callbacks.
    pub fn rebaseline(
        &self,
        expected: AttentionBoundary,
        snapshots: Vec<AttentionSourceSnapshot>,
    ) -> AttentionApply {
        let mut state = self.lock();
        if expected != state.boundary {
            return AttentionApply::StaleSource;
        }
        if snapshots.len() > self.0.limits.sources {
            return self.invalidate(&mut state, AttentionUnavailable::Capacity);
        }
        let mut sources = BTreeMap::new();
        for snapshot in snapshots {
            if snapshot.pending.len() > self.0.limits.identities {
                return self.invalidate(&mut state, AttentionUnavailable::Capacity);
            }
            if !valid_snapshot(&snapshot) || sources.contains_key(&snapshot.source.session_id) {
                return self.invalidate(&mut state, AttentionUnavailable::InvalidMetadata);
            }
            sources.insert(
                snapshot.source.session_id.clone(),
                SourceState::from_snapshot(snapshot),
            );
            if !self.fits(&sources) {
                return self.invalidate(&mut state, AttentionUnavailable::Capacity);
            }
        }
        state.sources = sources;
        state.boundary.epoch = Uuid::new_v4();
        state.boundary.sequence = 0;
        state.unavailable = None;
        state.replay.clear();
        state.replay_bytes = 0;
        state.subscriber = None;
        self.0.wake.send_replace(state.boundary);
        AttentionApply::Applied
    }

    pub fn reset(&self) {
        let _ = self.invalidate(&mut self.lock(), AttentionUnavailable::Reset);
    }

    fn fits(&self, sources: &BTreeMap<String, SourceState>) -> bool {
        let (identities, bytes) = metrics(sources);
        sources.len() <= self.0.limits.sources
            && identities <= self.0.limits.identities
            && bytes <= self.0.limits.current_bytes
    }

    fn invalidate(&self, state: &mut State, reason: AttentionUnavailable) -> AttentionApply {
        state.sources = BTreeMap::new();
        state.replay = VecDeque::new();
        state.replay_bytes = 0;
        state.subscriber = None;
        state.unavailable = Some(reason);
        state.boundary.epoch = Uuid::new_v4();
        state.boundary.sequence = 0;
        self.0.wake.send_replace(state.boundary);
        AttentionApply::Unavailable(reason)
    }

    fn record(
        &self,
        state: &mut State,
        source: AttentionSource,
        source_revision: u64,
        change: AttentionRecordChange,
        new_attention: bool,
    ) -> AttentionApply {
        let bytes = source_bytes(&source)
            + 64
            + match &change {
                AttentionRecordChange::SourceReplaced(snapshot) => snapshot_bytes(snapshot),
                AttentionRecordChange::Fact(change) => change_bytes(change),
                AttentionRecordChange::Checkpoint => 1,
            };
        if !self.fits(&state.sources) || bytes > self.0.limits.replay_bytes {
            return self.invalidate(state, AttentionUnavailable::Capacity);
        }
        let Some(sequence) = state.boundary.sequence.checked_add(1) else {
            return self.invalidate(state, AttentionUnavailable::Capacity);
        };
        state.boundary.sequence = sequence;
        while state.replay.len() >= self.0.limits.replay_records
            || state.replay_bytes + bytes > self.0.limits.replay_bytes
        {
            if let Some(record) = state.replay.pop_front() {
                state.replay_bytes -= record_bytes(&record);
            }
        }
        let record = Arc::new(AttentionRecord {
            boundary: state.boundary,
            source,
            source_revision,
            change,
            new_attention,
        });
        state.replay_bytes += bytes;
        state.replay.push_back(record);
        self.0.wake.send_replace(state.boundary);
        AttentionApply::Applied
    }

    pub fn subscribe(
        &self,
        cursor: Option<AttentionBoundary>,
    ) -> Result<AttentionSubscription, AttentionSubscribeError> {
        let mut state = self.lock();
        if let Some(reason) = state.unavailable {
            return Err(AttentionSubscribeError::Unavailable(reason));
        }
        // A reset retires the seat immediately, but an unpolled old handle can
        // still retain its receiver/baseline. Bound those actual owners too.
        if state.subscriber.is_some() || self.0.wake.receiver_count() != 0 {
            return Err(AttentionSubscribeError::Busy);
        }
        // Receiver acquisition, baseline and frontier share the publication lock.
        let wake = self.0.wake.subscribe();
        let token = Uuid::new_v4();
        state.subscriber = Some(token);
        let reset = cursor.and_then(|cursor| cursor_reset(&state, cursor));
        let replay = if reset.is_none() {
            cursor
                .map(|cursor| {
                    state
                        .replay
                        .iter()
                        .filter(|r| r.boundary.sequence > cursor.sequence)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let initial = AttentionInitial {
            boundary: state.boundary,
            baseline: state
                .sources
                .values()
                .filter(|s| !s.deleted)
                .map(SourceState::snapshot)
                .collect(),
            replay,
            reset,
        };
        Ok(AttentionSubscription {
            hub: self.clone(),
            token,
            cursor: state.boundary,
            wake: Some(wake),
            initial,
            closed: false,
        })
    }
}

impl AttentionObserver for AttentionHub {
    fn replace_source(
        &self,
        expected: Option<&AttentionSource>,
        snapshot: AttentionSourceSnapshot,
    ) -> AttentionApply {
        let mut state = self.lock();
        if let Some(reason) = state.unavailable {
            return AttentionApply::Unavailable(reason);
        }
        let previous = state.sources.get(&snapshot.source.session_id);
        if previous.map(|s| &s.source) != expected
            || previous.is_some_and(|s| s.source == snapshot.source)
        {
            return AttentionApply::StaleSource;
        }
        if snapshot.pending.len() > self.0.limits.identities {
            return self.invalidate(&mut state, AttentionUnavailable::Capacity);
        }
        if !valid_snapshot(&snapshot) {
            return self.invalidate(&mut state, AttentionUnavailable::InvalidMetadata);
        }
        state.sources.insert(
            snapshot.source.session_id.clone(),
            SourceState::from_snapshot(snapshot.clone()),
        );
        self.record(
            &mut state,
            snapshot.source.clone(),
            snapshot.revision,
            AttentionRecordChange::SourceReplaced(snapshot),
            false,
        )
    }

    fn observe(&self, fact: AttentionFact) -> AttentionApply {
        let mut state = self.lock();
        if let Some(reason) = state.unavailable {
            return AttentionApply::Unavailable(reason);
        }
        let Some(source) = state.sources.get_mut(&fact.source.session_id) else {
            return AttentionApply::StaleSource;
        };
        if source.source != fact.source || source.deleted {
            return AttentionApply::StaleSource;
        }
        if fact.revision <= source.revision {
            return AttentionApply::Duplicate;
        }
        if source.revision.checked_add(1) != Some(fact.revision) {
            return self.invalidate(&mut state, AttentionUnavailable::SourceGap);
        }
        if !valid_change(&fact.change) {
            return self.invalidate(&mut state, AttentionUnavailable::InvalidMetadata);
        }
        source.revision = fact.revision;
        let (changed, new_attention) = match &fact.change {
            AttentionChange::WorkSettled(work) => {
                if work.disposition == SettledWorkDisposition::Completed
                    && source.decisions.iter().any(|d| {
                        d.pending
                            && matches!(&d.decision,
                    AttentionDecision::Question { run_id, .. } if run_id == &work.run_id)
                    })
                {
                    return self.invalidate(&mut state, AttentionUnavailable::InvalidMetadata);
                }
                if source.completed_runs.contains(&work.run_id) {
                    if source.work.is_none()
                        && work.disposition == SettledWorkDisposition::Completed
                    {
                        source.work = Some(work.clone());
                        (true, false)
                    } else {
                        (false, false)
                    }
                } else if source.work.as_ref() == Some(work) {
                    (false, false)
                } else {
                    let completed = work.disposition == SettledWorkDisposition::Completed;
                    if completed {
                        source.completed_runs.insert(work.run_id.clone());
                    }
                    source.work = Some(work.clone());
                    (true, completed)
                }
            }
            AttentionChange::WorkCleared => (source.work.take().is_some(), false),
            AttentionChange::DecisionPending(decision)
            | AttentionChange::DecisionResolved(decision) => {
                let pending = matches!(&fact.change, AttentionChange::DecisionPending(_));
                match source
                    .decisions
                    .iter_mut()
                    .find(|d| same_decision(&d.decision, decision))
                {
                    Some(current)
                        if current.pending
                            && decision_revision(decision)
                                >= decision_revision(&current.decision) =>
                    {
                        let changed = current.pending != pending || &current.decision != decision;
                        current.decision = decision.clone();
                        current.pending = pending;
                        (changed, false)
                    }
                    Some(current)
                        if pending && matches!(decision, AttentionDecision::Review { .. }) =>
                    {
                        // A failed retry enqueue can restore this exact broker
                        // membership. It is current again, not a new notice.
                        current.pending = true;
                        (true, false)
                    }
                    Some(_) => (false, false),
                    None => {
                        source.decisions.push(DecisionState {
                            decision: decision.clone(),
                            pending,
                        });
                        (true, pending)
                    }
                }
            }
            AttentionChange::SessionDeleted => {
                source.deleted = true;
                source.work = None;
                source.decisions.clear();
                source.completed_runs.clear();
                (true, false)
            }
            AttentionChange::Availability(availability) => {
                let changed = source.availability != *availability;
                source.availability = *availability;
                (changed, false)
            }
        };
        // Even a semantic repeat advances the producer frontier. Recording the
        // checkpoint fences concurrent rebaseline without re-announcing it.
        self.record(
            &mut state,
            fact.source,
            fact.revision,
            if changed {
                AttentionRecordChange::Fact(fact.change)
            } else {
                AttentionRecordChange::Checkpoint
            },
            new_attention,
        )
    }
}

pub(crate) struct AttentionSubscription {
    hub: AttentionHub,
    token: Uuid,
    cursor: AttentionBoundary,
    wake: Option<watch::Receiver<AttentionBoundary>>,
    pub initial: AttentionInitial,
    closed: bool,
}

impl AttentionSubscription {
    pub async fn next(&mut self) -> AttentionRead {
        loop {
            if self.closed {
                return AttentionRead::Closed;
            }
            if let Some(wake) = self.wake.as_mut() {
                wake.borrow_and_update();
            }
            let result = {
                let state = self.hub.lock();
                if let Some(reset) = cursor_reset(&state, self.cursor) {
                    Some(AttentionRead::Reset(reset))
                } else if state.subscriber != Some(self.token) {
                    Some(AttentionRead::Closed)
                } else {
                    state
                        .replay
                        .iter()
                        .find(|r| r.boundary.sequence > self.cursor.sequence)
                        .cloned()
                        .map(AttentionRead::Record)
                }
            };
            match result {
                Some(AttentionRead::Record(record)) => {
                    self.cursor = record.boundary;
                    return AttentionRead::Record(record);
                }
                Some(result) => {
                    self.close();
                    return result;
                }
                None => {
                    let closed = match self.wake.as_mut() {
                        Some(wake) => wake.changed().await.is_err(),
                        None => true,
                    };
                    if closed {
                        self.close();
                        return AttentionRead::Closed;
                    }
                }
            }
        }
    }

    fn close(&mut self) {
        self.closed = true;
        self.wake = None;
        self.initial.baseline = Vec::new();
        self.initial.replay = Vec::new();
        let mut state = self.hub.lock();
        if state.subscriber == Some(self.token) {
            state.subscriber = None;
        }
    }
}

impl Drop for AttentionSubscription {
    fn drop(&mut self) {
        self.close();
    }
}

fn cursor_reset(state: &State, cursor: AttentionBoundary) -> Option<AttentionReset> {
    if cursor.engine != state.boundary.engine || cursor.epoch != state.boundary.epoch {
        Some(AttentionReset::Incarnation)
    } else if cursor.sequence > state.boundary.sequence {
        Some(AttentionReset::InvalidCursor)
    } else if cursor.sequence < state.boundary.sequence
        && state
            .replay
            .front()
            .is_none_or(|r| cursor.sequence < r.boundary.sequence.saturating_sub(1))
    {
        Some(AttentionReset::ReplayGap)
    } else {
        None
    }
}

fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= MAX_ID_BYTES
}
fn valid_source(source: &AttentionSource) -> bool {
    valid_id(&source.session_id) && !source.epoch.is_nil()
}
fn valid_work(work: &SettledWork) -> bool {
    valid_id(&work.run_id)
        && work
            .goal
            .as_ref()
            .is_none_or(|g| valid_id(&g.id) && g.version > 0)
}
fn valid_decision(decision: &AttentionDecision) -> bool {
    match decision {
        AttentionDecision::Permission { request_id } => valid_id(request_id),
        AttentionDecision::Review { review_id } => valid_id(review_id),
        AttentionDecision::Question {
            request_id,
            run_id,
            generation,
            revision,
        } => valid_id(request_id) && valid_id(run_id) && valid_id(generation) && *revision > 0,
    }
}
fn valid_snapshot(snapshot: &AttentionSourceSnapshot) -> bool {
    valid_source(&snapshot.source)
        && snapshot.work.as_ref().is_none_or(valid_work)
        && snapshot.pending.iter().enumerate().all(|(i, d)| {
            valid_decision(d) && !snapshot.pending[..i].iter().any(|p| same_decision(p, d))
        })
        && !snapshot.work.as_ref().is_some_and(|w| {
            w.disposition == SettledWorkDisposition::Completed
            && snapshot.pending.iter().any(
                |d| matches!(d, AttentionDecision::Question { run_id, .. } if run_id == &w.run_id),
            )
        })
}
fn valid_change(change: &AttentionChange) -> bool {
    match change {
        AttentionChange::WorkSettled(w) => valid_work(w),
        AttentionChange::DecisionPending(d) | AttentionChange::DecisionResolved(d) => {
            valid_decision(d)
        }
        AttentionChange::SessionDeleted
        | AttentionChange::WorkCleared
        | AttentionChange::Availability(_) => true,
    }
}
fn same_decision(a: &AttentionDecision, b: &AttentionDecision) -> bool {
    match (a, b) {
        (
            AttentionDecision::Permission { request_id: a },
            AttentionDecision::Permission { request_id: b },
        )
        | (
            AttentionDecision::Review { review_id: a },
            AttentionDecision::Review { review_id: b },
        ) => a == b,
        (
            AttentionDecision::Question {
                request_id: a,
                run_id: ar,
                generation: ag,
                ..
            },
            AttentionDecision::Question {
                request_id: b,
                run_id: br,
                generation: bg,
                ..
            },
        ) => a == b && ar == br && ag == bg,
        _ => false,
    }
}
fn decision_revision(decision: &AttentionDecision) -> u64 {
    match decision {
        AttentionDecision::Question { revision, .. } => *revision,
        _ => 0,
    }
}
// Budgets count identifier bytes plus fixed per-record fields. Count limits
// separately bound container/allocator overhead. No serialized payload cache.
fn source_bytes(source: &AttentionSource) -> usize {
    source.session_id.len() + 16
}
fn work_bytes(work: &SettledWork) -> usize {
    work.run_id.len() + 16 + work.goal.as_ref().map_or(0, |g| g.id.len() + 8)
}
fn decision_bytes(decision: &AttentionDecision) -> usize {
    16 + match decision {
        AttentionDecision::Permission { request_id } => request_id.len(),
        AttentionDecision::Review { review_id } => review_id.len(),
        AttentionDecision::Question {
            request_id,
            run_id,
            generation,
            ..
        } => request_id.len() + run_id.len() + generation.len() + 8,
    }
}
fn change_bytes(change: &AttentionChange) -> usize {
    match change {
        AttentionChange::WorkSettled(w) => work_bytes(w),
        AttentionChange::DecisionPending(d) | AttentionChange::DecisionResolved(d) => {
            decision_bytes(d)
        }
        AttentionChange::SessionDeleted | AttentionChange::WorkCleared => 1,
        AttentionChange::Availability(_) => 16,
    }
}
pub(super) fn snapshot_bytes(snapshot: &AttentionSourceSnapshot) -> usize {
    source_bytes(&snapshot.source)
        + 8
        + snapshot.work.as_ref().map_or(0, work_bytes)
        + snapshot.pending.iter().map(decision_bytes).sum::<usize>()
}
fn record_bytes(record: &AttentionRecord) -> usize {
    source_bytes(&record.source)
        + 64
        + match &record.change {
            AttentionRecordChange::SourceReplaced(s) => snapshot_bytes(s),
            AttentionRecordChange::Fact(c) => change_bytes(c),
            AttentionRecordChange::Checkpoint => 1,
        }
}
fn metrics(sources: &BTreeMap<String, SourceState>) -> (usize, usize) {
    sources.values().fold((0, 0), |(ids, bytes), source| {
        let (i, b) = source.metrics();
        (ids + i, bytes + b)
    })
}
