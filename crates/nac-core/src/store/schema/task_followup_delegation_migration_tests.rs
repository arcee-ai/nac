use super::*;

const ALLOCATIONS: &[(i64, &[&str])] = &[
    (42, &["native_task_launches"]),
    (43, &["peer_goal_starts"]),
    (
        44,
        &[
            "heartbeat_commands",
            "heartbeat_occurrences",
            "heartbeat_schedules",
        ],
    ),
    (45, &["session_mcp_refresh"]),
    (46, &["task_questions"]),
];

fn rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut names = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap();
    let columns = names
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .filter(|c| c != "delegation_id")
        .collect::<Vec<_>>();
    let mut query = conn
        .prepare(&format!(
            "SELECT {} FROM {table} ORDER BY 1",
            columns.join(",")
        ))
        .unwrap();
    query
        .query_map([], |row| {
            columns
                .iter()
                .enumerate()
                .map(|(i, _)| row.get(i))
                .collect()
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn heartbeat_layout(conn: &Connection) -> Vec<(String, String)> {
    let mut query = conn
        .prepare(
            "SELECT name,sql FROM sqlite_master WHERE name IN (
            'heartbeat_schedules','heartbeat_occurrences','heartbeat_commands',
            'idx_heartbeat_due','idx_heartbeat_session','idx_heartbeat_pending',
            'idx_heartbeat_active','idx_heartbeat_history','idx_heartbeat_run') ORDER BY name",
        )
        .unwrap();
    query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn seed(conn: &Connection, version: i64) {
    if version >= 42 {
        conn.execute_batch("INSERT INTO native_task_launches VALUES('launch-key','caller','project','{}','/repo','launched',0,'failed','retained failure',NULL,'created','updated');").unwrap();
    }
    if version >= 43 {
        conn.execute_batch("INSERT INTO peer_goal_starts VALUES('caller','peer-goal','target','{}','{\"retained\":true}');").unwrap();
    }
    if version >= 44 {
        conn.execute_batch("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES('schedule','caller',1,'paused','{}','{}',0,0,0,0);
        INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,settlement_sequence) VALUES('occurrence','schedule','caller',1,0,0,1,'run_now','withdrawn','{}','heartbeat-receipt',1);
        INSERT INTO heartbeat_commands VALUES('caller','heartbeat-command','digest','schedule','{}',0);").unwrap();
    }
    if version >= 45 {
        conn.execute_batch(
            "INSERT INTO session_mcp_refresh VALUES('caller',3,'retained refresh');",
        )
        .unwrap();
    }
    if version >= 46 {
        conn.execute_batch("INSERT INTO task_questions(session_id,request_id,request_json,creation_digest,config_version,revision,status,created_at) VALUES('caller','question','{}','digest',0,1,'cancelled','retained question');").unwrap();
    }
}

#[test]
fn followup_schema47_upgrades_each_allocated_predecessor_without_inventing_authority() {
    for version in 41..=46 {
        let path = std::env::temp_dir()
            .join(format!("nac-delegation-migration-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        initialize(&path).unwrap();
        for id in ["caller", "target"] {
            insert_test_session(&path, id);
            open_runtime_connection(&path)
                .unwrap()
                .execute(
                    "UPDATE sessions SET behavior='direct' WHERE session_id=?1",
                    [id],
                )
                .unwrap();
        }
        let input = r#"{"caller_session_id":"caller","request_id":"historical","target_session_id":"target","project_id":null,"action":"queue","expected_run_id":null,"prompt":"historical peer input"}"#;
        let inbox = create_session_inbox_item(
            &path,
            "target",
            InboxDelivery::Queue,
            "historical peer input",
            None,
            None,
        )
        .unwrap();
        let conn = open_runtime_connection(&path).unwrap();
        let current_heartbeat_layout = heartbeat_layout(&conn);
        assert_eq!(current_heartbeat_layout.len(), 9);
        conn.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('caller','historical','target',?1,'queue',?2,'retained')",params![input,inbox.id]).unwrap();
        conn.execute_batch("ALTER TABLE task_followups DROP COLUMN delegation_id; DROP TABLE task_followup_delegations;").unwrap();
        // Reconstruct allocated historical ownership, not a latest-schema
        // hybrid carrying a stale physical48 marker into predecessors41..46.
        conn.execute_batch(
            "DROP TABLE heartbeat_fresh_destinations;
             DROP TABLE heartbeat_task_launches;
             DROP TABLE heartbeat_retained_commands;
             DROP TABLE heartbeat_retained_allowance;
             DROP TABLE heartbeat_commands;
             DROP TABLE heartbeat_occurrences;
             DROP TABLE heartbeat_schedules;",
        )
        .unwrap();
        heartbeat_tables::create_heartbeat_tables(&conn).unwrap();
        for (allocation, tables) in ALLOCATIONS.iter().rev() {
            if *allocation > version {
                for table in *tables {
                    conn.execute_batch(&format!("DROP TABLE {table};")).unwrap();
                }
            }
        }
        seed(&conn, version);
        conn.pragma_update(None, "user_version", version).unwrap();
        let mut preserved = vec!["sessions", "session_inbox", "task_followups"];
        for (allocation, tables) in ALLOCATIONS {
            if *allocation <= version {
                preserved.extend_from_slice(tables);
            }
        }
        let before = preserved
            .iter()
            .map(|table| (*table, rows(&conn, table)))
            .collect::<Vec<_>>();
        let definitions = preserved
            .iter()
            .filter(|t| **t != "task_followups")
            .map(|table| {
                (
                    *table,
                    conn.query_row(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                        [table],
                        |r| r.get::<_, String>(0),
                    )
                    .unwrap(),
                )
            })
            .collect::<Vec<_>>();
        drop(conn);
        let reached_commit = std::cell::Cell::new(false);
        assert!(initialize_with_hooks(
            &path,
            || {},
            || {},
            || {
                reached_commit.set(true);
                Err(anyhow!("rollback schema47"))
            }
        )
        .is_err());
        assert!(
            reached_commit.get(),
            "predecessor {version} must reach the real rollback boundary"
        );
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            version
        );
        assert!(!column_exists(&conn, "task_followups", "delegation_id").unwrap());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='task_followup_delegations'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        for (table, old) in &before {
            assert_eq!(
                rows(&conn, table),
                *old,
                "rollback schema {version}: {table}"
            );
        }
        for (table, definition) in &definitions {
            assert_eq!(
                conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get::<_, String>(0),
                )
                .unwrap(),
                *definition,
                "rollback schema {version}: {table}"
            );
        }
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM sqlite_master WHERE name='heartbeat_fresh_destinations'",
                [],
                |r| r.get(0),
            )
            .unwrap(),
            0
        );
        drop(conn);
        initialize(&path).unwrap();
        initialize(&path).unwrap();
        let conn = open_runtime_connection(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            STORE_SCHEMA_VERSION
        );
        assert_eq!(STORE_SCHEMA_VERSION, 48);
        assert_eq!(
            heartbeat_layout(&conn),
            current_heartbeat_layout,
            "upgrade must install current48 heartbeat table/FK/index definitions"
        );
        for table in ["heartbeat_schedules", "heartbeat_occurrences"] {
            assert_eq!(conn.query_row::<i64,_,_>(
                &format!("SELECT \"notnull\" FROM pragma_table_info('{table}') WHERE name='session_id'"),
                [], |r| r.get(0),
            ).unwrap(), 0, "current48 nullable ownership: {table}");
        }
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get(0),)
                .unwrap(),
            0
        );
        for (table, old) in before {
            assert_eq!(rows(&conn, table), old, "schema {version}: {table}");
        }
        for (table, definition) in definitions {
            let expected = if table.starts_with("heartbeat_") {
                &current_heartbeat_layout
                    .iter()
                    .find(|(name, _)| name == table)
                    .unwrap()
                    .1
            } else {
                &definition
            };
            assert_eq!(
                conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                *expected
            );
        }
        for (_, tables) in ALLOCATIONS {
            for table in *tables {
                assert_eq!(
                    conn.query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                        [table],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                    1
                );
            }
        }
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM task_followup_delegations", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        let retained: (String,i64,Option<String>)=conn.query_row("SELECT request_json,inbox_item_id,delegation_id FROM task_followups WHERE caller_session_id='caller' AND request_id='historical'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(retained, (input.to_owned(), inbox.id, None));
        drop(conn);
        eprintln!("SCHEMA47_FIXTURE_{version}={}", path.display());
    }
}
