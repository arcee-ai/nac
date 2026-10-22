//! Real protected file/source and actual Native arithmetic, synthetic scope only.
use super::*;
use nac_capacity_policy::{Configuration, PolicyOwner, PolicyPins};
use sha2::{Digest, Sha256};
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

struct Source {
    owner: PolicyOwner,
    dir: PathBuf,
}
impl Source {
    fn new(adjust: impl FnOnce(&mut serde_json::Value)) -> Self {
        let raw_scope = serde_json::json!({"endpoints":2,"live_jobs":2,
            "native_payload_bytes":10354752,"captured_results":2,"captured_bytes":4194304});
        let revision = "a".repeat(40);
        let mut value = serde_json::json!({
            "version":1,"environment":"dev3",
            "policy_id":"22222222-2222-4222-8222-222222222222","revision":1,
            "scope":{"cluster_namespace_uid":"fixture-cluster","namespace":"dev3-fixture",
                "namespace_uid":"fixture-namespace","managed_host_id":"11111111-1111-4111-8111-111111111111",
                "host_incarnation_id":"fixture-incarnation","source_revision":revision,
                "product_version":"0.1.4","release_id":format!("dev-{revision}"),
                "build_id":format!("dev-{revision}"),"supported_schema_version":36,"minimum_schema_version":0},
            "layout":"single_owner_shared_session_pair","max_sessions":1,
            "host":raw_scope,"session":raw_scope,
            "native_endpoint":{"live_jobs":1,"wire_records":2,"flow_window":16384,
                "owned_input_bytes":2097152,"capture_bytes":2097152}
        });
        adjust(&mut value);
        let cfg: Configuration = serde_json::from_value(value.clone()).unwrap();
        let raw = serde_json::to_vec(&value).unwrap();
        let dir =
            std::env::temp_dir().join(format!("nac-native-capacity-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let path = dir.join("policy.json");
        fs::write(&path, &raw).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        let pins = PolicyPins {
            policy_id: cfg.policy_id,
            revision: cfg.revision,
            scope: cfg.scope,
            sha256: format!("{:x}", Sha256::digest(raw)),
        };
        let owner = PolicySource::load_file(
            &path,
            &pins,
            Instant::now() + std::time::Duration::from_secs(60),
        )
        .unwrap();
        Self { owner, dir }
    }
}
impl Drop for Source {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.dir).unwrap();
    }
}

#[test]
fn selected_explicit_plan_uses_exact_original_source_and_checked_native_declaration() {
    let source = Source::new(|_| {});
    let plan = ResourcePlan::from_policy(source.owner.source()).unwrap();
    assert_eq!(plan.declaration().accounted_payload_bytes().get(), 5177376);
    assert_eq!(plan.declaration().live_jobs().get(), 1);
    assert_eq!(plan.declaration().wire_records().get(), 2);
    assert!(Arc::ptr_eq(
        plan.policy_source.as_ref().unwrap(),
        &source.owner.source()
    ));
}

#[test]
fn undersized_pair_or_capture_and_unrepresentable_native_arithmetic_refuse() {
    for field in 0..5 {
        let source = Source::new(|v| match field {
            0 => v["session"]["live_jobs"] = serde_json::json!(1),
            1 => v["session"]["native_payload_bytes"] = serde_json::json!(10354751),
            2 => v["session"]["captured_results"] = serde_json::json!(0),
            3 => v["session"]["captured_bytes"] = serde_json::json!(2097151),
            _ => v["native_endpoint"]["flow_window"] = serde_json::json!(u64::MAX),
        });
        assert!(
            ResourcePlan::from_policy(source.owner.source()).is_err(),
            "field{field}"
        );
    }
}

#[test]
fn retired_policy_refuses_new_job_without_charging_native_pool() {
    let source = Source::new(|_| {});
    let plan = ResourcePlan::from_policy(source.owner.source()).unwrap();
    let pool = ResourcePool::new(plan, StorageCharge::Unaccounted).unwrap();
    source.owner.retirement().retire();
    assert!(pool.reserve(1, 1).is_err());
    assert_eq!(pool.used.lock().unwrap().jobs, 0);
}

#[test]
fn actual_core_hold_must_match_the_same_native_policy_declaration() {
    use nac_core::runtime::compartment_resource_fixtures::{FixtureHost, FixtureScopeLimits};
    let source = Source::new(|_| {});
    let plan = ResourcePlan::from_policy(source.owner.source()).unwrap();
    let declaration = plan.declaration();
    let limits = FixtureScopeLimits {
        endpoints: 2,
        live_jobs: 2,
        native_payload_bytes: 10354752,
        captured_results: 2,
        captured_bytes: 4194304,
    };
    let host = FixtureHost::new(limits, NonZeroUsize::new(1).unwrap());
    let session = host.session(limits).unwrap();
    let (_reservation, hold) = session.reserve_endpoint(declaration).unwrap();
    let mut mismatched = declaration;
    mismatched = CompartmentResourceDeclaration::from_raw_capacity(
        mismatched.live_jobs(),
        mismatched.wire_records(),
        mismatched.flow_window(),
        mismatched.owned_input_bytes() + 1,
        mismatched.capture_bytes(),
        mismatched.accounted_payload_bytes(),
    );
    assert!(StorageCharge::Accounted(hold.clone())
        .check(mismatched)
        .is_err());
    assert!(ResourcePool::new(plan, StorageCharge::Accounted(hold)).is_ok());
}

#[cfg(target_os = "linux")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn original_policy_retirement_stops_quiet_pair_and_releases_only_actual_joined_storage() {
    use crate::execution_supervision::actor::{
        client::NativeExecutionTransport,
        runner::NativeRunner,
        tests::{deadline, negotiated_channels},
    };
    use nac_core::runtime::compartment_resource_fixtures::{FixtureHost, FixtureScopeLimits};
    use nac_process::{NativePipe, NativePipeOwner};

    // Same-process capacity fixture, not a remote retained runner or factory.
    let source = Source::new(|_| {});
    let left = ResourcePlan::from_policy(source.owner.source()).unwrap();
    let right = ResourcePlan::from_policy(source.owner.source()).unwrap();
    let declaration = left.declaration();
    let limits = FixtureScopeLimits {
        endpoints: 2,
        live_jobs: 2,
        native_payload_bytes: 10354752,
        captured_results: 2,
        captured_bytes: 4194304,
    };
    let host = FixtureHost::new(limits, NonZeroUsize::new(1).unwrap());
    let session = host.session(limits).unwrap();
    let (client_admission, client_hold) = session.reserve_endpoint(declaration).unwrap();
    let (runner_admission, runner_hold) = session.reserve_endpoint(declaration).unwrap();
    let (a, b) = negotiated_channels().await;
    let (runner, runner_peer) = NativeRunner::from_negotiated(b, right, runner_hold).unwrap();
    let mut command = tokio::process::Command::new("/bin/sleep");
    command.arg("30");
    let NativePipe { process, .. } =
        NativePipe::spawn_with_closed_fds(command, deadline().into()).unwrap();
    let driver: Arc<NativePipeOwner> = Arc::new(process);
    let (client, client_peer) = NativeExecutionTransport::from_negotiated(
        a,
        Arc::<NativePipeOwner>::clone(&driver),
        left,
        client_hold,
    )
    .unwrap();
    client_peer.check_current().unwrap();
    runner_peer.check_current().unwrap();
    source.owner.retirement().retire();
    // No explicit close has run: the policy observer must deny both original
    // quiet peers itself, while their original budgets are still live.
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while client_peer.check_current().is_ok() || runner_peer.check_current().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let (client_join, runner_join) = tokio::join!(
        client_admission.close_and_reap(&client, deadline()),
        runner_admission.close_and_reap(&runner.cleanup, deadline()),
    );
    client_join.unwrap();
    runner_join.unwrap();
    assert!(
        session.probe_endpoint(declaration).is_err(),
        "joined objects still retain original storage"
    );
    drop(client_admission);
    drop(runner_admission);
    drop(client);
    drop(runner);
    drop(driver);
    drop(client_peer);
    drop(runner_peer);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while session.probe_endpoint(declaration).is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
