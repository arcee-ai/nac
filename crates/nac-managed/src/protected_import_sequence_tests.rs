use super::*;
use crate::{ImportChannelContext, ImportProofSequence};

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

pub(super) fn sequence(f: &Fixture) -> ImportProofSequence {
    ImportProofSequence::new(
        ImportProofVerifier::new(&f.verifier.trust_file),
        f.context.clone(),
        f.binding.clone(),
        ImportChannelContext {
            attempt_id: f.claims.attempt_id.clone(),
            authority_channel_lifetime_id: f.claims.authority_channel_lifetime_id.clone(),
            native_certificate_sha256: f.claims.native_certificate_sha256.clone(),
            d_certificate_sha256: f.claims.d_certificate_sha256.clone(),
            authority_channel_binding_sha256: f.claims.authority_channel_binding_sha256.clone(),
        },
        Instant::now() + Duration::from_secs(60),
    )
    .unwrap()
}
pub(super) fn frame(
    f: &Fixture,
    index: usize,
    issued: Option<&str>,
    previous: Option<&str>,
) -> ImportProofClaims {
    let mut c = f.claims.clone();
    let n = u8::try_from(index).unwrap();
    c.phase = PHASES[index];
    c.sequence = n;
    c.proof_type = c.phase.required_proof_kind();
    c.jti = id(30 + n);
    c.nonce_hex = hash(7 + n);
    c.nonce_sha256 = hex(&Sha256::digest([7 + n; 32]));
    c.exp = 1020;
    c.remaining_deadline_budget_ms = 60_000 - i64::from(n) * 5000;
    c.issued_proof_sha256 = issued.map(str::to_owned);
    c.preceding_proof_sha256 = previous.map(str::to_owned);
    c.consumed_audit_id = (index != 0).then(|| id(15));
    c.current_imported_check_sha256 = hash(60 + n);
    c.authority_config_resource_version = format!("config-rv-{index}");
    c.managed_resource_resource_version = format!("cr-rv-{index}");
    c.controller_pvc_resource_version = format!("pvc-rv-{index}");
    c
}
fn accept(s: &mut ImportProofSequence, f: &Fixture, c: &ImportProofClaims) -> String {
    let raw = f.sign(c);
    s.accept(&raw, &c.nonce_hex, Instant::now(), NOW).unwrap();
    hex(&Sha256::digest(raw))
}
fn issued(f: &Fixture) -> (ImportProofSequence, String) {
    let mut s = sequence(f);
    let c = frame(f, 0, None, None);
    let digest = accept(&mut s, f, &c);
    (s, digest)
}

#[test]
fn all_phases_keep_one_grant_scope_and_only_tighten_deadlines() {
    let f = Fixture::new();
    let mut s = sequence(&f);
    let mut issue = None;
    let mut previous = None;
    let mut deadline = None;
    for (index, phase) in PHASES.into_iter().enumerate() {
        assert_eq!(s.next_phase(), Some(phase));
        let c = frame(&f, index, issue.as_deref(), previous.as_deref());
        let digest = accept(&mut s, &f, &c);
        let p = s.check_phase(phase, NOW).unwrap();
        if let Some(old) = deadline {
            assert!(p.deadline() <= old);
        }
        deadline = Some(p.deadline());
        if issue.is_none() {
            issue = Some(digest.clone());
        }
        previous = Some(digest);
    }
    assert_eq!(s.next_phase(), None);
    assert!(s.accept("extra", &hash(99), Instant::now(), NOW).is_err());
    assert!(s
        .check_phase(ProtectedImportPhase::AfterFreshImported, NOW)
        .is_err());
}

#[test]
fn root_adopted_vectors_pass_the_stateful_sequence_with_actual_links() {
    let bundle: Value = serde_json::from_str(include_str!(
        "fixtures/managed_import_v2/root-synthetic-vectors.json"
    ))
    .unwrap();
    let vectors = bundle["vectors"].as_array().unwrap();
    let mut f = Fixture::new();
    f.claims = serde_json::from_str(vectors[0]["claims_json"].as_str().unwrap()).unwrap();
    (f.context, f.binding) = expected_parts(&f.claims);
    let raw_hex = bundle["public_ed25519_raw_hex"].as_str().unwrap();
    let key: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&raw_hex[i..i + 2], 16).unwrap())
        .collect();
    f.write_trust(json!({"version":1,"issuer":bundle["issuer"],"audience":bundle["audience"],
        "max_proof_lifetime_seconds":60,"keys":[{"kid":bundle["issuer_key_id"],
        "issuer_key_generation":bundle["issuer_key_generation"],"public_key_base64url":URL_SAFE_NO_PAD.encode(key),
        "not_before_unix_seconds":f.claims.iat-1,"not_after_unix_seconds":f.claims.exp+1,"revoked":false}]}));
    let mut s = sequence(&f);
    let now = (bundle["fixed_unix_seconds"].as_i64().unwrap() + 1) * 1000;
    for vector in vectors {
        let c: ImportProofClaims =
            serde_json::from_str(vector["claims_json"].as_str().unwrap()).unwrap();
        s.accept(
            vector["compact_jws"].as_str().unwrap(),
            &c.nonce_hex,
            Instant::now(),
            now,
        )
        .unwrap();
        assert_eq!(
            hex(s.check_phase(c.phase, now).unwrap().proof_sha256()),
            vector["proof_sha256"]
        );
    }
    assert_eq!(s.next_phase(), None);
}

#[test]
fn repeated_nonce_or_jti_poison_the_original_sequence() {
    for duplicate_nonce in [true, false] {
        let f = Fixture::new();
        let (mut s, digest) = issued(&f);
        let mut c = frame(&f, 1, Some(&digest), Some(&digest));
        let original = frame(&f, 0, None, None);
        if duplicate_nonce {
            c.nonce_hex = original.nonce_hex;
            c.nonce_sha256 = original.nonce_sha256;
        } else {
            c.jti = original.jti;
        }
        assert!(s
            .accept(&f.sign(&c), &c.nonce_hex, Instant::now(), NOW)
            .is_err());
        let valid = frame(&f, 1, Some(&digest), Some(&digest));
        assert!(s
            .accept(&f.sign(&valid), &valid.nonce_hex, Instant::now(), NOW)
            .is_err());
        assert_eq!(s.next_phase(), None);
    }
}

#[test]
fn skipped_phase_wrong_parent_or_changed_consume_audit_cannot_recover() {
    for error in [0, 1, 2] {
        let f = Fixture::new();
        let (mut s, digest) = issued(&f);
        let mut c = frame(&f, 1, Some(&digest), Some(&digest));
        if error == 0 {
            c.phase = ProtectedImportPhase::PreImport;
            c.sequence = 2;
            c.proof_type = ImportProofKind::Current;
        }
        if error == 1 {
            c.issued_proof_sha256 = Some(hash(99));
            c.preceding_proof_sha256 = Some(hash(99));
        }
        if error == 2 {
            let parent = accept(&mut s, &f, &c);
            c = frame(&f, 2, Some(&digest), Some(&parent));
            c.consumed_audit_id = Some(id(99));
        }
        assert!(s
            .accept(&f.sign(&c), &c.nonce_hex, Instant::now(), NOW)
            .is_err());
        assert_eq!(s.next_phase(), None);
    }
}

#[test]
fn signed_changes_to_immutable_source_and_principal_fences_are_denied() {
    for (field, value) in [
        ("actor_id", json!(id(99))),
        ("beneficiary_id", json!(id(99))),
        ("eligible_subject_user_id", json!(id(99))),
        ("eligible_subject_tenant_role", json!("admin")),
        ("eligible_subject_user_generation", json!(2)),
        ("policy_generation", json!(2)),
        ("revocation_generation", json!(2)),
        ("host_generation", json!(2)),
        ("operation_revision", json!(5)),
        ("source_deliver_check_sha256", json!(hash(99))),
        ("source_audit_id", json!(id(99))),
        ("managed_resource_uid", json!("replacement")),
        ("authority_config_uid", json!("replacement")),
        ("managed_resource_generation", json!(2)),
    ] {
        let f = Fixture::new();
        let (mut s, digest) = issued(&f);
        let c = frame(&f, 1, Some(&digest), Some(&digest));
        let mut v = serde_json::to_value(c).unwrap();
        v[field] = value;
        let c: ImportProofClaims = serde_json::from_value(v).unwrap();
        assert!(
            s.accept(&f.sign(&c), &c.nonce_hex, Instant::now(), NOW)
                .is_err(),
            "accepted changed {field}"
        );
        assert_eq!(s.next_phase(), None);
    }
}

#[test]
fn original_expiry_budget_and_elapsed_cutoff_cannot_be_extended() {
    for change in [0, 1, 2] {
        let f = Fixture::new();
        let (mut s, digest) = issued(&f);
        let mut c = frame(&f, 1, Some(&digest), Some(&digest));
        if change == 0 {
            c.exp = 1021;
        }
        if change == 1 {
            c.remaining_deadline_budget_ms = 60_001;
        }
        let sent = if change == 2 {
            Instant::now() - Duration::from_secs(61)
        } else {
            Instant::now()
        };
        assert!(s.accept(&f.sign(&c), &c.nonce_hex, sent, NOW).is_err());
        assert_eq!(s.next_phase(), None);
    }
}

#[test]
fn eof_lost_ack_and_revoked_then_restored_keys_never_revive() {
    for reason in [0, 1, 2] {
        let f = Fixture::new();
        let (mut s, digest) = issued(&f);
        if reason == 0 {
            s.terminate();
        }
        if reason == 1 {
            assert!(s
                .check_phase(ProtectedImportPhase::Issue, 1_020_000)
                .is_err());
        }
        if reason == 2 {
            let mut trust = f.trust();
            trust["keys"][0]["revoked"] = json!(true);
            f.write_trust(trust);
            assert!(s.check_phase(ProtectedImportPhase::Issue, NOW).is_err());
            f.write_trust(f.trust());
        }
        let c = frame(&f, 1, Some(&digest), Some(&digest));
        assert!(s
            .accept(&f.sign(&c), &c.nonce_hex, Instant::now(), NOW)
            .is_err());
        assert!(s.check_phase(ProtectedImportPhase::Issue, NOW).is_err());
    }
}
