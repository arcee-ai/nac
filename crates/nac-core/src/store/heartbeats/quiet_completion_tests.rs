use super::*;

fn admitted(f: &InitialPrompt) -> CompletionCursor {
    let cutoff = read_completion_page(&f.fixture.path, None).unwrap().cursor;
    TranscriptLogWriter::new(&f.fixture.path)
        .unwrap()
        .append_admitted_inbox_run_prompt(&f.inbox.session_id, 0, &f.message, &f.run, &f.inbox)
        .unwrap();
    cutoff
}

fn reported(f: &InitialPrompt, outcome: HeartbeatOutcome) {
    heartbeat_report(
        &f.fixture.path,
        &f.inbox.session_id,
        &f.occurrence.occurrence_id,
        &f.run,
        f.occurrence.generation.as_deref().unwrap(),
        f.occurrence.revision,
        outcome,
        "Exact classification evidence.",
    )
    .unwrap();
}

fn terminal(f: &InitialPrompt) -> crate::sessions::SessionRunStateUpdate {
    let mut update = terminal_update(f);
    update.updated_at = "same-terminal-second".into();
    update.heartbeat_settlement = Some(HeartbeatRunSettlement {
        tokens_used: Some(3),
        duration_ms: 10,
        terminal_at_epoch_ms: 63_000,
        needs_human_action: false,
    });
    update
}

#[test]
fn quiet_join_final_overrides_and_missing_classification_keep_existing_visibility() {
    for case in [
        "unchanged",
        "meaningful",
        "finished",
        "unknown",
        "missing",
        "action",
        "failed",
        "cancelled",
    ] {
        let f = initial_prompt();
        let cutoff = admitted(&f);
        let provisional = match case {
            "meaningful" => HeartbeatOutcome::Meaningful,
            "finished" => HeartbeatOutcome::Finished,
            "unknown" => HeartbeatOutcome::Unknown,
            _ => HeartbeatOutcome::Unchanged,
        };
        if case != "unknown" {
            reported(&f, provisional);
        }
        let mut update = terminal(&f);
        let expected = match case {
            "action" => {
                update
                    .heartbeat_settlement
                    .as_mut()
                    .unwrap()
                    .needs_human_action = true;
                HeartbeatOutcome::NeedsHumanAction
            }
            "failed" => {
                update.finished_run_id = None;
                update.finished_run_disposition = None;
                update.failed_run_id = Some(f.run.clone());
                update.failed_run_failure =
                    Some(crate::run_failure::RunFailure::unknown("failure"));
                HeartbeatOutcome::Failed
            }
            "cancelled" => {
                update.finished_run_disposition = Some(RunTerminalDisposition::Cancelled);
                HeartbeatOutcome::Interrupted
            }
            "missing" => {
                update.heartbeat_settlement = None;
                HeartbeatOutcome::Unknown
            }
            _ => provisional,
        };
        for _ in 0..2 {
            crate::sessions::save_session_run_state(&f.fixture.path, &update).unwrap();
            initialize(&f.fixture.path).unwrap();
        }
        let history = heartbeat_history(
            &f.fixture.path,
            "project:project",
            &f.occurrence.schedule_id,
        )
        .unwrap();
        assert_eq!(
            history[0].outcome,
            (case != "missing").then_some(expected),
            "{case}"
        );
        assert_eq!(history[0].run_id.as_deref(), Some(f.run.as_str()));
        let visible = !matches!(case, "unchanged" | "failed" | "cancelled");
        assert_eq!(
            read_completion_page(&f.fixture.path, Some(&cutoff))
                .unwrap()
                .items
                .len(),
            usize::from(visible),
            "{case}"
        );
        if matches!(case, "action" | "failed" | "cancelled") {
            assert_eq!(
                read_heartbeat(
                    &f.fixture.path,
                    "project:project",
                    &f.occurrence.schedule_id
                )
                .unwrap()
                .state,
                HeartbeatState::Suspended
            );
        }
    }
}

#[test]
fn quiet_join_goal_a_mark_survives_quiet_run_with_unrelated_b_question() {
    let f = initial_prompt();
    let cutoff = admitted(&f);
    let session = &f.inbox.session_id;
    let baseline = GoalRunBaseline {
        run_id: f.run.clone(),
        billable_tokens: 0,
        started_at_epoch_ms: 1,
        continuation: false,
    };
    let a = create_session_goal(&f.fixture.path, session, "A", None, Some(&baseline)).unwrap();
    let mark =
        update_session_goal_by_model(&f.fixture.path, session, &a.goal_id, GoalStatus::Complete)
            .unwrap();
    let b = create_session_goal(&f.fixture.path, session, "B", None, Some(&baseline)).unwrap();
    let question = create_task_question(
        &f.fixture.path,
        &QuestionRequest {
            session_id: session.clone(),
            request_id: "B-question".into(),
            run_id: f.run.clone(),
            generation: f.run.clone(),
            text: "Choose B".into(),
            choices: vec![],
            responder_class: QuestionResponder::HumanDecision,
        },
        0,
    )
    .unwrap();
    reported(&f, HeartbeatOutcome::Unchanged);
    let mut update = terminal(&f);
    update.goal_settlement = Some(GoalRunSettlement {
        run_id: f.run.clone(),
        final_billable_tokens: 0,
        terminal_at_epoch_ms: 63_000,
        disposition: GoalRunDisposition::Completed,
        failure: None,
    });
    crate::sessions::save_session_run_state(&f.fixture.path, &update).unwrap();
    let page = read_completion_page(&f.fixture.path, Some(&cutoff)).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].kind, CompletionKind::Goal);
    assert_eq!(page.items[0].goal_id.as_deref(), Some(a.goal_id.as_str()));
    assert_eq!(page.items[0].mark_version, Some(mark.version));
    assert_eq!(
        load_session_goal(&f.fixture.path, session)
            .unwrap()
            .unwrap()
            .goal_id,
        b.goal_id
    );
    assert_eq!(
        pending_task_question(&f.fixture.path, session).unwrap(),
        Some(question)
    );
}

#[test]
fn quiet_join_later_ordinary_b_in_same_second_remains_visible() {
    let f = initial_prompt();
    let cutoff = admitted(&f);
    reported(&f, HeartbeatOutcome::Unchanged);
    let mut update = terminal(&f);
    crate::sessions::save_session_run_state(&f.fixture.path, &update).unwrap();
    assert!(heartbeat_attention_snapshot(&f.fixture.path)
        .unwrap()
        .quiet_updated_at
        .contains_key(&f.inbox.session_id));
    let b = uuid::Uuid::new_v4().to_string();
    TranscriptLogWriter::new(&f.fixture.path)
        .unwrap()
        .append_run_prompt(
            &f.inbox.session_id,
            1,
            &Message::User {
                content: "Human B".into(),
            },
            &b,
        )
        .unwrap();
    update.finished_run_id = Some(b.clone());
    update.heartbeat_settlement = None;
    crate::sessions::save_session_run_state(&f.fixture.path, &update).unwrap();
    assert!(!heartbeat_attention_snapshot(&f.fixture.path)
        .unwrap()
        .quiet_updated_at
        .contains_key(&f.inbox.session_id));
    let items = read_completion_page(&f.fixture.path, Some(&cutoff))
        .unwrap()
        .items;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].run_id, b);
}

#[test]
fn quiet_join_outer_rollback_covers_outcome_classifier_and_binding_consumption() {
    for stage in ["classification", "request", "binding"] {
        let f = initial_prompt();
        let cutoff = admitted(&f);
        reported(
            &f,
            if stage == "request" {
                HeartbeatOutcome::Meaningful
            } else {
                HeartbeatOutcome::Unchanged
            },
        );
        let conn = open_runtime_connection(&f.fixture.path).unwrap();
        let trigger = match stage {
            "classification" => "BEFORE UPDATE ON heartbeat_occurrences WHEN NEW.state='settled'",
            "request" => "BEFORE INSERT ON session_completion_occurrences WHEN NEW.kind='request'",
            _ => "BEFORE DELETE ON session_completion_bindings",
        };
        conn.execute_batch(&format!(
            "CREATE TRIGGER fault {trigger} BEGIN SELECT RAISE(ABORT,'terminal fault'); END;"
        ))
        .unwrap();
        assert!(crate::sessions::save_session_run_state(&f.fixture.path, &terminal(&f)).is_err());
        let counts: (i64, i64, String) = conn.query_row(
            "SELECT (SELECT count(*) FROM session_run_outcomes),(SELECT count(*) FROM session_completion_bindings),(SELECT state FROM heartbeat_occurrences WHERE occurrence_id=?1)",
            [&f.occurrence.occurrence_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(counts, (0, 1, "admitted".into()));
        assert!(read_completion_page(&f.fixture.path, Some(&cutoff))
            .unwrap()
            .items
            .is_empty());
        conn.execute_batch("DROP TRIGGER fault").unwrap();
        crate::sessions::save_session_run_state(&f.fixture.path, &terminal(&f)).unwrap();
    }
}

#[test]
fn quiet_join_recovery_never_promotes_provisional_unchanged_to_quiet() {
    for final_committed in [false, true] {
        let f = initial_prompt();
        let cutoff = admitted(&f);
        reported(&f, HeartbeatOutcome::Unchanged);
        if final_committed {
            let mut conn = open_runtime_connection(&f.fixture.path).unwrap();
            let tx = conn.transaction().unwrap();
            settle_heartbeat_with_connection(
                &tx,
                &f.inbox.session_id,
                &f.run,
                HeartbeatOutcome::Unknown,
                Some(3),
                10,
                63_000,
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let assistant: Message = serde_json::from_value(
            serde_json::json!({"role":"assistant","content":"Canonical terminal"}),
        )
        .unwrap();
        TranscriptLogWriter::new(&f.fixture.path)
            .unwrap()
            .append(&f.inbox.session_id, 1, &assistant)
            .unwrap();
        let _lease = crate::sessions::SessionOperationLease::try_acquire(
            &f.fixture.path,
            &f.inbox.session_id,
        )
        .unwrap();
        assert_eq!(
            reconcile_active_run(&f.fixture.path, &f.inbox.session_id).unwrap(),
            ActiveRunReconciliation::CanonicalTerminal
        );
        reconcile_heartbeat_occurrences(&f.fixture.path, &f.inbox.session_id, 65_000).unwrap();
        assert_eq!(
            reconcile_active_run(&f.fixture.path, &f.inbox.session_id).unwrap(),
            ActiveRunReconciliation::None
        );
        let history = heartbeat_history(
            &f.fixture.path,
            "project:project",
            &f.occurrence.schedule_id,
        )
        .unwrap();
        assert_eq!(
            history[0].outcome,
            Some(if final_committed {
                HeartbeatOutcome::Unchanged
            } else {
                HeartbeatOutcome::Interrupted
            })
        );
        assert_eq!(
            read_completion_page(&f.fixture.path, Some(&cutoff))
                .unwrap()
                .items
                .len(),
            usize::from(!final_committed)
        );
    }
}

#[test]
fn quiet_join_connection_and_exact_identity_mismatches_roll_back() {
    for change in [
        "connection",
        "foreign-store",
        "session",
        "run",
        "occurrence",
        "generation",
    ] {
        let f = initial_prompt();
        admitted(&f);
        reported(&f, HeartbeatOutcome::Unchanged);
        let mut conn = open_runtime_connection(&f.fixture.path).unwrap();
        let tx = conn.transaction().unwrap();
        let fact = settle_heartbeat_with_connection(
            &tx,
            &f.inbox.session_id,
            &f.run,
            HeartbeatOutcome::Unknown,
            Some(3),
            10,
            63_000,
        )
        .unwrap()
        .unwrap();
        let other_path = if change == "foreign-store" {
            let path = f.fixture.root.join("foreign.db");
            initialize(&path).unwrap();
            path
        } else {
            f.fixture.path.clone()
        };
        let other = open_runtime_connection(&other_path).unwrap();
        tx.execute_batch("PRAGMA defer_foreign_keys=ON").unwrap();
        if change == "occurrence" {
            tx.execute(
                "UPDATE heartbeat_occurrences SET occurrence_id='different' WHERE occurrence_id=?1",
                [&f.occurrence.occurrence_id],
            )
            .unwrap();
        }
        if change == "generation" {
            tx.execute(
                "UPDATE heartbeat_occurrences SET generation='different' WHERE occurrence_id=?1",
                [&f.occurrence.occurrence_id],
            )
            .unwrap();
        }
        assert!(
            fact.outcome_for(
                if matches!(change, "connection" | "foreign-store") {
                    &other
                } else {
                    &tx
                },
                if change == "session" {
                    "wrong-session"
                } else {
                    &f.inbox.session_id
                },
                if change == "run" { "wrong-run" } else { &f.run }
            )
            .is_err(),
            "{change}"
        );
        tx.rollback().unwrap();
        assert_eq!(
            heartbeat_history(
                &f.fixture.path,
                "project:project",
                &f.occurrence.schedule_id
            )
            .unwrap()[0]
                .state,
            HeartbeatOccurrenceState::Admitted
        );
    }
}

#[test]
fn quiet_join_relationship_marker_consumes_binding_once_and_clears_only_exact_run() {
    let f = initial_prompt();
    let cutoff = admitted(&f);
    reported(&f, HeartbeatOutcome::Unchanged);
    let conn = open_runtime_connection(&f.fixture.path).unwrap();
    conn.execute("INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,run_id,execution_mode,created_at,updated_at) VALUES(?1,'creator','creator','general','child',1,'running',1,?2,'background','now','now')",params![f.inbox.session_id,f.run]).unwrap();
    crate::sessions::save_session_run_state(&f.fixture.path, &terminal(&f)).unwrap();
    assert_eq!(
        load_run_recovery(&f.fixture.path, &f.inbox.session_id)
            .unwrap()
            .unwrap()
            .terminal_disposition,
        Some(RunTerminalDisposition::Completed)
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
    let _lease =
        crate::sessions::SessionOperationLease::try_acquire(&f.fixture.path, &f.inbox.session_id)
            .unwrap();
    assert_eq!(
        reconcile_active_run(&f.fixture.path, &f.inbox.session_id).unwrap(),
        ActiveRunReconciliation::CanonicalTerminal
    );
    assert!(read_completion_page(&f.fixture.path, Some(&cutoff))
        .unwrap()
        .items
        .is_empty());
    assert!(load_run_recovery(&f.fixture.path, &f.inbox.session_id)
        .unwrap()
        .is_some());
    conn.execute(
        "UPDATE traditional_children SET status='completed' WHERE child_session_id=?1",
        [&f.inbox.session_id],
    )
    .unwrap();
    clear_settled_run_recovery(&f.fixture.path, &f.inbox.session_id, "wrong-run").unwrap();
    assert!(load_run_recovery(&f.fixture.path, &f.inbox.session_id)
        .unwrap()
        .is_some());
    clear_settled_run_recovery(&f.fixture.path, &f.inbox.session_id, &f.run).unwrap();
    assert!(load_run_recovery(&f.fixture.path, &f.inbox.session_id)
        .unwrap()
        .is_none());
}

#[test]
fn current_question_overrides_quiet_report_without_request_completion() {
    for provisional in [
        HeartbeatOutcome::Unchanged,
        HeartbeatOutcome::Meaningful,
        HeartbeatOutcome::Finished,
    ] {
        let f = initial_prompt();
        let cutoff = admitted(&f);
        let question = create_task_question(
            &f.fixture.path,
            &QuestionRequest {
                session_id: f.inbox.session_id.clone(),
                request_id: "current-question".into(),
                run_id: f.run.clone(),
                generation: f.run.clone(),
                text: "Choose the next action".into(),
                choices: vec![],
                responder_class: QuestionResponder::HumanDecision,
            },
            0,
        )
        .unwrap();
        reported(&f, provisional);
        for _ in 0..2 {
            crate::sessions::save_session_run_state(&f.fixture.path, &terminal(&f)).unwrap();
            initialize(&f.fixture.path).unwrap();
        }
        let history = heartbeat_history(
            &f.fixture.path,
            "project:project",
            &f.occurrence.schedule_id,
        )
        .unwrap();
        assert_eq!(history[0].outcome, Some(HeartbeatOutcome::NeedsHumanAction));
        assert_eq!(history[0].provisional_outcome, Some(provisional));
        let schedule = read_heartbeat(
            &f.fixture.path,
            "project:project",
            &f.occurrence.schedule_id,
        )
        .unwrap();
        assert_eq!(schedule.state, HeartbeatState::Suspended);
        assert_eq!(
            schedule.tokens_used, 3,
            "terminal replay must not double charge"
        );
        assert_eq!(
            pending_task_question(&f.fixture.path, &f.inbox.session_id).unwrap(),
            Some(question)
        );
        assert!(read_completion_page(&f.fixture.path, Some(&cutoff))
            .unwrap()
            .items
            .is_empty());
        let bindings: i64 = open_runtime_connection(&f.fixture.path)
            .unwrap()
            .query_row(
                "SELECT count(*) FROM session_completion_bindings WHERE session_id=?1",
                [&f.inbox.session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            bindings, 0,
            "question yield still consumes the exact binding"
        );
    }
}

#[test]
fn quiet_final_fact_survives_actual_bounded_pruning_before_binding_consumption() {
    let f = initial_prompt();
    let cutoff = admitted(&f);
    reported(&f, HeartbeatOutcome::Unchanged);
    let mut conn = open_runtime_connection(&f.fixture.path).unwrap();
    let tx = conn.transaction().unwrap();
    record_run_outcome_with_connection(
        &tx,
        &f.inbox.session_id,
        &f.run,
        RunOutcomeDisposition::Completed,
        Some("canonical result"),
        None,
    )
    .unwrap();
    let fact = settle_heartbeat_with_connection(
        &tx,
        &f.inbox.session_id,
        &f.run,
        HeartbeatOutcome::Unknown,
        Some(3),
        10,
        63_000,
    )
    .unwrap()
    .unwrap();
    // Later retained history can displace the settled row. Exercise the real
    // bounded history owner rather than manufacturing a different final fact.
    for i in 0..33 {
        tx.execute(
            "INSERT INTO heartbeat_occurrences(
                occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,
                coalesced_count,source,state,specification_json,receipt_id,expected_revision,
                outcome,started_at_ms,settled_at_ms,settlement_sequence)
             SELECT ?2,schedule_id,session_id,schedule_version,?3,?3,1,'interval','settled',
                specification_json,?2,1,'meaningful',?3,?3,?4
             FROM heartbeat_occurrences WHERE occurrence_id=?1",
            params![
                f.occurrence.occurrence_id,
                format!("later-history-{i}"),
                200_000 + i * 15_000,
                100 + i
            ],
        )
        .unwrap();
    }
    prune_history(&tx, &f.occurrence.schedule_id).unwrap();
    let retained: i64 = tx
        .query_row(
            "SELECT count(*) FROM heartbeat_occurrences WHERE occurrence_id=?1",
            [&f.occurrence.occurrence_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(retained, 0, "the exact row must really have been pruned");
    assert_eq!(
        fact.outcome_for(&tx, &f.inbox.session_id, &f.run).unwrap(),
        HeartbeatOutcome::Unchanged
    );
    clear_active_run(
        &tx,
        &f.inbox.session_id,
        &f.run,
        RunTerminalDisposition::Completed,
        Some(&fact),
    )
    .unwrap();
    tx.commit().unwrap();
    assert!(read_completion_page(&f.fixture.path, Some(&cutoff))
        .unwrap()
        .items
        .is_empty());
    assert!(load_run_recovery(&f.fixture.path, &f.inbox.session_id)
        .unwrap()
        .is_none());
    let bindings: i64 = conn
        .query_row(
            "SELECT count(*) FROM session_completion_bindings",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(bindings, 0);
}
