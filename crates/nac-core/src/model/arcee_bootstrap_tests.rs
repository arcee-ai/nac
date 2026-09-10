use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};

use serde_json::{json, Value};

use super::*;
use crate::model::arcee::{
    begin_managed_arcee_device_login_with_service, request_token_refresh, stored_auth_from_refresh,
    ArceeAuthService, ManagedArceeRepairBinding, RefreshOutcome, ARCEE_AUTH_DEV2_ISSUER,
    LEGACY_CLIENT_ID,
};
use crate::model::arcee_repair::{
    complete_managed_arcee_repair_with_paths, prepare_managed_arcee_repair_with_paths,
    AuthorizationPaths,
};
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "nac-arcee-bootstrap-{label}-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn paths(&self) -> OwnedPaths {
        OwnedPaths {
            input: self.0.join("bootstrap.json"),
            auth: self.0.join("arcee_auth.json"),
            receipt: self.0.join("arcee_managed_bootstrap_receipt.json"),
            repair: self.0.join("arcee_managed_repair.json"),
            lock: self.0.join("arcee_auth.json.lock"),
        }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone)]
struct OwnedPaths {
    input: PathBuf,
    auth: PathBuf,
    receipt: PathBuf,
    repair: PathBuf,
    lock: PathBuf,
}

impl OwnedPaths {
    fn borrowed(&self) -> ImportPaths<'_> {
        ImportPaths {
            input: &self.input,
            auth: &self.auth,
            receipt: &self.receipt,
            repair: &self.repair,
            lock: &self.lock,
        }
    }

    fn authorization(&self) -> AuthorizationPaths<'_> {
        AuthorizationPaths {
            auth: &self.auth,
            receipt: &self.receipt,
            repair: &self.repair,
            lock: &self.lock,
        }
    }
}

const HOST_ID: &str = "21856443-8ed8-40ab-9036-72e837c99f27";
const BOOTSTRAP_ID: &str = "4712bc5e-30d5-421a-b416-8291d9f7d8f9";
const ACCESS_TOKEN: &str = "managed-access-canary";
const REFRESH_TOKEN: &str = "managed-refresh-canary";
const REPAIR_INTENT: &str = "managed-repair-intent-canary-0123456789";

fn bootstrap_value(bootstrap_id: &str) -> Value {
    json!({
        "version": 1,
        "bootstrap_id": bootstrap_id,
        "managed_host_id": HOST_ID,
        "client_id": "managed-nac",
        "access_token": ACCESS_TOKEN,
        "refresh_token": REFRESH_TOKEN,
        "access_token_expires_at": "2030-01-02T03:04:05.678Z",
        "token_type": "bearer",
        "inference_base_url": "https://api.arcee.ai",
        "organization_id": "org-managed",
        "workspace": "managed-workspace"
    })
}

fn bootstrap_v2_value(bootstrap_id: &str, auth_issuer: &str) -> Value {
    let mut value = bootstrap_value(bootstrap_id);
    value["version"] = json!(2);
    value["auth_issuer"] = json!(auth_issuer);
    value["repair_intent"] = json!(REPAIR_INTENT);
    value
}

fn write_private(path: &Path, contents: impl AsRef<[u8]>) {
    fs::write(path, contents).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn write_bootstrap(paths: &OwnedPaths, bootstrap_id: &str) {
    write_private(
        &paths.input,
        serde_json::to_vec_pretty(&bootstrap_value(bootstrap_id)).unwrap(),
    );
}

fn write_repair_bootstrap(paths: &OwnedPaths, bootstrap_id: &str) {
    write_private(
        &paths.input,
        serde_json::to_vec_pretty(&bootstrap_v2_value(
            bootstrap_id,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        ))
        .unwrap(),
    );
}

fn import(paths: &OwnedPaths) -> Result<ManagedArceeBootstrapOutcome> {
    import_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        paths.borrowed(),
        || Ok(()),
    )
}

fn validate(paths: &OwnedPaths) -> Result<()> {
    validate_authorization_with_paths(
        HOST_ID,
        "https://api.arcee.ai",
        ARCEE_AUTH_PRODUCTION_ISSUER,
        paths.authorization(),
    )
}

fn read_auth(paths: &OwnedPaths) -> StoredArceeAuth {
    let raw = fs::read_to_string(&paths.auth).unwrap();
    parse_stored_auth(&raw, &paths.auth).unwrap().unwrap()
}

fn interactive_auth(base_url: &str, auth_issuer: &str) -> StoredArceeAuth {
    StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        access_token: "repair-access-canary".to_string(),
        refresh_token: "repair-refresh-canary".to_string(),
        token_type: "bearer".to_string(),
        expires_at_ms: u64::MAX,
        base_url: base_url.to_string(),
        organization_id: "org-repaired".to_string(),
        workspace_name: "workspace-repaired".to_string(),
        auth_issuer: auth_issuer.to_string(),
        client_id: LEGACY_CLIENT_ID.to_string(),
        managed_bootstrap: None,
    }
}

fn repair_binding(base_url: &str, auth_issuer: &str) -> ManagedArceeRepairBinding {
    ManagedArceeRepairBinding {
        managed_host_id: HOST_ID.to_string(),
        bootstrap_id: BOOTSTRAP_ID.to_string(),
        host_incarnation_id: "opaque-incarnation-canary".to_string(),
        auth_issuer: auth_issuer.to_string(),
        inference_base_url: base_url.to_string(),
    }
}

#[test]
fn first_import_is_durable_and_restart_does_not_need_the_mount() {
    let dir = TestDir::new("first-import");
    let paths = dir.paths();
    write_bootstrap(&paths, BOOTSTRAP_ID);

    assert_eq!(
        import(&paths).unwrap(),
        ManagedArceeBootstrapOutcome::Imported
    );
    let auth = read_auth(&paths);
    assert_eq!(auth.access_token, ACCESS_TOKEN);
    assert_eq!(auth.refresh_token, REFRESH_TOKEN);
    assert_eq!(auth.client_id, MANAGED_CLIENT_ID);
    assert_eq!(auth.auth_issuer, ARCEE_AUTH_PRODUCTION_ISSUER);
    assert_eq!(auth.expires_at_ms, 1_893_553_445_678);
    assert_eq!(
        auth.managed_bootstrap,
        Some(ManagedBootstrapProvenance {
            bootstrap_id: Uuid::parse_str(BOOTSTRAP_ID).unwrap(),
            managed_host_id: Uuid::parse_str(HOST_ID).unwrap(),
        })
    );

    let receipt = fs::read_to_string(&paths.receipt).unwrap();
    assert!(!receipt.contains(ACCESS_TOKEN));
    assert!(!receipt.contains(REFRESH_TOKEN));
    fs::remove_file(&paths.input).unwrap();
    assert_eq!(
        import(&paths).unwrap(),
        ManagedArceeBootstrapOutcome::AlreadyConsumed
    );
    validate(&paths).unwrap();
}

#[test]
fn receipt_prevents_reconciliation_or_a_new_generation_from_overwriting_rotation() {
    let dir = TestDir::new("rotation-preserved");
    let paths = dir.paths();
    write_bootstrap(&paths, BOOTSTRAP_ID);
    import(&paths).unwrap();

    let mut rotated = read_auth(&paths);
    rotated.access_token = "rotated-access-canary".to_string();
    rotated.refresh_token = "rotated-refresh-canary".to_string();
    write_stored_auth_to_path(&paths.auth, &rotated).unwrap();
    write_bootstrap(&paths, "27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa");

    assert_eq!(
        import(&paths).unwrap(),
        ManagedArceeBootstrapOutcome::AlreadyConsumed
    );
    let reopened = read_auth(&paths);
    assert_eq!(reopened.access_token, "rotated-access-canary");
    assert_eq!(reopened.refresh_token, "rotated-refresh-canary");
    validate(&paths).unwrap();
}

#[test]
fn managed_repair_requires_trusted_receipt_and_never_replaces_existing_auth() {
    let missing_dir = TestDir::new("repair-missing-receipt");
    let missing = missing_dir.paths();
    let error = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        missing.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("requires its durable bootstrap receipt"));

    let healthy_dir = TestDir::new("repair-preserve-healthy");
    let healthy = healthy_dir.paths();
    write_repair_bootstrap(&healthy, BOOTSTRAP_ID);
    import(&healthy).unwrap();
    let before = fs::read(&healthy.auth).unwrap();
    let error = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        healthy.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("will not replace an existing credential"));
    assert_eq!(fs::read(&healthy.auth).unwrap(), before);

    fs::remove_file(&healthy.auth).unwrap();
    let mut receipt: Value = serde_json::from_slice(&fs::read(&healthy.receipt).unwrap()).unwrap();
    receipt["managed_host_id"] = json!("27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa");
    write_private(&healthy.receipt, serde_json::to_vec(&receipt).unwrap());
    let error = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        healthy.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("different logical host"));
    assert!(!healthy.auth.exists());

    let v1_dir = TestDir::new("repair-v1-no-capability");
    let v1 = v1_dir.paths();
    write_bootstrap(&v1, BOOTSTRAP_ID);
    import(&v1).unwrap();
    fs::remove_file(&v1.auth).unwrap();
    let error = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        v1.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("repair capability is unavailable"));
    assert!(!error.contains(REPAIR_INTENT));
}

#[test]
fn managed_repair_completion_restores_identity_provenance_and_readiness() {
    let dir = TestDir::new("repair-complete");
    let paths = dir.paths();
    write_repair_bootstrap(&paths, BOOTSTRAP_ID);
    import(&paths).unwrap();
    fs::remove_file(&paths.auth).unwrap();

    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        paths.authorization(),
    )
    .unwrap();
    assert!(!format!("{context:?}").contains(REPAIR_INTENT));
    let repaired = complete_managed_arcee_repair_with_paths(
        &context,
        interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
        Some(repair_binding(
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        )),
        paths.authorization(),
    )
    .unwrap();

    assert_eq!(repaired.client_id, MANAGED_CLIENT_ID);
    assert_eq!(
        repaired.managed_bootstrap,
        Some(ManagedBootstrapProvenance {
            bootstrap_id: Uuid::parse_str(BOOTSTRAP_ID).unwrap(),
            managed_host_id: Uuid::parse_str(HOST_ID).unwrap(),
        })
    );
    assert_eq!(read_auth(&paths), repaired);
    validate(&paths).unwrap();
}

#[test]
fn managed_repair_requires_exact_server_binding_before_any_write() {
    for mutation in [
        "missing",
        "host",
        "bootstrap",
        "incarnation",
        "issuer",
        "inference",
    ] {
        let dir = TestDir::new(&format!("repair-binding-{mutation}"));
        let paths = dir.paths();
        write_repair_bootstrap(&paths, BOOTSTRAP_ID);
        import(&paths).unwrap();
        fs::remove_file(&paths.auth).unwrap();
        let context = prepare_managed_arcee_repair_with_paths(
            HOST_ID,
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
            paths.authorization(),
        )
        .unwrap();
        let mut binding =
            repair_binding(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER);
        match mutation {
            "host" => binding.managed_host_id = Uuid::new_v4().to_string(),
            "bootstrap" => binding.bootstrap_id = Uuid::new_v4().to_string(),
            "incarnation" => binding.host_incarnation_id = "  ".to_string(),
            "issuer" => binding.auth_issuer = ARCEE_AUTH_DEV2_ISSUER.to_string(),
            "inference" => binding.inference_base_url = ARCEE_AUTH_DEV2_ISSUER.to_string(),
            "missing" => {}
            _ => unreachable!(),
        }
        let binding = (mutation != "missing").then_some(binding);
        let error = complete_managed_arcee_repair_with_paths(
            &context,
            interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
            binding,
            paths.authorization(),
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("managed Arcee repair"),
            "{mutation}: {error}"
        );
        assert!(!error.contains(REPAIR_INTENT));
        assert!(!error.contains("repair-access-canary"));
        assert!(!error.contains("repair-refresh-canary"));
        assert!(!paths.auth.exists(), "{mutation} wrote credentials");
    }
}

#[tokio::test]
async fn managed_device_login_completes_with_managed_identity_and_provenance() {
    let dir = TestDir::new("repair-device-flow");
    let paths = dir.paths();
    write_repair_bootstrap(&paths, BOOTSTRAP_ID);
    import(&paths).unwrap();
    fs::remove_file(&paths.auth).unwrap();
    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        paths.authorization(),
    )
    .unwrap();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            json!({
                "device_code": "managed-device-code",
                "user_code": "MANAGED-CODE",
                "verification_uri_complete": "https://accounts.arcee.ai/device?code=MANAGED-CODE",
                "interval": 1,
                "expires_in": 60
            })
            .to_string(),
        ),
        ScriptedResponse::json(
            "200 OK",
            json!({
                "access_token": "repaired-access-canary",
                "refresh_token": "repaired-refresh-canary",
                "token_type": "bearer",
                "expires_in": 3600,
                "base_url": ARCEE_AUTH_PRODUCTION_ISSUER,
                "organization_id": "org-repaired",
                "workspace_name": "workspace-repaired",
                "managed_binding": {
                    "managed_host_id": HOST_ID,
                    "bootstrap_id": BOOTSTRAP_ID,
                    "host_incarnation_id": "opaque-incarnation-canary",
                    "auth_issuer": ARCEE_AUTH_PRODUCTION_ISSUER,
                    "inference_base_url": ARCEE_AUTH_PRODUCTION_ISSUER
                }
            })
            .to_string(),
        ),
    ]);

    let login = begin_managed_arcee_device_login_with_service(
        context,
        ArceeAuthService::for_test(&server.base_url),
    )
    .await
    .unwrap();
    let snapshot = login.complete().await.unwrap();
    assert!(snapshot.signed_in);
    validate(&paths).unwrap();

    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    for request in &requests {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        assert_eq!(body["client_id"], MANAGED_CLIENT_ID);
    }
    let request: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(request["managed_repair"]["repair_intent"], REPAIR_INTENT);
    let poll: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(poll.get("managed_repair").is_none());
    let repaired = read_auth(&paths);
    assert_eq!(repaired.client_id, MANAGED_CLIENT_ID);
    assert!(repaired.managed_bootstrap.is_some());
}

#[test]
fn managed_repair_completion_rechecks_receipt_and_empty_target() {
    let receipt_dir = TestDir::new("repair-recheck-receipt");
    let receipt_paths = receipt_dir.paths();
    write_repair_bootstrap(&receipt_paths, BOOTSTRAP_ID);
    import(&receipt_paths).unwrap();
    fs::remove_file(&receipt_paths.auth).unwrap();
    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        receipt_paths.authorization(),
    )
    .unwrap();
    fs::remove_file(&receipt_paths.receipt).unwrap();
    let error = complete_managed_arcee_repair_with_paths(
        &context,
        interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
        Some(repair_binding(
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        )),
        receipt_paths.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("requires its durable bootstrap receipt"));
    assert!(!receipt_paths.auth.exists());

    let changed_dir = TestDir::new("repair-changed-receipt");
    let changed = changed_dir.paths();
    write_repair_bootstrap(&changed, BOOTSTRAP_ID);
    import(&changed).unwrap();
    fs::remove_file(&changed.auth).unwrap();
    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        changed.authorization(),
    )
    .unwrap();
    let mut receipt: Value = serde_json::from_slice(&fs::read(&changed.receipt).unwrap()).unwrap();
    receipt["bootstrap_id"] = json!("27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa");
    write_private(&changed.receipt, serde_json::to_vec(&receipt).unwrap());
    let error = complete_managed_arcee_repair_with_paths(
        &context,
        interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
        Some(repair_binding(
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        )),
        changed.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("receipt changed"));
    assert!(!changed.auth.exists());

    let origin_dir = TestDir::new("repair-wrong-inference-origin");
    let origin = origin_dir.paths();
    write_repair_bootstrap(&origin, BOOTSTRAP_ID);
    import(&origin).unwrap();
    fs::remove_file(&origin.auth).unwrap();
    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        origin.authorization(),
    )
    .unwrap();
    let error = complete_managed_arcee_repair_with_paths(
        &context,
        interactive_auth(ARCEE_AUTH_DEV2_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
        Some(repair_binding(
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        )),
        origin.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("binding inference URL"));
    assert!(!error.contains("repair-access-canary"));
    assert!(!error.contains("repair-refresh-canary"));
    assert!(!origin.auth.exists());

    let raced_dir = TestDir::new("repair-raced-auth");
    let raced = raced_dir.paths();
    write_repair_bootstrap(&raced, BOOTSTRAP_ID);
    import(&raced).unwrap();
    fs::remove_file(&raced.auth).unwrap();
    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        raced.authorization(),
    )
    .unwrap();
    let mut conflicting =
        interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER);
    conflicting.access_token = "concurrent-access-canary".to_string();
    write_stored_auth_to_path(&raced.auth, &conflicting).unwrap();
    let before = fs::read(&raced.auth).unwrap();
    let error = complete_managed_arcee_repair_with_paths(
        &context,
        interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
        Some(repair_binding(
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        )),
        raced.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("will not replace an existing credential"));
    assert_eq!(fs::read(&raced.auth).unwrap(), before);

    let capability_dir = TestDir::new("repair-changed-capability");
    let capability = capability_dir.paths();
    write_repair_bootstrap(&capability, BOOTSTRAP_ID);
    import(&capability).unwrap();
    fs::remove_file(&capability.auth).unwrap();
    let context = prepare_managed_arcee_repair_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        capability.authorization(),
    )
    .unwrap();
    let replacement_intent = "replacement-repair-intent-secret-0123456789";
    write_private(
        &capability.repair,
        serde_json::json!({
            "version": 1,
            "bootstrap_id": BOOTSTRAP_ID,
            "managed_host_id": HOST_ID,
            "repair_intent": replacement_intent
        })
        .to_string(),
    );
    let error = complete_managed_arcee_repair_with_paths(
        &context,
        interactive_auth(ARCEE_AUTH_PRODUCTION_ISSUER, ARCEE_AUTH_PRODUCTION_ISSUER),
        Some(repair_binding(
            ARCEE_AUTH_PRODUCTION_ISSUER,
            ARCEE_AUTH_PRODUCTION_ISSUER,
        )),
        capability.authorization(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("capability changed"));
    assert!(!error.contains(REPAIR_INTENT));
    assert!(!error.contains(replacement_intent));
    assert!(!capability.auth.exists());
}

#[test]
fn retry_tombstones_the_durable_generation_not_a_reconciled_mount() {
    let dir = TestDir::new("receipt-recovery");
    let paths = dir.paths();
    write_repair_bootstrap(&paths, BOOTSTRAP_ID);

    let error = import_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        paths.borrowed(),
        || Err(anyhow!("deterministic post-credential failpoint")),
    )
    .unwrap_err();
    assert!(error.to_string().contains("deterministic"));
    assert!(paths.auth.exists());
    assert!(paths.repair.exists());
    assert!(!paths.receipt.exists());
    let before = fs::read(&paths.auth).unwrap();
    let replacement_bootstrap_id = "27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa";
    write_bootstrap(&paths, replacement_bootstrap_id);

    assert_eq!(
        import(&paths).unwrap(),
        ManagedArceeBootstrapOutcome::RecoveredReceipt
    );
    assert_eq!(fs::read(&paths.auth).unwrap(), before);
    let receipt: Value = serde_json::from_slice(&fs::read(&paths.receipt).unwrap()).unwrap();
    assert_eq!(receipt["bootstrap_id"], BOOTSTRAP_ID);
    assert_ne!(receipt["bootstrap_id"], replacement_bootstrap_id);
    assert_eq!(read_auth(&paths).access_token, ACCESS_TOKEN);
    assert!(fs::read_to_string(&paths.repair)
        .unwrap()
        .contains(REPAIR_INTENT));

    fs::remove_file(&paths.input).unwrap();
    assert_eq!(
        import(&paths).unwrap(),
        ManagedArceeBootstrapOutcome::AlreadyConsumed
    );
    validate(&paths).unwrap();
}

#[test]
fn receipt_recovery_preserves_and_rechecks_the_stored_dev2_issuer() {
    let matching_dir = TestDir::new("dev2-recovery-match");
    let matching_paths = matching_dir.paths();
    let value = bootstrap_v2_value(BOOTSTRAP_ID, ARCEE_AUTH_DEV2_ISSUER);
    write_private(&matching_paths.input, serde_json::to_vec(&value).unwrap());
    import_with_paths(
        HOST_ID,
        ARCEE_AUTH_DEV2_ISSUER,
        matching_paths.borrowed(),
        || Err(anyhow!("post-write dev2 failpoint")),
    )
    .unwrap_err();
    assert!(!matching_paths.receipt.exists());
    assert_eq!(
        import_with_paths(
            HOST_ID,
            ARCEE_AUTH_DEV2_ISSUER,
            matching_paths.borrowed(),
            || Ok(())
        )
        .unwrap(),
        ManagedArceeBootstrapOutcome::RecoveredReceipt
    );
    assert_eq!(
        read_auth(&matching_paths).auth_issuer,
        ARCEE_AUTH_DEV2_ISSUER
    );

    let mismatch_dir = TestDir::new("dev2-recovery-mismatch");
    let mismatch_paths = mismatch_dir.paths();
    write_private(&mismatch_paths.input, serde_json::to_vec(&value).unwrap());
    import_with_paths(
        HOST_ID,
        ARCEE_AUTH_DEV2_ISSUER,
        mismatch_paths.borrowed(),
        || Err(anyhow!("post-write dev2 failpoint")),
    )
    .unwrap_err();
    let error = import_with_paths(
        HOST_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
        mismatch_paths.borrowed(),
        || Ok(()),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("does not match managed configuration"));
    assert!(!mismatch_paths.receipt.exists());
}

#[test]
fn existing_valid_and_corrupt_credentials_are_preserved_and_tombstoned() {
    let valid_dir = TestDir::new("existing-valid");
    let valid_paths = valid_dir.paths();
    write_bootstrap(&valid_paths, BOOTSTRAP_ID);
    let legacy = json!({
        "type": AUTH_TYPE,
        "access_token": "legacy-access",
        "refresh_token": "legacy-refresh",
        "token_type": "bearer",
        "expires_at_ms": 1_900_000_000_000_u64,
        "base_url": "https://api.arcee.ai",
        "organization_id": "legacy-org",
        "workspace_name": "legacy-workspace"
    });
    write_private(&valid_paths.auth, serde_json::to_vec(&legacy).unwrap());
    let before = fs::read(&valid_paths.auth).unwrap();
    assert_eq!(
        import(&valid_paths).unwrap(),
        ManagedArceeBootstrapOutcome::ExistingCredentialPreserved
    );
    assert_eq!(fs::read(&valid_paths.auth).unwrap(), before);
    assert_eq!(read_auth(&valid_paths).client_id, LEGACY_CLIENT_ID);
    let error = validate(&valid_paths).unwrap_err().to_string();
    assert!(error.contains("did not import a usable managed credential"));
    assert!(!error.contains("legacy-access"));
    assert_eq!(fs::read(&valid_paths.auth).unwrap(), before);

    let corrupt_dir = TestDir::new("existing-corrupt");
    let corrupt_paths = corrupt_dir.paths();
    write_bootstrap(&corrupt_paths, BOOTSTRAP_ID);
    let corrupt = b"{\"refresh_token\":\"corrupt-secret-canary\"";
    write_private(&corrupt_paths.auth, corrupt);
    let outcome = import(&corrupt_paths).unwrap();
    assert_eq!(
        outcome,
        ManagedArceeBootstrapOutcome::InvalidCredentialPreserved
    );
    assert!(!format!("{outcome:?}").contains("corrupt-secret-canary"));
    assert_eq!(fs::read(&corrupt_paths.auth).unwrap(), corrupt);
    assert!(corrupt_paths.receipt.exists());
    let error = validate(&corrupt_paths).unwrap_err().to_string();
    assert!(error.contains("did not import a usable managed credential"));
    assert!(!error.contains("corrupt-secret-canary"));
    assert_eq!(fs::read(&corrupt_paths.auth).unwrap(), corrupt);
}

#[test]
fn bound_validation_rejects_every_receipt_and_provenance_mismatch() {
    let dir = TestDir::new("bound-validation");
    let paths = dir.paths();
    write_bootstrap(&paths, BOOTSTRAP_ID);
    import(&paths).unwrap();
    validate(&paths).unwrap();
    let original_auth = fs::read(&paths.auth).unwrap();
    let original_receipt = fs::read(&paths.receipt).unwrap();

    let assert_redacted = |error: anyhow::Error| {
        let error = error.to_string();
        assert!(!error.contains(ACCESS_TOKEN));
        assert!(!error.contains(REFRESH_TOKEN));
        error
    };

    write_private(&paths.receipt, b"{invalid-receipt-secret-canary");
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("receipt is invalid"));
    assert!(!error.contains("invalid-receipt-secret-canary"));

    let mut receipt: Value = serde_json::from_slice(&original_receipt).unwrap();
    receipt["version"] = json!(2);
    write_private(&paths.receipt, serde_json::to_vec(&receipt).unwrap());
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("receipt is invalid"));

    receipt = serde_json::from_slice(&original_receipt).unwrap();
    receipt["client_id"] = json!("nac-cli");
    write_private(&paths.receipt, serde_json::to_vec(&receipt).unwrap());
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("receipt is invalid"));

    receipt = serde_json::from_slice(&original_receipt).unwrap();
    receipt["managed_host_id"] = json!("1fcb247b-c246-4210-89b0-bb0655441163");
    write_private(&paths.receipt, serde_json::to_vec(&receipt).unwrap());
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("different logical host"));

    receipt = serde_json::from_slice(&original_receipt).unwrap();
    receipt["bootstrap_id"] = json!("27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa");
    write_private(&paths.receipt, serde_json::to_vec(&receipt).unwrap());
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("does not match its bootstrap receipt"));
    write_private(&paths.receipt, &original_receipt);

    let mut auth = read_auth(&paths);
    auth.client_id = LEGACY_CLIENT_ID.to_string();
    write_stored_auth_to_path(&paths.auth, &auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("not a managed-nac authorization"));

    auth = read_auth_from_bytes(&original_auth, &paths.auth);
    auth.managed_bootstrap = None;
    write_stored_auth_to_path(&paths.auth, &auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("no bootstrap provenance"));

    auth = read_auth_from_bytes(&original_auth, &paths.auth);
    auth.managed_bootstrap.as_mut().unwrap().managed_host_id =
        Uuid::parse_str("1fcb247b-c246-4210-89b0-bb0655441163").unwrap();
    write_stored_auth_to_path(&paths.auth, &auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("different logical host"));

    auth = read_auth_from_bytes(&original_auth, &paths.auth);
    auth.managed_bootstrap.as_mut().unwrap().bootstrap_id =
        Uuid::parse_str("27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa").unwrap();
    write_stored_auth_to_path(&paths.auth, &auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("does not match its bootstrap receipt"));

    auth = read_auth_from_bytes(&original_auth, &paths.auth);
    auth.token_type = "Bearer".to_string();
    write_stored_auth_to_path(&paths.auth, &auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("not structurally valid"));

    auth = read_auth_from_bytes(&original_auth, &paths.auth);
    auth.auth_issuer = ARCEE_AUTH_DEV2_ISSUER.to_string();
    write_stored_auth_to_path(&paths.auth, &auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("auth issuer does not match managed configuration"));

    write_private(&paths.auth, &original_auth);
    let error = assert_redacted(
        validate_authorization_with_paths(
            HOST_ID,
            "https://app.arcee.ai",
            ARCEE_AUTH_PRODUCTION_ISSUER,
            paths.authorization(),
        )
        .unwrap_err(),
    );
    assert!(error.contains("endpoint origin"));

    fs::remove_file(&paths.auth).unwrap();
    let error = assert_redacted(validate(&paths).unwrap_err());
    assert!(error.contains("not configured"));
}

fn read_auth_from_bytes(raw: &[u8], path: &Path) -> StoredArceeAuth {
    parse_stored_auth(std::str::from_utf8(raw).unwrap(), path)
        .unwrap()
        .unwrap()
}

#[test]
fn strict_validation_rejects_unknown_fields_mismatch_and_secret_echo() {
    let dir = TestDir::new("strict-invalid");
    let paths = dir.paths();
    let mut value = bootstrap_value(BOOTSTRAP_ID);
    value["host_incarnation_id"] = json!("079be3ba-a485-46d5-9ec6-7aa5edaa6645");
    write_private(&paths.input, serde_json::to_vec(&value).unwrap());
    let error = import(&paths).unwrap_err().to_string();
    assert!(error.contains("strict v1"));
    assert!(!error.contains(ACCESS_TOKEN));
    assert!(!error.contains(REFRESH_TOKEN));

    value = bootstrap_value(BOOTSTRAP_ID);
    value["managed_host_id"] = json!("1fcb247b-c246-4210-89b0-bb0655441163");
    write_private(&paths.input, serde_json::to_vec(&value).unwrap());
    let error = import(&paths).unwrap_err().to_string();
    assert!(error.contains("configured logical host"));
    assert!(!error.contains(ACCESS_TOKEN));
}

#[test]
fn strict_v2_persists_exact_prod_and_dev2_issuers_independently_of_inference() {
    for (label, auth_issuer, inference_base_url) in [
        (
            "prod-v2",
            ARCEE_AUTH_PRODUCTION_ISSUER,
            "https://api2.apps.dev.arcee.ai",
        ),
        (
            "dev2-v2",
            ARCEE_AUTH_DEV2_ISSUER,
            "https://tenant.arcee.ai/api/v1",
        ),
    ] {
        let dir = TestDir::new(label);
        let paths = dir.paths();
        let mut value = bootstrap_v2_value(BOOTSTRAP_ID, auth_issuer);
        value["inference_base_url"] = json!(inference_base_url);
        write_private(&paths.input, serde_json::to_vec(&value).unwrap());

        assert_eq!(
            import_with_paths(HOST_ID, auth_issuer, paths.borrowed(), || Ok(())).unwrap(),
            ManagedArceeBootstrapOutcome::Imported
        );
        let auth = read_auth(&paths);
        assert_eq!(auth.auth_issuer, auth_issuer);
        assert_eq!(auth.base_url, inference_base_url);
        validate_authorization_with_paths(
            HOST_ID,
            inference_base_url,
            auth_issuer,
            paths.authorization(),
        )
        .unwrap();
    }
}

#[test]
fn v1_always_means_production_and_cannot_be_reclassified_as_dev2() {
    let prod_dir = TestDir::new("v1-production-default");
    let prod_paths = prod_dir.paths();
    let mut value = bootstrap_value(BOOTSTRAP_ID);
    value["inference_base_url"] = json!(ARCEE_AUTH_DEV2_ISSUER);
    write_private(&prod_paths.input, serde_json::to_vec(&value).unwrap());
    import(&prod_paths).unwrap();
    let auth = read_auth(&prod_paths);
    assert_eq!(auth.auth_issuer, ARCEE_AUTH_PRODUCTION_ISSUER);
    assert_eq!(auth.base_url, ARCEE_AUTH_DEV2_ISSUER);

    let dev2_dir = TestDir::new("v1-dev2-reissue");
    let dev2_paths = dev2_dir.paths();
    write_bootstrap(&dev2_paths, BOOTSTRAP_ID);
    let error = import_with_paths(
        HOST_ID,
        ARCEE_AUTH_DEV2_ISSUER,
        dev2_paths.borrowed(),
        || Ok(()),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("does not match managed configuration"));
    assert!(!dev2_paths.auth.exists());
    assert!(!dev2_paths.receipt.exists());
}

#[test]
fn v2_auth_issuer_is_exact_double_bound_and_rejected_without_writes() {
    for (label, auth_issuer) in [
        ("http", "http://api.arcee.ai"),
        ("slash", "https://api.arcee.ai/"),
        ("port", "https://api.arcee.ai:443"),
        ("userinfo", "https://user@api.arcee.ai"),
        ("path", "https://api.arcee.ai/app/v1"),
        ("query", "https://api.arcee.ai?env=dev2"),
        ("fragment", "https://api.arcee.ai#dev2"),
        ("subdomain", "https://tenant.arcee.ai"),
        ("lookalike", "https://api.arcee.ai.attacker.example"),
    ] {
        let dir = TestDir::new(label);
        let paths = dir.paths();
        let value = bootstrap_v2_value(BOOTSTRAP_ID, auth_issuer);
        write_private(&paths.input, serde_json::to_vec(&value).unwrap());
        let error = import(&paths).unwrap_err().to_string();
        assert!(
            error.contains("auth_issuer is not approved"),
            "{auth_issuer}: {error}"
        );
        assert!(!error.contains(ACCESS_TOKEN));
        assert!(!error.contains(REFRESH_TOKEN));
        assert!(!paths.auth.exists());
        assert!(!paths.receipt.exists());
    }

    let mismatch_dir = TestDir::new("issuer-mismatch");
    let paths = mismatch_dir.paths();
    let value = bootstrap_v2_value(BOOTSTRAP_ID, ARCEE_AUTH_PRODUCTION_ISSUER);
    write_private(&paths.input, serde_json::to_vec(&value).unwrap());
    let error = import_with_paths(HOST_ID, ARCEE_AUTH_DEV2_ISSUER, paths.borrowed(), || Ok(()))
        .unwrap_err()
        .to_string();
    assert!(error.contains("does not match managed configuration"));
    assert!(!paths.auth.exists());
    assert!(!paths.receipt.exists());

    let missing_dir = TestDir::new("issuer-missing");
    let missing_paths = missing_dir.paths();
    let mut value = bootstrap_v2_value(BOOTSTRAP_ID, ARCEE_AUTH_PRODUCTION_ISSUER);
    value.as_object_mut().unwrap().remove("auth_issuer");
    write_private(&missing_paths.input, serde_json::to_vec(&value).unwrap());
    let error = import(&missing_paths).unwrap_err().to_string();
    assert!(error.contains("strict v2"));
    assert!(!missing_paths.auth.exists());
    assert!(!missing_paths.receipt.exists());
    assert!(!missing_paths.repair.exists());

    for (label, repair_intent, expected) in [
        ("repair-intent-missing", None, "strict v2"),
        ("repair-intent-short", Some("too-short"), "invalid length"),
    ] {
        let dir = TestDir::new(label);
        let paths = dir.paths();
        let mut value = bootstrap_v2_value(BOOTSTRAP_ID, ARCEE_AUTH_PRODUCTION_ISSUER);
        match repair_intent {
            Some(repair_intent) => value["repair_intent"] = json!(repair_intent),
            None => {
                value.as_object_mut().unwrap().remove("repair_intent");
            }
        }
        write_private(&paths.input, serde_json::to_vec(&value).unwrap());
        let error = import(&paths).unwrap_err().to_string();
        assert!(error.contains(expected), "{label}: {error}");
        assert!(!error.contains(ACCESS_TOKEN));
        assert!(!error.contains(REFRESH_TOKEN));
        assert!(!paths.auth.exists());
        assert!(!paths.receipt.exists());
        assert!(!paths.repair.exists());
    }

    let duplicate_dir = TestDir::new("issuer-duplicate");
    let duplicate_paths = duplicate_dir.paths();
    let raw = serde_json::to_string(&bootstrap_v2_value(
        BOOTSTRAP_ID,
        ARCEE_AUTH_PRODUCTION_ISSUER,
    ))
    .unwrap();
    let raw = raw.replacen(
        r#""auth_issuer":"https://api.arcee.ai""#,
        r#""auth_issuer":"https://api.arcee.ai","auth_issuer":"https://api2.apps.dev.arcee.ai""#,
        1,
    );
    write_private(&duplicate_paths.input, raw);
    let error = import(&duplicate_paths).unwrap_err().to_string();
    assert!(error.contains("strict v2"));
    assert!(!duplicate_paths.auth.exists());
    assert!(!duplicate_paths.receipt.exists());
}

#[cfg(unix)]
#[test]
fn bootstrap_input_must_be_a_regular_no_follow_file() {
    use std::os::unix::fs::symlink;

    let dir = TestDir::new("input-symlink");
    let paths = dir.paths();
    let target = dir.0.join("target.json");
    write_private(
        &target,
        serde_json::to_vec(&bootstrap_value(BOOTSTRAP_ID)).unwrap(),
    );
    symlink(&target, &paths.input).unwrap();
    let error = import(&paths).unwrap_err().to_string();
    assert!(error.contains("symlink credential path"));
    assert!(!paths.auth.exists());
}

#[test]
fn concurrent_importers_commit_one_credential_and_one_receipt() {
    let dir = TestDir::new("concurrent");
    let paths = dir.paths();
    write_bootstrap(&paths, BOOTSTRAP_ID);
    let barrier = Arc::new(Barrier::new(3));

    let handles = (0..2)
        .map(|_| {
            let paths = paths.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                import(&paths).unwrap()
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let mut outcomes = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    outcomes.sort_by_key(|outcome| match outcome {
        ManagedArceeBootstrapOutcome::Imported => 0,
        _ => 1,
    });
    assert_eq!(
        outcomes,
        vec![
            ManagedArceeBootstrapOutcome::Imported,
            ManagedArceeBootstrapOutcome::AlreadyConsumed
        ]
    );
    assert_eq!(read_auth(&paths).refresh_token, REFRESH_TOKEN);
}

#[tokio::test]
async fn managed_client_refresh_rotation_is_written_and_reopens_with_provenance() {
    let dir = TestDir::new("refresh-reopen");
    let paths = dir.paths();
    write_bootstrap(&paths, BOOTSTRAP_ID);
    import(&paths).unwrap();
    let current = read_auth(&paths);
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "access_token": "rotated-access",
            "refresh_token": "rotated-refresh",
            "token_type": "bearer",
            "expires_in": 3600
        })
        .to_string(),
    )]);

    let outcome = request_token_refresh(
        &super::super::arcee::no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
        &current.refresh_token,
        &current.client_id,
    )
    .await
    .unwrap();
    let refreshed = match outcome {
        RefreshOutcome::Success(refreshed) => refreshed,
        RefreshOutcome::Revoked => panic!("managed refresh unexpectedly revoked"),
    };
    let updated = stored_auth_from_refresh(current, refreshed);
    write_stored_auth_to_path(&paths.auth, &updated).unwrap();
    let requests = server.finish();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["client_id"], MANAGED_CLIENT_ID);

    let reopened = read_auth(&paths);
    assert_eq!(reopened.access_token, "rotated-access");
    assert_eq!(reopened.refresh_token, "rotated-refresh");
    assert_eq!(reopened.client_id, MANAGED_CLIENT_ID);
    assert_eq!(reopened.auth_issuer, ARCEE_AUTH_PRODUCTION_ISSUER);
    assert!(reopened.managed_bootstrap.is_some());
}

#[test]
fn utc_expiry_parser_is_strict_and_calendar_correct() {
    assert_eq!(parse_rfc3339_utc_millis("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(
        parse_rfc3339_utc_millis("2000-02-29T00:00:00.001234Z"),
        Some(951_782_400_001)
    );
    for invalid in [
        "1969-12-31T23:59:59Z",
        "2026-02-29T00:00:00Z",
        "2026-01-01T24:00:00Z",
        "2026-01-01T00:00:00+00:00",
        "2026-01-01t00:00:00z",
        "2026-01-01T00:00:00.Z",
    ] {
        assert_eq!(parse_rfc3339_utc_millis(invalid), None, "{invalid}");
    }
}
