use super::*;
use crate::terminal::OutputStream;
use std::io::Write;

#[cfg(target_os = "linux")]
fn process_running(pid: u32) -> bool {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    stat.rsplit_once(") ")
        .and_then(|(_, fields)| fields.split_whitespace().next())
        != Some("Z")
}

#[cfg(all(unix, not(target_os = "linux")))]
fn process_running(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(unix)]
fn parse_child_pid(output: &str) -> Option<u32> {
    output.lines().find_map(|line| {
        line.split_once("NAC_CHILD:").and_then(|(_, rest)| {
            rest.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse()
                .ok()
        })
    })
}

#[test]
#[cfg(unix)]
fn exited_pty_descendant_helper() {
    if std::env::var_os("NAC_EXITED_PTY_DESCENDANT_HELPER").is_none() {
        return;
    }
    let pid = unsafe { libc::getpid() };
    let parent = unsafe { libc::getppid() };
    let group = unsafe { libc::getpgid(parent) };
    assert!(group > 0);
    assert_eq!(unsafe { libc::setpgid(0, group) }, 0);
    unsafe {
        libc::signal(libc::SIGHUP, libc::SIG_IGN);
    }
    println!("NAC_CHILD:{pid}");
    std::io::stdout().flush().unwrap();
    unsafe {
        libc::close(libc::STDIN_FILENO);
        libc::close(libc::STDOUT_FILENO);
        libc::close(libc::STDERR_FILENO);
    }
    std::thread::sleep(Duration::from_secs(30));
}

#[tokio::test]
#[cfg(unix)]
async fn kill_removes_background_jobs_from_pty_shell() {
    let backend = crate::sandbox::execution_backend_from_sandbox(
        None,
        &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
    );
    let registry = OutputRegistry::new(crate::terminal::CommandOutputLimits::default()).unwrap();
    let mut session = TerminalSession::spawn(
        "test".to_string(),
        "bash",
        None,
        120,
        40,
        &backend,
        registry.clone(),
        &[],
        None,
    )
    .unwrap();
    // The PTY uses the account's configured login shell, which may not
    // support POSIX job syntax (for example, Fish has no `$!`). Run the
    // process-tree fixture through `sh` so the test is shell-independent.
    session
        .write(b"sh -c 'sleep 30 & echo NAC_CHILD:$!; wait'\r")
        .unwrap();

    let mut cursor = 0;
    let mut output = String::new();
    let mut child_pid = None;
    for _ in 0..40 {
        let page = registry
            .page(
                session.output_id(),
                OutputStream::Combined,
                cursor,
                32 * 1024,
            )
            .unwrap();
        cursor = page.next_offset;
        output.push_str(&page.content);
        child_pid = parse_child_pid(&output);
        if child_pid.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let child_pid = child_pid.unwrap_or_else(|| panic!("child pid not found in: {output:?}"));
    assert!(
        process_running(child_pid),
        "background child exited too early"
    );

    session.kill().await.unwrap();

    let mut still_running = false;
    for _ in 0..40 {
        still_running = process_running(child_pid);
        if !still_running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if still_running {
        unsafe {
            libc::kill(child_pid as libc::pid_t, libc::SIGKILL);
        }
    }
    assert!(!still_running, "background child survived PTY cleanup");
}

#[tokio::test]
#[cfg(unix)]
async fn completed_pty_root_kills_surviving_process_group() {
    let backend = crate::sandbox::execution_backend_from_sandbox(
        None,
        &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
    );
    let registry = OutputRegistry::new(crate::terminal::CommandOutputLimits::default()).unwrap();
    let executable = std::env::current_exe().unwrap();
    let executable = format!(
        "'{}'",
        executable.display().to_string().replace('\'', "'\"'\"'")
    );
    let command = format!(
        "NAC_EXITED_PTY_DESCENDANT_HELPER=1 {executable} --exact terminal::session::tests::exited_pty_descendant_helper --nocapture & sleep 0.2"
    );
    let mut session = TerminalSession::spawn(
        "exited-root".to_string(),
        &command,
        None,
        120,
        40,
        &backend,
        registry.clone(),
        &[],
        None,
    )
    .unwrap();

    let mut cursor = 0;
    let mut output = String::new();
    let mut child_pid = None;
    for _ in 0..40 {
        let page = registry
            .page(
                session.output_id(),
                OutputStream::Combined,
                cursor,
                32 * 1024,
            )
            .unwrap();
        cursor = page.next_offset;
        output.push_str(&page.content);
        child_pid = parse_child_pid(&output);
        if child_pid.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let child_pid = child_pid.unwrap_or_else(|| panic!("child pid not found in: {output:?}"));
    assert!(
        process_running(child_pid),
        "background child exited too early"
    );

    for _ in 0..40 {
        session.refresh_status();
        if session.exit_code().is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(session.exit_code().is_some(), "PTY root did not exit");

    let mut still_running = false;
    for _ in 0..40 {
        still_running = process_running(child_pid);
        if !still_running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if still_running {
        unsafe {
            libc::kill(child_pid as libc::pid_t, libc::SIGKILL);
        }
    }
    assert!(
        !still_running,
        "background child survived exited-root PTY cleanup"
    );
}
