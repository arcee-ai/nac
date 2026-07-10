#[cfg(unix)]
use std::time::Duration;

use tokio::process::{Child, Command};
#[cfg(unix)]
use tokio::time::sleep;

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
    {
        let process_group = child.id().map(|pid| pid as libc::pid_t);
        if let Some(process_group) = process_group {
            let term_sent = unsafe { libc::killpg(process_group, libc::SIGTERM) == 0 };
            if term_sent {
                if !wait_for_group_exit(child, process_group, TERMINATE_GRACE).await {
                    let kill_sent = unsafe {
                        libc::killpg(process_group, libc::SIGKILL) == 0
                            || std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
                    };
                    if !kill_sent {
                        let _ = child.kill().await;
                    }
                }

                let _ = child.wait().await;
                return;
            }
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(unix)]
async fn wait_for_group_exit(
    child: &mut Child,
    process_group: libc::pid_t,
    grace: Duration,
) -> bool {
    let deadline = sleep(grace);
    tokio::pin!(deadline);

    loop {
        // Reap the leader as soon as it exits so its zombie does not make the
        // process group appear to be alive for the entire grace period.
        let _ = child.try_wait();
        if !process_group_exists(process_group) {
            return true;
        }

        tokio::select! {
            _ = &mut deadline => return false,
            _ = sleep(EXIT_POLL_INTERVAL) => {}
        }
    }
}

#[cfg(unix)]
fn process_group_exists(process_group: libc::pid_t) -> bool {
    if unsafe { libc::killpg(process_group, 0) == 0 } {
        return true;
    }

    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::process::ExitStatusExt;
    use std::process::Stdio;

    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::time::timeout;

    use super::*;

    async fn spawn_process_group(script: &str) -> (Child, libc::pid_t) {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(script)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        isolate_process_group(&mut command);

        let mut child = command.spawn().expect("spawn process group");
        let mut stdout = BufReader::new(child.stdout.take().expect("capture child stdout"));
        let mut line = String::new();
        timeout(Duration::from_secs(2), stdout.read_line(&mut line))
            .await
            .expect("descendant did not become ready")
            .expect("read descendant pid");
        let descendant = line.trim().parse().expect("parse descendant pid");
        (child, descendant)
    }

    async fn assert_process_exits(pid: libc::pid_t) {
        let exited = timeout(Duration::from_secs(2), async {
            while unsafe { libc::kill(pid, 0) == 0 } {
                sleep(EXIT_POLL_INTERVAL).await;
            }
        })
        .await;
        if exited.is_err() {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
            panic!("descendant survived process-group cleanup");
        }
    }

    #[tokio::test]
    async fn waits_for_descendant_after_leader_exits() {
        let (mut child, descendant) = spawn_process_group(
            "trap '' TERM; sleep 30 & descendant=$!; \
             trap 'exit 0' TERM; echo \"$descendant\"; wait",
        )
        .await;

        terminate_child_tree(&mut child).await;

        let status = child
            .try_wait()
            .expect("read leader status")
            .expect("leader was not reaped");
        assert!(status.success(), "leader did not handle SIGTERM: {status}");
        assert_process_exits(descendant).await;
    }

    #[tokio::test]
    async fn kills_term_ignoring_process_group() {
        let (mut child, descendant) = spawn_process_group(
            "trap '' TERM; sleep 30 & descendant=$!; echo \"$descendant\"; wait",
        )
        .await;

        terminate_child_tree(&mut child).await;

        let status = child
            .try_wait()
            .expect("read leader status")
            .expect("leader was not reaped");
        assert_eq!(status.signal(), Some(libc::SIGKILL));
        assert_process_exits(descendant).await;
    }
}
