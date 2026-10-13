use super::*;
use crate::terminal::CommandStatus;

fn backend() -> Arc<ExecutionBackend> {
    Arc::new(ExecutionBackend::Local {
        workspace_cwd: std::env::current_dir().unwrap(),
    })
}

async fn command(manager: &TerminalManager, text: &str) -> super::super::super::CommandOutput {
    manager
        .exec_one_shot(text, None, 80, 24, 5000, 100, &backend(), None)
        .await
}

#[tokio::test]
async fn failed_pipe_spawns_leave_no_observation_owners_or_history() {
    let manager = TerminalManager::for_direct();
    let missing =
        std::env::temp_dir().join(format!("nac-history-missing-{}", uuid::Uuid::new_v4()));
    for _ in 0..32 {
        let output = manager
            .exec_one_shot(
                "printf unreachable",
                Some(missing.clone()),
                80,
                24,
                100,
                100,
                &backend(),
                None,
            )
            .await;
        assert_eq!(output.status, CommandStatus::SpawnError);
        assert_eq!(output.output_id, None);
        assert!(manager.pipe_executions.lock().unwrap().is_empty());
        assert!(manager.recent_execution_catalog().await.is_empty());
        assert_eq!(manager.pending_remote_cleanup_count(), 0);
    }
    let output = command(&manager, "printf admitted").await;
    assert_eq!(output.status, CommandStatus::Completed);
    assert_eq!(output.stdout_preview, "admitted");
    assert_eq!(manager.recent_execution_catalog().await.len(), 1);
}

#[tokio::test]
async fn cancellation_after_registration_before_spawn_removes_only_the_unstarted_owner() {
    let manager = TerminalManager::for_direct();
    let artifact = manager
        .output_registry
        .create(ArtifactKind::Command)
        .unwrap();
    let pending = manager
        .register_pipe(artifact.output_id(), "masked cwd".into(), &backend())
        .unwrap();
    pending.started();
    let pending_id = manager.execution_catalog().await[0].id.clone();
    let held_spawn = manager.one_shot_spawn_gate.lock().await;
    let cancellation = ThreadCancellation::default();
    let task_manager = manager.clone();
    let task_cancellation = cancellation.clone();
    let task = tokio::spawn(async move {
        task_manager
            .exec_one_shot(
                "printf unreachable",
                None,
                80,
                24,
                100,
                100,
                &backend(),
                Some(&task_cancellation),
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while manager.pipe_executions.lock().unwrap().len() != 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    cancellation.cancel();
    drop(held_spawn);
    let output = task.await.unwrap();
    assert_eq!(output.status, CommandStatus::Cancelled);
    assert_eq!(output.output_id, None);
    assert_eq!(manager.pipe_executions.lock().unwrap().len(), 1);
    drop(pending);
    let history = manager.recent_execution_catalog().await;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].0.id, pending_id);
    assert_eq!(
        history[0].0.process_state,
        ExecutionProcessState::CleanupPending
    );
    assert!(!history[0].0.output_complete);
    assert_eq!(manager.pending_remote_cleanup_count(), 0);
}

#[tokio::test]
async fn recent_pipe_metadata_has_stable_identity_bounded_cardinality_and_honest_byte_gap() {
    let mut manager = TerminalManager::with_limits(CommandOutputLimits {
        per_command_bytes: 4,
        per_session_bytes: 8,
    })
    .unwrap();
    manager.max_sessions = 2;
    assert_eq!(
        command(&manager, "printf 0123456789; exit 7").await.status,
        CommandStatus::Completed
    );
    let first = manager.recent_execution_catalog().await.pop().unwrap();
    assert_eq!(first.0.exit_code, Some(7));
    assert_eq!(first.2, Some(CommandStatus::Completed));
    assert!(first.0.output_complete);
    assert_eq!(first.0.process_state, ExecutionProcessState::Settled);
    assert!(!first.0.input && !first.0.resize && !first.0.stop);
    let gap = manager
        .read_execution_output(&first.0.id, 0, 100)
        .await
        .unwrap();
    assert!(gap.gap && gap.bytes.is_empty());
    assert_eq!((gap.retained_start, gap.retained_end), (6, 10));
    assert_eq!(
        manager
            .read_execution_output(&first.0.id, 6, 100)
            .await
            .unwrap()
            .bytes,
        b"6789"
    );
    assert_eq!(manager.recent_execution_catalog().await[0].0.id, first.0.id);
    for _ in 0..20 {
        assert_eq!(
            command(&manager, "true").await.status,
            CommandStatus::Completed
        );
    }
    assert_eq!(manager.pipe_executions.lock().unwrap().len(), 2);
    assert_eq!(manager.recent_execution_catalog().await.len(), 2);
    assert!(manager
        .read_execution_output(&first.0.id, 0, 100)
        .await
        .is_err());
    assert!(manager.stop_execution(&first.0.id).await.is_err());
}

#[tokio::test]
async fn history_eviction_and_output_expiry_keep_cleanup_and_collector_pending_owners() {
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 1;
    manager.output_registry =
        OutputRegistry::with_artifact_limit_for_test(CommandOutputLimits::default(), 2).unwrap();
    let artifact = manager
        .output_registry
        .create(ArtifactKind::Command)
        .unwrap();
    let guard = manager
        .register_pipe(artifact.output_id(), "masked cwd".into(), &backend())
        .unwrap();
    guard.started();
    let pending = manager.execution_catalog().await[0].id.clone();
    guard.settle_process(None, true, CommandStatus::SpawnError);
    guard.finish(Some("collector failed".into()));
    drop(guard);
    drop(artifact);
    for _ in 0..5 {
        command(&manager, "true").await;
    }
    let history = manager.recent_execution_catalog().await;
    assert_eq!(
        history.len(),
        2,
        "one settled record plus an unsettled obligation"
    );
    let retained = history.iter().find(|entry| entry.0.id == pending).unwrap();
    assert_eq!(
        retained.0.process_state,
        ExecutionProcessState::CleanupPending
    );
    assert!(retained.0.output_complete);
    assert_eq!(retained.0.output_error.as_deref(), Some("collector failed"));
    assert_eq!(retained.2, Some(CommandStatus::SpawnError));
    assert!(manager.read_execution_output(&pending, 0, 1).await.is_err());
    assert!(manager.stop_execution(&pending).await.is_err());
    assert!(manager
        .recent_execution_catalog()
        .await
        .iter()
        .any(|entry| entry.0.id == pending
            && entry.0.process_state == ExecutionProcessState::CleanupPending));

    let artifact = manager
        .output_registry
        .create(ArtifactKind::Command)
        .unwrap();
    let guard = manager
        .register_pipe(artifact.output_id(), "masked cwd".into(), &backend())
        .unwrap();
    guard.started();
    guard.settle_process(Some(0), false, CommandStatus::Completed);
    let history = manager.recent_execution_catalog().await;
    let collector = history
        .iter()
        .find(|entry| entry.0.exit_code == Some(0) && !entry.0.output_complete)
        .unwrap();
    assert_eq!(collector.0.process_state, ExecutionProcessState::Settled);
    let collector_id = collector.0.id.clone();
    command(&manager, "true").await;
    assert!(manager
        .recent_execution_catalog()
        .await
        .iter()
        .any(|entry| entry.0.id == collector_id));
    guard.finish(None);
    drop(guard);
    assert!(manager.pipe_executions.lock().unwrap().len() <= 2);
}

#[tokio::test]
async fn expired_pipe_metadata_cannot_authorize_new_output_or_external_stop() {
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 4;
    manager.output_registry =
        OutputRegistry::with_artifact_limit_for_test(CommandOutputLimits::default(), 2).unwrap();
    command(&manager, "printf first").await;
    let id = manager.recent_execution_catalog().await[0].0.id.clone();
    manager.stop_execution(&id).await.unwrap(); // Known settled stop is idempotent.
    command(&manager, "true").await;
    command(&manager, "true").await;
    assert!(manager
        .recent_execution_catalog()
        .await
        .iter()
        .any(|entry| entry.0.id == id));
    assert!(manager.execution_status(&id).await.is_err());
    assert!(manager.read_execution_output(&id, 0, 1).await.is_err());
    assert!(manager.stop_execution(&id).await.is_err());
}

#[tokio::test]
async fn guard_drop_keeps_confirmed_eof_separate_from_unsettled_process_ownership() {
    let mut manager = TerminalManager::for_direct();
    manager.max_sessions = 1;
    manager.output_registry =
        OutputRegistry::with_artifact_limit_for_test(CommandOutputLimits::default(), 2).unwrap();
    let artifact = manager
        .output_registry
        .create(ArtifactKind::Command)
        .unwrap();
    let guard = manager
        .register_pipe(artifact.output_id(), "masked cwd".into(), &backend())
        .unwrap();
    guard.started();
    guard.finish(None);
    let id = manager.execution_catalog().await[0].id.clone();
    drop(guard);
    drop(artifact);
    for _ in 0..3 {
        command(&manager, "true").await;
    }
    let history = manager.recent_execution_catalog().await;
    let entry = history.iter().find(|entry| entry.0.id == id).unwrap();
    assert!(entry.0.alive);
    assert_eq!(entry.0.process_state, ExecutionProcessState::CleanupPending);
    assert!(
        entry.0.output_complete,
        "confirmed EOF cannot roll back on owner drop"
    );
    assert!(entry.0.output_error.is_none());
    assert!(
        entry.2.is_none(),
        "collector EOF cannot invent a process outcome"
    );
    assert!(!entry.0.input && !entry.0.resize && !entry.0.stop);
    assert_eq!(
        history.len(),
        2,
        "unsettled owner plus bounded settled history"
    );
}

#[tokio::test]
async fn cancelled_pipe_keeps_one_source_and_cannot_be_read_from_restarted_manager() {
    let manager = TerminalManager::for_direct();
    let owner = manager.clone();
    let process = tokio::spawn(async move {
        owner
            .exec_one_shot("sleep 60", None, 80, 24, 60_000, 100, &backend(), None)
            .await
    });
    let id = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(entry) = manager.execution_catalog().await.pop() {
                break entry.id;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    manager.stop_execution(&id).await.unwrap();
    assert_eq!(process.await.unwrap().status, CommandStatus::Cancelled);
    for _ in 0..3 {
        let history = manager.recent_execution_catalog().await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].0.id, id);
        assert_eq!(history[0].2, Some(CommandStatus::Cancelled));
        assert_eq!(history[0].0.process_state, ExecutionProcessState::Settled);
        assert!(!history[0].0.input && !history[0].0.resize && !history[0].0.stop);
    }
    assert!(TerminalManager::for_direct()
        .read_execution_output(&id, 0, 1)
        .await
        .is_err());
}

#[tokio::test]
async fn human_and_model_pty_history_use_one_identity_without_advancing_model_preview() {
    let manager = TerminalManager::for_direct();
    let human = manager.user_terminal_name(uuid::Uuid::new_v4());
    manager
        .create_user_terminal(
            human.clone(),
            "/bin/sh",
            std::env::current_dir().unwrap(),
            80,
            24,
            &backend(),
            nac_contracts::CommandEnvironmentSnapshot::empty(),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    let agent = manager.next_session_name();
    manager
        .create(agent.clone(), "sleep 60", None, 80, 24, &backend())
        .await
        .unwrap();
    manager.retain(&agent).await.unwrap();
    let active = manager.recent_execution_catalog().await;
    assert_eq!(active.len(), 2);
    assert_eq!(
        active
            .iter()
            .find(|entry| entry.0.id == human)
            .unwrap()
            .0
            .origin,
        ExecutionOrigin::Human
    );
    assert_eq!(
        active
            .iter()
            .find(|entry| entry.0.id == agent)
            .unwrap()
            .0
            .origin,
        ExecutionOrigin::Agent
    );
    let cursor = manager.sessions.lock().await[&agent].preview_cursor();
    manager.terminate_user_terminal(&human).await.unwrap();
    manager.terminate(&agent).await.unwrap();
    for _ in 0..3 {
        let history = manager.recent_execution_catalog().await;
        assert_eq!(history.len(), 2);
        for id in [&human, &agent] {
            let entries = history
                .iter()
                .filter(|entry| &entry.0.id == id)
                .collect::<Vec<_>>();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].0.process_state, ExecutionProcessState::Settled);
            assert!(!entries[0].0.input && !entries[0].0.resize && !entries[0].0.stop);
        }
        assert_eq!(
            manager
                .completed_sessions
                .lock()
                .await
                .iter()
                .find(|entry| entry.0 == agent)
                .unwrap()
                .1
                .preview_cursor,
            cursor
        );
    }
    manager.remove_all().await.unwrap();
}
