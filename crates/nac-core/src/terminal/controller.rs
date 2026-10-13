//! Input ownership is process-local. A revision fences queued packets at the
//! physical writer boundary; changing ownership never waits for PTY I/O.
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum InputController {
    Human,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct InputControlStatus {
    pub controller: InputController,
    /// Decimal on the wire, without JavaScript integer rounding.
    pub revision: String,
    pub in_flight: bool,
    pub frozen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum InputDeliveryOutcome {
    Written,
    Rejected,
    Unconfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct InputDeliveryReceipt {
    pub outcome: InputDeliveryOutcome,
    pub error: Option<String>,
}

impl InputDeliveryReceipt {
    pub(crate) fn into_result(self) -> Result<()> {
        match self.outcome {
            InputDeliveryOutcome::Written => Ok(()),
            _ => Err(anyhow!(self
                .error
                .unwrap_or_else(|| "terminal input delivery failed".into()))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InputTicket {
    pub(crate) incarnation: String,
    pub(crate) controller: InputController,
    pub(crate) revision: u64,
}

#[derive(Clone)]
pub(super) struct InputControl(Arc<Mutex<State>>);
struct State {
    controller: InputController,
    revision: u64,
    in_flight: bool,
    frozen: bool,
    stopped: bool,
    liveness: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
}

impl InputControl {
    pub(super) fn new(controller: InputController) -> Self {
        Self(Arc::new(Mutex::new(State {
            controller,
            revision: 1,
            in_flight: false,
            frozen: false,
            stopped: false,
            liveness: None,
        })))
    }

    pub(super) fn bind_liveness(&self, alive: Arc<dyn Fn() -> bool + Send + Sync>) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .liveness = Some(alive);
    }

    pub(super) fn status(&self) -> InputControlStatus {
        let state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        InputControlStatus {
            controller: state.controller,
            revision: state.revision.to_string(),
            in_flight: state.in_flight,
            frozen: state.frozen,
        }
    }

    pub(super) fn ticket(
        &self,
        incarnation: &str,
        controller: InputController,
    ) -> Result<InputTicket> {
        let state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ticket = InputTicket {
            incarnation: incarnation.into(),
            controller,
            revision: state.revision,
        };
        Self::check(&state, &ticket)?;
        Ok(ticket)
    }

    fn check(state: &State, ticket: &InputTicket) -> Result<()> {
        if state.stopped
            || state.liveness.as_ref().is_some_and(|alive| !alive())
            || state.controller != ticket.controller
            || state.revision != ticket.revision
        {
            return Err(anyhow!(
                "terminal controller changed; this input was not written"
            ));
        }
        if state.frozen {
            return Err(anyhow!("terminal input is frozen after unconfirmed delivery; acknowledge before fresh input"));
        }
        Ok(())
    }

    pub(super) fn validate(&self, ticket: &InputTicket) -> Result<()> {
        Self::check(
            &self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            ticket,
        )
    }

    pub(super) fn transfer(
        &self,
        expected: u64,
        controller: InputController,
        acknowledge: bool,
    ) -> Result<InputControlStatus> {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.stopped || state.revision != expected {
            return Err(anyhow!(
                "terminal controller revision changed; refresh before handoff"
            ));
        }
        if acknowledge && state.in_flight {
            return Err(anyhow!(
                "terminal input is still in flight; delivery cannot yet be acknowledged"
            ));
        }
        state.revision = state
            .revision
            .checked_add(1)
            .ok_or_else(|| anyhow!("terminal controller revision exhausted"))?;
        state.controller = controller;
        state.frozen = state.in_flight || (state.frozen && !acknowledge);
        Ok(InputControlStatus {
            controller: state.controller,
            revision: state.revision.to_string(),
            in_flight: state.in_flight,
            frozen: state.frozen,
        })
    }

    /// Linearization point. The mutex is released before Write is entered;
    /// reclaim can always run and exposes that irrevocable write honestly.
    pub(super) fn begin(&self, ticket: &InputTicket) -> Result<()> {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Self::check(&state, ticket)?;
        state.in_flight = true;
        Ok(())
    }

    pub(super) fn finish(&self, failed: bool) {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.in_flight = false;
        state.frozen |= failed;
    }

    pub(super) fn freeze(&self) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .frozen = true;
    }

    pub(super) fn stop(&self) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .stopped = true;
    }
}
