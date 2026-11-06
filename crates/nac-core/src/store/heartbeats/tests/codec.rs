use super::*;

// Exact canonical bytes from the interval-only model at accepted58f. This is
// deliberately independent of the new serializer and includes its field order.
const LEGACY_SPEC: &str = r#"{"name":"Job check","instructions":"Check the authorized Local job result.","skills":["verification"],"interval_ms":60000,"end_condition":"Finish when the result is ready.","goal_id":null,"execution_timeout_ms":300000,"max_occurrences":1000,"token_allowance":null}"#;

fn calendar_spec() -> HeartbeatSpec {
    let mut spec = spec();
    spec.cadence = HeartbeatCadence::Calendar(HeartbeatCalendarRule {
        zone: "America/Los_Angeles".into(),
        data_version: "2026f".into(),
        hour: 9,
        minute: 0,
        days: HeartbeatCalendarDays::Weekdays {
            days: vec![1, 2, 3, 4, 5],
        },
    });
    spec
}

#[test]
fn legacy_spec_and_every_control_keep_exact_canonical_bytes() {
    assert_eq!(encode(&spec()).unwrap(), LEGACY_SPEC);
    assert_eq!(
        serde_json::from_str::<HeartbeatSpec>(LEGACY_SPEC).unwrap(),
        spec()
    );
    let create = format!(r#"{{"action":"create","spec":{LEGACY_SPEC}}}"#);
    let edit = format!(
        r#"{{"action":"edit","schedule_id":"schedule","expected_version":7,"spec":{LEGACY_SPEC}}}"#
    );
    for canonical in [
        create,
        edit,
        r#"{"action":"pause","schedule_id":"schedule","expected_version":7}"#.into(),
        r#"{"action":"resume","schedule_id":"schedule","expected_version":7}"#.into(),
        r#"{"action":"stop","schedule_id":"schedule","expected_version":7}"#.into(),
        r#"{"action":"delete","schedule_id":"schedule","expected_version":7}"#.into(),
        r#"{"action":"run_now","schedule_id":"schedule","expected_version":7}"#.into(),
    ] {
        let action: HeartbeatAction = serde_json::from_str(&canonical).unwrap();
        assert_eq!(encode(&action).unwrap(), canonical);
        assert_eq!(
            Sha256::digest(encode(&action).unwrap().as_bytes()),
            Sha256::digest(canonical.as_bytes())
        );
    }
    // Historical optional/default fields normalize exactly as the old model.
    let minimal = r#"{"name":"Job check","instructions":"Check the authorized Local job result.","interval_ms":60000,"end_condition":"Finish when the result is ready."}"#;
    let decoded: HeartbeatSpec = serde_json::from_str(minimal).unwrap();
    assert_eq!(decoded.skills, Vec::<String>::new());
    assert_eq!(decoded.execution_timeout_ms, 300_000);
    assert_eq!(decoded.max_occurrences, 1_000);
    assert!(!encode(&decoded).unwrap().contains("calendar"));
}

#[test]
fn canonical_calendar_has_no_interval_and_strict_zone_rule_and_version_validation() {
    let spec = calendar_spec();
    spec.validate().unwrap();
    let json = encode(&spec).unwrap();
    assert!(!json.contains("interval_ms"));
    assert!(json.contains(r#""calendar":{"zone":"America/Los_Angeles","data_version":"2026f""#));
    assert_eq!(serde_json::from_str::<HeartbeatSpec>(&json).unwrap(), spec);
    for extra in [r#", "interval_ms":60000"#, r#", "unknown":true"#] {
        let invalid = format!("{}{extra}}}", &json[..json.len() - 1]);
        assert!(serde_json::from_str::<HeartbeatSpec>(&invalid).is_err());
    }
    assert!(serde_json::from_str::<HeartbeatSpec>(
        &LEGACY_SPEC.replace(r#""interval_ms":60000,"#, "")
    )
    .is_err());
    for (from, to) in [
        ("America/Los_Angeles", "Unknown/Zone"),
        ("2026f", "2026e"),
        (r#""hour":9"#, r#""hour":24"#),
        (r#""minute":0"#, r#""minute":60"#),
        (r#""kind":"weekdays""#, r#""kind":"monthly""#),
        ("[1,2,3,4,5]", "[1,1]"),
        ("[1,2,3,4,5]", "[0]"),
        ("[1,2,3,4,5]", "[]"),
    ] {
        let invalid = json.replace(from, to);
        assert!(
            serde_json::from_str::<HeartbeatSpec>(&invalid)
                .and_then(|spec| spec.validate().map_err(serde::de::Error::custom))
                .is_err(),
            "accepted {invalid}"
        );
    }
}

#[test]
fn selected_weekday_order_is_canonical_without_losing_duplicate_validation() {
    let canonical = encode(&calendar_spec()).unwrap();
    let shuffled = canonical.replace("[1,2,3,4,5]", "[5,1,4,2,3]");
    let decoded: HeartbeatSpec = serde_json::from_str(&shuffled).unwrap();
    decoded.validate().unwrap();
    assert_eq!(encode(&decoded).unwrap(), canonical);
    assert_eq!(decoded, calendar_spec());
    let duplicate = canonical.replace("[1,2,3,4,5]", "[1,1]");
    assert!(serde_json::from_str::<HeartbeatSpec>(&duplicate).is_err());
}

#[test]
fn legacy_retained_request_replays_original_bytes_after_reopen_and_delete() {
    let f = Fixture::new();
    let key = uuid::Uuid::new_v4().to_string();
    let action: HeartbeatAction =
        serde_json::from_str(&format!(r#"{{"action":"create","spec":{LEGACY_SPEC}}}"#)).unwrap();
    let receipt = control_heartbeat(
        &f.path,
        "direct",
        &key,
        &action,
        "Original human interval request",
        f.binding(),
        1_000,
    )
    .unwrap();
    let canonical = format!(r#"{{"action":"create","spec":{LEGACY_SPEC}}}"#);
    let old_digest = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    let original_response = encode(&receipt).unwrap();
    {
        let conn = open_runtime_connection(&f.path).unwrap();
        // Model the preexisting typed writer, retaining its actual bytes and
        // digest, rather than recomputing them during startup/migration.
        conn.execute(
            "UPDATE heartbeat_schedules SET specification_json=?1 WHERE schedule_id=?2",
            params![LEGACY_SPEC, receipt.schedule.schedule_id],
        )
        .unwrap();
        conn.execute("UPDATE heartbeat_commands SET canonical_digest=?1,response_json=?2 WHERE request_id=?3",params![old_digest,original_response,key]).unwrap();
    }
    initialize(&f.path).unwrap();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let active = f.admit(&pending, 61_000);
    f.control(
        HeartbeatAction::Delete {
            schedule_id: receipt.schedule.schedule_id.clone(),
            expected_version: 1,
        },
        62_000,
    );
    initialize(&f.path).unwrap();
    let replay = control_heartbeat(
        &f.path,
        "direct",
        &key,
        &action,
        "Later different request",
        f.binding(),
        90_000,
    )
    .unwrap();
    assert_eq!(encode(&replay).unwrap(), original_response);
    assert_eq!(
        heartbeat_history(&f.path, "direct", &receipt.schedule.schedule_id).unwrap()[0].spec,
        spec()
    );
    assert_eq!(
        heartbeat_for_run(&f.path, "direct", active.run_id.as_ref().unwrap())
            .unwrap()
            .unwrap()
            .occurrence_id,
        active.occurrence_id
    );
    let conn = open_runtime_connection(&f.path).unwrap();
    assert_eq!(
        conn.query_row::<(String, String), _, _>(
            "SELECT canonical_digest,response_json FROM heartbeat_commands WHERE request_id=?1",
            [key],
            |row| Ok((row.get(0)?, row.get(1)?))
        )
        .unwrap(),
        (old_digest, original_response)
    );
}

#[test]
fn calendar_durable_controls_use_real_private50_format_and_retain_explicit_rule() {
    let f = Fixture::new();
    assert_eq!(schema_version(), 50);
    let now = "2026-11-02T12:00:00Z"
        .parse::<jiff::Timestamp>()
        .unwrap()
        .as_millisecond();
    let created = f
        .control(
            HeartbeatAction::Create {
                spec: calendar_spec(),
            },
            now,
        )
        .schedule;
    assert_eq!(created.spec, calendar_spec());
    assert_eq!(
        created.next_due_ms,
        "2026-11-02T17:00:00Z"
            .parse::<jiff::Timestamp>()
            .unwrap()
            .as_millisecond()
    );
    let conn = open_runtime_connection(&f.path).unwrap();
    let raw: String = conn
        .query_row(
            "SELECT specification_json FROM heartbeat_schedules WHERE schedule_id=?1",
            [&created.schedule_id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!raw.contains("interval_ms"));
    assert!(raw.contains("2026f") && raw.contains("America/Los_Angeles"));
}
