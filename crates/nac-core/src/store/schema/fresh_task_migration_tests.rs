use super::*;

fn rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut query = conn
        .prepare(&format!("SELECT * FROM {table} ORDER BY 1"))
        .unwrap();
    let width = query.column_count();
    query
        .query_map([], |row| (0..width).map(|index| row.get(index)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn previous_schema(path: &Path) {
    initialize(path).unwrap();
    insert_test_session(path, "legacy");
    insert_test_session(path, "creator");
    let conn = open_runtime_connection(path).unwrap();
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
    conn.execute_batch(
        "INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,starts,tokens_used,time_used_ms,usage_unknown,created_at_ms,updated_at_ms)
         VALUES('original','legacy',7,'paused','{\"retained_binding\":true}','{\"retained_specification\":true}',100,60100,2,345,2345,1,100,200);
         INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id,run_id,generation,expected_revision,provisional_outcome,outcome,evidence,tokens_used,started_at_ms,settled_at_ms,attempt_count,settlement_sequence)
         VALUES('settled','original','legacy',6,60100,180100,3,'interval','settled','{\"original_specification\":true}','receipt','exact-run','generation',8,'unchanged','failed','failure overrides provisional result',345,200100,202445,1,1);
         INSERT INTO heartbeat_commands VALUES('legacy','request','canonical-digest','original','{\"original_response\":true}',100);
         PRAGMA user_version=47;",
    ).unwrap();
}

#[test]
fn schema_48_rebuild_preserves_original_facts_with_foreign_keys_and_atomic_rollback() {
    let root = std::env::temp_dir().join(format!("nac-fresh-migration-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    previous_schema(&path);
    let tables = [
        "heartbeat_schedules",
        "heartbeat_occurrences",
        "heartbeat_commands",
    ];
    let before = {
        let conn = Connection::open(&path).unwrap();
        tables.map(|table| rows(&conn, table))
    };
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("before commit"))).is_err());
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            47
        );
        assert_eq!(tables.map(|table| rows(&conn, table)), before);
        assert!(!conn.query_row::<bool, _, _>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='heartbeat_fresh_destinations')", [], |row| row.get(0)).unwrap());
    }
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    {
        let conn = open_runtime_connection(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "foreign_keys", |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(tables.map(|table| rows(&conn, table)), before);
        assert_eq!(rows(&conn, "heartbeat_retained_commands").len(), 0);
        assert_eq!(conn.query_row::<(i64,i64),_,_>("SELECT retained_limit,revision FROM heartbeat_retained_allowance WHERE singleton=1",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap(),(100,1));
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM pragma_foreign_key_check",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            0
        );
        // Preserve receipt and active/pending uniqueness after the rebuild.
        let insert = "INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id) VALUES(?1,'original','legacy',7,60100,60100,1,'interval',?2,'{}',?3)";
        for state in ["pending", "admitted"] {
            conn.execute(insert, params![state, state, format!("{state}-receipt")])
                .unwrap();
            assert!(conn
                .execute(
                    insert,
                    params![
                        format!("{state}-duplicate"),
                        state,
                        format!("{state}-other-receipt")
                    ]
                )
                .is_err());
        }
        assert!(conn
            .execute(insert, params!["duplicate-receipt", "pending", "receipt"])
            .is_err());
        conn.execute("DELETE FROM sessions WHERE session_id='legacy'", [])
            .unwrap();
        for table in tables {
            assert!(rows(&conn, table).is_empty(), "legacy cascade {table}");
        }
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn schema_48_standalone_creator_and_task_deletion_preserve_receipts_and_resource_ownership() {
    let root = std::env::temp_dir().join(format!("nac-fresh-ownership-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "creator");
    insert_test_session(&path, "produced");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch(
        "INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms)
         VALUES('standalone',NULL,1,'active','{}','{}',0,60000,0,0);
         INSERT INTO heartbeat_fresh_destinations VALUES('standalone','project','creator','{}','{}');
         INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id)
         VALUES('occurrence','standalone','produced',1,60000,60000,1,'interval','admitted','{}','receipt');
         INSERT INTO heartbeat_commands VALUES('project:project','request','digest','standalone','{}',0);
         INSERT INTO heartbeat_task_launches(occurrence_id,schedule_id,request_id,project_id,launch_json,session_id,created_at_ms) VALUES('occurrence','standalone','launch','project','{}','produced',0);
         DELETE FROM sessions WHERE session_id IN ('creator','produced');",
    ).unwrap();
    for table in [
        "heartbeat_schedules",
        "heartbeat_fresh_destinations",
        "heartbeat_occurrences",
        "heartbeat_commands",
        "heartbeat_task_launches",
    ] {
        assert_eq!(
            rows(&conn, table).len(),
            1,
            "{table} survives session deletion"
        );
    }
    conn.execute("DELETE FROM heartbeat_occurrences", [])
        .unwrap();
    assert_eq!(rows(&conn, "heartbeat_task_launches").len(), 1);
    conn.execute("DELETE FROM heartbeat_schedules", []).unwrap();
    assert_eq!(rows(&conn, "heartbeat_task_launches").len(), 1);
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .unwrap(),
        0
    );
    drop(conn);
    initialize(&path).unwrap();
    assert_eq!(
        rows(
            &open_runtime_connection(&path).unwrap(),
            "heartbeat_task_launches"
        )
        .len(),
        1
    );
    std::fs::remove_dir_all(root).unwrap();
}
