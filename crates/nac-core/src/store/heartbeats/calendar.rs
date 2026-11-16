//! Pure wall-clock calculation used by the existing-chat heartbeat cadence.
//! Durable control/admission and API/UI wiring live in the owning services.
//! No system clock, host timezone, database, scheduler or execution capability.
use anyhow::{ensure, Context, Result};
use jiff::{civil::Time, tz::AmbiguousOffset, Timestamp};

mod range;
#[cfg(test)]
mod range_tests;
#[cfg(test)]
mod tests;
mod zones;

pub(super) const DATA_VERSION: &str = "2026f";

// Private calculation limits, not persisted/API defaults. A failure is explicit;
// callers must never substitute the host zone or guess a due instant.
const MAX_SEARCH_DATES: usize = 366;
const MAX_PREVIEW: usize = 16;

/// Monday=1 through Sunday=7. A single selected day is weekly recurrence.
#[derive(Clone, Copy, Debug)]
pub(super) struct Weekdays(u8);

impl Weekdays {
    pub(super) fn daily() -> Self {
        Self(0x7f)
    }

    pub(super) fn selected(days: &[u8]) -> Result<Self> {
        ensure!(!days.is_empty() && days.len() <= 7, "select 1..=7 weekdays");
        let mut mask = 0;
        for &day in days {
            ensure!((1..=7).contains(&day), "weekday must be Monday=1..Sunday=7");
            let bit = 1 << (day - 1);
            ensure!(mask & bit == 0, "duplicate weekday");
            mask |= bit;
        }
        Ok(Self(mask))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CalendarOccurrence {
    pub(super) due_ms: i64,
    pub(super) local: jiff::civil::DateTime,
}

/// One catch-up range, not a queue of missed work. The existing materializer
/// will persist it with the schedule's version and immutable specification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CalendarMissedRange {
    pub(super) due_last_ms: i64,
    pub(super) count: i64,
    pub(super) next_due_ms: i64,
}

#[derive(Debug, Clone)]
pub(super) struct CalendarCadence {
    zone: jiff::tz::TimeZone,
    days: Weekdays,
    time: Time,
}

impl CalendarCadence {
    pub(super) fn new(
        zone: &str,
        data_version: &str,
        days: Weekdays,
        hour: u8,
        minute: u8,
    ) -> Result<Self> {
        ensure!(hour < 24 && minute < 60, "invalid local hour/minute");
        ensure!(days.0 != 0 && days.0 <= 0x7f, "invalid weekday mask");
        Ok(Self {
            zone: zones::load(zone, data_version)?,
            days,
            time: Time::new(hour as i8, minute as i8, 0, 0)?,
        })
    }

    /// Strictly after both now and the last retained canonical due instant.
    /// Recomputing after a backwards clock jump cannot select a second fold or
    /// replay an already retained occurrence. This does not itself persist IDs.
    pub(super) fn next(
        &self,
        now_ms: i64,
        retained_due_ms: Option<i64>,
    ) -> Result<CalendarOccurrence> {
        let cursor_ms = retained_due_ms.map_or(now_ms, |due| due.max(now_ms));
        let cursor = Timestamp::from_millisecond(cursor_ms)
            .context("calendar cursor is outside supported timestamp range")?;
        let mut date = self.zone.to_datetime(cursor).date();
        for _ in 0..MAX_SEARCH_DATES {
            let bit = 1 << date.weekday().to_monday_zero_offset();
            if self.days.0 & bit != 0 {
                let local = date.to_datetime(self.time);
                let ambiguous = self.zone.to_ambiguous_timestamp(local);
                // Jiff's compatible conversion would shift gaps; the selected
                // contract skips them. Only the earliest side of a fold exists
                // as a schedule candidate, even when that side is already past.
                if !matches!(ambiguous.offset(), AmbiguousOffset::Gap { .. }) {
                    let due = ambiguous
                        .earlier()
                        .context("calendar offset resolution failed")?;
                    if due > cursor {
                        return Ok(CalendarOccurrence {
                            due_ms: due.as_millisecond(),
                            local,
                        });
                    }
                }
            }
            date = date.tomorrow().context("calendar date range exhausted")?;
        }
        anyhow::bail!("calendar next-occurrence search bound exhausted")
    }

    pub(super) fn preview(
        &self,
        now_ms: i64,
        retained_due_ms: Option<i64>,
        count: usize,
    ) -> Result<Vec<CalendarOccurrence>> {
        ensure!(
            (1..=MAX_PREVIEW).contains(&count),
            "calendar preview requires 1..=16 entries"
        );
        let mut result = Vec::with_capacity(count);
        let mut cursor = retained_due_ms;
        for _ in 0..count {
            let next = self.next(now_ms, cursor)?;
            cursor = Some(next.due_ms);
            result.push(next);
        }
        Ok(result)
    }
}
