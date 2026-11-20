//! Exercise direct sessions and child settlement with the serving store owner.
use super::managed_load::{
    self, CheckpointEvidence, LoadStoreAdapter, SqliteLoadStore, StoreConfiguration,
};
use super::*;
use std::path::{Path, PathBuf};

struct OwnedSqliteLoadStore;
impl LoadStoreAdapter for OwnedSqliteLoadStore {
    fn identity(&self) -> &'static str {
        "sqlite-wal-coordinator"
    }
    fn create_direct_manager_async<'a>(
        &'a self,
        root: &'a Path,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SessionManager> + 'a>> {
        Box::pin(async move {
            let options = ServerOptions {
                root_cwd: root.to_path_buf(),
                store_path: Some(root.join("store.db")),
                managed_host: None,
            };
            nac_core::store::spawn_blocking_store_caller(move || {
                let _recorder = nac_core::telemetry::register_test_recorder_thread();
                SessionManager::new(options)
            })
            .await
            .expect("owned constructor caller")
            .expect("owned direct-load manager")
        })
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

fn owned_load_runtime() -> tokio::runtime::Runtime {
    std::thread_local! {
        static RECORDER_MEMBER: std::cell::RefCell<Option<nac_core::telemetry::TestRecorderThreadGuard>> = const { std::cell::RefCell::new(None) };
    }
    tokio::runtime::Builder::new_multi_thread()
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
        .unwrap()
}

#[test]
#[ignore = "bounded direct owned-store load workload"]
fn owned_direct_persistence_load_scenario() {
    owned_load_runtime().block_on(owned_direct_persistence_load());
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded direct owned current-thread load workload"]
async fn owned_direct_persistence_current_thread_load_scenario() {
    owned_direct_persistence_load().await;
}

async fn owned_direct_persistence_load() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let lane = match tokio::runtime::Handle::current().runtime_flavor() {
        tokio::runtime::RuntimeFlavor::CurrentThread => "current-thread",
        _ => "multi-thread",
    };
    let artifact_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/persistence-load-direct")
        .join(lane);
    std::fs::create_dir_all(&artifact_root).unwrap();
    let seed = 0xA11_0612;
    for count in [1, 2, 4] {
        let path = artifact_root.join(format!("seed-{seed}-primaries-{count}.json"));
        managed_load::direct_acceptance::prepare_artifact(&path);
        let evidence =
            managed_load::direct_acceptance::run_variant(&OwnedSqliteLoadStore, seed, count).await;
        managed_load::write_secret_safe_artifact(&path, &evidence);
    }
}
