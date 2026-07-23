use super::*;
use nac_core::runtime::{
    self, ModelOptions, NacConfig, OptionalModelOption, RunOptions, StoreOptions,
};
use nac_core::session_service::SessionCoordinationError;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn temp_dir(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nac_tui_{label}_{unique}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn metadata_for(path: &Path) -> TuiMetadata {
    TuiMetadata {
        cwd: path.display().to_string(),
        workspace_host_path: Some(path.to_path_buf()),
        store_path: path.join(".nac").join("store.db"),
        model: "gpt-test".to_string(),
        backend: "openai-responses".to_string(),
        session_id: None,
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        base_url: String::new(),
        reasoning_effort: None,
        api_key_env: None,
        extra_headers: Default::default(),
    }
}

async fn empty_session_service(label: &str) -> (SessionService, SessionServiceInit, PathBuf) {
    let dir = temp_dir(label);
    let key_env = format!(
        "NAC_TUI_TEST_API_KEY_{}",
        label.replace('-', "_").to_uppercase()
    );
    std::env::set_var(&key_env, "test-key");
    let run_config = runtime::build_run_config(
        RunOptions {
            workspace_cwd: dir.clone(),
            store: StoreOptions {
                store_path: Some(dir.join("store.db")),
            },
            model: ModelOptions {
                backend: Some(nac_core::model::BackendKind::OpenAiResponses),
                api_base_url: Some("https://api.example.test/v1".to_string()),
                api_model: Some("gpt-test".to_string()),
                api_key_env: OptionalModelOption::Value(key_env.clone()),
                ..ModelOptions::default()
            },
            ..RunOptions::default()
        },
        &NacConfig::default(),
    )
    .await;
    std::env::remove_var(key_env);
    let parts = SessionService::from_orchestrator_run_config(run_config.unwrap());
    (parts.service, parts.init, dir)
}

#[test]
fn compact_command_is_frontend_action_and_preserves_draft_until_admission() {
    let dir = temp_dir("compact-action");
    let mut app = App::new(metadata_for(&dir), &[], false);
    app.composer.insert_str("/compact");

    let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

    assert!(matches!(action, AppAction::Compact));
    assert_eq!(app.prompt(), "/compact");
    assert!(app.prompts.is_empty());
    assert!(app.responses.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn compact_command_rejects_arguments_without_clearing_draft() {
    let dir = temp_dir("compact-args");
    let mut app = App::new(metadata_for(&dir), &[], false);
    app.composer.insert_str("/compact now");

    let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

    assert!(matches!(action, AppAction::None));
    assert_eq!(app.prompt(), "/compact now");
    assert_eq!(
        app.composer_notice
            .as_ref()
            .map(|notice| notice.text.as_str()),
        Some("usage: /compact")
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn direct_compaction_is_nonblocking_and_does_not_mutate_tui_or_transcript_history() {
    let (service, init, dir) = empty_session_service("compact-direct-service").await;
    let before_messages = service.messages_snapshot().await;
    let mut app = App::new_with_service(
        service.clone(),
        init.metadata,
        &init.restored_messages,
        false,
    );
    app.composer.insert_str("/compact");
    let action = app.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    assert!(matches!(action, AppAction::Compact));
    let (completion_tx, mut completion_rx) = mpsc::unbounded_channel();

    start_manual_compaction(&service, &mut app, completion_tx);

    assert!(app.prompt().is_empty());
    assert!(app.is_manual_compaction_active());
    assert!(!app.is_run_active());
    assert!(app.prompts.is_empty());
    assert!(app.responses.is_empty());

    let completion = tokio::time::timeout(Duration::from_secs(2), completion_rx.recv())
        .await
        .expect("manual compaction should finish")
        .expect("completion sender should remain available");
    assert!(matches!(
        &completion.result,
        Ok(SessionCompactionResult::Unchanged {
            reason: CompactionSkipReason::NoEligibleBoundary,
            ..
        })
    ));
    finish_manual_compaction(&mut app, completion);

    assert!(!app.is_composer_busy());
    assert!(!app.is_run_active());
    assert!(app.prompts.is_empty());
    assert!(app.responses.is_empty());
    let after_messages = service.messages_snapshot().await;
    assert!(!before_messages.is_empty());
    assert_eq!(after_messages.len(), before_messages.len());
    assert!(before_messages
        .iter()
        .zip(&after_messages)
        .all(|(before, after)| match (before, after) {
            (
                Message::System {
                    content: before_content,
                },
                Message::System {
                    content: after_content,
                },
            ) => before_content == after_content,
            _ => false,
        }));
    assert_eq!(
        app.composer_notice
            .as_ref()
            .map(|notice| (notice.text.as_str(), notice.tone)),
        Some(("Nothing new to compact", Tone::Info))
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn busy_admission_preserves_the_compact_draft() {
    let (service, init, dir) = empty_session_service("compact-busy-admission").await;
    let metadata = service.metadata();
    let session_id = metadata.session_id.as_deref().unwrap();
    let _lease =
        nac_core::sessions::SessionOperationLease::try_acquire(&metadata.store_path, session_id)
            .unwrap();
    let mut app = App::new_with_service(
        service.clone(),
        init.metadata,
        &init.restored_messages,
        false,
    );
    app.composer.insert_str("/compact");
    let (completion_tx, mut completion_rx) = mpsc::unbounded_channel();

    start_manual_compaction(&service, &mut app, completion_tx);

    assert_eq!(app.prompt(), "/compact");
    assert!(!app.is_manual_compaction_active());
    assert!(matches!(
        completion_rx.try_recv(),
        Err(mpsc::error::TryRecvError::Empty | mpsc::error::TryRecvError::Disconnected)
    ));
    assert_eq!(
        app.composer_notice
            .as_ref()
            .map(|notice| (notice.text.as_str(), notice.tone)),
        Some((
            "session is busy; wait for the current operation",
            Tone::Warning,
        ))
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn admission_and_completion_errors_never_expose_internal_paths() {
    const CANARY: &str = "/private/canary/session-store.db";
    let admission = SessionCompactionAdmissionError::Coordination {
        message: SessionCoordinationError::Store {
            detail: format!("failed to open {CANARY}"),
        },
    };
    let completion = Err(SessionCompactionError::Failed {
        compaction_id: Uuid::nil(),
        failure: CompactionFailure::CheckpointPersistenceFailed,
        source: Some(anyhow::anyhow!("failed to write {CANARY}")),
    });

    let admission_notice = manual_compaction_admission_notice(&admission);
    let completion_notice = manual_compaction_notice(&completion);

    assert_eq!(
        admission_notice,
        ("Context compaction could not start", Tone::Error)
    );
    assert_eq!(
        completion_notice,
        ("Context compaction failed", Tone::Error)
    );
    assert!(!admission_notice.0.contains(CANARY));
    assert!(!completion_notice.0.contains(CANARY));
}

#[test]
fn result_notices_are_brief() {
    assert_eq!(
        manual_compaction_notice(&Ok(SessionCompactionResult::Compacted {
            compaction_id: Uuid::nil(),
        })),
        ("Context compacted", Tone::Success)
    );
    assert_eq!(
        manual_compaction_notice(&Err(SessionCompactionError::Unavailable)),
        ("Context compaction is unavailable", Tone::Warning)
    );
}

#[test]
fn activity_events_use_typed_safe_labels_without_mutating_history() {
    let dir = temp_dir("compaction-activity");
    let mut app = App::new(metadata_for(&dir), &[], false);
    let compaction_id = Uuid::nil();

    apply_compaction_event(
        &mut app,
        AgentEvent::OrchestratorCompactionStarted {
            compaction_id,
            reason: CompactionReason::Manual,
        },
    );
    assert!(app.is_manual_compaction_active());
    assert!(!app.is_run_active());
    apply_compaction_event(
        &mut app,
        AgentEvent::OrchestratorCompactionCompleted {
            compaction_id,
            reason: CompactionReason::Manual,
        },
    );
    assert!(!app.is_manual_compaction_active());
    apply_compaction_event(
        &mut app,
        AgentEvent::OrchestratorCompactionSkipped {
            compaction_id,
            reason: CompactionReason::Auto,
            cause: CompactionSkipReason::AlreadyCompacted,
        },
    );
    apply_compaction_event(
        &mut app,
        AgentEvent::OrchestratorCompactionFailed {
            compaction_id,
            reason: CompactionReason::Auto,
            failure: CompactionFailure::SummaryRequestFailed,
        },
    );

    let details = app
        .timeline
        .iter()
        .map(|entry| (entry.detail.as_str(), entry.tone))
        .collect::<Vec<_>>();
    assert_eq!(
        details,
        vec![
            ("context compaction • started • manual", Tone::Info),
            ("context compaction • completed • manual", Tone::Success),
            (
                "context compaction • unchanged • automatic • already compacted",
                Tone::Muted,
            ),
            (
                "context compaction • failed • automatic • summary request failed",
                Tone::Error,
            ),
        ]
    );
    assert!(app
        .timeline
        .iter()
        .all(|entry| entry.actor == "orchestrator"));
    assert!(app.prompts.is_empty());
    assert!(app.responses.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn activity_labels_cover_all_skip_causes_and_failures() {
    assert_eq!(
        compaction_skip_label(CompactionSkipReason::NoEligibleBoundary),
        "no eligible boundary"
    );
    assert_eq!(
        compaction_failure_label(CompactionFailure::SummaryRejected),
        "summary rejected"
    );
    assert_eq!(
        compaction_failure_label(CompactionFailure::CheckpointPersistenceFailed),
        "checkpoint persistence failed"
    );
    assert_eq!(
        compaction_failure_label(CompactionFailure::Cancelled),
        "cancelled"
    );
}
