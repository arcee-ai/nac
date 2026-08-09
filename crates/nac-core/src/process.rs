use std::time::Duration;

use tokio::process::{Child, Command};
use tokio::time::sleep;

const TERMINATE_GRACE: Duration = Duration::from_millis(500);
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

pub struct ProcessGroupGuard {
    #[cfg(unix)]
    pgid: Option<libc::pid_t>,
}

impl ProcessGroupGuard {
    pub fn for_child(child: &Child) -> Self {
        Self {
            #[cfg(unix)]
            pgid: child.id().map(|pid| pid as libc::pid_t),
        }
    }

    pub fn disarm(&mut self) {
        #[cfg(unix)]
        {
            self.pgid = None;
        }
    }

    /// Terminate descendants using the process group captured at spawn time.
    /// This remains valid after Tokio has consumed the leader's child id.
    pub async fn terminate(&self, child: &mut Child) {
        #[cfg(unix)]
        if let Some(pgid) = self.pgid {
            let term_sent = unsafe { libc::killpg(pgid, libc::SIGTERM) == 0 };
            if term_sent {
                let deadline = sleep(TERMINATE_GRACE);
                tokio::pin!(deadline);
                loop {
                    let group_exists = unsafe { libc::killpg(pgid, 0) == 0 };
                    if !group_exists {
                        break;
                    }
                    tokio::select! {
                        _ = &mut deadline => break,
                        _ = sleep(EXIT_POLL_INTERVAL) => {}
                    }
                }
            }
            // Always sweep: the leader may have exited while a descendant
            // ignored TERM or retained one of the inherited pipes.
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
            let _ = child.wait().await;
            return;
        }

        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pgid) = self.pgid.take() {
            // Emergency fallback for an aborted Rust future. The managed child
            // owns an isolated process group, so grandchildren cannot escape.
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
    }
}

pub fn isolate_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }
}

pub async fn terminate_child_tree(child: &mut Child) {
    let guard = ProcessGroupGuard::for_child(child);
    guard.terminate(child).await;
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;

    fn alive(pid: u32) -> bool {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        stat.split_whitespace().nth(2) != Some("Z")
    }

    async fn wait_dead(pid: u32) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while alive(pid) {
                sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("process {pid} survived cancellation"));
    }

    async fn wait_reaped(pid: u32) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while std::path::Path::new(&format!("/proc/{pid}")).exists() {
                sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("process {pid} was killed but remained a zombie"));
    }

    fn shell(script: &str) -> Child {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        isolate_process_group(&mut command);
        command.spawn().unwrap()
    }

    #[tokio::test]
    async fn termination_reaps_term_compliant_child() {
        let root = std::env::temp_dir().join(format!("nac_term_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let marker = root.join("term");
        let mut child = shell(&format!(
            "trap 'echo term > {}; exit 0' TERM; while :; do sleep 1; done",
            marker.display()
        ));
        let pid = child.id().unwrap();
        sleep(Duration::from_millis(50)).await;
        terminate_child_tree(&mut child).await;
        wait_reaped(pid).await;
        assert_eq!(std::fs::read_to_string(marker).unwrap().trim(), "term");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn termination_escalates_and_kills_grandchild_tree() {
        let root = std::env::temp_dir().join(format!("nac_kill_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pid_file = root.join("grandchild.pid");
        let mut child = shell(&format!(
            "trap '' TERM; (trap '' TERM; while :; do sleep 1; done) & echo $! > {}; while :; do sleep 1; done",
            pid_file.display()
        ));
        let leader = child.id().unwrap();
        let grandchild = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if let Ok(pid) = std::fs::read_to_string(&pid_file) {
                    break pid.trim().parse::<u32>().unwrap();
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        terminate_child_tree(&mut child).await;
        wait_reaped(leader).await;
        wait_dead(grandchild).await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn process_group_guard_drop_kills_future_owned_tree() {
        let root = std::env::temp_dir().join(format!("nac_drop_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pid_file = root.join("grandchild.pid");
        let child = shell(&format!(
            "trap '' TERM; (trap '' TERM; while :; do sleep 1; done) & echo $! > {}; while :; do sleep 1; done",
            pid_file.display()
        ));
        let leader = child.id().unwrap();
        let guard = ProcessGroupGuard::for_child(&child);
        let grandchild = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if let Ok(pid) = std::fs::read_to_string(&pid_file) {
                    break pid.trim().parse::<u32>().unwrap();
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        drop(guard);
        drop(child);
        wait_reaped(leader).await;
        wait_dead(grandchild).await;
        let _ = std::fs::remove_dir_all(root);
    }
}
