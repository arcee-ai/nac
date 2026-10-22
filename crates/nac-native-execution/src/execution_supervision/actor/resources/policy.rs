//! Actual Native plan derived from the same original capacity-policy owner.
//! Policy data does not construct Core's ledger, lifecycle loan or runtime.
use super::*;
use crate::execution_supervision::{actor::stop::StopScope, task_set::TaskSet};
use std::time::Instant;

impl ResourcePlan {
    pub(in super::super::super) fn from_policy(source: Arc<PolicySource>) -> Result<Self> {
        let cfg = source.configuration()?;
        let input = cfg.native_endpoint;
        let count = |value| -> Result<NonZeroUsize> {
            NonZeroUsize::new(usize::try_from(value)?).context("Native capacity policy unavailable")
        };
        let mut plan = ResourceLimits {
            live_jobs: count(input.live_jobs)?,
            wire_records: count(input.wire_records)?,
            flow_window: count(input.flow_window)?,
            owned_input_bytes: input.owned_input_bytes.try_into()?,
            capture_bytes: input.capture_bytes.try_into()?,
        }
        .validate()?;
        let jobs = plan
            .declaration
            .live_jobs()
            .get()
            .checked_mul(2)
            .context("Native aggregate job capacity overflow")?;
        let payload = plan
            .declaration
            .accounted_payload_bytes()
            .get()
            .checked_mul(2)
            .context("Native aggregate payload capacity overflow")?;
        for scope in [cfg.host, cfg.session] {
            // Core alone constructs/charges the real common ledger. These
            // checks refuse policy data that cannot hold BOTH physical ends.
            let values = [
                scope.endpoints,
                scope.live_jobs,
                scope.native_payload_bytes,
                scope.captured_results,
                scope.captured_bytes,
            ]
            .map(usize::try_from)
            .into_iter()
            .collect::<std::result::Result<Vec<_>, _>>()?;
            ensure!(
                values[0] >= 2
                    && values[1] >= jobs
                    && values[2] >= payload
                    && values[3] >= 1
                    && values[4] >= plan.limits.capture_bytes,
                "Native policy cannot admit both endpoints and capture"
            );
        }
        source.check_current()?;
        plan.policy_source = Some(source);
        Ok(plan)
    }
    pub(in super::super::super) fn policy_cutoff(&self, original: Instant) -> Instant {
        self.policy_source
            .as_ref()
            .map_or(original, |source| source.cutoff(original))
    }
    pub(super) fn check_policy(&self) -> Result<()> {
        if let Some(source) = &self.policy_source {
            source.check_current()?;
        }
        if let Some(original) = &self.issuer_storage {
            original.gate.check_current()?;
        }
        Ok(())
    }
}
impl ResourcePool {
    pub(in super::super) fn observe_policy(
        &self,
        scope: &Arc<StopScope>,
        tasks: &Arc<TaskSet>,
        original: Instant,
    ) -> Result<()> {
        let Some(source) = self.plan.policy_source.as_ref().map(Arc::clone) else {
            if let Some(held) = self.plan.issuer_storage.as_ref().map(Arc::clone) {
                let scope = Arc::clone(scope);
                let _observer = tasks.spawn(&tokio::runtime::Handle::current(), async move {
                    tokio::select! { biased;
                        _ = scope.invalidated() => {},
                        _ = held.gate.invalidated() => scope.stop(original),
                    }
                })?;
            }
            return Ok(());
        };
        let scope = Arc::clone(scope);
        // The existing TaskSet retains the same Core storage hold. Normal
        // Native denial cancels this observer so it cannot obstruct real join.
        let _observer = tasks.spawn(&tokio::runtime::Handle::current(), async move {
            tokio::select! { biased;
                _ = scope.invalidated() => {},
                _ = source.retired() => scope.stop(source.cutoff(original)),
            }
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
