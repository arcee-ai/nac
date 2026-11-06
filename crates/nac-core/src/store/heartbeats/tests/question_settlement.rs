//! Exact question classification at the canonical session terminal transaction.
use super::*;
use crate::store::task_questions::{
    answer_task_question, cancel_task_question, create_task_question,
};
use crate::store::{QuestionAnswer, QuestionRecord, QuestionRequest, QuestionResponder};
use crate::types::Message;

fn active(f: &Fixture, bound: bool) -> HeartbeatOccurrence {
    let mut specification = spec();
    if bound {
        specification.goal_id = Some(
            create_session_goal(&f.path, "direct", "Existing work", None, None)
                .unwrap()
                .goal_id,
        );
    }
    f.control(
        HeartbeatAction::Create {
            spec: specification,
        },
        1_000,
    );
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    TranscriptLogWriter::new(&f.path)
        .unwrap()
        .append_inbox_run_prompt(
            "direct",
            0,
            &Message::User {
                content: "authorized heartbeat input".into(),
            },
            active.run_id.as_ref().unwrap(),
            active.inbox_item_id.unwrap(),
        )
        .unwrap();
    active
}

fn request(active: &HeartbeatOccurrence) -> QuestionRequest {
    let run = active.run_id.as_ref().unwrap();
    QuestionRequest {
        session_id: "direct".into(),
        request_id: "settlement-decision".into(),
        run_id: run.clone(),
        generation: run.clone(),
        text: "CSV or JSON?".into(),
        choices: vec!["CSV".into(), "JSON".into()],
        responder_class: QuestionResponder::HumanDecision,
    }
}
fn answer(q: &QuestionRecord) -> QuestionAnswer {
    QuestionAnswer {
        request_id: q.request.request_id.clone(),
        run_id: q.request.run_id.clone(),
        generation: q.request.generation.clone(),
        expected_revision: q.revision,
        answer: "CSV".into(),
    }
}
fn report(f: &Fixture, active: &HeartbeatOccurrence, outcome: HeartbeatOutcome) {
    heartbeat_report(
        &f.path,
        "direct",
        &active.occurrence_id,
        active.run_id.as_ref().unwrap(),
        active.generation.as_ref().unwrap(),
        active.revision,
        outcome,
        "Observed result before requesting a decision",
    )
    .unwrap();
}
fn terminal_update(
    f: &Fixture,
    active: &HeartbeatOccurrence,
) -> crate::sessions::SessionRunStateUpdate {
    let mut snapshot = crate::sessions::load_session(&f.path, "direct").unwrap();
    let mut update = snapshot.apply_run_state(crate::sessions::SessionRunState {
        last_response_duration_ms: Some(100),
        previous_response_duration_ms: None,
        response_durations_ms: Some(vec![Some(100)]),
        token_usages: Vec::new(),
        unattributed_token_usage: None,
    });
    update.finished_run_id = active.run_id.clone();
    update.finished_run_disposition = Some(RunTerminalDisposition::Completed);
    update.goal_settlement = Some(GoalRunSettlement {
        run_id: active.run_id.clone().unwrap(),
        final_billable_tokens: 3,
        terminal_at_epoch_ms: 65_000,
        disposition: GoalRunDisposition::Completed,
        failure: None,
    });
    update.heartbeat_settlement = Some(HeartbeatRunSettlement {
        tokens_used: Some(3),
        duration_ms: 100,
        terminal_at_epoch_ms: 65_000,
        needs_human_action: false,
    });
    update
}
fn save(f: &Fixture, active: &HeartbeatOccurrence) -> Result<()> {
    crate::sessions::save_session_run_state(&f.path, &terminal_update(f, active))
}
fn result(f: &Fixture, active: &HeartbeatOccurrence) -> HeartbeatOccurrence {
    heartbeat_history(&f.path, "direct", &active.schedule_id)
        .unwrap()
        .remove(0)
}

#[test]
fn heartbeat_question_settlement_exact_pending_overrides_provisional_and_survives_restart() {
    for provisional in [
        None,
        Some(HeartbeatOutcome::Unchanged),
        Some(HeartbeatOutcome::Finished),
    ] {
        for bound in [false, true] {
            let f = Fixture::new();
            let active = active(&f, bound);
            if let Some(outcome) = provisional {
                report(&f, &active, outcome);
            }
            let q = create_task_question(&f.path, &request(&active), 0).unwrap();
            assert_ne!(
                q.request.generation,
                *active.generation.as_ref().unwrap(),
                "the two generation vocabularies are distinct"
            );
            save(&f, &active).unwrap();
            let settled = result(&f, &active);
            assert_eq!(settled.outcome, Some(HeartbeatOutcome::NeedsHumanAction));
            assert_eq!(
                read_heartbeat(&f.path, "direct", &active.schedule_id)
                    .unwrap()
                    .state,
                HeartbeatState::Suspended
            );
            assert!(!heartbeat_attention_snapshot(&f.path)
                .unwrap()
                .quiet_updated_at
                .contains_key("direct"));
            initialize(&f.path).unwrap();
            save(&f, &active).unwrap();
            assert_eq!(result(&f, &active), settled);
            assert_eq!(
                crate::store::pending_task_question(&f.path, "direct").unwrap(),
                Some(q)
            );
            if bound {
                let goal = load_session_goal(&f.path, "direct").unwrap().unwrap();
                assert_eq!(goal.status, GoalStatus::Active);
                assert!(goal.accounting_run_id.is_none());
                assert_eq!(goal.tokens_used, 3);
            } else {
                assert!(load_session_goal(&f.path, "direct").unwrap().is_none());
            }
        }
    }
}

#[test]
fn heartbeat_question_settlement_hard_terminal_precedence_and_unrelated_questions() {
    for hard in [
        HeartbeatOutcome::Failed,
        HeartbeatOutcome::Interrupted,
        HeartbeatOutcome::NeedsHumanAction,
    ] {
        let f = Fixture::new();
        let active = active(&f, false);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        create_task_question(&f.path, &request(&active), 0).unwrap();
        f.settle(&active, hard, Some(3));
        assert_eq!(result(&f, &active).outcome, Some(hard));
    }
    for state in [
        "none",
        "answered",
        "cancelled",
        "wrong-run",
        "wrong-generation",
        "stale-config",
    ] {
        let f = Fixture::new();
        let active = active(&f, false);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        if state != "none" {
            let q = create_task_question(&f.path, &request(&active), 0).unwrap();
            match state {
                "answered" => {
                    answer_task_question(&f.path, "direct", &answer(&q), None, 0).unwrap();
                }
                "cancelled" => {
                    cancel_task_question(&f.path, "direct", &q.request.request_id, q.revision)
                        .unwrap();
                }
                // Synthetic invalid-origin fixtures prove the final predicate;
                // normal canonical creation rejects both of these inputs.
                "wrong-run" | "wrong-generation" => {
                    let mut changed = q.request.clone();
                    if state == "wrong-run" {
                        changed.run_id = uuid::Uuid::new_v4().to_string();
                    } else {
                        changed.generation = uuid::Uuid::new_v4().to_string();
                    }
                    open_runtime_connection(&f.path)
                        .unwrap()
                        .execute(
                            "UPDATE task_questions SET request_json=?1",
                            [serde_json::to_string(&changed).unwrap()],
                        )
                        .unwrap();
                }
                "stale-config" => {
                    open_runtime_connection(&f.path)
                        .unwrap()
                        .execute(
                            "UPDATE task_questions SET config_version=config_version+1",
                            [],
                        )
                        .unwrap();
                }
                _ => unreachable!(),
            }
        }
        save(&f, &active).unwrap();
        assert_eq!(
            result(&f, &active).outcome,
            Some(HeartbeatOutcome::Unchanged),
            "{state}"
        );
        assert!(heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at
            .contains_key("direct"));
    }
}

fn assert_rollback(f: &Fixture, active: &HeartbeatOccurrence) {
    assert_eq!(result(f, active).state, HeartbeatOccurrenceState::Admitted);
    assert_eq!(
        load_run_recovery(&f.path, "direct")
            .unwrap()
            .unwrap()
            .status,
        RunRecoveryStatus::Active
    );
    let goal = load_session_goal(&f.path, "direct").unwrap().unwrap();
    assert_eq!(goal.accounting_run_id, active.run_id);
    assert_eq!(goal.tokens_used, 0);
    let count: i64 = open_runtime_connection(&f.path)
        .unwrap()
        .query_row(
            "SELECT count(*) FROM session_run_outcomes WHERE session_id='direct'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    assert!(!heartbeat_attention_snapshot(&f.path)
        .unwrap()
        .quiet_updated_at
        .contains_key("direct"));
}

#[test]
fn heartbeat_question_settlement_decode_and_outer_transaction_errors_rollback_all_owners() {
    let f = Fixture::new();
    let active = active(&f, true);
    report(&f, &active, HeartbeatOutcome::Unchanged);
    let q = create_task_question(&f.path, &request(&active), 0).unwrap();
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute("UPDATE task_questions SET request_json='null'", [])
        .unwrap();
    assert!(save(&f, &active).is_err());
    assert_rollback(&f, &active);
    conn.execute(
        "UPDATE task_questions SET request_json=?1",
        [serde_json::to_string(&q.request).unwrap()],
    )
    .unwrap();
    conn.execute_batch("CREATE TRIGGER abort_terminal BEFORE UPDATE OF state ON heartbeat_occurrences BEGIN SELECT RAISE(ABORT,'test outer transaction rollback'); END;").unwrap();
    assert!(save(&f, &active).is_err());
    assert_rollback(&f, &active);
    conn.execute_batch("DROP TRIGGER abort_terminal;").unwrap();
    save(&f, &active).unwrap();
    let once = result(&f, &active);
    save(&f, &active).unwrap();
    assert_eq!(result(&f, &active), once);
    assert_eq!(once.outcome, Some(HeartbeatOutcome::NeedsHumanAction));
    assert_eq!(
        load_session_goal(&f.path, "direct")
            .unwrap()
            .unwrap()
            .tokens_used,
        3
    );
}

#[test]
fn heartbeat_question_settlement_creation_and_answer_have_one_transactional_order() {
    // Both fixed serial orders, then a genuine two-writer race with no sleeps.
    for order in ["create-first", "terminal-first", "race"] {
        let f = Fixture::new();
        let active = active(&f, false);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        let req = request(&active);
        let created = match order {
            "create-first" => {
                let q = create_task_question(&f.path, &req, 0);
                save(&f, &active).unwrap();
                q
            }
            "terminal-first" => {
                save(&f, &active).unwrap();
                create_task_question(&f.path, &req, 0)
            }
            _ => std::thread::scope(|scope| {
                let (f, active) = (&f, &active);
                let barrier = Arc::new(std::sync::Barrier::new(2));
                let gate = barrier.clone();
                let first = scope.spawn(move || {
                    barrier.wait();
                    create_task_question(&f.path, &req, 0)
                });
                let second = scope.spawn(move || {
                    gate.wait();
                    save(&f, &active)
                });
                let q = first.join().unwrap();
                second.join().unwrap().unwrap();
                q
            }),
        };
        let observed = result(&f, &active);
        if created.is_ok() {
            assert_eq!(observed.outcome, Some(HeartbeatOutcome::NeedsHumanAction));
        } else {
            assert_eq!(observed.outcome, Some(HeartbeatOutcome::Unchanged));
            assert!(crate::store::pending_task_question(&f.path, "direct")
                .unwrap()
                .is_none());
        }
    }
    for order in ["answer-first", "terminal-first", "race"] {
        let f = Fixture::new();
        let active = active(&f, false);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        let q = create_task_question(&f.path, &request(&active), 0).unwrap();
        let input = answer(&q);
        let accepted = match order {
            "answer-first" => {
                let a = answer_task_question(&f.path, "direct", &input, None, 0).unwrap();
                save(&f, &active).unwrap();
                a
            }
            "terminal-first" => {
                save(&f, &active).unwrap();
                answer_task_question(&f.path, "direct", &input, None, 0).unwrap()
            }
            _ => std::thread::scope(|scope| {
                let (f, active, input) = (&f, &active, &input);
                let barrier = Arc::new(std::sync::Barrier::new(2));
                let gate = barrier.clone();
                let first = scope.spawn(move || {
                    barrier.wait();
                    answer_task_question(&f.path, "direct", &input, None, 0)
                });
                let second = scope.spawn(move || {
                    gate.wait();
                    save(&f, &active)
                });
                let a = first.join().unwrap().unwrap();
                second.join().unwrap().unwrap();
                a
            }),
        };
        let observed = result(&f, &active);
        if order == "answer-first" {
            assert_eq!(observed.outcome, Some(HeartbeatOutcome::Unchanged));
        }
        if order == "terminal-first" {
            assert_eq!(observed.outcome, Some(HeartbeatOutcome::NeedsHumanAction));
        }
        assert_eq!(
            answer_task_question(&f.path, "direct", &input, None, 0)
                .unwrap()
                .receipt,
            accepted.receipt
        );
        assert_eq!(
            next_pending_session_inbox_item(&f.path, "direct")
                .unwrap()
                .unwrap()
                .id,
            accepted.receipt.inbox_item_id
        );
        assert_eq!(
            heartbeat_history(&f.path, "direct", &active.schedule_id)
                .unwrap()
                .len(),
            1
        );
    }
}

#[path = "question_delivery.rs"]
mod delivery;
