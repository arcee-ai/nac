use super::*;

fn fixture() -> (PathBuf, WorkerDispatchIdentity) {
    let path = std::env::temp_dir()
        .join(format!("nac-worker-receipt-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "session");
    let identity =
        admit_worker_dispatch(&path, "session", "worker", "dispatch", None, "action").unwrap();
    (path, identity)
}

#[test]
fn worker_commit_replay_is_exact_and_generation_fenced() {
    let (path, identity) = fixture();
    let id = commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).unwrap();
    assert_eq!(
        commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).unwrap(),
        id
    );
    assert!(commit_worker_episode(&path, &identity, "changed", EpisodeStatus::Ok).is_err());
    assert!(commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Error).is_err());
    for changed in [
        WorkerDispatchIdentity {
            session_id: "other".into(),
            ..identity.clone()
        },
        WorkerDispatchIdentity {
            thread_name: "other".into(),
            ..identity.clone()
        },
        WorkerDispatchIdentity {
            dispatch_id: "other".into(),
            ..identity.clone()
        },
        WorkerDispatchIdentity {
            generation: 2,
            ..identity.clone()
        },
        WorkerDispatchIdentity {
            run_id: Some("other".into()),
            ..identity.clone()
        },
    ] {
        assert!(commit_worker_episode(&path, &changed, "answer", EpisodeStatus::Ok).is_err());
    }
    let next =
        admit_worker_dispatch(&path, "session", "worker", "next", None, "next action").unwrap();
    assert_eq!(next.generation, identity.generation + 1);
    assert!(commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).is_err());
    commit_worker_episode(&path, &next, "new answer", EpisodeStatus::Ok).unwrap();
    assert_eq!(thread_read(&path, "session", "worker").unwrap().len(), 2);
    delete_thread(&path, "session", "worker").unwrap();
    assert!(commit_worker_episode(&path, &next, "new answer", EpisodeStatus::Ok).is_err());
    assert!(thread_read(&path, "session", "worker").unwrap().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn worker_commit_failure_rolls_back_episode_and_receipt() {
    let (path, identity) = fixture();
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_receipt BEFORE UPDATE ON worker_dispatches BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;").unwrap();
    assert!(commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).is_err());
    assert!(!worker_dispatch_committed(&path, "dispatch").unwrap());
    assert!(thread_dispatches(&path, "session", "worker")
        .unwrap()
        .is_empty());
    conn.execute_batch("DROP TRIGGER reject_receipt").unwrap();
    commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).unwrap();
    assert_eq!(thread_read(&path, "session", "worker").unwrap().len(), 1);
    drop(conn);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn worker_pending_commit_rejects_replaced_or_terminal_session_run() {
    let (path, identity) = fixture();
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute("INSERT INTO thread_events (id, session_id, thread_name, event_json, created_at) VALUES (1, 'session', '__orchestrator__', '{}', 'now')", []).unwrap();
    conn.execute("INSERT INTO session_run_recovery (session_id, run_id, submitted_message_id, status) VALUES ('session', 'new-run', 1, 'active')", []).unwrap();
    assert!(commit_worker_episode(&path, &identity, "stale", EpisodeStatus::Ok).is_err());
    let new = admit_worker_dispatch(
        &path,
        "session",
        "worker",
        "next",
        Some("new-run"),
        "action",
    )
    .unwrap();
    conn.execute(
        "UPDATE session_run_recovery SET status = 'interrupted' WHERE session_id = 'session'",
        [],
    )
    .unwrap();
    assert!(commit_worker_episode(&path, &new, "stale", EpisodeStatus::Ok).is_err());
    assert!(thread_dispatches(&path, "session", "worker")
        .unwrap()
        .is_empty());
    drop(conn);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn worker_receipt_migration_v30_to_current_preserves_episode_and_transcript_receipts() {
    let (path, _) = fixture();
    append_episode(&path, "session", "old", "legacy", "retained").unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let message = crate::types::Message::User {
        content: "retained transcript".into(),
    };
    writer.append("session", 0, &message).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    let receipt_before: String = conn
        .query_row(
            "SELECT digest FROM transcript_append_receipts WHERE session_id = 'session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    conn.execute_batch("DROP TABLE worker_dispatches; PRAGMA user_version=30;")
        .unwrap();
    drop(conn);
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        schema_version()
    );
    let receipt_after: String = conn
        .query_row(
            "SELECT digest FROM transcript_append_receipts WHERE session_id = 'session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(receipt_before, receipt_after);
    assert_eq!(
        serde_json::to_string(&writer.read_from("session", 0).unwrap()[0].1).unwrap(),
        serde_json::to_string(&message).unwrap()
    );
    writer.append("session", 0, &message).unwrap();
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 1);
    drop(conn);
    assert_eq!(
        thread_read(&path, "session", "old").unwrap()[0].content,
        "retained"
    );
    let identity = admit_worker_dispatch(&path, "session", "new", "new", None, "new").unwrap();
    commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn worker_context_requires_host_initialized_schema_without_creating_or_migrating() {
    let root = std::env::temp_dir().join(format!("nac-worker-read-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    assert!(load_worker_context(&path, "session", "worker", &[]).is_err());
    assert!(
        !root.exists(),
        "worker read cannot initialize a missing store"
    );
    initialize(&path).unwrap();
    insert_test_session(&path, "session");
    let conn = open_runtime_connection(&path).unwrap();
    conn.pragma_update(None, "user_version", schema_version() - 1)
        .unwrap();
    assert!(load_worker_context(&path, "session", "worker", &[]).is_err());
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        schema_version() - 1
    );
    drop(conn);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "current_thread")]
async fn required_prefix_failure_cannot_commit_success_after_reload() {
    for overloaded in [false, true] {
        let (path, identity) = fixture();
        append_thread_event(
            &path,
            "session",
            "worker",
            r#"{"type":"thread_started","name":"worker","action":"action","source_threads":[]}"#,
        )
        .unwrap();
        require_worker_history(&path, &identity).unwrap();
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_prefix BEFORE INSERT ON thread_events WHEN json_extract(NEW.event_json, '$.type') = 'run_started' BEGIN SELECT RAISE(ABORT, 'injected prefix failure'); END;").unwrap();
        drop(conn);
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let sink =
            crate::events::EventSink::bus(crate::events::SessionEventBus::with_thread_event_store(
                Some("session".into()),
                path.clone(),
            ));
        let saturation = overloaded.then(crate::store::reject_callers_for_test);
        let error = sink
            .try_emit_async(crate::events::AgentEvent::RunStarted {
                thread_name: Some("worker".into()),
                prompt_preview: "work".into(),
            })
            .await
            .unwrap_err();
        if overloaded {
            assert_eq!(
                error.downcast_ref::<crate::store::PersistenceAdmissionError>(),
                Some(&crate::store::PersistenceAdmissionError::CallerOverloaded)
            );
        } else {
            assert!(format!("{error:#}").contains("injected prefix failure"));
        }
        drop(saturation);
        owner.shutdown().await.unwrap();
        drop(owner);
        // Restart permits subsequent commands; it does not manufacture the lost prefix.
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute_batch("DROP TRIGGER reject_prefix").unwrap();
        drop(conn);
        let owner = StoreCoordinator::acquire(&path).unwrap();
        owner.append_thread_event("session".into(), "worker".into(), r#"{"type":"assistant_message","thread_name":"worker","content":"answer","tool_calls":[],"usage":null}"#.into()).await.unwrap();
        let command_identity = identity.clone();
        let command_path = path.clone();
        let error = crate::store::spawn_blocking_store_caller(move || {
            commit_worker_episode(
                &command_path,
                &command_identity,
                "answer",
                EpisodeStatus::Ok,
            )
        })
        .await
        .unwrap()
        .unwrap_err();
        assert!(format!("{error:#}").contains("required durable prefix is incomplete"));
        let command_identity = identity.clone();
        let command_path = path.clone();
        crate::store::spawn_blocking_store_caller(move || {
            commit_worker_episode(
                &command_path,
                &command_identity,
                "Required worker history incomplete",
                EpisodeStatus::Error,
            )
        })
        .await
        .unwrap()
        .unwrap();
        owner.shutdown().await.unwrap();
        drop(owner);
        assert!(!worker_dispatch_committed(&path, &identity.dispatch_id).unwrap());
        let episodes = thread_dispatches(&path, "session", "worker").unwrap();
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].status, EpisodeStatus::Error.as_str());
        assert!(commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[test]
fn required_prefix_is_scoped_to_exact_dispatch_generation() {
    let (path, first) = fixture();
    append_thread_event(&path, "session", "worker", r#"{"type":"thread_started"}"#).unwrap();
    require_worker_history(&path, &first).unwrap();
    append_thread_event(&path, "session", "worker", r#"{"type":"run_started"}"#).unwrap();
    append_thread_event(
        &path,
        "session",
        "worker",
        r#"{"type":"assistant_message"}"#,
    )
    .unwrap();
    commit_worker_episode(&path, &first, "first", EpisodeStatus::Ok).unwrap();
    let next = admit_worker_dispatch(&path, "session", "worker", "next", None, "next").unwrap();
    append_thread_event(&path, "session", "worker", r#"{"type":"thread_started"}"#).unwrap();
    require_worker_history(&path, &next).unwrap();
    assert!(require_worker_history(&path, &first).is_err());
    assert!(commit_worker_episode(&path, &next, "next", EpisodeStatus::Ok).is_err());
    append_thread_event(&path, "session", "worker", r#"{"type":"run_started"}"#).unwrap();
    append_thread_event(
        &path,
        "session",
        "worker",
        r#"{"type":"assistant_message"}"#,
    )
    .unwrap();
    commit_worker_episode(&path, &next, "next", EpisodeStatus::Ok).unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn schema_31_upgrade_preserves_existing_worker_receipt() {
    let (path, identity) = fixture();
    let receipt = commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch(
        "ALTER TABLE worker_dispatches DROP COLUMN history_start_id; ALTER TABLE worker_dispatches DROP COLUMN history_boundary_id; PRAGMA user_version = 31;",
    )
    .unwrap();
    drop(conn);
    initialize(&path).unwrap();
    assert_eq!(
        commit_worker_episode(&path, &identity, "answer", EpisodeStatus::Ok).unwrap(),
        receipt
    );
    let conn = open_runtime_connection(&path).unwrap();
    let history: Option<i64> = conn
        .query_row(
            "SELECT history_start_id FROM worker_dispatches WHERE dispatch_id = 'dispatch'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(history, None);
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        schema_version()
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
