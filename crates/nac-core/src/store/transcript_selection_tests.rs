use super::*;
fn fixture() -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!("nac-provenance-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for session in ["session", "fork", "grand"] {
        insert_test_session(&path, session);
    }
    path
}
fn intent() -> TerminalSelectionIntent {
    TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: uuid::Uuid::new_v4().to_string(),
        capture_id: uuid::Uuid::new_v4().to_string(),
        source_session_id: "session".into(),
        terminal_id: "exited-source".into(),
        owner_instance_id: uuid::Uuid::new_v4().to_string(),
        client_capture_time_ms: Some("12".into()),
        text: " /compact\n$skill\n/mcp_prompt missing\n[REDACTED]\n中🙂 ".into(),
        user_text: Some(" literal question ".into()),
        initial_delivery: TerminalSelectionDelivery::Queue,
        initial_expected_run_id: None,
    }
}
#[test]
fn selection_provenance_atomic_delivery_replay_and_copied_lookalike() {
    let path = fixture();
    let original = intent();
    let admission = create_terminal_selection_intent(&path, &original).unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let message = Message::User {
        content: admission.record.content.clone(),
    };
    writer.lose_next_append_ack_for_test();
    assert!(writer
        .append_inbox_run_prompt("session", 0, &message, "run", admission.record.id)
        .is_err());
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_inbox_run_prompt("session", 0, &message, "run", admission.record.id)
        .unwrap();
    let mut connection = open_runtime_connection(&path).unwrap();
    let tx = connection.transaction().unwrap();
    clear_active_run(&tx, "session", "run", RunTerminalDisposition::Completed).unwrap();
    tx.commit().unwrap();
    writer.append("session", 1, &message).unwrap(); // exact genuine-envelope copy lacks annotation
    let plain = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        &admission.record.content,
        None,
        None,
    )
    .unwrap();
    writer
        .append_inbox_run_prompt("session", 2, &message, "plain", plain.id)
        .unwrap();
    let references = load_terminal_selection_references(&path, "session", 0, 3).unwrap();
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].message_index, 0);
    assert_eq!(
        references[0].attribution.admission_id,
        original.admission_id
    );
    assert_eq!(
        references[0].attribution.intent_sha256,
        original.digest().unwrap()
    );
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 3);
    let json = encode_transcript_log_entry(7, &message).unwrap();
    assert!(!json.contains("terminal_selection_attribution"));
}
#[test]
fn selection_provenance_delivery_rollback_and_immutable_digest_validation() {
    let path = fixture();
    let original = intent();
    let admission = create_terminal_selection_intent(&path, &original).unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let message = Message::User {
        content: admission.record.content,
    };
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_annotation BEFORE UPDATE OF event_json ON thread_events BEGIN SELECT RAISE(ABORT,'annotation rollback'); END").unwrap();
    assert!(writer
        .append_inbox_run_prompt("session", 0, &message, "run", admission.record.id)
        .is_err());
    assert!(writer.read_from("session", 0).unwrap().is_empty());
    assert_eq!(
        load_terminal_selection_receipt(&path, &original)
            .unwrap()
            .unwrap()
            .record
            .status,
        InboxStatus::Pending
    );
    conn.execute_batch("DROP TRIGGER reject_annotation")
        .unwrap();
    conn.execute(
        "UPDATE session_inbox SET admission_digest=?1 WHERE id=?2",
        params!["0".repeat(64), admission.record.id],
    )
    .unwrap();
    assert!(writer
        .append_inbox_run_prompt("session", 0, &message, "run", admission.record.id)
        .is_err());
    assert!(writer.read_from("session", 0).unwrap().is_empty());
}
#[test]
fn selection_provenance_steers_stream_bounded_refs_and_verified_fork_prefixes() {
    let path = fixture();
    let run = uuid::Uuid::new_v4().to_string();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_run_prompt(
            "session",
            0,
            &Message::User {
                content: "plain".into(),
            },
            &run,
        )
        .unwrap();
    for _ in 0..10 {
        let mut original = intent();
        original.initial_delivery = TerminalSelectionDelivery::Steer;
        original.initial_expected_run_id = Some(run.clone());
        create_terminal_selection_intent(&path, &original).unwrap();
    }
    assert_eq!(
        writer
            .append_pending_inbox_steers("session", &run, 1)
            .unwrap()
            .len(),
        10
    );
    assert_eq!(
        writer
            .append_pending_inbox_steers("session", &run, 1)
            .unwrap()
            .len(),
        10
    );
    let summary = load_terminal_selection_provenance(&path, "session", &[5, 11]).unwrap();
    assert_eq!(summary[0].count, 4);
    assert_eq!(summary[1].count, 10);
    assert_eq!(
        summary[1]
            .recent
            .iter()
            .map(|r| r.message_index)
            .collect::<Vec<_>>(),
        vec![7, 8, 9, 10]
    );
    assert_ne!(summary[0].digest, summary[1].digest);
    let source = writer
        .read_from("session", 0)
        .unwrap()
        .into_iter()
        .map(|(_, m)| m)
        .collect::<Vec<_>>();
    writer.append_batch("fork", 0, &source[..5]).unwrap();
    copy_terminal_selection_attributions(&path, "session", "fork", 5).unwrap();
    assert_eq!(
        load_terminal_selection_references(&path, "fork", 0, 100).unwrap(),
        load_terminal_selection_references(&path, "session", 0, 5).unwrap()
    );
    writer.append_batch("grand", 0, &source[..3]).unwrap();
    copy_terminal_selection_attributions(&path, "fork", "grand", 3).unwrap();
    assert_eq!(
        load_terminal_selection_references(&path, "grand", 0, 100)
            .unwrap()
            .len(),
        2
    );
    assert!(list_session_inbox(&path, "fork").unwrap().is_empty());
    assert!(list_session_inbox(&path, "grand").unwrap().is_empty());
    assert!(load_terminal_selection_references(&path, "fork", 5, 100)
        .unwrap()
        .is_empty());
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute("DELETE FROM sessions WHERE session_id='session'", [])
        .unwrap();
    assert_eq!(
        load_terminal_selection_references(&path, "grand", 0, 100)
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn selection_provenance_tamper_and_snapshot_replacement_cannot_rebind_origin() {
    let path = fixture();
    let original = intent();
    let admission = create_terminal_selection_intent(&path, &original).unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_inbox_run_prompt(
            "session",
            0,
            &Message::User {
                content: admission.record.content,
            },
            "run",
            admission.record.id,
        )
        .unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    let old: String = conn
        .query_row(
            "SELECT event_json FROM thread_events WHERE session_id='session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let mut json: serde_json::Value = serde_json::from_str(&old).unwrap();
    json["nac_transcript_message"]["terminal_selection_attribution"]["source_session_id"] =
        serde_json::json!("fork");
    conn.execute(
        "UPDATE thread_events SET event_json=?1 WHERE session_id='session'",
        params![json.to_string()],
    )
    .unwrap();
    assert!(load_terminal_selection_references(&path, "session", 0, 1).is_err());
    conn.execute(
        "UPDATE thread_events SET event_json=?1 WHERE session_id='session'",
        params![old],
    )
    .unwrap();
    writer
        .replace_snapshot_and_delete_from(
            "session",
            &[Message::User {
                content: "replacement".into(),
            }],
        )
        .unwrap();
    assert!(load_terminal_selection_references(&path, "session", 0, 1)
        .unwrap()
        .is_empty());
}

#[test]
fn selection_provenance_plain_large_snapshot_is_not_stepped_and_ordering_fails_closed() {
    let path = fixture();
    let connection = open_runtime_connection(&path).unwrap();
    let plain = vec![
        Message::User {
            content: "large plain history".repeat(20)
        };
        22_000
    ];
    connection
        .execute(
            "UPDATE sessions SET messages_json=?1 WHERE session_id='session'",
            params![serde_json::to_string(&plain).unwrap()],
        )
        .unwrap();
    SNAPSHOT_STEPS.with(|steps| steps.set(0));
    assert_eq!(
        load_terminal_selection_provenance(&path, "session", &[22_000]).unwrap()[0].count,
        0
    );
    SNAPSHOT_STEPS.with(|steps| assert_eq!(steps.get(), 0));
    let mut query = connection
        .prepare("SELECT 2,'{}' UNION ALL SELECT 0,'{}'")
        .unwrap();
    let mut rows = query.query([]).unwrap();
    let mut expected = 0;
    assert!(next_snapshot_row(&mut rows, &mut expected).is_err());
    let mut query = connection
        .prepare("SELECT 0,'{}' UNION ALL SELECT 2,'{}'")
        .unwrap();
    let mut rows = query.query([]).unwrap();
    let mut expected = 0;
    assert!(next_snapshot_row(&mut rows, &mut expected)
        .unwrap()
        .is_some());
    assert!(next_snapshot_row(&mut rows, &mut expected).is_err());
}
