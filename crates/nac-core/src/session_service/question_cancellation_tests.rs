use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;
use crate::store::{GoalStatus, QuestionResponder, TaskLookup};
use crate::types::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tokio::task::JoinSet;

async fn response_gate() -> (
    String,
    oneshot::Receiver<String>,
    oneshot::Sender<()>,
    JoinSet<()>,
) {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (seen, request) = oneshot::channel();
    let (release, wait) = oneshot::channel();
    let mut tasks = JoinSet::new();
    tasks.spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        let body = loop {
            let mut chunk = [0; 4096];
            let count = stream.read(&mut chunk).await.unwrap();
            assert!(count > 0, "request ended before its body");
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                let size: usize = String::from_utf8_lossy(&bytes[..end])
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().unwrap())
                    })
                    .unwrap();
                if bytes.len() >= end + 4 + size {
                    break String::from_utf8(bytes[end + 4..end + 4 + size].to_vec()).unwrap();
                }
            }
        };
        seen.send(body).unwrap();
        wait.await.unwrap();
        let body = serde_json::json!({
            "status":"completed",
            "output":[{"type":"message","content":[{"type":"output_text","text":"continued"}]}],
            "usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}
        }).to_string();
        stream.write_all(format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        ).as_bytes()).await.unwrap();
    });
    (url, request, release, tasks)
}

async fn settled_question(
    label: &str,
    url: String,
    goal_status: Option<GoalStatus>,
) -> (SessionService, PathBuf, QuestionRecord) {
    let (parts, path) =
        test_direct_active_service(label, "target", ModelClient::new_for_test_server(url));
    let service = parts.service;
    let run = service
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
        let active = service.lock_active_operation();
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
    service.agent.lock().await.messages.push(message);
    service
        .run_prompt_commit(&run.run_id)
        .unwrap()
        .send_replace(RunPromptCommitStatus::Committed);
    if let Some(status) = goal_status {
        let goal = service
            .create_direct_goal("finish the bounded task", Some(15))
            .await
            .unwrap();
        if status != GoalStatus::Active {
            service
                .update_direct_goal(
                    &goal.goal_id,
                    goal.version,
                    crate::store::UserGoalUpdate {
                        status: Some(status),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
        }
    }
    let question = crate::store::create_task_question(
        &path,
        &QuestionRequest {
            session_id: "target".into(),
            request_id: "exact".into(),
            run_id: run.run_id.to_string(),
            generation: run.run_id.to_string(),
            text: "Which format?".into(),
            choices: vec![],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    // This returns only after settlement's ordinary wake has encountered the
    // pending question. Cancelling before this seam would hide B1.
    assert!(
        service
            .finish_run_once(&run.run_id, RunOutcome::Completed("waiting".into(), None))
            .await
    );
    assert!(service.active_run().is_none());
    assert_eq!(
        crate::store::pending_task_question(&path, "target").unwrap(),
        Some(question.clone())
    );
    (service, path, question)
}

async fn task(path: &Path) -> crate::store::DirectTaskSnapshot {
    let path = path.to_path_buf();
    match crate::store::spawn_blocking_store_caller(move || {
        crate::store::load_direct_task(&path, "target")
    })
    .await
    .unwrap()
    .unwrap()
    {
        TaskLookup::Found(snapshot) => *snapshot,
        other => panic!("expected direct task, got {other:?}"),
    }
}

async fn finish_continuation(
    service: &SessionService,
    request: oneshot::Receiver<String>,
    release: oneshot::Sender<()>,
    mut server: JoinSet<()>,
) {
    let body = tokio::time::timeout(Duration::from_secs(5), request)
        .await
        .unwrap()
        .unwrap();
    assert!(body.contains("nac_goal_continuation"), "{body}");
    let (mut settled, task) = {
        let mut active = service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(run)) = active.as_mut() else {
            panic!("ordinary continuation must remain active at the HTTP barrier")
        };
        (run.settlement.subscribe(), run.task.take().unwrap())
    };
    release.send(()).unwrap();
    server.join_next().await.unwrap().unwrap();
    tokio::time::timeout(Duration::from_secs(5), settled.wait_for(|done| *done))
        .await
        .unwrap()
        .unwrap();
    // The run still performs its final ordinary wake after signalling
    // settlement. Join it before deleting the fixture's store directory.
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    // Settlement signals while clearing the operation under its guard. Wait
    // for that guard to publish the idle snapshot before reading the cache.
    assert!(service.lock_active_operation().is_none());
    assert!(service.active_run().is_none());
}

#[tokio::test]
async fn cancelled_question_after_settlement_wakes_one_ordinary_active_goal_continuation() {
    let (url, request, release, server) = response_gate().await;
    let (service, path, question) =
        settled_question("question_cancel_settled", url, Some(GoalStatus::Active)).await;
    let before = task(&path).await;
    let cancelled = service
        .cancel_task_question("exact".into(), question.revision)
        .await
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert!(cancelled.answer.is_none());
    assert!(cancelled.continuation_state.is_none());
    assert!(service.active_run().is_some(), "successful idle question cancellation must admit the eligible goal without another attach or input");
    finish_continuation(&service, request, release, server).await;
    let after = task(&path).await;
    assert_eq!(after.run_count, before.run_count + 1);
    assert_eq!(
        after.goal.as_ref().unwrap().status,
        GoalStatus::BudgetLimited
    );
    assert!(after.pending_question.is_none());
    assert!(crate::store::list_session_inbox(&path, "target")
        .unwrap()
        .is_empty());
    assert_eq!(
        crate::store::load_task_question(&path, "target", "exact").unwrap(),
        Some(cancelled)
    );
    service.stop_run_admission().await.unwrap();
    drop(service);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn question_cancel_preserves_paused_and_goal_free_idle_states() {
    for goal in [None, Some(GoalStatus::Paused)] {
        let (service, path, q) = settled_question(
            "question_cancel_no_autostart",
            "http://127.0.0.1:1".into(),
            goal,
        )
        .await;
        let before = task(&path).await;
        service
            .cancel_task_question("exact".into(), q.revision)
            .await
            .unwrap();
        let after = task(&path).await;
        assert_eq!(after.run_count, before.run_count);
        assert_eq!(after.goal, before.goal);
        assert!(service.active_run().is_none());
        assert!(after.pending_question.is_none());
        assert!(crate::store::list_session_inbox(&path, "target")
            .unwrap()
            .is_empty());
        service.stop_run_admission().await.unwrap();
        drop(service);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[tokio::test]
async fn denied_or_stale_question_cancellation_does_not_clear_gate_or_wake() {
    use crate::permissions::{
        PermissionBackend, PermissionBroker, PermissionEffect, PermissionRule,
    };
    for denied in [false, true] {
        let (mut service, path, q) = settled_question(
            "question_cancel_rejected",
            "http://127.0.0.1:1".into(),
            Some(GoalStatus::Active),
        )
        .await;
        if denied {
            service.permission_broker = Some(Arc::new(PermissionBroker::new(
                path.clone(),
                "target".into(),
                PermissionBackend::Local,
                0,
                [PermissionRule::new(
                    "task_question_cancel",
                    "session:target/question:exact",
                    PermissionEffect::Deny,
                )],
            )));
        }
        let before = task(&path).await;
        let error = service
            .cancel_task_question(
                "exact".into(),
                if denied { q.revision } else { q.revision + 1 },
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.downcast_ref::<crate::store::QuestionError>(),
            Some(if denied {
                &crate::store::QuestionError::Denied
            } else {
                &crate::store::QuestionError::Conflict
            })
        );
        let after = task(&path).await;
        assert_eq!(after.run_count, before.run_count);
        assert_eq!(after.pending_question, Some(q));
        assert!(service.active_run().is_none());
        assert!(sessions::SessionOperationLease::try_acquire(&path, "target").is_ok());
        service.stop_run_admission().await.unwrap();
        drop(service);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[tokio::test]
async fn question_cancellation_respects_foreign_idle_lease_and_shutdown_fence() {
    let (service, path, q) = settled_question(
        "question_cancel_fences",
        "http://127.0.0.1:1".into(),
        Some(GoalStatus::Active),
    )
    .await;
    let peer = sessions::SessionOperationLease::try_acquire(&path, "target").unwrap();
    let error = service
        .cancel_task_question("exact".into(), q.revision)
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<crate::store::QuestionError>(),
        Some(&crate::store::QuestionError::Conflict)
    );
    assert_eq!(task(&path).await.pending_question, Some(q.clone()));
    drop(peer);
    service.stop_run_admission().await.unwrap();
    let error = service
        .cancel_task_question("exact".into(), q.revision)
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<crate::store::QuestionError>(),
        Some(&crate::store::QuestionError::Unavailable)
    );
    assert_eq!(task(&path).await.pending_question, Some(q));
    assert!(service.active_run().is_none());
    drop(service);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn question_cancellation_keeps_active_guidance_and_lets_its_settlement_wake() {
    let (url, request, release, server) = response_gate().await;
    let (service, path, q) =
        settled_question("question_cancel_guidance", url, Some(GoalStatus::Active)).await;
    let before = task(&path).await;
    let guidance = service
        .try_begin_run_inner(
            None,
            "unrelated guidance",
            None,
            true,
            RunAdmissionKind::default(),
        )
        .unwrap();
    let writer = {
        let active = service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(run)) = active.as_ref() else {
            panic!("guidance must be active")
        };
        crate::store::TranscriptLogWriter::for_run(
            &path,
            "target",
            guidance.run_id.as_str(),
            run._operation_lease.as_ref().unwrap(),
        )
        .unwrap()
    };
    let message = Message::User {
        content: "unrelated guidance".into(),
    };
    let mut messages = sessions::load_session(&path, "target").unwrap().messages;
    let tail = writer
        .read_tail_from("target", messages.len() as u64)
        .unwrap();
    messages.extend(tail.into_iter().map(|(_, message)| message));
    writer
        .append_run_prompt(
            "target",
            messages.len() as u64,
            &message,
            guidance.run_id.as_str(),
        )
        .unwrap();
    messages.push(message);
    service.agent.lock().await.messages = messages;
    service
        .run_prompt_commit(&guidance.run_id)
        .unwrap()
        .send_replace(RunPromptCommitStatus::Committed);
    service
        .cancel_task_question("exact".into(), q.revision)
        .await
        .unwrap();
    assert_eq!(service.active_run().unwrap().run_id, guidance.run_id);
    assert!(
        service
            .finish_run_once(
                &guidance.run_id,
                RunOutcome::Completed("guidance handled".into(), None)
            )
            .await
    );
    finish_continuation(&service, request, release, server).await;
    let after = task(&path).await;
    assert_eq!(after.run_count, before.run_count + 2);
    assert_eq!(after.goal.unwrap().status, GoalStatus::BudgetLimited);
    assert!(crate::store::list_session_inbox(&path, "target")
        .unwrap()
        .is_empty());
    service.stop_run_admission().await.unwrap();
    drop(service);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn cancelling_accepted_answer_retains_receipt_without_delivering_its_reserved_run() {
    let (service, path, q) = settled_question(
        "question_cancel_answer",
        "http://127.0.0.1:1".into(),
        Some(GoalStatus::Paused),
    )
    .await;
    let before = task(&path).await;
    let answer = QuestionAnswer {
        request_id: q.request.request_id.clone(),
        run_id: q.request.run_id.clone(),
        generation: q.request.generation.clone(),
        expected_revision: q.revision,
        answer: "CSV".into(),
    };
    let receipt =
        crate::store::task_questions::answer_task_question(&path, "target", &answer, None, 0)
            .unwrap()
            .receipt;
    let cancelled = service
        .cancel_task_question("exact".into(), receipt.revision)
        .await
        .unwrap();
    assert_eq!(cancelled.answer, Some(receipt.clone()));
    assert_eq!(cancelled.continuation_state.as_deref(), Some("cancelled"));
    assert_eq!(service.answer_task_question(answer).await.unwrap(), receipt);
    assert_eq!(task(&path).await.run_count, before.run_count);
    assert!(service.active_run().is_none());
    let inbox = crate::store::list_session_inbox(&path, "target").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].status, crate::store::InboxStatus::Cancelled);
    assert!(
        crate::store::question_continuation_run(&path, "target", receipt.inbox_item_id).is_err()
    );
    service.stop_run_admission().await.unwrap();
    drop(service);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

async fn queued_at_least(owner: &crate::store::StoreCoordinator, count: usize) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while owner.stats().queued < count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn abandoned_question_cancel_caller_retains_idle_lease_through_commit_and_wake() {
    let (url, request, release, server) = response_gate().await;
    let (service, path, q) =
        settled_question("question_cancel_abandonment", url, Some(GoalStatus::Active)).await;
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let (first, release_first, _) = crate::store::coordinator::block_executor(&owner);
    let caller_service = service.clone();
    let caller = tokio::spawn(async move {
        caller_service
            .cancel_task_question("exact".into(), q.revision)
            .await
    });
    queued_at_least(&owner, 1).await; // Public preflight is queued.
    let next_owner = owner.clone();
    let second =
        tokio::task::spawn_blocking(move || crate::store::coordinator::block_executor(&next_owner));
    queued_at_least(&owner, 2).await; // Fence is behind preflight, ahead of mutation.
    release_first.send(()).unwrap();
    first.acknowledge().await.unwrap();
    let (second, release_second, _) = second.await.unwrap();
    queued_at_least(&owner, 1).await; // Owned cancellation has queued its write.
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&path, "target"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    release_second.send(()).unwrap();
    second.acknowledge().await.unwrap();
    finish_continuation(&service, request, release, server).await;
    let after = task(&path).await;
    assert_eq!(after.goal.unwrap().status, GoalStatus::BudgetLimited);
    assert!(after.pending_question.is_none());
    assert!(owner
        .list_session_inbox("target".into())
        .await
        .unwrap()
        .is_empty());
    let q = owner
        .load_task_question("target".into(), "exact".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(q.status, "cancelled");
    assert!(q.answer.is_none());
    service.stop_run_admission().await.unwrap();
    owner.shutdown().await.unwrap();
    drop(service);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
