use super::*;
use std::process::Stdio;

#[tokio::test]
async fn bounded_failed_reap_retains_the_actual_child_for_retry() {
    let mut child = Command::new("/bin/sleep")
        .arg("30")
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let id = child.id().unwrap();
    let error = reap_owned_child(&mut child).await.unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    assert_eq!(child.id(), Some(id));
    assert!(child.try_wait().unwrap().is_none());
    child.start_kill().unwrap();
    reap_owned_child(&mut child).await.unwrap();
    assert!(child.id().is_none());
}

#[tokio::test]
async fn failed_cleanup_retains_live_owned_tree_until_retry_succeeds() {
    let mut command = Command::new("/bin/sleep");
    command
        .arg("30")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let (mut child, mut guard) = ProcessTreeGuard::spawn_supervised(&mut command).unwrap();
    guard.fail_cleanup_attempts_for_test(1);
    assert!(guard.terminate(&mut child).await.is_err());
    assert!(child.try_wait().unwrap().is_none());
    assert!(guard.tree_id.is_some());
    assert!(guard.group_leader.is_some());
    guard.terminate(&mut child).await.unwrap();
    assert!(child.try_wait().unwrap().is_some());
    assert!(guard.tree_id.is_none());
    assert!(guard.pgid.is_none());
}

#[tokio::test]
async fn successful_leader_cleanup_failure_retains_supervisor_and_closes_once() {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "exit 0"]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let (mut child, mut guard) = ProcessTreeGuard::spawn_supervised(&mut command).unwrap();
    assert!(child.wait().await.unwrap().success());
    guard.mark_leader_reaped();
    guard.fail_cleanup_attempts_for_test(1);
    assert!(guard.terminate(&mut child).await.is_err());
    assert!(guard.group_leader.is_some());
    assert!(guard.pgid.is_some());
    guard.terminate(&mut child).await.unwrap();
    guard.terminate(&mut child).await.unwrap();
    assert!(guard.tree_id.is_none());
    assert!(guard.group_leader.is_none());
    assert!(guard.pgid.is_none());
}

#[cfg(target_os = "macos")]
#[test]
fn darwin_census_rejects_a_changed_retained_start_identity() {
    let mut child = std::process::Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .unwrap();
    let pid = child.id() as libc::pid_t;
    let mut census = MacosCensus::start(pid);
    census.stop();
    let expected = census.identities.lock().unwrap()[&pid];
    census
        .identities
        .lock()
        .unwrap()
        .insert(pid, (expected.0.saturating_add(1), expected.1));
    assert!(!census.snapshot().contains(&pid));
    assert!(child.try_wait().unwrap().is_none());
    child.kill().unwrap();
    child.wait().unwrap();
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn retained_failed_pidfd_inspection_retries_the_exact_observed_process() {
    let _failure = PIDFD_OPEN_FAILURE_LOCK.lock().await;
    let mut child = std::process::Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .unwrap();
    let pid = child.id() as libc::pid_t;
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let (ppid, pgrp, start_time) = parse_process_stat(&stat).unwrap();
    let mut pending = CapturedDescendants::default();
    pending.pending_inspections.push(ProcessMetadata {
        pid,
        ppid,
        pgrp,
        start_time,
    });
    set_pidfd_open_failure_for_test(pid);
    assert!(pending.signal_retained(libc::SIGKILL).is_err());
    assert_eq!(pending.pending_inspections.len(), 1);
    assert!(child.try_wait().unwrap().is_none());
    set_pidfd_open_failure_for_test(0);
    pending.signal_retained(libc::SIGKILL).unwrap();
    assert!(!child.wait().unwrap().success());
    assert!(pending.all_exited());
}

#[cfg(target_os = "linux")]
#[test]
fn retained_pidfd_proves_exit_before_parent_reaps_its_child() {
    let mut child = std::process::Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .unwrap();
    let pid = child.id() as libc::pid_t;
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let (ppid, pgrp, start_time) = parse_process_stat(&stat).unwrap();
    let identity = ProcessIdentity::capture(ProcessMetadata {
        pid,
        ppid,
        pgrp,
        start_time,
    })
    .unwrap()
    .unwrap();
    assert!(!identity.has_exited().unwrap());
    child.kill().unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while !identity.has_exited().unwrap() {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    // The parent has deliberately not called wait/try_wait before this proof.
    let mut retained = CapturedDescendants::default();
    retained.processes.push(identity);
    assert!(retained.all_exited());
    child.wait().unwrap();
}
