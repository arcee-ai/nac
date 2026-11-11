use super::*;
use std::process::{Child, Command};

#[test]
fn proc_stat_disappearance_is_absent_for_not_found() {
    for error in [
        io::Error::from_raw_os_error(libc::ENOENT),
        io::Error::new(io::ErrorKind::NotFound, "proc row removed"),
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

#[test]
fn proc_esrch_requires_conclusive_original_capability_death() {
    let trace = std::cell::RefCell::new(Vec::new());
    let mut probes = [Ok(()), Err(io::Error::from_raw_os_error(libc::ESRCH))].into_iter();
    let alive = live_with(
        7,
        || {
            trace.borrow_mut().push("original capability");
            probes.next().expect("at most one death bookend")
        },
        || {
            trace.borrow_mut().push("proc stat");
            Err(io::Error::from_raw_os_error(libc::ESRCH))
        },
    )
    .unwrap();
    assert!(!alive);
    assert_eq!(
        *trace.borrow(),
        ["original capability", "proc stat", "original capability"]
    );
    assert!(probes.next().is_none());
}

#[test]
fn proc_esrch_does_not_declare_a_live_original_capability_dead() {
    let probes = std::cell::Cell::new(0);
    let error = live_with(
        7,
        || {
            probes.set(probes.get() + 1);
            Ok(())
        },
        || Err(io::Error::from_raw_os_error(libc::ESRCH)),
    )
    .unwrap_err();
    assert_eq!(error.raw_os_error(), Some(libc::ESRCH));
    assert_eq!(probes.get(), 2);
}

#[test]
fn proc_esrch_preserves_denied_or_unknown_original_capability() {
    for probe_error in [
        io::Error::from_raw_os_error(libc::EPERM),
        io::Error::new(io::ErrorKind::WouldBlock, "original identity uncertain"),
        io::Error::other("original identity unavailable"),
    ] {
        let expected = (
            probe_error.kind(),
            probe_error.raw_os_error(),
            probe_error.to_string(),
        );
        let mut probes = [Ok(()), Err(probe_error)].into_iter();
        let error = live_with(
            7,
            || probes.next().expect("at most one death bookend"),
            || Err(io::Error::from_raw_os_error(libc::ESRCH)),
        )
        .unwrap_err();
        assert_eq!(
            (error.kind(), error.raw_os_error(), error.to_string()),
            expected
        );
        assert!(probes.next().is_none());
    }
}

#[test]
fn unrelated_proc_errors_are_unchanged_without_a_second_probe() {
    for proc_error in [
        io::Error::from_raw_os_error(libc::EACCES),
        io::Error::new(io::ErrorKind::InvalidData, "invalid PTY process stat"),
        io::Error::other("proc inspection unavailable"),
    ] {
        let expected = (
            proc_error.kind(),
            proc_error.raw_os_error(),
            proc_error.to_string(),
        );
        let probes = std::cell::Cell::new(0);
        let error = live_with(
            7,
            || {
                probes.set(probes.get() + 1);
                Ok(())
            },
            || Err(proc_error),
        )
        .unwrap_err();
        assert_eq!(
            (error.kind(), error.raw_os_error(), error.to_string()),
            expected
        );
        assert_eq!(probes.get(), 1);
    }
}

#[test]
fn original_capability_result_precedes_any_numeric_pid_read() {
    for outcome in [
        Err(io::Error::from_raw_os_error(libc::ESRCH)),
        Err(io::Error::from_raw_os_error(libc::EPERM)),
    ] {
        let expected_errno = outcome.as_ref().unwrap_err().raw_os_error();
        let mut outcomes = [outcome].into_iter();
        let result = live_with(
            7,
            || outcomes.next().expect("one original capability probe"),
            || panic!("dead or denied original must not inspect a recycled PID"),
        );
        if expected_errno == Some(libc::ESRCH) {
            assert!(!result.unwrap());
        } else {
            assert_eq!(result.unwrap_err().raw_os_error(), expected_errno);
        }
        assert!(outcomes.next().is_none());
    }
}

#[test]
fn successful_proc_rows_preserve_start_time_and_live_checks() {
    for (observed, expected_alive) in [
        (Some((7, true)), true),
        (Some((8, true)), false),
        (Some((7, false)), false),
        (None, false),
    ] {
        let probes = std::cell::Cell::new(0);
        let alive = live_with(
            7,
            || {
                probes.set(probes.get() + 1);
                Ok(())
            },
            || {
                Ok(observed.map(|(start_time, live)| Row {
                    pid: 123,
                    ppid: 1,
                    sid: 123,
                    live,
                    metadata: crate::ProcessMetadata {
                        pid: 123,
                        ppid: 1,
                        pgrp: 123,
                        start_time,
                    },
                }))
            },
        )
        .unwrap();
        assert_eq!(alive, expected_alive);
        assert_eq!(probes.get(), 1);
    }
}

#[test]
fn proc_stat_esrch_is_bookended_by_the_original_capability() {
    for (second_probe, expected_errno) in [
        (Ok(()), Some(libc::ESRCH)),
        (Err(io::Error::from_raw_os_error(libc::ESRCH)), None),
        (
            Err(io::Error::from_raw_os_error(libc::EPERM)),
            Some(libc::EPERM),
        ),
    ] {
        let mut probes = [Ok(()), second_probe].into_iter();
        let result = live_with(
            7,
            || probes.next().expect("original capability bookend"),
            || row_from_stat(123, Err(io::Error::from_raw_os_error(libc::ESRCH))),
        );
        match expected_errno {
            Some(errno) => assert_eq!(result.unwrap_err().raw_os_error(), Some(errno)),
            None => assert!(!result.unwrap()),
        }
        assert!(probes.next().is_none());
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
