use super::*;
use std::os::unix::fs::OpenOptionsExt;
use std::time::{Duration, Instant};

struct Fixture {
    root: PathBuf,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("retained-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let path = root.join("config.toml");
        std::fs::write(&path, b"[worker]\nthread_timeout_secs = 73\n").unwrap();
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path.with_extension("toml.lock"))
            .unwrap();
        initialize_write_fence(&path).unwrap();
        Self { root, path }
    }
    fn capture(&self) -> RetainedMcpConfiguration {
        RetainedMcpConfiguration::capture(&self.path, Instant::now() + Duration::from_secs(30))
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn retained_config_owns_original_bytes_and_excludes_the_actual_writer_lock() {
    let f = Fixture::new();
    let owner = f.capture();
    assert_eq!(owner.raw().unwrap(), "[worker]\nthread_timeout_secs = 73\n");
    owner.check_current().unwrap();
    let writer = OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.path.with_extension("toml.source-lock"))
        .unwrap();
    assert!(writer.try_lock_exclusive().is_err());
    owner.deny();
    assert!(owner.raw().is_err());
    assert!(owner.check_current().is_err());
    assert!(
        writer.try_lock_exclusive().is_err(),
        "denial does not release original lock custody"
    );
    drop(owner);
    writer.try_lock_exclusive().unwrap();
}

#[test]
fn retained_config_drop_unlocks_even_with_an_inherited_open_file_description() {
    let f = Fixture::new();
    let owner = f.capture();
    // try_clone shares the open file description, just as an inherited fd
    // between fork and exec does. Keeping it open must not extend custody.
    let inherited = owner.source_fence.try_clone().unwrap();
    let writer = OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.path.with_extension("toml.source-lock"))
        .unwrap();
    assert!(writer.try_lock_exclusive().is_err());
    drop(owner);
    writer.try_lock_exclusive().unwrap();
    drop(inherited);
}

#[test]
fn retained_config_no_source_writer_acquisition_wait_or_recovery_write() {
    let f = Fixture::new();
    let writer = acquire_mcp_configuration_write_lease(&f.path).unwrap();
    assert!(
        RetainedMcpConfiguration::capture(&f.path, Instant::now() + Duration::from_secs(30))
            .is_err()
    );
    drop(writer);
    let marker = transaction_path(&f.path);
    std::fs::write(&marker, b"PRIVATE_SENTINEL_UNRESOLVED_JOURNAL").unwrap();
    let before = std::fs::read(&f.path).unwrap();
    let error =
        RetainedMcpConfiguration::capture(&f.path, Instant::now() + Duration::from_secs(30))
            .err()
            .unwrap();
    assert!(!format!("{error:?} {error}").contains("PRIVATE_SENTINEL"));
    assert_eq!(std::fs::read(&f.path).unwrap(), before);
    assert_eq!(
        std::fs::read(&marker).unwrap(),
        b"PRIVATE_SENTINEL_UNRESOLVED_JOURNAL"
    );
}

#[test]
fn retained_config_same_bytes_replacement_and_restore_cannot_refresh_original() {
    let f = Fixture::new();
    let owner = f.capture();
    let original = f.root.join("original.toml");
    std::fs::rename(&f.path, &original).unwrap();
    std::fs::write(&f.path, owner.raw().unwrap()).unwrap();
    assert!(owner.check_current().is_err());
    std::fs::remove_file(&f.path).unwrap();
    std::fs::rename(&original, &f.path).unwrap();
    assert!(owner.check_current().is_err());
    assert!(owner.raw().is_err());
}

#[test]
fn retained_config_lock_name_replacement_and_parent_rename_are_sticky_denials() {
    for lock_replacement in [true, false] {
        let f = Fixture::new();
        let owner = f.capture();
        if lock_replacement {
            let lock = f.path.with_extension("toml.lock");
            let original = f.root.join("old.lock");
            std::fs::rename(&lock, &original).unwrap();
            std::fs::write(&lock, b"").unwrap();
            assert!(owner.check_current().is_err());
            std::fs::remove_file(&lock).unwrap();
            std::fs::rename(&original, &lock).unwrap();
        } else {
            let moved = f.root.with_extension("original");
            std::fs::rename(&f.root, &moved).unwrap();
            std::fs::create_dir(&f.root).unwrap();
            assert!(owner.check_current().is_err());
            std::fs::remove_dir(&f.root).unwrap();
            std::fs::rename(&moved, &f.root).unwrap();
        }
        assert!(owner.check_current().is_err());
    }
}

#[test]
fn retained_config_absence_is_bound_and_symlink_hardlink_sources_refuse() {
    let f = Fixture::new();
    std::fs::remove_file(&f.path).unwrap();
    let owner = f.capture();
    assert_eq!(owner.raw().unwrap(), "");
    std::fs::write(&f.path, b"[worker]\n").unwrap();
    assert!(owner.check_current().is_err());
    drop(owner);
    let real = f.root.join("real.toml");
    std::fs::rename(&f.path, &real).unwrap();
    std::os::unix::fs::symlink(&real, &f.path).unwrap();
    assert!(
        RetainedMcpConfiguration::capture(&f.path, Instant::now() + Duration::from_secs(30))
            .is_err()
    );
    std::fs::remove_file(&f.path).unwrap();
    std::fs::hard_link(&real, &f.path).unwrap();
    assert!(
        RetainedMcpConfiguration::capture(&f.path, Instant::now() + Duration::from_secs(30))
            .is_err()
    );
}

#[test]
fn retained_config_expiry_never_releases_or_renews_the_original_lock() {
    let f = Fixture::new();
    let mut owner = f.capture();
    owner.cutoff = Instant::now();
    assert!(owner.check_current().is_err());
    owner.cutoff = Instant::now() + Duration::from_secs(30); // private negative control only
    assert!(owner.check_current().is_err());
    let writer = OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.path.with_extension("toml.source-lock"))
        .unwrap();
    assert!(writer.try_lock_exclusive().is_err());
}

#[test]
fn retained_config_cross_process_writer_helper() {
    let Some(path) = std::env::var_os("NAC_CONFIG_SOURCE_WRITER_FIXTURE") else {
        return;
    };
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(Path::new(&path).with_extension("toml.source-lock"))
        .unwrap();
    if std::env::var_os("NAC_CONFIG_SOURCE_PUBLICATION_FIXTURE").is_some() {
        let record = McpServerConfigurationRecord {
            name: "source-fenced".into(),
            enabled: true,
            transport: MCP_TRANSPORT_STREAMABLE_HTTP.into(),
            url: Some("https://example.invalid/mcp".into()),
            ..Default::default()
        };
        assert!(insert_mcp_server_configuration(Path::new(&path), record).is_err());
    }
    assert!(
        file.try_lock_exclusive().is_err(),
        "another process must observe the original config lock"
    );
}
#[test]
fn retained_config_excludes_a_real_other_process() {
    let f = Fixture::new();
    let owner = f.capture();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "mcp::file_config::source::tests::retained_config_cross_process_writer_helper",
            "--nocapture",
        ])
        .env("NAC_CONFIG_SOURCE_WRITER_FIXTURE", &f.path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let before = std::fs::read(&f.path).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "mcp::file_config::source::tests::retained_config_cross_process_writer_helper",
            "--nocapture",
        ])
        .env("NAC_CONFIG_SOURCE_WRITER_FIXTURE", &f.path)
        .env("NAC_CONFIG_SOURCE_PUBLICATION_FIXTURE", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(std::fs::read(&f.path).unwrap(), before);
    owner.check_current().unwrap();
}

#[test]
fn retained_config_excludes_actual_core_publication_even_without_callers_write_lease() {
    let f = Fixture::new();
    let owner = f.capture();
    let before = std::fs::read(&f.path).unwrap();
    let record = McpServerConfigurationRecord {
        name: "source-fenced".into(),
        enabled: true,
        transport: MCP_TRANSPORT_STREAMABLE_HTTP.into(),
        url: Some("https://example.invalid/mcp".into()),
        ..Default::default()
    };
    assert!(insert_mcp_server_configuration(&f.path, record).is_err());
    assert_eq!(std::fs::read(&f.path).unwrap(), before);
    assert!(!transaction_path(&f.path).exists());
    owner.check_current().unwrap();
}
#[test]
fn retained_config_new_unresolved_journal_after_capture_denies_without_repair() {
    let f = Fixture::new();
    let owner = f.capture();
    let before = std::fs::read(&f.path).unwrap();
    std::fs::write(
        transaction_path(&f.path),
        b"unresolved external publication",
    )
    .unwrap();
    assert!(owner.check_current().is_err());
    std::fs::remove_file(transaction_path(&f.path)).unwrap();
    assert!(owner.check_current().is_err());
    assert_eq!(std::fs::read(&f.path).unwrap(), before);
}

#[test]
fn retained_config_same_current_source_supports_concurrent_preparations() {
    let f = Fixture::new();
    let first = f.capture();
    let second = f.capture();
    assert_eq!(first.raw().unwrap(), second.raw().unwrap());
    first.check_current().unwrap();
    second.check_current().unwrap();
    drop(first);
    second.check_current().unwrap();
    let writer = OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.path.with_extension("toml.source-lock"))
        .unwrap();
    assert!(writer.try_lock_exclusive().is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn retained_config_legacy_data_read_does_not_block_the_actual_store_executor() {
    struct ReadConfig(PathBuf);
    impl crate::store::coordinator::PersistenceCommand for ReadConfig {
        type Output = ConfigurationResult<String>;
        fn correlation(&self) -> crate::telemetry::Correlation {
            crate::telemetry::Correlation::default()
        }
        fn execute(self, _: &Path) -> anyhow::Result<Self::Output> {
            Ok(read_mcp_configuration_consistently(&self.0))
        }
    }
    let f = Fixture::new();
    let mut retained = Some(f.capture());
    let store = f.root.join("store.db");
    crate::store::initialize(&store).unwrap();
    let coordinator = crate::store::StoreCoordinator::acquire(&store).unwrap();
    let mut read = Box::pin(
        coordinator
            .submit(ReadConfig(f.path.clone()))
            .unwrap()
            .acknowledge(),
    );
    let completed = tokio::time::timeout(Duration::from_secs(1), &mut read).await;
    let responsive = completed.is_ok();
    if let Ok(result) = completed {
        assert!(result
            .unwrap()
            .unwrap()
            .contains("thread_timeout_secs = 73"));
        retained.as_ref().unwrap().check_current().unwrap();
        let rows = tokio::time::timeout(
            Duration::from_secs(1),
            coordinator.list_model_configurations(),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(rows.is_empty());
    } else {
        // Always release this source-only fixture and join the real command,
        // so the deterministic RED never strands an executor after failure.
        drop(retained.take());
        read.await.unwrap().unwrap();
    }
    drop(retained.take());
    coordinator.shutdown().await.unwrap();
    assert!(
        responsive,
        "ordinary data read must not wait for retained source retirement on the store executor"
    );
}

#[test]
fn retained_config_legacy_recovery_refuses_while_source_fence_is_retained() {
    let f = Fixture::new();
    let owner = f.capture();
    let before = std::fs::read(&f.path).unwrap();
    // Real well-formed recovery marker in its pre-exchange phase, assembled
    // from the actual document revision. No copied marker grants a mutation.
    let (_, revision) = read_document_image(&f.path).unwrap().unwrap();
    let transaction = PublicationTransaction {
        version: PUBLICATION_TRANSACTION_VERSION,
        expected_revision: revision.digest.unwrap(),
        expected_identity: revision.identity,
        candidate_revision: [7; 32],
        candidate_identity: None,
        temp_name: "config.toml.source-fixture.tmp".into(),
        phase: PublicationPhase::Prepared,
    };
    persist_transaction(&f.path, &transaction).unwrap();
    assert!(read_mcp_configuration_consistently(&f.path).is_err());
    assert_eq!(std::fs::read(&f.path).unwrap(), before);
    assert!(transaction_path(&f.path).exists());
    assert!(owner.check_current().is_err());
}
