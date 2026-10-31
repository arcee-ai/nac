use super::*;

#[test]
fn schema_43_upgrades_actual_42_atomically_and_preserves_supplier_receipts() {
    let path = std::env::temp_dir()
        .join(format!("nac-peer-start-migration-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["caller", "other-caller", "target"] {
        insert_test_session(&path, id);
    }
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('caller','followup','target','{}','queue',123,'now')", []).unwrap();
    conn.execute("INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at) VALUES('launch','caller','project','{}','/repo','launched',0,'reserved','now','now')", []).unwrap();
    conn.execute_batch("DROP TABLE peer_goal_starts; PRAGMA user_version=42;")
        .unwrap();
    drop(conn);
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("rollback"))).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        42
    );
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='peer_goal_starts')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!exists, "failed migration must roll back table and version");
    drop(conn);
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT COUNT(*) FROM task_followups WHERE request_id='followup'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT session_id FROM native_task_launches WHERE request_id='launch'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        "launched"
    );
    let insert = "INSERT INTO peer_goal_starts(caller_session_id,request_id,target_session_id,request_json,response_json) VALUES(?1,?2,'target','arguments','original reply')";
    conn.execute(insert, params!["caller", "start"]).unwrap();
    assert!(conn.execute(insert, params!["caller", "start"]).is_err());
    conn.execute(insert, params!["other-caller", "start"])
        .unwrap();
    assert!(conn.execute(insert, params!["caller", ""]).is_err());
    assert!(conn.execute(insert, params!["missing", "start"]).is_err());
    conn.pragma_update(None, "user_version", 42).unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    assert_eq!(conn.query_row::<String, _, _>("SELECT response_json FROM peer_goal_starts WHERE caller_session_id='caller' AND request_id='start'", [], |row| row.get(0)).unwrap(), "original reply");
    conn.execute("DELETE FROM sessions WHERE session_id='target'", [])
        .unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM peer_goal_starts", [], |row| row
            .get(0))
            .unwrap(),
        0
    );
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
