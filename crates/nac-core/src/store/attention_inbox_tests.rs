use super::*;
use crate::store::coordinator::PersistenceCommand;
use std::sync::{mpsc, Arc};
use tokio::sync::Notify;

struct Control(&'static str);
impl PersistenceCommand for Control {
    type Output = ();
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        open_runtime_connection(path)?.execute_batch(self.0)?;
        Ok(())
    }
}
struct CommitThenWait {
    cancel: Option<(i64, i64)>,
    reached: Arc<Notify>,
    release: mpsc::Receiver<()>,
}
impl PersistenceCommand for CommitThenWait {
    type Output = SessionInboxRecord;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        let item = if let Some((id, version)) = self.cancel {
            cancel_pending_session_inbox_item(path, "session", id, version)?
        } else {
            create_session_inbox_item(
                path,
                "session",
                InboxDelivery::Queue,
                "private queued content",
                None,
                None,
            )?
        };
        self.reached.notify_one();
        let _ = self.release.recv();
        Ok(item)
    }
}
async fn control(owner: &StoreCoordinator, sql: &'static str) {
    owner
        .submit(Control(sql))
        .unwrap()
        .acknowledge()
        .await
        .unwrap();
}
async fn close(
    path: PathBuf,
    owner: Arc<StoreCoordinator>,
    observation: AttentionStoreObservation,
) {
    owner.shutdown().await.unwrap();
    drop(owner);
    drop(observation);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_inbox_constraint_and_load_after_autocommit_keep_real_effects() {
    let path = fixture();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
    control(&owner, "CREATE TRIGGER reject_inbox BEFORE INSERT ON session_inbox BEGIN SELECT RAISE(ABORT,'insert rollback'); END;").await;
    assert!(owner
        .create_session_inbox_item(
            "session".into(),
            InboxDelivery::Queue,
            "work".into(),
            None,
            None
        )
        .await
        .is_err());
    assert_eq!(observation.try_changed().unwrap(), None);
    assert!(
        !owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .inbox_pending
    );
    control(&owner, "DROP TRIGGER reject_inbox; CREATE TRIGGER fail_inbox_load AFTER INSERT ON session_inbox BEGIN UPDATE session_inbox SET client_id=x'ff' WHERE id=NEW.id; END;").await;
    assert!(owner
        .create_session_inbox_item(
            "session".into(),
            InboxDelivery::Queue,
            "work".into(),
            None,
            None
        )
        .await
        .is_err());
    assert_eq!(
        observation.try_changed().unwrap().as_deref(),
        Some("session")
    );
    assert!(
        owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .inbox_pending,
        "the real autocommit survives a later row-load failure"
    );
    control(
        &owner,
        "DROP TRIGGER fail_inbox_load; UPDATE session_inbox SET client_id=NULL;",
    )
    .await;
    let item = owner
        .list_session_inbox("session".into())
        .await
        .unwrap()
        .remove(0);
    let updated = owner
        .update_pending_session_inbox_item(
            "session".into(),
            item.id,
            item.version,
            InboxDelivery::Steer,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        observation.try_changed().unwrap(),
        None,
        "pending edits do not change attention metadata"
    );
    assert!(owner
        .cancel_pending_session_inbox_item("session".into(), item.id, item.version)
        .await
        .is_err());
    assert_eq!(observation.try_changed().unwrap(), None);
    control(&owner, "CREATE TRIGGER reject_cancel BEFORE UPDATE ON session_inbox WHEN NEW.status='cancelled' BEGIN SELECT RAISE(ABORT,'cancel rollback'); END;").await;
    assert!(owner
        .cancel_pending_session_inbox_item("session".into(), updated.id, updated.version)
        .await
        .is_err());
    assert_eq!(observation.try_changed().unwrap(), None);
    assert!(
        owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .inbox_pending
    );
    control(&owner, "DROP TRIGGER reject_cancel;").await;
    let reached = Arc::new(Notify::new());
    let (release, receive) = mpsc::channel();
    let pending = owner
        .submit(CommitThenWait {
            cancel: Some((updated.id, updated.version)),
            reached: reached.clone(),
            release: receive,
        })
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
        .await
        .unwrap();
    assert_eq!(
        observation.try_changed().unwrap().as_deref(),
        Some("session")
    );
    drop(pending);
    release.send(()).unwrap();
    assert!(
        !owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .inbox_pending
    );
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    assert!(owner
        .cancel_pending_session_inbox_item("session".into(), updated.id, updated.version)
        .await
        .is_err());
    assert_eq!(
        observation.try_changed().unwrap(),
        None,
        "stale cancellation replay is silent"
    );
    close(path, owner, observation).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_inbox_insert_hint_precedes_lost_ack_without_duplicate_work() {
    let path = fixture();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
    let reached = Arc::new(Notify::new());
    let (release, receive) = mpsc::channel();
    let pending = owner
        .submit(CommitThenWait {
            cancel: None,
            reached: reached.clone(),
            release: receive,
        })
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
        .await
        .unwrap();
    assert_eq!(
        observation.try_changed().unwrap().as_deref(),
        Some("session")
    );
    drop(pending);
    release.send(()).unwrap();
    let metadata = owner
        .read_attention_metadata(Some("session".into()))
        .await
        .unwrap();
    assert!(metadata[0].inbox_pending);
    assert!(!format!("{metadata:?}").contains("private queued content"));
    assert_eq!(
        owner
            .list_session_inbox("session".into())
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    assert_eq!(observation.try_changed().unwrap(), None);
    close(path, owner, observation).await;
}
