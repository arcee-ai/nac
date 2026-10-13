use super::*;
use crate::session_service::shell_output::{fail_enrichment_for_test, EnrichmentFault};
use std::sync::atomic::{AtomicUsize, Ordering};

fn effects(workspace: &std::path::Path) -> usize {
    std::fs::read_dir(workspace)
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
}

fn canonical_result(path: &std::path::Path) -> ShellCommandSnapshot {
    let history = crate::store::TranscriptLogWriter::new(path)
        .unwrap()
        .read_from("session", 0)
        .unwrap();
    let results = history
        .iter()
        .filter_map(|(_, message)| {
            let Message::User { content } = message else {
                return None;
            };
            content
                .strip_prefix("<human_shell_result>\n")?
                .strip_suffix("\n</human_shell_result>")
        })
        .collect::<Vec<_>>();
    assert_eq!(
        results.len(),
        1,
        "one canonical result, not an interrupted replacement"
    );
    let result: ShellCommandSnapshot = serde_json::from_str(results[0]).unwrap();
    assert!(!results[0].contains("secret--line"));
    assert!(!results[0].contains("private-error-canary"));
    result
}

#[tokio::test]
async fn human_shell_artifact_failures_preserve_known_result_and_replay_after_reload() {
    for fault in [
        EnrichmentFault::Missing,
        EnrichmentFault::Redaction,
        EnrichmentFault::Join,
    ] {
        let (parts, path) = test_direct_active_service(
            "shell_output_unavailable",
            "session",
            ModelClient::new_for_test(),
        );
        let workspace = path.parent().unwrap().join("workspace");
        let request_id = format!("output-fault-{}", Uuid::new_v4());
        let command = r#"python3 -c 'import os, sys, tempfile; fd, path = tempfile.mkstemp(prefix="effects.", dir="."); os.close(fd); sys.stdout.write(os.environ["NAC_HUMAN_SECRET"]); sys.stderr.write("trusted stderr"); sys.exit(7)'"#;
        fail_enrichment_for_test(request_id.clone(), fault);
        let (accepted, replay) = parts
            .service
            .submit_shell_command(request(&request_id, command))
            .await
            .unwrap();
        assert!(!replay);
        let result = settled(&parts.service, &request_id).await;
        assert_eq!(result.operation_id, accepted.operation_id);
        assert_eq!(
            result.state,
            ShellCommandState::Completed,
            "native outcome diagnostic: {:?}",
            result.diagnostic
        );
        assert_eq!(result.exit_code, Some(7));
        assert_eq!(result.stdout, "[REDACTED]");
        assert_eq!(result.stderr, "trusted stderr");
        assert_eq!(
            result.diagnostic.as_deref(),
            if matches!(fault, EnrichmentFault::Redaction) {
                None
            } else {
                Some(
                "Full retained output is unavailable; only safely redacted previews are recorded.",
            )
            }
        );
        assert!(result.finished_at_epoch_ms.is_some());
        assert!(result.transcript_index.is_some());
        assert_eq!(effects(&workspace), 1);
        if matches!(fault, EnrichmentFault::Missing) {
            assert!(parts
                .service
                .shell_command_output(&request_id, "stdout", 0, 100)
                .await
                .unwrap()
                .is_none());
        }
        let (duplicate, replay) = parts
            .service
            .submit_shell_command(request(&request_id, command))
            .await
            .unwrap();
        assert!(replay);
        assert_eq!(duplicate, result);
        let canonical = canonical_result(&path);
        assert_eq!(canonical.state, result.state);
        assert_eq!(canonical.exit_code, result.exit_code);
        assert_eq!(canonical.stdout, result.stdout);
        assert_eq!(canonical.stderr, result.stderr);
        assert_eq!(canonical.diagnostic, result.diagnostic);
        drop(parts);

        // A new service/terminal registry cannot turn a finished journal row
        // into outcome_unknown or launch the command again to recreate output.
        let (reloaded, _) = test_direct_active_service_at(
            "shell_output_reload",
            "session",
            ModelClient::new_for_test(),
            path.clone(),
        );
        let restored = reloaded
            .service
            .lookup_shell_command(&request_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(restored, result);
        let (duplicate, replay) = reloaded
            .service
            .submit_shell_command(request(&request_id, command))
            .await
            .unwrap();
        assert!(replay);
        assert_eq!(duplicate, result);
        assert!(reloaded
            .service
            .shell_command_output(&request_id, "stdout", 0, 100)
            .await
            .unwrap()
            .is_none());
        assert_eq!(effects(&workspace), 1);
        let restored_canonical = canonical_result(&path);
        assert_eq!(restored_canonical.state, result.state);
        assert_eq!(restored_canonical.operation_id, result.operation_id);
        drop(reloaded);
    }
}

struct UnavailableDiagnostic(AtomicUsize);
impl nac_contracts::CommandEnvironmentProvider for UnavailableDiagnostic {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        Box::pin(async { Ok(test_environment()) })
    }
    fn redaction_snapshot(&self) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
        // Admission masks the command successfully. The known rejection's
        // diagnostic sanitizer then fails and must not strand its journal.
        if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
            Ok(test_environment())
        } else {
            anyhow::bail!("diagnostic-private-error-canary")
        }
    }
    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        Default::default()
    }
}

#[tokio::test]
async fn human_shell_rejected_diagnostic_redaction_failure_still_settles_without_effect() {
    let (parts, path) = test_direct_active_service("deny", "session", ModelClient::new_for_test());
    parts
        .service
        .agent
        .lock()
        .await
        .set_command_environment_provider(Some(Arc::new(UnavailableDiagnostic(AtomicUsize::new(
            0,
        )))));
    let command = "mktemp effects.XXXXXX";
    parts
        .service
        .submit_shell_command(request("rejected-output", command))
        .await
        .unwrap();
    let result = settled(&parts.service, "rejected-output").await;
    assert_eq!(result.state, ShellCommandState::Rejected);
    assert_eq!(result.exit_code, None);
    assert_eq!(
        result.diagnostic.as_deref(),
        Some("Command diagnostic is unavailable because it could not be safely redacted.",)
    );
    assert_eq!(effects(&path.parent().unwrap().join("workspace")), 0);
    let canonical = canonical_result(&path);
    assert_eq!(canonical.state, ShellCommandState::Rejected);
    assert_eq!(canonical.diagnostic, result.diagnostic);
    let (duplicate, replay) = parts
        .service
        .submit_shell_command(request("rejected-output", command))
        .await
        .unwrap();
    assert!(replay);
    assert_eq!(duplicate, result);
}
