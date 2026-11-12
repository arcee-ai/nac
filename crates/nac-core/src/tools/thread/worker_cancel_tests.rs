//! Cooperative cancellation must drain the worker's stdio pumps even when a
//! survivor that inherited those pipes (such as an orphaned stdio MCP server)
//! keeps them open after the worker acknowledged and exited.
#![cfg(unix)]

use super::*;
use crate::tools::test_runtime;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::time::Instant;

const DRAIN_BOUND: Duration = Duration::from_secs(5);
const CANCEL_BARRIER: &str = "COOPERATIVE_CANCEL_BARRIER";
const HOLDER_PID_ENV: &str = "NAC_WORKER_STDIO_HOLDER_PID_FILE";

#[derive(Clone, Copy, PartialEq, Eq)]
enum StdioHolder {
    None,
    /// A background job in the worker's process group that ignores SIGTERM.
    InGroup,
    /// A descendant in a new session with a cleared environment: no group
    /// signal or Linux environment tag reaches it (macOS still tracks forks).
    Escaped,
}

/// Re-executed by the worker as an escaped holder of its inherited stdio.
#[test]
fn escaped_stdio_holder_helper() {
    let Some(pid_file) = std::env::var_os(HOLDER_PID_ENV) else {
        return;
    };
    // SAFETY: `setsid` takes no arguments. A background job of the worker
    // shell is not a group leader, so this creates a new session.
    assert!(unsafe { libc::setsid() } > 0);
    let error = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"printf '%s' "$$" > "$1"; exec /bin/sleep 600"#)
        .arg("sh")
        .arg(pid_file)
        .env_clear()
        .exec();
    panic!("failed to exec the escaped stdio holder: {error}");
}

fn write_worker(root: &Path, holder: StdioHolder) -> std::path::PathBuf {
    let executable = root.join("worker.sh");
    let pid_file = root.join("holder.pid");
    let holder = match holder {
        StdioHolder::None => String::new(),
        StdioHolder::InGroup => format!(
            "(trap '' TERM; exec sleep 600) &\nprintf '%s' \"$!\" > '{}'\n",
            pid_file.display()
        ),
        // The holder keeps the worker's pipes as fds 3 and 4 while the
        // re-executed test harness writes its own progress to /dev/null.
        StdioHolder::Escaped => format!(
            "{HOLDER_PID_ENV}='{pid_file}' '{exe}' --exact \
             tools::thread::worker::cancel_tests::escaped_stdio_holder_helper --nocapture \
             3>&1 4>&2 >/dev/null 2>&1 &\n\
             while [ ! -s '{pid_file}' ]; do sleep 0.01; done\n",
            pid_file = pid_file.display(),
            exe = std::env::current_exe().unwrap().display()
        ),
    };
    // The barrier is a sanitized product event, so the host publishes it only
    // after its stderr pump has accounted for every earlier line.
    let barrier = serde_json::to_string(&AgentEvent::ModelError {
        thread_name: Some("worker".to_string()),
        message: CANCEL_BARRIER.to_string(),
    })
    .unwrap();
    let script = format!(
        "#!/bin/sh\n{holder}printf 'worker-stdout\\n'\nprintf 'worker-stderr\\n' >&2\n\
         printf '%s\\n' '{prefix}{barrier}' >&2\nread line\nprintf '%s\\n' '{ack}' >&2\nexit 0\n",
        prefix = crate::events::STDERR_EVENT_PREFIX,
        ack = crate::worker::MANAGED_WORKER_CANCEL_ACK,
    );
    std::fs::write(&executable, script).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    executable
}

struct CooperativeCancel {
    run: std::io::Result<WorkerRun>,
    drained: anyhow::Result<Vec<crate::store::ThreadSteeringRecord>>,
    cancel_to_drain: Duration,
}

/// Runs one worker through a session-level cancel and drain. `None` means
/// the dispatch did not drain within the bound.
async fn cooperative_cancel(root: &Path, holder: StdioHolder) -> Option<CooperativeCancel> {
    let mut runtime = test_runtime();
    runtime.workspace_cwd = root.to_path_buf();
    runtime.config_cwd = root.to_path_buf();
    runtime.store_path = root.join("store.db");
    runtime.worker_executable = Some(write_worker(root, holder));
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    runtime.event_sink = crate::events::EventSink::channel(events_tx);
    crate::store::initialize(&runtime.store_path).unwrap();
    crate::store::insert_test_session(&runtime.store_path, "session");
    assert!(runtime.active_threads.begin_run("run-1"));
    assert!(runtime.active_threads.mark("worker", "dispatch"));
    let cancellation = runtime.active_threads.start("worker", "dispatch").unwrap();
    let client = ModelClient::new_for_test();
    let no_sources = Vec::<String>::new();
    let no_skills = Vec::<String>::new();
    let worker = async {
        let run = run_worker(
            &runtime,
            &client,
            WorkerInvocation {
                require_history: false,
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            cancellation,
        )
        .await;
        let _ = runtime
            .active_threads
            .close(&runtime.store_path, "session", "worker", "dispatch");
        (run, Instant::now())
    };
    let cancel_after_barrier = async {
        // Pumps deliberately suppress output read after cancellation, so
        // cancel only once the stderr line has been accounted for.
        while let Some(event) = events_rx.recv().await {
            if matches!(&event, AgentEvent::ModelError { message, .. } if message == CANCEL_BARRIER)
            {
                break;
            }
        }
        let cancelled_at = Instant::now();
        let drained = runtime
            .active_threads
            .cancel_and_drain(Some((&runtime.store_path, "session")))
            .await;
        (drained, cancelled_at)
    };
    let ((run, finished_at), (drained, cancelled_at)) = tokio::time::timeout(DRAIN_BOUND, async {
        tokio::join!(worker, cancel_after_barrier)
    })
    .await
    .ok()?;
    Some(CooperativeCancel {
        run,
        drained,
        cancel_to_drain: finished_at.duration_since(cancelled_at),
    })
}

fn recorded_holder(root: &Path) -> Option<libc::pid_t> {
    std::fs::read_to_string(root.join("holder.pid"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

async fn holder_exits(pid: libc::pid_t) -> bool {
    tokio::time::timeout(Duration::from_secs(2), async {
        // SAFETY: signal zero only probes the holder PID the worker recorded.
        while unsafe { libc::kill(pid, 0) } == 0 {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .is_ok()
}

/// Returns whether the holder had exited, then removes any survivor.
async fn cleanup_holder(root: &Path) -> Option<bool> {
    let pid = recorded_holder(root)?;
    let exited = holder_exits(pid).await;
    // Test cleanup only, so a survivor or a failing run does not leak.
    // SAFETY: kill only the holder PID this test's worker recorded.
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
    Some(exited)
}

async fn assert_cooperative_cancel_drains(holder: StdioHolder, scenario: &str) -> Option<bool> {
    let root = std::env::temp_dir().join(format!("nac_worker_drain_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let outcome = cooperative_cancel(&root, holder).await;
    let holder_exited = cleanup_holder(&root).await;
    let _ = std::fs::remove_dir_all(&root);
    let outcome = outcome.unwrap_or_else(|| panic!("{scenario}: cooperative cancel never drained"));
    eprintln!(
        "{scenario}: drained {:?} after cancel",
        outcome.cancel_to_drain
    );
    outcome.drained.unwrap();
    let run = outcome.run.unwrap();
    assert!(run.cancelled, "{scenario}: run was not reported cancelled");
    assert!(
        run.cleanup_error.is_none(),
        "{scenario}: {:?}",
        run.cleanup_error
    );
    // Output accounted for before cancellation is kept; stdout has no
    // barrier, so it may still have been unread when the cancel arrived.
    assert_eq!(run.stderr, "worker-stderr", "{scenario}");
    assert!(
        run.stdout.is_empty() || run.stdout == "worker-stdout",
        "{scenario}: {:?}",
        run.stdout
    );
    holder_exited
}

#[tokio::test]
async fn cooperative_cancel_drains_while_a_survivor_holds_worker_stdio() {
    let exited = assert_cooperative_cancel_drains(StdioHolder::InGroup, "in-group holder").await;
    assert_eq!(exited, Some(true), "the stdio holder survived cleanup");
}

#[tokio::test]
async fn cooperative_cancel_bounds_the_drain_for_an_unreachable_stdio_holder() {
    let exited = assert_cooperative_cancel_drains(StdioHolder::Escaped, "escaped holder").await;
    assert!(exited.is_some(), "the escaped holder never started");
}

#[tokio::test]
async fn control_cooperative_cancel_drains_without_a_pipe_holder() {
    let exited = assert_cooperative_cancel_drains(StdioHolder::None, "no holder").await;
    assert_eq!(exited, None);
}
