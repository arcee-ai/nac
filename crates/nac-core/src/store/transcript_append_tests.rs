use super::*;
use std::sync::{Barrier, Mutex};

struct TestStoreDir(PathBuf);
impl Drop for TestStoreDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn setup() -> (TestStoreDir, PathBuf) {
    let directory = std::env::temp_dir().join(format!("nac-append-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "session");
    (TestStoreDir(directory), path)
}
fn message(content: &str) -> Message {
    Message::User {
        content: content.into(),
    }
}
fn receipt_count(path: &Path) -> i64 {
    open_runtime_connection(path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM transcript_append_receipts", [], |r| {
            r.get(0)
        })
        .unwrap()
}

#[test]
fn transcript_append_fault_windows_retry_once_and_restart_agrees() {
    for phase in [
        AppendFault::BeforeTransaction,
        AppendFault::Statements,
        AppendFault::BeforeCommit,
        AppendFault::UncertainCommit,
        AppendFault::AfterCommitBeforeAck,
    ] {
        let (_dir, path) = setup();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        *writer.append_fault.lock().unwrap() = Some((phase, 1));
        let messages = [message("one"), message("two")];
        let first = writer.append_idempotent("session", "request", None, &messages);
        match phase {
            AppendFault::UncertainCommit => {
                assert!(first.is_ok(), "{first:?}");
            }
            AppendFault::AfterCommitBeforeAck => {
                assert_eq!(
                    first.unwrap_err().downcast_ref::<TranscriptAppendError>(),
                    Some(&TranscriptAppendError::CommitUncertain)
                );
                assert_eq!(receipt_count(&path), 1);
            }
            _ => {
                assert!(first.is_err());
                assert_eq!(receipt_count(&path), 0);
                assert!(writer.read_from("session", 0).unwrap().is_empty());
            }
        }
        // Fresh connection and writer exercise process-independent identity.
        let restarted = TranscriptLogWriter::new(&path).unwrap();
        let receipt = restarted
            .append_idempotent("session", "request", None, &messages)
            .unwrap();
        assert_eq!(receipt.start_idx, 0);
        assert_eq!(receipt.end_idx, 2);
        assert_eq!(
            restarted
                .append_idempotent("session", "request", None, &messages)
                .unwrap(),
            receipt
        );
        assert_eq!(receipt_count(&path), 1);
        assert_eq!(
            restarted
                .read_from("session", 0)
                .unwrap()
                .iter()
                .map(|(idx, _)| *idx)
                .collect::<Vec<_>>(),
            [0, 1]
        );
        assert_eq!(
            crate::sessions::list_sessions(&path).unwrap()[0].visible_message_count,
            2
        );
    }
}

#[test]
fn transcript_append_identity_conflicts_and_rewind_invalidates_receipt() {
    let (_dir, path) = setup();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let receipt = writer
        .append_idempotent("session", "key", Some(0), &[message("one"), message("two")])
        .unwrap();
    assert_eq!(
        writer
            .append_idempotent("session", "key", Some(0), &[message("different")])
            .unwrap_err()
            .downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::IdentityConflict)
    );
    writer.delete_from("session", 1).unwrap();
    assert_eq!(receipt_count(&path), 0);
    assert_eq!(
        writer
            .append_idempotent("session", "key", Some(0), &[message("one"), message("two")])
            .unwrap_err()
            .downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::PositionConflict {
            expected: 1,
            found: 0
        })
    );
    let next = writer
        .append_idempotent("session", "successor", None, &[message("new")])
        .unwrap();
    assert_eq!(next.start_idx, 1);
    assert!(next.last_message_id > receipt.last_message_id);
}

#[test]
fn transcript_append_concurrent_duplicate_and_distinct_writers_remain_contiguous() {
    let (_dir, path) = setup();
    let barrier = Arc::new(Barrier::new(4));
    let receipts = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for ordinal in 0..4 {
            let barrier = Arc::clone(&barrier);
            let path = &path;
            let receipts = &receipts;
            scope.spawn(move || {
                let writer = TranscriptLogWriter::new(path).unwrap();
                barrier.wait();
                let key = format!("request-{}", ordinal / 2);
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                loop {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "append lease retry timed out"
                    );
                    match writer.append_idempotent("session", &key, None, &[message(&key)]) {
                        Ok(receipt) => {
                            receipts.lock().unwrap().push((key, receipt));
                            break;
                        }
                        Err(error)
                            if error
                                .downcast_ref::<crate::sessions::SessionOperationLeaseError>()
                                .is_some_and(|e| {
                                    matches!(
                                        e,
                                        crate::sessions::SessionOperationLeaseError::Busy(_)
                                    )
                                }) =>
                        {
                            std::thread::yield_now()
                        }
                        Err(error) => panic!("{error:#}"),
                    }
                }
            });
        }
    });
    let receipts = receipts.into_inner().unwrap();
    for key in ["request-0", "request-1"] {
        let duplicated = receipts
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, r)| r)
            .collect::<Vec<_>>();
        assert_eq!(duplicated.len(), 2);
        assert_eq!(duplicated[0], duplicated[1]);
    }
    let writer = TranscriptLogWriter::new(&path).unwrap();
    assert_eq!(
        writer
            .read_from("session", 0)
            .unwrap()
            .iter()
            .map(|(idx, _)| *idx)
            .collect::<Vec<_>>(),
        [0, 1]
    );
    assert_eq!(receipt_count(&path), 2);
    assert_eq!(
        crate::sessions::list_sessions(&path).unwrap()[0].visible_message_count,
        2
    );
}

#[test]
fn transcript_append_run_prompt_retry_is_atomic_with_recovery_and_owner_fenced() {
    let (_dir, path) = setup();
    let lease = Arc::new(SessionOperationLease::try_acquire(&path, "session").unwrap());
    let writer = TranscriptLogWriter::for_run(&path, "session", "run", &lease).unwrap();
    *writer.append_fault.lock().unwrap() = Some((AppendFault::AfterCommitBeforeAck, 1));
    assert!(writer
        .append_run_prompt("session", 0, &message("prompt"), "run")
        .is_err());
    writer
        .append_run_prompt("session", 0, &message("prompt"), "run")
        .unwrap();
    let recovery = load_run_recovery(&path, "session").unwrap().unwrap();
    assert_eq!(recovery.run_id, "run");
    assert_eq!(recovery.status, RunRecoveryStatus::Active);
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 1);
    drop(lease);
    assert_eq!(
        writer
            .append("session", 1, &message("stale"))
            .unwrap_err()
            .downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::StaleOwner)
    );
    let lease = Arc::new(SessionOperationLease::try_acquire(&path, "session").unwrap());
    let wrong = TranscriptLogWriter::for_run(&path, "session", "other-run", &lease).unwrap();
    assert_eq!(
        wrong
            .append("session", 1, &message("wrong run"))
            .unwrap_err()
            .downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::StaleRun)
    );
    assert_eq!(receipt_count(&path), 1);
}

#[test]
fn transcript_append_generation_change_rejects_even_the_same_run_id() {
    let (_dir, path) = setup();
    insert_test_session(&path, "parent");
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute("INSERT INTO managed_orchestrators
        (orchestrator_session_id, parent_session_id, root_session_id, description,
         status, generation, run_id, execution_mode, created_at, updated_at)
        VALUES ('session', 'parent', 'parent', 'test', 'running', 1, 'run', 'background', 'now', 'now')", []).unwrap();
    let lease = Arc::new(SessionOperationLease::try_acquire(&path, "session").unwrap());
    let writer = TranscriptLogWriter::for_run(&path, "session", "run", &lease).unwrap();
    writer
        .append_run_prompt("session", 0, &message("prompt"), "run")
        .unwrap();
    let generation: i64 = connection
        .query_row(
            "SELECT generation FROM transcript_append_receipts",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(generation, 1);
    connection
        .execute("UPDATE managed_orchestrators SET generation = 2", [])
        .unwrap();
    assert_eq!(
        writer
            .append("session", 1, &message("stale generation"))
            .unwrap_err()
            .downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::StaleRun)
    );
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 1);
    let failure = TranscriptAppendError::PositionConflict {
        expected: 3,
        found: 4,
    }
    .run_failure();
    assert_eq!(failure.kind, crate::run_failure::RunFailureKind::Protocol);
    assert!(!failure.transient);
}

#[test]
fn transcript_append_v29_upgrade_preserves_legacy_payload_and_recovery() {
    let (_dir, path) = setup();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_run_prompt("session", 0, &message("legacy prompt"), "legacy-run")
        .unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    let payload: String = connection
        .query_row("SELECT event_json FROM thread_events", [], |r| r.get(0))
        .unwrap();
    let recovery = load_run_recovery(&path, "session").unwrap();
    connection
        .execute_batch("DROP TABLE transcript_append_receipts; PRAGMA user_version = 29;")
        .unwrap();
    drop(connection);
    initialize(&path).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    assert_eq!(
        connection
            .query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        schema_version()
    );
    assert_eq!(
        connection
            .query_row::<String, _, _>("SELECT event_json FROM thread_events", [], |r| r.get(0))
            .unwrap(),
        payload
    );
    assert_eq!(load_run_recovery(&path, "session").unwrap(), recovery);
    assert_eq!(receipt_count(&path), 0);
    assert_eq!(
        connection
            .query_row::<String, _, _>("PRAGMA foreign_key_check", [], |r| r.get(0))
            .optional()
            .unwrap(),
        None
    );
}

#[test]
fn transcript_append_statement_abort_rolls_back_the_entire_batch_and_receipt() {
    let (_dir, path) = setup();
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_second_append BEFORE INSERT ON thread_events
        WHEN NEW.event_json LIKE '%second%' BEGIN SELECT RAISE(ABORT, 'statement failure'); END;",
        )
        .unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let messages = [message("first"), message("second")];
    assert!(writer
        .append_idempotent("session", "batch", Some(0), &messages)
        .is_err());
    assert!(writer.read_from("session", 0).unwrap().is_empty());
    assert_eq!(receipt_count(&path), 0);
    assert_eq!(
        crate::sessions::list_sessions(&path).unwrap()[0].visible_message_count,
        0
    );
    connection
        .execute_batch("DROP TRIGGER fail_second_append")
        .unwrap();
    assert_eq!(
        writer
            .append_idempotent("session", "batch", Some(0), &messages)
            .unwrap()
            .end_idx,
        2
    );
}

#[test]
fn transcript_append_steer_and_inbox_ack_loss_replay_delivery_once() {
    let (_dir, path) = setup();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let queued =
        create_session_inbox_item(&path, "session", InboxDelivery::Queue, "prompt", None, None)
            .unwrap();
    *writer.append_fault.lock().unwrap() = Some((AppendFault::AfterCommitBeforeAck, 1));
    assert!(writer
        .append_inbox_run_prompt("session", 0, &message("prompt"), "run", queued.id)
        .is_err());
    writer
        .append_inbox_run_prompt("session", 0, &message("prompt"), "run", queued.id)
        .unwrap();
    let steer = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Steer,
        "steer",
        Some("run"),
        None,
    )
    .unwrap();
    *writer.append_fault.lock().unwrap() = Some((AppendFault::AfterCommitBeforeAck, 1));
    assert!(writer
        .append_pending_inbox_steers("session", "run", 1)
        .is_err());
    let delivered = writer
        .append_pending_inbox_steers("session", "run", 1)
        .unwrap();
    assert_eq!(
        delivered.iter().map(|r| r.id).collect::<Vec<_>>(),
        [steer.id]
    );
    assert_eq!(delivered[0].status, InboxStatus::Delivered);
    let version = delivered[0].version;
    assert_eq!(
        writer
            .append_pending_inbox_steers("session", "run", 1)
            .unwrap()[0]
            .version,
        version
    );
    let queued = queue_thread_steering(
        &path,
        "session",
        ORCHESTRATOR_STEERING_TARGET,
        "run",
        "thread steer",
    )
    .unwrap();
    claim_thread_steering(&path, "session", "run").unwrap();
    *writer.append_fault.lock().unwrap() = Some((AppendFault::UncertainCommit, 1));
    writer
        .append_claimed_thread_steering(
            "session",
            "run",
            &[queued.id],
            2,
            &[message("thread steer")],
        )
        .unwrap();
    writer
        .append_claimed_thread_steering(
            "session",
            "run",
            &[queued.id],
            2,
            &[message("thread steer")],
        )
        .unwrap();
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 3);
    assert_eq!(
        crate::sessions::list_sessions(&path).unwrap()[0].visible_message_count,
        3
    );
    assert_eq!(
        list_thread_steering(&path, "session").unwrap()[0].status,
        "delivered"
    );
    assert_eq!(
        load_run_recovery(&path, "session")
            .unwrap()
            .unwrap()
            .submitted_message_id,
        1
    );
}

#[test]
fn transcript_append_in_flight_transaction_retains_lease_until_commit() {
    let (_dir, path) = setup();
    let lease = Arc::new(SessionOperationLease::try_acquire(&path, "session").unwrap());
    let writer = Arc::new(TranscriptLogWriter::for_run(&path, "session", "run", &lease).unwrap());
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(0);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
    let in_flight = Arc::clone(&writer);
    let thread = std::thread::spawn(move || {
        in_flight
            .commit_append(
                "session",
                "prompt",
                Some(0),
                &[message("prompt")],
                AppendPurpose::RunPrompt("run"),
                |transaction, _| {
                    replace_with_active_run(
                        transaction,
                        "session",
                        "run",
                        transaction.last_insert_rowid(),
                    )?;
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(())
                },
            )
            .unwrap()
    });
    entered_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    drop(lease);
    assert!(matches!(
        SessionOperationLease::try_acquire(&path, "session"),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_))
    ));
    release_tx.send(()).unwrap();
    assert_eq!(thread.join().unwrap().end_idx, 1);
    let _next_owner = SessionOperationLease::try_acquire(&path, "session").unwrap();
    assert_eq!(
        writer
            .append("session", 1, &message("late"))
            .unwrap_err()
            .downcast_ref::<TranscriptAppendError>(),
        Some(&TranscriptAppendError::StaleOwner)
    );
}
