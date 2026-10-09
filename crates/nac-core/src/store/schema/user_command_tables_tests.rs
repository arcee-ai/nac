use super::*;

#[test]
fn v32_store_adds_durable_user_commands_without_touching_existing_rows() {
    let path = temp_store_path("v32_user_commands");
    initialize(&path).unwrap();
    let legacy = Connection::open(&path).unwrap();
    insert_legacy_session(&legacy, "legacy-session");
    legacy
        .execute(
            "INSERT INTO thread_events (id, session_id, thread_name, event_json, created_at)
             VALUES (7, 'legacy-session', '__orchestrator__', '{\"legacy\":true}', 'created')",
            [],
        )
        .unwrap();
    legacy
        .execute_batch("DROP TABLE session_user_commands; PRAGMA user_version = 32;")
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    migrated.pragma_update(None, "foreign_keys", true).unwrap();
    let version: i64 = migrated
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 33);
    assert_eq!(
        table_columns(&migrated, "session_user_commands"),
        [
            "session_id",
            "request_id",
            "payload_digest",
            "command",
            "timeout_ms",
            "state",
            "result_json",
            "reason",
            "cwd",
            "process_started",
            "created_at_epoch_ms",
            "finished_at_epoch_ms",
            "transcript_message_id",
        ]
    );
    assert_session_cascade(&migrated, "session_user_commands");
    let legacy_event: String = migrated
        .query_row(
            "SELECT event_json FROM thread_events WHERE id = 7",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(legacy_event, "{\"legacy\":true}");

    let insert = "INSERT INTO session_user_commands
         (session_id, request_id, payload_digest, command, timeout_ms, state,
          created_at_epoch_ms, transcript_message_id)
         VALUES ('legacy-session', ?1, 'digest', 'ls', 30000, ?2, 1, ?3)";
    migrated
        .execute(insert, params!["completed", "completed", 7])
        .unwrap();
    migrated
        .execute(insert, params!["first", "admitted", None::<i64>])
        .unwrap();
    assert!(migrated
        .execute(insert, params!["second", "executing", None::<i64>])
        .is_err());
    migrated
        .execute("DELETE FROM thread_events WHERE id = 7", [])
        .unwrap();
    let message_id: Option<i64> = migrated
        .query_row(
            "SELECT transcript_message_id FROM session_user_commands WHERE request_id = 'completed'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(message_id, None);
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
