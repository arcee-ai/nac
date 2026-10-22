//! Actual eight-phase import/key/root resources, synthetic upstream authority.
//! These controls do not establish provider, Native or CREATE runtime acceptance.
use super::*;
use crate::runtime::{initial_import_admission::tests::capture_fixture_roots, ModelImportFixture};
struct Fixture {
    imported: ModelImportFixture,
    custody: Arc<InitialHostKeyCustody>,
    completion: Arc<CompletedInitialImport>,
    roots: Arc<CreateGlobalSourceRoots>,
}

#[test]
fn concurrent_create_generations_are_unique_and_stop_at_signed_storage_limit() {
    let f = Fixture::new();
    let owner = f.start();
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let owner = Arc::clone(&owner);
            std::thread::spawn(move || {
                (0..64)
                    .map(|_| owner.next_create_generation().unwrap())
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    let mut generations: Vec<_> = workers
        .into_iter()
        .flat_map(|worker| worker.join().unwrap())
        .collect();
    generations.sort_unstable();
    assert_eq!(generations, (1..=512).collect::<Vec<_>>());
    owner
        .create_generation
        .store(i64::MAX as u64 - 1, Ordering::Release);
    assert_eq!(owner.next_create_generation().unwrap(), i64::MAX as u64);
    assert!(owner.next_create_generation().is_err());
    assert_eq!(
        owner.create_generation.load(Ordering::Acquire),
        i64::MAX as u64
    );
}
impl Fixture {
    fn new() -> Self {
        let (imported, custody, completion, roots) = ModelImportFixture::new_with_global_roots();
        Self {
            imported,
            custody: Arc::new(custody),
            completion: Arc::new(completion),
            roots,
        }
    }
    fn retain(&self, lifetime: Duration) -> Arc<PostImportRuntimeHost> {
        PostImportRuntimeHost::retain(
            Arc::clone(&self.custody),
            Arc::clone(&self.completion),
            Arc::clone(&self.roots),
            lifetime,
        )
    }
    fn start(&self) -> Arc<PostImportRuntimeHost> {
        let owner = self.retain(Duration::from_secs(120));
        owner.try_start().unwrap();
        owner
    }
}
#[test]
fn same_original_allocations_and_eight_phase_history_are_retained_before_start() {
    let f = Fixture::new();
    let owner = f.retain(Duration::from_secs(120));
    assert!(Arc::ptr_eq(&owner.custody, &f.custody));
    assert!(Arc::ptr_eq(&owner.completion, &f.completion));
    assert!(Arc::ptr_eq(&owner.roots, &f.roots));
    assert_eq!(f.completion.snapshot().proofs.len(), 8);
    assert!(owner.check_denial().is_err());
    f.custody.check_denial().unwrap();
    std::fs::remove_file(f.imported.receipt_path()).unwrap();
    owner.try_start().unwrap();
    owner.check_current().unwrap();
    assert!(!f.imported.receipt_path().exists(), "no receipt repair");
    let ids = owner.startup_incarnations();
    assert!(!ids.0.is_nil() && !ids.1.is_nil());
    assert_ne!(ids.0, ids.1);
    assert_eq!(ids.2, std::process::id());
    assert_eq!(owner.startup_incarnations(), ids);
    assert_eq!(
        owner.original_runtime_deadline().unwrap(),
        owner.captured_at() + Duration::from_secs(120)
    );
}
#[test]
fn same_path_new_root_allocation_cannot_replace_original_import_roots() {
    let f = Fixture::new();
    let (_, path) = f.roots.original_nac_home_directory().unwrap();
    let copy = capture_fixture_roots(path);
    let owner = PostImportRuntimeHost::retain(
        Arc::clone(&f.custody),
        Arc::clone(&f.completion),
        copy,
        Duration::from_secs(120),
    );
    assert!(owner.try_start().is_err());
    assert!(f.custody.check_denial().is_err());
}
#[test]
fn legacy_import_without_original_roots_cannot_create_positive_runtime() {
    let (imported, custody, completion) = ModelImportFixture::new();
    let path = imported
        .private_key_path()
        .parent()
        .unwrap()
        .canonicalize()
        .unwrap();
    let roots = capture_fixture_roots(&path);
    let custody = Arc::new(custody);
    let owner = PostImportRuntimeHost::retain(
        Arc::clone(&custody),
        Arc::new(completion),
        roots,
        Duration::from_secs(120),
    );
    assert!(owner.try_start().is_err());
    assert!(custody.check_denial().is_err());
}
#[test]
fn unrelated_actual_completion_is_refused_and_retained() {
    let f = Fixture::new();
    let other = Fixture::new();
    let owner = PostImportRuntimeHost::retain(
        Arc::clone(&f.custody),
        Arc::clone(&other.completion),
        Arc::clone(&f.roots),
        Duration::from_secs(120),
    );
    assert!(owner.try_start().is_err());
    assert!(Arc::ptr_eq(&owner.completion, &other.completion));
    assert!(f.custody.check_denial().is_err());
    other.custody.check_denial().unwrap();
}
#[test]
fn second_owner_cannot_renew_even_before_first_start() {
    let f = Fixture::new();
    let original = f.retain(Duration::from_secs(120));
    let duplicate = f.retain(Duration::from_secs(3600));
    assert!(!Arc::ptr_eq(&original, &duplicate));
    assert!(duplicate.try_start().is_err());
    assert!(original.try_start().is_err());
    assert!(f.custody.check_denial().is_err());
}
#[test]
fn repeated_start_on_same_owner_is_sticky_denial() {
    let f = Fixture::new();
    let owner = f.start();
    assert!(owner.try_start().is_err());
    assert!(owner.check_denial().is_err());
    assert!(f.retain(Duration::from_secs(3600)).try_start().is_err());
}
#[test]
fn invalid_explicit_policy_cannot_be_replaced_by_default_or_new_wrapper() {
    for duration in [Duration::ZERO, Duration::MAX] {
        let f = Fixture::new();
        let owner = f.retain(duration);
        assert!(owner.try_start().is_err());
        assert!(f.retain(Duration::from_secs(120)).try_start().is_err());
        assert!(f.custody.check_denial().is_err());
    }
}
#[test]
fn original_deadline_can_only_tighten_and_expiry_cannot_be_renewed() {
    let f = Fixture::new();
    let owner = f.start();
    let original = owner.original_runtime_deadline().unwrap();
    let negative = owner.denial();
    negative.tighten_cutoff(original + Duration::from_secs(120));
    assert_eq!(owner.original_runtime_deadline().unwrap(), original);
    let earlier = original - Duration::from_secs(1);
    negative.tighten_cutoff(earlier);
    assert_eq!(owner.original_runtime_deadline().unwrap(), earlier);
    negative.tighten_cutoff(Instant::now() - Duration::from_secs(1));
    assert!(owner.check_denial().is_err());
    negative.tighten_cutoff(original);
    assert!(owner.check_denial().is_err());
    assert!(f.retain(Duration::from_secs(3600)).try_start().is_err());
}
#[test]
fn late_start_uses_original_capture_clock() {
    let f = Fixture::new();
    let owner = f.retain(Duration::from_secs(120));
    owner
        .denial()
        .tighten_cutoff(Instant::now() - Duration::from_secs(1));
    assert!(owner.try_start().is_err());
    assert!(f.retain(Duration::from_secs(120)).try_start().is_err());
}
#[test]
fn original_import_clock_is_historical_not_runtime_eligibility() {
    let f = Fixture::new();
    let owner = f.retain(Duration::from_secs(120));
    f.imported.expire_import_clock();
    owner.try_start().unwrap();
    owner.check_current().unwrap();
    // Explicitly querying the expired original importer denies its same key.
    assert!(f.completion.check_current().is_err());
    assert!(owner.check_denial().is_err());
}
#[test]
fn actual_private_key_revocation_is_sticky_without_receipt_reconstruction() {
    let f = Fixture::new();
    let owner = f.start();
    let path = f.imported.private_key_path();
    let original = std::fs::read_to_string(&path).unwrap();
    f.imported
        .key_store()
        .record_revocation(f.custody.binding())
        .unwrap();
    assert!(owner.check_current().is_err());
    nac_credential_store::write_auth_string_to_path(&path, &original).unwrap();
    assert!(owner.check_current().is_err());
}
#[test]
fn actual_root_replacement_denies_original_even_after_namespace_restored() {
    let f = Fixture::new();
    let owner = f.start();
    let (_, path) = f.roots.original_nac_home_directory().unwrap();
    let path = path.to_path_buf();
    let moved = path.with_extension("old-runtime-root");
    std::fs::rename(&path, &moved).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(owner.check_current().is_err());
    std::fs::remove_dir(&path).unwrap();
    std::fs::rename(&moved, &path).unwrap();
    assert!(owner.check_current().is_err());
}
#[tokio::test]
async fn same_original_shutdown_or_key_denial_wakes_pending_waiter() {
    for key_denial in [false, true] {
        let f = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
        let owner = f.start();
        let waiter = owner.invalidated();
        tokio::pin!(waiter);
        assert!(tokio::time::timeout(Duration::from_millis(5), &mut waiter)
            .await
            .is_err());
        if key_denial {
            f.custody.deny();
        } else {
            owner.denial().deny();
        }
        tokio::time::timeout(Duration::from_secs(1), &mut waiter)
            .await
            .unwrap();
        assert!(owner.check_denial().is_err());
        assert!(f.custody.check_denial().is_err());
    }
}
#[tokio::test]
async fn tightened_cutoff_wakes_pending_waiter_and_cannot_extend() {
    let f = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    let owner = f.start();
    let waiter = owner.invalidated();
    tokio::pin!(waiter);
    assert!(tokio::time::timeout(Duration::from_millis(5), &mut waiter)
        .await
        .is_err());
    owner
        .denial()
        .tighten_cutoff(Instant::now() - Duration::from_secs(1));
    tokio::time::timeout(Duration::from_secs(1), &mut waiter)
        .await
        .unwrap();
    assert!(owner.check_denial().is_err());
}
#[test]
fn dropping_last_original_owner_revokes_retained_key_and_weak_handle_cannot_rebuild() {
    let f = Fixture::new();
    let owner = f.start();
    let negative = owner.denial();
    let observer = Arc::downgrade(&owner);
    drop(owner);
    assert!(observer.upgrade().is_none());
    negative.tighten_cutoff(Instant::now() + Duration::from_secs(3600));
    negative.deny();
    assert!(f.custody.check_denial().is_err());
    assert!(f.retain(Duration::from_secs(120)).try_start().is_err());
}
#[test]
fn canceled_model_scope_does_not_poison_shared_supervisor_but_key_integrity_does() {
    let f = Fixture::new();
    let owner = f.start();
    assert!(f
        .custody
        .model_key(|| anyhow::bail!("synthetic canceled scope"))
        .is_err());
    assert!(f
        .custody
        .check_model_current(|| anyhow::bail!("synthetic canceled scope"))
        .is_err());
    owner.check_current().unwrap();
    f.custody.model_key(|| Ok(())).unwrap();
    std::fs::remove_file(f.imported.private_key_path()).unwrap();
    assert!(f.custody.check_model_current(|| Ok(())).is_err());
    assert!(owner.check_denial().is_err());
}

#[tokio::test]
async fn completed_import_original_denial_wakes_supervised_runtime() {
    let f = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    let owner = f.start();
    let waiter = owner.invalidated();
    tokio::pin!(waiter);
    assert!(tokio::time::timeout(Duration::from_millis(5), &mut waiter)
        .await
        .is_err());
    f.imported.expire_import_clock();
    assert!(f.completion.check_current().is_err());
    tokio::time::timeout(Duration::from_secs(1), &mut waiter)
        .await
        .expect("original completion denial must wake the same supervisor");
}
