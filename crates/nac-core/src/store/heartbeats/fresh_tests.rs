//! Isolated store characterization on the migrated supplier foundation.
use super::*;

mod model_defaults;

pub(super) struct Fixture {
    pub(super) root: PathBuf,
    pub(super) path: PathBuf,
    pub(super) binding: HeartbeatBinding,
}
impl Fixture {
    pub(super) fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-fresh-admission-{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        initialize(&path).unwrap();
        insert_project(
            &path,
            NewProject {
                project_id: "project".into(),
                name: Some("Fixture project".into()),
                description: None,
                cwd: root.clone(),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
            },
        )
        .unwrap();
        insert_test_session(&path, "creator");
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior='direct' WHERE session_id='creator'",
                [],
            )
            .unwrap();
        let binding = fresh_heartbeat_binding(
            &path,
            &FreshTaskDestination {
                project_id: "project".into(),
                model_selection: Some(crate::store::TaskModelSelection {
                    backend: "openai-responses".into(),
                    model: "fixture-model".into(),
                    base_url: "https://fixture.invalid/v1".into(),
                    allow_insecure_http: false,
                    api_key_env: None,
                    reasoning_effort: None,
                    extra_headers: None,
                    compaction_threshold: None,
                }),
                pinned_commit: None,
                default_ref: Some("refs/heads/dev".into()),
                model: None,
                reasoning_effort: None,
                retained_limit: 2,
            },
            Some("creator"),
            root.to_str().unwrap(),
        )
        .unwrap();
        Self {
            root,
            path,
            binding,
        }
    }
    fn control(&self, action: HeartbeatAction, time: i64) -> HeartbeatReceipt {
        control_heartbeat(
            &self.path,
            "project:project",
            &uuid::Uuid::new_v4().to_string(),
            &action,
            "Create a fresh task every minute for the Local fixture.",
            &self.binding,
            time,
        )
        .unwrap()
    }
    pub(super) fn create(&self) -> HeartbeatSchedule {
        self.control(
            HeartbeatAction::Create {
                spec: super::tests::spec(),
            },
            1_000,
        )
        .schedule
    }
    fn pending(&self) -> HeartbeatOccurrence {
        materialize_heartbeats(&self.path, 61_000)
            .unwrap()
            .remove(0)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub(super) fn prepared_shared_snapshot(
    f: &Fixture,
    reserved: &PreparedFreshTaskLaunch,
) -> crate::sessions::SessionSnapshot {
    let mut snapshot = crate::sessions::new_snapshot(
        reserved.receipt().session_id.clone(),
        f.root.clone(),
        "fixture-model".into(),
        "https://fixture.invalid/v1".into(),
        crate::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        std::collections::BTreeMap::new(),
    );
    snapshot.behavior = crate::sessions::SessionBehavior::Direct;
    snapshot.project_id = Some("project".into());
    snapshot
}

#[test]
fn scheduled_model_selection_is_frozen_in_the_durable_launch_receipt() {
    let mut f = Fixture::new();
    let selection = crate::store::TaskModelSelection {
        backend: "openai-responses".into(),
        model: "fixture-model".into(),
        base_url: "https://fixture.invalid/v1".into(),
        allow_insecure_http: false,
        api_key_env: Some("FIXTURE_API_KEY".into()),
        reasoning_effort: Some("high".into()),
        extra_headers: None,
        compaction_threshold: None,
    };
    f.binding.fresh_task.as_mut().unwrap().model_selection = Some(selection.clone());
    f.create();
    let pending = f.pending();
    let first =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    assert_eq!(
        first.receipt().request.model_selection,
        Some(selection.clone())
    );
    let reloaded = read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
        .unwrap()
        .unwrap();
    assert_eq!(reloaded.receipt().request.model_selection, Some(selection));
}

#[test]
fn legacy_receipt_defaults_remain_in_storage_but_never_replace_the_selection() {
    let f = Fixture::new();
    f.create();
    let pending = f.pending();
    let original =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute(
        "UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,'$.model_defaults',json('{\"model\":\"retired-preset\"}')) WHERE occurrence_id=?1",
        [&pending.occurrence_id],
    ).unwrap();
    drop(conn);
    let replay = read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        replay.receipt().request.model_selection,
        original.receipt().request.model_selection
    );
    let conn = open_runtime_connection(&f.path).unwrap();
    let retained: String = conn.query_row(
        "SELECT json_extract(launch_json,'$.model_defaults.model') FROM heartbeat_task_launches WHERE occurrence_id=?1",
        [&pending.occurrence_id], |row| row.get(0),
    ).unwrap();
    assert_eq!(retained, "retired-preset");
}

#[test]
fn initial_publication_run_and_outcome_survive_later_human_run_task_and_history_deletion() {
    let mut f = Fixture::new();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    let schedule = f.create();
    let pending = f.pending();
    let reserved =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    pin_fresh_heartbeat_workspace_mode(&f.path, &pending.occurrence_id, true).unwrap();
    let snapshot = prepared_shared_snapshot(&f, &reserved);
    {
        let mut conn = open_runtime_connection(&f.path).unwrap();
        let tx = conn.transaction().unwrap();
        crate::sessions::insert_new_session_in_transaction(&tx, &f.path, &snapshot).unwrap();
        publish_shared_fresh_launch_with_connection(
            &tx,
            &reserved.receipt().request.request_id,
            &snapshot,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let first = fresh_heartbeat_inventory(&f.path, "project", None)
        .unwrap()
        .remove(0);
    assert!(first.first_input_id.is_some());
    assert_eq!(
        list_session_inbox(&f.path, &snapshot.session_id)
            .unwrap()
            .len(),
        1
    );
    assert!(
        next_pending_session_inbox_item(&f.path, &snapshot.session_id)
            .unwrap()
            .is_none(),
        "ordinary inbox cannot adopt scheduled initial input"
    );
    let published = heartbeat_history(&f.path, "project:project", &schedule.schedule_id)
        .unwrap()
        .remove(0);
    let run = uuid::Uuid::new_v4().to_string();
    let active = admit_heartbeat(
        &f.path,
        &snapshot.session_id,
        &pending.occurrence_id,
        published.revision,
        &run,
        &pending.receipt_id,
        "expanded initial prompt",
        f.root.to_str().unwrap(),
        62_000,
    )
    .unwrap()
    .unwrap();
    assert_eq!(active.inbox_item_id, first.first_input_id);
    assert_eq!(
        list_heartbeats(&f.path, None).unwrap()[0].starts,
        1,
        "run admission does not count the same launch twice"
    );
    assert!(
        fresh_heartbeat_for_inbox(&f.path, &snapshot.session_id, first.first_input_id.unwrap())
            .is_err(),
        "lost acknowledgement cannot repeat the admitted initial input"
    );
    heartbeat_report(
        &f.path,
        &snapshot.session_id,
        &pending.occurrence_id,
        &run,
        &pending.receipt_id,
        active.revision,
        HeartbeatOutcome::Unchanged,
        "No fixture changes.",
    )
    .unwrap();
    // Settlement is bound to the admitted runtime/run, while schedule reads
    // remain scoped to the creator chat or owning project.
    let mut chat_binding = heartbeat_binding(&f.path, "creator").unwrap();
    chat_binding.execution_cwd = Some(f.root.to_string_lossy().into_owned());
    let chat = control_heartbeat(
        &f.path,
        "creator",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create {
            spec: super::tests::spec(),
        },
        "Check this chat's job every minute.",
        &chat_binding,
        62_001,
    )
    .unwrap()
    .schedule;
    let unrelated_root = f.root.join("unrelated-project");
    std::fs::create_dir_all(&unrelated_root).unwrap();
    insert_project(
        &f.path,
        NewProject {
            project_id: "unrelated-project".into(),
            name: None,
            description: None,
            cwd: unrelated_root.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        },
    )
    .unwrap();
    let mut destination = f.binding.fresh_task.clone().unwrap();
    destination.project_id = "unrelated-project".into();
    let other_binding = fresh_heartbeat_binding(
        &f.path,
        &destination,
        Some("creator"),
        unrelated_root.to_str().unwrap(),
    )
    .unwrap();
    let unrelated = control_heartbeat(
        &f.path,
        "project:unrelated-project",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create {
            spec: super::tests::spec(),
        },
        "Check the unrelated project's job every minute.",
        &other_binding,
        62_001,
    )
    .unwrap()
    .schedule;
    assert!(read_heartbeat(&f.path, &snapshot.session_id, &schedule.schedule_id).is_err());
    assert!(read_heartbeat(&f.path, "project:unrelated-project", &schedule.schedule_id).is_err());
    let schedules_before = list_heartbeats(&f.path, None).unwrap();
    let history_before =
        heartbeat_history(&f.path, "project:project", &schedule.schedule_id).unwrap();
    let receipt_before = fresh_heartbeat_inventory(&f.path, "project", None).unwrap();
    for (session, candidate_run) in [
        ("creator", run.as_str()),
        (snapshot.session_id.as_str(), "not-the-admitted-run"),
        ("creator", "no-active-occurrence"),
    ] {
        let mut conn = open_runtime_connection(&f.path).unwrap();
        let tx = conn.transaction().unwrap();
        settle_heartbeat_with_connection(
            &tx,
            session,
            candidate_run,
            HeartbeatOutcome::Failed,
            Some(999),
            999,
            62_002,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(list_heartbeats(&f.path, None).unwrap(), schedules_before);
        assert_eq!(
            heartbeat_history(&f.path, "project:project", &schedule.schedule_id).unwrap(),
            history_before
        );
        assert_eq!(
            fresh_heartbeat_inventory(&f.path, "project", None).unwrap(),
            receipt_before
        );
    }
    {
        let mut conn = open_runtime_connection(&f.path).unwrap();
        let tx = conn.transaction().unwrap();
        settle_heartbeat_with_connection(
            &tx,
            &snapshot.session_id,
            &run,
            HeartbeatOutcome::Unknown,
            Some(3),
            1_000,
            63_000,
        )
        .unwrap();
        tx.commit().unwrap();
        settle_heartbeat_with_connection(
            &conn,
            &snapshot.session_id,
            &uuid::Uuid::new_v4().to_string(),
            HeartbeatOutcome::Failed,
            Some(50),
            1_000,
            64_000,
        )
        .unwrap();
    }
    assert_eq!(
        read_heartbeat(&f.path, "creator", &chat.schedule_id).unwrap(),
        chat
    );
    assert_eq!(
        read_heartbeat(&f.path, "project:unrelated-project", &unrelated.schedule_id).unwrap(),
        unrelated
    );
    let initial = fresh_heartbeat_inventory(&f.path, "project", None)
        .unwrap()
        .remove(0);
    assert_eq!(initial.initial_run_id.as_deref(), Some(run.as_str()));
    assert_eq!(
        initial.initial_outcome.as_ref().unwrap().outcome,
        Some(HeartbeatOutcome::Unchanged)
    );
    assert!(crate::sessions::delete_session(&f.path, &snapshot.session_id).unwrap());
    open_runtime_connection(&f.path)
        .unwrap()
        .execute("DELETE FROM heartbeat_occurrences", [])
        .unwrap();
    initialize(&f.path).unwrap();
    let retained = fresh_heartbeat_inventory(&f.path, "project", None)
        .unwrap()
        .remove(0);
    assert_eq!(retained.initial_outcome, initial.initial_outcome);
    assert_eq!(
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, 1, 99_000)
            .unwrap()
            .unwrap()
            .receipt(),
        &retained
    );
}

#[test]
fn stop_then_delete_before_publication_rolls_back_task_and_first_input_together() {
    let mut f = Fixture::new();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    let schedule = f.create();
    let pending = f.pending();
    let reserved =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    pin_fresh_heartbeat_workspace_mode(&f.path, &pending.occurrence_id, true).unwrap();
    let active = active_heartbeat_occurrences(&f.path).unwrap().remove(0);
    assert_eq!(active.state, HeartbeatOccurrenceState::Admitted);
    assert_eq!(
        active.session_id.as_deref(),
        Some(reserved.receipt().session_id.as_str())
    );
    assert!(active.run_id.is_none() && active.generation.is_none());
    let stopped = f.control(
        HeartbeatAction::Stop {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
        },
        62_000,
    );
    f.control(
        HeartbeatAction::Delete {
            schedule_id: schedule.schedule_id,
            expected_version: stopped.schedule.version,
        },
        63_000,
    );
    let current = read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
        .unwrap()
        .unwrap();
    assert!(current.receipt().stop_requested);
    assert!(
        current.receipt().initial_run_id.is_none() && current.receipt().first_input_id.is_none()
    );
    let marker: Option<String> = open_runtime_connection(&f.path).unwrap().query_row(
        "SELECT json_extract(binding_json,'$._stop_request') FROM heartbeat_schedules WHERE schedule_id=?1",
        [&pending.schedule_id], |row| row.get(0),
    ).unwrap();
    assert!(
        marker.is_none(),
        "fresh pre-run Stop must not invent a legacy run marker"
    );
    let snapshot = prepared_shared_snapshot(&f, &reserved);
    {
        let mut conn = open_runtime_connection(&f.path).unwrap();
        let tx = conn.transaction().unwrap();
        crate::sessions::insert_new_session_in_transaction(&tx, &f.path, &snapshot).unwrap();
        assert!(publish_shared_fresh_launch_with_connection(
            &tx,
            &reserved.receipt().request.request_id,
            &snapshot
        )
        .is_err());
    }
    assert!(!crate::sessions::session_exists(&f.path, &snapshot.session_id).unwrap());
    assert!(list_session_inbox(&f.path, &snapshot.session_id)
        .unwrap()
        .is_empty());
    fail_fresh_heartbeat_before_run(
        &f.path,
        &pending.occurrence_id,
        HeartbeatOutcome::Interrupted,
        "Stopped before publication.",
        64_000,
    )
    .unwrap();
    let retained = fresh_heartbeat_inventory(&f.path, "project", None).unwrap();
    assert_eq!(retained.len(), 1);
    assert!(retained[0].stop_requested);
    assert_eq!(
        retained[0].initial_outcome.as_ref().unwrap().outcome,
        Some(HeartbeatOutcome::Interrupted)
    );
}

#[test]
fn standalone_control_and_launch_reservation_replay_without_creator_dependency() {
    let f = Fixture::new();
    let schedule = f.create();
    assert_eq!(schedule.session_id, None);
    assert_eq!(
        schedule.binding.creator_session_id.as_deref(),
        Some("creator")
    );
    assert!(crate::sessions::delete_session(&f.path, "creator").unwrap());
    let pending = f.pending();
    assert_eq!(pending.session_id, None);
    let first =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    let replay =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 99_000)
            .unwrap()
            .unwrap();
    assert_eq!(first.receipt(), replay.receipt());
    assert_eq!(
        fresh_heartbeat_inventory(&f.path, "project", None)
            .unwrap()
            .len(),
        1
    );
    assert!(
        first.receipt().request.invoking_session_id.is_none(),
        "default branch never inherits creator HEAD"
    );
    assert_eq!(first.receipt().request.request_id, pending.receipt_id);
    assert_eq!(list_heartbeats(&f.path, None).unwrap()[0].starts, 1);
    let stopped = f.control(
        HeartbeatAction::Stop {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
        },
        62_000,
    );
    f.control(
        HeartbeatAction::Delete {
            schedule_id: schedule.schedule_id,
            expected_version: stopped.schedule.version,
        },
        63_000,
    );
    assert!(fresh_heartbeat_inventory(&f.path, "project", None).unwrap()[0].stop_requested);
}

#[test]
fn concurrent_schedules_contend_for_one_host_retained_slot_before_effects() {
    let f = Fixture::new();
    f.create();
    f.create();
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE heartbeat_retained_allowance SET retained_limit=1",
            [],
        )
        .unwrap();
    let mut pending = materialize_heartbeats(&f.path, 61_000).unwrap();
    let first = pending.remove(0);
    let second = pending.remove(0);
    let a = f.path.clone();
    let b = f.path.clone();
    let start = std::sync::Barrier::new(2);
    let (left, right) = std::thread::scope(|scope| {
        let barrier = &start;
        let left = scope.spawn(move || {
            barrier.wait();
            reserve_fresh_heartbeat_launch(&a, &first.occurrence_id, first.revision, 61_000)
                .unwrap()
        });
        let right = scope.spawn(move || {
            barrier.wait();
            reserve_fresh_heartbeat_launch(&b, &second.occurrence_id, second.revision, 61_000)
                .unwrap()
        });
        (left.join().unwrap(), right.join().unwrap())
    });
    assert_ne!(left.is_some(), right.is_some());
    assert_eq!(
        fresh_heartbeat_inventory(&f.path, "project", None)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        list_heartbeats(&f.path, None)
            .unwrap()
            .iter()
            .filter(|schedule| schedule.state == HeartbeatState::Suspended)
            .count(),
        1
    );
    assert!(
        !f.root.join("task-worktrees").exists(),
        "quota admission precedes any materialization"
    );
}

#[test]
fn two_owners_reserve_one_launch_and_host_allowance_counts_partial_and_deleted_history() {
    let f = Fixture::new();
    let first = f.create();
    let second = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap();
    open_runtime_connection(&f.path)
        .unwrap()
        .execute(
            "UPDATE heartbeat_retained_allowance SET retained_limit=1",
            [],
        )
        .unwrap();
    let one = pending
        .iter()
        .find(|p| p.schedule_id == first.schedule_id)
        .unwrap()
        .clone();
    let a = f.path.clone();
    let b = f.path.clone();
    let duplicate = one.clone();
    let (left, right) = std::thread::scope(|scope| {
        let left = scope.spawn(move || {
            reserve_fresh_heartbeat_launch(&a, &one.occurrence_id, one.revision, 61_000)
                .unwrap()
                .unwrap()
        });
        let right = scope.spawn(move || {
            reserve_fresh_heartbeat_launch(&b, &duplicate.occurrence_id, duplicate.revision, 61_000)
                .unwrap()
                .unwrap()
        });
        (left.join().unwrap(), right.join().unwrap())
    });
    assert_eq!(left.receipt(), right.receipt());
    // No task row or checkout exists yet; this partial reservation already owns
    // capacity. Deleting history cannot release that ownership across restart.
    {
        let conn = open_runtime_connection(&f.path).unwrap();
        conn.execute(
            "DELETE FROM heartbeat_occurrences WHERE schedule_id=?1",
            [&first.schedule_id],
        )
        .unwrap();
    }
    initialize(&f.path).unwrap();
    let other = pending
        .iter()
        .find(|p| p.schedule_id == second.schedule_id)
        .unwrap();
    assert!(
        reserve_fresh_heartbeat_launch(&f.path, &other.occurrence_id, other.revision, 61_000)
            .unwrap()
            .is_none()
    );
    let suspended = read_heartbeat(&f.path, "project:project", &second.schedule_id).unwrap();
    assert_eq!(suspended.state, HeartbeatState::Suspended);
    assert!(suspended.reason.unwrap().contains("owned inventory"));
    assert_eq!(
        fresh_heartbeat_inventory(&f.path, "project", None)
            .unwrap()
            .len(),
        1
    );
    let replay = reserve_fresh_heartbeat_launch(&f.path, &left.receipt().occurrence_id, 1, 99_000)
        .unwrap()
        .unwrap();
    assert_eq!(replay.receipt(), left.receipt());
}

#[test]
fn deleted_project_disables_pending_launch_and_changed_control_arguments_conflict() {
    let f = Fixture::new();
    let request = uuid::Uuid::new_v4().to_string();
    let action = HeartbeatAction::Create {
        spec: super::tests::spec(),
    };
    let first = control_heartbeat(
        &f.path,
        "project:project",
        &request,
        &action,
        "Human requested schedule.",
        &f.binding,
        1_000,
    )
    .unwrap();
    let pending = f.pending();
    let mut changed_destination = f.binding.clone();
    changed_destination.fresh_task.as_mut().unwrap().model = Some("different-model".into());
    assert!(control_heartbeat(
        &f.path,
        "project:project",
        &request,
        &action,
        "Human requested schedule.",
        &changed_destination,
        1_000,
    )
    .is_err());
    let mut changed = super::tests::spec();
    changed.instructions.push_str(" changed");
    assert!(control_heartbeat(
        &f.path,
        "project:project",
        &request,
        &HeartbeatAction::Create { spec: changed },
        "Human requested schedule.",
        &f.binding,
        1_000
    )
    .is_err());
    open_runtime_connection(&f.path)
        .unwrap()
        .execute("DELETE FROM projects WHERE project_id='project'", [])
        .unwrap();
    assert!(reserve_fresh_heartbeat_launch(
        &f.path,
        &pending.occurrence_id,
        pending.revision,
        61_000
    )
    .unwrap()
    .is_none());
    assert_eq!(
        read_heartbeat(&f.path, "project:project", &first.schedule.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Suspended
    );
    assert!(fresh_heartbeat_inventory(&f.path, "project", None)
        .unwrap()
        .is_empty());
}

#[test]
fn selected_model_is_preserved_on_reservation_replay() {
    let mut f = Fixture::new();
    let destination = f.binding.fresh_task.clone().unwrap();
    f.binding =
        fresh_heartbeat_binding(&f.path, &destination, None, f.root.to_str().unwrap()).unwrap();
    f.create();
    let pending = f.pending();
    let reserved =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    assert_eq!(
        reserved
            .receipt()
            .request
            .model_selection
            .as_ref()
            .unwrap()
            .model,
        "fixture-model"
    );
    let replay =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 99_000)
            .unwrap()
            .unwrap();
    assert_eq!(
        replay.receipt().request.model_selection,
        reserved.receipt().request.model_selection
    );
}

#[test]
fn fresh_calendar_create_and_edit_refuse_without_durable_effects() {
    use rusqlite::types::Value;
    let f = Fixture::new();
    let snapshot = || {
        let conn = open_runtime_connection(&f.path).unwrap();
        [
            "heartbeat_schedules",
            "heartbeat_commands",
            "heartbeat_fresh_destinations",
            "heartbeat_task_launches",
            "heartbeat_occurrences",
            "sqlite_sequence",
        ]
        .into_iter()
        .map(|table| {
            let mut q = conn
                .prepare(&format!("SELECT rowid,* FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = q.column_count();
            q.query_map([], |row| {
                (0..columns)
                    .map(|i| row.get::<_, Value>(i))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
        })
        .collect::<Vec<_>>()
    };
    let mut calendar = super::tests::spec();
    calendar.cadence = HeartbeatCadence::Calendar(HeartbeatCalendarRule {
        zone: "UTC".into(),
        data_version: "2026f".into(),
        hour: 9,
        minute: 0,
        days: HeartbeatCalendarDays::Daily,
    });
    let before_create = snapshot();
    let error = control_heartbeat(
        &f.path,
        "project:project",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create {
            spec: calendar.clone(),
        },
        "Create the saved Local task.",
        &f.binding,
        1_000,
    )
    .unwrap_err();
    assert!(error.to_string().contains("interval cadence"));
    assert_eq!(snapshot(), before_create);
    let interval = f.create();
    assert!(matches!(
        &interval.spec.cadence,
        HeartbeatCadence::Interval { .. }
    ));
    let before_edit = snapshot();
    let error = control_heartbeat(
        &f.path,
        "project:project",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Edit {
            schedule_id: interval.schedule_id,
            expected_version: interval.version,
            spec: calendar,
        },
        "Edit the saved Local task.",
        &f.binding,
        2_000,
    )
    .unwrap_err();
    assert!(error.to_string().contains("interval cadence"));
    assert_eq!(snapshot(), before_edit);
}

#[test]
fn v54_fresh_receipts_replay_and_resume_without_rewriting_evidence() {
    for threshold in [None, Some(8192)] {
        let mut f = Fixture::new();
        f.binding
            .fresh_task
            .as_mut()
            .unwrap()
            .model_selection
            .as_mut()
            .unwrap()
            .compaction_threshold = threshold;
        let create_id = uuid::Uuid::new_v4().to_string();
        let create_action = HeartbeatAction::Create {
            spec: super::tests::spec(),
        };
        let original = control_heartbeat(
            &f.path,
            "project:project",
            &create_id,
            &create_action,
            "Human schedule",
            &f.binding,
            1_000,
        )
        .unwrap();
        let edit_id = uuid::Uuid::new_v4().to_string();
        let mut spec = super::tests::spec();
        spec.instructions.push_str(" edited");
        let edit_action = HeartbeatAction::Edit {
            schedule_id: original.schedule.schedule_id.clone(),
            expected_version: 1,
            spec,
        };
        let edited = control_heartbeat(
            &f.path,
            "project:project",
            &edit_id,
            &edit_action,
            "Human edit",
            &f.binding,
            2_000,
        )
        .unwrap();
        let pending = f.pending();
        let reserved = reserve_fresh_heartbeat_launch(
            &f.path,
            &pending.occurrence_id,
            pending.revision,
            61_000,
        )
        .unwrap()
        .unwrap();
        let before_schedule =
            read_heartbeat(&f.path, "project:project", &original.schedule.schedule_id).unwrap();
        let conn = open_runtime_connection(&f.path).unwrap();
        let old_key = |value: String| {
            value.replace(
                "\"compaction_threshold\":",
                "\"orchestrator_compaction_threshold\":",
            )
        };
        for (table, key, column, id) in [
            (
                "heartbeat_schedules",
                "schedule_id",
                "binding_json",
                original.schedule.schedule_id.as_str(),
            ),
            (
                "heartbeat_fresh_destinations",
                "schedule_id",
                "destination_json",
                original.schedule.schedule_id.as_str(),
            ),
            (
                "heartbeat_fresh_destinations",
                "schedule_id",
                "binding_json",
                original.schedule.schedule_id.as_str(),
            ),
            (
                "heartbeat_task_launches",
                "occurrence_id",
                "launch_json",
                pending.occurrence_id.as_str(),
            ),
        ] {
            let raw: String = conn
                .query_row(
                    &format!("SELECT {column} FROM {table} WHERE {key}=?1"),
                    [id],
                    |r| r.get(0),
                )
                .unwrap();
            conn.execute(
                &format!("UPDATE {table} SET {column}=?2 WHERE {key}=?1"),
                params![id, old_key(raw)],
            )
            .unwrap();
        }
        for (id, action) in [(&create_id, &create_action), (&edit_id, &edit_action)] {
            let raw: String = conn
                .query_row(
                    "SELECT response_json FROM heartbeat_commands WHERE request_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .unwrap();
            let digest =
                super::v54_receipt::digest(action, f.binding.fresh_task.as_ref().unwrap()).unwrap();
            conn.execute("UPDATE heartbeat_commands SET response_json=?2,canonical_digest=?3 WHERE request_id=?1",params![id,old_key(raw),digest]).unwrap();
        }
        let before: (String, String) = conn
            .query_row(
                "SELECT response_json,canonical_digest FROM heartbeat_commands WHERE request_id=?1",
                [&create_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        // Reconstruct the predecessor catalog, then exercise the real v54
        // upgrade and reopen instead of manually manufacturing provenance.
        let triggers: Vec<String> = conn.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'task_model_v54_%'").unwrap().query_map([], |row|row.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        for trigger in triggers {
            conn.execute_batch(&format!("DROP TRIGGER {trigger}"))
                .unwrap();
        }
        conn.execute_batch("DROP TABLE task_model_v54_provenance;
            ALTER TABLE session_events RENAME COLUMN event_target TO thread_name;
            ALTER TABLE session_events RENAME TO thread_events;
            ALTER TABLE session_compaction_checkpoints RENAME TO orchestrator_compaction_checkpoints;
            ALTER TABLE sessions RENAME COLUMN compaction_threshold TO orchestrator_compaction_threshold;
            DROP INDEX idx_session_events_session_target_id;
            DROP INDEX idx_session_compaction_checkpoints_latest;
            CREATE INDEX idx_thread_events_session_thread_id ON thread_events(session_id,thread_name,id DESC);
            CREATE INDEX idx_orchestrator_compaction_checkpoints_latest ON orchestrator_compaction_checkpoints(session_id,id DESC);
            PRAGMA user_version=54;").unwrap();
        drop(conn);
        initialize(&f.path).unwrap();
        assert_eq!(
            read_heartbeat(&f.path, "project:project", &original.schedule.schedule_id).unwrap(),
            before_schedule
        );
        assert_eq!(
            read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
                .unwrap()
                .unwrap()
                .receipt(),
            reserved.receipt()
        );
        for (id, action, expected) in [
            (&create_id, &create_action, &original),
            (&edit_id, &edit_action, &edited),
        ] {
            let replay = control_heartbeat(
                &f.path,
                "project:project",
                id,
                action,
                "different prose ignored on receipt replay",
                &f.binding,
                99_000,
            )
            .unwrap();
            assert_eq!(&replay, expected);
        }
        let mut changed = f.binding.clone();
        changed
            .fresh_task
            .as_mut()
            .unwrap()
            .model_selection
            .as_mut()
            .unwrap()
            .compaction_threshold = Some(9999);
        assert!(control_heartbeat(
            &f.path,
            "project:project",
            &create_id,
            &create_action,
            "ignored",
            &changed,
            99_000
        )
        .is_err());
        let conn = open_runtime_connection(&f.path).unwrap();
        assert_eq!(
            conn.query_row::<(String, String), _, _>(
                "SELECT response_json,canonical_digest FROM heartbeat_commands WHERE request_id=?1",
                [&create_id],
                |r| Ok((r.get(0)?, r.get(1)?))
            )
            .unwrap(),
            before
        );
        conn.execute("UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,'$.preparation_attempts',2) WHERE occurrence_id=?1",[&pending.occurrence_id]).unwrap();
        conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._attention_base_updated_at','x') WHERE schedule_id=?1",[&original.schedule.schedule_id]).unwrap();
        drop(conn);
        assert_eq!(
            read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
                .unwrap()
                .unwrap()
                .receipt(),
            reserved.receipt()
        );
        assert_eq!(
            read_heartbeat(&f.path, "project:project", &original.schedule.schedule_id)
                .unwrap()
                .binding
                .fresh_task,
            f.binding.fresh_task
        );
    }
}
