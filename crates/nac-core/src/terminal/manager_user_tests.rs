use super::*;

fn backend() -> Arc<ExecutionBackend> {
    crate::sandbox::execution_backend_from_sandbox(None, &std::env::current_dir().unwrap())
}

async fn launch(manager: &TerminalManager, id: uuid::Uuid, command: &str) -> String {
    let name = manager.resolve_user_terminal_launch(id).await;
    manager
        .create_user_terminal(
            name.clone(),
            command,
            std::env::current_dir().unwrap(),
            80,
            24,
            &backend(),
            nac_contracts::CommandEnvironmentSnapshot::from_parts(
                Default::default(),
                vec!["secret-value".into()],
            ),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    name
}

async fn wait_for(manager: &TerminalManager, name: &str, needle: &[u8]) -> Vec<u8> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let bytes = manager
                .read_user_output(name, 0, 64 * 1024)
                .await
                .unwrap()
                .bytes;
            if bytes.windows(needle.len()).any(|window| window == needle) {
                return bytes;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn user_output_is_sanitized_and_independent_of_model_run_settlement() {
    let manager = TerminalManager::for_direct();
    let name = launch(
        &manager,
        uuid::Uuid::new_v4(),
        "printf 'sec'; sleep 0.05; printf 'ret-value\\377\\033[31m'; while :; do sleep 1; done",
    )
    .await;
    let output = wait_for(&manager, &name, b"\x1b[31m").await;
    assert_eq!(output, b"[REDACTED]\xff\x1b[31m");
    assert_eq!(
        manager
            .read_user_output(&name, 0, 64 * 1024)
            .await
            .unwrap()
            .bytes,
        output
    );
    manager.settle_run().await.unwrap();
    assert!(manager.user_terminal_status(&name).await.unwrap().alive);
    assert!(manager.write_stdin(&name, "", 0, 1024, None).await.is_err());
    assert!(manager
        .write_stdin(&name, "echo unsafe\n", 0, 1024, None)
        .await
        .is_err());
    manager.terminate_user_terminal(&name).await.unwrap();
    manager.terminate_user_terminal(&name).await.unwrap();
    assert!(manager
        .create_with_cancellation(name.clone(), "true", None, 80, 24, &backend(), None)
        .await
        .is_err());
    assert_eq!(
        manager
            .read_user_output(&name, 0, 64 * 1024)
            .await
            .unwrap()
            .bytes,
        output
    );
}

#[tokio::test]
async fn user_input_is_literal_and_resize_reaches_the_actual_pty() {
    let manager = TerminalManager::for_direct();
    let name = launch(&manager, uuid::Uuid::new_v4(), "stty -echo -icanon; printf READY; dd bs=1 count=6 2>/dev/null | od -An -tx1; stty size; sleep 30").await;
    wait_for(&manager, &name, b"READY").await;
    manager
        .resize_user_terminal(&name, 91, 31, &ThreadCancellation::default())
        .await
        .unwrap();
    manager
        .write_user_input(&name, b"CTRL-C", &ThreadCancellation::default())
        .await
        .unwrap();
    let bytes = wait_for(&manager, &name, b"31 91").await;
    let text = String::from_utf8_lossy(&bytes);
    let tokens = text.split_whitespace().collect::<Vec<_>>();
    assert!(
        tokens
            .windows(6)
            .any(|tokens| tokens == ["43", "54", "52", "4c", "2d", "43"]),
        "{text:?}"
    );
    let status = manager.user_terminal_status(&name).await.unwrap();
    assert_eq!((status.cols, status.rows), (91, 31));
    assert!(manager
        .resize_user_terminal(&name, 0, 31, &ThreadCancellation::default())
        .await
        .is_err());
    assert!(manager
        .write_user_input(
            &name,
            &vec![0; 16 * 1024 + 1],
            &ThreadCancellation::default()
        )
        .await
        .is_err());
    let cancelled = ThreadCancellation::default();
    cancelled.cancel();
    assert!(manager
        .resize_user_terminal(&name, 80, 24, &cancelled)
        .await
        .is_err());
    assert!(manager
        .write_user_input(&name, b"x", &cancelled)
        .await
        .is_err());
    manager.terminate_user_terminal(&name).await.unwrap();
}

#[tokio::test]
async fn capacity_retries_and_wrong_owner_do_not_replace_or_expose_processes() {
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 1;
    let id = uuid::Uuid::new_v4();
    let name = launch(&manager, id, "printf FIRST; sleep 30").await;
    wait_for(&manager, &name, b"FIRST").await;
    assert_eq!(launch(&manager, id, "printf SECOND; sleep 30").await, name);
    assert_eq!(manager.user_terminal_names().await, vec![name.clone()]);
    assert!(manager
        .create_user_terminal(
            manager.user_terminal_name(uuid::Uuid::new_v4()),
            "true",
            std::env::current_dir().unwrap(),
            80,
            24,
            &backend(),
            nac_contracts::CommandEnvironmentSnapshot::empty(),
            None,
            &ThreadCancellation::default()
        )
        .await
        .is_err());
    assert!(manager.user_terminal_status(&name).await.unwrap().alive);
    let foreign = TerminalManager::for_direct();
    assert!(foreign.read_user_output(&name, 0, 1024).await.is_err());
    assert!(foreign
        .write_user_input(&name, b"x", &ThreadCancellation::default())
        .await
        .is_err());
    assert!(foreign.terminate_user_terminal(&name).await.is_err());
    manager.terminate_user_terminal(&name).await.unwrap();
}

#[tokio::test]
async fn output_completion_tracks_collector_eof_and_flushes_safe_suffix() {
    let manager = TerminalManager::for_direct();
    let name = launch(&manager, uuid::Uuid::new_v4(), "printf 'sec'; exit 7").await;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = manager.user_terminal_status(&name).await.unwrap();
            if status.output_complete && status.exit_code.is_some() {
                assert!(!status.alive);
                assert_eq!(status.exit_code, Some(7));
                assert!(status.output_error.is_none());
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        manager
            .read_user_output(&name, 0, 1024)
            .await
            .unwrap()
            .bytes,
        b"sec"
    );
    manager.terminate_user_terminal(&name).await.unwrap();
}

#[tokio::test]
async fn expired_launch_history_never_reuses_the_old_process_handle() {
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 1;
    let launch_id = uuid::Uuid::new_v4();
    let old = launch(&manager, launch_id, "sleep 30").await;
    manager.terminate_user_terminal(&old).await.unwrap();
    let intervening = launch(&manager, uuid::Uuid::new_v4(), "sleep 30").await;
    manager.terminate_user_terminal(&intervening).await.unwrap();
    let current = launch(&manager, launch_id, "sleep 30").await;
    assert_ne!(old, current);
    assert!(manager
        .write_user_input(&old, b"exit\r", &ThreadCancellation::default())
        .await
        .is_err());
    assert!(manager
        .resize_user_terminal(&old, 91, 31, &ThreadCancellation::default())
        .await
        .is_err());
    manager.terminate_user_terminal(&old).await.unwrap();
    assert!(manager.user_terminal_status(&current).await.unwrap().alive);
    manager.terminate_user_terminal(&current).await.unwrap();
}

#[tokio::test]
async fn unread_paste_cannot_block_resize_or_process_cleanup() {
    let manager = TerminalManager::for_direct();
    let name = launch(
        &manager,
        uuid::Uuid::new_v4(),
        "stty raw -echo; printf READY; sleep 30",
    )
    .await;
    wait_for(&manager, &name, b"READY").await;
    let mut writes = Vec::new();
    for _ in 0..4 {
        let owner = manager.clone();
        let id = name.clone();
        writes.push(tokio::spawn(async move {
            owner
                .write_user_input(&id, &vec![b'x'; 16 * 1024], &ThreadCancellation::default())
                .await
        }));
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    tokio::time::timeout(
        Duration::from_secs(1),
        manager.resize_user_terminal(&name, 91, 31, &ThreadCancellation::default()),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::timeout(
        Duration::from_secs(3),
        manager.terminate_user_terminal(&name),
    )
    .await
    .unwrap()
    .unwrap();
    for write in writes {
        let _ = write.await.unwrap();
    }
    assert!(!manager.user_terminal_status(&name).await.unwrap().alive);
}
