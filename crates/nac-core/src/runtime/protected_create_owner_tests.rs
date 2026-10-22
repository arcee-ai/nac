//! Mechanical owner tests with private synthetic admission state, never a
//! production admission producer or test-support authority constructor.
use super::*;
use crate::{
    runtime::{
        protected_execution_resources::capacity_source::tests::Fixture as PolicyFixture,
        PreparationResourceCustody,
    },
    store::native_source_reservation::{SourceKind, SourceVersion},
};
use std::{fs::File, path::PathBuf, sync::atomic::AtomicUsize, time::Duration};
use uuid::Uuid;

#[derive(Default)]
struct Probe {
    denied: AtomicBool,
    fail_physical: AtomicBool,
    panic_physical: AtomicBool,
    drops: AtomicUsize,
    during_check: Mutex<Option<CreateAdmissionDenial>>,
}
struct DirectoryOwner {
    file: File,
    probe: Arc<Probe>,
}
impl PreparationResourceCustody for DirectoryOwner {
    fn check_outside_store(&self) -> Result<()> {
        assert!(
            !self.probe.panic_physical.load(Ordering::Acquire),
            "private control panics during physical revalidation"
        );
        ensure!(
            self.file.metadata()?.is_dir() && !self.probe.fail_physical.load(Ordering::Acquire),
            "directory unavailable"
        );
        let denial = self.probe.during_check.lock().unwrap().take();
        if let Some(denial) = denial {
            denial.deny();
        }
        self.check_denial()
    }
    fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.probe.denied.load(Ordering::Acquire),
            "original directory denied"
        );
        Ok(())
    }
    fn deny(&self) {
        self.probe.denied.store(true, Ordering::Release);
    }
}
impl Drop for DirectoryOwner {
    fn drop(&mut self) {
        self.probe.drops.fetch_add(1, Ordering::AcqRel);
    }
}
pub(crate) struct Fixture {
    _policy: PolicyFixture,
    root: PathBuf,
    owner: Arc<CreateFactoryOwner>,
    probes: [Arc<Probe>; 2],
    denial: CreateAdmissionDenial,
}
impl Fixture {
    pub(crate) fn new() -> Self {
        Self::with_scope(|_| {})
    }
    pub(crate) fn unbound_snapshot() -> Self {
        Self::with_inputs(|binding| binding.creation_snapshot_sha256 = None, |_| {})
    }
    fn with_scope(change: fn(&mut AdmissionState)) -> Self {
        Self::with_inputs(|_| {}, change)
    }
    fn with_inputs(
        change_binding: impl FnOnce(&mut NativeSourceBinding),
        change: impl FnOnce(&mut AdmissionState),
    ) -> Self {
        let policy = PolicyFixture::new();
        let capacity = Arc::new(RetainedCapacityInput::from_owner(policy.load()).unwrap());
        let root = std::env::temp_dir().join(format!("create-owner-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("store.db");
        crate::store::initialize(&path).unwrap();
        let path = std::fs::canonicalize(path).unwrap();
        let binding = NativeSourceBinding {
            operation_id: Uuid::new_v4(),
            source_id: Uuid::new_v4(),
            source_generation: 1,
            canonical_effect_sha256: [1; 32],
            creation_snapshot_sha256: Some([2; 32]),
            session_id: Uuid::new_v4().to_string(),
            project_id: None,
            sources: vec![],
        };
        let mut binding = binding;
        change_binding(&mut binding);
        binding.sources.push(SourceVersion {
            kind: SourceKind::Session,
            resource_id: binding.session_id.clone(),
            revision: 0,
        });
        let cutoff = Instant::now() + Duration::from_secs(60);
        let canonical_intent: Box<[u8]> = b"private synthetic owner control"
            .to_vec()
            .into_boxed_slice();
        let mut state = AdmissionState {
            participant: None,
            binding: binding.clone(),
            store_path: path.clone(),
            capacity_source: capacity.source_view().unwrap(),
            claim_sequence: 1,
            intent_sha256: Sha256::digest(&canonical_intent).into(),
            canonical_intent,
            configuration_sha256: [3; 32],
            backend: Arc::new(ExecutionBackend::Local {
                workspace_cwd: root.clone(),
            }),
            identity: ProtectedExecutionIdentity {
                runtime_id: Uuid::new_v4(),
                runtime_generation: 1,
                execution_owner_id: Uuid::new_v4(),
                process_generation: 1,
                trusted_key_owner_id: Uuid::new_v4(),
                key_generation: 1,
            },
            creator_process: std::process::id(),
            create_cutoff: cutoff,
            runtime_cutoff: Mutex::new(cutoff),
            create_denied: AtomicBool::new(false),
            runtime_denied: AtomicBool::new(false),
            started: AtomicBool::new(false),
            owner: Mutex::new(Weak::new()),
            changed: tokio::sync::Notify::new(),
        };
        change(&mut state);
        let admission = LocalCreateAdmission {
            state: Arc::new(state),
        };
        let denial = admission.denial();
        let probes = [Arc::new(Probe::default()), Arc::new(Probe::default())];
        let resources = ProtectedPreparationInput::new(
            Box::new(DirectoryOwner {
                file: File::open(&root).unwrap(),
                probe: Arc::clone(&probes[0]),
            }),
            Box::new(DirectoryOwner {
                file: File::open(&root).unwrap(),
                probe: Arc::clone(&probes[1]),
            }),
        );
        let owner = CreateFactoryOwner::retain(admission, binding, path, resources, capacity);
        Self {
            _policy: policy,
            root,
            owner,
            probes,
            denial,
        }
    }
    pub(crate) fn for_host_key(binding: &crate::model::ManagedHostKeyBinding) -> Self {
        Self::with_inputs(
            |binding| binding.creation_snapshot_sha256 = None,
            |state| {
                state.identity.trusted_key_owner_id =
                    Uuid::parse_str(&binding.local_key_id).unwrap();
                state.identity.key_generation = binding.key_generation;
            },
        )
    }
    pub(crate) fn observer(&self) -> Weak<CreateFactoryOwner> {
        Arc::downgrade(&self.owner)
    }
    pub(crate) fn retained_and_denied(&self) {
        for probe in &self.probes {
            assert!(probe.denied.load(Ordering::Acquire));
            assert_eq!(
                probe.drops.load(Ordering::Acquire),
                0,
                "discarding an error must retain the same FD/resource allocation"
            );
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn declaration() -> CompartmentResourceDeclaration {
    let one = std::num::NonZeroUsize::new(1).unwrap();
    CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one)
}
struct NoDispatchTransport {
    storage: Mutex<Option<[CompartmentStorageHold; 2]>>,
}
impl ExecutionCompartmentTransport for NoDispatchTransport {
    fn execute(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { bail!("no test dispatch authority") })
    }
    fn spawn_pipe(
        &self,
        _: CompartmentCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        Box::pin(async { bail!("no test dispatch authority") })
    }
    fn spawn_pty(
        &self,
        _: CompartmentCommand,
        _: CompartmentPtySize,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        Box::pin(async { bail!("no test dispatch authority") })
    }
    fn native_file_io(
        &self,
        _: CompartmentFileIoCommand,
        _: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        Box::pin(async { bail!("no test dispatch authority") })
    }
    fn close_and_reap(&self, _: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async {
            drop(self.storage.lock().unwrap().take());
            Ok(())
        })
    }
}
pub(crate) fn finish(fixture: &Fixture) -> CreatePublicationCustody {
    let mut construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let storage = construction.take_storage().unwrap();
    construction
        .finish_with_peer(
            Box::new(NoDispatchTransport {
                storage: Mutex::new(Some(storage)),
            }),
            peer::BoundaryPeer::Synthetic,
        )
        .unwrap()
}

#[test]
fn exact_binding_mismatches_deny_without_dropping_original_resources() {
    for change in [
        (|state: &mut AdmissionState| state.binding.operation_id = Uuid::new_v4())
            as fn(&mut AdmissionState),
        |state| state.binding.source_generation += 1,
        |state| state.store_path.push("another-store"),
        |state| state.claim_sequence = 0,
        |state| state.intent_sha256 = [9; 32],
        |state| state.configuration_sha256 = [0; 32],
        |state| state.creator_process = 0,
    ] {
        let fixture = Fixture::with_scope(change);
        assert!(fixture
            .owner
            .prepare_protected_create(declaration())
            .is_err());
        fixture.retained_and_denied();
    }
}

#[test]
fn physical_failure_and_mid_check_denial_retain_unknown_original_owners() {
    for mid_check in [false, true] {
        let fixture = Fixture::new();
        if mid_check {
            *fixture.probes[0].during_check.lock().unwrap() =
                Some(fixture.owner.admission.denial());
        } else {
            fixture.probes[0]
                .fail_physical
                .store(true, Ordering::Release);
        }
        assert!(fixture
            .owner
            .prepare_protected_create(declaration())
            .is_err());
        fixture.retained_and_denied();
        assert!(
            fixture.owner.source.get().is_none(),
            "physical refusal precedes local source writes"
        );
    }
}

#[test]
fn duplicate_prepare_and_lost_construction_never_restore_unknown_capacity() {
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    assert!(fixture
        .owner
        .prepare_protected_create(declaration())
        .is_err());
    drop(construction);
    fixture.retained_and_denied();
    assert!(fixture
        .owner
        .capacity
        .prepare_native_pair(declaration())
        .is_err());
}

#[test]
fn publication_retirement_preserves_original_active_runtime_currentness() {
    let fixture = Fixture::new();
    let publication = finish(&fixture);
    let runtime = Arc::clone(publication.context());
    publication.retire();
    assert!(publication.check_current().is_err());
    assert!(fixture.owner.source().unwrap().check_denial().is_err());
    drop(publication);
    assert!(runtime.check_stage(ProtectedExecutionStage::Effect).is_ok());
    assert!(fixture.owner.check_runtime().is_ok());
    for probe in &fixture.probes {
        assert!(!probe.denied.load(Ordering::Acquire));
    }
    fixture.denial.deny();
    assert!(runtime
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
    fixture.retained_and_denied();
}

#[test]
fn original_cutoff_only_tightens_and_expiry_denies_quiet_runtime() {
    let fixture = Fixture::new();
    let publication = finish(&fixture);
    let tightened = Instant::now() + Duration::from_secs(1);
    fixture.denial.tighten_cutoff(tightened);
    fixture
        .denial
        .tighten_cutoff(tightened + Duration::from_secs(30));
    assert_eq!(fixture.owner.runtime_deadline(), tightened);
    fixture.denial.tighten_cutoff(Instant::now());
    assert!(publication
        .context
        .check_stage(ProtectedExecutionStage::Prepare)
        .is_err());
    fixture.retained_and_denied();
}

#[test]
fn poisoned_cutoff_cannot_reopen_scope_and_denies_resources_without_reentrant_deadlock() {
    let fixture = Fixture::new();
    let publication = finish(&fixture);
    let state = Arc::clone(&fixture.owner.admission.state);
    let cutoff = &state.runtime_cutoff;
    let result = std::panic::catch_unwind(|| {
        let _guard = cutoff.lock().unwrap();
        panic!("private control poisons original cutoff");
    });
    assert!(result.is_err());
    assert!(publication
        .context
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
    fixture.retained_and_denied();
}

#[test]
fn original_scope_and_allocation_retire_only_after_last_runtime_owner() {
    let fixture = Fixture::new();
    let publication = finish(&fixture);
    let runtime = Arc::clone(publication.context());
    let weak_owner = Arc::downgrade(&fixture.owner);
    let probes = fixture.probes.clone();
    drop(publication);
    drop(fixture);
    assert!(weak_owner.upgrade().is_some());
    for probe in &probes {
        assert_eq!(probe.drops.load(Ordering::Acquire), 0);
    }
    drop(runtime);
    assert!(weak_owner.upgrade().is_none());
    for probe in &probes {
        assert_eq!(probe.drops.load(Ordering::Acquire), 1);
    }
}

#[test]
fn panic_during_preparation_denies_before_caller_can_keep_the_failed_attempt() {
    let fixture = Fixture::new();
    fixture.probes[0]
        .panic_physical
        .store(true, Ordering::Release);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fixture.owner.prepare_protected_create(declaration())
    }));
    assert!(result.is_err());
    fixture.retained_and_denied();
}

#[test]
fn independently_loaded_equal_policy_is_not_original_factory_ownership() {
    let fixture = Fixture::with_scope(|state| {
        let other = PolicyFixture::new();
        state.capacity_source = other.load().source();
    });
    assert!(fixture
        .owner
        .prepare_protected_create(declaration())
        .is_err());
    fixture.retained_and_denied();
}

#[test]
fn source_reservation_is_created_by_factory_and_survives_lost_attempt() {
    let fixture = Fixture::new();
    assert!(fixture.owner.source.get().is_none());
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let source = fixture.owner.source().unwrap();
    assert_eq!(source.binding(), &fixture.owner.local_plan);
    drop(construction);
    assert!(NativeSourceReservation::reserve(
        source.bound_store_path(),
        source.binding().clone(),
        Instant::now() + Duration::from_secs(60)
    )
    .is_err());
    fixture.retained_and_denied();
}

#[test]
fn endpoint_holds_move_once_and_repeat_move_denies_original_scope() {
    let fixture = Fixture::new();
    let mut construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let storage = construction.take_storage().unwrap();
    assert!(construction.take_storage().is_err());
    fixture.retained_and_denied();
    drop(storage);
    drop(construction);
    assert!(fixture
        .owner
        .capacity
        .prepare_native_pair(declaration())
        .is_err());
}

#[test]
fn native_consumer_observes_original_binding_policy_and_weak_lifetime() {
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    construction.check_current().unwrap();
    let binding = construction.binding();
    assert_eq!(binding.operation_id, fixture.owner.local_plan.operation_id);
    assert_eq!(binding.session_id, fixture.owner.local_plan.session_id);
    assert_eq!(binding.claim_sequence, 1);
    assert_eq!(binding.source_id, fixture.owner.local_plan.source_id);
    assert_eq!(
        binding.source_generation,
        fixture.owner.local_plan.source_generation
    );
    assert_eq!(
        binding.intent_sha256,
        fixture.owner.admission.state.intent_sha256
    );
    assert_eq!(binding.configuration_sha256, [3; 32]);
    assert!(Arc::ptr_eq(
        &construction.policy_source().unwrap(),
        &fixture.owner.admission.state.capacity_source
    ));
    let original = fixture.observer();
    drop(construction);
    assert!(observed.check_current().is_err());
    fixture.retained_and_denied();
    drop(fixture);
    assert!(
        original.upgrade().is_none(),
        "observation must not own original resources"
    );
    assert!(observed.create_cutoff().is_err());
}

#[test]
fn native_observation_does_not_reenter_original_execution_resource_checks() {
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    *fixture.probes[1].during_check.lock().unwrap() = Some(fixture.owner.admission.denial());
    observed.check_current().unwrap();
    assert!(fixture.probes[1].during_check.lock().unwrap().is_some());
    assert!(
        construction.check_current().is_err(),
        "physical construction check still checks original resources"
    );
    fixture.retained_and_denied();
}

#[tokio::test]
async fn native_wait_observes_denial_and_does_not_retain_factory() {
    let fixture = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    let pending = tokio::spawn(async move { observed.invalidated().await });
    tokio::task::yield_now().await;
    let original = fixture.observer();
    drop(construction);
    drop(fixture);
    tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(original.upgrade().is_none());
}

#[tokio::test]
async fn native_wait_follows_original_tightening_and_cannot_extend_cutoffs() {
    let fixture = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    let original = observed.runtime_cutoff().unwrap();
    let create = observed.create_cutoff().unwrap();
    fixture
        .denial
        .tighten_cutoff(original + Duration::from_secs(100));
    assert_eq!(observed.runtime_cutoff().unwrap(), original);
    assert_eq!(observed.create_cutoff().unwrap(), create);
    let waiting = observed.clone();
    let pending = tokio::spawn(async move { waiting.invalidated().await });
    tokio::task::yield_now().await;
    let past = Instant::now() - Duration::from_millis(1);
    fixture.denial.tighten_cutoff(past);
    tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(observed.runtime_cutoff().unwrap() <= past);
    assert!(observed.create_cutoff().unwrap() <= past);
    assert!(observed.check_current().is_err());
    fixture.retained_and_denied();
}

#[test]
fn native_observer_checks_original_source_denial_and_policy_retirement() {
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    fixture.owner.source().unwrap().deny();
    assert!(observed.check_create_current().is_err());
    observed.check_current().unwrap();
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    construction.policy_source().unwrap().retirement().retire();
    assert!(observed.check_current().is_err());
}

#[tokio::test]
async fn native_create_observer_retirement_does_not_revoke_published_runtime() {
    let fixture = Fixture::new();
    let mut construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    let storage = construction.take_storage().unwrap();
    let custody = construction
        .finish_with_peer(
            Box::new(NoDispatchTransport {
                storage: Mutex::new(Some(storage)),
            }),
            peer::BoundaryPeer::Synthetic,
        )
        .unwrap();
    observed.check_current().unwrap();
    let waiting = observed.invalidated();
    tokio::pin!(waiting);
    assert!(matches!(
        futures_util::poll!(&mut waiting),
        std::task::Poll::Pending
    ));
    let context = Arc::clone(custody.context());
    drop(custody);
    assert!(observed.check_create_current().is_err());
    observed.check_current().unwrap();
    context
        .check_stage(ProtectedExecutionStage::Effect)
        .unwrap();
}

#[test]
fn native_plan_uses_same_original_policy_before_any_paired_reservation() {
    let fixture = Fixture::new();
    assert!(fixture.owner.source.get().is_none());
    let source = fixture.owner.policy_source().unwrap();
    assert!(Arc::ptr_eq(
        &source,
        &fixture.owner.admission.state.capacity_source
    ));
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    assert!(Arc::ptr_eq(&source, &construction.policy_source().unwrap()));
    source.retirement().retire();
    assert!(fixture.owner.policy_source().is_err());
}

#[test]
fn native_observer_cannot_accept_a_poisoned_original_cutoff() {
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    let observed = construction.currentness();
    let state = Arc::clone(&fixture.owner.admission.state);
    let cutoff = &state.runtime_cutoff;
    let _ = std::panic::catch_unwind(|| {
        let _guard = cutoff.lock().unwrap();
        panic!("poison original runtime cutoff before Native observation");
    });
    assert!(observed.check_current().is_err());
    fixture.retained_and_denied();
}

#[test]
fn native_physical_revalidation_failure_denies_original_allocation_stickily() {
    for before_pair in [true, false] {
        let fixture = Fixture::new();
        let construction = if before_pair {
            None
        } else {
            Some(
                fixture
                    .owner
                    .prepare_protected_create(declaration())
                    .unwrap(),
            )
        };
        fixture.probes[1]
            .fail_physical
            .store(true, Ordering::Release);
        let refused = if let Some(construction) = &construction {
            construction.check_current()
        } else {
            fixture.owner.policy_source().map(|_| ())
        };
        assert!(refused.is_err());
        fixture.probes[1]
            .fail_physical
            .store(false, Ordering::Release);
        assert!(
            fixture.owner.check_runtime().is_err(),
            "failed Native physical check must not reopen after resource restoration"
        );
        fixture.retained_and_denied();
    }
}

#[test]
fn native_preparation_rejects_a_different_owner_with_identical_correlations_and_policy() {
    let fixture = Fixture::new();
    let construction = fixture
        .owner
        .prepare_protected_create(declaration())
        .unwrap();
    // Deliberate private synthetic lookalike: even cloning unreachable private
    // admission state and the same actual policy cannot match original custody.
    let foreign = Arc::new(CreateFactoryOwner {
        admission: LocalCreateAdmission {
            state: Arc::clone(&fixture.owner.admission.state),
        },
        source: OnceLock::new(),
        local_plan: fixture.owner.local_plan.clone(),
        store_path: fixture.owner.store_path.clone(),
        resources: ProtectedPreparationInput::new(
            Box::new(DirectoryOwner {
                file: File::open(&fixture.root).unwrap(),
                probe: Arc::clone(&fixture.probes[0]),
            }),
            Box::new(DirectoryOwner {
                file: File::open(&fixture.root).unwrap(),
                probe: Arc::clone(&fixture.probes[1]),
            }),
        ),
        capacity: Arc::clone(&fixture.owner.capacity),
        boundary: Mutex::new(None),
    });
    assert!(construction.belongs_to(&Arc::clone(&fixture.owner)));
    assert!(!construction.belongs_to(&foreign));
    assert!(Arc::ptr_eq(&foreign.capacity, &fixture.owner.capacity));
    assert_eq!(foreign.local_plan, fixture.owner.local_plan);
    construction.check_current().unwrap();
}

#[test]
fn serving_cancellation_before_preparation_denies_and_retains_original_resources() {
    let fixture = Fixture::new();
    fixture.owner.deny_runtime();
    fixture.owner.deny_runtime();
    assert!(fixture.owner.source.get().is_none());
    assert!(fixture.owner.policy_source().is_err());
    assert!(fixture
        .owner
        .prepare_protected_create(declaration())
        .is_err());
    assert!(fixture.owner.source.get().is_none());
    fixture.retained_and_denied();
}
