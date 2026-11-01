use super::*;
use crate::run_failure::RunFailure;

fn update() -> sessions::SessionRunStateUpdate {
    sessions::SessionRunStateUpdate {
        session_id: "session".into(),
        ssh: None,
        sandbox_spec: None,
        run_state: sessions::SessionRunState::default(),
        finished_run_id: None,
        finished_run_disposition: None,
        failed_run_id: None,
        failed_run_failure: None,
        goal_settlement: None,
        finished_run_result: None,
        updated_at: now_utc(),
    }
}
async fn close(
    path: PathBuf,
    owner: Arc<StoreCoordinator>,
    observation: AttentionStoreObservation,
) {
    owner.shutdown().await.unwrap();
    drop(owner);
    drop(observation);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_terminal_save_hints_require_actual_question_invalidation_and_outer_commit() {
    for cancelled in [true, false] {
        let (path, _) = setup(Change::Config);
        let run = load_run_recovery(&path, "session").unwrap().unwrap().run_id;
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
        let mut terminal = update();
        if cancelled {
            terminal.finished_run_id = Some(run);
            terminal.finished_run_disposition = Some(RunTerminalDisposition::Cancelled);
        } else {
            terminal.failed_run_id = Some(run);
            terminal.failed_run_failure = Some(RunFailure::unknown("fixture failure"));
        }
        owner
            .submit(RollbackScope(true))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(owner
            .save_session_run_state(terminal.clone())
            .await
            .is_err());
        assert_eq!(observation.try_changed().unwrap(), None);
        assert!(owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .question
            .is_some());
        owner
            .submit(RollbackScope(false))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        owner
            .save_session_run_state(terminal.clone())
            .await
            .unwrap();
        assert_eq!(
            observation.try_changed().unwrap().as_deref(),
            Some("session")
        );
        assert!(owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .question
            .is_none());
        owner.save_session_run_state(terminal).await.unwrap();
        assert_eq!(observation.try_changed().unwrap(), None);
        close(path, owner, observation).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_ordinary_accounting_is_silent_but_recorded_interruption_invalidates_once() {
    let (path, _) = setup(Change::Config);
    let run = load_run_recovery(&path, "session").unwrap().unwrap().run_id;
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
    let mut ordinary = update();
    for index in 0..20 {
        ordinary.run_state.last_response_duration_ms = Some(index);
        ordinary.run_state.token_usages.push(None);
        owner
            .save_session_run_state(ordinary.clone())
            .await
            .unwrap();
    }
    assert_eq!(observation.try_changed().unwrap(), None);
    ordinary.failed_run_id = Some(run);
    ordinary.failed_run_failure = Some(RunFailure::interrupted("fixture interruption"));
    owner
        .save_session_run_state(ordinary.clone())
        .await
        .unwrap();
    assert_eq!(
        observation.try_changed().unwrap().as_deref(),
        Some("session")
    );
    owner.save_session_run_state(ordinary).await.unwrap();
    assert_eq!(observation.try_changed().unwrap(), None);
    assert!(owner
        .read_attention_metadata(Some("session".into()))
        .await
        .unwrap()[0]
        .question
        .is_some());
    close(path, owner, observation).await;
}

struct BindingRollback(bool);
impl PersistenceCommand for BindingRollback {
    type Output = ();
    fn correlation(&self) -> telemetry::Correlation {
        telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        open_runtime_connection(path)?.execute_batch(if self.0 {
            "CREATE TRIGGER rollback_binding AFTER UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'binding rollback fixture'); END;"
        } else { "DROP TRIGGER rollback_binding" })?;
        Ok(())
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_run_save_binding_changes_wake_once_while_identical_bindings_stay_silent() {
    for sandbox in [false, true] {
        let (path, _) = setup(Change::Config);
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
        let mut binding = update();
        if sandbox {
            binding.sandbox_spec = Some(crate::sandbox::SandboxSpec::default());
        } else {
            binding.ssh = Some(crate::sandbox::SshConnection::new("scope.example"));
        }
        owner
            .submit(BindingRollback(true))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(owner.save_session_run_state(binding.clone()).await.is_err());
        assert_eq!(observation.try_changed().unwrap(), None);
        owner
            .submit(BindingRollback(false))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        owner.save_session_run_state(binding.clone()).await.unwrap();
        assert_eq!(
            observation.try_changed().unwrap().as_deref(),
            Some("session")
        );
        assert!(owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .question
            .is_none());
        owner.save_session_run_state(binding).await.unwrap();
        assert_eq!(observation.try_changed().unwrap(), None);
        close(path, owner, observation).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_both_recovery_failure_branches_wake_after_commit_and_stage_transcript_stay_silent(
) {
    for marker in [false, true] {
        let (path, _) = setup(Change::Config);
        let run = load_run_recovery(&path, "session").unwrap().unwrap().run_id;
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
        if marker {
            let writer = TranscriptLogWriter::new(owner.store_path()).unwrap();
            writer
                .append(
                    "session",
                    1,
                    &crate::types::Message::Assistant {
                        content: Some(crate::agent::RUN_FAILED_PARTIAL_MARKER.into()),
                        tool_calls: None,
                        reasoning_text: None,
                        reasoning_details: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                )
                .unwrap();
        } else {
            let canonical = owner.store_path().to_owned();
            tokio::task::spawn_blocking(move || {
                stage_active_run_failure(
                    &canonical,
                    "session",
                    &run,
                    &RunFailure::unknown("fixture failure"),
                )
            })
            .await
            .unwrap()
            .unwrap();
        }
        assert_eq!(observation.try_changed().unwrap(), None);
        owner
            .submit(RollbackScope(true))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(owner.reconcile_active_run("session".into()).await.is_err());
        assert_eq!(observation.try_changed().unwrap(), None);
        owner
            .submit(RollbackScope(false))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(matches!(
            owner.reconcile_active_run("session".into()).await.unwrap(),
            ActiveRunReconciliation::Failed { .. }
        ));
        assert_eq!(
            observation.try_changed().unwrap().as_deref(),
            Some("session")
        );
        assert!(owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .question
            .is_none());
        assert_eq!(
            owner.reconcile_active_run("session".into()).await.unwrap(),
            ActiveRunReconciliation::None
        );
        assert_eq!(observation.try_changed().unwrap(), None);
        close(path, owner, observation).await;
    }
}

enum LifecycleCommit {
    Save(sessions::SessionRunStateUpdate),
    Recover,
}
struct LifecycleCommitThenWait {
    mutation: LifecycleCommit,
    reached: Arc<Notify>,
    release: mpsc::Receiver<()>,
}
impl PersistenceCommand for LifecycleCommitThenWait {
    type Output = ();
    fn correlation(&self) -> telemetry::Correlation {
        telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        match self.mutation {
            LifecycleCommit::Save(update) => sessions::save_session_run_state(path, &update)?,
            LifecycleCommit::Recover => {
                reconcile_active_run(path, "session")?;
            }
        }
        self.reached.notify_one();
        let _ = self.release.recv();
        Ok(())
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_lifecycle_commits_wake_before_lost_ack_and_replay_stays_silent() {
    for case in 0..5 {
        let (path, _) = setup(Change::Config);
        let run = load_run_recovery(&path, "session").unwrap().unwrap().run_id;
        let mut terminal = update();
        match case {
            0 => {
                terminal.finished_run_id = Some(run.clone());
                terminal.finished_run_disposition = Some(RunTerminalDisposition::Cancelled);
            }
            1 => {
                terminal.failed_run_id = Some(run.clone());
                terminal.failed_run_failure = Some(RunFailure::unknown("fixture failure"));
            }
            2 => terminal.ssh = Some(crate::sandbox::SshConnection::new("scope.example")),
            3 => stage_active_run_failure(
                &path,
                "session",
                &run,
                &RunFailure::unknown("fixture failure"),
            )
            .unwrap(),
            _ => {
                TranscriptLogWriter::new(&path)
                    .unwrap()
                    .append(
                        "session",
                        1,
                        &crate::types::Message::Assistant {
                            content: Some(crate::agent::RUN_FAILED_PARTIAL_MARKER.into()),
                            tool_calls: None,
                            reasoning_text: None,
                            reasoning_details: None,
                            duration_ms: None,
                            model_origin: None,
                            reasoning_field: None,
                        },
                    )
                    .unwrap();
            }
        }
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
        let reached = Arc::new(Notify::new());
        let (release, receive) = mpsc::channel();
        let pending = owner
            .submit(LifecycleCommitThenWait {
                mutation: if case < 3 {
                    LifecycleCommit::Save(terminal.clone())
                } else {
                    LifecycleCommit::Recover
                },
                reached: Arc::clone(&reached),
                release: receive,
            })
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        assert_eq!(
            observation.try_changed().unwrap().as_deref(),
            Some("session")
        );
        drop(pending);
        release.send(()).unwrap();
        assert!(owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .question
            .is_none());
        assert_eq!(owner.stats().acknowledgements_lost, 1);
        if case < 3 {
            owner.save_session_run_state(terminal).await.unwrap();
        } else {
            assert_eq!(
                owner.reconcile_active_run("session".into()).await.unwrap(),
                ActiveRunReconciliation::None
            );
        }
        assert_eq!(observation.try_changed().unwrap(), None);
        close(path, owner, observation).await;
    }
}

struct OutcomeRollback(bool);
impl PersistenceCommand for OutcomeRollback {
    type Output = ();
    fn correlation(&self) -> telemetry::Correlation {
        telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        open_runtime_connection(path)?.execute_batch(if self.0 {
            "CREATE TRIGGER rollback_outcome BEFORE INSERT ON session_run_outcomes BEGIN SELECT RAISE(ABORT,'outcome rollback fixture'); END;"
        } else { "DROP TRIGGER rollback_outcome" })?;
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_terminal_outcome_needs_its_own_postcommit_invalidation() {
    for disposition in [
        RunOutcomeDisposition::Completed,
        RunOutcomeDisposition::Cancelled,
        RunOutcomeDisposition::Failed,
    ] {
        let (path, _) = setup(Change::Config);
        let run = load_run_recovery(&path, "session").unwrap().unwrap().run_id;
        cancel_task_question(&path, "session", "scope", 1).unwrap();
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
        let mut terminal = update();
        if disposition == RunOutcomeDisposition::Failed {
            terminal.failed_run_id = Some(run.clone());
            terminal.failed_run_failure = Some(RunFailure::unknown("fixture failure"));
        } else {
            terminal.finished_run_id = Some(run.clone());
            terminal.finished_run_disposition =
                Some(if disposition == RunOutcomeDisposition::Completed {
                    RunTerminalDisposition::Completed
                } else {
                    RunTerminalDisposition::Cancelled
                });
            terminal.finished_run_result = Some("private result never read by attention".into());
        }
        owner
            .submit(OutcomeRollback(true))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(owner
            .save_session_run_state(terminal.clone())
            .await
            .is_err());
        assert_eq!(observation.try_changed().unwrap(), None);
        assert!(owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()[0]
            .last_outcome
            .is_none());
        owner
            .submit(OutcomeRollback(false))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        let reached = Arc::new(Notify::new());
        let (release, receive) = mpsc::channel();
        let pending = owner
            .submit(LifecycleCommitThenWait {
                mutation: LifecycleCommit::Save(terminal.clone()),
                reached: reached.clone(),
                release: receive,
            })
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        assert_eq!(
            observation.try_changed().unwrap().as_deref(),
            Some("session")
        );
        drop(pending);
        release.send(()).unwrap();
        let metadata = owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(metadata.last_outcome.as_ref().unwrap().run_id, run);
        assert_eq!(
            metadata.last_outcome.as_ref().unwrap().disposition,
            disposition
        );
        assert_eq!(
            metadata.verifies_goal_free_idle(&run, Some(metadata.config_version)),
            disposition == RunOutcomeDisposition::Completed
        );
        assert!(!format!("{metadata:?}").contains("private result"));
        assert_eq!(owner.stats().acknowledgements_lost, 1);
        owner.save_session_run_state(terminal).await.unwrap();
        assert_eq!(observation.try_changed().unwrap(), None);
        owner.save_session_run_state(update()).await.unwrap();
        assert_eq!(observation.try_changed().unwrap(), None);
        close(path, owner, observation).await;
    }
}
