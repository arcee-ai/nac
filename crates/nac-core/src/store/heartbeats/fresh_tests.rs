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
                default_model_config_id: None,
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
            default_model_config_id: None,
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
fn each_launch_reservation_freezes_destination_defaults_without_exposing_configuration_headers() {
    let mut f = Fixture::new();
    insert_model_configuration(
        &f.path,
        "fixture-config",
        NewModelConfiguration {
            name: "Fixture model".into(),
            backend: "openai-responses".into(),
            model: "fixture-first".into(),
            base_url: "https://fixture.invalid/v1".into(),
            allow_insecure_http: false,
            api_key_env: None,
            reasoning_effort: Some("high".into()),
            extra_headers: std::collections::BTreeMap::from([(
                "X-Fixture".into(),
                "private-configuration-value".into(),
            )]),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
    update_project(
        &f.path,
        "project",
        ProjectPatch {
            default_model_config_id: Some(Some("fixture-config".into())),
            ..ProjectPatch::default()
        },
    )
    .unwrap();
    let destination = f.binding.fresh_task.clone().unwrap();
    f.binding =
        fresh_heartbeat_binding(&f.path, &destination, None, f.root.to_str().unwrap()).unwrap();
    f.create();
    let pending = f.pending();
    let reserved =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    assert_eq!(reserved.model_defaults().unwrap().model, "fixture-first");
    open_runtime_connection(&f.path).unwrap().execute("UPDATE model_configurations SET model='fixture-later' WHERE config_id='fixture-config'",[]).unwrap();
    let replay =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 99_000)
            .unwrap()
            .unwrap();
    assert_eq!(replay.model_defaults(), reserved.model_defaults());
    assert!(
        !encode(&fresh_heartbeat_inventory(&f.path, "project", None).unwrap())
            .unwrap()
            .contains("private-configuration-value")
    );
}
