use super::*;
fn ms(text: &str) -> i64 {
    text.parse::<jiff::Timestamp>().unwrap().as_millisecond()
}
fn rule(zone: &str, hour: u8, minute: u8) -> HeartbeatCalendarRule {
    HeartbeatCalendarRule {
        zone: zone.into(),
        data_version: "2026f".into(),
        hour,
        minute,
        days: HeartbeatCalendarDays::Daily,
    }
}

#[test]
fn retained_next_due_is_kept_when_future_and_paused_time_is_skipped() {
    let cadence = HeartbeatCadence::Calendar(rule("America/Los_Angeles", 1, 30));
    let before = ms("2026-11-01T07:00:00Z");
    assert_eq!(
        cadence.future_due(before, before, None).unwrap(),
        ms("2026-11-01T08:30:00Z")
    );
    let next = ms("2026-11-02T09:30:00Z");
    assert_eq!(
        cadence.future_due(before, before, Some(next)).unwrap(),
        next,
        "backward clock keeps durable next point; it must not skip it as a last-processed cursor"
    );
    assert_eq!(
        cadence
            .future_due(
                before,
                ms("2026-11-01T09:30:00Z"),
                Some(ms("2026-11-01T08:30:00Z"))
            )
            .unwrap(),
        next,
        "resume skips paused earlier/later fold instead of catchup"
    );
    let interval = HeartbeatCadence::Interval {
        interval_ms: 60_000,
    };
    assert_eq!(interval.future_due(1_000, 1_000, None).unwrap(), 61_000);
    assert_eq!(
        interval.future_due(1_000, 241_000, Some(61_000)).unwrap(),
        301_000
    );
    assert_eq!(
        interval.future_due(1_000, 1_000, Some(301_000)).unwrap(),
        301_000
    );
}

#[test]
fn preview_carries_stored_rule_and_both_utc_and_pinned_local_time() {
    let rule = rule("America/Havana", 9, 0);
    let before = ms("2026-11-01T00:00:00Z");
    let preview = rule.preview(before, None, 3).unwrap();
    assert_eq!(preview.calendar, rule);
    assert_eq!(preview.occurrences.len(), 3);
    assert_eq!(
        preview.occurrences[0],
        HeartbeatCalendarPreviewPoint {
            due_ms: ms("2026-11-01T13:00:00Z"),
            utc: "2026-11-01T13:00:00Z".into(),
            local: "2026-11-01T09:00:00".into()
        }
    );
    let retained = ms("2026-11-03T13:00:00Z");
    assert_eq!(
        rule.preview(before, Some(retained), 1).unwrap().occurrences[0].due_ms,
        retained
    );
    assert!(rule.preview(before, None, 0).is_err());
    assert!(rule.preview(before, None, 17).is_err());
    let mut unsupported = rule;
    unsupported.data_version = "2026e".into();
    assert!(unsupported.preview(before, None, 1).is_err());
}

#[test]
fn replacement_zone_or_time_selects_new_rule_without_an_elapsed_placeholder() {
    let now = ms("2026-11-02T12:00:00Z");
    let la = HeartbeatCadence::Calendar(rule("America/Los_Angeles", 9, 0));
    let ny = HeartbeatCadence::Calendar(rule("America/New_York", 9, 0));
    assert_eq!(
        la.future_due(now, now, None).unwrap(),
        ms("2026-11-02T17:00:00Z")
    );
    assert_eq!(
        ny.future_due(now, now, None).unwrap(),
        ms("2026-11-02T14:00:00Z")
    );
    let gap = HeartbeatCadence::Calendar(rule("America/Los_Angeles", 2, 30));
    let before = ms("2026-03-08T00:00:00Z");
    assert_eq!(
        gap.future_due(before, before, None).unwrap(),
        ms("2026-03-09T09:30:00Z")
    );
    assert!(la.future_due(-1, now, None).is_err());
}

#[test]
fn draft_resolves_current_version_but_stored_rule_never_defaults_and_overdue_preview_keeps_identity(
) {
    let draft:HeartbeatCalendarDraft=serde_json::from_value(serde_json::json!({"zone":"America/Los_Angeles","hour":1,"minute":30,"days":{"kind":"daily"}})).unwrap();
    let rule = draft.into_rule();
    assert_eq!(rule.data_version, "2026f");
    let mut stored = serde_json::to_value(&rule).unwrap();
    stored.as_object_mut().unwrap().remove("data_version");
    assert!(serde_json::from_value::<HeartbeatCalendarRule>(stored).is_err());
    let first = ms("2026-11-01T08:30:00Z");
    let preview = rule
        .preview(ms("2026-11-01T09:30:00Z"), Some(first), 3)
        .unwrap();
    assert_eq!(preview.next_due.unwrap().due_ms, first);
    assert_eq!(preview.occurrences[0].due_ms, ms("2026-11-02T09:30:00Z"));
}
