use super::super::super::job_wire::command::decode_command;
use super::super::{
    capture,
    tests::{command, deadline},
};
use super::*;
use std::time::Duration;

#[tokio::test]
async fn unresolved_spawn_is_never_reported_as_an_empty_reaped_registry() {
    let children = Children::new();
    let id = Uuid::new_v4();
    children.reserve_spawn(id).unwrap();
    children.request_stop(deadline());
    assert!(children.remove_reaped(id).is_err());
    assert!(children.reserve_spawn(Uuid::new_v4()).is_err());
    assert!(tokio::time::timeout(
        Duration::from_millis(40),
        children.wait_for_reap(deadline())
    )
    .await
    .is_err());
}

#[tokio::test]
async fn late_actual_spawn_after_stop_is_retained_stopped_and_observed_reaped() {
    let children = Children::new();
    let id = Uuid::new_v4();
    children.reserve_spawn(id).unwrap();
    let cutoff = deadline();
    children.request_stop(cutoff);
    let (encoded, _) = capture::encode(command("/bin/sleep", &["30"])).unwrap();
    let child = Process::spawn(
        decode_command(&encoded).unwrap(),
        Operation::Pipe {},
        cutoff,
    )
    .unwrap();
    assert!(children.insert(id, Arc::clone(&child.process)).is_err());
    tokio::time::timeout(Duration::from_secs(2), children.wait_for_reap(cutoff))
        .await
        .unwrap()
        .unwrap();
    child.process.wait().await.unwrap();
    children.remove_reaped(id).unwrap();
}
