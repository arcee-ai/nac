use super::*;

fn fixture() -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!("nac-attention-read-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "session");
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id='session'",
            [],
        )
        .unwrap();
    path
}

#[tokio::test]
async fn existing_postcommit_hint_reconciles_exact_goal_metadata_without_content() {
    let path = fixture();
    let mut hints = AttentionStoreObservation::subscribe(&path);
    let goal = create_session_goal(
        &path,
        "session",
        "private objective must not leave this reader",
        None,
        None,
    )
    .unwrap();
    assert_eq!(hints.changed().await.unwrap(), "session");
    let metadata = read_attention_metadata(&path, Some("session")).unwrap();
    assert_eq!(metadata.len(), 1);
    assert_eq!(metadata[0].goal.as_ref().unwrap().identity.id, goal.goal_id);
    assert_eq!(
        metadata[0].goal.as_ref().unwrap().status,
        GoalStatus::Active
    );
    assert!(!format!("{metadata:?}").contains("private objective"));
    assert!(read_attention_metadata(&path, Some("missing"))
        .unwrap()
        .is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn canonical_question_resolution_and_compatibility_are_reused() {
    let path = fixture();
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &crate::types::Message::User {
                content: "not observer content".into(),
            },
            &run,
        )
        .unwrap();
    let mut hints = AttentionStoreObservation::subscribe(&path);
    let record = create_task_question(
        &path,
        &QuestionRequest {
            session_id: "session".into(),
            request_id: "question".into(),
            run_id: run.clone(),
            generation: run.clone(),
            text: "private question".into(),
            choices: vec![],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    assert_eq!(hints.try_changed().unwrap().as_deref(), Some("session"));
    let metadata = read_attention_metadata(&path, None).unwrap();
    assert_eq!(
        metadata[0].question,
        Some(AttentionDecision::Question {
            request_id: "question".into(),
            run_id: run.clone(),
            generation: run,
            revision: 1
        })
    );
    cancel_task_question(&path, "session", "question", record.revision).unwrap();
    assert_eq!(hints.try_changed().unwrap().as_deref(), Some("session"));
    assert_eq!(
        read_attention_metadata(&path, Some("session")).unwrap()[0].question,
        None
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn census_rejects_the_extra_row_instead_of_silently_truncating() {
    let path = fixture();
    for id in 0..1024 {
        insert_test_session(&path, &format!("extra-{id}"));
    }
    assert!(read_attention_metadata(&path, None)
        .unwrap_err()
        .to_string()
        .contains("capacity"));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn lag_requires_rebaseline_and_drop_releases_the_existing_bus_receiver() {
    let path = fixture();
    let mut hints = AttentionStoreObservation::subscribe(&path);
    let mut goal = create_session_goal(&path, "session", "private", None, None).unwrap();
    for index in 0..260 {
        goal = update_session_goal_by_user(
            &path,
            "session",
            &goal.goal_id,
            goal.version,
            UserGoalUpdate {
                status: Some(if index % 2 == 0 {
                    GoalStatus::Paused
                } else {
                    GoalStatus::Active
                }),
                ..Default::default()
            },
        )
        .unwrap();
    }
    assert!(hints.try_changed().is_err());
    assert_eq!(goal_changes::subscriber_count(&path), 1);
    drop(hints);
    assert_eq!(goal_changes::subscriber_count(&path), 0);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn oversized_database_identity_and_unsupported_question_backend_fail_explicitly() {
    let path = fixture();
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET host_id='remote' WHERE session_id='session'",
            [],
        )
        .unwrap();
    assert!(!read_attention_metadata(&path, None).unwrap()[0].questions_supported);
    connection
        .execute(
            "UPDATE sessions SET session_id=?1 WHERE session_id='session'",
            ["large".repeat(100_000)],
        )
        .unwrap();
    assert!(read_attention_metadata(&path, None)
        .unwrap_err()
        .to_string()
        .contains("identity"));
    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn metadata_helper_does_not_weaken_the_canonical_question_readers_goal_validation() {
    let path = fixture();
    create_session_goal(&path, "session", "private objective", None, None).unwrap();
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
            request_id: "question".into(),
            run_id: run.clone(),
            generation: run,
            text: "private".into(),
            choices: vec![],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    assert!(task_questions::pending_task_question(&path, "session")
        .unwrap()
        .is_some());
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute("UPDATE session_goals SET last_failure_json='invalid fixture json' WHERE session_id='session'",[]).unwrap();
    assert!(task_questions::pending_task_question(&path, "session").is_err());
    // The passive identity projection is never a question mutation capability.
    assert!(read_attention_metadata(&path, Some("session")).unwrap()[0]
        .question
        .is_some());
    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[path = "attention_scope_tests.rs"]
mod scope;
