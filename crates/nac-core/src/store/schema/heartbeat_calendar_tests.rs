//! Physical49-to50 characterization, independent of calendar runtime/types.
//! The predecessor is canonical15bc's unchanged heartbeat44/fresh48 owners,
//! with only the new occurrence format reversed before the49 header is set.
use super::*;
use heartbeat_calendar::rebuild_occurrences_for_calendar;
use rusqlite::types::Value;

type TableRows = Vec<Vec<Value>>;
type Facts = (i64, Vec<(String, TableRows)>);

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn previous49() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-calendar-schema-{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        initialize(&path).unwrap();
        for id in ["owner", "creator", "produced", "deleted"] {
            insert_test_session(&path, id);
        }
        reconstruct49(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        let specification = r#"{"name":"retained interval","instructions":"Check the saved job.","skills":[],"interval_ms":60000,"end_condition":"Until ready","goal_id":null,"execution_timeout_ms":300000,"max_occurrences":1000,"token_allowance":null}"#;
        for (id, owner) in [("existing", Some("owner")), ("standalone", None)] {
            conn.execute("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES(?1,?2,3,'paused','retained binding',?3,1000,61000,1000,2000)",params![id,owner,specification]).unwrap();
        }
        conn.execute_batch("INSERT INTO session_inbox(id,session_id,delivery,content,created_at,updated_at) VALUES(77,'owner','queue','retained automation input','retained','retained');
            INSERT INTO heartbeat_commands VALUES('owner','request','original digest','existing','original serialized response',1000);
            INSERT INTO heartbeat_commands VALUES('project:project','fresh-request','fresh digest','standalone','original fresh response',1000);
            INSERT INTO heartbeat_fresh_destinations VALUES('standalone','project','creator','retained destination','retained binding');
            UPDATE heartbeat_retained_allowance SET retained_limit=123,revision=7;
            INSERT INTO heartbeat_retained_commands VALUES('retained-limit','limit digest','original limit response');").unwrap();
        for (index, state, source, sequence) in [
            (0, "settled", "interval", Some(10)),
            (1, "admitted", "interval", None),
            (2, "pending", "interval", None),
            (3, "withdrawn", "run_now", Some(11)),
        ] {
            let started = matches!(state, "settled" | "admitted");
            conn.execute("INSERT INTO heartbeat_occurrences(rowid,occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,inbox_item_id,run_id,generation,expected_revision,provisional_outcome,outcome,evidence,tokens_used,started_at_ms,settled_at_ms,attempt_count,settlement_sequence) VALUES(?1,?2,'existing','owner',?3,61000,181000,3,?4,?5,?6,?7,?8,?9,?10,7,?11,?12,'retained evidence',?13,?14,?15,2,?16)",params![100+index,format!("occurrence-{index}"),index.min(2)+1,source,state,specification,format!("receipt-{index}"),(state=="admitted").then_some(77),started.then(||format!("run-{index}")),started.then(||format!("generation-{index}")),(state=="settled").then_some("unchanged"),(state=="settled").then_some("unchanged"),(state=="settled").then_some(11),started.then_some(62000),sequence.map(|_|63000),sequence]).unwrap();
        }
        for (id, owner, sequence) in [
            ("fresh-unassigned", None, 30),
            ("fresh-produced", Some("produced"), 31),
        ] {
            conn.execute("INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,settlement_sequence) VALUES(?1,'standalone',?2,2,60000,180000,3,'interval','withdrawn',?3,?4,?5)",params![id,owner,specification,format!("{id}-receipt"),sequence]).unwrap();
        }
        conn.execute_batch("INSERT INTO heartbeat_task_launches(occurrence_id,schedule_id,request_id,project_id,launch_json,session_id,created_at_ms) VALUES('fresh-produced','standalone','launch','project','retained launch','produced',1000);
            INSERT INTO thread_events(id,session_id,thread_name,event_json,created_at) VALUES(901,'owner','main','{}','retained');
            INSERT INTO session_completion_bindings(session_id,run_id,submitted_message_id,behavior,eligible) VALUES('owner','bound-run',901,'direct',1);
            INSERT INTO session_completion_marks VALUES('owner','bound-run','goal',4);
            INSERT INTO session_completion_occurrences(sequence,session_id,run_id,behavior,kind,committed_at) VALUES(73,'owner','request-run','direct','request','retained');
            INSERT INTO session_completion_occurrences(sequence,session_id,run_id,behavior,kind,goal_id,mark_version,committed_at) VALUES(74,'owner','goal-run','direct','goal','goal',4,'retained');
            INSERT INTO session_completion_occurrences(sequence,session_id,run_id,behavior,kind,committed_at) VALUES(90,'deleted','deleted-frontier','direct','request','retained');
            DELETE FROM sessions WHERE session_id IN ('creator','produced','deleted');").unwrap();
        assert_eq!(version(&conn), 49);
        assert_eq!(
            autoincrement_sequence(&conn, "session_completion_occurrences").unwrap(),
            Some(90)
        );
        assert!(rows(&conn, "PRAGMA foreign_key_check").is_empty());
        Self { path }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.path.parent().unwrap());
    }
}

fn version(conn: &Connection) -> i64 {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

fn rows(conn: &Connection, sql: &str) -> TableRows {
    let mut stmt = conn.prepare(sql).unwrap();
    let width = stmt.column_count();
    let values = stmt
        .query_map([], |row| (0..width).map(|i| row.get(i)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    values
}

fn facts(conn: &Connection) -> Facts {
    let tables = rows(
        conn,
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    (
        version(conn),
        tables
            .into_iter()
            .map(|row| {
                let Value::Text(table) = &row[0] else {
                    panic!("table name")
                };
                (
                    table.clone(),
                    rows(
                        conn,
                        &format!("SELECT rowid,* FROM \"{table}\" ORDER BY rowid"),
                    ),
                )
            })
            .collect(),
    )
}

fn catalog(conn: &Connection) -> TableRows {
    rows(
        conn,
        "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
    )
}

fn unaffected_catalog(conn: &Connection) -> TableRows {
    rows(conn, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name!='heartbeat_occurrences' ORDER BY type,name")
}

fn occurrence_indices(conn: &Connection) -> Vec<(String, String)> {
    rows(conn, "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='heartbeat_occurrences' AND sql IS NOT NULL ORDER BY name")
        .into_iter().map(|row| {
            let (Value::Text(name), Value::Text(sql)) = (&row[0], &row[1]) else { panic!("index SQL") };
            (name.clone(), sql.split_whitespace().collect())
        }).collect()
}

/// Use the unchanged canonical44/48 owners, not the current50 constructor or
/// a hand-stamped50 table. Other canonical49 physical objects are unchanged.
fn reconstruct49(path: &Path) {
    let mut old = Connection::open_in_memory().unwrap();
    old.execute_batch("CREATE TABLE sessions(session_id TEXT PRIMARY KEY); CREATE TABLE session_inbox(id INTEGER PRIMARY KEY);").unwrap();
    let tx = old.transaction().unwrap();
    heartbeat_tables::create_heartbeat_tables(&tx).unwrap();
    fresh_task_tables::migrate(&tx).unwrap();
    tx.commit().unwrap();
    let sql: String = old
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='heartbeat_occurrences'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!sql.contains("'calendar'"));
    let indices = rows(&old, "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='heartbeat_occurrences' AND sql IS NOT NULL ORDER BY name");
    let columns = rows(
        &old,
        "SELECT name FROM pragma_table_info('heartbeat_occurrences') ORDER BY cid",
    )
    .into_iter()
    .map(|row| {
        let Value::Text(name) = &row[0] else {
            panic!("column name")
        };
        format!("\"{name}\"")
    })
    .collect::<Vec<_>>()
    .join(",");
    let mut conn = Connection::open(path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    let tx = conn.transaction().unwrap();
    let ddl = sql.replacen(
        "CREATE TABLE \"heartbeat_occurrences\"",
        "CREATE TABLE heartbeat_occurrences_before_calendar",
        1,
    );
    assert_ne!(ddl, sql);
    tx.execute_batch(&ddl).unwrap();
    tx.execute_batch(&format!("INSERT INTO heartbeat_occurrences_before_calendar(rowid,{columns}) SELECT rowid,{columns} FROM heartbeat_occurrences; DROP TABLE heartbeat_occurrences; ALTER TABLE heartbeat_occurrences_before_calendar RENAME TO heartbeat_occurrences;")).unwrap();
    for row in indices {
        let Value::Text(sql) = &row[0] else {
            panic!("index SQL")
        };
        tx.execute_batch(sql).unwrap();
    }
    let actual: String = tx
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='heartbeat_occurrences'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(actual, sql, "exact canonical49 occurrence catalog");
    tx.pragma_update(None, "user_version", 49).unwrap();
    tx.commit().unwrap();
}

#[test]
fn calendar_schema50_real49_preserves_rows_feed_sequences_and_retained_owners() {
    let f = Fixture::previous49();
    let conn = Connection::open(&f.path).unwrap();
    let before = facts(&conn);
    let other_catalog = unaffected_catalog(&conn);
    let indices = occurrence_indices(&conn);
    drop(conn);
    initialize(&f.path).unwrap();
    let mut conn = open_runtime_connection(&f.path).unwrap();
    assert_eq!(version(&conn), 50);
    assert_eq!(
        facts(&conn).1,
        before.1,
        "every rowid/value including feed UUID and sqlite_sequence"
    );
    assert_eq!(unaffected_catalog(&conn), other_catalog);
    assert_eq!(occurrence_indices(&conn), indices);
    let current = catalog(&conn);
    let tx = conn.transaction().unwrap();
    rebuild_occurrences_for_calendar(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(facts(&conn).1, before.1);
    assert_eq!(
        catalog(&conn),
        current,
        "format rebuild is catalog-idempotent"
    );
    drop(conn);
    initialize(&f.path).unwrap();
    let conn = open_runtime_connection(&f.path).unwrap();
    assert_eq!(facts(&conn).1, before.1, "reopen retains all facts");
    assert!(rows(&conn, "PRAGMA foreign_key_check").is_empty());
    conn.execute("INSERT INTO session_completion_occurrences(session_id,run_id,behavior,kind,committed_at) VALUES('owner','after-upgrade','direct','request','retained')", []).unwrap();
    assert!(
        conn.last_insert_rowid() > 90,
        "deleted AUTOINCREMENT frontier is never reused"
    );
    assert!(conn.execute("INSERT INTO session_completion_occurrences(session_id,run_id,behavior,kind,goal_id,mark_version,committed_at) VALUES('owner','other-run','direct','goal','goal',4,'retained')", []).is_err());
    conn.execute("INSERT INTO session_completion_bindings(session_id,run_id,submitted_message_id,behavior,eligible) VALUES('owner','other-run',901,'direct',1)", []).unwrap();
    assert!(conn
        .execute(
            "INSERT INTO session_completion_marks VALUES('owner','other-run','goal',4)",
            []
        )
        .is_err());
    conn.execute(
        "INSERT INTO session_completion_marks VALUES('owner','other-run','goal',5)",
        [],
    )
    .unwrap();
}

#[test]
fn calendar_schema50_before_commit_failure_restores_genuine49_catalog_and_facts() {
    let f = Fixture::previous49();
    let conn = Connection::open(&f.path).unwrap();
    let before = facts(&conn);
    let before_catalog = catalog(&conn);
    drop(conn);
    let reached = std::cell::Cell::new(false);
    assert!(initialize_with_hooks(
        &f.path,
        || {},
        || {},
        || {
            reached.set(true);
            Err(anyhow!("abort after calendar50 DDL before commit"))
        }
    )
    .is_err());
    assert!(reached.get(), "real49 reaches actual before_commit");
    let conn = Connection::open(&f.path).unwrap();
    assert_eq!(facts(&conn), before);
    assert_eq!(catalog(&conn), before_catalog);
    assert!(
        rebuild_occurrences_for_calendar(&conn).is_err(),
        "owning transaction required"
    );
}

#[test]
fn calendar_schema50_retains_constraints_and_standalone_audit_after_deletion() {
    let f = Fixture::previous49();
    initialize(&f.path).unwrap();
    let conn = open_runtime_connection(&f.path).unwrap();
    assert!(conn.execute("UPDATE heartbeat_occurrences SET state='admitted',run_id='conflict' WHERE state='pending'", []).is_err());
    assert!(conn
        .execute("UPDATE heartbeat_occurrences SET source='unsupported'", [])
        .is_err());
    assert!(conn
        .execute(
            "UPDATE heartbeat_occurrences SET receipt_id='same-receipt'",
            []
        )
        .is_err());
    assert!(conn
        .execute("UPDATE heartbeat_occurrences SET schedule_id='missing'", [])
        .is_err());
    assert_eq!(
        rows(
            &conn,
            "SELECT source,count(*) FROM heartbeat_occurrences GROUP BY source ORDER BY source"
        )
        .len(),
        2,
        "no calendar occurrence manufactured"
    );
    conn.execute("DELETE FROM sessions WHERE session_id='owner'", [])
        .unwrap();
    assert_eq!(rows(&conn, "SELECT * FROM heartbeat_occurrences").len(), 2);
    assert_eq!(rows(&conn, "SELECT * FROM heartbeat_commands").len(), 1);
    assert_eq!(
        rows(&conn, "SELECT * FROM heartbeat_task_launches").len(),
        1
    );
    assert_eq!(
        rows(&conn, "SELECT * FROM heartbeat_fresh_destinations").len(),
        1
    );
    assert_eq!(
        rows(
            &conn,
            "SELECT session_id FROM heartbeat_occurrences ORDER BY occurrence_id"
        ),
        vec![vec![Value::Text("produced".into())], vec![Value::Null]]
    );
    assert!(rows(&conn, "PRAGMA foreign_key_check").is_empty());
}

fn sqlite_files(path: &Path) -> Vec<Option<Vec<u8>>> {
    ["", "-wal", "-shm"]
        .into_iter()
        .map(
            |suffix| match std::fs::read(format!("{}{suffix}", path.display())) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => panic!("snapshot SQLite file: {error}"),
            },
        )
        .collect()
}

#[test]
fn calendar_schema50_foreign_same_version_refuses_opens_before_effects() {
    let f = Fixture::previous49();
    let conn = Connection::open(&f.path).unwrap();
    // A deliberately invalid50 header on actual49 DDL is a negative fixture,
    // never the claimed predecessor or a successful migration.
    conn.pragma_update(None, "journal_mode", "DELETE").unwrap();
    conn.pragma_update(None, "user_version", 50).unwrap();
    let before = facts(&conn);
    let before_catalog = catalog(&conn);
    drop(conn);
    let files = sqlite_files(&f.path);
    for action in ["initialize", "runtime", "read-only", "probe"] {
        let error = match action {
            "initialize" => initialize(&f.path).unwrap_err(),
            "runtime" => open_runtime_connection(&f.path).err().unwrap(),
            "read-only" => open_initialized_read_connection(&f.path).err().unwrap(),
            "probe" => open_probe_read_connection(&f.path).err().unwrap(),
            _ => unreachable!(),
        };
        assert!(error
            .to_string()
            .contains("unsupported calendar store format"));
        assert_eq!(
            sqlite_files(&f.path),
            files,
            "refusal changes no main/WAL/SHM"
        );
    }
    let conn = Connection::open(&f.path).unwrap();
    assert_eq!(facts(&conn), before);
    assert_eq!(catalog(&conn), before_catalog);
    assert_eq!(
        conn.pragma_query_value::<String, _, _>(None, "journal_mode", |row| row.get(0))
            .unwrap(),
        "delete"
    );
}

fn physical_state(conn: &Connection) -> (Facts, TableRows, i64) {
    (
        facts(conn),
        catalog(conn),
        conn.pragma_query_value(None, "schema_version", |row| row.get(0))
            .unwrap(),
    )
}

#[test]
fn calendar_schema50_lock_time_current_preserves_facts_catalog_and_commit_hook() {
    for fail_commit_hook in [false, true] {
        let f = Fixture::previous49();
        let expected = std::cell::RefCell::new(None);
        let preflight = std::cell::Cell::new(false);
        let locked_version = std::cell::Cell::new(0);
        let commits = std::cell::Cell::new(0);
        // Deterministically commit another initializer at the actual boundary:
        // this caller has read49 but has not acquired its Immediate lock yet.
        let result = initialize_with_hooks(
            &f.path,
            || {
                preflight.set(true);
                let conn = Connection::open(&f.path).unwrap();
                assert_eq!(version(&conn), 49);
                drop(conn);
                initialize(&f.path).unwrap();
                let conn = Connection::open(&f.path).unwrap();
                assert_eq!(version(&conn), 50);
                *expected.borrow_mut() = Some(physical_state(&conn));
            },
            || {
                let conn = Connection::open(&f.path).unwrap();
                locked_version.set(version(&conn));
            },
            || {
                commits.set(commits.get() + 1);
                if fail_commit_hook {
                    Err(anyhow!("current50 before_commit sentinel"))
                } else {
                    Ok(())
                }
            },
        );
        if fail_commit_hook {
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("current50 before_commit sentinel"));
        } else {
            result.unwrap();
        }
        assert!(preflight.get());
        assert_eq!(locked_version.get(), 50);
        assert_eq!(commits.get(), 1, "the locked path retains before_commit");
        let conn = Connection::open(&f.path).unwrap();
        assert_eq!(
            physical_state(&conn),
            expected.borrow().as_ref().unwrap().clone(),
            "even an equivalent rebuild changes the schema cookie; neither hook outcome may rebuild the other initializer's committed50"
        );
        assert!(rows(&conn, "PRAGMA foreign_key_check").is_empty());
    }
}

#[test]
fn calendar_schema50_lock_time_foreign_format_is_refused_without_repair() {
    let f = Fixture::previous49();
    let expected = std::cell::RefCell::new(None);
    let preflight = std::cell::Cell::new(false);
    let locked_version = std::cell::Cell::new(0);
    let commit_hook = std::cell::Cell::new(false);
    let error = initialize_with_hooks(
        &f.path,
        || {
            preflight.set(true);
            let conn = Connection::open(&f.path).unwrap();
            assert_eq!(version(&conn), 49);
            // A foreign writer commits only a50 header on interval-only49
            // layout after our preflight. It is deliberately invalid format.
            conn.pragma_update(None, "user_version", 50).unwrap();
            *expected.borrow_mut() = Some(physical_state(&conn));
        },
        || {
            let conn = Connection::open(&f.path).unwrap();
            locked_version.set(version(&conn));
        },
        || {
            commit_hook.set(true);
            Ok(())
        },
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("unsupported calendar store format"));
    assert!(preflight.get());
    assert_eq!(locked_version.get(), 50);
    assert!(
        !commit_hook.get(),
        "invalid format cannot reach before_commit"
    );
    let conn = Connection::open(&f.path).unwrap();
    assert_eq!(
        physical_state(&conn),
        expected.borrow().as_ref().unwrap().clone(),
        "refusal preserves every rowid/value, complete catalog and schema cookie without calendar repair"
    );
    assert!(rows(&conn, "PRAGMA foreign_key_check").is_empty());
}
