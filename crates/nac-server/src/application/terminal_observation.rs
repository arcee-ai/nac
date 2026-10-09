//! Bounded observation seats and rendering acknowledgements for human terminals.
//! One immutable sanitized page per observer is retained until acknowledgement.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use nac_core::session_service::{SessionService, UserTerminalOutputPage, UserTerminalStatus};
use tokio::sync::Mutex;
use uuid::Uuid;

#[cfg(test)]
#[path = "terminal_observation_tests.rs"]
mod tests;

pub(crate) const MAX_OBSERVERS: usize = 32;
pub(crate) const MAX_TERMINAL_OBSERVERS: usize = 4;
const OBSERVER_IDLE_TTL: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub(crate) enum TerminalApplicationError {
    Invalid(&'static str),
    Unavailable,
    Busy,
    Rejected(String),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for TerminalApplicationError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

#[derive(Clone)]
pub(crate) struct TerminalFrame {
    pub page: UserTerminalOutputPage,
    pub terminal: UserTerminalStatus,
    pub requires_ack: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct RenderAcknowledgement {
    pub offset: u64,
    pub reset: bool,
}

struct CursorState {
    cursor: u64,
    pending: Option<TerminalFrame>,
    last_ack: Option<RenderAcknowledgement>,
}

struct Observer {
    session_id: String,
    terminal_id: String,
    service: Arc<SessionService>,
    page_limit: usize,
    state: Mutex<CursorState>,
}

struct Seat {
    observer: Arc<Observer>,
    last_used: Instant,
}

#[derive(Default)]
pub(crate) struct TerminalObservationHub {
    seats: StdMutex<HashMap<Uuid, Seat>>,
}

impl TerminalObservationHub {
    pub(crate) fn attach(
        &self,
        session_id: &str,
        terminal_id: &str,
        service: Arc<SessionService>,
        page_limit: usize,
    ) -> Result<Uuid, TerminalApplicationError> {
        if !(1..=64 * 1024).contains(&page_limit) {
            return Err(TerminalApplicationError::Invalid(
                "terminal page limit is out of bounds",
            ));
        }
        let mut seats = self
            .seats
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        seats.retain(|_, seat| seat.last_used.elapsed() < OBSERVER_IDLE_TTL);
        if seats.len() >= MAX_OBSERVERS
            || seats
                .values()
                .filter(|seat| {
                    seat.observer.session_id == session_id
                        && seat.observer.terminal_id == terminal_id
                })
                .count()
                >= MAX_TERMINAL_OBSERVERS
        {
            return Err(TerminalApplicationError::Busy);
        }
        let id = Uuid::new_v4();
        seats.insert(
            id,
            Seat {
                last_used: Instant::now(),
                observer: Arc::new(Observer {
                    session_id: session_id.to_owned(),
                    terminal_id: terminal_id.to_owned(),
                    service,
                    page_limit,
                    state: Mutex::new(CursorState {
                        cursor: 0,
                        pending: None,
                        last_ack: None,
                    }),
                }),
            },
        );
        Ok(id)
    }

    pub(crate) fn detach(&self, session_id: &str, terminal_id: &str, observer_id: Uuid) {
        let mut seats = self
            .seats
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if seats.get(&observer_id).is_some_and(|seat| {
            seat.observer.session_id == session_id && seat.observer.terminal_id == terminal_id
        }) {
            seats.remove(&observer_id);
        }
        // Wrong-scope and absent handles have the same idempotent result.
        // Detaching an observer never terminates a shell or cancels the agent.
    }

    pub(crate) async fn pull(
        &self,
        session_id: &str,
        terminal_id: &str,
        observer_id: Uuid,
        acknowledgement: Option<RenderAcknowledgement>,
        wait_ms: u16,
    ) -> Result<TerminalFrame, TerminalApplicationError> {
        if wait_ms > 1000 {
            return Err(TerminalApplicationError::Invalid(
                "terminal page limit/wait is out of bounds",
            ));
        }
        let observer = {
            let mut seats = self
                .seats
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let seat = seats
                .get_mut(&observer_id)
                .filter(|seat| {
                    seat.last_used.elapsed() < OBSERVER_IDLE_TTL
                        && seat.observer.session_id == session_id
                        && seat.observer.terminal_id == terminal_id
                })
                .ok_or(TerminalApplicationError::Unavailable)?;
            seat.last_used = Instant::now();
            Arc::clone(&seat.observer)
        };
        // Concurrent requests never queue behind a slow observer. Its single
        // pending frame is the complete replay/flow-control bound.
        let mut state = observer
            .state
            .try_lock()
            .map_err(|_| TerminalApplicationError::Busy)?;
        if let Some(ack) = acknowledgement {
            if state.last_ack != Some(ack) {
                let pending = state
                    .pending
                    .as_ref()
                    .ok_or(TerminalApplicationError::Invalid(
                        "no terminal frame awaits acknowledgement",
                    ))?;
                if pending.page.next_offset != ack.offset || pending.page.gap != ack.reset {
                    return Err(TerminalApplicationError::Invalid(
                        "terminal acknowledgement does not match the pending frame/reset",
                    ));
                }
                state.cursor = ack.offset;
                state.last_ack = Some(ack);
                state.pending = None;
            }
        }
        if let Some(frame) = &state.pending {
            return Ok(frame.clone());
        }
        let deadline = Instant::now() + Duration::from_millis(u64::from(wait_ms));
        loop {
            // Completion is observed before paging. If EOF is true, its
            // sanitized final append has committed before this page is read.
            let terminal = observer
                .service
                .user_terminal_status(&observer.terminal_id)
                .await
                .map_err(|_| TerminalApplicationError::Unavailable)?;
            let page = observer
                .service
                .read_user_terminal_output(&observer.terminal_id, state.cursor, observer.page_limit)
                .await
                .map_err(|_| TerminalApplicationError::Unavailable)?;
            if page.gap
                || !page.bytes.is_empty()
                || terminal.output_complete
                || Instant::now() >= deadline
            {
                let frame = TerminalFrame {
                    requires_ack: page.gap || !page.bytes.is_empty(),
                    page,
                    terminal,
                };
                if frame.requires_ack {
                    state.pending = Some(frame.clone());
                }
                return Ok(frame);
            }
            let remaining = deadline
                .saturating_duration_since(Instant::now())
                .as_millis()
                .min(1000) as u16;
            observer
                .service
                .wait_for_user_terminal_output(&observer.terminal_id, page.retained_end, remaining)
                .await
                .map_err(|_| TerminalApplicationError::Unavailable)?;
        }
    }
}
