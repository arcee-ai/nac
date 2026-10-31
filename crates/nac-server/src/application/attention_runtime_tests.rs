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
    }
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
    assert_eq!(
        snapshot.availability.permissions,
        AttentionFacet::Unsupported
    );
    assert_eq!(snapshot.availability.reviews, AttentionFacet::Unsupported);
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
