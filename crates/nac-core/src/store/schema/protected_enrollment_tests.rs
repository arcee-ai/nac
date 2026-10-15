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
