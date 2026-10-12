//! All-PID discovery; inaccessible owned candidates retain an obligation.
use super::inspection::{snapshot, Native, Probe};
use super::{Identity, Key, Row};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;

#[derive(Default)]
pub(in crate::native_pty::platform) struct Discovery {
    // None means SID ownership was observed before exact identity acquisition.
    // Such uncertainty never becomes raw-PID signaling authority.
    pending: HashMap<libc::pid_t, Obligation>,
}
#[derive(Clone, Copy)]
struct Obligation {
    uniqueid: Option<u64>,
    owned: bool,
}
pub(in crate::native_pty::platform) struct Census {
    pub rows: Vec<Row>,
    pub identities: Vec<(Key, Identity)>,
    pub error: Option<io::Error>,
}
impl Discovery {
    pub fn rows(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
    ) -> io::Result<Census> {
        self.scan(root, known, pids()?, &Native)
    }

    fn scan(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
        mut pids: Vec<libc::pid_t>,
        probe: &impl Probe,
    ) -> io::Result<Census> {
        // Retry obligations even when census/UID/SID membership later changes.
        pids.extend(self.pending.keys().copied());
        pids.sort_unstable();
        pids.dedup();
        let mut census = Census {
            rows: Vec::new(),
            identities: Vec::new(),
            error: None,
        };
        for pid in pids.into_iter().filter(|pid| *pid > 1 && *pid != root) {
            let known_pid = known.keys().any(|key| key.0 == pid);
            let sid = match probe.sid(pid) {
                Ok(sid) => sid,
                Err(error) => {
                    // Membership cannot be excluded. This is census uncertainty,
                    // not a guessed owned identity or permission bypass.
                    self.pending.entry(pid).or_insert_with(|| Obligation {
                        uniqueid: probe
                            .unique(pid)
                            .ok()
                            .flatten()
                            .map(|identity| identity.uniqueid),
                        owned: false,
                    });
                    census.error.get_or_insert(error);
                    continue;
                }
            };
            if sid == Some(root) {
                self.pending.entry(pid).or_insert(Obligation {
                    uniqueid: None,
                    owned: true,
                });
            }
            if sid.is_none() && !known_pid && !self.pending.contains_key(&pid) {
                continue;
            }
            let current = match snapshot(pid, probe) {
                Ok(Some(snapshot)) => snapshot,
                Ok(None) => {
                    self.pending.remove(&pid);
                    continue;
                }
                Err(error) => {
                    if known_pid || self.pending.contains_key(&pid) {
                        census.error.get_or_insert(error);
                    }
                    // A different SID alone is not ancestry authority. Do not
                    // poison an owner with inaccessible unrelated processes.
                    continue;
                }
            };
            let key = (pid, current.unique.uniqueid);
            if self
                .pending
                .get(&pid)
                .is_some_and(|original| original.uniqueid.is_some_and(|id| id != key.1))
            {
                // Positive unique-ID replacement proves the original gone.
                self.pending.remove(&pid);
            }
            let related = current.sid == root
                || current.short.ppid == root
                || known.contains_key(&(current.short.ppid, current.unique.parent_uniqueid));
            if related {
                // Exact, bookended identity is recorded BEFORE status/capture
                // checks. Unknown status or denied inspection retains it.
                self.pending.insert(
                    pid,
                    Obligation {
                        uniqueid: Some(key.1),
                        owned: true,
                    },
                );
            }
            let previously_owned = self
                .pending
                .get(&pid)
                .is_some_and(|obligation| obligation.owned && obligation.uniqueid == Some(key.1));
            let row = match current.row() {
                Ok(row) => row,
                Err(error) => {
                    if previously_owned || known_pid || self.pending.contains_key(&pid) {
                        census.error.get_or_insert(error);
                    }
                    continue;
                }
            };
            if !row.live {
                self.pending.remove(&pid);
            } else if previously_owned {
                // Exact retained discovery authority survives UID/new-SID
                // changes. Re-inspection cannot reacquire a replacement PID.
                match Identity::capture_with(row.clone(), probe) {
                    Ok(Some(identity)) => {
                        census.identities.push((key, identity));
                        self.pending.remove(&pid);
                    }
                    Ok(None) => {
                        self.pending.remove(&pid);
                    }
                    Err(error) => {
                        census.error.get_or_insert(error);
                    }
                }
            } else if self.pending.contains_key(&pid) {
                census.error.get_or_insert_with(|| io::Error::new(io::ErrorKind::WouldBlock,
                    "PTY candidate ownership remains uncertain after SID/identity inspection failure; retained for retry"));
            }
            census.rows.push(row);
        }
        Ok(census)
    }
}

pub(super) fn pids() -> io::Result<Vec<libc::pid_t>> {
    let mut capacity = 256usize;
    loop {
        let mut pids = vec![0 as libc::pid_t; capacity];
        // SAFETY: allocated PID buffer exactly matches provided byte capacity.
        // ALL_PIDS includes other UIDs; proc_listpids returns bytes, not count.
        let returned = unsafe {
            libc::proc_listpids(
                1,
                0,
                pids.as_mut_ptr().cast(),
                (capacity * std::mem::size_of::<libc::pid_t>()) as i32,
            )
        };
        if returned <= 0 {
            return Err(io::Error::last_os_error());
        }
        let bytes = returned as usize;
        if !bytes.is_multiple_of(std::mem::size_of::<libc::pid_t>())
            || bytes > capacity * std::mem::size_of::<libc::pid_t>()
        {
            return Err(io::Error::other("invalid native process census size"));
        }
        let count = bytes / std::mem::size_of::<libc::pid_t>();
        if count == capacity {
            if capacity >= 1_048_576 {
                return Err(io::Error::other("native process census remained truncated"));
            }
            capacity *= 2;
            continue;
        }
        pids.truncate(count);
        return Ok(pids);
    }
}

#[cfg(test)]
mod tests;
