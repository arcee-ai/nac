use super::*;
use crate::tests::{seed_direct_session, test_manager, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use nac_core::permissions::PermissionApprovalMode;

async fn fixture() -> (
    crate::SessionManager,
    Arc<SessionService>,
    String,
    std::path::PathBuf,
) {
    let root = std::env::temp_dir().join(format!("nac-observer-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    (manager, service, terminal.id, root)
}

async fn await_output(service: &SessionService, terminal: &str, needle: &[u8]) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let page = service
                .read_user_terminal_output(terminal, 0, 64 * 1024)
                .await
                .unwrap();
            if page
                .bytes
                .windows(needle.len())
                .any(|bytes| bytes == needle)
            {
                return;
            }
            service
                .wait_for_user_terminal_output(terminal, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap();
}

fn same_frame(left: &TerminalFrame, right: &TerminalFrame) {
    assert_eq!(left.page.bytes, right.page.bytes);
    assert_eq!(left.page.offset, right.page.offset);
    assert_eq!(left.page.next_offset, right.page.next_offset);
    assert_eq!(left.page.retained_end, right.page.retained_end);
    assert_eq!(left.page.gap, right.page.gap);
    assert_eq!(
        left.terminal.output_complete,
        right.terminal.output_complete
    );
    assert_eq!(left.terminal.exit_code, right.terminal.exit_code);
}

#[tokio::test]
async fn observer_acknowledgements_preserve_pending_frames_and_independent_cursors() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-observer-home-{}", Uuid::new_v4()));
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    let (_manager, service, terminal, root) = fixture().await;
    service
        .write_user_terminal_input(&terminal, b"printf FIRST-MARKER\\n\r")
        .await
        .unwrap();
    await_output(&service, &terminal, b"FIRST-MARKER").await;
    let hub = TerminalObservationHub::default();
    let first = hub
        .attach("session", &terminal, Arc::clone(&service), 7)
        .unwrap();
    let second = hub
        .attach("session", &terminal, Arc::clone(&service), 7)
        .unwrap();
    let frame = hub
        .pull("session", &terminal, first, None, 0)
        .await
        .unwrap();
    assert_eq!(frame.page.bytes.len(), 7);
    assert!(frame.requires_ack);
    let independent = hub
        .pull("session", &terminal, second, None, 0)
        .await
        .unwrap();
    assert_eq!(frame.page.bytes, independent.page.bytes);
    assert_eq!(frame.page.offset, independent.page.offset);
    assert_eq!(frame.page.next_offset, independent.page.next_offset);
    service
        .write_user_terminal_input(&terminal, b"printf LAST-MARKER; exit 7\r")
        .await
        .unwrap();
    let completion = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = service.user_terminal_status(&terminal).await.unwrap();
            if status.output_complete && !status.alive && status.exit_code.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    if completion.is_err() {
        let status = service.user_terminal_status(&terminal).await.unwrap();
        let output = service
            .read_user_terminal_output(&terminal, 0, 65536)
            .await
            .unwrap();
        panic!(
            "EOF did not complete: alive={} exit={:?} error={:?} sanitized output={}",
            status.alive,
            status.exit_code,
            status.output_error,
            String::from_utf8_lossy(&output.bytes)
        );
    }
    // New output and EOF cannot mutate an unacknowledged earlier frame.
    same_frame(
        &frame,
        &hub.pull("session", &terminal, first, None, 0)
            .await
            .unwrap(),
    );
    for wrong in [
        RenderAcknowledgement {
            offset: frame.page.next_offset + 1,
            reset: false,
        },
        RenderAcknowledgement {
            offset: frame.page.next_offset,
            reset: true,
        },
    ] {
        assert!(matches!(
            hub.pull("session", &terminal, first, Some(wrong), 0).await,
            Err(TerminalApplicationError::Invalid(_))
        ));
    }
    let ack = RenderAcknowledgement {
        offset: frame.page.next_offset,
        reset: false,
    };
    let next = hub
        .pull("session", &terminal, first, Some(ack), 0)
        .await
        .unwrap();
    assert_eq!(next.page.offset, frame.page.next_offset);
    // A lost HTTP response is recovered by resending the previous ACK.
    same_frame(
        &next,
        &hub.pull("session", &terminal, first, Some(ack), 0)
            .await
            .unwrap(),
    );
    same_frame(
        &independent,
        &hub.pull("session", &terminal, second, None, 0)
            .await
            .unwrap(),
    );
    let mut received = frame.page.bytes;
    let mut page = next;
    loop {
        received.extend_from_slice(&page.page.bytes);
        if page.page.caught_up && page.terminal.output_complete {
            break;
        }
        assert!(page.requires_ack);
        page = hub
            .pull(
                "session",
                &terminal,
                first,
                Some(RenderAcknowledgement {
                    offset: page.page.next_offset,
                    reset: page.page.gap,
                }),
                0,
            )
            .await
            .unwrap();
    }
    assert_eq!(page.terminal.exit_code, Some(7));
    assert!(received
        .windows(b"LAST-MARKER".len())
        .any(|bytes| bytes == b"LAST-MARKER"));
    service.terminate_user_terminal(&terminal).await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn observer_capacity_expiry_scope_and_busy_requests_are_bounded() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-observer-home-{}", Uuid::new_v4()));
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    let (_manager, service, terminal, root) = fixture().await;
    let hub = TerminalObservationHub::default();
    assert!(matches!(
        hub.attach("session", &terminal, Arc::clone(&service), 0),
        Err(TerminalApplicationError::Invalid(_))
    ));
    assert!(matches!(
        hub.attach("session", &terminal, Arc::clone(&service), 65537),
        Err(TerminalApplicationError::Invalid(_))
    ));
    let id = hub
        .attach("session", &terminal, Arc::clone(&service), 1)
        .unwrap();
    for _ in 1..MAX_TERMINAL_OBSERVERS {
        hub.attach("session", &terminal, Arc::clone(&service), 1)
            .unwrap();
    }
    assert!(matches!(
        hub.attach("session", &terminal, Arc::clone(&service), 1),
        Err(TerminalApplicationError::Busy)
    ));
    // Admission has validated these identities before the hub receives them;
    // distinct opaque owners test the independent host-wide seat budget.
    for index in MAX_TERMINAL_OBSERVERS..MAX_OBSERVERS {
        hub.attach(
            &format!("owner-{index}"),
            &terminal,
            Arc::clone(&service),
            1,
        )
        .unwrap();
    }
    assert!(matches!(
        hub.attach("another", &terminal, Arc::clone(&service), 1),
        Err(TerminalApplicationError::Busy)
    ));
    for (session, name) in [
        ("foreign", terminal.as_str()),
        ("session", "foreign-terminal"),
    ] {
        assert!(matches!(
            hub.pull(session, name, id, None, 0).await,
            Err(TerminalApplicationError::Unavailable)
        ));
        hub.detach(session, name, id);
    }
    let observer = Arc::clone(&hub.seats.lock().unwrap().get(&id).unwrap().observer);
    let held = observer.state.lock().await;
    assert!(matches!(
        hub.pull("session", &terminal, id, None, 0).await,
        Err(TerminalApplicationError::Busy)
    ));
    drop(held);
    hub.seats.lock().unwrap().get_mut(&id).unwrap().last_used = Instant::now() - OBSERVER_IDLE_TTL;
    assert!(matches!(
        hub.pull("session", &terminal, id, None, 0).await,
        Err(TerminalApplicationError::Unavailable)
    ));
    assert!(hub
        .attach("replacement", &terminal, Arc::clone(&service), 1)
        .is_ok());
    assert!(!hub.seats.lock().unwrap().contains_key(&id));
    let restarted = TerminalObservationHub::default();
    assert!(matches!(
        restarted.pull("session", &terminal, id, None, 0).await,
        Err(TerminalApplicationError::Unavailable)
    ));
    service.terminate_user_terminal(&terminal).await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn observer_gap_requires_reset_before_replaying_retained_tail() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-observer-home-{}", Uuid::new_v4()));
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    let (_manager, service, terminal, root) = fixture().await;
    // Direct sessions retain the established default 8 MiB command budget.
    // Exercise its real eviction path rather than inventing an observer gap.
    let count = 9 * 1024 * 1024;
    service
        .write_user_terminal_input(
            &terminal,
            format!("printf '%{count}s' '' | tr ' ' Z; exit 0\r").as_bytes(),
        )
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !service
            .user_terminal_status(&terminal)
            .await
            .unwrap()
            .output_complete
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let hub = TerminalObservationHub::default();
    let id = hub
        .attach("session", &terminal, Arc::clone(&service), 1024)
        .unwrap();
    let gap = hub.pull("session", &terminal, id, None, 0).await.unwrap();
    assert!(
        gap.page.gap,
        "expected retained gap start={} end={} output={}",
        gap.page.retained_start,
        gap.page.retained_end,
        String::from_utf8_lossy(&gap.page.bytes)
    );
    assert!(gap.page.bytes.is_empty());
    assert!(gap.requires_ack);
    assert!(gap.page.retained_start > 0);
    assert!(matches!(
        hub.pull(
            "session",
            &terminal,
            id,
            Some(RenderAcknowledgement {
                offset: gap.page.next_offset,
                reset: false,
            }),
            0
        )
        .await,
        Err(TerminalApplicationError::Invalid(_))
    ));
    same_frame(
        &gap,
        &hub.pull("session", &terminal, id, None, 0).await.unwrap(),
    );
    let tail = hub
        .pull(
            "session",
            &terminal,
            id,
            Some(RenderAcknowledgement {
                offset: gap.page.next_offset,
                reset: true,
            }),
            0,
        )
        .await
        .unwrap();
    assert!(!tail.page.gap);
    assert_eq!(tail.page.offset, gap.page.retained_start);
    assert_eq!(tail.page.bytes.len(), 1024);
    assert!(tail.page.bytes.iter().all(|byte| *byte == b'Z'));
    assert!(tail.terminal.output_complete);
    service.terminate_user_terminal(&terminal).await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn two_native_owners_and_slow_observers_keep_cached_status_and_close_responsive() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-observer-home-{}", Uuid::new_v4()));
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    let (_manager, service, first, root) = fixture().await;
    let second = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap()
        .id;
    let hub = Arc::new(TerminalObservationHub::default());
    let terminals = [first, second];
    let mut ids = Vec::new();
    for terminal in &terminals {
        // Finish the entire setup line before observation. Modern Readline
        // emits bracketed-paste mode bytes even for an empty prompt; turn
        // those off only in this deliberately quiet fixture.
        service
            .write_user_terminal_input(
                terminal,
                b"stty -echo -onlcr; PS1=; PROMPT_COMMAND=; bind 'set enable-bracketed-paste off' 2>/dev/null; printf '\\121\\125\\111\\105\\124\\055\\122\\105\\101\\104\\131\\n'\r",
            )
            .await
            .unwrap();
        await_output(&service, terminal, b"QUIET-READY\n").await;
        let id = hub
            .attach("session", terminal, Arc::clone(&service), 64 * 1024)
            .unwrap();
        let mut ack = None;
        loop {
            let frame = hub.pull("session", terminal, id, ack, 0).await.unwrap();
            if !frame.requires_ack {
                break;
            }
            ack = Some(RenderAcknowledgement {
                offset: frame.page.next_offset,
                reset: frame.page.gap,
            });
        }
        ids.push(id);
    }
    let mut pulls = Vec::new();
    for (terminal, id) in terminals.iter().zip(&ids) {
        let hub = Arc::clone(&hub);
        let terminal = terminal.clone();
        let id = *id;
        pulls.push(tokio::spawn(async move {
            hub.pull("session", &terminal, id, None, 1000).await
        }));
    }
    let observers = ids
        .iter()
        .map(|id| Arc::clone(&hub.seats.lock().unwrap()[id].observer))
        .collect::<Vec<_>>();
    tokio::time::timeout(Duration::from_millis(250), async {
        loop {
            if observers
                .iter()
                .all(|observer| observer.state.try_lock().is_err())
            {
                break;
            }
            if let Some(index) = pulls.iter().position(|pull| pull.is_finished()) {
                let frame = (&mut pulls[index]).await.unwrap().unwrap();
                panic!(
                    "quiet observer {index} completed before both waits: bytes={} gap={} alive={} EOF={} exit={:?} newline_only={} paste_toggle={}",
                    frame.page.bytes.len(),
                    frame.page.gap,
                    frame.terminal.alive,
                    frame.terminal.output_complete,
                    frame.terminal.exit_code,
                    frame.page.bytes.iter().all(|byte| matches!(byte, b'\r' | b'\n')),
                    frame.page.bytes.windows(7).any(|bytes| bytes == b"\x1b[?2004")
                );
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("both observers should independently enter their output waits");
    let snapshot_started = Instant::now();
    tokio::time::timeout(Duration::from_millis(250), async {
        assert!(matches!(
            hub.pull("session", &terminals[0], ids[0], None, 0).await,
            Err(TerminalApplicationError::Busy)
        ));
        assert_eq!(service.list_user_terminals().await.unwrap().len(), 2);
        for terminal in &terminals {
            assert!(service.user_terminal_status(terminal).await.unwrap().alive);
        }
    })
    .await
    .expect("cached snapshots and duplicate pull must not queue behind slow observers");
    let snapshot_elapsed = snapshot_started.elapsed();
    let close_started = Instant::now();
    tokio::time::timeout(
        Duration::from_secs(1),
        service.terminate_user_terminal(&terminals[0]),
    )
    .await
    .expect("native close must not wait behind either observer")
    .unwrap();
    let close_elapsed = close_started.elapsed();
    service
        .terminate_user_terminal(&terminals[1])
        .await
        .unwrap();
    for pull in pulls {
        let frame = tokio::time::timeout(Duration::from_secs(1), pull)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(!frame.requires_ack);
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let mut complete = true;
            for terminal in &terminals {
                let status = service.user_terminal_status(terminal).await.unwrap();
                complete &= status.output_complete && !status.alive && status.exit_code.is_some();
            }
            if complete {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("both native owners and their output collectors must settle after close");
    eprintln!("two native owners: cached snapshots={snapshot_elapsed:?}, close={close_elapsed:?}");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn execution_pending_receipt_replays_after_source_expiry_but_new_pages_remain_opaque() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-pending-execution-{}", Uuid::new_v4()));
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    std::fs::create_dir_all(&root).unwrap();
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .write_user_terminal_input(&terminal.id, b"printf pending\\n\n")
        .await
        .unwrap();
    let (observer, _) = manager
        .session_terminals()
        .attach_execution("session", &terminal.id, 2)
        .await
        .unwrap();
    let hub = &manager.inner.terminal_observations;
    let frame = hub
        .pull("session", &terminal.id, observer, None, 1000)
        .await
        .unwrap();
    assert!(frame.requires_ack);
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    // Expire the exact source handle through existing bounded completed-PTY
    // history, without altering observer seats or creating any model runs.
    for _ in 0..16 {
        let shell = service
            .open_user_terminal(Uuid::new_v4(), 80, 24)
            .await
            .unwrap();
        service.terminate_user_terminal(&shell.id).await.unwrap();
    }
    assert!(service.execution_status(&terminal.id).await.is_err());
    assert!(matches!(
        manager
            .session_terminals()
            .attach_execution("session", &terminal.id, 2)
            .await,
        Err(TerminalApplicationError::Unavailable)
    ));
    let replay = manager
        .session_terminals()
        .pull_execution("session", &terminal.id, observer, None, 0)
        .await
        .unwrap();
    same_frame(&frame, &replay);
    let ack = RenderAcknowledgement {
        offset: frame.page.next_offset,
        reset: frame.page.gap,
    };
    assert!(matches!(
        hub.pull("session", &terminal.id, observer, Some(ack), 0)
            .await,
        Err(TerminalApplicationError::Unavailable)
    ));
    assert!(matches!(
        hub.pull("session", &terminal.id, observer, Some(ack), 0)
            .await,
        Err(TerminalApplicationError::Unavailable)
    ));
    let seat = hub
        .seats
        .lock()
        .unwrap()
        .get(&observer)
        .unwrap()
        .observer
        .clone();
    let state = seat.state.lock().await;
    assert!(state.pending.is_none());
    assert_eq!(state.cursor, ack.offset);
    assert!(state.last_ack == Some(ack));
    drop(state);
    hub.detach("session", &terminal.id, observer);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn execution_pending_frame_is_rejected_when_cached_owner_is_replaced() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-replaced-execution-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let original = manager.attach_session("session").await.unwrap();
    let terminal = original
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    original
        .write_user_terminal_input(&terminal.id, b"printf replacement\\n\n")
        .await
        .unwrap();
    let (observer, _) = manager
        .session_terminals()
        .attach_execution("session", &terminal.id, 2)
        .await
        .unwrap();
    let frame = manager
        .session_terminals()
        .pull_execution("session", &terminal.id, observer, None, 1000)
        .await
        .unwrap();
    assert!(frame.requires_ack);
    original
        .terminate_user_terminal(&terminal.id)
        .await
        .unwrap();
    // Rebuild through ordinary construction while the old observer still owns
    // its immutable page and service clone. The view itself never reconstructs.
    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove("session");
    let replacement = manager.attach_session("session").await.unwrap();
    assert!(!Arc::ptr_eq(&original, &replacement));
    assert!(matches!(
        manager
            .session_terminals()
            .pull_execution("session", &terminal.id, observer, None, 0)
            .await,
        Err(TerminalApplicationError::Unavailable)
    ));
    assert!(matches!(
        manager
            .session_terminals()
            .pull_execution(
                "session",
                &terminal.id,
                observer,
                Some(RenderAcknowledgement {
                    offset: frame.page.next_offset,
                    reset: frame.page.gap
                }),
                0
            )
            .await,
        Err(TerminalApplicationError::Unavailable)
    ));
    manager
        .inner
        .terminal_observations
        .detach("session", &terminal.id, observer);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn cached_terminal_views_validate_unknown_ids_without_allocating_or_attaching() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-cached-view-home-{}", Uuid::new_v4()));
    let _env = ScopedModelEnv::isolated(&home, Some("server-test-key"));
    let (manager, service, terminal, root) = fixture().await;
    let oversized = "x".repeat(121);
    // Even a corrupt cached key cannot bypass the existing identity bound.
    manager
        .inner
        .active_sessions
        .write()
        .await
        .insert(oversized.clone(), Arc::clone(&service));
    let gates = manager.inner.lifecycle_gates.lock().unwrap().len();
    for id in ["", "missing", oversized.as_str()] {
        assert!(manager
            .session_terminals()
            .cached_user_service(id)
            .await
            .is_err());
    }
    assert_eq!(manager.inner.lifecycle_gates.lock().unwrap().len(), gates);
    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove(&oversized);

    seed_direct_session(&root, "detached");
    assert!(manager
        .session_terminals()
        .cached_user_service("detached")
        .await
        .unwrap()
        .is_none());
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("detached"));
    service.terminate_user_terminal(&terminal).await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn cached_terminal_view_rechecks_persisted_existence() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-deleted-view-home-{}", Uuid::new_v4()));
    let _env = ScopedModelEnv::isolated(&home, Some("server-test-key"));
    let (manager, service, terminal, root) = fixture().await;
    service.terminate_user_terminal(&terminal).await.unwrap();
    assert!(manager
        .session_terminals()
        .cached_user_service("session")
        .await
        .unwrap()
        .is_some());
    // Leave the process-local owner cached while deleting its durable row.
    nac_core::sessions::delete_session(&root.join("store.db"), "session").unwrap();
    assert!(manager
        .session_terminals()
        .cached_user_service("session")
        .await
        .is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn cached_terminal_view_rechecks_configuration_before_replaying_a_receipt() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let home = std::env::temp_dir().join(format!("nac-config-view-home-{}", Uuid::new_v4()));
    let _env = ScopedModelEnv::isolated(&home, Some("server-test-key"));
    let (manager, service, terminal, root) = fixture().await;
    service
        .write_user_terminal_input(&terminal, b"printf receipt\\n\r")
        .await
        .unwrap();
    let (observer, _) = manager
        .session_terminals()
        .attach_execution("session", &terminal, 2)
        .await
        .unwrap();
    let frame = manager
        .session_terminals()
        .pull_execution("session", &terminal, observer, None, 1000)
        .await
        .unwrap();
    assert!(frame.requires_ack);
    service.terminate_user_terminal(&terminal).await.unwrap();
    // An external configuration revision must fence an otherwise cached owner.
    let config =
        nac_core::sessions::load_session_config(&root.join("store.db"), "session").unwrap();
    nac_core::sessions::update_raw_session_config(&root.join("store.db"), &config).unwrap();
    assert!(matches!(
        manager
            .session_terminals()
            .pull_execution("session", &terminal, observer, None, 0)
            .await,
        Err(TerminalApplicationError::Unavailable)
    ));
    manager
        .inner
        .terminal_observations
        .detach("session", &terminal, observer);
    std::fs::remove_dir_all(root).unwrap();
}
