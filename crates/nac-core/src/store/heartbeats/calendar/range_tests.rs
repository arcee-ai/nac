use super::*;

fn ms(text: &str) -> i64 {
    text.parse::<Timestamp>().unwrap().as_millisecond()
}
fn daily(zone: &str, hour: u8, minute: u8) -> CalendarCadence {
    CalendarCadence::new(zone, DATA_VERSION, Weekdays::daily(), hour, minute).unwrap()
}

#[test]
fn missed_ranges_exclude_gaps_and_later_folds_with_explicit_utc_endpoints() {
    // UTC endpoints are fixed offset arithmetic, not a host timezone oracle.
    // LA gap skips March8; fold excludes09:30Z. Lord Howe shifts30minutes.
    // Apia skips a whole local date. Havana2026f has no November fallback.
    for (zone, hour, minute, first, now, last, count, next) in [
        // Newfoundland has a half-hour base offset and the same date rollback.
        (
            "America/St_Johns",
            0,
            0,
            "2009-11-01T02:30:00Z",
            "2009-11-01T03:00:00Z",
            "2009-11-01T02:30:00Z",
            1,
            "2009-11-02T03:30:00Z",
        ),
        // At 00:01 Goose Bay rolled from November1 back into October31.
        // The earliest November1 midnight has already happened at03:00Z.
        (
            "America/Goose_Bay",
            0,
            0,
            "2009-11-01T03:00:00Z",
            "2009-11-01T03:30:00Z",
            "2009-11-01T03:00:00Z",
            1,
            "2009-11-02T04:00:00Z",
        ),
        (
            "America/Goose_Bay",
            0,
            0,
            "2009-10-31T03:00:00Z",
            "2009-11-01T03:30:00Z",
            "2009-11-01T03:00:00Z",
            2,
            "2009-11-02T04:00:00Z",
        ),
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
        let range = daily(zone, hour, minute)
            .missed(ms(first), ms(now))
            .unwrap();
        assert_eq!(
            range,
            CalendarMissedRange {
                due_last_ms: ms(last),
                count,
                next_due_ms: ms(next)
            },
            "{zone}"
        );
    }
    let weekdays = CalendarCadence::new(
        "America/Los_Angeles",
        DATA_VERSION,
        Weekdays::selected(&[1, 2, 3, 4, 5]).unwrap(),
        9,
        0,
    )
    .unwrap();
    let range = weekdays
        .missed(ms("2026-03-06T17:00:00Z"), ms("2026-03-09T16:00:00Z"))
        .unwrap();
    assert_eq!(range.count, 2);
    assert_eq!(range.due_last_ms, ms("2026-03-09T16:00:00Z"));
    assert_eq!(range.next_due_ms, ms("2026-03-10T16:00:00Z"));
}

#[test]
fn arithmetic_range_agrees_with_bounded_successive_occurrence_oracle() {
    let start = ms("2025-01-01T00:00:00Z");
    let now = ms("2027-01-01T12:00:00Z");
    for zone in [
        "America/Los_Angeles",
        "Australia/Lord_Howe",
        "Pacific/Apia",
        "Asia/Kolkata",
        "America/Havana",
        "Pacific/Kwajalein",
        "Africa/Casablanca",
        "Antarctica/Troll",
        "Europe/Dublin",
        "Asia/Gaza",
        "America/Santiago",
        "Etc/UTC",
    ] {
        for days in [
            Weekdays::daily(),
            Weekdays::selected(&[1, 2, 3, 4, 5]).unwrap(),
            Weekdays::selected(&[7]).unwrap(),
        ] {
            for (hour, minute) in [(0, 0), (1, 45), (2, 30)] {
                let cadence = CalendarCadence::new(zone, DATA_VERSION, days, hour, minute).unwrap();
                let first = cadence.next(start, None).unwrap();
                let mut last = first.clone();
                let mut count = 1;
                let expected_next = loop {
                    assert!(count < 800, "oracle fixture itself must remain bounded");
                    let next = cadence.next(last.due_ms, None).unwrap();
                    if next.due_ms > now {
                        break next;
                    }
                    last = next;
                    count += 1;
                };
                assert_eq!(
                    cadence.missed(first.due_ms, now).unwrap(),
                    CalendarMissedRange {
                        due_last_ms: last.due_ms,
                        count,
                        next_due_ms: expected_next.due_ms
                    },
                    "{zone} {hour}:{minute}"
                );
            }
        }
    }
}

#[test]
fn huge_downtime_count_does_not_iterate_each_missed_date() {
    // 8000 Gregorian years are20 complete400-year cycles,146097days each.
    let utc = daily("Etc/UTC", 9, 0)
        .missed(ms("1970-01-01T09:00:00Z"), ms("9970-01-01T09:00:00Z"))
        .unwrap();
    assert_eq!(utc.count, 20 * 146_097 + 1);
    assert_eq!(utc.next_due_ms, ms("9970-01-02T09:00:00Z"));
    // Pinned LA rules skip one02:30 gap each year2000..9989:7990 skips.
    // Gregorian date difference is2,918,288 days (independent civil arithmetic).
    let la = daily("America/Los_Angeles", 2, 30)
        .missed(ms("2000-01-01T10:30:00Z"), ms("9990-01-01T10:30:00Z"))
        .unwrap();
    assert_eq!(la.count, 2_910_299);
    assert_eq!(la.next_due_ms, ms("9990-01-02T10:30:00Z"));
}

#[test]
fn invalid_or_noncanonical_retained_ranges_fail_instead_of_inventing_identity() {
    let la = daily("America/Los_Angeles", 1, 30);
    let first = ms("2026-11-01T08:30:00Z");
    assert!(la.missed(first, first - 1).is_err());
    assert!(la.missed(first + 1, first + 1).is_err());
    assert!(
        la.missed(ms("2026-11-01T09:30:00Z"), ms("2026-11-02T10:00:00Z"))
            .is_err(),
        "later fold is never a canonical first due"
    );
    assert!(la.missed(-1, first).is_err());
    assert!(la.missed(first, i64::MAX).is_err());
    assert_eq!(la.missed(first, first).unwrap().count, 1);
}

#[test]
fn cross_date_fold_keeps_the_canonical_sunday_in_a_weekly_range() {
    let cadence = CalendarCadence::new(
        "America/Goose_Bay",
        DATA_VERSION,
        Weekdays::selected(&[7]).unwrap(),
        0,
        0,
    )
    .unwrap();
    let range = cadence
        .missed(ms("2009-11-01T03:00:00Z"), ms("2009-11-01T03:30:00Z"))
        .unwrap();
    assert_eq!(
        range,
        CalendarMissedRange {
            due_last_ms: ms("2009-11-01T03:00:00Z"),
            count: 1,
            next_due_ms: ms("2009-11-08T04:00:00Z"),
        }
    );
}
