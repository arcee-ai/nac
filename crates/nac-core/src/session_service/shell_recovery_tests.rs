use super::*;

fn orphan(path: &std::path::Path, started: bool) -> ShellCommandSnapshot {
    let lease = Arc::new(sessions::SessionOperationLease::try_acquire(path, "session").unwrap());
    let mut snapshot = ShellCommandSnapshot {
        request_id: "orphan".into(),
        operation_id: Uuid::new_v4().to_string(),
        command: "touch must-not-execute".into(),
        timeout_ms: DEFAULT_SHELL_TIMEOUT_MS,
        state: ShellCommandState::Accepted,
        accepted_at_epoch_ms: now_epoch_ms(),
        finished_at_epoch_ms: None,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        diagnostic: None,
        output_id: None,
        transcript_index: None,
    };
    crate::store::accept_shell_command(path, "session", "digest", &snapshot, &lease).unwrap();
    if started {
        snapshot.state = ShellCommandState::Started;
        crate::store::start_shell_command(path, "session", &snapshot, &lease).unwrap();
    }
    snapshot
}

#[tokio::test]
async fn human_shell_model_admission_recovers_orphans_before_refreshing_context() {
    for started in [false, true] {
        let (parts, path) = test_direct_active_service(
            "human_shell_run_recovery",
            "session",
            ModelClient::new_for_test(),
        );
        let command = orphan(&path, started);
        // No projection/lookup runs before admission: this is an independent
        // recovery entry point, not a render-triggered cleanup.
        parts
            .service
            .try_begin_run_with_lease(None, "continue", None, RunAdmissionKind::default())
            .unwrap();
        let result = crate::store::lookup_shell_command(&path, "session", "orphan")
            .unwrap()
            .unwrap()
            .1;
        assert_eq!(
            result.state,
            if started {
                ShellCommandState::OutcomeUnknown
            } else {
                ShellCommandState::Interrupted
            }
        );
        assert!(result.transcript_index.is_some());
        assert!(!path
            .parent()
            .unwrap()
            .join("workspace/must-not-execute")
            .exists());
        let agent = parts.service.agent.lock().await;
        assert!(agent.messages.iter().any(|message| matches!(message,
            crate::types::Message::User { content } if content.contains(&command.operation_id)
                && content.contains("<human_shell_result>"))));
    }
}

#[tokio::test]
async fn human_shell_compaction_admission_recovers_orphans_before_refreshing_context() {
    for started in [false, true] {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            crate::session_service::tests::compaction_response("recovered command summary"),
        )]);
        let (parts, path) = test_direct_active_service(
            "human_shell_compaction_recovery",
            "session",
            ModelClient::new_for_test_server(server.base_url.clone()),
        );
        orphan(&path, started);
        let handle = parts.service.try_compact().unwrap();
        let result = crate::store::lookup_shell_command(&path, "session", "orphan")
            .unwrap()
            .unwrap()
            .1;
        assert!(result.state.is_terminal());
        assert!(result.transcript_index.is_some());
        handle.wait().await.unwrap();
        assert_eq!(server.finish().len(), 1);
        assert!(!path
            .parent()
            .unwrap()
            .join("workspace/must-not-execute")
            .exists());
    }
}

#[tokio::test]
async fn human_shell_retries_known_result_after_settlement_store_failure_without_rerunning() {
    let (parts, path) = test_direct_active_service(
        "human_shell_settlement_retry",
        "session",
        ModelClient::new_for_test(),
    );
    let connection = crate::store::open_runtime_connection(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_shell_settlement BEFORE UPDATE ON human_shell_operations WHEN NEW.phase='finished' BEGIN SELECT RAISE(ABORT, 'injected shell settlement failure'); END;").unwrap();
    drop(connection);
    let workspace = path.parent().unwrap().join("workspace");
    let effect_count = || {
        std::fs::read_dir(&workspace)
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("effects.")
            })
            .count()
    };
    parts
        .service
        .submit_shell_command(request(
            "retry",
            "mktemp effects.XXXXXX; printf 'known result'; exit 7",
        ))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while effect_count() == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(
        parts.service.has_active_operation(),
        "known result must retain its lease while settlement fails"
    );
    let pending = crate::store::lookup_shell_command(&path, "session", "retry")
        .unwrap()
        .unwrap()
        .1;
    assert_eq!(pending.state, ShellCommandState::Started);
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&path, "session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    let (replay, duplicate) = parts
        .service
        .submit_shell_command(request(
            "retry",
            "mktemp effects.XXXXXX; printf 'known result'; exit 7",
        ))
        .await
        .unwrap();
    assert!(duplicate);
    assert_eq!(replay.operation_id, pending.operation_id);
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute_batch("DROP TRIGGER fail_shell_settlement;")
        .unwrap();
    let result = settled(&parts.service, "retry").await;
    assert_eq!(result.state, ShellCommandState::Completed);
    assert_eq!(result.exit_code, Some(7));
    assert!(result.stdout.ends_with("known result"));
    assert_eq!(effect_count(), 1);
    let history = crate::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .read_from("session", 0)
        .unwrap();
    assert_eq!(
        history
            .iter()
            .filter(|(_, message)| matches!(message,
        crate::types::Message::User { content } if content.contains("<human_shell_result>")))
            .count(),
        1
    );
}
