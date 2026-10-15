//! Migration coverage for the automatic permission reviewer column.

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
