#[cfg(unix)]
use std::time::Duration;

use tokio::process::{Child, Command};
#[cfg(unix)]
use tokio::time::{sleep, timeout};

#[cfg(unix)]
const TERMINATE_GRACE: Duration = Duration::from_millis(500);
#[cfg(unix)]
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

pub fn isolate_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }
}

pub async fn terminate_child_tree(child: &mut Child) {
    #[cfg(unix)]
    if let Some(group) = child.id().map(|pid| pid as libc::pid_t) {
        if unsafe { libc::killpg(group, libc::SIGTERM) == 0 } {
            let group_exited = timeout(TERMINATE_GRACE, async {
                loop {
                    // Reap the leader so its zombie does not keep the group alive.
                    let _ = child.try_wait();
                    if unsafe { libc::killpg(group, 0) != 0 }
                        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
                    {
                        break;
                    }
                    sleep(EXIT_POLL_INTERVAL).await;
                }
            })
            .await
            .is_ok();

            if !group_exited
                && unsafe { libc::killpg(group, libc::SIGKILL) != 0 }
                && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
            {
                let _ = child.kill().await;
            }
            let _ = child.wait().await;
            return;
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(all(test, unix))]
mod tests {
    use std::{os::unix::process::ExitStatusExt, process::Stdio};

    use tokio::io::{AsyncBufReadExt, BufReader};

    use super::*;

    async fn spawn_group(script: &str) -> (Child, libc::pid_t) {
        let mut command = Command::new("sh");
        command
            .args(["-c", script])
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        isolate_process_group(&mut command);

        let mut child = command.spawn().expect("spawn process group");
        let mut output = BufReader::new(child.stdout.take().expect("capture stdout"));
        let mut pid = String::new();
        timeout(Duration::from_secs(2), output.read_line(&mut pid))
            .await
            .expect("descendant did not become ready")
            .expect("read descendant pid");
        (child, pid.trim().parse().expect("parse descendant pid"))
    }

    async fn assert_process_exited(pid: libc::pid_t) {
        let result = timeout(Duration::from_secs(2), async {
            while unsafe { libc::kill(pid, 0) == 0 } {
                sleep(EXIT_POLL_INTERVAL).await;
            }
        })
        .await;
        if result.is_err() {
            unsafe { libc::kill(pid, libc::SIGKILL) };
            panic!("descendant {pid} survived process-group cleanup");
        }
    }

    #[tokio::test]
    async fn terminates_entire_process_group_and_reaps_leader() {
        let leader_exits = "trap '' TERM; sleep 30 & pid=$!; trap 'exit 0' TERM; echo $pid; wait";
        let ignores_term = "trap '' TERM; sleep 30 & pid=$!; echo $pid; wait";
        let cases = [
            ("leader exits before descendant", leader_exits, 0),
            ("group ignores TERM", ignores_term, -libc::SIGKILL),
        ];

        for (name, script, expected_exit) in cases {
            let (mut child, descendant) = spawn_group(script).await;
            terminate_child_tree(&mut child).await;

            let status = child.try_wait().expect(name);
            let status = status.expect("leader was not reaped");
            let exit = status.code().unwrap_or_else(|| -status.signal().unwrap());
            assert_eq!(exit, expected_exit, "{name}: {status}");
            assert_process_exited(descendant).await;
        }
    }
}
