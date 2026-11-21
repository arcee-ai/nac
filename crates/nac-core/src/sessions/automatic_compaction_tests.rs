use super::tests::{temp_store_path, test_snapshot};
use super::*;

#[test]
fn automatic_compaction_provenance_survives_restart_and_preserves_legacy_settings() {
    let path = temp_store_path("automatic_compaction_migration");
    crate::store::initialize_synthetic_predecessor(&path).unwrap();
    let conn = crate::store::open_connection(&path).unwrap();
    conn.execute_batch("ALTER TABLE sessions RENAME COLUMN orchestrator_compaction_threshold TO compaction_threshold;").unwrap();
    drop(conn);
    let mut legacy = test_snapshot("legacy", "2026-01-01", "2026-01-02");
    legacy.compaction_threshold = Some(123_456);
    create_session(&path, &legacy).unwrap();
    let conn = crate::store::open_connection(&path).unwrap();
    conn.execute_batch(
        "ALTER TABLE sessions RENAME COLUMN compaction_threshold TO orchestrator_compaction_threshold;
         ALTER TABLE sessions DROP COLUMN automatic_compaction; PRAGMA user_version=51;",
    )
    .unwrap();
    drop(conn);
    crate::store::initialize(&path).unwrap();
    let loaded = load_session(&path, "legacy").unwrap();
    assert!(!loaded.automatic_compaction);
    assert_eq!(loaded.compaction_threshold, Some(123_456));
    let mut fresh = test_snapshot("fresh", "2026-01-01", "2026-01-02");
    fresh.automatic_compaction = true;
    fresh.compaction_threshold = Some(332_500);
    create_session(&path, &fresh).unwrap();
    assert!(load_session(&path, "fresh").unwrap().automatic_compaction);
    let mut config = load_session_config(&path, "fresh").unwrap();
    assert!(config.automatic_compaction);
    config.automatic_compaction = false;
    config.compaction_threshold = Some(99_000);
    update_raw_session_config(&path, &config).unwrap();
    let loaded = load_session(&path, "fresh").unwrap();
    assert!(!loaded.automatic_compaction);
    assert_eq!(loaded.compaction_threshold, Some(99_000));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
