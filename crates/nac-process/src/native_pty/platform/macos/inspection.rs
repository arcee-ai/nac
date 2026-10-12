//! Permission-neutral metadata acquisition with exact identity bookends.
use super::{classify_status, Row, Unique};
use std::io;

// Installed private proc_uniqidentifierinfo. Read the complete ABI buffer,
// then retain only the exact fields used by the existing identity proof.
#[repr(C)]
pub(super) struct UniqueRecord {
    uuid: [u8; 16],
    uniqueid: u64,
    parent_uniqueid: u64,
    version: i32,
    original_parent_version: i32,
    reserved: [u64; 2],
}

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

#[derive(Clone, Copy, Default)]
pub(super) struct Short {
    pub pid: libc::pid_t,
    pub ppid: libc::pid_t,
    pub status: u32,
}

#[derive(Clone, Copy)]
pub(super) struct Snapshot {
    pub short: Short,
    pub sid: libc::pid_t,
    pub unique: Unique,
}
impl Snapshot {
    #[inline(always)]
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
    fn unique_into(&self, pid: libc::pid_t, output: &mut Unique) -> io::Result<bool> {
        let Some(record) = self.unique(pid)? else {
            return Ok(false);
        };
        *output = record;
        Ok(true)
    }
    fn short_into(&self, pid: libc::pid_t, output: &mut Short) -> io::Result<bool> {
        let Some(record) = self.short(pid)? else {
            return Ok(false);
        };
        *output = record;
        Ok(true)
    }
}
pub(super) struct Native;
impl Probe for Native {
    #[inline(always)]
    fn unique(&self, pid: libc::pid_t) -> io::Result<Option<Unique>> {
        let mut output = Unique::default();
        Ok(self.unique_into(pid, &mut output)?.then_some(output))
    }
    #[inline(always)]
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<Short>> {
        let mut output = Short::default();
        Ok(self.short_into(pid, &mut output)?.then_some(output))
    }
    #[inline(always)]
    fn unique_into(&self, pid: libc::pid_t, output: &mut Unique) -> io::Result<bool> {
        let mut record = std::mem::MaybeUninit::<UniqueRecord>::uninit();
        if !read_into(pid, 17, &mut record)? {
            return Ok(false);
        }
        // SAFETY: exact-size success initializes the complete integer ABI record.
        let record = unsafe { record.assume_init_ref() };
        *output = Unique {
            uniqueid: record.uniqueid,
            parent_uniqueid: record.parent_uniqueid,
            version: record.version,
        };
        Ok(true)
    }
    #[inline(always)]
    fn short_into(&self, pid: libc::pid_t, output: &mut Short) -> io::Result<bool> {
        let mut record = std::mem::MaybeUninit::<BsdShort>::uninit();
        if !read_into(pid, 13, &mut record)? {
            return Ok(false);
        }
        // SAFETY: exact-size success initializes the complete integer ABI record.
        let record = unsafe { record.assume_init_ref() };
        *output = Short {
            pid: record.pid as libc::pid_t,
            ppid: record.ppid as libc::pid_t,
            status: record.status,
        };
        Ok(true)
    }
    #[inline(always)]
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

// These small record adapters sit on every PID in every census. Keeping the
// syscall buffer and its exact-size conversion in the caller avoids repeated
// by-value record transfers even in the repository's ordinary dev binary.
#[inline(always)]
fn read_into<T>(
    pid: libc::pid_t,
    flavor: i32,
    record: &mut std::mem::MaybeUninit<T>,
) -> io::Result<bool> {
    let size = std::mem::size_of::<T>() as i32;
    // SAFETY: private unique-ID/public short-BSD layout and byte size are checked
    // at preflight; writable storage exactly matches the request. Arg1 allows
    // explicit zombie inspection. Neither flavor requires same-user privilege
    // in the qualified kernel; any MAC/runtime denial remains an error.
    let returned = unsafe { libc::proc_pidinfo(pid, flavor, 1, record.as_mut_ptr().cast(), size) };
    if returned == size {
        return Ok(true);
    }
    if returned <= 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(false);
        }
        return Err(error);
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "unsupported native process identity record size",
    ))
}

#[inline(always)]
pub(super) fn snapshot(pid: libc::pid_t, probe: &impl Probe) -> io::Result<Option<Snapshot>> {
    for _ in 0..3 {
        let mut first = Unique::default();
        if !probe.unique_into(pid, &mut first)? {
            return Ok(None);
        };
        let mut before = Short::default();
        if !probe.short_into(pid, &mut before)? {
            return Ok(None);
        };
        let sid_before = probe.sid(pid)?;
        let mut after = Short::default();
        if !probe.short_into(pid, &mut after)? {
            return Ok(None);
        };
        let sid_after = probe.sid(pid)?;
        let mut last = Unique::default();
        if !probe.unique_into(pid, &mut last)? {
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
