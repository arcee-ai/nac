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
    // SAFETY: signal zero checks the existence of the exact fixture child.
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
    service
        .write_user_terminal_input(&terminal.id, b"sleep 30 & printf 'CHILD_PID:%s\\n' $!\r")
        .await
        .unwrap();
    let mut last_output = String::new();
    let child_pid = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(&terminal.id, 0, 65536)
                .await
                .unwrap();
            let output = String::from_utf8_lossy(&page.bytes);
            last_output = output.to_string();
            if let Some(pid) = output.split("CHILD_PID:").find_map(|suffix| {
                suffix
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect::<String>()
                    .parse::<u32>()
                    .ok()
            }) {
                break pid;
            }
            service
                .wait_for_user_terminal_output(&terminal.id, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap_or_else(|_| panic!("child readiness timed out: {last_output:?}"));
    assert!(child_running(child_pid));
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
    let child_after_drain = child_running(child_pid);
    // Clean the real child even if the ownership assertion regresses.
    service.destroy_terminals().await.unwrap();
    manager
        .session_terminals()
        .detach_user("session", &terminal.id, observer_id);
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
