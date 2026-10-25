use super::*;

#[test]
fn migration_36_retains_legacy_inbox_and_atomically_adds_child_mode() {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-child-input-migration-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "child");
    let legacy = create_session_inbox_item(
        &path,
        "child",
        InboxDelivery::Steer,
        "legacy input",
        Some("old-run"),
        None,
    )
    .unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute_batch(
            "ALTER TABLE session_inbox DROP COLUMN child_execution_mode; PRAGMA user_version = 35;",
        )
        .unwrap();
    drop(connection);

    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("before commit"))).is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        35
    );
    assert!(!column_exists(&connection, "session_inbox", "child_execution_mode").unwrap());
    drop(connection);

    initialize(&path).unwrap();
    initialize(&path).unwrap();
    assert_eq!(
        load_session_inbox_item(&path, "child", legacy.id).unwrap(),
        legacy
    );
    for mode in [
        TraditionalChildExecutionMode::Foreground,
        TraditionalChildExecutionMode::Background,
    ] {
        let item =
            create_traditional_child_inbox_item(&path, "child", "new input", Some("old-run"), mode)
                .unwrap();
        assert_eq!(item.child_execution_mode, Some(mode));
        assert_eq!(
            load_session_inbox_item(&path, "child", item.id).unwrap(),
            item
        );
        // This metadata must not alter the public inbox/API record shape.
        assert!(serde_json::to_value(&item)
            .unwrap()
            .get("child_execution_mode")
            .is_none());
    }
    let connection = open_runtime_connection(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        36
    );
    assert!(connection
        .execute(
            "UPDATE session_inbox SET child_execution_mode = 'invalid'",
            []
        )
        .is_err());
    drop(connection);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
