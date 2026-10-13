use super::*;
use crate::session_service::ExecutionOutputAvailability;

#[tokio::test]
async fn history_does_not_reconcile_abandoned_command_or_append_transcript() {
    let (parts, path) =
        test_direct_active_service("history_orphan", "session", ModelClient::new_for_test());
    let lease = Arc::new(sessions::SessionOperationLease::try_acquire(&path, "session").unwrap());
    let command = ShellCommandSnapshot {
        request_id: "orphan".into(),
        operation_id: Uuid::new_v4().to_string(),
        command: "touch must-not-execute".into(),
        timeout_ms: 30_000,
        state: ShellCommandState::Accepted,
        accepted_at_epoch_ms: 1,
        finished_at_epoch_ms: None,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        diagnostic: None,
        output_id: None,
        transcript_index: None,
    };
    crate::store::accept_shell_command(&path, "session", "digest", &command, &lease).unwrap();
    drop(lease);
    for _ in 0..3 {
        let history = parts.service.execution_history().await.unwrap();
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0].command.as_ref().unwrap(), &command);
        assert!(history.entries[0].execution.is_none());
        assert!(!parts.service.has_active_operation());
    }
    assert!(crate::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .read_from("session", 0)
        .unwrap()
        .is_empty());
    assert!(!path
        .parent()
        .unwrap()
        .join("workspace/must-not-execute")
        .exists());
    assert_eq!(
        crate::store::lookup_shell_command(&path, "session", "orphan")
            .unwrap()
            .unwrap()
            .1,
        command
    );
}

#[tokio::test]
async fn history_keeps_known_result_through_enrichment_failure_and_restart() {
    use crate::session_service::shell_output::{fail_enrichment_for_test, EnrichmentFault};
    let (parts, path) = test_direct_active_service(
        "history_output_failure",
        "session",
        ModelClient::new_for_test(),
    );
    let request_id = Uuid::new_v4().to_string();
    fail_enrichment_for_test(request_id.clone(), EnrichmentFault::Missing);
    parts
        .service
        .submit_shell_command(request(&request_id, "printf known; exit 7"))
        .await
        .unwrap();
    let result = settled(&parts.service, &request_id).await;
    let first = parts.service.execution_history().await.unwrap();
    let entry = &first.entries[0];
    let canonical = entry.command.as_ref().unwrap();
    assert_eq!(canonical.state, ShellCommandState::Completed);
    assert_eq!(canonical.exit_code, Some(7));
    assert_eq!(canonical.stdout, "known");
    assert!(canonical.output_id.is_none());
    assert!(matches!(
        entry.output.availability,
        ExecutionOutputAvailability::Expired | ExecutionOutputAvailability::ProcessLocalUnavailable
    ));
    drop(parts);
    let reloaded = crate::session_service::recent_command_history(path.clone(), "session".into())
        .await
        .unwrap();
    let restored = &reloaded.entries[0];
    assert_eq!(restored.id, entry.id);
    assert!(restored.execution.is_none());
    assert_eq!(
        restored.output.availability,
        ExecutionOutputAvailability::ProcessLocalUnavailable
    );
    assert_eq!(
        restored.command.as_ref().unwrap().operation_id,
        result.operation_id
    );
    assert_eq!(
        restored.command.as_ref().unwrap().state,
        ShellCommandState::Completed
    );
    assert_eq!(restored.command.as_ref().unwrap().stdout, "known");
}
