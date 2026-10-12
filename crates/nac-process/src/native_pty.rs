//! Exclusive lifetime ownership for a freshly created native PTY session.
//!
//! This authority is never valid for an inherited SSH session. Session census
//! retains ordinary job groups through leader exit; it does not guarantee
//! adoption of a descendant that forks and creates a new session between scans.

mod platform;
#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests;

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// The adapter must transfer an exclusive, unreaped direct child whose native
/// spawn established a fresh session before exec. No other caller may reap it.
pub trait NativePtyChild: Send {
    fn process_id(&self) -> Option<u32>;
    fn try_wait(&mut self) -> io::Result<Option<i32>>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativePtySnapshot {
    pub leader_alive: bool,
    pub exit_code: Option<i32>,
    pub cleanup_pending: bool,
    pub error: Option<String>,
}

struct Shared {
    child: Mutex<Option<Box<dyn NativePtyChild>>>,
    snapshot: Mutex<NativePtySnapshot>,
    terminate: AtomicBool,
    started: AtomicBool,
    on_change: Arc<dyn Fn() + Send + Sync>,
    pid: Option<u32>,
    #[cfg(any(test, feature = "test-support"))]
    inspection_failure: AtomicBool,
    #[cfg(any(test, feature = "test-support"))]
    worker_start_failure: AtomicBool,
    #[cfg(all(test, target_os = "macos"))]
    observed: Mutex<std::collections::HashMap<(libc::pid_t, u64), std::time::Instant>>,
}

struct Control(Arc<Shared>);

// A failed OS thread allocation must not drop an unreaped child on last-handle
// drop. Retain that authority and retry it at the next native admission/control
// operation. Ordinary running workers own their authority independently.
fn pending_workers() -> &'static Mutex<Vec<Arc<Shared>>> {
    static PENDING: OnceLock<Mutex<Vec<Arc<Shared>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

fn retry_workers() {
    let pending = std::mem::take(
        &mut *pending_workers()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for worker in pending {
        start_worker(&worker);
    }
}

impl Drop for Control {
    fn drop(&mut self) {
        self.0.terminate.store(true, Ordering::SeqCst);
        start_worker(&self.0);
    }
}

/// A cheap clonable status/control handle. The worker exclusively owns the
/// child and retains failed cleanup authority independently of handle drops.
#[derive(Clone)]
pub struct NativePtyOwner(Arc<Control>);

impl NativePtyOwner {
    /// Check required identity capabilities before spawning a new human PTY.
    /// This does not change generic process supervision or model OS support.
    pub fn preflight() -> io::Result<()> {
        retry_workers();
        if !pending_workers()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
        {
            return Err(io::Error::other(
                "native PTY worker setup cleanup remains retained",
            ));
        }
        platform::preflight()
    }

    /// Transfer a successful fresh native session spawn before any wait/reap.
    /// Post-spawn inspection/thread errors retain the child for cleanup retry.
    pub fn from_fresh_session(
        child: Box<dyn NativePtyChild>,
        on_change: Arc<dyn Fn() + Send + Sync>,
    ) -> Self {
        let owner = Self::create(child, on_change);
        start_worker(&owner.0 .0);
        owner
    }

    fn create(child: Box<dyn NativePtyChild>, on_change: Arc<dyn Fn() + Send + Sync>) -> Self {
        retry_workers();
        let shared = Arc::new(Shared {
            pid: child.process_id(),
            child: Mutex::new(Some(child)),
            snapshot: Mutex::new(NativePtySnapshot {
                leader_alive: true,
                exit_code: None,
                cleanup_pending: true,
                error: None,
            }),
            terminate: AtomicBool::new(false),
            started: AtomicBool::new(false),
            on_change,
            #[cfg(any(test, feature = "test-support"))]
            inspection_failure: AtomicBool::new(false),
            #[cfg(any(test, feature = "test-support"))]
            worker_start_failure: AtomicBool::new(false),
            #[cfg(all(test, target_os = "macos"))]
            observed: Mutex::new(std::collections::HashMap::new()),
        });
        Self(Arc::new(Control(shared)))
    }

    pub fn process_id(&self) -> Option<u32> {
        self.0 .0.pid
    }

    pub fn accepts_input(&self) -> bool {
        self.snapshot().leader_alive && !self.0 .0.terminate.load(Ordering::SeqCst)
    }

    pub fn same_owner(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_inspection_failure_for_test(&self, fail: bool) {
        self.0 .0.inspection_failure.store(fail, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> NativePtySnapshot {
        self.0
             .0
            .snapshot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// A bounded request; cancellation or failure leaves the same authority
    /// available to retry. Process work never runs in the caller's map lock.
    pub async fn terminate(&self) -> io::Result<()> {
        retry_workers();
        self.0 .0.terminate.store(true, Ordering::SeqCst);
        start_worker(&self.0 .0);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            let status = self.snapshot();
            if !status.cleanup_pending {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(io::Error::other(status.error.unwrap_or_else(|| {
                    "native PTY cleanup is still pending".to_string()
                })));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

fn publish(shared: &Shared, snapshot: NativePtySnapshot) {
    let changed = {
        let mut old = shared
            .snapshot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if *old == snapshot {
            false
        } else {
            *old = snapshot;
            true
        }
    };
    if changed {
        // A delivery callback cannot discard process cleanup authority.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (shared.on_change)()));
    }
}

fn start_worker(shared: &Arc<Shared>) {
    if shared.started.swap(true, Ordering::SeqCst) {
        return;
    }
    #[cfg(any(test, feature = "test-support"))]
    let injected = shared.worker_start_failure.load(Ordering::SeqCst);
    #[cfg(not(any(test, feature = "test-support")))]
    let injected = false;
    let result = if injected {
        Err(io::Error::other("injected native PTY worker start failure"))
    } else {
        let worker = Arc::clone(shared);
        std::thread::Builder::new()
            .name("nac-native-pty-owner".to_string())
            .spawn(move || supervise(worker))
    };
    if let Err(error) = result {
        shared.started.store(false, Ordering::SeqCst);
        let mut snapshot = shared
            .snapshot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        snapshot.error = Some(format!("native PTY worker unavailable: {error}"));
        publish(shared, snapshot);
        let mut retained = pending_workers()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !retained.iter().any(|worker| Arc::ptr_eq(worker, shared)) {
            retained.push(Arc::clone(shared));
        }
    }
}

fn supervise(shared: Arc<Shared>) {
    let Some(mut child) = shared
        .child
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
    else {
        return;
    };
    let mut authority = platform::Authority::new(shared.pid);
    let mut leader_alive = true;
    loop {
        let mut error = None;
        #[cfg(any(test, feature = "test-support"))]
        if shared.inspection_failure.load(Ordering::SeqCst) {
            publish(
                &shared,
                NativePtySnapshot {
                    leader_alive,
                    exit_code: None,
                    cleanup_pending: true,
                    error: Some("injected native PTY inspection failure".to_string()),
                },
            );
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        match authority.leader_exited() {
            Ok(exited) => {
                if exited {
                    leader_alive = false;
                    shared.terminate.store(true, Ordering::SeqCst);
                }
            }
            Err(failure) => error = Some(failure.to_string()),
        }
        let observation = if shared.terminate.load(Ordering::SeqCst) {
            authority.observe_cleanup()
        } else {
            authority.observe()
        };
        if let Err(failure) = observation {
            error = Some(failure.to_string());
        }
        #[cfg(all(test, target_os = "macos"))]
        for key in authority.observed_keys_for_test() {
            shared
                .observed
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .entry(key)
                .or_insert_with(std::time::Instant::now);
        }
        if shared.terminate.load(Ordering::SeqCst) {
            // Preserve terminal close's immediate SIGKILL policy. Stop the
            // leader before its jobs so it cannot replace killed children or
            // append shell diagnostics during an incidental grace period.
            // The direct-child PID cannot be recycled before this owner reaps.
            if leader_alive {
                if let Err(failure) = authority.terminate_leader() {
                    error = Some(failure.to_string());
                }
            }
            if let Err(failure) = authority.terminate_members() {
                error = Some(failure.to_string());
            }
            if !leader_alive && error.is_none() {
                match authority.settled() {
                    Ok(true) => match child.try_wait() {
                        Ok(Some(exit_code)) => {
                            // Release adapter-owned lifetime leases before
                            // publishing successful settlement.
                            drop(child);
                            publish(
                                &shared,
                                NativePtySnapshot {
                                    leader_alive: false,
                                    exit_code: Some(exit_code),
                                    cleanup_pending: false,
                                    error: None,
                                },
                            );
                            return;
                        }
                        Ok(None) => {}
                        Err(failure) => error = Some(failure.to_string()),
                    },
                    Ok(false) => {}
                    Err(failure) => error = Some(failure.to_string()),
                }
            }
        }
        publish(
            &shared,
            NativePtySnapshot {
                leader_alive,
                exit_code: None,
                cleanup_pending: true,
                error: error.clone(),
            },
        );
        let period = if error.is_some() {
            Duration::from_millis(250)
        } else {
            Duration::from_millis(50)
        };
        #[cfg(target_os = "macos")]
        let period = platform::aligned_delay(period);
        std::thread::sleep(period);
    }
}

/// Identity-safe teardown for caller-owned disposable native-process fixtures.
#[cfg(all(
    any(test, feature = "test-support"),
    any(target_os = "linux", target_os = "macos")
))]
pub struct NativePtyTestIdentity(platform::TestIdentity);

#[cfg(all(
    any(test, feature = "test-support"),
    any(target_os = "linux", target_os = "macos")
))]
impl NativePtyTestIdentity {
    pub fn capture(pid: u32) -> io::Result<Option<Self>> {
        platform::TestIdentity::capture(pid).map(|identity| identity.map(Self))
    }
    pub fn is_alive(&self) -> io::Result<bool> {
        self.0.is_alive()
    }
    pub fn kill(&mut self) -> io::Result<()> {
        self.0.kill()
    }
}
