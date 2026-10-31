//! One-test, in-memory observations. Compiled out of non-test builds.
use super::{inspection, Row, Unique};
use std::cell::{Cell, RefCell};
use std::io::{self, Write};
use std::marker::PhantomData;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq)]
pub(in crate::native_pty::platform) enum Phase {
    Setup,
    CapturedRow,
    Signal,
    Prune,
    Teardown,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::native_pty::platform) enum Stage {
    Resolve,
    UniqueFirst,
    ShortBefore,
    SidBefore,
    ShortAfter,
    SidAfter,
    UniqueLast,
    Inspect,
    Validate,
    NativeSend,
    Counts,
    Leader,
    Members,
    Job,
    ChildKill,
    ChildWait,
}
impl Stage {
    fn label(self) -> &'static str {
        match self {
            Self::Resolve => "resolve",
            Self::UniqueFirst => "unique-first",
            Self::ShortBefore => "short-before",
            Self::SidBefore => "sid-before",
            Self::ShortAfter => "short-after",
            Self::SidAfter => "sid-after",
            Self::UniqueLast => "unique-last",
            Self::Inspect => "inspect",
            Self::Validate => "validate",
            Self::NativeSend => "native-send",
            Self::Counts => "counts",
            Self::Leader => "leader",
            Self::Members => "members",
            Self::Job => "job",
            Self::ChildKill => "child-kill",
            Self::ChildWait => "child-wait",
        }
    }
    fn teardown_call(self) -> bool {
        matches!(
            self,
            Self::Counts
                | Self::Leader
                | Self::Members
                | Self::Job
                | Self::ChildKill
                | Self::ChildWait
        )
    }
}
type Inspector = fn(libc::pid_t) -> io::Result<Option<Row>>;
struct Capture {
    phase: Phase,
    buffers: [String; 3],
    dropped: [u32; 3],
    sequence: u32,
    inspector: Option<Inspector>,
}
thread_local! {
    static CAPTURE: RefCell<Option<Capture>> = const { RefCell::new(None) };
}

// !Send prevents moving the guard to a different thread's capture.
pub(in crate::native_pty::platform) struct Scope {
    active: bool,
    emit: fn(&str),
    _thread: PhantomData<Rc<()>>,
}
impl Scope {
    pub(in crate::native_pty::platform) fn new() -> Self {
        Self::with_inspector(None)
    }
    fn with_inspector(inspector: Option<Inspector>) -> Self {
        let active = CAPTURE.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_some() {
                return false;
            }
            *slot = Some(Capture {
                phase: Phase::Setup,
                buffers: Default::default(),
                dropped: [0; 3],
                sequence: 0,
                inspector,
            });
            true
        });
        Self {
            active,
            emit: |record| {
                let _ = writeln!(io::stderr().lock(), "{record}");
            },
            _thread: PhantomData,
        }
    }
    fn take(&mut self) -> Option<String> {
        if !self.active {
            return None;
        }
        self.active = false;
        CAPTURE.with(|slot| slot.borrow_mut().take()).map(|capture| {
            // Budgets total 7680 bytes; fixed header is below 512 even at u32::MAX.
            format!("NAC_PTY_SIGNAL_DIAGNOSTICS_V1 test=active-prune panicking={} dropped={},{},{} records={}\n{}{}{}",
                u8::from(std::thread::panicking()), capture.dropped[0], capture.dropped[1],
                capture.dropped[2], capture.sequence, capture.buffers[0], capture.buffers[1], capture.buffers[2])
        })
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        if let Some(record) = self.take() {
            (self.emit)(&record);
        }
    }
}
pub(in crate::native_pty::platform) fn phase(value: Phase) {
    CAPTURE.with(|slot| {
        if let Some(capture) = slot.borrow_mut().as_mut() {
            capture.phase = value;
        }
    });
}
fn kind(error: &io::Error) -> u8 {
    match error.kind() {
        io::ErrorKind::PermissionDenied => 1,
        io::ErrorKind::NotFound => 2,
        io::ErrorKind::InvalidData => 3,
        io::ErrorKind::WouldBlock => 4,
        io::ErrorKind::Unsupported => 5,
        io::ErrorKind::Other => 6,
        io::ErrorKind::Interrupted => 7,
        io::ErrorKind::InvalidInput => 8,
        io::ErrorKind::TimedOut => 9,
        _ => 255,
    }
}
// result=0 began, 1 returned Ok, 2 absent/false, 3 returned Err. Ok is not settlement.
fn record(
    stage: Stage,
    pid: libc::pid_t,
    result: u8,
    error: Option<&io::Error>,
    values: [i128; 3],
) {
    CAPTURE.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        let Some(capture) = slot.as_mut() else {
            return;
        };
        if matches!(capture.phase, Phase::Setup | Phase::Prune) {
            return;
        }
        let bucket = if capture.phase != Phase::Teardown {
            0
        } else if stage.teardown_call() {
            2
        } else {
            1
        };
        capture.sequence = capture.sequence.saturating_add(1);
        let errno = error
            .and_then(io::Error::raw_os_error)
            .map_or("none".to_owned(), |n| n.to_string());
        let line = format!(
            "seq={} phase={} stage={} pid={} result={} errno={} kind={} a={} b={} c={}\n",
            capture.sequence,
            capture.phase as u8,
            stage.label(),
            pid,
            result,
            errno,
            error.map_or(0, kind),
            values[0],
            values[1],
            values[2]
        );
        if capture.buffers[bucket].len() + line.len() <= [5120, 1024, 1536][bucket] {
            capture.buffers[bucket].push_str(&line);
        } else {
            capture.dropped[bucket] = capture.dropped[bucket].saturating_add(1);
        }
    });
}
pub(in crate::native_pty::platform) fn result<T>(
    stage: Stage,
    pid: libc::pid_t,
    value: &io::Result<T>,
    fields: [i128; 3],
) {
    record(
        stage,
        pid,
        if value.is_ok() { 1 } else { 3 },
        value.as_ref().err(),
        fields,
    );
}
pub(in crate::native_pty::platform) fn begin(stage: Stage, pid: libc::pid_t, fields: [i128; 3]) {
    record(stage, pid, 0, None, fields);
}
pub(super) fn resolve(value: io::Result<super::AuditSignal>) -> io::Result<super::AuditSignal> {
    result(Stage::Resolve, 0, &value, [0; 3]);
    value
}
pub(super) fn signal_inspector(
    native: Inspector,
) -> impl Fn(libc::pid_t) -> io::Result<Option<Row>> {
    move |pid| {
        let inspector = CAPTURE
            .with(|slot| slot.borrow().as_ref().and_then(|c| c.inspector))
            .unwrap_or(native);
        let value = inspector(pid);
        match &value {
            Ok(Some(row)) => record(
                Stage::Inspect,
                pid,
                1,
                None,
                [
                    row.unique.uniqueid as i128,
                    row.unique.version as i128,
                    row.live as i128,
                ],
            ),
            Ok(None) => record(Stage::Inspect, pid, 2, None, [0; 3]),
            Err(error) => record(Stage::Inspect, pid, 3, Some(error), [0; 3]),
        }
        value
    }
}
pub(super) fn validation(pid: libc::pid_t, retained: u64, row: &Row) {
    record(
        Stage::Validate,
        pid,
        if row.unique.uniqueid == retained && row.live {
            1
        } else {
            2
        },
        None,
        [
            retained as i128,
            row.unique.uniqueid as i128,
            row.live as i128,
        ],
    );
}
pub(super) fn native_send(pid: libc::pid_t, signal: i32, version: i32, returned: i32) {
    let value = if returned == 0 {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(returned))
    };
    result(
        Stage::NativeSend,
        pid,
        &value,
        [signal as i128, version as i128, returned as i128],
    );
}

pub(super) struct ObservedProbe<'a, P> {
    inner: &'a P,
    index: Cell<usize>,
}
impl<'a, P> ObservedProbe<'a, P> {
    pub(super) fn new(inner: &'a P) -> Self {
        Self {
            inner,
            index: Cell::new(0),
        }
    }
    fn stage(&self) -> Stage {
        let n = self.index.get();
        self.index.set((n + 1) % 6);
        [
            Stage::UniqueFirst,
            Stage::ShortBefore,
            Stage::SidBefore,
            Stage::ShortAfter,
            Stage::SidAfter,
            Stage::UniqueLast,
        ][n]
    }
}
impl<P: inspection::Probe> inspection::Probe for ObservedProbe<'_, P> {
    fn unique(&self, pid: libc::pid_t) -> io::Result<Option<Unique>> {
        self.inner.unique(pid)
    }
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<inspection::Short>> {
        self.inner.short(pid)
    }
    fn unique_into(&self, pid: libc::pid_t, output: &mut Unique) -> io::Result<bool> {
        let value = self.inner.unique_into(pid, output);
        let fields = if matches!(value, Ok(true)) {
            [
                output.uniqueid as i128,
                output.parent_uniqueid as i128,
                output.version as i128,
            ]
        } else {
            [0; 3]
        };
        record(
            self.stage(),
            pid,
            match value {
                Ok(true) => 1,
                Ok(false) => 2,
                Err(_) => 3,
            },
            value.as_ref().err(),
            fields,
        );
        value
    }
    fn short_into(&self, pid: libc::pid_t, output: &mut inspection::Short) -> io::Result<bool> {
        let value = self.inner.short_into(pid, output);
        let fields = if matches!(value, Ok(true)) {
            [
                output.pid as i128,
                output.ppid as i128,
                output.status as i128,
            ]
        } else {
            [0; 3]
        };
        record(
            self.stage(),
            pid,
            match value {
                Ok(true) => 1,
                Ok(false) => 2,
                Err(_) => 3,
            },
            value.as_ref().err(),
            fields,
        );
        value
    }
    fn sid(&self, pid: libc::pid_t) -> io::Result<Option<libc::pid_t>> {
        let value = self.inner.sid(pid);
        record(
            self.stage(),
            pid,
            match value {
                Ok(Some(_)) => 1,
                Ok(None) => 2,
                Err(_) => 3,
            },
            value.as_ref().err(),
            [
                value.as_ref().ok().and_then(|v| *v).unwrap_or(0) as i128,
                0,
                0,
            ],
        );
        value
    }
}

#[cfg(test)]
mod tests;
