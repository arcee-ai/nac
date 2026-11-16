use super::*;

#[test]
fn schema_42_upgrades_actual_41_atomically_and_retains_launch_inventory() {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-native-launch-migration-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "source");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('source','followup','target','{}','queue',123,'now')",[]).unwrap();
    conn.execute_batch("DROP TABLE native_task_launches; PRAGMA user_version=41;")
        .unwrap();
    drop(conn);
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("rollback"))).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        41
    );
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='native_task_launches')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!exists);
    drop(conn);
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    let followups: i64 = conn
        .query_row("SELECT COUNT(*) FROM task_followups", [], |r| r.get(0))
        .unwrap();
    assert_eq!(followups, 1, "schema 41 receipts remain authoritative");
    let insert = "INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at) VALUES(?1,'source','project','{}','/saved/project',?2,?3,?4,'now','now')";
    conn.execute(insert, params!["request", "task", false, "reserved"])
        .unwrap();
    assert!(conn
        .execute(insert, params!["request", "other", false, "reserved"])
        .is_err());
    assert!(conn
        .execute(insert, params!["other", "task", false, "reserved"])
        .is_err());
    assert!(conn
        .execute(insert, params!["bad", "bad", 2, "reserved"])
        .is_err());
    assert!(conn
        .execute(insert, params!["bad", "bad", false, "invented"])
        .is_err());
    conn.execute("DELETE FROM sessions WHERE session_id='source'", [])
        .unwrap();
    conn.pragma_update(None, "user_version", 41).unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    let record:(String,String,String) = conn.query_row("SELECT caller_session_id,session_id,source_cwd FROM native_task_launches WHERE request_id='request'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(
        record,
        ("source".into(), "task".into(), "/saved/project".into())
    );
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
