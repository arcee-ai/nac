use super::*;
use crate::store::{
    InboxDelivery, TranscriptAppendError, TranscriptAppendReceipt, TranscriptLogWriter,
};
use crate::types::Message;

struct SeedSession;
impl PersistenceCommand for SeedSession {
    type Output = ();
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        crate::store::insert_test_session(path, "session");
        Ok(())
    }
}

struct Append {
    writer: TranscriptLogWriter,
    identity: String,
    expected: u64,
    messages: Vec<Message>,
}
impl PersistenceCommand for Append {
    type Output = TranscriptAppendReceipt;
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, _: &Path) -> Result<Self::Output> {
        self.writer.append_idempotent(
            "session",
            &self.identity,
            Some(self.expected),
            &self.messages,
        )
    }
}

struct ReadLog;
impl PersistenceCommand for ReadLog {
    type Output = Vec<(u64, Message)>;
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        TranscriptLogWriter::new(path)?.read_from("session", 0)
    }
}

struct AdmitWorker(&'static str);
impl PersistenceCommand for AdmitWorker {
    type Output = crate::store::WorkerDispatchIdentity;
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        crate::store::admit_worker_dispatch(path, "session", "worker", self.0, None, "test")
    }
}
struct CommitWorker {
    identity: crate::store::WorkerDispatchIdentity,
    content: &'static str,
}
impl PersistenceCommand for CommitWorker {
    type Output = i64;
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session")).with_generation(self.identity.generation as u64)
    }
    fn execute(self, path: &Path) -> Result<i64> {
        crate::store::commit_worker_episode(
            path,
            &self.identity,
            self.content,
            crate::store::EpisodeStatus::Ok,
        )
    }
}

fn path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("nac-coordinator-contract-{}", uuid::Uuid::new_v4()))
        .join("store.db")
}
fn message(content: &str) -> Message {
    Message::User {
        content: content.to_owned(),
    }
}
async fn seed(path: &Path) -> Arc<StoreCoordinator> {
    let owner = StoreCoordinator::acquire(path).unwrap();
    owner.initialize().await.unwrap();
    owner
        .submit(SeedSession)
        .unwrap()
        .acknowledge()
        .await
        .unwrap();
    owner
}

#[tokio::test(flavor = "current_thread")]
async fn typed_inbox_port_keeps_revision_cas_and_restart_state() {
    let path = path();
    let owner = seed(&path).await;
    let first = owner
        .create_session_inbox_item(
            "session".into(),
            InboxDelivery::Queue,
            "one".into(),
            None,
            None,
        )
        .await
        .unwrap();
    let updated = owner
        .update_pending_session_inbox_item(
            "session".into(),
            first.id,
            first.version,
            InboxDelivery::Steer,
            Some("run".into()),
        )
        .await
        .unwrap();
    assert_eq!(updated.version, first.version + 1);
    assert!(owner
        .update_pending_session_inbox_item(
            "session".into(),
            first.id,
            first.version,
            InboxDelivery::Queue,
            None
        )
        .await
        .is_err());
    assert_eq!(
        owner.list_session_inbox("session".into()).await.unwrap(),
        vec![updated.clone()]
    );
    owner.shutdown().await.unwrap();
    let restarted = StoreCoordinator::acquire(&path).unwrap();
    restarted.initialize().await.unwrap();
    assert_eq!(
        restarted
            .list_session_inbox("session".into())
            .await
            .unwrap(),
        vec![updated]
    );
    restarted.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn owned_connections_reject_bypass_and_lookup_does_not_create_directories() {
    let path = path();
    let owner = seed(&path).await;
    assert!(crate::store::open_runtime_connection(&path)
        .err()
        .unwrap()
        .to_string()
        .contains("bypassed"));
    let absent = path.parent().unwrap().join("never-created/store.db");
    assert!(owner_for(&absent).unwrap().is_none());
    assert!(!absent.parent().unwrap().exists());
    assert!(owner
        .list_session_inbox("session".into())
        .await
        .unwrap()
        .is_empty());
    owner.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn blocking_compatibility_caller_is_routed_through_the_owned_queue() {
    let path = path();
    let owner = seed(&path).await;
    let admitted = owner.stats().admitted;
    let thread_path = path.clone();
    let caller = std::thread::spawn(move || {
        crate::store::create_session_inbox_item(
            &thread_path,
            "session",
            InboxDelivery::Queue,
            "legacy caller",
            None,
            None,
        )
    });
    let result = tokio::task::spawn_blocking(move || caller.join().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.content, "legacy caller");
    assert_eq!(owner.stats().admitted, admitted + 1);
    owner.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn identified_append_faults_rollback_or_reconcile_exactly_once_through_the_executor() {
    use crate::store::transcript_append::AppendFault;
    for phase in [
        AppendFault::BeforeTransaction,
        AppendFault::Statements,
        AppendFault::BeforeCommit,
        AppendFault::AfterCommitBeforeAck,
        AppendFault::UncertainCommit,
    ] {
        let path = path();
        let owner = seed(&path).await;
        let writer = TranscriptLogWriter::new(&path).unwrap();
        *writer.append_fault.lock().unwrap() = Some((phase, 1));
        let command = || Append {
            writer: writer.clone(),
            identity: "identified".into(),
            expected: 0,
            messages: vec![message("one"), message("two")],
        };
        let first = owner.submit(command()).unwrap().acknowledge().await;
        if matches!(phase, AppendFault::UncertainCommit) {
            assert!(
                first.is_ok(),
                "the existing receipt reconciles an uncertain commit"
            );
        } else {
            assert!(
                first.is_err(),
                "injected phase {phase:?} must reach its caller"
            );
        }
        let committed = matches!(
            phase,
            AppendFault::AfterCommitBeforeAck | AppendFault::UncertainCommit
        );
        assert_eq!(
            owner
                .submit(ReadLog)
                .unwrap()
                .acknowledge()
                .await
                .unwrap()
                .len(),
            if committed { 2 } else { 0 }
        );
        let receipt = owner
            .submit(command())
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert_eq!((receipt.start_idx, receipt.end_idx), (0, 2));
        assert_eq!(
            owner
                .submit(command())
                .unwrap()
                .acknowledge()
                .await
                .unwrap(),
            receipt
        );
        owner.shutdown().await.unwrap();
        let restarted = StoreCoordinator::acquire(&path).unwrap();
        restarted.initialize().await.unwrap();
        assert_eq!(
            restarted
                .submit(command())
                .unwrap()
                .acknowledge()
                .await
                .unwrap(),
            receipt
        );
        let rows = restarted
            .submit(ReadLog)
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(rows).unwrap(),
            serde_json::to_value(vec![(0, message("one")), (1, message("two"))]).unwrap()
        );
        restarted.shutdown().await.unwrap();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
async fn queued_writer_pins_the_admitted_canonical_store_when_an_alias_changes() {
    let first_path = path();
    let second_path = path();
    let first = seed(&first_path).await;
    let second = seed(&second_path).await;
    let alias = first_path.parent().unwrap().join("alias.db");
    std::os::unix::fs::symlink(&first_path, &alias).unwrap();
    let writer = TranscriptLogWriter::new(&alias).unwrap();
    let (gate, release, _) = super::tests::block_executor(&first);
    let caller =
        std::thread::spawn(move || writer.append_batch("session", 0, &[message("pinned")]));
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while first.stats().queued != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(&second_path, &alias).unwrap();
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    tokio::task::spawn_blocking(move || caller.join().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        first
            .submit(ReadLog)
            .unwrap()
            .acknowledge()
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(second
        .submit(ReadLog)
        .unwrap()
        .acknowledge()
        .await
        .unwrap()
        .is_empty());
    first.shutdown().await.unwrap();
    second.shutdown().await.unwrap();
    std::fs::remove_dir_all(first_path.parent().unwrap()).unwrap();
    std::fs::remove_dir_all(second_path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn worker_generation_fence_and_receipt_replay_survive_the_queue_and_restart() {
    let path = path();
    let owner = seed(&path).await;
    let old = owner
        .submit(AdmitWorker("old"))
        .unwrap()
        .acknowledge()
        .await
        .unwrap();
    let current = owner
        .submit(AdmitWorker("current"))
        .unwrap()
        .acknowledge()
        .await
        .unwrap();
    assert!(current.generation > old.generation);
    assert!(owner
        .submit(CommitWorker {
            identity: old,
            content: "stale"
        })
        .unwrap()
        .acknowledge()
        .await
        .is_err());
    let commit = || CommitWorker {
        identity: current.clone(),
        content: "canonical",
    };
    let id = owner.submit(commit()).unwrap().acknowledge().await.unwrap();
    assert_eq!(
        owner.submit(commit()).unwrap().acknowledge().await.unwrap(),
        id
    );
    assert!(owner
        .submit(CommitWorker {
            identity: current.clone(),
            content: "changed"
        })
        .unwrap()
        .acknowledge()
        .await
        .is_err());
    owner.shutdown().await.unwrap();
    let restarted = StoreCoordinator::acquire(&path).unwrap();
    restarted.initialize().await.unwrap();
    assert_eq!(
        restarted
            .submit(commit())
            .unwrap()
            .acknowledge()
            .await
            .unwrap(),
        id
    );
    let records = restarted
        .thread_dispatches("session".into(), "worker".into())
        .await
        .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].content, "canonical");
    restarted.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn queued_writer_keeps_weak_run_authority_instead_of_reviving_a_cancelled_owner() {
    struct BoundWriter(Arc<crate::sessions::SessionOperationLease>);
    impl PersistenceCommand for BoundWriter {
        type Output = TranscriptLogWriter;
        fn correlation(&self) -> Correlation {
            Correlation::session(Some("session"))
        }
        fn execute(self, path: &Path) -> Result<Self::Output> {
            TranscriptLogWriter::for_run(path, "session", "run", &self.0)
        }
    }
    let path = path();
    let owner = seed(&path).await;
    let lease =
        Arc::new(crate::sessions::SessionOperationLease::try_acquire(&path, "session").unwrap());
    let writer = owner
        .submit(BoundWriter(Arc::clone(&lease)))
        .unwrap()
        .acknowledge()
        .await
        .unwrap();
    drop(lease);
    let error = owner
        .submit(Append {
            writer,
            identity: "stale".into(),
            expected: 0,
            messages: vec![message("cannot commit")],
        })
        .unwrap()
        .acknowledge()
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::StaleOwner)
    );
    assert!(owner
        .submit(ReadLog)
        .unwrap()
        .acknowledge()
        .await
        .unwrap()
        .is_empty());
    owner.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
