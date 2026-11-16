use super::*;

fn ms(text: &str) -> i64 {
    text.parse::<Timestamp>().unwrap().as_millisecond()
}
fn daily(zone: &str, hour: u8, minute: u8) -> CalendarCadence {
    CalendarCadence::new(zone, DATA_VERSION, Weekdays::daily(), hour, minute).unwrap()
}
fn assert_next(c: &CalendarCadence, now: &str, retained: Option<&str>, expected: &str) {
    let next = c.next(ms(now), retained.map(ms)).unwrap();
    assert_eq!(next.due_ms, ms(expected));
}

#[test]
fn la_gap_is_skipped_instead_of_shifted() {
    // IANA US: second Sunday in March at02:00 jumps to03:00. March8,2026
    // 02:30 does not exist; March9,02:30 PDT is09:30Z.
    assert_next(
        &daily("America/Los_Angeles", 2, 30),
        "2026-03-08T00:00:00Z",
        None,
        "2026-03-09T09:30:00Z",
    );
}

#[test]
fn la_fold_earliest_once_even_after_restart_or_clock_regression() {
    let c = daily("America/Los_Angeles", 1, 30);
    // November1,01:30 PDT=08:30Z; repeated PST side09:30Z is never a candidate.
    assert_next(&c, "2026-11-01T07:00:00Z", None, "2026-11-01T08:30:00Z");
    assert_next(&c, "2026-11-01T08:31:00Z", None, "2026-11-02T09:30:00Z");
    assert_next(
        &c,
        "2026-11-01T09:00:00Z",
        Some("2026-11-01T08:30:00Z"),
        "2026-11-02T09:30:00Z",
    );
    assert_next(
        &c,
        "2026-11-01T07:00:00Z",
        Some("2026-11-01T08:30:00Z"),
        "2026-11-02T09:30:00Z",
    );
}

#[test]
fn selected_weekdays_and_weekly_follow_local_dates_across_dst() {
    let c = CalendarCadence::new(
        "America/Los_Angeles",
        DATA_VERSION,
        Weekdays::selected(&[1, 2, 3, 4, 5]).unwrap(),
        9,
        0,
    )
    .unwrap();
    // Friday09:00 PST=17Z, Monday09:00 PDT=16Z; weekend skipped.
    assert_next(&c, "2026-03-06T17:00:00Z", None, "2026-03-09T16:00:00Z");
    let weekly = CalendarCadence::new(
        "America/Los_Angeles",
        DATA_VERSION,
        Weekdays::selected(&[7]).unwrap(),
        2,
        30,
    )
    .unwrap();
    // Weekly March8 gap is skipped altogether, not deferred toMonday.
    assert_next(
        &weekly,
        "2026-03-08T00:00:00Z",
        None,
        "2026-03-15T09:30:00Z",
    );
}

#[test]
fn lord_howe_half_hour_fold_and_gap() {
    // Lord Howe's +11→+10:30 fold repeats01:30..01:59, not an hour.
    let fold = daily("Australia/Lord_Howe", 1, 45);
    assert_next(&fold, "2026-04-04T13:00:00Z", None, "2026-04-04T14:45:00Z");
    assert_next(
        &fold,
        "2026-04-04T15:00:00Z",
        Some("2026-04-04T14:45:00Z"),
        "2026-04-05T15:15:00Z",
    );
    // October4,02:15 is in the half-hour gap. October5 is+11, hence15:15Z.
    assert_next(
        &daily("Australia/Lord_Howe", 2, 15),
        "2026-10-03T14:00:00Z",
        None,
        "2026-10-04T15:15:00Z",
    );
}

#[test]
fn nonseasonal_zone_leap_day_and_year_boundary() {
    let c = daily("Asia/Kolkata", 9, 0); // Fixed+05:30 throughout these dates.
    assert_next(&c, "2028-02-28T04:00:00Z", None, "2028-02-29T03:30:00Z");
    assert_next(&c, "2026-12-31T04:00:00Z", None, "2027-01-01T03:30:00Z");
}

#[test]
fn havana_2026f_stays_at_minus_four_in_november() {
    // Official2026f NEWS removes Cuba's November1 fallback. Stale2026e would
    // return14:00Z for09:00; pinned2026f must return13:00Z.
    assert_next(
        &daily("America/Havana", 9, 0),
        "2026-11-01T00:00:00Z",
        None,
        "2026-11-01T13:00:00Z",
    );
}

#[test]
fn unknown_zone_version_and_invalid_rules_fail_explicitly() {
    for zone in [
        "",
        "Mars/Base",
        "../../etc/localtime",
        "Factory",
        "america/los_angeles",
    ] {
        assert!(
            CalendarCadence::new(zone, DATA_VERSION, Weekdays::daily(), 9, 0).is_err(),
            "{zone}"
        );
    }
    assert!(CalendarCadence::new("Etc/UTC", "2026e", Weekdays::daily(), 9, 0).is_err());
    for days in [&[][..], &[0], &[8], &[1, 1]] {
        assert!(Weekdays::selected(days).is_err());
    }
    assert!(CalendarCadence::new("Etc/UTC", DATA_VERSION, Weekdays::daily(), 24, 0).is_err());
    assert!(CalendarCadence::new("Etc/UTC", DATA_VERSION, Weekdays::daily(), 9, 60).is_err());
    assert!(daily("Etc/UTC", 9, 0).next(i64::MAX, None).is_err());
}

#[test]
fn preview_is_bounded_monotonic_and_aliases_use_same_pinned_data() {
    let c = daily("America/Los_Angeles", 1, 30);
    assert!(c.preview(ms("2026-10-31T00:00:00Z"), None, 0).is_err());
    assert!(c.preview(ms("2026-10-31T00:00:00Z"), None, 17).is_err());
    let values = c.preview(ms("2026-10-31T00:00:00Z"), None, 16).unwrap();
    assert_eq!(values.len(), 16);
    assert!(values.windows(2).all(|p| p[0].due_ms < p[1].due_ms));
    let alias = daily("US/Pacific", 1, 30);
    assert_eq!(
        values,
        alias.preview(ms("2026-10-31T00:00:00Z"), None, 16).unwrap()
    );
}

#[test]
fn all_generated_zone_names_parse_from_embedded_tzif() {
    let mut previous = "";
    for line in include_str!("data/index.tsv").lines() {
        let name = line.split('\t').next().unwrap();
        assert!(name > previous, "name index must be unique and sorted");
        assert!(zones::load(name, DATA_VERSION).is_ok(), "{name}");
        previous = name;
    }
}

#[test]
fn generated_data_manifest_matches_embedded_originals() {
    use sha2::{Digest, Sha256};
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("data/manifest.json")).unwrap();
    assert_eq!(manifest["version"], DATA_VERSION);
    let files: [(&str, &[u8]); 4] = [
        ("index.tsv", include_bytes!("data/index.tsv")),
        ("zones.bin", include_bytes!("data/zones.bin")),
        ("LICENSE", include_bytes!("data/LICENSE")),
        ("NOTICE", include_bytes!("data/NOTICE")),
    ];
    for (name, data) in files {
        assert_eq!(
            manifest["files"][name]["bytes"],
            data.len() as u64,
            "{name}"
        );
        assert_eq!(
            manifest["files"][name]["sha256"],
            format!("{:x}", Sha256::digest(data)),
            "{name}"
        );
    }
    assert_eq!(
        manifest["names"],
        include_str!("data/index.tsv").lines().count() as u64
    );
}
