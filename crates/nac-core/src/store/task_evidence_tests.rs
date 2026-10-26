use super::*;

fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .unwrap()
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn v34_store_adds_bounded_task_evidence_without_rewriting_goals() {
    let path = std::env::temp_dir()
        .join(format!("nac-task-evidence-v34-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "direct");
    let legacy = Connection::open(&path).unwrap();
    legacy
        .execute_batch(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'direct';
             INSERT INTO session_goals (session_id, goal_id, objective, status, created_at, updated_at, version)
             VALUES ('direct', 'goal-1', 'kept', 'complete', 'then', 'then', 3);
             DROP TABLE session_run_outcomes;
             DROP TABLE session_goal_outcomes;
             ALTER TABLE session_goals DROP COLUMN last_run_id;
             PRAGMA user_version = 34;",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    assert_eq!(
        table_columns(&migrated, "session_run_outcomes"),
        [
            "id",
            "session_id",
            "run_id",
            "disposition",
            "result_excerpt",
            "result_truncated",
            "failure_json",
            "finished_at",
        ]
    );
    assert_eq!(
        table_columns(&migrated, "session_goal_outcomes"),
        [
            "id",
            "session_id",
            "goal_id",
            "objective",
            "status",
            "version",
            "tokens_used",
            "time_used_ms",
            "last_failure_json",
            "created_at",
            "updated_at",
            "retired_at",
            "retirement",
            "last_run_id",
        ]
    );
    let goal: (String, i64, Option<String>) = migrated
        .query_row(
            "SELECT goal_id, version, last_run_id FROM session_goals WHERE session_id = 'direct'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(goal, ("goal-1".to_owned(), 3, None));
    assert_eq!(
        migrated
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        schema_version()
    );
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
