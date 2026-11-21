use super::*;

#[test]
fn actual_v56_speed_writer_upgrades_transactionally_to_direct_schema() {
    let path = temp_store_path("speed_v56_to_v57");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/v56-speed-upgraded.sql"))
        .unwrap();
    let before: (i64, String, String) = conn
        .query_row(
            "SELECT rowid,service_tier,messages_json FROM sessions WHERE session_id='speed-direct'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    drop(conn);
    let failed = initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("rollback")));
    assert!(failed.is_err());
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        56
    );
    let rolled_back: (i64, String, String) = conn
        .query_row(
            "SELECT rowid,service_tier,messages_json FROM sessions WHERE session_id='speed-direct'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(rolled_back, before);
    drop(conn);
    initialize(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        57
    );
    let after: (i64, String, String) = conn
        .query_row(
            "SELECT rowid,service_tier,messages_json FROM sessions WHERE session_id='speed-direct'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(after, before);
    let messages: Vec<crate::types::Message> = serde_json::from_str(&after.2).unwrap();
    assert!(
        matches!(&messages[..], [crate::types::Message::Assistant { service_tier_receipt: Some(receipt), .. }] if receipt.requested == Some(crate::model::ServiceTier::Fast) && receipt.served.as_deref() == Some("priority"))
    );
    let selector: String = conn
        .query_row(
            "SELECT api_key_env FROM provider_connections WHERE connection_id='speed-preset'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(selector, "EDITED_SPEED_KEY");
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    drop(conn);
    assert_eq!(
        crate::sessions::load_session_config(&path, "speed-direct")
            .unwrap()
            .service_tier
            .as_deref(),
        Some("fast")
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn speed_writer_predecessors_upgrade_and_missing_tier_rolls_back() {
    for (version, fixture) in [
        (55, include_str!("fixtures/v55-speed-upgraded.sql")),
        (56, include_str!("fixtures/v56-speed-upgraded.sql")),
    ] {
        let path = temp_store_path(&format!("speed_v{version}_predecessor"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(fixture).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            version
        );
        let tier: String = conn
            .query_row(
                "SELECT service_tier FROM sessions WHERE session_id='speed-direct'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tier, "fast");
        drop(conn);
        initialize(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT service_tier FROM sessions WHERE session_id='speed-direct'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            tier
        );
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            57
        );
        assert!(conn
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
        drop(conn);

        let bad_path = path.parent().unwrap().join("missing-tier.db");
        let conn = Connection::open(&bad_path).unwrap();
        conn.execute_batch(fixture).unwrap();
        conn.execute_batch("ALTER TABLE sessions DROP COLUMN service_tier")
            .unwrap();
        let before: Vec<(String, String, String)> = conn.prepare("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect();
        drop(conn);
        let error = initialize(&bad_path).unwrap_err();
        assert!(format!("{error:#}").contains("unsupported sessions column count"));
        let conn = Connection::open(&bad_path).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            version
        );
        let after: Vec<(String, String, String)> = conn.prepare("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect();
        assert_eq!(before, after);
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT model FROM sessions WHERE session_id='speed-direct'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            "legacy-model"
        );
        drop(conn);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
