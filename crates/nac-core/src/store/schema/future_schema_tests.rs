use super::*;

#[derive(Debug, PartialEq, Eq)]
struct FileSnapshot {
    bytes: Option<Vec<u8>>,
    sha256: Option<[u8; 32]>,
    created: Option<std::time::SystemTime>,
    modified: Option<std::time::SystemTime>,
}

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_schema_{label}_{unique}"))
        .join("store.db")
}

fn sqlite_sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

fn snapshot_file(path: &Path) -> FileSnapshot {
    use sha2::{Digest, Sha256};

    match std::fs::read(path) {
        Ok(bytes) => {
            let metadata = std::fs::metadata(path).unwrap();
            let sha256 = Sha256::digest(&bytes).into();
            FileSnapshot {
                bytes: Some(bytes),
                sha256: Some(sha256),
                created: metadata.created().ok(),
                modified: Some(metadata.modified().unwrap()),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => FileSnapshot {
            bytes: None,
            sha256: None,
            created: None,
            modified: None,
        },
        Err(error) => panic!("failed to snapshot {}: {error}", path.display()),
    }
}

fn snapshot_sqlite_files(path: &Path) -> [FileSnapshot; 3] {
    [
        snapshot_file(path),
        snapshot_file(&sqlite_sidecar(path, "-wal")),
        snapshot_file(&sqlite_sidecar(path, "-shm")),
    ]
}

fn prepare_future_schema_store(
    path: &Path,
    with_sidecars: bool,
) -> (i64, String, Option<Connection>) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let future_version = STORE_SCHEMA_VERSION + 1;
    let future = Connection::open(path).unwrap();
    future
        .execute_batch(
            "CREATE TABLE future_sentinel (value TEXT NOT NULL);\n\
             INSERT INTO future_sentinel VALUES ('future-data-canary');",
        )
        .unwrap();
    future
        .pragma_update(None, "user_version", STORE_SCHEMA_VERSION)
        .unwrap();
    drop(future);

    let future = Connection::open(path).unwrap();
    future
        .pragma_update(
            None,
            "journal_mode",
            if with_sidecars { "WAL" } else { "DELETE" },
        )
        .unwrap();
    let journal_mode: String = future
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    if with_sidecars {
        future.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        future
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
    }
    future
        .pragma_update(None, "user_version", future_version)
        .unwrap();
    if with_sidecars {
        assert!(sqlite_sidecar(path, "-wal").exists());
        assert!(sqlite_sidecar(path, "-shm").exists());
        let main = std::fs::read(path).unwrap();
        assert_eq!(
            u32::from_be_bytes(main[60..64].try_into().unwrap()),
            STORE_SCHEMA_VERSION as u32,
            "the future schema must exist only in the uncheckpointed WAL"
        );
        (future_version, journal_mode, Some(future))
    } else {
        drop(future);
        (future_version, journal_mode, None)
    }
}

fn assert_future_store_contents(
    path: &Path,
    future_version: i64,
    journal_mode: &str,
    open: Option<&Connection>,
) {
    let reopened;
    let unchanged = if let Some(open) = open {
        open
    } else {
        reopened = Connection::open(path).unwrap();
        &reopened
    };
    assert_eq!(
        unchanged
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        future_version
    );
    assert_eq!(
        unchanged
            .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
            .unwrap(),
        journal_mode
    );
    assert_eq!(
        unchanged
            .query_row("SELECT value FROM future_sentinel", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "future-data-canary"
    );
}

#[test]
fn every_future_schema_refusal_preserves_database_and_sidecars_exactly() {
    assert_eq!(MINIMUM_MIGRATABLE_SCHEMA_VERSION, 0);
    for with_sidecars in [false, true] {
        for action in ["initialize", "normal-open", "migration-status", "readiness"] {
            let path = temp_store_path(&format!("future_{action}_{with_sidecars}"));
            let (future_version, journal_mode, open) =
                prepare_future_schema_store(&path, with_sidecars);
            let before = snapshot_sqlite_files(&path);

            match action {
                "initialize" => {
                    let error = initialize(&path).unwrap_err();
                    assert!(error.to_string().contains(&format!(
                        "unsupported store schema version {future_version}"
                    )));
                }
                "normal-open" => {
                    let error = crate::store::list_projects(&path).unwrap_err();
                    assert!(error.to_string().contains(&format!(
                        "unsupported store schema version {future_version}"
                    )));
                }
                "migration-status" => assert_eq!(
                    migration_status(&path),
                    StoreMigrationStatus {
                        supported_schema_version: STORE_SCHEMA_VERSION,
                        opened_schema_version: Some(future_version),
                        state: StoreMigrationState::Failed,
                        failure: Some(StoreMigrationFailure::FutureSchema),
                    }
                ),
                "readiness" => {
                    let error = check_readiness(&path).unwrap_err();
                    assert!(error.to_string().contains(&format!(
                        "unsupported store schema version {future_version}"
                    )));
                }
                _ => unreachable!(),
            }

            let after = snapshot_sqlite_files(&path);
            assert_eq!(after, before, "{action} changed future-schema files");
            assert_future_store_contents(&path, future_version, &journal_mode, open.as_ref());
            drop(open);
            let _ = std::fs::remove_dir_all(path.parent().unwrap());
        }
    }
}
