//! Manual real-worker admission latency plus cross-root cleanup qualification.
#![allow(
    clippy::unwrap_used,
    reason = "bounded disposable fixture errors deliberately fail manual qualification"
)]
use super::*;
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Instant;

struct Adapter(Child);
impl NativePtyChild for Adapter {
    fn process_id(&self) -> Option<u32> {
        Some(self.0.id())
    }
    fn try_wait(&mut self) -> io::Result<Option<i32>> {
        self.0
            .try_wait()
            .map(|status| status.map(|status| status.code().unwrap_or(1)))
    }
}
struct Shell {
    owner: NativePtyOwner,
    input: ChildStdin,
    output: ChildStdout,
    jobs: Vec<NativePtyTestIdentity>,
}
impl Drop for Shell {
    fn drop(&mut self) {
        self.owner.0 .0.terminate.store(true, Ordering::SeqCst);
        for job in &mut self.jobs {
            let _ = job.kill();
        }
    }
}
impl Shell {
    fn new() -> Self {
        NativePtyOwner::preflight().unwrap();
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "while read token; do /bin/sleep 30 & job=$!; echo $job; wait $job; done",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // SAFETY: async-signal-safe setup in this disposable child before exec.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let owner = NativePtyOwner::from_fresh_session(Box::new(Adapter(child)), Arc::new(|| {}));
        Self {
            owner,
            input,
            output,
            jobs: Vec::new(),
        }
    }

    fn launch(&mut self) -> (u32, Instant) {
        let start = Instant::now();
        self.input.write_all(b"job\n").unwrap();
        let mut line = Vec::new();
        loop {
            assert!(
                start.elapsed() < Duration::from_secs(3),
                "fixture PID output timeout"
            );
            let mut poll = libc::pollfd {
                fd: self.output.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: initialized writable descriptor storage, bounded wait.
            if unsafe { libc::poll(&mut poll, 1, 10) } <= 0 {
                continue;
            }
            let mut byte = [0];
            assert_eq!(
                self.output.read(&mut byte).unwrap(),
                1,
                "fixture stdout ended before its PID"
            );
            if byte[0] == b'\n' {
                break;
            }
            line.push(byte[0]);
            assert!(line.len() < 32, "fixture PID output exceeded bound");
        }
        let pid = String::from_utf8(line).unwrap().parse().unwrap();
        self.jobs
            .push(NativePtyTestIdentity::capture(pid).unwrap().unwrap());
        (pid, start)
    }

    fn admission(&self, pid: u32, start: Instant) -> Duration {
        let key = platform::observed_key_for_test(pid).unwrap();
        loop {
            let observed = self.owner.0 .0.observed.lock().unwrap().get(&key).copied();
            if let Some(observed) = observed {
                return observed.duration_since(start);
            }
            assert!(
                start.elapsed() < Duration::from_secs(3),
                "admission timeout: {:?}",
                self.owner.snapshot()
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

#[tokio::test]
#[ignore = "manual before/after admission latency qualification on a quiet host"]
async fn native_admission_latency_and_independent_root_cleanup() {
    for count in [1, 8] {
        let mut shells = (0..count).map(|_| Shell::new()).collect::<Vec<_>>();
        // Let spawn/exec and the first census settle before measuring new jobs.
        tokio::time::sleep(Duration::from_millis(300)).await;
        for trial in 0..40 {
            let index = trial % count;
            let (pid, start) = shells[index].launch();
            let admission = shells[index].admission(pid, start);
            println!(
                "NAC_ADMISSION slots={count} trial={trial} millis={:.3}",
                admission.as_secs_f64() * 1000.0
            );
            assert!(shells[index].jobs.last().unwrap().is_alive().unwrap());
            shells[index].jobs.last_mut().unwrap().kill().unwrap();
            // Vary launch phase within the existing polling interval.
            tokio::time::sleep(Duration::from_millis((trial * 17 % 49) as u64)).await;
        }
        // Keep one captured child per root alive across a peer close. Cleanup
        // must be fresh and must never adopt/signal another root's child.
        for shell in &mut shells {
            let (pid, start) = shell.launch();
            let _ = shell.admission(pid, start);
        }
        for index in 0..count {
            let start = Instant::now();
            shells[index].owner.terminate().await.unwrap();
            println!(
                "NAC_CLOSE slots={count} index={index} millis={:.3}",
                start.elapsed().as_secs_f64() * 1000.0
            );
            assert!(!shells[index].jobs.last().unwrap().is_alive().unwrap());
            for other in &shells[index + 1..] {
                assert!(other.owner.accepts_input());
                assert!(other.jobs.last().unwrap().is_alive().unwrap());
            }
        }
    }
}
