use super::*;

fn catalog(conn: &Connection) -> Vec<(String, String, String)> {
    conn.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")
        .unwrap()
        .query_map([], |row| {
            let sql: String = row.get(2)?;
            Ok((row.get(0)?, row.get(1)?, sql.split_whitespace().collect::<Vec<_>>().join(" ")))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn fresh_schema_matches_migrated_v53_without_creating_retired_tables() {
    let root = std::env::temp_dir().join(format!("nac-fresh-schema-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let fresh_path = root.join("fresh.db");
    let old_path = root.join("v53.db");
    let old = Connection::open(&old_path).unwrap();
    old.execute_batch(include_str!("fixtures/v53-fresh.sql"))
        .unwrap();
    drop(old);
    initialize(&fresh_path).unwrap();
    initialize(&old_path).unwrap();
    let fresh = Connection::open(&fresh_path).unwrap();
    let migrated = Connection::open(&old_path).unwrap();
    assert_eq!(catalog(&fresh), catalog(&migrated));
    let schema = include_str!("current.sql").to_ascii_lowercase();
    for table in [
        "managed_orchestrators",
        "managed_orchestrator_terminal_receipts",
        "worker_dispatches",
        "episodes",
        "threads",
        "workset_items",
        "worksets",
        "thread_steering",
        "model_configurations",
    ] {
        assert!(
            !schema.contains(&format!("create table {table} ")),
            "retired table {table}"
        );
    }
    assert_eq!(
        fresh
            .query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap(),
        0
    );
    let id: String = fresh
        .query_row("SELECT store_id FROM session_completion_feed", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(uuid::Uuid::parse_str(&id).is_ok());
    drop((fresh, migrated));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn fresh_schema_failure_rolls_back_and_retries() {
    let root = std::env::temp_dir().join(format!("nac-fresh-rollback-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    assert!(
        initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("injected failure"))).is_err()
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        0
    );
    assert!(catalog(&conn).is_empty());
    drop(conn);
    initialize(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
