//! Use the existing ALL-112 plan, phase gates, default 20s deadline, worker,
//! payloads and probes with the serving application's real store ownership.
use super::managed_load::{
    self, CheckpointEvidence, LoadStoreAdapter, SqliteLoadStore, StoreConfiguration,
};
use super::*;
use std::path::{Path, PathBuf};
use std::time::Duration;

struct OwnedSqliteLoadStore;
impl LoadStoreAdapter for OwnedSqliteLoadStore {
    fn expected_terminal_settlements(&self, count: usize) -> usize {
        // The executor records the child's run-state commit, parent completion
        // run-state commit, and relationship terminal transaction. The legacy
        // current-thread fixture observes only the last on its recorder thread.
        count * 3
    }
    fn identity(&self) -> &'static str {
        "sqlite-wal-coordinator"
    }
    fn create_manager(&self, root: &Path, worker: &Path) -> SessionManager {
        SessionManager::new(ServerOptions {
            root_cwd: root.to_path_buf(),
            store_path: Some(root.join("store.db")),
            worker_executable: Some(worker.to_path_buf()),
            managed_host: None,
        })
        .expect("owned persistence load manager")
    }
    fn assert_integrity(&self, path: &Path) {
        SqliteLoadStore.assert_integrity(path);
    }
    fn configuration(&self, path: &Path) -> StoreConfiguration {
        SqliteLoadStore.configuration(path)
    }
    fn checkpoint(&self, path: &Path) -> CheckpointEvidence {
        SqliteLoadStore.checkpoint(path)
    }
}

#[test]
#[ignore = "bounded owned-store scenario; requires the managed-load worker"]
fn owned_persistence_load_scenario() {
    std::thread_local! {
        static RECORDER_MEMBER: std::cell::RefCell<Option<nac_core::telemetry::TestRecorderThreadGuard>> = const { std::cell::RefCell::new(None) };
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .on_thread_unpark(|| {
            RECORDER_MEMBER.with(|member| {
                member.borrow_mut().take();
                *member.borrow_mut() = Some(nac_core::telemetry::register_test_recorder_thread());
            });
        })
        .on_thread_park(|| {
            RECORDER_MEMBER.with(|member| {
                member.borrow_mut().take();
            });
        })
        .build()
        .unwrap();
    runtime.block_on(owned_persistence_load()).unwrap();
}

async fn owned_persistence_load() -> anyhow::Result<()> {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let worker =
        PathBuf::from(std::env::var_os("NAC_MANAGED_LOAD_WORKER").expect("managed-load worker"));
    assert!(worker.is_file());
    let artifact_root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/persistence-load");
    std::fs::create_dir_all(&artifact_root).unwrap();
    let seed = 0xA11_0112;
    for count in [1, 2, 4] {
        let evidence = managed_load::run_variant(
            &OwnedSqliteLoadStore,
            &worker,
            seed,
            count,
            Duration::from_millis(100),
        )
        .await;
        let path = artifact_root.join(format!("all-116-seed-{seed}-orchestrators-{count}.json"));
        managed_load::write_secret_safe_artifact(&path, &evidence);
        eprintln!("ALL-116 owned persistence artifact: {}", path.display());
    }
    Ok(())
}
