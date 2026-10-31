//! Bounded interval schedules and their exact occurrence receipts.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

pub const MIN_HEARTBEAT_INTERVAL_MS: i64 = 60_000;
pub const MAX_HEARTBEAT_INTERVAL_MS: i64 = 365 * 24 * 60 * 60 * 1_000;
pub const MAX_HEARTBEAT_SCHEDULES: i64 = 100;
pub const MAX_HEARTBEAT_CONCURRENCY: i64 = 4;
pub const HEARTBEAT_HISTORY_LIMIT: i64 = 32;
pub const HEARTBEAT_COMMAND_LIMIT: i64 = 4_096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatSpec {
    pub name: String,
    pub instructions: String,
    #[serde(default)]
    pub skills: Vec<String>,
    pub interval_ms: i64,
    pub end_condition: String,
    pub goal_id: Option<String>,
    #[serde(default = "default_deadline")]
    pub execution_timeout_ms: i64,
    #[serde(default = "default_starts")]
    pub max_occurrences: i64,
    pub token_allowance: Option<i64>,
}

fn default_deadline() -> i64 {
    300_000
}
fn default_starts() -> i64 {
    1_000
}

impl HeartbeatSpec {
    pub fn validate(&self) -> Result<()> {
        for (text, max, field) in [
            (&self.name, 120, "name"),
            (&self.instructions, 8_000, "instructions"),
            (&self.end_condition, 1_000, "end condition"),
        ] {
            ensure!(
                !text.trim().is_empty() && text.len() <= max,
                "heartbeat {field} must contain 1..={max} bytes"
            );
        }
        ensure!(
            (MIN_HEARTBEAT_INTERVAL_MS..=MAX_HEARTBEAT_INTERVAL_MS).contains(&self.interval_ms),
            "heartbeat interval must be between 60 seconds and 365 days"
        );
        ensure!(
            (1_000..=3_600_000).contains(&self.execution_timeout_ms),
            "heartbeat deadline must be between 1 second and 1 hour"
        );
        ensure!(
            (1..=100_000).contains(&self.max_occurrences),
            "heartbeat occurrence allowance must be between 1 and 100000"
        );
        ensure!(
            self.token_allowance.is_none_or(|n| n > 0),
            "heartbeat token allowance must be positive"
        );
        ensure!(
            self.skills.len() <= 8
                && self
                    .skills
                    .iter()
                    .all(|s| !s.trim().is_empty() && s.len() <= 256),
            "heartbeat skills exceed bounds"
        );
        ensure!(
            self.goal_id
                .as_ref()
                .is_none_or(|s| !s.is_empty() && s.len() <= 256),
            "invalid heartbeat goal identity"
        );
        Ok(())
    }
}

/// An authenticated Local store is one owning user's host boundary. The exact
/// persisted session/configuration is pinned; a later change requires review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatBinding {
    pub config_version: i64,
    pub cwd: String,
    pub project_id: Option<String>,
    pub backend: String,
    /// Construction-time canonical Local workspace, checked again after
    /// restore. Persisted display/relative paths alone are not an identity.
    #[serde(default)]
    pub execution_cwd: Option<String>,
    /// Actual person input or service-issued human configuration intent. It
    /// grants only this saved scheduling purpose, never human tool authority.
    pub scheduling_request: Option<String>,
    /// Human attention metadata only; excluded from canonical target binding.
    #[serde(default)]
    pub seen_through_sequence: i64,
}

impl HeartbeatBinding {
    pub(super) fn same_target(&self, other: &Self) -> bool {
        self.config_version == other.config_version
            && self.cwd == other.cwd
            && self.project_id == other.project_id
            && self.backend == other.backend
    }
}

macro_rules! vocabulary {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
        #[serde(rename_all = "snake_case")]
        #[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
        pub enum $name { $($variant),+ }
    };
}
vocabulary!(HeartbeatState {
    Active,
    Paused,
    Suspended,
    Stopped,
    Finished,
    Deleted
});
vocabulary!(HeartbeatOccurrenceState {
    Pending,
    Admitted,
    Settled,
    Withdrawn
});
vocabulary!(HeartbeatOutcome {
    Unchanged,
    Meaningful,
    Finished,
    NeedsHumanAction,
    Failed,
    Interrupted,
    Unknown
});

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatSchedule {
    pub schedule_id: String,
    pub session_id: String,
    pub version: i64,
    pub state: HeartbeatState,
    pub binding: HeartbeatBinding,
    pub spec: HeartbeatSpec,
    pub anchor_ms: i64,
    pub next_due_ms: i64,
    pub reason: Option<String>,
    pub starts: i64,
    pub tokens_used: i64,
    pub time_used_ms: i64,
    pub usage_unknown: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatOccurrence {
    pub occurrence_id: String,
    pub schedule_id: String,
    pub session_id: String,
    pub schedule_version: i64,
    pub due_first_ms: i64,
    pub due_last_ms: i64,
    pub coalesced_count: i64,
    pub run_now: bool,
    pub state: HeartbeatOccurrenceState,
    pub spec: HeartbeatSpec,
    pub receipt_id: String,
    pub inbox_item_id: Option<i64>,
    pub run_id: Option<String>,
    pub generation: Option<String>,
    pub revision: i64,
    pub provisional_outcome: Option<HeartbeatOutcome>,
    pub outcome: Option<HeartbeatOutcome>,
    pub evidence: Option<String>,
    pub tokens_used: Option<i64>,
    pub started_at_ms: Option<i64>,
    pub settled_at_ms: Option<i64>,
    pub attempt_count: i64,
    pub settlement_sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum HeartbeatAction {
    Create {
        spec: HeartbeatSpec,
    },
    Edit {
        schedule_id: String,
        expected_version: i64,
        spec: HeartbeatSpec,
    },
    Pause {
        schedule_id: String,
        expected_version: i64,
    },
    Resume {
        schedule_id: String,
        expected_version: i64,
    },
    Stop {
        schedule_id: String,
        expected_version: i64,
    },
    Delete {
        schedule_id: String,
        expected_version: i64,
    },
    RunNow {
        schedule_id: String,
        expected_version: i64,
    },
}

impl HeartbeatAction {
    pub fn target(&self) -> Option<(&str, i64)> {
        match self {
            Self::Create { .. } => None,
            Self::Edit {
                schedule_id,
                expected_version,
                ..
            }
            | Self::Pause {
                schedule_id,
                expected_version,
            }
            | Self::Resume {
                schedule_id,
                expected_version,
            }
            | Self::Stop {
                schedule_id,
                expected_version,
            }
            | Self::Delete {
                schedule_id,
                expected_version,
            }
            | Self::RunNow {
                schedule_id,
                expected_version,
            } => Some((schedule_id, *expected_version)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HeartbeatReceipt {
    pub request_id: String,
    pub schedule: HeartbeatSchedule,
    pub occurrence: Option<HeartbeatOccurrence>,
    /// Exact already-admitted work. Delete alone never claims cancellation.
    pub active_occurrence: Option<HeartbeatOccurrence>,
}

/// Final usage sample travels with the canonical run-state transaction.
#[derive(Debug, Clone)]
pub struct HeartbeatRunSettlement {
    pub tokens_used: Option<u64>,
    pub duration_ms: u64,
    pub terminal_at_epoch_ms: u64,
    pub needs_human_action: bool,
}

/// Next strictly future point of an anchored cadence. A backward clock cannot
/// move an already-advanced durable due instant backwards.
pub(super) fn future_due(anchor: i64, interval: i64, now: i64) -> Result<i64> {
    ensure!(
        anchor >= 0 && now >= 0 && interval > 0,
        "invalid heartbeat time"
    );
    let elapsed = now.saturating_sub(anchor);
    let steps = elapsed
        .checked_div(interval)
        .and_then(|n| n.checked_add(1))
        .context("heartbeat cadence overflow")?;
    anchor
        .checked_add(
            steps
                .checked_mul(interval)
                .context("heartbeat cadence overflow")?,
        )
        .context("heartbeat cadence overflow")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cadence_is_anchored_strictly_future_and_overflow_checked() {
        assert_eq!(future_due(100, 60, 100).unwrap(), 160);
        assert_eq!(future_due(100, 60, 220).unwrap(), 280);
        assert_eq!(future_due(100, 60, 75).unwrap(), 160);
        assert!(future_due(i64::MAX - 1, 60, i64::MAX).is_err());
        assert!(future_due(0, 0, 0).is_err());
    }
}
