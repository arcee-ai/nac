//! Owned-store approval cancellation must remain responsive and fail closed
//! while a separate durable event is waiting for the persistence executor.
use super::*;
use crate::events::{AgentEvent, EventSink, SessionEvent, SessionEventBus};
use crate::store::coordinator::PersistenceCommand;

struct Gate {
    entered: std::sync::mpsc::Sender<()>,
    release: std::sync::mpsc::Receiver<()>,
}
impl PersistenceCommand for Gate {
    type Output = ();
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some("session-a"))
    }
    fn execute(self, _: &Path) -> anyhow::Result<()> {
        self.entered.send(())?;
        self.release.recv_timeout(Duration::from_secs(5))?;
        Ok(())
    }
}

#[tokio::test(flavor = "current_thread")]
async fn aborted_owned_approval_removes_authority_without_waiting_for_event_persistence() {
    let (path, broker) = super::tests::broker_fixture();
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let bus = SessionEventBus::with_thread_event_store(Some("session-a".into()), path.clone());
    let _interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus.clone());
    let authorization = {
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
    let request = tokio::time::timeout(Duration::from_secs(1), async {
        match events.recv().await.unwrap().event {
            SessionEvent::PermissionAsked { request } => request,
            _ => panic!("approval must be asked before cancellation"),
        }
    })
    .await
    .unwrap();
    let (entered, observed) = std::sync::mpsc::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let gate = owner
        .submit(Gate {
            entered,
            release: wait,
        })
        .unwrap();
    observed.recv_timeout(Duration::from_secs(1)).unwrap();
    let publisher = tokio::spawn(async move {
        EventSink::bus(bus)
            .emit_async(AgentEvent::ThreadStarted {
                name: "worker".into(),
                action: "wait for persistence".into(),
                source_threads: Vec::new(),
            })
            .await;
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while owner.stats().queued == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    authorization.abort();
    let error = tokio::time::timeout(Duration::from_millis(100), authorization)
        .await
        .unwrap()
        .unwrap_err();
    assert!(error.is_cancelled());
    assert!(broker.pending().is_empty());
    assert!(broker.reply(&request.id, PermissionReply::Always).is_err());
    tokio::time::sleep(Duration::from_millis(5)).await;
    assert!(!publisher.is_finished());
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    publisher.await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if matches!(
                events.recv().await.unwrap().event,
                SessionEvent::PermissionDismissed { .. }
            ) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert!(owner
        .list_permission_grants("session-a".into())
        .await
        .unwrap()
        .is_empty());
    owner.shutdown().await.unwrap();
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
