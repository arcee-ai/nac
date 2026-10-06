use super::*;

fn fixture(label: &str) -> (PathBuf, Arc<SessionOperationLease>, ShellCommandSnapshot) {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-human-journal-{label}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id='session'",
            [],
        )
        .unwrap();
    let lease = Arc::new(SessionOperationLease::try_acquire(&path, "session").unwrap());
    let snapshot = ShellCommandSnapshot {
        request_id: "request".into(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        command: "printf value".into(),
        timeout_ms: 30_000,
        state: ShellCommandState::Accepted,
        accepted_at_epoch_ms: 1,
        finished_at_epoch_ms: None,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        diagnostic: None,
        output_id: None,
        transcript_index: None,
    };
    (path, lease, snapshot)
}

#[test]
fn human_shell_result_reconciles_lost_commit_ack_and_fences_stale_writers() {
    let (path, lease, mut command) = fixture("receipt");
    accept_shell_command(&path, "session", "digest", &command, &lease).unwrap();
    command.state = ShellCommandState::Started;
    start_shell_command(&path, "session", &command, &lease).unwrap();
    let writer =
        TranscriptLogWriter::for_run(&path, "session", &command.operation_id, &lease).unwrap();
    writer.lose_next_append_ack_for_test();
    command.state = ShellCommandState::Completed;
    command.stdout = "value".into();
    let uncertain = writer
        .finish_shell_command("session", &command)
        .unwrap_err();
    assert!(matches!(
        uncertain.downcast_ref::<TranscriptAppendError>(),
        Some(TranscriptAppendError::CommitUncertain)
    ));
    let first = writer.finish_shell_command("session", &command).unwrap();
    let replay = writer.finish_shell_command("session", &command).unwrap();
    assert_eq!(first, replay);
    assert_eq!(list_shell_commands(&path, "session").unwrap(), vec![first]);
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 1);
    drop(lease);
    let new_owner = Arc::new(SessionOperationLease::try_acquire(&path, "session").unwrap());
    assert!(writer.finish_shell_command("session", &command).is_err());
    let fresh =
        TranscriptLogWriter::for_run(&path, "session", "wrong-operation", &new_owner).unwrap();
    assert!(fresh.finish_shell_command("session", &command).is_err());
}

#[test]
fn human_shell_schema_upgrade_from_32_preserves_existing_sessions() {
    let (path, lease, _) = fixture("migration");
    drop(lease);
    let connection = open_runtime_connection(&path).unwrap();
    let before: String = connection
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id='session'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    connection
        .execute_batch("DROP TABLE human_shell_operations; PRAGMA user_version=32;")
        .unwrap();
    drop(connection);
    crate::store::initialize(&path).unwrap();
    assert_eq!(crate::store::schema_version(), 33);
    let connection = open_runtime_connection(&path).unwrap();
    let after: String = connection
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id='session'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
    assert!(list_shell_commands(&path, "session").unwrap().is_empty());
}
