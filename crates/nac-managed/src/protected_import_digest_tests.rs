//! Actual Ed25519/enrolled-trust checks with synthetic keys and Source inputs.
//! No real Root issuer/currentness, channel, consume, ACK or runtime acceptance.
use super::sequence_tests::{frame, sequence};
use super::*;
use crate::{ImportChannelContext, ImportProofSequence};

const HEADER: &[u8] =
    br#"{"typ":"nac-managed-import-digest+jwt","alg":"EdDSA","kid":"test-key","v":2}"#;

// Independent fixture serializer for the private Native v2 envelope candidate.
// This is not a freeze/adoption of Root's actual production signer or wire.
#[derive(Clone, Deserialize, Serialize)]
struct TestEnvelope {
    iss: String,
    aud: String,
    iat: i64,
    nbf: i64,
    exp: i64,
    jti: String,
    v: u32,
    phase: ProtectedImportPhase,
    attempt_id: String,
    issuer_key_generation: i64,
    claims_sha256: String,
}
impl TestEnvelope {
    fn new(c: &ImportProofClaims, raw: &[u8]) -> Self {
        Self {
            iss: c.iss.clone(),
            aud: c.aud.clone(),
            iat: c.iat,
            nbf: c.nbf,
            exp: c.exp,
            jti: c.jti.clone(),
            v: 2,
            phase: c.phase,
            attempt_id: c.attempt_id.clone(),
            issuer_key_generation: c.issuer_key_generation,
            claims_sha256: hex(&Sha256::digest(raw)),
        }
    }
}
fn fixture() -> Fixture {
    let mut f = Fixture::new();
    f.claims.v = 2;
    f
}
fn signed(f: &Fixture, c: &ImportProofClaims) -> (String, Vec<u8>) {
    let raw = serde_json::to_vec(c).unwrap();
    let envelope = serde_json::to_vec(&TestEnvelope::new(c, &raw)).unwrap();
    (f.sign_raw(HEADER, &envelope), raw)
}
fn reject(f: &Fixture, compact: &str, raw: &[u8]) {
    assert!(f
        .verifier
        .verify_detached_v2(compact, raw, &f.expected(), NOW)
        .is_err());
}
fn v2_sequence(f: &Fixture) -> ImportProofSequence {
    ImportProofSequence::new_detached_v2(
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
fn accept(s: &mut ImportProofSequence, f: &Fixture, c: &ImportProofClaims) -> String {
    let (compact, raw) = signed(f, c);
    s.accept_detached_v2(&compact, &raw, &c.nonce_hex, Instant::now(), NOW)
        .unwrap();
    hex(&Sha256::digest(compact.as_bytes()))
}

#[test]
fn actual_enrolled_signature_checks_all_eight_roles_and_hashes_exact_compact() {
    let mut f = fixture();
    let mut issued = None;
    let mut previous = None;
    for index in 0..8 {
        f.claims = frame(&f, index, issued.as_deref(), previous.as_deref());
        let (compact, raw) = signed(&f, &f.claims);
        let proof = f
            .verifier
            .verify_detached_v2(&compact, &raw, &f.expected(), NOW)
            .unwrap();
        assert_eq!(proof.claims(), &f.claims);
        assert_eq!(proof.claims().v, 2);
        let digest = hex(proof.proof_sha256());
        assert_eq!(digest, hex(&Sha256::digest(compact.as_bytes())));
        assert_ne!(
            digest,
            hex(&Sha256::digest(&raw)),
            "ACK/lineage hashes compact incl signature"
        );
        f.verifier.recheck(&proof, NOW).unwrap();
        if issued.is_none() {
            issued = Some(digest.clone());
        }
        previous = Some(digest);
    }
}

#[test]
fn detached_digest_authenticates_full_claim_bytes_and_signature_is_mandatory() {
    let f = fixture();
    let (compact, raw) = signed(&f, &f.claims);
    let mut altered = f.claims.clone();
    altered.policy_generation += 1;
    reject(&f, &compact, &serde_json::to_vec(&altered).unwrap());
    let parts: Vec<_> = compact.split('.').collect();
    for signature in [vec![0; 64], vec![0; 63], vec![0; 65]] {
        let forged = format!(
            "{}.{}.{}",
            parts[0],
            parts[1],
            URL_SAFE_NO_PAD.encode(signature)
        );
        assert!(matches!(
            f.verifier
                .verify_detached_v2(&forged, &raw, &f.expected(), NOW),
            Err(ImportProofError::Signature)
        ));
    }
    let other = Ed25519KeyPair::from_seed_unchecked(&[43; 32]).unwrap();
    let input = format!("{}.{}", parts[0], parts[1]);
    let forged = format!(
        "{input}.{}",
        URL_SAFE_NO_PAD.encode(other.sign(input.as_bytes()).as_ref())
    );
    assert!(matches!(
        f.verifier
            .verify_detached_v2(&forged, &raw, &f.expected(), NOW),
        Err(ImportProofError::Signature)
    ));
}

#[test]
fn every_envelope_mirror_and_header_domain_is_checked_even_with_valid_signature() {
    let f = fixture();
    let raw = serde_json::to_vec(&f.claims).unwrap();
    let original = TestEnvelope::new(&f.claims, &raw);
    for index in 0..11 {
        let mut e = original.clone();
        match index {
            0 => e.iss.push('x'),
            1 => e.aud.push('x'),
            2 => e.iat += 1,
            3 => e.nbf += 1,
            4 => e.exp += 1,
            5 => e.jti = id(99),
            6 => e.v = 1,
            7 => e.phase = ProtectedImportPhase::Consume,
            8 => e.attempt_id = id(99),
            9 => e.issuer_key_generation += 1,
            _ => e.claims_sha256 = hash(99),
        }
        reject(
            &f,
            &f.sign_raw(HEADER, &serde_json::to_vec(&e).unwrap()),
            &raw,
        );
    }
    let envelope = serde_json::to_vec(&original).unwrap();
    for header in [
        r#"{"typ":"nac-managed-import+jwt","alg":"EdDSA","kid":"test-key","v":2}"#,
        r#"{"typ":"nac-managed-import-digest+jwt","alg":"none","kid":"test-key","v":2}"#,
        r#"{"typ":"nac-managed-import-digest+jwt","alg":"EdDSA","kid":"test-key","v":1}"#,
        r#"{"typ":"nac-managed-import-digest+jwt","alg":"EdDSA","kid":"other-key","v":2}"#,
        r#"{"typ":"nac-managed-import-digest+jwt","alg":"EdDSA","kid":"test-key","v":2,"extra":false}"#,
        r#"{"typ":"nac-managed-import-digest+jwt","alg":"EdDSA","kid":"test-key","v":2,"v":2}"#,
        r#"{"alg":"EdDSA","typ":"nac-managed-import-digest+jwt","kid":"test-key","v":2}"#,
        r#"{"typ":"nac-managed-import-digest+jwt","alg":"EdDSA","v":2}"#,
    ] {
        reject(&f, &f.sign_raw(header.as_bytes(), &envelope), &raw);
    }
}

#[test]
fn full11_channel_context_and_original_check_must_match_with_valid_signature() {
    let f = fixture();
    for field in [
        "full11_bootstrap_id",
        "full11_managed_host_id",
        "full11_host_incarnation_id",
        "full11_pvc_uid",
        "full11_organization_id",
        "full11_owner_epoch",
        "full11_key_generation",
        "full11_local_key_id",
        "full11_provider_key_id",
        "full11_clerk_instance_id",
        "full11_inference_origin",
        "environment",
        "provider_instance_id",
        "operation_id",
        "original_input_sha256",
        "lifecycle_check_sequence",
        "lifecycle_check_sha256",
        "product_release_id",
        "product_artifact_sha256",
        "source_expires_at_unix_ms",
        "attempt_id",
        "authority_channel_lifetime_id",
        "native_certificate_sha256",
        "d_certificate_sha256",
        "authority_channel_binding_sha256",
        "initial_imported_check_sha256",
    ] {
        let mut value = serde_json::to_value(&f.claims).unwrap();
        let old = value[field].clone();
        value[field] = if let Some(n) = old.as_i64() {
            json!(n + 1)
        } else if field.ends_with("sha256") {
            json!(hash(99))
        } else if old
            .as_str()
            .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
        {
            json!(id(99))
        } else {
            json!("different")
        };
        let c: ImportProofClaims = serde_json::from_value(value).unwrap();
        let (compact, raw) = signed(&f, &c);
        reject(&f, &compact, &raw);
    }
    let mut c = f.claims.clone();
    c.nonce_hex = hash(99);
    c.nonce_sha256 = hex(&Sha256::digest([99; 32]));
    let (compact, raw) = signed(&f, &c);
    reject(&f, &compact, &raw);
}

#[test]
fn closed_canonical_json_and_base64_remain_required_for_each_signed_layer() {
    let f = fixture();
    let raw = serde_json::to_vec(&f.claims).unwrap();
    let e = TestEnvelope::new(&f.claims, &raw);
    let envelope = serde_json::to_string(&e).unwrap();
    for altered in [
        format!(" {envelope}"),
        format!("{envelope}{{}}"),
        envelope.replace("\"v\":2", "\"v\":2,\"v\":2"),
        envelope.replace("\"v\":2", "\"v\":2,\"extra\":false"),
        envelope.replace("\"iat\":1000,\"nbf\":1000", "\"nbf\":1000,\"iat\":1000"),
        envelope.replace("\"iat\":1000", "\"iat\":1e3"),
    ] {
        reject(&f, &f.sign_raw(HEADER, altered.as_bytes()), &raw);
    }
    let body = String::from_utf8(raw.clone()).unwrap();
    for altered in [
        format!(" {body}"),
        format!("{body}{{}}"),
        body.replace("\"v\":2", "\"v\":2,\"v\":2"),
        body.replace(",\"issued_proof_sha256\":null", ""),
        body.replace("\"v\":2", "\"v\":null"),
        body.replace("\"v\":2", "\"v\":2,\"extra\":false"),
    ] {
        let envelope =
            serde_json::to_vec(&TestEnvelope::new(&f.claims, altered.as_bytes())).unwrap();
        reject(&f, &f.sign_raw(HEADER, &envelope), altered.as_bytes());
    }
    let (compact, raw) = signed(&f, &f.claims);
    let parts: Vec<_> = compact.split('.').collect();
    for changed in [
        format!("{}=.{}.{}", parts[0], parts[1], parts[2]),
        format!("{}.{}=.{}", parts[0], parts[1], parts[2]),
        format!("{}=", compact),
        format!("{compact}.extra"),
    ] {
        reject(&f, &changed, &raw);
    }
}

#[test]
fn v2_claim_roles_nil_identities_and_nullable_links_cannot_be_relabeled() {
    let f = fixture();
    for field in [
        "jti",
        "grant_id",
        "attempt_id",
        "operation_id",
        "authority_channel_lifetime_id",
    ] {
        let mut value = serde_json::to_value(&f.claims).unwrap();
        value[field] = json!(uuid::Uuid::nil().to_string());
        let c = serde_json::from_value(value).unwrap();
        let (compact, raw) = signed(&f, &c);
        reject(&f, &compact, &raw);
    }
    for changed in 0..5 {
        let mut c = f.claims.clone();
        match changed {
            0 => c.v = 1,
            1 => c.sequence = 1,
            2 => c.proof_type = ImportProofKind::Current,
            3 => c.issued_proof_sha256 = Some(hash(99)),
            _ => c.consumed_audit_id = Some(id(99)),
        }
        let (compact, raw) = signed(&f, &c);
        reject(&f, &compact, &raw);
    }
}

#[test]
fn v2_rechecks_actual_enrolled_key_revocation_generation_and_material() {
    for failure in 0..3 {
        let f = fixture();
        let (compact, raw) = signed(&f, &f.claims);
        let proof = f
            .verifier
            .verify_detached_v2(&compact, &raw, &f.expected(), NOW)
            .unwrap();
        let mut trust = f.trust();
        match failure {
            0 => trust["keys"][0]["revoked"] = json!(true),
            1 => trust["keys"][0]["issuer_key_generation"] = json!(2),
            _ => trust["keys"][0]["public_key_base64url"] = json!(URL_SAFE_NO_PAD.encode([0; 32])),
        }
        f.write_trust(trust);
        assert!(f.verifier.recheck(&proof, NOW).is_err());
        f.write_trust(f.trust());
        assert!(
            f.verifier.recheck(&proof, NOW).is_err(),
            "revocation/rotation denial sticks"
        );
    }
}

#[test]
fn v2_respects_exact_utc_source_budget_and_actual_original_send_cutoffs() {
    let f = fixture();
    let (compact, raw) = signed(&f, &f.claims);
    for now in [999999, 1030000] {
        assert!(f
            .verifier
            .verify_detached_v2(&compact, &raw, &f.expected(), now)
            .is_err());
    }
    for failure in 0..4 {
        let mut e = f.expected();
        match failure {
            0 => e.phase_sent_at = Instant::now() - Duration::from_secs(61),
            1 => e.original_deadline = Instant::now() - Duration::from_millis(1),
            2 => e.maximum_remaining_deadline_budget_ms = 59000,
            _ => e.phase_sent_at = Instant::now() + Duration::from_secs(1),
        }
        assert!(f
            .verifier
            .verify_detached_v2(&compact, &raw, &e, NOW)
            .is_err());
    }
    for (iat, nbf, exp, budget) in [
        (0, 1000, 1030, 60000),
        (1001, 1000, 1030, 60000),
        (1000, 1000, 1061, 60000),
        (1000, 1000, 1031, 60000),
        (1000, 1000, 1030, 29999),
        (1000, 1000, 1001, 999),
        (1000, 1000, 1030, 60001),
        (i64::MAX - 1, i64::MAX - 1, i64::MAX, 60000),
    ] {
        let mut c = f.claims.clone();
        c.iat = iat;
        c.nbf = nbf;
        c.exp = exp;
        c.remaining_deadline_budget_ms = budget;
        let (compact, raw) = signed(&f, &c);
        reject(&f, &compact, &raw);
    }
}

#[test]
fn bounds_refuse_before_trust_access_and_legacy_verifier_never_auto_upgrades() {
    let f = fixture();
    let (compact, raw) = signed(&f, &f.claims);
    assert!(f.verifier.verify(&compact, &f.expected(), NOW).is_err());
    let mut legacy = f.claims.clone();
    legacy.v = 1;
    reject(&f, &f.sign(&legacy), &serde_json::to_vec(&legacy).unwrap());
    std::fs::remove_file(&f.verifier.trust_file).unwrap();
    for (proof, claims) in [
        ("x".repeat(4184), raw.clone()),
        (compact.clone(), vec![b'x'; 9217]),
        (String::new(), raw),
        (compact, Vec::new()),
    ] {
        assert!(matches!(
            f.verifier
                .verify_detached_v2(&proof, &claims, &f.expected(), NOW),
            Err(ImportProofError::Malformed)
        ));
    }
}

#[test]
fn explicit_v2_sequence_verifies_real_signature_links_and_tightening_all_phases() {
    let f = fixture();
    let mut s = v2_sequence(&f);
    let mut issued = None;
    let mut previous = None;
    let mut deadline = None;
    for index in 0..8 {
        let c = frame(&f, index, issued.as_deref(), previous.as_deref());
        assert_eq!(s.next_phase(), Some(c.phase));
        let digest = accept(&mut s, &f, &c);
        let p = s.check_phase(c.phase, NOW).unwrap();
        assert_eq!(p.claims().v, 2);
        if let Some(old) = deadline {
            assert!(p.deadline() <= old);
        }
        deadline = Some(p.deadline());
        if issued.is_none() {
            issued = Some(digest.clone());
        }
        previous = Some(digest);
    }
    assert_eq!(s.next_phase(), None);
}

#[test]
fn explicit_sequence_modes_refuse_cross_encoding_and_never_fallback() {
    let f = fixture();
    let (compact, raw) = signed(&f, &f.claims);
    let mut legacy = sequence(&f);
    assert!(legacy
        .accept_detached_v2(&compact, &raw, &f.claims.nonce_hex, Instant::now(), NOW)
        .is_err());
    assert_eq!(legacy.next_phase(), None);
    let mut v2 = v2_sequence(&f);
    let mut c = f.claims.clone();
    c.v = 1;
    assert!(v2
        .accept(&f.sign(&c), &c.nonce_hex, Instant::now(), NOW)
        .is_err());
    assert!(v2
        .accept_detached_v2(&compact, &raw, &f.claims.nonce_hex, Instant::now(), NOW)
        .is_err());
    assert_eq!(v2.next_phase(), None);
}

#[test]
fn v2_sequence_refuses_replay_wrong_links_changed_source_and_budget_extension() {
    for failure in 0..7 {
        let f = fixture();
        let mut s = v2_sequence(&f);
        let first = frame(&f, 0, None, None);
        let issued = accept(&mut s, &f, &first);
        let mut c = frame(&f, 1, Some(&issued), Some(&issued));
        match failure {
            0 => {
                c.nonce_hex = first.nonce_hex.clone();
                c.nonce_sha256 = first.nonce_sha256.clone();
            }
            1 => c.jti = first.jti.clone(),
            2 => {
                c.issued_proof_sha256 = Some(hash(99));
                c.preceding_proof_sha256 = Some(hash(99));
            }
            3 => c.policy_generation += 1,
            4 => {
                c.phase = ProtectedImportPhase::PreImport;
                c.sequence = 2;
                c.proof_type = ImportProofKind::Current;
            }
            5 => {
                let parent = accept(&mut s, &f, &c);
                c = frame(&f, 2, Some(&issued), Some(&parent));
                c.remaining_deadline_budget_ms = 56000;
            }
            _ => {
                let parent = accept(&mut s, &f, &c);
                c = frame(&f, 2, Some(&issued), Some(&parent));
                c.consumed_audit_id = Some(id(99));
            }
        }
        let (compact, raw) = signed(&f, &c);
        assert!(s
            .accept_detached_v2(&compact, &raw, &c.nonce_hex, Instant::now(), NOW)
            .is_err());
        assert_eq!(s.next_phase(), None);
        assert!(s.check_phase(ProtectedImportPhase::Issue, NOW).is_err());
    }
}
