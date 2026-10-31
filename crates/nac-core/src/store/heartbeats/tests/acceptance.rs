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
