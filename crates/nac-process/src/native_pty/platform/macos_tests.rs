use super::*;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[test]
fn pending_fork_is_live_and_unknown_status_never_proves_death() {
    for status in 1..=4 {
        assert!(classify_status(status).unwrap());
    }
    assert!(!classify_status(5).unwrap());
    for status in [0, 6, 9, 15, u32::MAX] {
        assert_eq!(
            classify_status(status).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
}

#[test]
fn foreign_child_of_replacement_numeric_parent_is_not_adopted() {
    let fixture = sleep_fixture();
    let row = inspect(fixture.0.id() as libc::pid_t).unwrap().unwrap();
    // Same numeric parent, different kernel-stamped identity: the census saw
    // the original owned parent, then a foreign replacement parent's child.
    let stale_parent = std::sync::Arc::new(Identity {
        pid: row.ppid,
        uniqueid: row.unique.parent_uniqueid.wrapping_add(1),
    });
    assert!(
        Identity::capture_owned(row, super::super::Evidence::Parent(stale_parent))
            .unwrap()
            .is_none()
    );
    assert!(
        inspect(fixture.0.id() as libc::pid_t)
            .unwrap()
            .unwrap()
            .live
    );
}

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn sleep_fixture() -> Fixture {
    Fixture(
        Command::new("/bin/sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}

#[test]
fn missing_atomic_signal_capability_is_unsupported() {
    assert_eq!(
        require_signal_function(None).unwrap_err().kind(),
        io::ErrorKind::Unsupported
    );
}

#[test]
fn audit_signal_rejects_wrong_version_without_signaling_fixture() {
    let fixture = sleep_fixture();
    let pid = fixture.0.id() as libc::pid_t;
    let row = inspect(pid).unwrap().unwrap();
    let mut key = [0u32; 8];
    key[5] = pid as u32;
    key[7] = row.unique.version.wrapping_add(1) as u32;
    // SAFETY: runtime-checked signature and fully initialized token storage.
    let result = unsafe { signal_function().unwrap()(&key, libc::SIGKILL) };
    assert_eq!(result, libc::ESRCH);
    assert!(inspect(pid).unwrap().unwrap().live);
    // Positive errno is the libproc wrapper contract, not errno/-1.
    key[7] = row.unique.version as u32;
    // SAFETY: same verified function and token storage; invalid signal is
    // deliberately rejected without affecting the disposable fixture.
    let invalid = unsafe { signal_function().unwrap()(&key, 0) };
    assert_eq!(invalid, libc::EINVAL);
}

#[test]
fn mismatched_unique_identity_cannot_signal_fixture() {
    let fixture = sleep_fixture();
    let pid = fixture.0.id() as libc::pid_t;
    let row = inspect(pid).unwrap().unwrap();
    let wrong = Identity {
        pid,
        uniqueid: row.unique.uniqueid.wrapping_add(1),
    };
    assert!(!wrong.signal(libc::SIGKILL).unwrap());
    assert!(inspect(pid).unwrap().unwrap().live);
}

#[test]
fn exec_refresh_keeps_unique_identity_and_uses_new_version() {
    let root = std::env::temp_dir().join(format!("nac-native-exec-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    struct Files(std::path::PathBuf);
    impl Drop for Files {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _files = Files(root.clone());
    let gate = root.join("gate");
    let mut fixture = Fixture(
        Command::new("/bin/sh")
            .args([
                "-c",
                "while [ ! -e \"$1\" ]; do sleep 0.01; done; exec /bin/sleep 30",
                "fixture",
            ])
            .arg(&gate)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let pid = fixture.0.id() as libc::pid_t;
    let first = inspect(pid).unwrap().unwrap();
    let identity = Identity::capture(first.clone()).unwrap().unwrap();
    std::fs::write(&gate, b"go").unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let changed = loop {
        let current = inspect(pid).unwrap().unwrap();
        if current.unique.version != first.unique.version {
            break current;
        }
        assert!(Instant::now() < deadline, "exec version never changed");
        std::thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(changed.unique.uniqueid, first.unique.uniqueid);
    assert!(identity.signal(libc::SIGKILL).unwrap());
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if fixture.0.try_wait().unwrap().is_some() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "atomic signal did not end fixture"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn atomic_signal_permission_failure_retains_exact_live_identity() {
    unsafe extern "C" fn denied(_: *const [u32; 8], _: i32) -> i32 {
        libc::EPERM
    }
    let fixture = sleep_fixture();
    let pid = fixture.0.id() as libc::pid_t;
    let identity = Identity::capture(inspect(pid).unwrap().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(
        identity
            .signal_with(libc::SIGKILL, denied)
            .unwrap_err()
            .raw_os_error(),
        Some(libc::EPERM)
    );
    assert!(identity.live().unwrap());
}

struct CaptureProbe {
    child: std::cell::RefCell<Row>,
    denied: std::cell::Cell<bool>,
}
impl inspection::Probe for CaptureProbe {
    fn unique(&self, _: libc::pid_t) -> io::Result<Option<Unique>> {
        if self.denied.get() {
            return Err(io::Error::from_raw_os_error(libc::EPERM));
        }
        Ok(Some(self.child.borrow().unique))
    }
    fn short(&self, pid: libc::pid_t) -> io::Result<Option<inspection::Short>> {
        Ok(Some(inspection::Short {
            pid,
            ppid: self.child.borrow().ppid,
            status: if self.child.borrow().live { 3 } else { 5 },
        }))
    }
    fn sid(&self, _: libc::pid_t) -> io::Result<Option<libc::pid_t>> {
        Ok(Some(self.child.borrow().sid))
    }
}
fn captured_child() -> Row {
    Row {
        pid: 200,
        ppid: 50,
        sid: 900,
        live: true,
        unique: Unique {
            uniqueid: 7,
            parent_uniqueid: 9,
            version: 1,
            ..Unique::default()
        },
    }
}
#[test]
fn pending_capture_reparents_after_failure_and_original_parent_prune() {
    use super::super::{Authority, Evidence};
    use std::sync::Arc;
    let row = captured_child();
    let key = row.key();
    let parent = Arc::new(Identity {
        pid: 50,
        uniqueid: 9,
    });
    let weak = Arc::downgrade(&parent);
    let probe = CaptureProbe {
        child: std::cell::RefCell::new(row.clone()),
        denied: std::cell::Cell::new(true),
    };
    let evidence = Evidence::Parent(Arc::clone(&parent));
    assert_eq!(
        Identity::capture_owned_with(row.clone(), evidence.clone(), &probe)
            .err()
            .unwrap()
            .raw_os_error(),
        Some(libc::EPERM)
    );
    let mut authority = Authority::new(None);
    authority.members.insert((50, 9), Arc::clone(&parent));
    authority.pending_capture.insert(key, (row, evidence));
    drop(parent);
    assert!(authority
        .retry_pending_capture_with(|row, evidence| Identity::capture_owned_with(
            row, evidence, &probe
        ))
        .is_err());
    assert!(authority.pending_capture.contains_key(&key));
    // Deterministic positive-parent-prune transition; original child witness
    // remains independent. Existing real active-prune test covers OS pruning.
    authority.members.remove(&(50, 9));
    assert!(weak.upgrade().is_some());
    probe.child.borrow_mut().ppid = 1;
    probe.child.borrow_mut().sid = 901;
    probe.denied.set(false);
    authority
        .retry_pending_capture_with(|row, evidence| {
            Identity::capture_owned_with(row, evidence, &probe)
        })
        .unwrap();
    assert!(authority.pending_capture.is_empty());
    assert!(authority.members.contains_key(&key));
    assert!(weak.upgrade().is_none());
}
#[test]
fn pending_same_identity_session_and_direct_child_witness_survive_movement() {
    use super::super::Evidence;
    let row = captured_child();
    let mut moved = row.clone();
    moved.ppid = 1;
    moved.sid = 901;
    let probe = CaptureProbe {
        child: std::cell::RefCell::new(moved),
        denied: std::cell::Cell::new(false),
    };
    for evidence in [Evidence::Session, Evidence::DirectChild] {
        let id = Identity::capture_owned_with(row.clone(), evidence, &probe)
            .unwrap()
            .unwrap();
        assert_eq!(id.uniqueid, row.unique.uniqueid);
    }
}
#[test]
fn pending_private_identity_replacement_or_death_resolves_but_birth_inconsistency_retains() {
    use super::super::Evidence;
    use std::sync::Arc;
    let row = captured_child();
    let evidence = Evidence::Parent(Arc::new(Identity {
        pid: 50,
        uniqueid: 9,
    }));
    let probe = CaptureProbe {
        child: std::cell::RefCell::new(row.clone()),
        denied: std::cell::Cell::new(false),
    };
    probe.child.borrow_mut().unique.uniqueid = 8;
    assert!(
        Identity::capture_owned_with(row.clone(), evidence.clone(), &probe)
            .unwrap()
            .is_none()
    );
    *probe.child.borrow_mut() = row.clone();
    probe.child.borrow_mut().live = false;
    assert!(
        Identity::capture_owned_with(row.clone(), evidence.clone(), &probe)
            .unwrap()
            .is_none()
    );
    *probe.child.borrow_mut() = row.clone();
    probe.child.borrow_mut().unique.parent_uniqueid = 10;
    assert_eq!(
        Identity::capture_owned_with(row, evidence, &probe)
            .err()
            .unwrap()
            .kind(),
        io::ErrorKind::InvalidData
    );
}
