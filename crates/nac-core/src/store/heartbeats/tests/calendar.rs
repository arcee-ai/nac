use super::*;

fn ms(text: &str) -> i64 {
    text.parse::<jiff::Timestamp>().unwrap().as_millisecond()
}
fn calendar(zone: &str, hour: u8, minute: u8, days: HeartbeatCalendarDays) -> HeartbeatSpec {
    let mut spec = spec();
    spec.cadence = HeartbeatCadence::Calendar(HeartbeatCalendarRule {
        zone: zone.into(),
        data_version: "2026f".into(),
        hour,
        minute,
        days,
    });
    spec
}
fn control(f: &Fixture, action: &HeartbeatAction, now: i64, key: &str) -> HeartbeatReceipt {
    control_heartbeat(&f.path,"direct",key,action,"Schedule this existing Local chat at the specified local time, weekdays and IANA zone until the saved end condition; apply the requested control.",f.binding(),now).unwrap()
}
fn fresh_control(f: &Fixture, action: HeartbeatAction, now: i64) -> HeartbeatReceipt {
    control(f, &action, now, &uuid::Uuid::new_v4().to_string())
}

#[test]
fn persisted_calendar_gap_fold_unusual_and_nonseasonal_ranges_survive_reopen_and_clock_rewind() {
    for (zone, hour, minute, first, now, last, count, next) in [
        (
            "America/Los_Angeles",
            2,
            30,
            "2026-03-07T10:30:00Z",
            "2026-03-09T10:00:00Z",
            "2026-03-09T09:30:00Z",
            2,
            "2026-03-10T09:30:00Z",
        ),
        (
            "America/Los_Angeles",
            1,
            30,
            "2026-11-01T08:30:00Z",
            "2026-11-01T09:30:00Z",
            "2026-11-01T08:30:00Z",
            1,
            "2026-11-02T09:30:00Z",
        ),
        (
            "Australia/Lord_Howe",
            1,
            45,
            "2026-04-04T14:45:00Z",
            "2026-04-04T15:15:00Z",
            "2026-04-04T14:45:00Z",
            1,
            "2026-04-05T15:15:00Z",
        ),
        (
            "Australia/Lord_Howe",
            2,
            15,
            "2026-10-02T15:45:00Z",
            "2026-10-04T15:15:00Z",
            "2026-10-04T15:15:00Z",
            2,
            "2026-10-05T15:15:00Z",
        ),
        (
            "Asia/Kolkata",
            9,
            0,
            "2028-02-28T03:30:00Z",
            "2028-03-01T03:30:00Z",
            "2028-03-01T03:30:00Z",
            3,
            "2028-03-02T03:30:00Z",
        ),
        (
            "Pacific/Apia",
            9,
            0,
            "2011-12-29T19:00:00Z",
            "2011-12-31T19:00:00Z",
            "2011-12-31T19:00:00Z",
            3,
            "2012-01-01T19:00:00Z",
        ),
        (
            "America/Havana",
            9,
            0,
            "2026-10-31T13:00:00Z",
            "2026-11-02T13:00:00Z",
            "2026-11-02T13:00:00Z",
            3,
            "2026-11-03T13:00:00Z",
        ),
    ] {
        let f = Fixture::new();
        let spec = calendar(zone, hour, minute, HeartbeatCalendarDays::Daily);
        let schedule = fresh_control(
            &f,
            HeartbeatAction::Create { spec: spec.clone() },
            ms(first) - 1,
        )
        .schedule;
        assert_eq!(schedule.next_due_ms, ms(first), "{zone}");
        initialize(&f.path).unwrap();
        let pending = materialize_heartbeats(&f.path, ms(now)).unwrap().remove(0);
        assert_eq!(
            (
                pending.due_first_ms,
                pending.due_last_ms,
                pending.coalesced_count
            ),
            (ms(first), ms(last), count),
            "{zone}"
        );
        assert_eq!(pending.spec, spec);
        initialize(&f.path).unwrap();
        for clock in [ms(now), ms(first) - 3_600_000] {
            let same = materialize_heartbeats(&f.path, clock).unwrap().remove(0);
            assert_eq!(same.occurrence_id, pending.occurrence_id);
            assert_eq!(same.coalesced_count, count);
        }
        assert_eq!(
            read_heartbeat(&f.path, "direct", &schedule.schedule_id)
                .unwrap()
                .next_due_ms,
            ms(next)
        );
        let conn = open_runtime_connection(&f.path).unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT source FROM heartbeat_occurrences WHERE occurrence_id=?1",
                [pending.occurrence_id],
                |r| r.get(0)
            )
            .unwrap(),
            "calendar"
        );
    }
}

#[test]
fn calendar_two_owners_coalesce_once_and_admitted_fold_restart_never_replays_effects() {
    let f = Fixture::new();
    let first = ms("2026-11-01T08:30:00Z");
    let schedule = fresh_control(
        &f,
        HeartbeatAction::Create {
            spec: calendar("America/Los_Angeles", 1, 30, HeartbeatCalendarDays::Daily),
        },
        first - 1,
    )
    .schedule;
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let results = std::thread::scope(|scope| {
        let handles = (0..2)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let path = f.path.clone();
                scope.spawn(move || {
                    barrier.wait();
                    materialize_heartbeats(&path, first).unwrap().remove(0)
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(results[0].occurrence_id, results[1].occurrence_id);
    let active = f.admit(&results[0], first);
    initialize(&f.path).unwrap();
    assert!(materialize_heartbeats(&f.path, ms("2026-11-01T09:30:00Z"))
        .unwrap()
        .is_empty());
    reconcile_heartbeat_occurrences(&f.path, "direct", ms("2026-11-01T09:30:00Z")).unwrap();
    let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].run_id, active.run_id);
    assert_eq!(history[0].outcome, Some(HeartbeatOutcome::Interrupted));
    assert!(materialize_heartbeats(&f.path, ms("2026-11-03T12:00:00Z"))
        .unwrap()
        .is_empty());
}

#[test]
fn calendar_pause_resume_skips_paused_fold_and_retains_a_future_cursor_on_clock_rollback() {
    let f = Fixture::new();
    let before = ms("2026-10-31T07:00:00Z");
    let schedule = fresh_control(
        &f,
        HeartbeatAction::Create {
            spec: calendar("America/Los_Angeles", 1, 30, HeartbeatCalendarDays::Daily),
        },
        before,
    )
    .schedule;
    materialize_heartbeats(&f.path, ms("2026-10-31T08:30:00Z")).unwrap();
    let paused = fresh_control(
        &f,
        HeartbeatAction::Pause {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
        },
        ms("2026-10-31T08:31:00Z"),
    )
    .schedule;
    assert!(materialize_heartbeats(&f.path, ms("2026-11-03T18:00:00Z"))
        .unwrap()
        .is_empty());
    let resumed = fresh_control(
        &f,
        HeartbeatAction::Resume {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: paused.version,
        },
        ms("2026-11-03T18:00:00Z"),
    )
    .schedule;
    assert_eq!(resumed.next_due_ms, ms("2026-11-04T09:30:00Z"));
    let paused = fresh_control(
        &f,
        HeartbeatAction::Pause {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: resumed.version,
        },
        before,
    )
    .schedule;
    let resumed = fresh_control(
        &f,
        HeartbeatAction::Resume {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: paused.version,
        },
        before,
    )
    .schedule;
    assert_eq!(resumed.next_due_ms, ms("2026-11-04T09:30:00Z"));
    let next = materialize_heartbeats(&f.path, resumed.next_due_ms)
        .unwrap()
        .remove(0);
    assert_eq!(next.coalesced_count, 1);
    assert_eq!(next.schedule_version, resumed.version);
}

#[test]
fn calendar_due_boundary_edits_withdraw_unstarted_and_keep_admitted_old_rule_and_replay() {
    for admitted in [false, true] {
        let f = Fixture::new();
        let now = ms("2026-11-02T12:00:00Z");
        let old = calendar(
            "America/Los_Angeles",
            9,
            0,
            HeartbeatCalendarDays::Weekdays {
                days: vec![1, 2, 3, 4, 5],
            },
        );
        let schedule =
            fresh_control(&f, HeartbeatAction::Create { spec: old.clone() }, now).schedule;
        let pending = materialize_heartbeats(&f.path, schedule.next_due_ms)
            .unwrap()
            .remove(0);
        let active = admitted.then(|| f.admit(&pending, schedule.next_due_ms));
        let key = uuid::Uuid::new_v4().to_string();
        let edit = HeartbeatAction::Edit {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
            spec: calendar(
                "America/New_York",
                18,
                0,
                HeartbeatCalendarDays::Weekly { day: 1 },
            ),
        };
        let receipt = control(&f, &edit, schedule.next_due_ms, &key);
        assert_eq!(receipt.schedule.next_due_ms, ms("2026-11-02T23:00:00Z"));
        let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
        assert_eq!(history[0].spec, old);
        assert_eq!(history[0].schedule_version, 1);
        assert_eq!(
            history[0].state,
            if admitted {
                HeartbeatOccurrenceState::Admitted
            } else {
                HeartbeatOccurrenceState::Withdrawn
            }
        );
        if let Some(active) = active {
            assert_eq!(receipt.active_occurrence.unwrap().run_id, active.run_id);
        } else {
            assert!(admit_heartbeat(
                &f.path,
                "direct",
                &pending.occurrence_id,
                pending.revision,
                &uuid::Uuid::new_v4().to_string(),
                &uuid::Uuid::new_v4().to_string(),
                "old input",
                "/tmp/project",
                schedule.next_due_ms
            )
            .is_err());
        }
        fresh_control(
            &f,
            HeartbeatAction::Pause {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 2,
            },
            schedule.next_due_ms + 1,
        );
        let replay = control(&f, &edit, schedule.next_due_ms + 2, &key);
        assert_eq!(replay.schedule, receipt.schedule);
        assert_eq!(
            read_heartbeat(&f.path, "direct", &schedule.schedule_id)
                .unwrap()
                .state,
            HeartbeatState::Paused
        );
        assert!(control_heartbeat(
            &f.path,
            "direct",
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Resume {
                schedule_id: schedule.schedule_id,
                expected_version: 2
            },
            "Resume after human review",
            f.binding(),
            now
        )
        .is_err());
    }
}

#[test]
fn calendar_long_downtime_and_history_remain_bounded_in_real_store() {
    let f = Fixture::new();
    let first = ms("2000-01-01T09:00:00Z");
    let mut schedule = fresh_control(
        &f,
        HeartbeatAction::Create {
            spec: calendar("Etc/UTC", 9, 0, HeartbeatCalendarDays::Daily),
        },
        first - 1,
    )
    .schedule;
    let now = ms("6000-01-01T09:00:00Z");
    let pending = materialize_heartbeats(&f.path, now).unwrap().remove(0);
    assert_eq!(pending.coalesced_count, 10 * 146_097 + 1);
    assert_eq!(
        heartbeat_history(&f.path, "direct", &schedule.schedule_id)
            .unwrap()
            .len(),
        1
    );
    for day in 0..45 {
        let at = now + day * 86_400_000;
        materialize_heartbeats(&f.path, at).unwrap();
        schedule = fresh_control(
            &f,
            HeartbeatAction::Pause {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: schedule.version,
            },
            at,
        )
        .schedule;
        schedule = fresh_control(
            &f,
            HeartbeatAction::Resume {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: schedule.version,
            },
            at,
        )
        .schedule;
    }
    assert!(
        heartbeat_history(&f.path, "direct", &schedule.schedule_id)
            .unwrap()
            .len()
            <= HEARTBEAT_HISTORY_LIMIT as usize
    );
    let conn = open_runtime_connection(&f.path).unwrap();
    assert!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM heartbeat_occurrences", [], |r| r
            .get(0))
            .unwrap()
            <= HEARTBEAT_HISTORY_LIMIT
    );
}
