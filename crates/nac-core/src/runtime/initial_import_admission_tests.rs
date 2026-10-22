//! Core-only synthetic authority port tests. No Root/TLS/current-primary or
//! image/runtime acceptance is inferred from these deliberately fake resources.
use super::*;
use crate::model::ManagedHostKeyBinding;
use nac_credential_store::write_auth_string_to_path;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use uuid::Uuid;

const PHASES: [ProtectedImportPhase; 8] = [
    ProtectedImportPhase::Issue,
    ProtectedImportPhase::Consume,
    ProtectedImportPhase::PreImport,
    ProtectedImportPhase::PostImport,
    ProtectedImportPhase::BeforeInitialImported,
    ProtectedImportPhase::AfterInitialImported,
    ProtectedImportPhase::BeforeFreshImported,
    ProtectedImportPhase::AfterFreshImported,
];

#[test]
fn actual_carrier_scope_must_match_before_recording_an_imported_phase() {
    for wrong_binding in [false, true] {
        let fixture = Fixture::new();
        let (mut attempt, _custody) = fixture.imported();
        fixture.phase(4);
        let mut binding = fixture
            .source
            .current
            .lock()
            .unwrap()
            .enrollment
            .binding
            .clone();
        let mut check = [8; 32];
        if wrong_binding {
            binding.local_key_id = uuid::Uuid::new_v4().to_string();
        } else {
            check = [9; 32];
        }
        assert!(attempt
            .record_imported_check_for(PHASES[4], &binding, check)
            .is_err());
        assert_eq!(fixture.snapshot().proofs.len(), 4);
        assert!(fixture.source.denied.load(Ordering::Acquire));
        assert!(
            attempt.record_imported_check(PHASES[4]).is_err(),
            "mismatch is sticky"
        );
    }
}

#[test]
fn moving_attempt_to_carrier_cannot_renew_a_retained_cutoff() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    let first = attempt.original_deadline().unwrap();
    *fixture.source.deadline.lock().unwrap() = first + Duration::from_secs(60);
    assert_eq!(attempt.original_deadline().unwrap(), first);
    *fixture.source.deadline.lock().unwrap() = Instant::now() - Duration::from_millis(1);
    assert!(attempt.original_deadline().is_err());
    *fixture.source.deadline.lock().unwrap() = first;
    assert!(attempt.original_deadline().is_err(), "expiry is sticky");
}
struct FakeState {
    #[cfg(unix)]
    global_roots: std::sync::OnceLock<Arc<crate::runtime::CreateGlobalSourceRoots>>,
    current: Mutex<InitialImportAuthoritySnapshot>,
    denied: AtomicBool,
    calls: AtomicUsize,
    fail_at: AtomicUsize,
    panic_at: AtomicUsize,
    deadline: Mutex<Instant>,
    deadline_at_call: Mutex<Option<(usize, Instant)>>,
    fail_after_write: AtomicBool,
    private_path: PathBuf,
    notify_on: Mutex<Option<(usize, std::sync::mpsc::Sender<()>)>>,
    after_write: Mutex<Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>>,
}
struct FakeAuthority(Arc<FakeState>);
impl InitialImportAuthority for FakeAuthority {
    #[cfg(unix)]
    fn global_roots(&self) -> Option<&Arc<crate::runtime::CreateGlobalSourceRoots>> {
        self.0.global_roots.get()
    }

    fn snapshot(&self) -> Result<InitialImportAuthoritySnapshot> {
        Ok(self.0.current.lock().unwrap().clone())
    }
    fn original_deadline(&self) -> Instant {
        *self.0.deadline.lock().unwrap()
    }
    fn check_current(&self, expected: &InitialImportAuthoritySnapshot) -> Result<()> {
        let call = self.0.calls.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some((wanted, deadline)) = *self.0.deadline_at_call.lock().unwrap() {
            if call == wanted {
                *self.0.deadline.lock().unwrap() = deadline;
            }
        }
        assert_ne!(
            call,
            self.0.panic_at.load(Ordering::Acquire),
            "synthetic worker panic"
        );
        if self.0.private_path.exists() {
            let hook = self.0.after_write.lock().unwrap().take();
            if let Some((entered, release)) = hook {
                let _ = entered.send(());
                let _ = release.recv();
            }
        }
        ensure!(
            !self.0.denied.load(Ordering::Acquire)
                && !(self.0.fail_after_write.load(Ordering::Acquire)
                    && self.0.private_path.exists())
                && call != self.0.fail_at.load(Ordering::Acquire)
                && *self.0.current.lock().unwrap() == *expected,
            "synthetic authority unavailable"
        );
        if let Some((wanted, notify)) = &*self.0.notify_on.lock().unwrap() {
            if call == *wanted {
                notify.send(()).unwrap();
            }
        }
        Ok(())
    }
    fn poison(&self) {
        self.0.denied.store(true, Ordering::Release);
    }
}
struct Fixture {
    root: PathBuf,
    path: PathBuf,
    input: PathBuf,
    key_store: ManagedHostKeyStore,
    source: Arc<FakeState>,
    proofs: Vec<InitialImportProofRecord>,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-import-admission-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("store.db");
        store::initialize(&path).unwrap();
        let input = root.join("bootstrap.json");
        let binding = ManagedHostKeyBinding {
            bootstrap_id: Uuid::new_v4().to_string(),
            managed_host_id: Uuid::new_v4().to_string(),
            host_incarnation_id: "synthetic-cr".into(),
            pvc_uid: "synthetic-pvc".into(),
            organization_id: Uuid::new_v4().to_string(),
            owner_epoch: 1,
            key_generation: 1,
            local_key_id: Uuid::new_v4().to_string(),
            key_id: "synthetic-provider-key".into(),
            clerk_instance_id: "synthetic-instance".into(),
            inference_origin: "https://api.arcee.ai".into(),
        };
        let enrollment = EnrollmentAttempt {
            attempt_id: Uuid::new_v4(),
            binding: binding.clone(),
            original_check_sha256: [8; 32].try_into().unwrap(),
            authority_channel_lifetime_id: Uuid::new_v4().try_into().unwrap(),
            eligible_subject: "synthetic-subject".into(),
            primary_revision: "synthetic-primary".into(),
            eligibility_audit_id: Uuid::new_v4().to_string(),
        };
        let mut wire = serde_json::to_value(binding).unwrap();
        wire["version"] = serde_json::json!(3);
        wire["credential_kind"] = serde_json::json!("clerk_api_key");
        wire["scopes"] = serde_json::json!(["managed:inference"]);
        wire["api_key"] = serde_json::json!("synthetic-core-import-canary");
        write_auth_string_to_path(&input, &wire.to_string()).unwrap();
        let grant = Uuid::new_v4();
        let audit = Uuid::new_v4();
        let proofs: Vec<_> = PHASES
            .into_iter()
            .enumerate()
            .map(|(i, phase)| InitialImportProofRecord {
                attempt_id: enrollment.attempt_id,
                grant_id: grant,
                phase,
                proof_sha256: [i as u8 + 1; 32],
                issued_proof_sha256: [1; 32],
                preceding_proof_sha256: (i > 0).then_some([i as u8; 32]),
                consumed_audit_id: (i > 0).then_some(audit),
            })
            .collect();
        let source = Arc::new(FakeState {
            #[cfg(unix)]
            global_roots: std::sync::OnceLock::new(),
            current: Mutex::new(InitialImportAuthoritySnapshot {
                enrollment,
                proof: proofs[0].clone(),
            }),
            denied: AtomicBool::new(false),
            calls: AtomicUsize::new(0),
            fail_at: AtomicUsize::new(usize::MAX),
            panic_at: AtomicUsize::new(usize::MAX),
            deadline: Mutex::new(Instant::now() + Duration::from_secs(60)),
            deadline_at_call: Mutex::new(None),
            fail_after_write: AtomicBool::new(false),
            private_path: root.join("managed_host_key.json"),
            notify_on: Mutex::new(None),
            after_write: Mutex::new(None),
        });
        Self {
            key_store: ManagedHostKeyStore::new(&root),
            root,
            path,
            input,
            source,
            proofs,
        }
    }
    fn begin(&self) -> Result<InitialImportAttempt> {
        InitialImportAttempt::begin(
            &self.path,
            self.key_store.clone(),
            &self.input,
            Box::new(FakeAuthority(Arc::clone(&self.source))),
        )
    }
    fn phase(&self, n: usize) {
        self.source.current.lock().unwrap().proof = self.proofs[n].clone();
    }
    fn snapshot(&self) -> InitialImportSnapshot {
        let id = self.proofs[0].attempt_id;
        store::read_initial_import_grant(&self.path, &id)
            .unwrap()
            .unwrap()
    }
    fn imported(&self) -> (InitialImportAttempt, InitialHostKeyCustody) {
        let mut attempt = self.begin().unwrap();
        self.phase(1);
        attempt.accept_consumed().unwrap();
        self.phase(2);
        attempt.import_once().unwrap();
        assert_eq!(self.snapshot().state, InitialImportState::Started);
        assert!(self.snapshot().enrollment.import_audit_id.is_none());
        self.phase(3);
        let (custody, receipt) = attempt.accept_post_import().unwrap().into_parts();
        assert!(receipt.import_audit_id.is_some());
        (attempt, custody)
    }
}

#[tokio::test]
async fn initial_work_cancelled_join_retains_original_handle_until_io_returns() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let (held_tx, held_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let lock = fixture.root.join("arcee_auth.json.lock");
    let holder = std::thread::spawn(move || {
        nac_credential_store::with_credential_lock(&lock, || {
            held_tx.send(()).unwrap();
            let _ = release_rx.recv();
            Ok(())
        })
        .unwrap();
    });
    held_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (notify_tx, notify_rx) = std::sync::mpsc::channel();
    let notify_at = fixture.source.calls.load(Ordering::Acquire) + 4;
    *fixture.source.notify_on.lock().unwrap() = Some((notify_at, notify_tx));
    let observer = std::thread::spawn(move || {
        notify_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let _ = started_tx.send(());
    });
    let mut work = attempt.into_import_work().unwrap();
    let mut waiting = Box::pin(work.wait());
    tokio::select! { _=started_rx=>{}, result=&mut waiting=>panic!("work returned before held credential lock: {}",result.is_ok()) }
    drop(waiting);
    release_tx.send(()).unwrap();
    holder.join().unwrap();
    observer.join().unwrap();
    let returned = work.wait().await.unwrap();
    assert_eq!(
        returned.terminal().start_observation(),
        InitialImportStartObservation::Claimed
    );
    assert_eq!(
        returned.terminal().outcome(),
        InitialImportIoOutcome::SettledAfterStart { succeeded: false }
    );
    assert!(returned.operation_result().is_err());
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[tokio::test]
async fn initial_work_actual_return_preserves_attempt_for_fresh_postcheck() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let mut work = attempt.into_import_work().unwrap();
    let returned = work.wait().await.unwrap();
    assert_eq!(
        returned.terminal().binding().consumed_proof,
        fixture.proofs[1]
    );
    assert_eq!(
        returned.terminal().outcome(),
        InitialImportIoOutcome::SettledAfterStart { succeeded: true }
    );
    let (attempt, terminal, result) = returned.into_parts();
    result.unwrap();
    drop(terminal);
    drop(work);
    let mut attempt = attempt.unwrap();
    fixture.phase(3);
    let (custody, _) = attempt.accept_post_import().unwrap().into_parts();
    custody.check_current(|| Ok(())).unwrap();
    drop(attempt);
    assert!(custody.check_current(|| Ok(())).is_err());
}

#[tokio::test]
async fn initial_work_capacity_refusal_reports_no_admitted_start() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let _capacity = crate::store::reject_callers_for_test();
    let mut work = attempt.into_import_work().unwrap();
    let returned = work.wait().await.unwrap();
    assert_eq!(
        returned.terminal().outcome(),
        InitialImportIoOutcome::SettledNoStart
    );
    assert!(returned.operation_result().is_err());
    assert!(returned.into_parts().0.is_none());
    assert_eq!(fixture.snapshot().state, InitialImportState::Consumed);
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[tokio::test]
async fn initial_work_keeps_tighter_cutoff_when_source_reports_a_longer_budget() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    let cutoff = Instant::now() + Duration::from_secs(30);
    *fixture.source.deadline.lock().unwrap() = cutoff;
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    *fixture.source.deadline.lock().unwrap() = Instant::now() + Duration::from_secs(60);
    fixture.phase(2);
    let mut work = attempt.into_import_work().unwrap();
    assert_eq!(work.binding().original_deadline, cutoff);
    let result = work.wait().await.unwrap();
    result.operation_result().as_ref().unwrap();
    assert_eq!(result.terminal().binding().original_deadline, cutoff);
}

#[tokio::test]
async fn initial_work_source_denial_before_claim_never_starts_io() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    fixture.source.denied.store(true, Ordering::Release);
    let mut work = attempt.into_import_work().unwrap();
    let returned = work.wait().await.unwrap();
    assert_eq!(
        returned.terminal().outcome(),
        InitialImportIoOutcome::SettledNoStart
    );
    assert!(returned.operation_result().is_err());
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[tokio::test]
async fn initial_work_failed_claim_never_uses_missing_started_row_as_no_effect() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let connection = rusqlite::Connection::open(&fixture.path).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_test_start BEFORE UPDATE ON managed_initial_import_grants WHEN NEW.state='started' BEGIN SELECT RAISE(ABORT,'injected claim failure'); END;").unwrap();
    let mut work = attempt.into_import_work().unwrap();
    let returned = work.wait().await.unwrap();
    assert!(returned.operation_result().is_err());
    assert_eq!(fixture.snapshot().state, InitialImportState::Consumed);
    assert_eq!(
        returned.terminal().outcome(),
        InitialImportIoOutcome::Unknown
    );
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[tokio::test]
async fn initial_work_worker_panic_never_constructs_terminal_no_start() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    fixture.source.panic_at.store(
        fixture.source.calls.load(Ordering::Acquire) + 1,
        Ordering::Release,
    );
    let mut work = attempt.into_import_work().unwrap();
    assert!(work.wait().await.is_err());
    assert!(work.is_finished());
    assert!(work.wait().await.is_err());
    assert!(fixture.source.denied.load(Ordering::Acquire));
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[tokio::test]
async fn initial_work_denial_dominates_late_private_material_without_waiting_on_key_lock() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let cancellation = attempt.cancellation().unwrap();
    let (written_tx, written_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    *fixture.source.after_write.lock().unwrap() = Some((written_tx, release_rx));
    let mut work = attempt.into_import_work().unwrap();
    written_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(fixture.root.join("managed_host_key.json").exists());
    assert!(!work.is_finished());
    // The original worker still holds the credential lock and has not joined.
    cancellation.cancel();
    assert!(fixture.source.denied.load(Ordering::Acquire));
    assert!(!work.is_finished());
    release_tx.send(()).unwrap();
    let result = work.wait().await.unwrap();
    assert_eq!(
        result.terminal().outcome(),
        InitialImportIoOutcome::SettledAfterStart { succeeded: false }
    );
    assert!(result.operation_result().is_err());
    let (attempt, _, _) = result.into_parts();
    let mut attempt = attempt.unwrap();
    fixture.source.denied.store(false, Ordering::Release);
    fixture.phase(3);
    assert!(attempt.accept_post_import().is_err());
    assert!(fixture.snapshot().enrollment.import_audit_id.is_none());
    assert!(fixture.root.join("managed_host_key.json").exists());
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn initial_admission_actual_local_effect_and_postcheck_transfer_once() {
    let fixture = Fixture::new();
    let (mut attempt, custody) = fixture.imported();
    custody.check_current(|| Ok(())).unwrap();
    for phase in 4..8 {
        fixture.phase(phase);
        attempt.record_imported_check(PHASES[phase]).unwrap();
    }
    let completed = attempt.finish().unwrap();
    completed.check_current().unwrap();
    assert_eq!(completed.snapshot().proofs, fixture.proofs);
    drop(completed);
    assert!(custody.check_current(|| Ok(())).is_err());
}

#[test]
fn initial_completed_tightened_deadline_denies_before_and_after_current_checks() {
    for tighten_during_check in [false, true] {
        let fixture = Fixture::new();
        let (mut attempt, custody) = fixture.imported();
        for (phase, value) in PHASES.iter().copied().enumerate().skip(4) {
            fixture.phase(phase);
            attempt.record_imported_check(value).unwrap();
        }
        let completed = attempt.finish().unwrap();
        completed.check_current().unwrap();
        let expired = Instant::now() - Duration::from_secs(1);
        if tighten_during_check {
            let next = fixture.source.calls.load(Ordering::Acquire) + 1;
            *fixture.source.deadline_at_call.lock().unwrap() = Some((next, expired));
        } else {
            *fixture.source.deadline.lock().unwrap() = expired;
        }
        assert!(completed.check_current().is_err());
        // A later optimistic source observation cannot restore this owner.
        fixture.source.deadline_at_call.lock().unwrap().take();
        *fixture.source.deadline.lock().unwrap() = Instant::now() + Duration::from_secs(60);
        fixture.source.denied.store(false, Ordering::Release);
        assert!(completed.check_current().is_err());
        assert!(custody.check_current(|| Ok(())).is_err());
        assert_eq!(fixture.snapshot().proofs.len(), 8);
        assert_eq!(fixture.snapshot().state, InitialImportState::Imported);
    }
}

#[test]
fn initial_admission_missing_consume_or_changed_scope_never_opens_private_slot() {
    for changed_scope in [false, true] {
        let fixture = Fixture::new();
        let mut attempt = fixture.begin().unwrap();
        if changed_scope {
            fixture.phase(1);
            attempt.accept_consumed().unwrap();
        }
        fixture.phase(2);
        if changed_scope {
            fixture
                .source
                .current
                .lock()
                .unwrap()
                .enrollment
                .binding
                .key_generation += 1;
        }
        assert!(attempt.import_once().is_err());
        assert_eq!(
            fixture.snapshot().state,
            if changed_scope {
                InitialImportState::Consumed
            } else {
                InitialImportState::Issued
            }
        );
        assert!(!fixture.root.join("managed_host_key.json").exists());
        fixture.phase(1);
        assert!(attempt.accept_consumed().is_err());
    }
}

#[test]
fn initial_admission_consumed_restart_or_lost_ack_never_mints_another_attempt() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    drop(attempt);
    fixture.source.denied.store(false, Ordering::Release);
    fixture.phase(0);
    assert!(fixture.begin().is_err());
    assert_eq!(fixture.snapshot().state, InitialImportState::Consumed);
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[test]
fn initial_admission_late_fence_failure_preserves_start_and_quarantines_import() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    fixture
        .source
        .fail_after_write
        .store(true, Ordering::Release);
    assert!(attempt.import_once().is_err());
    assert_eq!(fixture.snapshot().state, InitialImportState::Started);
    assert!(fixture.snapshot().enrollment.import_audit_id.is_none());
    assert!(fixture.root.join("managed_host_key.json").exists());
    assert!(!fixture.root.join("managed_host_key_receipt.json").exists());
    fixture
        .source
        .fail_after_write
        .store(false, Ordering::Release);
    fixture.source.denied.store(false, Ordering::Release);
    assert!(attempt.import_once().is_err());
}

#[test]
fn initial_admission_actor_loss_after_custody_transfer_permanently_denies_borrow() {
    let fixture = Fixture::new();
    let (mut attempt, custody) = fixture.imported();
    fixture.source.denied.store(true, Ordering::Release);
    fixture.phase(4);
    assert!(attempt.record_imported_check(PHASES[4]).is_err());
    fixture.source.denied.store(false, Ordering::Release);
    assert!(custody.check_current(|| Ok(())).is_err());
    attempt.cancel().unwrap();
    assert_eq!(fixture.snapshot().state, InitialImportState::Terminal);
    assert!(fixture.snapshot().enrollment.import_audit_id.is_some());
}

#[test]
fn initial_admission_drop_or_premature_finish_denies_transferred_custody() {
    for premature_finish in [false, true] {
        let fixture = Fixture::new();
        let (attempt, custody) = fixture.imported();
        if premature_finish {
            assert!(attempt.finish().is_err());
        } else {
            drop(attempt);
        }
        assert!(custody.check_current(|| Ok(())).is_err());
    }
}

#[test]
fn initial_admission_rechecks_actor_cancel_and_deadline_after_real_credential_lock_wait() {
    for cancellation in 0..4 {
        let fixture = Fixture::new();
        let mut attempt = fixture.begin().unwrap();
        fixture.phase(1);
        attempt.accept_consumed().unwrap();
        fixture.phase(2);
        let (held_tx, held_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let lock = fixture.root.join("arcee_auth.json.lock");
        let holder = std::thread::spawn(move || {
            nac_credential_store::with_credential_lock(&lock, || {
                held_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .unwrap();
        });
        held_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let notify_at = fixture.source.calls.load(Ordering::Acquire) + 4;
        *fixture.source.notify_on.lock().unwrap() = Some((notify_at, started_tx));
        let importing = std::thread::spawn(move || attempt.import_once());
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(fixture.snapshot().state, InitialImportState::Started);
        if cancellation == 1 {
            store::terminate_initial_import_grant(
                &fixture.path,
                &fixture.source.current.lock().unwrap().enrollment,
            )
            .unwrap();
        } else if cancellation == 2 {
            store::finish_enrollment_attempt(
                &fixture.path,
                &fixture.source.current.lock().unwrap().enrollment,
            )
            .unwrap();
        } else if cancellation == 3 {
            *fixture.source.deadline.lock().unwrap() = Instant::now() - Duration::from_secs(1);
        } else {
            fixture.source.denied.store(true, Ordering::Release);
        }
        release_tx.send(()).unwrap();
        holder.join().unwrap();
        assert!(importing.join().unwrap().is_err());
        assert!(!fixture.root.join("managed_host_key.json").exists());
    }
}

#[tokio::test]
async fn initial_admission_caller_drop_denies_detached_blocking_work_before_effect() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let guard = attempt.cancel_on_drop().unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let work = store::spawn_blocking_store_caller(move || {
        entered_tx.send(()).unwrap();
        release_rx.recv().unwrap();
        done_tx.send(attempt.import_once().is_err()).unwrap();
    });
    let caller = tokio::spawn(async move {
        let result = work.await;
        guard.disarm();
        result
    });
    entered_rx.await.unwrap();
    // Actual blocking caller remains admitted, but the async owner is gone.
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    fixture.source.denied.store(false, Ordering::Release);
    release_tx.send(()).unwrap();
    assert!(done_rx.await.unwrap());
    assert_eq!(fixture.snapshot().state, InitialImportState::Consumed);
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

#[test]
fn initial_admission_cancellation_handle_denies_already_transferred_custody() {
    let fixture = Fixture::new();
    let (attempt, custody) = fixture.imported();
    let cancel = attempt.cancellation().unwrap();
    cancel.cancel();
    fixture.source.denied.store(false, Ordering::Release);
    assert!(custody.check_current(|| Ok(())).is_err());
    assert!(attempt.finish().is_err());
}

#[test]
fn initial_import_source_observations_never_hold_a_local_sqlite_writer() {
    // This synthetic port probes Core's lock boundary only. It establishes no
    // AFM/Native writer exclusion or real upstream resource acquisition.
    struct Probe {
        inner: FakeAuthority,
        path: PathBuf,
        observations: Arc<AtomicUsize>,
    }
    impl Probe {
        fn outside_local_write(&self) -> Result<()> {
            let mut connection = rusqlite::Connection::open(&self.path)?;
            connection.busy_timeout(Duration::ZERO)?;
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            transaction.rollback()?;
            self.observations.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }
    }
    impl InitialImportAuthority for Probe {
        fn snapshot(&self) -> Result<InitialImportAuthoritySnapshot> {
            self.outside_local_write()?;
            self.inner.snapshot()
        }
        fn original_deadline(&self) -> Instant {
            self.inner.original_deadline()
        }
        fn check_current(&self, expected: &InitialImportAuthoritySnapshot) -> Result<()> {
            self.outside_local_write()?;
            self.inner.check_current(expected)
        }
        fn poison(&self) {
            self.inner.poison();
        }
    }
    let fixture = Fixture::new();
    let observations = Arc::new(AtomicUsize::new(0));
    let mut attempt = InitialImportAttempt::begin(
        &fixture.path,
        fixture.key_store.clone(),
        &fixture.input,
        Box::new(Probe {
            inner: FakeAuthority(Arc::clone(&fixture.source)),
            path: fixture.path.clone(),
            observations: Arc::clone(&observations),
        }),
    )
    .unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    attempt.import_once().unwrap();
    fixture.phase(3);
    let (_custody, _receipt) = attempt.accept_post_import().unwrap().into_parts();
    for (sequence, phase) in PHASES.iter().enumerate().skip(4) {
        fixture.phase(sequence);
        attempt.record_imported_check(*phase).unwrap();
    }
    let completed = attempt.finish().unwrap();
    completed.check_current().unwrap();
    assert!(observations.load(Ordering::Acquire) >= PHASES.len());
}

#[tokio::test]
async fn initial_import_terminal_audit_cannot_relabel_unknown_work_as_settled() {
    let fixture = Fixture::new();
    let mut attempt = fixture.begin().unwrap();
    fixture.phase(1);
    attempt.accept_consumed().unwrap();
    fixture.phase(2);
    let connection = rusqlite::Connection::open(&fixture.path).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_unknown_start BEFORE UPDATE ON managed_initial_import_grants WHEN NEW.state='started' BEGIN SELECT RAISE(ABORT,'injected unknown start'); END;").unwrap();
    let mut work = attempt.into_import_work().unwrap();
    let (attempt, terminal, operation) = work.wait().await.unwrap().into_parts();
    assert!(operation.is_err());
    assert_eq!(terminal.outcome(), InitialImportIoOutcome::Unknown);
    let mut attempt = attempt.unwrap();
    attempt.cancel().unwrap();
    let snapshot = fixture.snapshot();
    assert_eq!(snapshot.state, InitialImportState::Terminal);
    assert_eq!(snapshot.proofs.len(), 2);
    assert_eq!(
        snapshot.proofs.last(),
        Some(&terminal.binding().consumed_proof)
    );
    assert_eq!(terminal.outcome(), InitialImportIoOutcome::Unknown);
    fixture.source.denied.store(false, Ordering::Release);
    fixture.phase(0);
    assert!(fixture.begin().is_err(), "terminal audit cannot renew work");
    assert!(!fixture.root.join("managed_host_key.json").exists());
}

/// Core-private composition fixture only: actual eight-phase store writes with
/// deliberately synthetic authority, never a public/test-support grant issuer.
pub(crate) struct ModelImportFixture(Fixture);
impl ModelImportFixture {
    pub(crate) fn new() -> (Self, InitialHostKeyCustody, CompletedInitialImport) {
        Self::finish(Fixture::new())
    }
    #[cfg(unix)]
    pub(crate) fn new_with_global_roots() -> (
        Self,
        InitialHostKeyCustody,
        CompletedInitialImport,
        Arc<crate::runtime::CreateGlobalSourceRoots>,
    ) {
        let mut fixture = Fixture::new();
        fixture.root = fixture.root.canonicalize().unwrap();
        fixture.path = fixture.root.join("store.db");
        fixture.input = fixture.root.join("bootstrap.json");
        fixture.key_store = ManagedHostKeyStore::new(&fixture.root);
        let roots = capture_fixture_roots(&fixture.root);
        assert!(fixture.source.global_roots.set(Arc::clone(&roots)).is_ok());
        let (fixture, custody, completed) = Self::finish(fixture);
        (fixture, custody, completed, roots)
    }
    fn finish(fixture: Fixture) -> (Self, InitialHostKeyCustody, CompletedInitialImport) {
        let (mut attempt, custody) = fixture.imported();
        for (index, phase) in PHASES.iter().enumerate().skip(4) {
            fixture.phase(index);
            attempt.record_imported_check(*phase).unwrap();
        }
        let complete = attempt.finish().unwrap();
        (Self(fixture), custody, complete)
    }
    pub(crate) fn key_store(&self) -> &ManagedHostKeyStore {
        &self.0.key_store
    }
    pub(crate) fn private_key_path(&self) -> PathBuf {
        self.0.root.join("managed_host_key.json")
    }
    pub(crate) fn receipt_path(&self) -> PathBuf {
        self.0.root.join("managed_host_key_receipt.json")
    }
    pub(crate) fn expire_import_clock(&self) {
        *self.0.source.deadline.lock().unwrap() = Instant::now() - Duration::from_secs(1);
    }
}

#[cfg(unix)]
#[path = "initial_bootstrap_slot_tests.rs"]
mod bootstrap_slot_tests;

#[cfg(unix)]
pub(crate) fn capture_fixture_roots(root: &Path) -> Arc<crate::runtime::CreateGlobalSourceRoots> {
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let before = [std::env::var_os("HOME"), std::env::var_os("NAC_HOME")];
    std::env::set_var("HOME", root);
    std::env::set_var("NAC_HOME", root);
    let captured = crate::runtime::CreateGlobalSourceRoots::capture(root);
    for (name, value) in ["HOME", "NAC_HOME"].into_iter().zip(before) {
        match value {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }
    Arc::new(captured.unwrap())
}
