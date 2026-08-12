use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn now_utc_seconds() -> String {
    format_utc_seconds(SystemTime::now())
}

pub(crate) fn now_utc_nanoseconds() -> String {
    format_utc_nanoseconds(SystemTime::now())
}

pub(crate) fn format_unix_utc(seconds: u64) -> String {
    let (date, time) = utc_parts(seconds);
    format!("{date}T{time}Z")
}

fn format_utc_seconds(time: SystemTime) -> String {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let (date, time) = utc_parts(duration.as_secs());
    format!("{date} {time}")
}

fn format_utc_nanoseconds(time: SystemTime) -> String {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let (date, time) = utc_parts(duration.as_secs());
    format!("{date} {time}.{:09}", duration.subsec_nanos())
}

fn utc_parts(seconds: u64) -> (String, String) {
    let days = (seconds / 86_400) as i64;
    let remainder = seconds % 86_400;
    let (hour, minute, second) = (remainder / 3_600, (remainder % 3_600) / 60, remainder % 60);

    // Howard Hinnant's civil-from-days algorithm.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    let year = if month <= 2 { year + 1 } else { year };

    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!("{hour:02}:{minute:02}:{second:02}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_epoch_with_exact_precision() {
        assert_eq!(format_utc_seconds(UNIX_EPOCH), "1970-01-01 00:00:00");
        assert_eq!(
            format_utc_nanoseconds(UNIX_EPOCH + Duration::from_nanos(42)),
            "1970-01-01 00:00:00.000000042"
        );
        assert_eq!(format_unix_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn formats_day_boundary() {
        let last_second = UNIX_EPOCH + Duration::from_secs(86_399);
        let next_day = UNIX_EPOCH + Duration::from_secs(86_400);
        assert_eq!(format_utc_seconds(last_second), "1970-01-01 23:59:59");
        assert_eq!(format_utc_seconds(next_day), "1970-01-02 00:00:00");
    }

    #[test]
    fn handles_leap_century_rules() {
        assert_eq!(format_unix_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(format_unix_utc(4_107_542_400), "2100-03-01T00:00:00Z");
    }

    #[test]
    fn clamps_pre_epoch_times() {
        let before_epoch = UNIX_EPOCH - Duration::from_nanos(1);
        assert_eq!(format_utc_seconds(before_epoch), "1970-01-01 00:00:00");
        assert_eq!(
            format_utc_nanoseconds(before_epoch),
            "1970-01-01 00:00:00.000000000"
        );
    }
}
