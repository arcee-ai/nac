//! Optional broker membership observation. Never an approver or authority.
//! Snapshot/install: review -> pending -> observation. Mutations take their
//! existing authority guard then observation; every callback follows all locks.
use super::*;
use crate::events::{AttentionBrokerSnapshot, AttentionBrokerState, AttentionUnavailable};
use uuid::Uuid;

const MAX_DECISIONS: usize = 256;
const MAX_METADATA_BYTES: usize = 16 * 1024;

pub(crate) trait BrokerAttentionObserver: Send + Sync {
    fn broker_changed(&self, registration: Uuid, snapshot: AttentionBrokerSnapshot);
}
struct Registration {
    id: Uuid,
    observer: Weak<dyn BrokerAttentionObserver>,
}
pub(super) struct BrokerAttention {
    owner: Uuid,
    revision: u64,
    exhausted: bool,
    registration: Option<Registration>,
}
impl BrokerAttention {
    pub(super) fn new() -> Self {
        Self {
            owner: Uuid::new_v4(),
            revision: 0,
            exhausted: false,
            registration: None,
        }
    }
}
pub(crate) struct BrokerAttentionInstall {
    pub registration: Uuid,
    pub snapshot: AttentionBrokerSnapshot,
}
pub(super) struct Publication(Uuid);

fn identity(id: &str) -> Result<Uuid, AttentionUnavailable> {
    let parsed = Uuid::parse_str(id).map_err(|_| AttentionUnavailable::InvalidMetadata)?;
    // Native navigation must preserve the exact broker key, never normalize it.
    if parsed.hyphenated().to_string() != id {
        return Err(AttentionUnavailable::InvalidMetadata);
    }
    Ok(parsed)
}

fn snapshot(
    session: &str,
    review: &ReviewMemory,
    pending: &PermissionBrokerState,
    attention: &BrokerAttention,
) -> AttentionBrokerSnapshot {
    let state = (|| {
        if attention.exhausted {
            return Err(AttentionUnavailable::SourceGap);
        }
        if session.trim().is_empty() || session.len() > 512 {
            return Err(AttentionUnavailable::InvalidMetadata);
        }
        let count = pending
            .pending
            .len()
            .saturating_add(review.blocked_ids().len());
        if count > MAX_DECISIONS || 128 + session.len() + count * 48 > MAX_METADATA_BYTES {
            return Err(AttentionUnavailable::Capacity);
        }
        let mut permissions = pending
            .pending
            .iter()
            .map(|(key, pending)| {
                let request = &pending.request;
                if request.session_id != session || *key != request.id || key.len() > 512 {
                    return Err(AttentionUnavailable::InvalidMetadata);
                }
                identity(key)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut authorizable_reviews = Vec::with_capacity(review.blocked_ids().len());
        for (owner, id) in review.blocked_ids() {
            if owner != session || id.len() > 512 {
                return Err(AttentionUnavailable::InvalidMetadata);
            }
            authorizable_reviews.push(identity(id)?);
        }
        permissions.sort_unstable();
        authorizable_reviews.sort_unstable();
        if permissions.windows(2).any(|ids| ids[0] == ids[1])
            || authorizable_reviews.windows(2).any(|ids| ids[0] == ids[1])
        {
            return Err(AttentionUnavailable::InvalidMetadata);
        }
        Ok(AttentionBrokerState::Current {
            permissions,
            authorizable_reviews,
        })
    })()
    .unwrap_or_else(AttentionBrokerState::Unavailable);
    AttentionBrokerSnapshot {
        owner: attention.owner,
        revision: attention.revision,
        state,
    }
}

impl PermissionBroker {
    pub(crate) fn replace_attention_observer(
        &self,
        expected: Option<Uuid>,
        observer: Weak<dyn BrokerAttentionObserver>,
    ) -> Option<BrokerAttentionInstall> {
        let review = self
            .review
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let pending = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut attention = self
            .attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if attention
            .registration
            .as_ref()
            .is_some_and(|slot| slot.observer.strong_count() == 0)
        {
            attention.registration = None;
        }
        if attention.registration.as_ref().map(|slot| slot.id) != expected {
            return None;
        }
        let registration = Uuid::new_v4();
        let snapshot = snapshot(&self.session_id, &review, &pending, &attention);
        attention.registration = Some(Registration {
            id: registration,
            observer,
        });
        Some(BrokerAttentionInstall {
            registration,
            snapshot,
        })
    }
    pub(crate) fn remove_attention_observer(&self, registration: Uuid) {
        let mut attention = self
            .attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if attention
            .registration
            .as_ref()
            .is_some_and(|slot| slot.id == registration)
        {
            attention.registration = None;
        }
    }
    /// Called only inside the actual membership owner's authority guard.
    pub(super) fn attention_changed(&self) -> Option<Publication> {
        let mut attention = self
            .attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match attention.revision.checked_add(1) {
            Some(revision) if !attention.exhausted => attention.revision = revision,
            _ => attention.exhausted = true,
        }
        attention
            .registration
            .as_ref()
            .map(|slot| Publication(slot.id))
    }
    /// The ticket carries no authority. Read the complete current membership
    /// again; late callbacks are rejected by registration and revision.
    pub(super) fn publish_attention(&self, publication: Option<Publication>) {
        let Some(Publication(registration)) = publication else {
            return;
        };
        let (observer, snapshot) = {
            let review = self
                .review
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let pending = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let attention = self
                .attention
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(slot) = attention
                .registration
                .as_ref()
                .filter(|slot| slot.id == registration)
            else {
                return;
            };
            (
                Weak::clone(&slot.observer),
                snapshot(&self.session_id, &review, &pending, &attention),
            )
        };
        if let Some(observer) = observer.upgrade() {
            // An observation defect must not change a real broker mutation.
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                observer.broker_changed(registration, snapshot);
            }))
            .is_err()
            {
                self.remove_attention_observer(registration);
            }
        }
    }
}

#[cfg(test)]
#[path = "attention_tests.rs"]
pub(crate) mod tests;
