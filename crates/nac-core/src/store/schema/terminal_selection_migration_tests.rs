use super::*;
#[test]
fn terminal_selection_migration_34_rolls_back_before_commit_and_restarts() {
    let path = std::env::temp_dir()
        .join(format!("nac-selection-migration-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    let legacy = crate::store::create_session_inbox_item(
        &path,
        "session",
        crate::store::InboxDelivery::Queue,
        "legacy",
        None,
        None,
    )
    .unwrap();
    {
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("DROP INDEX idx_session_inbox_admission; ALTER TABLE session_inbox DROP COLUMN admission_digest; ALTER TABLE session_inbox DROP COLUMN admission_id; PRAGMA user_version=32;").unwrap();
    }
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("injected admission migration failure"))
    )
    .is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        32
    );
    let columns = connection
        .prepare("PRAGMA table_info(session_inbox)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(!columns.iter().any(|column| column == "admission_id"));
    drop(connection);
    initialize(&path).unwrap();
    assert_eq!(
        crate::store::load_session_inbox_item(&path, "session", legacy.id).unwrap(),
        legacy
    );
    assert_eq!(
        Connection::open(&path)
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        35
    );
}
