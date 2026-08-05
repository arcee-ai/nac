use super::*;

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_schema_{label}_{unique}"))
        .join("store.db")
}

fn create_legacy_base(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE sessions (
             session_id TEXT PRIMARY KEY,
             cwd TEXT NOT NULL,
             store_path TEXT NOT NULL,
             model TEXT NOT NULL,
             base_url TEXT NOT NULL,
             sandbox_json TEXT,
             messages_json TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE threads (
             name TEXT NOT NULL,
             session_id TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             PRIMARY KEY (name, session_id)
         );
         CREATE TABLE episodes (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             thread_name TEXT NOT NULL,
             session_id TEXT NOT NULL,
             action TEXT NOT NULL,
             content TEXT NOT NULL,
             created_at TEXT NOT NULL,
             FOREIGN KEY (thread_name, session_id) REFERENCES threads(name, session_id)
         );",
    )
    .unwrap();
}

fn insert_legacy_session(conn: &Connection, session_id: &str) {
    conn.execute(
        "INSERT INTO sessions
             (session_id, cwd, store_path, model, base_url, messages_json,
              created_at, updated_at)
         VALUES (?1, '/tmp/project', '/tmp/store.db', 'legacy-model',
                 'https://example.invalid', '[]',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![session_id],
    )
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
fn insert_raw_checkpoint(
    conn: &Connection,
    summary: &str,
    tail_start: i64,
    source_digest: &[u8],
    system_digest: &[u8],
    policy_version: i64,
    old_estimate: i64,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    new_estimate: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO orchestrator_compaction_checkpoints
             (session_id, summary, tail_start_message_index,
              source_prefix_sha256, system_policy_sha256, prompt_policy_version,
              old_context_estimate, summary_prompt_tokens,
              summary_completion_tokens, new_context_estimate, created_at)
         VALUES ('owned', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'created')",
        params![
            summary,
            tail_start,
            source_digest,
            system_digest,
            policy_version,
            old_estimate,
            prompt_tokens,
            completion_tokens,
            new_estimate,
        ],
    )
}

fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap();
    statement
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

fn assert_session_cascade(conn: &Connection, table: &str) {
    let mut statement = conn
        .prepare(&format!("PRAGMA foreign_key_list({table})"))
        .unwrap();
    let foreign_keys = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(6)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(
        foreign_keys,
        vec![(
            "sessions".to_string(),
            "session_id".to_string(),
            "session_id".to_string(),
            "CASCADE".to_string(),
        )],
        "unexpected foreign key for {table}"
    );
}

fn assert_current_schema(conn: &Connection) {
    assert!(table_columns(conn, "sessions")
        .iter()
        .any(|column| column == "orchestrator_compaction_threshold"));
    assert_eq!(
        table_columns(conn, "thread_steering"),
        [
            "id",
            "session_id",
            "thread_name",
            "dispatch_id",
            "instruction",
            "status",
            "created_at",
            "claimed_at",
            "delivered_at",
            "expired_at"
        ]
    );
    assert_eq!(
        table_columns(conn, "thread_events"),
        [
            "id",
            "session_id",
            "thread_name",
            "event_json",
            "created_at"
        ]
    );
    for table in ["thread_steering", "thread_events"] {
        assert_session_cascade(conn, table);
    }
    assert_eq!(
        table_columns(conn, "orchestrator_compaction_checkpoints"),
        [
            "id",
            "session_id",
            "previous_checkpoint_id",
            "summary",
            "tail_start_message_index",
            "source_prefix_sha256",
            "system_policy_sha256",
            "prompt_policy_version",
            "old_context_estimate",
            "summary_prompt_tokens",
            "summary_completion_tokens",
            "new_context_estimate",
            "created_at",
        ]
    );
    let checkpoint_foreign_keys = conn
        .prepare("PRAGMA foreign_key_list(orchestrator_compaction_checkpoints)")
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(6)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(checkpoint_foreign_keys
        .iter()
        .any(|(_, table, from, to, on_delete)| table == "sessions"
            && from == "session_id"
            && to == "session_id"
            && on_delete == "CASCADE"));
    let self_foreign_keys = checkpoint_foreign_keys
        .iter()
        .filter(|(_, table, _, _, on_delete)| {
            table == "orchestrator_compaction_checkpoints" && on_delete == "CASCADE"
        })
        .map(|(id, _, from, to, _)| (*id, from.as_str(), to.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(self_foreign_keys.len(), 2);
    assert_eq!(self_foreign_keys[0].0, self_foreign_keys[1].0);
    assert!(self_foreign_keys
        .iter()
        .any(|(_, from, to)| *from == "session_id" && *to == "session_id"));
    assert!(self_foreign_keys
        .iter()
        .any(|(_, from, to)| { *from == "previous_checkpoint_id" && *to == "id" }));
    let latest_index_exists: bool = conn
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM sqlite_master
                 WHERE type = 'index'
                   AND name = 'idx_orchestrator_compaction_checkpoints_latest'
             )",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(latest_index_exists);

    let violation_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(violation_count, 0);
}

#[test]
fn main_v0_store_migrates_directly_to_v3() {
    let path = temp_store_path("main_v0");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let legacy = Connection::open(&path).unwrap();
    create_legacy_base(&legacy);
    insert_legacy_session(&legacy, "legacy-session");
    legacy
        .execute_batch(
            "PRAGMA user_version = 0;
             INSERT INTO threads
                 (name, session_id, created_at, updated_at)
             VALUES ('legacy-thread', 'legacy-session',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO episodes
                 (thread_name, session_id, action, content, created_at)
             VALUES ('legacy-thread', 'legacy-session', 'inspect', 'preserved',
                     '2026-01-01T00:00:00Z');",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();

    let migrated = Connection::open(&path).unwrap();
    let version: i64 = migrated
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, STORE_SCHEMA_VERSION);
    assert_current_schema(&migrated);
    let episode: String = migrated
        .query_row("SELECT content FROM episodes", [], |row| row.get(0))
        .unwrap();
    assert_eq!(episode, "preserved");
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn partial_v1_tables_at_version_zero_are_rebuilt() {
    let path = temp_store_path("partial_v1_v0");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let legacy = Connection::open(&path).unwrap();
    create_legacy_base(&legacy);
    insert_legacy_session(&legacy, "owned");
    legacy
        .execute_batch(
            "PRAGMA user_version = 0;
              CREATE TABLE thread_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  session_id TEXT NOT NULL,
                  thread_name TEXT NOT NULL,
                  event_json TEXT NOT NULL,
                  created_at TEXT NOT NULL
              );
             INSERT INTO thread_events
                 (id, session_id, thread_name, event_json, created_at)
             VALUES (8, 'owned', 'pre-episode-worker',
                     '{\"type\":\"thread_started\",\"name\":\"pre-episode-worker\",\"action\":\"legacy action\",\"source_threads\":[]}',
                     'created');",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();

    let migrated = Connection::open(&path).unwrap();
    assert_current_schema(&migrated);
    let event: (i64, String) = migrated
        .query_row("SELECT id, thread_name FROM thread_events", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    assert_eq!(event, (8, "pre-episode-worker".to_string()));
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn v1_to_v3_preserves_owned_rows_drops_orphans_and_sequences() {
    let path = temp_store_path("v1");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let legacy = Connection::open(&path).unwrap();
    create_legacy_base(&legacy);
    insert_legacy_session(&legacy, "owned");
    legacy
        .execute_batch(
            "PRAGMA foreign_keys = OFF;
             PRAGMA user_version = 1;
             CREATE TABLE thread_steering (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,
                 thread_name TEXT NOT NULL,
                 instruction TEXT NOT NULL,
                 status TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 delivered_at TEXT,
                 expired_at TEXT
             );
             CREATE TABLE thread_events (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,
                 thread_name TEXT NOT NULL,
                 event_json TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );
             INSERT INTO thread_steering VALUES
                 (7, 'owned', 'worker', 'queued instruction', 'queued',
                  'created-7', NULL, NULL);
             INSERT INTO thread_steering VALUES
                 (9, 'owned', 'worker', 'delivered instruction', 'delivered',
                  'created-9', 'delivered-9', NULL);
             INSERT INTO thread_steering VALUES
                 (11, 'owned', 'worker', 'expired instruction', 'expired',
                  'created-11', NULL, 'expired-11');
             INSERT INTO thread_steering VALUES
                 (13, 'orphan', 'worker', 'orphan instruction', 'queued',
                  'created-13', NULL, NULL);
             INSERT INTO thread_events VALUES
                 (20, 'owned', 'worker-without-thread-row',
                  '{\"type\":\"tool_call_started\",\"thread_name\":\"worker-without-thread-row\",\"call_id\":\"call-20\",\"name\":\"exec_command\",\"args_preview\":\"CANARY_COMMAND\",\"args_detail\":\"{\\\"cmd\\\":\\\"echo safe_cmd\\\",\\\"workdir\\\":\\\"/safe/work\\\"}\"}',
                  'created-20');
             INSERT INTO thread_events VALUES
                 (21, 'owned', 'worker-without-thread-row',
                  '{\"type\":\"model_call_started\",\"thread_name\":\"worker-without-thread-row\",\"iteration\":1}',
                  'created-21');
             INSERT INTO thread_events VALUES
                 (22, 'owned', 'worker-without-thread-row', '{malformed', 'created-22');
             INSERT INTO thread_events VALUES
                 (25, 'orphan', 'worker', '{\"secret\":true}', 'created-25');",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();

    let migrated = open_runtime_connection(&path).unwrap();
    assert_current_schema(&migrated);

    let steering = migrated
        .prepare(
            "SELECT id, dispatch_id, status, claimed_at, delivered_at, expired_at
             FROM thread_steering ORDER BY id",
        )
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(steering.len(), 3);
    assert_eq!(steering[0].0, 7);
    assert_eq!(steering[0].1, "legacy-v1:7");
    assert_eq!(steering[0].2, "expired");
    assert!(steering[0].3.is_none());
    assert!(steering[0].4.is_none());
    assert!(steering[0].5.is_some());
    assert_eq!(
        &steering[1],
        &(
            9,
            "legacy-v1:9".to_string(),
            "delivered".to_string(),
            Some("delivered-9".to_string()),
            Some("delivered-9".to_string()),
            None
        )
    );
    assert_eq!(steering[2].0, 11);
    assert_eq!(steering[2].2, "expired");
    assert_eq!(steering[2].5.as_deref(), Some("expired-11"));

    let event: (i64, String, String) = migrated
        .query_row(
            "SELECT id, thread_name, event_json FROM thread_events",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(event.0, 20);
    assert_eq!(event.1, "worker-without-thread-row");
    assert!(!event.2.contains("CANARY_COMMAND"));
    let migrated_event: crate::events::AgentEvent = serde_json::from_str(&event.2).unwrap();
    assert!(matches!(
        migrated_event,
        crate::events::AgentEvent::ToolCallStarted {
            call_id,
            args_preview,
            args_detail: None,
            key_arg_preview,
            ..
        } if call_id == "call-20"
            && args_preview.contains("/safe/work")
            && args_preview.contains("execute")
            && key_arg_preview.as_deref() == Some("echo safe_cmd")
    ));
    let migrated_event_count: i64 = migrated
        .query_row("SELECT COUNT(*) FROM thread_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!(migrated_event_count, 1);

    migrated
        .execute(
            "INSERT INTO thread_steering
                 (session_id, thread_name, dispatch_id, instruction, status, created_at)
             VALUES ('owned', 'worker', 'next-dispatch', 'next', 'queued', 'next')",
            [],
        )
        .unwrap();
    assert!(migrated.last_insert_rowid() > 13);
    migrated
        .execute(
            "INSERT INTO thread_events
                 (session_id, thread_name, event_json, created_at)
             VALUES ('owned', 'worker', '{}', 'next')",
            [],
        )
        .unwrap();
    assert!(migrated.last_insert_rowid() > 25);

    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_rows_survive_thread_events_rebuild_migration() {
    // Pins the invariant that the thread_events sanitize-drop rebuild (and any
    // future rebuild-migration) carries transcript log rows through verbatim.
    // Current v3 DBs never re-run this migration, but the assertion keeps the
    // pattern honest for future rebuilds.
    let path = temp_store_path("transcript_survival");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let legacy = Connection::open(&path).unwrap();
    create_legacy_base(&legacy);
    insert_legacy_session(&legacy, "owned");
    let transcript_zero = crate::store::encode_transcript_log_entry(
        0,
        &crate::types::Message::User {
            content: "prompt".to_string(),
        },
    )
    .unwrap();
    let transcript_one = crate::store::encode_transcript_log_entry(
        1,
        &crate::types::Message::Assistant {
            content: Some("answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
        },
    )
    .unwrap();
    legacy
        .execute_batch(
            "PRAGMA user_version = 1;
             CREATE TABLE thread_events (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,
                 thread_name TEXT NOT NULL,
                 event_json TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );",
        )
        .unwrap();
    for (id, thread_name, event_json) in [
        (30, "__orchestrator__", transcript_zero.as_str()),
        (31, "__orchestrator__", transcript_one.as_str()),
        (
            32,
            "worker",
            "{\"type\":\"thread_started\",\"name\":\"worker\",\"action\":\"legacy action\",\"source_threads\":[]}",
        ),
        (33, "worker", "{malformed"),
    ] {
        legacy
            .execute(
                "INSERT INTO thread_events
                     (id, session_id, thread_name, event_json, created_at)
                 VALUES (?1, 'owned', ?2, ?3, 'created')",
                params![id, thread_name, event_json],
            )
            .unwrap();
    }
    drop(legacy);

    initialize(&path).unwrap();

    let migrated = open_runtime_connection(&path).unwrap();
    assert_current_schema(&migrated);
    let rows = migrated
        .prepare("SELECT id, thread_name, event_json FROM thread_events ORDER BY id")
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    // Transcript rows survive byte-identical; the valid AgentEvent row is
    // sanitized and kept; the malformed row is dropped.
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[0],
        (30, "__orchestrator__".to_string(), transcript_zero)
    );
    assert_eq!(
        rows[1],
        (31, "__orchestrator__".to_string(), transcript_one)
    );
    assert_eq!(rows[2].0, 32);
    assert_eq!(rows[2].1, "worker");
    assert!(serde_json::from_str::<crate::events::AgentEvent>(&rows[2].2).is_ok());
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn v2_to_v3_adds_threshold_and_empty_checkpoint_storage() {
    let path = temp_store_path("v2");
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    insert_legacy_session(&conn, "owned");
    conn.execute(
        "INSERT INTO thread_events
             (session_id, thread_name, event_json, created_at)
         VALUES ('owned', 'worker', '{legacy-v2-event', 'created')",
        [],
    )
    .unwrap();
    let event_id = conn.last_insert_rowid();
    conn.execute_batch(
        "DROP TABLE orchestrator_compaction_checkpoints;
         ALTER TABLE sessions DROP COLUMN orchestrator_compaction_threshold;
         PRAGMA user_version = 2;",
    )
    .unwrap();
    drop(conn);

    initialize(&path).unwrap();

    let migrated = open_runtime_connection(&path).unwrap();
    assert_current_schema(&migrated);
    let event: (i64, String) = migrated
        .query_row("SELECT id, event_json FROM thread_events", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    assert_eq!(event, (event_id, "{legacy-v2-event".to_string()));
    let checkpoint_count: i64 = migrated
        .query_row(
            "SELECT COUNT(*) FROM orchestrator_compaction_checkpoints",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(checkpoint_count, 0);
    let threshold: Option<i64> = migrated
        .query_row(
            "SELECT orchestrator_compaction_threshold FROM sessions WHERE session_id = 'owned'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(threshold, None);
    for invalid in ["0", "-1", "'not-an-integer'"] {
        assert!(migrated
            .execute(
                &format!(
                    "UPDATE sessions SET orchestrator_compaction_threshold = {invalid} WHERE session_id = 'owned'"
                ),
                [],
            )
            .is_err());
    }
    assert!(migrated
        .execute(
            "UPDATE sessions SET orchestrator_compaction_threshold = ?1 WHERE session_id = 'owned'",
            params![(crate::MAX_SUPPORTED_TOKEN_COUNT + 1) as i64],
        )
        .is_err());
    migrated
        .execute(
            "UPDATE sessions SET orchestrator_compaction_threshold = ?1 WHERE session_id = 'owned'",
            params![crate::MAX_SUPPORTED_TOKEN_COUNT as i64],
        )
        .unwrap();
    migrated
        .execute(
            "UPDATE sessions SET orchestrator_compaction_threshold = 8192 WHERE session_id = 'owned'",
            [],
        )
        .unwrap();
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn checkpoint_table_enforces_completed_row_constraints() {
    let path = temp_store_path("checkpoint_constraints");
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    insert_legacy_session(&conn, "owned");
    let digest = [7_u8; 32];
    let short_digest = [7_u8; 31];

    insert_raw_checkpoint(
        &conn,
        "exact summary",
        0,
        &digest,
        &digest,
        1,
        0,
        None,
        None,
        0,
    )
    .unwrap();
    assert!(
        insert_raw_checkpoint(&conn, "   ", 0, &digest, &digest, 1, 0, None, None, 0,).is_err()
    );
    assert!(
        insert_raw_checkpoint(&conn, "summary", -1, &digest, &digest, 1, 0, None, None, 0,)
            .is_err()
    );
    assert!(insert_raw_checkpoint(
        &conn,
        "summary",
        0,
        &short_digest,
        &digest,
        1,
        0,
        None,
        None,
        0,
    )
    .is_err());
    assert!(insert_raw_checkpoint(
        &conn,
        "summary",
        0,
        &digest,
        &short_digest,
        1,
        0,
        None,
        None,
        0,
    )
    .is_err());
    insert_raw_checkpoint(
        &conn,
        "maximum supported counts",
        0,
        &digest,
        &digest,
        1,
        crate::MAX_SUPPORTED_TOKEN_COUNT as i64,
        Some(crate::MAX_SUPPORTED_TOKEN_COUNT as i64),
        Some(crate::MAX_SUPPORTED_TOKEN_COUNT as i64),
        crate::MAX_SUPPORTED_TOKEN_COUNT as i64,
    )
    .unwrap();
    let too_large = (crate::MAX_SUPPORTED_TOKEN_COUNT + 1) as i64;
    for (policy, old, prompt, completion, new) in [
        (0, 0, None, None, 0),
        (i64::from(u32::MAX) + 1, 0, None, None, 0),
        (1, -1, None, None, 0),
        (1, 0, Some(-1), None, 0),
        (1, 0, None, Some(-1), 0),
        (1, 0, None, None, -1),
        (1, too_large, None, None, 0),
        (1, 0, Some(too_large), None, 0),
        (1, 0, None, Some(too_large), 0),
        (1, 0, None, None, too_large),
    ] {
        assert!(insert_raw_checkpoint(
            &conn, "summary", 0, &digest, &digest, policy, old, prompt, completion, new,
        )
        .is_err());
    }
    let row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestrator_compaction_checkpoints",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(row_count, 2);
    drop(conn);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn future_schema_version_is_rejected_without_changes() {
    let path = temp_store_path("future");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let future = Connection::open(&path).unwrap();
    future.pragma_update(None, "user_version", 8).unwrap();
    drop(future);

    let error = initialize(&path).unwrap_err();
    assert!(error
        .to_string()
        .contains("unsupported store schema version 8"));
    let unchanged = Connection::open(&path).unwrap();
    let version: i64 = unchanged
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 8);
    assert!(!table_exists(&unchanged, "sessions").unwrap());
    drop(unchanged);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn opening_v3_store_is_idempotent() {
    let path = temp_store_path("idempotent");
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    insert_legacy_session(&conn, "owned");
    conn.execute(
        "INSERT INTO thread_events
             (session_id, thread_name, event_json, created_at)
         VALUES ('owned', 'worker', '{\"type\":\"thread_started\"}', 'created')",
        [],
    )
    .unwrap();
    let event_id = conn.last_insert_rowid();
    drop(conn);

    initialize(&path).unwrap();

    let reopened = open_runtime_connection(&path).unwrap();
    assert_current_schema(&reopened);
    let stored_id: i64 = reopened
        .query_row("SELECT id FROM thread_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stored_id, event_id);
    drop(reopened);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
