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
        while !service
            .user_terminal_status(&terminal)
            .await
            .unwrap()
            .output_complete
        {
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
