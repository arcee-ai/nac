#[tokio::test]
async fn pipe_reader_shutdown_preserves_queued_output_and_closes_channel() {
    use tokio::io::AsyncWriteExt;

    let (mut writer, reader) = tokio::io::duplex(64);
    let (sender, mut receiver) = mpsc::channel(1);
    let shutdown = ThreadCancellation::default();
    let handle = tokio::spawn(read_chunks(
        reader,
        OutputStream::Stdout,
        sender,
        shutdown.clone(),
    ));

    writer.write_all(b"before shutdown").await.unwrap();
    let chunk = receiver.recv().await.unwrap();
    assert_eq!(chunk.bytes, b"before shutdown");

    shutdown.cancel();
    tokio::time::timeout(Duration::from_secs(1), handle)
        .await
        .expect("reader did not stop")
        .unwrap()
        .unwrap();
    assert!(receiver.recv().await.is_none());
}
use super::*;
use crate::paths::PathContext;
use crate::sandbox::{
    select_execution_backend, SandboxSession, SandboxSpec, SshConnection, DEFAULT_SANDBOX_IMAGE,
};

fn backend() -> Arc<ExecutionBackend> {
    crate::sandbox::execution_backend_from_sandbox(
        None,
        &std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
    )
}

#[cfg(unix)]
fn current_thread_cpu_time() -> Duration {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    let result = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut time) };
    assert_eq!(result, 0, "failed to read thread CPU clock");
    Duration::new(time.tv_sec as u64, time.tv_nsec as u32)
}

#[tokio::test]
async fn one_shot_preserves_separate_streams_and_nonzero_exit() {
    let manager = TerminalManager::new();
    let output = manager
        .exec_one_shot(
            "printf out; printf err >&2; exit 7",
            None,
            120,
            40,
            5_000,
            8_000,
            &backend(),
            None,
        )
        .await;
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.exit_code, Some(7));
    assert_eq!(output.stdout_preview, "out");
    assert_eq!(output.stderr_preview, "err");
    let id = output.output_id.unwrap();
    assert_eq!(
        manager
            .read_output(&id, OutputStream::Combined, 0, 32)
            .unwrap()
            .content,
        "outerr"
    );
}

#[tokio::test]
async fn direct_settlements_keep_zero_output_artifact_metadata_bounded() {
    let mut manager = TerminalManager::for_direct();
    manager.output_registry =
        OutputRegistry::with_artifact_limit_for_test(CommandOutputLimits::default(), 4).unwrap();
    let mut output_ids = Vec::new();
    for _ in 0..6 {
        let output = manager
            .exec_one_shot("true", None, 120, 40, 5_000, 8_000, &backend(), None)
            .await;
        assert_eq!(output.status, CommandStatus::Completed);
        assert_eq!(output.stdout_bytes, 0);
        assert_eq!(output.stderr_bytes, 0);
        output_ids.push(output.output_id.unwrap());
        manager.settle_run().await.unwrap();
    }

    assert_eq!(manager.output_registry.artifact_count(), 4);
    assert!(manager
        .read_output(&output_ids[0], OutputStream::Combined, 0, 32)
        .is_err());
    assert!(manager
        .read_output(output_ids.last().unwrap(), OutputStream::Combined, 0, 32)
        .is_ok());
}

#[tokio::test]
async fn retained_live_pty_output_stays_pinned_at_the_artifact_limit() {
    let mut manager = TerminalManager::for_direct();
    manager.output_registry =
        OutputRegistry::with_artifact_limit_for_test(CommandOutputLimits::default(), 2).unwrap();
    let first = manager.next_session_name();
    manager
        .create(
            first.clone(),
            "printf live; while :; do sleep 1; done",
            None,
            120,
            40,
            &backend(),
        )
        .await
        .unwrap();
    manager.retain(&first).await.unwrap();
    let initial = manager
        .write_stdin(&first, "", 100, 8_000, None)
        .await
        .unwrap();
    let live_output_id = initial.output_id;

    for _ in 0..3 {
        let output = manager
            .exec_one_shot("true", None, 120, 40, 5_000, 8_000, &backend(), None)
            .await;
        assert_eq!(output.status, CommandStatus::Completed);
        assert!(manager
            .read_output(&live_output_id, OutputStream::Combined, 0, 32)
            .is_ok());
    }

    let second = manager.next_session_name();
    manager
        .create(
            second,
            "while :; do sleep 1; done",
            None,
            120,
            40,
            &backend(),
        )
        .await
        .unwrap();
    let marker_root =
        std::env::temp_dir().join(format!("nac-output-cap-no-spawn-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&marker_root).unwrap();
    let marker = marker_root.join("spawned");
    let third = manager.next_session_name();
    let create_error = manager
        .create(
            third,
            "printf spawned > spawned; while :; do sleep 1; done",
            Some(marker_root.clone()),
            120,
            40,
            &backend(),
        )
        .await
        .unwrap_err();
    assert!(create_error
        .to_string()
        .contains("all 2 artifacts are still active"));
    assert!(
        !marker.exists(),
        "rejected PTY command unexpectedly spawned"
    );
    let rejected = manager
        .exec_one_shot("exit 99", None, 120, 40, 5_000, 8_000, &backend(), None)
        .await;
    assert_eq!(rejected.status, CommandStatus::SpawnError);
    assert!(rejected
        .stderr_preview
        .contains("all 2 artifacts are still active"));
    assert!(manager
        .read_output(&live_output_id, OutputStream::Combined, 0, 32)
        .is_ok());
    manager.remove_all().await.unwrap();
    let _ = std::fs::remove_dir_all(marker_root);
}

#[cfg(unix)]
#[tokio::test]
async fn successful_one_shot_kills_background_descendants() {
    let manager = TerminalManager::new();
    let root =
        std::env::temp_dir().join(format!("nac-one-shot-descendant-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let pid_path = root.join("pid");
    let command = format!(
        "sh -c 'trap \"\" HUP TERM; printf %s $$ > {}; exec sleep 30' </dev/null >/dev/null 2>&1 & while [ ! -s {} ]; do sleep 0.01; done",
        pid_path.display(),
        pid_path.display(),
    );
    let output = manager
        .exec_one_shot(&command, None, 120, 40, 5_000, 8_000, &backend(), None)
        .await;
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.exit_code, Some(0));
    let pid = std::fs::read_to_string(&pid_path)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    for _ in 0..100 {
        if unsafe { libc::kill(pid, 0) } != 0 {
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "descendant survived");
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn worker_one_shot_does_not_hang_on_descendant_inherited_pipes() {
    let manager = TerminalManager::for_worker_with_limits(CommandOutputLimits::default()).unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-worker-one-shot-pipes-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let pid_path = root.join("pid");
    let command = format!(
        "sh -c 'trap \"\" HUP TERM; printf %s $$ > {}; sleep 30' & while [ ! -s {} ]; do sleep 0.01; done",
        pid_path.display(),
        pid_path.display(),
    );
    let output = tokio::time::timeout(
        Duration::from_secs(2),
        manager.exec_one_shot(&command, None, 120, 40, 5_000, 8_000, &backend(), None),
    )
    .await
    .expect("worker one-shot remained blocked on descendant-owned pipes");
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.exit_code, Some(0));
    let pid = std::fs::read_to_string(&pid_path)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    for _ in 0..100 {
        if unsafe { libc::kill(pid, 0) } != 0 {
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "descendant survived");
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn terminal_settlement_surfaces_remote_cleanup_failure() {
    use std::os::unix::fs::PermissionsExt;

    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }
    }

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let root = std::env::temp_dir().join(format!(
        "nac-terminal-cleanup-error-{}",
        uuid::Uuid::new_v4()
    ));
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let calls = root.join("calls");
    std::fs::write(
        &podman,
        format!(
            "#!/bin/sh\nif [ ! -e '{}' ]; then touch '{}'; exit 23; fi\nexit 0\n",
            calls.display(),
            calls.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![bin];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

    let manager = TerminalManager::new();
    manager
        .create("remote".to_string(), "sleep 30", None, 120, 40, &backend())
        .await
        .unwrap();
    let remote_backend = crate::sandbox::execution_backend_from_sandbox(
        Some(SandboxSession::new_for_test(SandboxSpec {
            workdir: root.clone(),
            ..Default::default()
        })),
        &root,
    );
    manager
        .sessions
        .lock()
        .await
        .get_mut("remote")
        .unwrap()
        .set_backend_cleanup_for_test(remote_backend, "/tmp/nac-test.pid".to_string());

    let error = manager.settle_run().await.unwrap_err().to_string();
    assert!(
        error.contains("Podman command cleanup exited with status"),
        "unexpected settlement error: {error}"
    );
    assert!(manager.sessions.lock().await.contains_key("remote"));
    manager.settle_run().await.unwrap();
    assert!(manager.sessions.lock().await.is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn failed_remote_one_shot_cleanup_remains_owned_for_settlement_retry() {
    use std::os::unix::fs::PermissionsExt;

    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }
    }

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let root = std::env::temp_dir().join(format!(
        "nac-one-shot-cleanup-retry-{}",
        uuid::Uuid::new_v4()
    ));
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let cleanup_calls = root.join("cleanup-calls");
    std::fs::write(
        &podman,
        format!(
            "#!/bin/sh\ncase \" $* \" in\n*' nac-kill '*)\n  count=$(cat '{}' 2>/dev/null || printf 0)\n  count=$((count + 1))\n  printf %s \"$count\" > '{}'\n  [ \"$count\" -gt 1 ]\n  exit $?\n  ;;\nesac\nsleep 30\n",
            cleanup_calls.display(),
            cleanup_calls.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![bin];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

    let backend = crate::sandbox::execution_backend_from_sandbox(
        Some(SandboxSession::new_for_test(SandboxSpec {
            workdir: root.clone(),
            ..Default::default()
        })),
        &root,
    );
    let manager = TerminalManager::new();
    let output = manager
        .exec_one_shot("sleep 30", None, 120, 40, 20, 8_000, &backend, None)
        .await;
    assert_eq!(output.status, CommandStatus::TimedOut);
    assert!(output
        .stderr_preview
        .contains("remote command cleanup incomplete"));
    assert_eq!(manager.pending_remote_cleanup_count(), 1);

    manager.settle_run().await.unwrap();
    assert_eq!(manager.pending_remote_cleanup_count(), 0);
    assert_eq!(std::fs::read_to_string(&cleanup_calls).unwrap(), "2");
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn remote_cleanup_observes_local_transport_already_stopped() {
    use std::os::unix::fs::PermissionsExt;

    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }
    }

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let root =
        std::env::temp_dir().join(format!("nac-remote-cleanup-order-{}", uuid::Uuid::new_v4()));
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let launcher_pid = root.join("launcher-pid");
    let cleanup_overtook_transport = root.join("cleanup-overtook-transport");
    let late_side_effect = root.join("late-side-effect");
    std::fs::write(
        &podman,
        format!(
            "#!/bin/sh\ncase \" $* \" in\n*' nac-kill '*)\n  pid=$(cat '{}' 2>/dev/null || true)\n  if [ -n \"$pid\" ] && kill -0 \"$pid\" 2>/dev/null; then : > '{}'; fi\n  exit 0\n  ;;\nesac\nprintf %s \"$$\" > '{}'\nsleep 0.3\nprintf late > '{}'\nsleep 30\n",
            launcher_pid.display(),
            cleanup_overtook_transport.display(),
            launcher_pid.display(),
            late_side_effect.display(),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![bin];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

    let remote_backend = crate::sandbox::execution_backend_from_sandbox(
        Some(SandboxSession::new_for_test(SandboxSpec {
            workdir: root.clone(),
            ..Default::default()
        })),
        &root,
    );
    let manager = TerminalManager::new();
    let cancellation = ThreadCancellation::default();
    let command_manager = manager.clone();
    let command_backend = Arc::clone(&remote_backend);
    let command_cancellation = cancellation.clone();
    let command = tokio::spawn(async move {
        command_manager
            .exec_one_shot(
                "sleep 30",
                None,
                120,
                40,
                60_000,
                8_000,
                &command_backend,
                Some(&command_cancellation),
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !launcher_pid.exists() {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("remote transport did not start");
    let settlement_error = manager.settle_run().await.unwrap_err();
    assert!(settlement_error.to_string().contains("still active"));
    assert_eq!(manager.pending_remote_cleanup_count(), 1);
    assert!(!cleanup_overtook_transport.exists());

    cancellation.cancel();
    let output = command.await.unwrap();
    assert_eq!(output.status, CommandStatus::Cancelled);
    assert_eq!(manager.pending_remote_cleanup_count(), 0);
    assert!(!cleanup_overtook_transport.exists());
    sleep(Duration::from_millis(350)).await;
    assert!(!late_side_effect.exists());

    std::fs::remove_file(&launcher_pid).unwrap();
    let aborted_manager = manager.clone();
    let aborted_backend = Arc::clone(&remote_backend);
    let aborted = tokio::spawn(async move {
        aborted_manager
            .exec_one_shot(
                "sleep 30",
                None,
                120,
                40,
                60_000,
                8_000,
                &aborted_backend,
                None,
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !launcher_pid.exists() {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("remote transport for aborted command did not start");
    aborted.abort();
    assert!(aborted.await.unwrap_err().is_cancelled());
    manager.settle_run().await.unwrap();
    assert_eq!(manager.pending_remote_cleanup_count(), 0);
    assert!(!cleanup_overtook_transport.exists());
    sleep(Duration::from_millis(350)).await;
    assert!(!late_side_effect.exists());

    manager
        .create("pty".to_string(), "sleep 30", None, 120, 40, &backend())
        .await
        .unwrap();
    let pty_pid = manager
        .sessions
        .lock()
        .await
        .get("pty")
        .and_then(TerminalSession::pid)
        .unwrap();
    std::fs::write(&launcher_pid, pty_pid.to_string()).unwrap();
    manager
        .set_backend_cleanup_for_test(
            "pty",
            Arc::clone(&remote_backend),
            "/tmp/nac-order.pid".to_string(),
        )
        .await
        .unwrap();
    manager.remove_all().await.unwrap();
    assert!(!cleanup_overtook_transport.exists());

    let natural_cleanup = root.join("natural-exit-cleanup");
    std::fs::write(
        &podman,
        format!(
            "#!/bin/sh\ncase \" $* \" in\n*' nac-kill '*) : > '{}'; exit 0 ;;\nesac\nexit 7\n",
            natural_cleanup.display()
        ),
    )
    .unwrap();
    let output = manager
        .exec_one_shot("exit 7", None, 120, 40, 1_000, 8_000, &remote_backend, None)
        .await;
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.exit_code, Some(7));
    assert!(natural_cleanup.exists());
    assert_eq!(manager.pending_remote_cleanup_count(), 0);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn cleanup_cancellation_preserves_ownership_and_parallel_create_keeps_capacity() {
    use std::os::unix::fs::PermissionsExt;

    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }
    }

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let root =
        std::env::temp_dir().join(format!("nac-terminal-cancel-safe-{}", uuid::Uuid::new_v4()));
    let bin = root.join("bin");
    let started = root.join("cleanup-started");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    std::fs::write(
        &podman,
        format!(
            "#!/bin/sh\nif [ ! -e '{}' ]; then touch '{}'; sleep 1; fi\nexit 0\n",
            started.display(),
            started.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![bin];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

    let mut manager = TerminalManager::new();
    manager.max_sessions = 1;
    manager
        .create("first".to_string(), "sleep 30", None, 120, 40, &backend())
        .await
        .unwrap();
    let remote_backend = crate::sandbox::execution_backend_from_sandbox(
        Some(SandboxSession::new_for_test(SandboxSpec {
            workdir: root.clone(),
            ..Default::default()
        })),
        &root,
    );
    manager
        .set_backend_cleanup_for_test(
            "first",
            remote_backend,
            "/tmp/nac-cancel-safe.pid".to_string(),
        )
        .await
        .unwrap();

    let cleanup_manager = manager.clone();
    let cleanup = tokio::spawn(async move { cleanup_manager.settle_run().await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !started.exists() {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    cleanup.abort();
    assert!(cleanup.await.unwrap_err().is_cancelled());
    assert!(manager.get("first").await.is_some());

    // Let the abandoned helper exit, then force the eviction cleanup in
    // the first create to pause again while a second create arrives.
    sleep(Duration::from_millis(1100)).await;
    std::fs::remove_file(&started).unwrap();
    let create_a_manager = manager.clone();
    let local_backend = backend();
    let create_a_backend = local_backend.clone();
    let create_a = tokio::spawn(async move {
        create_a_manager
            .create(
                "second".to_string(),
                "sleep 30",
                None,
                120,
                40,
                &create_a_backend,
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !started.exists() {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let create_b_manager = manager.clone();
    let create_b_backend = local_backend;
    let create_b = tokio::spawn(async move {
        create_b_manager
            .create(
                "third".to_string(),
                "sleep 30",
                None,
                120,
                40,
                &create_b_backend,
            )
            .await
    });
    create_a.await.unwrap().unwrap();
    create_b.await.unwrap().unwrap();

    let sessions = manager.sessions.lock().await;
    assert_eq!(sessions.len(), 1);
    assert!(sessions.contains_key("third"));
    drop(sessions);
    manager.remove_all().await.unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn one_shot_timeout_is_structured() {
    let manager = TerminalManager::new();
    let output = manager
        .exec_one_shot("sleep 5", None, 120, 40, 20, 8_000, &backend(), None)
        .await;

    assert_eq!(output.status, CommandStatus::TimedOut);
    assert_eq!(output.exit_code, None);
}

#[cfg(target_os = "linux")]
async fn run_one_shot_with_pidfd_failure(cancel: bool) -> CommandOutput {
    let _test_lock = crate::process::PIDFD_OPEN_FAILURE_LOCK.lock().await;
    let manager = TerminalManager::new();
    let root = std::env::temp_dir().join(format!("nac-pidfd-failure-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let pidfile = root.join("descendant-pid");
    let command = format!(
        "setsid sh -c 'printf $$ > {pidfile}; printf child-output; \
         printf child-error >&2; trap \"\" TERM; sleep 30' & \
         printf parent-output; printf parent-error >&2; sleep 30",
        pidfile = pidfile.display()
    );
    let cancellation = ThreadCancellation::default();
    let task_cancellation = cancellation.clone();
    let task_manager = manager.clone();
    let task_backend = backend();
    let timeout_ms = if cancel { 5_000 } else { 200 };
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(
                &command,
                None,
                120,
                40,
                timeout_ms,
                8_000,
                &task_backend,
                cancel.then_some(&task_cancellation),
            )
            .await
    });

    let descendant_pid = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pidfile) {
                break pid.parse::<libc::pid_t>().unwrap();
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("isolated descendant did not publish its pid");
    struct PidfdFailureReset;
    impl Drop for PidfdFailureReset {
        fn drop(&mut self) {
            crate::process::set_pidfd_open_failure_for_test(0);
        }
    }
    let _failure_reset = PidfdFailureReset;
    crate::process::set_pidfd_open_failure_for_test(descendant_pid);
    if cancel {
        cancellation.cancel();
    }

    let output = tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .expect("one-shot cleanup remained blocked on inherited pipes")
        .unwrap();

    assert_eq!(output.exit_code, None);
    assert!(output.stdout_preview.contains("parent-output"));
    assert!(output.stdout_preview.contains("child-output"));
    assert!(output.stderr_preview.contains("parent-error"));
    assert!(output.stderr_preview.contains("child-error"));
    assert!(output.stderr_preview.contains("command cleanup incomplete"));

    unsafe {
        libc::kill(descendant_pid, libc::SIGKILL);
    }
    let _ = std::fs::remove_dir_all(root);
    output
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn one_shot_pidfd_failure_is_bounded_and_preserves_timeout_output() {
    let output = run_one_shot_with_pidfd_failure(false).await;
    assert_eq!(output.status, CommandStatus::TimedOut);
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn one_shot_pidfd_failure_is_bounded_and_preserves_cancellation_output() {
    let output = run_one_shot_with_pidfd_failure(true).await;
    assert_eq!(output.status, CommandStatus::Cancelled);
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
async fn one_shot_closed_pipes_do_not_busy_spin() {
    let manager = TerminalManager::new();
    let wall_start = Instant::now();
    let cpu_start = current_thread_cpu_time();
    let output = manager
        .exec_one_shot(
            "printf retained; exec 1>&- 2>&-; sleep 0.3",
            None,
            120,
            40,
            1_000,
            8_000,
            &backend(),
            None,
        )
        .await;
    let wall_elapsed = wall_start.elapsed();
    let cpu_elapsed = current_thread_cpu_time().saturating_sub(cpu_start);

    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(
        manager
            .read_output(
                output.output_id.as_deref().unwrap(),
                OutputStream::Stdout,
                0,
                32,
            )
            .unwrap()
            .content,
        "retained"
    );
    assert!(
        cpu_elapsed < wall_elapsed / 2,
        "closed output pipes consumed {cpu_elapsed:?} CPU over {wall_elapsed:?} wall time"
    );
}

#[tokio::test]
async fn one_shot_closed_pipes_still_time_out() {
    let manager = TerminalManager::new();
    let output = manager
        .exec_one_shot(
            "exec 1>&- 2>&-; sleep 5",
            None,
            120,
            40,
            20,
            8_000,
            &backend(),
            None,
        )
        .await;

    assert_eq!(output.status, CommandStatus::TimedOut);
    assert_eq!(output.exit_code, None);
}

#[tokio::test]
async fn one_shot_closed_pipes_still_cancel() {
    let manager = TerminalManager::new();
    let cancellation = ThreadCancellation::default();
    let task_manager = manager.clone();
    let task_backend = backend();
    let task_cancellation = cancellation.clone();
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(
                "exec 1>&- 2>&-; sleep 5",
                None,
                120,
                40,
                5_000,
                8_000,
                &task_backend,
                Some(&task_cancellation),
            )
            .await
    });

    sleep(Duration::from_millis(50)).await;
    cancellation.cancel();
    let output = task.await.unwrap();
    assert_eq!(output.status, CommandStatus::Cancelled);
    assert_eq!(output.exit_code, None);
}

#[tokio::test]
async fn one_shot_spawn_failure_is_structured() {
    let manager = TerminalManager::new();
    let missing =
        std::env::temp_dir().join(format!("nac-missing-command-cwd-{}", uuid::Uuid::new_v4()));
    let output = manager
        .exec_one_shot(
            "printf unreachable",
            Some(missing),
            120,
            40,
            1_000,
            1_000,
            &backend(),
            None,
        )
        .await;
    assert_eq!(output.status, CommandStatus::SpawnError);
    assert_eq!(output.exit_code, None);
    assert!(output.stderr_preview.contains("spawn"));
}

#[tokio::test]
async fn one_shot_output_is_bounded_while_retaining_middle() {
    let manager = TerminalManager::with_limits(CommandOutputLimits {
        per_command_bytes: 3 * 1024 * 1024,
        per_session_bytes: 4 * 1024 * 1024,
    })
    .unwrap();
    let counter = std::env::temp_dir().join(format!("nac-command-once-{}", uuid::Uuid::new_v4()));
    let command = format!(
        "python3 -c 'from pathlib import Path; import sys; p=Path(r\"{}\"); p.write_text(\"1\" if not p.exists() else p.read_text()+\"1\"); sys.stdout.write(\"a\"*(1024*1024)+\"UNIQUE_DIAGNOSTIC\"+\"z\"*(1024*1024))'",
        counter.display()
    );
    let output = manager
        .exec_one_shot(&command, None, 120, 40, 10_000, 1_000, &backend(), None)
        .await;
    assert!(output.truncated);
    assert!(!output.stdout_preview.contains("UNIQUE_DIAGNOSTIC"));
    let id = output.output_id.unwrap();
    let page = manager
        .read_output(&id, OutputStream::Stdout, 1024 * 1024 - 8, 64)
        .unwrap();
    assert!(page.content.contains("UNIQUE_DIAGNOSTIC"));
    assert_eq!(std::fs::read_to_string(&counter).unwrap(), "1");
    let _ = std::fs::remove_file(counter);
}

#[tokio::test]
async fn noisy_producer_never_retains_more_than_the_configured_cap() {
    let manager = TerminalManager::with_limits(CommandOutputLimits {
        per_command_bytes: 64 * 1024,
        per_session_bytes: 64 * 1024,
    })
    .unwrap();
    let output = manager
        .exec_one_shot(
            "python3 -c 'import sys; sys.stdout.write(\"x\"*(2*1024*1024))'",
            None,
            120,
            40,
            10_000,
            100,
            &backend(),
            None,
        )
        .await;
    assert!(output.overflowed);
    let page = manager
        .read_output(
            output.output_id.as_deref().unwrap(),
            OutputStream::Stdout,
            0,
            64 * 1024,
        )
        .unwrap();
    assert_eq!(page.retained_end - page.retained_start, 64 * 1024);
    assert_eq!(page.content.len(), 64 * 1024);
}

#[tokio::test]
async fn explicit_cancellation_is_structured_and_stops_late_side_effects() {
    let manager = TerminalManager::new();
    let cancellation = ThreadCancellation::default();
    let path = std::env::temp_dir().join(format!("nac-command-cancel-{}", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let command = format!("sleep 1; printf late > {}", path.display());
    let task_manager = manager.clone();
    let task_backend = backend();
    let task_cancellation = cancellation.clone();
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(
                &command,
                None,
                120,
                40,
                5_000,
                8_000,
                &task_backend,
                Some(&task_cancellation),
            )
            .await
    });

    sleep(Duration::from_millis(50)).await;
    cancellation.cancel();
    let output = task.await.unwrap();
    assert_eq!(output.status, CommandStatus::Cancelled);
    assert_eq!(output.exit_code, None);
    sleep(Duration::from_millis(100)).await;
    assert!(
        !path.exists(),
        "cancelled command produced a late side effect"
    );
}

#[tokio::test]
async fn registry_clear_terminates_an_active_one_shot_command() {
    let manager = TerminalManager::new();
    let path = std::env::temp_dir().join(format!(
        "nac-command-registry-clear-{}",
        uuid::Uuid::new_v4()
    ));
    let command = format!(
        "python3 -c 'from pathlib import Path; from threading import Timer; import sys; \
         Timer(1,lambda:Path(r\"{}\").write_text(\"late\")).start(); \
         exec(\"while True:\\n sys.stdout.write(\\\"x\\\"*65536)\\n sys.stdout.flush()\")'",
        path.display()
    );
    let task_manager = manager.clone();
    let task_backend = backend();
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(&command, None, 120, 40, 5_000, 8_000, &task_backend, None)
            .await
    });

    sleep(Duration::from_millis(50)).await;
    manager.remove_all().await.unwrap();
    let output = tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .expect("one-shot command stalled after registry clear")
        .unwrap();
    assert_eq!(output.status, CommandStatus::SpawnError);
    sleep(Duration::from_millis(1_100)).await;
    assert!(
        !path.exists(),
        "registry-cleared command produced a late side effect"
    );
}

#[tokio::test]
async fn cancellation_before_spawn_never_starts_the_command() {
    let manager = TerminalManager::new();
    let cancellation = ThreadCancellation::default();
    cancellation.cancel();
    let path =
        std::env::temp_dir().join(format!("nac-command-pre-cancel-{}", uuid::Uuid::new_v4()));
    let output = manager
        .exec_one_shot(
            &format!("printf late > {}", path.display()),
            None,
            120,
            40,
            5_000,
            8_000,
            &backend(),
            Some(&cancellation),
        )
        .await;
    assert_eq!(output.status, CommandStatus::Cancelled);
    assert_eq!(output.output_id, None);
    assert!(!path.exists(), "pre-cancelled command was spawned");
}

#[tokio::test]
async fn cancellation_wins_while_one_shot_waits_before_final_spawn() {
    let manager = TerminalManager::new();
    let cancellation = ThreadCancellation::default();
    let marker = std::env::temp_dir().join(format!(
        "nac-command-cancelled-final-spawn-{}",
        uuid::Uuid::new_v4()
    ));
    let held_spawn = manager.one_shot_spawn_gate.lock().await;
    let task_manager = manager.clone();
    let task_backend = backend();
    let task_cancellation = cancellation.clone();
    let command = format!("printf late > {}", marker.display());
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(
                &command,
                None,
                120,
                40,
                5_000,
                8_000,
                &task_backend,
                Some(&task_cancellation),
            )
            .await
    });
    tokio::task::yield_now().await;
    cancellation.cancel();
    drop(held_spawn);

    let output = task.await.unwrap();
    assert_eq!(output.status, CommandStatus::Cancelled);
    assert_eq!(output.output_id, None);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!marker.exists(), "cancelled one-shot command was spawned");
    assert_eq!(manager.pending_remote_cleanup_count(), 0);
    let _ = std::fs::remove_file(marker);
}

#[tokio::test]
async fn pty_cancellation_stops_waiting_and_late_side_effects() {
    let manager = TerminalManager::new();
    let backend = backend();
    manager
        .create("pty-cancel".to_string(), "bash", None, 120, 40, &backend)
        .await
        .unwrap();
    let cancellation = ThreadCancellation::default();
    let path = std::env::temp_dir().join(format!("nac-pty-cancel-{}", uuid::Uuid::new_v4()));
    let command = format!("sleep 1; printf late > {}<RET>", path.display());
    let task_manager = manager.clone();
    let task_cancellation = cancellation.clone();
    let task = tokio::spawn(async move {
        task_manager
            .write_stdin(
                "pty-cancel",
                &command,
                5_000,
                8_000,
                Some(&task_cancellation),
            )
            .await
    });
    sleep(Duration::from_millis(50)).await;
    cancellation.cancel();
    let error = task.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("cancelled"));
    sleep(Duration::from_millis(1_100)).await;
    assert!(!path.exists(), "cancelled PTY produced a late side effect");
    assert!(manager.get("pty-cancel").await.is_none());
}

#[tokio::test]
async fn direct_run_settlement_keeps_only_explicitly_retained_terminals() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let foreground = manager.next_session_name();
    let retained = manager.next_session_name();
    manager
        .create(foreground.clone(), "bash", None, 120, 40, &backend)
        .await
        .unwrap();
    manager
        .create(retained.clone(), "bash", None, 120, 40, &backend)
        .await
        .unwrap();
    let info = manager.retain(&retained).await.unwrap();
    assert!(info.retained);

    manager.settle_run().await.unwrap();
    assert!(manager.get(&foreground).await.is_none());
    assert!(manager.get(&retained).await.unwrap().retained);
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn retained_terminal_holds_cross_process_workspace_authority() {
    let root = std::env::temp_dir().join(format!(
        "nac-retained-workspace-authority-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    let identity = crate::workspace::GitTarget::local(root.clone()).lease_identity();
    let manager = TerminalManager::for_direct();
    manager.configure_workspace_authority(store_path.clone(), identity.clone());
    manager
        .configure_session_resource_authority(store_path.clone(), "retained-session".to_string());
    let name = manager.next_session_name();
    manager
        .create(
            name.clone(),
            "bash",
            Some(root.clone()),
            120,
            40,
            &backend(),
        )
        .await
        .unwrap();
    manager.retain(&name).await.unwrap();

    assert!(matches!(
        crate::sessions::WorkspaceMutationLease::try_acquire(&store_path, &identity),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store_path, "retained-session"),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_))
    ));
    manager.remove_all().await.unwrap();
    drop(crate::sessions::WorkspaceMutationLease::try_acquire(&store_path, &identity).unwrap());
    drop(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store_path, "retained-session")
            .unwrap(),
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn eviction_cleanup_rechecks_retention_after_selection() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let name = manager.next_session_name();
    manager
        .create(name.clone(), "sleep 30", None, 120, 40, &backend)
        .await
        .unwrap();

    // Model the eviction/settlement name snapshot, then let retention win
    // before cleanup reacquires the map lock.
    let selected = name.clone();
    manager.retain(&name).await.unwrap();
    assert!(manager
        .kill_owned_session(&selected, true)
        .await
        .unwrap()
        .is_none());
    assert!(manager.get(&name).await.unwrap().retained);
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn cancelled_create_cannot_spawn_before_manager_ownership() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let marker =
        std::env::temp_dir().join(format!("nac-create-ownership-{}", uuid::Uuid::new_v4()));
    let held_map = manager.sessions.lock().await;
    let create_manager = manager.clone();
    let create_backend = backend.clone();
    let command = format!("printf spawned > {}; sleep 30", marker.display());
    let create = tokio::spawn(async move {
        create_manager
            .create(
                "ownership-window".to_string(),
                &command,
                None,
                120,
                40,
                &create_backend,
            )
            .await
    });
    tokio::task::yield_now().await;
    create.abort();
    assert!(create.await.unwrap_err().is_cancelled());
    drop(held_map);
    tokio::time::sleep(Duration::from_millis(50)).await;

    assert!(
        !marker.exists(),
        "cancelled create spawned outside manager ownership"
    );
    assert!(manager.sessions.lock().await.is_empty());
    let _ = std::fs::remove_file(marker);
}

#[tokio::test]
async fn cancellation_wins_while_create_waits_before_final_spawn() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let cancellation = ThreadCancellation::default();
    let marker =
        std::env::temp_dir().join(format!("nac-cancelled-create-{}", uuid::Uuid::new_v4()));
    let held_admission = manager.create_gate.lock().await;
    let create_manager = manager.clone();
    let create_backend = backend.clone();
    let create_cancellation = cancellation.clone();
    let command = format!("printf spawned > {}; sleep 30", marker.display());
    let create = tokio::spawn(async move {
        create_manager
            .create_with_cancellation(
                "cancelled-before-spawn".to_string(),
                &command,
                None,
                120,
                40,
                &create_backend,
                Some(&create_cancellation),
            )
            .await
    });
    tokio::task::yield_now().await;
    cancellation.cancel();
    drop(held_admission);

    let error = create.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("cancelled before PTY spawn"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!marker.exists(), "cancelled PTY created its marker");
    assert!(manager.sessions.lock().await.is_empty());
    let _ = std::fs::remove_file(marker);
}

#[tokio::test]
async fn cancellation_wins_while_terminal_input_waits_for_final_ownership() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let cancellation = ThreadCancellation::default();
    let marker = std::env::temp_dir().join(format!("nac-cancelled-input-{}", uuid::Uuid::new_v4()));
    let command = format!("read value; printf %s \"$value\" > {}", marker.display());
    manager
        .create(
            "cancelled-input".to_string(),
            &command,
            None,
            120,
            40,
            &backend,
        )
        .await
        .unwrap();

    let held_sessions = manager.sessions.lock().await;
    let input_manager = manager.clone();
    let input_cancellation = cancellation.clone();
    let input = tokio::spawn(async move {
        input_manager
            .write_stdin(
                "cancelled-input",
                "must-not-arrive<RET>",
                50,
                8_000,
                Some(&input_cancellation),
            )
            .await
    });
    tokio::task::yield_now().await;
    cancellation.cancel();
    drop(held_sessions);

    let error = input.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("cancelled before input"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!marker.exists(), "cancelled input reached the PTY process");
    manager.remove_all().await.unwrap();
    let _ = std::fs::remove_file(marker);
}

#[tokio::test]
async fn cancellation_wins_while_retention_waits_for_final_ownership() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let cancellation = ThreadCancellation::default();
    let name = manager.next_session_name();
    manager
        .create(name.clone(), "sleep 30", None, 120, 40, &backend)
        .await
        .unwrap();

    let held_sessions = manager.sessions.lock().await;
    let retain_manager = manager.clone();
    let retain_name = name.clone();
    let retain_cancellation = cancellation.clone();
    let retain = tokio::spawn(async move {
        retain_manager
            .retain_with_cancellation(&retain_name, Some(&retain_cancellation))
            .await
    });
    tokio::task::yield_now().await;
    cancellation.cancel();
    drop(held_sessions);

    let error = retain.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("cancelled before retention"));
    manager.settle_run().await.unwrap();
    assert!(manager.get(&name).await.is_none());
}

#[tokio::test]
async fn exited_retained_terminals_do_not_exhaust_live_capacity() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let marker =
        std::env::temp_dir().join(format!("nac-retained-capacity-{}", uuid::Uuid::new_v4()));
    let command = format!("while [ ! -e {} ]; do sleep 0.01; done", marker.display());
    let mut names = Vec::new();
    for _ in 0..manager.max_sessions {
        let name = manager.next_session_name();
        manager
            .create(name.clone(), &command, None, 120, 40, &backend)
            .await
            .unwrap();
        manager.retain(&name).await.unwrap();
        names.push(name);
    }
    std::fs::write(&marker, b"done").unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let mut all_exited = true;
            for name in &names {
                all_exited &= manager.get(name).await.is_some_and(|info| !info.alive);
            }
            if all_exited {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("retained commands did not exit");
    assert!(
        manager.has_retained(),
        "an exited retained handle remains an explicit service-ownership obligation"
    );

    let replacement = manager.next_session_name();
    manager
        .create(replacement.clone(), "sleep 30", None, 120, 40, &backend)
        .await
        .expect("exited retained handles must be reaped before capacity is checked");
    assert!(manager.get(&replacement).await.is_some());
    let completed = manager
        .write_stdin(&names[0], "", 0, 8_000, None)
        .await
        .expect("reaped retained status remains observable through a bounded tombstone");
    assert_eq!(completed.exit_code, Some(0));
    assert!(completed.session_name.is_none());
    manager.remove_all().await.unwrap();
    let _ = std::fs::remove_file(marker);
}

#[tokio::test]
async fn direct_cancellation_stops_foreground_and_preserves_retained_terminal() {
    let manager = TerminalManager::for_direct();
    let backend = backend();
    let foreground = manager.next_session_name();
    let retained = manager.next_session_name();
    manager
        .create(foreground.clone(), "bash", None, 120, 40, &backend)
        .await
        .unwrap();
    manager
        .create(retained.clone(), "bash", None, 120, 40, &backend)
        .await
        .unwrap();
    manager.retain(&retained).await.unwrap();
    let cancellation = ThreadCancellation::default();
    cancellation.cancel();
    assert!(manager
        .write_stdin(&foreground, "", 10, 100, Some(&cancellation))
        .await
        .unwrap_err()
        .to_string()
        .contains("cancelled"));
    assert!(manager.get(&foreground).await.is_none());
    assert!(manager.get(&retained).await.is_some());
    manager.remove_all().await.unwrap();
}

#[test]
fn stale_terminal_handle_reports_process_local_restart_loss() {
    let prior = TerminalManager::for_direct();
    let stale = prior.next_session_name();
    let current = TerminalManager::for_direct();
    assert!(current
        .missing_session_error(&stale)
        .to_string()
        .contains("previous nac service instance"));
    assert!(current
        .missing_session_error(&current.next_session_name())
        .to_string()
        .contains("closed or expired"));
}

#[tokio::test]
async fn terminal_handle_cannot_cross_manager_authority() {
    let owner = TerminalManager::for_direct();
    let handle = owner.next_session_name();
    owner
        .create(
            handle.clone(),
            "while :; do sleep 1; done",
            None,
            120,
            40,
            &backend(),
        )
        .await
        .unwrap();
    let foreign = TerminalManager::for_direct();
    let error = foreign
        .write_stdin(&handle, "input<RET>", 10, 100, None)
        .await
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("belonged to a previous nac service instance"));
    assert!(owner.get(&handle).await.is_some());
    owner.remove_all().await.unwrap();
}

#[tokio::test]
async fn pty_preview_does_not_destroy_omitted_output() {
    let manager = TerminalManager::new();
    let backend = backend();
    manager
        .create("pty-recovery".to_string(), "bash", None, 120, 40, &backend)
        .await
        .unwrap();
    let output = manager
        .write_stdin(
            "pty-recovery",
            "python3 -c 'print(\"a\"*9000+bytes([80,84,89,95,68,73,65,71,78,79,83,84,73,67]).decode()+\"z\"*9000)'<RET>",
            1_000,
            100,
            None,
        )
        .await
        .unwrap();
    assert!(output.truncated);
    assert!(!output.content_preview.contains("PTY_DIAGNOSTIC"));

    let first = manager
        .read_output(
            &output.output_id,
            OutputStream::Combined,
            output.start_cursor,
            32 * 1024,
        )
        .unwrap();
    let repeated = manager
        .read_output(
            &output.output_id,
            OutputStream::Combined,
            output.start_cursor,
            32 * 1024,
        )
        .unwrap();
    assert_eq!(first.content, repeated.content);
    assert!(first.content.contains("PTY_DIAGNOSTIC"));
    manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn remove_all_expires_command_output() {
    let manager = TerminalManager::new();
    let output = manager
        .exec_one_shot(
            "printf hello",
            None,
            120,
            40,
            1_000,
            8_000,
            &backend(),
            None,
        )
        .await;
    let id = output.output_id.unwrap();
    manager.remove_all().await.unwrap();
    assert!(manager
        .read_output(&id, OutputStream::Combined, 0, 32)
        .is_err());
}

async fn assert_remote_backend_output_contract(backend: Arc<ExecutionBackend>) {
    let manager = TerminalManager::with_limits(CommandOutputLimits {
        per_command_bytes: 3 * 1024 * 1024,
        per_session_bytes: 4 * 1024 * 1024,
    })
    .unwrap();
    let marker = format!("/tmp/nac-command-once-{}", uuid::Uuid::new_v4());
    let command = format!(
        "python3 -c 'from pathlib import Path; import sys; p=Path(\"{marker}\"); p.write_text(\"1\" if not p.exists() else p.read_text()+\"1\"); sys.stdout.write(\"a\"*(1024*1024)+\"REMOTE_DIAGNOSTIC\"+\"z\"*(1024*1024)); sys.stderr.write(\"remote-err\\n\"); raise SystemExit(7)'"
    );
    let output = manager
        .exec_one_shot(&command, None, 120, 40, 30_000, 1_000, &backend, None)
        .await;
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.exit_code, Some(7));
    assert!(output.truncated);
    assert!(!output.stdout_preview.contains("REMOTE_DIAGNOSTIC"));
    assert_eq!(output.stderr_preview, "remote-err\n");
    let output_id = output.output_id.unwrap();
    let diagnostic = manager
        .read_output(&output_id, OutputStream::Stdout, 1024 * 1024 - 8, 64)
        .unwrap();
    assert!(diagnostic.content.contains("REMOTE_DIAGNOSTIC"));

    let mut offset = 0;
    let mut total = 0;
    loop {
        let page = manager
            .read_output(&output_id, OutputStream::Combined, offset, 32 * 1024)
            .unwrap();
        assert_eq!(page.offset, offset);
        total += page.content.len();
        offset = page.next_offset;
        if page.eof {
            break;
        }
    }
    assert_eq!(total, 2 * 1024 * 1024 + "REMOTE_DIAGNOSTIC".len() + 11);

    let counter = manager
        .exec_one_shot(
            &format!("cat {marker}; rm -f {marker}"),
            None,
            120,
            40,
            10_000,
            1_000,
            &backend,
            None,
        )
        .await;
    assert_eq!(counter.stdout_preview, "1");

    let cancellation = ThreadCancellation::default();
    let cancellation_marker = format!("/tmp/nac-command-cancel-{}", uuid::Uuid::new_v4());
    let task_manager = manager.clone();
    let task_backend = Arc::clone(&backend);
    let task_cancellation = cancellation.clone();
    let task_marker = cancellation_marker.clone();
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(
                &format!("trap '' TERM; sleep 1; printf late > {task_marker}"),
                None,
                120,
                40,
                10_000,
                1_000,
                &task_backend,
                Some(&task_cancellation),
            )
            .await
    });
    sleep(Duration::from_millis(50)).await;
    cancellation.cancel();
    let cancelled = task.await.unwrap();
    assert_eq!(cancelled.status, CommandStatus::Cancelled);
    sleep(Duration::from_millis(1_100)).await;
    let side_effect_check = manager
        .exec_one_shot(
            &format!(
                "test ! -e {cancellation_marker}; status=$?; rm -f {cancellation_marker}; exit $status"
            ),
            None,
            120,
            40,
            10_000,
            1_000,
            &backend,
            None,
        )
        .await;
    assert_eq!(
        side_effect_check.exit_code,
        Some(0),
        "cancelled remote command produced a late side effect"
    );

    let timed_out = manager
        .exec_one_shot("sleep 5", None, 120, 40, 100, 1_000, &backend, None)
        .await;
    assert_eq!(timed_out.status, CommandStatus::TimedOut);
    assert_eq!(timed_out.exit_code, None);
}

#[tokio::test]
#[ignore = "requires a running Podman machine and the configured image"]
async fn podman_backend_preserves_output_contract() {
    let image = std::env::var("NAC_TEST_PODMAN_IMAGE")
        .unwrap_or_else(|_| DEFAULT_SANDBOX_IMAGE.to_string());
    let sandbox = SandboxSession::create(
        SandboxSpec {
            image,
            ..Default::default()
        },
        format!("output-artifacts-test-{}", uuid::Uuid::new_v4()),
        true,
        "output-artifacts-test".to_string(),
    )
    .await
    .unwrap();
    assert_remote_backend_output_contract(crate::sandbox::execution_backend_from_sandbox(
        Some(sandbox),
        &std::env::current_dir().unwrap(),
    ))
    .await;
}

#[tokio::test]
#[ignore = "requires NAC_TEST_SSH_HOST, NAC_TEST_SSH_PORT, and NAC_TEST_SSH_KEY"]
async fn openssh_backend_preserves_output_contract() {
    let connection = SshConnection {
        host: std::env::var("NAC_TEST_SSH_HOST").unwrap(),
        port: Some(std::env::var("NAC_TEST_SSH_PORT").unwrap().parse().unwrap()),
        identity_file: Some(PathBuf::from(std::env::var("NAC_TEST_SSH_KEY").unwrap())),
    };
    let cwd = PathBuf::from("/tmp");
    let paths = PathContext::new(std::env::current_dir().unwrap());
    let backend =
        select_execution_backend(Some(connection), None, &cwd, &paths).expect("SSH backend");
    backend.ensure_ready().await.unwrap();
    assert_remote_backend_output_contract(backend).await;
}
