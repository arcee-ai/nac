use super::*;
use crate::store::task_questions::{answer_task_question, create_task_question};
use crate::store::{QuestionAnswer, QuestionRecord, QuestionRequest, QuestionResponder};
use crate::types::Message;

fn pending_question(f: &Fixture) -> QuestionRecord {
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&f.path)
        .unwrap()
        .append_run_prompt(
            "direct",
            0,
            &Message::User {
                content: "Work".into(),
            },
            &run,
        )
        .unwrap();
    let question = create_task_question(
        &f.path,
        &QuestionRequest {
            session_id: "direct".into(),
            request_id: "heartbeat-blocking-question".into(),
            run_id: run.clone(),
            generation: run.clone(),
            text: "Which result should be checked?".into(),
            choices: vec!["CSV".into(), "JSON".into()],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    end_run(f, &run);
    question
}

fn end_run(f: &Fixture, run: &str) {
    let mut conn = open_runtime_connection(&f.path).unwrap();
    let tx = conn.transaction().unwrap();
    clear_active_run(&tx, "direct", run, RunTerminalDisposition::Completed).unwrap();
    tx.commit().unwrap();
}

fn answer(question: &QuestionRecord) -> QuestionAnswer {
    QuestionAnswer {
        request_id: question.request.request_id.clone(),
        run_id: question.request.run_id.clone(),
        generation: question.request.generation.clone(),
        expected_revision: question.revision,
        answer: "CSV".into(),
    }
}

fn try_admit(path: &Path, pending: &HeartbeatOccurrence) -> Result<Option<HeartbeatOccurrence>> {
    admit_heartbeat(
        path,
        "direct",
        &pending.occurrence_id,
        pending.revision,
        &uuid::Uuid::new_v4().to_string(),
        &pending.receipt_id,
        "authorized heartbeat input",
        "/tmp/project",
        61_000,
    )
}

fn assert_retained(f: &Fixture, schedule: &HeartbeatSchedule, pending: &HeartbeatOccurrence) {
    assert_eq!(
        heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap(),
        vec![pending.clone()]
    );
    let current = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(current.state, HeartbeatState::Active);
    assert_eq!(current.starts, 0);
    assert!(crate::store::load_session_goal(&f.path, "direct")
        .unwrap()
        .is_none());
}

#[test]
fn heartbeat_question_gate_preserves_receipt_through_restart_and_exact_answer_continuation() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let question = pending_question(&f);
    for _ in 0..2 {
        assert!(try_admit(&f.path, &pending).unwrap().is_none());
        initialize(&f.path).unwrap();
        assert_retained(&f, &schedule, &pending);
        assert!(list_session_inbox(&f.path, "direct").unwrap().is_empty());
    }
    let input = answer(&question);
    let accepted = answer_task_question(&f.path, "direct", &input, None, 0)
        .unwrap()
        .receipt;
    assert_eq!(
        answer_task_question(&f.path, "direct", &input, None, 0)
            .unwrap()
            .receipt,
        accepted
    );
    // The pending answer owns one exact ordinary continuation; the heartbeat
    // must not adopt it even though the blocking question is now answered.
    assert!(try_admit(&f.path, &pending).unwrap().is_none());
    assert_retained(&f, &schedule, &pending);
    let item = load_session_inbox_item(&f.path, "direct", accepted.inbox_item_id).unwrap();
    let writer = TranscriptLogWriter::new(&f.path).unwrap();
    let prompt = Message::User {
        content: item.content,
    };
    assert!(writer
        .append_inbox_run_prompt(
            "direct",
            1,
            &prompt,
            &uuid::Uuid::new_v4().to_string(),
            item.id
        )
        .is_err());
    writer
        .append_inbox_run_prompt("direct", 1, &prompt, &accepted.continuation_run_id, item.id)
        .unwrap();
    writer
        .append_inbox_run_prompt("direct", 1, &prompt, &accepted.continuation_run_id, item.id)
        .unwrap();
    let retry = answer_task_question(&f.path, "direct", &input, None, 0).unwrap();
    assert_eq!(retry.receipt, accepted);
    assert!(!retry.should_wake);
    end_run(&f, &accepted.continuation_run_id);
    let active = try_admit(&f.path, &pending).unwrap().unwrap();
    assert_eq!(active.occurrence_id, pending.occurrence_id);
    assert_eq!(active.receipt_id, pending.receipt_id);
    assert_eq!(active.attempt_count, 1);
    assert_eq!(list_session_inbox(&f.path, "direct").unwrap().len(), 2);
    assert!(heartbeat_report(
        &f.path,
        "direct",
        &active.occurrence_id,
        active.run_id.as_ref().unwrap(),
        &uuid::Uuid::new_v4().to_string(),
        active.revision,
        HeartbeatOutcome::Unchanged,
        "stale generation"
    )
    .is_err());
    reconcile_heartbeat_occurrences(&f.path, "direct", 62_000).unwrap();
    reconcile_heartbeat_occurrences(&f.path, "direct", 63_000).unwrap();
    let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].outcome, Some(HeartbeatOutcome::Interrupted));
    assert_eq!(history[0].run_id, active.run_id);
}

#[test]
fn heartbeat_question_answer_race_never_overtakes_pending_question_or_its_answer() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let question = pending_question(&f);
    let barrier = Arc::new(std::sync::Barrier::new(2));
    std::thread::scope(|scope| {
        let (f, pending, question) = (&f, &pending, &question);
        let gate = Arc::clone(&barrier);
        let first = scope.spawn(move || {
            gate.wait();
            try_admit(&f.path, &pending)
        });
        let gate = Arc::clone(&barrier);
        let second = scope.spawn(move || {
            gate.wait();
            answer_task_question(&f.path, "direct", &answer(&question), None, 0)
        });
        assert!(first.join().unwrap().unwrap().is_none());
        assert!(second.join().unwrap().is_ok());
    });
    assert_retained(&f, &schedule, &pending);
    assert_eq!(list_session_inbox(&f.path, "direct").unwrap().len(), 1);
    assert!(try_admit(&f.path, &pending).unwrap().is_none());
}

#[test]
fn heartbeat_question_read_failure_rolls_back_without_spending_occurrence() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let question = pending_question(&f);
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute(
        "UPDATE task_questions SET request_json='null' WHERE session_id='direct'",
        [],
    )
    .unwrap();
    assert!(try_admit(&f.path, &pending).is_err());
    assert_retained(&f, &schedule, &pending);
    assert!(list_session_inbox(&f.path, "direct").unwrap().is_empty());
    conn.execute(
        "UPDATE task_questions SET request_json=?1 WHERE session_id='direct'",
        [serde_json::to_string(&question.request).unwrap()],
    )
    .unwrap();
    assert!(try_admit(&f.path, &pending).unwrap().is_none());
    assert_retained(&f, &schedule, &pending);
}

#[test]
fn heartbeat_question_deferral_does_not_revive_stopped_or_edited_occurrence() {
    for stop in [false, true] {
        let f = Fixture::new();
        let schedule = f.create();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let question = pending_question(&f);
        assert!(try_admit(&f.path, &pending).unwrap().is_none());
        let action = if stop {
            HeartbeatAction::Stop {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
            }
        } else {
            let mut updated = spec();
            updated.interval_ms = 120_000;
            HeartbeatAction::Edit {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
                spec: updated,
            }
        };
        f.control(action, 62_000);
        crate::store::task_questions::cancel_task_question(
            &f.path,
            "direct",
            &question.request.request_id,
            question.revision,
        )
        .unwrap();
        assert!(try_admit(&f.path, &pending).is_err());
        let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
        assert_eq!(history[0].state, HeartbeatOccurrenceState::Withdrawn);
        assert!(history[0].run_id.is_none());
        assert_eq!(history[0].attempt_count, 0);
        assert!(list_session_inbox(&f.path, "direct").unwrap().is_empty());
    }
}
