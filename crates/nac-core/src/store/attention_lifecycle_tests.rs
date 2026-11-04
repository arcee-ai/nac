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
        heartbeat_settlement: None,
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

#[test]
fn b1_terminal_commit_notifies_the_existing_scope_bus_exactly_once() {
    let root = std::env::temp_dir().join(format!("nac-b1-preimage-{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "b1-preimage");
    crate::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "b1-preimage",
            0,
            &crate::types::Message::User {
                content: "fixture request".into(),
            },
            "b1-preimage-run",
        )
        .unwrap();
    // Admission has already committed. Observe only the terminal transaction.
    let mut hints = crate::store::goal_changes::subscribe(&path);
    let terminal = crate::sessions::SessionRunStateUpdate {
        session_id: "b1-preimage".into(),
        ssh: None,
        sandbox_spec: None,
        run_state: crate::sessions::SessionRunState::default(),
        finished_run_id: Some("b1-preimage-run".into()),
        finished_run_disposition: Some(crate::store::RunTerminalDisposition::Completed),
        failed_run_id: None,
        failed_run_failure: None,
        goal_settlement: None,
        heartbeat_settlement: None,
        finished_run_result: Some("fixture result".into()),
        updated_at: crate::store::now_utc(),
    };
    crate::sessions::save_session_run_state(&path, &terminal).unwrap();
    let notification_count = usize::from(hints.try_recv().is_ok());
    let occurrence_count: i64 = crate::store::open_runtime_connection(&path)
        .unwrap()
        .query_row(
            "SELECT count(*) FROM session_completion_occurrences WHERE session_id='b1-preimage' AND run_id='b1-preimage-run' AND kind='request'",
            [], |row| row.get(0),
        )
        .unwrap();
    crate::sessions::save_session_run_state(&path, &terminal).unwrap();
    let replay_notification_count = usize::from(hints.try_recv().is_ok());
    drop(hints);
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(
        occurrence_count, 1,
        "the canonical completion must really commit"
    );
    assert_eq!(
        notification_count, 1,
        "the existing scope bus must wake after the terminal commit"
    );
    assert_eq!(
        replay_notification_count, 0,
        "terminal replay must stay silent"
    );
}

#[derive(Clone, Copy, Debug)]
enum RecoveryEffectCase {
    Cached(RunTerminalDisposition),
    CompletedTranscript,
    CancelledTranscript,
    FailedTranscript,
    StagedFailure,
    Interrupted,
}

fn prepare_recovery_effect(case: RecoveryEffectCase) -> PathBuf {
    let path = fixture();
    let run = uuid::Uuid::new_v4().to_string();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_run_prompt(
            "session",
            0,
            &crate::types::Message::User {
                content: "recover this exact run".into(),
            },
            &run,
        )
        .unwrap();
    match case {
        RecoveryEffectCase::Cached(disposition) => {
            // Use ordinary terminal settlement to retain the actual relationship
            // obligation and canonical outcome, rather than inventing a receipt.
            open_runtime_connection(&path).unwrap().execute(
                "INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,run_id,execution_mode,created_at,updated_at) VALUES('session','creator','creator','general','child',1,'running',1,?1,'background','now','now')",
                [&run],
            ).unwrap();
            let mut terminal = update();
            terminal.finished_run_id = Some(run);
            terminal.finished_run_disposition = Some(disposition);
            sessions::save_session_run_state(&path, &terminal).unwrap();
            assert_eq!(
                load_run_recovery(&path, "session")
                    .unwrap()
                    .unwrap()
                    .terminal_disposition,
                Some(disposition)
            );
        }
        RecoveryEffectCase::StagedFailure => {
            stage_active_run_failure(
                &path,
                "session",
                &run,
                &RunFailure::unknown("staged recovery fixture"),
            )
            .unwrap();
        }
        RecoveryEffectCase::Interrupted => {}
        _ => {
            let content = match case {
                RecoveryEffectCase::CompletedTranscript => "canonical recovered result",
                RecoveryEffectCase::CancelledTranscript => crate::agent::RUN_CANCELLED_MARKER,
                RecoveryEffectCase::FailedTranscript => crate::agent::RUN_FAILED_PARTIAL_MARKER,
                _ => unreachable!(),
            };
            writer
                .append(
                    "session",
                    1,
                    &crate::types::Message::Assistant {
                        content: Some(content.into()),
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
    path
}

enum RecoveryFixtureMutation {
    Fault(bool),
    ReleaseRelationship,
}
impl PersistenceCommand for RecoveryFixtureMutation {
    type Output = ();
    fn correlation(&self) -> telemetry::Correlation {
        telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        let connection = open_runtime_connection(path)?;
        match self {
            Self::Fault(true) => connection.execute_batch(
                "CREATE TRIGGER rollback_recovery_update BEFORE UPDATE ON session_run_recovery WHEN NEW.status<>OLD.status BEGIN SELECT RAISE(ABORT,'recovery effect rollback fixture'); END;
                 CREATE TRIGGER rollback_recovery_delete BEFORE DELETE ON session_run_recovery BEGIN SELECT RAISE(ABORT,'recovery effect rollback fixture'); END;",
            )?,
            Self::Fault(false) => connection.execute_batch(
                "DROP TRIGGER rollback_recovery_update; DROP TRIGGER rollback_recovery_delete;",
            )?,
            Self::ReleaseRelationship => {
                connection.execute("UPDATE traditional_children SET status='completed' WHERE child_session_id='session'", [])?;
            }
        }
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn all_five_recovery_branches_publish_actual_effects_after_commit_and_before_lost_ack() {
    for case in [
        RecoveryEffectCase::Cached(RunTerminalDisposition::Completed),
        RecoveryEffectCase::Cached(RunTerminalDisposition::Cancelled),
        RecoveryEffectCase::CompletedTranscript,
        RecoveryEffectCase::CancelledTranscript,
        RecoveryEffectCase::FailedTranscript,
        RecoveryEffectCase::StagedFailure,
        RecoveryEffectCase::Interrupted,
    ] {
        let path = prepare_recovery_effect(case);
        let lease = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
        let cutoff = read_completion_page(&path, None).unwrap().cursor;
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let mut observation = AttentionStoreObservation::subscribe(owner.store_path());
        if matches!(case, RecoveryEffectCase::Cached(_)) {
            // While the exact relationship is still running, a replay changes
            // neither the already-recorded outcome nor its retained obligation.
            assert_eq!(
                owner.reconcile_active_run("session".into()).await.unwrap(),
                ActiveRunReconciliation::CanonicalTerminal
            );
            assert_eq!(observation.try_changed().unwrap(), None);
            owner
                .submit(RecoveryFixtureMutation::ReleaseRelationship)
                .unwrap()
                .acknowledge()
                .await
                .unwrap();
        }
        let before = owner
            .read_attention_metadata(Some("session".into()))
            .await
            .unwrap();
        owner
            .submit(RecoveryFixtureMutation::Fault(true))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(
            owner.reconcile_active_run("session".into()).await.is_err(),
            "{case:?}"
        );
        assert_eq!(
            observation.try_changed().unwrap(),
            None,
            "rollback {case:?}"
        );
        assert_eq!(
            owner
                .read_attention_metadata(Some("session".into()))
                .await
                .unwrap(),
            before
        );
        assert!(owner
            .read_completion_page(Some(cutoff))
            .await
            .unwrap()
            .items
            .is_empty());
        owner
            .submit(RecoveryFixtureMutation::Fault(false))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();

        let reached = Arc::new(Notify::new());
        let (release, receive) = mpsc::channel();
        let pending = owner
            .submit(LifecycleCommitThenWait {
                mutation: LifecycleCommit::Recover,
                reached: reached.clone(),
                release: receive,
            })
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
            .await
            .unwrap();
        assert_eq!(
            observation.try_changed().unwrap().as_deref(),
            Some("session"),
            "committed {case:?}"
        );
        assert_eq!(
            observation.try_changed().unwrap(),
            None,
            "one effect {case:?}"
        );
        drop(pending); // A lost acknowledgement cannot retract the real commit.
        release.send(()).unwrap();
        assert_eq!(
            owner.reconcile_active_run("session".into()).await.unwrap(),
            ActiveRunReconciliation::None
        );
        assert_eq!(observation.try_changed().unwrap(), None, "replay {case:?}");
        drop(lease);
        close(path, owner, observation).await;
    }
}
