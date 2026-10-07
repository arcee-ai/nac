//! Live owner of one native operation lease. No row/UUID/transport constructor.
use super::effect_lease::RuntimeEffectLease;
use crate::store::{
    ActiveRuntimeLease, ActiveRuntimeLeaseCheck, ManagedRuntimeObservation,
    PendingRuntimeChallenge, RuntimeChallengeSpec, RuntimeLeaseBinding, RuntimeLeaseClock,
    RuntimeLeaseResponse, RuntimeLeaseSnapshot, StoreCoordinator,
};
use anyhow::{anyhow, Result};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

struct State {
    active: ActiveRuntimeLease,
    terminal: bool,
    publishing: bool,
    last_wall_ms: i64,
    terminal_scheduled: bool,
}

/// Only a consumed, delivered sealed store capability creates this owner.
/// Cloning its Arc shares the SAME original-operation authority; no successor
/// run, deserialized state, recovered goal or copied identifier creates a grant.
pub struct ManagedRuntimeLeaseGuard {
    store: Arc<StoreCoordinator>,
    state: Mutex<State>,
    executor: tokio::runtime::Handle,
}

fn denied() -> anyhow::Error {
    anyhow!("runtime operation lease unavailable")
}
pub(super) fn native_clock() -> Result<RuntimeLeaseClock> {
    Ok(RuntimeLeaseClock::capture()?)
}

impl ManagedRuntimeLeaseGuard {
    pub async fn new(
        store: Arc<StoreCoordinator>,
        active: ActiveRuntimeLease,
    ) -> Result<Arc<Self>> {
        let clock = native_clock()?;
        // Validate the selected store before constructing an owner that can
        // schedule termination; a cross-store capability must not mutate it.
        if !active.available_at(clock) || !store.check_managed_runtime_lease(&active, clock).await?
        {
            return Err(denied());
        }
        let guard = Arc::new(Self {
            store,
            state: Mutex::new(State {
                active,
                terminal: false,
                publishing: false,
                last_wall_ms: clock.wall_ms(),
                terminal_scheduled: false,
            }),
            executor: tokio::runtime::Handle::try_current().map_err(|_| denied())?,
        });
        guard.check_now()?;
        Ok(guard)
    }
    fn state(&self) -> Result<MutexGuard<'_, State>> {
        self.state.lock().map_err(|_| denied())
    }
    fn local(state: &mut State, clock: RuntimeLeaseClock) -> Result<()> {
        if state.terminal
            || clock.wall_ms() < state.last_wall_ms
            || !state.active.available_at(clock)
        {
            state.terminal = true;
            return Err(denied());
        }
        state.last_wall_ms = clock.wall_ms();
        Ok(())
    }
    #[cfg(test)]
    fn check_at(&self, clock: RuntimeLeaseClock) -> Result<()> {
        let mut state = self.state()?;
        Self::local(&mut state, clock)
    }

    /// Final in-process fence: clocks and locally observed close/removal/stop.
    /// Callers also perform `check_current` before each admitted external effect.
    pub fn check_now(&self) -> Result<()> {
        let result = (|| {
            let mut state = self.state()?;
            Self::local(&mut state, native_clock()?)
        })();
        if result.is_err() {
            self.deny_now();
        }
        result
    }

    pub fn snapshot(&self) -> Result<RuntimeLeaseSnapshot> {
        Ok(self.state()?.active.snapshot().clone())
    }
    pub fn binding(&self) -> Result<RuntimeLeaseBinding> {
        Ok(self.state()?.active.binding().clone())
    }

    /// Native connection/removal/stop owners mark denial synchronously before
    /// awaiting persistence, so a queued prompt/process cannot pass an old check.
    pub fn deny_now(&self) {
        let binding = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.terminal = true;
            if state.terminal_scheduled {
                None
            } else {
                state.terminal_scheduled = true;
                Some(state.active.binding().clone())
            }
        };
        if let Some(binding) = binding {
            let store = Arc::clone(&self.store);
            self.executor.spawn(async move {
                let _ = store.terminate_managed_runtime_lease(binding).await;
            });
        }
    }
    pub async fn terminate(&self) -> Result<()> {
        self.deny_now();
        self.store
            .terminate_managed_runtime_lease(self.binding()?)
            .await?;
        Ok(())
    }

    /// Native retained state + final current clocks. A renewal's committed new
    /// sequence is published under this owner's state before another check can
    /// treat its old snapshot as revoked. Old expiry still terminates a delayed
    /// or failed publication; there is no resurrection after local denial.
    pub async fn check(&self) -> Result<()> {
        let result = self.check_inner().await;
        if result.is_err() {
            self.deny_now();
        }
        result
    }
    async fn check_inner(&self) -> Result<()> {
        loop {
            let (clock, view, snapshot) = {
                let mut state = self.state()?;
                let clock = native_clock()?;
                Self::local(&mut state, clock)?;
                (
                    clock,
                    ActiveRuntimeLeaseCheck::from(&state.active),
                    state.active.snapshot().clone(),
                )
            };
            let check = self.store.check_runtime_lease_view(view, clock);
            tokio::pin!(check);
            let retained = loop {
                tokio::select! {
                    retained = &mut check => break retained,
                    () = tokio::time::sleep(Duration::from_millis(100)) => { self.check_now()?; }
                }
            };
            let retry = {
                let mut state = self.state()?;
                Self::local(&mut state, native_clock()?)?;
                if state.active.snapshot() != &snapshot {
                    true
                } else if matches!(retained, Ok(true)) {
                    return Ok(());
                } else if state.publishing && matches!(retained, Ok(false)) {
                    true
                } else {
                    state.terminal = true;
                    false
                }
            };
            if !retry {
                return Err(denied());
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }

    /// Application must independently corroborate that this exact acknowledged
    /// native session/run is active and current policy before creating its wire.
    pub async fn challenge_renewal(
        &self,
        native: ManagedRuntimeObservation,
        challenge: RuntimeChallengeSpec,
    ) -> Result<PendingRuntimeChallenge> {
        self.check().await?;
        let (clock, view) = {
            let mut state = self.state()?;
            let clock = native_clock()?;
            Self::local(&mut state, clock)?;
            if state.publishing {
                return Err(denied());
            }
            (clock, ActiveRuntimeLeaseCheck::from(&state.active))
        };
        let pending = self
            .store
            .challenge_runtime_lease_view(view, native, challenge, clock)
            .await?;
        self.check_now()?;
        Ok(pending)
    }

    /// Consume and publish together. Returning only an observational snapshot
    /// prevents a second guard from capturing the renewed execution capability.
    pub async fn consume_renewal(
        &self,
        pending: PendingRuntimeChallenge,
        response: RuntimeLeaseResponse,
        receipt_clock: RuntimeLeaseClock,
    ) -> Result<RuntimeLeaseSnapshot> {
        {
            let mut state = self.state()?;
            Self::local(&mut state, native_clock()?)?;
            if state.publishing {
                return Err(denied());
            }
            state.publishing = true;
        }
        let mut publication = Publication {
            guard: self,
            completed: false,
        };
        let renewed = self
            .store
            .consume_managed_runtime_challenge(pending, response, receipt_clock)
            .await;
        let result = {
            let mut state = self.state()?;
            let local = Self::local(&mut state, native_clock()?);
            let result = match (local, renewed) {
                (Ok(()), Ok(renewed))
                    if state.active.same_operation(&renewed)
                        && renewed.snapshot().lease_id == state.active.snapshot().lease_id
                        && renewed.snapshot().sequence > state.active.snapshot().sequence
                        && renewed.available_at(native_clock()?) =>
                {
                    let snapshot = renewed.snapshot().clone();
                    state.active = renewed;
                    Ok(snapshot)
                }
                _ => {
                    state.terminal = true;
                    Err(denied())
                }
            };
            state.publishing = false;
            result
        };
        publication.completed = true;
        if result.is_err() {
            self.deny_now();
        }
        result
    }

    pub async fn observe_denial(&self) {
        loop {
            if self.check().await.is_err() {
                self.deny_now();
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

// Cancellation/panic can happen after COMMIT. Never leave a publication open or
// reinterpret its lost capability delivery as permission to resume old work.
struct Publication<'a> {
    guard: &'a ManagedRuntimeLeaseGuard,
    completed: bool,
}
impl Drop for Publication<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.guard.deny_now();
            if let Ok(mut state) = self.guard.state.lock() {
                state.publishing = false;
            }
        }
    }
}

impl RuntimeEffectLease for ManagedRuntimeLeaseGuard {
    fn check_available(&self) -> Result<()> {
        self.check_now()
    }
    fn check_current(&self) -> Pin<Box<dyn Future<Output = Result<()>> + Send + '_>> {
        Box::pin(self.check())
    }
    fn wait_for_denial(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(self.observe_denial())
    }
}

#[cfg(test)]
#[path = "managed_runtime_lease_tests.rs"]
mod tests;
