#[cfg(target_os = "linux")]
use std::collections::HashMap;
#[cfg(unix)]
use std::collections::VecDeque;
#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
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
        #[cfg(unix)]
        let root_pid = child.id().map(|pid| pid as libc::pid_t);
        Self {
            #[cfg(unix)]
            root_pid,
            // Worker pipe commands skip process-group isolation, so the
            // child is not necessarily a group leader; only allow killpg
            // when it actually is one, otherwise fall back to killing the
            // child pid directly.
            #[cfg(unix)]
            pgid: root_pid.filter(|pid| unsafe { libc::getpgid(*pid) } == *pid),
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
                signal_discovered(descendants_outside_group(root_pid, pgid), libc::SIGTERM);

                let deadline = sleep(TERMINATE_GRACE);
                tokio::pin!(deadline);
                loop {
                    if child.id() != Some(root_pid as u32) {
                        break;
                    }
                    let descendants = descendants_outside_group(root_pid, pgid);
                    report_capture_failures(&descendants.failures);
                    if descendants.processes.is_empty() {
                        break;
                    }
                    tokio::select! {
                        _ = &mut deadline => break,
                        _ = sleep(EXIT_POLL_INTERVAL) => {}
                    }
                }
                if child.id() == Some(root_pid as u32) {
                    signal_discovered(descendants_outside_group(root_pid, pgid), libc::SIGKILL);
                }
            }

            self.terminate_owned_group().await;
            if child.id().is_some() {
                let _ = child.wait().await;
            }
            self.disarm();
            return;
        }

        // The child is not a process-group leader, so killpg cannot reach
        // it; kill any known descendants directly so pipe readers can
        // finish, then kill the child itself.
        #[cfg(unix)]
        if let Some(root_pid) = self.root_pid {
            signal_descendants(root_pid, libc::SIGKILL);
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
fn descendants_outside_group(root: libc::pid_t, pgid: libc::pid_t) -> DescendantProcesses {
    let mut descendants = descendant_processes(root);
    descendants.processes.retain(|process| {
        let child_pgid = unsafe { libc::getpgid(process.pid) };
        child_pgid > 0 && child_pgid != pgid
    });
    descendants
}

#[cfg(unix)]
pub(crate) fn signal_descendants(root: libc::pid_t, signal: libc::c_int) {
    signal_discovered(descendant_processes(root), signal);
}

#[cfg(unix)]
fn signal_discovered(descendants: DescendantProcesses, signal: libc::c_int) {
    signal_processes(&descendants.processes, signal);
    report_capture_failures(&descendants.failures);
}

#[cfg(target_os = "linux")]
fn report_capture_failures(failures: &[ProcessCaptureFailure]) {
    for failure in failures {
        eprintln!(
            "nac: cannot safely signal descendant pid {}: pidfd_open failed: {}",
            failure.pid, failure.error
        );
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
fn report_capture_failures(_failures: &[ProcessCaptureFailure]) {}

#[cfg(unix)]
struct DescendantProcesses {
    processes: Vec<ProcessIdentity>,
    failures: Vec<ProcessCaptureFailure>,
}

#[cfg(target_os = "linux")]
struct ProcessCaptureFailure {
    pid: libc::pid_t,
    error: std::io::Error,
}

#[cfg(all(unix, not(target_os = "linux")))]
struct ProcessCaptureFailure;

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
fn descendant_processes(root: libc::pid_t) -> DescendantProcesses {
    #[cfg(target_os = "macos")]
    {
        DescendantProcesses {
            processes: descendant_pids_macos(root)
                .into_iter()
                .map(|pid| ProcessIdentity { pid })
                .collect(),
            failures: Vec::new(),
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut descendants = Vec::new();
        let mut failures = Vec::new();
        for snapshot in descendant_snapshots(root, process_snapshots()) {
            match ProcessIdentity::capture(snapshot) {
                Ok(Some(process)) => descendants.push(process),
                Ok(None) => {}
                Err(error) => failures.push(ProcessCaptureFailure {
                    pid: snapshot.pid,
                    error,
                }),
            }
        }
        DescendantProcesses {
            processes: descendants,
            failures,
        }
    }

    #[cfg(all(not(target_os = "linux"), not(target_os = "macos")))]
    {
        DescendantProcesses {
            processes: Vec::new(),
            failures: Vec::new(),
        }
    }
}

#[cfg(unix)]
pub(crate) fn signal_processes(processes: &[ProcessIdentity], signal: libc::c_int) {
    for process in processes {
        #[cfg(target_os = "linux")]
        unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                process.pidfd.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            );
        }
        #[cfg(not(target_os = "linux"))]
        unsafe {
            libc::kill(process.pid, signal);
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) struct ProcessIdentity {
    pid: libc::pid_t,
    pidfd: OwnedFd,
}

#[cfg(target_os = "linux")]
impl ProcessIdentity {
    fn capture(snapshot: ProcessSnapshot) -> std::io::Result<Option<Self>> {
        // A numeric-PID fallback would recreate the reuse race this type is
        // meant to close. If the kernel cannot provide a stable handle, leave
        // this descendant unsignaled and report the failure after signaling
        // every sibling whose identity was captured successfully.
        let pidfd = open_pidfd(snapshot.pid)?;
        let stat = match std::fs::read_to_string(format!("/proc/{}/stat", snapshot.pid)) {
            Ok(stat) => stat,
            Err(_) => return Ok(None),
        };
        let Some((_, start_time)) = parse_process_stat(&stat) else {
            return Ok(None);
        };
        Ok((start_time == snapshot.start_time).then_some(Self {
            pid: snapshot.pid,
            pidfd,
        }))
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
pub(crate) struct ProcessIdentity {
    pid: libc::pid_t,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
struct ProcessSnapshot {
    pid: libc::pid_t,
    ppid: libc::pid_t,
    start_time: u64,
}

#[cfg(target_os = "linux")]
fn descendant_snapshots(
    root: libc::pid_t,
    snapshots: Vec<ProcessSnapshot>,
) -> Vec<ProcessSnapshot> {
    let mut children: HashMap<libc::pid_t, Vec<ProcessSnapshot>> = HashMap::new();
    for snapshot in snapshots {
        children.entry(snapshot.ppid).or_default().push(snapshot);
    }

    let mut found = Vec::new();
    let mut queue = VecDeque::from([root]);
    while let Some(parent) = queue.pop_front() {
        let Some(direct_children) = children.remove(&parent) else {
            continue;
        };
        for snapshot in direct_children {
            if snapshot.pid <= 1 {
                continue;
            }
            queue.push_back(snapshot.pid);
            found.push(snapshot);
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
fn process_snapshots() -> Vec<ProcessSnapshot> {
    let mut processes = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return processes;
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
        let Some((ppid, start_time)) = parse_process_stat(&stat) else {
            continue;
        };
        processes.push(ProcessSnapshot {
            pid,
            ppid,
            start_time,
        });
    }
    processes
}

#[cfg(target_os = "linux")]
fn parse_process_stat(stat: &str) -> Option<(libc::pid_t, u64)> {
    let (_, rest) = stat.rsplit_once(") ")?;
    let mut fields = rest.split_whitespace();
    let _state = fields.next()?;
    let ppid = fields.next()?.parse().ok()?;
    let start_time = fields.nth(17)?.parse().ok()?;
    Some((ppid, start_time))
}

#[cfg(target_os = "linux")]
fn open_pidfd(pid: libc::pid_t) -> std::io::Result<OwnedFd> {
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) as libc::c_int };
    if fd < 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;

    #[cfg(target_os = "linux")]
    #[test]
    fn signaling_uses_captured_process_identity_instead_of_numeric_pid() {
        let mut exited = std::process::Command::new("/bin/true").spawn().unwrap();
        let exited_pid = exited.id() as libc::pid_t;
        let Ok(pidfd) = open_pidfd(exited_pid) else {
            exited.wait().unwrap();
            return;
        };
        exited.wait().unwrap();

        let mut sentinel = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let identity = ProcessIdentity {
            pid: sentinel.id() as libc::pid_t,
            pidfd,
        };

        signal_processes(&[identity], libc::SIGKILL);

        assert!(
            sentinel.try_wait().unwrap().is_none(),
            "signaling followed the numeric PID instead of the captured process identity"
        );
        sentinel.kill().unwrap();
        sentinel.wait().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_parent_and_start_time_from_proc_stat() {
        let stat =
            "123 (command with ) parens) S 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23";

        assert_eq!(parse_process_stat(stat), Some((4, 22)));
    }

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
