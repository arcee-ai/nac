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
async fn blocking_pool_adapter_keeps_current_thread_runtime_responsive() {
    let path = path();
    let owner = seed(&path).await;
    let error = crate::store::list_session_inbox(&path, "session").unwrap_err();
    assert_eq!(
        error.downcast_ref::<PersistenceAdmissionError>(),
        Some(&PersistenceAdmissionError::AsyncContext)
    );
    let (gate, release, _) = super::tests::block_executor(&owner);
    let caller_path = path.clone();
    let caller = crate::store::spawn_blocking_store_caller(move || {
        crate::store::create_session_inbox_item(
            &caller_path,
            "session",
            InboxDelivery::Queue,
            "blocking pool",
            None,
            None,
        )
    });
    while owner.stats().queued == 0 {
        tokio::task::yield_now().await;
    }
    tokio::time::timeout(
        std::time::Duration::from_millis(200),
        tokio::time::sleep(std::time::Duration::from_millis(5)),
    )
    .await
    .unwrap();
    assert!(!caller.is_finished());
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    assert_eq!(caller.await.unwrap().unwrap().content, "blocking pool");
    owner.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn maintenance_lease_contention_cannot_wait_for_settlement_on_the_executor() {
    let path = path();
    let owner = seed(&path).await;
    let admission = crate::sessions::HostAdmissionLease::try_acquire(&path).unwrap();
    let target = crate::store::ManagedUpgradeTarget {
        release_id: "test-release".into(),
        source_sha: "a".repeat(40),
        product_version: "0.2.0".into(),
        schema_version: crate::store::schema_version(),
        minimum_schema_version: 0,
    };
    let identity = crate::store::ManagedAcceptedIdentity {
        managed_host_id: "host".into(),
        host_incarnation_id: "incarnation".into(),
        operation_id: "replacement".into(),
        target,
    };
    let error = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        owner.accept_managed_forward_start(identity.clone()),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(matches!(
        error,
        crate::store::ManagedMaintenanceError::Store(_)
    ));
    // Work holding the admission can still get its durable settlement into
    // the same FIFO. Only then may it release the lease and admit maintenance.
    owner
        .create_session_inbox_item(
            "session".into(),
            InboxDelivery::Queue,
            "settlement".into(),
            None,
            None,
        )
        .await
        .unwrap();
    drop(admission);
    assert!(!owner.accept_managed_forward_start(identity).await.unwrap());
    owner.shutdown().await.unwrap();
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn async_thread_event_waits_for_commit_before_publication_without_blocking_timers() {
    let path = path();
    let owner = seed(&path).await;
    let bus = crate::events::SessionEventBus::with_thread_event_store(
        Some("session".into()),
        path.clone(),
    );
    let mut receiver = bus.subscribe();
    let sink = crate::events::EventSink::bus(bus.clone());
    let (gate, release, _) = super::tests::block_executor(&owner);
    let publication = tokio::spawn(async move {
        sink.emit_async(crate::events::AgentEvent::ThreadStarted {
            name: "worker".into(),
            action: "test".into(),
            source_threads: vec![],
        })
        .await;
    });
    while owner.stats().queued == 0 {
        tokio::task::yield_now().await;
    }
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
    // Replay reads use only the published cache, not the lock waiting for SQL.
    let (boundary, replay) = bus.recent_events(None, 10);
    assert_eq!(boundary.sequence_id, 0);
    assert!(replay.is_empty());
    tokio::time::timeout(
        std::time::Duration::from_millis(200),
        tokio::time::sleep(std::time::Duration::from_millis(5)),
    )
    .await
    .unwrap();
    assert!(!publication.is_finished());
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    publication.await.unwrap();
    let published = receiver.recv().await.unwrap();
    assert_eq!(published.sequence_id, 1);
    let events = owner
        .load_all_thread_events("session".into(), 10)
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events["worker"].len(), 1);
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

#[tokio::test(flavor = "current_thread")]
async fn queue_diagnostics_cover_commit_and_ack_without_exporting_data_or_error_text() {
    use crate::telemetry::{InMemoryExporter, RuntimeMetadata, TelemetryName, TelemetryRecorder};
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(
        exporter.clone(),
        RuntimeMetadata::sqlite("test", "test", crate::store::schema_version(), None, None),
        crate::telemetry::MAX_EXPORT_QUEUE_CAPACITY,
    );
    let _recording = crate::telemetry::install_test_recorder(recorder.clone());
    let path = path();
    let owner = seed(&path).await;
    owner
        .create_session_inbox_item(
            "session".into(),
            InboxDelivery::Queue,
            "PRIVATE_ROW_CONTENT".into(),
            None,
            None,
        )
        .await
        .unwrap();
    struct ErrorText;
    impl PersistenceCommand for ErrorText {
        type Output = ();
        fn correlation(&self) -> Correlation {
            Correlation::session(Some("session"))
        }
        fn execute(self, _: &Path) -> Result<()> {
            anyhow::bail!("PRIVATE_ERROR_TEXT INSERT INTO private_table");
        }
    }
    assert!(owner
        .submit(ErrorText)
        .unwrap()
        .acknowledge()
        .await
        .is_err());
    owner.shutdown().await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let stats = recorder.stats();
            if stats.exported + stats.failures == stats.accepted {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    let events = exporter.events();
    for operation in [
        StoreOperation::QueueAdmission,
        StoreOperation::QueueWait,
        StoreOperation::QueueExecution,
        StoreOperation::Commit,
        StoreOperation::QueueAck,
        StoreOperation::QueueShutdown,
    ] {
        assert!(
            events
                .iter()
                .any(|event| event.operation == Some(operation)),
            "missing {operation:?}"
        );
    }
    assert!(events
        .iter()
        .any(|event| event.name == TelemetryName::PersistenceQueueDepth && event.value == Some(0)));
    assert!(events.iter().any(
        |event| event.name == TelemetryName::PersistenceQueueCapacity && event.value == Some(128)
    ));
    let encoded = serde_json::to_string(&events).unwrap();
    for private in [
        "PRIVATE_ROW_CONTENT",
        "PRIVATE_ERROR_TEXT",
        "INSERT INTO",
        "private_table",
    ] {
        assert!(
            !encoded.contains(private),
            "diagnostics leaked data or error text"
        );
    }
    assert_eq!(recorder.stats().dropped, 0);
    assert_eq!(recorder.stats().failures, 0);
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
