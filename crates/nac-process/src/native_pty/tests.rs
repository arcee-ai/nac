use super::*;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

#[cfg(target_os = "macos")]
#[path = "latency_tests.rs"]
mod latency;

static OWNER_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Adapter {
    child: Child,
    released: Arc<AtomicBool>,
}
impl NativePtyChild for Adapter {
    fn process_id(&self) -> Option<u32> {
        Some(self.child.id())
    }
    fn try_wait(&mut self) -> io::Result<Option<i32>> {
        self.child
            .try_wait()
            .map(|status| status.map(|status| status.code().unwrap_or(1)))
    }
}
impl Drop for Adapter {
    fn drop(&mut self) {
        self.released.store(true, Ordering::SeqCst);
    }
}

struct Fixture(NativePtyOwner);
impl Drop for Fixture {
    fn drop(&mut self) {
        // Even assertion failures must release the injected barrier and request
        // cleanup; the exclusive worker retains the child until it is reaped.
        self.0.set_inspection_failure_for_test(false);
        self.0 .0 .0.terminate.store(true, Ordering::SeqCst);
    }
}

fn fixture(
    command: &str,
    fail_start: bool,
) -> io::Result<(Fixture, Arc<AtomicBool>, Arc<AtomicBool>)> {
    NativePtyOwner::preflight()?;
    let released = Arc::new(AtomicBool::new(false));
    let woke = Arc::new(AtomicBool::new(false));
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", command])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: setsid is async-signal-safe and called only in this disposable
    // child before exec, matching the fresh session ownership prerequisite.
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() < 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let child = cmd.spawn()?;
    let notified = Arc::clone(&woke);
    let owner = NativePtyOwner::create(
        Box::new(Adapter {
            child,
            released: Arc::clone(&released),
        }),
        Arc::new(move || {
            notified.store(true, Ordering::SeqCst);
        }),
    );
    owner
        .0
         .0
        .worker_start_failure
        .store(fail_start, Ordering::SeqCst);
    start_worker(&owner.0 .0);
    Ok((Fixture(owner), released, woke))
}

#[tokio::test]
async fn immediate_exit_keeps_fence_until_reap_and_releases_adapter() {
    let _serial = OWNER_TEST_LOCK.lock().await;
    for _ in 0..8 {
        let (fixture, released, woke) = fixture("exit 7", false).unwrap();
        tokio::time::timeout(Duration::from_secs(4), async {
            while fixture.0.snapshot().cleanup_pending {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(fixture.0.snapshot().exit_code, Some(7));
        assert!(!fixture.0.snapshot().leader_alive);
        assert!(released.load(Ordering::SeqCst));
        assert!(woke.load(Ordering::SeqCst));
    }
}

#[tokio::test]
async fn cancelled_cleanup_keeps_child_and_failure_authority_for_retry() {
    let _serial = OWNER_TEST_LOCK.lock().await;
    let (fixture, released, _) = fixture("exec /bin/sleep 30", false).unwrap();
    fixture.0.set_inspection_failure_for_test(true);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    while fixture.0.snapshot().error.is_none() {
        assert!(tokio::time::Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let clone = fixture.0.clone();
    assert!(clone.same_owner(&fixture.0));
    assert!(
        tokio::time::timeout(Duration::from_millis(100), clone.terminate())
            .await
            .is_err()
    );
    assert!(clone.snapshot().cleanup_pending);
    assert!(!released.load(Ordering::SeqCst));
    fixture.0.set_inspection_failure_for_test(false);
    tokio::time::timeout(Duration::from_secs(4), clone.terminate())
        .await
        .unwrap()
        .unwrap();
    assert!(released.load(Ordering::SeqCst));
    assert!(!clone.snapshot().cleanup_pending);
}

#[tokio::test]
async fn last_handle_drop_transfers_cleanup_and_adapter_lifetime() {
    let _serial = OWNER_TEST_LOCK.lock().await;
    let (fixture, released, _) = fixture("exec /bin/sleep 30", false).unwrap();
    drop(fixture);
    tokio::time::timeout(Duration::from_secs(4), async {
        while !released.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn failed_worker_start_and_last_drop_retain_discoverable_retry_authority() {
    let _serial = OWNER_TEST_LOCK.lock().await;
    let (fixture, released, _) = fixture("exec /bin/sleep 30", true).unwrap();
    struct Recovery(std::sync::Weak<Shared>);
    impl Drop for Recovery {
        fn drop(&mut self) {
            if let Some(shared) = self.0.upgrade() {
                shared.worker_start_failure.store(false, Ordering::SeqCst);
                shared.terminate.store(true, Ordering::SeqCst);
                retry_workers();
                start_worker(&shared);
            }
        }
    }
    let recovery = Recovery(Arc::downgrade(&fixture.0 .0 .0));
    assert!(fixture
        .0
        .snapshot()
        .error
        .unwrap()
        .contains("worker start failure"));
    drop(fixture);
    assert!(!released.load(Ordering::SeqCst));
    let retained = recovery
        .0
        .upgrade()
        .expect("failed worker authority retained after all public handles drop");
    assert!(retained.child.lock().unwrap().is_some());
    assert!(pending_workers()
        .lock()
        .unwrap()
        .iter()
        .any(|worker| Arc::ptr_eq(worker, &retained)));
    retained.worker_start_failure.store(false, Ordering::SeqCst);
    drop(retained);
    NativePtyOwner::preflight().unwrap();
    tokio::time::timeout(Duration::from_secs(4), async {
        while !released.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(pending_workers().lock().unwrap().is_empty());
}
