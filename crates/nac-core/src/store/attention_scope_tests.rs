use super::*;
use crate::store::coordinator::PersistenceCommand;
use crate::{sessions, telemetry};
use std::sync::{mpsc, Arc};
use tokio::sync::Notify;

#[derive(Clone, Copy)]
enum Change {
    Config,
    Assign,
    Delete,
}
fn setup(change: Change) -> (PathBuf, sessions::RawSessionConfig) {
    let path = fixture();
    if !matches!(change, Change::Config) {
        let cwd = open_runtime_connection(&path)
            .unwrap()
            .query_row(
                "SELECT cwd FROM sessions WHERE session_id='session'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        insert_project(
            &path,
            NewProject {
                project_id: "project".into(),
                name: Some("scope".into()),
                description: None,
                cwd: PathBuf::from(cwd),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            },
        )
        .unwrap();
        if matches!(change, Change::Delete) {
            assign_session_to_project(&path, "project", "session").unwrap();
        }
    }
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &crate::types::Message::User {
                content: "private".into(),
            },
            &run,
        )
        .unwrap();
    create_task_question(
        &path,
        &QuestionRequest {
            session_id: "session".into(),
            request_id: "scope".into(),
            run_id: run.clone(),
            generation: run,
            text: "private".into(),
            choices: vec![],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    let mut config = sessions::load_session_config(&path, "session").unwrap();
    config.orchestrator_compaction_threshold = Some(64_000);
    (path, config)
}
async fn mutate(
    owner: &StoreCoordinator,
    change: Change,
    config: &sessions::RawSessionConfig,
) -> Result<()> {
    match change {
        Change::Config => {
            owner.update_raw_session_config(config.clone()).await?;
        }
        Change::Assign => {
            owner
                .assign_session_to_project("project".into(), "session".into())
                .await?;
        }
        Change::Delete => {
            owner.delete_project("project".into()).await?;
        }
    }
    Ok(())
}
struct RollbackScope(bool);
impl PersistenceCommand for RollbackScope {
    type Output = ();
    fn correlation(&self) -> telemetry::Correlation {
        telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        open_runtime_connection(path)?.execute_batch(if self.0 {
            "CREATE TRIGGER rollback_scope AFTER UPDATE ON task_questions WHEN NEW.status='cancelled' BEGIN SELECT RAISE(ABORT,'scope rollback fixture'); END;"
        } else {"DROP TRIGGER rollback_scope"})?;
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn direct_owned_scope_writers_publish_only_after_commit_and_retries_stay_silent() {
    for change in [Change::Config, Change::Assign, Change::Delete] {
        let (path, config) = setup(change);
        let owner = StoreCoordinator::acquire(&path).unwrap();
        let canonical = owner.store_path().to_owned();
        let mut observation = AttentionStoreObservation::subscribe(&canonical);
        owner
            .submit(RollbackScope(true))
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert!(mutate(&owner, change, &config).await.is_err());
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
        mutate(&owner, change, &config).await.unwrap();
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
        assert!(mutate(&owner, change, &config).await.is_err());
        assert_eq!(observation.try_changed().unwrap(), None);
        owner.shutdown().await.unwrap();
        drop(owner);
        drop(observation);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
struct CommitThenWait {
    config: sessions::RawSessionConfig,
    reached: Arc<Notify>,
    release: mpsc::Receiver<()>,
}
impl PersistenceCommand for CommitThenWait {
    type Output = ();
    fn correlation(&self) -> telemetry::Correlation {
        telemetry::Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<()> {
        sessions::update_raw_session_config(path, &self.config)?;
        self.reached.notify_one();
        let _ = self.release.recv();
        Ok(())
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_real_commit_wakes_before_a_lost_ack_and_canonical_replay_cannot_duplicate_it() {
    let (path, config) = setup(Change::Config);
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let canonical = owner.store_path().to_owned();
    let mut observation = AttentionStoreObservation::subscribe(&canonical);
    let reached = Arc::new(Notify::new());
    let (release, receive) = mpsc::channel();
    let pending = owner
        .submit(CommitThenWait {
            config: config.clone(),
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
    assert!(owner.update_raw_session_config(config).await.is_err());
    assert_eq!(observation.try_changed().unwrap(), None);
    owner.shutdown().await.unwrap();
    drop(owner);
    drop(observation);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_observer_is_created_by_scope_mutation_and_ordinary_transcripts_do_not_flood_hints() {
    let (path, config) = setup(Change::Config);
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let canonical = owner.store_path().to_owned();
    assert_eq!(goal_changes::subscriber_count(&canonical), 0);
    owner.update_raw_session_config(config).await.unwrap();
    assert_eq!(goal_changes::subscriber_count(&canonical), 0);
    let mut observation = AttentionStoreObservation::subscribe(&canonical);
    let writer = TranscriptLogWriter::new(&canonical).unwrap();
    for index in 1..21 {
        writer
            .append(
                "session",
                index,
                &crate::types::Message::User {
                    content: format!("ordinary {index}"),
                },
            )
            .unwrap();
    }
    assert_eq!(observation.try_changed().unwrap(), None);
    owner.shutdown().await.unwrap();
    drop(owner);
    drop(observation);
    drop(writer);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[path = "attention_lifecycle_tests.rs"]
mod lifecycle;
