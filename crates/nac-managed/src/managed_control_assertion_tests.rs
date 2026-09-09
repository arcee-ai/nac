use super::*;
use ring::signature::Ed25519KeyPair;

const NOW: i64 = 1_800_000_000;
const SEED_HEX: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUBLIC_HEX: &str = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

fn hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

fn request() -> ManagedControlRequest {
    ManagedControlRequest {
        managed_host_id: "host-123".to_string(),
        host_incarnation_id: "incarnation-456".to_string(),
        operation_id: "operation-789".to_string(),
        target: ManagedControlTarget {
            release_id: "beta-42".to_string(),
            source_sha: "a".repeat(40),
            product_version: "0.2.0-beta.42".to_string(),
            schema_version: 25,
            minimum_schema_version: 0,
        },
        actor: "user:owner".to_string(),
        beneficiary: "tenant:owner".to_string(),
    }
}

fn claims(action: &str) -> serde_json::Value {
    let request = request();
    serde_json::json!({
        "iss": "https://nac-api.example.test",
        "aud": "urn:nac:managed-control:host-123:incarnation-456",
        "jti": "jti-123",
        "action": action,
        "managed_host_id": request.managed_host_id,
        "host_incarnation_id": request.host_incarnation_id,
        "operation_id": request.operation_id,
        "target": request.target,
        "actor": request.actor,
        "beneficiary": request.beneficiary,
        "iat": NOW,
        "nbf": NOW,
        "exp": NOW + 60
    })
}

fn header() -> serde_json::Value {
    serde_json::json!({
        "alg": "EdDSA",
        "kid": "test-key",
        "typ": "nac-managed-operation+jwt",
        "v": 1
    })
}

fn jwks(kid: &str, public: &[u8]) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "keys": [{
            "kty": "OKP", "crv": "Ed25519", "use": "sig", "alg": "EdDSA",
            "kid": kid, "x": URL_SAFE_NO_PAD.encode(public)
        }]
    }))
    .unwrap()
}

fn sign(header: &serde_json::Value, claims: &serde_json::Value) -> String {
    sign_raw(
        &serde_json::to_vec(header).unwrap(),
        &serde_json::to_vec(claims).unwrap(),
    )
}

fn sign_raw(header: &[u8], claims: &[u8]) -> String {
    let seed = hex(SEED_HEX);
    let public = hex(PUBLIC_HEX);
    let key = Ed25519KeyPair::from_seed_and_public_key(&seed, &public).unwrap();
    let protected = URL_SAFE_NO_PAD.encode(header);
    let payload = URL_SAFE_NO_PAD.encode(claims);
    let signing_input = format!("{protected}.{payload}");
    let signature = key.sign(signing_input.as_bytes());
    format!(
        "{signing_input}.{}",
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    )
}

struct Fixture {
    root: PathBuf,
    jwks: PathBuf,
    verifier: ManagedControlVerifier,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-managed-jws-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).unwrap();
        let key_mount = root.join("control-keys");
        std::fs::create_dir(&key_mount).unwrap();
        let jwks = key_mount.join("jwks.json");
        std::fs::write(
            &jwks,
            serde_json::to_vec(&serde_json::json!({
                "keys": [{
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "use": "sig",
                    "alg": "EdDSA",
                    "kid": "test-key",
                    "x": URL_SAFE_NO_PAD.encode(hex(PUBLIC_HEX))
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&jwks, std::fs::Permissions::from_mode(0o444)).unwrap();
            std::fs::set_permissions(&key_mount, std::fs::Permissions::from_mode(0o555)).unwrap();
        }
        let verifier = ManagedControlVerifier::new(
            &jwks,
            "https://nac-api.example.test",
            "host-123",
            "incarnation-456",
        );
        Self {
            root,
            jwks,
            verifier,
        }
    }

    #[cfg(unix)]
    fn replace_jwks(&self, raw: &[u8]) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            self.jwks.parent().unwrap(),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        std::fs::set_permissions(&self.jwks, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::write(&self.jwks, raw).unwrap();
        std::fs::set_permissions(&self.jwks, std::fs::Permissions::from_mode(0o444)).unwrap();
        std::fs::set_permissions(
            self.jwks.parent().unwrap(),
            std::fs::Permissions::from_mode(0o555),
        )
        .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(parent) = self.jwks.parent() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o755));
            let _ = std::fs::set_permissions(&self.jwks, std::fs::Permissions::from_mode(0o644));
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn fixed_go_rust_vector_verifies() {
    let fixture = Fixture::new();
    let compact = sign(&header(), &claims("prepare"));
    let golden: serde_json::Value =
        serde_json::from_str(include_str!("../testdata/managed-control-ed25519-v1.json")).unwrap();
    assert_eq!(golden["compact_jws"], compact);
    let validated = fixture
        .verifier
        .verify(
            &compact,
            ManagedControlAction::Prepare,
            &request(),
            NOW + 30,
        )
        .unwrap();
    assert_eq!(validated.jti, "jti-123");
    assert_eq!(validated.request, request());
}

#[test]
fn every_request_binding_substitution_is_rejected() {
    let fixture = Fixture::new();
    let base = claims("prepare");
    let substitutions = [
        ("managed_host_id", serde_json::json!("host-other")),
        (
            "host_incarnation_id",
            serde_json::json!("incarnation-stale"),
        ),
        ("operation_id", serde_json::json!("operation-other")),
        ("actor", serde_json::json!("user:attacker")),
        ("beneficiary", serde_json::json!("tenant:other")),
    ];
    for (field, value) in substitutions {
        let mut changed = base.clone();
        changed[field] = value;
        assert_eq!(
            fixture.verifier.verify(
                &sign(&header(), &changed),
                ManagedControlAction::Prepare,
                &request(),
                NOW + 1
            ),
            Err(ManagedControlAssertionError::BindingMismatch),
            "{field}"
        );
    }
    for field in [
        "release_id",
        "source_sha",
        "product_version",
        "schema_version",
        "minimum_schema_version",
    ] {
        let mut changed = base.clone();
        changed["target"][field] = match field {
            "schema_version" => serde_json::json!(26),
            "minimum_schema_version" => serde_json::json!(1),
            "source_sha" => serde_json::json!("b".repeat(40)),
            _ => serde_json::json!(format!("changed-{field}")),
        };
        assert_eq!(
            fixture.verifier.verify(
                &sign(&header(), &changed),
                ManagedControlAction::Prepare,
                &request(),
                NOW + 1
            ),
            Err(ManagedControlAssertionError::BindingMismatch),
            "target.{field}"
        );
    }
}

#[test]
fn issuer_audience_action_and_stale_incarnation_fail_closed() {
    let fixture = Fixture::new();
    for (field, value) in [
        ("iss", "https://wrong.example.test"),
        ("aud", "urn:nac:managed-control:host-123:stale"),
        ("host_incarnation_id", "stale"),
    ] {
        let mut changed = claims("prepare");
        changed[field] = serde_json::json!(value);
        assert_eq!(
            fixture.verifier.verify(
                &sign(&header(), &changed),
                ManagedControlAction::Prepare,
                &request(),
                NOW
            ),
            Err(ManagedControlAssertionError::BindingMismatch)
        );
    }
    assert_eq!(
        fixture.verifier.verify(
            &sign(&header(), &claims("status")),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::BindingMismatch)
    );
}

#[test]
fn header_key_rotation_and_signature_are_strict() {
    let fixture = Fixture::new();
    for (field, value) in [
        ("alg", serde_json::json!("none")),
        ("typ", serde_json::json!("JWT")),
        ("v", serde_json::json!(2)),
    ] {
        let mut changed = header();
        changed[field] = value;
        assert_eq!(
            fixture.verifier.verify(
                &sign(&changed, &claims("prepare")),
                ManagedControlAction::Prepare,
                &request(),
                NOW
            ),
            Err(ManagedControlAssertionError::UnsupportedHeader)
        );
    }
    let mut unknown = header();
    unknown["kid"] = serde_json::json!("rotated-away");
    assert_eq!(
        fixture.verifier.verify(
            &sign(&unknown, &claims("prepare")),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::UnknownKey)
    );

    let compact = sign(&header(), &claims("prepare"));
    let mut bytes = compact.into_bytes();
    let last = bytes.len() - 1;
    bytes[last] = if bytes[last] == b'A' { b'B' } else { b'A' };
    assert_eq!(
        fixture.verifier.verify(
            std::str::from_utf8(&bytes).unwrap(),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::InvalidSignature)
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            fixture.jwks.parent().unwrap(),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        std::fs::set_permissions(&fixture.jwks, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    std::fs::write(
        &fixture.jwks,
        serde_json::to_vec(&serde_json::json!({
            "keys": [{
                "kty": "OKP", "crv": "Ed25519", "use": "sig", "alg": "EdDSA",
                "kid": "new-key", "x": URL_SAFE_NO_PAD.encode(hex(PUBLIC_HEX))
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fixture.jwks, std::fs::Permissions::from_mode(0o444)).unwrap();
        std::fs::set_permissions(
            fixture.jwks.parent().unwrap(),
            std::fs::Permissions::from_mode(0o555),
        )
        .unwrap();
    }
    assert_eq!(
        fixture.verifier.verify(
            &sign(&header(), &claims("prepare")),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::UnknownKey)
    );
}

#[cfg(unix)]
#[test]
fn same_kid_wrong_key_and_noncanonical_key_sets_fail_closed() {
    let fixture = Fixture::new();
    let compact = sign(&header(), &claims("prepare"));
    fixture.replace_jwks(&jwks("test-key", &[0; 32]));
    assert_eq!(
        fixture
            .verifier
            .verify(&compact, ManagedControlAction::Prepare, &request(), NOW),
        Err(ManagedControlAssertionError::InvalidSignature)
    );

    let duplicate = format!(
        "{{\"keys\":[{{\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"use\":\"sig\",\"alg\":\"EdDSA\",\"kid\":\"test-key\",\"x\":\"{}\",\"x\":\"{}\"}}]}}",
        URL_SAFE_NO_PAD.encode(hex(PUBLIC_HEX)),
        URL_SAFE_NO_PAD.encode(hex(PUBLIC_HEX))
    );
    fixture.replace_jwks(duplicate.as_bytes());
    assert_eq!(
        fixture
            .verifier
            .verify(&compact, ManagedControlAction::Prepare, &request(), NOW),
        Err(ManagedControlAssertionError::KeySetUnavailable)
    );
    let mut unknown =
        serde_json::from_slice::<serde_json::Value>(&jwks("test-key", &hex(PUBLIC_HEX))).unwrap();
    unknown["keys"][0]["private"] = serde_json::json!("must-not-be-accepted");
    fixture.replace_jwks(&serde_json::to_vec(&unknown).unwrap());
    assert_eq!(
        fixture
            .verifier
            .verify(&compact, ManagedControlAction::Prepare, &request(), NOW),
        Err(ManagedControlAssertionError::KeySetUnavailable)
    );
}

#[cfg(unix)]
#[test]
fn jwks_requires_nonwritable_files_and_mounts_and_rejects_arbitrary_symlinks() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let fixture = Fixture::new();
    let compact = sign(&header(), &claims("prepare"));
    std::fs::set_permissions(&fixture.jwks, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        fixture
            .verifier
            .verify(&compact, ManagedControlAction::Prepare, &request(), NOW),
        Err(ManagedControlAssertionError::KeySetUnavailable)
    );
    std::fs::set_permissions(&fixture.jwks, std::fs::Permissions::from_mode(0o444)).unwrap();
    std::fs::set_permissions(
        fixture.jwks.parent().unwrap(),
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    assert_eq!(
        fixture
            .verifier
            .verify(&compact, ManagedControlAction::Prepare, &request(), NOW),
        Err(ManagedControlAssertionError::KeySetUnavailable)
    );

    let arbitrary = fixture.root.join("arbitrary-link.json");
    symlink(&fixture.jwks, &arbitrary).unwrap();
    let verifier = ManagedControlVerifier::new(
        arbitrary,
        "https://nac-api.example.test",
        "host-123",
        "incarnation-456",
    );
    assert_eq!(
        verifier.verify(&compact, ManagedControlAction::Prepare, &request(), NOW),
        Err(ManagedControlAssertionError::KeySetUnavailable)
    );
}

#[cfg(unix)]
#[test]
fn kubernetes_projected_jwks_symlink_rotates_between_immutable_versions() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let root = std::env::temp_dir().join(format!("nac-jwks-projection-{}", uuid::Uuid::new_v4()));
    let mount = root.join("keys");
    let first = mount.join("..2026_a");
    let second = mount.join("..2026_b");
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&second).unwrap();
    std::fs::write(first.join("jwks.json"), jwks("test-key", &hex(PUBLIC_HEX))).unwrap();
    std::fs::write(
        second.join("jwks.json"),
        jwks("rotated-key", &hex(PUBLIC_HEX)),
    )
    .unwrap();
    for path in [first.join("jwks.json"), second.join("jwks.json")] {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o444)).unwrap();
    }
    for path in [&first, &second] {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o555)).unwrap();
    }
    symlink("..2026_a", mount.join("..data")).unwrap();
    symlink("..data/jwks.json", mount.join("jwks.json")).unwrap();
    std::fs::set_permissions(&mount, std::fs::Permissions::from_mode(0o555)).unwrap();
    let verifier = ManagedControlVerifier::new(
        mount.join("jwks.json"),
        "https://nac-api.example.test",
        "host-123",
        "incarnation-456",
    );
    verifier
        .verify(
            &sign(&header(), &claims("prepare")),
            ManagedControlAction::Prepare,
            &request(),
            NOW,
        )
        .unwrap();

    std::fs::set_permissions(&mount, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::remove_file(mount.join("..data")).unwrap();
    symlink("..2026_b", mount.join("..data")).unwrap();
    std::fs::set_permissions(&mount, std::fs::Permissions::from_mode(0o555)).unwrap();
    let mut rotated_header = header();
    rotated_header["kid"] = serde_json::json!("rotated-key");
    verifier
        .verify(
            &sign(&rotated_header, &claims("prepare")),
            ManagedControlAction::Prepare,
            &request(),
            NOW,
        )
        .unwrap();

    std::fs::set_permissions(&mount, std::fs::Permissions::from_mode(0o755)).unwrap();
    for path in [&first, &second] {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn time_bounds_malformed_unknown_duplicate_and_oversized_inputs_are_rejected() {
    let fixture = Fixture::new();
    assert!(fixture
        .verifier
        .verify(
            &sign(&header(), &claims("prepare")),
            ManagedControlAction::Prepare,
            &request(),
            NOW + 65
        )
        .is_ok());
    for (field, value) in [
        ("exp", NOW - 10),
        ("nbf", NOW + 10),
        ("iat", NOW + 10),
        ("exp", NOW + 61),
        ("iat", i64::MIN),
        ("exp", i64::MAX),
        ("nbf", i64::MAX),
    ] {
        let mut changed = claims("prepare");
        changed[field] = serde_json::json!(value);
        assert_eq!(
            fixture.verifier.verify(
                &sign(&header(), &changed),
                ManagedControlAction::Prepare,
                &request(),
                NOW
            ),
            Err(ManagedControlAssertionError::InvalidTime),
            "{field}={value}"
        );
    }

    let mut unknown = claims("prepare");
    unknown["unexpected"] = serde_json::json!(true);
    assert_eq!(
        fixture.verifier.verify(
            &sign(&header(), &unknown),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::Malformed)
    );
    let duplicate_header =
        br#"{"alg":"EdDSA","alg":"EdDSA","kid":"test-key","typ":"nac-managed-operation+jwt","v":1}"#;
    assert_eq!(
        fixture.verifier.verify(
            &sign_raw(
                duplicate_header,
                &serde_json::to_vec(&claims("prepare")).unwrap()
            ),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::Malformed)
    );
    for malformed in ["", "one.two", "one.two.three.four", "=.eA.eA"] {
        assert!(fixture
            .verifier
            .verify(malformed, ManagedControlAction::Prepare, &request(), NOW)
            .is_err());
    }
    assert_eq!(
        fixture.verifier.verify(
            &"x".repeat(MAX_ASSERTION_BYTES + 1),
            ManagedControlAction::Prepare,
            &request(),
            NOW
        ),
        Err(ManagedControlAssertionError::Oversized)
    );
}
