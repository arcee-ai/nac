//! Permission-neutral metadata acquisition with exact identity bookends.
use super::{classify_status, Row, Unique};
use std::io;

// Installed sys/proc_info.h proc_bsdshortinfo; locked libc does not declare it.
#[repr(C)]
pub(super) struct BsdShort {
    pid: u32,
    ppid: u32,
    pgid: u32,
    status: u32,
    comm: [u8; 16],
    flags: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
}

#[derive(Clone, Copy)]
pub(super) struct Short {
    pub pid: libc::pid_t,
    pub ppid: libc::pid_t,
    pub status: u32,
}

pub(super) struct Snapshot {
    pub short: Short,
    pub sid: libc::pid_t,
    pub unique: Unique,
}
impl Snapshot {
    pub fn row(self) -> io::Result<Row> {
        Ok(Row {
            pid: self.short.pid,
            ppid: self.short.ppid,
            sid: self.sid,
            live: classify_status(self.short.status)?,
            unique: self.unique,
        })
    }
}

pub(super) trait Probe {
    fn unique(&self, pid: libc::pid_t) -> io::Result<Option<Unique>>;
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<Short>>;
    fn sid(&self, pid: libc::pid_t) -> io::Result<Option<libc::pid_t>>;
}
pub(super) struct Native;
impl Probe for Native {
    fn unique(&self, pid: libc::pid_t) -> io::Result<Option<Unique>> {
        read(pid, 17)
    }
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<Short>> {
        Ok(read::<BsdShort>(pid, 13)?.map(|record| Short {
            pid: record.pid as libc::pid_t,
            ppid: record.ppid as libc::pid_t,
            status: record.status,
        }))
    }
    fn sid(&self, pid: libc::pid_t) -> io::Result<Option<libc::pid_t>> {
        // SAFETY: getsid takes a numeric PID and has no pointer preconditions.
        let sid = unsafe { libc::getsid(pid) };
        if sid >= 0 {
            Ok(Some(sid))
        } else {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                Ok(None)
            } else {
                Err(error)
            }
        }
    }
}

fn read<T>(pid: libc::pid_t, flavor: i32) -> io::Result<Option<T>> {
    let mut record = std::mem::MaybeUninit::<T>::zeroed();
    let size = std::mem::size_of::<T>() as i32;
    // SAFETY: private Unique/public short-BSD layout and byte size are checked
    // at preflight; writable storage exactly matches the request. Arg1 allows
    // explicit zombie inspection. Neither flavor requires same-user privilege
    // in the qualified kernel; any MAC/runtime denial remains an error.
    let returned = unsafe { libc::proc_pidinfo(pid, flavor, 1, record.as_mut_ptr().cast(), size) };
    if returned == size {
        // SAFETY: the exact successful size initializes the complete record.
        return Ok(Some(unsafe { record.assume_init() }));
    }
    if returned <= 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(None);
        }
        return Err(error);
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "unsupported native process identity record size",
    ))
}

pub(super) fn snapshot(pid: libc::pid_t, probe: &impl Probe) -> io::Result<Option<Snapshot>> {
    for _ in 0..3 {
        let Some(first) = probe.unique(pid)? else {
            return Ok(None);
        };
        let Some(before) = probe.short(pid)? else {
            return Ok(None);
        };
        let sid_before = probe.sid(pid)?;
        let Some(after) = probe.short(pid)? else {
            return Ok(None);
        };
        let sid_after = probe.sid(pid)?;
        let Some(last) = probe.unique(pid)? else {
            return Ok(None);
        };
        if first.uniqueid == 0 || before.pid != pid || after.pid != pid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid native process identity",
            ));
        }
        if first.uniqueid != last.uniqueid
            || first.version != last.version
            || first.parent_uniqueid != last.parent_uniqueid
            || before.ppid != after.ppid
            || sid_before != sid_after
        {
            continue;
        }
        let sid = match sid_after {
            Some(sid) => sid,
            None if after.status == 5 => -1, // Explicit zombie, never a live lookup inference.
            None => continue,
        };
        return Ok(Some(Snapshot {
            short: after,
            sid,
            unique: last,
        }));
    }
    Err(io::Error::new(
        io::ErrorKind::WouldBlock,
        "PTY identity/session changed during inspection; retained for retry",
    ))
}
