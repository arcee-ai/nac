use super::*;

#[test]
fn runtime_uses_patched_bundled_sqlite() {
    let path = temp_store_path("sqlite_runtime_identity");
    initialize(&path).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    let version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, rusqlite::version());
    assert!(
        rusqlite::version_number() >= 3_054_000,
        "bundled SQLite {version} must include the mismatched-WAL memory disclosure fix"
    );
    eprintln!("actual linked SQLite: {version}");
    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn runtime_cached_statements_preserve_checked_unsigned_sql_boundaries() {
    let path = temp_store_path("sqlite_unsigned_boundaries");
    initialize(&path).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    {
        let mut statement = connection.prepare_cached("SELECT ?1").unwrap();
        for value in [None, Some(0_u64), Some(i64::MAX as u64)] {
            assert_eq!(
                statement
                    .query_row([value], |row| row.get::<_, Option<u64>>(0))
                    .unwrap(),
                value
            );
        }
        for value in [i64::MAX as u64 + 1, u64::MAX] {
            assert!(matches!(
                statement.query_row([value], |row| row.get::<_, u64>(0)),
                Err(rusqlite::Error::ToSqlConversionFailure(_))
            ));
        }
        assert!(matches!(
            statement.query_row([-1_i64], |row| row.get::<_, u64>(0)),
            Err(rusqlite::Error::IntegralValueOutOfRange(0, -1))
        ));
        assert_eq!(
            statement
                .query_row([usize::MAX.min(i64::MAX as usize)], |row| row
                    .get::<_, usize>(0))
                .unwrap(),
            usize::MAX.min(i64::MAX as usize)
        );
        if usize::BITS == 64 {
            assert!(matches!(
                statement.query_row([usize::MAX], |row| row.get::<_, usize>(0)),
                Err(rusqlite::Error::ToSqlConversionFailure(_))
            ));
        }
        assert!(statement
            .query_row([-1_i64], |row| row.get::<_, usize>(0))
            .is_err());
    }
    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
