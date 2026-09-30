//! Store compatibility, consistent fixture copies, and checkpoint evidence for ALL-112/114.
use super::*;

pub(super) trait LoadStoreAdapter {
    fn identity(&self) -> &'static str;
    fn create_manager(&self, root: &Path, worker: &Path) -> SessionManager;
    fn assert_integrity(&self, store_path: &Path);
    fn configuration(&self, store_path: &Path) -> StoreConfiguration;
    fn checkpoint(&self, store_path: &Path) -> CheckpointEvidence;
    fn copy_fixture(&self, store_path: &Path, seed: u64, count: usize);
}

pub(super) struct SqliteLoadStore;

impl LoadStoreAdapter for SqliteLoadStore {
    fn identity(&self) -> &'static str {
        "sqlite-wal"
    }

    fn create_manager(&self, root: &Path, worker: &Path) -> SessionManager {
        SessionManager::new_unowned_fixture(ServerOptions {
            root_cwd: root.to_path_buf(),
            store_path: Some(root.join("store.db")),
            worker_executable: Some(worker.to_path_buf()),
            managed_host: None,
        })
        .expect("managed-load session manager")
    }

    fn assert_integrity(&self, store_path: &Path) {
        let connection = rusqlite::Connection::open(store_path).unwrap();
        let quick_check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(quick_check, "ok");
        let foreign_key_errors: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_errors, 0);
        let journal_mode: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
    }

    fn configuration(&self, store_path: &Path) -> StoreConfiguration {
        let connection = rusqlite::Connection::open(store_path).unwrap();
        StoreConfiguration {
            engine: "sqlite",
            journal_mode: connection
                .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
                .unwrap(),
            synchronous: connection
                .query_row("PRAGMA synchronous", [], |row| row.get(0))
                .unwrap(),
            mmap_size: connection
                .query_row("PRAGMA mmap_size", [], |row| row.get(0))
                .unwrap(),
            schema_version: connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap(),
            page_count: connection
                .query_row("PRAGMA page_count", [], |row| row.get(0))
                .unwrap(),
            page_size: connection
                .query_row("PRAGMA page_size", [], |row| row.get(0))
                .unwrap(),
            database_bytes: file_size(store_path),
            wal_bytes: file_size(&PathBuf::from(format!("{}-wal", store_path.display()))),
            shm_bytes: file_size(&PathBuf::from(format!("{}-shm", store_path.display()))),
        }
    }

    fn copy_fixture(&self, store_path: &Path, seed: u64, count: usize) {
        // The output must be new. VACUUM INTO includes committed WAL contents;
        // an alternate engine receives only this consistent synthetic copy.
        if let Some(directory) = std::env::var_os("NAC_MANAGED_LOAD_COPY_STORE_DIR") {
            let directory = PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            let destination = directory.join(format!("{seed}-{count}.db"));
            rusqlite::Connection::open(store_path)
                .unwrap()
                .execute("VACUUM INTO ?1", [destination.to_str().unwrap()])
                .unwrap();
        }
    }

    fn checkpoint(&self, store_path: &Path) -> CheckpointEvidence {
        let connection = rusqlite::Connection::open(store_path).unwrap();
        let started = Instant::now();
        let (busy, log_frames, checkpointed_frames) = connection
            .query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        let duration = started.elapsed();
        assert_eq!(busy, 0, "passive checkpoint must not remain busy");
        nac_core::telemetry::emit_store_duration(
            nac_core::telemetry::StoreOperation::Checkpoint,
            nac_core::telemetry::Correlation::default(),
            duration,
            nac_core::telemetry::TelemetryOutcome::Ok,
            None,
        );
        CheckpointEvidence {
            busy,
            log_frames,
            checkpointed_frames,
            duration_us: duration.as_micros(),
        }
    }
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |metadata| metadata.len())
}

#[derive(Serialize)]
pub(super) struct StoreConfiguration {
    pub(super) engine: &'static str,
    pub(super) journal_mode: String,
    pub(super) synchronous: i64,
    pub(super) mmap_size: i64,
    pub(super) schema_version: i64,
    pub(super) page_count: i64,
    pub(super) page_size: i64,
    pub(super) database_bytes: u64,
    pub(super) wal_bytes: u64,
    pub(super) shm_bytes: u64,
}

#[derive(Serialize)]
pub(super) struct CheckpointEvidence {
    pub(super) busy: i64,
    pub(super) log_frames: i64,
    pub(super) checkpointed_frames: i64,
    pub(super) duration_us: u128,
}
