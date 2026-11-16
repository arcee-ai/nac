use std::io;

pub(super) type Key = (libc::pid_t, u64);
#[derive(Clone)]
pub(super) struct Row {
    pub pid: libc::pid_t,
    pub ppid: libc::pid_t,
    pub sid: libc::pid_t,
    pub live: bool,
    metadata: crate::ProcessMetadata,
}
impl Row {
    pub fn key(&self) -> Key {
        (self.pid, self.metadata.start_time)
    }
}

pub(super) struct Identity(crate::ProcessIdentity);
impl Identity {
    pub fn pid(&self) -> libc::pid_t {
        self.0.metadata.pid
    }
    pub fn capture(row: Row) -> io::Result<Option<Self>> {
        crate::ProcessIdentity::capture(row.metadata).map(|identity| identity.map(Self))
    }
    pub fn capture_owned(row: Row, evidence: super::Evidence) -> io::Result<Option<Self>> {
        let Some(current) = read(row.pid)? else {
            return Ok(None);
        };
        if current.key() != row.key() || !current.live {
            return Ok(None);
        }
        if matches!(evidence, super::Evidence::Session) {
            if current.sid != row.sid {
                return Err(io::Error::other(
                    "PTY original child session changed before capture; retained for retry",
                ));
            }
            let Some(identity) = Self::capture(row.clone())? else {
                return Ok(None);
            };
            if !identity.capability_live()? {
                return Ok(None);
            }
            let Some(after) = read(row.pid)? else {
                return Ok(None);
            };
            if after.key() != row.key() || !after.live {
                return Ok(None);
            }
            if after.sid != row.sid {
                return Err(io::Error::other(
                    "PTY original child session changed during capture; retained for retry",
                ));
            }
            if !identity.capability_live()? {
                return Ok(None);
            }
            return Ok(Some(identity));
        }
        if current.ppid != row.ppid {
            return Err(io::Error::other(
                "PTY child parent changed before ownership capture",
            ));
        }
        let parent = match evidence {
            super::Evidence::Parent(parent) => {
                // Probe the ORIGINAL retained capability, not a newly opened
                // pidfd/start-time pair vulnerable to same-jiffy PID reuse.
                parent.0.send_signal(0)?;
                let Some(now) = read(parent.pid())? else {
                    return Err(io::Error::other(
                        "PTY parent identity unavailable during discovery",
                    ));
                };
                parent.require_original_start(now.metadata.start_time)?;
                Some(parent)
            }
            super::Evidence::DirectChild => None,
            super::Evidence::Session => unreachable!(),
        };
        let Some(identity) = Self::capture(row.clone())? else {
            return Ok(None);
        };
        if !identity.capability_live()? {
            return Ok(None);
        }
        let Some(after) = read(row.pid)? else {
            return Ok(None);
        };
        if after.key() != row.key() || !after.live {
            return Ok(None);
        }
        if after.ppid != row.ppid {
            return Err(io::Error::other(
                "PTY child parent changed during ownership capture",
            ));
        }
        if let Some(parent) = parent {
            parent.0.send_signal(0)?;
            let Some(after) = read(parent.pid())? else {
                return Err(io::Error::other(
                    "PTY parent exited during ownership capture",
                ));
            };
            parent.require_original_start(after.metadata.start_time)?;
        }
        if !identity.capability_live()? {
            return Ok(None);
        }
        Ok(Some(identity))
    }

    fn require_original_start(&self, current: u64) -> io::Result<()> {
        if current != self.0.metadata.start_time {
            return Err(io::Error::other(
                "PTY parent identity changed during ownership capture; retained for retry",
            ));
        }
        Ok(())
    }

    fn capability_live(&self) -> io::Result<bool> {
        match self.0.send_signal(0) {
            Ok(()) => Ok(true),
            Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn signal(&self, signal: i32) -> io::Result<bool> {
        match self.0.send_signal(signal) {
            Ok(()) => Ok(true),
            Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(false),
            Err(error) => Err(error),
        }
    }
    pub fn live(&self) -> io::Result<bool> {
        live_with(
            self.0.metadata.start_time,
            || self.0.send_signal(0),
            || read(self.pid()),
        )
    }
}

// Both probes must use the same retained original capability. A proc read
// racing with death is conclusive only after that capability reports ESRCH.
fn live_with(
    expected_start: u64,
    mut probe_original: impl FnMut() -> io::Result<()>,
    read_row: impl FnOnce() -> io::Result<Option<Row>>,
) -> io::Result<bool> {
    match probe_original() {
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => return Ok(false),
        Err(error) => return Err(error),
        Ok(()) => {}
    }
    let row = match read_row() {
        Ok(row) => row,
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {
            return match probe_original() {
                Err(death) if death.raw_os_error() == Some(libc::ESRCH) => Ok(false),
                Err(probe_error) => Err(probe_error),
                Ok(()) => Err(error),
            };
        }
        Err(error) => return Err(error),
    };
    Ok(row.is_some_and(|row| row.metadata.start_time == expected_start && row.live))
}

pub(super) fn preflight() -> io::Result<()> {
    // pidfd capability is required only for new human Local PTYs.
    // SAFETY: getpid has no preconditions.
    let pid = unsafe { libc::getpid() };
    let row = read(pid)?.ok_or_else(|| io::Error::other("own process identity unavailable"))?;
    let identity = Identity::capture(row)?
        .ok_or_else(|| io::Error::other("own pidfd identity unavailable"))?;
    identity.0.send_signal(0)?;
    Ok(())
}

pub(super) fn rows(excluded_root: Option<libc::pid_t>) -> io::Result<Vec<Row>> {
    let mut rows = Vec::new();
    for entry in std::fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
        else {
            continue;
        };
        if Some(pid) == excluded_root {
            continue;
        }
        if let Some(row) = read(pid)? {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn read(pid: libc::pid_t) -> io::Result<Option<Row>> {
    row_from_stat(pid, std::fs::read_to_string(format!("/proc/{pid}/stat")))
}

fn row_from_stat(pid: libc::pid_t, result: io::Result<String>) -> io::Result<Option<Row>> {
    let stat = match result {
        Ok(stat) => stat,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        // Keep ESRCH visible to live_with: only the retained original pidfd
        // can conclusively establish that this process lifetime has ended.
        Err(error) => return Err(error),
    };
    let (ppid, pgrp, start_time) = crate::parse_process_stat(&stat)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid PTY process stat"))?;
    let (_, rest) = stat
        .rsplit_once(") ")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid PTY stat fields"))?;
    let fields = rest.split_whitespace().collect::<Vec<_>>();
    let sid = fields
        .get(3)
        .and_then(|sid| sid.parse().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid PTY session ID"))?;
    let live = !matches!(fields.first().copied(), Some("Z" | "X"));
    Ok(Some(Row {
        pid,
        ppid,
        sid,
        live,
        metadata: crate::ProcessMetadata {
            pid,
            ppid,
            pgrp,
            start_time,
        },
    }))
}

#[cfg(test)]
#[path = "linux_tests.rs"]
mod tests;
