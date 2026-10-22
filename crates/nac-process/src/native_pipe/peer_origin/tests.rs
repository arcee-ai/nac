use super::*;
use crate::{peer_channel, NativePipe};
use std::{io::Read, time::Duration};
use tokio::{net::UnixListener, process::Command, time::Instant};

#[test]
#[ignore = "subprocess fixture, invoked only by the parent control"]
fn peer_origin_child_fixture() {
    let path = std::env::var("NAC_PIPE_ORIGIN_SOCKET").expect("parent fixture socket");
    let mut stream = std::os::unix::net::UnixStream::connect(path).unwrap();
    let mut scratch = [0; 1];
    let _ = stream.read(&mut scratch);
}

async fn child() -> (
    NativePipe,
    peer_channel::PeerConnection,
    PeerLifetime,
    std::path::PathBuf,
) {
    let path = std::env::temp_dir().join(format!("nac-origin-{}", uuid::Uuid::new_v4()));
    let listener = UnixListener::bind(&path).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "native_pipe::peer_origin::tests::peer_origin_child_fixture",
            "--ignored",
        ])
        .env("NAC_PIPE_ORIGIN_SOCKET", &path);
    let cutoff = Instant::now() + Duration::from_secs(8);
    let pipe = NativePipe::spawn_peer_runner(command, cutoff).unwrap();
    let (stream, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let (connection, peer) = peer_channel::capture(stream, cutoff.into_std()).unwrap();
    (pipe, connection, peer, path)
}

#[tokio::test]
async fn live_original_child_pidfd_matches_only_its_actual_socket_peer() {
    let (original, connection, peer, path) = child().await;
    let (foreign, foreign_connection, foreign_peer, foreign_path) = child().await;
    original.process.require_original_peer(&peer).unwrap();
    assert!(original
        .process
        .require_original_peer(&foreign_peer)
        .is_err());
    foreign
        .process
        .require_original_peer(&foreign_peer)
        .unwrap();
    drop((connection, foreign_connection));
    original.process.wait().await.unwrap();
    foreign.process.wait().await.unwrap();
    assert!(original.process.require_original_peer(&peer).is_err());
    std::fs::remove_file(path).unwrap();
    std::fs::remove_file(foreign_path).unwrap();
}

#[tokio::test]
async fn ordinary_pipe_has_no_original_peer_origin_and_cannot_be_upgraded() {
    let (peer_child, connection, peer, path) = child().await;
    let mut command = Command::new("/bin/sleep");
    command.arg("30");
    let ordinary = NativePipe::spawn(command, Instant::now() + Duration::from_secs(8)).unwrap();
    assert!(ordinary.process.require_original_peer(&peer).is_err());
    ordinary
        .process
        .terminate_until(Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    drop(connection);
    peer_child.process.wait().await.unwrap();
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn post_spawn_identity_failure_returns_the_actual_original_cleanup_owner() {
    FAIL_CAPTURE.with(|flag| flag.set(true));
    let mut command = Command::new("/bin/sleep");
    command.arg("30");
    let failure = NativePipe::spawn_peer_runner(command, Instant::now() + Duration::from_secs(8));
    FAIL_CAPTURE.with(|flag| flag.set(false));
    let failure = match failure {
        Err(failure) => failure,
        Ok(_) => panic!("injected failure must refuse"),
    };
    assert_eq!(
        failure.error.to_string(),
        "injected original child peer capture failure"
    );
    let process = failure
        .process
        .expect("actual post-spawn cleanup must remain owned");
    process
        .terminate_until(Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert!(!process.snapshot().cleanup_pending);
}
