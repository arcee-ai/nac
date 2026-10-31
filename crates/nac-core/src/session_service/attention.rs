//! Optional service-local metadata publication. Installation and changes share
//! one lock; the sink cannot call this service or persistence back.
use super::*;
use crate::events::{
    AttentionBrokerSnapshot, AttentionBrokerState, AttentionGoal, AttentionOperation,
    AttentionServiceObserver, AttentionServiceSnapshot, SettledWork, SettledWorkDisposition,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ContinuationDisposition {
    Started,
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
        Self {
            run: Some(run),
            disposition: ContinuationDisposition::Started,
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
    broker_registration: Option<(std::sync::Weak<crate::permissions::PermissionBroker>, Uuid)>,
    _broker_observer: Option<Arc<dyn crate::permissions::attention::BrokerAttentionObserver>>,
}

impl Drop for ServiceAttention {
    fn drop(&mut self) {
        if let Some((broker, registration)) = &self.broker_registration {
            if let Some(broker) = broker.upgrade() {
                broker.remove_attention_observer(*registration);
            }
        }
        self.observer
            .service_retired(&self.session_id, self.snapshot.epoch);
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
        let mut state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(state) = state.as_mut().filter(|state| {
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
        publish(state, &id);
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
) {
    let mut state = attention
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (Some(state), Some(id)) = (state.as_mut(), session_id) else {
        return;
    };
    let operation = normalized(operation);
    if state.snapshot.operation == operation {
        return;
    }
    if matches!(&operation, AttentionOperation::Run(id) if state.snapshot.settled.as_ref().is_some_and(|work| &work.run_id != id))
    {
        state.snapshot.settled = None;
    }
    state.snapshot.operation = operation;
    publish(state, id);
}

fn publish(state: &mut ServiceAttention, id: &str) {
    match state.snapshot.revision.checked_add(1) {
        Some(revision) => state.snapshot.revision = revision,
        None => {
            state.snapshot.epoch = Uuid::new_v4();
            state.snapshot.revision = 0;
        }
    }
    state.observer.service_changed(id, state.snapshot.clone());
}

impl SessionService {
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
            broker_registration,
            _broker_observer: broker_observer,
        });
        observer.service_changed(id, snapshot);
        drop(state);
        drop(operation);
        drop(previous);
        Some(registration)
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

    pub(super) fn publish_settled_attention(&self, work: SettledWork) {
        let Some(id) = self.metadata.session_id.as_deref() else {
            return;
        };
        let mut state = self
            .attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(state) = state.as_mut() {
            if work.disposition == SettledWorkDisposition::Completed
                && state.snapshot.operation != AttentionOperation::Idle
            {
                return;
            }
            if state.snapshot.settled.as_ref() != Some(&work) {
                state.snapshot.settled = Some(work);
                publish(state, id);
            }
        }
    }

    pub(super) fn publish_attention_completion(
        &self,
        run_id: &SessionRunId,
        successful: bool,
        goal: GoalAttentionSettlement,
        selection: ContinuationDisposition,
    ) {
        if !successful || !goal.known {
            return;
        }
        let disposition = match selection {
            ContinuationDisposition::Started | ContinuationDisposition::RetryScheduled => {
                SettledWorkDisposition::Continuing
            }
            ContinuationDisposition::WaitingForQuestion => {
                SettledWorkDisposition::WaitingForDecision
            }
            ContinuationDisposition::Idle {
                goal: current,
                last_run,
            } if current == goal.goal
                && (current.is_none() || last_run.as_deref() == Some(run_id.as_str())) =>
            {
                SettledWorkDisposition::Completed
            }
            _ => return,
        };
        self.publish_settled_attention(SettledWork {
            run_id: run_id.to_string(),
            goal: goal.goal,
            disposition,
        });
    }
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;
