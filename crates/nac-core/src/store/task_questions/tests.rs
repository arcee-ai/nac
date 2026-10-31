use super::*;
use crate::types::Message;

fn fixture(class: QuestionResponder) -> (PathBuf, QuestionRecord) {
    fixture_with_goal(class, false)
}
fn fixture_with_goal(class: QuestionResponder, goal: bool) -> (PathBuf, QuestionRecord) {
    let path = std::env::temp_dir()
        .join(format!("nac-questions-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "target");
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id='target'",
            [],
        )
        .unwrap();
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "target",
            0,
            &Message::User {
                content: "start".into(),
            },
            &run,
        )
        .unwrap();
    if goal {
        create_session_goal(
            &path,
            "target",
            "finish the export",
            None,
            Some(&GoalRunBaseline {
                run_id: run.clone(),
                billable_tokens: 0,
                started_at_epoch_ms: 1,
                continuation: false,
            }),
        )
        .unwrap();
    }
    let question = create_task_question(
        &path,
        &QuestionRequest {
            session_id: "target".into(),
            request_id: "exact-question".into(),
            run_id: run.clone(),
            generation: run,
            text: "Which format?".into(),
            choices: vec!["CSV".into(), "JSON".into()],
            responder_class: class,
        },
        0,
    )
    .unwrap();
    (path, question)
}
fn answer(q: &QuestionRecord, text: &str) -> QuestionAnswer {
    QuestionAnswer {
        request_id: q.request.request_id.clone(),
        run_id: q.request.run_id.clone(),
        generation: q.request.generation.clone(),
        expected_revision: q.revision,
        answer: text.into(),
    }
}
fn end_run(path: &Path, run: &str, disposition: RunTerminalDisposition) {
    let mut conn = open_runtime_connection(path).unwrap();
    let tx = conn.transaction().unwrap();
    clear_active_run(&tx, "target", run, disposition).unwrap();
    tx.commit().unwrap();
}
fn cleanup(path: &Path) {
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn exact_creation_retries_conflict_on_changed_arguments_and_survive_restart() {
    let (path, q) = fixture(QuestionResponder::HumanDecision);
    assert_eq!(create_task_question(&path, &q.request, 0).unwrap(), q);
    let mut changed = q.request.clone();
    changed.text = "different".into();
    assert!(create_task_question(&path, &changed, 0)
        .unwrap_err()
        .is::<QuestionError>());
    changed = q.request.clone();
    changed.request_id = "replacement".into();
    assert!(create_task_question(&path, &changed, 0).is_err());
    initialize(&path).unwrap();
    assert_eq!(pending_task_question(&path, "target").unwrap(), Some(q));
    cleanup(&path);
}

#[test]
fn answer_receipt_is_stable_and_never_replaces_an_accepted_answer() {
    let (path, q) = fixture(QuestionResponder::Information);
    let input = answer(&q, "CSV");
    let first = answer_task_question(&path, "target", &input, None, 0).unwrap();
    let retry = answer_task_question(&path, "target", &input, None, 0).unwrap();
    assert_eq!(first.receipt, retry.receipt);
    assert!(retry.should_wake);
    initialize(&path).unwrap();
    assert_eq!(
        answer_task_question(&path, "target", &input, None, 0)
            .unwrap()
            .receipt,
        first.receipt
    );
    assert!(answer_task_question(&path, "target", &answer(&q, "JSON"), None, 0).is_err());
    assert_eq!(list_session_inbox(&path, "target").unwrap().len(), 1);
    let conn = open_runtime_connection(&path).unwrap();
    let intent: Option<String> = conn
        .query_row("SELECT review_intent FROM session_inbox", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        intent, None,
        "question responses never create approval intent"
    );
    cleanup(&path);
}

#[test]
fn concurrent_responders_admit_one_immutable_resolution() {
    let (path, q) = fixture(QuestionResponder::Information);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let handles: Vec<_> = ["CSV", "JSON"]
        .into_iter()
        .map(|text| {
            let (path, q, barrier) = (path.clone(), q.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                answer_task_question(&path, "target", &answer(&q, text), None, 0).map(|r| r.receipt)
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(list_session_inbox(&path, "target").unwrap().len(), 1);
    cleanup(&path);
}

#[test]
fn human_only_question_rejects_agents_even_when_the_answer_text_is_known() {
    let (path, q) = fixture(QuestionResponder::HumanDecision);
    let scope = QuestionAgentScope {
        caller_session_id: "target".into(),
        caller_run_id: q.request.run_id.clone(),
        caller_config_version: 0,
        explicit_project: None,
        target_project: None,
    };
    let error = answer_task_question(&path, "target", &answer(&q, "CSV"), Some(&scope), 0)
        .err()
        .unwrap();
    assert_eq!(
        error.downcast_ref::<QuestionError>(),
        Some(&QuestionError::HumanRequired)
    );
    assert!(list_session_inbox(&path, "target").unwrap().is_empty());
    assert!(answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0).is_ok());
    cleanup(&path);
}

#[test]
fn information_answer_revalidates_caller_run_config_and_project_scope() {
    let (path, q) = fixture(QuestionResponder::Information);
    let mut scope = QuestionAgentScope {
        caller_session_id: "target".into(),
        caller_run_id: uuid::Uuid::new_v4().to_string(),
        caller_config_version: 0,
        explicit_project: None,
        target_project: None,
    };
    assert!(answer_task_question(&path, "target", &answer(&q, "CSV"), Some(&scope), 0).is_err());
    scope.caller_run_id = q.request.run_id.clone();
    scope.caller_config_version = 1;
    assert!(answer_task_question(&path, "target", &answer(&q, "CSV"), Some(&scope), 0).is_err());
    scope.caller_config_version = 0;
    scope.explicit_project = Some("foreign".into());
    assert!(answer_task_question(&path, "target", &answer(&q, "CSV"), Some(&scope), 0).is_err());
    scope.explicit_project = None;
    assert!(answer_task_question(&path, "target", &answer(&q, "CSV"), Some(&scope), 0).is_ok());
    cleanup(&path);
}

#[test]
fn guidance_does_not_resolve_and_answer_can_only_commit_to_reserved_continuation() {
    let (path, q) = fixture(QuestionResponder::Information);
    end_run(&path, &q.request.run_id, RunTerminalDisposition::Completed);
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let guidance = uuid::Uuid::new_v4().to_string();
    writer
        .append_person_run_prompt(
            "target",
            1,
            &Message::User {
                content: "unrelated guidance".into(),
            },
            &guidance,
            "unrelated guidance",
        )
        .unwrap();
    assert_eq!(
        pending_task_question(&path, "target").unwrap(),
        Some(q.clone())
    );
    let accepted = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0)
        .unwrap()
        .receipt;
    let item = load_session_inbox_item(&path, "target", accepted.inbox_item_id).unwrap();
    assert_eq!(item.delivery, InboxDelivery::Queue);
    assert_eq!(item.target_run_id, None);
    assert!(update_pending_session_inbox_item(
        &path,
        "target",
        item.id,
        item.version,
        InboxDelivery::Steer,
        Some(&guidance)
    )
    .is_err());
    end_run(&path, &guidance, RunTerminalDisposition::Completed);
    initialize(&path).unwrap();
    let prompt = Message::User {
        content: item.content,
    };
    assert!(writer
        .append_inbox_run_prompt(
            "target",
            2,
            &prompt,
            &uuid::Uuid::new_v4().to_string(),
            item.id
        )
        .is_err());
    assert_eq!(
        load_session_inbox_item(&path, "target", item.id)
            .unwrap()
            .status,
        InboxStatus::Pending
    );
    writer
        .append_inbox_run_prompt("target", 2, &prompt, &accepted.continuation_run_id, item.id)
        .unwrap();
    writer
        .append_inbox_run_prompt("target", 2, &prompt, &accepted.continuation_run_id, item.id)
        .unwrap();
    assert_eq!(
        load_task_question(&path, "target", &q.request.request_id)
            .unwrap()
            .unwrap()
            .continuation_state
            .as_deref(),
        Some("delivered")
    );
    let retry = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0).unwrap();
    assert_eq!(retry.receipt, accepted);
    assert!(!retry.should_wake);
    cleanup(&path);
}

#[test]
fn cancellation_preserves_accepted_receipt_and_invalidates_undelivered_obligation() {
    let (path, q) = fixture(QuestionResponder::Information);
    let receipt = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0)
        .unwrap()
        .receipt;
    let cancelled =
        cancel_task_question(&path, "target", &q.request.request_id, receipt.revision).unwrap();
    assert_eq!(cancelled.answer, Some(receipt.clone()));
    assert_eq!(cancelled.continuation_state.as_deref(), Some("cancelled"));
    let replay = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0).unwrap();
    assert_eq!(replay.receipt, receipt);
    assert!(!replay.should_wake);
    assert!(question_continuation_run(&path, "target", receipt.inbox_item_id).is_err());
    assert_eq!(
        load_session_inbox_item(&path, "target", receipt.inbox_item_id)
            .unwrap()
            .status,
        InboxStatus::Cancelled
    );
    cleanup(&path);
}

#[test]
fn cancelled_source_and_stale_generation_never_answer_a_replacement_request() {
    let (path, q) = fixture(QuestionResponder::Information);
    let mut stale = answer(&q, "CSV");
    stale.generation = uuid::Uuid::new_v4().to_string();
    assert!(answer_task_question(&path, "target", &stale, None, 0).is_err());
    stale = answer(&q, "CSV");
    stale.expected_revision += 1;
    assert!(answer_task_question(&path, "target", &stale, None, 0).is_err());
    end_run(&path, &q.request.run_id, RunTerminalDisposition::Cancelled);
    assert_eq!(
        load_task_question(&path, "target", &q.request.request_id)
            .unwrap()
            .unwrap()
            .status,
        "cancelled"
    );
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "target",
            1,
            &Message::User {
                content: "replacement".into(),
            },
            &run,
        )
        .unwrap();
    let mut next = q.request.clone();
    next.request_id = "replacement".into();
    next.run_id = run.clone();
    next.generation = run;
    create_task_question(&path, &next, 0).unwrap();
    assert!(answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0).is_err());
    assert_eq!(
        pending_task_question(&path, "target")
            .unwrap()
            .unwrap()
            .request,
        next
    );
    cleanup(&path);
}

#[test]
fn pending_question_and_active_goal_survive_interrupted_source_recovery() {
    let (path, q) = fixture_with_goal(QuestionResponder::Information, true);
    let creation = q.creation_receipt();
    assert!(matches!(
        reconcile_active_run(&path, "target").unwrap(),
        ActiveRunReconciliation::Interrupted { .. }
    ));
    assert_eq!(
        pending_task_question(&path, "target").unwrap(),
        Some(q.clone())
    );
    assert_eq!(
        reconcile_session_goal_run(&path, "target")
            .unwrap()
            .unwrap()
            .status,
        GoalStatus::Active
    );
    assert!(update_session_goal_by_model(
        &path,
        "target",
        q.goal_id.as_deref().unwrap(),
        GoalStatus::Blocked
    )
    .is_err());
    let receipt = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0)
        .unwrap()
        .receipt;
    assert_eq!(
        create_task_question(&path, &q.request, 0)
            .unwrap()
            .creation_receipt(),
        creation
    );
    let item = load_session_inbox_item(&path, "target", receipt.inbox_item_id).unwrap();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_inbox_run_prompt(
            "target",
            1,
            &Message::User {
                content: item.content,
            },
            &receipt.continuation_run_id,
            item.id,
        )
        .unwrap();
    assert_eq!(
        load_session_goal(&path, "target").unwrap().unwrap().status,
        GoalStatus::Active
    );
    cleanup(&path);
}

#[test]
fn goal_replacement_invalidates_pending_question_without_rewriting_accepted_receipt() {
    let (path, q) = fixture_with_goal(QuestionResponder::Information, true);
    let accepted = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0)
        .unwrap()
        .receipt;
    let goal = load_session_goal(&path, "target").unwrap().unwrap();
    clear_session_goal(&path, "target", &goal.goal_id, goal.version).unwrap();
    let replay = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0).unwrap();
    assert_eq!(replay.receipt, accepted);
    assert!(!replay.should_wake);
    assert!(question_continuation_run(&path, "target", accepted.inbox_item_id).is_err());
    cleanup(&path);
}

#[test]
fn stale_terminal_callback_does_not_cancel_a_question_from_a_completed_yield() {
    let (path, q) = fixture(QuestionResponder::Information);
    end_run(&path, &q.request.run_id, RunTerminalDisposition::Completed);
    end_run(&path, &q.request.run_id, RunTerminalDisposition::Cancelled);
    assert_eq!(pending_task_question(&path, "target").unwrap(), Some(q));
    cleanup(&path);
}

#[test]
fn configuration_change_cancels_question_delivery_but_retains_accepted_receipt() {
    let (path, q) = fixture(QuestionResponder::Information);
    let accepted = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 0)
        .unwrap()
        .receipt;
    end_run(&path, &q.request.run_id, RunTerminalDisposition::Completed);
    let config = crate::sessions::load_session_config(&path, "target").unwrap();
    assert_eq!(
        crate::sessions::update_raw_session_config(&path, &config).unwrap(),
        1
    );
    let replay = answer_task_question(&path, "target", &answer(&q, "CSV"), None, 1).unwrap();
    assert_eq!(replay.receipt, accepted);
    assert!(!replay.should_wake);
    assert_eq!(
        load_task_question(&path, "target", &q.request.request_id)
            .unwrap()
            .unwrap()
            .continuation_state
            .as_deref(),
        Some("cancelled")
    );
    assert!(question_continuation_run(&path, "target", accepted.inbox_item_id).is_err());
    cleanup(&path);
}

#[test]
fn deleting_project_cancels_question_binding_while_preserving_session_identity() {
    let (path, q) = fixture(QuestionResponder::Information);
    insert_project(
        &path,
        NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: PathBuf::from("/tmp/project"),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    assign_session_to_project(&path, "project", "target").unwrap();
    let mut request = q.request.clone();
    request.request_id = "after-assignment".into();
    let new = create_task_question(&path, &request, 0).unwrap();
    delete_project(&path, "project").unwrap();
    assert!(crate::sessions::session_exists(&path, "target").unwrap());
    assert_eq!(
        load_task_question(&path, "target", &request.request_id)
            .unwrap()
            .unwrap()
            .status,
        "cancelled"
    );
    assert!(answer_task_question(&path, "target", &answer(&new, "CSV"), None, 0).is_err());
    cleanup(&path);
}

#[test]
fn masking_never_collapses_changed_creation_or_answer_arguments() {
    let (path, q) = fixture(QuestionResponder::Information);
    cancel_task_question(&path, "target", &q.request.request_id, q.revision).unwrap();
    let mut shown = q.request.clone();
    shown.request_id = "masked".into();
    shown.text = "[REDACTED]".into();
    let mut raw = shown.clone();
    raw.text = "private fixture one".into();
    let first_digest = canonical_digest(&raw).unwrap();
    let masked = create_task_question_bound(&path, &shown, 0, &first_digest).unwrap();
    raw.text = "private fixture two".into();
    assert!(
        create_task_question_bound(&path, &shown, 0, &canonical_digest(&raw).unwrap()).is_err()
    );
    assert_eq!(
        create_task_question_bound(&path, &shown, 0, &first_digest).unwrap(),
        masked
    );
    let displayed = answer(&masked, "[REDACTED]");
    let raw_first = answer(&masked, "private answer one");
    let raw_second = answer(&masked, "private answer two");
    let digest = canonical_digest(&raw_first).unwrap();
    let receipt = answer_task_question_bound(&path, "target", &displayed, None, 0, &digest)
        .unwrap()
        .receipt;
    assert!(answer_task_question_bound(
        &path,
        "target",
        &displayed,
        None,
        0,
        &canonical_digest(&raw_second).unwrap()
    )
    .is_err());
    assert_eq!(
        answer_task_question_bound(&path, "target", &displayed, None, 0, &digest)
            .unwrap()
            .receipt,
        receipt
    );
    let serialized =
        serde_json::to_string(&load_task_question(&path, "target", "masked").unwrap()).unwrap();
    assert!(!serialized.contains("private fixture"));
    assert!(!serialized.contains("private answer"));
    cleanup(&path);
}
