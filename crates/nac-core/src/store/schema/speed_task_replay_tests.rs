use super::*;

#[test]
fn actual_v55_writer_fast_task_survives_rename_rollback_and_replay() {
    const ID: &str = "5c26d9ef-928d-4563-9794-370479d60e71";
    let path = temp_store_path("actual_v55_fast_task");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v55-speed-task.sql"))
        .unwrap();
    let raw: String = conn
        .query_row(
            "SELECT request_json FROM task_launches WHERE request_id=?1",
            [ID],
            |row| row.get(0),
        )
        .unwrap();
    assert!(raw.contains("\"service_tier\":\"fast\""));
    drop(conn);
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("rollback"))).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        55
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT request_json FROM task_launches WHERE request_id=?1",
            [ID],
            |row| row.get(0)
        )
        .unwrap(),
        raw
    );
    drop(conn);
    initialize(&path).unwrap();
    let record = crate::store::load_task_launch(&path, ID).unwrap().unwrap();
    let selected = record.request.model_selection.as_ref().unwrap();
    assert_eq!(selected.service_tier.as_deref(), Some("fast"));
    assert_eq!(selected.compaction_threshold, Some(8192));
    let replay =
        crate::store::reserve_task_launch(&path, record.request.clone(), record.source.clone())
            .unwrap();
    assert_eq!(replay, record);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT request_json FROM task_launches WHERE request_id=?1",
            [ID],
            |row| row.get(0)
        )
        .unwrap(),
        raw
    );
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn actual_v55_source_task_preserves_private_headers_and_bound_legacy_replay() {
    const ID: &str = "21a44b75-3bd0-46f3-9a8b-fbc23339f426";
    let path = temp_store_path("actual_v55_source_task");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", false).unwrap();
    conn.execute_batch(include_str!("fixtures/v55-source-task.sql"))
        .unwrap();
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    let (raw, source): (String, String) = conn
        .query_row(
            "SELECT request_json,source_json FROM task_launches WHERE request_id=?1",
            [ID],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert!(raw.contains("orchestrator_compaction_threshold"));
    assert!(raw.contains("\"model_source\""));
    assert!(source.contains("private-fixture-canary"));
    drop(conn);
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("rollback"))).is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        55
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT request_json FROM task_launches WHERE request_id=?1",
            [ID],
            |r| r.get(0)
        )
        .unwrap(),
        raw
    );
    drop(conn);
    initialize(&path).unwrap();
    let record = crate::store::load_task_launch(&path, ID).unwrap().unwrap();
    let selected = record.request.model_selection.as_ref().unwrap();
    assert_eq!(selected.service_tier.as_deref(), Some("fast"));
    assert_eq!(selected.compaction_threshold, Some(8192));
    assert_eq!(
        record
            .frozen_model_headers
            .as_ref()
            .unwrap()
            .0
            .get("x-project-token")
            .map(String::as_str),
        Some("private-fixture-canary")
    );
    assert!(!serde_json::to_string(&record)
        .unwrap()
        .contains("private-fixture-canary"));
    let conn = Connection::open(&path).unwrap();
    let marker: String = conn.query_row("SELECT evidence_sha256 FROM task_model_v54_provenance WHERE owner='task' AND key1=?1 AND key2=''", [ID], |r| r.get(0)).unwrap();
    assert_eq!(marker.len(), 64);
    conn.execute("DELETE FROM sessions WHERE session_id='source'", [])
        .unwrap();
    drop(conn);
    assert_eq!(
        crate::store::reserve_task_launch(&path, record.request.clone(), record.source.clone())
            .unwrap(),
        record
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT request_json FROM task_launches WHERE request_id=?1",
            [ID],
            |r| r.get(0)
        )
        .unwrap(),
        raw
    );
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT source_json FROM task_launches WHERE request_id=?1",
            [ID],
            |r| r.get(0)
        )
        .unwrap(),
        source
    );
    conn.execute("UPDATE task_launches SET source_json=json_remove(source_json,'$._nac_model_headers') WHERE request_id=?1", [ID]).unwrap();
    conn.execute("INSERT INTO task_model_v54_provenance(owner,key1,key2,evidence_sha256) VALUES('task',?1,'',?2)", params![ID, marker]).unwrap();
    drop(conn);
    assert!(crate::store::load_task_launch(&path, ID)
        .unwrap_err()
        .to_string()
        .contains("invalid task model source receipt"));
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "UPDATE task_launches SET source_json=?2 WHERE request_id=?1",
        params![ID, source],
    )
    .unwrap();
    conn.execute("UPDATE task_launches SET request_json=json_set(request_json,'$.model_source.session_id','different') WHERE request_id=?1", [ID]).unwrap();
    conn.execute("INSERT INTO task_model_v54_provenance(owner,key1,key2,evidence_sha256) VALUES('task',?1,'',?2)", params![ID, marker]).unwrap();
    drop(conn);
    assert!(crate::store::load_task_launch(&path, ID)
        .unwrap_err()
        .to_string()
        .contains("legacy task model evidence changed"));
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "UPDATE task_launches SET request_json=?2 WHERE request_id=?1",
        params![ID, raw],
    )
    .unwrap();
    conn.execute(
        "DELETE FROM task_model_v54_provenance WHERE owner='task' AND key1=?1",
        [ID],
    )
    .unwrap();
    drop(conn);
    assert!(crate::store::load_task_launch(&path, ID).is_err());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
