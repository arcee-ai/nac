//! Optional service-local metadata publication. Installation and changes share
//! one lock; the sink cannot call this service or persistence back.
use super::*;
use crate::events::{
    AttentionBrokerSnapshot, AttentionBrokerState, AttentionGoal, AttentionOperation,
    AttentionServiceObserver, AttentionServiceSnapshot, SettledWork, SettledWorkDisposition,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ContinuationDisposition {
    Started {
        successor: SessionRunId,
    },
    WaitingForQuestion,
    RetryScheduled,
    Idle {
        goal: Option<AttentionGoal>,
        last_run: Option<String>,
    },
    IdleUnverified,
    Busy,
    ForeignOwner,
    Stopping,
}

pub(super) struct ContinuationSelection {
    pub run: Option<SessionRunHandle>,
    pub disposition: ContinuationDisposition,
}

impl ContinuationSelection {
    pub fn stopped(disposition: ContinuationDisposition) -> Self {
        Self {
            run: None,
            disposition,
        }
    }
    pub fn started(run: SessionRunHandle) -> Self {
        let successor = run.run_id.clone();
        Self {
            run: Some(run),
            disposition: ContinuationDisposition::Started { successor },
        }
    }
}

pub(super) struct GoalAttentionSettlement {
    pub known: bool,
    pub goal: Option<AttentionGoal>,
}

pub(super) struct ServiceAttention {
    snapshot: AttentionServiceSnapshot,
    observer: Arc<dyn AttentionServiceObserver>,
    registration: Uuid,
    session_id: String,
    /// Actual accepted operation identity, retained through its idle publication.
    /// A delayed older settlement cannot replace a newer run's receipt.
    last_operation_run: Option<String>,
    broker_registration: Option<(std::sync::Weak<crate::permissions::PermissionBroker>, Uuid)>,
    _broker_observer: Option<Arc<dyn crate::permissions::attention::BrokerAttentionObserver>>,
}

impl ServiceAttention {
    // Remove only metadata registration while the service slot is still fenced.
    // This performs no callback and drops no observer. A replacement cannot see
    // an empty service slot while the failed broker registration still owns it.
    fn detach_broker(&mut self) {
        if let Some((broker, registration)) = self.broker_registration.take() {
            if let Some(broker) = broker.upgrade() {
                broker.remove_attention_observer(registration);
            }
        }
    }
}

impl Drop for ServiceAttention {
    fn drop(&mut self) {
        self.detach_broker();
        // A broken optional sink cannot unwind service teardown, including
        // retirement after its service_changed callback has already panicked.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.observer
                .service_retired(&self.session_id, self.snapshot.epoch);
        }));
    }
}

struct BrokerBridge {
    state: std::sync::Weak<StdMutex<Option<ServiceAttention>>>,
}
impl crate::permissions::attention::BrokerAttentionObserver for BrokerBridge {
    fn broker_changed(&self, registration: Uuid, snapshot: AttentionBrokerSnapshot) {
        let Some(state) = self.state.upgrade() else {
            return;
        };
        let mut guard = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(state) = guard.as_mut().filter(|state| {
            state
                .broker_registration
                .as_ref()
                .is_some_and(|(_, id)| *id == registration)
        }) else {
            return;
        };
        if let Some(old) = &state.snapshot.broker {
            if old.owner != snapshot.owner
                || old.revision > snapshot.revision
                || (old.revision == snapshot.revision
                    && (old == &snapshot
                        || !matches!(snapshot.state, AttentionBrokerState::Unavailable(_))))
            {
                return;
            }
        }
        state.snapshot.broker = Some(snapshot);
        let id = state.session_id.clone();
        let published = publish(state, &id);
        let retired = if published {
            None
        } else {
            state.detach_broker();
            guard.take()
        };
        drop(guard);
        drop(retired);
    }
}

fn normalized(operation: Option<&ActiveSessionOperationSnapshot>) -> AttentionOperation {
    match operation {
        None => AttentionOperation::Idle,
        Some(ActiveSessionOperationSnapshot::Run { run }) => {
            AttentionOperation::Run(run.run_id.to_string())
        }
        Some(ActiveSessionOperationSnapshot::HumanShell { command }) => {
            AttentionOperation::Manual(command.operation_id.clone())
        }
        Some(ActiveSessionOperationSnapshot::ManualCompaction { compaction }) => {
            AttentionOperation::Compaction(compaction.compaction_id.to_string())
        }
    }
}

pub(super) fn operation_changed(
    attention: &StdMutex<Option<ServiceAttention>>,
    session_id: Option<&str>,
    operation: Option<&ActiveSessionOperationSnapshot>,
) -> Option<ServiceAttention> {
    let mut guard = attention
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (Some(state), Some(id)) = (guard.as_mut(), session_id) else {
        return None;
    };
    let operation = normalized(operation);
    if state.snapshot.operation == operation {
        return None;
    }
    if let AttentionOperation::Run(run) = &operation {
        state.last_operation_run = Some(run.clone());
    }
    if matches!(&operation, AttentionOperation::Run(id) if state.snapshot.settled.as_ref().is_some_and(|work| &work.run_id != id))
    {
        state.snapshot.settled = None;
    }
    state.snapshot.operation = operation;
    if publish(state, id) {
        None
    } else {
        state.detach_broker();
        guard.take()
    }
}

fn publish(state: &mut ServiceAttention, id: &str) -> bool {
    match state.snapshot.revision.checked_add(1) {
        Some(revision) => state.snapshot.revision = revision,
        None => {
            state.snapshot.epoch = Uuid::new_v4();
            state.snapshot.revision = 0;
        }
    }
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        state.observer.service_changed(id, state.snapshot.clone());
    }))
    .is_ok()
}

impl SessionService {
    /// This finite check belongs only to an acknowledged successful settlement.
    /// It cannot select, recover or admit work, even if intent arrives after preflight.
    pub(super) fn verify_goal_free_settlement(
        &self,
        lease: sessions::SessionOperationLease,
        run: SessionRunId,
    ) -> Result<ContinuationSelection> {
        let id =
            self.metadata.session_id.as_deref().ok_or_else(|| {
                anyhow::anyhow!("goal-free settlement requires a persisted session")
            })?;
        lease.validate(&self.metadata.store_path, id)?;
        let disposition = if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            ContinuationDisposition::Stopping
        } else if self.has_active_operation() {
            ContinuationDisposition::Busy
        } else {
            let metadata =
                crate::store::read_attention_metadata(&self.metadata.store_path, Some(id))?
                    .into_iter()
                    .next();
            match metadata {
                Some(metadata)
                    if metadata.verifies_goal_free_idle(run.as_str(), self.config_version)
                        && self.attention_broker_idle() =>
                {
                    ContinuationDisposition::Idle {
                        goal: None,
                        last_run: Some(run.to_string()),
                    }
                }
                Some(metadata)
                    if metadata.primary
                        && metadata.questions_supported
                        && self.config_version == Some(metadata.config_version)
                        && metadata.goal.is_none()
                        && !metadata.inbox_pending
                        && !metadata.manual_unsettled
                        && !metadata.recovery_pending
                        && metadata.question.is_some() =>
                {
                    ContinuationDisposition::WaitingForQuestion
                }
                _ => ContinuationDisposition::IdleUnverified,
            }
        };
        Ok(ContinuationSelection::stopped(disposition))
    }

    pub(super) fn attention_broker_idle(&self) -> bool {
        self.attention.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref().is_some_and(|state| matches!(&state.snapshot.broker,
                Some(AttentionBrokerSnapshot { state: AttentionBrokerState::Current { permissions, authorizable_reviews }, .. })
                if permissions.is_empty() && authorizable_reviews.is_empty()))
    }

    /// Existing owners call this before cache publication/wake, or on opt-in.
    /// The operation publication lock precedes the source metadata lock in
    /// exactly the same order as ActiveOperationGuard::drop.
    pub fn install_attention_observer(
        &self,
        observer: Arc<dyn AttentionServiceObserver>,
    ) -> Option<Uuid> {
        let id = self.metadata.session_id.as_deref()?;
        let operation = self
            .published_operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut state = self
            .attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous = state.take();
        let mut snapshot = previous
            .as_ref()
            .map(|state| state.snapshot.clone())
            .unwrap_or_else(|| AttentionServiceSnapshot {
                epoch: Uuid::new_v4(),
                revision: 0,
                operation: normalized(operation.as_ref()),
                settled: None,
                broker: None,
            });
        let registration = Uuid::new_v4();
        let last_operation_run = previous
            .as_ref()
            .and_then(|state| state.last_operation_run.clone())
            .or_else(|| match &snapshot.operation {
                AttentionOperation::Run(run) => Some(run.clone()),
                _ => None,
            });
        let mut broker_registration = None;
        let mut broker_observer = None;
        snapshot.broker = None;
        if let Some(broker) = &self.permission_broker {
            let bridge: Arc<dyn crate::permissions::attention::BrokerAttentionObserver> =
                Arc::new(BrokerBridge {
                    state: Arc::downgrade(&self.attention),
                });
            let expected = previous
                .as_ref()
                .and_then(|state| state.broker_registration.as_ref().map(|(_, id)| *id));
            if let Some(installed) =
                broker.replace_attention_observer(expected, Arc::downgrade(&bridge))
            {
                snapshot.broker = Some(installed.snapshot);
                broker_registration = Some((Arc::downgrade(broker), installed.registration));
                broker_observer = Some(bridge);
            }
        }
        *state = Some(ServiceAttention {
            snapshot: snapshot.clone(),
            observer: Arc::clone(&observer),
            registration,
            session_id: id.to_owned(),
            last_operation_run,
            broker_registration,
            _broker_observer: broker_observer,
        });
        let installed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            observer.service_changed(id, snapshot);
        }))
        .is_ok();
        let failed = if installed {
            None
        } else {
            if let Some(failed) = state.as_mut() {
                failed.detach_broker();
            }
            state.take()
        };
        drop(state);
        drop(operation);
        // Both the replaced and failed registrations retire outside the
        // publication/observation locks; compare-remove preserves a successor.
        drop(previous);
        drop(failed);
        installed.then_some(registration)
    }

    pub fn remove_attention_observer(&self, registration: Uuid) {
        let retired = {
            let mut state = self
                .attention
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state
                .as_ref()
                .is_some_and(|state| state.registration == registration)
            {
                state.take()
            } else {
                None
            }
        };
        // Broker compare-remove and retirement callback run outside service locks.
        drop(retired);
    }

    pub(super) fn attention_enabled(&self) -> bool {
        self.attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some()
    }

    pub(super) fn publish_settled_attention(
        &self,
        work: SettledWork,
        selected_successor: Option<&SessionRunId>,
    ) {
        let Some(id) = self.metadata.session_id.as_deref() else {
            return;
        };
        let mut guard = self
            .attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut retired = None;
        if let Some(state) = guard.as_mut() {
            let current = match work.disposition {
                SettledWorkDisposition::Continuing => match selected_successor {
                    Some(successor) => matches!(&state.snapshot.operation,
                        AttentionOperation::Run(current) if current == successor.as_str()),
                    // A scheduled goal retry selects no run. Keep only the
                    // exact still-idle predecessor, never invent a successor.
                    None => {
                        work.goal.is_some()
                            && state.snapshot.operation == AttentionOperation::Idle
                            && state.last_operation_run.as_deref() == Some(work.run_id.as_str())
                    }
                },
                // Goal provenance does not make an older run current again.
                SettledWorkDisposition::Completed | SettledWorkDisposition::WaitingForDecision => {
                    state.last_operation_run.as_deref() == Some(work.run_id.as_str())
                }
            };
            if !current {
                return;
            }
            if work.disposition == SettledWorkDisposition::Completed
                && state.snapshot.operation != AttentionOperation::Idle
            {
                return;
            }
            if work.goal.is_none()
                && work.disposition == SettledWorkDisposition::Completed
                && !matches!(&state.snapshot.broker,
                    Some(AttentionBrokerSnapshot { state: AttentionBrokerState::Current { permissions, authorizable_reviews }, .. })
                    if permissions.is_empty() && authorizable_reviews.is_empty())
            {
                return;
            }
            if state.snapshot.settled.as_ref() != Some(&work) {
                state.snapshot.settled = Some(work);
                if !publish(state, id) {
                    state.detach_broker();
                    retired = guard.take();
                }
            }
        }
        drop(guard);
        drop(retired);
    }

    pub(super) fn publish_attention_completion(
        &self,
        run_id: &SessionRunId,
        successful: bool,
        goal: GoalAttentionSettlement,
        selection: ContinuationDisposition,
    ) {
        if !successful
            || !goal.known
            || (goal.goal.is_none()
                && self
                    .stopping_admission
                    .load(std::sync::atomic::Ordering::Acquire))
        {
            return;
        }
        let (disposition, selected_successor) = match selection {
            ContinuationDisposition::Started { successor } => {
                (SettledWorkDisposition::Continuing, Some(successor))
            }
            ContinuationDisposition::RetryScheduled if goal.goal.is_some() => {
                (SettledWorkDisposition::Continuing, None)
            }
            ContinuationDisposition::WaitingForQuestion => {
                (SettledWorkDisposition::WaitingForDecision, None)
            }
            ContinuationDisposition::Idle {
                goal: current,
                last_run,
            } if current == goal.goal && last_run.as_deref() == Some(run_id.as_str()) => {
                (SettledWorkDisposition::Completed, None)
            }
            _ => return,
        };
        self.publish_settled_attention(
            SettledWork {
                run_id: run_id.to_string(),
                goal: goal.goal,
                disposition,
            },
            selected_successor.as_ref(),
        );
    }
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;
