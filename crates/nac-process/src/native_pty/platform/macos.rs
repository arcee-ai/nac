//! Runtime-qualified private libproc ABI; no raw-PID signal fallback.
//!
//! Contract inspected in Apple XNU f6217f891ac0bb64f3d375211650a4c1ff8ca1ea:
//! https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/proc_info.c
//! https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info_private.h
//! The kernel validates PID/version and then exact uniqueid before signaling
//! a referenced process. Exec changes version, so only equal retained uniqueid
//! permits refreshing it. These private interfaces may change; size/capability
//! failures are retained, never converted to successful cleanup.

use std::io;
use std::sync::OnceLock;

mod discovery;
mod inspection;
pub(super) use discovery::Discovery;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Unique {
    uuid: [u8; 16],
    uniqueid: u64,
    parent_uniqueid: u64,
    version: i32,
    original_parent_version: i32,
    reserved: [u64; 2],
}

type AuditSignal = unsafe extern "C" fn(*const [u32; 8], i32) -> i32;
pub(super) type Key = (libc::pid_t, u64);

#[derive(Clone)]
pub(super) struct Row {
    pub pid: libc::pid_t,
    pub ppid: libc::pid_t,
    pub sid: libc::pid_t,
    pub live: bool,
    unique: Unique,
}

impl Row {
    pub fn key(&self) -> Key {
        (self.pid, self.unique.uniqueid)
    }
}

pub(super) struct Identity {
    pid: libc::pid_t,
    uniqueid: u64,
}

impl Identity {
    #[cfg(any(test, feature = "test-support"))]
    pub fn capture(row: Row) -> io::Result<Option<Self>> {
        Self::capture_with(row, &inspection::Native)
    }

    fn capture_with(row: Row, probe: &impl inspection::Probe) -> io::Result<Option<Self>> {
        let Some(current) = inspection::snapshot(row.pid, probe)?
            .map(inspection::Snapshot::row)
            .transpose()?
        else {
            return Ok(None);
        };
        if current.unique.uniqueid != row.unique.uniqueid {
            return Ok(None);
        }
        Ok(Some(Self {
            pid: row.pid,
            uniqueid: row.unique.uniqueid,
        }))
    }

    pub fn capture_owned(row: Row, evidence: super::Evidence) -> io::Result<Option<Self>> {
        if let super::Evidence::Parent(ref parent) = evidence {
            // Kernel parent_uniqueid identifies the birth parent and survives
            // reparenting. Require BOTH current PPID and the original parent's
            // retained uniqueid; numeric PPID alone cannot establish ownership.
            if row.ppid != parent.pid || row.unique.parent_uniqueid != parent.uniqueid {
                return Ok(None);
            }
        }
        let Some(current) = inspect(row.pid)? else {
            return Ok(None);
        };
        if current.key() != row.key() {
            return Ok(None);
        }
        if matches!(evidence, super::Evidence::Session) && current.sid != row.sid {
            return Ok(None);
        }
        if let super::Evidence::Parent(ref parent) = evidence {
            if current.ppid != parent.pid || current.unique.parent_uniqueid != parent.uniqueid {
                return Ok(None);
            }
        }
        if matches!(evidence, super::Evidence::DirectChild) && current.ppid != row.ppid {
            return Err(io::Error::other(
                "PTY direct child parent changed before ownership capture",
            ));
        }
        Ok(Some(Self {
            pid: row.pid,
            uniqueid: row.unique.uniqueid,
        }))
    }

    pub fn signal(&self, signal: i32) -> io::Result<bool> {
        self.signal_with(signal, signal_function()?)
    }

    fn signal_with(&self, signal: i32, send: AuditSignal) -> io::Result<bool> {
        for _ in 0..3 {
            let Some(current) = inspect(self.pid)? else {
                return Ok(false);
            };
            if current.unique.uniqueid != self.uniqueid || !current.live {
                return Ok(false);
            }
            // This is an identity signaling key, not an IPC provenance token.
            // The verified kernel path consumes PID/version and ordinary caller
            // credentials. The other fields are deliberately zero.
            let mut key = [0u32; 8];
            key[5] = self.pid as u32;
            key[7] = current.unique.version as u32;
            // SAFETY: runtime symbol has the installed libproc signature; key
            // is initialized audit-token-sized storage valid for this call.
            let result = unsafe { send(&key, signal) };
            if result == 0 {
                return Ok(true);
            }
            if result != libc::ESRCH {
                return Err(io::Error::from_raw_os_error(result));
            }
            // ESRCH may mean exec changed the version. Re-inspect and require
            // the same uniqueid before constructing another version key.
        }
        Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "PTY identity changed during atomic signal; retained for retry",
        ))
    }

    pub fn live(&self) -> io::Result<bool> {
        Ok(inspect(self.pid)?.is_some_and(|row| row.unique.uniqueid == self.uniqueid && row.live))
    }
}

fn signal_function() -> io::Result<AuditSignal> {
    static FUNCTION: OnceLock<Option<AuditSignal>> = OnceLock::new();
    let function = FUNCTION.get_or_init(|| {
        // SAFETY: static nul-terminated symbol; RTLD_DEFAULT searches already
        // linked system libraries without loading a dependency.
        let address =
            unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"proc_signal_with_audittoken".as_ptr()) };
        if address.is_null() {
            None
        } else {
            // SAFETY: installed declaration and official wrapper agree on this
            // function signature. Availability is resolved at runtime.
            Some(unsafe { std::mem::transmute::<*mut libc::c_void, AuditSignal>(address) })
        }
    });
    require_signal_function(*function)
}

fn require_signal_function(function: Option<AuditSignal>) -> io::Result<AuditSignal> {
    function.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::Unsupported,
            "atomic native PTY identity signaling unavailable",
        )
    })
}

#[cfg(test)]
#[path = "macos_tests.rs"]
mod tests;

pub(super) fn preflight() -> io::Result<()> {
    signal_function()?;
    if std::mem::size_of::<Unique>() != 56 || std::mem::size_of::<inspection::BsdShort>() != 64 {
        return Err(io::Error::other("unsupported native process identity ABI"));
    }
    // Check the runtime discovery and identity seams before any new child.
    discovery::pids()?;
    // SAFETY: getpid has no preconditions.
    inspect(unsafe { libc::getpid() })?
        .ok_or_else(|| io::Error::other("own unique process identity unavailable"))?;
    Ok(())
}

fn classify_status(status: u32) -> io::Result<bool> {
    match status {
        1..=4 => Ok(true), // SIDL, SRUN, SSLEEP, SSTOP: pending/live work.
        5 => Ok(false),    // Installed sys/proc.h: SZOMB.
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unknown Darwin process status {status}; retained for inspection retry"),
        )),
    }
}

pub(super) fn inspect(pid: libc::pid_t) -> io::Result<Option<Row>> {
    inspection::snapshot(pid, &inspection::Native)?
        .map(inspection::Snapshot::row)
        .transpose()
}
