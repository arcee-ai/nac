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
        service_tier: Some(
            if model == "model-a" {
                "fast"
            } else {
                "standard"
            }
            .into(),
        ),
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
fn legacy_schedule_without_selection_suspends_without_reserving_or_guessing() {
    let root = std::env::temp_dir().join(format!("nac-legacy-schedule-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!(
        "../../schema/fixtures/v53-legacy-schedule-replay.sql"
    ))
    .unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let receipt = read_heartbeat_command_receipt(
        &path,
        "project:project",
        "33333333-3333-4333-8333-333333333333",
    )
    .unwrap()
    .unwrap();
    let f = Fixture {
        root,
        path,
        binding: receipt.schedule.binding.clone(),
    };
    let schedule = receipt.schedule;
    for id in ["model-a", "model-b"] {
        insert_model_configuration(&f.path, id, configuration(id)).unwrap();
    }
    select(&f, Some("model-b"));
    let pending = materialize_heartbeats(&f.path, 63_000)
        .unwrap()
        .into_iter()
        .find(|occurrence| occurrence.schedule_id == schedule.schedule_id)
        .unwrap();
    assert!(reserve_fresh_heartbeat_launch(
        &f.path,
        &pending.occurrence_id,
        pending.revision,
        63_000
    )
    .unwrap()
    .is_none());
    assert!(read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
        .unwrap()
        .is_none());
    initialize(&f.path).unwrap();
    let reopened = read_heartbeat(&f.path, "project:project", &schedule.schedule_id).unwrap();
    assert_eq!(reopened.state, HeartbeatState::Suspended);
    assert_eq!(reopened.starts, 0);
    assert!(reopened
        .reason
        .as_deref()
        .unwrap_or_default()
        .contains("explicit model selection"));
    assert!(fresh_heartbeat_inventory(&f.path, "project", None)
        .unwrap()
        .is_empty());
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
        assert!(prepared.model_defaults().is_none());
        assert_eq!(
            prepared.receipt().request.model_selection,
            destination.model_selection
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
    snapshot.model = prepared
        .receipt()
        .request
        .model_selection
        .as_ref()
        .unwrap()
        .model
        .clone();
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
fn reserved_session_model_survives_reopen_publication_and_initial_admission_after_pointer_changes()
{
    let mut f = configured();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    f.binding
        .fresh_task
        .as_mut()
        .unwrap()
        .model_selection
        .as_mut()
        .unwrap()
        .service_tier = Some("fast".into());
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
    assert!(replay.model_defaults().is_none());
    assert_eq!(
        replay
            .receipt()
            .request
            .model_selection
            .as_ref()
            .unwrap()
            .service_tier
            .as_deref(),
        Some("fast")
    );
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

#[test]
fn legacy_create_receipt_committing_during_retry_wins_before_model_guard() {
    use std::sync::mpsc;
    use std::time::Duration;

    let root = std::env::temp_dir().join(format!("nac-legacy-race-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!(
        "../../schema/fixtures/v53-legacy-schedule-replay.sql"
    ))
    .unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let scope = "project:project";
    let id = "11111111-1111-4111-8111-111111111111";
    let original = read_heartbeat_command_receipt(&path, scope, id)
        .unwrap()
        .unwrap();
    let action = HeartbeatAction::Create {
        spec: original.schedule.spec.clone(),
    };
    let binding = original.schedule.binding.clone();
    let mut writer = rusqlite::Connection::open(&path).unwrap();
    let row: (String, String, String, i64) = writer.query_row(
        "SELECT canonical_digest,schedule_id,response_json,created_at_ms FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",
        (scope, id), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).unwrap();
    writer
        .execute(
            "DELETE FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",
            (scope, id),
        )
        .unwrap();
    assert!(read_heartbeat_command_receipt(&path, scope, id)
        .unwrap()
        .is_none());
    let tx = writer
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    tx.execute("INSERT INTO heartbeat_commands(session_id,request_id,canonical_digest,schedule_id,response_json,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6)", rusqlite::params![scope,id,row.0,row.1,row.2,row.3]).unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    *super::super::control::ON_CONTROL_BUSY.lock().unwrap() = Some((id.into(), started_tx));
    let (result_tx, result_rx) = mpsc::channel();
    let retry_path = path.clone();
    let retry = std::thread::spawn(move || {
        let result = control_heartbeat(&retry_path, scope, id, &action, "retry", &binding, 4_000);
        let _ = result_tx.send(result);
    });
    let entered = started_rx.recv_timeout(Duration::from_secs(5));
    let before_commit = result_rx.recv_timeout(Duration::from_millis(100));
    // Always release the writer before asserting so a failure cannot strand the contender.
    tx.commit().unwrap();
    *super::super::control::ON_CONTROL_BUSY.lock().unwrap() = None;
    let after_commit = if before_commit.is_err() {
        Some(result_rx.recv_timeout(Duration::from_secs(5)))
    } else {
        None
    };
    retry.join().unwrap();
    entered.unwrap();
    assert!(matches!(
        before_commit,
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    let replay = after_commit.unwrap().unwrap().unwrap();
    assert_eq!(replay, original);
    assert_eq!(
        read_heartbeat_command_receipt(&path, scope, id).unwrap(),
        Some(original)
    );
    drop(writer);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn v53_writer_frozen_admission_replays_exact_model_without_rebinding() {
    let root = std::env::temp_dir().join(format!("nac-v53-frozen-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("store.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(include_str!(
        "../../schema/fixtures/v53-admitted-frozen.sql"
    ))
    .unwrap();
    let (id, original): (String, String) = conn
        .query_row(
            "SELECT occurrence_id, launch_json FROM heartbeat_task_launches",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    drop(conn);
    initialize(&path).unwrap();
    let first = read_fresh_heartbeat_launch(&path, &id).unwrap().unwrap();
    let selection = first.legacy_frozen_model().unwrap().unwrap();
    assert_eq!(selection.model, "model-a");
    assert_eq!(selection.base_url, "https://fixture.invalid/v1");
    assert_eq!(selection.service_tier.as_deref(), Some("fast"));
    assert!(first.receipt().request.model_selection.is_none());
    let mut pinned = first.clone();
    pinned.receipt.binding.model_configuration_id = None;
    assert!(pinned.legacy_frozen_model().is_err());
    pinned.model_defaults.as_mut().unwrap().config_id =
        format!("scheduled-defaults:{}", pinned.receipt.occurrence_id);
    assert!(pinned.legacy_frozen_model().unwrap().is_some());
    let mut tampered = first.clone();
    tampered.model_defaults.as_mut().unwrap().config_id = "wrong-binding".into();
    assert!(tampered.legacy_frozen_model().is_err());
    let mut tampered = first.clone();
    tampered
        .model_defaults
        .as_mut()
        .unwrap()
        .extra_headers
        .insert("invalid header".into(), "private".into());
    assert!(tampered.legacy_frozen_model().is_err());
    let mut tampered = first.clone();
    tampered
        .model_defaults
        .as_mut()
        .unwrap()
        .orchestrator_compaction_threshold = Some(0);
    assert!(tampered.legacy_frozen_model().is_err());
    let mut overridden = first.clone();
    overridden.receipt.destination.model = Some("different-model".into());
    overridden.receipt.binding.fresh_task = Some(overridden.receipt.destination.clone());
    assert!(
        overridden.legacy_frozen_model().is_err(),
        "incompatible inherited tier must not silently change on a non-Codex route"
    );
    overridden.receipt.destination.service_tier = Some("standard".into());
    overridden.receipt.binding.fresh_task = Some(overridden.receipt.destination.clone());
    assert_eq!(
        overridden
            .legacy_frozen_model()
            .unwrap()
            .unwrap()
            .service_tier
            .as_deref(),
        Some("standard")
    );
    let mut codex = first.clone();
    let defaults = codex.model_defaults.as_mut().unwrap();
    defaults.backend = "chatgpt-codex-responses".into();
    defaults.model = "gpt-5.2".into();
    defaults.base_url = "https://chatgpt.com/backend-api/codex".into();
    codex.receipt.destination.model = Some("gpt-5.3-codex".into());
    codex.receipt.binding.fresh_task = Some(codex.receipt.destination.clone());
    assert_eq!(
        codex
            .legacy_frozen_model()
            .unwrap()
            .unwrap()
            .service_tier
            .as_deref(),
        Some("standard")
    );
    codex.receipt.destination.service_tier = Some("fast".into());
    codex.receipt.binding.fresh_task = Some(codex.receipt.destination.clone());
    assert_eq!(
        codex
            .legacy_frozen_model()
            .unwrap()
            .unwrap()
            .service_tier
            .as_deref(),
        Some("fast")
    );
    let mut stopped = first.clone();
    stopped.receipt.stop_requested = true;
    assert!(stopped.legacy_frozen_model().is_err());
    let replay = reserve_fresh_heartbeat_launch(&path, &id, 1, 99_000)
        .unwrap()
        .unwrap();
    assert_eq!(replay.receipt(), first.receipt());
    assert_eq!(replay.legacy_frozen_model().unwrap(), Some(selection));
    let conn = Connection::open(&path).unwrap();
    let raw: String = conn
        .query_row(
            "SELECT launch_json FROM heartbeat_task_launches WHERE occurrence_id=?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, original);
    conn.execute("UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,'$.model_defaults.orchestrator_compaction_threshold',8192) WHERE occurrence_id=?1", [&id]).unwrap();
    drop(conn);
    let prepared = read_fresh_heartbeat_launch(&path, &id).unwrap().unwrap();
    let mut snapshot = crate::sessions::new_snapshot(
        prepared.receipt().session_id.clone(),
        root.clone(),
        "model-a".into(),
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
    snapshot.api_key_env = crate::model::auto_select_api_key_env(snapshot.backend);
    snapshot.reasoning_effort = Some(crate::model::ReasoningEffort::High);
    snapshot.service_tier = Some(crate::model::ServiceTier::Fast);
    snapshot.orchestrator_compaction_threshold = Some(8192);
    let mut variants = Vec::new();
    let mut changed = snapshot.clone();
    changed.api_key_env = Some("UNRELATED_SELECTOR".into());
    variants.push(changed);
    let mut changed = snapshot.clone();
    changed.reasoning_effort = Some(crate::model::ReasoningEffort::Low);
    variants.push(changed);
    let mut changed = snapshot.clone();
    changed.service_tier = Some(crate::model::ServiceTier::Standard);
    variants.push(changed);
    let mut changed = snapshot.clone();
    changed.orchestrator_compaction_threshold = Some(8193);
    variants.push(changed);
    let mut changed = snapshot.clone();
    changed
        .extra_headers
        .insert("x-test".into(), "changed".into());
    variants.push(changed);
    for changed in variants {
        let conn = Connection::open(&path).unwrap();
        let error = link_fresh_launch_input_with_connection(
            &conn,
            &prepared.receipt().request.request_id,
            &changed,
            1,
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("does not match historical frozen model receipt"));
    }
    let conn = Connection::open(&path).unwrap();
    conn.execute("UPDATE heartbeat_task_launches SET launch_json=json_set(launch_json,'$.model_defaults.reasoning_effort',NULL,'$.model_defaults.service_tier',NULL) WHERE occurrence_id=?1", [&id]).unwrap();
    drop(conn);
    let prepared = read_fresh_heartbeat_launch(&path, &id).unwrap().unwrap();
    let mut changed = snapshot.clone();
    changed.service_tier = None;
    let conn = Connection::open(&path).unwrap();
    assert!(link_fresh_launch_input_with_connection(
        &conn,
        &prepared.receipt().request.request_id,
        &changed,
        1
    )
    .unwrap_err()
    .to_string()
    .contains("frozen model receipt"));
    let mut changed = snapshot.clone();
    changed.reasoning_effort = None;
    assert!(link_fresh_launch_input_with_connection(
        &conn,
        &prepared.receipt().request.request_id,
        &changed,
        1
    )
    .unwrap_err()
    .to_string()
    .contains("frozen model receipt"));
    conn.execute("UPDATE heartbeat_task_launches SET launch_json=json_remove(launch_json,'$.model_defaults') WHERE occurrence_id=?1", [&id]).unwrap();
    drop(conn);
    assert!(read_fresh_heartbeat_launch(&path, &id)
        .unwrap()
        .unwrap()
        .legacy_frozen_model()
        .unwrap()
        .is_none());
    std::fs::remove_dir_all(root).unwrap();
}
