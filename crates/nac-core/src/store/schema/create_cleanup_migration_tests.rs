//! New receiving schema38/39 migration controls, with real transaction rollback.
use super::*;
#[test]
fn current38_and_prepared39_upgrade_cleanup_table_transactionally() {
    struct Root(std::path::PathBuf);
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    for predecessor in [38, 39] {
        let root = Root(
            std::env::temp_dir().join(format!("native-cleanup-upgrade-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir(&root.0).unwrap();
        let path = root.0.join("store.db");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "retained");
        let c = Connection::open(&path).unwrap();
        c.execute(
            "UPDATE sessions SET backend='arcee-api' WHERE session_id='retained'",
            [],
        )
        .unwrap();
        let original: String = c.query_row("SELECT json_array(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at,backend) FROM sessions WHERE session_id='retained'",[],|row|row.get(0)).unwrap();
        crate::sessions::load_session(&path, "retained").unwrap();
        c.execute_batch("DROP TABLE native_create_acknowledgements;")
            .unwrap();
        if predecessor == 38 {
            c.execute_batch("DROP TABLE native_source_prepared_snapshots;")
                .unwrap();
        }
        c.pragma_update(None, "user_version", predecessor).unwrap();
        drop(c);
        assert!(initialize_with_hooks(
            &path,
            || {},
            || {},
            || Err(anyhow!("injected upgrade rollback"))
        )
        .is_err());
        let c = Connection::open(&path).unwrap();
        let version: i64 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, predecessor);
        let table: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name='native_create_acknowledgements'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table, 0);
        drop(c);
        initialize(&path).unwrap();
        crate::sessions::load_session(&path, "retained").unwrap();
        let c = Connection::open(&path).unwrap();
        let preserved: String = c.query_row("SELECT json_array(session_id,cwd,store_path,model,base_url,messages_json,created_at,updated_at,backend) FROM sessions WHERE session_id='retained'",[],|row|row.get(0)).unwrap();
        assert_eq!(original, preserved);
        let count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM native_create_acknowledgements",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        let version: i64 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 40);
    }
}
