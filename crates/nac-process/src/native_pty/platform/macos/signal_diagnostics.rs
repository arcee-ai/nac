//! Existing post-error observation, sharing the fixture's bounded numeric capture.
use super::diagnostics::{self, Stage};
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Duration;

/// Observation only: its result never participates in signaling or cleanup.
#[derive(Default)]
pub(super) struct FailureObservation {
    observed: bool,
}

impl FailureObservation {
    pub(super) fn observe(
        &mut self,
        pid: libc::pid_t,
        retained_uniqueid: u64,
        result: i32,
        send_elapsed: Duration,
        inspect: impl FnOnce() -> io::Result<Option<super::inspection::Snapshot>>,
    ) {
        if result == 0 || self.observed || !diagnostics::observing_signal(pid) {
            return;
        }
        self.observed = true;
        // Preserve #591's once-per-failed-call observation and primary errno.
        // No capability or token is created or retained; failed observation or
        // formatting cannot replace the original audit return code.
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let started = std::time::Instant::now();
            diagnostics::begin(
                Stage::PostAudit,
                pid,
                [result as i128, send_elapsed.as_nanos() as i128, 0],
            );
            match inspect() {
                Ok(Some(snapshot)) => {
                    diagnostics::record(
                        Stage::PostIdentity,
                        pid,
                        1,
                        None,
                        [
                            retained_uniqueid as i128,
                            snapshot.unique.uniqueid as i128,
                            snapshot.unique.version as i128,
                        ],
                    );
                    diagnostics::record(
                        Stage::PostParent,
                        pid,
                        1,
                        None,
                        [
                            snapshot.unique.parent_uniqueid as i128,
                            snapshot.short.ppid as i128,
                            snapshot.sid as i128,
                        ],
                    );
                    diagnostics::record(
                        Stage::PostStatus,
                        pid,
                        1,
                        None,
                        [
                            snapshot.short.status as i128,
                            started.elapsed().as_nanos() as i128,
                            0,
                        ],
                    );
                }
                Ok(None) => diagnostics::record(Stage::PostIdentity, pid, 2, None, [0; 3]),
                Err(error) => {
                    diagnostics::record(Stage::PostIdentity, pid, 3, Some(&error), [0; 3])
                }
            }
        }));
    }
}

#[test]
fn post_error_observation_is_scoped_once_and_cannot_replace_primary_error() {
    use super::diagnostics::Phase;
    use std::cell::Cell;

    let calls = Cell::new(0);
    let mut observation = FailureObservation::default();
    let probe = || {
        calls.set(calls.get() + 1);
        Err(io::Error::from_raw_os_error(libc::EACCES))
    };
    observation.observe(0, 1, libc::EPERM, Duration::ZERO, probe);
    assert_eq!(calls.get(), 0, "inactive diagnostics must not inspect");
    let _scope = diagnostics::Scope::new();
    diagnostics::signal_target(0);
    observation.observe(1, 1, libc::EPERM, Duration::ZERO, probe);
    assert_eq!(calls.get(), 0, "unrelated targets must not inspect");
    observation.observe(0, 1, 0, Duration::ZERO, probe);
    assert_eq!(calls.get(), 0, "successful signals must not inspect");
    let primary = io::Error::from_raw_os_error(libc::EPERM);
    observation.observe(0, 1, libc::EPERM, Duration::ZERO, probe);
    observation.observe(0, 1, libc::ESRCH, Duration::ZERO, probe);
    assert_eq!(calls.get(), 1);
    assert_eq!(primary.raw_os_error(), Some(libc::EPERM));

    let mut panicking = FailureObservation::default();
    panicking.observe(0, 1, libc::EPERM, Duration::ZERO, || panic!("inert probe"));
    assert_eq!(primary.raw_os_error(), Some(libc::EPERM));
    assert!(panicking.observed);
    diagnostics::phase(Phase::Teardown);
    let mut teardown = FailureObservation::default();
    teardown.observe(0, 1, libc::EPERM, Duration::ZERO, probe);
    assert_eq!(calls.get(), 1, "teardown must not add a new inspection");
}

#[test]
fn failed_diagnostic_io_preserves_original_unwind_and_cleanup() {
    use std::cell::Cell;
    use std::io::Write;

    struct FailingWriter<'a>(&'a Cell<usize>);
    impl Write for FailingWriter<'_> {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            self.0.set(self.0.get() + 1);
            Err(io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> io::Result<()> {
            Err(io::ErrorKind::BrokenPipe.into())
        }
    }
    struct Cleanup<'a>(&'a Cell<bool>);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            self.0.set(true);
        }
    }
    struct EmitOnDrop<'a> {
        writes: &'a Cell<usize>,
        panicked: &'a Cell<bool>,
    }
    impl Drop for EmitOnDrop<'_> {
        fn drop(&mut self) {
            let result = catch_unwind(AssertUnwindSafe(|| {
                diagnostics::emit(
                    "NAC_PTY_SIGNAL_DIAGNOSTICS_V1",
                    &mut FailingWriter(self.writes),
                );
            }));
            self.panicked.set(result.is_err());
        }
    }
    struct OriginalSignalError;
    let cleaned = Cell::new(false);
    let writes = Cell::new(0);
    let emission_panicked = Cell::new(false);
    let original = catch_unwind(AssertUnwindSafe(|| {
        let _cleanup = Cleanup(&cleaned);
        let _emission = EmitOnDrop {
            writes: &writes,
            panicked: &emission_panicked,
        };
        std::panic::panic_any(OriginalSignalError);
    }));
    let payload = original.expect_err("original fixture panic was lost");
    assert!(payload.downcast_ref::<OriginalSignalError>().is_some());
    assert!(writes.get() > 0);
    assert!(!emission_panicked.get());
    assert!(cleaned.get());
}
