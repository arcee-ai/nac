//! Schema38 source custody remains immutable through additive snapshot sealing.
use super::*;
use crate::store::native_source_reservation::{
    NativeSourceBinding, NativeSourceReservation, SourceKind, SourceVersion,
};

#[test]
fn schema39_preserves38_source_and_session_bytes_and_failed_upgrade_rolls_back() {
    let root = std::env::temp_dir().join(format!("snapshot-migration-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("store.db");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "snapshot-template");
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET backend='arcee-api' WHERE session_id='snapshot-template'",
            [],
        )
        .unwrap();
    let mut snapshot = crate::sessions::load_session(&path, "snapshot-template").unwrap();
    snapshot.session_id = "snapshot-reserved".into();
    let binding = NativeSourceBinding {
        operation_id: uuid::Uuid::new_v4(),
        source_id: uuid::Uuid::new_v4(),
        source_generation: 1,
        canonical_effect_sha256: [1; 32],
        creation_snapshot_sha256: Some(
            crate::store::native_source_reservation::creation_snapshot_sha256(&snapshot).unwrap(),
        ),
        session_id: snapshot.session_id.clone(),
        project_id: None,
        sources: vec![SourceVersion {
            kind: SourceKind::Session,
            resource_id: snapshot.session_id.clone(),
            revision: 0,
        }],
    };
    let source = NativeSourceReservation::reserve(
        &path,
        binding,
        std::time::Instant::now() + Duration::from_secs(60),
    )
    .unwrap();
    source.begin_preparation().unwrap();
    let c = Connection::open(&path).unwrap();
    let original: String = c
        .query_row(
            "SELECT binding_json FROM native_source_reservations",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let messages: String = c
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id='snapshot-template'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    c.execute_batch("DROP TRIGGER native_source_snapshot_no_update; DROP TRIGGER native_source_snapshot_no_delete; DROP TABLE native_source_prepared_snapshots; PRAGMA user_version=38;").unwrap();
    drop(c);
    assert!(initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("snapshot migration rollback"))
    )
    .is_err());
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        38
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='native_source_prepared_snapshots'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    drop(c);
    initialize(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    assert_eq!(
        c.query_row(
            "SELECT binding_json FROM native_source_reservations",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        original
    );
    assert_eq!(
        c.query_row(
            "SELECT messages_json FROM sessions WHERE session_id='snapshot-template'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        messages
    );
    assert_eq!(
        c.query_row("SELECT state FROM native_source_reservations", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "preparing"
    );
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM native_source_slots", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    source.check_current().unwrap();
    assert_eq!(
        source.binding().creation_snapshot_sha256,
        Some(source.prepared_snapshot_sha256().unwrap())
    );
    drop(c);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}
