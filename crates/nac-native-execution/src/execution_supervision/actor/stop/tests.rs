use super::*;
use nac_process::{peer_channel, NativePipe};
use std::time::Duration;
use tokio::{net::UnixStream, process::Command};

// Actual selected process in this bounded fixture, not a Root/runtime producer.
fn runner() -> Arc<nac_process::NativePipeOwner> {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "exec /bin/sleep 30"]);
    let NativePipe { process, .. } = NativePipe::spawn_with_closed_fds(
        command,
        (Instant::now() + Duration::from_secs(8)).into(),
    )
    .unwrap();
    Arc::new(process)
}
fn until_reaped(runner: &nac_process::NativePipeOwner) {
    let limit = Instant::now() + Duration::from_secs(4);
    while runner.snapshot().cleanup_pending && Instant::now() < limit {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!runner.snapshot().cleanup_pending);
}

#[test]
fn admitted_original_job_cutoff_stops_actual_runner_without_caller_runtime_progress() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (scope, runner, _connection, _peer, _other, registration) = runtime.block_on(async {
        let (a, b) = UnixStream::pair().unwrap();
        let (connection, peer) =
            peer_channel::capture(a, Instant::now() + Duration::from_secs(6)).unwrap();
        let runner = runner();
        let scope = StopScope::start(
            connection.io_gate(),
            peer.denial_handle(),
            runner.clone(),
            peer.original_cutoff(),
        )
        .unwrap();
        let registration = scope
            .register(Instant::now() + Duration::from_millis(120))
            .unwrap();
        (scope, runner, connection, peer, b, registration)
    });
    until_reaped(&runner);
    assert!(scope.check().is_err());
    drop(registration);
}

#[tokio::test]
async fn dropped_pending_dispatch_stops_actual_runner_with_all_scope_owners_retained() {
    let (a, _b) = UnixStream::pair().unwrap();
    let (connection, peer) =
        peer_channel::capture(a, Instant::now() + Duration::from_secs(6)).unwrap();
    let runner = runner();
    let scope = StopScope::start(
        connection.io_gate(),
        peer.denial_handle(),
        runner.clone(),
        peer.original_cutoff(),
    )
    .unwrap();
    let registration = scope
        .register(Instant::now() + Duration::from_secs(5))
        .unwrap();
    // Represents cancellation before the queued job future was ever polled.
    drop(registration);
    tokio::task::spawn_blocking(move || until_reaped(&runner))
        .await
        .unwrap();
    assert!(scope.check().is_err());
}

#[tokio::test]
async fn settled_registration_releases_only_its_deadline_and_real_peer_loss_still_stops_runner() {
    let (a, b) = UnixStream::pair().unwrap();
    let (connection, peer) =
        peer_channel::capture(a, Instant::now() + Duration::from_secs(6)).unwrap();
    let runner = runner();
    let scope = StopScope::start(
        connection.io_gate(),
        peer.denial_handle(),
        runner.clone(),
        peer.original_cutoff(),
    )
    .unwrap();
    scope
        .register(Instant::now() + Duration::from_millis(40))
        .unwrap()
        .settled();
    tokio::time::sleep(Duration::from_millis(70)).await;
    assert!(scope.check().is_ok());
    assert!(runner.snapshot().cleanup_pending);
    drop(b);
    tokio::task::spawn_blocking(move || until_reaped(&runner))
        .await
        .unwrap();
    assert!(scope.check().is_err());
}

#[tokio::test]
async fn already_expired_registration_requests_actual_stop_before_returning_error() {
    let (a, _b) = UnixStream::pair().unwrap();
    let (connection, peer) =
        peer_channel::capture(a, Instant::now() + Duration::from_secs(6)).unwrap();
    let runner = runner();
    let scope = StopScope::start(
        connection.io_gate(),
        peer.denial_handle(),
        runner.clone(),
        peer.original_cutoff(),
    )
    .unwrap();
    assert!(scope
        .register(Instant::now() - Duration::from_millis(1))
        .is_err());
    assert!(scope.check().is_err());
    tokio::task::spawn_blocking(move || until_reaped(&runner))
        .await
        .unwrap();
}

#[tokio::test]
async fn cached_job_cutoffs_and_cancel_guards_are_inert_after_actual_settlement() {
    let (a, _b) = UnixStream::pair().unwrap();
    let (connection, peer) =
        peer_channel::capture(a, Instant::now() + Duration::from_secs(6)).unwrap();
    let runner = runner();
    let scope = StopScope::start(
        connection.io_gate(),
        peer.denial_handle(),
        runner.clone(),
        peer.original_cutoff(),
    )
    .unwrap();
    let registration = scope
        .register(Instant::now() + Duration::from_secs(5))
        .unwrap();
    let stale = registration.cutoff_handle();
    let cancelled = StopJobOnDrop::new(Some(stale.clone()));
    registration.settled();
    stale.tighten(Instant::now() - Duration::from_millis(1));
    drop(cancelled);
    assert!(!scope.stop_if_expired());
    assert!(scope.check().is_ok());
    assert!(runner.snapshot().cleanup_pending);
    scope
        .close_and_reap(Instant::now() + Duration::from_secs(2))
        .await
        .unwrap();
    assert!(!runner.snapshot().cleanup_pending);
}
