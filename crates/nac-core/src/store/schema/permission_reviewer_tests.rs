//! Permission-mode, revision and automatic-reviewer migration coverage.

use rusqlite::Connection;

use super::tests::{insert_legacy_session, temp_store_path};
use super::*;

#[test]
fn v34_store_adds_the_human_reviewer_and_rejects_review_with_approve_all() {
    let path = temp_store_path("v34_permission_reviewer");
    initialize(&path).unwrap();
    let legacy = Connection::open(&path).unwrap();
    insert_legacy_session(&legacy, "manual-session");
    insert_legacy_session(&legacy, "auto-session");
    legacy
        .execute(
            "UPDATE sessions SET permission_approval_mode = 'auto_approve'
             WHERE session_id = 'auto-session'",
            [],
        )
        .unwrap();
    legacy
        .execute_batch(
            "ALTER TABLE sessions DROP COLUMN permission_reviewer;
             PRAGMA user_version = 34;",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    let reviewers = migrated
        .prepare(
            "SELECT session_id, permission_approval_mode, permission_reviewer
             FROM sessions ORDER BY session_id",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<(String, String, String)>>>()
        .unwrap();
    assert_eq!(
        reviewers,
        vec![
            (
                "auto-session".to_string(),
                "auto_approve".to_string(),
                "user".to_string()
            ),
            (
                "manual-session".to_string(),
                "manual".to_string(),
                "user".to_string()
            ),
        ]
    );
    migrated
        .execute(
            "UPDATE sessions SET permission_reviewer = 'auto_review'
             WHERE session_id = 'manual-session'",
            [],
        )
        .unwrap();
    assert!(migrated
        .execute(
            "UPDATE sessions SET permission_reviewer = 'auto_review'
             WHERE session_id = 'auto-session'",
            [],
        )
        .is_err());
    assert!(migrated
        .execute(
            "UPDATE sessions SET permission_reviewer = 'model'
             WHERE session_id = 'manual-session'",
            [],
        )
        .is_err());
    assert_eq!(
        migrated
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn v39_task_store_adds_review_without_changing_queued_child_authority() {
    let path = temp_store_path("v39_permission_reviewer");
    initialize(&path).unwrap();
    insert_test_session(&path, "child");
    let item = create_session_inbox_item(
        &path,
        "child",
        InboxDelivery::Steer,
        "queued input",
        Some("run-a"),
        None,
    )
    .unwrap();
    let wait_id = uuid::Uuid::new_v4().to_string();
    let connection = Connection::open(&path).unwrap();
    connection.execute(
        "UPDATE session_inbox SET child_execution_mode='foreground', child_wait_id=?1 WHERE id=?2",
        params![wait_id, item.id],
    ).unwrap();
    connection
        .execute_batch(
            "ALTER TABLE sessions DROP COLUMN permission_reviewer;
         ALTER TABLE sessions DROP COLUMN permission_review_intent;
         ALTER TABLE session_inbox DROP COLUMN review_intent;
         ALTER TABLE thread_steering DROP COLUMN review_intent;
         PRAGMA user_version=39;",
        )
        .unwrap();
    drop(connection);

    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("before commit"))).is_err());
    let connection = Connection::open(&path).unwrap();
    assert!(!column_exists(&connection, "sessions", "permission_reviewer").unwrap());
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        39
    );
    drop(connection);

    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    let saved: (String, String, Option<String>) = connection.query_row(
        "SELECT permission_approval_mode, permission_reviewer, permission_review_intent FROM sessions WHERE session_id='child'",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).unwrap();
    assert_eq!(saved, ("manual".into(), "user".into(), None));
    let queued = load_session_inbox_item(&path, "child", item.id).unwrap();
    assert_eq!(
        queued.child_execution_mode,
        Some(TraditionalChildExecutionMode::Foreground)
    );
    assert_eq!(queued.child_wait_id.as_deref(), Some(wait_id.as_str()));
    let raw_intent: Option<String> = connection
        .query_row(
            "SELECT review_intent FROM session_inbox WHERE id=?1",
            [item.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(raw_intent.is_none());
    assert_eq!(schema_version(), 40);
    drop(connection);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn historical_v35_review_store_preserves_intent_when_adding_task_schema() {
    let path = temp_store_path("v35_review_task_union");
    initialize(&path).unwrap();
    insert_test_session(&path, "review-session");
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch(
        "UPDATE sessions SET permission_reviewer='auto_review', permission_review_intent='[\"Only inspect files\"]' WHERE session_id='review-session';
         ALTER TABLE session_inbox DROP COLUMN child_wait_id;
         ALTER TABLE session_inbox DROP COLUMN child_execution_mode;
         DROP TABLE traditional_child_terminal_receipts;
         DROP TABLE managed_orchestrator_terminal_receipts;
         PRAGMA user_version=35;",
    ).unwrap();
    drop(connection);
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    let saved: (String, String) = connection.query_row(
        "SELECT permission_reviewer, permission_review_intent FROM sessions WHERE session_id='review-session'",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();
    assert_eq!(
        saved,
        ("auto_review".into(), "[\"Only inspect files\"]".into())
    );
    assert!(column_exists(&connection, "session_inbox", "child_execution_mode").unwrap());
    assert!(column_exists(&connection, "session_inbox", "child_wait_id").unwrap());
    assert!(table_exists(&connection, "traditional_child_terminal_receipts").unwrap());
    assert!(table_exists(&connection, "managed_orchestrator_terminal_receipts").unwrap());
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    drop(connection);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn v24_store_adds_manual_session_permission_approval_mode() {
    let path = temp_store_path("v24_permission_approval_mode");
    initialize(&path).unwrap();
    let legacy = Connection::open(&path).unwrap();
    insert_legacy_session(&legacy, "legacy-session");
    legacy
        .execute_batch(
            "ALTER TABLE sessions DROP COLUMN permission_reviewer;
             ALTER TABLE sessions DROP COLUMN permission_approval_mode;
             ALTER TABLE sessions DROP COLUMN permission_auto_approve_generation;
             ALTER TABLE sessions DROP COLUMN permission_approval_revision;
             PRAGMA user_version = 24;",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    let mode: String = migrated
        .query_row(
            "SELECT permission_approval_mode FROM sessions WHERE session_id = 'legacy-session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(mode, "manual");
    let generation: i64 = migrated
        .query_row(
            "SELECT permission_auto_approve_generation FROM sessions WHERE session_id = 'legacy-session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(generation, 0);
    let revision: i64 = migrated
        .query_row(
            "SELECT permission_approval_revision FROM sessions WHERE session_id = 'legacy-session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(revision, 0);
    assert_eq!(
        migrated
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn v25_store_adds_permission_approval_transition_revision() {
    let path = temp_store_path("v25_permission_approval_revision");
    initialize(&path).unwrap();
    let legacy = Connection::open(&path).unwrap();
    insert_legacy_session(&legacy, "legacy-session");
    legacy
        .execute(
            "UPDATE sessions
             SET permission_approval_mode = 'auto_approve',
                 permission_auto_approve_generation = 7
             WHERE session_id = 'legacy-session'",
            [],
        )
        .unwrap();
    legacy
        .execute_batch(
            "ALTER TABLE sessions DROP COLUMN permission_approval_revision;
             PRAGMA user_version = 25;",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    let state: (String, i64, i64) = migrated
        .query_row(
            "SELECT permission_approval_mode, permission_auto_approve_generation,
                    permission_approval_revision
             FROM sessions WHERE session_id = 'legacy-session'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, ("auto_approve".to_string(), 7, 0));
    assert_eq!(
        migrated
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
