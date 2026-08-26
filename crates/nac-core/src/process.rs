#[cfg(unix)]
use std::collections::VecDeque;
#[cfg(target_os = "linux")]
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::time::Duration;

use tokio::process::{Child, Command};
use tokio::time::sleep;

const TERMINATE_GRACE: Duration = Duration::from_millis(500);
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);
#[cfg(all(test, target_os = "linux"))]
pub(crate) static PIDFD_OPEN_FAILURE_LOCK: tokio::sync::Mutex<()> =
    tokio::sync::Mutex::const_new(());

#[cfg(all(test, target_os = "linux"))]
static PIDFD_OPEN_FAILURE_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

#[cfg(all(test, target_os = "linux"))]
pub(crate) fn set_pidfd_open_failure_for_test(pid: libc::pid_t) {
    PIDFD_OPEN_FAILURE_PID.store(pid, std::sync::atomic::Ordering::SeqCst);
}

pub struct ProcessTreeGuard {
    #[cfg(unix)]
    root_pid: Option<libc::pid_t>,
    #[cfg(target_os = "linux")]
    root_start_time: Option<u64>,
    #[cfg(unix)]
    pgid: Option<libc::pid_t>,
    #[cfg(unix)]
    group_leader: Option<Child>,
}

impl ProcessTreeGuard {
    pub fn for_child(child: &Child) -> Self {
        #[cfg(unix)]
        let root_pid = child.id().map(|pid| pid as libc::pid_t);
        #[cfg(target_os = "linux")]
        let root_start_time = root_pid.and_then(process_start_time);
        Self {
            #[cfg(unix)]
            root_pid,
            #[cfg(target_os = "linux")]
            root_start_time,
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
            #[cfg(target_os = "linux")]
            let root_start_time = root_pid.and_then(process_start_time);
            Ok((
                child,
                Self {
                    root_pid,
                    #[cfg(target_os = "linux")]
                    root_start_time,
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
            #[cfg(target_os = "linux")]
            {
                self.root_start_time = None;
            }
            self.pgid = None;
            self.group_leader = None;
        }
    }

    pub fn mark_leader_reaped(&mut self) {
        #[cfg(unix)]
        {
            self.root_pid = None;
            #[cfg(target_os = "linux")]
            {
                self.root_start_time = None;
            }
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

    pub async fn terminate(&mut self, child: &mut Child) -> std::io::Result<()> {
        #[cfg(target_os = "linux")]
        let mut cleanup_result = Ok(());
        #[cfg(not(target_os = "linux"))]
        let cleanup_result = Ok(());
        #[cfg(unix)]
        if let Some(pgid) = self.pgid {
            let leader_pid = self
                .root_pid
                .filter(|root_pid| child.id() == Some(*root_pid as u32));
            if let Some(root_pid) = leader_pid {
                #[cfg(target_os = "linux")]
                {
                    let mut descendants = capture_descendants(
                        root_pid,
                        self.root_start_time,
                        Some(pgid),
                        "initial descendant scan",
                    );
                    descendants.signal_best_effort(libc::SIGTERM);

                    let deadline = sleep(TERMINATE_GRACE);
                    tokio::pin!(deadline);
                    loop {
                        if child.id() != Some(root_pid as u32) || descendants.all_exited() {
                            break;
                        }
                        tokio::select! {
                            _ = &mut deadline => break,
                            _ = sleep(EXIT_POLL_INTERVAL) => {}
                        }
                    }

                    if child.id() == Some(root_pid as u32)
                        && self.root_start_time.is_some_and(|start_time| {
                            process_identity_matches(root_pid, start_time)
                        })
                    {
                        descendants.extend(capture_descendants(
                            root_pid,
                            self.root_start_time,
                            Some(pgid),
                            "final descendant scan",
                        ));
                    }
                    cleanup_result = descendants.signal_all(libc::SIGKILL);
                }

                #[cfg(all(unix, not(target_os = "linux")))]
                {
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
            }

            self.terminate_owned_group().await;
            if child.id().is_some() {
                let _ = child.wait().await;
            }
            self.disarm();
            return cleanup_result;
        }

        // The child is not a process-group leader, so killpg cannot reach
        // it; kill any known descendants directly so pipe readers can
        // finish, then kill the child itself.
        #[cfg(target_os = "linux")]
        if let Some(root_pid) = self.root_pid {
            cleanup_result =
                capture_descendants(root_pid, self.root_start_time, None, "descendant scan")
                    .signal_all(libc::SIGKILL);
        }
        #[cfg(all(unix, not(target_os = "linux")))]
        if let Some(root_pid) = self.root_pid {
            signal_pids(&descendant_pids(root_pid), libc::SIGKILL);
        }

        let _ = child.kill().await;
        let _ = child.wait().await;
        self.disarm();
        cleanup_result
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
#[cfg(all(unix, not(target_os = "linux")))]
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

#[cfg(target_os = "linux")]
pub(crate) fn signal_descendants(
    root: libc::pid_t,
    root_start_time: u64,
    signal: libc::c_int,
) -> std::io::Result<()> {
    capture_descendants(root, Some(root_start_time), None, "descendant scan").signal_all(signal)
}

#[cfg(all(unix, not(target_os = "linux")))]
pub(crate) fn signal_descendants(root: libc::pid_t, signal: libc::c_int) -> std::io::Result<()> {
    signal_pids(&descendant_pids(root), signal);
    Ok(())
}

#[cfg(all(unix, not(target_os = "linux")))]
fn descendant_pids(root: libc::pid_t) -> Vec<libc::pid_t> {
    #[cfg(target_os = "macos")]
    {
        descendant_pids_macos(root)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
fn signal_pids(pids: &[libc::pid_t], signal: libc::c_int) {
    for &pid in pids {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessMetadata {
    pid: libc::pid_t,
    ppid: libc::pid_t,
    pgrp: libc::pid_t,
    start_time: u64,
}

#[cfg(target_os = "linux")]
struct ProcessIdentity {
    metadata: ProcessMetadata,
    pidfd: OwnedFd,
}

#[cfg(target_os = "linux")]
impl ProcessIdentity {
    fn capture(expected: ProcessMetadata) -> std::io::Result<Option<Self>> {
        let pidfd = match open_pidfd(expected.pid) {
            Ok(pidfd) => pidfd,
            Err(error) if error.raw_os_error() == Some(libc::ESRCH) => return Ok(None),
            Err(error) => return Err(error),
        };
        let stat = match std::fs::read_to_string(format!("/proc/{}/stat", expected.pid)) {
            Ok(stat) => stat,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let Some((ppid, pgrp, start_time)) = parse_process_stat(&stat) else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid /proc/{}/stat", expected.pid),
            ));
        };
        if start_time != expected.start_time {
            return Ok(None);
        }
        Ok(Some(Self {
            metadata: ProcessMetadata {
                pid: expected.pid,
                ppid,
                pgrp,
                start_time,
            },
            pidfd,
        }))
    }

    fn send_signal(&self, signal: libc::c_int) -> std::io::Result<()> {
        let result = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.pidfd.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            )
        };
        if result < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct CleanupFailures {
    count: usize,
    first: Option<std::io::Error>,
}

#[cfg(target_os = "linux")]
impl CleanupFailures {
    fn record(&mut self, pid: libc::pid_t, operation: &str, error: std::io::Error) {
        self.count += 1;
        if self.first.is_none() {
            self.first = Some(std::io::Error::new(
                error.kind(),
                format!("{operation} for pid {pid}: {error}"),
            ));
        }
    }

    fn extend(&mut self, mut other: Self) {
        self.count += other.count;
        if self.first.is_none() {
            self.first = other.first.take();
        }
    }

    fn into_result(self) -> std::io::Result<()> {
        let Some(first) = self.first else {
            return Ok(());
        };
        Err(std::io::Error::new(
            first.kind(),
            format!(
                "incomplete descendant cleanup: {} operation(s) failed; first: {}",
                self.count, first
            ),
        ))
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct CapturedDescendants {
    processes: Vec<ProcessIdentity>,
    failures: CleanupFailures,
}
#[cfg(target_os = "linux")]
impl CapturedDescendants {
    fn extend(&mut self, other: Self) {
        for process in other.processes {
            let duplicate = self.processes.iter().any(|existing| {
                existing.metadata.pid == process.metadata.pid
                    && existing.metadata.start_time == process.metadata.start_time
            });
            if !duplicate {
                self.processes.push(process);
            }
        }
        self.failures.extend(other.failures);
    }

    fn signal_best_effort(&mut self, signal: libc::c_int) {
        self.processes
            .retain(|process| match process.send_signal(signal) {
                Ok(()) => true,
                Err(error) if error.raw_os_error() == Some(libc::ESRCH) => false,
                Err(_) => true,
            });
    }

    fn all_exited(&mut self) -> bool {
        self.processes
            .retain(|process| match process.send_signal(0) {
                Ok(()) => true,
                Err(error) if error.raw_os_error() == Some(libc::ESRCH) => false,
                Err(_) => true,
            });
        self.processes.is_empty() && self.failures.count == 0
    }

    fn signal_all(mut self, signal: libc::c_int) -> std::io::Result<()> {
        for process in self.processes {
            if let Err(error) = process.send_signal(signal) {
                if error.raw_os_error() != Some(libc::ESRCH) {
                    self.failures
                        .record(process.metadata.pid, "pidfd_send_signal", error);
                }
            }
        }
        self.failures.into_result()
    }
}

#[cfg(target_os = "linux")]
fn capture_descendants(
    root: libc::pid_t,
    root_start_time: Option<u64>,
    excluded_pgrp: Option<libc::pid_t>,
    operation: &str,
) -> CapturedDescendants {
    let Some(root_start_time) = root_start_time else {
        let mut failures = CleanupFailures::default();
        failures.record(
            root,
            operation,
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "root process identity was unavailable",
            ),
        );
        return CapturedDescendants {
            processes: Vec::new(),
            failures,
        };
    };
    let processes = match process_metadata() {
        Ok(processes) => processes,
        Err(error) => {
            let mut failures = CleanupFailures::default();
            failures.record(root, operation, error);
            return CapturedDescendants {
                processes: Vec::new(),
                failures,
            };
        }
    };
    if !processes
        .iter()
        .any(|process| process.pid == root && process.start_time == root_start_time)
    {
        let mut failures = CleanupFailures::default();
        failures.record(
            root,
            operation,
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "root process identity changed before descendant discovery",
            ),
        );
        return CapturedDescendants {
            processes: Vec::new(),
            failures,
        };
    }
    let candidates = descendant_metadata(root, processes);

    let mut captured = Vec::new();
    let mut failures = CleanupFailures::default();
    for candidate in candidates {
        match ProcessIdentity::capture(candidate) {
            Ok(Some(process)) => captured.push(process),
            Ok(None) => {}
            Err(error) => failures.record(candidate.pid, "pidfd_open/capture", error),
        }
    }
    if !process_identity_matches(root, root_start_time) {
        failures.record(
            root,
            operation,
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "root process identity changed during descendant discovery",
            ),
        );
        captured.clear();
    } else {
        retain_authoritative_descendants(root, excluded_pgrp, &mut captured, &mut failures);
    }

    let processes = captured;
    CapturedDescendants {
        processes,
        failures,
    }
}

#[cfg(target_os = "linux")]
fn retain_authoritative_descendants(
    root: libc::pid_t,
    excluded_pgrp: Option<libc::pid_t>,
    captured: &mut Vec<ProcessIdentity>,
    failures: &mut CleanupFailures,
) {
    let authoritative = descendant_metadata(
        root,
        captured.iter().map(|process| process.metadata).collect(),
    )
    .into_iter()
    .map(|process| (process.pid, process.start_time))
    .collect::<HashSet<_>>();
    captured.retain(|process| {
        if excluded_pgrp == Some(process.metadata.pgrp) {
            return false;
        }
        if authoritative.contains(&(process.metadata.pid, process.metadata.start_time)) {
            return true;
        }
        failures.record(
            process.metadata.pid,
            "pidfd_open/capture",
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "captured process no longer has authoritative descendant ancestry",
            ),
        );
        false
    });
}

#[cfg(target_os = "linux")]
fn descendant_metadata(root: libc::pid_t, processes: Vec<ProcessMetadata>) -> Vec<ProcessMetadata> {
    let mut children: HashMap<libc::pid_t, Vec<ProcessMetadata>> = HashMap::new();
    for process in processes {
        children.entry(process.ppid).or_default().push(process);
    }

    let mut found = Vec::new();
    let mut queue = VecDeque::from([root]);
    while let Some(parent) = queue.pop_front() {
        let Some(direct_children) = children.get(&parent) else {
            continue;
        };
        for &child in direct_children {
            if child.pid <= 1
                || found
                    .iter()
                    .any(|found: &ProcessMetadata| found.pid == child.pid)
            {
                continue;
            }
            found.push(child);
            queue.push_back(child.pid);
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
pub(crate) fn process_start_time(pid: libc::pid_t) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_process_stat(&stat).map(|(_, _, start_time)| start_time)
}

#[cfg(target_os = "linux")]
pub(crate) fn process_identity_matches(pid: libc::pid_t, start_time: u64) -> bool {
    process_start_time(pid) == Some(start_time)
}

#[cfg(target_os = "linux")]
fn process_metadata() -> std::io::Result<Vec<ProcessMetadata>> {
    let mut processes = Vec::new();
    for entry in std::fs::read_dir("/proc")?.flatten() {
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
        let Some((ppid, pgrp, start_time)) = parse_process_stat(&stat) else {
            continue;
        };
        processes.push(ProcessMetadata {
            pid,
            ppid,
            pgrp,
            start_time,
        });
    }
    Ok(processes)
}

#[cfg(target_os = "linux")]
fn parse_process_stat(stat: &str) -> Option<(libc::pid_t, libc::pid_t, u64)> {
    let (_, rest) = stat.rsplit_once(") ")?;
    let mut fields = rest.split_whitespace();
    let _state = fields.next()?;
    let ppid = fields.next()?.parse().ok()?;
    let pgrp = fields.next()?.parse().ok()?;
    let start_time = fields.nth(16)?.parse().ok()?;
    Some((ppid, pgrp, start_time))
}

#[cfg(target_os = "linux")]
fn open_pidfd(pid: libc::pid_t) -> std::io::Result<OwnedFd> {
    #[cfg(test)]
    if PIDFD_OPEN_FAILURE_PID.load(std::sync::atomic::Ordering::SeqCst) == pid {
        return Err(std::io::Error::from_raw_os_error(libc::EPERM));
    }
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
    fn test_identity(pid: libc::pid_t, ppid: libc::pid_t, pidfd: OwnedFd) -> ProcessIdentity {
        ProcessIdentity {
            metadata: ProcessMetadata {
                pid,
                ppid,
                pgrp: pid,
                start_time: 1,
            },
            pidfd,
        }
    }

    #[cfg(target_os = "linux")]
    fn capture_test_identity(pid: libc::pid_t) -> ProcessIdentity {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
        let (ppid, pgrp, start_time) = parse_process_stat(&stat).unwrap();
        ProcessIdentity::capture(ProcessMetadata {
            pid,
            ppid,
            pgrp,
            start_time,
        })
        .unwrap()
        .unwrap()
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_parent_group_and_start_time_from_proc_stat() {
        let stat =
            "123 (command with ) parens) S 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23";

        assert_eq!(parse_process_stat(stat), Some((4, 5, 22)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mismatched_start_time_is_not_captured() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let stat = std::fs::read_to_string(format!("/proc/{}/stat", child.id())).unwrap();
        let (ppid, pgrp, start_time) = parse_process_stat(&stat).unwrap();

        let identity = ProcessIdentity::capture(ProcessMetadata {
            pid: child.id() as libc::pid_t,
            ppid,
            pgrp,
            start_time: start_time.saturating_add(1),
        })
        .unwrap();

        assert!(identity.is_none());
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mismatched_root_identity_rejects_descendant_discovery() {
        let mut root = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid = root.id() as libc::pid_t;
        let wrong_start_time = process_start_time(pid).unwrap().saturating_add(1);

        let result = capture_descendants(pid, Some(wrong_start_time), None, "test descendant scan")
            .signal_all(libc::SIGKILL);

        assert!(result.is_err());
        assert!(root.try_wait().unwrap().is_none());
        root.kill().unwrap();
        root.wait().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn matching_pidfd_is_signaled() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let identity = capture_test_identity(child.id() as libc::pid_t);

        identity.send_signal(libc::SIGKILL).unwrap();

        assert!(!child.wait().unwrap().success());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn captured_pidfd_survives_parent_change_through_later_scan() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let identity = capture_test_identity(child.id() as libc::pid_t);
        let mut descendants = CapturedDescendants {
            processes: vec![identity],
            failures: CleanupFailures::default(),
        };
        descendants.processes[0].metadata.ppid = 1;

        descendants.extend(CapturedDescendants {
            processes: Vec::new(),
            failures: CleanupFailures::default(),
        });
        descendants.signal_all(libc::SIGKILL).unwrap();

        assert!(!child.wait().unwrap().success());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn stale_pidfd_cannot_signal_reused_numeric_pid() {
        let mut exited = std::process::Command::new("/bin/true").spawn().unwrap();
        let mut identity = capture_test_identity(exited.id() as libc::pid_t);
        exited.wait().unwrap();

        let mut sentinel = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        identity.metadata.pid = sentinel.id() as libc::pid_t;

        let error = identity.send_signal(libc::SIGKILL).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(libc::ESRCH));
        assert!(sentinel.try_wait().unwrap().is_none());
        sentinel.kill().unwrap();
        sentinel.wait().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn signal_errors_do_not_stop_later_identities() {
        let invalid_fd: OwnedFd = std::fs::File::open("/dev/null").unwrap().into();
        let invalid = test_identity(101, 1, invalid_fd);

        let mut exited = std::process::Command::new("/bin/true").spawn().unwrap();
        let stale = capture_test_identity(exited.id() as libc::pid_t);
        exited.wait().unwrap();

        let mut live = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let live_identity = capture_test_identity(live.id() as libc::pid_t);
        let descendants = CapturedDescendants {
            processes: vec![invalid, stale, live_identity],
            failures: CleanupFailures::default(),
        };

        let error = descendants.signal_all(libc::SIGKILL).unwrap_err();

        assert!(error.to_string().contains("pidfd_send_signal"));
        assert!(!live.wait().unwrap().success());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn snapshot_ancestry_rejects_unrelated_candidates() {
        let root = 50;
        let child = ProcessMetadata {
            pid: 51,
            ppid: root,
            pgrp: 50,
            start_time: 1,
        };
        let grandchild = ProcessMetadata {
            pid: 52,
            ppid: 51,
            pgrp: 50,
            start_time: 2,
        };
        let unrelated = ProcessMetadata {
            pid: 53,
            ppid: 1,
            pgrp: 53,
            start_time: 3,
        };

        let descendants = descendant_metadata(root, vec![unrelated, grandchild, child]);
        let pids = descendants
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();

        assert_eq!(pids, vec![51, 52]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn post_capture_ancestry_rejects_unrelated_identity() {
        let child_fd: OwnedFd = std::fs::File::open("/dev/null").unwrap().into();
        let unrelated_fd: OwnedFd = std::fs::File::open("/dev/null").unwrap().into();
        let mut captured = vec![
            test_identity(51, 50, child_fd),
            test_identity(52, 1, unrelated_fd),
        ];
        let mut failures = CleanupFailures::default();

        retain_authoritative_descendants(50, None, &mut captured, &mut failures);

        assert_eq!(
            captured
                .iter()
                .map(|process| process.metadata.pid)
                .collect::<Vec<_>>(),
            vec![51]
        );
        assert_eq!(failures.count, 1);
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

        guard.terminate(&mut child).await.unwrap();
        sleep(Duration::from_millis(1100)).await;
        assert!(
            !root.join("late-write").exists(),
            "isolated descendant survived process-tree cancellation"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
