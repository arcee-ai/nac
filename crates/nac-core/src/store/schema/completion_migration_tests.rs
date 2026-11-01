use super::*;

const POST_47: &str = "DROP TABLE session_completion_marks;
    DROP TABLE session_completion_bindings; DROP TABLE session_completion_occurrences;
    DROP TABLE session_completion_feed; DROP TABLE heartbeat_fresh_destinations;
    DROP TABLE heartbeat_task_launches; DROP TABLE heartbeat_retained_commands;
    DROP TABLE heartbeat_retained_allowance; DROP TABLE heartbeat_commands;
    DROP TABLE heartbeat_occurrences; DROP TABLE heartbeat_schedules;";
const LEDGER_TABLES: &[&str] = &[
    "session_completion_feed",
    "session_completion_bindings",
    "session_completion_marks",
    "session_completion_occurrences",
];
const RETAINED: &[&str] = &[
    "sessions",
    "task_followups",
    "native_task_launches",
    "peer_goal_starts",
    "heartbeat_schedules",
    "heartbeat_occurrences",
    "heartbeat_commands",
    "session_mcp_refresh",
    "task_questions",
    "task_followup_delegations",
];

fn rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut query = conn
        .prepare(&format!("SELECT * FROM {table} ORDER BY 1"))
        .unwrap();
    let width = query.column_count();
    query
        .query_map([], |row| (0..width).map(|i| row.get(i)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}
fn catalog(conn: &Connection) -> Vec<(String, String)> {
    let mut query = conn
        .prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        .unwrap();
    query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}
fn path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("nac-completion-migration-{}", uuid::Uuid::new_v4()))
        .join("store.db")
}

/// Reconstruct every post-version addition, not a version stamp on current DDL.
/// Unchanged c226 schema47 tables + exact48348 migration are the frozen suppliers.
fn historical(path: &Path, version: i64) {
    initialize(path).unwrap();
    for id in ["caller", "target"] {
        insert_test_session(path, id);
    }
    let mut conn = Connection::open(path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    conn.execute_batch(POST_47).unwrap();
    heartbeat_tables::create_heartbeat_tables(&conn).unwrap();
    conn.execute_batch("INSERT INTO task_followup_delegations VALUES('delegation','caller','human-request','target','queue','original-request','original-scope',0,'human_product_request','retained',NULL);
        INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at,delegation_id) VALUES('caller','request','target','original-request','queue',77,'retained','delegation');
        INSERT INTO native_task_launches VALUES('launch','caller','project','{}','/repo','target',0,'failed','retained error',NULL,'created','updated');
        INSERT INTO peer_goal_starts VALUES('caller','goal','target','{}','retained reply');
        INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES('schedule','caller',7,'paused','original binding','original specification',0,60000,0,0);
        INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,settlement_sequence) VALUES('occurrence','schedule','caller',7,60000,60000,1,'interval','withdrawn','{}','receipt',1);
        INSERT INTO heartbeat_commands VALUES('caller','command','digest','schedule','retained reply',0);
        INSERT INTO session_mcp_refresh VALUES('caller',3,'retained refresh');
        INSERT INTO task_questions(session_id,request_id,request_json,creation_digest,config_version,revision,status,created_at) VALUES('caller','question','{}','digest',0,1,'cancelled','retained question');").unwrap();
    assert!(LEDGER_TABLES
        .iter()
        .all(|name| !catalog(&conn).iter().any(|(n, _)| n == name)));
    assert_eq!(conn.query_row::<i64,_,_>("SELECT \"notnull\" FROM pragma_table_info('heartbeat_schedules') WHERE name='session_id'",[],|r|r.get(0)).unwrap(),1);
    if version == 48 {
        let tx = conn.transaction().unwrap();
        fresh_task_tables::migrate(&tx).unwrap();
        tx.commit().unwrap();
        conn.execute_batch("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES('standalone',NULL,1,'active','{}','{}',0,60000,0,0);
            INSERT INTO heartbeat_fresh_destinations VALUES('standalone','project','caller','{}','{}');
            INSERT INTO heartbeat_task_launches(occurrence_id,schedule_id,request_id,project_id,launch_json,session_id,created_at_ms) VALUES('produced','standalone','launch-48','project','{}','target',0);
            UPDATE heartbeat_retained_allowance SET retained_limit=123,revision=7;
            INSERT INTO heartbeat_retained_commands VALUES('allowance-request','digest','original response');").unwrap();
        assert_eq!(conn.query_row::<i64,_,_>("SELECT \"notnull\" FROM pragma_table_info('heartbeat_schedules') WHERE name='session_id'",[],|r|r.get(0)).unwrap(),0);
    }
    conn.pragma_update(None, "user_version", version).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn completion_schema49_real47_and_actual48_preserve_catalog_rows_rollback_and_reopen() {
    for version in [47, 48] {
        let path = path();
        historical(&path, version);
        let before_conn = Connection::open(&path).unwrap();
        let before_catalog = catalog(&before_conn);
        let mut tables = RETAINED.to_vec();
        if version == 48 {
            tables.extend([
                "heartbeat_fresh_destinations",
                "heartbeat_task_launches",
                "heartbeat_retained_allowance",
                "heartbeat_retained_commands",
            ]);
        }
        let before = tables
            .iter()
            .map(|table| (*table, rows(&before_conn, table)))
            .collect::<Vec<_>>();
        drop(before_conn);
        assert!(initialize_with_hooks(
            &path,
            || {},
            || {},
            || Err(anyhow!("abort after complete48+49 DDL before commit"))
        )
        .is_err());
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            version
        );
        assert_eq!(
            catalog(&conn),
            before_catalog,
            "rollback restores entire actual predecessor catalog"
        );
        for (table, values) in &before {
            assert_eq!(rows(&conn, table), *values, "rollback {version} {table}");
        }
        drop(conn);
        initialize(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            49
        );
        let installed = catalog(&conn);
        for name in LEDGER_TABLES.iter().copied().chain([
            "heartbeat_fresh_destinations",
            "heartbeat_task_launches",
            "heartbeat_retained_allowance",
            "heartbeat_retained_commands",
            "idx_completion_request",
            "idx_completion_goal",
            "idx_completion_session",
        ]) {
            assert!(
                installed.iter().any(|(n, _)| n == name),
                "complete current49 catalog includes {name}"
            );
        }
        for (table, values) in &before {
            assert_eq!(rows(&conn, table), *values, "migration {version} {table}");
        }
        assert_eq!(
            rows(&conn, "session_completion_occurrences").len(),
            0,
            "migration invents no historical success"
        );
        let feed = rows(&conn, "session_completion_feed");
        assert_eq!(feed.len(), 1);
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0))
                .unwrap(),
            0
        );
        drop(conn);
        for _ in 0..2 {
            initialize(&path).unwrap();
        }
        let conn = Connection::open(&path).unwrap();
        assert_eq!(catalog(&conn), installed);
        assert_eq!(rows(&conn, "session_completion_feed"), feed);
        assert!(conn.execute("INSERT INTO session_completion_occurrences(session_id,run_id,behavior,kind,goal_id,mark_version,committed_at) VALUES('caller','run','direct','goal','goal',NULL,'now')",[]).is_err());
        conn.execute("INSERT INTO session_completion_occurrences(session_id,run_id,behavior,kind,committed_at) VALUES('caller','run','direct','request','now')",[]).unwrap();
        assert!(conn.execute("INSERT INTO session_completion_occurrences(session_id,run_id,behavior,kind,committed_at) VALUES('caller','run','direct','request','now')",[]).is_err());
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; DELETE FROM sessions WHERE session_id='caller';",
        )
        .unwrap();
        assert!(rows(&conn, "session_completion_occurrences").is_empty());
        //48's standalone owner and retained launch audit survive creator deletion.
        if version == 48 {
            assert_eq!(rows(&conn, "heartbeat_fresh_destinations").len(), 1);
            assert_eq!(rows(&conn, "heartbeat_task_launches").len(), 1);
        }
        drop(conn);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
