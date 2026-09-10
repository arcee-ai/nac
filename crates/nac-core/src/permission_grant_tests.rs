use super::*;

fn broker_fixture() -> (PathBuf, Arc<PermissionBroker>) {
    let path = std::env::temp_dir()
        .join(format!("nac-permission-grants-{}", uuid::Uuid::new_v4()))
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

async fn wait_for_pending(broker: &PermissionBroker) -> PermissionRequest {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Some(request) = broker.pending().into_iter().next() {
                return request;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("permission request should become pending")
}

#[tokio::test]
async fn claimed_always_reply_wins_over_later_cancellation() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let cancellation = crate::tools::ThreadCancellation::default();
    let resources = vec![
        PermissionResource::new("execute", "command:[curl][example.com]")
            .with_save_resource("command:[curl][example.com]*"),
        PermissionResource::new("read", "/outside/Cargo.toml")
            .with_save_resource("/outside/Cargo.toml"),
    ];
    let authorize = {
        let broker = Arc::clone(&broker);
        let cancellation = cancellation.clone();
        let resources = resources.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &resources,
                    &crate::tools::kernel::ToolCallContext::default(),
                    &cancellation,
                )
                .await
        })
    };
    let request = wait_for_pending(&broker).await;

    let lock = rusqlite::Connection::open(&path).unwrap();
    lock.busy_timeout(Duration::from_secs(5)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let reply = {
        let broker = Arc::clone(&broker);
        tokio::task::spawn_blocking(move || broker.reply(&request.id, PermissionReply::Always))
    };
    tokio::time::timeout(Duration::from_secs(1), async {
        while !broker.pending().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("reply must claim the pending request before persistence");
    cancellation.cancel();
    lock.execute_batch("ROLLBACK").unwrap();
    reply.await.unwrap().unwrap();

    assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
    let grants = broker.grants().unwrap();
    assert_eq!(grants.len(), 2);
    assert!(grants.iter().any(|grant| grant.action == "execute"));
    assert!(grants.iter().any(|grant| grant.action == "read"));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn abort_after_reply_claim_rolls_back_blocked_always_grant() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let authorize = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[
                        PermissionResource::new("execute", "command:[curl][example.com]")
                            .with_save_resource("command:[curl]*"),
                    ],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    let request = wait_for_pending(&broker).await;
    let lock = rusqlite::Connection::open(&path).unwrap();
    lock.busy_timeout(Duration::from_secs(5)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();

    broker.reply(&request.id, PermissionReply::Always).unwrap();
    tokio::time::sleep(Duration::from_millis(25)).await;
    authorize.abort();
    let _ = authorize.await;
    lock.execute_batch("ROLLBACK").unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(broker.grants().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn always_saves_harness_candidate_and_authorizes_headless_retry() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let resource = PermissionResource::new("execute", "command:[curl][example.com][status]")
        .with_save_resource("command:[curl][example.com]*");
    let authorize = {
        let broker = Arc::clone(&broker);
        let resource = resource.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[resource],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    let request = wait_for_pending(&broker).await;
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
    assert_eq!(broker.grants().unwrap().len(), 1);
    drop(interactive);
    assert_eq!(
        broker
            .authorize(
                "exec_command",
                &[resource],
                &crate::tools::kernel::ToolCallContext::default(),
                &crate::tools::ThreadCancellation::default(),
            )
            .await,
        AuthorizationOutcome::Allowed
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
