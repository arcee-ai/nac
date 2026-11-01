//! Pure injected Probe/AuditSignal tests: no Native probe, child or real signal.
use super::super::{AuditSignal, Identity};
use super::*;
use std::cell::RefCell;

#[derive(Default)]
struct Fake {
    calls: Vec<&'static str>,
    fail_at: Option<usize>,
    errno: i32,
    uniqueid: u64,
    status: u32,
    versions: Vec<i32>,
    sends: Vec<i32>,
    sent_versions: Vec<i32>,
    torn: bool,
    gone: bool,
}
thread_local! {
    static FAKE: RefCell<Fake> = RefCell::new(Fake::default());
    static EMITTED: RefCell<Option<String>> = const { RefCell::new(None) };
}
struct Probe {
    version: i32,
    unique_calls: Cell<i32>,
}
fn call(name: &'static str) -> io::Result<()> {
    FAKE.with(|fake| {
        let mut fake = fake.borrow_mut();
        fake.calls.push(name);
        if fake.fail_at == Some(fake.calls.len()) {
            Err(io::Error::from_raw_os_error(fake.errno))
        } else {
            Ok(())
        }
    })
}
impl inspection::Probe for Probe {
    fn unique(&self, _: libc::pid_t) -> io::Result<Option<Unique>> {
        call("unique")?;
        if FAKE.with(|f| f.borrow().gone) {
            return Ok(None);
        }
        let offset = FAKE.with(|f| {
            if f.borrow().torn {
                self.unique_calls.get()
            } else {
                0
            }
        });
        self.unique_calls.set(self.unique_calls.get() + 1);
        Ok(Some(Unique {
            uniqueid: FAKE.with(|f| f.borrow().uniqueid),
            parent_uniqueid: 9,
            version: self.version + offset,
        }))
    }
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<inspection::Short>> {
        call("short")?;
        Ok(Some(inspection::Short {
            pid,
            ppid: 50,
            status: FAKE.with(|f| f.borrow().status),
        }))
    }
    fn sid(&self, _: libc::pid_t) -> io::Result<Option<libc::pid_t>> {
        call("sid")?;
        Ok(Some(900))
    }
}
fn inspect_fake(pid: libc::pid_t) -> io::Result<Option<Row>> {
    let version = FAKE.with(|f| {
        let mut f = f.borrow_mut();
        if f.versions.is_empty() {
            1
        } else {
            f.versions.remove(0)
        }
    });
    inspection::snapshot(
        pid,
        &Probe {
            version,
            unique_calls: Cell::new(0),
        },
    )?
    .map(inspection::Snapshot::row)
    .transpose()
}
unsafe extern "C" fn send_fake(key: *const [u32; 8], signal: i32) -> i32 {
    // SAFETY: Identity::signal_with passes initialized, live token-sized storage.
    let key = unsafe { &*key };
    assert_eq!(signal, libc::SIGKILL);
    assert_eq!(key[5], 200);
    assert!(key
        .iter()
        .enumerate()
        .all(|(i, value)| i == 5 || i == 7 || *value == 0));
    FAKE.with(|fake| {
        let mut fake = fake.borrow_mut();
        fake.calls.push("send");
        fake.sent_versions.push(key[7] as i32);
        if fake.sends.is_empty() {
            0
        } else {
            fake.sends.remove(0)
        }
    })
}
fn reset_fake() {
    FAKE.with(|f| {
        *f.borrow_mut() = Fake {
            uniqueid: 7,
            status: 3,
            errno: libc::EPERM,
            ..Fake::default()
        }
    });
}
fn scope() -> Scope {
    reset_fake();
    let scope = Scope::with_inspector(Some(inspect_fake));
    phase(Phase::Signal);
    scope
}
fn census_scope() -> Scope {
    reset_fake();
    Scope::with_capture(Some(inspect_fake), Some(0))
}
fn signal() -> io::Result<bool> {
    Identity {
        pid: 200,
        uniqueid: 7,
    }
    .signal_with(libc::SIGKILL, send_fake as AuditSignal)
}
fn calls() -> Vec<&'static str> {
    FAKE.with(|f| f.borrow().calls.clone())
}

#[test]
fn inspection_errno_source_and_original_order_are_preserved() {
    let order = ["unique", "short", "sid", "short", "sid", "unique"];
    let stages = [
        "unique-first",
        "short-before",
        "sid-before",
        "short-after",
        "sid-after",
        "unique-last",
    ];
    for index in 0..6 {
        for errno in [libc::EPERM, libc::EACCES, libc::EIO] {
            let mut scope = scope();
            FAKE.with(|f| {
                f.borrow_mut().fail_at = Some(index + 1);
                f.borrow_mut().errno = errno;
            });
            let error = signal().unwrap_err();
            assert_eq!(error.raw_os_error(), Some(errno));
            assert_eq!(error.kind(), io::Error::from_raw_os_error(errno).kind());
            assert_eq!(calls(), order[..=index]); // No send or extra inspection after failure.
            let text = scope.take().unwrap();
            assert!(text.contains(&format!(
                "stage={} pid=200 result=3 errno={errno}",
                stages[index]
            )));
            assert!(text.contains(&format!("stage=inspect pid=200 result=3 errno={errno}")));
            assert!(!text.contains("stage=native-send"));
        }
    }
}

#[test]
fn native_send_denial_is_distinct_and_keeps_original_errno() {
    let mut scope = scope();
    FAKE.with(|f| f.borrow_mut().sends = vec![libc::EPERM]);
    let error = signal().unwrap_err();
    assert_eq!(error.raw_os_error(), Some(libc::EPERM));
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(
        calls(),
        ["unique", "short", "sid", "short", "sid", "unique", "send"]
    );
    let text = scope.take().unwrap();
    assert!(text.contains("stage=native-send pid=200 result=3 errno=1 kind=1"));
    assert!(!text.contains("stage=inspect pid=200 result=3"));
}

#[test]
fn existing_version_retry_order_and_three_attempt_bound_are_unchanged() {
    for results in [vec![libc::ESRCH, 0], vec![libc::ESRCH; 3]] {
        let mut scope = scope();
        FAKE.with(|f| {
            let mut f = f.borrow_mut();
            f.versions = vec![11, 12, 13];
            f.sends = results.clone();
        });
        let result = signal();
        if results.len() == 2 {
            assert!(result.unwrap());
        } else {
            let error = result.unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
            assert_eq!(error.raw_os_error(), None);
        }
        let order =
            ["unique", "short", "sid", "short", "sid", "unique", "send"].repeat(results.len());
        assert_eq!(calls(), order);
        assert_eq!(
            FAKE.with(|f| f.borrow().sent_versions.clone()),
            [11, 12, 13][..results.len()]
        );
        let text = scope.take().unwrap();
        assert_eq!(text.matches("stage=native-send").count(), results.len());
        assert_eq!(text.matches("stage=validate").count(), results.len());
    }
}

#[test]
fn replacement_dead_and_torn_records_never_gain_signal_authority() {
    for (id, status) in [(8, 3), (7, 5)] {
        let mut scope = scope();
        FAKE.with(|f| {
            f.borrow_mut().uniqueid = id;
            f.borrow_mut().status = status;
        });
        assert!(!signal().unwrap());
        assert!(!calls().contains(&"send"));
        assert!(scope
            .take()
            .unwrap()
            .contains("stage=validate pid=200 result=2"));
    }
    let mut scope = scope();
    FAKE.with(|f| f.borrow_mut().torn = true);
    assert_eq!(signal().unwrap_err().kind(), io::ErrorKind::WouldBlock);
    assert_eq!(calls().len(), 18);
    assert!(!calls().contains(&"send"));
    assert!(scope
        .take()
        .unwrap()
        .contains("stage=inspect pid=200 result=3 errno=none kind=4"));
}

#[test]
fn budgets_keep_failure_and_teardown_results_separate_and_private() {
    for census in [false, true] {
        let mut scope = if census { census_scope() } else { scope() };
        if census {
            scope.begin_iteration();
            phase(Phase::Signal);
        }
        let error = io::Error::from_raw_os_error(libc::EPERM);
        result::<()>(Stage::NativeSend, 200, &Err(error), [9, 1, 1]);
        for _ in 0..2000 {
            record(Stage::Validate, i32::MAX, 1, None, [u64::MAX as i128; 3]);
        }
        if census {
            assert!(CAPTURE.with(|slot| slot.borrow().as_ref().unwrap().dropped[0] > 0));
            scope.begin_iteration();
            phase(Phase::Signal);
            assert!(CAPTURE.with(|slot| slot.borrow().as_ref().unwrap().dropped[0] == 0));
            native_send(200, libc::SIGKILL, 1, libc::EPERM);
        }
        phase(Phase::Teardown);
        for _ in 0..2000 {
            record(Stage::UniqueFirst, 200, 1, None, [u64::MAX as i128; 3]);
        }
        for stage in [
            Stage::Leader,
            Stage::Members,
            Stage::Job,
            Stage::ChildKill,
            Stage::ChildWait,
        ] {
            begin(stage, 200, [0; 3]);
            result::<()>(
                stage,
                200,
                &Err(io::Error::other("PRIVATE-ENV-ARGS-FILE-CREDENTIAL")),
                [0; 3],
            );
        }
        let text = scope.take().unwrap();
        assert!(text.len() <= 8192);
        assert!(text.contains("stage=native-send pid=200 result=3 errno=1"));
        for stage in ["leader", "members", "job", "child-kill", "child-wait"] {
            assert!(text.contains(&format!("stage={stage} pid=200 result=3 errno=none kind=6")));
        }
        assert!(!text.contains("dropped=0,0,0"));
        assert!(!text.contains("PRIVATE"));
        assert!(!text.contains("settled"));
    }
}

#[test]
fn inactive_other_thread_and_nested_scopes_cannot_replace_capture() {
    begin(Stage::NativeSend, 200, [0; 3]);
    assert!(CAPTURE.with(|s| s.borrow().is_none()));
    let mut outer = scope();
    begin(Stage::Validate, 200, [7, 7, 1]);
    let mut nested = Scope::new();
    assert!(nested.take().is_none());
    drop(nested);
    std::thread::spawn(|| {
        begin(Stage::Validate, 999, [0; 3]);
        assert!(CAPTURE.with(|s| s.borrow().is_none()));
    })
    .join()
    .unwrap();
    let text = outer.take().unwrap();
    assert_eq!(text.matches("stage=validate").count(), 1);
    assert!(!text.contains("pid=999"));
    assert!(CAPTURE.with(|s| s.borrow().is_none()));
}

#[test]
fn unwind_emits_after_existing_fake_cleanup_results_without_success_conversion() {
    struct Cleanup;
    impl Drop for Cleanup {
        fn drop(&mut self) {
            phase(Phase::Teardown);
            for stage in [
                Stage::Leader,
                Stage::Members,
                Stage::Job,
                Stage::ChildKill,
                Stage::ChildWait,
            ] {
                begin(stage, 200, [0; 3]);
                result::<()>(
                    stage,
                    200,
                    &Err(io::Error::from_raw_os_error(libc::EPERM)),
                    [0; 3],
                );
            }
        }
    }
    let failure = std::panic::catch_unwind(|| {
        let mut capture = scope();
        capture.emit = |text| EMITTED.with(|slot| *slot.borrow_mut() = Some(text.to_owned()));
        let _cleanup = Cleanup;
        FAKE.with(|f| f.borrow_mut().sends = vec![libc::EPERM]);
        signal().unwrap(); // The unchanged failure remains a panic.
    });
    assert!(failure.is_err());
    let text = EMITTED.with(|slot| slot.borrow_mut().take().unwrap());
    assert!(text.contains("panicking=1"));
    let mut last = 0;
    for stage in [
        "native-send",
        "leader",
        "members",
        "job",
        "child-kill",
        "child-wait",
    ] {
        let index = text.find(&format!("stage={stage}")).unwrap();
        assert!(index >= last);
        last = index;
    }
    assert_eq!(text.matches("result=3 errno=1").count(), 6);
    assert!(CAPTURE.with(|s| s.borrow().is_none()));
}

#[test]
fn unavailable_inspection_and_resolver_never_become_successful_signal() {
    let mut scope = scope();
    FAKE.with(|f| f.borrow_mut().gone = true);
    assert!(!signal().unwrap());
    assert_eq!(calls(), ["unique"]);
    let text = scope.take().unwrap();
    assert!(text.contains("stage=unique-first pid=200 result=2"));
    assert!(text.contains("stage=inspect pid=200 result=2"));
    assert!(!text.contains("stage=native-send"));
    let mut scope = Scope::new();
    phase(Phase::Signal);
    let error = resolve(super::super::require_signal_function(None)).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    assert_eq!(error.raw_os_error(), None);
    assert!(scope
        .take()
        .unwrap()
        .contains("stage=resolve pid=0 result=3 errno=none kind=5"));
}

#[test]
fn census_child_label_and_rotation_keep_only_iteration_48() {
    let mut capture = Scope::census();
    for iteration in 1..=48 {
        capture.begin_iteration();
        phase(Phase::Signal);
        native_send(iteration, libc::SIGKILL, iteration, 0);
        phase(Phase::Prune);
    }
    let text = capture.take().unwrap();
    assert!(text.starts_with("NAC_PTY_SIGNAL_DIAGNOSTICS_V1 test=active-census iteration=48 panicking=0 dropped=0,0,0 records=1\n"));
    assert_eq!(text.matches("stage=native-send").count(), 1);
    assert!(text.contains("pid=48 result=1 errno=none kind=0 a=9 b=48 c=0"));
    assert!(!text.contains("pid=47 "));
    assert!(text.len() <= 8192);
}

#[test]
fn late_census_failure_emits_after_fake_teardown_without_converting_errno() {
    struct Cleanup;
    impl Drop for Cleanup {
        fn drop(&mut self) {
            phase(Phase::Teardown);
            begin(Stage::ChildWait, 50, [0; 3]);
            result::<()>(
                Stage::ChildWait,
                50,
                &Err(io::Error::from_raw_os_error(libc::EIO)),
                [0; 3],
            );
        }
    }
    let failure = std::panic::catch_unwind(|| {
        let mut capture = census_scope();
        capture.emit = |text| EMITTED.with(|slot| *slot.borrow_mut() = Some(text.to_owned()));
        let _cleanup = Cleanup;
        for iteration in 1..48 {
            capture.begin_iteration();
            phase(Phase::Signal);
            native_send(100 + iteration, libc::SIGKILL, iteration, 0);
        }
        capture.begin_iteration();
        phase(Phase::Signal);
        FAKE.with(|f| f.borrow_mut().sends = vec![libc::EPERM]);
        let result = signal();
        assert_eq!(
            result.as_ref().unwrap_err().raw_os_error(),
            Some(libc::EPERM)
        );
        assert_eq!(
            calls(),
            ["unique", "short", "sid", "short", "sid", "unique", "send"]
        );
        result.unwrap(); // Preserve the original error and panic.
    });
    assert!(failure.is_err());
    let text = EMITTED.with(|slot| slot.borrow_mut().take().unwrap());
    assert!(text.starts_with(
        "NAC_PTY_SIGNAL_DIAGNOSTICS_V1 test=active-census iteration=48 panicking=1 dropped=0,0,0"
    ));
    assert!(text.contains("stage=native-send pid=200 result=3 errno=1 kind=1"));
    assert!(text.contains("stage=child-wait pid=50 result=3 errno=5"));
    assert_eq!(text.matches("stage=native-send").count(), 1);
    assert!(text.find("stage=native-send").unwrap() < text.find("stage=child-wait").unwrap());
    assert!(CAPTURE.with(|slot| slot.borrow().is_none()));
}

#[test]
fn prune_header_and_rows_survive_census_rotation_requests_unchanged() {
    let mut capture = Scope::new();
    phase(Phase::Signal);
    begin(Stage::Validate, 200, [7, 7, 1]);
    capture.begin_iteration(); // A prune scope never becomes a census scope.
    let mut nested = Scope::census();
    nested.begin_iteration(); // An inactive nested scope cannot rotate its owner.
    assert!(nested.take().is_none());
    let text = capture.take().unwrap();
    assert_eq!(text, "NAC_PTY_SIGNAL_DIAGNOSTICS_V1 test=active-prune panicking=0 dropped=0,0,0 records=1\nseq=1 phase=2 stage=validate pid=200 result=0 errno=none kind=0 a=7 b=7 c=1\n");
}

#[test]
fn census_setup_and_prune_do_not_fill_the_signal_budget() {
    let mut capture = Scope::census();
    capture.begin_iteration();
    begin(Stage::UniqueFirst, 100, [0; 3]);
    phase(Phase::Signal);
    begin(Stage::Validate, 200, [7, 7, 1]);
    phase(Phase::Prune);
    begin(Stage::UniqueFirst, 300, [0; 3]);
    let text = capture.take().unwrap();
    assert!(text.contains("test=active-census iteration=1"));
    assert!(text.contains("records=1\n"));
    assert!(!text.contains("stage=unique-first"));
    assert!(text.contains("stage=validate pid=200"));
}

#[test]
fn census_teardown_prevents_rotation_of_the_failure_and_result_budgets() {
    let mut capture = Scope::census();
    capture.begin_iteration();
    phase(Phase::Signal);
    native_send(200, libc::SIGKILL, 7, libc::EPERM);
    phase(Phase::Teardown);
    begin(Stage::ChildWait, 50, [0; 3]);
    result::<()>(Stage::ChildWait, 50, &Ok(()), [9, 0, 0]);
    capture.begin_iteration();
    let text = capture.take().unwrap();
    assert!(text.contains("test=active-census iteration=1"));
    assert!(text.contains("stage=native-send pid=200 result=3 errno=1"));
    assert!(text.contains("stage=child-wait pid=50 result=1 errno=none kind=0 a=9"));
    assert!(text.contains("records=3\n"));
}
