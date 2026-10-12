#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::collections::HashMap;
use std::io;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::sync::Arc;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
use linux as os;
#[cfg(target_os = "macos")]
use macos as os;
#[cfg(target_os = "macos")]
pub(super) use macos::aligned_delay;

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn preflight() -> io::Result<()> {
    os::preflight()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(super) fn preflight() -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "native PTY identity supervision is unavailable",
    ))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Clone)]
enum Evidence {
    Session,
    DirectChild,
    Parent(Arc<os::Identity>),
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) struct Authority {
    root: Option<libc::pid_t>,
    members: HashMap<os::Key, Arc<os::Identity>>,
    pending_capture: HashMap<os::Key, (os::Row, Evidence)>,
    #[cfg(target_os = "macos")]
    discovery: macos::Discovery,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl Authority {
    #[cfg(all(test, target_os = "macos"))]
    pub(super) fn observed_keys_for_test(&self) -> Vec<os::Key> {
        self.members.keys().copied().collect()
    }
    pub(super) fn new(pid: Option<u32>) -> Self {
        Self {
            root: pid.map(|pid| pid as libc::pid_t),
            members: HashMap::new(),
            pending_capture: HashMap::new(),
            #[cfg(target_os = "macos")]
            discovery: macos::Discovery::new(pid.map(|pid| pid as libc::pid_t)),
        }
    }

    pub(super) fn leader_exited(&self) -> io::Result<bool> {
        let root = self
            .root
            .ok_or_else(|| io::Error::other("native PTY child PID unavailable"))?;
        let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        // SAFETY: writable siginfo storage; this is our exclusive unreaped
        // direct child. WNOWAIT keeps the PID/session identifier fenced.
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                root as libc::id_t,
                info.as_mut_ptr(),
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: waitid succeeded and initialized the output record.
        Ok(unsafe { info.assume_init().si_pid() } == root)
    }

    pub(super) fn observe(&mut self) -> io::Result<()> {
        self.observe_with(false)
    }

    pub(super) fn observe_cleanup(&mut self) -> io::Result<()> {
        self.observe_with(true)
    }

    fn observe_with(&mut self, _fresh: bool) -> io::Result<()> {
        // No fresh SID/parent adoption after losing direct-child ownership.
        self.leader_exited()?;
        let root = self
            .root
            .ok_or_else(|| io::Error::other("native PTY child PID unavailable"))?;
        #[cfg(target_os = "linux")]
        let rows = os::rows(Some(root))?;
        #[cfg(target_os = "macos")]
        let census = self.discovery.rows(root, &self.members, _fresh)?;
        #[cfg(target_os = "macos")]
        let rows = census.rows;
        // Bookend census with the original exclusive direct-child fence.
        self.leader_exited()?;
        #[cfg(target_os = "linux")]
        let mut first_error = None;
        #[cfg(target_os = "macos")]
        let mut first_error = census.error;
        #[cfg(target_os = "macos")]
        for (key, identity) in census.identities {
            self.members
                .entry(key)
                .or_insert_with(|| Arc::new(identity));
        }
        // Failed captures keep their original identity/ownership obligation.
        if let Err(error) = self.retry_pending_capture_with(os::Identity::capture_owned) {
            first_error.get_or_insert(error);
        }
        // With no retained parent and no live session/direct-child seed, the
        // ancestry closure cannot adopt anything. Full census and pending
        // retries above still run; this only avoids an empty derivation pass.
        let seeded = !self.members.is_empty()
            || rows
                .iter()
                .any(|row| row.live && (row.sid == root || row.ppid == root));
        if seeded {
            loop {
                let previous = self.members.len();
                // Derivation uses exact current parent identity, never a retained
                // numeric PID. Each OS proves the relationship before acceptance.
                let owned = rows
                    .iter()
                    .filter(|row| self.members.contains_key(&row.key()))
                    .map(|row| (row.pid, Arc::clone(&self.members[&row.key()])))
                    .collect::<HashMap<_, _>>();
                for row in &rows {
                    let key = row.key();
                    if !row.live || self.members.contains_key(&key) {
                        continue;
                    }
                    let evidence = if row.sid == root {
                        Evidence::Session
                    } else if row.ppid == root {
                        Evidence::DirectChild
                    } else if let Some(parent) = owned.get(&row.ppid) {
                        Evidence::Parent(Arc::clone(parent))
                    } else {
                        continue;
                    };
                    match os::Identity::capture_owned(row.clone(), evidence.clone()) {
                        Ok(Some(identity)) => {
                            self.members.insert(key, Arc::new(identity));
                            self.pending_capture.remove(&key);
                        }
                        Ok(None) => {
                            self.pending_capture.remove(&key);
                        }
                        Err(error) => {
                            self.pending_capture.insert(key, (row.clone(), evidence));
                            first_error.get_or_insert(error);
                        }
                    }
                }
                if self.members.len() == previous {
                    break;
                }
            }
        }
        // Discover children before releasing their parents. A failed capture
        // holds its original Parent Arc independently of this live-member map.
        if let Err(error) = self.prune_dead() {
            first_error.get_or_insert(error);
        }
        if let Some(error) = first_error {
            Err(error)
        } else {
            Ok(())
        }
    }

    // Retained ownership and its original parent capability must survive any
    // retry ambiguity. The inward closure also permits deterministic races in
    // tests without replacing the production identity/signal primitive.
    fn retry_pending_capture_with(
        &mut self,
        mut capture: impl FnMut(os::Row, Evidence) -> io::Result<Option<os::Identity>>,
    ) -> io::Result<()> {
        let mut first_error = None;
        self.pending_capture.retain(|key, (row, evidence)| {
            match capture(row.clone(), evidence.clone()) {
                Ok(Some(identity)) => {
                    self.members.insert(*key, Arc::new(identity));
                    false
                }
                Ok(None) => false,
                Err(error) => {
                    first_error.get_or_insert(error);
                    true
                }
            }
        });
        first_error.map_or(Ok(()), Err)
    }

    fn prune_dead(&mut self) -> io::Result<()> {
        let mut first_error = None;
        self.members.retain(|_, identity| match identity.live() {
            Ok(live) => live,
            Err(error) => {
                first_error.get_or_insert(error);
                true
            }
        });
        first_error.map_or(Ok(()), Err)
    }

    pub(super) fn terminate_leader(&self) -> io::Result<()> {
        // Unlike portable-pty's ChildKiller, this never waits or reaps. A
        // successful direct-child waitid probe proves the exclusive fence;
        // even exit after that probe cannot recycle this unreaped PID.
        if self.leader_exited()? {
            return Ok(());
        }
        let root = self
            .root
            .ok_or_else(|| io::Error::other("native PTY child PID unavailable"))?;
        // SAFETY: root is exclusively owned and unreaped, validated above;
        // kill accepts an integer PID and signal without pointer arguments.
        if unsafe { libc::kill(root, libc::SIGKILL) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub(super) fn terminate_members(&mut self) -> io::Result<()> {
        let mut first_error = None;
        self.members
            .retain(|_, identity| match identity.signal(libc::SIGKILL) {
                Ok(true) => true,
                Ok(false) => false,
                Err(error) => {
                    first_error.get_or_insert(error);
                    true
                }
            });
        if let Some(error) = first_error {
            Err(error)
        } else {
            Ok(())
        }
    }

    pub(super) fn settled(&mut self) -> io::Result<bool> {
        // Re-census after signaling; never interpret an inspection error as an
        // empty session. Retain identities until death is positively observed.
        self.observe_cleanup()?;
        Ok(self.members.is_empty() && self.pending_capture.is_empty())
    }
}

#[cfg(all(test, target_os = "macos"))]
pub(super) fn observed_key_for_test(pid: u32) -> io::Result<os::Key> {
    macos::inspect(pid as libc::pid_t)?
        .map(|row| row.key())
        .ok_or_else(|| io::Error::other("live latency fixture disappeared"))
}

#[cfg(all(
    any(test, feature = "test-support"),
    any(target_os = "linux", target_os = "macos")
))]
pub(super) struct TestIdentity(os::Identity);
#[cfg(all(
    any(test, feature = "test-support"),
    any(target_os = "linux", target_os = "macos")
))]
impl TestIdentity {
    pub(super) fn capture(pid: u32) -> io::Result<Option<Self>> {
        #[cfg(target_os = "linux")]
        let row = os::rows(None)?
            .into_iter()
            .find(|row| row.pid == pid as libc::pid_t);
        #[cfg(target_os = "macos")]
        let row = macos::inspect(pid as libc::pid_t)?;
        match row {
            Some(row) => os::Identity::capture(row).map(|identity| identity.map(Self)),
            None => Ok(None),
        }
    }
    pub(super) fn is_alive(&self) -> io::Result<bool> {
        self.0.live()
    }
    pub(super) fn kill(&mut self) -> io::Result<()> {
        self.0.signal(libc::SIGKILL).map(|_| ())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(super) struct Authority;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl Authority {
    pub(super) fn new(_: Option<u32>) -> Self {
        Self
    }
    pub(super) fn leader_exited(&self) -> io::Result<bool> {
        preflight().map(|_| false)
    }
    pub(super) fn observe(&mut self) -> io::Result<()> {
        preflight()
    }
    pub(super) fn observe_cleanup(&mut self) -> io::Result<()> {
        preflight()
    }
    pub(super) fn terminate_members(&mut self) -> io::Result<()> {
        preflight()
    }
    pub(super) fn terminate_leader(&self) -> io::Result<()> {
        preflight()
    }
    pub(super) fn settled(&mut self) -> io::Result<bool> {
        preflight().map(|_| false)
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
#[path = "platform_tests.rs"]
mod tests;
