use super::*;

#[test]
fn v28_store_adds_insecure_http_opt_in_with_fail_closed_defaults() {
    let path = temp_store_path("v28_insecure_http");
    initialize(&path).unwrap();
    let legacy = Connection::open(&path).unwrap();
    crate::store::native_source_reservation::remove_schema_for_legacy_fixture(&legacy).unwrap();
    insert_legacy_session(&legacy, "legacy-session");
    legacy
        .execute(
            "INSERT INTO model_configurations
             (config_id, name, backend, model, base_url, created_at, updated_at)
             VALUES ('legacy-config', 'Legacy', 'openai-chat-completions', 'model',
                     'https://example.invalid/v1', 'created', 'updated')",
            [],
        )
        .unwrap();
    legacy
        .execute_batch(
            "ALTER TABLE sessions DROP COLUMN allow_insecure_http;
             ALTER TABLE model_configurations DROP COLUMN allow_insecure_http;
             PRAGMA user_version = 28;",
        )
        .unwrap();
    drop(legacy);

    initialize(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    let session_opt_in: bool = migrated
        .query_row(
            "SELECT allow_insecure_http FROM sessions WHERE session_id = 'legacy-session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let config_opt_in: bool = migrated
        .query_row(
            "SELECT allow_insecure_http FROM model_configurations WHERE config_id = 'legacy-config'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!session_opt_in);
    assert!(!config_opt_in);
    assert_eq!(
        migrated
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    drop(migrated);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
