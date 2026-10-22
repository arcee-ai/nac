use super::*;
use crate::model::ManagedHostKeyBinding;
use std::sync::{Arc, Barrier};

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
fn fixture() -> (PathBuf, EnrollmentAttempt, Vec<InitialImportProofRecord>) {
    let path = std::env::temp_dir()
        .join(format!("nac-initial-grant-{}", Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    let attempt = EnrollmentAttempt {
        attempt_id: Uuid::new_v4(),
        binding: ManagedHostKeyBinding {
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
        },
        original_check_sha256: [4; 32].try_into().unwrap(),
        authority_channel_lifetime_id: Uuid::new_v4().try_into().unwrap(),
        eligible_subject: "synthetic-subject".into(),
        primary_revision: "synthetic-revision".into(),
        eligibility_audit_id: Uuid::new_v4().to_string(),
    };
    let grant_id = Uuid::new_v4();
    let audit = Uuid::new_v4();
    let proofs = PHASES
        .into_iter()
        .enumerate()
        .map(|(i, phase)| InitialImportProofRecord {
            attempt_id: attempt.attempt_id,
            grant_id,
            phase,
            proof_sha256: [i as u8 + 1; 32],
            issued_proof_sha256: [1; 32],
            preceding_proof_sha256: (i > 0).then_some([i as u8; 32]),
            consumed_audit_id: (i > 0).then_some(audit),
        })
        .collect();
    (path, attempt, proofs)
}

#[test]
fn initial_import_journal_separates_consumed_started_and_actual_completion() {
    let (path, attempt, proofs) = fixture();
    assert!(begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap());
    for (i, proof) in proofs.iter().enumerate() {
        if i > 0 {
            assert!(record_initial_import_phase(&path, &attempt, proof).unwrap());
        }
        let s = read_initial_import_grant(&path, &attempt.attempt_id)
            .unwrap()
            .unwrap();
        assert_eq!(s.proofs, proofs[..=i]);
        assert_eq!(s.revision, i as u64);
        assert_eq!(
            s.state,
            match i {
                0 => InitialImportState::Issued,
                1 => InitialImportState::Consumed,
                2 => InitialImportState::Started,
                _ => InitialImportState::Imported,
            }
        );
        assert_eq!(s.enrollment.import_audit_id.is_some(), i >= 3);
        if i > 0 {
            assert!(!record_initial_import_phase(&path, &attempt, proof).unwrap());
        }
    }
    assert!(!begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap());
    let before = read_initial_import_grant(&path, &attempt.attempt_id)
        .unwrap()
        .unwrap();
    terminate_initial_import_grant(&path, &attempt).unwrap();
    terminate_initial_import_grant(&path, &attempt).unwrap();
    let after = read_initial_import_grant(&path, &attempt.attempt_id)
        .unwrap()
        .unwrap();
    assert_eq!(after.state, InitialImportState::Terminal);
    assert_eq!(after.enrollment.phase, EnrollmentPhase::Terminal);
    assert_eq!(
        after.enrollment.import_audit_id,
        before.enrollment.import_audit_id
    );
    assert_eq!(after.proofs, before.proofs);
    assert_eq!(after.revision, before.revision + 1);
}

#[test]
fn initial_import_journal_has_one_concurrent_private_start_winner() {
    let (path, attempt, proofs) = fixture();
    begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap();
    record_initial_import_phase(&path, &attempt, &proofs[1]).unwrap();
    let gate = Arc::new(Barrier::new(3));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let (path, attempt, proof, gate) = (
                path.clone(),
                attempt.clone(),
                proofs[2].clone(),
                Arc::clone(&gate),
            );
            std::thread::spawn(move || {
                gate.wait();
                record_initial_import_phase(&path, &attempt, &proof).unwrap()
            })
        })
        .collect();
    gate.wait();
    assert_eq!(
        threads
            .into_iter()
            .filter_map(|v| v.join().unwrap().then_some(()))
            .count(),
        1
    );
    // Simulated lost successful ACK / new process only sees Started history.
    assert!(!record_initial_import_phase(&path, &attempt, &proofs[2]).unwrap());
    assert!(!begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap());
    assert_eq!(
        read_initial_import_grant(&path, &attempt.attempt_id)
            .unwrap()
            .unwrap()
            .state,
        InitialImportState::Started
    );
}

#[test]
fn initial_import_journal_refuses_skips_rebinding_and_changed_source_audit() {
    let (path, attempt, proofs) = fixture();
    begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap();
    assert!(record_initial_import_phase(&path, &attempt, &proofs[2]).is_err());
    record_initial_import_phase(&path, &attempt, &proofs[1]).unwrap();
    for field in 0..7 {
        let mut p = proofs[2].clone();
        let mut a = attempt.clone();
        match field {
            0 => p.grant_id = Uuid::new_v4(),
            1 => p.attempt_id = Uuid::new_v4(),
            2 => p.preceding_proof_sha256 = Some([9; 32]),
            3 => p.issued_proof_sha256 = [9; 32],
            4 => p.consumed_audit_id = Some(Uuid::new_v4()),
            5 => a.binding.key_generation += 1,
            _ => a.authority_channel_lifetime_id = Uuid::new_v4().try_into().unwrap(),
        }
        assert!(record_initial_import_phase(&path, &a, &p).is_err());
    }
    terminate_initial_import_grant(&path, &attempt).unwrap();
    assert!(record_initial_import_phase(&path, &attempt, &proofs[2]).is_err());
}

#[test]
fn initial_import_journal_never_upgrades_legacy_or_reuses_bootstrap_or_grant() {
    let (path, attempt, proofs) = fixture();
    begin_enrollment_attempt(&path, &attempt).unwrap();
    assert!(begin_initial_import_grant(&path, &attempt, &proofs[0]).is_err());
    assert!(read_initial_import_grant(&path, &attempt.attempt_id)
        .unwrap()
        .is_none());
    let (path, attempt, proofs) = fixture();
    begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap();
    let mut next = attempt.clone();
    next.attempt_id = Uuid::new_v4();
    let mut proof = proofs[0].clone();
    proof.attempt_id = next.attempt_id;
    proof.grant_id = Uuid::new_v4();
    proof.proof_sha256 = [9; 32];
    proof.issued_proof_sha256 = [9; 32];
    assert!(begin_initial_import_grant(&path, &next, &proof).is_err());
    next.binding.bootstrap_id = Uuid::new_v4().to_string();
    proof.grant_id = proofs[0].grant_id;
    assert!(begin_initial_import_grant(&path, &next, &proof).is_err());
    assert!(read_enrollment_attempt(&path, &next.attempt_id)
        .unwrap()
        .is_none());
}

#[test]
fn initial_import_journal_preserves_immutable_proofs_and_terminal_history() {
    let (path, attempt, proofs) = fixture();
    begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap();
    record_initial_import_phase(&path, &attempt, &proofs[1]).unwrap();
    let connection = Connection::open(&path).unwrap();
    for sql in [
        "DELETE FROM managed_initial_import_grants",
        "DELETE FROM managed_initial_import_proofs",
        "UPDATE managed_initial_import_proofs SET phase_sequence=7",
        "UPDATE managed_initial_import_grants SET state='issued',revision=revision+1",
        "UPDATE managed_initial_import_grants SET grant_id='different',revision=revision+1",
        "UPDATE managed_initial_import_grants SET consumed_audit_id='different',revision=revision+1",
    ] { assert!(connection.execute(sql,[]).is_err(),"{sql}"); }
    terminate_initial_import_grant(&path, &attempt).unwrap();
    assert!(connection
        .execute(
            "UPDATE managed_initial_import_grants SET state='started',revision=revision+1",
            []
        )
        .is_err());
}

#[test]
fn initial_import_journal_child_crash_after_committed_phase() {
    let Some(input) = std::env::var_os("NAC_TEST_INITIAL_IMPORT_CHILD") else {
        return;
    };
    let (path, attempt, proofs, stage): (
        PathBuf,
        EnrollmentAttempt,
        Vec<InitialImportProofRecord>,
        usize,
    ) = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap();
    for proof in proofs.iter().take(stage + 1).skip(1) {
        assert!(record_initial_import_phase(&path, &attempt, proof).unwrap());
    }
    // No normal owner/destructor or successful acknowledgment survives.
    std::process::exit(92);
}

#[test]
fn initial_import_journal_process_death_retains_consumed_or_started_without_replay() {
    for stage in [1, 2] {
        let (path, attempt, proofs) = fixture();
        let input = path.parent().unwrap().join("child-input.json");
        std::fs::write(
            &input,
            serde_json::to_vec(&(&path, &attempt, &proofs, stage)).unwrap(),
        )
        .unwrap();
        let status=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact","store::initial_import::tests::initial_import_journal_child_crash_after_committed_phase","--nocapture"])
            .env("NAC_TEST_INITIAL_IMPORT_CHILD",input).status().unwrap();
        assert_eq!(status.code(), Some(92));
        let retained = read_initial_import_grant(&path, &attempt.attempt_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            retained.state,
            if stage == 1 {
                InitialImportState::Consumed
            } else {
                InitialImportState::Started
            }
        );
        assert!(retained.enrollment.import_audit_id.is_none());
        assert!(!begin_initial_import_grant(&path, &attempt, &proofs[0]).unwrap());
        assert!(!record_initial_import_phase(&path, &attempt, &proofs[stage]).unwrap());
    }
}
