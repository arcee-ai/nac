//! Canonical elapsed and wall-clock recurrence with explicit pinned zone data.
use super::calendar::{CalendarCadence, Weekdays};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// Elapsed time and wall-clock recurrence have distinct identities. The spec
/// codec preserves the historical interval JSON without a new enum envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeartbeatCadence {
    Interval { interval_ms: i64 },
    Calendar(HeartbeatCalendarRule),
}

pub(super) struct HeartbeatDueRange {
    pub(super) last_ms: i64,
    pub(super) count: i64,
    pub(super) next_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatCalendarRule {
    pub zone: String,
    pub data_version: String,
    pub hour: u8,
    pub minute: u8,
    pub days: HeartbeatCalendarDays,
}

/// Only an unsaved preview may select the currently supported data version.
/// Creation saves its resolved rule; durable rules never default the version.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatCalendarDraft {
    pub zone: String,
    pub data_version: Option<String>,
    pub hour: u8,
    pub minute: u8,
    pub days: HeartbeatCalendarDays,
}
impl HeartbeatCalendarDraft {
    pub fn into_rule(self) -> HeartbeatCalendarRule {
        HeartbeatCalendarRule {
            zone: self.zone,
            data_version: self
                .data_version
                .unwrap_or_else(|| super::calendar::DATA_VERSION.to_owned()),
            hour: self.hour,
            minute: self.minute,
            days: self.days,
        }
    }
}

/// A passive projection from the pinned data, separate from retained control
/// responses. The owning rule always travels with its UTC/local instants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatCalendarPreview {
    pub calendar: HeartbeatCalendarRule,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_due: Option<HeartbeatCalendarPreviewPoint>,
    pub occurrences: Vec<HeartbeatCalendarPreviewPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatCalendarPreviewPoint {
    pub due_ms: i64,
    pub utc: String,
    pub local: String,
}

/// Selected weekdays use Monday=1 through Sunday=7. Encoding order is canonical
/// (ascending); duplicate and unsupported days are rejected rather than lost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    try_from = "CalendarDaysWire",
    into = "CalendarDaysWire"
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum HeartbeatCalendarDays {
    Daily,
    Weekdays { days: Vec<u8> },
    Weekly { day: u8 },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum CalendarDaysWire {
    Daily,
    Weekdays { days: Vec<u8> },
    Weekly { day: u8 },
}

impl TryFrom<CalendarDaysWire> for HeartbeatCalendarDays {
    type Error = anyhow::Error;
    fn try_from(wire: CalendarDaysWire) -> Result<Self> {
        Ok(match wire {
            CalendarDaysWire::Daily => Self::Daily,
            CalendarDaysWire::Weekdays { mut days } => {
                Weekdays::selected(&days)?;
                days.sort_unstable();
                Self::Weekdays { days }
            }
            CalendarDaysWire::Weekly { day } => {
                Weekdays::selected(&[day])?;
                Self::Weekly { day }
            }
        })
    }
}

impl From<HeartbeatCalendarDays> for CalendarDaysWire {
    fn from(days: HeartbeatCalendarDays) -> Self {
        match days {
            HeartbeatCalendarDays::Daily => Self::Daily,
            HeartbeatCalendarDays::Weekdays { mut days } => {
                days.sort_unstable();
                Self::Weekdays { days }
            }
            HeartbeatCalendarDays::Weekly { day } => Self::Weekly { day },
        }
    }
}

impl HeartbeatCalendarRule {
    pub fn preview(
        &self,
        now_ms: i64,
        retained_due_ms: Option<i64>,
        count: usize,
    ) -> Result<HeartbeatCalendarPreview> {
        let engine = self.engine()?;
        let cursor = retained_due_ms
            .map(|due| due.checked_sub(1).context("invalid calendar retained due"))
            .transpose()?;
        let next_due = if let Some(due) = retained_due_ms {
            let point = engine.next(
                due.checked_sub(1)
                    .context("invalid calendar retained due")?,
                None,
            )?;
            ensure!(
                point.due_ms == due,
                "retained calendar due is not canonical"
            );
            Some(preview_point(point)?)
        } else {
            None
        };
        let occurrences = engine
            .preview(now_ms, cursor, count)?
            .into_iter()
            .map(preview_point)
            .collect::<Result<_>>()?;
        Ok(HeartbeatCalendarPreview {
            calendar: self.clone(),
            next_due,
            occurrences,
        })
    }

    pub(super) fn engine(&self) -> Result<CalendarCadence> {
        let days = match &self.days {
            HeartbeatCalendarDays::Daily => Weekdays::daily(),
            HeartbeatCalendarDays::Weekdays { days } => Weekdays::selected(days)?,
            HeartbeatCalendarDays::Weekly { day } => Weekdays::selected(&[*day])?,
        };
        CalendarCadence::new(&self.zone, &self.data_version, days, self.hour, self.minute)
    }
}

fn preview_point(
    point: super::calendar::CalendarOccurrence,
) -> Result<HeartbeatCalendarPreviewPoint> {
    Ok(HeartbeatCalendarPreviewPoint {
        due_ms: point.due_ms,
        utc: jiff::Timestamp::from_millisecond(point.due_ms)?.to_string(),
        local: point.local.to_string(),
    })
}

impl super::HeartbeatSchedule {
    pub fn calendar_preview(
        &self,
        now_ms: i64,
        count: usize,
    ) -> Result<Option<HeartbeatCalendarPreview>> {
        match &self.spec.cadence {
            HeartbeatCadence::Calendar(rule) => rule
                .preview(now_ms, Some(self.next_due_ms), count)
                .map(Some),
            HeartbeatCadence::Interval { .. } => Ok(None),
        }
    }
}

impl HeartbeatCadence {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Interval { interval_ms } => ensure!(
                (super::MIN_HEARTBEAT_INTERVAL_MS..=super::MAX_HEARTBEAT_INTERVAL_MS)
                    .contains(interval_ms),
                "heartbeat interval must be between 60 seconds and 365 days"
            ),
            Self::Calendar(rule) => {
                rule.engine()?;
            }
        }
        Ok(())
    }

    pub(super) fn due_range(&self, first_ms: i64, now_ms: i64) -> Result<HeartbeatDueRange> {
        ensure!(
            first_ms >= 0 && now_ms >= first_ms,
            "invalid heartbeat due range"
        );
        match self {
            Self::Interval { interval_ms } => {
                let count = now_ms
                    .checked_sub(first_ms)
                    .and_then(|n| n.checked_div(*interval_ms))
                    .and_then(|n| n.checked_add(1))
                    .context("heartbeat cadence overflow")?;
                let next_ms = count
                    .checked_mul(*interval_ms)
                    .and_then(|n| first_ms.checked_add(n))
                    .context("heartbeat cadence overflow")?;
                Ok(HeartbeatDueRange {
                    last_ms: next_ms - *interval_ms,
                    count,
                    next_ms,
                })
            }
            Self::Calendar(rule) => {
                let range = rule.engine()?.missed(first_ms, now_ms)?;
                Ok(HeartbeatDueRange {
                    last_ms: range.due_last_ms,
                    count: range.count,
                    next_ms: range.next_due_ms,
                })
            }
        }
    }

    /// `retained_due` is the next durable due, not the last processed due. Keep
    /// that point if still future; on resume skip everything at/before now.
    pub(super) fn future_due(
        &self,
        anchor_ms: i64,
        now_ms: i64,
        retained_due: Option<i64>,
    ) -> Result<i64> {
        ensure!(
            anchor_ms >= 0 && now_ms >= 0 && retained_due.is_none_or(|due| due >= 0),
            "invalid heartbeat time"
        );
        match self {
            Self::Interval { interval_ms } => {
                let next = super::model::future_due(anchor_ms, *interval_ms, now_ms)?;
                Ok(retained_due.map_or(next, |due| due.max(next)))
            }
            Self::Calendar(rule) => {
                let cursor = retained_due
                    .map(|due| due.checked_sub(1).context("invalid calendar retained due"))
                    .transpose()?;
                Ok(rule.engine()?.next(now_ms, cursor)?.due_ms)
            }
        }
    }
}
