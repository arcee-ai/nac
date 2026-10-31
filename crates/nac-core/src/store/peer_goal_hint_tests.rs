//! Publication belongs to the peer's outer commit, including its admission
//! receipt and question/inbox changes. The lossy bus is never replay authority.
use super::*;
use crate::store::goal_changes::{self, GoalChangeKind, TaskChange};
use std::sync::{Arc, Barrier};
use tokio::sync::broadcast::{error::TryRecvError, Receiver};

fn fixture() -> (PathBuf, PeerGoalStart) {
    let path = std::env::temp_dir()
        .join(format!("nac-peer-hints-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["caller", "target"] {
        insert_test_session(&path, id);
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior='direct' WHERE session_id=?1",
                [id],
            )
            .unwrap();
    }
    let request = PeerGoalStart {
        caller_session_id: "caller".into(),
        request_id: "request".into(),
        target_session_id: "target".into(),
        project_id: None,
        objective: "finite objective".into(),
        token_budget: Some(100),
    };
    (path, request)
}

fn assert_hint(
    hints: &mut Receiver<TaskChange>,
    path: &Path,
    goal: &SessionGoalRecord,
    kind: GoalChangeKind,
) {
    let TaskChange::Goal(hint) = hints
        .try_recv()
        .expect("committed peer mutation must publish")
    else {
        panic!("expected the exact goal hint");
    };
    assert_eq!(hint.store_path, path);
    assert_eq!(hint.session_id, goal.session_id);
    assert_eq!(hint.goal_id, goal.goal_id);
    assert_eq!(hint.version, goal.version);
    assert_eq!(hint.status, goal.status);
    assert_eq!(hint.kind, kind);
}

fn assert_silent(hints: &mut Receiver<TaskChange>) {
    assert!(matches!(hints.try_recv(), Err(TryRecvError::Empty)));
}

fn transition(goal: &SessionGoalRecord, resume: bool, run: Option<&str>) -> PeerGoalTransition {
    PeerGoalTransition {
        session_id: goal.session_id.clone(),
        goal_id: goal.goal_id.clone(),
        expected_version: goal.version,
        resume,
        active_run_id: run.map(str::to_owned),
        project_id: None,
        config_version: 0,
    }
}

#[test]
fn start_hint_has_readable_committed_goal_and_receipt() {
    let (path, request) = fixture();
    let mut hints = goal_changes::subscribe(&path);
    let receipt = start_peer_goal(&path, &request, None, 0).unwrap();
    assert_hint(
        &mut hints,
        &path,
        &receipt.admitted_goal,
        GoalChangeKind::Current,
    );
    assert_eq!(
        load_session_goal(&path, "target").unwrap(),
        Some(receipt.admitted_goal.clone())
    );
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap(),
        Some(receipt)
    );
    assert_silent(&mut hints);
}

#[test]
fn replacement_publishes_exact_retired_then_admitted_identity() {
    let (path, request) = fixture();
    let first = start_peer_goal(&path, &request, None, 0).unwrap();
    let terminal = update_session_goal_by_model(
        &path,
        "target",
        &first.admitted_goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let mut next = request.clone();
    next.request_id = "next".into();
    next.objective = "next finite objective".into();
    let mut hints = goal_changes::subscribe(&path);
    let receipt = start_peer_goal(&path, &next, None, 0).unwrap();
    assert_hint(&mut hints, &path, &terminal, GoalChangeKind::Replaced);
    assert_hint(
        &mut hints,
        &path,
        &receipt.admitted_goal,
        GoalChangeKind::Current,
    );
    assert_silent(&mut hints);
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "target").unwrap() else {
        panic!()
    };
    let retained = snapshot
        .prior_goals
        .iter()
        .find(|goal| goal.goal_id == terminal.goal_id)
        .unwrap();
    assert_eq!(retained.version, terminal.version);
    assert_eq!(retained.status, GoalStatus::Complete);
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap(),
        Some(first)
    );
    assert_silent(&mut hints);
}

#[test]
fn pause_and_resume_publish_only_their_committed_cas_versions() {
    let (path, request) = fixture();
    let baseline = GoalRunBaseline {
        run_id: "running".into(),
        billable_tokens: 80,
        started_at_epoch_ms: 1,
        continuation: false,
    };
    let goal = start_peer_goal(&path, &request, Some(&baseline), 0)
        .unwrap()
        .admitted_goal;
    let mut hints = goal_changes::subscribe(&path);
    let paused = transition_peer_goal(&path, &transition(&goal, false, Some("running"))).unwrap();
    assert_eq!(paused.accounting_token_baseline, Some(80));
    assert_eq!(paused.accounting_run_id.as_deref(), Some("running"));
    assert_hint(&mut hints, &path, &paused, GoalChangeKind::Current);
    assert!(transition_peer_goal(&path, &transition(&goal, false, Some("running"))).is_err());
    assert!(transition_peer_goal(&path, &transition(&paused, true, Some("running"))).is_err());
    assert_silent(&mut hints);
    let settled = settle_session_goal_run(
        &path,
        "target",
        "running",
        110,
        2000,
        GoalRunDisposition::Completed,
    )
    .unwrap()
    .unwrap();
    // This separate accepted owner publishes its own settlement, exactly once.
    assert_hint(&mut hints, &path, &settled, GoalChangeKind::Current);
    let resumed = transition_peer_goal(&path, &transition(&settled, true, None)).unwrap();
    assert_eq!(resumed.remaining_tokens(), Some(70));
    assert_hint(&mut hints, &path, &resumed, GoalChangeKind::Current);
    assert!(transition_peer_goal(&path, &transition(&settled, true, None)).is_err());
    assert_silent(&mut hints);
}

#[test]
fn rejected_mutations_never_publish_or_change_the_goal() {
    for case in [
        "arguments",
        "stale",
        "foreign",
        "child",
        "backend",
        "config",
        "project",
    ] {
        let (path, mut request) = fixture();
        let baseline = GoalRunBaseline {
            run_id: "owner".into(),
            billable_tokens: 0,
            started_at_epoch_ms: 1,
            continuation: false,
        };
        let goal = start_peer_goal(&path, &request, Some(&baseline), 0)
            .unwrap()
            .admitted_goal;
        let mut hints = goal_changes::subscribe(&path);
        let mut change = transition(&goal, false, Some("owner"));
        let result = match case {
            "arguments" => {
                request.objective.push('!');
                start_peer_goal(&path, &request, None, 0).map(|_| ())
            }
            "stale" => {
                change.expected_version += 1;
                transition_peer_goal(&path, &change).map(|_| ())
            }
            "foreign" => {
                change.active_run_id = Some("foreign".into());
                transition_peer_goal(&path, &change).map(|_| ())
            }
            "child" => {
                create_traditional_child_relationship(
                    &path,
                    "caller",
                    "target",
                    GENERAL_CHILD_PROFILE,
                    "child",
                )
                .unwrap();
                transition_peer_goal(&path, &change).map(|_| ())
            }
            "backend" => {
                open_runtime_connection(&path)
                    .unwrap()
                    .execute(
                        "UPDATE sessions SET host_id='foreign-host' WHERE session_id='target'",
                        [],
                    )
                    .unwrap();
                transition_peer_goal(&path, &change).map(|_| ())
            }
            "config" => {
                open_runtime_connection(&path)
                    .unwrap()
                    .execute(
                        "UPDATE sessions SET config_version=1 WHERE session_id='target'",
                        [],
                    )
                    .unwrap();
                transition_peer_goal(&path, &change).map(|_| ())
            }
            "project" => {
                change.project_id = Some("other".into());
                transition_peer_goal(&path, &change).map(|_| ())
            }
            _ => unreachable!(),
        };
        assert!(result.is_err(), "{case}");
        assert_eq!(load_session_goal(&path, "target").unwrap(), Some(goal));
        assert_silent(&mut hints);
    }
}

#[test]
fn concurrent_start_emits_once_and_receipt_replay_stays_passive_after_clear() {
    let (path, request) = fixture();
    let mut hints = goal_changes::subscribe(&path);
    let barrier = Arc::new(Barrier::new(3));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let (path, request, barrier) = (path.clone(), request.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                start_peer_goal(&path, &request, None, 0).unwrap()
            })
        })
        .collect();
    barrier.wait();
    let mut receipts = workers.into_iter().map(|worker| worker.join().unwrap());
    let original = receipts.next().unwrap();
    assert_eq!(receipts.next().unwrap(), original);
    assert_hint(
        &mut hints,
        &path,
        &original.admitted_goal,
        GoalChangeKind::Current,
    );
    initialize(&path).unwrap();
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), original);
    assert_silent(&mut hints);
    drop(hints);
    update_session_goal_by_model(
        &path,
        "target",
        &original.admitted_goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let replacement =
        create_session_goal(&path, "target", "human replacement", None, None).unwrap();
    let mut hints = goal_changes::subscribe(&path);
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), original);
    assert_eq!(
        load_session_goal(&path, "target").unwrap(),
        Some(replacement.clone())
    );
    assert_silent(&mut hints);
    drop(hints);
    clear_session_goal(&path, "target", &replacement.goal_id, replacement.version).unwrap();
    initialize(&path).unwrap();
    let mut hints = goal_changes::subscribe(&path);
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), original);
    assert!(load_session_goal(&path, "target").unwrap().is_none());
    assert_silent(&mut hints);
}

#[test]
fn foreign_process_lost_ack_is_recovered_by_read_not_replayed_publication() {
    let (path, request) = fixture();
    let arguments = path.parent().unwrap().join("request.json");
    std::fs::write(&arguments, serde_json::to_vec(&request).unwrap()).unwrap();
    let mut hints = goal_changes::subscribe(&path);
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "store::peer_goals::tests::restart_writer_exits_after_commit",
            "--nocapture",
        ])
        .env("NAC_PEER_GOAL_RESTART_PATH", &path)
        .env("NAC_PEER_GOAL_RESTART_ARGUMENTS", &arguments)
        .status()
        .unwrap();
    assert!(status.success());
    let receipt = lookup_peer_goal_start(&path, &request).unwrap().unwrap();
    assert_eq!(
        load_session_goal(&path, "target").unwrap(),
        Some(receipt.admitted_goal.clone())
    );
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), receipt);
    assert_silent(&mut hints);
}

fn questions_with_pending_continuation(
    path: &Path,
) -> (GoalRunBaseline, QuestionRecord, QuestionRecord) {
    let run = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(path)
        .unwrap()
        .append_run_prompt(
            "target",
            0,
            &crate::types::Message::User {
                content: "work".into(),
            },
            &run,
        )
        .unwrap();
    let request = QuestionRequest {
        session_id: "target".into(),
        request_id: "answered".into(),
        run_id: run.clone(),
        generation: run.clone(),
        text: "Which format?".into(),
        choices: vec!["CSV".into()],
        responder_class: QuestionResponder::Information,
    };
    let question = create_task_question(path, &request, 0).unwrap();
    crate::store::task_questions::answer_task_question(
        path,
        "target",
        &QuestionAnswer {
            request_id: request.request_id.clone(),
            run_id: run.clone(),
            generation: run.clone(),
            expected_revision: question.revision,
            answer: "CSV".into(),
        },
        None,
        0,
    )
    .unwrap();
    let answered = load_task_question(path, "target", "answered")
        .unwrap()
        .unwrap();
    let mut request = request;
    request.request_id = "pending".into();
    let pending = create_task_question(path, &request, 0).unwrap();
    (
        GoalRunBaseline {
            run_id: run,
            billable_tokens: 0,
            started_at_epoch_ms: 1,
            continuation: false,
        },
        answered,
        pending,
    )
}

fn failed_start_restores_questions_and_inbox(commit_failure: bool) {
    let (path, request) = fixture();
    let (baseline, answered, pending) = questions_with_pending_continuation(&path);
    let inbox = list_session_inbox(&path, "target").unwrap();
    let conn = open_runtime_connection(&path).unwrap();
    if commit_failure {
        conn.execute_batch("CREATE TABLE peer_commit_fault(missing TEXT REFERENCES sessions(session_id) DEFERRABLE INITIALLY DEFERRED);
            CREATE TRIGGER reject_peer_receipt AFTER INSERT ON peer_goal_starts BEGIN INSERT INTO peer_commit_fault VALUES('absent-session'); END;").unwrap();
    } else {
        conn.execute_batch("CREATE TRIGGER reject_peer_receipt BEFORE INSERT ON peer_goal_starts BEGIN SELECT RAISE(ABORT,'injected peer receipt failure'); END;").unwrap();
    }
    let mut hints = goal_changes::subscribe(&path);
    let error = start_peer_goal(&path, &request, Some(&baseline), 0).unwrap_err();
    assert!(
        error.to_string().contains(if commit_failure {
            "FOREIGN KEY constraint failed"
        } else {
            "injected peer receipt failure"
        }),
        "{error:#}"
    );
    assert!(load_session_goal(&path, "target").unwrap().is_none());
    assert!(lookup_peer_goal_start(&path, &request).unwrap().is_none());
    assert_eq!(
        load_task_question(&path, "target", "answered").unwrap(),
        Some(answered.clone())
    );
    assert_eq!(
        load_task_question(&path, "target", "pending").unwrap(),
        Some(pending)
    );
    assert_eq!(list_session_inbox(&path, "target").unwrap(), inbox);
    assert_silent(&mut hints);
    conn.execute_batch("DROP TRIGGER reject_peer_receipt")
        .unwrap();
    let receipt = start_peer_goal(&path, &request, Some(&baseline), 0).unwrap();
    assert_hint(
        &mut hints,
        &path,
        &receipt.admitted_goal,
        GoalChangeKind::Current,
    );
    let cancelled = load_task_question(&path, "target", "pending")
        .unwrap()
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");
    let retained = load_task_question(&path, "target", "answered")
        .unwrap()
        .unwrap();
    assert_eq!(retained.answer, answered.answer);
    assert_eq!(retained.continuation_state.as_deref(), Some("cancelled"));
    assert!(list_session_inbox(&path, "target")
        .unwrap()
        .iter()
        .all(|item| item.status == InboxStatus::Cancelled));
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap(),
        Some(receipt)
    );
    assert_silent(&mut hints);
}

#[test]
fn receipt_insert_abort_rolls_back_question_invalidation_and_publishes_nothing() {
    failed_start_restores_questions_and_inbox(false);
}

#[test]
fn actual_commit_failure_rolls_back_question_invalidation_and_publishes_nothing() {
    failed_start_restores_questions_and_inbox(true);
}

#[test]
fn transition_commit_failure_is_silent_and_preserves_cas_state() {
    let (path, request) = fixture();
    let goal = start_peer_goal(&path, &request, None, 0)
        .unwrap()
        .admitted_goal;
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute_batch("CREATE TABLE peer_transition_fault(missing TEXT REFERENCES sessions(session_id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER reject_peer_transition AFTER UPDATE ON session_goals BEGIN INSERT INTO peer_transition_fault VALUES('absent-session'); END;").unwrap();
    let mut hints = goal_changes::subscribe(&path);
    let error = transition_peer_goal(&path, &transition(&goal, false, None)).unwrap_err();
    assert!(
        error.to_string().contains("FOREIGN KEY constraint failed"),
        "{error:#}"
    );
    assert_eq!(
        load_session_goal(&path, "target").unwrap(),
        Some(goal.clone())
    );
    assert_silent(&mut hints);
    conn.execute_batch("DROP TRIGGER reject_peer_transition")
        .unwrap();
    let paused = transition_peer_goal(&path, &transition(&goal, false, None)).unwrap();
    assert_hint(&mut hints, &path, &paused, GoalChangeKind::Current);
    assert_silent(&mut hints);
}
