use super::*;

// Frozen491/e4da3be receipt DDL, independent of current migration constructors.
const HISTORICAL_43_RECEIPTS: &str = r#"CREATE TABLE IF NOT EXISTS task_followups (
            caller_session_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            target_session_id TEXT NOT NULL,
            request_json TEXT NOT NULL,
            resolved_delivery TEXT NOT NULL CHECK (resolved_delivery IN ('queue','steer')),
            admitted_run_id TEXT,
            inbox_item_id INTEGER NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (caller_session_id, request_id)
        );
CREATE TABLE IF NOT EXISTS native_task_launches (
        request_id TEXT PRIMARY KEY, caller_session_id TEXT NOT NULL,
        project_id TEXT NOT NULL, request_json TEXT NOT NULL,
        source_cwd TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
        retained INTEGER NOT NULL CHECK(retained IN (0,1)),
        phase TEXT NOT NULL CHECK(phase IN ('reserved','preparing_runtime','ready','failed','cancelled')),
        error TEXT, first_input_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS peer_goal_starts (
            caller_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 160),
            target_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            request_json TEXT NOT NULL,
            response_json TEXT NOT NULL,
            PRIMARY KEY(caller_session_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS idx_peer_goal_starts_target ON peer_goal_starts(target_session_id);"#;
fn receipt_catalog(conn: &Connection) -> Vec<(String, Option<String>)> {
    conn.prepare(
        "SELECT name,sql FROM sqlite_master WHERE tbl_name IN
        ('task_followups','native_task_launches','peer_goal_starts') ORDER BY name",
    )
    .unwrap()
    .query_map([], |r| {
        Ok((
            r.get(0)?,
            r.get::<_, Option<String>>(1)?
                .map(|sql| sql.split_whitespace().collect::<String>()),
        ))
    })
    .unwrap()
    .collect::<rusqlite::Result<_>>()
    .unwrap()
}
fn receipt_rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let columns = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
        .into_iter()
        .filter(|c| c != "delegation_id")
        .collect::<Vec<_>>();
    conn.prepare(&format!(
        "SELECT {} FROM {table} ORDER BY 1,2",
        columns.join(",")
    ))
    .unwrap()
    .query_map([], |r| (0..columns.len()).map(|i| r.get(i)).collect())
    .unwrap()
    .collect::<rusqlite::Result<_>>()
    .unwrap()
}

fn absent(conn: &Connection) -> bool {
    conn.query_row("SELECT count(*)=0 FROM sqlite_master WHERE name IN ('heartbeat_schedules','heartbeat_occurrences','heartbeat_commands')",[],|row|row.get(0)).unwrap()
}

#[test]
fn schema_44_heartbeats_upgrade_actual_43_atomically_and_preserve_all_supplier_receipts() {
    let root =
        std::env::temp_dir().join(format!("nac-heartbeat-migration-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    initialize(&path).unwrap();
    for id in ["caller", "target"] {
        insert_test_session(&path, id);
    }
    let inbox = create_session_inbox_item(
        &path,
        "target",
        InboxDelivery::Queue,
        "existing human guidance",
        None,
        None,
    )
    .unwrap();
    let retained;
    {
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('caller','followup','target','{}','queue',?1,'now')",[inbox.id]).unwrap();
        conn.execute("INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at) VALUES('launch','caller','project','{}','/repo','launched',0,'reserved','now','now')",[]).unwrap();
        conn.execute("INSERT INTO peer_goal_starts(caller_session_id,request_id,target_session_id,request_json,response_json) VALUES('caller','start','target','canonical arguments','original admission')",[]).unwrap();
        // 44 adds only these tables/indexes. Removing them reconstructs the
        // verified supplier43 catalog, with actual41/42/43 receipts retained.
        conn.execute_batch("DROP TABLE session_completion_marks; DROP TABLE session_completion_bindings; DROP TABLE session_completion_occurrences; DROP TABLE session_completion_feed; DROP TABLE heartbeat_fresh_destinations; DROP TABLE heartbeat_task_launches; DROP TABLE heartbeat_retained_commands; DROP TABLE heartbeat_retained_allowance; DROP TABLE heartbeat_commands; DROP TABLE heartbeat_occurrences; DROP TABLE heartbeat_schedules; DROP TABLE session_mcp_refresh; DROP TABLE task_questions; ALTER TABLE task_followups DROP COLUMN delegation_id; DROP TABLE task_followup_delegations; PRAGMA user_version=43;").unwrap();
        let expected = Connection::open_in_memory().unwrap();
        expected.execute_batch(HISTORICAL_43_RECEIPTS).unwrap();
        assert_eq!(receipt_catalog(&conn), receipt_catalog(&expected));
        for table in [
            "session_mcp_refresh",
            "task_questions",
            "task_followup_delegations",
            "heartbeat_fresh_destinations",
            "session_completion_feed",
        ] {
            assert!(!table_exists(&conn, table).unwrap());
        }
        retained = ["task_followups", "native_task_launches", "peer_goal_starts"]
            .map(|t| receipt_rows(&conn, t));
    }
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("before heartbeat migration commit"))
    )
    .is_err());
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            43
        );
        assert!(
            absent(&conn),
            "failed migration must roll back all three tables"
        );
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT response_json FROM peer_goal_starts WHERE request_id='start'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            "original admission"
        );
    }
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    {
        let conn = open_runtime_connection(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            STORE_SCHEMA_VERSION
        );
        assert_eq!(
            ["task_followups", "native_task_launches", "peer_goal_starts"]
                .map(|t| receipt_rows(&conn, t)),
            retained
        );
        for table in ["task_followups", "native_task_launches", "peer_goal_starts"] {
            assert_eq!(
                conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap(),
                1
            );
        }
        for table in [
            "heartbeat_schedules",
            "heartbeat_occurrences",
            "heartbeat_commands",
        ] {
            assert_eq!(
                conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap(),
                0,
                "migration must not create or wake work"
            );
        }
    }
    assert_eq!(
        load_session_inbox_item(&path, "target", inbox.id).unwrap(),
        inbox
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn schema_44_heartbeat_constraints_keep_one_pending_and_active_receipt_and_cascade_deleted_target()
{
    let root = std::env::temp_dir().join(format!(
        "nac-heartbeat-constraints-{}",
        uuid::Uuid::new_v4()
    ));
    let path = root.join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "session");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES('schedule','session',1,'active','{}','{}',0,60000,0,0)",[]).unwrap();
    let insert="INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id) VALUES(?1,'schedule','session',1,60000,60000,1,'interval',?2,'{}',?3)";
    conn.execute(insert, params!["one", "pending", "receipt-one"])
        .unwrap();
    assert!(conn
        .execute(insert, params!["two", "pending", "receipt-two"])
        .is_err());
    conn.execute("UPDATE heartbeat_occurrences SET state='admitted',run_id='original-run',generation='generation' WHERE occurrence_id='one'",[]).unwrap();
    conn.execute(insert, params!["two", "pending", "receipt-two"])
        .unwrap();
    assert!(conn
        .execute(
            "UPDATE heartbeat_occurrences SET state='admitted' WHERE occurrence_id='two'",
            []
        )
        .is_err());
    assert!(conn
        .execute(insert, params!["three", "settled", "receipt-one"])
        .is_err());
    conn.execute("INSERT INTO heartbeat_commands(session_id,request_id,canonical_digest,schedule_id,response_json,created_at_ms) VALUES('session','request','digest','schedule','original receipt',0)",[]).unwrap();
    conn.execute("DELETE FROM sessions WHERE session_id='session'", [])
        .unwrap();
    for table in [
        "heartbeat_commands",
        "heartbeat_occurrences",
        "heartbeat_schedules",
    ] {
        assert_eq!(
            conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |row| row
                .get(0))
                .unwrap(),
            0
        );
    }
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
