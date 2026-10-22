use super::super::super::{
    job_wire::{command::decode_command, Direction, Operation},
    wire_pump::NativeWire,
};
use super::super::{
    capture,
    child::Children,
    tests::{command, deadline, negotiated_channels},
};
use super::*;
use std::{num::NonZeroUsize, time::Duration};

#[tokio::test]
async fn actual_resize_reserved_before_exit_is_acknowledged_before_reaped() {
    let (a, b) = negotiated_channels().await;
    let (mut client, _peer) = NativeWire::from_negotiated(
        a,
        Direction::ToClient,
        NonZeroUsize::new(2).unwrap(),
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let (wire, _target_peer) = NativeWire::from_negotiated(
        b,
        Direction::ToRunner,
        NonZeroUsize::new(2).unwrap(),
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let sender = wire.sender();
    let (gate, denial, original) = sender.physical_observer();
    let children = Children::new();
    let scope = StopScope::start(gate, denial, children.clone(), original).unwrap();
    let (encoded, _) = capture::encode(command("/bin/sh", &["-c", "exec /bin/sleep 0.1"])).unwrap();
    let id = Uuid::new_v4();
    children.reserve_spawn(id).unwrap();
    let child = Process::spawn(
        decode_command(&encoded).unwrap(),
        Operation::Pty { rows: 24, cols: 80 },
        original,
    )
    .unwrap();
    children.insert(id, Arc::clone(&child.process)).unwrap();
    let changed = Arc::new(Notify::new());
    let job = RunnerJob::new(Arc::clone(&child.process), 1024, Arc::clone(&changed), true).unwrap();
    let (mut sink, input, receiver) = Receiver::pair(
        id,
        Stream::Stdin,
        1024,
        changed,
        Arc::clone(&scope),
        &sender,
        original,
    )
    .unwrap();
    let tasks = wire.tasks();
    let writer = job
        .spawn(
            child,
            input,
            receiver,
            JobLink {
                id,
                wire: sender,
                scope: Arc::clone(&scope),
                deadline: original,
                tasks,
            },
        )
        .unwrap();
    assert!(matches!(
        client.receive().await.unwrap(),
        Frame::Started { .. }
    ));
    job.grant(Stream::PtyOutput, 1024).unwrap();
    job.stdin_eof().unwrap();
    sink.finish().unwrap();
    // Pause at the actual reservation/ioctl boundary while the real child exits.
    job.reserve_resize(1).unwrap();
    loop {
        let record = client.receive().await.unwrap();
        assert!(!matches!(record, Frame::Reaped { .. }));
        if matches!(record, Frame::Exited { .. }) {
            break;
        }
    }
    assert!(tokio::time::timeout(Duration::from_millis(40), async {
        loop {
            if matches!(client.receive().await.unwrap(), Frame::Reaped { .. }) {
                break;
            }
        }
    })
    .await
    .is_err());
    job.process.resize(47, 137).unwrap();
    job.complete_resize(1).unwrap();
    let mut resized = false;
    loop {
        match client.receive().await.unwrap() {
            Frame::Resized { control_id: 1, .. } => {
                assert!(!resized);
                resized = true;
            }
            Frame::Reaped { .. } => {
                assert!(resized);
                break;
            }
            _ => {}
        }
    }
    writer.await.unwrap().unwrap();
    scope.close_and_reap(deadline()).await.unwrap();
}
