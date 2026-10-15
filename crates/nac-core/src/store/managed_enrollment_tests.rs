use super::*;
use std::sync::{Arc, Barrier};

fn fixture() -> (PathBuf, EnrollmentAttempt) {
    let path = std::env::temp_dir()
        .join(format!("nac-enrollment-{}", Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    let attempt = EnrollmentAttempt {
        attempt_id: Uuid::new_v4(),
        binding: ManagedHostKeyBinding {
            bootstrap_id: Uuid::new_v4().to_string(),
            managed_host_id: Uuid::new_v4().to_string(),
            host_incarnation_id: "fixture-cr".into(),
            pvc_uid: "fixture-pvc".into(),
            organization_id: Uuid::new_v4().to_string(),
            owner_epoch: 1,
            key_generation: 1,
            local_key_id: Uuid::new_v4().to_string(),
            key_id: "fixture-key".into(),
            clerk_instance_id: "fixture-clerk".into(),
            inference_origin: "https://api.arcee.ai".into(),
        },
        original_check_sha256: [1; 32],
        serving_lifetime_id: Uuid::new_v4(),
        eligible_subject: "synthetic-subject".into(),
        primary_revision: "synthetic-primary-revision".into(),
        eligibility_audit_id: "synthetic-eligibility-audit".into(),
    };
    (path, attempt)
}

#[test]
fn enrollment_restart_and_lost_ack_are_observational_never_new_import() {
    let (path, attempt) = fixture();
    assert!(begin_enrollment_attempt(&path, &attempt).unwrap());
    // Simulate loss of the successful acknowledgment and process-local state.
    let retained = read_enrollment_attempt(&path, &attempt.attempt_id)
        .unwrap()
        .unwrap();
    assert_eq!(retained.phase, EnrollmentPhase::Pending);
    assert!(!begin_enrollment_attempt(&path, &attempt).unwrap());
    let mut rebound = attempt.clone();
    rebound.serving_lifetime_id = Uuid::new_v4();
    assert!(begin_enrollment_attempt(&path, &rebound).is_err());
    assert!(finish_enrollment_attempt(&path, &rebound).is_err());
    let imported = finish_enrollment_attempt(&path, &attempt).unwrap();
    assert_eq!(imported.phase, EnrollmentPhase::Imported);
    assert_eq!(
        finish_enrollment_attempt(&path, &attempt).unwrap(),
        imported
    );
    assert!(!begin_enrollment_attempt(&path, &attempt).unwrap());
    let connection = Connection::open(path).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM managed_enrollment_events", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
        2
    );
}

#[test]
fn enrollment_cancellation_preserves_audit_and_permanently_fences_replay() {
    let (path, attempt) = fixture();
    begin_enrollment_attempt(&path, &attempt).unwrap();
    let imported = finish_enrollment_attempt(&path, &attempt).unwrap();
    terminate_enrollment_attempt(&path, &attempt).unwrap();
    terminate_enrollment_attempt(&path, &attempt).unwrap();
    assert!(finish_enrollment_attempt(&path, &attempt).is_err());
    let retained = read_enrollment_attempt(&path, &attempt.attempt_id)
        .unwrap()
        .unwrap();
    assert_eq!(retained.phase, EnrollmentPhase::Terminal);
    assert_eq!(retained.import_audit_id, imported.import_audit_id);
    let mut reused = attempt.clone();
    reused.attempt_id = Uuid::new_v4();
    assert!(begin_enrollment_attempt(&path, &reused).is_err());
    let connection = Connection::open(&path).unwrap();
    for sql in [
        "DELETE FROM managed_enrollment_attempts",
        "UPDATE managed_enrollment_attempts SET phase='pending'",
        "DELETE FROM managed_enrollment_events",
        "UPDATE managed_enrollment_events SET event='imported'",
    ] {
        assert!(connection.execute(sql, []).is_err(), "{sql}");
    }
}

#[test]
fn enrollment_concurrent_attempts_share_one_no_replay_boundary() {
    let (path, attempt) = fixture();
    let barrier = Arc::new(Barrier::new(3));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let (path, attempt, barrier) = (path.clone(), attempt.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                begin_enrollment_attempt(&path, &attempt).unwrap()
            })
        })
        .collect();
    barrier.wait();
    assert_eq!(
        threads
            .into_iter()
            .filter_map(|t| t.join().unwrap().then_some(()))
            .count(),
        1
    );
    terminate_enrollment_attempt(&path, &attempt).unwrap();
    assert!(finish_enrollment_attempt(&path, &attempt).is_err());
    assert_eq!(
        read_enrollment_attempt(&path, &attempt.attempt_id)
            .unwrap()
            .unwrap()
            .import_audit_id,
        None
    );
}

#[test]
fn enrollment_identity_changes_cannot_retarget_pending_work() {
    let (path, attempt) = fixture();
    begin_enrollment_attempt(&path, &attempt).unwrap();
    for field in 0..5 {
        let mut changed = attempt.clone();
        match field {
            0 => changed.original_check_sha256 = [2; 32],
            1 => changed.binding.key_generation += 1,
            2 => changed.eligible_subject = "other".into(),
            3 => changed.primary_revision = "other".into(),
            _ => changed.eligibility_audit_id = "other".into(),
        }
        assert!(begin_enrollment_attempt(&path, &changed).is_err());
        assert!(finish_enrollment_attempt(&path, &changed).is_err());
        assert!(terminate_enrollment_attempt(&path, &changed).is_err());
    }
}

#[test]
fn enrollment_finish_racing_cancellation_never_revives_terminal_state() {
    let (path, attempt) = fixture();
    begin_enrollment_attempt(&path, &attempt).unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let finishing = {
        let (path, attempt, barrier) = (path.clone(), attempt.clone(), barrier.clone());
        std::thread::spawn(move || {
            barrier.wait();
            finish_enrollment_attempt(&path, &attempt)
        })
    };
    let cancelling = {
        let (path, attempt, barrier) = (path.clone(), attempt.clone(), barrier.clone());
        std::thread::spawn(move || {
            barrier.wait();
            terminate_enrollment_attempt(&path, &attempt)
        })
    };
    barrier.wait();
    let finished = finishing.join().unwrap();
    cancelling.join().unwrap().unwrap();
    let retained = read_enrollment_attempt(&path, &attempt.attempt_id)
        .unwrap()
        .unwrap();
    assert_eq!(retained.phase, EnrollmentPhase::Terminal);
    assert_eq!(
        retained.import_audit_id,
        finished.ok().and_then(|s| s.import_audit_id)
    );
    assert!(finish_enrollment_attempt(&path, &attempt).is_err());
}

#[test]
fn protected_enrollment_journal_child() {
    let Some(input) = std::env::var_os("NAC_TEST_ENROLLMENT_CHILD_INPUT") else {
        return;
    };
    let (path, attempt): (PathBuf, EnrollmentAttempt) =
        serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    assert!(begin_enrollment_attempt(&path, &attempt).unwrap());
    // The commit succeeds, but the process dies before its caller gets an ack.
    std::process::exit(91);
}

#[test]
fn enrollment_process_death_after_commit_retains_uncertainty_and_consumes_bootstrap() {
    let (path, attempt) = fixture();
    let input = path.parent().unwrap().join("child-input.json");
    std::fs::write(&input, serde_json::to_vec(&(&path, &attempt)).unwrap()).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "store::managed_enrollment::tests::protected_enrollment_journal_child",
            "--nocapture",
        ])
        .env("NAC_TEST_ENROLLMENT_CHILD_INPUT", &input)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(91));
    assert!(!begin_enrollment_attempt(&path, &attempt).unwrap());
    let retained = read_enrollment_attempt(&path, &attempt.attempt_id)
        .unwrap()
        .unwrap();
    assert_eq!(retained.phase, EnrollmentPhase::Pending);
    assert_eq!(retained.import_audit_id, None);
    terminate_enrollment_attempt(&path, &attempt).unwrap();
    let mut retry = attempt;
    retry.attempt_id = Uuid::new_v4();
    retry.serving_lifetime_id = Uuid::new_v4();
    assert!(begin_enrollment_attempt(&path, &retry).is_err());
}
