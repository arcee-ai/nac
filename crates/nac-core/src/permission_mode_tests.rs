use super::*;

fn broker_fixture() -> (PathBuf, Arc<PermissionBroker>) {
    let path = std::env::temp_dir()
        .join(format!("nac-permission-mode-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    let broker = Arc::new(PermissionBroker::new(
        path.clone(),
        "session-a".to_string(),
        PermissionBackend::Local,
        0,
        [],
    ));
    (path, broker)
}

async fn wait_for_pending_count(broker: &PermissionBroker, count: usize) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while broker.pending().len() != count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("permission requests should become pending");
}

fn spawn_ask(
    broker: &Arc<PermissionBroker>,
    resource: &str,
) -> tokio::task::JoinHandle<AuthorizationOutcome> {
    let broker = Arc::clone(broker);
    let resource = resource.to_string();
    tokio::spawn(async move {
        broker
            .authorize(
                "exec_command",
                &[PermissionResource::new("execute", resource)],
                &crate::tools::kernel::ToolCallContext::default(),
                &crate::tools::ThreadCancellation::default(),
            )
            .await
    })
}

#[tokio::test]
async fn completed_disable_protects_requests_from_an_older_delayed_enable() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let mut events = bus.subscribe();
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);

    let initial = spawn_ask(&broker, "command:[curl][before-enable.example]");
    wait_for_pending_count(&broker, 1).await;
    let initial_id = broker.pending().pop().unwrap().id;
    // This test isolates process-local claim timing after a committed enable.
    // Cross-broker generation polling has separate coverage and must not race
    // the deliberately paused claim below.
    {
        let mut observer = broker.approval_observer.lock().await;
        observer.last_checked = Instant::now().checked_add(Duration::from_secs(60));
        observer.observed_generation = Some(Ok(0));
    }

    let (committed_tx, committed_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    let enabling = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .set_approval_mode_with_hooks(
                    PermissionApprovalMode::AutoApprove,
                    || async {},
                    move || async move {
                        let _ = committed_tx.send(());
                        let _ = resume_rx.await;
                    },
                )
                .await
        })
    };
    committed_rx.await.unwrap();

    broker
        .set_approval_mode(PermissionApprovalMode::Manual)
        .await
        .unwrap();
    let after_disable = spawn_ask(&broker, "command:[curl][after-disable.example]");
    wait_for_pending_count(&broker, 2).await;
    let after_disable_id = broker
        .pending()
        .into_iter()
        .find(|request| request.id != initial_id)
        .unwrap()
        .id;
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionAsked { .. }
    ));
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionApprovalModeChanged {
            mode: PermissionApprovalMode::AutoApprove
        }
    ));
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionApprovalModeChanged {
            mode: PermissionApprovalMode::Manual
        }
    ));
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionAsked { .. }
    ));

    resume_tx.send(()).unwrap();
    enabling.await.unwrap().unwrap();
    assert_eq!(initial.await.unwrap(), AuthorizationOutcome::Allowed);
    assert!(
        !after_disable.is_finished(),
        "the stale enable must not claim a request admitted after disable"
    );
    assert_eq!(
        broker
            .pending()
            .into_iter()
            .map(|request| request.id)
            .collect::<Vec<_>>(),
        vec![after_disable_id.clone()]
    );

    broker
        .reply(&after_disable_id, PermissionReply::Once)
        .unwrap();
    assert_eq!(after_disable.await.unwrap(), AuthorizationOutcome::Allowed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn delayed_enable_write_cannot_overwrite_or_emit_after_a_completed_disable() {
    let (path, owner) = broker_fixture();
    let peer = Arc::new(PermissionBroker::new(
        path.clone(),
        "session-a".to_string(),
        PermissionBackend::Local,
        0,
        [],
    ));
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let mut events = bus.subscribe();
    let _interactive = bus.subscribe_assistant_deltas();
    owner.attach_event_bus(bus.clone());
    peer.attach_event_bus(bus);

    let pending = spawn_ask(&owner, "command:[curl][delayed-write.example]");
    wait_for_pending_count(&owner, 1).await;
    let pending_id = owner.pending().pop().unwrap().id;

    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    let enabling = {
        let owner = Arc::clone(&owner);
        tokio::spawn(async move {
            owner
                .set_approval_mode_with_hooks(
                    PermissionApprovalMode::AutoApprove,
                    move || async move {
                        let _ = ready_tx.send(());
                        let _ = resume_rx.await;
                    },
                    || async {},
                )
                .await
        })
    };
    ready_rx.await.unwrap();

    peer.set_approval_mode(PermissionApprovalMode::Manual)
        .await
        .unwrap();
    resume_tx.send(()).unwrap();
    let error = enabling.await.unwrap().unwrap_err();
    assert_eq!(
        error.downcast_ref::<PermissionApprovalModeUpdateError>(),
        Some(&PermissionApprovalModeUpdateError::ConcurrentChange)
    );
    assert_eq!(
        crate::sessions::load_permission_approval_mode(&path, "session-a").unwrap(),
        PermissionApprovalMode::Manual
    );
    assert!(!pending.is_finished());
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionAsked { .. }
    ));
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionApprovalModeChanged {
            mode: PermissionApprovalMode::Manual
        }
    ));
    assert!(
        events.try_recv().is_err(),
        "the superseded enable emitted an event"
    );

    owner.reply(&pending_id, PermissionReply::Once).unwrap();
    assert_eq!(pending.await.unwrap(), AuthorizationOutcome::Allowed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn later_disable_wins_when_the_older_enable_attempts_its_write_first() {
    let (path, owner) = broker_fixture();
    let peer = Arc::new(PermissionBroker::new(
        path.clone(),
        "session-a".to_string(),
        PermissionBackend::Local,
        0,
        [],
    ));
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let mut events = bus.subscribe();
    let _interactive = bus.subscribe_assistant_deltas();
    owner.attach_event_bus(bus.clone());
    peer.attach_event_bus(bus);

    let pending = spawn_ask(&owner, "command:[curl][reverse-write-order.example]");
    wait_for_pending_count(&owner, 1).await;
    let pending_id = owner.pending().pop().unwrap().id;

    let (enable_ready_tx, enable_ready_rx) = tokio::sync::oneshot::channel();
    let (enable_go_tx, enable_go_rx) = tokio::sync::oneshot::channel();
    let enabling = {
        let owner = Arc::clone(&owner);
        tokio::spawn(async move {
            owner
                .set_approval_mode_with_hooks(
                    PermissionApprovalMode::AutoApprove,
                    move || async move {
                        let _ = enable_ready_tx.send(());
                        let _ = enable_go_rx.await;
                    },
                    || async {},
                )
                .await
        })
    };
    enable_ready_rx.await.unwrap();

    let (disable_ready_tx, disable_ready_rx) = tokio::sync::oneshot::channel();
    let (disable_go_tx, disable_go_rx) = tokio::sync::oneshot::channel();
    let disabling = {
        let peer = Arc::clone(&peer);
        tokio::spawn(async move {
            peer.set_approval_mode_with_hooks(
                PermissionApprovalMode::Manual,
                move || async move {
                    let _ = disable_ready_tx.send(());
                    let _ = disable_go_rx.await;
                },
                || async {},
            )
            .await
        })
    };
    disable_ready_rx.await.unwrap();

    enable_go_tx.send(()).unwrap();
    assert!(enabling.await.unwrap().is_err());
    assert!(
        !pending.is_finished(),
        "the superseded enable claimed a waiter"
    );
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionAsked { .. }
    ));
    assert!(
        events.try_recv().is_err(),
        "the superseded enable emitted an event"
    );

    disable_go_tx.send(()).unwrap();
    disabling.await.unwrap().unwrap();
    assert_eq!(
        crate::sessions::load_permission_approval_mode(&path, "session-a").unwrap(),
        PermissionApprovalMode::Manual
    );
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionApprovalModeChanged {
            mode: PermissionApprovalMode::Manual
        }
    ));
    assert!(events.try_recv().is_err());
    assert!(!pending.is_finished());

    owner.reply(&pending_id, PermissionReply::Once).unwrap();
    assert_eq!(pending.await.unwrap(), AuthorizationOutcome::Allowed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn transient_mode_observation_failure_does_not_dismiss_shared_waiters() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let first = spawn_ask(&broker, "command:[curl][first-transient.example]");
    let second = spawn_ask(&broker, "command:[curl][second-transient.example]");
    wait_for_pending_count(&broker, 2).await;

    {
        let mut observer = broker.approval_observer.lock().await;
        observer.last_checked = Instant::now().checked_add(Duration::from_secs(60));
        observer.observed_generation = Some(Err("injected transient read failure".to_string()));
    }
    tokio::time::sleep(APPROVAL_MODE_POLL_INTERVAL * 3).await;
    assert_eq!(broker.pending().len(), 2);
    assert!(!first.is_finished());
    assert!(!second.is_finished());

    broker
        .set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    assert_eq!(first.await.unwrap(), AuthorizationOutcome::Allowed);
    assert_eq!(second.await.unwrap(), AuthorizationOutcome::Allowed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
