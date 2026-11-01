use super::*;
use nac_core::events::{AttentionFacet, AttentionGoal};
use std::{future::Future, sync::Barrier, task::Poll, time::Duration};

fn source(id: &str) -> AttentionSource {
    AttentionSource {
        session_id: id.into(),
        epoch: Uuid::new_v4(),
    }
}

fn snapshot(source: &AttentionSource) -> AttentionSourceSnapshot {
    AttentionSourceSnapshot {
        source: source.clone(),
        revision: 0,
        work: None,
        pending: vec![],
        availability: AttentionAvailability {
            work: AttentionFacet::Available,
            questions: AttentionFacet::Available,
            permissions: AttentionFacet::Available,
            reviews: AttentionFacet::Available,
            topology: AttentionFacet::Available,
        },
    }
}

fn hub(limits: AttentionLimits, sources: &[AttentionSource]) -> AttentionHub {
    let hub = AttentionHub::new(Uuid::new_v4(), limits).unwrap();
    assert_eq!(
        hub.rebaseline(hub.boundary(), sources.iter().map(snapshot).collect()),
        AttentionApply::Applied
    );
    hub
}

fn permission(id: &str) -> AttentionDecision {
    AttentionDecision::Permission {
        request_id: id.into(),
    }
}

fn question(revision: u64) -> AttentionDecision {
    AttentionDecision::Question {
        request_id: "same-id".into(),
        run_id: "run".into(),
        generation: "generation".into(),
        revision,
    }
}

fn work(disposition: SettledWorkDisposition) -> AttentionChange {
    AttentionChange::WorkSettled(SettledWork {
        run_id: "run".into(),
        goal: Some(AttentionGoal {
            id: "goal".into(),
            version: 1,
        }),
        disposition,
    })
}

fn fact(source: &AttentionSource, revision: u64, change: AttentionChange) -> AttentionFact {
    AttentionFact {
        source: source.clone(),
        revision,
        change,
    }
}

async fn next(subscription: &mut AttentionSubscription) -> Arc<AttentionRecord> {
    match tokio::time::timeout(Duration::from_secs(2), subscription.next())
        .await
        .unwrap()
    {
        AttentionRead::Record(record) => record,
        other => panic!("expected record, got {other:?}"),
    }
}

#[tokio::test]
async fn initial_baseline_is_silent_and_live_semantic_transitions_are_once() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    let mut subscription = hub.subscribe(None).unwrap();
    assert!(subscription.initial.replay.is_empty());
    assert_eq!(subscription.initial.baseline, vec![snapshot(&source)]);
    for (revision, disposition) in [
        (1, SettledWorkDisposition::Continuing),
        (2, SettledWorkDisposition::WaitingForDecision),
    ] {
        assert_eq!(
            hub.observe(fact(&source, revision, work(disposition))),
            AttentionApply::Applied
        );
        assert!(!next(&mut subscription).await.new_attention);
    }
    let pending = fact(&source, 3, AttentionChange::DecisionPending(question(1)));
    assert_eq!(hub.observe(pending.clone()), AttentionApply::Applied);
    assert!(next(&mut subscription).await.new_attention);
    let boundary = hub.boundary();
    assert_eq!(hub.observe(pending), AttentionApply::Duplicate);
    assert_eq!(hub.boundary(), boundary);
    assert_eq!(
        hub.observe(fact(
            &source,
            4,
            AttentionChange::DecisionResolved(question(2))
        )),
        AttentionApply::Applied
    );
    assert!(!next(&mut subscription).await.new_attention);
    let completed = fact(&source, 5, work(SettledWorkDisposition::Completed));
    assert_eq!(hub.observe(completed.clone()), AttentionApply::Applied);
    assert!(next(&mut subscription).await.new_attention);
    assert_eq!(hub.observe(completed), AttentionApply::Duplicate);
    assert_eq!(
        hub.observe(fact(&source, 6, work(SettledWorkDisposition::Completed))),
        AttentionApply::Applied
    );
    let repeated = next(&mut subscription).await;
    assert!(!repeated.new_attention);
    assert_eq!(repeated.change, AttentionRecordChange::Checkpoint);
    assert_eq!(repeated.source_revision, 6);
    drop(subscription);
    let initial = hub.subscribe(None).unwrap();
    assert!(initial.initial.replay.is_empty());
    assert!(initial.initial.baseline[0].pending.is_empty());
    assert_eq!(initial.initial.baseline[0].revision, 6);
}

#[tokio::test]
async fn decision_kinds_and_question_revisions_do_not_alias_or_resurrect() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    let mut subscription = hub.subscribe(None).unwrap();
    for (index, decision) in [
        permission("same-id"),
        AttentionDecision::Review {
            review_id: "same-id".into(),
        },
        question(1),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            hub.observe(fact(
                &source,
                index as u64 + 1,
                AttentionChange::DecisionPending(decision)
            )),
            AttentionApply::Applied
        );
        assert!(next(&mut subscription).await.new_attention);
    }
    for (revision, change) in [
        (4, AttentionChange::DecisionPending(question(2))),
        (5, AttentionChange::DecisionResolved(question(1))), // stale resolution
        (6, AttentionChange::DecisionResolved(question(3))),
        (7, AttentionChange::DecisionPending(question(1))), // late semantic replay
        (
            8,
            AttentionChange::DecisionResolved(permission("resolved-first")),
        ),
        (
            9,
            AttentionChange::DecisionPending(permission("resolved-first")),
        ),
    ] {
        assert_eq!(
            hub.observe(fact(&source, revision, change)),
            AttentionApply::Applied
        );
        let record = next(&mut subscription).await;
        assert!(!record.new_attention);
        if [5, 7, 9].contains(&revision) {
            assert_eq!(record.change, AttentionRecordChange::Checkpoint);
        }
        if revision == 5 {
            assert!(hub.lock().sources["s"]
                .snapshot()
                .pending
                .contains(&question(2)));
        }
    }
    let state = hub.lock().sources["s"].snapshot();
    assert_eq!(state.pending.len(), 2);
    assert!(!state
        .pending
        .iter()
        .any(|d| matches!(d, AttentionDecision::Question { .. })));
}

#[test]
fn a_pending_question_cannot_be_reported_as_completed_work() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    assert_eq!(
        hub.observe(fact(
            &source,
            1,
            AttentionChange::DecisionPending(question(1))
        )),
        AttentionApply::Applied
    );
    assert_eq!(
        hub.observe(fact(&source, 2, work(SettledWorkDisposition::Completed))),
        AttentionApply::Unavailable(AttentionUnavailable::InvalidMetadata)
    );
    assert_eq!(hub.retention().identities, 0);
}

#[tokio::test]
async fn subscribe_frontier_covers_publication_before_after_and_racing_snapshot() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    // Producer wins before subscription: canonical baseline contains the fact,
    // without a historical notification or a second live copy.
    let producer = hub.clone();
    let source_copy = source.clone();
    std::thread::spawn(move || {
        producer.observe(fact(
            &source_copy,
            1,
            work(SettledWorkDisposition::Continuing),
        ))
    })
    .join()
    .unwrap();
    let mut subscription = hub.subscribe(None).unwrap();
    assert_eq!(subscription.initial.boundary.sequence, 1);
    assert_eq!(subscription.initial.baseline[0].revision, 1);
    assert!(subscription.initial.replay.is_empty());
    // Subscriber wins before publication: a waiting read receives the real fact.
    let mut waiting = Box::pin(subscription.next());
    std::future::poll_fn(|context| {
        assert!(waiting.as_mut().poll(context).is_pending());
        Poll::Ready(())
    })
    .await;
    assert_eq!(
        hub.observe(fact(
            &source,
            2,
            AttentionChange::DecisionPending(permission("decision"))
        )),
        AttentionApply::Applied
    );
    let AttentionRead::Record(record) = waiting.await else {
        panic!("publication was lost")
    };
    assert_eq!(record.boundary.sequence, 2);
    assert!(record.new_attention);
    drop(subscription);

    // Both operations actually contend on the production publication mutex.
    // Either lock winner must put the event on exactly one side of frontier.
    let guard = hub.lock();
    let barrier = Arc::new(Barrier::new(3));
    let reader_hub = hub.clone();
    let reader_barrier = barrier.clone();
    let reader = std::thread::spawn(move || {
        reader_barrier.wait();
        reader_hub.subscribe(None).unwrap()
    });
    let writer_hub = hub.clone();
    let writer_barrier = barrier.clone();
    let writer = std::thread::spawn(move || {
        writer_barrier.wait();
        writer_hub.observe(fact(
            &source,
            3,
            AttentionChange::DecisionPending(permission("racing")),
        ))
    });
    barrier.wait();
    drop(guard);
    let mut subscription = reader.join().unwrap();
    assert_eq!(writer.join().unwrap(), AttentionApply::Applied);
    let before = subscription.initial.baseline[0]
        .pending
        .contains(&permission("racing"));
    if before {
        assert_eq!(subscription.initial.boundary.sequence, 3);
        assert!(!subscription.wake.as_ref().unwrap().has_changed().unwrap());
    } else {
        assert_eq!(subscription.initial.boundary.sequence, 2);
        let record = next(&mut subscription).await;
        assert_eq!(record.boundary.sequence, 3);
        assert!(record.new_attention);
    }
}

#[tokio::test]
async fn cancelling_a_wait_does_not_consume_the_next_record_or_release_a_new_seat() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    let mut subscription = hub.subscribe(None).unwrap();
    assert!(matches!(
        hub.subscribe(None),
        Err(AttentionSubscribeError::Busy)
    ));
    let mut waiting = Box::pin(subscription.next());
    std::future::poll_fn(|context| {
        assert!(waiting.as_mut().poll(context).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(waiting);
    hub.observe(fact(
        &source,
        1,
        AttentionChange::DecisionPending(permission("live")),
    ));
    assert!(next(&mut subscription).await.new_attention);
    hub.reset();
    let reset_boundary = hub.boundary();
    assert_eq!(
        hub.rebaseline(reset_boundary, vec![snapshot(&source)]),
        AttentionApply::Applied
    );
    assert!(matches!(
        hub.subscribe(None),
        Err(AttentionSubscribeError::Busy)
    ));
    assert_eq!(hub.retention().wake_receivers, 1);
    assert_eq!(
        subscription.next().await,
        AttentionRead::Reset(AttentionReset::Incarnation)
    );
    assert!(subscription.initial.baseline.is_empty());
    assert!(subscription.initial.replay.is_empty());
    assert_eq!(hub.retention().wake_receivers, 0);
    let newer = hub.subscribe(None).unwrap();
    drop(subscription);
    assert_eq!(hub.retention().subscribers, 1);
    assert_eq!(hub.retention().wake_receivers, 1);
    drop(newer);
    assert_eq!(hub.retention().subscribers, 0);
    assert_eq!(hub.retention().wake_receivers, 0);
}

#[test]
fn owner_cas_deletion_and_late_facts_cannot_replace_current_session_state() {
    let old = source("s");
    let current = source("s");
    let hub = hub(AttentionLimits::default(), &[old.clone()]);
    assert_eq!(
        hub.replace_source(None, snapshot(&current)),
        AttentionApply::StaleSource
    );
    assert_eq!(
        hub.replace_source(Some(&old), snapshot(&current)),
        AttentionApply::Applied
    );
    assert_eq!(
        hub.replace_source(Some(&old), snapshot(&old)),
        AttentionApply::StaleSource
    );
    assert_eq!(
        hub.observe(fact(&old, 1, work(SettledWorkDisposition::Completed))),
        AttentionApply::StaleSource
    );
    assert_eq!(
        hub.observe(fact(&current, 1, AttentionChange::SessionDeleted)),
        AttentionApply::Applied
    );
    assert_eq!(
        hub.observe(fact(&current, 2, work(SettledWorkDisposition::Completed))),
        AttentionApply::StaleSource
    );
    assert_eq!(
        hub.replace_source(None, snapshot(&old)),
        AttentionApply::StaleSource
    );
    let subscription = hub.subscribe(None).unwrap();
    assert!(subscription.initial.baseline.is_empty());
    assert_eq!(hub.retention().sources, 1); // bounded tombstone fences late owners
    assert_eq!(hub.retention().identities, 0);
}

#[test]
fn source_gap_reset_and_rebaseline_require_current_frontiers() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    let stale = hub.boundary();
    assert_eq!(
        hub.observe(fact(&source, 2, work(SettledWorkDisposition::Completed))),
        AttentionApply::Unavailable(AttentionUnavailable::SourceGap)
    );
    assert_eq!(
        hub.rebaseline(stale, vec![snapshot(&source)]),
        AttentionApply::StaleSource
    );
    assert!(matches!(
        hub.subscribe(None),
        Err(AttentionSubscribeError::Unavailable(
            AttentionUnavailable::SourceGap
        ))
    ));
    assert_eq!(
        hub.observe(fact(&source, 1, work(SettledWorkDisposition::Completed))),
        AttentionApply::Unavailable(AttentionUnavailable::SourceGap)
    );
    let mut canonical = snapshot(&source);
    canonical.revision = 2;
    canonical.work = match work(SettledWorkDisposition::Completed) {
        AttentionChange::WorkSettled(w) => Some(w),
        _ => unreachable!(),
    };
    assert_eq!(
        hub.rebaseline(hub.boundary(), vec![canonical]),
        AttentionApply::Applied
    );
    let subscription = hub.subscribe(Some(stale)).unwrap();
    assert_eq!(
        subscription.initial.reset,
        Some(AttentionReset::Incarnation)
    );
    assert!(subscription.initial.replay.is_empty());
    assert_eq!(
        hub.observe(fact(&source, 1, work(SettledWorkDisposition::Completed))),
        AttentionApply::Duplicate
    );
    assert_eq!(
        hub.observe(fact(&source, 3, work(SettledWorkDisposition::Completed))),
        AttentionApply::Applied
    );
    assert!(!hub.lock().replay.back().unwrap().new_attention);
}

#[tokio::test]
async fn replay_count_and_byte_eviction_report_gaps_without_inventing_completion() {
    for limits in [
        AttentionLimits {
            replay_records: 2,
            ..AttentionLimits::default()
        },
        AttentionLimits {
            replay_bytes: 110,
            ..AttentionLimits::default()
        },
    ] {
        let source = source("s");
        let hub = hub(limits, &[source.clone()]);
        let frontier = hub.boundary();
        let mut slow = hub.subscribe(None).unwrap();
        for revision in 1..=3 {
            assert_eq!(
                hub.observe(fact(
                    &source,
                    revision,
                    AttentionChange::DecisionPending(permission(&format!("d{revision}")))
                )),
                AttentionApply::Applied
            );
        }
        assert_eq!(
            slow.next().await,
            AttentionRead::Reset(AttentionReset::ReplayGap)
        );
        let retention = hub.retention();
        assert!(retention.replay_records <= limits.replay_records);
        assert!(retention.replay_bytes <= limits.replay_bytes);
        let subscription = hub.subscribe(Some(frontier)).unwrap();
        assert_eq!(subscription.initial.reset, Some(AttentionReset::ReplayGap));
        assert!(subscription.initial.replay.is_empty());
        assert_eq!(subscription.initial.baseline[0].pending.len(), 3);
        drop(subscription);
        let current = hub.boundary();
        let future = AttentionBoundary {
            sequence: current.sequence + 1,
            ..current
        };
        assert_eq!(
            hub.subscribe(Some(future)).unwrap().initial.reset,
            Some(AttentionReset::InvalidCursor)
        );
    }
}

#[test]
fn reconnect_replays_only_after_the_acknowledged_frontier() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    hub.observe(fact(
        &source,
        1,
        AttentionChange::DecisionPending(permission("first")),
    ));
    let first = hub.boundary();
    hub.observe(fact(
        &source,
        2,
        AttentionChange::DecisionResolved(permission("first")),
    ));
    hub.observe(fact(&source, 3, work(SettledWorkDisposition::Completed)));
    let subscription = hub.subscribe(Some(first)).unwrap();
    assert_eq!(subscription.initial.reset, None);
    assert_eq!(
        subscription
            .initial
            .replay
            .iter()
            .map(|r| r.boundary.sequence)
            .collect::<Vec<_>>(),
        vec![2, 3]
    );
    assert!(!subscription.initial.replay[0].new_attention);
    assert!(subscription.initial.replay[1].new_attention);
}

#[test]
fn capacities_fail_explicitly_and_release_all_hub_retention() {
    for (limits, decision) in [
        (
            AttentionLimits {
                identities: 1,
                ..AttentionLimits::default()
            },
            permission("second"),
        ),
        (
            AttentionLimits {
                current_bytes: 128,
                ..AttentionLimits::default()
            },
            permission(&"x".repeat(512)),
        ),
        (
            AttentionLimits {
                replay_bytes: 110,
                ..AttentionLimits::default()
            },
            permission(&"x".repeat(512)),
        ),
    ] {
        let source = source("s");
        let hub = hub(limits, &[source.clone()]);
        hub.observe(fact(
            &source,
            1,
            AttentionChange::DecisionPending(permission("first")),
        ));
        let subscription = hub.subscribe(None).unwrap();
        assert_eq!(
            hub.observe(fact(&source, 2, AttentionChange::DecisionPending(decision))),
            AttentionApply::Unavailable(AttentionUnavailable::Capacity)
        );
        assert_eq!(
            hub.retention(),
            AttentionRetention {
                sources: 0,
                identities: 0,
                current_bytes: 0,
                replay_records: 0,
                replay_bytes: 0,
                subscribers: 0,
                wake_receivers: 1
            }
        );
        drop(subscription);
        assert_eq!(hub.retention().wake_receivers, 0);
        assert!(matches!(
            hub.subscribe(None),
            Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::Capacity
            ))
        ));
    }
    let first = source("first");
    let hub = hub(
        AttentionLimits {
            sources: 1,
            ..AttentionLimits::default()
        },
        &[first.clone()],
    );
    hub.observe(fact(&first, 1, AttentionChange::SessionDeleted));
    assert_eq!(
        hub.replace_source(None, snapshot(&source("other"))),
        AttentionApply::Unavailable(AttentionUnavailable::Capacity)
    );
}

#[test]
fn invalid_metadata_and_stale_rebaseline_do_not_create_a_current_baseline() {
    let source = source("s");
    let hub = hub(AttentionLimits::default(), &[source.clone()]);
    let stale = hub.boundary();
    hub.observe(fact(
        &source,
        1,
        AttentionChange::DecisionResolved(permission("already-resolved")),
    ));
    let before_repeat = hub.boundary();
    hub.observe(fact(
        &source,
        2,
        AttentionChange::DecisionPending(permission("already-resolved")),
    ));
    assert_ne!(before_repeat, hub.boundary()); // semantic repeats still fence source revision
    assert_eq!(
        hub.rebaseline(stale, vec![snapshot(&source)]),
        AttentionApply::StaleSource
    );
    for pending in [
        vec![permission("")],
        vec![permission(&"x".repeat(513))],
        vec![question(0)],
        vec![permission("duplicate"), permission("duplicate")],
    ] {
        let mut invalid = snapshot(&source);
        invalid.pending = pending;
        assert_eq!(
            hub.rebaseline(hub.boundary(), vec![invalid]),
            AttentionApply::Unavailable(AttentionUnavailable::InvalidMetadata)
        );
    }
}

#[test]
fn construction_is_inert_and_capacity_limits_cannot_be_silently_disabled() {
    let hub = AttentionHub::new(Uuid::new_v4(), AttentionLimits::default()).unwrap();
    assert_eq!(hub.retention().subscribers, 0);
    assert_eq!(hub.retention().wake_receivers, 0);
    assert!(matches!(
        hub.subscribe(None),
        Err(AttentionSubscribeError::Unavailable(
            AttentionUnavailable::Initial
        ))
    ));
    let initial = hub.boundary();
    assert_eq!(hub.rebaseline(initial, vec![]), AttentionApply::Applied);
    let subscription = hub.subscribe(None).unwrap();
    assert!(subscription.initial.baseline.is_empty());
    assert!(subscription.initial.replay.is_empty());
    for limits in [
        AttentionLimits {
            sources: 0,
            ..AttentionLimits::default()
        },
        AttentionLimits {
            identities: 1025,
            ..AttentionLimits::default()
        },
        AttentionLimits {
            replay_records: 257,
            ..AttentionLimits::default()
        },
        AttentionLimits {
            current_bytes: usize::MAX,
            ..AttentionLimits::default()
        },
        AttentionLimits {
            replay_bytes: usize::MAX,
            ..AttentionLimits::default()
        },
    ] {
        assert!(matches!(
            AttentionHub::new(Uuid::new_v4(), limits),
            Err(AttentionUnavailable::InvalidMetadata)
        ));
    }
}

#[test]
fn engine_replacement_and_source_registration_provide_silent_current_state() {
    let hub = hub(AttentionLimits::default(), &[]);
    let mut registered = snapshot(&source("new-session"));
    registered.pending = vec![permission("existing")];
    assert_eq!(
        hub.replace_source(None, registered.clone()),
        AttentionApply::Applied
    );
    assert!(!hub.lock().replay.back().unwrap().new_attention);
    let other_engine = AttentionBoundary {
        engine: Uuid::new_v4(),
        ..hub.boundary()
    };
    let subscription = hub.subscribe(Some(other_engine)).unwrap();
    assert_eq!(
        subscription.initial.reset,
        Some(AttentionReset::Incarnation)
    );
    assert!(subscription.initial.replay.is_empty());
    assert_eq!(subscription.initial.baseline, vec![registered]);
}
