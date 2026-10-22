use super::*;
use fs2::FileExt;
use std::{ffi::OsString, fs::OpenOptions, path::PathBuf, sync::MutexGuard, time::Duration};

struct Environment {
    original: Vec<(&'static str, Option<OsString>)>,
    _lock: MutexGuard<'static, ()>,
}
impl Environment {
    fn capture(root: &Path) -> Self {
        let lock = crate::TEST_ENV_LOCK.lock().unwrap();
        let original = ["NAC_HOME", "HOME", "XDG_CONFIG_HOME"]
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        // SAFETY: this guard holds the shared process environment test lock
        // until AFTER restoring all values in Drop.
        unsafe {
            std::env::set_var("NAC_HOME", root);
            std::env::remove_var("HOME");
            std::env::remove_var("XDG_CONFIG_HOME");
        }
        Self {
            original,
            _lock: lock,
        }
    }
    fn clear_context(&self) {
        // SAFETY: this same guard still owns TEST_ENV_LOCK.
        unsafe {
            for name in ["NAC_HOME", "HOME", "XDG_CONFIG_HOME"] {
                std::env::remove_var(name);
            }
        }
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        // SAFETY: _lock is released only after this Drop body returns.
        unsafe {
            for (name, value) in self.original.drain(..) {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}
struct Fixture {
    root: PathBuf,
    path: PathBuf,
    environment: Environment,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("create-config-source-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let environment = Environment::capture(&root);
        let path = root.join("config.toml");
        std::fs::write(&path, "[worker]\nthread_timeout_secs=73\n").unwrap();
        // Actual ordinary startup establishes the original locks. Capture
        // itself must neither create them nor invoke recovery.
        NacConfig::load_from_cwd(&root).unwrap();
        Self {
            root,
            path,
            environment,
        }
    }
    fn cutoff(&self) -> Instant {
        Instant::now() + Duration::from_secs(30)
    }
    fn capture(&self) -> CreateConfigurationSource {
        CreateConfigurationSource::capture(&self.root, self.cutoff()).unwrap()
    }
    fn fence(&self) -> std::fs::File {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(self.path.with_extension("toml.source-lock"))
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn captures_same_parsed_bytes_and_original_cutoff_without_client_or_key_setup() {
    let f = Fixture::new();
    let cutoff = f.cutoff();
    let owner = CreateConfigurationSource::capture(&f.root, cutoff).unwrap();
    assert_eq!(owner.original_cutoff(), cutoff);
    assert_eq!(
        owner.configuration().unwrap().worker.thread_timeout_secs,
        Some(73)
    );
    owner.check_current().unwrap();
    let concurrent = f.capture();
    assert_eq!(
        concurrent
            .configuration()
            .unwrap()
            .worker
            .thread_timeout_secs,
        Some(73)
    );
    assert!(f.fence().try_lock_exclusive().is_err());
}

#[test]
fn bounded_getter_does_not_reread_and_physical_failure_latches_on_original_owner() {
    let f = Fixture::new();
    let owner = f.capture();
    std::fs::write(&f.path, "[worker]\nthread_timeout_secs=91\n").unwrap();
    // Bounded access intentionally cannot claim that a file is still current.
    assert_eq!(
        owner.configuration().unwrap().worker.thread_timeout_secs,
        Some(73)
    );
    assert!(owner.check_current().is_err());
    assert!(owner.configuration().is_err());
    std::fs::write(&f.path, "[worker]\nthread_timeout_secs=73\n").unwrap();
    assert!(
        owner.check_current().is_err(),
        "restoring bytes cannot revive denied custody"
    );
}

#[test]
fn denial_keeps_actual_publication_fence_until_owner_is_dropped() {
    let f = Fixture::new();
    let owner = f.capture();
    let writer = f.fence();
    owner.deny();
    assert!(owner.configuration().is_err());
    assert!(owner.check_current().is_err());
    assert!(writer.try_lock_exclusive().is_err());
    drop(owner);
    writer.try_lock_exclusive().unwrap();
}

#[test]
fn busy_writer_expired_cutoff_and_absent_context_refuse_without_fallback_or_new_files() {
    let f = Fixture::new();
    let writer = f.fence();
    writer.try_lock_exclusive().unwrap();
    let started = Instant::now();
    assert!(CreateConfigurationSource::capture(&f.root, f.cutoff()).is_err());
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "capture must not wait for retirement"
    );
    drop(writer);
    assert!(
        CreateConfigurationSource::capture(&f.root, Instant::now() - Duration::from_secs(1))
            .is_err()
    );
    let before = std::fs::read_dir(&f.root).unwrap().count();
    f.environment.clear_context();
    assert!(CreateConfigurationSource::capture(&f.root, f.cutoff()).is_err());
    assert_eq!(std::fs::read_dir(&f.root).unwrap().count(), before);
}

#[test]
fn malformed_source_and_unresolved_journal_are_content_free_and_never_recovered() {
    let f = Fixture::new();
    let malformed = b"PRIVATE_HEADER_VALUE = [ invalid private-sentinel";
    std::fs::write(&f.path, malformed).unwrap();
    let error = CreateConfigurationSource::capture(&f.root, f.cutoff())
        .err()
        .unwrap();
    assert!(!format!("{error} {error:?}").contains("private-sentinel"));
    assert_eq!(std::fs::read(&f.path).unwrap(), malformed);
    std::fs::write(&f.path, "[worker]\nthread_timeout_secs=73\n").unwrap();
    let marker = f.path.with_extension("toml.nac-txn");
    std::fs::write(&marker, b"PRIVATE_UNRESOLVED_SOURCE_JOURNAL").unwrap();
    assert!(CreateConfigurationSource::capture(&f.root, f.cutoff()).is_err());
    assert_eq!(
        std::fs::read(&marker).unwrap(),
        b"PRIVATE_UNRESOLVED_SOURCE_JOURNAL"
    );
    assert_eq!(
        std::fs::read_to_string(&f.path).unwrap(),
        "[worker]\nthread_timeout_secs=73\n"
    );
}

#[test]
fn missing_startup_fence_is_not_recreated_by_source_capture() {
    let f = Fixture::new();
    let fence = f.path.with_extension("toml.source-lock");
    std::fs::remove_file(&fence).unwrap();
    assert!(CreateConfigurationSource::capture(&f.root, f.cutoff()).is_err());
    assert!(!fence.exists());
}

#[tokio::test(flavor = "current_thread")]
async fn actual_coordinator_progresses_while_a_second_real_source_capture_runs() {
    let f = Fixture::new();
    let store = f.root.join("store.db");
    crate::store::initialize(&store).unwrap();
    crate::projects::insert_project(
        &store,
        crate::projects::NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: f.root.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    let coordinator = crate::store::StoreCoordinator::acquire(&store).unwrap();
    let original = f.capture();
    let cwd = f.root.clone();
    let cutoff = f.cutoff();
    let read = crate::store::spawn_blocking_store_caller(move || {
        CreateConfigurationSource::capture(&cwd, cutoff)
    });
    let row = coordinator.load_project_source("project".into());
    let (observed, row) =
        tokio::time::timeout(Duration::from_secs(2), async { tokio::join!(read, row) })
            .await
            .expect("real caller/coordinator must not await source retirement");
    let observed = observed.unwrap().unwrap();
    assert_eq!(row.unwrap().record.project_id, "project");
    assert_eq!(
        observed.configuration().unwrap().worker.thread_timeout_secs,
        Some(73)
    );
    original.check_current().unwrap();
    observed.check_current().unwrap();
    drop((original, observed));
    coordinator.shutdown().await.unwrap();
}
