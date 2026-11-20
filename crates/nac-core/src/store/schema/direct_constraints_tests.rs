use super::*;

fn setup() -> (std::path::PathBuf, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("nac-v56-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v55.sql"))
        .unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;
        INSERT INTO heartbeat_retained_allowance VALUES(1,100,1);
        INSERT INTO managed_host_maintenance VALUES(1,'serving',NULL,NULL,NULL,NULL,0);
        INSERT INTO session_completion_feed VALUES(1,'feed');
        INSERT INTO sessions(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES('s','/tmp','/tmp/store','m','https://example.invalid','[]','now','now');
        INSERT INTO sessions(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES('child','/tmp','/tmp/store','m','https://example.invalid','[]','now','now');
        INSERT INTO session_events(id,session_id,event_target,event_json,created_at) VALUES(7,'s','session','{}','now');
        INSERT INTO session_completion_bindings VALUES('s','r',7,'direct',1,0,0);
        INSERT INTO session_completion_marks VALUES('s','r','g',1);
        INSERT INTO session_completion_occurrences(sequence,session_id,run_id,behavior,kind,committed_at) VALUES(9,'s','r','direct','request','now');
        INSERT INTO session_inbox(id,session_id,delivery,status,content,created_at,updated_at) VALUES(4,'s','queue','pending','orchestrator is user text','now','now');
        INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,run_id,execution_mode,completion_inbox_id,created_at,updated_at) VALUES('child','s','s','general','child',1,'completed',1,'run','background',4,'now','now');
        UPDATE sqlite_sequence SET seq=1000 WHERE name='session_inbox';
        UPDATE sqlite_sequence SET seq=2000 WHERE name='session_completion_occurrences';
        PRAGMA user_version=55;").unwrap();
    drop(conn);
    (root, path)
}

fn catalog(conn: &Connection) -> Vec<(String, String, String)> {
    conn.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").unwrap()
        .query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get::<_, String>(2)?.split_whitespace().collect::<Vec<_>>().join(" ")))).unwrap()
        .map(Result::unwrap).collect()
}

#[test]
fn v55_upgrade_preserves_rows_sequences_cascades_and_catalog() {
    let (root, path) = setup();
    let fresh_path = root.join("fresh.db");
    initialize(&fresh_path).unwrap();
    initialize(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    let fresh = Connection::open(fresh_path).unwrap();
    assert_eq!(catalog(&conn), catalog(&fresh));
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT rowid FROM sessions WHERE session_id='s'", [], |r| r
            .get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row::<String, _, _>("SELECT content FROM session_inbox WHERE id=4", [], |r| r
            .get(0))
            .unwrap(),
        "orchestrator is user text"
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT seq FROM sqlite_sequence WHERE name='session_inbox'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        1000
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT seq FROM sqlite_sequence WHERE name='session_completion_occurrences'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        2000
    );
    assert!(conn
        .execute(
            "UPDATE sessions SET behavior='orchestrator' WHERE session_id='s'",
            []
        )
        .is_err());
    assert!(conn
        .execute(
            "UPDATE session_completion_bindings SET behavior='orchestrator'",
            []
        )
        .is_err());
    assert!(conn
        .execute(
            "UPDATE session_completion_occurrences SET behavior='direct-with-orchestrator'",
            []
        )
        .is_err());
    assert!(conn.execute("UPDATE session_inbox SET completion_source='managed_orchestrator',completion_session_id='s',completion_generation=1", []).is_err());
    conn.execute("UPDATE session_inbox SET completion_source='traditional_child',completion_session_id='child',completion_generation=1 WHERE id=4", []).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        4
    );
    conn.execute("DELETE FROM session_inbox WHERE id=4", [])
        .unwrap();
    assert_eq!(
        conn.query_row::<Option<i64>, _, _>(
            "SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        None
    );
    conn.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at) VALUES('s','queue','pending','new','now','now')", []).unwrap();
    assert_eq!(conn.last_insert_rowid(), 1001);
    conn.execute("DELETE FROM sessions WHERE session_id='s'", [])
        .unwrap();
    for table in [
        "session_inbox",
        "session_events",
        "session_completion_bindings",
        "session_completion_marks",
        "session_completion_occurrences",
    ] {
        assert_eq!(
            conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap(),
            0,
            "{table}"
        );
    }
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    drop((conn, fresh));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failure_rolls_back_catalog_and_rows_and_retry_works() {
    let (root, path) = setup();
    let before = Connection::open(&path).unwrap();
    let original_catalog = catalog(&before);
    drop(before);
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("injected"))).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        55
    );
    assert_eq!(catalog(&conn), original_catalog);
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM session_completion_marks", [], |r| r
            .get(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT seq FROM sqlite_sequence WHERE name='session_inbox'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        1000
    );
    drop(conn);
    initialize(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn peer_schema_cache_observes_atomic_commit() {
    let (root, path) = setup();
    let peer = Connection::open(&path).unwrap();
    peer.execute_batch("PRAGMA journal_mode=WAL; BEGIN; SELECT * FROM sessions;")
        .unwrap();
    let old: String = peer
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='sessions'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    initialize(&path).unwrap();
    let pinned: String = peer
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='sessions'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pinned, old);
    peer.execute_batch("COMMIT").unwrap();
    let changed: String = peer
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='sessions'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_ne!(changed, old);
    assert!(peer
        .execute(
            "UPDATE sessions SET behavior='orchestrator' WHERE session_id='s'",
            []
        )
        .is_err());
    drop(peer);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn unsupported_shape_fails_without_mutating_catalog() {
    let (root, path) = setup();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA writable_schema=ON; UPDATE sqlite_schema SET sql=replace(sql, 'behavior TEXT NOT NULL CHECK(behavior IN', 'behavior TEXT NOT NULL CHECK (behavior IN') WHERE name='session_completion_bindings'; PRAGMA writable_schema=OFF;").unwrap();
    let original = catalog(&conn);
    drop(conn);
    assert!(initialize(&path).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(catalog(&conn), original);
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        55
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn old_constraint_hidden_in_comment_is_rejected_atomically() {
    let (root, path) = setup();
    let conn = Connection::open(&path).unwrap();
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='session_completion_bindings'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let deceptive = sql.replace(
        COMPLETION_COLUMN,
        &format!("behavior TEXT NOT NULL CHECK(behavior IN ('direct','orchestrator','direct-with-orchestrator')) /* {COMPLETION_COLUMN} */"),
    );
    assert_ne!(sql, deceptive);
    conn.execute_batch("PRAGMA writable_schema=ON").unwrap();
    conn.execute(
        "UPDATE sqlite_schema SET sql=?1 WHERE name='session_completion_bindings'",
        [&deceptive],
    )
    .unwrap();
    conn.execute_batch("PRAGMA writable_schema=OFF").unwrap();
    drop(conn);
    let original = catalog(&Connection::open(&path).unwrap());

    assert!(initialize(&path).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(catalog(&conn), original);
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        55
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM session_completion_marks", [], |row| {
            row.get(0)
        })
        .unwrap(),
        1
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn column_match_ignores_nested_and_quoted_sql() {
    let actual = format!("CREATE TABLE t (id TEXT, {COMPLETION_COLUMN}, other TEXT)");
    assert!(is_column_definition(&actual, COMPLETION_COLUMN));
    for sql in [
        format!("CREATE TABLE t (id TEXT /* {COMPLETION_COLUMN} */)"),
        format!("CREATE TABLE t (id TEXT -- {COMPLETION_COLUMN}\n)"),
        format!("CREATE TABLE t (\"{COMPLETION_COLUMN}\" TEXT)"),
        format!("CREATE TABLE t (id TEXT CHECK({COMPLETION_COLUMN}))"),
    ] {
        assert!(!is_column_definition(&sql, COMPLETION_COLUMN), "{sql}");
    }
}

#[test]
fn v52_upgrade_catalog_matches_fresh() {
    let root = std::env::temp_dir().join(format!("nac-v52-catalog-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let old_path = root.join("old.db");
    let old = Connection::open(&old_path).unwrap();
    old.execute_batch(include_str!("fixtures/v52.sql")).unwrap();
    drop(old);
    let fresh_path = root.join("fresh.db");
    initialize(&old_path).unwrap();
    initialize(&fresh_path).unwrap();
    let old = Connection::open(old_path).unwrap();
    let fresh = Connection::open(fresh_path).unwrap();
    let old_catalog = catalog(&old);
    let fresh_catalog = catalog(&fresh);
    let old_map: std::collections::BTreeMap<_, _> = old_catalog
        .iter()
        .map(|(kind, name, sql)| ((kind, name), sql))
        .collect();
    let fresh_map: std::collections::BTreeMap<_, _> = fresh_catalog
        .iter()
        .map(|(kind, name, sql)| ((kind, name), sql))
        .collect();
    let differences: Vec<_> = old_map
        .keys()
        .chain(fresh_map.keys())
        .filter(|key| old_map.get(key) != fresh_map.get(key))
        .collect();
    assert!(
        differences.is_empty(),
        "catalog differences: {differences:?}"
    );
    drop((old, fresh));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn v0_explicit_direct_session_survives_with_appended_behavior_column() {
    let root = std::env::temp_dir().join(format!("nac-v0-direct-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL, store_path TEXT NOT NULL,
        model TEXT NOT NULL, base_url TEXT NOT NULL, sandbox_json TEXT,
        messages_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        ALTER TABLE sessions ADD COLUMN behavior TEXT NOT NULL DEFAULT 'orchestrator' CHECK (behavior IN ('orchestrator', 'direct', 'direct-with-orchestrator'));
        INSERT INTO sessions(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at,behavior) VALUES('retained','/tmp','/tmp/store','m','https://example.invalid','[]','now','now','direct');").unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT behavior FROM sessions WHERE session_id='retained'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        "direct"
    );
    let names: Vec<String> = conn
        .prepare("PRAGMA table_info(sessions)")
        .unwrap()
        .query_map([], |r| r.get(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_ne!(names.iter().position(|name| name == "behavior"), Some(1));
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn ada_origin_columns_keep_physical_order_on_upgrade() {
    let root = std::env::temp_dir().join(format!("nac-ada-order-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v52.sql"))
        .unwrap();
    conn.execute_batch("DROP INDEX idx_session_inbox_admission;
        ALTER TABLE session_inbox DROP COLUMN completion_generation;
        ALTER TABLE session_inbox DROP COLUMN completion_session_id;
        ALTER TABLE session_inbox DROP COLUMN completion_source;
        ALTER TABLE session_inbox DROP COLUMN review_intent;
        ALTER TABLE session_inbox DROP COLUMN child_wait_id;
        ALTER TABLE session_inbox DROP COLUMN child_execution_mode;
        ALTER TABLE session_inbox DROP COLUMN admission_digest;
        ALTER TABLE session_inbox DROP COLUMN admission_id;
        ALTER TABLE session_inbox ADD COLUMN completion_source\n    TEXT CHECK(completion_source IN ('traditional_child','managed_orchestrator'));
        ALTER TABLE session_inbox ADD COLUMN completion_session_id TEXT CHECK((completion_session_id IS NULL)=(completion_source IS NULL));
        ALTER TABLE session_inbox ADD COLUMN completion_generation INTEGER CHECK((completion_generation IS NULL)=(completion_source IS NULL)) CHECK(completion_generation IS NULL OR completion_generation>0);
        INSERT INTO sessions(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at,behavior) VALUES('retained','/tmp','/tmp/store','m','https://example.invalid','[]','now','now','direct');
        INSERT INTO sessions(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at,behavior) VALUES('child','/tmp','/tmp/store','m','https://example.invalid','[]','now','now','direct');
        INSERT INTO session_inbox(id,session_id,delivery,status,content,created_at,updated_at,completion_source,completion_session_id,completion_generation) VALUES(7,'retained','queue','pending','literal user text','now','now','traditional_child','child',3);
        INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,run_id,execution_mode,completion_inbox_id,created_at,updated_at) VALUES('child','retained','retained','general','child',1,'completed',3,'run','background',7,'now','now');
        UPDATE sqlite_sequence SET seq=1000 WHERE name='session_inbox';
        DROP TABLE session_completion_marks; DROP TABLE session_completion_bindings;
        DROP TABLE session_completion_occurrences; DROP TABLE session_completion_feed;
        DROP TABLE heartbeat_fresh_destinations; DROP TABLE heartbeat_task_launches;
        DROP TABLE heartbeat_retained_commands; DROP TABLE heartbeat_retained_allowance;
        DROP TABLE heartbeat_commands; DROP TABLE heartbeat_occurrences; DROP TABLE heartbeat_schedules;
        DROP TABLE task_followups; DROP TABLE task_followup_delegations;
        DROP TABLE native_task_launches; DROP TABLE peer_goal_starts;
        DROP TABLE session_mcp_refresh; DROP TABLE task_questions;
        PRAGMA user_version=41;").unwrap();
    conn.execute_batch(
        "CREATE TRIGGER unknown_inbox BEFORE UPDATE ON session_inbox BEGIN SELECT 1; END;",
    )
    .unwrap();
    let with_trigger = catalog(&conn);
    drop(conn);
    assert!(initialize(&path).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(catalog(&conn), with_trigger);
    conn.execute_batch("DROP TRIGGER unknown_inbox").unwrap();
    conn.execute_batch("CREATE INDEX unsupported_origin_index ON session_inbox(completion_source)")
        .unwrap();
    let with_index = catalog(&conn);
    drop(conn);
    assert!(initialize(&path).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(catalog(&conn), with_index);
    conn.execute_batch("DROP INDEX unsupported_origin_index")
        .unwrap();
    let before = catalog(&conn);
    drop(conn);
    assert!(
        initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("injected rollback"))).is_err()
    );
    let rolled_back = Connection::open(&path).unwrap();
    assert_eq!(catalog(&rolled_back), before);
    assert_eq!(
        rolled_back
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        41
    );
    assert_eq!(rolled_back.query_row::<i64, _, _>("SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'", [], |row| row.get(0)).unwrap(), 7);
    drop(rolled_back);
    initialize(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    let columns = |db: &Connection| -> Vec<String> {
        db.prepare("PRAGMA table_info(session_inbox)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    let fresh_path = root.join("fresh.db");
    initialize(&fresh_path).unwrap();
    let fresh = Connection::open(fresh_path).unwrap();
    let upgraded_columns = columns(&conn);
    let fresh_columns = columns(&fresh);
    println!("upgraded columns: {upgraded_columns:?}\nfresh columns: {fresh_columns:?}");
    let retained: (String, String, String, i64) = conn.query_row("SELECT content,completion_source,completion_session_id,completion_generation FROM session_inbox WHERE id=7", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap();
    assert_eq!(
        retained,
        (
            "literal user text".into(),
            "traditional_child".into(),
            "child".into(),
            3
        )
    );
    assert_eq!(
        upgraded_columns, fresh_columns,
        "fresh and upgraded physical column order differs"
    );
    let old_catalog = catalog(&conn);
    let fresh_catalog = catalog(&fresh);
    let old_map: std::collections::BTreeMap<_, _> = old_catalog
        .iter()
        .map(|(kind, name, sql)| ((kind, name), sql))
        .collect();
    let fresh_map: std::collections::BTreeMap<_, _> = fresh_catalog
        .iter()
        .map(|(kind, name, sql)| ((kind, name), sql))
        .collect();
    let differences: Vec<_> = old_map
        .keys()
        .chain(fresh_map.keys())
        .filter(|key| old_map.get(key) != fresh_map.get(key))
        .collect();
    assert!(
        differences.is_empty(),
        "catalog differences: {differences:?}"
    );
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        7
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT seq FROM sqlite_sequence WHERE name='session_inbox'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        1000
    );
    conn.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at) VALUES('retained','queue','pending','new','now','now')", []).unwrap();
    assert_eq!(conn.last_insert_rowid(), 1001);
    conn.execute("DELETE FROM session_inbox WHERE id=7", [])
        .unwrap();
    assert_eq!(
        conn.query_row::<Option<i64>, _, _>(
            "SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        None
    );
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    drop((conn, fresh));
    std::fs::remove_dir_all(root).unwrap();
}
