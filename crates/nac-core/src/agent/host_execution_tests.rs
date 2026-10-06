use super::transcript_log_tests::{fenced_prompt_agent, read_log, user_message};
use super::*;

#[tokio::test]
async fn host_execution_prompt_waiting_on_owned_store_is_denied_before_durable_append() {
    use crate::store::coordinator::{PersistenceCommand, StoreCoordinator};
    struct Block {
        entered: std::sync::mpsc::SyncSender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl PersistenceCommand for Block {
        type Output = ();
        fn correlation(&self) -> crate::telemetry::Correlation {
            crate::telemetry::Correlation::session(Some("session"))
        }
        fn execute(self, _: &std::path::Path) -> anyhow::Result<()> {
            self.entered.send(())?;
            self.release.recv()?;
            Ok(())
        }
    }
    let fixture = crate::model::host_execution_test_support::Fixture::new();
    let path = fixture.root.join("prompt-store.db");
    let (mut agent, lease) = fenced_prompt_agent(&path);
    agent.tool_runtime.host_execution_authority = Some(fixture.authority.clone());
    agent.begin_run_cancellation();
    let before = agent.messages.clone();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let blocked = owner
        .submit(Block {
            entered: entered_tx,
            release: release_rx,
        })
        .unwrap();
    tokio::task::spawn_blocking(move || entered_rx.recv().unwrap())
        .await
        .unwrap();
    let append = tokio::spawn(async move {
        let result = agent
            .push_and_log_run_prompt(
                user_message("denied queued prompt"),
                &SessionRunId::from_stored("prompt-run".into()),
                None,
            )
            .await;
        (agent, result)
    });
    tokio::time::timeout(Duration::from_secs(3), async {
        while owner.stats().queued == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    fixture.remove();
    release_tx.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    let (agent, result) = tokio::time::timeout(Duration::from_secs(3), append)
        .await
        .unwrap()
        .unwrap();
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("denied before durable commit"));
    assert_eq!(
        serde_json::to_value(&agent.messages).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    assert!(!agent.steering_append_pending);
    owner.shutdown().await.unwrap();
    drop(owner);
    assert!(read_log(&path, "session").is_empty());
    drop(lease);
}
