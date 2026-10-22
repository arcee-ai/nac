//! Synthetic operator files exercise policy ownership, never runtime grants.
use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

fn document() -> Value {
    let source = "a".repeat(40);
    let scope = json!({"endpoints":2,"live_jobs":2,"native_payload_bytes":10354752,
        "captured_results":2,"captured_bytes":4194304});
    json!({
        "version":1,"environment":"dev3",
        "policy_id":"22222222-2222-4222-8222-222222222222","revision":1,
        "scope":{
            "cluster_namespace_uid":"fixture-cluster-uid","namespace":"dev3-capacity-fixture",
            "namespace_uid":"fixture-namespace-uid",
            "managed_host_id":"11111111-1111-4111-8111-111111111111",
            "host_incarnation_id":"fixture-incarnation-uid","source_revision":source,
            "product_version":"0.1.4","release_id":format!("dev-{source}"),
            "build_id":format!("dev-{source}"),"supported_schema_version":36,"minimum_schema_version":0
        },
        "layout":"single_owner_shared_session_pair","max_sessions":1,
        "host":scope,"session":scope,
        "native_endpoint":{"live_jobs":1,"wire_records":2,"flow_window":16384,
            "owned_input_bytes":2097152,"capture_bytes":2097152}
    })
}
struct Fixture {
    dir: PathBuf,
    path: PathBuf,
    pins: PolicyPins,
    raw: Vec<u8>,
    cutoff: std::time::Instant,
}
impl Fixture {
    fn new(value: Value) -> Self {
        Self::bytes(serde_json::to_vec(&value).unwrap())
    }
    fn bytes(raw: Vec<u8>) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "nac-capacity-policy-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let path = dir.join("policy.json");
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        file.write_all(&raw).unwrap();
        file.set_permissions(fs::Permissions::from_mode(0o400))
            .unwrap();
        let baseline: Configuration = serde_json::from_value(document()).unwrap();
        let pins = PolicyPins {
            policy_id: baseline.policy_id,
            revision: 1,
            sha256: format!("{:x}", Sha256::digest(&raw)),
            scope: baseline.scope,
        };
        Self {
            dir,
            path,
            pins,
            raw,
            cutoff: tokio::time::Instant::now().into_std() + Duration::from_secs(3600),
        }
    }
    fn load(&self) -> anyhow::Result<PolicyOwner> {
        PolicySource::load_file(&self.path, &self.pins, self.cutoff)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.dir).unwrap();
    }
}

#[test]
fn original_source_retains_exact_values_pin_and_real_process_without_grant() {
    let f = Fixture::new(document());
    let source = f.load().unwrap();
    assert_eq!(source.sha256(), f.pins.sha256);
    assert_eq!(source.creator_process(), std::process::id());
    assert_eq!(source.configuration().unwrap().max_sessions, 1);
    assert_eq!(
        source.configuration().unwrap().host.native_payload_bytes,
        10354752
    );
    assert_eq!(
        source
            .configuration()
            .unwrap()
            .native_endpoint
            .capture_bytes,
        2097152
    );
}

#[test]
fn all_source_pins_must_match_independently_selected_startup_inputs() {
    let f = Fixture::new(document());
    for field in 0..5 {
        let mut pins = f.pins.clone();
        match field {
            0 => pins.sha256 = "f".repeat(64),
            1 => pins.revision = 2,
            2 => pins.scope.host_incarnation_id = "other-incarnation".into(),
            3 => pins.scope.namespace_uid = "other-namespace".into(),
            _ => pins.scope.source_revision = "b".repeat(40),
        }
        assert!(PolicySource::load_file(&f.path, &pins, f.cutoff).is_err());
    }
}

#[test]
fn closed_file_shape_refuses_unknown_missing_null_and_second_values() {
    let valid = document();
    for value in [
        {
            let mut v = valid.clone();
            v["unknown"] = json!(1);
            v
        },
        {
            let mut v = valid.clone();
            v["scope"]["unknown"] = json!(1);
            v
        },
        {
            let mut v = valid.clone();
            v.as_object_mut().unwrap().remove("max_sessions");
            v
        },
        {
            let mut v = valid.clone();
            v["max_sessions"] = Value::Null;
            v
        },
        {
            let mut v = valid.clone();
            v["scope"]["source_revision"] = Value::Null;
            v
        },
    ] {
        assert!(Fixture::new(value).load().is_err());
    }
    let mut raw = serde_json::to_vec(&valid).unwrap();
    raw.extend_from_slice(b" {}");
    assert!(Fixture::bytes(raw).load().is_err());
    let text = serde_json::to_string(&valid)
        .unwrap()
        .replace("\"version\":1", "\"version\":1,\"version\":1");
    assert!(Fixture::bytes(text.into_bytes()).load().is_err());
}

#[test]
fn policy_is_explicit_dev3_single_owner_scope_and_bounded_original_lifetime() {
    for field in 0..10 {
        let mut value = document();
        match field {
            0 => value["environment"] = json!("production"),
            1 => value["scope"]["namespace"] = json!("default"),
            2 => value["scope"]["cluster_namespace_uid"] = json!(""),
            3 => value["revision"] = json!(0),
            4 => value["max_sessions"] = json!(0),
            5 => value["max_sessions"] = json!(2),
            6 => value["session"]["native_payload_bytes"] = json!(10354753),
            7 => value["not_after_epoch_ms"] = json!(12345),
            8 => value["issued_at_epoch_ms"] = json!(12345),
            _ => value["scope"]["supported_schema_version"] = json!(u64::MAX),
        }
        assert!(Fixture::new(value).load().is_err(), "field {field}");
    }
}

#[test]
fn writable_symlink_directory_relative_and_oversize_sources_refuse() {
    let f = Fixture::new(document());
    fs::set_permissions(&f.path, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(f.load().is_err());
    fs::set_permissions(&f.path, fs::Permissions::from_mode(0o400)).unwrap();
    let link = f.dir.join("link");
    std::os::unix::fs::symlink(&f.path, &link).unwrap();
    assert!(PolicySource::load_file(&link, &f.pins, f.cutoff).is_err());
    assert!(PolicySource::load_file(&f.dir, &f.pins, f.cutoff).is_err());
    assert!(
        PolicySource::load_file(std::path::Path::new("policy.json"), &f.pins, f.cutoff).is_err()
    );
    assert!(Fixture::bytes(vec![b' '; 65537]).load().is_err());
}

#[tokio::test(start_paused = true)]
async fn expired_original_owner_and_min_only_tightening_never_start_a_new_budget() {
    let mut f = Fixture::new(document());
    f.cutoff = tokio::time::Instant::now().into_std() - Duration::from_secs(1);
    assert!(f.load().is_err());
    let f = Fixture::new(document());
    let source = f.load().unwrap();
    let short = tokio::time::Instant::now().into_std() + Duration::from_secs(2);
    source.tighten_cutoff(short);
    source.tighten_cutoff(short + Duration::from_secs(100));
    assert_eq!(source.cutoff(f.cutoff), short);
    tokio::time::advance(Duration::from_secs(3)).await;
    assert!(source.check_current().is_err());
}

#[tokio::test]
async fn explicit_retirement_is_sticky_and_quiet_wait_is_not_settlement() {
    let f = Fixture::new(document());
    let source = f.load().unwrap();
    let observed = source.source();
    let task = tokio::spawn(async move { observed.retired().await });
    tokio::task::yield_now().await;
    source.retirement().retire();
    task.await.unwrap();
    assert!(source.check_current().is_err());
    assert!(source.configuration().is_err());
    assert!(
        f.load().is_ok(),
        "fresh parsed source does not revive the original allocation"
    );
    assert!(source.check_current().is_err());
}

#[tokio::test(start_paused = true)]
async fn original_monotonic_expiry_cannot_be_extended_by_arc_or_longer_request() {
    let f = Fixture::new(document());
    let source = f.load().unwrap();
    let far = std::time::Instant::now() + Duration::from_secs(86400);
    let original = source.cutoff(far);
    let copy = source.source();
    assert_eq!(copy.cutoff(far + Duration::from_secs(86400)), original);
    tokio::time::advance(Duration::from_secs(3601)).await;
    copy.retired().await;
    assert!(source.check_current().is_err());
    assert_eq!(source.cutoff(far), original);
}

#[tokio::test(start_paused = true)]
async fn byte_identical_replacement_retires_original_quiet_source_without_reload() {
    let f = Fixture::new(document());
    let source = f.load().unwrap();
    let observed = source.source();
    let task = tokio::spawn(async move { observed.retired().await });
    tokio::task::yield_now().await;
    let replacement = f.dir.join("replacement");
    fs::write(&replacement, &f.raw).unwrap();
    fs::set_permissions(&replacement, fs::Permissions::from_mode(0o400)).unwrap();
    fs::rename(replacement, &f.path).unwrap();
    tokio::time::advance(Duration::from_secs(1)).await;
    task.await.unwrap();
    assert!(source.check_current().is_err());
}

#[tokio::test]
async fn dropping_unique_configuration_owner_denies_retained_views_and_quiet_wait() {
    let f = Fixture::new(document());
    let owner = f.load().unwrap();
    let source = owner.source();
    let observed = std::sync::Arc::clone(&source);
    let task = tokio::spawn(async move { observed.retired().await });
    tokio::task::yield_now().await;
    drop(owner);
    task.await.unwrap();
    assert!(source.check_current().is_err());
}

#[test]
fn bounded_denial_is_not_physical_policy_revalidation() {
    let f = Fixture::new(document());
    let owner = f.load().unwrap();
    let source = owner.source();
    std::fs::remove_file(&f.path).unwrap();
    source.check_denial().unwrap();
    assert!(source.check_current().is_err());
    assert!(source.check_denial().is_err());
}
