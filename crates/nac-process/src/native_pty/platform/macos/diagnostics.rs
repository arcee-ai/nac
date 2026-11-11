//! Scoped, in-memory fixture observations. Compiled out of non-test builds.
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
    PostAudit,
    PostIdentity,
    PostParent,
    PostStatus,
    MetadataRead,
    MetadataCredentials,
    MetadataStatus,
    Actor,
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
            Self::PostAudit => "post-audit",
            Self::PostIdentity => "post-identity",
            Self::PostParent => "post-parent",
            Self::PostStatus => "post-status",
            Self::MetadataRead => "metadata-read",
            Self::MetadataCredentials => "metadata-credentials",
            Self::MetadataStatus => "metadata-status",
            Self::Actor => "actor",
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
    signal_pid: Option<libc::pid_t>,
    census_iteration: Option<u32>,
    buffers: [String; 3],
    signal_outcome: Option<std::ops::Range<usize>>,
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
    pub(in crate::native_pty::platform) fn census() -> Self {
        Self::with_capture(None, Some(0))
    }
    fn with_inspector(inspector: Option<Inspector>) -> Self {
        Self::with_capture(inspector, None)
    }
    fn with_capture(inspector: Option<Inspector>, census_iteration: Option<u32>) -> Self {
        let active = CAPTURE.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_some() {
                return false;
            }
            *slot = Some(Capture {
                phase: Phase::Setup,
                signal_pid: None,
                census_iteration,
                buffers: Default::default(),
                signal_outcome: None,
                dropped: [0; 3],
                sequence: 0,
                inspector,
            });
            true
        });
        Self {
            active,
            emit: |record| {
                emit(record, &mut io::stderr().lock());
            },
            _thread: PhantomData,
        }
    }
    pub(in crate::native_pty::platform) fn begin_iteration(&mut self) {
        if !self.active {
            return;
        }
        CAPTURE.with(|slot| {
            let mut slot = slot.borrow_mut();
            let Some(capture) = slot.as_mut() else {
                return;
            };
            if capture.phase == Phase::Teardown {
                return;
            }
            let Some(iteration) = capture.census_iteration.as_mut() else {
                return;
            };
            *iteration = iteration.saturating_add(1);
            // Successful earlier iterations cannot hide a later failure. Only
            // this iteration's signal rows/drops rotate; teardown has its own
            // inspection and operation-result budgets. Nothing rotates on unwind.
            capture.buffers[0].clear();
            capture.signal_outcome = None;
            capture.dropped[0] = 0;
            capture.sequence = 0;
            capture.phase = Phase::Setup;
            capture.signal_pid = None;
        });
    }
    fn take(&mut self) -> Option<String> {
        if !self.active {
            return None;
        }
        self.active = false;
        CAPTURE.with(|slot| slot.borrow_mut().take()).map(|capture| {
            // Budgets total 7680 bytes; fixed header is below 512 even at u32::MAX.
            let test = capture.census_iteration.map_or_else(
                || "active-prune".to_owned(),
                |iteration| format!("active-census iteration={iteration}"),
            );
            format!("NAC_PTY_SIGNAL_DIAGNOSTICS_V1 test={test} panicking={} dropped={},{},{} records={}\n{}{}{}",
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
pub(super) fn emit(record: &str, output: &mut impl Write) {
    // A failed diagnostic sink must not replace the original fixture unwind.
    let _ = writeln!(output, "{record}");
}
pub(in crate::native_pty::platform) fn signal_target(pid: libc::pid_t) {
    CAPTURE.with(|slot| {
        if let Some(capture) = slot.borrow_mut().as_mut() {
            capture.phase = Phase::Signal;
            capture.signal_pid = Some(pid);
        }
    });
    // Preserve the existing fixture's scalar caller identity, never a token.
    // SAFETY: these scalar identity queries have no preconditions.
    let actor = unsafe {
        [
            libc::getpid() as i128,
            libc::getuid() as i128,
            libc::geteuid() as i128,
        ]
    };
    begin(Stage::Actor, pid, actor);
}
pub(super) fn observing_signal(pid: libc::pid_t) -> bool {
    CAPTURE.with(|slot| {
        slot.borrow().as_ref().is_some_and(|capture| {
            capture.phase == Phase::Signal && capture.signal_pid == Some(pid)
        })
    })
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
pub(super) fn record(
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
        if bucket == 0 {
            // Roll complete signal rows, but retain the latest primary outcome
            // across the inherited observational probe. It may itself overflow
            // after an atomic denial; that must not replace primary attribution.
            let primary = stage == Stage::NativeSend
                || (stage == Stage::Inspect && result != 1)
                || (stage == Stage::Validate && result == 2)
                || (stage == Stage::Resolve && result == 3);
            if primary {
                capture.signal_outcome = None;
            }
            let buffer = &mut capture.buffers[0];
            while buffer.len() + line.len() > 5120 {
                let start = capture
                    .signal_outcome
                    .as_ref()
                    .filter(|range| range.start == 0)
                    .map_or(0, |range| range.end);
                let Some(end) = buffer[start..].find('\n').map(|end| start + end + 1) else {
                    capture.dropped[0] = capture.dropped[0].saturating_add(1);
                    return;
                };
                buffer.drain(start..end);
                if let Some(range) = capture.signal_outcome.as_mut() {
                    if end <= range.start {
                        range.start -= end - start;
                        range.end -= end - start;
                    }
                }
                capture.dropped[0] = capture.dropped[0].saturating_add(1);
            }
            if primary {
                capture.signal_outcome = Some(buffer.len()..buffer.len() + line.len());
            }
            buffer.push_str(&line);
        } else if capture.buffers[bucket].len() + line.len() <= [5120, 1024, 1536][bucket] {
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
