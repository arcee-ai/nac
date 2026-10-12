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
}
impl Root {
    fn new() -> io::Result<Self> {
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "while read token; do sleep 30 & job=$!; echo $job; wait $job; done",
            ])
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
        })
    }
    fn job(&mut self) -> io::Result<libc::pid_t> {
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
    let mut root = Root::new().unwrap();
    #[cfg(target_os = "linux")]
    let fd_baseline = std::fs::read_dir("/proc/self/fd").unwrap().count();
    for _ in 0..48 {
        let pid = root.job().unwrap();
        root.until(|authority| authority.members.keys().any(|key| key.0 == pid));
        assert!(!root.authority.leader_exited().unwrap());
        let identity = Arc::clone(
            root.authority
                .members
                .iter()
                .find(|(key, _)| key.0 == pid)
                .unwrap()
                .1,
        );
        let weak = Arc::downgrade(&identity);
        identity.signal(libc::SIGKILL).unwrap();
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
