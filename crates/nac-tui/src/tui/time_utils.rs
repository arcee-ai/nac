use super::*;

pub(super) fn visible_restored_message_count(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| match message {
            Message::User { .. } => true,
            Message::Assistant {
                content,
                tool_calls,
                ..
            } => content.is_some() && tool_calls.as_ref().map_or(true, |tc| tc.is_empty()),
            _ => false,
        })
        .count()
}

pub(super) fn short_session(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

pub(super) fn short_clock(timestamp: &str) -> String {
    timestamp
        .rsplit_once(' ')
        .map(|(_, time)| time.to_string())
        .unwrap_or_else(|| fit_text(timestamp, 8))
}

pub(super) fn short_timestamp(timestamp: &str) -> String {
    fit_text(timestamp, 19)
}

pub(super) fn utc_hms() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let rem = d.as_secs() % 86_400;
    let hours = rem / 3_600;
    let minutes = (rem % 3_600) / 60;
    let seconds = rem % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

/// Returns current Unix timestamp in seconds, for numeric thread sorting.
pub(super) fn current_unix_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Parse a timestamp string (format: "YYYY-MM-DD HH:MM:SS") to Unix timestamp.
/// Returns None if parsing fails.
pub(super) fn parse_timestamp_to_unix(ts: &str) -> Option<u64> {
    let parts: Vec<&str> = ts.split_whitespace().collect();
    if parts.len() != 2 {
        return None;
    }

    let date_parts: Vec<&str> = parts[0].split('-').collect();
    let time_parts: Vec<&str> = parts[1].split(':').collect();

    if date_parts.len() != 3 || time_parts.len() != 3 {
        return None;
    }

    let year: u64 = date_parts[0].parse().ok()?;
    let month: u64 = date_parts[1].parse().ok()?;
    let day: u64 = date_parts[2].parse().ok()?;
    let hour: u64 = time_parts[0].parse().ok()?;
    let minute: u64 = time_parts[1].parse().ok()?;
    let second: u64 = time_parts[2].parse().ok()?;

    let mut days_since_epoch: u64 = 0;
    for y in 1970..year {
        days_since_epoch += if is_leap_year(y) { 366 } else { 365 };
    }

    let month_days = [
        31,
        if is_leap_year(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for m in 0..(month - 1) as usize {
        days_since_epoch += month_days[m];
    }
    days_since_epoch += day - 1;

    let secs_per_day: u64 = 86_400;
    let secs_of_day = hour * 3_600 + minute * 60 + second;

    Some(days_since_epoch * secs_per_day + secs_of_day)
}

pub(super) fn is_leap_year(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
