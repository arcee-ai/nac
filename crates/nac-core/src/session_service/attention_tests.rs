use super::*;
use crate::model::ModelClient;

#[derive(Default)]
struct Observer(StdMutex<Vec<AttentionServiceSnapshot>>);
impl AttentionServiceObserver for Observer {
    fn service_changed(&self, _id: &str, snapshot: AttentionServiceSnapshot) {
        self.0.lock().unwrap().push(snapshot);
    }
}

#[tokio::test]
async fn actual_goal_settlement_publishes_only_after_existing_continuation_boundary() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-settlement",
        "session",
        ModelClient::new_for_test(),
    );
    let observer = Arc::new(Observer::default());
    let registration = parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let active = parts.service.try_begin_run(None, "work").unwrap();
    let goal = parts
        .service
        .create_direct_goal("finish work", None)
        .await
        .unwrap();
    crate::store::update_session_goal_by_model(
        &path,
        "session",
        &goal.goal_id,
        crate::store::GoalStatus::Complete,
    )
    .unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_for_test(Message::User {
                content: "work".into(),
            })
            .await
            .unwrap();
        agent
            .push_and_log_for_test(Message::Assistant {
                content: Some("done".into()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            })
            .await
            .unwrap();
    }
    assert!(
        parts
            .service
            .finish_run_once(&active.run_id, RunOutcome::Completed("done".into(), None))
            .await
    );
    let observations = observer.0.lock().unwrap();
    let completed = observations
        .iter()
        .filter(|snapshot| {
            snapshot
                .settled
                .as_ref()
                .is_some_and(|work| work.disposition == SettledWorkDisposition::Completed)
        })
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].operation, AttentionOperation::Idle);
    assert_eq!(
        completed[0].settled.as_ref().unwrap().run_id,
        active.run_id.as_str()
    );
    assert_eq!(
        completed[0]
            .settled
            .as_ref()
            .unwrap()
            .goal
            .as_ref()
            .unwrap()
            .id,
        goal.goal_id
    );
    assert!(observations
        .windows(2)
        .all(|pair| pair[0].epoch == pair[1].epoch && pair[0].revision < pair[1].revision));
    drop(observations);
    parts.service.remove_attention_observer(registration);
    assert!(!parts.service.attention_enabled());
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn real_selector_distinguishes_unverified_idle_foreign_owner_and_stopping() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-selection",
        "session",
        ModelClient::new_for_test(),
    );
    assert_eq!(
        parts
            .service
            .select_next_direct_inbox_item()
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::IdleUnverified
    );
    let goal = crate::store::create_session_goal(&path, "session", "done", None, None).unwrap();
    crate::store::update_session_goal_by_model(
        &path,
        "session",
        &goal.goal_id,
        crate::store::GoalStatus::Complete,
    )
    .unwrap();
    let lease = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
    assert_eq!(
        parts
            .service
            .select_next_direct_inbox_item()
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::ForeignOwner
    );
    drop(lease);
    parts.service.stop_run_admission().await.unwrap();
    assert_eq!(
        parts
            .service
            .select_next_direct_inbox_item()
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::Stopping
    );
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn stale_detach_and_unknown_goal_settlement_cannot_publish_completion() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-registration",
        "session",
        ModelClient::new_for_test(),
    );
    let first = Arc::new(Observer::default());
    let old = parts.service.install_attention_observer(first).unwrap();
    let second = Arc::new(Observer::default());
    let current = parts
        .service
        .install_attention_observer(second.clone())
        .unwrap();
    parts.service.remove_attention_observer(old);
    assert!(parts.service.attention_enabled());
    parts.service.publish_attention_completion(
        &SessionRunId::from_stored("run".into()),
        true,
        GoalAttentionSettlement {
            known: false,
            goal: None,
        },
        ContinuationDisposition::Idle {
            goal: None,
            last_run: None,
        },
    );
    assert!(second
        .0
        .lock()
        .unwrap()
        .iter()
        .all(|snapshot| snapshot.settled.is_none()));
    parts.service.remove_attention_observer(current);
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn real_question_yield_does_not_complete_an_active_goal_or_start_an_observer_run() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-question-yield",
        "session",
        ModelClient::new_for_test(),
    );
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let active = parts.service.try_begin_run(None, "work").unwrap();
    let goal = parts
        .service
        .create_direct_goal("wait for person", None)
        .await
        .unwrap();
    crate::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "session",
            sessions::load_session(&path, "session")
                .unwrap()
                .messages
                .len() as u64,
            &Message::User {
                content: "private prompt".into(),
            },
            active.run_id.as_str(),
        )
        .unwrap();
    crate::store::create_task_question(
        &path,
        &crate::store::QuestionRequest {
            session_id: "session".into(),
            request_id: "choice".into(),
            run_id: active.run_id.to_string(),
            generation: active.run_id.to_string(),
            text: "Choose".into(),
            choices: vec![],
            responder_class: crate::store::QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    assert!(
        parts
            .service
            .finish_run_once(
                &active.run_id,
                RunOutcome::Completed("question yielded".into(), None)
            )
            .await
    );
    let observations = observer.0.lock().unwrap();
    assert!(observations.iter().all(|snapshot| snapshot
        .settled
        .as_ref()
        .is_none_or(|work| work.disposition != SettledWorkDisposition::Completed)));
    assert!(observations.iter().any(|snapshot| snapshot
        .settled
        .as_ref()
        .is_some_and(|work| work.disposition == SettledWorkDisposition::WaitingForDecision)));
    assert!(!parts.service.has_active_operation());
    let current = crate::store::load_session_goal(&path, "session")
        .unwrap()
        .unwrap();
    assert_eq!(current.goal_id, goal.goal_id);
    assert_eq!(current.status, crate::store::GoalStatus::Active);
    assert!(current.accounting_run_id.is_none());
    drop(observations);
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
