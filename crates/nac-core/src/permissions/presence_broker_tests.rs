//! Approval waits for a connected app, never answers through it, and still
//! fails closed once no client remains.
use super::*;
use crate::events::SessionEventBus;
use crate::tools::{kernel::ToolCallContext, RunCancellation};

fn ask(broker: &Arc<PermissionBroker>) -> tokio::task::JoinHandle<AuthorizationOutcome> {
    let broker = Arc::clone(broker);
    tokio::spawn(async move {
        broker
            .authorize(
                "exec_command",
                &[PermissionResource::new(
                    "execute",
                    "command:[curl][example.com]",
                )],
                &ToolCallContext::default(),
                &RunCancellation::default(),
            )
            .await
    })
}

async fn pending(broker: &PermissionBroker, count: usize) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while broker.pending().len() != count {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn ask_waits_while_the_app_is_connected_and_only_a_reply_answers_it() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    // The session itself is not open anywhere: no interactive subscriber.
    let bus = SessionEventBus::new(Some("session-a".into()));
    broker.attach_event_bus(bus.clone());
    let app = InteractivePresence::enter(&path);
    let request = ask(&broker);
    pending(&broker, 1).await;
    assert!(!bus.has_interactive_subscribers());
    // Presence keeps it waiting; it never answers.
    tokio::time::sleep(APPROVAL_SUBSCRIBER_POLL_INTERVAL * 4).await;
    assert!(!request.is_finished());
    assert!(broker.grants().unwrap().is_empty());
    let id = broker.pending()[0].id.clone();
    broker.reply(&id, PermissionReply::Once).unwrap();
    assert!(matches!(
        request.await.unwrap(),
        AuthorizationOutcome::Allowed
    ));
    drop(app);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn pending_ask_is_denied_when_the_last_app_client_leaves() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    broker.attach_event_bus(SessionEventBus::new(Some("session-a".into())));
    let app = InteractivePresence::enter(&path);
    let request = ask(&broker);
    pending(&broker, 1).await;
    drop(app);
    assert!(matches!(
        request.await.unwrap(),
        AuthorizationOutcome::Denied(reason) if reason.contains("disconnected while approval was pending")
    ));
    assert!(broker.pending().is_empty());
    assert!(broker.grants().unwrap().is_empty());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn presence_for_another_store_leaves_headless_ask_failing_closed() {
    let (path, broker) = crate::permissions::tests::broker_fixture();
    broker.attach_event_bus(SessionEventBus::new(Some("session-a".into())));
    let (other, _) = crate::permissions::tests::broker_fixture();
    let elsewhere = InteractivePresence::enter(&other);
    assert!(matches!(
        ask(&broker).await.unwrap(),
        AuthorizationOutcome::Denied(reason) if reason.contains("no interactive session client is connected")
    ));
    assert!(broker.pending().is_empty());
    drop(elsewhere);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    std::fs::remove_dir_all(other.parent().unwrap()).unwrap();
}
