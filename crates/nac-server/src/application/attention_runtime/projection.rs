//! Pure metadata normalization and contiguous publication under the source lock.
use super::*;

pub(super) fn normalized(id: &str, source: &Source) -> Option<AttentionSourceSnapshot> {
    let stored = source.stored.as_ref()?;
    let supported = stored.primary && stored.direct;
    let work = source.service.as_ref().and_then(|service| {
        let work = service.settled.as_ref()?;
        if !supported
            || stored.manual_unsettled
            || stored.inbox_pending
            || stored.question.is_some()
        {
            return None;
        }
        if work.goal.as_ref() != stored.goal.as_ref().map(|goal| &goal.identity) {
            return None;
        }
        if work.disposition == SettledWorkDisposition::Completed {
            let goal = stored.goal.as_ref()?;
            if service.operation != AttentionOperation::Idle
                || work.goal.as_ref() != Some(&goal.identity)
                || goal.status != nac_core::store::GoalStatus::Complete
                || goal.accounting_run.is_some()
                || goal.continuation_run.is_some()
                || goal.retry_scheduled
                || goal.last_run.as_deref() != Some(&work.run_id)
            {
                return None;
            }
        }
        Some(work.clone())
    });
    Some(AttentionSourceSnapshot {
        source: AttentionSource {
            session_id: id.to_owned(),
            epoch: source.epoch,
        },
        revision: 0,
        availability: AttentionAvailability {
            work: if !supported {
                AttentionFacet::Unsupported
            } else if work.is_some() {
                AttentionFacet::Available
            } else {
                AttentionFacet::Unknown
            },
            questions: if stored.questions_supported {
                AttentionFacet::Available
            } else {
                AttentionFacet::Unsupported
            },
            permissions: AttentionFacet::Unsupported,
            reviews: AttentionFacet::Unsupported,
            topology: if supported {
                AttentionFacet::Available
            } else {
                AttentionFacet::Unsupported
            },
        },
        work,
        pending: stored.question.clone().into_iter().collect(),
    })
}
pub(super) fn emit(hub: &AttentionHub, source: &mut Source, change: AttentionChange) -> Result<()> {
    let Some(published) = source.published.as_mut() else {
        return Ok(());
    };
    published.revision =
        published
            .revision
            .checked_add(1)
            .ok_or(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::Capacity,
            ))?;
    if matches!(
        hub.observe(AttentionFact {
            source: published.source.clone(),
            revision: published.revision,
            change
        }),
        AttentionApply::Unavailable(_)
    ) {
        return Err(AttentionSubscribeError::Unavailable(
            AttentionUnavailable::Capacity,
        ));
    }
    Ok(())
}
fn same_identity(a: &AttentionDecision, b: &AttentionDecision) -> bool {
    match (a, b) {
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
        _ => a == b,
    }
}
pub(super) fn publish(
    hub: &AttentionHub,
    source: &mut Source,
    mut next: AttentionSourceSnapshot,
) -> Result<()> {
    let old = source.published.clone();
    if old.as_ref().is_none_or(|old| old.source != next.source) {
        // Transfer the last observed durable decision silently, then publish
        // changes that happened during installation. A question committed after
        // baseline cannot disappear into a later service replacement snapshot.
        let mut handoff = next.clone();
        handoff.work = None;
        handoff.pending = old
            .as_ref()
            .map_or_else(Vec::new, |old| old.pending.clone());
        if handoff.availability.work != AttentionFacet::Unsupported {
            handoff.availability.work = AttentionFacet::Unknown;
        }
        let expected = old.as_ref().map(|old| &old.source);
        if hub.replace_source(expected, handoff.clone()) != AttentionApply::Applied {
            return Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::SourceGap,
            ));
        }
        source.published = Some(handoff);
        return publish(hub, source, next);
    } else if let Some(old) = old {
        for decision in old.pending.iter().filter(|decision| {
            !next
                .pending
                .iter()
                .any(|next| same_identity(decision, next))
        }) {
            emit(
                hub,
                source,
                AttentionChange::DecisionResolved(decision.clone()),
            )?;
        }
        for decision in next
            .pending
            .iter()
            .filter(|decision| !old.pending.contains(decision))
        {
            emit(
                hub,
                source,
                AttentionChange::DecisionPending(decision.clone()),
            )?;
        }
        if old.work != next.work {
            emit(
                hub,
                source,
                next.work
                    .clone()
                    .map_or(AttentionChange::WorkCleared, AttentionChange::WorkSettled),
            )?;
        }
        if old.availability != next.availability {
            emit(
                hub,
                source,
                AttentionChange::Availability(next.availability),
            )?;
        }
        next.revision = source
            .published
            .as_ref()
            .ok_or(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::SourceGap,
            ))?
            .revision;
    }
    source.published = Some(next);
    Ok(())
}
