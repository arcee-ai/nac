//! Actual private v2 same-UID fixtures, never Core qualification or runtime isolation.
use super::super::ExecutionSupervisionChannel;
use super::{client::NativeExecutionTransport, resources::ResourceLimits, runner::NativeRunner};
use nac_core::runtime::{CompartmentCommand, CompartmentPtySize, ExecutionCompartmentTransport};
use nac_process::{
    peer_channel::{self, PeerLifetime},
    NativePipe, NativePipeOwner,
};
use std::{
    collections::BTreeMap,
    num::NonZeroUsize,
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    process::Command,
};
use uuid::Uuid;

pub(super) struct Fixture {
    pub client: NativeExecutionTransport,
    pub runner: NativeRunner,
    pub driver: Arc<NativePipeOwner>,
    pub peer: PeerLifetime,
    _target_peer: PeerLifetime,
}
pub(super) fn resources(window: usize, jobs: usize) -> ResourceLimits {
    ResourceLimits {
        live_jobs: NonZeroUsize::new(jobs).unwrap(),
        wire_records: NonZeroUsize::new(2).unwrap(),
        flow_window: NonZeroUsize::new(window).unwrap(),
        owned_input_bytes: 2 * 1024 * 1024,
        capture_bytes: 2 * 1024 * 1024,
    }
}
pub(super) async fn negotiated_channels(
) -> (ExecutionSupervisionChannel, ExecutionSupervisionChannel) {
    let (a, b) = UnixStream::pair().unwrap();
    let channel = |stream| {
        let (stream, peer) =
            peer_channel::capture(stream, Instant::now() + Duration::from_secs(10)).unwrap();
        ExecutionSupervisionChannel {
            stream,
            peer,
            denied: AtomicBool::new(false),
            negotiated: false,
            protocol: None,
        }
    };
    let (mut a, mut b) = (channel(a), channel(b));
    let (one, two) = tokio::join!(
        a.negotiate_execution(Uuid::new_v4(), true),
        b.negotiate_execution(Uuid::new_v4(), false)
    );
    one.unwrap();
    two.unwrap();
    (a, b)
}
impl Fixture {
    pub async fn new(window: usize, jobs: usize) -> Self {
        let (a, b) = negotiated_channels().await;
        let mut command = Command::new("/bin/sleep");
        command.arg("30");
        let NativePipe { process, .. } = NativePipe::spawn_with_closed_fds(
            command,
            (Instant::now() + Duration::from_secs(10)).into(),
        )
        .unwrap();
        let driver = Arc::new(process);
        let (runner, target_peer) =
            NativeRunner::unaccounted_for_test(b, resources(window, jobs)).unwrap();
        let (client, peer) = NativeExecutionTransport::unaccounted_for_test(
            a,
            driver.clone(),
            resources(window, jobs),
        )
        .unwrap();
        assert!(client.peer_binding().unwrap() == peer.binding());
        Self {
            client,
            runner,
            driver,
            peer,
            _target_peer: target_peer,
        }
    }
}
pub(super) fn command(program: &str, args: &[&str]) -> CompartmentCommand {
    CompartmentCommand {
        program: PathBuf::from(program),
        args: args.iter().map(Into::into).collect(),
        cwd: PathBuf::from("/"),
        environment: BTreeMap::new(),
        stdin: None,
        stdout_limit: 1024 * 1024,
        stderr_limit: 1024 * 1024,
    }
}
pub(super) fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(6)
}

#[tokio::test]
async fn whole_capture_drains_both_streams_past_independent_ceilings() {
    let fixture = Fixture::new(1024, 2).await;
    let mut command = command("/bin/sh", &["-c", "/bin/dd if=/dev/zero bs=4096 count=24 2>/dev/null; /bin/dd if=/dev/zero bs=4096 count=20 >&2 2>/dev/null"]);
    command.stdout_limit = 17;
    command.stderr_limit = 7;
    let output = fixture.client.execute(command, deadline()).await.unwrap();
    assert_eq!(output.exit.code, Some(0));
    assert_eq!(output.stdout, [0; 17]);
    assert_eq!(output.stderr, [0; 7]);
    assert!(output.stdout_truncated && output.stderr_truncated);
}

#[tokio::test]
async fn stdin_larger_than_command_or_flow_window_round_trips_without_bidirectional_deadlock() {
    let fixture = Fixture::new(1024, 2).await;
    let input = (0..300_000).map(|n| (n % 251) as u8).collect::<Vec<_>>();
    let mut command = command("/bin/cat", &[]);
    command.stdin = Some(input.clone());
    let output = fixture.client.execute(command, deadline()).await.unwrap();
    assert_eq!(output.exit.code, Some(0));
    assert_eq!(output.stdout, input);
    assert!(output.stderr.is_empty());
    assert!(!output.stdout_truncated && !output.stderr_truncated);
}

#[tokio::test]
async fn pipe_streams_ignore_capture_ceilings_and_recycle_byte_credit() {
    let fixture = Fixture::new(1024, 2).await;
    let mut command = command(
        "/bin/sh",
        &[
            "-c",
            "/bin/dd if=/dev/zero bs=4096 count=32 2>/dev/null; printf error >&2",
        ],
    );
    command.stdout_limit = 1;
    command.stderr_limit = 1;
    let mut pipe = fixture
        .client
        .spawn_pipe(command, deadline())
        .await
        .unwrap();
    drop(pipe.stdin);
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let (read_out, read_err, exit) = tokio::join!(
        pipe.stdout.read_to_end(&mut out),
        pipe.stderr.read_to_end(&mut err),
        pipe.process.wait()
    );
    read_out.unwrap();
    read_err.unwrap();
    let exit = exit.unwrap();
    assert_eq!(exit.code, Some(0));
    assert_eq!(out.len(), 128 * 1024);
    assert!(out.iter().all(|byte| *byte == 0));
    assert_eq!(err, b"error");
}

#[tokio::test]
async fn pty_resize_waits_for_actual_target_dimensions_and_preserves_merged_output() {
    let fixture = Fixture::new(1024, 2).await;
    let command = command("/bin/sh", &["-c", "/bin/stty -echo; printf READY:; IFS= read -r value; /bin/stty size; printf 'got:%s\n' \"$value\"; exit 7"]);
    let mut pty = fixture
        .client
        .spawn_pty(
            command,
            CompartmentPtySize { rows: 24, cols: 80 },
            deadline(),
        )
        .await
        .unwrap();
    let mut ready = [0; 6];
    pty.output.read_exact(&mut ready).await.unwrap();
    assert_eq!(&ready, b"READY:");
    pty.process
        .resize(CompartmentPtySize {
            rows: 47,
            cols: 137,
        })
        .await
        .unwrap();
    pty.input.write_all(b"payload\n").await.unwrap();
    pty.input.shutdown().await.unwrap();
    let mut out = Vec::new();
    let (read, exit) = tokio::join!(pty.output.read_to_end(&mut out), pty.process.wait());
    read.unwrap();
    let exit = exit.unwrap();
    assert_eq!(out, b"47 137\r\ngot:payload\r\n");
    assert_eq!(exit.code, Some(7));
}

#[tokio::test]
async fn sequential_jobs_release_slots_and_do_not_retain_old_deadline_authority() {
    let fixture = Fixture::new(1024, 1).await;
    for _ in 0..8 {
        let output = fixture
            .client
            .execute(
                command("/bin/echo", &["next"]),
                Instant::now() + Duration::from_millis(500),
            )
            .await
            .unwrap();
        assert_eq!(output.stdout, b"next\n");
    }
    tokio::time::sleep(Duration::from_millis(550)).await;
    assert!(fixture.peer.check_current().is_ok());
    let output = fixture
        .client
        .execute(command("/bin/echo", &["successor"]), deadline())
        .await
        .unwrap();
    assert_eq!(output.stdout, b"successor\n");
}

#[tokio::test]
async fn stalled_consumer_does_not_block_another_job_and_explicit_stop_can_drain_retained_output() {
    let fixture = Fixture::new(1024, 3).await;
    let mut pipe = fixture
        .client
        .spawn_pipe(
            command(
                "/bin/sh",
                &[
                    "-c",
                    "/bin/dd if=/dev/zero bs=4096 count=32 2>/dev/null; exec /bin/sleep 30",
                ],
            ),
            deadline(),
        )
        .await
        .unwrap();
    drop(pipe.stdin);
    let output = tokio::time::timeout(
        Duration::from_secs(2),
        fixture
            .client
            .execute(command("/bin/echo", &["independent"]), deadline()),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(output.stdout, b"independent\n");
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let (read_out, read_err, reap) = tokio::join!(
        pipe.stdout.read_to_end(&mut out),
        pipe.stderr.read_to_end(&mut err),
        pipe.process.terminate_and_reap(deadline())
    );
    read_out.unwrap();
    read_err.unwrap();
    reap.unwrap();
    assert!(out.len() <= 128 * 1024);
    assert!(err.is_empty());
}

#[test]
fn raw_call_installs_original_deadline_before_any_future_poll_or_queue_progress() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let fixture = runtime.block_on(Fixture::new(1024, 2));
    let pending = fixture.client.execute(
        command("/bin/sleep", &["30"]),
        Instant::now() + Duration::from_millis(120),
    );
    let observed_until = Instant::now() + Duration::from_secs(4);
    while fixture.driver.snapshot().cleanup_pending && Instant::now() < observed_until {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!fixture.driver.snapshot().cleanup_pending);
    assert!(fixture.peer.check_current().is_err());
    drop(pending);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn completed_process_observations_hold_no_live_job_slot_or_old_deadline() {
    let fixture = Fixture::new(1024, 1).await;
    let mut observations = Vec::new();
    for _ in 0..8 {
        let mut pipe = fixture
            .client
            .spawn_pipe(
                command("/bin/echo", &["complete"]),
                Instant::now() + Duration::from_secs(2),
            )
            .await
            .unwrap();
        drop(pipe.stdin);
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (read_out, read_err, exit) = tokio::join!(
            pipe.stdout.read_to_end(&mut out),
            pipe.stderr.read_to_end(&mut err),
            pipe.process.wait()
        );
        read_out.unwrap();
        read_err.unwrap();
        assert_eq!(exit.unwrap().code, Some(0));
        assert_eq!(out, b"complete\n");
        observations.push(pipe.process);
    }
    tokio::time::sleep(Duration::from_millis(2050)).await;
    assert!(fixture.peer.check_current().is_ok());
    for process in observations {
        assert_eq!(process.wait().await.unwrap().code, Some(0));
    }
    assert_eq!(
        fixture
            .client
            .execute(command("/bin/echo", &["fresh"]), deadline())
            .await
            .unwrap()
            .stdout,
        b"fresh\n"
    );
}

#[tokio::test]
async fn explicit_close_reaps_actual_driver_and_joins_native_io_tasks() {
    let fixture = Fixture::new(1024, 2).await;
    let mut pipe = fixture
        .client
        .spawn_pipe(
            command("/bin/sh", &["-c", "printf READY:; exec /bin/sleep 30"]),
            deadline(),
        )
        .await
        .unwrap();
    let mut ready = [0; 6];
    pipe.stdout.read_exact(&mut ready).await.unwrap();
    assert_eq!(&ready, b"READY:");
    fixture.client.close_and_reap(deadline()).await.unwrap();
    assert!(!fixture.driver.snapshot().cleanup_pending);
    assert!(fixture.peer.check_current().is_err());
    // The fixture peer is deliberately same-process, while its selected driver
    // is a separate actual process. Observe target cleanup independently too.
    fixture.runner.close_and_reap(deadline()).await.unwrap();
    assert!(pipe.stdout.read_u8().await.is_err());
    assert!(pipe.stdin.write_all(b"late").await.is_err());
    assert!(pipe.process.wait().await.is_err());
}

#[tokio::test]
async fn input_closed_before_exit_wakes_backpressured_writer_and_preserves_output() {
    let fixture = Fixture::new(1024, 2).await;
    let mut pipe = fixture
        .client
        .spawn_pipe(
            command(
                "/bin/sh",
                &[
                    "-c",
                    "exec 0<&-; printf READY:; /bin/sleep 0.1; printf survived",
                ],
            ),
            deadline(),
        )
        .await
        .unwrap();
    let mut ready = [0; 6];
    pipe.stdout.read_exact(&mut ready).await.unwrap();
    assert_eq!(&ready, b"READY:");
    let write = pipe.stdin.write_all(&[7; 8192]).await;
    assert!(write.is_err());
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let (read_out, read_err, exit) = tokio::join!(
        pipe.stdout.read_to_end(&mut out),
        pipe.stderr.read_to_end(&mut err),
        pipe.process.wait()
    );
    read_out.unwrap();
    read_err.unwrap();
    assert_eq!(exit.unwrap().code, Some(0));
    assert_eq!(out, b"survived");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_jobs_keep_admission_order_and_complete_independently() {
    let fixture = Fixture::new(1024, 8).await;
    let mut commands = Vec::new();
    for _ in 0..8 {
        let mut cmd = command("/bin/echo", &["concurrent"]);
        cmd.stdout_limit = 64;
        cmd.stderr_limit = 64;
        commands.push(cmd);
    }
    let mut tasks = tokio::task::JoinSet::new();
    let client = Arc::new(fixture.client);
    for command in commands {
        let client = Arc::clone(&client);
        tasks.spawn(async move { client.execute(command, deadline()).await });
    }
    while let Some(result) = tasks.join_next().await {
        let output = result.unwrap().unwrap();
        assert_eq!(output.stdout, b"concurrent\n");
        assert_eq!(output.exit.code, Some(0));
    }
}

#[tokio::test]
async fn cancelling_actual_capture_stops_and_reaps_with_transport_and_peer_retained() {
    let fixture = Fixture::new(1024, 2).await;
    let marker = std::env::temp_dir().join(format!("native-cancel-ready-{}", Uuid::new_v4()));
    let script = format!("printf READY > '{}'; exec /bin/sleep 30", marker.display());
    let mut capture = fixture
        .client
        .execute(command("/bin/sh", &["-c", &script]), deadline());
    tokio::time::timeout(Duration::from_secs(2), async {
        while !marker.exists() {
            std::future::poll_fn(|cx| {
                assert!(capture.as_mut().poll(cx).is_pending());
                std::task::Poll::Ready(())
            })
            .await;
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
    drop(capture);
    std::fs::remove_file(marker).unwrap();
    // Observe cancellation's own stop before explicit close can request it.
    tokio::time::timeout(Duration::from_secs(2), async {
        while fixture.driver.snapshot().cleanup_pending {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
    assert!(fixture.peer.check_current().is_err());
    fixture.client.close_and_reap(deadline()).await.unwrap();
    fixture.runner.close_and_reap(deadline()).await.unwrap();
    assert!(!fixture.driver.snapshot().cleanup_pending);
    assert!(fixture.peer.check_current().is_err());
}
