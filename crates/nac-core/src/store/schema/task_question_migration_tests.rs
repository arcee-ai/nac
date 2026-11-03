use super::*;

#[test]
fn schema_46_upgrades_actual_45_atomically_without_rewriting_supplier_receipts() {
    let path = std::env::temp_dir()
        .join(format!("nac-question-migration46-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["owner", "target"] {
        insert_test_session(&path, id);
    }
    let inbox = create_session_inbox_item(
        &path,
        "target",
        InboxDelivery::Queue,
        "existing guidance",
        None,
        None,
    )
    .unwrap();
    let refresh = request_session_mcp_refresh(&path, "owner", 0).unwrap();
    let before;
    {
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('owner','followup','target','{}','queue',?1,'fixture')",[inbox.id]).unwrap();
        conn.execute("INSERT INTO native_task_launches(request_id,caller_session_id,project_id,request_json,source_cwd,session_id,retained,phase,created_at,updated_at) VALUES('launch','owner','project','{}','/repo','launched',0,'reserved','fixture','fixture')",[]).unwrap();
        conn.execute("INSERT INTO peer_goal_starts(caller_session_id,request_id,target_session_id,request_json,response_json) VALUES('owner','goal','target','{}','original receipt')",[]).unwrap();
        conn.execute("INSERT INTO heartbeat_schedules(schedule_id,session_id,version,state,binding_json,specification_json,anchor_ms,next_due_ms,created_at_ms,updated_at_ms) VALUES('schedule','owner',1,'paused','{}','{}',0,60000,0,0)",[]).unwrap();
        before = conn
            .prepare("SELECT session_id,behavior,messages_json FROM sessions ORDER BY session_id")
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        conn.execute_batch("DROP TABLE task_questions; PRAGMA user_version=45;")
            .unwrap();
    }
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("before question migration commit"))
    )
    .is_err());
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            45
        );
        assert!(!conn
            .query_row::<bool, _, _>(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='task_questions')",
                [],
                |r| r.get(0)
            )
            .unwrap());
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT response_json FROM peer_goal_starts", [], |r| r
                .get(0))
                .unwrap(),
            "original receipt"
        );
    }
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    let after = conn
        .prepare("SELECT session_id,behavior,messages_json FROM sessions ORDER BY session_id")
        .unwrap()
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(before, after);
    for table in [
        "task_followups",
        "native_task_launches",
        "peer_goal_starts",
        "heartbeat_schedules",
        "session_mcp_refresh",
    ] {
        assert_eq!(
            conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap(),
            1
        );
    }
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_questions", [], |r| r.get(0))
            .unwrap(),
        0
    );
    let insert="INSERT INTO task_questions(session_id,request_id,request_json,config_version,revision,status,created_at,creation_digest) VALUES(?1,?2,'{}',0,1,'pending','fixture','fixture-digest')";
    assert!(conn.execute(insert, params!["missing", "q"]).is_err());
    conn.execute(insert, params!["owner", "q"]).unwrap();
    assert!(conn.execute(insert, params!["owner", "other"]).is_err());
    conn.execute("DELETE FROM sessions WHERE session_id='owner'", [])
        .unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_questions", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        load_session_inbox_item(&path, "target", inbox.id).unwrap(),
        inbox
    );
    assert_eq!(refresh.revision, 1);
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
