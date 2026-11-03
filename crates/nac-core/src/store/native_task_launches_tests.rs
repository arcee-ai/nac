use super::*;
use crate::task_launch_control::TaskWorkspace;
use crate::types::Message;

fn cwd(path: &Path) -> PathBuf {
    std::fs::canonicalize(path.parent().unwrap()).unwrap()
}

fn fixture() -> (PathBuf, NativeTaskRequest) {
    let path = std::env::temp_dir()
        .join(format!("nac-native-intent-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_project(
        &path,
        NewProject {
            project_id: "p".into(),
            name: None,
            description: None,
            cwd: cwd(&path),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    insert_test_session(&path, "caller");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct',cwd=?1 WHERE session_id='caller'",
        params![cwd(&path).to_string_lossy()],
    )
    .unwrap();
    drop(conn);
    assign_session_to_project(&path, "p", "caller").unwrap();
    (
        path,
        NativeTaskRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            project_id: None,
            title: "Native task".into(),
            prompt: "Fresh handoff facts".into(),
            skill: Some("qa".into()),
            model: None,
            reasoning_effort: None,
            workspace: TaskWorkspace::Auto,
            git_ref: None,
            default_ref: None,
        },
    )
}

#[test]
fn native_intent_retry_reopens_original_identity_and_distinguishes_new_requests() {
    let (path, request) = fixture();
    let first =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .unwrap();
    assert_eq!(
        first,
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .unwrap()
    );
    assert!(reserve_native_task_launch(
        &path,
        "caller",
        "p",
        Path::new("/other"),
        false,
        request.clone()
    )
    .is_err());
    assert!(
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), true, request.clone())
            .is_err()
    );
    let mut changed = request.clone();
    changed.skill = Some("release".into());
    assert!(
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, changed)
            .unwrap_err()
            .to_string()
            .contains("conflict")
    );
    assert!(
        reserve_native_task_launch(&path, "foreign", "p", &cwd(&path), false, request.clone())
            .is_err()
    );
    let mut other = request;
    other.request_id = uuid::Uuid::new_v4().to_string();
    assert_ne!(
        first.session_id,
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, other)
            .unwrap()
            .session_id
    );
    assert!(!crate::sessions::session_exists(&path, &first.session_id).unwrap());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn native_intent_refuses_wrong_project_source_and_nonlocal_callers() {
    let (path, request) = fixture();
    assert!(reserve_native_task_launch(
        &path,
        "caller",
        "p",
        Path::new("/other"),
        false,
        request.clone()
    )
    .is_err());
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET host_id='remote' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    assert!(
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .is_err()
    );
    conn.execute(
        "UPDATE sessions SET host_id=NULL,behavior='orchestrator' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    assert!(reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request).is_err());
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn native_restart_observation_respects_live_preparation_and_never_admits_input() {
    let (path, request) = fixture();
    let launch =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request.clone())
            .unwrap();
    let lease = crate::sessions::SessionOperationLease::try_acquire(
        &path,
        &format!("native-task-launch:{}", request.request_id),
    )
    .unwrap();
    reconcile_native_task_launches(&path).unwrap();
    assert_eq!(
        load_native_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap()
            .phase,
        "reserved"
    );
    drop(lease);
    reconcile_native_task_launches(&path).unwrap();
    let observed = load_native_task_launch(&path, &request.request_id)
        .unwrap()
        .unwrap();
    assert_eq!(observed.phase, "failed");
    assert!(observed.error.unwrap().contains("restart"));
    assert!(!crate::sessions::session_exists(&path, &launch.session_id).unwrap());
    let retry =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), false, request).unwrap();
    assert_eq!(retry.session_id, launch.session_id);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

fn published_fixture(retained: bool) -> (PathBuf, NativeTaskLaunch) {
    let (path, request) = fixture();
    let launch =
        reserve_native_task_launch(&path, "caller", "p", &cwd(&path), retained, request).unwrap();
    insert_test_session(&path, &launch.session_id);
    let item = create_session_inbox_item(
        &path,
        &launch.session_id,
        InboxDelivery::Queue,
        &launch.request.initial_prompt(),
        None,
        None,
    )
    .unwrap();
    // The store projection is shared by retained and ordinary publication.
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE native_task_launches SET phase='ready',first_input_id=?2 WHERE request_id=?1",
            params![launch.request.request_id, item.id],
        )
        .unwrap();
    let launch = load_native_task_launch(&path, &launch.request.request_id)
        .unwrap()
        .unwrap();
    (path, launch)
}

#[test]
fn native_admission_error_follows_durable_delivery_despite_stale_retry_and_lost_ack() {
    use super::super::transcript_append::AppendFault;
    for retained in [false, true] {
        for generic_writer in [false, true] {
            let (path, stale_retry) = published_fixture(retained);
            let id = &stale_retry.request.request_id;
            let session = &stale_retry.session_id;
            let input_id = stale_retry.first_input_id.unwrap();
            assert!(stale_retry.error.is_none());
            let failed = if generic_writer {
                update_native_task_launch(&path, id, "failed", Some("original wake failed".into()))
            } else {
                update_native_task_admission_error(&path, id, Some("original wake failed".into()))
            }
            .unwrap();
            assert_eq!(failed.error.as_deref(), Some("original wake failed"));
            let writer = TranscriptLogWriter::new(&path).unwrap();
            let message = Message::User {
                content: stale_retry.request.initial_prompt(),
            };
            // Delivery of another item, even in this session, cannot hide the failure.
            let unrelated = create_session_inbox_item(
                &path,
                session,
                InboxDelivery::Queue,
                "unrelated",
                None,
                None,
            )
            .unwrap();
            writer
                .append_inbox_run_prompt(
                    session,
                    0,
                    &Message::User {
                        content: "unrelated".into(),
                    },
                    "unrelated-run",
                    unrelated.id,
                )
                .unwrap();
            let mut conn = open_runtime_connection(&path).unwrap();
            let tx = conn.transaction().unwrap();
            super::super::run_recovery::clear_active_run(
                &tx,
                session,
                "unrelated-run",
                RunTerminalDisposition::Completed,
            )
            .unwrap();
            tx.commit().unwrap();
            drop(conn);
            assert!(load_native_task_launch(&path, id)
                .unwrap()
                .unwrap()
                .error
                .is_some());
            // The inbox ID alone does not establish ownership of delivery.
            assert!(writer
                .append_inbox_run_prompt("caller", 0, &message, "wrong-session", input_id)
                .is_err());
            *writer.append_fault.lock().unwrap() = Some((AppendFault::BeforeCommit, 1));
            let rollback = writer
                .append_inbox_run_prompt(session, 1, &message, "native-run", input_id)
                .unwrap_err();
            assert!(
                rollback.to_string().contains("BeforeCommit"),
                "{rollback:#}"
            );
            assert_eq!(
                load_session_inbox_item(&path, session, input_id)
                    .unwrap()
                    .status,
                InboxStatus::Pending
            );
            assert!(load_native_task_launch(&path, id)
                .unwrap()
                .unwrap()
                .error
                .is_some());
            // Commit delivery but lose the acknowledgement. No resume cleanup runs:
            // the retry's earlier snapshot still has error=None.
            writer.lose_next_append_ack_for_test();
            let lost_ack = writer
                .append_inbox_run_prompt(session, 1, &message, "native-run", input_id)
                .unwrap_err();
            assert_eq!(
                lost_ack.downcast_ref::<TranscriptAppendError>(),
                Some(&TranscriptAppendError::CommitUncertain)
            );
            assert_eq!(
                load_session_inbox_item(&path, session, input_id)
                    .unwrap()
                    .status,
                InboxStatus::Delivered
            );
            drop(writer);
            initialize(&path).unwrap();
            reconcile_native_task_launches(&path).unwrap();
            let observed = load_native_task_launch(&path, id).unwrap().unwrap();
            assert!(
                observed.error.is_none(),
                "delivered input cannot report a stale wake failure: {observed:?}"
            );
            assert_eq!(observed.session_id, *session);
            assert_eq!(observed.first_input_id, Some(input_id));
            assert_eq!(observed.phase, "ready");
            // Reads derive current truth without rewriting historical diagnostics.
            let raw = || {
                open_runtime_connection(&path)
                    .unwrap()
                    .query_row::<String, _, _>(
                        "SELECT error FROM native_task_launches WHERE request_id=?1",
                        [id],
                        |r| r.get(0),
                    )
                    .unwrap()
            };
            assert_eq!(raw(), "original wake failed");
            for late in [
                update_native_task_launch(&path, id, "failed", Some("late generic failure".into()))
                    .unwrap(),
                update_native_task_admission_error(
                    &path,
                    id,
                    Some("late admission failure".into()),
                )
                .unwrap(),
            ] {
                assert!(late.error.is_none());
                assert_eq!(late.updated_at, observed.updated_at);
            }
            assert_eq!(
                raw(),
                "original wake failed",
                "late writers must not replace diagnostics after delivery"
            );
            let restarted_writer = TranscriptLogWriter::new(&path).unwrap();
            restarted_writer
                .append_inbox_run_prompt(session, 1, &message, "native-run", input_id)
                .unwrap();
            assert_eq!(restarted_writer.read_from(session, 0).unwrap().len(), 2);
            assert_eq!(list_session_inbox(&path, session).unwrap().len(), 2);
            assert_eq!(
                load_session_inbox_item(&path, session, input_id)
                    .unwrap()
                    .delivered_run_id
                    .as_deref(),
                Some("native-run")
            );
            drop(restarted_writer);
            std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
}

#[test]
fn native_admission_clear_preserves_undelivered_error_across_restart() {
    for retained in [false, true] {
        for state in [
            "pending",
            "cancelled",
            "missing",
            "foreign-delivered",
            "other-delivered",
        ] {
            let (path, launch) = published_fixture(retained);
            let id = &launch.request.request_id;
            let session = &launch.session_id;
            let input_id = launch.first_input_id.unwrap();
            update_native_task_admission_error(&path, id, Some("wake failed".into())).unwrap();
            match state {
                "cancelled" => {
                    let item = load_session_inbox_item(&path, session, input_id).unwrap();
                    cancel_pending_session_inbox_item(&path, session, input_id, item.version)
                        .unwrap();
                }
                "missing" => {
                    // Deliberately corrupt only this isolated fixture's original-input row.
                    open_runtime_connection(&path)
                        .unwrap()
                        .execute("DELETE FROM session_inbox WHERE id=?1", [input_id])
                        .unwrap();
                }
                "foreign-delivered" | "other-delivered" => {
                    let owner = if state == "foreign-delivered" {
                        "caller"
                    } else {
                        session
                    };
                    let other = create_session_inbox_item(
                        &path,
                        owner,
                        InboxDelivery::Queue,
                        "other",
                        None,
                        None,
                    )
                    .unwrap();
                    let writer = TranscriptLogWriter::new(&path).unwrap();
                    writer
                        .append_inbox_run_prompt(
                            owner,
                            0,
                            &Message::User {
                                content: "other".into(),
                            },
                            "other-run",
                            other.id,
                        )
                        .unwrap();
                    if state == "foreign-delivered" {
                        // Matching the numeric ID is insufficient without session ownership.
                        open_runtime_connection(&path).unwrap().execute(
                            "UPDATE native_task_launches SET first_input_id=?2 WHERE request_id=?1",
                            params![id, other.id],
                        ).unwrap();
                    }
                }
                "pending" => {}
                _ => unreachable!(),
            }
            let before = load_native_task_launch(&path, id).unwrap().unwrap();
            let inbox = list_session_inbox(&path, session).unwrap();
            let raw_before: (Option<String>, String) = open_runtime_connection(&path)
                .unwrap()
                .query_row(
                    "SELECT error,updated_at FROM native_task_launches WHERE request_id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(before.error.as_deref(), Some("wake failed"), "{state}");
            for restart in [false, true] {
                if restart {
                    initialize(&path).unwrap();
                    reconcile_native_task_launches(&path).unwrap();
                }
                let cleared = update_native_task_admission_error(&path, id, None).unwrap();
                assert_eq!(cleared, before, "{state}, restart={restart}");
                let raw_after: (Option<String>, String) = open_runtime_connection(&path)
                    .unwrap()
                    .query_row(
                        "SELECT error,updated_at FROM native_task_launches WHERE request_id=?1",
                        [id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .unwrap();
                assert_eq!(raw_after, raw_before);
                let current = list_session_inbox(&path, session).unwrap();
                assert_eq!(current.len(), inbox.len());
                for (actual, expected) in current.iter().zip(&inbox) {
                    assert_eq!(actual.id, expected.id);
                    assert_eq!(actual.status, expected.status);
                    assert_eq!(actual.version, expected.version);
                    assert_eq!(actual.delivered_run_id, expected.delivered_run_id);
                }
            }
            std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
}

#[test]
fn native_admission_clear_serializes_with_exact_delivery_and_late_failure() {
    for retained in [false, true] {
        for clear_first in [false, true] {
            let (path, launch) = published_fixture(retained);
            let id = &launch.request.request_id;
            let input_id = launch.first_input_id.unwrap();
            update_native_task_admission_error(&path, id, Some("wake failed".into())).unwrap();
            // Capture the retry's stale failed receipt before either operation.
            let stale = load_native_task_launch(&path, id).unwrap().unwrap();
            let (go_tx, go_rx) = std::sync::mpsc::channel();
            let (done_tx, done_rx) = std::sync::mpsc::channel();
            let delivery_path = path.clone();
            let delivery_session = launch.session_id.clone();
            let prompt = launch.request.initial_prompt();
            let delivery = std::thread::spawn(move || {
                go_rx.recv().unwrap();
                let writer = TranscriptLogWriter::new(&delivery_path).unwrap();
                writer
                    .append_inbox_run_prompt(
                        &delivery_session,
                        0,
                        &Message::User { content: prompt },
                        "native-run",
                        input_id,
                    )
                    .unwrap();
                done_tx.send(()).unwrap();
            });
            if clear_first {
                assert_eq!(
                    update_native_task_admission_error(&path, id, None).unwrap(),
                    stale
                );
            }
            go_tx.send(()).unwrap();
            done_rx.recv().unwrap();
            delivery.join().unwrap();
            let delivered = load_native_task_launch(&path, id).unwrap().unwrap();
            assert!(delivered.error.is_none());
            // A read hides stale diagnostics without mutating their stored history.
            let raw: String = open_runtime_connection(&path)
                .unwrap()
                .query_row(
                    "SELECT error FROM native_task_launches WHERE request_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(raw, "wake failed");
            let late =
                update_native_task_admission_error(&path, id, Some("late failure".into())).unwrap();
            assert!(late.error.is_none());
            assert_eq!(late.updated_at, delivered.updated_at);
            // Explicit cleanup, including from the stale receipt, is safe only now.
            let cleared = update_native_task_admission_error(&path, id, None).unwrap();
            assert!(cleared.error.is_none());
            let raw: Option<String> = open_runtime_connection(&path)
                .unwrap()
                .query_row(
                    "SELECT error FROM native_task_launches WHERE request_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(raw.is_none());
            initialize(&path).unwrap();
            reconcile_native_task_launches(&path).unwrap();
            assert!(
                update_native_task_admission_error(&path, id, Some("after restart".into()))
                    .unwrap()
                    .error
                    .is_none()
            );
            let writer = TranscriptLogWriter::new(&path).unwrap();
            writer
                .append_inbox_run_prompt(
                    &launch.session_id,
                    0,
                    &Message::User {
                        content: launch.request.initial_prompt(),
                    },
                    "native-run",
                    input_id,
                )
                .unwrap();
            assert_eq!(writer.read_from(&launch.session_id, 0).unwrap().len(), 1);
            assert_eq!(
                list_session_inbox(&path, &launch.session_id).unwrap().len(),
                1
            );
            let current = load_native_task_launch(&path, id).unwrap().unwrap();
            assert_eq!(current.session_id, stale.session_id);
            assert_eq!(current.first_input_id, stale.first_input_id);
            assert_eq!(current.phase, "ready");
            drop(writer);
            std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
}
