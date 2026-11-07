//! Characterize physical composition only; NULL origin is not verified input.
//! Ada41/42 origins and selection DDL are pinned to64fc/a15a (unchanged at d7ac).
//! Dev40 base objects are unchanged by our41–49 owners. Reconstruct each owner
//! delta, including pre48 heartbeat shape; never stamp old versions on current DDL.
use super::*;

const DROP_OURS: &str = "DROP TABLE session_completion_marks;
    DROP TABLE session_completion_bindings; DROP TABLE session_completion_occurrences;
    DROP TABLE session_completion_feed; DROP TABLE heartbeat_fresh_destinations;
    DROP TABLE heartbeat_task_launches; DROP TABLE heartbeat_retained_commands;
    DROP TABLE heartbeat_retained_allowance; DROP TABLE heartbeat_commands;
    DROP TABLE heartbeat_occurrences; DROP TABLE heartbeat_schedules;
    DROP TABLE task_followups; DROP TABLE task_followup_delegations;
    DROP TABLE native_task_launches; DROP TABLE peer_goal_starts;
    DROP TABLE session_mcp_refresh; DROP TABLE task_questions;";
const ORIGINS: &str = "ALTER TABLE session_inbox ADD COLUMN completion_source
    TEXT CHECK(completion_source IN ('traditional_child','managed_orchestrator'));
    ALTER TABLE session_inbox ADD COLUMN completion_session_id
    TEXT CHECK((completion_session_id IS NULL)=(completion_source IS NULL));
    ALTER TABLE session_inbox ADD COLUMN completion_generation INTEGER
    CHECK((completion_generation IS NULL)=(completion_source IS NULL))
    CHECK(completion_generation IS NULL OR completion_generation>0);";
const SELECTION: &str = r#"CREATE TABLE IF NOT EXISTS selection_questions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             question_id TEXT NOT NULL UNIQUE CHECK (length(question_id) = 36),
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             request_key TEXT NOT NULL CHECK (length(request_key) = 36),
             request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
             source_message_index INTEGER NOT NULL CHECK (source_message_index >= 0),
             context_json TEXT NOT NULL,
             model_json TEXT NOT NULL,
             status TEXT NOT NULL CHECK (status IN
                 ('pending', 'answered', 'failed', 'canceled', 'interrupted')),
             answer TEXT,
             answer_truncated INTEGER NOT NULL DEFAULT 0 CHECK (answer_truncated IN (0, 1)),
             error TEXT,
             tool_call_attempted INTEGER NOT NULL DEFAULT 0
                 CHECK (tool_call_attempted IN (0, 1)),
             usage_json TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             completed_at TEXT,
             CHECK ((status = 'pending') = (completed_at IS NULL)),
             CHECK (status = 'answered' OR answer IS NULL),
             UNIQUE (session_id, request_key)
         );
         CREATE INDEX IF NOT EXISTS idx_selection_questions_session
             ON selection_questions(session_id, id);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_selection_questions_one_pending
             ON selection_questions(session_id) WHERE status = 'pending';"#;

fn rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut query = conn
        .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
        .unwrap();
    let width = query.column_count();
    query
        .query_map([], |row| (0..width).map(|i| row.get(i)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}
fn catalog(conn: &Connection) -> Vec<(String, String)> {
    conn.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}
fn seed_child(path: &Path, child: &str) -> i64 {
    create_traditional_child_relationship(path, "parent", child, GENERAL_CHILD_PROFILE, child)
        .unwrap();
    begin_traditional_child_run(
        path,
        child,
        "run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    settle_traditional_child_run(
        path,
        child,
        "run",
        TraditionalChildTerminal {
            status: TraditionalChildStatus::Completed,
            report: Some("retained result".into()),
            failure: None,
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap()
    .child
    .completion_inbox_id
    .unwrap()
}

#[test]
fn ada41_42_and_mixed43_keep_origins_nulls_questions_receipts_and_atomicity() {
    // Both41/42 histories, plus both Ada histories accepted by old ours43.
    for (version, selection) in [(41, false), (42, true), (43, false), (43, true)] {
        let root = std::env::temp_dir().join(format!("nac-lineage-{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        initialize(&path).unwrap();
        for id in ["parent", "explicit", "cleared", "old-producer"] {
            insert_test_session(&path, id);
        }
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute("UPDATE sessions SET behavior='direct'", [])
            .unwrap();
        conn.execute_batch(ORIGINS).unwrap();
        drop(conn);
        let explicit = seed_child(&path, "explicit");
        let cleared = seed_child(&path, "cleared");
        let conn = open_runtime_connection(&path).unwrap();
        for (id, child) in [(explicit, "explicit"), (cleared, "cleared")] {
            conn.execute(
                "UPDATE session_inbox SET completion_source='traditional_child',
                completion_session_id=?2,completion_generation=1 WHERE id=?1",
                params![id, child],
            )
            .unwrap();
        }
        conn.execute(
            "UPDATE session_inbox SET completion_source=NULL,
            completion_session_id=NULL,completion_generation=NULL WHERE id=?1",
            [cleared],
        )
        .unwrap();
        drop(conn);
        // The unchanged old producer writes only original columns even though
        // origin columns are present. Its exact receipt proves no unique intent.
        let unknown = seed_child(&path, "old-producer");
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute_batch(DROP_OURS).unwrap();
        if version == 43 {
            task_followups::create_tables(&conn).unwrap();
            native_task_launches::create_tables(&conn).unwrap();
            peer_goal_starts::create_tables(&conn).unwrap();
        }
        if selection {
            conn.execute_batch(SELECTION).unwrap();
            conn.execute(
                "INSERT INTO selection_questions(question_id,session_id,request_key,
                request_digest,source_message_index,context_json,model_json,status,answer,
                created_at,updated_at,completed_at)
                VALUES(?1,'parent',?2,?3,7,'{\"retained\":true}','{\"model\":\"old\"}',
                'answered','retained answer','created','updated','completed')",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    uuid::Uuid::new_v4().to_string(),
                    "a".repeat(64)
                ],
            )
            .unwrap();
        }
        // No ours46/47/48/49 artifacts survive in either Ada predecessor.
        for table in [
            "task_questions",
            "task_followup_delegations",
            "heartbeat_schedules",
            "session_mcp_refresh",
            "session_completion_feed",
        ] {
            assert!(!catalog(&conn).iter().any(|(name, _)| name == table));
        }
        if version != 43 {
            assert!(!catalog(&conn).iter().any(|(n, _)| n == "task_followups"));
        }
        conn.pragma_update(None, "user_version", version).unwrap();
        let kept = [
            "sessions",
            "session_inbox",
            "traditional_children",
            "traditional_child_terminal_receipts",
            "sqlite_sequence",
        ];
        let before = kept.map(|table| rows(&conn, table));
        let old_catalog = catalog(&conn);
        let selected = selection.then(|| rows(&conn, "selection_questions"));
        drop(conn);
        let reached_commit = std::cell::Cell::new(false);
        assert!(initialize_with_hooks(
            &path,
            || {},
            || {},
            || {
                reached_commit.set(true);
                Err(anyhow!("lineage rollback"))
            }
        )
        .is_err());
        assert!(
            reached_commit.get(),
            "lineage {version} reached before_commit"
        );
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            version
        );
        assert_eq!(catalog(&conn), old_catalog);
        assert_eq!(kept.map(|t| rows(&conn, t)), before);
        drop(conn);
        initialize(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        // sqlite_sequence gains only the newly created empty ledger entry if
        // SQLite chooses one; existing sequence identities never move.
        for (table, old) in kept.into_iter().zip(&before) {
            assert_eq!(rows(&conn, table), *old, "{version} {table}");
        }
        let origin = |id| {
            conn.query_row(
                "SELECT completion_source,completion_session_id,completion_generation
            FROM session_inbox WHERE id=?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .unwrap()
        };
        assert_eq!(
            origin(explicit),
            (
                Some("traditional_child".into()),
                Some("explicit".into()),
                Some(1)
            )
        );
        assert_eq!(origin(cleared), (None, None, None));
        assert_eq!(origin(unknown), (None, None, None));
        if let Some(old) = selected {
            assert_eq!(rows(&conn, "selection_questions"), old);
        }
        assert!(catalog(&conn).iter().any(|(n, _)| n == "task_questions"));
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
                .unwrap(),
            0
        );
        assert!(rows(&conn, "session_completion_occurrences").is_empty());
        let after = catalog(&conn);
        drop(conn);
        initialize(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        assert_eq!(catalog(&conn), after);
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }
}
