//! Isolated process-global signal/subreaper and exact descriptor/thread tests.
use super::*;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};

const CASE_ENV: &str = "NAC_PEER_ISOLATED_CASE";
const PEER_PATH: &str = "NAC_PEER_TEST_SOCKET";

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn isolated(name: &str) -> bool {
    if std::env::var(CASE_ENV).as_deref() == Ok(name) {
        return true;
    }
    let module = module_path!().split_once("::").unwrap().1;
    let mut child = ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &format!("{module}::{name}"), "--nocapture"])
            .env(CASE_ENV, name)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(15);
    while child.0.try_wait().unwrap().is_none() {
        assert!(
            Instant::now() < deadline,
            "isolated fixture exceeded teardown bound"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    let mut stdout = String::new();
    child
        .0
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut stdout)
        .unwrap();
    let mut stderr = String::new();
    child
        .0
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(child.0.wait().unwrap().success(), "{stdout}\n{stderr}");
    assert!(stdout.contains("1 passed; 0 failed"), "{stdout}\n{stderr}");
    false
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

fn count(path: &str) -> usize {
    std::fs::read_dir(path).unwrap().count()
}

#[test]
fn exact_descriptor_and_thread_teardown() {
    if !isolated("exact_descriptor_and_thread_teardown") {
        return;
    }
    runtime().block_on(async {
        let before_fds = count("/proc/self/fd");
        let before_threads = count("/proc/self/task");
        for _ in 0..64 {
            let (connection, owner, peer) = fixture();
            let denial = owner.denial_handle();
            let binding = connection.binding();
            finish(owner, connection).await;
            drop(peer);
            assert!(binding.0.upgrade().is_none());
            denial.invalidated().await;
            assert_eq!(count("/proc/self/fd"), before_fds);
        }
        for _ in 0..16 {
            let (stream, peer) = UnixStream::pair().unwrap();
            FAIL_SPAWN.with(|fail| fail.set(true));
            assert!(capture(stream, Instant::now() + Duration::from_secs(1)).is_err());
            drop(peer);
            assert_eq!(count("/proc/self/fd"), before_fds);
        }
        let deadline = Instant::now() + Duration::from_secs(1);
        while count("/proc/self/task") != before_threads {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(1));
        }
    });
}

extern "C" fn interrupt(_: libc::c_int) {}

#[test]
fn interrupted_poll_keeps_the_original_cutoff() {
    if !isolated("interrupted_poll_keeps_the_original_cutoff") {
        return;
    }
    // SAFETY: only this isolated process installs a no-op signal handler. The
    // handler touches no Rust state, locks or async-signal-unsafe functions.
    let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
    action.sa_sigaction = interrupt as *const () as usize;
    assert_eq!(unsafe { libc::sigemptyset(&mut action.sa_mask) }, 0);
    assert_eq!(
        unsafe { libc::sigaction(libc::SIGUSR1, &action, std::ptr::null_mut()) },
        0
    );
    runtime().block_on(async {
        let (stream, _peer) = UnixStream::pair().unwrap();
        let cutoff = Instant::now() + Duration::from_millis(120);
        let (connection, owner) = capture(stream, cutoff).unwrap();
        let kernel = &owner.shared.kernel;
        while kernel.thread_id.load(Ordering::Acquire) == 0 {
            assert!(Instant::now() < cutoff);
            std::thread::sleep(Duration::from_millis(1));
        }
        // Repeated interrupts while the current-thread async runtime is blocked.
        while Instant::now() < cutoff - Duration::from_millis(20) {
            let thread = kernel.thread_id.load(Ordering::Acquire) as libc::pthread_t;
            // SAFETY: owner/monitor are retained and have not reached cutoff.
            assert_eq!(unsafe { libc::pthread_kill(thread, libc::SIGUSR1) }, 0);
            std::thread::sleep(Duration::from_millis(3));
        }
        std::thread::sleep(Duration::from_millis(50));
        assert!(kernel.interrupted.load(Ordering::Relaxed) > 0);
        assert_eq!(owner.original_cutoff(), cutoff);
        assert!(owner.shared.signal.denied.load(Ordering::Acquire));
        finish(owner, connection).await;
    });
}

struct PeerProcess {
    leader: ChildGuard,
    inherited: libc::pid_t,
    path: std::path::PathBuf,
}
impl Drop for PeerProcess {
    fn drop(&mut self) {
        let _ = self.leader.0.kill();
        let _ = self.leader.0.wait();
        if self.inherited > 0 {
            // SAFETY: this isolated subreaper owns this exact unreaped fixture.
            unsafe { libc::kill(self.inherited, libc::SIGKILL) };
            loop {
                let result = unsafe { libc::waitpid(self.inherited, std::ptr::null_mut(), 0) };
                if result >= 0 || io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                    break;
                }
            }
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

#[test]
fn peer_exit_denies_while_inherited_socket_is_open() {
    if !isolated("peer_exit_denies_while_inherited_socket_is_open") {
        return;
    }
    // SAFETY: the isolated test becomes subreaper only for its own fixtures.
    assert_eq!(
        unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) },
        0
    );
    let path = std::env::temp_dir().join(format!("nac-peer-{}.sock", uuid::Uuid::new_v4()));
    let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
    let module = module_path!().split_once("::").unwrap().1;
    let leader = ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &format!("{module}::peer_process_fixture")])
            .env(PEER_PATH, &path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let mut process = PeerProcess {
        leader,
        inherited: -1,
        path,
    };
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(error) => panic!("accept: {error}"),
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut pid = [0; 4];
    stream.read_exact(&mut pid).unwrap();
    process.inherited = i32::from_ne_bytes(pid);
    assert!(process.inherited > 0);
    stream.set_nonblocking(true).unwrap();
    runtime().block_on(async {
        let (connection, owner) = capture(
            UnixStream::from_std(stream).unwrap(),
            Instant::now() + Duration::from_secs(5),
        )
        .unwrap();
        owner.check_current().unwrap();
        process
            .leader
            .0
            .stdin
            .take()
            .unwrap()
            .write_all(b"x")
            .unwrap();
        assert!(process.leader.0.wait().unwrap().success());
        // No async polling/current checks: the actual pidfd monitor must deny.
        let deadline = Instant::now() + Duration::from_secs(1);
        while !owner.shared.signal.denied.load(Ordering::Acquire) {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(1));
        }
        let cause = owner.shared.kernel.observed_events.load(Ordering::Acquire);
        assert_eq!(cause & 1, 1, "actual original peer pidfd did not trigger");
        assert_eq!(
            cause & 2,
            0,
            "inherited socket unexpectedly reached EOF first"
        );
        finish(owner, connection).await;
    });
    // PeerProcess reaps the inherited child after the leader's real exit.
}

#[test]
fn peer_process_fixture() {
    let Ok(path) = std::env::var(PEER_PATH) else {
        return;
    };
    let mut peer = std::os::unix::net::UnixStream::connect(path).unwrap();
    // SAFETY: after fork, the child performs only poll and _exit, no Rust
    // allocation, locks, runtime activity or destructors in the forked image.
    let inherited = unsafe { libc::fork() };
    assert!(inherited >= 0);
    if inherited == 0 {
        let mut observed = libc::pollfd {
            fd: peer.as_raw_fd(),
            events: SOCKET_EVENTS,
            revents: 0,
        };
        unsafe {
            libc::poll(&mut observed, 1, 10_000);
            libc::_exit(0);
        }
    }
    peer.write_all(&inherited.to_ne_bytes()).unwrap();
    std::io::stdin().read_exact(&mut [0]).unwrap();
}

struct DenyOnWakerDrop {
    denial: PeerDenial,
    entered: Arc<AtomicBool>,
}
impl std::task::Wake for DenyOnWakerDrop {
    fn wake(self: Arc<Self>) {}
}
impl Drop for DenyOnWakerDrop {
    fn drop(&mut self) {
        self.entered.store(true, Ordering::Release);
        self.denial.deny();
    }
}

#[test]
fn waker_drop_reentrant_denial_does_not_deadlock() {
    if !isolated("waker_drop_reentrant_denial_does_not_deadlock") {
        return;
    }
    runtime().block_on(async {
        let (mut connection, owner, _peer) = fixture();
        let entered = Arc::new(AtomicBool::new(false));
        let (done, wait) = std::sync::mpsc::channel();
        let observed = Arc::clone(&entered);
        let watchdog = std::thread::spawn(move || {
            if wait.recv_timeout(Duration::from_secs(1)).is_err() {
                eprintln!(
                    "reentrant waker watchdog expired; destructor entered={}",
                    observed.load(Ordering::Acquire)
                );
                // Only this isolated test process is affected; the parent
                // records a failed child and retains its diagnostic output.
                std::process::exit(78);
            }
        });
        {
            let old = Waker::from(Arc::new(DenyOnWakerDrop {
                denial: owner.denial_handle(),
                entered: Arc::clone(&entered),
            }));
            let mut cx = Context::from_waker(&old);
            // Zero-length read registers the public I/O waker without another
            // Tokio readiness reference; the slot becomes its last owner.
            let mut buffer = ReadBuf::new(&mut []);
            assert!(matches!(
                Pin::new(&mut connection).poll_read(&mut cx, &mut buffer),
                Poll::Ready(Ok(()))
            ));
        }
        let replacement = Waker::from(Arc::new(DenyOnWakerDrop {
            denial: owner.denial_handle(),
            entered: Arc::new(AtomicBool::new(false)),
        }));
        let mut cx = Context::from_waker(&replacement);
        let mut buffer = ReadBuf::new(&mut []);
        assert!(matches!(
            Pin::new(&mut connection).poll_read(&mut cx, &mut buffer),
            Poll::Ready(Err(_))
        ));
        assert!(entered.load(Ordering::Acquire));
        done.send(()).unwrap();
        watchdog.join().unwrap();
        finish(owner, connection).await;
    });
}
