use super::*;
use std::sync::Arc;

struct Fixture {
    root: PathBuf,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-heartbeat-{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        initialize(&path).unwrap();
        for id in ["direct", "other"] {
            insert_test_session(&path, id);
            open_runtime_connection(&path)
                .unwrap()
                .execute(
                    "UPDATE sessions SET behavior='direct',backend='arcee-api' WHERE session_id=?1",
                    [id],
                )
                .unwrap();
        }
        Self { root, path }
    }
    fn control(&self, action: HeartbeatAction, time: i64) -> HeartbeatReceipt {
        control_heartbeat(
            &self.path,
            "direct",
            &uuid::Uuid::new_v4().to_string(),
            &action,
            "Check the job every minute until ready.",
            "/tmp/project",
            time,
        )
        .unwrap()
    }
    fn create(&self) -> HeartbeatSchedule {
        self.control(HeartbeatAction::Create { spec: spec() }, 1_000)
            .schedule
    }
    fn admit(&self, occurrence: &HeartbeatOccurrence, time: i64) -> HeartbeatOccurrence {
        admit_heartbeat(
            &self.path,
            "direct",
            &occurrence.occurrence_id,
            occurrence.revision,
            &uuid::Uuid::new_v4().to_string(),
            &uuid::Uuid::new_v4().to_string(),
            "authorized heartbeat input",
            "/tmp/project",
            time,
        )
        .unwrap()
        .unwrap()
    }
    fn settle(&self, active: &HeartbeatOccurrence, outcome: HeartbeatOutcome, tokens: Option<i64>) {
        let conn = open_runtime_connection(&self.path).unwrap();
        settle_heartbeat_with_connection(
            &conn,
            "direct",
            active.run_id.as_ref().unwrap(),
            outcome,
            tokens,
            1_000,
            65_000,
        )
        .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn spec() -> HeartbeatSpec {
    HeartbeatSpec {
        name: "Job check".into(),
        instructions: "Check the authorized Local job result.".into(),
        skills: vec!["verification".into()],
        interval_ms: 60_000,
        end_condition: "Finish when the result is ready.".into(),
        goal_id: None,
        execution_timeout_ms: 300_000,
        max_occurrences: 1000,
        token_allowance: None,
    }
}

#[test]
fn heartbeat_controls_replay_original_response_and_conflict_after_deletion() {
    let f = Fixture::new();
    let key = uuid::Uuid::new_v4().to_string();
    let action = HeartbeatAction::Create { spec: spec() };
    let first = control_heartbeat(
        &f.path,
        "direct",
        &key,
        &action,
        "Check the job every minute until ready.",
        "/tmp/project",
        1_000,
    )
    .unwrap();
    assert_eq!(first.schedule.next_due_ms, 61_000);
    assert_eq!(
        control_heartbeat(
            &f.path,
            "direct",
            &key,
            &action,
            "Check the job every minute until ready.",
            "/tmp/project",
            50_000
        )
        .unwrap(),
        first
    );
    let deleted = f.control(
        HeartbeatAction::Delete {
            schedule_id: first.schedule.schedule_id.clone(),
            expected_version: 1,
        },
        2_000,
    );
    assert_eq!(deleted.schedule.state, HeartbeatState::Deleted);
    assert_eq!(
        control_heartbeat(
            &f.path,
            "direct",
            &key,
            &action,
            "Check the job every minute until ready.",
            "/tmp/project",
            90_000
        )
        .unwrap(),
        first
    );
    let mut changed = spec();
    changed.instructions = "Different work".into();
    assert!(control_heartbeat(
        &f.path,
        "direct",
        &key,
        &HeartbeatAction::Create { spec: changed },
        "Check the job every minute until ready.",
        "/tmp/project",
        90_000
    )
    .is_err());
    assert!(list_heartbeats(&f.path, None).unwrap().is_empty());
    assert!(read_heartbeat(&f.path, "other", &first.schedule.schedule_id).is_err());
    assert_eq!(
        crate::store::list_session_inbox(&f.path, "direct")
            .unwrap()
            .len(),
        0
    );
    assert!(crate::store::load_session_goal(&f.path, "direct")
        .unwrap()
        .is_none());
}

#[test]
fn heartbeat_two_owners_materialize_once_and_coalesce_downtime_without_clock_replay() {
    let f = Fixture::new();
    let schedule = f.create();
    assert!(materialize_heartbeats(&f.path, 60_999).unwrap().is_empty());
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let results = std::thread::scope(|scope| {
        let handles = (0..2)
            .map(|_| {
                let barrier = barrier.clone();
                let path = f.path.clone();
                scope.spawn(move || {
                    barrier.wait();
                    materialize_heartbeats(&path, 241_000).unwrap()
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(results[0][0].occurrence_id, results[1][0].occurrence_id);
    assert_eq!(results[0][0].coalesced_count, 4);
    assert_eq!(
        (results[0][0].due_first_ms, results[0][0].due_last_ms),
        (61_000, 241_000)
    );
    let backwards = materialize_heartbeats(&f.path, 1_000).unwrap();
    assert_eq!(backwards[0].coalesced_count, 4);
    let later = materialize_heartbeats(&f.path, 421_000).unwrap();
    assert_eq!(later[0].coalesced_count, 7);
    assert_eq!(
        heartbeat_history(&f.path, "direct", &schedule.schedule_id)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        read_heartbeat(&f.path, "direct", &schedule.schedule_id)
            .unwrap()
            .next_due_ms,
        481_000
    );
}

#[test]
fn heartbeat_pause_edit_resume_withdraw_unstarted_and_never_replay_paused_time() {
    let f = Fixture::new();
    let initial = f.create();
    let id = &initial.schedule_id;
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let paused = f
        .control(
            HeartbeatAction::Pause {
                schedule_id: id.clone(),
                expected_version: 1,
            },
            62_000,
        )
        .schedule;
    assert_eq!(
        heartbeat_history(&f.path, "direct", id).unwrap()[0].state,
        HeartbeatOccurrenceState::Withdrawn
    );
    assert!(materialize_heartbeats(&f.path, 600_000).unwrap().is_empty());
    assert!(control_heartbeat(
        &f.path,
        "direct",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::RunNow {
            schedule_id: id.clone(),
            expected_version: paused.version
        },
        "Check the job every minute until ready.",
        "/tmp/project",
        600_000
    )
    .is_err());
    let resumed = f
        .control(
            HeartbeatAction::Resume {
                schedule_id: id.clone(),
                expected_version: paused.version,
            },
            600_000,
        )
        .schedule;
    assert_eq!(resumed.anchor_ms, 1_000);
    assert_eq!(resumed.next_due_ms, 601_000);
    let now = f.control(
        HeartbeatAction::RunNow {
            schedule_id: id.clone(),
            expected_version: resumed.version,
        },
        600_001,
    );
    assert_eq!(now.schedule.next_due_ms, 601_000);
    assert_ne!(now.occurrence.unwrap().occurrence_id, pending.occurrence_id);
    let mut replacement = spec();
    replacement.interval_ms = 120_000;
    let edited = f
        .control(
            HeartbeatAction::Edit {
                schedule_id: id.clone(),
                expected_version: resumed.version,
                spec: replacement,
            },
            600_002,
        )
        .schedule;
    assert_eq!((edited.anchor_ms, edited.next_due_ms), (600_002, 720_002));
    assert!(materialize_heartbeats(&f.path, 720_001).unwrap().is_empty());
    assert_eq!(
        materialize_heartbeats(&f.path, 720_002).unwrap()[0].schedule_version,
        edited.version
    );
}

#[test]
fn heartbeat_validation_rejects_overflow_and_nonlocal_or_child_targets() {
    let f = Fixture::new();
    for interval in [0, 59_999, i64::MAX] {
        let mut invalid = spec();
        invalid.interval_ms = interval;
        assert!(control_heartbeat(
            &f.path,
            "direct",
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Create { spec: invalid },
            "Check the job every minute until ready.",
            "/tmp/project",
            1_000
        )
        .is_err());
    }
    assert!(control_heartbeat(
        &f.path,
        "direct",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create { spec: spec() },
        "Check the job every minute until ready.",
        "/tmp/project",
        i64::MAX
    )
    .is_err());
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute(
        "UPDATE sessions SET host_id='remote.example' WHERE session_id='direct'",
        [],
    )
    .unwrap();
    assert!(control_heartbeat(
        &f.path,
        "direct",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create { spec: spec() },
        "Check the job every minute until ready.",
        "/tmp/project",
        1_000
    )
    .is_err());
    assert!(list_heartbeats(&f.path, None).unwrap().is_empty());
}

#[test]
fn heartbeat_admission_has_one_input_and_receipt_controls_do_not_rewrite_admitted_work() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let admitted = f.admit(&pending, 61_000);
    assert!(admit_heartbeat(
        &f.path,
        "direct",
        &pending.occurrence_id,
        pending.revision,
        &uuid::Uuid::new_v4().to_string(),
        &uuid::Uuid::new_v4().to_string(),
        "duplicate",
        "/tmp/project",
        61_000
    )
    .is_err());
    let paused = f.control(
        HeartbeatAction::Pause {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: schedule.version,
        },
        62_000,
    );
    assert_eq!(paused.active_occurrence, Some(admitted.clone()));
    assert_eq!(admitted.spec, spec());
    assert_eq!(
        crate::store::list_session_inbox(&f.path, "direct")
            .unwrap()
            .len(),
        1
    );
    heartbeat_prompt_committed(
        &open_runtime_connection(&f.path).unwrap(),
        "direct",
        admitted.inbox_item_id.unwrap(),
        admitted.run_id.as_ref().unwrap(),
    )
    .unwrap();
    assert!(heartbeat_prompt_committed(
        &open_runtime_connection(&f.path).unwrap(),
        "direct",
        admitted.inbox_item_id.unwrap(),
        "successor human run"
    )
    .is_err());
    f.settle(&admitted, HeartbeatOutcome::Unknown, Some(50));
    let settled = heartbeat_history(&f.path, "direct", &schedule.schedule_id)
        .unwrap()
        .remove(0);
    assert_eq!(settled.outcome, Some(HeartbeatOutcome::Unknown));
    assert_eq!(
        read_heartbeat(&f.path, "direct", &schedule.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Paused
    );
}

#[test]
fn heartbeat_final_failure_overrides_finished_and_usage_settles_once() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    let report = heartbeat_report(
        &f.path,
        "direct",
        &active.occurrence_id,
        active.run_id.as_ref().unwrap(),
        active.generation.as_ref().unwrap(),
        active.revision,
        HeartbeatOutcome::Finished,
        "The job result is ready.",
    )
    .unwrap();
    assert_eq!(report.provisional_outcome, Some(HeartbeatOutcome::Finished));
    assert_eq!(
        heartbeat_report(
            &f.path,
            "direct",
            &active.occurrence_id,
            active.run_id.as_ref().unwrap(),
            active.generation.as_ref().unwrap(),
            active.revision,
            HeartbeatOutcome::Finished,
            "The job result is ready."
        )
        .unwrap(),
        report
    );
    assert!(heartbeat_report(
        &f.path,
        "direct",
        &active.occurrence_id,
        "later run",
        active.generation.as_ref().unwrap(),
        report.revision,
        HeartbeatOutcome::Unchanged,
        "ignore failure"
    )
    .is_err());
    f.settle(&active, HeartbeatOutcome::Failed, Some(100));
    f.settle(&active, HeartbeatOutcome::Unknown, Some(999));
    let schedule = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(
        (schedule.state, schedule.tokens_used),
        (HeartbeatState::Suspended, 100)
    );
    assert_eq!(
        heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap()[0].outcome,
        Some(HeartbeatOutcome::Failed)
    );
}

#[test]
fn heartbeat_queued_human_input_wins_and_control_before_admission_invalidates_pending() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let human = crate::store::create_person_session_inbox_item(
        &f.path,
        "direct",
        InboxDelivery::Queue,
        "Human guidance wins",
        None,
        None,
        "Human guidance wins",
    )
    .unwrap();
    assert!(admit_heartbeat(
        &f.path,
        "direct",
        &pending.occurrence_id,
        pending.revision,
        &uuid::Uuid::new_v4().to_string(),
        &uuid::Uuid::new_v4().to_string(),
        "heartbeat",
        "/tmp/project",
        61_000
    )
    .unwrap()
    .is_none());
    assert_eq!(
        crate::store::list_session_inbox(&f.path, "direct").unwrap()[0].id,
        human.id
    );
    f.control(
        HeartbeatAction::Delete {
            schedule_id: schedule.schedule_id,
            expected_version: 1,
        },
        62_000,
    );
    assert!(admit_heartbeat(
        &f.path,
        "direct",
        &pending.occurrence_id,
        pending.revision,
        &uuid::Uuid::new_v4().to_string(),
        &uuid::Uuid::new_v4().to_string(),
        "heartbeat",
        "/tmp/project",
        62_000
    )
    .is_err());
}

#[test]
fn heartbeat_pre_prompt_restart_is_uncertain_and_cannot_replay_effects() {
    let f = Fixture::new();
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    reconcile_heartbeat_occurrences(&f.path, "direct", 65_000).unwrap();
    reconcile_heartbeat_occurrences(&f.path, "direct", 66_000).unwrap();
    let history = heartbeat_history(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(history[0].run_id, active.run_id);
    assert_eq!(history[0].outcome, Some(HeartbeatOutcome::Interrupted));
    let schedule = read_heartbeat(&f.path, "direct", &schedule.schedule_id).unwrap();
    assert_eq!(schedule.state, HeartbeatState::Suspended);
    assert!(schedule.usage_unknown);
    assert!(materialize_heartbeats(&f.path, 1_000_000)
        .unwrap()
        .is_empty());
    assert!(
        crate::store::next_pending_session_inbox_item(&f.path, "direct")
            .unwrap()
            .is_none()
    );
}

mod acceptance;
