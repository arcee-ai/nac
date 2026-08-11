#[cfg(all(unix, not(target_os = "macos")))]
use std::collections::HashMap;
#[cfg(unix)]
use std::collections::VecDeque;
use std::time::Duration;

use tokio::process::{Child, Command};
use tokio::time::sleep;

const TERMINATE_GRACE: Duration = Duration::from_millis(500);
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

pub struct ProcessTreeGuard {
    #[cfg(unix)]
    root_pid: Option<libc::pid_t>,
    #[cfg(unix)]
    pgid: Option<libc::pid_t>,
    #[cfg(unix)]
    group_leader: Option<Child>,
}

impl ProcessTreeGuard {
    pub fn for_child(child: &Child) -> Self {
        Self {
            #[cfg(unix)]
            root_pid: child.id().map(|pid| pid as libc::pid_t),
            #[cfg(unix)]
            pgid: child.id().map(|pid| pid as libc::pid_t),
            #[cfg(unix)]
            group_leader: None,
        }
    }

    pub fn spawn_supervised(command: &mut Command) -> std::io::Result<(Child, Self)> {
        #[cfg(unix)]
        {
            let mut leader_command = Command::new("/bin/sleep");
            leader_command
                .arg("2147483647")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            isolate_process_group(&mut leader_command);
            let mut group_leader = leader_command.spawn()?;
            let pgid = group_leader
                .id()
                .expect("newly spawned process group leader has no pid")
                as libc::pid_t;
            command.process_group(pgid);
            let child = match command.spawn() {
                Ok(child) => child,
                Err(error) => {
                    let _ = group_leader.start_kill();
                    return Err(error);
                }
            };
            let root_pid = child.id().map(|pid| pid as libc::pid_t);
            Ok((
                child,
                Self {
                    root_pid,
                    pgid: Some(pgid),
                    group_leader: Some(group_leader),
                },
            ))
        }

        #[cfg(not(unix))]
        {
            let child = command.spawn()?;
            let guard = Self::for_child(&child);
            Ok((child, guard))
        }
    }

    pub fn disarm(&mut self) {
        #[cfg(unix)]
        {
            self.root_pid = None;
            self.pgid = None;
            self.group_leader = None;
        }
    }

    pub fn mark_leader_reaped(&mut self) {
        #[cfg(unix)]
        {
            self.root_pid = None;
        }
    }

    pub async fn finish(&mut self) {
        #[cfg(unix)]
        {
            if let Some(pgid) = self.pgid {
                unsafe {
                    libc::killpg(pgid, libc::SIGKILL);
                }
            }
            if let Some(mut group_leader) = self.group_leader.take() {
                let _ = group_leader.wait().await;
            }
        }
        self.disarm();
    }

    pub async fn terminate(&mut self, child: &mut Child) {
        #[cfg(unix)]
        if let Some(pgid) = self.pgid {
            let leader_pid = self
                .root_pid
                .filter(|root_pid| child.id() == Some(*root_pid as u32));
            if let Some(root_pid) = leader_pid {
                signal_pids(&descendants_outside_group(root_pid, pgid), libc::SIGTERM);

                let deadline = sleep(TERMINATE_GRACE);
                tokio::pin!(deadline);
                loop {
                    if child.id() != Some(root_pid as u32)
                        || descendants_outside_group(root_pid, pgid).is_empty()
                    {
                        break;
                    }
                    tokio::select! {
                        _ = &mut deadline => break,
                        _ = sleep(EXIT_POLL_INTERVAL) => {}
                    }
                }
                if child.id() == Some(root_pid as u32) {
                    signal_pids(&descendants_outside_group(root_pid, pgid), libc::SIGKILL);
                }
            }

            self.terminate_owned_group().await;
            if child.id().is_some() {
                let _ = child.wait().await;
            }
            self.disarm();
            return;
        }

        let _ = child.kill().await;
        let _ = child.wait().await;
        self.disarm();
    }

    #[cfg(unix)]
    async fn terminate_owned_group(&mut self) {
        let Some(pgid) = self.pgid else {
            return;
        };
        unsafe {
            libc::killpg(pgid, libc::SIGTERM);
        }
        let deadline = sleep(TERMINATE_GRACE);
        tokio::pin!(deadline);
        loop {
            if unsafe { libc::killpg(pgid, 0) != 0 } {
                break;
            }
            tokio::select! {
                _ = &mut deadline => break,
                _ = sleep(EXIT_POLL_INTERVAL) => {}
            }
        }
        unsafe {
            libc::killpg(pgid, libc::SIGKILL);
        }
        if let Some(mut group_leader) = self.group_leader.take() {
            let _ = group_leader.wait().await;
        }
    }
}

impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            let owns_group = self.root_pid.is_some() || self.group_leader.is_some();
            if owns_group {
                if let Some(pgid) = self.pgid.take() {
                    unsafe {
                        libc::killpg(pgid, libc::SIGKILL);
                    }
                }
            }
        }
    }
}
#[cfg(unix)]
fn descendants_outside_group(root: libc::pid_t, pgid: libc::pid_t) -> Vec<libc::pid_t> {
    descendant_pids(root)
        .into_iter()
        .filter(|pid| {
            let child_pgid = unsafe { libc::getpgid(*pid) };
            child_pgid > 0 && child_pgid != pgid
        })
        .collect()
}

pub fn isolate_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }
}

pub async fn terminate_child_tree(child: &mut Child) {
    let mut guard = ProcessTreeGuard::for_child(child);
    guard.terminate(child).await;
}

#[cfg(unix)]
pub(crate) fn descendant_pids(root: libc::pid_t) -> Vec<libc::pid_t> {
    #[cfg(target_os = "macos")]
    {
        descendant_pids_macos(root)
    }

    #[cfg(not(target_os = "macos"))]
    {
        descendant_pids_from_pairs(root, process_parent_pairs())
    }
}

#[cfg(unix)]
pub(crate) fn signal_pids(pids: &[libc::pid_t], signal: libc::c_int) {
    for &pid in pids {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn descendant_pids_from_pairs(
    root: libc::pid_t,
    pairs: Vec<(libc::pid_t, libc::pid_t)>,
) -> Vec<libc::pid_t> {
    let mut children: HashMap<libc::pid_t, Vec<libc::pid_t>> = HashMap::new();
    for (pid, ppid) in pairs {
        children.entry(ppid).or_default().push(pid);
    }

    let mut found = Vec::new();
    let mut queue = VecDeque::from([root]);
    while let Some(parent) = queue.pop_front() {
        let Some(direct_children) = children.get(&parent) else {
            continue;
        };
        for &child in direct_children {
            if child <= 1 || found.contains(&child) {
                continue;
            }
            found.push(child);
            queue.push_back(child);
        }
    }
    found
}

#[cfg(target_os = "macos")]
fn descendant_pids_macos(root: libc::pid_t) -> Vec<libc::pid_t> {
    let mut found = Vec::new();
    let mut queue = VecDeque::from([root]);
    while let Some(parent) = queue.pop_front() {
        for child in direct_child_pids_macos(parent) {
            if child <= 1 || found.contains(&child) {
                continue;
            }
            found.push(child);
            queue.push_back(child);
        }
    }
    found
}

#[cfg(target_os = "macos")]
fn direct_child_pids_macos(parent: libc::pid_t) -> Vec<libc::pid_t> {
    let mut capacity = 32usize;
    loop {
        let mut pids = vec![0 as libc::pid_t; capacity];
        let returned = unsafe {
            libc::proc_listchildpids(
                parent,
                pids.as_mut_ptr().cast(),
                (capacity * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
            )
        };
        if returned <= 0 {
            return Vec::new();
        }

        let count = (returned as usize).min(capacity);
        pids.truncate(count);
        let children = pids.into_iter().filter(|pid| *pid > 1).collect::<Vec<_>>();
        if children.len() < capacity || capacity >= 4096 {
            return children;
        }
        capacity *= 2;
    }
}

#[cfg(target_os = "linux")]
fn process_parent_pairs() -> Vec<(libc::pid_t, libc::pid_t)> {
    let mut pairs = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return pairs;
    };
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<libc::pid_t>().ok())
        else {
            continue;
        };
        let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some((_, rest)) = stat.rsplit_once(") ") else {
            continue;
        };
        let mut fields = rest.split_whitespace();
        let _state = fields.next();
        let Some(ppid) = fields
            .next()
            .and_then(|value| value.parse::<libc::pid_t>().ok())
        else {
            continue;
        };
        pairs.push((pid, ppid));
    }
    pairs
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn process_parent_pairs() -> Vec<(libc::pid_t, libc::pid_t)> {
    Vec::new()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;

    #[test]
    fn isolated_descendant_helper() {
        let Some(root) = std::env::var_os("NAC_PROCESS_TREE_TEST_ROOT") else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let ready = root.join("descendant-ready");
        let sentinel = root.join("late-write");
        let script = format!(
            "printf ready > '{}'; trap '' TERM; sleep 1; printf survived > '{}'",
            ready.display(),
            sentinel.display()
        );
        let mut command = std::process::Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.process_group(0);
        let mut descendant = command.spawn().unwrap();
        let _ = descendant.wait();
    }

    #[tokio::test]
    async fn process_tree_termination_reaches_isolated_descendants() {
        let root =
            std::env::temp_dir().join(format!("nac_process_tree_cancel_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "process::tests::isolated_descendant_helper",
                "--nocapture",
            ])
            .env("NAC_PROCESS_TREE_TEST_ROOT", &root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        isolate_process_group(&mut command);
        let mut child = command.spawn().unwrap();
        let mut guard = ProcessTreeGuard::for_child(&child);

        tokio::time::timeout(Duration::from_secs(2), async {
            while !root.join("descendant-ready").exists() {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("isolated descendant never became ready");

        guard.terminate(&mut child).await;
        sleep(Duration::from_millis(1100)).await;
        assert!(
            !root.join("late-write").exists(),
            "isolated descendant survived process-tree cancellation"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
