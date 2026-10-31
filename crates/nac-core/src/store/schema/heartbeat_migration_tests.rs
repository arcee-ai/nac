use super::*;

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
    {
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('caller','followup','target','{}','queue',?1,'now')",[inbox.id]).unwrap();
        conn.execute("INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at) VALUES('launch','caller','project','{}','/repo','launched',0,'reserved','now','now')",[]).unwrap();
        conn.execute("INSERT INTO peer_goal_starts(caller_session_id,request_id,target_session_id,request_json,response_json) VALUES('caller','start','target','canonical arguments','original admission')",[]).unwrap();
        // 44 adds only these tables/indexes. Removing them reconstructs the
        // verified supplier43 catalog, with actual41/42/43 receipts retained.
        conn.execute_batch("DROP TABLE heartbeat_commands; DROP TABLE heartbeat_occurrences; DROP TABLE heartbeat_schedules; PRAGMA user_version=43;").unwrap();
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
            44
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
