use super::*;

fn configuration(model: &str) -> NewModelConfiguration {
    NewModelConfiguration {
        name: model.into(),
        backend: "openai-responses".into(),
        model: model.into(),
        base_url: "https://fixture.invalid/v1".into(),
        allow_insecure_http: false,
        api_key_env: None,
        reasoning_effort: Some("high".into()),
        extra_headers: std::collections::BTreeMap::new(),
        orchestrator_compaction_threshold: None,
        initial_prompt: None,
        light_model: None,
    }
}

fn select(f: &Fixture, id: Option<&str>) {
    update_project(
        &f.path,
        "project",
        ProjectPatch {
            default_model_config_id: Some(id.map(str::to_owned)),
            ..ProjectPatch::default()
        },
    )
    .unwrap();
}

fn configured() -> Fixture {
    let mut f = Fixture::new();
    for id in ["model-a", "model-b"] {
        insert_model_configuration(&f.path, id, configuration(id)).unwrap();
    }
    select(&f, Some("model-a"));
    f.binding = fresh_heartbeat_binding(
        &f.path,
        f.binding.fresh_task.as_ref().unwrap(),
        None,
        f.root.to_str().unwrap(),
    )
    .unwrap();
    f
}

#[test]
fn new_occurrence_uses_current_project_default_after_pointer_change() {
    let f = configured();
    f.create();
    select(&f, Some("model-b"));
    let pending = f.pending();
    let prepared =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .expect("changing only project model defaults must not suspend a fresh schedule");
    assert_eq!(prepared.model_defaults().unwrap().model, "model-b");
    assert_eq!(
        prepared.receipt().binding.model_configuration_id.as_deref(),
        Some("model-b")
    );
    assert_eq!(
        list_heartbeats(&f.path, None).unwrap()[0].state,
        HeartbeatState::Active
    );
}

#[test]
fn absent_defaults_and_explicit_choices_do_not_change_project_identity() {
    for (before, after) in [(None, Some("model-b")), (Some("model-a"), None)] {
        let mut f = configured();
        select(&f, before);
        let mut destination = f.binding.fresh_task.clone().unwrap();
        destination.model = Some("explicit-model".into());
        destination.reasoning_effort = Some("low".into());
        f.binding =
            fresh_heartbeat_binding(&f.path, &destination, None, f.root.to_str().unwrap()).unwrap();
        let schedule = f.create();
        select(&f, after);
        let pending = f.pending();
        let prepared = reserve_fresh_heartbeat_launch(
            &f.path,
            &pending.occurrence_id,
            pending.revision,
            61_000,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            prepared
                .model_defaults()
                .map(|record| record.model.as_str()),
            after
        );
        assert_eq!(prepared.receipt().destination, destination);
        let saved = read_heartbeat(&f.path, "project:project", &schedule.schedule_id).unwrap();
        assert_eq!(
            saved.binding, schedule.binding,
            "new defaults do not rewrite a schedule"
        );
        assert_eq!(saved.starts, 1);
    }
}

#[test]
fn resume_after_default_change_needs_no_edit_and_replays_its_original_receipt() {
    let f = configured();
    let schedule = f.create();
    let paused = f.control(
        HeartbeatAction::Pause {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
        },
        2_000,
    );
    select(&f, Some("model-b"));
    let binding = fresh_heartbeat_binding(
        &f.path,
        f.binding.fresh_task.as_ref().unwrap(),
        None,
        f.root.to_str().unwrap(),
    )
    .unwrap();
    let action = HeartbeatAction::Resume {
        schedule_id: schedule.schedule_id.clone(),
        expected_version: paused.schedule.version,
    };
    let request = uuid::Uuid::new_v4().to_string();
    let resumed = control_heartbeat(
        &f.path,
        "project:project",
        &request,
        &action,
        "Resume the same schedule.",
        &binding,
        3_000,
    )
    .unwrap();
    assert_eq!(resumed.schedule.state, HeartbeatState::Active);
    assert_eq!(resumed.schedule.spec, schedule.spec);
    assert_eq!(resumed.schedule.binding, schedule.binding);
    select(&f, None);
    let replay = control_heartbeat(
        &f.path,
        "project:project",
        &request,
        &action,
        "Resume the same schedule.",
        &binding,
        4_000,
    )
    .unwrap();
    assert_eq!(replay, resumed);
    assert!(control_heartbeat(
        &f.path,
        "project:project",
        &uuid::Uuid::new_v4().to_string(),
        &action,
        "Stale resume must conflict.",
        &binding,
        5_000,
    )
    .is_err());
}

fn publish(
    f: &Fixture,
    pending: &HeartbeatOccurrence,
    prepared: &PreparedFreshTaskLaunch,
) -> crate::sessions::SessionSnapshot {
    pin_fresh_heartbeat_workspace_mode(&f.path, &pending.occurrence_id, true).unwrap();
    let mut snapshot = prepared_shared_snapshot(f, prepared);
    snapshot.model = prepared.model_defaults().unwrap().model.clone();
    let mut conn = open_runtime_connection(&f.path).unwrap();
    let tx = conn.transaction().unwrap();
    crate::sessions::insert_new_session_in_transaction(&tx, &f.path, &snapshot).unwrap();
    publish_shared_fresh_launch_with_connection(
        &tx,
        &prepared.receipt().request.request_id,
        &snapshot,
    )
    .unwrap();
    tx.commit().unwrap();
    snapshot
}

#[test]
fn reserved_defaults_survive_reopen_publication_and_initial_admission_after_pointer_changes() {
    let mut f = configured();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    f.create();
    let pending = f.pending();
    let prepared =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    select(&f, Some("model-b"));
    update_model_configuration(&f.path, "model-a", configuration("edited-model-a")).unwrap();
    initialize(&f.path).unwrap();
    let replay = reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, 1, 62_000)
        .unwrap()
        .unwrap();
    assert_eq!(replay.receipt(), prepared.receipt());
    assert_eq!(replay.model_defaults(), prepared.model_defaults());
    let snapshot = publish(&f, &pending, &replay);
    select(&f, None);
    let published = heartbeat_history(&f.path, "project:project", &pending.schedule_id)
        .unwrap()
        .remove(0);
    let run = uuid::Uuid::new_v4().to_string();
    let admitted = admit_heartbeat(
        &f.path,
        &snapshot.session_id,
        &pending.occurrence_id,
        published.revision,
        &run,
        &pending.receipt_id,
        "expanded initial prompt",
        f.root.to_str().unwrap(),
        63_000,
    )
    .unwrap()
    .unwrap();
    assert_eq!(admitted.run_id.as_deref(), Some(run.as_str()));
    let final_receipt = read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
        .unwrap()
        .unwrap();
    assert_eq!(final_receipt.model_defaults(), prepared.model_defaults());
    assert_eq!(
        final_receipt.receipt().session_id,
        prepared.receipt().session_id
    );
    assert_eq!(final_receipt.receipt().request, prepared.receipt().request);
    assert!(fresh_heartbeat_for_inbox(
        &f.path,
        &snapshot.session_id,
        admitted.inbox_item_id.unwrap()
    )
    .is_err());
    assert_eq!(
        list_session_inbox(&f.path, &snapshot.session_id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn changed_prepared_configuration_or_input_still_blocks_initial_admission() {
    for field in ["configuration", "input"] {
        let mut f = configured();
        f.binding.fresh_task.as_mut().unwrap().default_ref = None;
        f.create();
        let pending = f.pending();
        let prepared = reserve_fresh_heartbeat_launch(
            &f.path,
            &pending.occurrence_id,
            pending.revision,
            61_000,
        )
        .unwrap()
        .unwrap();
        select(&f, Some("model-b"));
        let snapshot = publish(&f, &pending, &prepared);
        let published = heartbeat_history(&f.path, "project:project", &pending.schedule_id)
            .unwrap()
            .remove(0);
        let conn = open_runtime_connection(&f.path).unwrap();
        if field == "configuration" {
            conn.execute(
                "UPDATE sessions SET config_version=config_version+1 WHERE session_id=?1",
                [&snapshot.session_id],
            )
            .unwrap();
        } else {
            conn.execute(
                "UPDATE session_inbox SET content='changed' WHERE session_id=?1",
                [&snapshot.session_id],
            )
            .unwrap();
        }
        drop(conn);
        assert!(
            admit_heartbeat(
                &f.path,
                &snapshot.session_id,
                &pending.occurrence_id,
                published.revision,
                &uuid::Uuid::new_v4().to_string(),
                &pending.receipt_id,
                "expanded",
                f.root.to_str().unwrap(),
                62_000,
            )
            .unwrap()
            .is_none(),
            "{field}"
        );
        let retained = read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
            .unwrap()
            .unwrap();
        assert!(retained.receipt().initial_run_id.is_none());
        assert_eq!(
            retained.receipt().initial_outcome.as_ref().unwrap().outcome,
            Some(HeartbeatOutcome::NeedsHumanAction)
        );
        assert_eq!(
            list_heartbeats(&f.path, None).unwrap()[0].state,
            HeartbeatState::Suspended
        );
    }
}

#[test]
fn fresh_comparison_keeps_target_guards_and_does_not_relax_classic_comparison() {
    let f = configured();
    let binding = f.binding.clone();
    let mut defaults = binding.clone();
    defaults.model_configuration_id = Some("model-b".into());
    assert!(!binding.same_target(&defaults));
    assert!(binding.same_fresh_project_target(&defaults));
    for field in ["configuration", "cwd", "project", "backend"] {
        let mut changed = defaults.clone();
        match field {
            "configuration" => changed.config_version += 1,
            "cwd" => changed.cwd.push_str("/other"),
            "project" => changed.project_id = Some("other".into()),
            "backend" => changed.backend = "ssh".into(),
            _ => unreachable!(),
        }
        assert!(!binding.same_target(&changed), "{field}");
        assert!(!binding.same_fresh_project_target(&changed), "{field}");
    }
}
