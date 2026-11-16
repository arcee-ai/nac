use super::*;

fn committed(f: &Fixture, active: &HeartbeatOccurrence) {
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE session_inbox SET status='delivered',delivered_run_id=?2,delivered_at=updated_at WHERE id=?1",
            params![active.inbox_item_id.unwrap(), active.run_id],
        )
        .unwrap();
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
        "Observed Local job evidence.",
    )
    .unwrap();
}

#[test]
fn heartbeat_finished_old_version_cannot_finish_edited_schedule_or_withdraw_new_pending() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    committed(&f, &active);
    report(&f, &active, HeartbeatOutcome::Finished);
    let mut replacement = spec();
    replacement.instructions = "Check the next authorized job.".into();
    let edited = f
        .control(
            HeartbeatAction::Edit {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
                spec: replacement.clone(),
            },
            62_000,
        )
        .schedule;
    let next = materialize_heartbeats(&f.path, 121_000).unwrap().remove(0);
    f.settle(&active, HeartbeatOutcome::Unknown, Some(10));
    let current = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(
        (current.state, current.version, current.spec),
        (HeartbeatState::Active, edited.version, replacement)
    );
    let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(history[0].occurrence_id, next.occurrence_id);
    assert_eq!(history[0].state, HeartbeatOccurrenceState::Pending);
    assert_eq!(history[1].outcome, Some(HeartbeatOutcome::Finished));
}

#[test]
fn heartbeat_attention_is_durable_human_metadata_and_wall_clock_cannot_reorder_history() {
    let f = Fixture::new();
    let schedule = f.create();
    for index in 0..36_i64 {
        let now = 61_000 + index * 60_000;
        let pending = materialize_heartbeats(&f.path, now).unwrap().remove(0);
        let active = f.admit(&pending, now);
        committed(&f, &active);
        report(
            &f,
            &active,
            if index == 35 {
                HeartbeatOutcome::Meaningful
            } else {
                HeartbeatOutcome::Unchanged
            },
        );
        let conn = open_runtime_connection(&f.path).unwrap();
        // Settlement timestamps regress while the admission clock advances.
        settle_heartbeat_with_connection(
            &conn,
            "direct",
            active.run_id.as_ref().unwrap(),
            HeartbeatOutcome::Unknown,
            Some(1),
            100,
            2_000 - index,
        )
        .unwrap();
    }
    let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(history.len(), 32);
    assert_eq!(history[0].outcome, Some(HeartbeatOutcome::Meaningful));
    assert!(history
        .windows(2)
        .all(|rows| rows[0].settlement_sequence > rows[1].settlement_sequence));
    assert!(history[0].settled_at_ms < history[1].settled_at_ms);
    let before = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    let sequence = history[0].settlement_sequence.unwrap();
    assert!(acknowledge_heartbeat_attention(&f.path, "direct", sequence + 1).is_err());
    acknowledge_heartbeat_attention(&f.path, "other", 0).unwrap();
    assert!(
        heartbeat_attention_snapshot(&f.path).unwrap().results["direct"]
            .iter()
            .all(|r| !r.seen)
    );
    acknowledge_heartbeat_attention(&f.path, "direct", sequence).unwrap();
    acknowledge_heartbeat_attention(&f.path, "direct", sequence - 1).unwrap();
    assert!(
        heartbeat_attention_snapshot(&f.path).unwrap().results["direct"]
            .iter()
            .all(|r| r.seen)
    );
    let after = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(
        (after.version, after.state, after.starts),
        (before.version, before.state, before.starts)
    );
    assert!(crate::store::load_session_goal(&f.path, "direct")
        .unwrap()
        .is_none());
}

#[test]
fn heartbeat_deadline_and_denial_are_exact_run_fences_and_cannot_be_hidden_by_report() {
    for deadline in [false, true] {
        let f = Fixture::new();
        let schedule = f.create();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let active = f.admit(&pending, 61_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Finished);
        if deadline {
            assert!(heartbeat_deadline_reached(
                &f.path,
                "direct",
                active.run_id.as_ref().unwrap(),
                62_000
            )
            .unwrap());
        } else {
            mark_heartbeat_action_denied(&f.path, "direct", active.run_id.as_ref().unwrap())
                .unwrap();
        }
        let current = heartbeat_for_run(&f.path, "direct", active.run_id.as_ref().unwrap())
            .unwrap()
            .unwrap();
        assert!(heartbeat_report(
            &f.path,
            "direct",
            &active.occurrence_id,
            active.run_id.as_ref().unwrap(),
            active.generation.as_ref().unwrap(),
            current.revision,
            HeartbeatOutcome::Unchanged,
            "Hide denial"
        )
        .is_err());
        f.settle(&active, HeartbeatOutcome::Unknown, Some(4));
        assert_eq!(
            heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap()[0].outcome,
            Some(HeartbeatOutcome::NeedsHumanAction)
        );
        assert!(!heartbeat_deadline_reached(
            &f.path,
            "direct",
            active.run_id.as_ref().unwrap(),
            900_000
        )
        .unwrap());
        assert!(!heartbeat_deadline_reached(
            &f.path,
            "direct",
            &uuid::Uuid::new_v4().to_string(),
            900_000
        )
        .unwrap());
    }
}

#[test]
fn heartbeat_unknown_and_overrun_usage_suspend_before_another_admission() {
    for tokens in [None, Some(150)] {
        let f = Fixture::new();
        let mut limited = spec();
        limited.token_allowance = Some(100);
        let schedule = f
            .control(HeartbeatAction::Create { spec: limited }, 1_000)
            .schedule;
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let active = f.admit(&pending, 61_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        f.settle(&active, HeartbeatOutcome::Unknown, tokens);
        let current = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
        assert_eq!(current.state, HeartbeatState::Suspended);
        assert_eq!(current.usage_unknown, tokens.is_none());
        assert_eq!(current.tokens_used, tokens.unwrap_or(0));
        assert!(materialize_heartbeats(&f.path, 121_000).unwrap().is_empty());
        assert!(control_heartbeat(
            &f.path,
            "direct",
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Resume {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: current.version
            },
            "Review and resume",
            f.binding(),
            121_000
        )
        .is_err());
    }
}

#[test]
fn heartbeat_pre_admission_retries_keep_receipt_identity_and_suspend_at_three() {
    let f = Fixture::new();
    let schedule = f.create();
    let mut pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let identity = (pending.occurrence_id.clone(), pending.receipt_id.clone());
    for attempt in 1..=3 {
        heartbeat_admission_unavailable(
            &f.path,
            "direct",
            &pending.occurrence_id,
            pending.revision,
            false,
            "Provider unavailable",
            61_000 + attempt,
        )
        .unwrap();
        let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
        pending = history[0].clone();
        assert_eq!(
            (&pending.occurrence_id, &pending.receipt_id),
            (&identity.0, &identity.1)
        );
        assert_eq!(pending.attempt_count, attempt);
    }
    assert_eq!(pending.outcome, Some(HeartbeatOutcome::Failed));
    assert_eq!(
        read_heartbeat(&f.path, "direct", &schedule.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Suspended
    );
    assert!(crate::store::list_session_inbox(&f.path, "direct")
        .unwrap()
        .is_empty());
}

#[test]
fn heartbeat_admission_rechecks_selected_workspace_configuration_and_deleted_target() {
    for mutation in [
        "UPDATE sessions SET config_version=config_version+1 WHERE session_id='direct'",
        "DELETE FROM sessions WHERE session_id='direct'",
    ] {
        let f = Fixture::new();
        let schedule = f.create();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        open_runtime_connection(&f.path)
            .unwrap()
            .execute(mutation, [])
            .unwrap();
        let result = admit_heartbeat(
            &f.path,
            "direct",
            &pending.occurrence_id,
            pending.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "input",
            "/different/resolved/path",
            61_000,
        );
        assert!(result.is_err() || result.unwrap().is_none());
        assert!(active_heartbeat_occurrences(&f.path).unwrap().is_empty());
        if mutation.starts_with("DELETE") {
            assert!(read_heartbeat(&f.path, "direct", &schedule.schedule_id).is_err());
        } else {
            assert_eq!(
                read_heartbeat(&f.path, "direct", &schedule.schedule_id)
                    .unwrap()
                    .state,
                HeartbeatState::Suspended
            );
        }
    }
}

#[test]
fn heartbeat_goal_binding_is_exact_and_never_resumes_or_replaces_goal_status() {
    for (bound, status) in [
        (false, "active"),
        (false, "paused"),
        (true, "paused"),
        (true, "blocked"),
        (true, "usage_limited"),
        (true, "budget_limited"),
    ] {
        let f = Fixture::new();
        let goal =
            create_session_goal(&f.path, "direct", "Existing finite work", None, None).unwrap();
        open_runtime_connection(&f.path)
            .unwrap()
            .execute(
                "UPDATE session_goals SET status=?1 WHERE session_id='direct'",
                [status],
            )
            .unwrap();
        let mut specification = spec();
        if bound {
            specification.goal_id = Some(goal.goal_id.clone());
        }
        let schedule = f
            .control(
                HeartbeatAction::Create {
                    spec: specification,
                },
                1_000,
            )
            .schedule;
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        assert!(admit_heartbeat(
            &f.path,
            "direct",
            &pending.occurrence_id,
            pending.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "input",
            "/tmp/project",
            61_000
        )
        .unwrap()
        .is_none());
        let current = load_session_goal(&f.path, "direct").unwrap().unwrap();
        assert_eq!(current.goal_id, goal.goal_id);
        assert_eq!(vocabulary(&current.status).unwrap(), status);
        assert_eq!(
            read_heartbeat(&f.path, "direct", &schedule.schedule_id)
                .unwrap()
                .state,
            HeartbeatState::Suspended
        );
        assert_eq!(
            heartbeat_blocks_goal_continuation(&f.path, "direct", &goal.goal_id).unwrap(),
            bound
        );
    }
    let f = Fixture::new();
    let goal = create_session_goal(&f.path, "direct", "Existing work", None, None).unwrap();
    let mut specification = spec();
    specification.goal_id = Some(goal.goal_id.clone());
    f.control(
        HeartbeatAction::Create {
            spec: specification,
        },
        1_000,
    );
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    let current = load_session_goal(&f.path, "direct").unwrap().unwrap();
    assert_eq!(current.status, GoalStatus::Active);
    assert_eq!(current.accounting_run_id, active.run_id);
    assert_eq!(current.goal_id, goal.goal_id);
}

#[test]
fn heartbeat_two_store_owners_race_one_admission_and_exact_receipt_without_duplicate_input() {
    let f = Fixture::new();
    f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let results = std::thread::scope(|scope| {
        let handles = (0..2)
            .map(|_| {
                let barrier = barrier.clone();
                let path = &f.path;
                let pending = &pending;
                scope.spawn(move || {
                    barrier.wait();
                    admit_heartbeat(
                        path,
                        "direct",
                        &pending.occurrence_id,
                        pending.revision,
                        &uuid::Uuid::new_v4().to_string(),
                        &uuid::Uuid::new_v4().to_string(),
                        "input",
                        "/tmp/project",
                        61_000,
                    )
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Ok(Some(_))))
            .count(),
        1
    );
    assert_eq!(active_heartbeat_occurrences(&f.path).unwrap().len(), 1);
    assert_eq!(list_session_inbox(&f.path, "direct").unwrap().len(), 1);
}

#[test]
fn heartbeat_quiet_attention_preserves_prior_unread_boundary_but_never_hides_later_human_update() {
    let f = Fixture::new();
    f.create();
    let before: String = open_runtime_connection(&f.path)
        .unwrap()
        .query_row(
            "SELECT updated_at FROM sessions WHERE session_id='direct'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    committed(&f, &active);
    report(&f, &active, HeartbeatOutcome::Unchanged);
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:00:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
    f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    assert_eq!(
        heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at["direct"],
        before
    );
    let pending = materialize_heartbeats(&f.path, 121_000).unwrap().remove(0);
    let active = f.admit(&pending, 121_000);
    committed(&f, &active);
    report(&f, &active, HeartbeatOutcome::Unchanged);
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:01:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
    f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    assert_eq!(
        heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at["direct"],
        before
    );
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:02:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
    assert!(!heartbeat_attention_snapshot(&f.path)
        .unwrap()
        .quiet_updated_at
        .contains_key("direct"));
}

#[test]
fn heartbeat_receipt_capacity_preserves_finite_relinquishing_controls() {
    let f = Fixture::new();
    let schedule = f.create();
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute("WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<?1) INSERT INTO heartbeat_commands(session_id,request_id,canonical_digest,schedule_id,response_json,created_at_ms) SELECT 'direct','capacity-'||value,'retained',?2,'{}',1000 FROM n",params![HEARTBEAT_COMMAND_LIMIT-1,schedule.schedule_id]).unwrap();
    assert!(control_heartbeat(
        &f.path,
        "direct",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create { spec: spec() },
        "New scheduling",
        f.binding(),
        62_000
    )
    .is_err());
    let paused = f
        .control(
            HeartbeatAction::Pause {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
            },
            62_000,
        )
        .schedule;
    assert_eq!(paused.state, HeartbeatState::Paused);
    assert!(control_heartbeat(
        &f.path,
        "direct",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Resume {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: paused.version
        },
        "Resume",
        f.binding(),
        63_000
    )
    .is_err());
    let stopped = f
        .control(
            HeartbeatAction::Stop {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: paused.version,
            },
            63_000,
        )
        .schedule;
    assert_eq!(stopped.state, HeartbeatState::Stopped);
    let deleted = f
        .control(
            HeartbeatAction::Delete {
                schedule_id: schedule.schedule_id,
                expected_version: stopped.version,
            },
            64_000,
        )
        .schedule;
    assert_eq!(deleted.state, HeartbeatState::Deleted);
}

#[test]
fn heartbeat_control_revalidates_captured_runtime_binding_at_commit_but_replays_original_receipt() {
    for mutation in [
        "UPDATE sessions SET config_version=config_version+1 WHERE session_id='direct'",
        "UPDATE sessions SET cwd='/changed-workspace' WHERE session_id='direct'",
    ] {
        let f = Fixture::new();
        let request = uuid::Uuid::new_v4().to_string();
        let action = HeartbeatAction::Create { spec: spec() };
        open_runtime_connection(&f.path)
            .unwrap()
            .execute(mutation, [])
            .unwrap();
        assert!(control_heartbeat(
            &f.path,
            "direct",
            &request,
            &action,
            "Captured human scheduling request",
            f.binding(),
            61_000
        )
        .is_err());
        assert!(list_heartbeats(&f.path, None).unwrap().is_empty());
        let mut current = heartbeat_binding(&f.path, "direct").unwrap();
        current.execution_cwd = Some("/reviewed/workspace".into());
        let accepted = control_heartbeat(
            &f.path,
            "direct",
            &request,
            &action,
            "Reviewed current scheduling request",
            &current,
            62_000,
        )
        .unwrap();
        open_runtime_connection(&f.path)
            .unwrap()
            .execute(
                "UPDATE sessions SET config_version=config_version+1 WHERE session_id='direct'",
                [],
            )
            .unwrap();
        assert_eq!(
            control_heartbeat(
                &f.path,
                "direct",
                &request,
                &action,
                "Retry original command",
                &current,
                63_000
            )
            .unwrap(),
            accepted
        );
        assert!(control_heartbeat(
            &f.path,
            "direct",
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Pause {
                schedule_id: accepted.schedule.schedule_id.clone(),
                expected_version: accepted.schedule.version
            },
            "Stale control request",
            &current,
            63_000
        )
        .is_err());
        assert_eq!(
            read_heartbeat(&f.path, "direct", &accepted.schedule.schedule_id)
                .unwrap()
                .state,
            HeartbeatState::Active
        );
    }
}

#[test]
fn heartbeat_restart_after_prompt_commit_retains_delivery_and_never_withdraws_or_replays_it() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    committed(&f, &active);
    reconcile_heartbeat_occurrences(&f.path, "direct", 65_000).unwrap();
    let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(history[0].state, HeartbeatOccurrenceState::Settled);
    assert_eq!(history[0].outcome, Some(HeartbeatOutcome::Interrupted));
    let inbox = list_session_inbox(&f.path, "direct").unwrap();
    assert_eq!(inbox[0].status, InboxStatus::Delivered);
    assert_eq!(inbox[0].delivered_run_id, active.run_id);
    assert!(materialize_heartbeats(&f.path, 1_000_000)
        .unwrap()
        .is_empty());
}

#[test]
fn heartbeat_run_now_obeys_minimum_start_spacing_and_finite_occurrence_allowance() {
    let f = Fixture::new();
    let mut limited = spec();
    limited.max_occurrences = 2;
    let schedule = f
        .control(HeartbeatAction::Create { spec: limited }, 1_000)
        .schedule;
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let first = f.admit(&pending, 61_000);
    committed(&f, &first);
    report(&f, &first, HeartbeatOutcome::Unchanged);
    f.settle(&first, HeartbeatOutcome::Unknown, Some(1));
    let manual = f
        .control(
            HeartbeatAction::RunNow {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: schedule.version,
            },
            65_000,
        )
        .occurrence
        .unwrap();
    let attempt = |now| {
        admit_heartbeat(
            &f.path,
            "direct",
            &manual.occurrence_id,
            manual.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "same pending check",
            "/tmp/project",
            now,
        )
        .unwrap()
    };
    assert!(attempt(65_000).is_none());
    let second = attempt(76_000).unwrap();
    assert_eq!(second.occurrence_id, manual.occurrence_id);
    committed(&f, &second);
    report(&f, &second, HeartbeatOutcome::Unchanged);
    f.settle(&second, HeartbeatOutcome::Unknown, Some(1));
    let current = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(
        (current.starts, current.state),
        (2, HeartbeatState::Suspended)
    );
    assert!(materialize_heartbeats(&f.path, 181_000).unwrap().is_empty());
}

#[test]
fn heartbeat_host_start_rate_defers_the_same_receipt_until_capacity_returns() {
    let f = Fixture::new();
    for _ in 0..61 {
        f.create();
    }
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap();
    assert_eq!(pending.len(), 61);
    for occurrence in &pending[..60] {
        let active = f.admit(occurrence, 61_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    }
    let churned = read_heartbeat(&f.path, "direct", &pending[0].schedule_id).unwrap();
    heartbeat_withdraw_many_unadmitted_requests(&f, churned, 62_000);
    let last = &pending[60];
    let attempt = |now| {
        admit_heartbeat(
            &f.path,
            "direct",
            &last.occurrence_id,
            last.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "same pending check",
            "/tmp/project",
            now,
        )
        .unwrap()
    };
    assert!(attempt(61_000).is_none());
    let later = attempt(121_001).unwrap();
    assert_eq!(
        (later.occurrence_id, later.receipt_id),
        (last.occurrence_id.clone(), last.receipt_id.clone())
    );
}

#[test]
fn heartbeat_quiet_mask_and_inherited_base_cannot_hide_a_same_second_ordinary_result() {
    let f = Fixture::new();
    f.create();
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute(
        "UPDATE sessions SET updated_at='2026-10-30 12:00:00' WHERE session_id='direct'",
        [],
    )
    .unwrap();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    committed(&f, &active);
    report(&f, &active, HeartbeatOutcome::Unchanged);
    conn.execute(
        "UPDATE sessions SET updated_at='2026-10-30 12:01:00' WHERE session_id='direct'",
        [],
    )
    .unwrap();
    f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    assert_eq!(
        heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at["direct"],
        "2026-10-30 12:00:00"
    );
    // A later canonical human run may finish in the same whole second.
    conn.execute("INSERT INTO session_run_outcomes(session_id,run_id,disposition,finished_at) VALUES('direct','later-human','completed','2026-10-30 12:01:00')", []).unwrap();
    assert!(!heartbeat_attention_snapshot(&f.path)
        .unwrap()
        .quiet_updated_at
        .contains_key("direct"));
    let pending = materialize_heartbeats(&f.path, 121_000).unwrap().remove(0);
    let active = f.admit(&pending, 121_000);
    committed(&f, &active);
    report(&f, &active, HeartbeatOutcome::Unchanged);
    conn.execute(
        "UPDATE sessions SET updated_at='2026-10-30 12:02:00' WHERE session_id='direct'",
        [],
    )
    .unwrap();
    f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    assert_eq!(
        heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at["direct"],
        "2026-10-30 12:01:00"
    );
}

#[test]
fn heartbeat_controls_preserve_quiet_metadata_before_and_after_active_settlement() {
    for pause_during_run in [false, true] {
        let f = Fixture::new();
        let schedule = f.create();
        let conn = open_runtime_connection(&f.path).unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:00:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let active = f.admit(&pending, 61_000);
        committed(&f, &active);
        let pause = || {
            f.control(
                HeartbeatAction::Pause {
                    schedule_id: schedule.schedule_id.clone(),
                    expected_version: 1,
                },
                62_000,
            )
        };
        if pause_during_run {
            pause();
        }
        report(&f, &active, HeartbeatOutcome::Unchanged);
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:01:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
        if !pause_during_run {
            pause();
        }
        f.control(
            HeartbeatAction::Resume {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 2,
            },
            65_000,
        );
        assert_eq!(
            heartbeat_attention_snapshot(&f.path)
                .unwrap()
                .quiet_updated_at["direct"],
            "2026-10-30 12:00:00"
        );
        let pending = materialize_heartbeats(&f.path, 121_000).unwrap().remove(0);
        let active = f.admit(&pending, 121_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:02:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
        assert_eq!(
            heartbeat_attention_snapshot(&f.path)
                .unwrap()
                .quiet_updated_at["direct"],
            "2026-10-30 12:00:00"
        );
        conn.execute("INSERT INTO session_run_outcomes(session_id,run_id,disposition,finished_at) VALUES('direct','later-human','completed','2026-10-30 12:02:00')", []).unwrap();
        assert!(!heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at
            .contains_key("direct"));
    }
}

#[test]
fn heartbeat_withdrawing_unexecuted_work_preserves_quiet_result_and_ack() {
    for action in ["pause", "edit", "stop", "delete"] {
        let f = Fixture::new();
        let schedule = f.create();
        let conn = open_runtime_connection(&f.path).unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:00:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let active = f.admit(&pending, 61_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:01:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
        let before = heartbeat_attention_snapshot(&f.path).unwrap();
        let result = before.results["direct"][0].clone();
        let pending = f
            .control(
                HeartbeatAction::RunNow {
                    schedule_id: schedule.schedule_id.clone(),
                    expected_version: 1,
                },
                70_000,
            )
            .occurrence
            .unwrap();
        let operation = match action {
            "pause" => HeartbeatAction::Pause {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
            },
            "edit" => HeartbeatAction::Edit {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
                spec: spec(),
            },
            "stop" => HeartbeatAction::Stop {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
            },
            _ => HeartbeatAction::Delete {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
            },
        };
        f.control(operation, 71_000);
        let after = heartbeat_attention_snapshot(&f.path).unwrap();
        assert_eq!(after.quiet_updated_at, before.quiet_updated_at, "{action}");
        assert_eq!(after.run_revisions, before.run_revisions);
        assert_eq!(after.results["direct"], before.results["direct"]);
        let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
        let withdrawn = history
            .iter()
            .find(|o| o.occurrence_id == pending.occurrence_id)
            .unwrap();
        assert_eq!(
            (withdrawn.state, withdrawn.outcome),
            (HeartbeatOccurrenceState::Withdrawn, None)
        );
        acknowledge_heartbeat_attention(&f.path, "direct", result.sequence).unwrap();
        initialize(&f.path).unwrap();
        let reopened = heartbeat_attention_snapshot(&f.path).unwrap();
        assert_eq!(reopened.quiet_updated_at, before.quiet_updated_at);
        assert!(reopened.results["direct"][0].seen);
        // Same-second ordinary completion must still invalidate the quiet mask.
        conn.execute("INSERT INTO session_run_outcomes(session_id,run_id,disposition,finished_at) VALUES('direct','later-human','completed','2026-10-30 12:01:00')", []).unwrap();
        assert!(!heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at
            .contains_key("direct"));
    }
}

#[test]
fn heartbeat_stop_intent_survives_controls_replay_and_restart_until_exact_settlement() {
    for recover in [false, true] {
        let f = Fixture::new();
        let schedule = f.create();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let active = f.admit(&pending, 61_000);
        committed(&f, &active);
        let requested = |session: &str, occurrence: &str, run: &str, generation: &str| {
            heartbeat_stop_requested(&f.path, session, occurrence, run, generation).unwrap()
        };
        let own = || {
            requested(
                "direct",
                &active.occurrence_id,
                active.run_id.as_ref().unwrap(),
                active.generation.as_ref().unwrap(),
            )
        };
        assert!(!own());
        let key = uuid::Uuid::new_v4().to_string();
        let stop = HeartbeatAction::Stop {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
        };
        let original = control_heartbeat(
            &f.path,
            "direct",
            &key,
            &stop,
            "Stop this heartbeat.",
            f.binding(),
            62_000,
        )
        .unwrap();
        assert!(own());
        if recover {
            // Legacy stopped records have no marker. The scoped fallback works
            // and a later control captures its intent before changing state.
            open_runtime_connection(&f.path).unwrap().execute("UPDATE heartbeat_schedules SET binding_json=json_remove(binding_json,'$._stop_request') WHERE schedule_id=?1",[&schedule.schedule_id]).unwrap();
            assert!(own());
        }
        f.control(
            HeartbeatAction::Edit {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 2,
                spec: spec(),
            },
            63_000,
        );
        f.control(
            HeartbeatAction::Delete {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 3,
            },
            64_000,
        );
        initialize(&f.path).unwrap();
        assert!(own());
        let other = uuid::Uuid::new_v4().to_string();
        assert!(!requested(
            "other",
            &active.occurrence_id,
            active.run_id.as_ref().unwrap(),
            active.generation.as_ref().unwrap()
        ));
        assert!(!requested(
            "direct",
            &other,
            active.run_id.as_ref().unwrap(),
            active.generation.as_ref().unwrap()
        ));
        assert!(!requested(
            "direct",
            &active.occurrence_id,
            &other,
            active.generation.as_ref().unwrap()
        ));
        assert!(!requested(
            "direct",
            &active.occurrence_id,
            active.run_id.as_ref().unwrap(),
            &other
        ));
        assert_eq!(
            control_heartbeat(
                &f.path,
                "direct",
                &key,
                &stop,
                "Stop this heartbeat.",
                f.binding(),
                65_000
            )
            .unwrap(),
            original
        );
        assert!(serde_json::to_value(
            read_heartbeat(&f.path, "direct", &schedule.schedule_id)
                .unwrap()
                .binding
        )
        .unwrap()
        .get("_stop_request")
        .is_none());
        if recover {
            reconcile_heartbeat_occurrences(&f.path, "direct", 66_000).unwrap();
        } else {
            f.settle(&active, HeartbeatOutcome::Interrupted, Some(1));
        }
        assert!(!own());
        let marker:Option<String>=open_runtime_connection(&f.path).unwrap().query_row("SELECT json_extract(binding_json,'$._stop_request') FROM heartbeat_schedules WHERE schedule_id=?1",[&schedule.schedule_id],|r|r.get(0)).unwrap();
        assert!(marker.is_none());
        assert_eq!(
            heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap()[0].outcome,
            Some(HeartbeatOutcome::Interrupted)
        );
        assert_eq!(
            control_heartbeat(
                &f.path,
                "direct",
                &key,
                &stop,
                "Stop this heartbeat.",
                f.binding(),
                67_000
            )
            .unwrap(),
            original
        );
        assert!(
            !own(),
            "old receipt replay cannot recreate cancellation authority"
        );
    }
}

#[test]
fn heartbeat_quiet_mask_never_hides_another_schedules_actionable_result() {
    for denied in [false, true] {
        let f = Fixture::new();
        let quiet = f.create();
        let conn = open_runtime_connection(&f.path).unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:00:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let active = f.admit(&pending, 61_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        conn.execute(
            "UPDATE sessions SET updated_at='2026-10-30 12:01:00' WHERE session_id='direct'",
            [],
        )
        .unwrap();
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
        assert!(heartbeat_attention_snapshot(&f.path)
            .unwrap()
            .quiet_updated_at
            .contains_key("direct"));
        let actionable = f.create();
        let next = f
            .control(
                HeartbeatAction::RunNow {
                    schedule_id: actionable.schedule_id,
                    expected_version: 1,
                },
                80_000,
            )
            .occurrence
            .unwrap();
        if denied {
            heartbeat_admission_unavailable(
                &f.path,
                "direct",
                &next.occurrence_id,
                next.revision,
                true,
                "Human review required",
                80_000,
            )
            .unwrap();
        } else {
            let active = f.admit(&next, 80_000);
            committed(&f, &active);
            report(&f, &active, HeartbeatOutcome::Meaningful);
            f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
        }
        f.control(
            HeartbeatAction::RunNow {
                schedule_id: quiet.schedule_id.clone(),
                expected_version: 1,
            },
            81_000,
        );
        f.control(
            HeartbeatAction::Pause {
                schedule_id: quiet.schedule_id,
                expected_version: 1,
            },
            82_000,
        );
        let snapshot = heartbeat_attention_snapshot(&f.path).unwrap();
        assert!(!snapshot.quiet_updated_at.contains_key("direct"));
        assert_eq!(
            snapshot.results["direct"][0].outcome,
            if denied {
                HeartbeatOutcome::NeedsHumanAction
            } else {
                HeartbeatOutcome::Meaningful
            }
        );
        assert!(!snapshot.results["direct"][0].seen);
        acknowledge_heartbeat_attention(&f.path, "direct", snapshot.results["direct"][0].sequence)
            .unwrap();
        let acknowledged = heartbeat_attention_snapshot(&f.path).unwrap();
        assert!(acknowledged.results["direct"][0].seen);
        assert!(!acknowledged.quiet_updated_at.contains_key("direct"));
    }
}

fn heartbeat_withdraw_many_unadmitted_requests(
    f: &Fixture,
    mut current: HeartbeatSchedule,
    time: i64,
) -> HeartbeatSchedule {
    for index in 0..33 {
        f.control(
            HeartbeatAction::RunNow {
                schedule_id: current.schedule_id.clone(),
                expected_version: current.version,
            },
            time + index * 3,
        )
        .occurrence
        .unwrap();
        current = f
            .control(
                HeartbeatAction::Pause {
                    schedule_id: current.schedule_id.clone(),
                    expected_version: current.version,
                },
                time + index * 3 + 1,
            )
            .schedule;
        current = f
            .control(
                HeartbeatAction::Resume {
                    schedule_id: current.schedule_id.clone(),
                    expected_version: current.version,
                },
                time + index * 3 + 2,
            )
            .schedule;
    }
    current
}

#[test]
fn heartbeat_history_churn_cannot_erase_start_spacing_or_exceed_retention() {
    for churn_time in [62_000, 1_000_000] {
        let f = Fixture::new();
        let schedule = f.create();
        let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
        let first = f.admit(&pending, 61_000);
        committed(&f, &first);
        report(&f, &first, HeartbeatOutcome::Unchanged);
        f.settle(&first, HeartbeatOutcome::Unknown, Some(1));
        // While a chat is busy, Run now can be withdrawn before admission many
        // times. Those legitimate control receipts must not reset rate authority.
        let current = heartbeat_withdraw_many_unadmitted_requests(&f, schedule, churn_time);
        let manual = f
            .control(
                HeartbeatAction::RunNow {
                    schedule_id: current.schedule_id.clone(),
                    expected_version: current.version,
                },
                churn_time + 1_000,
            )
            .occurrence
            .unwrap();
        let attempt = |now| {
            admit_heartbeat(
                &f.path,
                "direct",
                &manual.occurrence_id,
                manual.revision,
                &uuid::Uuid::new_v4().to_string(),
                &uuid::Uuid::new_v4().to_string(),
                "same pending check",
                "/tmp/project",
                now,
            )
            .unwrap()
        };
        // Includes a backward clock jump after pruning outside the minute window.
        assert!(attempt(60_000).is_none());
        assert!(attempt(63_001).is_none());
        let history = heartbeat_history(&f.path, "direct", &current.schedule_id).unwrap();
        assert_eq!(history.len(), HEARTBEAT_HISTORY_LIMIT as usize + 1);
        assert!(history.iter().any(|item| item.run_id == first.run_id));
        let second = attempt(76_000).unwrap();
        assert_eq!(
            (second.occurrence_id, second.receipt_id),
            (manual.occurrence_id, manual.receipt_id)
        );
    }
}

#[test]
fn heartbeat_host_clock_rewind_defers_unused_schedule_after_excess_future_history() {
    let f = Fixture::new();
    let running = f.create();
    let unused = f.create();
    let initial = materialize_heartbeats(&f.path, 61_000).unwrap();
    let first = initial
        .iter()
        .find(|o| o.schedule_id == running.schedule_id)
        .unwrap()
        .clone();
    let waiting = initial
        .iter()
        .find(|o| o.schedule_id == unused.schedule_id)
        .unwrap()
        .clone();
    let mut latest = 61_000;
    for index in 0..40 {
        latest = 61_000 + index * 15_000;
        let pending = if index == 0 {
            first.clone()
        } else {
            f.control(
                HeartbeatAction::RunNow {
                    schedule_id: running.schedule_id.clone(),
                    expected_version: running.version,
                },
                latest,
            )
            .occurrence
            .unwrap()
        };
        let active = f.admit(&pending, latest);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    }
    assert_eq!(
        heartbeat_history(&f.path, "direct", &running.schedule_id)
            .unwrap()
            .len(),
        HEARTBEAT_HISTORY_LIMIT as usize
    );
    assert_eq!(
        heartbeat_history(&f.path, "direct", &running.schedule_id)
            .unwrap()
            .iter()
            .filter_map(|o| o.started_at_ms)
            .max(),
        Some(latest)
    );
    let attempt = |now| {
        admit_heartbeat(
            &f.path,
            "direct",
            &waiting.occurrence_id,
            waiting.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "same pending check",
            "/tmp/project",
            now,
        )
        .unwrap()
    };
    // Rewinding makes all40 old starts eligible for the wall-time predicate,
    // although retention holds32. An unused schedule has no own last start.
    assert!(attempt(61_001).is_none());
    let deferred = heartbeat_history(&f.path, "direct", &unused.schedule_id)
        .unwrap()
        .remove(0);
    assert_eq!(deferred.state, HeartbeatOccurrenceState::Pending);
    assert_eq!(deferred.attempt_count, 0);
    assert_eq!(
        read_heartbeat(&f.path, "direct", &unused.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Active
    );
    assert_eq!(
        (&deferred.occurrence_id, &deferred.receipt_id),
        (&waiting.occurrence_id, &waiting.receipt_id)
    );
    let admitted = attempt(latest).unwrap();
    assert_eq!(
        (admitted.occurrence_id, admitted.receipt_id),
        (waiting.occurrence_id, waiting.receipt_id)
    );
}

#[test]
fn heartbeat_forward_controls_cannot_expire_admissions_needed_after_clock_rewind() {
    let f = Fixture::new();
    let running = f.create();
    let first = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    for now in [61_000, 76_000, 91_000, 106_000] {
        let pending = if now == 61_000 {
            first.clone()
        } else {
            f.control(
                HeartbeatAction::RunNow {
                    schedule_id: running.schedule_id.clone(),
                    expected_version: running.version,
                },
                now,
            )
            .occurrence
            .unwrap()
        };
        let active = f.admit(&pending, now);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    }
    for _ in 0..56 {
        f.create();
    }
    let unused = [f.create(), f.create()];
    let pending = materialize_heartbeats(&f.path, 106_000).unwrap();
    let waiting: Vec<_> = unused
        .iter()
        .map(|schedule| {
            pending
                .iter()
                .find(|occurrence| occurrence.schedule_id == schedule.schedule_id)
                .unwrap()
                .clone()
        })
        .collect();
    for occurrence in pending.iter().filter(|occurrence| {
        !unused
            .iter()
            .any(|s| s.schedule_id == occurrence.schedule_id)
    }) {
        let active = f.admit(occurrence, 106_000);
        committed(&f, &active);
        report(&f, &active, HeartbeatOutcome::Unchanged);
        f.settle(&active, HeartbeatOutcome::Unknown, Some(1));
    }
    let attempt = |occurrence: &HeartbeatOccurrence, now| {
        admit_heartbeat(
            &f.path,
            "direct",
            &occurrence.occurrence_id,
            occurrence.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "same pending check",
            "/tmp/project",
            now,
        )
        .unwrap()
    };
    assert!(attempt(&waiting[0], 106_001).is_none());
    let current = heartbeat_withdraw_many_unadmitted_requests(&f, running, 1_000_000);
    // Four starts on A plus 56 others still fill the minute after rollback.
    // Control timestamps must not expire three of A's four admission facts.
    assert!(attempt(&waiting[0], 106_001).is_none());
    let history = heartbeat_history(&f.path, "direct", &current.schedule_id).unwrap();
    assert_eq!(history.len(), HEARTBEAT_HISTORY_LIMIT as usize);
    assert_eq!(
        history.iter().filter(|o| o.started_at_ms.is_some()).count(),
        4
    );
    for original in &waiting {
        let retained = heartbeat_history(&f.path, "direct", &original.schedule_id)
            .unwrap()
            .remove(0);
        assert_eq!(retained, *original);
        assert_eq!(retained.attempt_count, 0);
    }
    // Reopen the durable store: no new start, identity or rate reset appears.
    initialize(&f.path).unwrap();
    assert!(attempt(&waiting[0], 106_001).is_none());
    let admitted = attempt(&waiting[0], 1_000_000).unwrap();
    assert_eq!(
        (&admitted.occurrence_id, &admitted.receipt_id),
        (&waiting[0].occurrence_id, &waiting[0].receipt_id)
    );
    committed(&f, &admitted);
    report(&f, &admitted, HeartbeatOutcome::Unchanged);
    f.settle(&admitted, HeartbeatOutcome::Unknown, Some(1));
    // A real later admission advances retention. Expired starts may now leave
    // history, while the host's latest admitted start still fences rollback.
    heartbeat_withdraw_many_unadmitted_requests(&f, current, 2_000_000);
    let history = heartbeat_history(&f.path, "direct", &first.schedule_id).unwrap();
    assert_eq!(history.len(), HEARTBEAT_HISTORY_LIMIT as usize);
    assert_eq!(
        history.iter().filter(|o| o.started_at_ms.is_some()).count(),
        1
    );
    assert!(attempt(&waiting[1], 106_001).is_none());
    let next = attempt(&waiting[1], 1_000_000).unwrap();
    assert_eq!(
        (next.occurrence_id, next.receipt_id),
        (
            waiting[1].occurrence_id.clone(),
            waiting[1].receipt_id.clone()
        )
    );
}

#[test]
fn heartbeat_goal_accounting_hint_follows_atomic_admission_and_never_escapes_rollback() {
    let f = Fixture::new();
    let goal = create_session_goal(&f.path, "direct", "Existing exact goal", None, None).unwrap();
    let mut specification = spec();
    specification.goal_id = Some(goal.goal_id.clone());
    f.control(
        HeartbeatAction::Create {
            spec: specification,
        },
        1_000,
    );
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let mut changes = crate::store::goal_changes::subscribe(&f.path);
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_heartbeat_input BEFORE INSERT ON session_inbox BEGIN SELECT RAISE(ABORT,'test admission rollback'); END;").unwrap();
    assert!(admit_heartbeat(
        &f.path,
        "direct",
        &pending.occurrence_id,
        pending.revision,
        &uuid::Uuid::new_v4().to_string(),
        &pending.receipt_id,
        "input",
        "/tmp/project",
        61_000
    )
    .is_err());
    assert!(changes.try_recv().is_err());
    assert!(load_session_goal(&f.path, "direct")
        .unwrap()
        .unwrap()
        .accounting_run_id
        .is_none());
    assert_eq!(
        heartbeat_history(&f.path, "direct", &pending.schedule_id).unwrap(),
        vec![pending.clone()]
    );
    conn.execute_batch("DROP TRIGGER fail_heartbeat_input;")
        .unwrap();
    let admitted = f.admit(&pending, 61_000);
    let crate::store::goal_changes::TaskChange::Goal(hint) = changes.try_recv().unwrap() else {
        panic!("exact goal accounting must retain its existing post-commit hint");
    };
    let committed = load_session_goal(&f.path, "direct").unwrap().unwrap();
    assert_eq!(hint.goal_id, goal.goal_id);
    assert_eq!(hint.version, committed.version);
    assert_eq!(committed.accounting_run_id, admitted.run_id);
    assert_eq!(
        hint.kind,
        crate::store::goal_changes::GoalChangeKind::Current
    );
    assert!(changes.try_recv().is_err());
}
