use super::*;
use sha2::{Digest, Sha256};

#[derive(Debug, PartialEq, Eq)]
struct FileSnapshot {
    bytes: Option<Vec<u8>>,
    sha256: Option<[u8; 32]>,
    modified: Option<std::time::SystemTime>,
}

fn sidecars(path: &Path) -> [PathBuf; 3] {
    [
        path.to_path_buf(),
        sqlite_sidecar_path(path, "-wal"),
        sqlite_sidecar_path(path, "-shm"),
    ]
}

fn snapshot(path: &Path) -> FileSnapshot {
    match std::fs::read(path) {
        Ok(bytes) => {
            let metadata = std::fs::metadata(path).unwrap();
            FileSnapshot {
                sha256: Some(Sha256::digest(&bytes).into()),
                bytes: Some(bytes),
                modified: metadata.modified().ok(),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => FileSnapshot {
            bytes: None,
            sha256: None,
            modified: None,
        },
        Err(error) => panic!("failed to snapshot {}: {error}", path.display()),
    }
}

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_current_startup_{label}_{unique}"))
        .join("store.db")
}

#[test]
fn current_schema_initialize_is_byte_exact_and_does_not_enter_a_writer_transaction() {
    let path = temp_store_path("read_only");
    initialize(&path).unwrap();
    let holder = Connection::open(&path).unwrap();
    holder.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    holder
        .execute_batch(
            "CREATE TABLE current_startup_sentinel (value TEXT NOT NULL);
             INSERT INTO current_startup_sentinel VALUES ('preserved');",
        )
        .unwrap();

    let paths = sidecars(&path);
    let before = paths.each_ref().map(|candidate| snapshot(candidate));
    initialize(&path).unwrap();
    let after = paths.each_ref().map(|candidate| snapshot(candidate));
    // SQLite may update transient WAL-index read marks through mmap without
    // changing the SHM mtime. The durable database and WAL must remain exact.
    for (index, label) in ["main", "wal"].into_iter().enumerate() {
        assert!(
            after[index] == before[index],
            "{label} changed: before hash={:?} mtime={:?}; after hash={:?} mtime={:?}",
            before[index].sha256,
            before[index].modified,
            after[index].sha256,
            after[index].modified,
        );
    }
    assert!(before[2].bytes.is_some() && after[2].bytes.is_some());

    holder.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (finished_tx, finished_rx) = std::sync::mpsc::channel();
    let initialize_path = path.clone();
    let startup = std::thread::spawn(move || {
        let result = initialize(&initialize_path);
        finished_tx.send(()).unwrap();
        result
    });
    finished_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("current-schema startup waited for a writer lock");
    startup.join().unwrap().unwrap();
    holder.execute_batch("ROLLBACK").unwrap();

    assert_eq!(
        holder
            .query_row("SELECT value FROM current_startup_sentinel", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "preserved"
    );
    drop(holder);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
