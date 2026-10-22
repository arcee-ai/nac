use super::super::{
    send::IncomingIds,
    tests::{command, deadline, negotiated_channels, resources, Fixture},
};
use super::*;
use std::time::Duration;
use tokio::io::AsyncReadExt;

#[tokio::test]
async fn retained_completed_input_port_keeps_its_actual_queue_charged() {
    let fixture = Fixture::new(1024, 1).await;
    let mut pipe = fixture
        .client
        .spawn_pipe(command("/bin/echo", &["done"]), deadline())
        .await
        .unwrap();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let (a, b, exit) = tokio::join!(
        pipe.stdout.read_to_end(&mut out),
        pipe.stderr.read_to_end(&mut err),
        pipe.process.wait()
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(exit.unwrap().code, Some(0));
    // The input handle has never been polled or shut down. Its actual Duplex
    // allocation remains reachable even though the target has exited/reaped.
    assert!(fixture.client.pool.reserve(0, 0).is_err());
    drop(pipe.stdin);
    let returned = fixture.client.pool.reserve(0, 0).unwrap();
    drop(returned);
    assert!(fixture.peer.check_current().is_ok());
}

#[tokio::test]
async fn captured_buffers_remain_charged_after_wire_settlement_until_result_transfer() {
    let fixture = Fixture::new(1024, 2).await;
    let release = std::env::temp_dir().join(format!("native-capture-release-{}", Uuid::new_v4()));
    let script = format!(
        "printf retained; exec 1>&- 2>&-; while [ ! -e '{}' ]; do /bin/sleep 0.01; done",
        release.display()
    );
    let mut cmd = command("/bin/sh", &["-c", &script]);
    cmd.stdout_limit = 17;
    cmd.stderr_limit = 7;
    let mut captured = fixture.client.execute(cmd, deadline());
    // Poll actual drain futures through both EOFs while the child is still
    // alive, then leave the caller future unpolled through actual Reaped.
    for _ in 0..20 {
        std::future::poll_fn(|cx| {
            assert!(captured.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        tokio::time::sleep(Duration::from_millis(3)).await;
    }
    std::fs::write(&release, b"release").unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(fixture.client.pool.reserve(0, 0).is_ok());
    // A full independent reservation fits only after Native transfers/drops
    // the retained capture vectors. Ordinary job/port settlement isn't enough.
    assert!(fixture
        .client
        .pool
        .reserve(0, fixture.client.pool.limits().capture_bytes)
        .is_err());
    let output = captured.await.unwrap();
    std::fs::remove_file(release).unwrap();
    assert_eq!(output.stdout, b"retained");
    assert!(fixture
        .client
        .pool
        .reserve(0, fixture.client.pool.limits().capture_bytes)
        .is_ok());
}

#[tokio::test]
async fn delayed_first_writer_cannot_put_second_begin_on_actual_wire() {
    let (a, b) = negotiated_channels().await;
    let limits = resources(1024, 2);
    let pool = ResourcePool::unaccounted_for_test(limits).unwrap();
    let (wire, _peer) = NativeWire::from_negotiated(
        a,
        Direction::ToClient,
        pool.limits().wire_records,
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let (mut target, _target_peer) = NativeWire::from_negotiated(
        b,
        Direction::ToRunner,
        pool.limits().wire_records,
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let sender = wire.sender();
    let tasks = wire.tasks();
    let (gate, denial, original) = sender.physical_observer();
    let mut driver = tokio::process::Command::new("/bin/sleep");
    driver.arg("30");
    let nac_process::NativePipe { process, .. } =
        nac_process::NativePipe::spawn_with_closed_fds(driver, original.into()).unwrap();
    let scope = StopScope::start(gate, denial, Arc::new(process), original).unwrap();
    let (requests, _incoming) = mpsc::channel(2);
    let client = NativeExecutionTransport {
        scope: Arc::clone(&scope),
        pool,
        binding: sender.binding(),
        requests,
        tasks: Arc::clone(&tasks),
        _stop: StopOnDrop::new(Arc::clone(&scope)),
    };
    let (release, blocked) = oneshot::channel();
    let (first_done, second_turn) = oneshot::channel();
    let (second_done, _last) = oneshot::channel();
    let mut ids = JobIds::new();
    let mut entries = Vec::new();
    let mut replies = Vec::new();
    let mut captures = Vec::new();
    for turn in [
        client_send::BeginTurn {
            previous: Some(blocked),
            next: first_done,
        },
        client_send::BeginTurn {
            previous: Some(second_turn),
            next: second_done,
        },
    ] {
        let mut cmd = command("/bin/true", &[]);
        cmd.stdout_limit = 17;
        cmd.stderr_limit = 7;
        let (prepared, capture) = client
            .prepare(cmd, Operation::Execute {}, deadline(), true)
            .unwrap();
        let (reply, received) = oneshot::channel();
        entries.push(
            create(
                ids.take().unwrap(),
                Request { prepared, reply },
                &sender,
                Arc::clone(&scope),
                1024,
                &tasks,
                turn,
            )
            .unwrap(),
        );
        replies.push(received);
        captures.push(capture);
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(40), target.receive())
            .await
            .is_err()
    );
    release.send(()).unwrap();
    let mut order = IncomingIds::new();
    let mut begins = 0;
    while begins < 2 {
        if let Frame::BeginCommand { job_id, .. } = target.receive().await.unwrap() {
            order.accept(job_id).unwrap();
            begins += 1;
        }
    }
    scope.close_and_reap(deadline()).await.unwrap();
    tasks.join(deadline()).await.unwrap();
}

#[tokio::test]
async fn internal_file_child_route_preserves_truncation_without_minting_core_preparation() {
    let fixture = Fixture::new(1024, 2).await;
    let path = std::env::temp_dir().join(format!("native-file-child-{}", Uuid::new_v4()));
    std::fs::write(&path, b"actual child file bytes").unwrap();
    let mut cmd = command("/bin/cat", &[path.to_str().unwrap()]);
    cmd.stdout_limit = 3;
    cmd.stderr_limit = 7;
    let output = fixture
        .client
        .captured(cmd, Operation::FileChild {}, deadline())
        .await
        .unwrap();
    std::fs::remove_file(path).unwrap();
    assert_eq!(output.stdout, b"act");
    assert!(output.stdout_truncated);
    assert!(!output.stderr_truncated);
    assert_eq!(output.exit.code, Some(0));
    // Only this private route is exercised. The opaque public Core prepared
    // wrapper, revision/canonical binding and its production factory stay closed.
}

#[tokio::test]
async fn retained_closed_input_keeps_storage_but_not_completed_deadline_authority() {
    use tokio::io::AsyncWriteExt;
    let fixture = Fixture::new(1024, 2).await;
    let old_deadline = Instant::now() + Duration::from_millis(500);
    let mut old = fixture
        .client
        .spawn_pipe(command("/bin/echo", &["done"]), old_deadline)
        .await
        .unwrap();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let (a, b, exit) = tokio::join!(
        old.stdout.read_to_end(&mut out),
        old.stderr.read_to_end(&mut err),
        old.process.wait()
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(exit.unwrap().code, Some(0));
    // Exactly one slot remains: actual closed stdin capacity is still charged.
    let probe = fixture.client.pool.reserve(0, 0).unwrap();
    assert!(fixture.client.pool.reserve(0, 0).is_err());
    drop(probe);
    let mut next = fixture
        .client
        .spawn_pipe(
            command("/bin/sh", &["-c", "/bin/sleep 0.8; printf successor"]),
            deadline(),
        )
        .await
        .unwrap();
    drop(next.stdin);
    tokio::time::sleep_until((old_deadline + Duration::from_millis(50)).into()).await;
    assert!(fixture.peer.check_current().is_ok());
    assert!(old.stdin.write_all(b"late").await.is_err());
    old.stdin.flush().await.unwrap();
    old.stdin.shutdown().await.unwrap();
    old.process.terminate_and_reap(deadline()).await.unwrap();
    assert_eq!(old.process.wait().await.unwrap().code, Some(0));
    assert!(fixture.peer.check_current().is_ok());
    assert!(fixture.client.pool.reserve(0, 0).is_ok());
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let (a, b, exit) = tokio::join!(
        next.stdout.read_to_end(&mut out),
        next.stderr.read_to_end(&mut err),
        next.process.wait()
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(exit.unwrap().code, Some(0));
    assert_eq!(out, b"successor");
}

mod paused_input_tests;
