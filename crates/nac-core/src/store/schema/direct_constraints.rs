//! Tighten direct-only constraints without rebuilding referenced tables.
//!
//! SQLite documents this catalog-edit procedure for changes that do not alter
//! the on-disk record format (https://www.sqlite.org/lang_altertable.html).
//! Rebuilding these tables would require disabling foreign keys before the
//! transaction, preventing earlier retirement migrations from cascading.
use super::*;

const SESSION_CHECK: &str =
    "CHECK (behavior IN ('orchestrator', 'direct', 'direct-with-orchestrator'))";
const COMPLETION_COLUMN: &str = "behavior TEXT NOT NULL CHECK(behavior IN ('orchestrator','direct','direct-with-orchestrator'))";
const INBOX_COLUMN: &str = "completion_source TEXT CHECK (completion_source IN ('traditional_child', 'managed_orchestrator'))";

fn replace_once(sql: &str, old: &str, new: &str, table: &str) -> Result<String> {
    if sql.matches(old).count() != 1 {
        anyhow::bail!("unexpected {table} schema while tightening direct constraints");
    }
    Ok(sql.replacen(old, new, 1))
}

pub(super) fn tighten(conn: &Connection) -> Result<()> {
    let mut edits = Vec::new();
    for table in [
        "sessions",
        "session_completion_bindings",
        "session_completion_occurrences",
        "session_inbox",
    ] {
        let sql: String = conn.query_row(
            "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",
            [table],
            |r| r.get(0),
        )?;
        let updated = match table {
            "sessions" => {
                // Both original inline definitions and historical ALTER TABLE
                // additions are supported, with their exact separator retained.
                let mut variants = Vec::new();
                for default in ["direct", "orchestrator"] {
                    for separator in ["\n                 ", " "] {
                        let old = format!(
                            "behavior TEXT NOT NULL DEFAULT '{default}'{separator}{SESSION_CHECK}"
                        );
                        let new = format!("behavior TEXT NOT NULL DEFAULT 'direct'{separator}CHECK (behavior = 'direct')");
                        if sql.matches(&old).count() == 1 {
                            variants.push((old, new));
                        }
                    }
                }
                if variants.len() != 1 {
                    anyhow::bail!("unexpected sessions behavior definition");
                }
                replace_once(&sql, &variants[0].0, &variants[0].1, table)?
            }
            "session_inbox" => {
                let ada_column = "completion_source\n    TEXT CHECK(completion_source IN ('traditional_child','managed_orchestrator'))";
                if sql.matches(INBOX_COLUMN).count() == 1 && !sql.contains(ada_column) {
                    replace_once(
                        &sql,
                        INBOX_COLUMN,
                        "completion_source TEXT CHECK (completion_source = 'traditional_child')",
                        table,
                    )?
                } else if sql.matches(ada_column).count() == 1 && !sql.contains(INBOX_COLUMN) {
                    replace_once(&sql, ada_column, "completion_source\n    TEXT CHECK(completion_source = 'traditional_child')", table)?
                } else {
                    anyhow::bail!("unexpected session inbox origin definition");
                }
            }
            _ => replace_once(
                &sql,
                COMPLETION_COLUMN,
                "behavior TEXT NOT NULL CHECK(behavior = 'direct')",
                table,
            )?,
        };
        edits.push((table, sql, updated));
    }
    for (table, predicate) in [
        ("sessions", "behavior IS NULL OR behavior <> 'direct'"),
        (
            "session_completion_bindings",
            "behavior IS NULL OR behavior <> 'direct'",
        ),
        (
            "session_completion_occurrences",
            "behavior IS NULL OR behavior <> 'direct'",
        ),
        (
            "session_inbox",
            "completion_source IS NOT NULL AND completion_source <> 'traditional_child'",
        ),
    ] {
        let invalid: bool = conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {predicate})"),
            [],
            |r| r.get(0),
        )?;
        if invalid {
            anyhow::bail!("retired or invalid values remain in {table}");
        }
    }
    // Reject modified or absent enforcement triggers rather than silently
    // discarding unknown catalog behavior. Whitespace varies by predecessor.
    for (name, expected) in [
        ("session_direct_only_insert", "CREATE TRIGGER session_direct_only_insert BEFORE INSERT ON sessions WHEN NEW.behavior <> 'direct' BEGIN SELECT RAISE(ABORT, 'retired session behavior'); END"),
        ("session_direct_only_update", "CREATE TRIGGER session_direct_only_update BEFORE UPDATE OF behavior ON sessions WHEN NEW.behavior <> 'direct' BEGIN SELECT RAISE(ABORT, 'retired session behavior'); END"),
        ("session_direct_inbox_origin_insert", "CREATE TRIGGER session_direct_inbox_origin_insert BEFORE INSERT ON session_inbox WHEN NEW.completion_source = 'managed_orchestrator' BEGIN SELECT RAISE(ABORT, 'retired inbox origin'); END"),
        ("session_direct_inbox_origin_update", "CREATE TRIGGER session_direct_inbox_origin_update BEFORE UPDATE OF completion_source ON session_inbox WHEN NEW.completion_source = 'managed_orchestrator' BEGIN SELECT RAISE(ABORT, 'retired inbox origin'); END"),
    ] {
        let sql: String = conn.query_row("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?1", [name], |r| r.get(0))?;
        if sql.split_whitespace().collect::<Vec<_>>().join(" ") != expected {
            anyhow::bail!("unexpected {name} trigger definition");
        }
    }
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS session_direct_only_insert;
        DROP TRIGGER IF EXISTS session_direct_only_update;
        DROP TRIGGER IF EXISTS session_direct_inbox_origin_insert;
        DROP TRIGGER IF EXISTS session_direct_inbox_origin_update;",
    )?;
    let cookie: i64 = conn.pragma_query_value(None, "schema_version", |r| r.get(0))?;
    let next = cookie
        .checked_add(1)
        .filter(|n| *n <= i32::MAX as i64)
        .ok_or_else(|| anyhow!("SQLite schema cookie exhausted"))?;
    conn.execute_batch("PRAGMA writable_schema=ON")?;
    // Always restore the connection setting before returning even on error.
    // Migration connections are not reused; a failed reset closes the handle.
    let result = (|| -> Result<()> {
        for (table, old, new) in &edits {
            let count = conn.execute(
                "UPDATE sqlite_schema SET sql=?1 WHERE type='table' AND name=?2 AND sql=?3",
                rusqlite::params![new, table, old],
            )?;
            if count != 1 {
                anyhow::bail!("schema changed while updating {table}");
            }
        }
        conn.pragma_update(None, "schema_version", next)?;
        Ok(())
    })();
    let reset = conn.execute_batch("PRAGMA writable_schema=OFF");
    result?;
    reset?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        anyhow::bail!("SQLite integrity check failed: {integrity}");
    }
    if conn
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        anyhow::bail!("foreign key check failed after direct constraint migration");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
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
            conn.query_row::<i64, _, _>(
                "SELECT rowid FROM sessions WHERE session_id='s'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT content FROM session_inbox WHERE id=4",
                [],
                |r| r.get(0)
            )
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
        assert_eq!(conn.query_row::<i64,_,_>("SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'", [], |r|r.get(0)).unwrap(), 4);
        conn.execute("DELETE FROM session_inbox WHERE id=4", [])
            .unwrap();
        assert_eq!(conn.query_row::<Option<i64>,_,_>("SELECT completion_inbox_id FROM traditional_children WHERE child_session_id='child'", [], |r|r.get(0)).unwrap(), None);
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
                conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get(0))
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
}
