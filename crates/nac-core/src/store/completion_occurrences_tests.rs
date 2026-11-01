use super::*;
use crate::{sessions, types::Message};

struct Fixture {
    path: PathBuf,
    next: u64,
    behavior: String,
}
impl Fixture {
    fn new(behavior: &str) -> Self {
        let path = std::env::temp_dir()
            .join(format!("nac-completion-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        initialize(&path).unwrap();
        insert_test_session(&path, "session");
        if !behavior.is_empty() {
            open_runtime_connection(&path)
                .unwrap()
                .execute(
                    "UPDATE sessions SET behavior=?1 WHERE session_id='session'",
                    [behavior],
                )
                .unwrap();
        }
        Self {
            path,
            next: 0,
            behavior: if behavior.is_empty() {
                "orchestrator".into()
            } else {
                behavior.into()
            },
        }
    }
    fn begin(&mut self, run: &str) {
        TranscriptLogWriter::new(&self.path)
            .unwrap()
            .append_run_prompt(
                "session",
                self.next,
                &Message::User {
                    content: "private request must not enter delivery metadata".into(),
                },
                run,
            )
            .unwrap();
        self.next += 1;
    }
    fn baseline(&self, run: &str) -> GoalRunBaseline {
        GoalRunBaseline {
            run_id: run.into(),
            billable_tokens: 0,
            started_at_epoch_ms: 1,
            continuation: false,
        }
    }
    fn update(
        &self,
        run: &str,
        disposition: RunTerminalDisposition,
    ) -> sessions::SessionRunStateUpdate {
        sessions::SessionRunStateUpdate {
            session_id: "session".into(),
            ssh: None,
            sandbox_spec: None,
            run_state: sessions::SessionRunState::default(),
            finished_run_id: Some(run.into()),
            finished_run_disposition: Some(disposition),
            failed_run_id: None,
            failed_run_failure: None,
            goal_settlement: (if self.behavior == "orchestrator" {
                None
            } else {
                load_session_goal(&self.path, "session").unwrap()
            })
            .filter(|g| g.accounting_run_id.as_deref() == Some(run))
            .map(|_| GoalRunSettlement {
                run_id: run.into(),
                final_billable_tokens: 0,
                terminal_at_epoch_ms: 2,
                disposition: if disposition == RunTerminalDisposition::Completed {
                    GoalRunDisposition::Completed
                } else {
                    GoalRunDisposition::Cancelled
                },
                failure: None,
            }),
            finished_run_result: Some("private result".into()),
            updated_at: now_utc(),
        }
    }
    fn finish(&self, run: &str) {
        sessions::save_session_run_state(
            &self.path,
            &self.update(run, RunTerminalDisposition::Completed),
        )
        .unwrap();
    }
    fn cursor(&self) -> CompletionCursor {
        read_completion_page(&self.path, None).unwrap().cursor
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(self.path.parent().unwrap()).unwrap();
    }
}

#[test]
fn completion_all_three_behaviors_retain_a_while_queued_or_transient_b_is_active() {
    for behavior in ["orchestrator", "direct", "direct-with-orchestrator", ""] {
        let mut fixture = Fixture::new(behavior);
        let after = fixture.cursor();
        fixture.begin("request-A");
        fixture.finish("request-A");
        // The new run begins before any notification/projection publication.
        fixture.begin("queued-or-new-operation-B");
        let page = read_completion_page(&fixture.path, Some(&after)).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].run_id, "request-A");
        assert_eq!(page.items[0].kind, CompletionKind::Request);
        assert_eq!(
            page.items[0].behavior,
            if behavior.is_empty() {
                "orchestrator"
            } else {
                behavior
            }
        );
        assert_eq!(
            load_run_recovery(&fixture.path, "session")
                .unwrap()
                .unwrap()
                .run_id,
            "queued-or-new-operation-B"
        );
        assert!(!serde_json::to_string(&page).unwrap().contains("private"));
        // Replayed terminal callback neither consumes B nor appends A again.
        fixture.finish("request-A");
        assert_eq!(
            read_completion_page(&fixture.path, Some(&after))
                .unwrap()
                .items
                .len(),
            1
        );
        assert_eq!(
            load_run_recovery(&fixture.path, "session")
                .unwrap()
                .unwrap()
                .run_id,
            "queued-or-new-operation-B"
        );
    }
}

#[test]
fn completion_exact_goal_mark_survives_replacement_before_successful_settlement() {
    let mut fixture = Fixture::new("direct");
    let after = fixture.cursor();
    fixture.begin("A");
    let goal = create_session_goal(
        &fixture.path,
        "session",
        "private goal A",
        None,
        Some(&fixture.baseline("A")),
    )
    .unwrap();
    let mark = update_session_goal_by_model(
        &fixture.path,
        "session",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    // No notification is authorized by update_goal alone.
    assert!(read_completion_page(&fixture.path, Some(&after))
        .unwrap()
        .items
        .is_empty());
    let next = create_session_goal(
        &fixture.path,
        "session",
        "unrelated goal B",
        None,
        Some(&fixture.baseline("A")),
    )
    .unwrap();
    fixture.finish("A");
    let page = read_completion_page(&fixture.path, Some(&after)).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].kind, CompletionKind::Goal);
    assert_eq!(
        page.items[0].goal_id.as_deref(),
        Some(goal.goal_id.as_str())
    );
    assert_eq!(page.items[0].mark_version, Some(mark.version));
    assert_eq!(
        load_session_goal(&fixture.path, "session")
            .unwrap()
            .unwrap()
            .goal_id,
        next.goal_id
    );
    assert_eq!(
        load_session_goal(&fixture.path, "session")
            .unwrap()
            .unwrap()
            .status,
        GoalStatus::Active
    );
}

#[test]
fn completion_active_goal_question_yield_cancel_and_failure_are_not_completed_requests() {
    for disposition in ["active-goal", "question", "cancelled", "failed"] {
        let mut fixture = Fixture::new("direct");
        let after = fixture.cursor();
        let run = uuid::Uuid::new_v4().to_string();
        fixture.begin(&run);
        if disposition == "active-goal" {
            create_session_goal(
                &fixture.path,
                "session",
                "still working",
                None,
                Some(&fixture.baseline(&run)),
            )
            .unwrap();
        }
        if disposition == "question" {
            create_task_question(
                &fixture.path,
                &QuestionRequest {
                    session_id: "session".into(),
                    request_id: "decision".into(),
                    run_id: run.clone(),
                    generation: run.clone(),
                    text: "private question".into(),
                    choices: vec![],
                    responder_class: QuestionResponder::HumanDecision,
                },
                0,
            )
            .unwrap();
        }
        if disposition == "failed" {
            let mut update = fixture.update(&run, RunTerminalDisposition::Completed);
            update.finished_run_id = None;
            update.finished_run_disposition = None;
            update.finished_run_result = None;
            update.failed_run_id = Some(run.clone());
            update.failed_run_failure = Some(crate::run_failure::RunFailure::unknown("failure"));
            sessions::save_session_run_state(&fixture.path, &update).unwrap();
        } else if disposition == "cancelled" {
            sessions::save_session_run_state(
                &fixture.path,
                &fixture.update(&run, RunTerminalDisposition::Cancelled),
            )
            .unwrap();
        } else {
            fixture.finish(&run);
        }
        assert!(
            read_completion_page(&fixture.path, Some(&after))
                .unwrap()
                .items
                .is_empty(),
            "{disposition}"
        );
    }
}

#[test]
fn completion_atomic_insert_failure_rolls_back_terminal_then_exact_retry_is_once() {
    let mut fixture = Fixture::new("direct");
    let after = fixture.cursor();
    fixture.begin("A");
    let goal = create_session_goal(
        &fixture.path,
        "session",
        "private goal",
        None,
        Some(&fixture.baseline("A")),
    )
    .unwrap();
    update_session_goal_by_model(
        &fixture.path,
        "session",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let conn = open_runtime_connection(&fixture.path).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_completion BEFORE INSERT ON session_completion_occurrences BEGIN SELECT RAISE(ABORT,'fixture commit boundary'); END;").unwrap();
    let update = fixture.update("A", RunTerminalDisposition::Completed);
    assert!(sessions::save_session_run_state(&fixture.path, &update).is_err());
    assert!(read_completion_page(&fixture.path, Some(&after))
        .unwrap()
        .items
        .is_empty());
    assert_eq!(
        load_run_recovery(&fixture.path, "session")
            .unwrap()
            .unwrap()
            .status,
        RunRecoveryStatus::Active
    );
    assert_eq!(
        load_session_goal(&fixture.path, "session")
            .unwrap()
            .unwrap()
            .accounting_run_id
            .as_deref(),
        Some("A")
    );
    conn.execute_batch("DROP TRIGGER fail_completion").unwrap();
    sessions::save_session_run_state(&fixture.path, &update).unwrap();
    // A lost consumer/acknowledgement after commit is reconciled by replay,
    // never by creating another semantic occurrence.
    sessions::save_session_run_state(&fixture.path, &update).unwrap();
    assert_eq!(
        read_completion_page(&fixture.path, Some(&after))
            .unwrap()
            .items
            .len(),
        1
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM session_completion_bindings",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn completion_disconnected_replay_outlives_eight_receipts_and_256_stream_records_with_bounded_pages(
) {
    let mut fixture = Fixture::new("direct");
    let cutoff = fixture.cursor();
    for n in 0..300 {
        let run = format!("run-{n}");
        fixture.begin(&run);
        fixture.finish(&run);
    }
    initialize(&fixture.path).unwrap(); // serving/consumer restart leaves the semantic cursor valid
    let mut cursor = cutoff.clone();
    let mut ids = Vec::new();
    let mut pages = 0;
    loop {
        let page = read_completion_page(&fixture.path, Some(&cursor)).unwrap();
        assert!(page.items.len() <= COMPLETION_PAGE_ROWS);
        assert!(serde_json::to_vec(&page).unwrap().len() <= COMPLETION_PAGE_BYTES);
        ids.extend(page.items.iter().map(|item| item.sequence));
        cursor = page.cursor;
        pages += 1;
        if !page.more {
            break;
        }
    }
    assert_eq!(ids.len(), 300);
    assert_eq!(
        ids.iter().collect::<std::collections::HashSet<_>>().len(),
        300
    );
    assert_eq!(pages, 3);
    assert!(read_completion_page(&fixture.path, Some(&cursor))
        .unwrap()
        .items
        .is_empty());
    assert_eq!(
        read_completion_page(&fixture.path, Some(&cutoff))
            .unwrap()
            .items
            .len(),
        128
    );
    assert!(read_completion_page(
        &fixture.path,
        Some(&CompletionCursor {
            store: uuid::Uuid::new_v4().to_string(),
            sequence: 0
        })
    )
    .is_err());
    assert!(read_completion_page(
        &fixture.path,
        Some(&CompletionCursor {
            store: cursor.store,
            sequence: 301
        })
    )
    .is_err());
}

#[test]
fn completion_canonical_recovery_promotes_only_exact_success_and_is_idempotent() {
    let mut fixture = Fixture::new("direct");
    let after = fixture.cursor();
    fixture.begin("A");
    let assistant: Message = serde_json::from_value(
        serde_json::json!({"role":"assistant","content":"canonical answer"}),
    )
    .unwrap();
    TranscriptLogWriter::new(&fixture.path)
        .unwrap()
        .append("session", fixture.next, &assistant)
        .unwrap();
    assert_eq!(
        reconcile_active_run(&fixture.path, "session").unwrap(),
        ActiveRunReconciliation::CanonicalTerminal
    );
    assert_eq!(
        reconcile_active_run(&fixture.path, "session").unwrap(),
        ActiveRunReconciliation::None
    );
    assert_eq!(
        read_completion_page(&fixture.path, Some(&after))
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn completion_relationship_owned_run_does_not_duplicate_primary_but_new_human_run_remains_distinct()
{
    let mut fixture = Fixture::new("direct");
    let after = fixture.cursor();
    insert_test_session(&fixture.path, "parent");
    open_runtime_connection(&fixture.path).unwrap().execute_batch("INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,run_id,execution_mode,created_at,updated_at) VALUES('session','parent','parent','general','child',1,'running',1,'delegated','background','now','now');").unwrap();
    fixture.begin("delegated");
    fixture.finish("delegated");
    assert!(read_completion_page(&fixture.path, Some(&after))
        .unwrap()
        .items
        .is_empty());
    // Ordinary relationship settlement releases its old recovery obligation.
    open_runtime_connection(&fixture.path)
        .unwrap()
        .execute(
            "UPDATE traditional_children SET status='completed' WHERE child_session_id='session'",
            [],
        )
        .unwrap();
    clear_settled_run_recovery(&fixture.path, "session", "delegated").unwrap();
    fixture.begin("new-explicit-request");
    fixture.finish("new-explicit-request");
    assert_eq!(
        read_completion_page(&fixture.path, Some(&after))
            .unwrap()
            .items[0]
            .run_id,
        "new-explicit-request"
    );
}
