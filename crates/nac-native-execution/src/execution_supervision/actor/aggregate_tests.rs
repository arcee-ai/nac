//! Actual Linux receiving controls for the capacity-only Core fixture seam.
//! Same-UID channels and RAW cleanup never qualify a protected runtime.
use super::{
    client::NativeExecutionTransport,
    construction::BuildControl,
    resources::StorageCharge,
    runner::NativeRunner,
    tests::{command, deadline, negotiated_channels, resources},
};
use nac_core::runtime::{
    compartment_resource_fixtures::{
        FixtureHost, FixtureReservation, FixtureScopeLimits, FixtureSession,
    },
    CompartmentResourceDeclaration, ExecutionCompartmentTransport,
};
use nac_process::{NativePipe, NativePipeOwner};
use std::{
    num::NonZeroUsize,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::io::AsyncReadExt;

fn limits(declaration: CompartmentResourceDeclaration, endpoints: usize) -> FixtureScopeLimits {
    FixtureScopeLimits {
        endpoints,
        live_jobs: declaration.live_jobs().get() * endpoints,
        native_payload_bytes: declaration.accounted_payload_bytes().get() * endpoints,
        captured_results: 0,
        captured_bytes: 0,
    }
}
fn scope(declaration: CompartmentResourceDeclaration) -> (FixtureHost, FixtureSession) {
    let limits = limits(declaration, 1);
    let host = FixtureHost::new(limits, NonZeroUsize::new(1).unwrap());
    let session = host.session(limits).unwrap();
    (host, session)
}
fn driver() -> Arc<NativePipeOwner> {
    let mut command = tokio::process::Command::new("/bin/sleep");
    command.arg("30");
    let NativePipe { process, .. } =
        NativePipe::spawn_with_closed_fds(command, deadline().into()).unwrap();
    Arc::new(process)
}
async fn available(session: &FixtureSession, declaration: CompartmentResourceDeclaration) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while session.probe_endpoint(declaration).is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

struct Pair {
    client: NativeExecutionTransport,
    runner: NativeRunner,
    client_reservation: FixtureReservation,
    runner_reservation: FixtureReservation,
    client_session: FixtureSession,
    _host: FixtureHost,
    _runner_session: FixtureSession,
    _peer: nac_process::peer_channel::PeerLifetime,
    _target_peer: nac_process::peer_channel::PeerLifetime,
}
impl Pair {
    async fn new() -> Self {
        let client_plan = resources(1024, 2).validate().unwrap();
        let runner_plan = resources(1024, 2).validate().unwrap();
        let declaration = client_plan.declaration();
        let host = FixtureHost::new(limits(declaration, 2), NonZeroUsize::new(2).unwrap());
        let client_session = host.session(limits(declaration, 1)).unwrap();
        let runner_session = host.session(limits(declaration, 1)).unwrap();
        // Admission precedes the first socket, driver, or Native task.
        let (client_reservation, client_hold) =
            client_session.reserve_endpoint(declaration).unwrap();
        let (runner_reservation, runner_hold) =
            runner_session.reserve_endpoint(declaration).unwrap();
        let (a, b) = negotiated_channels().await;
        let (runner, target_peer) =
            NativeRunner::from_negotiated(b, runner_plan, runner_hold).unwrap();
        let (client, peer) =
            NativeExecutionTransport::from_negotiated(a, driver(), client_plan, client_hold)
                .unwrap();
        Self {
            client,
            runner,
            client_reservation,
            runner_reservation,
            client_session,
            _host: host,
            _runner_session: runner_session,
            _peer: peer,
            _target_peer: target_peer,
        }
    }
    async fn join(&self) {
        self.client_reservation
            .close_and_reap(&self.client, deadline())
            .await
            .unwrap();
        self.runner_reservation
            .close_and_reap(&self.runner.cleanup, deadline())
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn actual_completed_pipe_ports_keep_aggregate_capacity_after_driver_and_tasks_join() {
    let pair = Pair::new().await;
    let declaration = resources(1024, 2).validate().unwrap().declaration();
    let mut pipe = pair
        .client
        .spawn_pipe(command("/bin/echo", &["retained"]), deadline())
        .await
        .unwrap();
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let (out, err, exit) = tokio::join!(
        pipe.stdout.read_to_end(&mut stdout),
        pipe.stderr.read_to_end(&mut stderr),
        pipe.process.wait()
    );
    out.unwrap();
    err.unwrap();
    assert_eq!(exit.unwrap().code, Some(0));
    assert_eq!(stdout, b"retained\n");
    pair.join().await;
    let Pair {
        client,
        runner,
        client_reservation,
        runner_reservation,
        client_session,
        _host,
        _runner_session,
        _peer,
        _target_peer,
    } = pair;
    drop(client_reservation);
    drop(runner_reservation);
    drop(client);
    drop(runner);
    // The actual completed input/output/process ports still own Native storage.
    assert!(client_session.probe_endpoint(declaration).is_err());
    drop(pipe);
    available(&client_session, declaration).await;
}

#[tokio::test]
async fn unpolled_actual_capture_keeps_its_reserved_input_until_drop_after_raw_join() {
    let pair = Pair::new().await;
    let declaration = resources(1024, 2).validate().unwrap().declaration();
    let mut cmd = command("/bin/cat", &[]);
    cmd.stdin = Some(Vec::with_capacity(512 * 1024));
    // Native reserves and owns the actual Vec at call time, before first poll.
    let unpolled = pair.client.execute(cmd, deadline());
    pair.join().await;
    assert!(pair.client_session.probe_endpoint(declaration).is_err());
    drop(unpolled);
    let Pair {
        client,
        runner,
        client_reservation,
        runner_reservation,
        client_session,
        _host,
        _runner_session,
        _peer,
        _target_peer,
    } = pair;
    drop(client_reservation);
    drop(runner_reservation);
    drop(client);
    drop(runner);
    available(&client_session, declaration).await;
}

#[tokio::test]
async fn partial_constructor_retains_actual_driver_and_wire_task_storage_across_unpolled_cleanup() {
    let plan = resources(1024, 2).validate().unwrap();
    let declaration = plan.declaration();
    let (_host, session) = scope(declaration);
    let (reservation, hold) = session.reserve_endpoint(declaration).unwrap();
    let (channel, _other) = negotiated_channels().await;
    let driver = driver();
    let failed = NativeExecutionTransport::construct(
        channel,
        driver.clone(),
        plan,
        StorageCharge::Accounted(hold),
        BuildControl::FailAfterWire,
    )
    .err()
    .unwrap();
    assert!(failed.error.to_string().contains("after wire tasks"));
    // These are the same real wire-task owners, not a test counter/Join setter.
    let wire_tasks = Arc::clone(&failed.cleanup.tasks);
    let unpolled = reservation.close_and_reap(&failed.cleanup, deadline());
    drop(unpolled);
    assert!(session.probe_endpoint(declaration).is_err());
    reservation
        .close_and_reap(&failed.cleanup, deadline())
        .await
        .unwrap();
    driver.wait().await.unwrap();
    drop(reservation);
    drop(failed);
    assert!(session.probe_endpoint(declaration).is_err());
    drop(wire_tasks);
    available(&session, declaration).await;
}

#[tokio::test]
async fn different_concrete_plan_is_refused_and_error_retains_actual_cleanup() {
    let admitted = resources(1024, 2).validate().unwrap().declaration();
    let (_host, session) = scope(admitted);
    let (reservation, hold) = session.reserve_endpoint(admitted).unwrap();
    let (channel, _other) = negotiated_channels().await;
    let driver = driver();
    let changed = resources(1025, 2).validate().unwrap();
    let failed = NativeExecutionTransport::from_negotiated(channel, driver.clone(), changed, hold)
        .err()
        .unwrap();
    assert!(failed.error.to_string().contains("differs from admitted"));
    assert!(session.probe_endpoint(admitted).is_err());
    reservation
        .close_and_reap(&failed.cleanup, deadline())
        .await
        .unwrap();
    driver.wait().await.unwrap();
    drop(reservation);
    assert!(session.probe_endpoint(admitted).is_err());
    drop(failed);
    available(&session, admitted).await;
}

#[tokio::test]
async fn expired_partial_cleanup_cannot_renew_its_original_cutoff_or_release_capacity() {
    let plan = resources(1024, 2).validate().unwrap();
    let declaration = plan.declaration();
    let (_host, session) = scope(declaration);
    let (reservation, hold) = session.reserve_endpoint(declaration).unwrap();
    let (channel, _other) = negotiated_channels().await;
    let failed = NativeExecutionTransport::construct(
        channel,
        driver(),
        plan,
        StorageCharge::Accounted(hold),
        BuildControl::FailAfterWire,
    )
    .err()
    .unwrap();
    let unpolled = reservation.close_and_reap(&failed.cleanup, Instant::now());
    drop(unpolled);
    assert!(reservation
        .close_and_reap(&failed.cleanup, deadline())
        .await
        .is_err());
    drop(reservation);
    drop(failed);
    tokio::task::yield_now().await;
    assert!(session.probe_endpoint(declaration).is_err());
}

#[tokio::test]
async fn unpolled_runner_close_retains_original_cutoff_and_cannot_renew() {
    let plan = resources(1024, 2).validate().unwrap();
    let declaration = plan.declaration();
    let (_host, session) = scope(declaration);
    let (reservation, hold) = session.reserve_endpoint(declaration).unwrap();
    let (_other, channel) = negotiated_channels().await;
    let (runner, peer) = NativeRunner::from_negotiated(channel, plan, hold).unwrap();
    let unpolled = runner.close_and_reap(Instant::now());
    drop(unpolled);
    assert!(runner.close_and_reap(deadline()).await.is_err());
    assert!(peer.check_current().is_err());
    drop(reservation);
    drop(runner);
    tokio::task::yield_now().await;
    assert!(session.probe_endpoint(declaration).is_err());
}
