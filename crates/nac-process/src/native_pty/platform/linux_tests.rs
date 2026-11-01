use super::*;
use std::process::{Child, Command};

#[test]
fn proc_stat_disappearance_is_absent_for_not_found_and_esrch() {
    for error in [
        io::Error::from_raw_os_error(libc::ENOENT),
        io::Error::new(io::ErrorKind::NotFound, "proc row removed"),
        io::Error::from_raw_os_error(libc::ESRCH),
    ] {
        assert!(row_from_stat(123, Err(error)).unwrap().is_none());
    }
}

#[test]
fn proc_stat_permission_and_io_errors_remain_errors() {
    for code in [libc::EACCES, libc::EPERM, libc::EIO] {
        let error = row_from_stat(123, Err(io::Error::from_raw_os_error(code)))
            .err()
            .expect("inspection failure must not become an absent row");
        assert_eq!(error.raw_os_error(), Some(code));
    }
    for kind in [io::ErrorKind::WouldBlock, io::ErrorKind::InvalidData] {
        let error = row_from_stat(123, Err(io::Error::new(kind, "retained read uncertainty")))
            .err()
            .expect("non-disappearance errors must be retained");
        assert_eq!(error.kind(), kind);
        assert_eq!(error.to_string(), "retained read uncertainty");
    }
}

#[test]
fn proc_stat_metadata_and_liveness_are_preserved() {
    for (state, live) in [("S", true), ("Z", false), ("X", false)] {
        let stat = format!(
            "123 (command with ) parens) {state} 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23"
        );
        let row = row_from_stat(123, Ok(stat)).unwrap().unwrap();
        assert_eq!(row.key(), (123, 22));
        assert_eq!((row.ppid, row.sid, row.live), (4, 6, live));
        assert_eq!(row.metadata.ppid, 4);
        assert_eq!(row.metadata.pgrp, 5);
    }
}

#[test]
fn malformed_proc_stat_is_not_an_absent_row() {
    for stat in [
        "invalid stat",
        "123 (missing terminator S 4 5 6",
        "123 (name) S bad 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23",
        "123 (name) S 4 5 bad 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23",
        "123 (name) S 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 bad 23",
    ] {
        let error = row_from_stat(123, Ok(stat.to_owned()))
            .err()
            .expect("malformed process metadata must retain inspection uncertainty");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
fn foreign_child_of_recycled_parent_identity_is_not_adopted() {
    let fixture = Fixture(Command::new("/bin/sleep").arg("30").spawn().unwrap());
    let row = read(fixture.0.id() as libc::pid_t).unwrap().unwrap();
    let parent = read(row.ppid).unwrap().unwrap();
    let mut retired = Fixture(Command::new("/bin/sleep").arg("30").spawn().unwrap());
    let retired_row = read(retired.0.id() as libc::pid_t).unwrap().unwrap();
    let mut original = Identity::capture(retired_row).unwrap().unwrap();
    retired.0.kill().unwrap();
    retired.0.wait().unwrap();
    // Emulate a same-jiffy replacement: numeric PID and start time both
    // appear to match, while the ORIGINAL parent pidfd identifies death.
    original.0.metadata = parent.metadata;
    let error = match Identity::capture_owned(
        row,
        super::super::Evidence::Parent(std::sync::Arc::new(original)),
    ) {
        Err(error) => error,
        Ok(_) => panic!("foreign replacement-parent child was accepted"),
    };
    assert_eq!(error.raw_os_error(), Some(libc::ESRCH));
    assert!(read(fixture.0.id() as libc::pid_t).unwrap().unwrap().live);
}
#[test]
fn exact_live_parent_and_child_identity_can_be_captured() {
    let fixture = Fixture(Command::new("/bin/sleep").arg("30").spawn().unwrap());
    let row = read(fixture.0.id() as libc::pid_t).unwrap().unwrap();
    let parent = read(row.ppid).unwrap().unwrap();
    let identity = Identity::capture_owned(
        row,
        super::super::Evidence::Parent(std::sync::Arc::new(
            Identity::capture(parent).unwrap().unwrap(),
        )),
    )
    .unwrap()
    .unwrap();
    assert!(identity.live().unwrap());
}
#[test]
fn changed_original_parent_stamp_retains_child_capture_uncertainty() {
    let fixture = Fixture(Command::new("/bin/sleep").arg("30").spawn().unwrap());
    let row = read(fixture.0.id() as libc::pid_t).unwrap().unwrap();
    let parent = Identity::capture(read(row.ppid).unwrap().unwrap())
        .unwrap()
        .unwrap();
    let error = parent.require_original_start(parent.0.metadata.start_time.wrapping_add(1));
    assert!(error.is_err());
    assert!(parent.capability_live().unwrap());
    assert!(read(row.pid).unwrap().unwrap().live);
}
#[test]
fn conclusive_original_child_death_resolves_pending_capture() {
    let mut fixture = Fixture(Command::new("/bin/sleep").arg("30").spawn().unwrap());
    let row = read(fixture.0.id() as libc::pid_t).unwrap().unwrap();
    let parent = Identity::capture(read(row.ppid).unwrap().unwrap())
        .unwrap()
        .unwrap();
    fixture.0.kill().unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while read(row.pid).unwrap().is_some_and(|current| current.live) {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(Identity::capture_owned(
        row,
        super::super::Evidence::Parent(std::sync::Arc::new(parent))
    )
    .unwrap()
    .is_none());
}
