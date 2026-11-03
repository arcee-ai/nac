//! Scoped diagnostics for the existing FD-stress test; never an authority source.
use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::{self, Write};

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
