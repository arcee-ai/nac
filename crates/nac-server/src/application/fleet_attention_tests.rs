use super::*;
use nac_core::events::{
    AttentionBrokerSnapshot, AttentionBrokerState, AttentionDecision, AttentionFacet,
};
use nac_core::store::AttentionLineageKind;

fn stored(id: &str, primary: bool) -> AttentionStoredSession {
    AttentionStoredSession {
        id: id.into(),
        primary,
        traditional_child: !primary,
        direct: true,
        questions_supported: primary,
        goal: None,
        question: None,
        inbox_pending: false,
        manual_unsettled: false,
        config_version: 0,
        last_outcome: None,
        recovery_pending: false,
    }
}

fn hub_with(sessions: Vec<AttentionStoredSession>, project: Option<&str>) -> FleetAttentionHub {
    let hub = FleetAttentionHub::default();
    let topology = sessions
        .iter()
        .map(|session| {
            (
                session.id.clone(),
                AttentionTopology {
                    session_id: session.id.clone(),
                    project_id: project.map(str::to_owned),
                    lineage: (!session.primary).then(|| AttentionLineage {
                        kind: AttentionLineageKind::TraditionalChild,
                        parent_session_id: "parent".into(),
                        root_session_id: "parent".into(),
                    }),
                },
            )
        })
        .collect();
    let mut cache = lock(&hub.0.store);
    cache.ticket = 1;
    cache.census = Some(Arc::new(StoreCensus {
        metadata: sessions,
        topology,
    }));
    drop(cache);
    hub
}

fn owner(permissions: Vec<Uuid>) -> AttentionServiceSnapshot {
    AttentionServiceSnapshot {
        epoch: Uuid::nil(),
        revision: 1,
        operation: AttentionOperation::Run("run".into()),
        settled: None,
        broker: Some(AttentionBrokerSnapshot {
            owner: Uuid::nil(),
            revision: 1,
            state: AttentionBrokerState::Current {
                permissions,
                authorizable_reviews: Vec::new(),
            },
        }),
    }
}

fn view(hub: &FleetAttentionHub) -> Arc<FleetAttentionView> {
    Arc::clone(&hub.0.sender.borrow())
}

#[test]
fn exact_identities_appear_and_resolve_while_unchanged_entries_keep_revisions() {
    let hub = hub_with(vec![stored("parent", true), stored("child", false)], None);
    let request = Uuid::new_v4();
    let mut live = HashMap::new();
    live.insert("parent".to_owned(), Some(owner(vec![request])));
    hub.publish(|| live.clone());
    let first = view(&hub);
    assert_eq!(first.revision, 1);
    let parent = &first.entries["parent"].facts;
    assert_eq!(
        parent.attention.pending,
        vec![AttentionDecision::Permission {
            request_id: request.to_string()
        }]
    );
    assert_eq!(
        parent.attention.availability.permissions,
        AttentionFacet::Available
    );
    // Settled work is observer-owned; it is unknown here, never inferred.
    assert_eq!(parent.attention.availability.work, AttentionFacet::Unknown);
    assert!(parent.attention.work.is_none());
    // A traditional child with no cached owner is unknown, never "none";
    // it never settles work or asks structured questions itself.
    let child = &first.entries["child"].facts;
    assert_eq!(
        child.attention.availability.permissions,
        AttentionFacet::Unknown
    );
    assert_eq!(
        child.attention.availability.topology,
        AttentionFacet::Available
    );
    assert_eq!(
        child.attention.availability.work,
        AttentionFacet::Unsupported
    );
    assert_eq!(
        child.attention.availability.questions,
        AttentionFacet::Unsupported
    );
    assert_eq!(child.lineage.as_ref().unwrap().parent_session_id, "parent");
    assert!(child.operation.is_none());

    // Republishing identical facts changes nothing at all.
    hub.publish(|| live.clone());
    assert_eq!(view(&hub).revision, 1);

    // Resolution removes the stale identity on the next record; the untouched
    // child keeps its entry and revision.
    live.insert("parent".to_owned(), Some(owner(Vec::new())));
    hub.publish(|| live.clone());
    let second = view(&hub);
    assert_eq!(second.revision, 2);
    assert!(second.entries["parent"].facts.attention.pending.is_empty());
    assert_eq!(second.entries["parent"].revision, 2);
    assert_eq!(second.entries["child"].revision, 1);
    let change = delta(&first, &second, None);
    assert_eq!(change.upserts.len(), 1);
    assert_eq!(change.upserts[0].0, "parent");
    assert!(change.removed.is_empty());

    // An owner leaving this process is unknown, not "nothing pending".
    live.remove("parent");
    hub.publish(|| live.clone());
    let third = view(&hub);
    let parent = &third.entries["parent"].facts;
    assert_eq!(
        parent.attention.availability.permissions,
        AttentionFacet::Unknown
    );
    assert_eq!(
        parent.attention.availability.reviews,
        AttentionFacet::Unknown
    );
    assert!(parent.operation.is_none());
}

#[test]
fn deletion_and_project_filters_are_explicit_removals() {
    let hub = hub_with(vec![stored("a", true), stored("b", true)], Some("project"));
    hub.publish(HashMap::new);
    let before = view(&hub);
    assert_eq!(delta(&before, &before, Some("project")).upserts.len(), 0);
    let other = delta(
        &FleetAttentionView {
            epoch: before.epoch,
            revision: 0,
            entries: BTreeMap::new(),
            unavailable: None,
        },
        &before,
        Some("other"),
    );
    assert!(other.upserts.is_empty());
    lock(&hub.0.store).census = Some(Arc::new(StoreCensus {
        metadata: vec![stored("a", true)],
        topology: HashMap::new(),
    }));
    hub.publish(HashMap::new);
    let after = view(&hub);
    let change = delta(&before, &after, Some("project"));
    // "a" left the project (topology now absent); "b" was deleted.
    assert_eq!(change.removed, vec!["a".to_owned(), "b".to_owned()]);
    let unfiltered = delta(&before, &after, None);
    assert_eq!(unfiltered.removed, vec!["b".to_owned()]);
    assert_eq!(unfiltered.upserts.len(), 1);
}

#[test]
fn unavailable_census_survives_live_publication_until_a_new_successful_read() {
    let hub = hub_with(vec![stored("a", true)], None);
    hub.publish(HashMap::new);
    assert_eq!(
        hub.accept_census(2, Err(FleetAttentionUnavailable::Capacity)),
        Err(FleetAttentionUnavailable::Capacity)
    );
    assert_eq!(
        view(&hub).unavailable,
        Some(FleetAttentionUnavailable::Capacity)
    );
    let revision = view(&hub).revision;
    let _ = hub.accept_census(3, Err(FleetAttentionUnavailable::Capacity));
    assert_eq!(view(&hub).revision, revision);
    hub.publish(HashMap::new);
    assert_eq!(
        view(&hub).unavailable,
        Some(FleetAttentionUnavailable::Capacity)
    );
    assert_eq!(view(&hub).revision, revision);
    hub.accept_census(
        4,
        Ok(StoreCensus {
            metadata: vec![stored("a", true)],
            topology: HashMap::new(),
        }),
    )
    .unwrap();
    hub.publish(HashMap::new);
    assert!(view(&hub).unavailable.is_none());
    assert!(view(&hub).revision > revision);
}

#[test]
fn census_success_failure_and_shutdown_share_one_ordered_frontier() {
    let hub = hub_with(vec![stored("a", true)], None);
    hub.publish(HashMap::new);
    let _ = hub.accept_census(3, Err(FleetAttentionUnavailable::Store));
    assert_eq!(
        hub.accept_census(
            2,
            Ok(StoreCensus {
                metadata: Vec::new(),
                topology: HashMap::new()
            })
        ),
        Err(FleetAttentionUnavailable::Store)
    );
    hub.publish(HashMap::new);
    assert_eq!(
        view(&hub).unavailable,
        Some(FleetAttentionUnavailable::Store)
    );
    hub.accept_census(
        5,
        Ok(StoreCensus {
            metadata: vec![stored("b", true)],
            topology: HashMap::new(),
        }),
    )
    .unwrap();
    assert_eq!(
        hub.accept_census(4, Err(FleetAttentionUnavailable::Capacity)),
        Ok(())
    );
    hub.publish(HashMap::new);
    assert!(view(&hub).unavailable.is_none());
    assert!(view(&hub).entries.contains_key("b"));
    hub.stop();
    assert_eq!(
        hub.accept_census(
            6,
            Ok(StoreCensus {
                metadata: Vec::new(),
                topology: HashMap::new()
            })
        ),
        Err(FleetAttentionUnavailable::Store)
    );
    hub.publish(HashMap::new);
    assert_eq!(
        view(&hub).unavailable,
        Some(FleetAttentionUnavailable::Store)
    );
}

#[test]
fn owner_sampling_and_publication_cannot_overtake_each_other() {
    let hub = hub_with(vec![stored("parent", true)], None);
    let request = Uuid::new_v4();
    let (sampled, entered) = std::sync::mpsc::channel();
    let (release, resume) = std::sync::mpsc::channel();
    let first = hub.clone();
    let older = std::thread::spawn(move || {
        first.publish(|| {
            sampled.send(()).unwrap();
            resume.recv().unwrap();
            HashMap::from([("parent".into(), Some(owner(vec![request])))])
        });
    });
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    let second = hub.clone();
    let (published, result) = std::sync::mpsc::channel();
    let newer = std::thread::spawn(move || {
        second.publish(|| HashMap::from([("parent".into(), Some(owner(Vec::new())))]));
        published.send(()).unwrap();
    });
    // The newer sample cannot publish between sampling and publication of the
    // older one. Once it does publish, the resolved identity stays resolved.
    assert!(result.recv_timeout(Duration::from_millis(50)).is_err());
    release.send(()).unwrap();
    older.join().unwrap();
    newer.join().unwrap();
    result.recv_timeout(Duration::from_secs(5)).unwrap();
    let final_view = view(&hub);
    assert_eq!(final_view.revision, 2);
    assert!(final_view.entries["parent"]
        .facts
        .attention
        .pending
        .is_empty());
}
