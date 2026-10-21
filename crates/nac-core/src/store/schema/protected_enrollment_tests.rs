use super::*;

#[test]
fn protected_enrollment_has_durable_audit_and_terminal_fences() {
    let path = std::env::temp_dir()
        .join(format!("nac-enrollment-red-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    for table in ["managed_enrollment_attempts", "managed_enrollment_events"] {
        assert!(
            table_exists(&connection, table).unwrap(),
            "missing durable {table}"
        );
    }
}

#[test]
fn protected_enrollment_upgrade_preserves_schema34_terminal_and_human_shell_rows() {
    let path = std::env::temp_dir()
        .join(format!("nac-enrollment-upgrade-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "retained");
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("INSERT INTO human_shell_operations VALUES('retained','request','fingerprint','operation','started','{\"retained\":true}');
        INSERT INTO terminal_remote_cleanups VALUES('retained','/retained/pid','original');
        DROP TABLE IF EXISTS managed_enrollment_events; DROP TABLE IF EXISTS managed_enrollment_attempts;
        PRAGMA user_version=34;").unwrap();
    let before: String = connection
        .query_row(
            "SELECT snapshot_json FROM human_shell_operations",
            [],
            |r| r.get(0),
        )
        .unwrap();
    drop(connection);
    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    let after: String = connection
        .query_row(
            "SELECT snapshot_json FROM human_shell_operations",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(
        connection
            .query_row("SELECT pidfile FROM terminal_remote_cleanups", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "/retained/pid"
    );
    assert!(table_exists(&connection, "managed_enrollment_events").unwrap());
}

#[test]
fn protected_enrollment_upgrade_rolls_back_and_retries_without_partial_audit() {
    let path = std::env::temp_dir()
        .join(format!("nac-enrollment-rollback-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("DROP TABLE managed_enrollment_events; DROP TABLE managed_enrollment_attempts; PRAGMA user_version=34;").unwrap();
    drop(connection);
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("injected before commit"))
    )
    .is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        34
    );
    assert!(!table_exists(&connection, "managed_enrollment_attempts").unwrap());
    assert!(!table_exists(&connection, "managed_enrollment_events").unwrap());
    drop(connection);
    initialize(&path).unwrap();
    assert!(table_exists(
        &Connection::open(&path).unwrap(),
        "managed_enrollment_events"
    )
    .unwrap());
}

#[test]
fn protected_enrollment_refuses_divergent35_before_rewriting_store() {
    let path = std::env::temp_dir()
        .join(format!("nac-enrollment-refusal-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; PRAGMA user_version=35;",
        )
        .unwrap();
    drop(connection);
    let before = std::fs::read(&path).unwrap();
    assert!(initialize(&path)
        .unwrap_err()
        .to_string()
        .contains("divergent"));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(!sqlite_sidecar_path(&path, "-wal").exists());
    assert!(!sqlite_sidecar_path(&path, "-shm").exists());
}

#[test]
fn schema38_upgrade_preserves37_history_and_rolls_back_atomically() {
    let root =
        std::env::temp_dir().join(format!("native-source-migration-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("store.db");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "template");
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET backend='arcee-api' WHERE session_id='template'",
            [],
        )
        .unwrap();
    let c = Connection::open(&path).unwrap();
    let mut stmt = c
        .prepare(
            "SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'native_source_%'",
        )
        .unwrap();
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    drop(stmt);
    for name in names {
        c.execute_batch(&format!("DROP TRIGGER {name}")).unwrap();
    }
    c.execute_batch("DROP TABLE native_source_slots; DROP TABLE native_source_reservations; DROP TABLE native_source_revisions; PRAGMA user_version=37;").unwrap();
    drop(c);
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("injected migration rollback"))
    )
    .is_err());
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        37
    );
    let count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='native_source_slots'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    drop(c);
    initialize(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        38
    );
    assert!(crate::sessions::load_session(&path, "template").is_ok());
    let count:i64=c.query_row("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('managed_initial_import_grants','managed_initial_import_proofs')",[],|r|r.get(0)).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn current_dev34_upgrade_preserves_session_and_rolls_back_atomically() {
    let root =
        std::env::temp_dir().join(format!("native-source-migration-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("store.db");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "template");
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET backend='arcee-api' WHERE session_id='template'",
            [],
        )
        .unwrap();
    let c = Connection::open(&path).unwrap();
    let mut stmt = c
        .prepare(
            "SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'native_source_%'",
        )
        .unwrap();
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    drop(stmt);
    for name in names {
        c.execute_batch(&format!("DROP TRIGGER {name}")).unwrap();
    }
    c.execute_batch("DROP TABLE native_source_slots; DROP TABLE native_source_reservations; DROP TABLE native_source_revisions; DROP TABLE managed_initial_import_proofs; DROP TABLE managed_initial_import_grants; DROP TABLE managed_enrollment_events; DROP TABLE managed_enrollment_attempts; PRAGMA user_version=34;").unwrap();
    drop(c);
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("injected migration rollback"))
    )
    .is_err());
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        34
    );
    let count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='native_source_slots'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    drop(c);
    initialize(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        38
    );
    assert!(crate::sessions::load_session(&path, "template").is_ok());
    let count:i64=c.query_row("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('managed_initial_import_grants','managed_initial_import_proofs')",[],|r|r.get(0)).unwrap();
    assert_eq!(count, 2);
}
