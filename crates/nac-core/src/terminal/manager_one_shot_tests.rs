//! One-shot cleanup when the command root leaves its reserved process group.
//!
//! The deadline and cancellation paths both wait in process-tree termination
//! while holding the caller's workspace gate, so they must return even when
//! the root has started a new session and dropped its inherited tree tags.
#![cfg(unix)]

use super::*;
use std::os::unix::process::CommandExt;

const ESCAPE_PID_ENV: &str = "NAC_ONE_SHOT_ESCAPE_PID_FILE";
const CALL_BOUND: Duration = Duration::from_secs(10);

/// Re-executed by `bash -c` as the command root: it starts a new session,
/// then execs a shell with a cleared environment that records its PID and
/// execs a long sleep under that same PID.
#[test]
fn escaping_one_shot_root_helper() {
    let Some(pid_file) = std::env::var_os(ESCAPE_PID_ENV) else {
        return;
    };
    // SAFETY: `setsid` takes no arguments. The command root joined the
    // reserved group without leading it, so this creates a new session.
    assert!(unsafe { libc::setsid() } > 0);
    let error = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"printf '%s' "$$" > "$1"; exec /bin/sleep 600"#)
        .arg("sh")
        .arg(pid_file)
        .env_clear()
        .exec();
    panic!("failed to exec the escaping command root: {error}");
}

struct EscapingRoot {
    pid_file: PathBuf,
}

impl EscapingRoot {
    fn new() -> Self {
        Self {
            pid_file: std::env::temp_dir()
                .join(format!("nac-one-shot-escape-{}.pid", uuid::Uuid::new_v4())),
        }
    }

    fn command(&self) -> String {
        format!(
            "{ESCAPE_PID_ENV}='{}' exec '{}' --exact \
             terminal::manager::one_shot::tests::escaping_one_shot_root_helper --nocapture",
            self.pid_file.display(),
            std::env::current_exe().unwrap().display()
        )
    }

    fn pid(&self) -> Option<libc::pid_t> {
        std::fs::read_to_string(&self.pid_file)
            .ok()?
            .trim()
            .parse()
            .ok()
    }

    async fn escaped(&self) -> Instant {
        loop {
            if self.pid().is_some() {
                return Instant::now();
            }
            sleep(Duration::from_millis(5)).await;
        }
    }

    fn alive(&self) -> bool {
        // SAFETY: signal zero only probes the PID recorded by the root.
        self.pid()
            .is_some_and(|pid| unsafe { libc::kill(pid, 0) } == 0)
    }
}

impl Drop for EscapingRoot {
    fn drop(&mut self) {
        if let Some(pid) = self.pid() {
            // Test cleanup only, so a failing run does not leak the root.
            // SAFETY: kill only the PID the test's own command recorded.
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        let _ = std::fs::remove_file(&self.pid_file);
    }
}

fn local_backend() -> Arc<ExecutionBackend> {
    crate::sandbox::execution_backend_from_sandbox(None, &std::env::current_dir().unwrap())
}

#[tokio::test]
async fn one_shot_deadline_returns_when_the_command_root_leaves_its_group() {
    let manager = TerminalManager::new();
    let root = EscapingRoot::new();
    let (command, backend) = (root.command(), local_backend());
    let yield_ms = 2_000;
    let started = Instant::now();
    let call = manager.exec_one_shot(&command, None, 120, 40, yield_ms, 8_000, &backend, None);
    let (output, escaped) =
        tokio::time::timeout(CALL_BOUND, async { tokio::join!(call, root.escaped()) })
            .await
            .expect("one-shot deadline cleanup did not return for an escaped command root");
    let elapsed = started.elapsed();
    eprintln!("escaped one-shot deadline returned after {elapsed:?}");

    assert!(
        escaped.duration_since(started) < Duration::from_millis(yield_ms),
        "the command root must leave its group before the deadline"
    );
    assert_eq!(output.status, CommandStatus::TimedOut);
    assert!(!root.alive(), "the escaped command root survived cleanup");
    assert!(
        elapsed < Duration::from_millis(yield_ms) + Duration::from_secs(3),
        "deadline cleanup took {elapsed:?}"
    );
}

#[tokio::test]
async fn one_shot_cancellation_returns_when_the_command_root_leaves_its_group() {
    let manager = TerminalManager::new();
    let root = EscapingRoot::new();
    let (command, backend) = (root.command(), local_backend());
    let cancellation = ThreadCancellation::default();
    let call = manager.exec_one_shot(
        &command,
        None,
        120,
        40,
        600_000,
        8_000,
        &backend,
        Some(&cancellation),
    );
    let cancel_after_escape = async {
        let escaped = root.escaped().await;
        cancellation.cancel();
        escaped
    };
    let (output, cancelled_at) = tokio::time::timeout(CALL_BOUND, async {
        tokio::join!(call, cancel_after_escape)
    })
    .await
    .expect("one-shot cancellation cleanup did not return for an escaped command root");
    eprintln!(
        "escaped one-shot cancellation returned {:?} after cancel",
        cancelled_at.elapsed()
    );

    assert_eq!(output.status, CommandStatus::Cancelled);
    assert!(!root.alive(), "the escaped command root survived cleanup");
    assert!(
        cancelled_at.elapsed() < Duration::from_secs(3),
        "cancellation cleanup took {:?}",
        cancelled_at.elapsed()
    );
}
