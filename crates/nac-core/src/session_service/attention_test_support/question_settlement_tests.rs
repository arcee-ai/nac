#![expect(
    clippy::unwrap_used,
    reason = "isolated exact-frontier fixture assertions"
)]
use super::*;
use crate::model::ModelClient;
use crate::store::{QuestionAnswer, QuestionRecord, QuestionRequest};

async fn source_question(
    label: &str,
    model: ModelClient,
) -> (SessionServiceParts, PathBuf, SessionRunId, QuestionRecord) {
    let (parts, path) =
        crate::session_service::tests::test_direct_active_service(label, "target", model);
    let run = parts
        .service
        .try_begin_run_inner(
            None,
            "source question",
            None,
            true,
            RunAdmissionKind::default(),
        )
        .unwrap();
    let message = Message::User {
        content: "source question".into(),
    };
    let snapshot = sessions::load_session(&path, "target").unwrap();
    let writer = {
        let active = parts.service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(state)) = active.as_ref() else {
            panic!("source run must own its append lease")
        };
        crate::store::TranscriptLogWriter::for_run(
            &path,
            "target",
            run.run_id.as_str(),
            state._operation_lease.as_ref().unwrap(),
        )
        .unwrap()
    };
    writer
        .append_run_prompt(
            "target",
            snapshot.messages.len() as u64,
            &message,
            run.run_id.as_str(),
        )
        .unwrap();
    parts.service.agent.lock().await.messages.push(message);
    parts
        .service
        .run_prompt_commit(&run.run_id)
        .unwrap()
        .send_replace(RunPromptCommitStatus::Committed);
    parts
        .service
        .create_direct_goal("finish bounded work", Some(15))
        .await
        .unwrap();
    let question = crate::store::create_task_question(
        &path,
        &QuestionRequest {
            session_id: "target".into(),
            request_id: "exact".into(),
            run_id: run.run_id.to_string(),
            generation: run.run_id.to_string(),
            text: "Which format?".into(),
            choices: vec![],
            responder_class: crate::store::QuestionResponder::HumanDecision,
        },
        parts.service.config_version.unwrap(),
    )
    .unwrap();
    (parts, path, run.run_id, question)
}

#[tokio::test]
async fn question_registration_requires_exact_run_generation_and_selection_kind() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "question-frontier-identity",
        "target",
        ModelClient::new_for_test(),
    );
    assert!(parts
        .service
        .hold_question_settlement_for_test("", "")
        .is_err());
    assert!(parts
        .service
        .hold_question_settlement_for_test("run", "different-generation")
        .is_err());
    let guard = parts
        .service
        .hold_question_settlement_for_test("run", "run")
        .unwrap();
    assert!(parts
        .service
        .hold_question_settlement_for_test("run", "run")
        .is_err());
    let idle = parts
        .service
        .hold_attention_publication_for_test("run")
        .unwrap();
    let key = guard.0.key.clone();
    use attention::ContinuationDisposition as D;
    for rejected in [
        D::IdleUnverified,
        D::Busy,
        D::ForeignOwner,
        D::Stopping,
        D::RetryScheduled,
        D::Idle {
            goal: None,
            last_run: Some("run".into()),
        },
        D::Started {
            successor: SessionRunId::from_stored("successor".into()),
        },
    ] {
        assert!(
            wait(&key, &rejected, &AtomicBool::new(true), Duration::ZERO)
                .await
                .is_none()
        );
        assert!(!guard.0.state.question_settled.load(Ordering::Acquire));
        assert!(BARRIERS.lock().unwrap().contains_key(&key));
    }
    for wrong in [
        Key {
            run: "other-run".into(),
            ..key.clone()
        },
        Key {
            session: "other-session".into(),
            ..key.clone()
        },
        Key {
            store: path.with_file_name("other.db"),
            ..key.clone()
        },
    ] {
        assert!(wait(
            &wrong,
            &D::WaitingForQuestion,
            &AtomicBool::new(true),
            Duration::ZERO
        )
        .await
        .is_none());
    }
    // The old Idle hook still refuses this disposition and retains its registration.
    assert!(wait(
        &idle.key,
        &D::WaitingForQuestion,
        &AtomicBool::new(true),
        Duration::ZERO
    )
    .await
    .is_none());
    assert!(BARRIERS.lock().unwrap().contains_key(&idle.key));
    let witness = wait(
        &key,
        &D::WaitingForQuestion,
        &AtomicBool::new(true),
        Duration::ZERO,
    )
    .await
    .unwrap();
    guard.arrived().await.unwrap();
    assert!(guard.0.state.selection.lock().unwrap().is_none());
    assert!(wait(
        &key,
        &D::WaitingForQuestion,
        &AtomicBool::new(true),
        Duration::ZERO
    )
    .await
    .is_none());
    witness.publication_attempted();
    drop(guard);
    drop(idle);
    assert!(!BARRIERS.lock().unwrap().contains_key(&key));
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn idle_slot_with_actual_operation_lease_is_not_question_readiness() {
    let (parts, path, run, question) =
        source_question("question-frontier-lease", ModelClient::new_for_test()).await;
    assert!(
        parts
            .service
            .finish_run_once(&run, RunOutcome::Completed("waiting".into(), None))
            .await
    );
    let guard = parts
        .service
        .hold_question_settlement_for_test(run.as_str(), run.as_str())
        .unwrap();
    let lease = sessions::SessionOperationLease::try_acquire(&path, "target").unwrap();
    assert!(!parts.service.has_active_operation());
    assert!(!guard.0.state.question_settled.load(Ordering::Acquire));
    let error = parts
        .service
        .answer_task_question(QuestionAnswer {
            request_id: "exact".into(),
            run_id: run.to_string(),
            generation: run.to_string(),
            expected_revision: question.revision,
            answer: "CSV".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<crate::store::QuestionError>(),
        Some(&crate::store::QuestionError::Conflict)
    );
    assert_eq!(
        crate::store::pending_task_question(&path, "target").unwrap(),
        Some(question)
    );
    assert!(crate::store::list_session_inbox(&path, "target")
        .unwrap()
        .is_empty());
    assert!(!guard.0.state.question_settled.load(Ordering::Acquire));
    drop(lease);
    drop(guard);
    parts.service.stop_run_admission().await.unwrap();
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn actual_question_frontier_is_after_selector_and_lease_free() {
    let (parts, path, run, question) =
        source_question("question-frontier-settled", ModelClient::new_for_test()).await;
    let goal = crate::store::load_session_goal(&path, "target")
        .unwrap()
        .unwrap();
    let guard = parts
        .service
        .hold_question_settlement_for_test(run.as_str(), run.as_str())
        .unwrap();
    let finishing = tokio::spawn({
        let service = parts.service.clone();
        let run = run.clone();
        async move {
            service
                .finish_run_once(&run, RunOutcome::Completed("waiting".into(), None))
                .await
        }
    });
    guard.arrived().await.unwrap();
    assert!(
        !finishing.is_finished(),
        "the real settlement is parked at its post-selection boundary"
    );
    assert!(!parts.service.has_active_operation());
    let lease = sessions::SessionOperationLease::try_acquire(&path, "target").unwrap();
    drop(lease);
    assert_eq!(
        crate::store::pending_task_question(&path, "target").unwrap(),
        Some(question)
    );
    let reconciled = crate::store::load_session_goal(&path, "target")
        .unwrap()
        .unwrap();
    assert_eq!(reconciled.goal_id, goal.goal_id);
    assert!(reconciled.accounting_run_id.is_none());
    assert!(parts.service.inbox_wake.try_lock().is_ok());
    guard.release();
    assert!(tokio::time::timeout(Duration::from_secs(5), finishing)
        .await
        .unwrap()
        .unwrap());
    drop(guard);
    parts.service.stop_run_admission().await.unwrap();
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn queued_input_keeps_priority_and_cannot_claim_predecessor_question_frontier() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let (release, wait_for_release) = std::sync::mpsc::channel();
    let provider = ScriptedServer::start_observed(vec![ScriptedResponse::json("200 OK", serde_json::json!({
        "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"guidance handled"}]}]
    }).to_string())], move |_, _| { wait_for_release.recv_timeout(Duration::from_secs(5)).unwrap(); });
    let (parts, path, run, question) = source_question(
        "question-frontier-queue",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    )
    .await;
    let queued = crate::store::create_session_inbox_item(
        &path,
        "target",
        crate::store::InboxDelivery::Queue,
        "ordinary guidance",
        None,
        None,
    )
    .unwrap();
    let guard = parts
        .service
        .hold_question_settlement_for_test(run.as_str(), run.as_str())
        .unwrap();
    assert!(
        parts
            .service
            .finish_run_once(&run, RunOutcome::Completed("waiting".into(), None))
            .await
    );
    let (successor, task) = {
        let mut active = parts.service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active)) = active.as_mut() else {
            panic!("queued input must be admitted before the question gate")
        };
        assert_eq!(active.inbox_item_id, Some(queued.id));
        (active.snapshot.run_id.clone(), active.task.take().unwrap())
    };
    assert_ne!(successor, run);
    assert!(!guard.0.state.question_settled.load(Ordering::Acquire));
    assert_eq!(
        crate::store::pending_task_question(&path, "target").unwrap(),
        Some(question.clone())
    );
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(provider.finish().len(), 1);
    // A later guidance run's WaitingForQuestion is not this source run's frontier.
    assert!(!guard.0.state.question_settled.load(Ordering::Acquire));
    assert_eq!(
        crate::store::pending_task_question(&path, "target").unwrap(),
        Some(question)
    );
    drop(guard);
    parts.service.stop_run_admission().await.unwrap();
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
