use super::*;
use std::{
    process::{Command, Stdio},
    time::Duration,
};
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-slot-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn reserve(root: &Path) -> CredentialSlotReservation {
    CredentialSlotReservation::capture(
        &File::open(root).unwrap(),
        Instant::now() + Duration::from_secs(30),
    )
    .unwrap()
}
#[test]
fn original_gate_excludes_all_shared_mutators_without_holding_credential_lock() {
    let root = Directory::new();
    let original = reserve(&root.0);
    assert!(write_auth_string_to_path(&root.0.join("arcee_auth.json"), "fixture").is_err());
    assert!(remove_auth_file_from_path(&root.0.join("arcee_auth.json")).is_err());
    assert!(FileLock::acquire(&root.0.join("arcee_auth.json.lock")).is_err());
    assert!(FileLock::try_acquire(&root.0.join("arcee_auth.json.lock")).is_err());
    original
        .with_credential_lock(OsStr::new("arcee_auth.json.lock"), |directory| {
            directory.write(OsStr::new("managed_host_key.json"), "fixture")?;
            assert_eq!(
                directory
                    .read(OsStr::new("managed_host_key.json"), 100)?
                    .unwrap(),
                b"fixture"
            );
            Ok(())
        })
        .unwrap();
    // The separate long-lived fence does not retain this short credential lock.
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.0.join("arcee_auth.json.lock"))
        .unwrap();
    FileExt::try_lock_exclusive(&lock).unwrap();
    drop(lock);
    original.finish_known_import().unwrap();
    write_auth_string_to_path(
        &root.0.join("arcee_auth.json"),
        "ordinary-after-known-import",
    )
    .unwrap();
}
#[test]
fn cancellation_and_drop_preserve_quarantine_without_reconstruction() {
    let root = Directory::new();
    let original = reserve(&root.0);
    original.deny();
    assert!(original.finish_known_import().is_err());
    drop(original);
    assert!(CredentialSlotReservation::capture(
        &File::open(&root.0).unwrap(),
        Instant::now() + Duration::from_secs(30)
    )
    .is_err());
    assert!(write_auth_string_to_path(&root.0.join("arcee_auth.json"), "replay").is_err());
}
#[test]
fn original_gate_replacement_and_symlink_refuse_without_touching_target() {
    let root = Directory::new();
    let original = reserve(&root.0);
    fs::rename(root.0.join(GATE), root.0.join("retained-gate")).unwrap();
    fs::write(root.0.join("canary"), "preserve").unwrap();
    std::os::unix::fs::symlink(root.0.join("canary"), root.0.join(GATE)).unwrap();
    assert!(original.check_current().is_err());
    assert!(original.finish_known_import().is_err());
    assert!(write_auth_string_to_path(&root.0.join("arcee_auth.json"), "replacement").is_err());
    assert_eq!(fs::read(root.0.join("canary")).unwrap(), b"preserve");
}
#[test]
fn original_expiry_cannot_be_renewed() {
    let root = Directory::new();
    assert!(CredentialSlotReservation::capture(
        &File::open(&root.0).unwrap(),
        Instant::now() - Duration::from_millis(1)
    )
    .is_err());
    let mut original = reserve(&root.0);
    // Deterministic original-clock boundary; no production setter exists.
    original.cutoff = Instant::now() - Duration::from_millis(1);
    assert!(original.check_current().is_err());
    assert!(original.finish_known_import().is_err());
}
#[test]
fn child_writer() {
    let Some(path) = std::env::var_os("NAC_SLOT_TEST_DIRECTORY") else {
        return;
    };
    let root = PathBuf::from(path);
    match std::env::var("NAC_SLOT_TEST_ACTION").unwrap().as_str() {
        "refuse" => {
            assert!(
                write_auth_string_to_path(&root.join("arcee_auth.json"), "child-fixture").is_err()
            );
            assert!(FileLock::try_acquire(&root.join("arcee_auth.json.lock")).is_err());
        }
        "crash" => {
            let _owner = reserve(&root);
            std::process::exit(0);
        }
        _ => panic!("invalid fixture action"),
    }
}
fn child(root: &Path, action: &str) {
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "slot_gate::tests::child_writer", "--nocapture"])
        .env("NAC_SLOT_TEST_DIRECTORY", root)
        .env("NAC_SLOT_TEST_ACTION", action)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
}
#[test]
fn actual_other_process_and_abrupt_exit_preserve_quarantine() {
    let root = Directory::new();
    let owner = reserve(&root.0);
    child(&root.0, "refuse");
    owner.finish_known_import().unwrap();
    drop(owner);
    child(&root.0, "crash");
    assert!(write_auth_string_to_path(&root.0.join("arcee_auth.json"), "after-crash").is_err());
    assert!(CredentialSlotReservation::capture(
        &File::open(&root.0).unwrap(),
        Instant::now() + Duration::from_secs(30)
    )
    .is_err());
}

#[test]
fn concurrent_first_writers_share_one_new_directory_gate() {
    let root = Directory::new();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let workers = (0..2)
        .map(|index| {
            let barrier = std::sync::Arc::clone(&barrier);
            let path = root.0.clone();
            std::thread::spawn(move || {
                barrier.wait();
                with_credential_lock(&path.join("auth.lock"), || {
                    write_auth_string_to_path(&path.join(format!("fixture-{index}")), "fixture")
                })
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert!(
        results.iter().all(Result::is_ok),
        "first writer results {results:?}; root={} gate={}",
        root.0.exists(),
        root.0.join(GATE).exists()
    );
}

#[test]
fn owned_empty_directory_cleanup_preserves_active_and_quarantined_gates() {
    let empty = Directory::new();
    write_auth_string_to_path(&empty.0.join("owner.json"), "fixture").unwrap();
    remove_auth_file_from_path(&empty.0.join("owner.json")).unwrap();
    let live = credential_mutation_guard(&empty.0.join("owner.json")).unwrap();
    assert!(crate::remove_empty_private_directory(&empty.0).is_err());
    drop(live);
    crate::remove_empty_private_directory(&empty.0).unwrap();
    assert!(!empty.0.exists());
    let quarantined = Directory::new();
    let owner = reserve(&quarantined.0);
    drop(owner);
    assert!(crate::remove_empty_private_directory(&quarantined.0).is_err());
    assert!(quarantined.0.join(GATE).exists());
    let unrelated = Directory::new();
    fs::write(unrelated.0.join("unrelated"), "keep").unwrap();
    assert!(crate::remove_empty_private_directory(&unrelated.0).is_err());
    assert_eq!(fs::read(unrelated.0.join("unrelated")).unwrap(), b"keep");
}

#[test]
fn completed_reservation_serializes_runtime_key_reads_without_false_denial() {
    use std::sync::{mpsc, Arc};
    let root = Directory::new();
    let original = Arc::new(reserve(&root.0));
    original
        .with_credential_lock(OsStr::new("auth.lock"), |io| {
            io.write(OsStr::new("key.json"), "fixture")
        })
        .unwrap();
    original.finish_known_import().unwrap();
    let held = FileLock::acquire(&root.0.join("auth.lock")).unwrap();
    let (started, ready) = mpsc::channel();
    let (sent, result) = mpsc::channel();
    let copied = Arc::clone(&original);
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        let read = copied.with_credential_lock(OsStr::new("auth.lock"), |io| {
            io.read(OsStr::new("key.json"), 100)
        });
        sent.send(read).unwrap();
    });
    ready.recv_timeout(Duration::from_secs(5)).unwrap();
    let premature = result.recv_timeout(Duration::from_millis(100));
    drop(held);
    // Join before reporting failure so fixture cleanup never hides a live job.
    worker.join().unwrap();
    assert!(
        matches!(premature, Err(mpsc::RecvTimeoutError::Timeout)),
        "completed credential read refused ordinary contention: {premature:?}"
    );
    assert_eq!(
        result
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .unwrap(),
        b"fixture"
    );
    original.check_current().unwrap();
}
