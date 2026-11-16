use super::*;
use crate::store::task_questions::answer_task_question;

struct Scenario {
    fixture: Fixture,
    run: String,
    cutoff: CompletionCursor,
    completed: SessionGoalRecord,
    successor: SessionGoalRecord,
    question: QuestionRecord,
}

fn ask(fixture: &Fixture, run: &str, request: &str) -> QuestionRecord {
    create_task_question(
        &fixture.path,
        &QuestionRequest {
            session_id: "session".into(),
            request_id: request.into(),
            run_id: run.into(),
            generation: run.into(),
            text: "Choose the next step".into(),
            choices: vec![],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap()
}

impl Scenario {
    fn new() -> Self {
        let mut fixture = Fixture::new("direct");
        let run = uuid::Uuid::new_v4().to_string();
        let cutoff = fixture.cursor();
        fixture.begin(&run);
        let first = create_session_goal(
            &fixture.path,
            "session",
            "goal A",
            None,
            Some(&fixture.baseline(&run)),
        )
        .unwrap();
        let completed = update_session_goal_by_model(
            &fixture.path,
            "session",
            &first.goal_id,
            GoalStatus::Complete,
        )
        .unwrap();
        let successor = create_session_goal(
            &fixture.path,
            "session",
            "unrelated goal B",
            None,
            Some(&fixture.baseline(&run)),
        )
        .unwrap();
        let question = ask(&fixture, &run, "question-for-B");
        assert_eq!(
            question.goal_id.as_deref(),
            Some(successor.goal_id.as_str())
        );
        Self {
            fixture,
            run,
            cutoff,
            completed,
            successor,
            question,
        }
    }

    fn assert_a_once(&self) -> CompletionPage {
        let page = read_completion_page(&self.fixture.path, Some(&self.cutoff)).unwrap();
        assert_eq!(page.items.len(), 1, "unrelated B question must not erase A");
        let item = &page.items[0];
        assert_eq!(item.kind, CompletionKind::Goal);
        assert_eq!(item.session_id, "session");
        assert_eq!(item.run_id, self.run);
        assert_eq!(
            item.goal_id.as_deref(),
            Some(self.completed.goal_id.as_str())
        );
        assert_eq!(item.mark_version, Some(self.completed.version));
        assert!(read_completion_page(&self.fixture.path, Some(&page.cursor))
            .unwrap()
            .items
            .is_empty());
        page
    }
}

#[test]
fn i2_completed_a_survives_b_question_across_terminal_and_recovery() {
    for recovered in [false, true] {
        let mut case = Scenario::new();
        let creation = case.question.creation_receipt();
        assert!(read_completion_page(&case.fixture.path, Some(&case.cutoff))
            .unwrap()
            .items
            .is_empty());
        // Reopen through the real store owner without recreating either mark.
        initialize(&case.fixture.path).unwrap();
        assert_eq!(
            pending_task_question(&case.fixture.path, "session").unwrap(),
            Some(case.question.clone())
        );
        if recovered {
            // The normal transcript writer supplies canonical terminal proof;
            // no recovery flag or completion row is manufactured by the test.
            let terminal: Message = serde_json::from_value(serde_json::json!({
                "role": "assistant", "content": "Waiting for the person's decision"
            }))
            .unwrap();
            TranscriptLogWriter::new(&case.fixture.path)
                .unwrap()
                .append("session", case.fixture.next, &terminal)
                .unwrap();
            case.fixture.next += 1;
            assert_eq!(
                reconcile_active_run(&case.fixture.path, "session").unwrap(),
                ActiveRunReconciliation::CanonicalTerminal
            );
            assert_eq!(
                reconcile_active_run(&case.fixture.path, "session").unwrap(),
                ActiveRunReconciliation::None
            );
        } else {
            case.fixture.finish(&case.run);
        }
        let page = case.assert_a_once();
        case.fixture.finish(&case.run); // repeated terminal callback
        assert_eq!(case.assert_a_once(), page);
        let current = load_session_goal(&case.fixture.path, "session")
            .unwrap()
            .unwrap();
        assert_eq!(current.goal_id, case.successor.goal_id);
        assert_eq!(current.status, GoalStatus::Active);
        let pending = pending_task_question(&case.fixture.path, "session")
            .unwrap()
            .unwrap();
        assert_eq!(pending, case.question);
        assert_eq!(pending.creation_receipt(), creation);
    }
}

#[test]
fn i2_retained_question_metadata_survives_cancel_answer_goal_clear_and_versions() {
    for change in ["cancel", "answer", "clear", "replace", "version"] {
        let case = Scenario::new();
        let creation = case.question.creation_receipt();
        assert!(update_session_goal_by_model(
            &case.fixture.path,
            "session",
            &case.successor.goal_id,
            GoalStatus::Complete,
        )
        .is_err());
        let mut accepted = None;
        match change {
            "cancel" => {
                cancel_task_question(&case.fixture.path, "session", "question-for-B", 1).unwrap();
            }
            "answer" => {
                let input = QuestionAnswer {
                    request_id: "question-for-B".into(),
                    run_id: case.run.clone(),
                    generation: case.run.clone(),
                    expected_revision: 1,
                    answer: "Continue".into(),
                };
                let receipt = answer_task_question(&case.fixture.path, "session", &input, None, 0)
                    .unwrap()
                    .receipt;
                cancel_task_question(
                    &case.fixture.path,
                    "session",
                    "question-for-B",
                    receipt.revision,
                )
                .unwrap();
                assert_eq!(
                    answer_task_question(&case.fixture.path, "session", &input, None, 0)
                        .unwrap()
                        .receipt,
                    receipt
                );
                accepted = Some(receipt);
            }
            "clear" | "replace" => {
                clear_session_goal(
                    &case.fixture.path,
                    "session",
                    &case.successor.goal_id,
                    case.successor.version,
                )
                .unwrap();
                if change == "replace" {
                    create_session_goal(
                        &case.fixture.path,
                        "session",
                        "goal C",
                        None,
                        Some(&case.fixture.baseline(&case.run)),
                    )
                    .unwrap();
                }
            }
            "version" => {
                let update = UserGoalUpdate {
                    objective: Some("edited goal B".into()),
                    ..Default::default()
                };
                update_session_goal_by_user(
                    &case.fixture.path,
                    "session",
                    &case.successor.goal_id,
                    case.successor.version,
                    update.clone(),
                )
                .unwrap();
                assert!(update_session_goal_by_user(
                    &case.fixture.path,
                    "session",
                    &case.successor.goal_id,
                    case.successor.version,
                    update,
                )
                .is_err());
            }
            _ => unreachable!(),
        }
        case.fixture.finish(&case.run);
        case.assert_a_once();
        let retained = load_task_question(&case.fixture.path, "session", "question-for-B")
            .unwrap()
            .unwrap();
        assert_eq!(retained.creation_receipt(), creation);
        assert_eq!(retained.answer, accepted);
    }
}

#[test]
fn i2_completion_insert_rollback_preserves_question_mark_and_exact_retry() {
    let case = Scenario::new();
    let conn = open_runtime_connection(&case.fixture.path).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_i2_completion BEFORE INSERT ON session_completion_occurrences BEGIN SELECT RAISE(ABORT,'I2 commit boundary'); END;").unwrap();
    let update = case
        .fixture
        .update(&case.run, RunTerminalDisposition::Completed);
    assert!(sessions::save_session_run_state(&case.fixture.path, &update).is_err());
    assert!(read_completion_page(&case.fixture.path, Some(&case.cutoff))
        .unwrap()
        .items
        .is_empty());
    assert_eq!(
        load_run_recovery(&case.fixture.path, "session")
            .unwrap()
            .unwrap()
            .status,
        RunRecoveryStatus::Active
    );
    assert_eq!(
        pending_task_question(&case.fixture.path, "session").unwrap(),
        Some(case.question.clone())
    );
    conn.execute_batch("DROP TRIGGER fail_i2_completion")
        .unwrap();
    sessions::save_session_run_state(&case.fixture.path, &update).unwrap();
    let page = case.assert_a_once();
    sessions::save_session_run_state(&case.fixture.path, &update).unwrap();
    assert_eq!(case.assert_a_once(), page);
}

#[test]
fn i2_unproven_interrupted_cancelled_and_failed_runs_never_promote_a() {
    for outcome in ["interrupted", "cancelled", "failed"] {
        let case = Scenario::new();
        match outcome {
            "interrupted" => assert!(matches!(
                reconcile_active_run(&case.fixture.path, "session").unwrap(),
                ActiveRunReconciliation::Interrupted { .. }
            )),
            "cancelled" => sessions::save_session_run_state(
                &case.fixture.path,
                &case
                    .fixture
                    .update(&case.run, RunTerminalDisposition::Cancelled),
            )
            .unwrap(),
            "failed" => {
                let mut update = case
                    .fixture
                    .update(&case.run, RunTerminalDisposition::Completed);
                update.finished_run_id = None;
                update.finished_run_disposition = None;
                update.finished_run_result = None;
                update.failed_run_id = Some(case.run.clone());
                update.failed_run_failure = Some(crate::run_failure::RunFailure::unknown("failed"));
                sessions::save_session_run_state(&case.fixture.path, &update).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(read_completion_page(&case.fixture.path, Some(&case.cutoff))
            .unwrap()
            .items
            .is_empty());
    }
}

#[test]
fn i2_same_goal_question_remains_suppressed_and_missing_attribution_fails_closed() {
    let mut fixture = Fixture::new("direct");
    let run = uuid::Uuid::new_v4().to_string();
    let cutoff = fixture.cursor();
    fixture.begin(&run);
    let goal = create_session_goal(
        &fixture.path,
        "session",
        "A",
        None,
        Some(&fixture.baseline(&run)),
    )
    .unwrap();
    update_session_goal_by_model(
        &fixture.path,
        "session",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    ask(&fixture, &run, "same-goal");
    fixture.finish(&run);
    assert!(read_completion_page(&fixture.path, Some(&cutoff))
        .unwrap()
        .items
        .is_empty());

    let case = Scenario::new();
    // Fault injection only: a latched yield without its durable receipt must
    // not be mistaken for evidence that every marked goal was unrelated.
    open_runtime_connection(&case.fixture.path)
        .unwrap()
        .execute("DELETE FROM task_questions WHERE session_id='session'", [])
        .unwrap();
    case.fixture.finish(&case.run);
    assert!(read_completion_page(&case.fixture.path, Some(&case.cutoff))
        .unwrap()
        .items
        .is_empty());
}

#[test]
fn i2_exact_question_lookup_outlives_the_32_row_display_window() {
    let case = Scenario::new();
    cancel_task_question(&case.fixture.path, "session", "question-for-B", 1).unwrap();
    for n in 0..40 {
        let question = ask(&case.fixture, &case.run, &format!("later-{n}"));
        cancel_task_question(
            &case.fixture.path,
            "session",
            &question.request.request_id,
            1,
        )
        .unwrap();
    }
    assert_eq!(
        list_task_questions(&case.fixture.path, "session")
            .unwrap()
            .len(),
        32
    );
    case.fixture.finish(&case.run);
    case.assert_a_once();
    assert_eq!(
        load_task_question(&case.fixture.path, "session", "question-for-B")
            .unwrap()
            .unwrap()
            .goal_id,
        Some(case.successor.goal_id)
    );

    // Also hide a same-goal question: a display-window shortcut would wrongly
    // release its old suppression once only newer B questions remain visible.
    let mut fixture = Fixture::new("direct");
    let run = uuid::Uuid::new_v4().to_string();
    let cutoff = fixture.cursor();
    fixture.begin(&run);
    let first = create_session_goal(
        &fixture.path,
        "session",
        "A",
        None,
        Some(&fixture.baseline(&run)),
    )
    .unwrap();
    ask(&fixture, &run, "early-same-goal");
    cancel_task_question(&fixture.path, "session", "early-same-goal", 1).unwrap();
    update_session_goal_by_model(
        &fixture.path,
        "session",
        &first.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    create_session_goal(
        &fixture.path,
        "session",
        "B",
        None,
        Some(&fixture.baseline(&run)),
    )
    .unwrap();
    for n in 0..40 {
        let question = ask(&fixture, &run, &format!("newer-B-{n}"));
        cancel_task_question(&fixture.path, "session", &question.request.request_id, 1).unwrap();
    }
    assert!(list_task_questions(&fixture.path, "session")
        .unwrap()
        .iter()
        .all(|q| q.request.request_id != "early-same-goal"));
    fixture.finish(&run);
    assert!(read_completion_page(&fixture.path, Some(&cutoff))
        .unwrap()
        .items
        .is_empty());
}

#[test]
fn i2_old_run_question_for_same_goal_cannot_suppress_a_new_run_mark() {
    let mut fixture = Fixture::new("direct");
    let cutoff = fixture.cursor();
    let old_run = uuid::Uuid::new_v4().to_string();
    fixture.begin(&old_run);
    let goal = create_session_goal(
        &fixture.path,
        "session",
        "A",
        None,
        Some(&fixture.baseline(&old_run)),
    )
    .unwrap();
    ask(&fixture, &old_run, "prior-run-question-for-A");
    cancel_task_question(&fixture.path, "session", "prior-run-question-for-A", 1).unwrap();
    fixture.finish(&old_run);
    let run = uuid::Uuid::new_v4().to_string();
    fixture.begin(&run);
    bind_session_goal_run(&fixture.path, "session", &fixture.baseline(&run)).unwrap();
    let completed = update_session_goal_by_model(
        &fixture.path,
        "session",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let successor = create_session_goal(
        &fixture.path,
        "session",
        "B",
        None,
        Some(&fixture.baseline(&run)),
    )
    .unwrap();
    let question = ask(&fixture, &run, "current-B");
    let case = Scenario {
        fixture,
        run,
        cutoff,
        completed,
        successor,
        question,
    };
    case.fixture.finish(&case.run);
    case.assert_a_once();
}

#[test]
fn i2_foreign_question_creation_and_session_deletion_preserve_owner_fences() {
    let case = Scenario::new();
    for field in ["run", "generation", "session"] {
        let mut request = case.question.request.clone();
        request.request_id = format!("foreign-{field}");
        match field {
            "run" => {
                request.run_id = uuid::Uuid::new_v4().to_string();
                request.generation = request.run_id.clone();
            }
            "generation" => request.generation = uuid::Uuid::new_v4().to_string(),
            "session" => request.session_id = "foreign-session".into(),
            _ => unreachable!(),
        }
        assert!(create_task_question(&case.fixture.path, &request, 0).is_err());
    }
    case.fixture.finish(&case.run);
    case.assert_a_once();
    assert!(sessions::delete_session(&case.fixture.path, "session").unwrap());
    let conn = open_runtime_connection(&case.fixture.path).unwrap();
    for table in [
        "task_questions",
        "session_completion_bindings",
        "session_completion_marks",
        "session_completion_occurrences",
    ] {
        assert_eq!(
            conn.query_row::<i64, _, _>(&format!("SELECT count(*) FROM {table}"), [], |row| row
                .get(0))
                .unwrap(),
            0
        );
    }
}
