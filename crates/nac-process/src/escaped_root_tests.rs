//! Termination of a supervised root that left the reserved process group.
//!
//! `spawn_supervised` places the root in a group led by a reserved leader, so
//! the root itself can `setsid`/`setpgid` away. A group signal no longer
//! reaches it, and an exec with a cleared environment also drops the inherited
//! tree tags. Termination must still reach and reap that root within its
//! bounded grace periods.
#![cfg(unix)]

use super::*;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::Stdio;

const ESCAPE_DIR_ENV: &str = "NAC_PROCESS_ESCAPE_TEST_DIR";
const ESCAPE_SETSID_ENV: &str = "NAC_PROCESS_ESCAPE_SETSID";
const ESCAPE_IGNORE_TERM_ENV: &str = "NAC_PROCESS_ESCAPE_IGNORE_TERM";
const TERMINATE_BOUND: Duration = Duration::from_secs(5);

/// Re-executed as the supervised root. It optionally starts a new session,
/// then execs a shell with a cleared environment (no tree tags) that may
/// ignore SIGTERM, records its PID and execs a long sleep under that PID.
#[test]
fn escaping_root_helper() {
    let Some(dir) = std::env::var_os(ESCAPE_DIR_ENV) else {
        return;
    };
    if std::env::var_os(ESCAPE_SETSID_ENV).is_some() {
        // SAFETY: `setsid` takes no arguments. The root joined the reserved
        // group without leading it, so this always creates a new session.
        assert!(unsafe { libc::setsid() } > 0);
    }
    let ignore_term = std::env::var_os(ESCAPE_IGNORE_TERM_ENV).is_some();
    let error = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"if [ -n "$2" ]; then trap '' TERM; fi; printf '%s' "$$" > "$1"; exec /bin/sleep 600"#)
        .arg("sh")
        .arg(PathBuf::from(dir).join("root.pid"))
        .arg(if ignore_term { "ignore" } else { "" })
        .env_clear()
        .exec();
    panic!("failed to exec the escaping root: {error}");
}

struct RootTermination {
    returned: bool,
    elapsed: Duration,
    result: Option<std::io::Result<()>>,
    reaped: bool,
}

async fn terminate_supervised_root(escape: bool, ignore_term: bool) -> RootTermination {
    let dir = std::env::temp_dir().join(format!("nac_process_escape_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "escaped_root_tests::escaping_root_helper",
            "--nocapture",
        ])
        .env(ESCAPE_DIR_ENV, &dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if escape {
        command.env(ESCAPE_SETSID_ENV, "1");
    }
    if ignore_term {
        command.env(ESCAPE_IGNORE_TERM_ENV, "1");
    }
    let (mut child, mut guard) = ProcessTreeGuard::spawn_supervised(&mut command).unwrap();
    let root = child.id().unwrap() as libc::pid_t;
    let reserved_group = guard.pgid.unwrap();
    tokio::time::timeout(TERMINATE_BOUND, async {
        loop {
            let recorded = std::fs::read_to_string(dir.join("root.pid"))
                .ok()
                .and_then(|pid| pid.parse::<libc::pid_t>().ok());
            // SAFETY: `getpgid` only inspects this test's unreaped child.
            let group = unsafe { libc::getpgid(root) };
            let expected = if escape { root } else { reserved_group };
            if recorded == Some(root) && group == expected {
                break;
            }
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("supervised root never reached its untagged sleep");

    let started = Instant::now();
    let outcome = tokio::time::timeout(TERMINATE_BOUND, guard.terminate(&mut child)).await;
    let elapsed = started.elapsed();
    let reaped = child.id().is_none();
    let returned = outcome.is_ok();
    if !reaped {
        // Test cleanup only, so a failing run does not leak the root.
        // SAFETY: the root is this test's own unreaped child.
        unsafe {
            libc::kill(root, libc::SIGKILL);
        }
        let _ = child.wait().await;
    }
    drop(guard);
    let _ = std::fs::remove_dir_all(dir);
    RootTermination {
        returned,
        elapsed,
        result: outcome.ok(),
        reaped,
    }
}

fn assert_terminated(run: RootTermination, scenario: &str) {
    assert!(
        run.returned,
        "{scenario}: terminate did not return within {TERMINATE_BOUND:?}"
    );
    assert!(
        run.reaped,
        "{scenario}: terminate returned without reaping the root"
    );
    if let Some(Err(error)) = run.result {
        panic!("{scenario}: terminate reported incomplete cleanup: {error}");
    }
    eprintln!("{scenario}: terminate returned in {:?}", run.elapsed);
}

#[tokio::test]
async fn terminate_reaches_a_root_that_left_the_reserved_group() {
    let run = terminate_supervised_root(true, false).await;
    assert_terminated(run, "escaped root");
}

#[tokio::test]
async fn terminate_kills_an_escaped_root_that_ignores_sigterm() {
    let run = terminate_supervised_root(true, true).await;
    assert_terminated(run, "escaped root ignoring SIGTERM");
}

#[tokio::test]
async fn control_terminate_kills_an_in_group_root_that_ignores_sigterm() {
    let run = terminate_supervised_root(false, true).await;
    assert_terminated(run, "in-group root ignoring SIGTERM");
}
