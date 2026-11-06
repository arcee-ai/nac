use super::*;
fn live() -> Arc<Live> {
    let runtime = Arc::new(Mutex::new(RuntimeState::default()));
    Arc::new(Live {
        hub: AttentionHub::new(Uuid::new_v4(), AttentionLimits::default()).unwrap(),
        limits: AttentionLimits::default(),
        state: Mutex::new(Projection {
            sources: BTreeMap::new(),
            dirty: BTreeSet::new(),
            generation: 0,
            closed: false,
        }),
        wake: Notify::new(),
        history: watch::channel(Some(0)).0,
        task: Mutex::new(None),
        _permit: Arc::new(Permit {
            runtime,
            token: Uuid::new_v4(),
        }),
    })
}
fn row() -> AttentionStoredSession {
    AttentionStoredSession {
        id: "session".into(),
        primary: true,
        direct: true,
        questions_supported: true,
        goal: None,
        question: None,
        inbox_pending: false,
        manual_unsettled: false,
        config_version: 0,
        last_outcome: None,
        recovery_pending: false,
    }
}

#[tokio::test]
async fn broker_owner_handoff_does_not_reannounce_observed_completion() {
    let live = live();
    let token = Uuid::new_v4();
    let mut stored = row();
    let goal = AttentionGoal {
        id: "goal".into(),
        version: 1,
    };
    stored.goal = Some(nac_core::store::AttentionStoredGoal {
        identity: goal.clone(),
        status: nac_core::store::GoalStatus::Complete,
        accounting_run: None,
        continuation_run: None,
        retry_scheduled: false,
        last_run: Some("run-a".into()),
    });
    let snapshot = AttentionServiceSnapshot {
        epoch: Uuid::new_v4(),
        revision: 1,
        operation: AttentionOperation::Idle,
        settled: Some(SettledWork {
            run_id: "run-a".into(),
            goal: Some(goal),
            disposition: SettledWorkDisposition::Completed,
        }),
        broker: Some(AttentionBrokerSnapshot {
            owner: Uuid::new_v4(),
            revision: 0,
            state: AttentionBrokerState::Current {
                permissions: vec![],
                authorizable_reviews: vec![],
            },
        }),
    };
    let initial_epoch = {
        let mut state = live.state.lock().unwrap();
        let source = live.source(&mut state, "session").unwrap();
        source.stored = Some(stored.clone());
        source.service = Some(snapshot.clone());
        source.binding = Some(Binding {
            service: Weak::new(),
            token,
            registration: None,
            installing: false,
            config_version: Some(0),
        });
        let baseline = normalized("session", source).unwrap();
        source.published = Some(baseline.clone());
        source.published_broker = snapshot.broker.as_ref().map(|broker| broker.owner);
        assert_eq!(
            live.hub.rebaseline(live.hub.boundary(), vec![baseline]),
            AttentionApply::Applied
        );
        source.epoch
    };
    let mut subscription = live.hub.subscribe(None).unwrap();
    let sink = Sink {
        live: Arc::downgrade(&live),
        token,
    };
    let mut handoff = snapshot;
    handoff.revision += 1;
    let mut broker = handoff.broker.take().unwrap();
    broker.owner = Uuid::new_v4();
    // A new broker first rejects the previous broker's registration. Its
    // unknown interval must not erase the already observed completion either.
    sink.service_changed("session", handoff.clone());
    let generation = live.state.lock().unwrap().sources["session"].generation;
    live.apply("session", generation, vec![stored.clone()])
        .unwrap();
    let AttentionRead::Record(unknown) = subscription.next().await else {
        panic!("unknown handoff")
    };
    assert!(!unknown.new_attention);
    assert_eq!(
        live.state.lock().unwrap().sources["session"]
            .published
            .as_ref()
            .unwrap()
            .availability
            .permissions,
        AttentionFacet::Unknown
    );
    handoff.revision += 1;
    handoff.broker = Some(broker);
    // Exercise the registered callback, its source-epoch transition, the
    // canonical read generation and projection, rather than only the hub.
    sink.service_changed("session", handoff.clone());
    let generation = {
        let state = live.state.lock().unwrap();
        assert_ne!(state.sources["session"].epoch, initial_epoch);
        state.sources["session"].generation
    };
    live.apply("session", generation, vec![stored.clone()])
        .unwrap();
    for _ in 0..3 {
        let AttentionRead::Record(record) = subscription.next().await else {
            panic!("handoff record")
        };
        assert!(
            !record.new_attention,
            "a source handoff cannot re-announce run-a: {record:?}"
        );
    }
    // A stale registration cannot publish, while a genuinely new completion
    // from the current broker remains eligible for attention.
    let boundary = live.hub.boundary();
    Sink {
        live: Arc::downgrade(&live),
        token: Uuid::new_v4(),
    }
    .service_changed("session", handoff.clone());
    assert_eq!(live.hub.boundary(), boundary);
    handoff.revision += 1;
    handoff.settled.as_mut().unwrap().run_id = "run-b".into();
    stored.goal.as_mut().unwrap().last_run = Some("run-b".into());
    sink.service_changed("session", handoff);
    let generation = live.state.lock().unwrap().sources["session"].generation;
    live.apply("session", generation, vec![stored]).unwrap();
    let AttentionRead::Record(record) = subscription.next().await else {
        panic!("new completion")
    };
    assert!(record.new_attention);
    assert!(
        matches!(&record.change, AttentionRecordChange::Fact(AttentionChange::WorkSettled(work)) if work.run_id == "run-b")
    );
}
#[test]
fn stale_read_cannot_clear_question_after_newer_dirty_hint_or_owner_handoff() {
    let live = live();
    {
        let mut state = live.state.lock().unwrap();
        live.dirty(&mut state, "session");
        let source = state.sources.get_mut("session").unwrap();
        let mut current = row();
        current.question = Some(AttentionDecision::Question {
            request_id: "q".into(),
            run_id: "run".into(),
            generation: "generation".into(),
            revision: 1,
        });
        source.stored = Some(current);
    }
    let ticket = live.state.lock().unwrap().sources["session"].generation;
    {
        let mut state = live.state.lock().unwrap();
        live.dirty(&mut state, "session");
    }
    live.apply("session", ticket, vec![row()]).unwrap();
    assert!(live.state.lock().unwrap().sources["session"]
        .stored
        .as_ref()
        .unwrap()
        .question
        .is_some());
    assert!(live.state.lock().unwrap().dirty.contains("session"));
}
#[test]
fn completion_requires_exact_current_goal_receipt_and_full_supported_metadata() {
    let mut source = Source::new();
    let mut stored = row();
    let identity = AttentionGoal {
        id: "goal".into(),
        version: 7,
    };
    stored.goal = Some(nac_core::store::AttentionStoredGoal {
        identity: identity.clone(),
        status: nac_core::store::GoalStatus::Complete,
        accounting_run: None,
        continuation_run: None,
        retry_scheduled: false,
        last_run: Some("run".into()),
    });
    source.service = Some(AttentionServiceSnapshot {
        broker: Some(AttentionBrokerSnapshot {
            owner: Uuid::new_v4(),
            revision: 0,
            state: AttentionBrokerState::Current {
                permissions: vec![],
                authorizable_reviews: vec![],
            },
        }),
        epoch: Uuid::new_v4(),
        revision: 2,
        operation: AttentionOperation::Idle,
        settled: Some(SettledWork {
            run_id: "run".into(),
            goal: Some(identity),
            disposition: SettledWorkDisposition::Completed,
        }),
    });
    source.stored = Some(stored);
    assert!(normalized("session", &source).unwrap().work.is_some());
    let broker = source.service.as_mut().unwrap().broker.take();
    let absent = normalized("session", &source).unwrap();
    assert!(
        absent.work.is_none(),
        "missing decision evidence cannot strengthen completion"
    );
    assert_eq!(absent.availability.permissions, AttentionFacet::Unknown);
    source.service.as_mut().unwrap().broker = broker;
    source
        .stored
        .as_mut()
        .unwrap()
        .goal
        .as_mut()
        .unwrap()
        .identity
        .version += 1;
    let snapshot = normalized("session", &source).unwrap();
    assert!(snapshot.work.is_none());
    assert_eq!(snapshot.availability.work, AttentionFacet::Unknown);
    assert_eq!(snapshot.availability.permissions, AttentionFacet::Available);
    assert_eq!(snapshot.availability.reviews, AttentionFacet::Available);
}

#[test]
fn attention_goal_free_normalization_requires_current_exact_outcome_and_every_existing_guard() {
    for invalid in [
        "valid",
        "missing",
        "newer",
        "failed",
        "cancelled",
        "config",
        "recovery",
        "manual",
        "inbox",
        "goal",
        "question",
        "topology",
        "backend",
        "broker",
        "permission",
        "review",
        "owner",
        "active",
    ] {
        let mut source = Source::new();
        let mut stored = row();
        stored.last_outcome = Some(nac_core::store::AttentionStoredRun {
            run_id: "run".into(),
            disposition: nac_core::store::RunOutcomeDisposition::Completed,
        });
        source.binding = Some(Binding {
            service: Weak::new(),
            token: Uuid::new_v4(),
            registration: None,
            installing: false,
            config_version: Some(0),
        });
        let mut service = AttentionServiceSnapshot {
            epoch: Uuid::new_v4(),
            revision: 1,
            operation: AttentionOperation::Idle,
            settled: Some(SettledWork {
                run_id: "run".into(),
                goal: None,
                disposition: SettledWorkDisposition::Completed,
            }),
            broker: Some(AttentionBrokerSnapshot {
                owner: Uuid::new_v4(),
                revision: 0,
                state: AttentionBrokerState::Current {
                    permissions: vec![],
                    authorizable_reviews: vec![],
                },
            }),
        };
        match invalid {
            "missing" => stored.last_outcome = None,
            "newer" => stored.last_outcome.as_mut().unwrap().run_id = "newer".into(),
            "failed" => {
                stored.last_outcome.as_mut().unwrap().disposition =
                    nac_core::store::RunOutcomeDisposition::Failed
            }
            "cancelled" => {
                stored.last_outcome.as_mut().unwrap().disposition =
                    nac_core::store::RunOutcomeDisposition::Cancelled
            }
            "config" => stored.config_version = 1,
            "recovery" => stored.recovery_pending = true,
            "manual" => stored.manual_unsettled = true,
            "inbox" => stored.inbox_pending = true,
            "goal" => {
                stored.goal = Some(nac_core::store::AttentionStoredGoal {
                    identity: AttentionGoal {
                        id: "goal".into(),
                        version: 0,
                    },
                    status: nac_core::store::GoalStatus::Complete,
                    accounting_run: None,
                    continuation_run: None,
                    retry_scheduled: false,
                    last_run: Some("run".into()),
                })
            }
            "question" => {
                stored.question = Some(AttentionDecision::Question {
                    request_id: "question".into(),
                    run_id: "run".into(),
                    generation: "generation".into(),
                    revision: 1,
                })
            }
            "topology" => stored.primary = false,
            "backend" => stored.questions_supported = false,
            "broker" => service.broker = None,
            "permission" | "review" => {
                service.broker.as_mut().unwrap().state = AttentionBrokerState::Current {
                    permissions: if invalid == "permission" {
                        vec![Uuid::new_v4()]
                    } else {
                        vec![]
                    },
                    authorizable_reviews: if invalid == "review" {
                        vec![Uuid::new_v4()]
                    } else {
                        vec![]
                    },
                }
            }
            "owner" => service.settled = None,
            "active" => service.operation = AttentionOperation::Run("newer".into()),
            "valid" => {}
            _ => unreachable!(),
        }
        source.stored = Some(stored);
        source.service = Some(service);
        let normalized = normalized("session", &source).unwrap();
        assert_eq!(normalized.work.is_some(), invalid == "valid", "{invalid}");
        assert_eq!(
            normalized.availability.work == AttentionFacet::Available,
            invalid == "valid",
            "{invalid}"
        );
    }
}
#[test]
fn source_count_dirty_set_and_actual_permit_are_bounded() {
    let live = live();
    let mut state = live.state.lock().unwrap();
    for index in 0..ATTENTION_SOURCE_LIMIT {
        live.dirty(&mut state, &format!("session-{index}"));
    }
    assert!(!state.closed);
    live.dirty(&mut state, "overflow");
    assert!(state.closed);
    assert_eq!(state.sources.len(), ATTENTION_SOURCE_LIMIT);
    assert_eq!(state.dirty.len(), ATTENTION_SOURCE_LIMIT);
    drop(state);
    let runtime = Arc::new(Mutex::new(RuntimeState::default()));
    let token = Uuid::new_v4();
    runtime.lock().unwrap().seat = Some(token);
    let permit = Arc::new(Permit {
        runtime: runtime.clone(),
        token,
    });
    let retired = permit.clone();
    drop(permit);
    assert_eq!(runtime.lock().unwrap().seat, Some(token));
    drop(retired);
    assert!(runtime.lock().unwrap().seat.is_none());
}

#[tokio::test]
async fn handoff_keeps_old_question_silent_but_announces_a_question_committed_during_install() {
    for existing_question in [false, true] {
        let live = live();
        let mut source = Source::new();
        let mut stored = row();
        let decision = AttentionDecision::Question {
            request_id: "question".into(),
            run_id: "run".into(),
            generation: "generation".into(),
            revision: 1,
        };
        if existing_question {
            stored.question = Some(decision.clone());
        }
        source.stored = Some(stored);
        let baseline = normalized("session", &source).unwrap();
        source.published = Some(baseline.clone());
        assert_eq!(
            live.hub.rebaseline(live.hub.boundary(), vec![baseline]),
            AttentionApply::Applied
        );
        let mut subscription = live.hub.subscribe(None).unwrap();
        source.epoch = Uuid::new_v4();
        source.stored.as_mut().unwrap().question = Some(decision);
        let next = normalized("session", &source).unwrap();
        publish(&live.hub, &mut source, next).unwrap();
        let AttentionRead::Record(handoff) = subscription.next().await else {
            panic!("handoff record");
        };
        assert!(!handoff.new_attention);
        if !existing_question {
            let AttentionRead::Record(pending) = subscription.next().await else {
                panic!("pending record");
            };
            assert!(pending.new_attention);
            assert_eq!(pending.source_revision, 1);
        } else {
            assert!(
                tokio::time::timeout(Duration::from_millis(10), subscription.next())
                    .await
                    .is_err()
            );
        }
    }
}

#[tokio::test]
async fn real_bootstrap_reservation_cancellation_and_retired_stream_hold_one_physical_seat() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-attention-bootstrap-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = crate::tests::test_manager(&root);
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let gate = Arc::new(BootstrapGate::default());
    manager.inner.attention.0.lock().unwrap().bootstrap_gate = Some(gate.clone());
    let opening = manager.clone();
    let task =
        tokio::spawn(async move { opening.inner.attention.open(opening.clone(), None).await });
    gate.reached.notified().await;
    assert!(matches!(
        manager.inner.attention.open(manager.clone(), None).await,
        Err(AttentionSubscribeError::Busy)
    ));
    task.abort();
    assert!(matches!(task.await,Err(error) if error.is_cancelled()));
    assert!(manager.inner.attention.0.lock().unwrap().seat.is_none());
    manager.inner.attention.0.lock().unwrap().bootstrap_gate = None;
    let mut subscription = manager
        .inner
        .attention
        .open(manager.clone(), None)
        .await
        .unwrap();
    let live = manager
        .inner
        .attention
        .0
        .lock()
        .unwrap()
        .live
        .upgrade()
        .unwrap();
    live.close();
    assert!(matches!(
        manager.inner.attention.open(manager.clone(), None).await,
        Err(AttentionSubscribeError::Busy)
    ));
    assert!(matches!(
        subscription.subscription.next().await,
        AttentionRead::Reset(_)
    ));
    drop(subscription);
    drop(live);
    // JoinHandle abortion drops the actual reader before releasing its permit.
    for _ in 0..100 {
        if manager.inner.attention.0.lock().unwrap().seat.is_none() {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(manager.inner.attention.0.lock().unwrap().seat.is_none());
    let replacement = manager
        .inner
        .attention
        .open(manager.clone(), None)
        .await
        .unwrap();
    drop(replacement);
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_between_reservation_and_live_publication_rejects_observation() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-attention-activation-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = crate::tests::test_manager(&root);
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let gate = Arc::new(BootstrapGate::default());
    manager.inner.attention.0.lock().unwrap().activation_gate = Some(gate.clone());
    let opening = manager.clone();
    let task =
        tokio::spawn(async move { opening.inner.attention.open(opening.clone(), None).await });
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    manager.inner.attention.stop();
    gate.resume.notify_one();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap(),
        Err(AttentionSubscribeError::Unavailable(
            AttentionUnavailable::Reset
        ))
    ));
    {
        let state = manager.inner.attention.0.lock().unwrap();
        assert!(state.live.upgrade().is_none());
        assert!(state.seat.is_none());
    }
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_owned_read_keeps_its_physical_seat_until_the_accepted_caller_finishes() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-attention-owned-read-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let (release, receive) = std::sync::mpsc::channel();
    let gate = Arc::new(ReadGate {
        reached: Notify::new(),
        release: Mutex::new(receive),
    });
    manager.inner.attention.0.lock().unwrap().read_gate = Some(gate.clone());
    let opening = manager.clone();
    let task =
        tokio::spawn(async move { opening.inner.attention.open(opening.clone(), None).await });
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    task.abort();
    assert!(matches!(task.await,Err(error) if error.is_cancelled()));
    assert!(matches!(
        manager.inner.attention.open(manager.clone(), None).await,
        Err(AttentionSubscribeError::Busy)
    ));
    manager.inner.attention.0.lock().unwrap().read_gate = None;
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.inner.attention.0.lock().unwrap().seat.is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let replacement = manager
        .inner
        .attention
        .open(manager.clone(), None)
        .await
        .unwrap();
    drop(replacement);
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[path = "attention_scope_tests.rs"]
mod scope;

#[path = "attention_decision_tests.rs"]
mod decisions;

#[path = "attention_installation_tests.rs"]
mod installation;
