//! Consumption of actual peer/local denial and the existing permit cutoff.
//! This does not create a Root invalidation producer or prove stopped work.
use super::*;

impl BoundaryState {
    pub(super) async fn guard_effect<T>(
        &self,
        permit: &ProtectedExecutionPermit,
        mut operation: CompartmentFuture<'_, T>,
    ) -> Result<T> {
        let result = loop {
            // Register before checking so denial or a shorter observed cutoff
            // cannot be lost before the first suspended poll. A cutoff update
            // changes the timer, never recreates or renews the admitted effect.
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            self.check_effect(permit)?;
            let cutoff = permit.deadline.min(self.original_deadline()?);
            tokio::select! {
                biased;
                _ = &mut changed => continue,
                _ = self.peer.invalidated() => break Err(anyhow::anyhow!("protected effect peer ended during dispatch")),
                _ = tokio::time::sleep_until(cutoff.into()) => break Err(anyhow::anyhow!("protected effect expired during dispatch")),
                result = &mut operation => break result,
            }
        };
        if result.is_err() {
            self.poison();
        } else {
            self.check_effect(permit)?;
        }
        result
    }
}

#[cfg(unix)]
impl ProtectedExecutionContext {
    /// Observe only the SAME original runtime boundary. This grants no effect
    /// and never retains/recreates a lease or waits on credential/store locks.
    pub(crate) async fn invalidated(&self) {
        let Ok(state) = self.state() else {
            return;
        };
        loop {
            let changed = state.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.check_stage(ProtectedExecutionStage::Effect).is_err() {
                return;
            }
            let Ok(cutoff) = state.original_deadline() else {
                return;
            };
            tokio::select! {
                biased;
                _ = &mut changed => {},
                _ = state.peer.invalidated() => { state.poison(); return; },
                _ = tokio::time::sleep_until(cutoff.into()) => { state.poison(); return; },
            }
        }
    }
}
