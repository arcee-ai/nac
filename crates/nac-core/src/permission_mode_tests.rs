use super::*;

fn broker_fixture() -> (PathBuf, Arc<PermissionBroker>) {
    let path = std::env::temp_dir()
        .join(format!("nac-permission-mode-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'session-a'",
            [],
        )
        .unwrap();
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

fn insert_direct_session(path: &Path, session_id: &str, behavior: &str) {
    crate::store::insert_test_session(path, session_id);
    crate::store::open_runtime_connection(path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = ?1 WHERE session_id = ?2",
            rusqlite::params![behavior, session_id],
        )
        .unwrap();
}

fn child_broker(path: &Path, session_id: &str) -> Arc<PermissionBroker> {
    Arc::new(PermissionBroker::new(
        path.to_path_buf(),
        session_id.to_string(),
        PermissionBackend::Local,
        0,
        [],
    ))
}

#[tokio::test]
async fn root_mode_governs_existing_future_and_durable_nested_children() {
    let (path, root) = broker_fixture();
    insert_direct_session(&path, "existing-child", "direct");
    crate::store::create_traditional_child_relationship(
        &path,
        "session-a",
        "existing-child",
        crate::store::GENERAL_CHILD_PROFILE,
        "existing child",
    )
    .unwrap();
    let existing = child_broker(&path, "existing-child");
    assert_eq!(
        existing.approval_mode().await.unwrap(),
        PermissionApprovalMode::Manual
    );

    root.set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    assert_eq!(
        existing.approval_mode().await.unwrap(),
        PermissionApprovalMode::AutoApprove
    );

    insert_direct_session(&path, "future-child", "direct");
    crate::store::create_traditional_child_relationship(
        &path,
        "session-a",
        "future-child",
        crate::store::GENERAL_CHILD_PROFILE,
        "future child",
    )
    .unwrap();
    let future = child_broker(&path, "future-child");
    assert_eq!(
        future.approval_mode().await.unwrap(),
        PermissionApprovalMode::AutoApprove
    );

    // The current product limits launches to depth one, but root_session_id is
    // already the durable ownership contract. Seed a deeper compatible record
    // to prove the policy lookup does not accidentally stop at the immediate
    // parent when that launch limit changes.
    insert_direct_session(&path, "nested-child", "direct");
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "INSERT INTO traditional_children
             (child_session_id, parent_session_id, root_session_id, profile,
              description, nesting_depth, created_at, updated_at)
             VALUES ('nested-child', 'existing-child', 'session-a', 'general',
                     'nested child', 1, 'now', 'now')",
            [],
        )
        .unwrap();
    let nested = child_broker(&path, "nested-child");
    assert_eq!(
        nested.approval_mode().await.unwrap(),
        PermissionApprovalMode::AutoApprove
    );

    let restarted = child_broker(&path, "existing-child");
    assert_eq!(
        restarted.approval_mode().await.unwrap(),
        PermissionApprovalMode::AutoApprove
    );

    root.set_approval_mode(PermissionApprovalMode::Manual)
        .await
        .unwrap();
    for broker in [&existing, &future, &nested, &restarted] {
        assert_eq!(
            broker.approval_mode().await.unwrap(),
            PermissionApprovalMode::Manual
        );
    }
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn enabling_root_drains_pending_child_and_completed_disable_is_immediate() {
    let (path, root) = broker_fixture();
    insert_direct_session(&path, "child", "direct");
    crate::store::create_traditional_child_relationship(
        &path,
        "session-a",
        "child",
        crate::store::GENERAL_CHILD_PROFILE,
        "pending child",
    )
    .unwrap();
    let child = child_broker(&path, "child");
    let bus = crate::events::SessionEventBus::new(Some("child".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    child.attach_event_bus(bus);

    let pending = spawn_ask(&child, "command:[curl][pending-child.example]");
    wait_for_pending_count(&child, 1).await;
    root.set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .expect("root enable should drain a descendant waiter")
            .unwrap(),
        AuthorizationOutcome::Allowed
    );

    root.set_approval_mode(PermissionApprovalMode::Manual)
        .await
        .unwrap();
    let manual = spawn_ask(&child, "command:[curl][after-disable.example]");
    wait_for_pending_count(&child, 1).await;
    assert!(!manual.is_finished());
    let request_id = child.pending().pop().unwrap().id;
    child.reply(&request_id, PermissionReply::Once).unwrap();
    assert_eq!(manual.await.unwrap(), AuthorizationOutcome::Allowed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn child_created_during_root_enable_observes_the_same_transition() {
    let (path, root) = broker_fixture();
    let (reserved_tx, reserved_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    let enabling = {
        let root = Arc::clone(&root);
        tokio::spawn(async move {
            root.set_approval_mode_with_hooks(
                PermissionApprovalMode::AutoApprove,
                move || async move {
                    let _ = reserved_tx.send(());
                    let _ = resume_rx.await;
                },
                || async {},
            )
            .await
        })
    };
    reserved_rx.await.unwrap();

    insert_direct_session(&path, "concurrent-child", "direct");
    crate::store::create_traditional_child_relationship(
        &path,
        "session-a",
        "concurrent-child",
        crate::store::GENERAL_CHILD_PROFILE,
        "concurrent child",
    )
    .unwrap();
    let child = child_broker(&path, "concurrent-child");
    let bus = crate::events::SessionEventBus::new(Some("concurrent-child".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    child.attach_event_bus(bus);
    let authorization = spawn_ask(&child, "command:[curl][concurrent-child.example]");
    wait_for_pending_count(&child, 1).await;

    resume_tx.send(()).unwrap();
    enabling.await.unwrap().unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), authorization)
            .await
            .expect("new descendant should observe the committed root generation")
            .unwrap(),
        AuthorizationOutcome::Allowed
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn direct_with_orchestrator_root_covers_children_but_not_managed_orchestrators() {
    let (path, root) = broker_fixture();
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct-with-orchestrator'
             WHERE session_id = 'session-a'",
            [],
        )
        .unwrap();
    insert_direct_session(&path, "child", "direct");
    insert_direct_session(&path, "managed", "orchestrator");
    crate::store::create_traditional_child_relationship(
        &path,
        "session-a",
        "child",
        crate::store::GENERAL_CHILD_PROFILE,
        "traditional child",
    )
    .unwrap();
    crate::store::create_managed_orchestrator_relationship(
        &path,
        "session-a",
        "managed",
        "managed orchestrator",
    )
    .unwrap();
    root.set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();

    let child = Arc::new(PermissionBroker::new(
        path.clone(),
        "child".to_string(),
        PermissionBackend::Local,
        0,
        [PermissionRule::new(
            "execute",
            "command:[blocked]*",
            PermissionEffect::Deny,
        )],
    ));
    assert_eq!(
        child.approval_mode().await.unwrap(),
        PermissionApprovalMode::AutoApprove
    );
    assert_eq!(
        child
            .authorize(
                "exec_command",
                &[PermissionResource::new(
                    "execute",
                    "command:[blocked][still-denied]",
                )],
                &crate::tools::kernel::ToolCallContext::default(),
                &crate::tools::ThreadCancellation::default(),
            )
            .await,
        AuthorizationOutcome::Denied("configured permission rules deny exec_command".to_string())
    );
    assert_eq!(
        child
            .authorize(
                "edit",
                &[PermissionResource::new("edit", "/workspace/.git/config")
                    .with_hard_denial("protected target")],
                &crate::tools::kernel::ToolCallContext::default(),
                &crate::tools::ThreadCancellation::default(),
            )
            .await,
        AuthorizationOutcome::Denied("protected target".to_string())
    );
    assert!(child.grants().unwrap().is_empty());

    let managed = child_broker(&path, "managed");
    assert_eq!(
        managed.approval_mode().await.unwrap(),
        PermissionApprovalMode::Manual,
        "managed orchestrators are a separate durable topology"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
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
