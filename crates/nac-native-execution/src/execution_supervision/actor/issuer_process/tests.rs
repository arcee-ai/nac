//! Real child/cleanup and Core capacity-only fixtures, not runtime admission.
use super::*;
use nac_capacity_policy::{Configuration, PolicyOwner, PolicyPins, PolicySource};
use nac_core::runtime::compartment_resource_fixtures::{
    FixtureHost, FixtureReservation, FixtureScopeLimits, FixtureSession,
};
use sha2::{Digest, Sha256};
use std::{fs, num::NonZeroUsize, os::unix::fs::PermissionsExt, path::PathBuf, time::Duration};
use tokio::io::AsyncReadExt;

pub(super) struct Fixture {
    pub(super) _host: FixtureHost,
    pub(super) session: FixtureSession,
    pub(super) policy: PolicyOwner,
    pub(super) dir: PathBuf,
    pub(super) client: Option<FixtureReservation>,
    pub(super) runner: Option<FixtureReservation>,
    pub(super) client_hold: CompartmentStorageHold,
}
impl Fixture {
    pub(super) fn new() -> (Self, ResourcePlan, CompartmentStorageHold) {
        let revision = "a".repeat(40);
        let limits = serde_json::json!({"endpoints":2,"live_jobs":2,"native_payload_bytes":10354752,"captured_results":2,"captured_bytes":4194304});
        let raw = serde_json::to_vec(&serde_json::json!({"version":1,"environment":"dev3","policy_id":uuid::Uuid::new_v4(),"revision":1,
            "scope":{"cluster_namespace_uid":"fixture-cluster","namespace":"dev3-fixture","namespace_uid":"fixture-namespace",
            "managed_host_id":uuid::Uuid::new_v4(),"host_incarnation_id":"fixture-incarnation","source_revision":revision,"product_version":"0.1.4",
            "release_id":format!("dev-{revision}"),"build_id":format!("dev-{revision}"),"supported_schema_version":36,"minimum_schema_version":0},
            "layout":"single_owner_shared_session_pair","max_sessions":1,"host":limits,"session":limits,
            "native_endpoint":{"live_jobs":1,"wire_records":2,"flow_window":16384,"owned_input_bytes":2097152,"capture_bytes":2097152}})).unwrap();
        let cfg: Configuration = serde_json::from_slice(&raw).unwrap();
        let dir = std::env::temp_dir().join(format!("nac-issuer-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("policy.json");
        fs::write(&path, &raw).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        let pins = PolicyPins {
            policy_id: cfg.policy_id,
            revision: cfg.revision,
            scope: cfg.scope,
            sha256: format!("{:x}", Sha256::digest(raw)),
        };
        let policy =
            PolicySource::load_file(&path, &pins, Instant::now() + Duration::from_secs(15))
                .unwrap();
        let plan = ResourcePlan::from_policy(policy.source()).unwrap();
        let limits = FixtureScopeLimits {
            endpoints: 2,
            live_jobs: 2,
            native_payload_bytes: 10354752,
            captured_results: 2,
            captured_bytes: 4194304,
        };
        let host = FixtureHost::new(limits, NonZeroUsize::new(1).unwrap());
        let session = host.session(limits).unwrap();
        // Both charges precede first socket/process/task construction.
        let (client, client_hold) = session.reserve_endpoint(plan.declaration()).unwrap();
        let (runner, runner_hold) = session.reserve_endpoint(plan.declaration()).unwrap();
        (
            Self {
                _host: host,
                session,
                policy,
                dir,
                client: Some(client),
                runner: Some(runner),
                client_hold,
            },
            plan,
            runner_hold,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.dir).unwrap();
    }
}
fn sleeper() -> Command {
    let mut cmd = Command::new("/bin/sleep");
    cmd.arg("30");
    cmd
}

#[tokio::test]
#[ignore = "raw handshake subprocess fixture; only parent control invokes it"]
async fn issuer_peer_helper_fixture() {
    let path = std::env::var("NAC_ISSUER_PEER_SOCKET").expect("parent test socket");
    let mut stream = tokio::net::UnixStream::connect(path).await.unwrap();
    crate::execution_supervision::handshake::exchange(
        &mut stream,
        uuid::Uuid::new_v4(),
        false,
        crate::execution_supervision::EXECUTION_PROTOCOL,
    )
    .await
    .unwrap();
    let mut scratch = [0; 1];
    while stream.read(&mut scratch).await.unwrap_or(0) != 0 {}
}

#[tokio::test]
async fn concrete_client_uses_actual_cross_uid_child_and_same_issuer_charges() {
    // This control runs only in the disposable root Linux fixture container.
    // A raw handshake sink is not a remote Native execution/bootstrap proof.
    // SAFETY: geteuid only observes this disposable test process's identity.
    assert_eq!(
        unsafe { libc::geteuid() },
        0,
        "disposable root Linux fixture required"
    );
    let (mut fixture, plan, hold) = Fixture::new();
    fs::set_permissions(&fixture.dir, fs::Permissions::from_mode(0o711)).unwrap();
    let path = fixture.dir.join("peer.sock");
    let listener = tokio::net::UnixListener::bind(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "execution_supervision::actor::issuer_process::tests::issuer_peer_helper_fixture",
            "--ignored",
        ])
        .env("NAC_ISSUER_PEER_SOCKET", &path)
        .uid(1001)
        .gid(1001);
    let owner = IssuerRunnerCustody::spawn(
        command,
        plan,
        fixture.client_hold.clone(),
        hold,
        Instant::now() + Duration::from_secs(8),
    )
    .unwrap();
    let cutoff = owner.original_cutoff();
    let (stream, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut channel = crate::execution_supervision::ExecutionSupervisionChannel::capture(
        stream,
        crate::execution_supervision::ExecutionPeerExpectation {
            uid: 1001,
            gid: 1001,
        },
        cutoff.into(),
    )
    .unwrap();
    channel
        .negotiate_execution(uuid::Uuid::new_v4(), true)
        .await
        .unwrap();
    let client_plan = ResourcePlan::from_policy(fixture.policy.source()).unwrap();
    let declaration = client_plan.declaration();
    let (client, peer) = super::super::client::NativeExecutionTransport::from_owned_runner(
        channel,
        Arc::clone(&owner),
        client_plan,
    )
    .unwrap();
    fixture
        .client
        .as_ref()
        .unwrap()
        .close_and_reap(&client, cutoff)
        .await
        .unwrap();
    fixture
        .runner
        .as_ref()
        .unwrap()
        .close_and_reap(&client, cutoff)
        .await
        .unwrap();
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    drop((client, peer, owner));
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    drop(fixture.runner.take());
    tokio::time::timeout(Duration::from_secs(1), async {
        while fixture.session.probe_endpoint(declaration).is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
fn cleanup(owner: Arc<IssuerRunnerCustody>, hold: CompartmentStorageHold) -> NativeCleanup {
    let cutoff = owner.original_cutoff();
    NativeCleanup::new(owner, StorageCharge::Accounted(hold), cutoff)
}

#[tokio::test]
async fn actual_runner_join_does_not_release_either_supplied_charge_until_last_storage() {
    let (mut fixture, plan, hold) = Fixture::new();
    let declaration = plan.declaration();
    let owner = IssuerRunnerCustody::spawn(
        sleeper(),
        plan,
        fixture.client_hold.clone(),
        hold,
        Instant::now() + Duration::from_secs(8),
    )
    .unwrap();
    let cleanup = cleanup(Arc::clone(&owner), fixture.client_hold.clone());
    fixture
        .client
        .as_ref()
        .unwrap()
        .close_and_reap(&cleanup, owner.original_cutoff())
        .await
        .unwrap();
    fixture
        .runner
        .as_ref()
        .unwrap()
        .close_and_reap(&cleanup, owner.original_cutoff())
        .await
        .unwrap();
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    drop(cleanup);
    drop(owner);
    // The original Core admission is storage too; join is not its retirement.
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    drop(fixture.runner.take());
    tokio::time::timeout(Duration::from_secs(1), async {
        while fixture.session.probe_endpoint(declaration).is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn policy_retirement_stops_actual_child_without_releasing_its_charge() {
    let (fixture, plan, hold) = Fixture::new();
    let declaration = plan.declaration();
    let owner = IssuerRunnerCustody::spawn(
        sleeper(),
        plan,
        fixture.client_hold.clone(),
        hold,
        Instant::now() + Duration::from_secs(8),
    )
    .unwrap();
    fixture.policy.retirement().retire();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let pending = match &*owner.process.lock().unwrap() {
                ProcessState::Started(p) => p.snapshot().cleanup_pending,
                _ => true,
            };
            if !pending {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(owner.check_current().is_err());
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    owner.wait_for_reap(owner.original_cutoff()).await.unwrap();
}

#[tokio::test]
async fn expired_cleanup_keeps_unknown_charge_and_cannot_be_renewed() {
    let (fixture, plan, hold) = Fixture::new();
    let declaration = plan.declaration();
    let owner = IssuerRunnerCustody::spawn(
        sleeper(),
        plan,
        fixture.client_hold.clone(),
        hold,
        Instant::now() + Duration::from_secs(8),
    )
    .unwrap();
    let cleanup = cleanup(Arc::clone(&owner), fixture.client_hold.clone());
    let expired = Instant::now() - Duration::from_millis(1);
    assert!(fixture
        .runner
        .as_ref()
        .unwrap()
        .close_and_reap(&cleanup, expired)
        .await
        .is_err());
    assert!(owner
        .wait_for_reap(Instant::now() + Duration::from_secs(30))
        .await
        .is_err());
    drop(cleanup);
    drop(owner);
    assert!(fixture.session.probe_endpoint(declaration).is_err());
}

#[tokio::test]
async fn spawn_error_retains_both_charges_and_never_certifies_an_unknown_join() {
    let (fixture, plan, hold) = Fixture::new();
    let declaration = plan.declaration();
    let command = Command::new(fixture.dir.join("absent-runner"));
    let failure = match IssuerRunnerCustody::spawn(
        command,
        plan,
        fixture.client_hold.clone(),
        hold,
        Instant::now() + Duration::from_secs(8),
    ) {
        Err(failure) => failure,
        Ok(_) => panic!("absent runner must refuse"),
    };
    assert!(fixture
        .runner
        .as_ref()
        .unwrap()
        .close_and_reap(&failure.cleanup, Instant::now() + Duration::from_secs(3))
        .await
        .is_err());
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    drop(failure);
    assert!(fixture.session.probe_endpoint(declaration).is_err());
}
