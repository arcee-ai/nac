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
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);

    let initial = spawn_ask(&broker, "command:[curl][before-enable.example]");
    wait_for_pending_count(&broker, 1).await;
    let initial_id = broker.pending().pop().unwrap().id;

    let (committed_tx, committed_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    let enabling = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .set_approval_mode_after_commit(
                    PermissionApprovalMode::AutoApprove,
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
