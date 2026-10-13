//! Real Local PTY lifetime regressions, with exact-identity fixture teardown.
use super::*;

struct Jobs(Vec<nac_process::NativePtyTestIdentity>);

impl Drop for Jobs {
    fn drop(&mut self) {
        for job in &mut self.0 {
            let _ = job.kill();
        }
    }
}

struct FinishHold(crate::terminal::collector::CollectorState);

impl Drop for FinishHold {
    fn drop(&mut self) {
        self.0.hold_finish_for_test(false);
    }
}

fn directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!("nac-native-pty-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

async fn launch_in(
    manager: &TerminalManager,
    directory: &std::path::Path,
    command: &str,
) -> String {
    let name = manager.user_terminal_name(uuid::Uuid::new_v4());
    manager
        .create_user_terminal(
            name.clone(),
            command,
            directory.to_owned(),
            80,
            24,
            &backend(),
            nac_contracts::CommandEnvironmentSnapshot::from_parts(
                std::collections::BTreeMap::from([(
                    "HOME".into(),
                    directory.display().to_string(),
                )]),
                Vec::new(),
            ),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    name
}

async fn separate_jobs(manager: &TerminalManager, name: &str) -> Jobs {
    let leader = manager
        .sessions
        .lock()
        .await
        .get(name)
        .unwrap()
        .pid()
        .unwrap();
    // SAFETY: these are read-only OS queries for our still-owned child.
    assert_eq!(
        unsafe { libc::getsid(leader as libc::pid_t) },
        leader as libc::pid_t
    );
    manager
        .write_user_input(name, b"set +H\r", &ThreadCancellation::default())
        .await
        .unwrap();
    manager.write_user_input(name, b"/bin/sleep 120 & ordinary=$!; (trap '' HUP; exec /bin/sleep 120) & detached=$!; disown %2; printf 'JOBS:%s:%s\\n' $ordinary $detached\r", &ThreadCancellation::default()).await.unwrap();
    let pids = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = manager.read_user_output(name, 0, 65536).await.unwrap();
            if let Some(pids) = String::from_utf8_lossy(&page.bytes)
                .lines()
                .find_map(|line| {
                    let (first, second) = line.strip_prefix("JOBS:")?.trim().split_once(':')?;
                    Some([first.parse::<u32>().ok()?, second.parse::<u32>().ok()?])
                })
            {
                break pids;
            }
            manager
                .wait_user_output(name, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap();
    let mut jobs = Jobs(Vec::new());
    for pid in pids {
        jobs.0.push(
            nac_process::NativePtyTestIdentity::capture(pid)
                .unwrap()
                .unwrap(),
        );
        // SAFETY: read-only geometry of a captured disposable fixture identity.
        assert_eq!(
            unsafe { libc::getsid(pid as libc::pid_t) },
            leader as libc::pid_t
        );
        // SAFETY: read-only process group query; no signal targets a raw ID.
        assert_ne!(
            unsafe { libc::getpgid(pid as libc::pid_t) },
            leader as libc::pid_t
        );
    }
    jobs
}

async fn settled(
    manager: &TerminalManager,
    name: &str,
    jobs: &Jobs,
) -> crate::terminal::UserTerminalStatus {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = manager.user_terminal_status(name).await.unwrap();
            if !status.alive && status.exit_code.is_some() && status.output_complete {
                assert!(
                    jobs.0.iter().all(|job| !job.is_alive().unwrap()),
                    "settled terminal must not leave a captured job live"
                );
                return status;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn natural_exit_settles_ordinary_and_disowned_separate_groups() {
    let directory = directory();
    let manager = TerminalManager::for_direct();
    let name = launch_in(&manager, &directory, "exec /bin/bash --noprofile --norc -i").await;
    let jobs = separate_jobs(&manager, &name).await;
    manager
        .write_user_input(&name, b"exit 7\r", &ThreadCancellation::default())
        .await
        .unwrap();
    assert_eq!(settled(&manager, &name, &jobs).await.exit_code, Some(7));
    assert!(manager.live_terminal_names().is_empty());
    manager.terminate_user_terminal(&name).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn explicit_close_and_manager_drop_settle_separate_groups() {
    for drop_manager in [false, true] {
        let directory = directory();
        let manager = TerminalManager::for_direct();
        let name = launch_in(&manager, &directory, "exec /bin/bash --noprofile --norc -i").await;
        let jobs = separate_jobs(&manager, &name).await;
        if drop_manager {
            drop(manager);
            tokio::time::timeout(Duration::from_secs(5), async {
                while jobs.0.iter().any(|job| job.is_alive().unwrap()) {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
        } else {
            manager.terminate_user_terminal(&name).await.unwrap();
            settled(&manager, &name, &jobs).await;
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[tokio::test]
async fn immediate_exit_remains_owned_until_cleanup_and_output_settle() {
    let directory = directory();
    let manager = TerminalManager::for_direct();
    for _ in 0..16 {
        let name = launch_in(&manager, &directory, "printf final; exit 9").await;
        assert_eq!(
            settled(&manager, &name, &Jobs(Vec::new())).await.exit_code,
            Some(9)
        );
        assert_eq!(
            manager
                .read_user_output(&name, 0, 1024)
                .await
                .unwrap()
                .bytes,
            b"final"
        );
    }
    manager.remove_all().await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn failed_cleanup_preserves_capacity_leases_and_responsive_cached_observation() {
    let directory = directory();
    let store = directory.join("store.db");
    crate::store::initialize(&store).unwrap();
    let workspace = crate::workspace::GitTarget::local(directory.clone()).lease_identity();
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 1;
    manager.configure_workspace_authority(store.clone(), workspace.clone());
    manager.configure_session_resource_authority(store.clone(), "native-session".into());
    let name = launch_in(&manager, &directory, "printf final; sleep 0.2; exit 7").await;
    let owner = manager
        .sessions
        .lock()
        .await
        .get(&name)
        .unwrap()
        .native_owner()
        .unwrap()
        .clone();
    owner.set_inspection_failure_for_test(true);
    tokio::time::timeout(Duration::from_secs(2), async {
        while owner.snapshot().error.is_none() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        while !manager
            .user_terminal_status(&name)
            .await
            .unwrap()
            .output_complete
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let close = tokio::spawn({
        let manager = manager.clone();
        let name = name.clone();
        async move { manager.terminate_user_terminal(&name).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(manager
        .write_user_input(&name, b"echo forbidden\r", &ThreadCancellation::default())
        .await
        .is_err());
    assert!(manager
        .resize_user_terminal(&name, 91, 31, &ThreadCancellation::default())
        .await
        .is_err());
    tokio::time::timeout(Duration::from_millis(500), async {
        let status = manager.user_terminal_status(&name).await.unwrap();
        assert!(status.alive && status.exit_code.is_none() && status.output_complete);
        assert!(status.output_error.is_none());
        assert_eq!(
            manager
                .read_user_output(&name, 0, 1024)
                .await
                .unwrap()
                .bytes,
            b"final"
        );
        manager.wait_user_output(&name, 5, 1000).await.unwrap();
        assert_eq!(manager.live_terminal_names(), vec![name.clone()]);
    })
    .await
    .unwrap();
    assert!(manager
        .create_user_terminal(
            manager.user_terminal_name(uuid::Uuid::new_v4()),
            "true",
            directory.clone(),
            80,
            24,
            &backend(),
            nac_contracts::CommandEnvironmentSnapshot::empty(),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .is_err());
    close.abort();
    let _ = close.await;
    assert!(manager.terminate_user_terminal(&name).await.is_err());
    assert!(crate::sessions::WorkspaceMutationLease::try_acquire(&store, &workspace).is_err());
    assert!(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store, "native-session")
            .is_err()
    );
    drop(manager);
    // The direct-child adapter, not the discarded manager, now retains leases.
    assert!(crate::sessions::WorkspaceMutationLease::try_acquire(&store, &workspace).is_err());
    assert!(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store, "native-session")
            .is_err()
    );
    owner.set_inspection_failure_for_test(false);
    owner.terminate().await.unwrap();
    drop(crate::sessions::WorkspaceMutationLease::try_acquire(&store, &workspace).unwrap());
    drop(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store, "native-session")
            .unwrap(),
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn close_is_prompt_but_output_drain_retains_entry_and_leases_until_final_append() {
    let directory = directory();
    let store = directory.join("store.db");
    crate::store::initialize(&store).unwrap();
    let workspace = crate::workspace::GitTarget::local(directory.clone()).lease_identity();
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 2;
    manager.configure_workspace_authority(store.clone(), workspace.clone());
    manager.configure_session_resource_authority(store.clone(), "native-drain".into());
    let marker = directory.join("ready");
    let command = format!(
        "printf sec; printf READY > '{}'; sleep 120",
        marker.display()
    );
    let name = launch(&manager, uuid::Uuid::new_v4(), &command).await;
    let state = manager
        .sessions
        .lock()
        .await
        .get(&name)
        .unwrap()
        .collector_state();
    state.hold_finish_for_test(true);
    let hold = FinishHold(state);
    tokio::time::timeout(Duration::from_secs(2), async {
        while !marker.exists() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::timeout(
        Duration::from_secs(1),
        manager.terminate_user_terminal(&name),
    )
    .await
    .unwrap()
    .unwrap();
    let status = manager.user_terminal_status(&name).await.unwrap();
    assert!(!status.alive && status.exit_code.is_some() && !status.output_complete);
    assert!(status.output_error.is_none());
    assert_eq!(manager.live_terminal_names(), vec![name.clone()]);
    // No output was appended: "sec" remains in the redactor behind held EOF.
    // The ownership change still wakes a wait registered after prompt close.
    tokio::time::timeout(
        Duration::from_millis(100),
        manager.wait_user_output(&name, 0, 1000),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(crate::sessions::WorkspaceMutationLease::try_acquire(&store, &workspace).is_err());
    assert!(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store, "native-drain").is_err()
    );
    let other = launch_in(&manager, &directory, "stty -echo; printf OTHER; sleep 120").await;
    tokio::time::timeout(Duration::from_millis(500), async {
        wait_for(&manager, &other, b"OTHER").await;
        manager
            .resize_user_terminal(&other, 91, 31, &ThreadCancellation::default())
            .await
            .unwrap();
        manager.read_user_output(&name, 0, 1024).await.unwrap();
        manager.terminate_user_terminal(&name).await.unwrap();
    })
    .await
    .unwrap();
    let error = manager.remove_all().await.unwrap_err();
    assert!(error
        .to_string()
        .contains("output drain remains incomplete"));
    assert!(manager.sessions.lock().await.contains_key(&name));
    assert!(
        !manager
            .user_terminal_status(&name)
            .await
            .unwrap()
            .output_complete
    );
    drop(hold);
    tokio::time::timeout(Duration::from_secs(2), async {
        while !manager
            .user_terminal_status(&name)
            .await
            .unwrap()
            .output_complete
        {
            manager.wait_user_output(&name, 0, 1000).await.unwrap();
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
    manager.remove_all().await.unwrap();
    drop(crate::sessions::WorkspaceMutationLease::try_acquire(&store, &workspace).unwrap());
    drop(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store, "native-drain").unwrap(),
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn concurrent_admission_never_holds_observation_map_while_waiting_for_history() {
    let directory = directory();
    let manager = TerminalManager::for_direct();
    let first = launch_in(&manager, &directory, "sleep 120").await;
    let history = manager.completed_sessions.lock().await;
    let backend = backend();
    let cancellation = ThreadCancellation::default();
    let next = manager.user_terminal_name(uuid::Uuid::new_v4());
    let admission = manager.create_user_terminal(
        next.clone(),
        "sleep 120",
        directory.clone(),
        80,
        24,
        &backend,
        nac_contracts::CommandEnvironmentSnapshot::empty(),
        None,
        &cancellation,
    );
    tokio::pin!(admission);
    tokio::select! {
        result = &mut admission => panic!("admission crossed held history barrier: {result:?}"),
        _ = tokio::time::sleep(Duration::from_millis(10)) => {}
    }
    // Admission is now suspended at the held history barrier. A status reader
    // can hold history then acquire the map without opposing lock order.
    assert!(
        manager.sessions.try_lock().is_ok(),
        "admission retained observation map across history wait"
    );
    drop(history);
    tokio::time::timeout(Duration::from_secs(1), admission)
        .await
        .unwrap()
        .unwrap();
    assert!(manager.user_terminal_status(&first).await.unwrap().alive);
    assert!(manager.user_terminal_status(&next).await.unwrap().alive);
    manager.remove_all().await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}
