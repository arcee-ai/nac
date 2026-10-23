use super::*;
use crate::types::Message;
use std::sync::Arc;
fn fixture() -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!("nac-selection-admission-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "session");
    insert_test_session(&path, "other");
    path
}
fn intent() -> TerminalSelectionIntent {
    TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: crate::store::TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: uuid::Uuid::new_v4().to_string(),
        capture_id: uuid::Uuid::new_v4().to_string(),
        source_session_id: "session".into(),
        terminal_id: "launch-incarnation".into(),
        owner_instance_id: uuid::Uuid::new_v4().to_string(),
        client_capture_time_ms: Some("123".into()),
        text: " \t/compact\n$skill\n[[REDACTED]]\n中🙂  ".into(),
        user_text: Some(" user question \n ".into()),
        initial_delivery: TerminalSelectionDelivery::Queue,
        initial_expected_run_id: None,
    }
}
#[test]
fn identified_selection_inbox_preserves_exact_fields_and_current_cancelled_state() {
    let path = fixture();
    let original = intent();
    let created = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(!created.replayed);
    let decoded: TerminalSelectionIntent = serde_json::from_str(
        created
            .record
            .content
            .strip_prefix(ENVELOPE_PREFIX)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(decoded, original);
    let updated = update_pending_session_inbox_item(
        &path,
        "session",
        created.record.id,
        0,
        InboxDelivery::Steer,
        Some("new-run"),
    )
    .unwrap();
    let cancelled =
        cancel_pending_session_inbox_item(&path, "session", created.record.id, updated.version)
            .unwrap();
    let replay = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.record, cancelled);
    assert_eq!(replay.intent, original);
    assert_eq!(replay.record.content, created.record.content);
    let legacy = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        " legacy ",
        None,
        None,
    )
    .unwrap();
    assert_eq!(legacy.content, "legacy");
    assert!(serde_json::to_value(legacy)
        .unwrap()
        .get("admission_id")
        .is_none());
}
#[test]
fn identified_selection_identity_conflicts_are_scoped_and_immutable() {
    let path = fixture();
    let original = intent();
    create_terminal_selection_intent(&path, &original).unwrap();
    for changed in [
        {
            let mut v = original.clone();
            v.text.push('x');
            v
        },
        {
            let mut v = original.clone();
            v.initial_delivery = TerminalSelectionDelivery::Send;
            v
        },
        {
            let mut v = original.clone();
            v.user_text = None;
            v
        },
        {
            let mut v = original.clone();
            v.owner_instance_id = uuid::Uuid::new_v4().to_string();
            v
        },
    ] {
        let error = create_terminal_selection_intent(&path, &changed).unwrap_err();
        assert_eq!(
            error.downcast_ref(),
            Some(&TerminalSelectionAdmissionError::IdentityConflict)
        );
    }
    let mut other = original.clone();
    other.source_session_id = "other".into();
    assert!(load_terminal_selection_receipt(&path, &other)
        .unwrap()
        .is_none());
    assert!(
        !create_terminal_selection_intent(&path, &other)
            .unwrap()
            .replayed
    );
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE session_inbox SET content='edited' WHERE session_id='session'",
            [],
        )
        .unwrap();
    assert!(load_terminal_selection_receipt(&path, &original).is_err());
}
#[test]
fn identified_selection_cross_thread_duplicates_commit_only_one_inbox_row() {
    let path = fixture();
    let original = intent();
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let threads = (0..8)
        .map(|_| {
            let (path, original, barrier) = (path.clone(), original.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                create_terminal_selection_intent(&path, &original).unwrap()
            })
        })
        .collect::<Vec<_>>();
    let receipts = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(receipts.iter().filter(|r| !r.replayed).count(), 1);
    assert!(receipts
        .iter()
        .all(|r| r.record.id == receipts[0].record.id));
    assert_eq!(list_session_inbox(&path, "session").unwrap().len(), 1);
}
#[test]
fn identified_selection_commit_faults_reconcile_exact_identity_and_fifo() {
    let path = fixture();
    let original = intent();
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_selection BEFORE INSERT ON session_inbox BEGIN SELECT RAISE(ABORT,'fail'); END;").unwrap();
    assert!(create_terminal_selection_intent(&path, &original).is_err());
    assert!(load_terminal_selection_receipt(&path, &original)
        .unwrap()
        .is_none());
    connection
        .execute_batch("DROP TRIGGER fail_selection;")
        .unwrap();
    LOSE_ACK.with(|fault| fault.set(true));
    let creator = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(!creator.replayed);
    let replay = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(replay.replayed);
    let mut send = intent();
    send.initial_delivery = TerminalSelectionDelivery::Send;
    assert_eq!(
        create_terminal_selection_intent(&path, &send)
            .unwrap_err()
            .downcast_ref(),
        Some(&TerminalSelectionAdmissionError::DeliveryConflict)
    );
    assert_eq!(list_session_inbox(&path, "session").unwrap().len(), 1);
}
#[test]
fn identified_selection_migration_from_32_preserves_legacy_records_and_reopens() {
    let path = fixture();
    let pending = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "legacy exact",
        None,
        None,
    )
    .unwrap();
    let item = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "cancelled",
        None,
        None,
    )
    .unwrap();
    cancel_pending_session_inbox_item(&path, "session", item.id, 0).unwrap();
    let before = list_session_inbox(&path, "session").unwrap();
    {
        let connection = open_runtime_connection(&path).unwrap();
        connection.execute_batch("DROP INDEX idx_session_inbox_admission; ALTER TABLE session_inbox DROP COLUMN admission_digest; ALTER TABLE session_inbox DROP COLUMN admission_id; PRAGMA user_version=32;").unwrap();
    }
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    assert_eq!(list_session_inbox(&path, "session").unwrap(), before);
    let connection = open_runtime_connection(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        crate::store::schema_version()
    );
    let columns: (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT admission_id,admission_digest FROM session_inbox WHERE id=?1",
            params![pending.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(columns, (None, None));
    assert!(connection
        .execute(
            "UPDATE session_inbox SET admission_id=?1 WHERE id=?2",
            params![uuid::Uuid::new_v4().to_string(), pending.id]
        )
        .is_err());
    create_terminal_selection_intent(&path, &intent()).unwrap();
}
#[test]
fn identified_selection_delivery_lost_ack_preserves_canonical_history_once() {
    let path = fixture();
    let original = intent();
    let created = create_terminal_selection_intent(&path, &original).unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let message = Message::User {
        content: created.record.content.clone(),
    };
    writer.lose_next_append_ack_for_test();
    assert!(writer
        .append_inbox_run_prompt("session", 0, &message, "run", created.record.id)
        .is_err());
    writer
        .append_inbox_run_prompt("session", 0, &message, "run", created.record.id)
        .unwrap();
    assert_eq!(
        serde_json::to_value(writer.read_from("session", 0).unwrap()).unwrap(),
        serde_json::to_value(vec![(0u64, message)]).unwrap()
    );
    let replay = load_terminal_selection_receipt(&path, &original)
        .unwrap()
        .unwrap();
    assert_eq!(replay.record.status, InboxStatus::Delivered);
    assert!(replay.replayed);
    assert_eq!(replay.intent, original);
    assert_eq!(list_session_inbox(&path, "session").unwrap().len(), 1);
}
#[tokio::test(flavor = "current_thread")]
async fn identified_selection_owned_port_survives_store_restart_without_new_identity() {
    let path = fixture();
    let original = intent();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    owner.initialize().await.unwrap();
    let created = owner
        .create_terminal_selection_intent(original.clone())
        .await
        .unwrap();
    owner.shutdown().await.unwrap();
    let restarted = StoreCoordinator::acquire(&path).unwrap();
    restarted.initialize().await.unwrap();
    let replay = restarted
        .create_terminal_selection_intent(original)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.record, created.record);
    restarted.shutdown().await.unwrap();
}

#[test]
fn identified_selection_process_helper() {
    let Ok(path) = std::env::var("NAC_SELECTION_ADMISSION_TEST_PATH") else {
        return;
    };
    let original: TerminalSelectionIntent =
        serde_json::from_str(&std::env::var("NAC_SELECTION_ADMISSION_TEST_INTENT").unwrap())
            .unwrap();
    create_terminal_selection_intent(Path::new(&path), &original).unwrap();
}
#[test]
fn identified_selection_independent_process_duplicates_share_one_durable_receipt() {
    let path = fixture();
    let original = intent();
    let children = (0..4)
        .map(|_| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "store::terminal_selection::tests::identified_selection_process_helper",
                ])
                .env("NAC_SELECTION_ADMISSION_TEST_PATH", &path)
                .env(
                    "NAC_SELECTION_ADMISSION_TEST_INTENT",
                    serde_json::to_string(&original).unwrap(),
                )
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap()
        })
        .collect::<Vec<_>>();
    for mut child in children {
        assert!(child.wait().unwrap().success());
    }
    assert_eq!(list_session_inbox(&path, "session").unwrap().len(), 1);
    assert!(
        create_terminal_selection_intent(&path, &original)
            .unwrap()
            .replayed
    );
}

#[test]
fn identified_selection_rollback_reused_row_id_is_not_creator_authority() {
    let path = fixture();
    let original = intent();
    let mut connection = open_runtime_connection(&path).unwrap();
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    tx.execute("INSERT INTO session_inbox(session_id,delivery,content,created_at,updated_at,admission_id,admission_digest) VALUES(?1,'queue',?2,?3,?3,?4,?5)", params![original.source_session_id,original.envelope().unwrap(),now_utc(),original.admission_id,original.digest().unwrap()]).unwrap();
    let rolled_back_id = tx.last_insert_rowid();
    tx.rollback().unwrap();
    // A distinct connection/creator can receive the exact same allocated ID.
    let peer = create_terminal_selection_intent(&path, &original).unwrap();
    assert_eq!(peer.record.id, rolled_back_id);
    assert!(!peer.replayed);
    let later = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(later.replayed);
    assert_eq!(later.record.id, rolled_back_id);
}

#[test]
fn identified_selection_failed_commit_retains_uncertainty_and_sqlite_cause() {
    let path = fixture();
    let original = intent();
    let connection = open_runtime_connection(&path).unwrap();
    // A deferred constraint allows INSERT but rejects the actual COMMIT.
    connection.execute_batch("CREATE TABLE selection_commit_parent(id INTEGER PRIMARY KEY);
        CREATE TABLE selection_commit_child(parent_id INTEGER REFERENCES selection_commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER selection_commit_failure AFTER INSERT ON session_inbox BEGIN
            INSERT INTO selection_commit_child(parent_id) VALUES(1);
        END;").unwrap();
    let error = create_terminal_selection_intent(&path, &original).unwrap_err();
    assert_eq!(
        error.downcast_ref::<TerminalSelectionAdmissionError>(),
        Some(&TerminalSelectionAdmissionError::CommitUncertain)
    );
    assert!(error.chain().any(|cause| matches!(cause.downcast_ref::<rusqlite::Error>(), Some(rusqlite::Error::SqliteFailure(code, _)) if code.code == rusqlite::ErrorCode::ConstraintViolation)));
    assert!(list_session_inbox(&path, "session").unwrap().is_empty());
    connection
        .execute_batch("DROP TRIGGER selection_commit_failure;")
        .unwrap();
    let creator = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(!creator.replayed);
    let replay = create_terminal_selection_intent(&path, &original).unwrap();
    assert!(replay.replayed);
    assert_eq!(creator.record.id, replay.record.id);
    assert_eq!(list_session_inbox(&path, "session").unwrap().len(), 1);
}
