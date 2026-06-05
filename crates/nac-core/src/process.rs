use std::time::Duration;

use tokio::process::{Child, Command};
use tokio::time::sleep;

const TERMINATE_GRACE: Duration = Duration::from_millis(500);
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
        if let Some(pid) = child.id() {
            let pgid = pid as libc::pid_t;
            let term_sent = unsafe { libc::killpg(pgid, libc::SIGTERM) == 0 };
            if term_sent && wait_for_exit(child, TERMINATE_GRACE).await {
                return;
            }

            let kill_sent = unsafe { libc::killpg(pgid, libc::SIGKILL) == 0 };
            if kill_sent {
                let _ = child.wait().await;
                return;
            }
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn wait_for_exit(child: &mut Child, grace: Duration) -> bool {
    let deadline = sleep(grace);
    tokio::pin!(deadline);

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            Err(_) => return true,
        }

        tokio::select! {
            _ = &mut deadline => return false,
            _ = sleep(EXIT_POLL_INTERVAL) => {}
        }
    }
}
