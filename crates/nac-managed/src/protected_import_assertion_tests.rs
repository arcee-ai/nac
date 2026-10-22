use super::*;
use nac_contracts::ImportProofKind;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{json, Value};

#[path = "protected_import_digest_tests.rs"]
mod digest_tests;
#[path = "protected_import_sequence_tests.rs"]
mod sequence_tests;

const NOW: i64 = 1_000_000;
fn id(n: u8) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}
fn hex(raw: &[u8]) -> String {
    raw.iter().map(|b| format!("{b:02x}")).collect()
}

fn expected_parts(claims: &ImportProofClaims) -> (ImportOriginalContext, ImportExpectedBinding) {
    let context = ImportOriginalContext {
        version: 1,
        environment: claims.environment.clone(),
        provider_instance_id: claims.provider_instance_id.clone(),
        operation_id: claims.operation_id.clone(),
        original_input_sha256: claims.original_input_sha256.clone(),
        lifecycle_check_sequence: claims.lifecycle_check_sequence,
        lifecycle_check_sha256: claims.lifecycle_check_sha256.clone(),
        product_release_id: claims.product_release_id.clone(),
        product_artifact_sha256: claims.product_artifact_sha256.clone(),
        source_expires_at_unix_ms: claims.source_expires_at_unix_ms,
        max_exchange_duration_ms: 60_000,
    };
    let binding = ImportExpectedBinding {
        bootstrap_id: claims.full11_bootstrap_id.clone(),
        managed_host_id: claims.full11_managed_host_id.clone(),
        host_incarnation_id: claims.full11_host_incarnation_id.clone(),
        pvc_uid: claims.full11_pvc_uid.clone(),
        organization_id: claims.full11_organization_id.clone(),
        owner_epoch: claims.full11_owner_epoch,
        key_generation: claims.full11_key_generation,
        local_key_id: claims.full11_local_key_id.clone(),
        provider_key_id: claims.full11_provider_key_id.clone(),
        clerk_instance_id: claims.full11_clerk_instance_id.clone(),
        inference_origin: claims.full11_inference_origin.clone(),
    };
    (context, binding)
}

struct Fixture {
    directory: PathBuf,
    verifier: ImportProofVerifier,
    key: Ed25519KeyPair,
    claims: ImportProofClaims,
    context: ImportOriginalContext,
    binding: ImportExpectedBinding,
}
impl Fixture {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("nac-import-proof-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        // Synthetic test key, unrelated to operator/private deployment keys.
        let key = Ed25519KeyPair::from_seed_unchecked(&[42; 32]).unwrap();
        let nonce = hash(7);
        let mut fields = json!({
            "iss":"urn:test:import-issuer", "aud":"urn:test:native-machine",
            "iat":1000, "nbf":1000, "exp":1030, "jti":id(1), "v":1,
            "phase":"issue", "proof_type":"issued", "sequence":0,
            "grant_id":id(2), "attempt_id":id(3), "purpose":"initial_import",
            "environment":"test", "provider_instance_id":"provider-1", "operation_id":id(4),
            "original_input_sha256":hash(1), "full11_bootstrap_id":id(5),
            "full11_managed_host_id":id(6), "full11_host_incarnation_id":"incarnation-1",
            "full11_pvc_uid":"pvc-1", "full11_organization_id":id(7),
            "full11_owner_epoch":1, "full11_key_generation":1, "full11_local_key_id":id(8),
            "full11_provider_key_id":"provider-key-1", "full11_clerk_instance_id":"clerk-1",
            "full11_inference_origin":"https://models.arcee.ai", "actor_id":id(9),
            "beneficiary_id":id(10), "profile_id":id(11), "eligible_subject_user_id":id(9),
            "eligible_subject_organization_id":id(7), "eligible_subject_profile_id":id(11),
            "eligible_subject_tenant_role":"owner", "eligible_subject_platform_role":"int_user",
            "eligible_subject_user_generation":1, "eligible_subject_organization_generation":1,
            "eligible_subject_profile_generation":1
        });
        let second = json!({"policy_generation":1, "revocation_generation":1,
            "host_generation":1, "product_release_id":id(12), "product_artifact_sha256":hash(2),
            "lifecycle_check_sequence":1, "lifecycle_check_sha256":hash(3), "operation_revision":4,
            "source_deliver_check_sha256":hash(4), "source_audit_id":id(13),
            "initial_imported_check_sha256":hash(5), "current_imported_check_sha256":hash(6),
            "authority_config_uid":"config-uid", "authority_config_resource_version":"config-rv",
            "managed_resource_uid":"cr-uid", "managed_resource_resource_version":"cr-rv",
            "managed_resource_generation":1, "controller_pvc_uid":"pvc-1",
            "controller_pvc_resource_version":"pvc-rv", "controller_machine_id":"d-machine",
            "d_certificate_sha256":hash(8), "host_incarnation_id":"incarnation-1",
            "organization_id":id(7), "profile_generation":1, "owner_epoch":1,
            "product_key_generation":1, "target_key_generation":1, "issuer_key_id":"test-key",
            "issuer_key_generation":1, "authority_channel_lifetime_id":id(14),
            "native_certificate_sha256":hash(9), "authority_channel_binding_sha256":hash(10),
            "source_expires_at_unix_ms":1_060_000, "nonce_hex":nonce,
            "nonce_sha256":hex(&Sha256::digest([7;32])), "remaining_deadline_budget_ms":60_000,
            "issued_proof_sha256":null, "preceding_proof_sha256":null, "consumed_audit_id":null
        });
        fields
            .as_object_mut()
            .unwrap()
            .extend(second.as_object().unwrap().clone());
        let claims: ImportProofClaims = serde_json::from_value(fields).unwrap();
        let (context, binding) = expected_parts(&claims);
        let fixture = Self {
            verifier: ImportProofVerifier::new(directory.join("trust.json")),
            directory,
            key,
            claims,
            context,
            binding,
        };
        fixture.write_trust(fixture.trust());
        fixture
    }
    fn trust(&self) -> Value {
        json!({"version":1, "issuer":"urn:test:import-issuer", "audience":"urn:test:native-machine",
        "max_proof_lifetime_seconds":60, "keys":[{
            "kid":"test-key", "issuer_key_generation":1,
            "public_key_base64url":URL_SAFE_NO_PAD.encode(self.key.public_key().as_ref()),
            "not_before_unix_seconds":900, "not_after_unix_seconds":1100, "revoked":false
        }]})
    }
    fn write_trust(&self, value: Value) {
        std::fs::write(
            &self.verifier.trust_file,
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }
    fn expected(&self) -> ImportProofExpectation<'_> {
        ImportProofExpectation {
            context: &self.context,
            binding: &self.binding,
            phase: self.claims.phase,
            attempt_id: &self.claims.attempt_id,
            authority_channel_lifetime_id: &self.claims.authority_channel_lifetime_id,
            native_certificate_sha256: &self.claims.native_certificate_sha256,
            d_certificate_sha256: &self.claims.d_certificate_sha256,
            authority_channel_binding_sha256: &self.claims.authority_channel_binding_sha256,
            nonce_hex: &self.claims.nonce_hex,
            grant_id: (self.claims.sequence != 0).then_some(self.claims.grant_id.as_str()),
            issued_proof_sha256: self.claims.issued_proof_sha256.as_deref(),
            preceding_proof_sha256: self.claims.preceding_proof_sha256.as_deref(),
            consumed_audit_id: self.claims.consumed_audit_id.as_deref(),
            initial_imported_check_sha256: Some(&self.claims.initial_imported_check_sha256),
            maximum_expiry_unix_seconds: Some(1030),
            maximum_remaining_deadline_budget_ms: 60_000,
            phase_sent_at: Instant::now(),
            original_deadline: Instant::now() + Duration::from_secs(60),
        }
    }
    fn sign(&self, claims: &ImportProofClaims) -> String {
        self.sign_raw(
            br#"{"typ":"nac-managed-import+jwt","alg":"EdDSA","kid":"test-key","v":1}"#,
            &serde_json::to_vec(claims).unwrap(),
        )
    }
    fn sign_raw(&self, header: &[u8], claims: &[u8]) -> String {
        let input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header),
            URL_SAFE_NO_PAD.encode(claims)
        );
        format!(
            "{input}.{}",
            URL_SAFE_NO_PAD.encode(self.key.sign(input.as_bytes()).as_ref())
        )
    }
    fn reject(&self, compact: &str) {
        assert!(self
            .verifier
            .verify(compact, &self.expected(), NOW)
            .is_err());
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn synthetic_signature_and_all_eight_exact_phase_roles() {
    let mut f = Fixture::new();
    let phases = [
        ProtectedImportPhase::Issue,
        ProtectedImportPhase::Consume,
        ProtectedImportPhase::PreImport,
        ProtectedImportPhase::PostImport,
        ProtectedImportPhase::BeforeInitialImported,
        ProtectedImportPhase::AfterInitialImported,
        ProtectedImportPhase::BeforeFreshImported,
        ProtectedImportPhase::AfterFreshImported,
    ];
    for phase in phases {
        f.claims.phase = phase;
        f.claims.sequence = phase.sequence();
        f.claims.proof_type = phase.required_proof_kind();
        if phase != ProtectedImportPhase::Issue {
            f.claims.issued_proof_sha256 = Some(hash(11));
            f.claims.preceding_proof_sha256 = Some(hash(11));
            f.claims.consumed_audit_id = Some(id(15));
        }
        let raw = f.sign(&f.claims);
        let proof = f.verifier.verify(&raw, &f.expected(), NOW).unwrap();
        assert_eq!(
            proof.proof_sha256(),
            Sha256::digest(raw.as_bytes()).as_slice()
        );
        assert_eq!(proof.claims().phase, phase);
        f.verifier.recheck(&proof, NOW).unwrap();
    }
}

#[test]
fn every_full11_field_must_match_even_with_valid_signature() {
    let f = Fixture::new();
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
    ] {
        let mut value = serde_json::to_value(&f.claims).unwrap();
        value[field] = if value[field].is_number() {
            json!(2)
        } else if field.ends_with("origin") {
            json!("https://other.invalid")
        } else if matches!(
            field,
            "full11_bootstrap_id"
                | "full11_managed_host_id"
                | "full11_organization_id"
                | "full11_local_key_id"
        ) {
            json!(id(99))
        } else {
            json!("different")
        };
        let c = serde_json::from_value(value).unwrap();
        f.reject(&f.sign(&c));
    }
}

#[test]
fn expected_operation_lifecycle_product_and_channel_cannot_be_substituted() {
    let f = Fixture::new();
    for field in [
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
        let mut v = serde_json::to_value(&f.claims).unwrap();
        v[field] = if v[field].is_number() {
            json!(2)
        } else if field.ends_with("sha256") {
            json!(hash(99))
        } else if field.ends_with("_id")
            && matches!(
                field,
                "operation_id"
                    | "product_release_id"
                    | "attempt_id"
                    | "authority_channel_lifetime_id"
            )
        {
            json!(id(99))
        } else {
            json!("different")
        };
        f.reject(&f.sign(&serde_json::from_value(v).unwrap()));
    }
    let mut c = f.claims.clone();
    c.nonce_hex = hash(99);
    c.nonce_sha256 = hex(&Sha256::digest([99; 32]));
    f.reject(&f.sign(&c));
}

#[test]
fn strict_header_and_claim_json_rejects_unknown_duplicate_missing_and_reordered() {
    let f = Fixture::new();
    let body = serde_json::to_vec(&f.claims).unwrap();
    for header in [
        r#"{"alg":"EdDSA","typ":"nac-managed-import+jwt","kid":"test-key","v":1}"#,
        r#"{"typ":"nac-managed-import+jwt","alg":"none","kid":"test-key","v":1}"#,
        r#"{"typ":"nac-managed-import+jwt","alg":"EdDSA","kid":"test-key","v":1,"jku":"https://example.invalid"}"#,
        r#"{"typ":"nac-managed-import+jwt","alg":"EdDSA","kid":"test-key","v":1,"v":1}"#,
    ] {
        f.reject(&f.sign_raw(header.as_bytes(), &body));
    }
    let header = br#"{"typ":"nac-managed-import+jwt","alg":"EdDSA","kid":"test-key","v":1}"#;
    let raw = String::from_utf8(body).unwrap();
    for changed in [
        format!(" {raw}"),
        format!("{raw}{{}}"),
        raw.replace("\"v\":1", "\"v\":1,\"v\":1"),
        raw.replace(",\"issued_proof_sha256\":null", ""),
        raw.replace(
            "\"consumed_audit_id\":null",
            "\"consumed_audit_id\":null,\"serving_lifetime_id\":null",
        ),
        raw.replace("\"iat\":1000,\"nbf\":1000", "\"nbf\":1000,\"iat\":1000"),
        raw.replace("\"iat\":1000", "\"iat\":1e3"),
    ] {
        f.reject(&f.sign_raw(header, changed.as_bytes()));
    }
}

#[test]
fn canonical_base64_signature_and_frame_bounds() {
    let f = Fixture::new();
    let raw = f.sign(&f.claims);
    let parts: Vec<_> = raw.split('.').collect();
    f.reject(&format!("{}=.{}.{}", parts[0], parts[1], parts[2]));
    f.reject(&format!("{raw}.extra"));
    f.reject("");
    f.reject(&"x".repeat(15_001));
    f.reject(&format!(
        "{}.{}.{}",
        parts[0],
        parts[1],
        URL_SAFE_NO_PAD.encode([0; 64])
    ));
    f.reject(&format!(
        "{}.{}.{}",
        parts[0],
        parts[1],
        URL_SAFE_NO_PAD.encode([0; 63])
    ));
}

#[test]
fn exact_expiry_budget_and_original_send_deadline() {
    let f = Fixture::new();
    let raw = f.sign(&f.claims);
    assert!(f.verifier.verify(&raw, &f.expected(), 1_030_000).is_err());
    assert!(f.verifier.verify(&raw, &f.expected(), 999_999).is_err());
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
        f.reject(&f.sign(&c));
    }
    let mut e = f.expected();
    e.phase_sent_at = Instant::now() - Duration::from_secs(61);
    assert!(f.verifier.verify(&raw, &e, NOW).is_err());
    let mut e = f.expected();
    e.original_deadline = Instant::now() - Duration::from_millis(1);
    assert!(f.verifier.verify(&raw, &e, NOW).is_err());
    let mut e = f.expected();
    e.maximum_remaining_deadline_budget_ms = 59000;
    assert!(f.verifier.verify(&raw, &e, NOW).is_err());
    let mut e = f.expected();
    e.phase_sent_at = Instant::now() + Duration::from_secs(10);
    assert!(f.verifier.verify(&raw, &e, NOW).is_err());
}

#[test]
fn phase_roles_required_links_ids_digests_and_principal_shape() {
    let f = Fixture::new();
    let mut c = f.claims.clone();
    c.proof_type = ImportProofKind::Current;
    f.reject(&f.sign(&c));
    let mut c = f.claims.clone();
    c.sequence = 1;
    f.reject(&f.sign(&c));
    let mut c = f.claims.clone();
    c.issued_proof_sha256 = Some(hash(1));
    f.reject(&f.sign(&c));
    for (field, value) in [
        ("eligible_subject_organization_id", json!(id(99))),
        ("eligible_subject_tenant_role", json!("tenant_owner")),
        ("eligible_subject_platform_role", json!("internal_user")),
        ("eligible_subject_user_generation", json!(-1)),
        ("source_deliver_check_sha256", json!(hash(0))),
        ("nonce_sha256", json!(hash(1))),
        ("grant_id", json!(f.claims.attempt_id)),
        ("issuer_key_generation", json!(0)),
        ("jti", json!("00000000-0000-0000-0000-000000000000")),
        ("operation_id", json!("00000000000040008000000000000004")),
        ("environment", json!("x".repeat(129))),
    ] {
        let mut v = serde_json::to_value(&f.claims).unwrap();
        v[field] = value;
        f.reject(&f.sign(&serde_json::from_value(v).unwrap()));
    }
}

#[test]
fn trust_unknown_revoked_generation_audience_and_windows() {
    let f = Fixture::new();
    let raw = f.sign(&f.claims);
    for (field, value) in [
        ("kid", json!("other")),
        ("issuer_key_generation", json!(2)),
        ("revoked", json!(true)),
        ("not_before_unix_seconds", json!(1001)),
        ("not_after_unix_seconds", json!(1020)),
        (
            "public_key_base64url",
            json!(URL_SAFE_NO_PAD.encode([0; 31])),
        ),
    ] {
        let mut trust = f.trust();
        trust["keys"][0][field] = value;
        f.write_trust(trust);
        f.reject(&raw);
    }
    for (field, value) in [
        ("issuer", json!("other")),
        ("audience", json!("other")),
        ("version", json!(2)),
        ("max_proof_lifetime_seconds", json!(61)),
        ("keys", json!([])),
    ] {
        let mut trust = f.trust();
        trust[field] = value;
        f.write_trust(trust);
        f.reject(&raw);
    }
    let mut trust = f.trust();
    let key = trust["keys"][0].clone();
    trust["keys"].as_array_mut().unwrap().push(key);
    f.write_trust(trust);
    f.reject(&raw);
    let mut trust = f.trust();
    let mut key = trust["keys"][0].clone();
    key["kid"] = json!("second");
    trust["keys"].as_array_mut().unwrap().push(key);
    f.write_trust(trust);
    f.reject(&raw);
    let raw_trust = serde_json::to_string(&f.trust())
        .unwrap()
        .replace("\"version\":1", "\"version\":1,\"version\":1");
    std::fs::write(&f.verifier.trust_file, raw_trust).unwrap();
    f.reject(&raw);
}

#[test]
fn trust_failure_or_key_replacement_stays_denied_after_restoration() {
    for replace in [false, true] {
        let f = Fixture::new();
        let proof = f
            .verifier
            .verify(&f.sign(&f.claims), &f.expected(), NOW)
            .unwrap();
        let mut trust = f.trust();
        if replace {
            let key = Ed25519KeyPair::from_seed_unchecked(&[43; 32]).unwrap();
            trust["keys"][0]["public_key_base64url"] =
                json!(URL_SAFE_NO_PAD.encode(key.public_key().as_ref()));
        } else {
            trust["keys"][0]["revoked"] = json!(true);
        }
        f.write_trust(trust);
        assert!(f.verifier.recheck(&proof, NOW).is_err());
        f.write_trust(f.trust());
        assert_eq!(
            f.verifier.recheck(&proof, NOW),
            Err(ImportProofError::Unavailable)
        );
    }
}

#[test]
fn consumed_links_and_initial_expiry_are_required_before_later_phases() {
    let mut f = Fixture::new();
    f.claims.phase = ProtectedImportPhase::Consume;
    f.claims.sequence = 1;
    f.claims.proof_type = ImportProofKind::Consumed;
    f.claims.issued_proof_sha256 = Some(hash(11));
    f.claims.preceding_proof_sha256 = Some(hash(11));
    f.claims.consumed_audit_id = Some(id(15));
    let raw = f.sign(&f.claims);
    let mut e = f.expected();
    e.maximum_expiry_unix_seconds = None;
    assert!(f.verifier.verify(&raw, &e, NOW).is_err());
    let mut c = f.claims.clone();
    c.preceding_proof_sha256 = Some(hash(12));
    f.reject(&f.sign(&c));
    let mut c = f.claims.clone();
    c.grant_id = id(99);
    f.reject(&f.sign(&c));
    let mut c = f.claims.clone();
    c.consumed_audit_id = None;
    f.reject(&f.sign(&c));
}

#[test]
fn expired_proof_cannot_revive_after_wall_clock_rollback() {
    let f = Fixture::new();
    let proof = f
        .verifier
        .verify(&f.sign(&f.claims), &f.expected(), NOW)
        .unwrap();
    assert!(f.verifier.recheck(&proof, 1_030_000).is_err());
    assert_eq!(
        f.verifier.recheck(&proof, NOW),
        Err(ImportProofError::Unavailable)
    );
}

#[test]
fn expected_context_validates_before_network_or_authority() {
    let f = Fixture::new();
    f.context.validate().unwrap();
    for (field, invalid) in [
        ("environment", json!("bad environment")),
        ("provider_instance_id", json!("x".repeat(257))),
        ("operation_id", json!("not-a-uuid")),
        ("lifecycle_check_sequence", json!(-1)),
        ("lifecycle_check_sha256", json!(hash(0))),
        ("source_expires_at_unix_ms", json!(0)),
        ("max_exchange_duration_ms", json!(60_001)),
    ] {
        let mut value = serde_json::to_value(&f.context).unwrap();
        value[field] = invalid;
        let context: ImportOriginalContext = serde_json::from_value(value).unwrap();
        assert!(context.validate().is_err(), "accepted invalid {field}");
    }
}

#[test]
fn zero_owner_and_key_generations_fail_even_when_expected_values_match() {
    for owner_epoch in [true, false] {
        let mut f = Fixture::new();
        if owner_epoch {
            f.claims.full11_owner_epoch = 0;
            f.claims.owner_epoch = 0;
            f.binding.owner_epoch = 0;
        } else {
            f.claims.full11_key_generation = 0;
            f.binding.key_generation = 0;
        }
        f.reject(&f.sign(&f.claims));
    }
}

#[test]
fn authenticated_subject_can_differ_from_the_delegated_actor() {
    let f = Fixture::new();
    let mut claims = f.claims.clone();
    claims.eligible_subject_user_id = claims.beneficiary_id.clone();
    assert_ne!(claims.eligible_subject_user_id, claims.actor_id);
    let proof = f
        .verifier
        .verify(&f.sign(&claims), &f.expected(), NOW)
        .unwrap();
    assert_eq!(
        proof.claims().eligible_subject_user_id,
        claims.beneficiary_id
    );
    // Actual delegation policy is Root's designated-primary decision. A
    // cryptographic validator must not replace it with actor==subject.
}

#[test]
fn root_adopted_source_eight_phase_public_synthetic_vectors_verify() {
    const RAW: &str = include_str!("fixtures/managed_import_v2/root-synthetic-vectors.json");
    assert_eq!(
        hex(&Sha256::digest(RAW)),
        "10b6889e62e7fd0b37c5c3726cd641ae2238ff5c18c50b17f6df8aa1ee693022"
    );
    let bundle: Value = serde_json::from_str(RAW).unwrap();
    assert_eq!(bundle["synthetic_only"], true);
    let vectors = bundle["vectors"].as_array().unwrap();
    assert_eq!(vectors.len(), 8);
    let now = (bundle["fixed_unix_seconds"].as_i64().unwrap() + 1) * 1000;
    let public_hex = bundle["public_ed25519_raw_hex"].as_str().unwrap();
    assert_eq!(public_hex.len(), 64);
    let public_key: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&public_hex[i..i + 2], 16).unwrap())
        .collect();
    let mut previous = None;
    let mut issued = None;
    let mut first_expiry = None;
    let mut previous_budget = 60_000;
    let mut nonces = std::collections::HashSet::new();
    let mut jtis = std::collections::HashSet::new();
    let original_deadline = Instant::now() + Duration::from_secs(60);
    let mut f = Fixture::new();
    for (sequence, vector) in vectors.iter().enumerate() {
        let claims_json = vector["claims_json"].as_str().unwrap();
        let claims: ImportProofClaims = serde_json::from_str(claims_json).unwrap();
        // Expected context here is fixed public fixture data. Production never
        // derives its expected context from an unverified received JWS.
        (f.context, f.binding) = expected_parts(&claims);
        f.claims = claims;
        let c = &f.claims;
        first_expiry.get_or_insert(c.exp);
        assert_eq!(usize::from(c.sequence), sequence);
        assert!(nonces.insert(c.nonce_hex.clone()));
        assert!(jtis.insert(c.jti.clone()));
        assert_eq!(c.issued_proof_sha256, issued);
        assert_eq!(c.preceding_proof_sha256, previous);
        let trust = json!({"version":1,"issuer":bundle["issuer"],"audience":bundle["audience"],
        "max_proof_lifetime_seconds":60,"keys":[{
            "kid":bundle["issuer_key_id"],"issuer_key_generation":bundle["issuer_key_generation"],
            "public_key_base64url":URL_SAFE_NO_PAD.encode(&public_key),
            "not_before_unix_seconds":c.iat-1,"not_after_unix_seconds":c.exp+1,"revoked":false
        }]});
        f.write_trust(trust);
        let mut e = f.expected();
        e.original_deadline = original_deadline;
        e.maximum_expiry_unix_seconds = first_expiry;
        e.maximum_remaining_deadline_budget_ms = previous_budget;
        let compact = vector["compact_jws"].as_str().unwrap();
        let proof = f.verifier.verify(compact, &e, now).unwrap();
        f.verifier.recheck(&proof, now).unwrap();
        assert_eq!(
            serde_json::to_vec(proof.claims()).unwrap(),
            claims_json.as_bytes()
        );
        let actual_digest = hex(proof.proof_sha256());
        assert_eq!(actual_digest, vector["proof_sha256"]);
        if issued.is_none() {
            issued = Some(actual_digest.clone());
        }
        previous = Some(actual_digest);
        previous_budget = c.remaining_deadline_budget_ms;
    }
}

#[test]
fn original_controller_check_is_learned_from_verified_issue_then_required() {
    let mut f = Fixture::new();
    let raw = f.sign(&f.claims);
    let mut e = f.expected();
    e.initial_imported_check_sha256 = None;
    let verified = f.verifier.verify(&raw, &e, NOW).unwrap();
    assert_eq!(
        verified.claims().initial_imported_check_sha256,
        f.claims.initial_imported_check_sha256
    );
    // An unavailable expected check never makes an unsigned frame acceptable.
    let mut parts: Vec<_> = raw.split('.').collect();
    let wrong_signature = URL_SAFE_NO_PAD.encode([0; 64]);
    parts[2] = &wrong_signature;
    assert!(f.verifier.verify(&parts.join("."), &e, NOW).is_err());
    f.claims.phase = ProtectedImportPhase::Consume;
    f.claims.sequence = 1;
    f.claims.proof_type = ImportProofKind::Consumed;
    f.claims.issued_proof_sha256 = Some(hex(verified.proof_sha256()));
    f.claims.preceding_proof_sha256 = f.claims.issued_proof_sha256.clone();
    f.claims.consumed_audit_id = Some(id(15));
    let mut e = f.expected();
    e.initial_imported_check_sha256 = None;
    assert!(f.verifier.verify(&f.sign(&f.claims), &e, NOW).is_err());
}

#[cfg(unix)]
#[test]
fn public_trust_rejects_symlink_nonregular_writable_and_oversized_files() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let f = Fixture::new();
    let raw = f.sign(&f.claims);
    let real = f.directory.join("real.json");
    std::fs::rename(&f.verifier.trust_file, &real).unwrap();
    symlink(&real, &f.verifier.trust_file).unwrap();
    f.reject(&raw);
    std::fs::remove_file(&f.verifier.trust_file).unwrap();
    std::fs::create_dir(&f.verifier.trust_file).unwrap();
    f.reject(&raw);
    std::fs::remove_dir(&f.verifier.trust_file).unwrap();
    f.write_trust(f.trust());
    std::fs::set_permissions(
        &f.verifier.trust_file,
        std::fs::Permissions::from_mode(0o666),
    )
    .unwrap();
    f.reject(&raw);
    std::fs::set_permissions(
        &f.verifier.trust_file,
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    std::fs::write(&f.verifier.trust_file, vec![b' '; 65537]).unwrap();
    f.reject(&raw);
}
