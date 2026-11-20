use super::*;
fn fixture() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE task_launches(request_id TEXT PRIMARY KEY,request_json TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT 'project',session_id TEXT NOT NULL DEFAULT 'session',source_json TEXT NOT NULL DEFAULT '{}',workspace_path TEXT NOT NULL DEFAULT '/tmp');
    CREATE TABLE native_task_launches(request_id TEXT PRIMARY KEY,request_json TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT 'project',caller_session_id TEXT NOT NULL DEFAULT 'caller',source_cwd TEXT NOT NULL DEFAULT '/tmp',session_id TEXT NOT NULL DEFAULT 'session',retained INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE heartbeat_schedules(schedule_id TEXT PRIMARY KEY,binding_json TEXT NOT NULL,session_id TEXT);
    CREATE TABLE heartbeat_task_launches(occurrence_id TEXT PRIMARY KEY,launch_json TEXT NOT NULL,schedule_id TEXT NOT NULL DEFAULT 'schedule',request_id TEXT NOT NULL DEFAULT 'request',project_id TEXT NOT NULL DEFAULT 'project',session_id TEXT);
    CREATE TABLE heartbeat_commands(session_id TEXT,request_id TEXT,response_json TEXT NOT NULL,canonical_digest TEXT NOT NULL DEFAULT '',schedule_id TEXT NOT NULL DEFAULT 'schedule',PRIMARY KEY(session_id,request_id));
    CREATE TABLE heartbeat_fresh_destinations(schedule_id TEXT PRIMARY KEY,destination_json TEXT NOT NULL,binding_json TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT 'project',creator_session_id TEXT);").unwrap();
    create_schema(&conn).unwrap();
    conn
}
fn model(threshold: Option<u64>) -> serde_json::Value {
    serde_json::json!({"backend":"openai-responses","model":"gpt","base_url":"https://example.invalid","allow_insecure_http":false,"api_key_env":null,"reasoning_effort":null,"extra_headers":null,"orchestrator_compaction_threshold":threshold})
}
fn request(threshold: Option<u64>) -> String {
    serde_json::json!({"request_id":"request","project_id":"project","invoking_session_id":null,"model_selection":model(threshold),"git_ref":null,"default_ref":null,"title":"title","prompt":"literal orchestrator_compaction_threshold in user prose"}).to_string()
}
fn destination(selection: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"project_id":"project","pinned_commit":null,"default_ref":null,"model_selection":selection,"model":null,"reasoning_effort":null,"retained_limit":2})
}
fn binding(selection: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"config_version":0,"cwd":"/tmp","project_id":"project","backend":"local","execution_cwd":"/tmp","scheduling_request":"requested","seen_through_sequence":0,"fresh_task":destination(selection)})
}
fn launch(selection: &serde_json::Value) -> serde_json::Value {
    let task: serde_json::Value = serde_json::from_str(&request(Some(42))).unwrap();
    serde_json::json!({"receipt":{"occurrence_id":"occurrence","schedule_id":"schedule","session_id":"session","request":task,"destination":destination(selection),"binding":binding(selection),"first_input_id":null,"stop_requested":false,"initial_run_id":null,"initial_outcome":null,"shared_directory":null,"created_at_ms":1}})
}
fn command(selection: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"request_id":"command","schedule":{"schedule_id":"schedule","session_id":null,"version":1,"state":"active","binding":binding(selection),"spec":{"name":"name","instructions":"instructions","interval_ms":60000,"end_condition":"done","goal_id":null,"token_allowance":null},"anchor_ms":1,"next_due_ms":60001,"reason":null,"starts":0,"tokens_used":0,"time_used_ms":0,"usage_unknown":false,"created_at_ms":1,"updated_at_ms":1},"occurrence":null,"active_occurrence":null})
}
fn insert_destination(conn: &Connection, selection: &serde_json::Value) {
    conn.execute("INSERT INTO heartbeat_fresh_destinations(schedule_id,destination_json,binding_json) VALUES('schedule',?1,?2)", params![destination(selection).to_string(),binding(selection).to_string()]).unwrap();
}

fn all_owner_fixture(selection: &serde_json::Value) -> Connection {
    let conn = fixture();
    let mut task: serde_json::Value = serde_json::from_str(&request(None)).unwrap();
    task["model_selection"] = selection.clone();
    let native = serde_json::json!({"request_id":"native","project_id":null,"title":"title","prompt":"prompt","_nac_model_selection":selection});
    let mut receipt = launch(selection);
    *receipt
        .pointer_mut("/receipt/request/model_selection")
        .unwrap() = selection.clone();
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [task.to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO native_task_launches(request_id,request_json) VALUES('native',?1)",
        [native.to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO heartbeat_schedules(schedule_id,binding_json) VALUES('schedule',?1)",
        [binding(selection).to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO heartbeat_task_launches(occurrence_id,launch_json) VALUES('occurrence',?1)",
        [receipt.to_string()],
    )
    .unwrap();
    conn.execute("INSERT INTO heartbeat_commands(session_id,request_id,response_json) VALUES('project:project','command',?1)", [command(selection).to_string()]).unwrap();
    insert_destination(&conn, selection);
    conn
}
#[test]
fn v54_marker_preserves_receipt_bytes_and_fences_current_records() {
    for threshold in [None, Some(8192)] {
        let conn = fixture();
        let raw = request(threshold);
        conn.execute(
            "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
            [&raw],
        )
        .unwrap();
        assert!(decode::<TaskLaunchRequest>(&conn, Owner::Task, "request", "", &raw).is_err());
        capture_v54(&conn).unwrap();
        let (value, legacy) =
            decode::<TaskLaunchRequest>(&conn, Owner::Task, "request", "", &raw).unwrap();
        assert!(legacy);
        assert_eq!(
            value.model_selection.unwrap().compaction_threshold,
            threshold
        );
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT request_json FROM task_launches", [], |r| r
                .get(0))
                .unwrap(),
            raw
        );
        // Public/current DTO decoding never accepts the retired name.
        assert!(serde_json::from_str::<TaskLaunchRequest>(&raw).is_err());
        let modified = raw.replace(
            "literal orchestrator_compaction_threshold",
            "changed literal",
        );
        conn.execute(
            "UPDATE task_launches SET request_json=?1 WHERE request_id='request'",
            [&modified],
        )
        .unwrap();
        assert!(decode::<TaskLaunchRequest>(&conn, Owner::Task, "request", "", &modified).is_err());
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
    }
}
#[test]
fn v54_marker_survives_unrelated_progress_and_rejects_model_rebinding() {
    let conn = fixture();
    let raw = binding(&model(Some(42))).to_string();
    conn.execute(
        "INSERT INTO heartbeat_schedules(schedule_id,binding_json) VALUES('schedule',?1)",
        [&raw],
    )
    .unwrap();
    insert_destination(&conn, &model(Some(42)));
    capture_v54(&conn).unwrap();
    conn.execute(
        "UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._attention',1)",
        [],
    )
    .unwrap();
    let raw: String = conn
        .query_row("SELECT binding_json FROM heartbeat_schedules", [], |r| {
            r.get(0)
        })
        .unwrap();
    let (_, legacy): (serde_json::Value, bool) =
        decode(&conn, Owner::Schedule, "schedule", "", &raw).unwrap();
    assert!(legacy);
    conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$.fresh_task.model_selection.model','other')",[]).unwrap();
    let raw: String = conn
        .query_row("SELECT binding_json FROM heartbeat_schedules", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    // Generic Value is permissive; strict public typed decoders reject the key.
    assert!(decode::<TaskLaunchRequest>(&conn, Owner::Schedule, "schedule", "", &raw).is_err());
}

#[test]
fn binding_project_and_creator_changes_revoke_legacy_authority() {
    for path in ["$.project_id", "$.creator_session_id"] {
        let conn = fixture();
        let raw = binding(&model(Some(42))).to_string();
        conn.execute(
            "INSERT INTO heartbeat_schedules(schedule_id,binding_json) VALUES('schedule',?1)",
            [&raw],
        )
        .unwrap();
        insert_destination(&conn, &model(Some(42)));
        capture_v54(&conn).unwrap();
        conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,?1,'different') WHERE schedule_id='schedule'", [path]).unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0,
            "{path}"
        );
    }
}

#[test]
fn schedule_and_destination_mismatches_roll_back_markers_and_preserve_bytes() {
    let selection = model(Some(42));
    for mismatch in ["model", "creator", "missing"] {
        let conn = fixture();
        let schedule = binding(&selection).to_string();
        conn.execute(
            "INSERT INTO heartbeat_schedules(schedule_id,binding_json) VALUES('schedule',?1)",
            [&schedule],
        )
        .unwrap();
        if mismatch != "missing" {
            let selected = if mismatch == "model" {
                model(Some(43))
            } else {
                selection.clone()
            };
            let mut saved_binding = binding(&selected);
            if mismatch == "creator" {
                saved_binding["creator_session_id"] = serde_json::json!("creator");
            }
            let creator = if mismatch == "creator" {
                Some("creator")
            } else {
                None
            };
            conn.execute("INSERT INTO heartbeat_fresh_destinations(schedule_id,destination_json,binding_json,creator_session_id) VALUES('schedule',?1,?2,?3)", params![destination(&selected).to_string(),saved_binding.to_string(),creator]).unwrap();
        }
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(capture_v54(&conn).is_err(), "{mismatch}");
        conn.execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT binding_json FROM heartbeat_schedules",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            schedule
        );
    }
}

#[test]
fn related_schedule_and_destination_markers_revoke_together() {
    for mutation in [
        "UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$.fresh_task.retained_limit',3)",
        "UPDATE heartbeat_fresh_destinations SET destination_json=json_set(destination_json,'$.retained_limit',3)",
        "DELETE FROM heartbeat_fresh_destinations",
        "DELETE FROM heartbeat_schedules",
    ] {
        let conn = fixture();
        let selection = model(Some(42));
        conn.execute("INSERT INTO heartbeat_schedules(schedule_id,binding_json) VALUES('schedule',?1)", [binding(&selection).to_string()]).unwrap();
        insert_destination(&conn, &selection);
        capture_v54(&conn).unwrap();
        assert_eq!(conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r|r.get(0)).unwrap(), 3);
        conn.execute_batch(mutation).unwrap();
        assert_eq!(conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r|r.get(0)).unwrap(), 0, "{mutation}");
    }
}

#[test]
fn missing_v54_threshold_and_malformed_shapes_fail_but_absent_selections_survive() {
    for selection in [
        serde_json::json!({"backend":"openai-responses","model":"gpt","base_url":"https://example.invalid","allow_insecure_http":false,"api_key_env":null,"reasoning_effort":null,"extra_headers":null}),
        serde_json::json!("invalid"),
    ] {
        let conn = fixture();
        let mut input: serde_json::Value = serde_json::from_str(&request(None)).unwrap();
        input["model_selection"] = selection;
        let raw = input.to_string();
        conn.execute(
            "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
            [&raw],
        )
        .unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(capture_v54(&conn).is_err());
        conn.execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT request_json FROM task_launches", [], |r| r
                .get(0))
                .unwrap(),
            raw
        );
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
    }
    for absent in [true, false] {
        let conn = fixture();
        let mut input: serde_json::Value = serde_json::from_str(&request(None)).unwrap();
        if absent {
            input.as_object_mut().unwrap().remove("model_selection");
        } else {
            input["model_selection"] = serde_json::Value::Null;
        }
        let raw = input.to_string();
        conn.execute(
            "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
            [&raw],
        )
        .unwrap();
        capture_v54(&conn).unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT request_json FROM task_launches", [], |r| r
                .get(0))
                .unwrap(),
            raw
        );
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
    }
}

#[test]
fn every_durable_model_path_requires_its_v54_threshold() {
    for (table, column, path) in [
        (
            "task_launches",
            "request_json",
            "$.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "native_task_launches",
            "request_json",
            "$._nac_model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_schedules",
            "binding_json",
            "$.fresh_task.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_fresh_destinations",
            "destination_json",
            "$.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_fresh_destinations",
            "binding_json",
            "$.fresh_task.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_task_launches",
            "launch_json",
            "$.receipt.request.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_task_launches",
            "launch_json",
            "$.receipt.destination.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_task_launches",
            "launch_json",
            "$.receipt.binding.fresh_task.model_selection.orchestrator_compaction_threshold",
        ),
        (
            "heartbeat_commands",
            "response_json",
            "$.schedule.binding.fresh_task.model_selection.orchestrator_compaction_threshold",
        ),
    ] {
        let conn = all_owner_fixture(&model(Some(42)));
        conn.execute(
            &format!("UPDATE {table} SET {column}=json_remove({column},?1)"),
            [path],
        )
        .unwrap();
        let before: String = conn
            .query_row(&format!("SELECT {column} FROM {table}"), [], |r| r.get(0))
            .unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(capture_v54(&conn).is_err(), "{table} {path}");
        conn.execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row::<String, _, _>(&format!("SELECT {column} FROM {table}"), [], |r| r
                .get(0))
                .unwrap(),
            before
        );
    }
}

#[test]
fn null_legacy_selections_across_all_owners_remain_unmarked() {
    let conn = all_owner_fixture(&serde_json::Value::Null);
    capture_v54(&conn).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
}
#[test]
fn duplicate_keys_collisions_and_invalid_legacy_shapes_fail_closed() {
    let conn = fixture();
    let both = request(None).replace(
        "\"orchestrator_compaction_threshold\":null",
        "\"orchestrator_compaction_threshold\":null,\"compaction_threshold\":null",
    );
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [&both],
    )
    .unwrap();
    assert!(capture_v54(&conn).is_err());
    let duplicate = request(None).replace(
        "\"orchestrator_compaction_threshold\":null",
        "\"orchestrator_compaction_threshold\":null,\"orchestrator_compaction_threshold\":3",
    );
    conn.execute("UPDATE task_launches SET request_json=?1", [&duplicate])
        .unwrap();
    assert!(capture_v54(&conn).is_err());
    let invalid = request(None).replace(
        "\"orchestrator_compaction_threshold\":null",
        "\"orchestrator_compaction_threshold\":\"bad\"",
    );
    conn.execute("UPDATE task_launches SET request_json=?1", [&invalid])
        .unwrap();
    assert!(capture_v54(&conn).is_err());
}

#[test]
fn legacy_receipt_identity_and_scheduled_model_copies_must_agree() {
    let conn = fixture();
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('other',?1)",
        [request(None)],
    )
    .unwrap();
    assert!(capture_v54(&conn).is_err());
    conn.execute("DELETE FROM task_launches", []).unwrap();
    let mut launch_value = launch(&model(None));
    *launch_value
        .pointer_mut("/receipt/request/model_selection")
        .unwrap() = model(None);
    *launch_value
        .pointer_mut("/receipt/destination/model_selection")
        .unwrap() = model(Some(7));
    let launch = launch_value.to_string();
    conn.execute(
        "INSERT INTO heartbeat_task_launches(occurrence_id,launch_json) VALUES('occurrence',?1)",
        [launch],
    )
    .unwrap();
    assert!(capture_v54(&conn).is_err());
    conn.execute("DELETE FROM heartbeat_task_launches", [])
        .unwrap();
    let mut current = model(None);
    current.as_object_mut().unwrap().remove(OLD);
    current
        .as_object_mut()
        .unwrap()
        .insert(NEW.into(), serde_json::Value::Null);
    *launch_value
        .pointer_mut("/receipt/destination/model_selection")
        .unwrap() = current;
    let mixed = launch_value.to_string();
    conn.execute(
        "INSERT INTO heartbeat_task_launches(occurrence_id,launch_json) VALUES('occurrence',?1)",
        [mixed],
    )
    .unwrap();
    assert!(capture_v54(&conn).is_err());
}

#[test]
fn malformed_later_evidence_rolls_back_all_prior_marks() {
    let conn = fixture();
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [request(Some(8192))],
    )
    .unwrap();
    let invalid = request(None)
        .replace("\"model_selection\":", "\"_nac_model_selection\":")
        .replace(
            "\"orchestrator_compaction_threshold\":null",
            "\"orchestrator_compaction_threshold\":\"bad\"",
        );
    conn.execute(
        "INSERT INTO native_task_launches(request_id,request_json) VALUES('bad',?1)",
        [invalid],
    )
    .unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert!(capture_v54(&conn).is_err());
    conn.execute_batch("ROLLBACK").unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM task_model_v54_provenance",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn unrelated_malformed_required_field_aborts_and_rolls_back() {
    let conn = fixture();
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [request(None)],
    )
    .unwrap();
    let malformed = serde_json::json!({"request_id":"native","project_id":null,"title":42,"prompt":"prompt","_nac_model_selection":model(None)}).to_string();
    conn.execute(
        "INSERT INTO native_task_launches(request_id,request_json) VALUES('native',?1)",
        [&malformed],
    )
    .unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let error = capture_v54(&conn).unwrap_err();
    assert!(format!("{error:#}").contains("malformed legacy task receipt"));
    conn.execute_batch("ROLLBACK").unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row::<String, _, _>("SELECT request_json FROM native_task_launches", [], |r| r
            .get(0))
            .unwrap(),
        malformed
    );
}

#[test]
fn contradictory_row_owners_abort_without_persisting_any_markers() {
    let selection = model(Some(42));
    let binding = binding(&selection);
    let receipt = launch(&selection);
    let command = command(&selection);
    for (sql, raw) in [
        ("INSERT INTO task_launches(request_id,request_json,project_id) VALUES('request',?1,'other')", request(None)),
        ("INSERT INTO native_task_launches(request_id,request_json,project_id) VALUES('request',?1,'other')", request(None).replace("\"model_selection\":", "\"_nac_model_selection\":")),
        ("INSERT INTO heartbeat_schedules(schedule_id,binding_json,session_id) VALUES('schedule',?1,'unexpected')", binding.to_string()),
        ("INSERT INTO heartbeat_task_launches(occurrence_id,launch_json,schedule_id,request_id,project_id,session_id) VALUES('occurrence',?1,'other','request','project','session')", receipt.to_string()),
        ("INSERT INTO heartbeat_task_launches(occurrence_id,launch_json,schedule_id,request_id,project_id,session_id) VALUES('occurrence',?1,'schedule','other','project','session')", receipt.to_string()),
        ("INSERT INTO heartbeat_task_launches(occurrence_id,launch_json,schedule_id,request_id,project_id,session_id) VALUES('occurrence',?1,'schedule','request','other','session')", receipt.to_string()),
        ("INSERT INTO heartbeat_task_launches(occurrence_id,launch_json,schedule_id,request_id,project_id,session_id) VALUES('occurrence',?1,'schedule','request','project','other')", receipt.to_string()),
        ("INSERT INTO heartbeat_commands(session_id,request_id,response_json,schedule_id) VALUES('project:project','command',?1,'other')", command.to_string()),
        ("INSERT INTO heartbeat_commands(session_id,request_id,response_json,schedule_id) VALUES('project:other','command',?1,'schedule')", command.to_string()),
        ("INSERT INTO heartbeat_fresh_destinations(schedule_id,destination_json,binding_json,project_id) VALUES('schedule',?1,?1,'other')", destination(&selection).to_string()),
        ("INSERT INTO heartbeat_fresh_destinations(schedule_id,destination_json,binding_json,project_id,creator_session_id) VALUES('schedule','{}',?1,'project','other')", binding.to_string()),
    ] {
        let conn = fixture();
        conn.execute(sql, [&raw]).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(capture_v54(&conn).is_err(), "{sql}");
        conn.execute_batch("ROLLBACK").unwrap();
        assert_eq!(conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r|r.get(0)).unwrap(), 0);
    }
}

#[test]
fn fresh_command_scope_and_complete_launch_bindings_fail_atomically() {
    let selection = model(Some(42));
    for (path, replacement) in [
        (
            "/receipt/binding/fresh_task/retained_limit",
            serde_json::json!(3),
        ),
        (
            "/receipt/request/git_ref",
            serde_json::json!("unexpected-ref"),
        ),
        (
            "/receipt/request/default_ref",
            serde_json::json!("unexpected-default"),
        ),
        (
            "/receipt/request/invoking_session_id",
            serde_json::json!("unexpected-caller"),
        ),
    ] {
        let conn = fixture();
        let prior = request(None);
        conn.execute(
            "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
            [&prior],
        )
        .unwrap();
        let mut payload = launch(&selection);
        *payload.pointer_mut(path).unwrap() = replacement;
        let raw = payload.to_string();
        conn.execute("INSERT INTO heartbeat_task_launches(occurrence_id,launch_json) VALUES('occurrence',?1)", [&raw]).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(capture_v54(&conn).is_err(), "{path}");
        conn.execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT launch_json FROM heartbeat_task_launches",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            raw
        );
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT request_json FROM task_launches", [], |r| r
                .get(0))
                .unwrap(),
            prior
        );
    }
    let conn = fixture();
    let prior = request(None);
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [&prior],
    )
    .unwrap();
    let raw = command(&selection).to_string();
    conn.execute("INSERT INTO heartbeat_commands(session_id,request_id,response_json) VALUES('caller','command',?1)", [&raw]).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert!(capture_v54(&conn).is_err());
    conn.execute_batch("ROLLBACK").unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row::<String, _, _>("SELECT response_json FROM heartbeat_commands", [], |r| r
            .get(0))
            .unwrap(),
        raw
    );
}

#[test]
fn modifying_owner_revokes_marker_without_rewriting_receipt() {
    let conn = fixture();
    let raw = request(None);
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [&raw],
    )
    .unwrap();
    capture_v54(&conn).unwrap();
    conn.execute(
        "UPDATE task_launches SET project_id='other' WHERE request_id='request'",
        [],
    )
    .unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row::<String, _, _>("SELECT request_json FROM task_launches", [], |r| r.get(0))
            .unwrap(),
        raw
    );
}

#[test]
fn matching_owners_and_nullable_legacy_identities_are_accepted() {
    let selection = model(Some(42));
    let binding = binding(&selection);
    let receipt = launch(&selection);
    let command = command(&selection);
    let native = serde_json::json!({"request_id":"native","project_id":null,"title":"title","prompt":"prompt","_nac_model_selection":selection});
    let destination = destination(&selection);
    let conn = fixture();
    conn.execute(
        "INSERT INTO task_launches(request_id,request_json) VALUES('request',?1)",
        [request(None)],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO native_task_launches(request_id,request_json) VALUES('native',?1)",
        [native.to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO heartbeat_schedules(schedule_id,binding_json) VALUES('schedule',?1)",
        [binding.to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO heartbeat_task_launches(occurrence_id,launch_json) VALUES('occurrence',?1)",
        [receipt.to_string()],
    )
    .unwrap();
    conn.execute("INSERT INTO heartbeat_commands(session_id,request_id,response_json) VALUES('project:project','command',?1)", [command.to_string()]).unwrap();
    conn.execute("INSERT INTO heartbeat_fresh_destinations(schedule_id,destination_json,binding_json) VALUES('schedule',?1,?2)", params![destination.to_string(),binding.to_string()]).unwrap();
    capture_v54(&conn).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        7
    );
    // Identity mutation must revoke, rather than transfer, old authority.
    conn.execute_batch(
        "UPDATE task_launches SET project_id='other';
        UPDATE native_task_launches SET caller_session_id='other';
        UPDATE heartbeat_schedules SET session_id='other';
        UPDATE heartbeat_task_launches SET schedule_id='other';
        UPDATE heartbeat_commands SET schedule_id='other';
        UPDATE heartbeat_fresh_destinations SET creator_session_id='other';",
    )
    .unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM task_model_v54_provenance", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
}
