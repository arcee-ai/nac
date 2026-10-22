//! Fixed internal runner launch data. These dimensions carry no Core authority.
//! Only the issuer keeps the real two Core holds; the child must also capture
//! its actual original parent connection before these values can be used.
use super::resources::ResourceLimits;
#[cfg(target_os = "linux")]
use super::resources::ResourcePlan;
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::num::NonZeroUsize;
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};
use uuid::Uuid;

pub(super) const INPUT_ENV: &str = "NAC_NATIVE_RUNNER_INPUT";
pub(super) const SOCKET_ENV: &str = "NAC_EXECUTION_SUPERVISION_SOCKET";
const MAX_INPUT: usize = 4096;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RunnerInput {
    boot: Uuid,
    /// Same-host CLOCK_MONOTONIC absolute cutoff, not a renewable duration.
    cutoff_ns: u64,
    dimensions: [usize; 5],
}
impl RunnerInput {
    #[cfg(target_os = "linux")]
    pub(super) fn encode(plan: &ResourcePlan, boot: Uuid, cutoff: Instant) -> Result<String> {
        // Clock first, then Instant: this conversion is conservative; elapsed
        // conversion time cannot extend the original trusted issuer cutoff.
        let clock = monotonic_ns()?;
        let remaining = cutoff
            .checked_duration_since(Instant::now())
            .context("runner cutoff ended")?;
        let value = Self {
            boot,
            cutoff_ns: clock
                .checked_add(remaining.as_nanos().try_into()?)
                .context("runner cutoff overflow")?,
            dimensions: plan.dimensions(),
        };
        ensure!(!value.boot.is_nil(), "runner correlation absent");
        let data = serde_json::to_string(&value)?;
        ensure!(data.len() <= MAX_INPUT, "runner launch input too large");
        Ok(data)
    }
    pub(super) fn decode(data: &str) -> Result<Self> {
        ensure!(
            !data.is_empty() && data.len() <= MAX_INPUT,
            "runner input size invalid"
        );
        let value: Self = serde_json::from_str(data)?;
        ensure!(
            !value.boot.is_nil() && value.cutoff_ns > 0,
            "runner input invalid"
        );
        value.limits()?.validate()?;
        Ok(value)
    }
    pub(super) fn boot(&self) -> Uuid {
        self.boot
    }
    pub(super) fn limits(&self) -> Result<ResourceLimits> {
        let count = |n| NonZeroUsize::new(n).context("runner count is zero");
        Ok(ResourceLimits {
            live_jobs: count(self.dimensions[0])?,
            wire_records: count(self.dimensions[1])?,
            flow_window: count(self.dimensions[2])?,
            owned_input_bytes: self.dimensions[3],
            capture_bytes: self.dimensions[4],
        })
    }
    #[cfg(target_os = "linux")]
    pub(super) fn cutoff(&self) -> Result<Instant> {
        // Instant first, then clock: child conversion cannot renew the budget.
        let now = Instant::now();
        let remaining = self
            .cutoff_ns
            .checked_sub(monotonic_ns()?)
            .context("runner cutoff ended")?;
        now.checked_add(Duration::from_nanos(remaining))
            .context("runner cutoff overflow")
    }
}
#[cfg(target_os = "linux")]
fn monotonic_ns() -> Result<u64> {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: clock_gettime writes only this initialized local structure.
    let observed = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut time) };
    ensure!(observed == 0, "runner monotonic clock unavailable");
    u64::try_from(time.tv_sec)?
        .checked_mul(1_000_000_000)
        .and_then(|s| s.checked_add(u64::try_from(time.tv_nsec).ok()?))
        .context("runner monotonic clock invalid")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launch_data_preserves_dimensions_without_borrowing_retention_defaults() {
        let input = RunnerInput {
            boot: Uuid::new_v4(),
            cutoff_ns: 1,
            dimensions: [7, 9, 11, 123456, 3_000_000_000],
        };
        let decoded = RunnerInput::decode(&serde_json::to_string(&input).unwrap()).unwrap();
        assert_eq!(
            decoded.limits().unwrap().validate().unwrap().dimensions(),
            input.dimensions
        );
    }
    #[test]
    fn launch_data_rejects_unknown_duplicate_zero_and_overflow_dimensions() {
        let base = r#"{"boot":"00000000-0000-0000-0000-000000000001","cutoff_ns":1,"dimensions":[1,2,3,4,5]}"#;
        assert!(RunnerInput::decode(base).is_ok());
        for bad in [
            base.replace("[1,2,3", "[0,2,3"),
            base.replace("\"cutoff_ns\":1", "\"cutoff_ns\":0"),
            base.replace("\"cutoff_ns\":1", "\"cutoff_ns\":1,\"cutoff_ns\":1"),
            base.replace("\"cutoff_ns\":1", "\"cutoff_ns\":1,\"authority\":true"),
            base.replace("[1,2,3,4,5]", &format!("[1,2,{},4,5]", usize::MAX)),
            " ".repeat(MAX_INPUT + 1),
        ] {
            assert!(RunnerInput::decode(&bad).is_err());
        }
    }
}
