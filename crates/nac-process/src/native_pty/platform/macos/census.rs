//! Synchronized census generations for already registered, unreaped roots.
//!
//! Every participant is fenced BEFORE and AFTER acquisition with WNOWAIT and
//! equal private unique IDs. A root must join before acquisition, consume a
//! generation once, and request it in the same 50 ms observation epoch. Cleanup
//! always requests a fresh generation. This is not a TTL ownership cache.
//! Enumeration, pending interpretation and signaling authority remain local.

use super::inspection::{snapshot, Native, Probe, Snapshot};
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

type Result<T> = std::result::Result<T, Arc<io::Error>>;

pub(super) struct Observation {
    pub sid: Result<Option<libc::pid_t>>,
    pub snapshot: Option<Result<Option<Snapshot>>>,
    pub ambiguous_uniqueid: Option<u64>,
    pub capture: Option<Arc<Result<Option<Snapshot>>>>,
    pub row: Option<Box<super::Row>>,
}
impl AsRef<Observation> for Observation {
    fn as_ref(&self) -> &Observation {
        self
    }
}

static CONSUMERS: AtomicUsize = AtomicUsize::new(0);
pub(super) struct Consumer {
    root: Option<Arc<Root>>,
    last: Option<Instant>,
}
impl Default for Consumer {
    fn default() -> Self {
        Self::new(None)
    }
}
impl Drop for Consumer {
    fn drop(&mut self) {
        CONSUMERS.fetch_sub(1, Ordering::Relaxed);
    }
}
pub(in crate::native_pty) fn sharing() -> bool {
    CONSUMERS.load(Ordering::Relaxed) > 1
}

impl Observation {
    #[inline(always)]
    pub fn acquire(pid: libc::pid_t, probe: &impl Probe) -> Self {
        let sid = probe.sid(pid).map_err(Arc::new);
        let (snapshot, ambiguous_uniqueid) = if sid.is_err() {
            (None, probe.unique(pid).ok().flatten().map(|u| u.uniqueid))
        } else {
            (Some(snapshot(pid, probe).map_err(Arc::new)), None)
        };
        Self {
            sid,
            snapshot,
            ambiguous_uniqueid,
            capture: None,
            row: None,
        }
    }
    pub(super) fn acquire_for_roots(
        pid: libc::pid_t,
        probe: &impl Probe,
        roots: &[libc::pid_t],
    ) -> Self {
        let mut observation = Self::acquire(pid, probe);
        observation.row = match &observation.snapshot {
            Some(Ok(Some(row))) => row.row().ok().map(Box::new),
            _ => None,
        };
        let positive = match &observation.snapshot {
            Some(Ok(Some(row))) => {
                (roots.contains(&row.sid) || roots.contains(&row.short.ppid))
                    && row.row().is_ok_and(|row| row.live)
            }
            _ => false,
        };
        if positive {
            // Preserve the original positive witness's immediate capture
            // bookend, before a short-lived parent can be reaped while another
            // participant is still acquiring unrelated rows. This stores only
            // metadata; each owner creates/interprets its own authority later.
            observation.capture = Some(Arc::new(snapshot(pid, probe).map_err(Arc::new)));
        }
        observation
    }
}

struct Root {
    pid: libc::pid_t,
    uniqueid: Option<u64>,
}
struct Generation {
    started: Instant,
    epoch: u128,
    participants: Vec<std::sync::Weak<Root>>,
    observations: Arc<Vec<(libc::pid_t, Observation)>>,
}

pub(super) struct Batch {
    observations: Arc<Vec<(libc::pid_t, Observation)>>,
    missing: Vec<(libc::pid_t, Observation)>,
}

impl Batch {
    pub fn iter<'a>(
        &'a self,
        pids: &'a [libc::pid_t],
    ) -> impl Iterator<Item = (libc::pid_t, &'a Observation)> {
        let mut existing = 0;
        let mut missing = 0;
        pids.iter().map(move |&pid| {
            while existing < self.observations.len() && self.observations[existing].0 < pid {
                existing += 1;
            }
            let observation =
                if existing < self.observations.len() && self.observations[existing].0 == pid {
                    &self.observations[existing].1
                } else {
                    let observation = &self.missing[missing];
                    debug_assert_eq!(
                        observation.0, pid,
                        "fresh inventory has a full missing read"
                    );
                    missing += 1;
                    &observation.1
                };
            (pid, observation)
        })
    }
}
#[derive(Default)]
struct Cache {
    roots: Vec<std::sync::Weak<Root>>,
    generation: Option<Generation>,
}
impl Cache {
    fn reusable(&self, root: &Arc<Root>, last: Option<Instant>, epoch: u128, fresh: bool) -> bool {
        !fresh
            && self.generation.as_ref().is_some_and(|g| {
                g.epoch == epoch
                    && last.is_none_or(|last| g.started > last)
                    && g.participants
                        .iter()
                        .any(|candidate| candidate.ptr_eq(&Arc::downgrade(root)))
            })
    }

    fn collect(
        &mut self,
        pids: &[libc::pid_t],
        epoch: u128,
        mut fence: impl FnMut(libc::pid_t) -> Option<u64>,
        mut acquire: impl FnMut(libc::pid_t, &[libc::pid_t]) -> Observation,
    ) {
        self.roots.retain(|root| root.strong_count() != 0);
        let roots = self
            .roots
            .iter()
            .filter_map(std::sync::Weak::upgrade)
            .collect::<Vec<_>>();
        let before = roots
            .iter()
            .map(|root| fence(root.pid).filter(|key| root.uniqueid == Some(*key)))
            .collect::<Vec<_>>();
        let owned = roots
            .iter()
            .zip(&before)
            .filter_map(|(root, key)| key.map(|_| root.pid))
            .collect::<Vec<_>>();
        let started = Instant::now();
        let observations = pids
            .iter()
            .map(|&pid| (pid, acquire(pid, &owned)))
            .collect();
        // WNOWAIT plus equal private unique ID bookends proves that every
        // participating root stayed the SAME exclusively owned unreaped child
        // throughout acquisition, even when a different worker is closing it.
        let participants = roots
            .iter()
            .zip(before)
            .filter_map(|(root, before)| {
                before
                    .filter(|key| fence(root.pid) == Some(*key))
                    .map(|_| Arc::downgrade(root))
            })
            .collect();
        self.generation = Some(Generation {
            started,
            epoch,
            participants,
            observations: Arc::new(observations),
        });
    }
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::default()))
}
fn origin() -> &'static Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    ORIGIN.get_or_init(Instant::now)
}
pub(in crate::native_pty) fn aligned_delay(period: std::time::Duration) -> std::time::Duration {
    if !sharing() {
        return period;
    }
    period
        - std::time::Duration::from_nanos(
            (origin().elapsed().as_nanos() % period.as_nanos()) as u64,
        )
}
fn fence(pid: libc::pid_t) -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::uninit();
    // SAFETY: the registry contains only exclusively owned direct children;
    // this read-only wait never reaps. Successful waitid initializes siginfo.
    if unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            info.as_mut_ptr(),
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    } != 0
    {
        return None;
    }
    Native
        .unique(pid)
        .ok()
        .flatten()
        .map(|unique| unique.uniqueid)
        .filter(|key| *key != 0)
}

impl Consumer {
    pub fn new(pid: Option<libc::pid_t>) -> Self {
        CONSUMERS.fetch_add(1, Ordering::Relaxed);
        let root = pid.map(|pid| {
            Arc::new(Root {
                pid,
                // Registration happens while this worker exclusively owns the
                // unreaped child. A failed identity read only disables sharing;
                // independent discovery remains supported and fail-closed.
                uniqueid: Native
                    .unique(pid)
                    .ok()
                    .flatten()
                    .map(|u| u.uniqueid)
                    .filter(|key| *key != 0),
            })
        });
        if let Some(root) = &root {
            cache()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .roots
                .push(Arc::downgrade(root));
        }
        Self { root, last: None }
    }

    pub fn observations(&mut self, pids: &[libc::pid_t], fresh: bool) -> Option<Batch> {
        let root = self.root.as_ref()?;
        let mut cache = cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let epoch = origin().elapsed().as_millis() / 50;
        if !cache.reusable(root, self.last, epoch, fresh) {
            cache.collect(pids, epoch, fence, |pid, roots| {
                Observation::acquire_for_roots(pid, &Native, roots)
            });
        }
        if !cache.reusable(root, self.last, epoch, false) {
            return None;
        }
        let generation = cache.generation.as_ref()?;
        self.last = Some(generation.started);
        // Retain the immutable batch once, rather than one reference-counted
        // allocation and clone/drop per PID per owner. Interpretation still
        // follows only this owner's freshly enumerated inventory.
        let observations = Arc::clone(&generation.observations);
        drop(cache);
        let mut cursor = 0;
        let mut missing = Vec::new();
        // Both inventories are sorted. Merge once instead of hashing every
        // PID for every owner; missing/new/pending PIDs still get FULL reads.
        for &pid in pids {
            while cursor < observations.len() && observations[cursor].0 < pid {
                cursor += 1;
            }
            if cursor == observations.len() || observations[cursor].0 != pid {
                // These reads belong only to this consumer's current child
                // fence; do not append them to another root's generation.
                missing.push((
                    pid,
                    Observation::acquire_for_roots(pid, &Native, &[root.pid]),
                ));
            }
        }
        Some(Batch {
            observations,
            missing,
        })
    }
}

pub(super) fn error(error: &io::Error) -> io::Error {
    error.raw_os_error().map_or_else(
        || io::Error::new(error.kind(), error.to_string()),
        io::Error::from_raw_os_error,
    )
}

#[cfg(test)]
mod tests;
