//! Scoped diagnostics for the existing FD-stress test; never an authority source.
use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::{self, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Duration;

const MAX_EVENTS: usize = 32;
const MAX_EVENT_BYTES: usize = 384;

struct Trace {
    root_pid: u32,
    target_pid: libc::pid_t,
    iteration: usize,
    actor_pid: libc::pid_t,
    actor_uid: libc::uid_t,
    actor_euid: libc::uid_t,
    events: VecDeque<String>,
    dropped: usize,
}

thread_local! {
    static TRACE: RefCell<Option<Trace>> = const { RefCell::new(None) };
}

pub(in crate::native_pty::platform) struct Scope;

impl Scope {
    pub(in crate::native_pty::platform) fn new(
        root_pid: u32,
        target_pid: libc::pid_t,
        iteration: usize,
    ) -> Self {
        // SAFETY: these scalar caller-identity queries have no preconditions.
        let (actor_pid, actor_uid, actor_euid) =
            unsafe { (libc::getpid(), libc::getuid(), libc::geteuid()) };
        TRACE.with(|slot| {
            *slot.borrow_mut() = Some(Trace {
                root_pid,
                target_pid,
                iteration,
                actor_pid,
                actor_uid,
                actor_euid,
                events: VecDeque::new(),
                dropped: 0,
            });
        });
        Self
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        let trace = TRACE.with(|slot| slot.borrow_mut().take());
        if let Some(trace) = trace {
            // Also emits on the original unwrap panic, before Root teardown.
            // Store no Arc, capability, token provenance, path or environment.
            emit(&trace, &mut io::stderr());
        }
    }
}

fn emit(trace: &Trace, output: &mut impl Write) {
    // Diagnostics must not introduce a second panic during fixture unwind.
    let _ = writeln!(
        output,
        "NAC_PROCESS_SIGNAL_DIAGNOSTIC root_pid={} target_pid={} iteration={} actor_pid={} actor_uid={} actor_euid={} dropped={} events={:?}",
        trace.root_pid, trace.target_pid, trace.iteration, trace.actor_pid,
        trace.actor_uid, trace.actor_euid, trace.dropped, trace.events,
    );
}

pub(super) fn record(pid: libc::pid_t, event: impl FnOnce() -> String) {
    TRACE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(trace) = slot.as_mut().filter(|trace| trace.target_pid == pid) else {
            return;
        };
        if trace.events.len() == MAX_EVENTS {
            trace.events.pop_front();
            trace.dropped += 1;
        }
        // Callers format fixed ASCII labels and scalar numbers only.
        let mut event = event();
        event.truncate(MAX_EVENT_BYTES);
        trace.events.push_back(event);
    });
}

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
        if result == 0 || self.observed {
            return;
        }
        let active = TRACE.with(|slot| {
            slot.borrow()
                .as_ref()
                .is_some_and(|trace| trace.target_pid == pid)
        });
        if !active {
            return;
        }
        self.observed = true;
        // Keep the original audit return code primary even if observation or
        // formatting panics. No capability or token is created or retained.
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let started = std::time::Instant::now();
            record(pid, || {
                format!(
                    "stage=post_audit.begin return_code={result} send_elapsed_ns={}",
                    send_elapsed.as_nanos()
                )
            });
            let snapshot = inspect();
            record(pid, || {
                match snapshot {
                Ok(Some(snapshot)) => format!(
                    "stage=post_audit.snapshot retained_uniqueid={retained_uniqueid} current_uniqueid={} version={} parent_uniqueid={} ppid={} sid={} status={} elapsed_ns={}",
                    snapshot.unique.uniqueid, snapshot.unique.version,
                    snapshot.unique.parent_uniqueid, snapshot.short.ppid,
                    snapshot.sid, snapshot.short.status, started.elapsed().as_nanos(),
                ),
                Ok(None) => format!("stage=post_audit.absent elapsed_ns={}", started.elapsed().as_nanos()),
                Err(error) => format!(
                    "stage=post_audit.error error_kind={:?} raw_errno={:?} elapsed_ns={}",
                    error.kind(), error.raw_os_error(), started.elapsed().as_nanos(),
                ),
            }
            });
        }));
    }
}

#[test]
fn post_error_observation_is_scoped_once_and_cannot_replace_primary_error() {
    use std::cell::Cell;

    let calls = Cell::new(0);
    let mut observation = FailureObservation::default();
    let probe = || {
        calls.set(calls.get() + 1);
        Err(io::Error::from_raw_os_error(libc::EACCES))
    };
    observation.observe(0, 1, libc::EPERM, Duration::ZERO, probe);
    assert_eq!(calls.get(), 0, "inactive diagnostics must not inspect");
    let _scope = Scope::new(0, 0, 0);
    observation.observe(0, 1, 0, Duration::ZERO, probe);
    assert_eq!(calls.get(), 0, "successful signals must not inspect");
    let primary = io::Error::from_raw_os_error(libc::EPERM);
    observation.observe(0, 1, libc::EPERM, Duration::ZERO, probe);
    observation.observe(0, 1, libc::ESRCH, Duration::ZERO, probe);
    assert_eq!(calls.get(), 1);
    assert_eq!(primary.raw_os_error(), Some(libc::EPERM));
    TRACE.with(|slot| {
        let trace = slot.borrow();
        let events = &trace.as_ref().unwrap().events;
        assert!(events
            .iter()
            .any(|event| event.contains("stage=post_audit.error")));
    });

    let mut panicking = FailureObservation::default();
    panicking.observe(0, 1, libc::EPERM, Duration::ZERO, || panic!("inert probe"));
    assert_eq!(primary.raw_os_error(), Some(libc::EPERM));
    assert!(panicking.observed);
}

#[test]
fn bounded_trace_reports_overflow_and_caps_each_event() {
    let _scope = Scope::new(0, 0, 0);
    for _ in 0..MAX_EVENTS + 3 {
        record(0, || "x".repeat(MAX_EVENT_BYTES + 1));
    }
    TRACE.with(|slot| {
        let trace = slot.borrow();
        let trace = trace.as_ref().unwrap();
        assert_eq!(trace.dropped, 3);
        assert_eq!(trace.events.len(), MAX_EVENTS);
        assert!(trace
            .events
            .iter()
            .all(|event| event.len() == MAX_EVENT_BYTES));
    });
}

#[test]
fn failed_diagnostic_io_preserves_original_unwind_and_cleanup() {
    use std::cell::Cell;
    use std::panic::{catch_unwind, AssertUnwindSafe};

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
        trace: &'a Trace,
        writes: &'a Cell<usize>,
        panicked: &'a Cell<bool>,
    }
    impl Drop for EmitOnDrop<'_> {
        fn drop(&mut self) {
            // Catch a logging regression inside Drop so this inert control
            // records it without double-panic aborting the whole test process.
            let result = catch_unwind(AssertUnwindSafe(|| {
                emit(self.trace, &mut FailingWriter(self.writes));
            }));
            self.panicked.set(result.is_err());
        }
    }
    struct OriginalSignalError;
    let trace = Trace {
        root_pid: 0,
        target_pid: 0,
        iteration: 0,
        actor_pid: 0,
        actor_uid: 0,
        actor_euid: 0,
        events: VecDeque::new(),
        dropped: 0,
    };
    let cleaned = Cell::new(false);
    let writes = Cell::new(0);
    let emission_panicked = Cell::new(false);
    let original = catch_unwind(AssertUnwindSafe(|| {
        let _cleanup = Cleanup(&cleaned);
        let _emission = EmitOnDrop {
            trace: &trace,
            writes: &writes,
            panicked: &emission_panicked,
        };
        std::panic::panic_any(OriginalSignalError);
    }));
    let payload = match original {
        Err(payload) => payload,
        Ok(()) => panic!("original fixture panic was lost"),
    };
    assert!(payload.downcast_ref::<OriginalSignalError>().is_some());
    assert!(writes.get() > 0);
    assert!(!emission_panicked.get());
    assert!(cleaned.get());
}
