//! Exact delivered-answer proof and conservative review/control boundaries.
use super::*;
use crate::store::QuestionAnswerReceipt;

fn gate(f: &Fixture, a: &HeartbeatOccurrence) -> Result<bool> {
    heartbeat_blocks_goal_continuation(&f.path, "direct", a.spec.goal_id.as_ref().unwrap())
}
fn question(f: &Fixture, a: &HeartbeatOccurrence, responder: QuestionResponder) -> QuestionRecord {
    let mut r = request(a);
    r.responder_class = responder;
    create_task_question(&f.path, &r, 0).unwrap()
}
fn accept(f: &Fixture, q: &QuestionRecord) -> QuestionAnswerReceipt {
    let input = answer(q);
    let first = answer_task_question(&f.path, "direct", &input, None, 0)
        .unwrap()
        .receipt;
    assert_eq!(
        first,
        answer_task_question(&f.path, "direct", &input, None, 0)
            .unwrap()
            .receipt
    );
    first
}
fn deliver(path: &Path, r: &QuestionAnswerReceipt) {
    let i = load_session_inbox_item(path, "direct", r.inbox_item_id).unwrap();
    TranscriptLogWriter::new(path)
        .unwrap()
        .append_inbox_run_prompt(
            "direct",
            1,
            &Message::User { content: i.content },
            &r.continuation_run_id,
            i.id,
        )
        .unwrap();
}
fn prepared(responder: QuestionResponder) -> (Fixture, HeartbeatOccurrence, QuestionRecord) {
    let f = Fixture::new();
    let a = active(&f, true);
    let q = question(&f, &a, responder);
    (f, a, q)
}
fn suspended(f: &Fixture, a: &HeartbeatOccurrence) {
    assert_eq!(
        result(f, a).outcome,
        Some(HeartbeatOutcome::NeedsHumanAction)
    );
    assert_eq!(
        read_heartbeat(&f.path, "direct", &a.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Suspended
    );
}

#[test]
fn heartbeat_question_delivery_only_exact_delivery_releases_goal_not_schedule() {
    for responder in [
        QuestionResponder::HumanDecision,
        QuestionResponder::Information,
    ] {
        for provisional in [
            None,
            Some(HeartbeatOutcome::Unchanged),
            Some(HeartbeatOutcome::Meaningful),
            Some(HeartbeatOutcome::Finished),
        ] {
            let (f, a, q) = prepared(responder);
            if let Some(outcome) = provisional {
                report(&f, &a, outcome);
            }
            save(&f, &a).unwrap();
            suspended(&f, &a);
            assert!(gate(&f, &a).unwrap());
            let r = accept(&f, &q);
            assert!(gate(&f, &a).unwrap(), "acceptance alone is not delivery");
            let before = read_heartbeat(&f.path, "direct", &a.schedule_id).unwrap();
            deliver(&f.path, &r);
            assert!(
                !gate(&f, &a).unwrap(),
                "F4-R1: delivered exact answer must release only the goal gate"
            );
            initialize(&f.path).unwrap();
            assert!(
                !gate(&f, &a).unwrap(),
                "the resolution proof survives restart"
            );
            save(&f, &a).unwrap();
            assert_eq!(
                read_heartbeat(&f.path, "direct", &a.schedule_id).unwrap(),
                before
            );
            let g = load_session_goal(&f.path, "direct").unwrap().unwrap();
            assert_eq!(g.status, GoalStatus::Active);
            assert_eq!(g.tokens_used, 3);
            assert!(g.accounting_run_id.is_none());
            assert_eq!(
                heartbeat_history(&f.path, "direct", &a.schedule_id)
                    .unwrap()
                    .len(),
                1
            );
        }
    }
}

#[test]
fn heartbeat_question_delivery_never_releases_other_review_causes_or_cancellation() {
    for cause in [
        "failed",
        "interrupted",
        "terminal_attention",
        "provisional_attention",
        "denial",
        "deadline",
        "count",
        "budget",
        "unknown_usage",
        "legacy",
        "cancel_question",
        "cancel_answer",
    ] {
        let (f, a, q) = prepared(QuestionResponder::HumanDecision);
        let conn = open_runtime_connection(&f.path).unwrap();
        let mut u = terminal_update(&f, &a);
        match cause {
            "failed" => {
                u.finished_run_id = None;
                u.finished_run_disposition = None;
                u.failed_run_id = a.run_id.clone();
            }
            "interrupted" => u.finished_run_disposition = Some(RunTerminalDisposition::Cancelled),
            "terminal_attention" => {
                u.heartbeat_settlement.as_mut().unwrap().needs_human_action = true
            }
            "provisional_attention" => report(&f, &a, HeartbeatOutcome::NeedsHumanAction),
            "denial" => {
                mark_heartbeat_action_denied(&f.path, "direct", a.run_id.as_ref().unwrap()).unwrap()
            }
            "deadline" => {
                assert!(heartbeat_deadline_reached(
                    &f.path,
                    "direct",
                    a.run_id.as_ref().unwrap(),
                    64_000
                )
                .unwrap());
            }
            "count" => {
                conn.execute("UPDATE heartbeat_schedules SET specification_json=json_set(specification_json,'$.max_occurrences',1) WHERE schedule_id=?1",[&a.schedule_id]).unwrap();
            }
            "budget" | "unknown_usage" => {
                conn.execute("UPDATE heartbeat_schedules SET specification_json=json_set(specification_json,'$.token_allowance',3) WHERE schedule_id=?1",[&a.schedule_id]).unwrap();
                if cause == "unknown_usage" {
                    u.heartbeat_settlement.as_mut().unwrap().tokens_used = None;
                }
            }
            _ => {}
        }
        crate::sessions::save_session_run_state(&f.path, &u).unwrap();
        if cause == "legacy" {
            conn.execute("UPDATE heartbeat_schedules SET binding_json=json_remove(binding_json,'$._goal_question_gate') WHERE schedule_id=?1",[&a.schedule_id]).unwrap();
        }
        if cause == "cancel_question" {
            cancel_task_question(&f.path, "direct", &q.request.request_id, q.revision).unwrap();
        } else if !matches!(cause, "failed" | "interrupted") {
            let r = accept(&f, &q);
            if cause == "cancel_answer" {
                cancel_task_question(&f.path, "direct", &q.request.request_id, r.revision).unwrap();
            } else {
                deliver(&f.path, &r);
            }
        }
        assert!(
            gate(&f, &a).unwrap(),
            "review cause {cause} cannot be released by an answer"
        );
        assert_eq!(
            read_heartbeat(&f.path, "direct", &a.schedule_id)
                .unwrap()
                .state,
            HeartbeatState::Suspended
        );
    }
}

#[test]
fn heartbeat_question_delivery_stale_malformed_missing_proof_fails_closed() {
    for mutation in [
        "missing",
        "malformed",
        "request",
        "run",
        "occurrence",
        "version",
        "goal",
        "config",
        "project",
        "question_generation",
        "cancelled_delivery",
        "wrong_inbox_run",
    ] {
        let (f, a, q) = prepared(QuestionResponder::Information);
        save(&f, &a).unwrap();
        let r = accept(&f, &q);
        deliver(&f.path, &r);
        let conn = open_runtime_connection(&f.path).unwrap();
        // The deliberately corrupted records below are negative storage fixtures,
        // not states claimed to be constructible via supported mutations.
        match mutation {
            "missing" => {
                conn.execute("UPDATE heartbeat_schedules SET binding_json=json_remove(binding_json,'$._goal_question_gate') WHERE schedule_id=?1",[&a.schedule_id]).unwrap();
            }
            "malformed" => {
                conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._goal_question_gate','invalid') WHERE schedule_id=?1",[&a.schedule_id]).unwrap();
            }
            "request" | "run" | "occurrence" | "goal" => {
                let field = match mutation {
                    "request" => "request_id",
                    "run" => "source_run_id",
                    "occurrence" => "occurrence_id",
                    _ => "goal_id",
                };
                conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,?2,'wrong') WHERE schedule_id=?1",params![a.schedule_id,format!("$._goal_question_gate.{field}")]).unwrap();
            }
            "version" => {
                conn.execute(
                    "UPDATE heartbeat_schedules SET version=version+1 WHERE schedule_id=?1",
                    [&a.schedule_id],
                )
                .unwrap();
            }
            "config" => {
                conn.execute(
                    "UPDATE sessions SET config_version=config_version+1 WHERE session_id='direct'",
                    [],
                )
                .unwrap();
            }
            "project" => {
                conn.execute(
                    "UPDATE task_questions SET project_id='foreign' WHERE session_id='direct'",
                    [],
                )
                .unwrap();
            }
            "question_generation" => {
                conn.execute("UPDATE task_questions SET request_json=json_set(request_json,'$.generation','wrong') WHERE session_id='direct'",[]).unwrap();
            }
            "cancelled_delivery" => {
                conn.execute("UPDATE task_questions SET continuation_state='cancelled' WHERE session_id='direct'",[]).unwrap();
            }
            "wrong_inbox_run" => {
                conn.execute(
                    "UPDATE session_inbox SET delivered_run_id='wrong' WHERE id=?1",
                    [r.inbox_item_id],
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            gate(&f, &a).unwrap_or(true),
            "{mutation} cannot prove exact resolution"
        );
        suspended(&f, &a);
    }
}

#[test]
fn heartbeat_question_delivery_control_versions_never_auto_resume_or_reuse_proof() {
    for name in ["pause", "stop", "delete", "edit", "resume"] {
        let (f, a, q) = prepared(QuestionResponder::HumanDecision);
        save(&f, &a).unwrap();
        let r = accept(&f, &q);
        let action = match name {
            "pause" => HeartbeatAction::Pause {
                schedule_id: a.schedule_id.clone(),
                expected_version: 1,
            },
            "stop" => HeartbeatAction::Stop {
                schedule_id: a.schedule_id.clone(),
                expected_version: 1,
            },
            "delete" => HeartbeatAction::Delete {
                schedule_id: a.schedule_id.clone(),
                expected_version: 1,
            },
            "edit" => HeartbeatAction::Edit {
                schedule_id: a.schedule_id.clone(),
                expected_version: 1,
                spec: a.spec.clone(),
            },
            _ => HeartbeatAction::Resume {
                schedule_id: a.schedule_id.clone(),
                expected_version: 1,
            },
        };
        // Both real writers race; neither can create a second answer or start.
        let barrier = std::sync::Barrier::new(3);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                barrier.wait();
                deliver(&f.path, &r);
            });
            scope.spawn(|| {
                barrier.wait();
                f.control(action, 66_000);
            });
            barrier.wait();
        });
        let s = read_heartbeat(&f.path, "direct", &a.schedule_id).unwrap();
        assert_eq!(s.version, 2);
        assert_eq!(s.starts, 1);
        assert_eq!(
            s.state,
            match name {
                "pause" => HeartbeatState::Paused,
                "stop" => HeartbeatState::Stopped,
                "delete" => HeartbeatState::Deleted,
                "edit" => HeartbeatState::Suspended,
                _ => HeartbeatState::Active,
            }
        );
        let raw:Option<String>=open_runtime_connection(&f.path).unwrap().query_row("SELECT json_extract(binding_json,'$._goal_question_gate') FROM heartbeat_schedules WHERE schedule_id=?1",[&a.schedule_id],|r|r.get(0)).unwrap();
        assert!(
            raw.is_none(),
            "operator {name} invalidates old private provenance"
        );
        assert_eq!(gate(&f, &a).unwrap(), name == "edit");
        assert_eq!(list_session_inbox(&f.path, "direct").unwrap().len(), 2);
    }
}

#[test]
fn heartbeat_question_delivery_outer_terminal_rollback_and_peer_review_are_atomic() {
    let (f, a, q) = prepared(QuestionResponder::HumanDecision);
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute_batch("CREATE TRIGGER abort_question_gate BEFORE UPDATE OF binding_json ON heartbeat_schedules WHEN json_extract(NEW.binding_json,'$._goal_question_gate') IS NOT NULL BEGIN SELECT RAISE(ABORT,'outer question gate rollback'); END;").unwrap();
    // Baseline has no cause marker and does not reach this new fault boundary.
    let failed = save(&f, &a);
    assert!(
        failed.is_err(),
        "question cause must share the canonical outer terminal transaction"
    );
    assert_eq!(result(&f, &a).state, HeartbeatOccurrenceState::Admitted);
    assert!(load_session_goal(&f.path, "direct")
        .unwrap()
        .unwrap()
        .accounting_run_id
        .is_some());
    conn.execute_batch("DROP TRIGGER abort_question_gate")
        .unwrap();
    save(&f, &a).unwrap();
    let r = accept(&f, &q);
    deliver(&f.path, &r);
    assert!(!gate(&f, &a).unwrap());
    // A second suspended schedule's real pre-admission denial retains its gate.
    let second = f
        .control(
            HeartbeatAction::Create {
                spec: a.spec.clone(),
            },
            70_000,
        )
        .schedule;
    let pending = materialize_heartbeats(&f.path, 130_000)
        .unwrap()
        .into_iter()
        .find(|o| o.schedule_id == second.schedule_id)
        .unwrap();
    heartbeat_admission_unavailable(
        &f.path,
        "direct",
        &pending.occurrence_id,
        pending.revision,
        true,
        "Actual prepared denial",
        130_000,
    )
    .unwrap();
    assert!(gate(&f, &a).unwrap());
    assert_eq!(
        read_heartbeat(&f.path, "direct", &a.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Suspended
    );
}

#[test]
fn heartbeat_question_delivery_answer_terminal_serial_orders_and_race_agree() {
    for order in [0, 1, 2] {
        let (f, a, q) = prepared(QuestionResponder::Information);
        let barrier = std::sync::Barrier::new(3);
        let receipt = match order {
            0 => {
                let r = accept(&f, &q);
                save(&f, &a).unwrap();
                r
            }
            1 => {
                save(&f, &a).unwrap();
                accept(&f, &q)
            }
            _ => std::thread::scope(|scope| {
                let s = scope.spawn(|| {
                    barrier.wait();
                    save(&f, &a).unwrap();
                });
                let answer = scope.spawn(|| {
                    barrier.wait();
                    accept(&f, &q)
                });
                barrier.wait();
                s.join().unwrap();
                answer.join().unwrap()
            }),
        };
        deliver(&f.path, &receipt);
        assert!(
            !gate(&f, &a).unwrap(),
            "delivered answer releases pure-question gate in order {order}"
        );
        assert_eq!(
            load_session_goal(&f.path, "direct")
                .unwrap()
                .unwrap()
                .tokens_used,
            3
        );
        assert_eq!(list_session_inbox(&f.path, "direct").unwrap().len(), 2);
    }
}

#[test]
fn heartbeat_question_delivery_never_changes_goal_status_budget_or_replacement() {
    for status in ["paused", "blocked", "budget_limited", "usage_limited"] {
        let (f, a, q) = prepared(QuestionResponder::Information);
        save(&f, &a).unwrap();
        let r = accept(&f, &q);
        deliver(&f.path, &r);
        let conn = open_runtime_connection(&f.path).unwrap();
        conn.execute(
            "UPDATE session_goals SET status=?1,token_budget=3 WHERE session_id='direct'",
            [status],
        )
        .unwrap();
        let before = load_session_goal(&f.path, "direct").unwrap().unwrap();
        assert!(!gate(&f, &a).unwrap());
        assert_eq!(
            load_session_goal(&f.path, "direct").unwrap().unwrap(),
            before
        );
        assert_eq!(vocabulary(&before.status).unwrap(), status);
        assert_eq!(before.token_budget, Some(3));
        suspended(&f, &a);
    }
    let (f, a, q) = prepared(QuestionResponder::Information);
    save(&f, &a).unwrap();
    let r = accept(&f, &q);
    deliver(&f.path, &r);
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE session_goals SET goal_id='replacement' WHERE session_id='direct'",
            [],
        )
        .unwrap();
    assert!(gate(&f, &a).unwrap());
    assert!(!heartbeat_blocks_goal_continuation(&f.path, "direct", "replacement").unwrap());
    assert_eq!(
        load_session_goal(&f.path, "direct")
            .unwrap()
            .unwrap()
            .goal_id,
        "replacement"
    );
}
