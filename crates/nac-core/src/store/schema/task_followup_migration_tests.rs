use super::*;

#[test]
fn schema_41_upgrades_40_atomically_and_preserves_existing_inbox() {
    let path = std::env::temp_dir()
        .join(format!("nac-followup-migration-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "target");
    let legacy = create_person_session_inbox_item(
        &path,
        "target",
        InboxDelivery::Steer,
        "person input",
        Some("prior-run"),
        Some("client"),
        "person input",
    )
    .unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch("DROP TABLE task_followups; PRAGMA user_version=40;")
        .unwrap();
    drop(conn);

    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("rollback"))).is_err());
    let conn = Connection::open(&path).unwrap();
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 40);
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='task_followups')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!exists);
    drop(conn);

    initialize(&path).unwrap();
    initialize(&path).unwrap();
    assert_eq!(
        load_session_inbox_item(&path, "target", legacy.id).unwrap(),
        legacy
    );
    let conn = open_runtime_connection(&path).unwrap();
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, STORE_SCHEMA_VERSION);
    let intent: String = conn
        .query_row(
            "SELECT review_intent FROM session_inbox WHERE id=?1",
            [legacy.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(intent.contains("person input"));
    let insert = "INSERT INTO task_followups(caller_session_id,request_id,target_session_id,
        request_json,resolved_delivery,admitted_run_id,inbox_item_id,created_at)
        VALUES(?1,?2,'target','{}',?3,NULL,?4,'now')";
    conn.execute(insert, params!["caller", "one", "queue", legacy.id])
        .unwrap();
    assert!(conn
        .execute(insert, params!["caller", "one", "queue", legacy.id + 1])
        .is_err());
    assert!(conn
        .execute(insert, params!["other", "one", "queue", legacy.id])
        .is_err());
    assert!(conn
        .execute(insert, params!["caller", "two", "auto", legacy.id + 1])
        .is_err());
    conn.execute(insert, params!["other", "one", "steer", legacy.id + 1])
        .unwrap();
    // Re-entering migration after a successful table creation preserves receipts.
    conn.pragma_update(None, "user_version", 40).unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM task_followups", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
    // Receipts outlive missing inbox rows, making deletion an inspectable unknown.
    conn.execute("DELETE FROM sessions WHERE session_id='target'", [])
        .unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM task_followups", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
    drop(conn);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
