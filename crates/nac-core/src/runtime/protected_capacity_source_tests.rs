//! Synthetic operator files, not genuine lifecycle or runtime qualification.
use super::*;
use futures_util::FutureExt;
use nac_capacity_policy::{Configuration, PolicyPins};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    time::{Duration, Instant},
};

pub(in crate::runtime) struct Fixture {
    dir: PathBuf,
    path: PathBuf,
    raw: Vec<u8>,
    pins: PolicyPins,
    cutoff: Instant,
}
impl Fixture {
    pub(in crate::runtime) fn new() -> Self {
        let revision = "a".repeat(40);
        let limits = json!({"endpoints":2,"live_jobs":2,"native_payload_bytes":10354752,
            "captured_results":2,"captured_bytes":4194304});
        let document = json!({
            "version":1,"environment":"dev3",
            "policy_id":"22222222-2222-4222-8222-222222222222","revision":1,
            "scope":{
                "cluster_namespace_uid":"synthetic-cluster","namespace":"dev3-core-fixture",
                "namespace_uid":"synthetic-namespace",
                "managed_host_id":"11111111-1111-4111-8111-111111111111",
                "host_incarnation_id":"synthetic-incarnation","source_revision":revision,
                "product_version":"0.1.4","release_id":format!("dev-{revision}"),
                "build_id":format!("dev-{revision}"),"supported_schema_version":36,
                "minimum_schema_version":0
            },
            "layout":"single_owner_shared_session_pair","max_sessions":1,
            "host":limits,"session":limits,
            "native_endpoint":{"live_jobs":1,"wire_records":2,"flow_window":16384,
                "owned_input_bytes":2097152,"capture_bytes":2097152}
        });
        let raw = serde_json::to_vec(&document).unwrap();
        let configuration: Configuration = serde_json::from_slice(&raw).unwrap();
        let dir = std::env::temp_dir().join(format!("core-policy-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let path = dir.join("policy.json");
        Self::write(&path, &raw);
        Self {
            dir,
            path,
            pins: PolicyPins {
                policy_id: configuration.policy_id,
                revision: configuration.revision,
                sha256: format!("{:x}", Sha256::digest(&raw)),
                scope: configuration.scope,
            },
            raw,
            cutoff: Instant::now() + Duration::from_secs(3600),
        }
    }
    fn write(path: &std::path::Path, raw: &[u8]) {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .unwrap();
        file.write_all(raw).unwrap();
        file.set_permissions(fs::Permissions::from_mode(0o400))
            .unwrap();
    }
    pub(in crate::runtime) fn load(&self) -> PolicyOwner {
        PolicySource::load_file(&self.path, &self.pins, self.cutoff).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.dir).unwrap();
    }
}

#[test]
fn composition_retains_original_owner_and_exact_source_allocation() {
    let fixture = Fixture::new();
    let owner = fixture.load();
    let original = owner.source();
    let retained = RetainedCapacityInput::from_owner(owner).unwrap();
    assert!(Arc::ptr_eq(&original, &retained.source_view().unwrap()));
    assert_eq!(original.cutoff(fixture.cutoff), fixture.cutoff);
    let data = retained.data().unwrap();
    for limits in [&data.host, &data.session] {
        assert_eq!(limits.endpoints, 2);
        assert_eq!(limits.live_jobs, 2);
        assert_eq!(limits.native_payload_bytes, 10354752);
        assert_eq!(limits.captured_results, 2);
        assert_eq!(limits.captured_bytes, 4194304);
    }
    assert_eq!(data.max_sessions.get(), 1);
    drop(retained);
    assert!(original.check_current().is_err());
}

#[tokio::test]
async fn retirement_wakes_quiet_same_source_and_cached_data_refuses() {
    let fixture = Fixture::new();
    let retained = RetainedCapacityInput::from_owner(fixture.load()).unwrap();
    let source = retained.source_view().unwrap();
    let retirement = source.retirement();
    let waiting = source.retired();
    tokio::pin!(waiting);
    assert!(waiting.as_mut().now_or_never().is_none());
    retirement.retire();
    tokio::time::timeout(Duration::from_secs(1), waiting)
        .await
        .unwrap();
    assert!(retained.data().is_err());
    assert!(retained.source_view().is_err());
}

#[test]
fn identical_replacement_cannot_refresh_the_original_validated_data() {
    let fixture = Fixture::new();
    let retained = RetainedCapacityInput::from_owner(fixture.load()).unwrap();
    let original = fixture.dir.join("original.json");
    fs::rename(&fixture.path, &original).unwrap();
    Fixture::write(&fixture.path, &fixture.raw);
    assert!(retained.data().is_err());
    fs::remove_file(&fixture.path).unwrap();
    fs::rename(original, &fixture.path).unwrap();
    assert!(
        retained.data().is_err(),
        "restoring bytes cannot renew owner"
    );
}

#[test]
fn cutoff_tightening_cannot_extend_or_refresh_cached_data() {
    let fixture = Fixture::new();
    let retained = RetainedCapacityInput::from_owner(fixture.load()).unwrap();
    let source = retained.source_view().unwrap();
    let later = fixture.cutoff + Duration::from_secs(3600);
    source.tighten_cutoff(later);
    assert_eq!(source.cutoff(later), fixture.cutoff);
    source.tighten_cutoff(Instant::now());
    assert!(retained.data().is_err());
    assert!(retained.source_view().is_err());
}

fn pair_declaration() -> super::CompartmentResourceDeclaration {
    let one = std::num::NonZeroUsize::new(1).unwrap();
    super::CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, one)
}

#[test]
fn second_endpoint_refusal_rolls_back_first_and_original_session_slot() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    // The valid policy can hold one such allocation but cannot hold both.
    // This deliberately unaccepted declaration never reaches Native I/O.
    let one = std::num::NonZeroUsize::new(1).unwrap();
    let bytes =
        std::num::NonZeroUsize::new(capacity.data().unwrap().host.native_payload_bytes / 2 + 1)
            .unwrap();
    let declaration =
        super::CompartmentResourceDeclaration::from_raw_capacity(one, one, one, 0, 0, bytes);
    for _ in 0..2 {
        assert!(capacity.prepare_native_pair(declaration).is_err());
        let host = capacity.host.state.lock().unwrap();
        assert_eq!(host.sessions, 0);
        assert_eq!(host.used, super::super::Usage::default());
    }
}

#[test]
fn unstarted_pair_rolls_back_both_distinct_allocations_and_original_session() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let prepared = capacity.prepare_native_pair(pair_declaration()).unwrap();
    assert!(!Arc::ptr_eq(
        &prepared.client.reservation,
        &prepared.runner.reservation
    ));
    assert!(Arc::ptr_eq(
        &prepared.client.reservation.session,
        &prepared.runner.reservation.session
    ));
    assert_eq!(capacity.host.state.lock().unwrap().used.endpoints, 2);
    assert!(capacity.prepare_native_pair(pair_declaration()).is_err());
    drop(prepared);
    assert_eq!(
        capacity.host.state.lock().unwrap().used,
        super::super::Usage::default()
    );
    assert_eq!(capacity.host.state.lock().unwrap().sessions, 0);
    drop(capacity.prepare_native_pair(pair_declaration()).unwrap());
}

#[test]
fn joined_pair_still_requires_retirement_of_both_original_storage_holds() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let (admissions, [client, runner]) = capacity
        .prepare_native_pair(pair_declaration())
        .unwrap()
        .begin()
        .unwrap();
    let escaping_runner = runner.clone();
    admissions.joined();
    drop(admissions);
    drop(client);
    drop(runner);
    assert_eq!(capacity.host.state.lock().unwrap().used.endpoints, 1);
    assert!(capacity.prepare_native_pair(pair_declaration()).is_err());
    drop(escaping_runner);
    drop(capacity.prepare_native_pair(pair_declaration()).unwrap());
}

#[test]
fn unknown_pair_retains_policy_owner_until_final_allocation_then_parks_charges() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let source = capacity.source_view().unwrap();
    let host = Arc::clone(&capacity.host);
    let (admissions, storage) = capacity
        .prepare_native_pair(pair_declaration())
        .unwrap()
        .begin()
        .unwrap();
    drop(capacity);
    assert!(
        source.check_current().is_ok(),
        "the pair retains the SAME original policy owner"
    );
    drop(storage);
    drop(admissions);
    assert!(source.check_current().is_err());
    assert_eq!(host.state.lock().unwrap().used.endpoints, 2);
    assert_eq!(host.state.lock().unwrap().sessions, 1);
}

#[test]
fn retirement_before_begin_preserves_known_no_start_rollback() {
    let fixture = Fixture::new();
    let capacity = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
    let prepared = capacity.prepare_native_pair(pair_declaration()).unwrap();
    capacity.source.retirement().retire();
    assert!(prepared.begin().is_err());
    let host = capacity.host.state.lock().unwrap();
    assert_eq!(host.used, super::super::Usage::default());
    assert_eq!(host.sessions, 0);
}

#[test]
fn pair_rejects_duplicated_endpoint_foreign_session_and_foreign_policy_host() {
    for mismatch in 0..3 {
        let fixture = Fixture::new();
        let original = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
        let other = Arc::new(RetainedCapacityInput::from_owner(fixture.load()).unwrap());
        let first = original
            .host
            .session(original.data().unwrap().session)
            .unwrap();
        let (client, client_storage) = first.reserve_endpoint(pair_declaration()).unwrap().begin();
        let (runner, runner_storage) = match mismatch {
            0 => (
                super::super::BoundaryAdmission(Arc::clone(&client.0)),
                client_storage.clone(),
            ),
            1 => other
                .host
                .session(other.data().unwrap().session)
                .unwrap()
                .reserve_endpoint(pair_declaration())
                .unwrap()
                .begin(),
            _ => first.reserve_endpoint(pair_declaration()).unwrap().begin(),
        };
        let owner = if mismatch == 2 { other } else { original };
        assert!(BoundaryAdmissions::paired(client, runner, owner).is_err());
        drop((client_storage, runner_storage));
    }
}
