use super::*;
use crate::model::ModelClient;

#[path = "attention_goal_free_tests.rs"]
mod goal_free;

#[derive(Default)]
struct Observer(StdMutex<Vec<AttentionServiceSnapshot>>, StdMutex<Vec<Uuid>>);
impl AttentionServiceObserver for Observer {
    fn service_changed(&self, _id: &str, snapshot: AttentionServiceSnapshot) {
        self.0.lock().unwrap().push(snapshot);
    }
    fn service_retired(&self, _: &str, epoch: Uuid) {
        self.1.lock().unwrap().push(epoch);
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

#[tokio::test]
async fn actual_permission_bridge_rejects_older_callbacks_and_optout_does_not_hold_an_approver() {
    use crate::events::AttentionBrokerState;
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-broker",
        "session",
        ModelClient::new_for_test(),
    );
    let observer = Arc::new(Observer::default());
    let registration = parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    assert!(!parts.service.event_bus.has_interactive_subscribers());
    let interactive = parts.service.event_bus.subscribe_assistant_deltas();
    let broker = parts.service.permission_broker.as_ref().unwrap().clone();
    let request = {
        let broker = broker.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[crate::tools::kernel::PermissionResource::new(
                        "execute",
                        "command:[curl][private.example]",
                    )],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while broker.pending().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let pending = observer
        .0
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .broker
        .clone()
        .unwrap();
    let id = broker.pending()[0].id.clone();
    assert!(
        matches!(&pending.state, AttentionBrokerState::Current { permissions, .. } if permissions == &[Uuid::parse_str(&id).unwrap()])
    );
    assert!(!format!("{pending:?}").contains("private.example"));
    broker
        .reply(&id, crate::permissions::PermissionReply::Reject)
        .unwrap();
    request.await.unwrap();
    let (bridge, broker_registration) = {
        let state = parts.service.attention.lock().unwrap();
        let state = state.as_ref().unwrap();
        (
            state._broker_observer.as_ref().unwrap().clone(),
            state.broker_registration.as_ref().unwrap().1,
        )
    };
    let receipts = observer.0.lock().unwrap().len();
    bridge.broker_changed(broker_registration, pending);
    assert_eq!(
        observer.0.lock().unwrap().len(),
        receipts,
        "late pending snapshot cannot resurrect resolved request"
    );
    parts.service.remove_attention_observer(registration);
    assert_eq!(observer.1.lock().unwrap().len(), 1);
    drop(interactive);
    assert!(!parts.service.event_bus.has_interactive_subscribers());
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn actual_idle_service_drop_retires_observation_without_a_strong_service_or_broker_cycle() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-drop",
        "session",
        ModelClient::new_for_test(),
    );
    let observer = Arc::new(Observer::default());
    let weak = Arc::downgrade(&parts.service.attention);
    let broker = Arc::downgrade(parts.service.permission_broker.as_ref().unwrap());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    drop(parts);
    assert!(weak.upgrade().is_none());
    assert!(broker.upgrade().is_none());
    assert_eq!(observer.1.lock().unwrap().len(), 1);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[cfg(feature = "test-support")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_review_retry_restores_only_before_enqueue_and_stays_removed_after_committed_wake_failure(
) {
    use crate::permissions::{
        PermissionApprovalMode, PermissionReviewer, ReviewCategory, ReviewRequest,
        ReviewUnavailable, ReviewVerdict,
    };
    struct Rejector;
    impl PermissionReviewer for Rejector {
        fn review<'a>(
            &'a self,
            _: &'a ReviewRequest,
        ) -> futures_util::future::BoxFuture<
            'a,
            std::result::Result<ReviewVerdict, ReviewUnavailable>,
        > {
            Box::pin(async { Ok(ReviewVerdict::Reject(ReviewCategory::OutOfScope)) })
        }
        fn check_available(&self) -> std::result::Result<(), String> {
            Ok(())
        }
        fn identity(&self) -> String {
            "local-fixture".into()
        }
    }
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-retry",
        "session",
        ModelClient::new_for_test(),
    );
    let broker = parts.service.permission_broker.as_ref().unwrap().clone();
    broker.set_reviewer(Arc::new(Rejector));
    parts
        .service
        .set_permission_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    crate::store::record_review_intent(
        &crate::store::open_runtime_connection(&path).unwrap(),
        "session",
        "work locally",
    )
    .unwrap();
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let outcome = broker
        .authorize(
            "exec_command",
            &[crate::tools::kernel::PermissionResource::new(
                "execute",
                "command:[mkdir][private]",
            )],
            &crate::tools::kernel::ToolCallContext::default(),
            &crate::tools::ThreadCancellation::default(),
        )
        .await;
    assert!(matches!(
        outcome,
        crate::permissions::AuthorizationOutcome::Denied(_)
    ));
    let id = broker.blocked_reviews()[0].id.clone();
    assert!(Uuid::parse_str(&id).is_ok());
    SessionService::fail_next_retry_enqueue_for_test();
    assert!(parts
        .service
        .authorize_permission_review_retry(&id)
        .await
        .is_err());
    assert_eq!(broker.blocked_reviews()[0].id, id);
    assert!(parts.service.list_direct_inbox().unwrap().is_empty());
    let restored = observer
        .0
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .broker
        .clone()
        .unwrap();
    assert!(
        matches!(restored.state, AttentionBrokerState::Current { authorizable_reviews, .. } if authorizable_reviews == [Uuid::parse_str(&id).unwrap()])
    );
    SessionService::fail_next_retry_wake_for_test();
    parts
        .service
        .authorize_permission_review_retry(&id)
        .await
        .unwrap();
    assert!(broker.blocked_reviews().is_empty());
    assert_eq!(parts.service.list_direct_inbox().unwrap().len(), 1);
    assert!(parts
        .service
        .authorize_permission_review_retry(&id)
        .await
        .is_err());
    assert_eq!(parts.service.list_direct_inbox().unwrap().len(), 1);
    let removed = observer
        .0
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .broker
        .clone()
        .unwrap();
    assert!(
        matches!(removed.state, AttentionBrokerState::Current { authorizable_reviews, .. } if authorizable_reviews.is_empty())
    );
    assert_eq!(
        parts.service.permission_approval_mode().await.unwrap(),
        PermissionApprovalMode::Review
    );
    assert!(broker.grants().unwrap().is_empty());
    drop(parts);
    drop(broker);
    owner.shutdown().await.unwrap();
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
