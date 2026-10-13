//! All-PID discovery; inaccessible owned candidates retain an obligation.
use super::census::{self, Observation};
use super::inspection::snapshot;
use super::inspection::{Native, Probe};
use super::{Identity, Key, Row};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;

#[derive(Default)]
pub(in crate::native_pty::platform) struct Discovery {
    // None means SID ownership was observed before exact identity acquisition.
    // Such uncertainty never becomes raw-PID signaling authority.
    pending: HashMap<libc::pid_t, Obligation>,
    consumer: census::Consumer,
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
    pub fn new(root: Option<libc::pid_t>) -> Self {
        Self {
            pending: HashMap::new(),
            consumer: census::Consumer::new(root),
        }
    }
    pub fn rows(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
        fresh: bool,
    ) -> io::Result<Census> {
        // Authority has just established this owner's exclusive child fence.
        // Enumeration is never cached; retained obligations are added below.
        let pids = pids()?;
        if !census::sharing() {
            return self.scan(root, known, pids, &Native);
        }
        let pids = self.inventory(root, pids);
        let Some(observations) = self.consumer.observations(&pids, fresh) else {
            // A denied/reaped/replaced peer root never poisons another owner
            // or narrows support. This owner retries the independent path.
            return self.scan(root, known, pids, &Native);
        };
        self.scan_observations(root, known, &Native, observations.iter(&pids))
    }

    fn scan(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
        pids: Vec<libc::pid_t>,
        probe: &impl Probe,
    ) -> io::Result<Census> {
        let pids = self.inventory(root, pids);
        let mut census = Census {
            rows: Vec::with_capacity(pids.len()),
            identities: Vec::new(),
            error: None,
        };
        for pid in pids {
            self.consider(root, known, probe, pid, None, &mut census)?;
        }
        Ok(census)
    }

    fn inventory(&self, root: libc::pid_t, mut pids: Vec<libc::pid_t>) -> Vec<libc::pid_t> {
        pids.extend(self.pending.keys().copied());
        sort_and_dedup(&mut pids);
        pids.retain(|pid| *pid > 1 && *pid != root);
        pids
    }

    #[cfg(test)]
    fn scan_with<A: AsRef<Observation>>(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
        pids: Vec<libc::pid_t>,
        probe: &impl Probe,
        mut acquire: impl FnMut(libc::pid_t) -> A,
    ) -> io::Result<Census> {
        // Retry obligations even when census/UID/SID membership later changes.
        let pids = self.inventory(root, pids);
        let mut census = Census {
            rows: Vec::with_capacity(pids.len()),
            identities: Vec::new(),
            error: None,
        };
        // Keep the large acquisition record in this stack frame. Passing it
        // through a lazy iterator would repeatedly move the whole record for
        // every PID, even though interpretation only needs a borrowed view.
        for pid in pids {
            let observation = acquire(pid);
            self.consider(
                root,
                known,
                probe,
                pid,
                Some(observation.as_ref()),
                &mut census,
            )?;
        }
        Ok(census)
    }

    fn scan_observations<A: AsRef<Observation>>(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
        probe: &impl Probe,
        observations: impl Iterator<Item = (libc::pid_t, A)>,
    ) -> io::Result<Census> {
        let mut census = Census {
            rows: Vec::with_capacity(observations.size_hint().0),
            identities: Vec::new(),
            error: None,
        };
        for (pid, observation) in observations {
            self.consider(
                root,
                known,
                probe,
                pid,
                Some(observation.as_ref()),
                &mut census,
            )?;
        }
        Ok(census)
    }

    fn consider(
        &mut self,
        root: libc::pid_t,
        known: &HashMap<Key, Arc<Identity>>,
        probe: &impl Probe,
        pid: libc::pid_t,
        observation: Option<&Observation>,
        census: &mut Census,
    ) -> io::Result<()> {
        if let Some(row) = observation.and_then(|observation| {
            observation.row.as_ref().filter(|row| {
                known.is_empty()
                    && self.pending.is_empty()
                    && observation
                        .sid
                        .as_ref()
                        .is_ok_and(|sid| sid.is_some_and(|sid| sid != root))
                    && row.sid != root
                    && row.ppid != root
            })
        }) {
            // A shared, fully validated row needs no owner-specific work
            // when there is no known/pending ancestry seed. Keep it for
            // newly discovered-parent closure; no inspection is omitted.
            census.rows.push(row.as_ref().clone());
            return Ok(());
        }
        let known_pid = !known.is_empty() && known.keys().any(|key| key.0 == pid);
        let mut obligation = if self.pending.is_empty() {
            None
        } else {
            self.pending.get(&pid).copied()
        };
        let sid = match observation.map_or_else(
            || probe.sid(pid),
            |observation| {
                observation
                    .sid
                    .as_ref()
                    .copied()
                    .map_err(|error| census::error(error))
            },
        ) {
            Ok(sid) => sid,
            Err(error) => {
                // Membership cannot be excluded. This is census uncertainty,
                // not a guessed owned identity or permission bypass.
                self.pending.entry(pid).or_insert_with(|| Obligation {
                    uniqueid: observation.map_or_else(
                        || {
                            probe
                                .unique(pid)
                                .ok()
                                .flatten()
                                .map(|unique| unique.uniqueid)
                        },
                        |observation| observation.ambiguous_uniqueid,
                    ),
                    owned: false,
                });
                census.error.get_or_insert(error);
                return Ok(());
            }
        };
        if sid == Some(root) && obligation.is_none() {
            let owned = Obligation {
                uniqueid: None,
                owned: true,
            };
            self.pending.insert(pid, owned);
            obligation = Some(owned);
        }
        if sid.is_none() && !known_pid && obligation.is_none() {
            return Ok(());
        }
        // The sole-owner path inspects directly into this frame instead of
        // constructing a shared acquisition record for every host PID.
        let acquired = if let Some(observation) = observation {
            let Some(snapshot) = observation.snapshot.as_ref() else {
                return Err(io::Error::other("native PTY census acquisition incomplete"));
            };
            snapshot
                .as_ref()
                .copied()
                .map_err(|error| census::error(error))
        } else {
            snapshot(pid, probe)
        };
        let current = match acquired {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => {
                self.pending.remove(&pid);
                return Ok(());
            }
            Err(error) => {
                if known_pid || obligation.is_some() {
                    census.error.get_or_insert(error);
                }
                // A different SID alone is not ancestry authority. Do not
                // poison an owner with inaccessible unrelated processes.
                return Ok(());
            }
        };
        let related = current.sid == root
            || current.short.ppid == root
            || (!known.is_empty()
                && known.contains_key(&(current.short.ppid, current.unique.parent_uniqueid)));
        if !related && !known_pid && obligation.is_none() {
            // This is AFTER the full exact inspection, not negative hint
            // preselection. Keep the row for new-parent ancestry closure;
            // only skip bookkeeping that has no owned/pending subject.
            if let Ok(row) = current.row() {
                census.rows.push(row);
            }
            return Ok(());
        }
        let key = (pid, current.unique.uniqueid);
        if obligation.is_some_and(|original| original.uniqueid.is_some_and(|id| id != key.1)) {
            // Positive unique-ID replacement proves the original gone.
            self.pending.remove(&pid);
            obligation = None;
        }
        if related {
            // Exact, bookended identity is recorded BEFORE status/capture
            // checks. Unknown status or denied inspection retains it.
            let owned = Obligation {
                uniqueid: Some(key.1),
                owned: true,
            };
            self.pending.insert(pid, owned);
            obligation = Some(owned);
        }
        let previously_owned = obligation
            .is_some_and(|obligation| obligation.owned && obligation.uniqueid == Some(key.1));
        let row = match current.row() {
            Ok(row) => row,
            Err(error) => {
                if previously_owned || known_pid || obligation.is_some() {
                    census.error.get_or_insert(error);
                }
                return Ok(());
            }
        };
        if !row.live {
            self.pending.remove(&pid);
        } else if previously_owned {
            // Exact retained discovery authority survives UID/new-SID
            // changes. Re-inspection cannot reacquire a replacement PID.
            let capture = match observation.and_then(|observation| observation.capture.as_ref()) {
                Some(current) => current
                    .as_ref()
                    .as_ref()
                    .map_err(|error| census::error(error))
                    .and_then(|current| Identity::capture_snapshot(row.clone(), *current)),
                None => Identity::capture_with(row.clone(), probe),
            };
            match capture {
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
        } else if obligation.is_some() {
            census.error.get_or_insert_with(|| io::Error::new(io::ErrorKind::WouldBlock,
                "PTY candidate ownership remains uncertain after SID/identity inspection failure; retained for retry"));
        }
        census.rows.push(row);
        Ok(())
    }
}

fn sort_and_dedup(pids: &mut Vec<libc::pid_t>) {
    if pids.len() < 64 {
        pids.sort_unstable();
        pids.dedup();
        return;
    }
    let mut low = pids[0];
    let mut high = low;
    for &pid in pids.iter() {
        if pid < low {
            low = pid;
        }
        if pid > high {
            high = pid;
        }
    }
    let span = (i64::from(high) - i64::from(low) + 1) as usize;
    // This bounds temporary storage, never the PID/identity support range.
    // Sparse or wide inventories retain the original comparison-sort path.
    if span > 1_048_576 || span > pids.len().saturating_mul(256) {
        pids.sort_unstable();
        pids.dedup();
        return;
    }
    let mut words = vec![0u64; span.div_ceil(64)];
    for &pid in pids.iter() {
        let offset = (i64::from(pid) - i64::from(low)) as usize;
        words[offset / 64] |= 1u64 << (offset % 64);
    }
    pids.clear();
    let mut index = 0;
    while index < words.len() {
        let mut word = words[index];
        while word != 0 {
            let offset = index * 64 + word.trailing_zeros() as usize;
            pids.push((i64::from(low) + offset as i64) as libc::pid_t);
            word &= word - 1;
        }
        index += 1;
    }
}

pub(super) fn pids() -> io::Result<Vec<libc::pid_t>> {
    let mut capacity = 1024usize;
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
