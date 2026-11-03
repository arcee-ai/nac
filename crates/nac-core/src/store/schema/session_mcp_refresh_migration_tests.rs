use super::*;

#[test]
fn schema_45_upgrades_actual_44_atomically_without_rewriting_or_scheduling_work() {
    let root = std::env::temp_dir().join(format!("nac-mcp-migration45-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    initialize(&path).unwrap();
    for id in ["owner", "target"] {
        insert_test_session(&path, id);
    }
    let inbox = create_session_inbox_item(
        &path,
        "target",
        InboxDelivery::Queue,
        "existing fixture guidance",
        None,
        None,
    )
    .unwrap();
    let before: Vec<(String, String, String)>;
    {
        let connection = open_runtime_connection(&path).unwrap();
        connection.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('owner','followup','target','{}','queue',?1,'fixture')", [inbox.id]).unwrap();
        connection.execute("INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at) VALUES('launch','owner','fixture-project','{}','/fixture','fixture-session',0,'reserved','fixture','fixture')", []).unwrap();
        connection.execute("INSERT INTO peer_goal_starts(caller_session_id,request_id,target_session_id,request_json,response_json) VALUES('owner','goal','target','{}','original admission')", []).unwrap();
        connection.execute("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES('schedule','owner',1,'paused','{}','{}',0,60000,0,0)", []).unwrap();
        before = connection
            .prepare("SELECT session_id,behavior,messages_json FROM sessions ORDER BY session_id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        // The sole 45 addition is this table. Removing it reconstructs the
        // verified 44 supplier with its real 41/42/43/44 receipt tables intact.
        connection
            .execute_batch("DROP TABLE session_mcp_refresh; PRAGMA user_version=44;")
            .unwrap();
    }
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("before MCP refresh migration commit"))
    )
    .is_err());
    {
        let connection = Connection::open(&path).unwrap();
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            44
        );
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='session_mcp_refresh')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!exists, "DDL and schema version must roll back together");
        assert_eq!(
            connection
                .query_row::<String, _, _>(
                    "SELECT response_json FROM peer_goal_starts WHERE request_id='goal'",
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
        let connection = open_runtime_connection(&path).unwrap();
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            STORE_SCHEMA_VERSION
        );
        let after: Vec<(String, String, String)> = connection
            .prepare("SELECT session_id,behavior,messages_json FROM sessions ORDER BY session_id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(after, before);
        for table in [
            "task_followups",
            "native_task_launches",
            "peer_goal_starts",
            "heartbeat_schedules",
        ] {
            assert_eq!(
                connection
                    .query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |row| row
                        .get(0))
                    .unwrap(),
                1
            );
        }
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT count(*) FROM session_mcp_refresh", [], |row| row
                    .get(0))
                .unwrap(),
            0,
            "migration cannot request refresh or wake work"
        );
        assert!(connection
            .execute(
                "INSERT INTO session_mcp_refresh VALUES ('missing-owner',1,'fixture')",
                []
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO session_mcp_refresh VALUES ('owner',0,'fixture')",
                []
            )
            .is_err());
    }
    assert_eq!(
        load_session_inbox_item(&path, "target", inbox.id).unwrap(),
        inbox
    );
    assert_eq!(
        load_session_mcp_refresh(&path, "owner").unwrap().revision,
        0
    );
    let requested = request_session_mcp_refresh(&path, "owner", 0).unwrap();
    initialize(&path).unwrap();
    assert_eq!(load_session_mcp_refresh(&path, "owner").unwrap(), requested);
    std::fs::remove_dir_all(root).unwrap();
}
