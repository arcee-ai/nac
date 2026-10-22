//! Actual owned socket/direct-child controls, no consumed lifecycle or job.
use super::super::tests::Fixture;
use super::*;
use nac_core::runtime::ExecutionCompartmentTransport;
use std::time::Duration;
use tokio::io::AsyncReadExt;

#[tokio::test]
#[ignore = "raw bootstrap subprocess fixture; parent controls invoke explicitly"]
async fn bootstrap_child_fixture() {
    let path = std::env::var("NAC_EXECUTION_SUPERVISION_SOCKET").unwrap();
    match std::env::var("NAC_BOOTSTRAP_TEST_MODE").as_deref() {
        Ok("no-connect") => {
            std::future::pending::<()>().await;
        }
        Ok("quiet") => {
            let _stream = tokio::net::UnixStream::connect(path).await.unwrap();
            std::future::pending::<()>().await;
        }
        _ => {
            let mut stream = tokio::net::UnixStream::connect(path).await.unwrap();
            crate::execution_supervision::handshake::exchange(
                &mut stream,
                Uuid::new_v4(),
                false,
                crate::execution_supervision::EXECUTION_PROTOCOL,
            )
            .await
            .unwrap();
            let mut scratch = [0; 1];
            while stream.read(&mut scratch).await.unwrap_or(0) != 0 {}
        }
    }
}
fn bootstrap(mode: &str) -> (Fixture, RunnerBootstrap) {
    // SAFETY: geteuid only observes the disposable test container identity.
    assert_eq!(
        unsafe { libc::geteuid() },
        0,
        "disposable root Linux fixture required"
    );
    let (fixture, plan, hold) = Fixture::new();
    fs::set_permissions(&fixture.dir, fs::Permissions::from_mode(0o711)).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args(["--exact","execution_supervision::actor::issuer_process::bootstrap::tests::bootstrap_child_fixture","--ignored"])
        .env("NAC_BOOTSTRAP_TEST_MODE",mode).uid(1001).gid(1001);
    let owned = RunnerBootstrap::spawn(
        command,
        plan,
        fixture.client_hold.clone(),
        hold,
        Instant::now() + Duration::from_secs(8),
        &fixture.dir,
        ExecutionPeerExpectation {
            uid: 1001,
            gid: 1001,
        },
    )
    .unwrap();
    (fixture, owned)
}
async fn stopped(owner: &IssuerRunnerCustody) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let pending = match &*owner.process.lock().unwrap() {
                ProcessState::Started(p) => p.snapshot().cleanup_pending,
                _ => true,
            };
            if !pending {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
fn cleanup(owner: Arc<IssuerRunnerCustody>) -> NativeCleanup {
    let cutoff = owner.original_cutoff();
    let storage = StorageCharge::Accounted(owner.client_storage());
    NativeCleanup::new(owner, storage, cutoff)
}

#[tokio::test]
async fn owned_bootstrap_connects_exact_child_and_transfers_actual_client_custody() {
    let (mut fixture, mut bootstrap) = bootstrap("negotiate");
    let path = bootstrap.socket.path.clone();
    let dir = bootstrap.socket.directory.clone();
    let connected = bootstrap.connect(Uuid::new_v4()).await.unwrap();
    drop(bootstrap);
    assert!(!path.exists() && !dir.exists());
    let plan = ResourcePlan::from_policy(fixture.policy.source()).unwrap();
    let declaration = plan.declaration();
    let custody = Arc::clone(&connected.custody);
    let (client, peer) = connected.into_client(plan).unwrap();
    fixture
        .client
        .as_ref()
        .unwrap()
        .close_and_reap(&client, custody.original_cutoff())
        .await
        .unwrap();
    fixture
        .runner
        .as_ref()
        .unwrap()
        .close_and_reap(&client, custody.original_cutoff())
        .await
        .unwrap();
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    drop((client, peer, custody));
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
async fn never_polled_connect_consumes_attempt_and_stops_original_child() {
    let (fixture, mut bootstrap) = bootstrap("no-connect");
    let declaration = bootstrap.custody.plan.declaration();
    drop(bootstrap.connect(Uuid::new_v4()));
    stopped(&bootstrap.custody).await;
    assert!(bootstrap.connect(Uuid::new_v4()).await.is_err());
    assert!(fixture.session.probe_endpoint(declaration).is_err());
    let cleanup = cleanup(Arc::clone(&bootstrap.custody));
    cleanup
        .close_and_reap(bootstrap.custody.original_cutoff())
        .await
        .unwrap();
}

#[tokio::test]
async fn cancelled_quiet_negotiation_retains_original_cleanup_and_charges() {
    let (fixture, mut bootstrap) = bootstrap("quiet");
    let declaration = bootstrap.custody.plan.declaration();
    assert!(tokio::time::timeout(
        Duration::from_millis(100),
        bootstrap.connect(Uuid::new_v4())
    )
    .await
    .is_err());
    stopped(&bootstrap.custody).await;
    assert!(bootstrap.connect(Uuid::new_v4()).await.is_err());
    assert!(fixture.session.probe_endpoint(declaration).is_err());
}

#[tokio::test]
async fn policy_retirement_interrupts_quiet_owned_accept_without_replacement() {
    let (fixture, mut bootstrap) = bootstrap("no-connect");
    let future = bootstrap.connect(Uuid::new_v4());
    tokio::pin!(future);
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut future)
        .await
        .is_err());
    fixture.policy.retirement().retire();
    assert!(tokio::time::timeout(Duration::from_secs(1), &mut future)
        .await
        .unwrap()
        .is_err());
}

#[tokio::test]
async fn socket_replacement_refuses_and_cleanup_never_deletes_foreign_inode() {
    let (fixture, mut bootstrap) = bootstrap("no-connect");
    let path = bootstrap.socket.path.clone();
    let directory = bootstrap.socket.directory.clone();
    fs::remove_file(&path).unwrap();
    fs::write(&path, b"foreign replacement").unwrap();
    assert!(bootstrap.connect(Uuid::new_v4()).await.is_err());
    stopped(&bootstrap.custody).await;
    drop(bootstrap);
    assert_eq!(fs::read(&path).unwrap(), b"foreign replacement");
    fs::remove_file(path).unwrap();
    fs::remove_dir(directory).unwrap();
    drop(fixture);
}

#[tokio::test]
async fn foreign_connector_with_expected_uid_denies_before_handshake_and_no_second_accept() {
    let (fixture, mut bootstrap) = bootstrap("no-connect");
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args(["--exact","execution_supervision::actor::issuer_process::bootstrap::tests::bootstrap_child_fixture","--ignored"])
        .env("NAC_BOOTSTRAP_TEST_MODE","quiet").env("NAC_EXECUTION_SUPERVISION_SOCKET",&bootstrap.socket.path).uid(1001).gid(1001);
    let foreign = NativePipe::spawn_silent_peer_runner(
        command,
        (Instant::now() + Duration::from_secs(8)).into(),
    )
    .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(2), bootstrap.connect(Uuid::new_v4()))
            .await
            .unwrap()
            .is_err()
    );
    assert!(bootstrap.connect(Uuid::new_v4()).await.is_err());
    stopped(&bootstrap.custody).await;
    foreign
        .terminate_until((Instant::now() + Duration::from_secs(3)).into())
        .await
        .unwrap();
    drop(fixture);
}

#[tokio::test]
async fn abandoned_connected_handoff_stops_child_before_client_construction() {
    let (fixture, mut bootstrap) = bootstrap("negotiate");
    let connected = bootstrap.connect(Uuid::new_v4()).await.unwrap();
    let custody = Arc::clone(&connected.custody);
    let declaration = custody.plan.declaration();
    drop(bootstrap);
    drop(connected);
    stopped(&custody).await;
    assert!(fixture.session.probe_endpoint(declaration).is_err());
}
