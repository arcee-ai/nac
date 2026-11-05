use super::{Authority, Evidence, TestIdentity};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

struct Root {
    child: Child,
    input: ChildStdin,
    output: ChildStdout,
    authority: Authority,
    jobs: Vec<TestIdentity>,
    #[cfg(target_os = "macos")]
    readiness: Option<Readiness>,
}
impl Root {
    fn new() -> io::Result<Self> {
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "while read token; do sleep 30 & job=$!; echo $job; wait $job; done",
        ]);
        Self::from_command(command)
    }
    fn from_command(mut command: Command) -> io::Result<Self> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // SAFETY: async-signal-safe fresh-session fixture setup before exec.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut child = command.spawn()?;
        let authority = Authority::new(Some(child.id()));
        let Some(input) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::other("fixture piped stdin unavailable"));
        };
        let Some(output) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::other("fixture piped stdout unavailable"));
        };
        Ok(Self {
            input,
            output,
            child,
            authority,
            jobs: Vec::new(),
            #[cfg(target_os = "macos")]
            readiness: None,
        })
    }
    fn job(&mut self) -> io::Result<libc::pid_t> {
        #[cfg(target_os = "macos")]
        if let Some(readiness) = &mut self.readiness {
            readiness.bind()?;
        }
        self.input.write_all(b"job\n")?;
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut line = Vec::new();
        loop {
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "bounded fixture read timeout",
                ));
            }
            let mut poll = libc::pollfd {
                fd: self.output.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: one initialized writable poll descriptor, bounded wait.
            let ready = unsafe { libc::poll(&mut poll, 1, 20) };
            if ready < 0 {
                return Err(io::Error::last_os_error());
            }
            if ready == 0 {
                continue;
            }
            let mut byte = [0];
            if self.output.read(&mut byte)? != 1 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "fixture ended before PID",
                ));
            }
            if byte[0] == b'\n' {
                break;
            }
            line.push(byte[0]);
            if line.len() >= 32 {
                return Err(io::Error::other("fixture PID output exceeded bound"));
            }
        }
        let pid = String::from_utf8(line)
            .map_err(io::Error::other)?
            .parse()
            .map_err(io::Error::other)?;
        // Independent exact teardown survives any later regression assertion.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match TestIdentity::capture(pid as u32) {
                Ok(Some(identity)) => {
                    self.jobs.push(identity);
                    return Ok(pid);
                }
                Ok(None) | Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Ok(None) => return Err(io::Error::other("fixture job identity disappeared")),
                Err(error) => return Err(error),
            }
        }
    }
    fn until(&mut self, condition: impl Fn(&Authority) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            // Exec/status races are retained and retried, not test success.
            let result = self.authority.observe();
            if result.is_ok() && condition(&self.authority) {
                self.jobs
                    .retain(|identity| identity.is_alive().unwrap_or(true));
                return;
            }
            assert!(
                Instant::now() < deadline,
                "bounded census retry: {result:?}"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = self.authority.terminate_leader();
        let _ = self.authority.terminate_members();
        for job in &mut self.jobs {
            let _ = job.kill();
        }
        // Direct child remains exclusively unreaped, including assertion unwind.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn active_census_releases_dead_capabilities_after_child_discovery() {
    // Count this fixture's process FDs without other parallel test owners.
    // Use the same isolated path on macOS to exercise the wrapper there too;
    // Linux retains its actual /proc/self/fd bound below.
    const CHILD: &str = "NAC_PROCESS_TEST_FD_STRESS_CHILD";
    if std::env::var(CHILD).as_deref() != Ok("1") {
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "native_pty::platform::tests::active_census_releases_dead_capabilities_after_child_discovery",
                "--test-threads=1",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .status()
            .unwrap();
        assert!(status.success(), "isolated FD stress failed: {status}");
        return;
    }
    #[cfg(target_os = "macos")]
    let mut root = match std::env::var("NAC_PROCESS_READY_DIAGNOSTIC") {
        Err(std::env::VarError::NotPresent) => Root::new().unwrap(),
        Ok(arm) if arm == "pid-only" || arm == "ready" => Root::diagnostic(arm == "ready").unwrap(),
        other => panic!("invalid readiness diagnostic arm: {other:?}"),
    };
    #[cfg(target_os = "linux")]
    let mut root = Root::new().unwrap();
    #[cfg(target_os = "linux")]
    let fd_baseline = std::fs::read_dir("/proc/self/fd").unwrap().count();
    for _iteration in 0..48 {
        let pid = root.job().unwrap();
        root.until(|authority| authority.members.keys().any(|key| key.0 == pid));
        assert!(!root.authority.leader_exited().unwrap());
        #[cfg(target_os = "macos")]
        if let Some(readiness) = &mut root.readiness {
            readiness.wait(pid).unwrap();
            eprintln!(
                "NAC_PROCESS_READY_DIAGNOSTIC wait={} iteration={} pid={}",
                readiness.wait, _iteration, pid
            );
        }
        let identity = Arc::clone(
            root.authority
                .members
                .iter()
                .find(|(key, _)| key.0 == pid)
                .unwrap()
                .1,
        );
        let weak = Arc::downgrade(&identity);
        #[cfg(target_os = "macos")]
        let signal_trace =
            super::macos::signal_diagnostics::Scope::new(root.child.id(), pid, _iteration);
        identity.signal(libc::SIGKILL).unwrap();
        #[cfg(target_os = "macos")]
        drop(signal_trace);
        drop(identity);
        root.until(|authority| {
            authority.members.is_empty() && authority.pending_capture.is_empty()
        });
        assert!(
            weak.upgrade().is_none(),
            "dead exact capability retained under live root"
        );
        #[cfg(target_os = "linux")]
        assert!(
            std::fs::read_dir("/proc/self/fd").unwrap().count() <= fd_baseline + 12,
            "sequential child pidfds accumulated"
        );
    }
    assert!(!root.authority.leader_exited().unwrap());
}

#[test]
fn active_prune_preserves_original_parent_arc_in_pending_obligation() {
    let mut root = Root::new().unwrap();
    let pid = root.job().unwrap();
    root.until(|authority| authority.members.keys().any(|key| key.0 == pid));
    let (key, parent) = root
        .authority
        .members
        .iter()
        .find(|(key, _)| key.0 == pid)
        .map(|(key, id)| (*key, Arc::clone(id)))
        .unwrap();
    let weak = Arc::downgrade(&parent);
    #[cfg(target_os = "linux")]
    let row = super::linux::rows(None)
        .unwrap()
        .into_iter()
        .find(|row| row.pid == pid)
        .unwrap();
    #[cfg(target_os = "macos")]
    let row = super::macos::inspect(pid).unwrap().unwrap();
    // Pending proof holds the original exact parent capability independently.
    root.authority
        .pending_capture
        .insert(key, (row, Evidence::Parent(Arc::clone(&parent))));
    parent.signal(libc::SIGKILL).unwrap();
    drop(parent);
    let deadline = Instant::now() + Duration::from_secs(3);
    while root.authority.members.contains_key(&key) {
        let _ = root.authority.prune_dead();
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(weak.upgrade().is_some());
    assert_eq!(root.authority.pending_capture.len(), 1);
    root.authority.pending_capture.clear();
    assert!(weak.upgrade().is_none());
}

#[test]
fn missing_unreaped_root_fence_rejects_fresh_discovery() {
    let mut root = Root::new().unwrap();
    root.child.kill().unwrap();
    root.child.wait().unwrap(); // Deliberately violate the inward constructor prerequisite.
    assert_eq!(
        root.authority.observe().unwrap_err().raw_os_error(),
        Some(libc::ECHILD)
    );
    assert!(root.authority.members.is_empty());
    assert!(root.authority.pending_capture.is_empty());
}

// Diagnostic only: reuse this test binary's existing --exact child mechanism.
// Both arms launch the same final executable and use the same churn assertions.
#[cfg(target_os = "macos")]
const READY_HELPER: &str = "native_pty::platform::tests::readiness_diagnostic_child";

#[cfg(target_os = "macos")]
struct Readiness {
    directory: std::path::PathBuf,
    listener: Option<std::os::unix::net::UnixListener>,
    wait: bool,
    connection: Option<std::os::unix::net::UnixStream>,
}
#[cfg(target_os = "macos")]
impl Readiness {
    fn new(wait: bool) -> io::Result<Self> {
        // Keep the Unix socket address within Darwin's sockaddr_un bound.
        let directory =
            std::path::Path::new("/tmp").join(format!("nac-ready-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory)?;
        Ok(Self {
            directory,
            listener: None,
            wait,
            connection: None,
        })
    }
    fn endpoint(&self) -> std::path::PathBuf {
        self.directory.join("r")
    }
    fn bind(&mut self) -> io::Result<()> {
        drop(self.connection.take());
        drop(self.listener.take());
        match std::fs::remove_file(self.endpoint()) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let listener = std::os::unix::net::UnixListener::bind(self.endpoint())?;
        listener.set_nonblocking(true)?;
        self.listener = Some(listener);
        Ok(())
    }
    fn wait(&mut self, pid: libc::pid_t) -> io::Result<()> {
        if !self.wait {
            return Ok(());
        }
        let listener = self.listener.as_ref().unwrap();
        let mut descriptor = libc::pollfd {
            fd: listener.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one initialized descriptor; finite wait, no signal retry.
        let result = unsafe { libc::poll(&mut descriptor, 1, 3000) };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        if result == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "post-exec readiness missing",
            ));
        }
        let (mut stream, _) = listener.accept()?;
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        let mut bytes = [0; 4];
        stream.read_exact(&mut bytes).map_err(|error| {
            io::Error::new(error.kind(), format!("post-exec readiness read: {error}"))
        })?;
        if u32::from_be_bytes(bytes) != pid as u32 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "readiness PID mismatch",
            ));
        }
        self.connection = Some(stream);
        // No PID or message becomes authority: the caller still uses its
        // independently captured exact member, atomic signal, and death proof.
        Ok(())
    }
}
#[cfg(target_os = "macos")]
impl Drop for Readiness {
    fn drop(&mut self) {
        drop(self.listener.take());
        let _ = std::fs::remove_file(self.endpoint());
        let _ = std::fs::remove_dir(&self.directory);
    }
}
#[cfg(target_os = "macos")]
impl Root {
    fn diagnostic(wait: bool) -> io::Result<Self> {
        let readiness = Readiness::new(wait)?;
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "while read token; do \"$1\" --exact \"$2\" --test-threads=1 --nocapture >/dev/null & job=$!; echo $job; wait $job; done",
            "fixture",
        ]).arg(std::env::current_exe()?).arg(READY_HELPER)
          .env("NAC_PROCESS_READY_HELPER", "1")
          .env("NAC_PROCESS_READY_SOCKET", readiness.endpoint());
        let mut root = Self::from_command(command)?;
        root.readiness = Some(readiness);
        Ok(root)
    }
}

#[cfg(target_os = "macos")]
#[test]
fn readiness_diagnostic_child() {
    if std::env::var("NAC_PROCESS_READY_HELPER").as_deref() != Ok("1") {
        return;
    }
    let mut stream = std::os::unix::net::UnixStream::connect(
        std::env::var_os("NAC_PROCESS_READY_SOCKET").expect("helper socket missing"),
    )
    .unwrap();
    // This body runs in the final test executable after exec; it performs no
    // subsequent spawn/exec. No record from the parent shell satisfies this gate.
    if std::env::var("NAC_PROCESS_READY_SUPPRESS").as_deref() != Ok("1") {
        let mut pid = std::process::id();
        if std::env::var("NAC_PROCESS_READY_WRONG_PID").as_deref() == Ok("1") {
            pid = pid.wrapping_add(1);
        }
        stream.write_all(&pid.to_be_bytes()).unwrap();
    }
    // Parent retains its accepted connection until exact teardown. The PID-only
    // arm leaves the same connection queued. No stabilization delay or exec.
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .unwrap();
    let mut end = [0];
    let outcome = stream.read(&mut end);
    panic!("diagnostic helper ended before atomic teardown: {outcome:?}");
}
