use super::*;
use nac_core::permissions::PermissionApprovalMode;

#[cfg(unix)]
fn child_running(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        if stat
            .rsplit_once(") ")
            .and_then(|(_, fields)| fields.split_whitespace().next())
            == Some("Z")
        {
            return false;
        }
    }
    // SAFETY: signal zero is a read-only existence check; teardown never
    // signals this raw PID. Core native tests use captured identity assertions.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graceful_shutdown_settles_human_shell_and_descendants_before_store_drain_with_observer_clones(
) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("user_terminal_owned_shutdown");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("shutdown-test-key"));
    drop(test_manager(&root));
    seed_direct_session(&root, "session");
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let service = manager.attach_session("session").await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let terminal = service
        .open_user_terminal(uuid::Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let (observer_id, _) = manager
        .session_terminals()
        .attach_user("session", &terminal.id, 1024)
        .await
        .unwrap();
    let client = service.connect_client();
    // Bash expands history before executing a whole line; disabling it must
    // be a separate input line before job-PID assignments using `$!;`.
    service
        .write_user_terminal_input(&terminal.id, b"set +H\r")
        .await
        .unwrap();
    service
        .write_user_terminal_input(&terminal.id, b"sleep 30 & ordinary=$!; (trap '' HUP; exec sleep 30) & detached=$!; disown %2; printf 'CHILD_PIDS:%s:%s\\n' $ordinary $detached\r")
        .await
        .unwrap();
    let mut last_output = String::new();
    let child_pids = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(&terminal.id, 0, 65536)
                .await
                .unwrap();
            let output = String::from_utf8_lossy(&page.bytes);
            last_output = output.to_string();
            if let Some(pids) = output.lines().find_map(|line| {
                let (ordinary, detached) =
                    line.strip_prefix("CHILD_PIDS:")?.trim().split_once(':')?;
                Some([ordinary.parse::<u32>().ok()?, detached.parse::<u32>().ok()?])
            }) {
                break pids;
            }
            service
                .wait_for_user_terminal_output(&terminal.id, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap_or_else(|_| panic!("child readiness timed out: {last_output:?}"));
    for pid in child_pids {
        assert!(child_running(pid));
        // SAFETY: read-only process/session group queries for live fixtures.
        assert_ne!(unsafe { libc::getpgid(pid as libc::pid_t) }, unsafe {
            libc::getsid(pid as libc::pid_t)
        });
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(serve_listener_with_shutdown(
        listener,
        None,
        manager.clone(),
        async move {
            let _ = shutdown_rx.await;
        },
        Duration::from_secs(5),
        || panic!("owned terminal shutdown exceeded its outer deadline"),
    ));
    shutdown_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let retained_after_drain = !service.live_terminal_names().is_empty();
    let child_after_drain = child_pids.into_iter().any(child_running);
    // Clean the real child even if the ownership assertion regresses.
    service.destroy_terminals().await.unwrap();
    let _ = manager
        .session_terminals()
        .detach_user("session", &terminal.id, observer_id)
        .await;
    drop(client);
    assert!(
        !retained_after_drain,
        "observer/service clones kept a shell past store drain"
    );
    assert!(
        !child_after_drain,
        "owned descendant survived the graceful shutdown boundary"
    );
    drop(service);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
