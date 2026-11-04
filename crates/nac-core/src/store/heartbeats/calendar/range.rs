//! Count a downtime range arithmetically, subtracting only missing wall times
//! at offset transitions. Work is bounded independently of missed occurrences.
use super::*;
use jiff::civil::{Date, DateTime};

const MAX_RANGE_TRANSITIONS: usize = 32_768;
// Jiff offsets are bounded to +/-25:59:59, so even their largest possible
// forward change spans fewer than four civil dates. Fail rather than truncate.
const MAX_GAP_DATES: usize = 4;

impl CalendarCadence {
    pub(in crate::store::heartbeats) fn missed(
        &self,
        first_ms: i64,
        now_ms: i64,
    ) -> Result<CalendarMissedRange> {
        ensure!(
            first_ms >= 0 && now_ms >= first_ms,
            "invalid calendar due range"
        );
        let first = Timestamp::from_millisecond(first_ms)?;
        let now = Timestamp::from_millisecond(now_ms)?;
        let first_local = self.zone.to_datetime(first);
        let canonical_first = self.on_date(first_local.date())?;
        ensure!(
            canonical_first
                .as_ref()
                .is_some_and(|point| point.due_ms == first_ms),
            "retained calendar due is not a canonical occurrence"
        );
        let last = self.latest(now)?;
        ensure!(last.due_ms >= first_ms, "calendar due range is reversed");
        let mut count = self.date_count(first_local.date(), last.local.date())?;
        for (index, transition) in self.zone.following(first).enumerate() {
            let at = transition.timestamp();
            if at.as_millisecond() > last.due_ms {
                break;
            }
            ensure!(
                index < MAX_RANGE_TRANSITIONS,
                "calendar transition search bound exhausted"
            );
            let before = at.checked_sub(jiff::SignedDuration::from_nanos(1))?;
            let gap_start = self.zone.to_offset(before).to_datetime(at);
            let gap_end = transition.offset().to_datetime(at);
            if gap_end > gap_start {
                count = count
                    .checked_sub(self.missing_in_gap(
                        gap_start,
                        gap_end,
                        first_local,
                        last.local,
                    )?)
                    .context("calendar missed-count overflow")?;
            }
        }
        ensure!(count > 0, "calendar missed count is empty");
        Ok(CalendarMissedRange {
            due_last_ms: last.due_ms,
            count,
            next_due_ms: self.next(now_ms, Some(last.due_ms))?.due_ms,
        })
    }

    fn on_date(&self, date: Date) -> Result<Option<CalendarOccurrence>> {
        if self.days.0 & (1 << date.weekday().to_monday_zero_offset()) == 0 {
            return Ok(None);
        }
        let local = date.to_datetime(self.time);
        let candidate = self.zone.to_ambiguous_timestamp(local);
        if matches!(candidate.offset(), AmbiguousOffset::Gap { .. }) {
            return Ok(None);
        }
        Ok(Some(CalendarOccurrence {
            due_ms: candidate.earlier()?.as_millisecond(),
            local,
        }))
    }

    fn latest(&self, now: Timestamp) -> Result<CalendarOccurrence> {
        // A fold can expose yesterday after tomorrow's earliest wall time
        // already occurred. Bound civil candidates from UTC using Jiff's full
        // offset domain, rather than assuming today's displayed date is last.
        let mut date = jiff::tz::Offset::MAX.to_datetime(now).date();
        let mut latest: Option<CalendarOccurrence> = None;
        for _ in 0..MAX_SEARCH_DATES {
            if let Some(candidate) = self.on_date(date)? {
                if candidate.due_ms <= now.as_millisecond()
                    && latest
                        .as_ref()
                        .is_none_or(|best| candidate.due_ms > best.due_ms)
                {
                    latest = Some(candidate);
                }
            }
            date = date.yesterday().context("calendar date range exhausted")?;
            if let Some(best) = latest.as_ref() {
                // No occurrence on this or any older date can exceed the
                // UTC instant obtained with the minimum possible offset.
                if jiff::tz::Offset::MIN
                    .to_timestamp(date.to_datetime(self.time))
                    .is_ok_and(|upper| upper.as_millisecond() <= best.due_ms)
                {
                    return Ok(best.clone());
                }
            }
        }
        anyhow::bail!("calendar previous-occurrence search bound exhausted")
    }

    fn date_count(&self, first: Date, last: Date) -> Result<i64> {
        ensure!(last >= first, "calendar local date range is reversed");
        let days = first.duration_until(last).as_secs() / 86_400 + 1;
        let mut count = (days / 7) * i64::from(self.days.0.count_ones());
        let start = i64::from(first.weekday().to_monday_zero_offset());
        for offset in 0..days % 7 {
            if self.days.0 & (1 << ((start + offset) % 7)) != 0 {
                count += 1;
            }
        }
        Ok(count)
    }

    fn missing_in_gap(
        &self,
        start: DateTime,
        end: DateTime,
        first: DateTime,
        last: DateTime,
    ) -> Result<i64> {
        let mut date = start.date();
        let mut count = 0;
        for _ in 0..MAX_GAP_DATES {
            let candidate = date.to_datetime(self.time);
            if candidate >= start
                && candidate < end
                && candidate >= first
                && candidate <= last
                && self.days.0 & (1 << date.weekday().to_monday_zero_offset()) != 0
            {
                count += 1;
            }
            if date >= end.date() {
                return Ok(count);
            }
            date = date
                .tomorrow()
                .context("calendar gap date range exhausted")?;
        }
        anyhow::bail!("calendar gap date bound exhausted")
    }
}
