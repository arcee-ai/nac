//! Actual Core journal/credential mechanics; upstream source remains synthetic.
use super::*;
use crate::{
    model::{InitialBootstrapSlot, InitialBootstrapSlotBinding, InitialBootstrapSlotRefusal},
    runtime::CreateGlobalSourceRoots,
};
struct Authority {
    original: FakeAuthority,
    slot: Arc<InitialBootstrapSlot>,
}
impl InitialImportAuthority for Authority {
    fn global_roots(&self) -> Option<&Arc<CreateGlobalSourceRoots>> {
        self.original.global_roots()
    }
    fn bootstrap_slot(&self) -> Option<&Arc<InitialBootstrapSlot>> {
        Some(&self.slot)
    }
    fn snapshot(&self) -> Result<InitialImportAuthoritySnapshot> {
        self.original.snapshot()
    }
    fn original_deadline(&self) -> Instant {
        self.original.original_deadline()
    }
    fn check_current(&self, expected: &InitialImportAuthoritySnapshot) -> Result<()> {
        self.slot.check_denial()?;
        self.original.check_current(expected)
    }
    fn poison(&self) {
        self.slot.deny();
        self.original.poison();
    }
}
fn roots(root: &Path) -> Arc<CreateGlobalSourceRoots> {
    // Never sample real HOME/NAC_HOME. Restore immediately after actual capture.
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let before = [std::env::var_os("HOME"), std::env::var_os("NAC_HOME")];
    std::env::set_var("HOME", root);
    std::env::set_var("NAC_HOME", root);
    let captured = CreateGlobalSourceRoots::capture(root);
    for (name, value) in ["HOME", "NAC_HOME"].into_iter().zip(before) {
        match value {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }
    Arc::new(captured.unwrap())
}
fn binding(f: &Fixture) -> InitialBootstrapSlotBinding {
    let b = &f.source.current.lock().unwrap().enrollment.binding;
    InitialBootstrapSlotBinding {
        operation_id: Uuid::new_v4(),
        bootstrap_id: Uuid::parse_str(&b.bootstrap_id).unwrap(),
        managed_host_id: Uuid::parse_str(&b.managed_host_id).unwrap(),
        host_incarnation_id: b.host_incarnation_id.clone(),
        pvc_uid: b.pvc_uid.clone(),
        organization_id: Uuid::parse_str(&b.organization_id).unwrap(),
        owner_epoch: b.owner_epoch,
        key_generation: b.key_generation,
        local_key_id: Uuid::parse_str(&b.local_key_id).unwrap(),
        clerk_instance_id: b.clerk_instance_id.clone(),
        inference_origin: b.inference_origin.clone(),
        intent_sha256: [21; 32],
        request_nonce: [22; 32],
    }
}
fn slot(f: &Fixture) -> Arc<InitialBootstrapSlot> {
    let root = std::fs::canonicalize(&f.root).unwrap();
    let cutoff = Instant::now() + Duration::from_secs(30);
    *f.source.deadline.lock().unwrap() = cutoff;
    InitialBootstrapSlot::capture(roots(&root), binding(f), cutoff).unwrap()
}
fn begin(f: &Fixture, slot: &Arc<InitialBootstrapSlot>) -> Result<InitialImportAttempt> {
    let key_store = ManagedHostKeyStore::new(&std::fs::canonicalize(&f.root)?);
    InitialImportAttempt::begin_from_bootstrap_slot(
        &f.path,
        key_store,
        &f.input,
        Box::new(Authority {
            original: FakeAuthority(Arc::clone(&f.source)),
            slot: Arc::clone(slot),
        }),
        Arc::clone(slot),
    )
}
#[test]
fn actual_eight_phase_import_consumes_same_slot_without_reacquiring_long_lived_lock() {
    let f = Fixture::new();
    let slot = slot(&f);
    assert!(!f.root.join("managed_host_key.json").exists());
    assert!(write_auth_string_to_path(&f.root.join("arcee_auth.json"), "legacy-writer").is_err());
    let mut attempt = begin(&f, &slot).unwrap();
    f.phase(1);
    attempt.accept_consumed().unwrap();
    f.phase(2);
    attempt.import_once().unwrap();
    f.phase(3);
    let (custody, _) = attempt.accept_post_import().unwrap().into_parts();
    custody.check_current(|| Ok(())).unwrap();
    for index in 4..8 {
        f.phase(index);
        attempt.record_imported_check(PHASES[index]).unwrap();
    }
    let completed = attempt.finish().unwrap();
    completed.check_custody_association(&custody).unwrap();
    assert_eq!(f.snapshot().proofs.len(), 8);
    assert_eq!(f.snapshot().state, InitialImportState::Imported);
    custody.check_current(|| Ok(())).unwrap();
    // Known completion released only reservation; normal revocation remains
    // effective and does not invent a new positive source/runtime admission.
    let key_store = ManagedHostKeyStore::new(&std::fs::canonicalize(&f.root).unwrap());
    key_store.record_revocation(custody.binding()).unwrap();
    assert!(custody.check_current(|| Ok(())).is_err());
}
#[test]
fn occupied_authority_receipt_and_legacy_are_explicit_refusals() {
    for name in [
        "managed_host_key.json",
        "managed_host_key_receipt.json",
        "arcee_auth.json",
    ] {
        let f = Fixture::new();
        let root = std::fs::canonicalize(&f.root).unwrap();
        write_auth_string_to_path(&root.join(name), "fixture-occupied").unwrap();
        let result = InitialBootstrapSlot::capture(
            roots(&root),
            binding(&f),
            Instant::now() + Duration::from_secs(30),
        );
        assert!(matches!(result, Err(InitialBootstrapSlotRefusal::Occupied)));
        assert_eq!(std::fs::read(root.join(name)).unwrap(), b"fixture-occupied");
    }
}
#[test]
fn no_path_fallback_default_source_or_wrong_original_allocation_can_transfer() {
    let f = Fixture::new();
    let slot = slot(&f);
    assert!(InitialImportAttempt::begin_from_bootstrap_slot(
        &f.path,
        f.key_store.clone(),
        &f.input,
        Box::new(FakeAuthority(Arc::clone(&f.source))),
        Arc::clone(&slot)
    )
    .is_err());
    assert!(slot.check_denial().is_err());
    assert!(!f.root.join("managed_host_key.json").exists());
    assert!(
        write_auth_string_to_path(&f.root.join("arcee_auth.json"), "unknown-after-refusal")
            .is_err()
    );
}
#[test]
fn wrong_settlement_or_extended_clock_denies_and_quarantines() {
    for clock in [false, true] {
        let f = Fixture::new();
        let slot = slot(&f);
        if clock {
            *f.source.deadline.lock().unwrap() = slot.original_cutoff() + Duration::from_secs(1);
        } else {
            f.source
                .current
                .lock()
                .unwrap()
                .enrollment
                .binding
                .local_key_id = Uuid::new_v4().to_string();
        }
        assert!(begin(&f, &slot).is_err());
        assert!(slot.check_denial().is_err());
        assert!(!f.root.join("managed_host_key.json").exists());
    }
}
#[test]
fn second_transfer_and_cancellation_never_release_original_quarantine() {
    let f = Fixture::new();
    let slot = slot(&f);
    let mut attempt = begin(&f, &slot).unwrap();
    assert!(begin(&f, &slot).is_err());
    assert!(slot.check_denial().is_err());
    assert!(attempt.cancel().is_ok());
    drop(attempt);
    drop(slot);
    assert!(write_auth_string_to_path(&f.root.join("arcee_auth.json"), "replay").is_err());
    assert_eq!(f.snapshot().state, InitialImportState::Terminal);
}
#[test]
fn sql_wait_holds_only_slot_fence_and_never_the_short_credential_lock() {
    use fs2::FileExt;
    let f = Fixture::new();
    let slot = slot(&f);
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.root.join("arcee_auth.json.lock"))
        .unwrap();
    FileExt::try_lock_exclusive(&lock).unwrap();
    FileExt::unlock(&lock).unwrap();
    let mut attempt = begin(&f, &slot).unwrap();
    f.phase(1);
    attempt.accept_consumed().unwrap();
    f.phase(2);
    let connection = store::open_connection(&f.path).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (started, waiting) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        let result = attempt.import_once();
        (attempt, result)
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    FileExt::try_lock_exclusive(&lock).unwrap();
    FileExt::unlock(&lock).unwrap();
    assert!(write_auth_string_to_path(&f.root.join("arcee_auth.json"), "racer").is_err());
    connection.execute_batch("ROLLBACK").unwrap();
    let (_attempt, result) = worker.join().unwrap();
    result.unwrap();
}

#[test]
fn actual_namespace_replacement_is_sticky_without_recapture() {
    let f = Fixture::new();
    let slot = slot(&f);
    let moved = f.root.with_extension("retained");
    std::fs::rename(&f.root, &moved).unwrap();
    std::fs::create_dir(&f.root).unwrap();
    let refused = slot.check_current().is_err();
    std::fs::remove_dir(&f.root).unwrap();
    std::fs::rename(&moved, &f.root).unwrap();
    assert!(refused);
    assert!(slot.check_current().is_err());
    assert!(write_auth_string_to_path(&f.root.join("arcee_auth.json"), "replacement").is_err());
}
#[test]
fn late_failure_keeps_consumed_private_state_and_blocks_every_ordinary_importer() {
    let f = Fixture::new();
    let slot = slot(&f);
    let mut attempt = begin(&f, &slot).unwrap();
    f.phase(1);
    attempt.accept_consumed().unwrap();
    f.phase(2);
    f.source.fail_after_write.store(true, Ordering::Release);
    assert!(attempt.import_once().is_err());
    assert!(f.root.join("managed_host_key.json").exists());
    assert!(!f.root.join("managed_host_key_receipt.json").exists());
    drop(attempt);
    drop(slot);
    let expected = f.source.current.lock().unwrap().enrollment.binding.clone();
    assert!(f.key_store.import(&expected, &f.input).is_err());
    assert!(write_auth_string_to_path(&f.root.join("arcee_auth.json"), "late-retry").is_err());
    assert_eq!(f.snapshot().state, InitialImportState::Started);
}
#[test]
fn real_credential_lock_contention_is_bounded_and_leaves_quarantine() {
    use fs2::FileExt;
    let f = Fixture::new();
    let slot = slot(&f);
    let mut attempt = begin(&f, &slot).unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.root.join("arcee_auth.json.lock"))
        .unwrap();
    FileExt::try_lock_exclusive(&lock).unwrap();
    f.phase(1);
    attempt.accept_consumed().unwrap();
    f.phase(2);
    let started = Instant::now();
    assert!(attempt.import_once().is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    FileExt::unlock(&lock).unwrap();
    assert!(!f.root.join("managed_host_key.json").exists());
    assert!(write_auth_string_to_path(&f.root.join("arcee_auth.json"), "retry").is_err());
}

#[test]
fn different_retained_slot_arc_cannot_substitute_for_original_source() {
    let f = Fixture::new();
    let original = slot(&f);
    let other_fixture = Fixture::new();
    let other = slot(&other_fixture);
    let key_store = ManagedHostKeyStore::new(&std::fs::canonicalize(&f.root).unwrap());
    assert!(InitialImportAttempt::begin_from_bootstrap_slot(
        &f.path,
        key_store,
        &f.input,
        Box::new(Authority {
            original: FakeAuthority(Arc::clone(&f.source)),
            slot: Arc::clone(&other)
        }),
        Arc::clone(&original)
    )
    .is_err());
    assert!(original.check_denial().is_err());
    assert!(other.check_denial().is_err());
    assert!(!f.root.join("managed_host_key.json").exists());
}
#[test]
fn capture_precedes_provider_material_and_does_not_need_a_provider_identity() {
    let f = Fixture::new();
    std::fs::remove_file(&f.input).unwrap();
    let slot = slot(&f);
    assert!(!f.input.exists());
    assert!(!f.root.join("managed_host_key.json").exists());
    let delivery = f.root.with_extension("delivery");
    std::fs::create_dir(&delivery).unwrap();
    let input = delivery.join("bootstrap.json");
    let binding = f.source.current.lock().unwrap().enrollment.binding.clone();
    let mut wire = serde_json::to_value(&binding).unwrap();
    wire["version"] = serde_json::json!(3);
    wire["credential_kind"] = serde_json::json!("clerk_api_key");
    wire["scopes"] = serde_json::json!(["managed:inference"]);
    wire["api_key"] = serde_json::json!("disposable-provider-settlement");
    write_auth_string_to_path(&input, &wire.to_string()).unwrap();
    let key_store = ManagedHostKeyStore::new(&std::fs::canonicalize(&f.root).unwrap());
    let mut attempt = InitialImportAttempt::begin_from_bootstrap_slot(
        &f.path,
        key_store,
        &input,
        Box::new(Authority {
            original: FakeAuthority(Arc::clone(&f.source)),
            slot: Arc::clone(&slot),
        }),
        Arc::clone(&slot),
    )
    .unwrap();
    f.phase(1);
    attempt.accept_consumed().unwrap();
    f.phase(2);
    attempt.import_once().unwrap();
    assert!(f.root.join("managed_host_key.json").exists());
    drop(attempt);
    std::fs::remove_dir_all(delivery).unwrap();
}

#[test]
fn mismatched_source_roots_refuse_before_slot_transfer_or_private_import() {
    let f = Fixture::new();
    let slot = slot(&f);
    let other = roots(&f.root.canonicalize().unwrap());
    assert!(!Arc::ptr_eq(slot.original_roots(), &other));
    assert!(f.source.global_roots.set(other).is_ok());
    assert!(begin(&f, &slot).is_err());
    assert_eq!(f.source.calls.load(Ordering::Acquire), 0);
    assert!(!f.root.join("managed_host_key.json").exists());
    assert!(f.input.exists());
}
#[test]
fn completed_slot_transfers_same_root_and_custody_into_independent_runtime() {
    let f = Fixture::new();
    let slot = slot(&f);
    let roots = Arc::clone(slot.original_roots());
    assert!(f.source.global_roots.set(Arc::clone(&roots)).is_ok());
    let mut attempt = begin(&f, &slot).unwrap();
    f.phase(1);
    attempt.accept_consumed().unwrap();
    f.phase(2);
    attempt.import_once().unwrap();
    f.phase(3);
    let (custody, _) = attempt.accept_post_import().unwrap().into_parts();
    for index in 4..8 {
        f.phase(index);
        attempt.record_imported_check(PHASES[index]).unwrap();
    }
    let completed = Arc::new(attempt.finish().unwrap());
    let custody = Arc::new(custody);
    assert!(Arc::ptr_eq(
        custody.original_global_roots().unwrap(),
        &roots
    ));
    *f.source.deadline.lock().unwrap() = Instant::now() - Duration::from_secs(1);
    let host = crate::runtime::PostImportRuntimeHost::retain(
        Arc::clone(&custody),
        completed,
        roots,
        Duration::from_secs(120),
    );
    host.try_start().unwrap();
    host.check_current().unwrap();
    // A cached veto from the SAME original slot must work inside Core locks;
    // it cannot wait for a later filesystem observation to deny this runtime.
    slot.deny();
    assert!(host.check_denial().is_err());
}
