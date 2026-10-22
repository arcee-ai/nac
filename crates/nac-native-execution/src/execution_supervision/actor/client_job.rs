//! Client job observations, live-port ownership and actual resize acknowledgements.
use super::super::poll_wake;
use super::{
    flow::{Receiver, Sender},
    resources::JobReservation,
    stop::{JobCutoff, JobDeadline, StopJobOnDrop, StopOnDrop, StopScope},
};
use anyhow::{ensure, Context as _, Result};
use nac_core::runtime::{
    CompartmentExit, CompartmentFuture, CompartmentProcess, CompartmentPtyProcess,
    CompartmentPtySize,
};
use std::{
    sync::{Arc, Mutex},
    task::Waker,
    time::Instant,
};
use tokio::sync::{oneshot, Mutex as AsyncMutex, Notify};
use uuid::Uuid;

pub(super) struct AdmittedJob {
    pub stop: StopOnDrop,
    pub scope: Arc<StopScope>,
    pub deadline: Instant,
    pub reservation: JobReservation,
    pub registration: JobDeadline,
}
pub(super) struct ClientFlows {
    pub changed: Arc<Notify>,
    pub input: Arc<Sender>,
    pub output: Arc<Receiver>,
    pub stderr: Option<Arc<Receiver>>,
}
pub(super) struct ClientJob {
    pub id: Uuid,
    pub scope: Arc<StopScope>,
    pub deadline: Instant,
    pub changed: Arc<Notify>,
    pub input: Arc<Sender>,
    pub output: Arc<Receiver>,
    pub stderr: Option<Arc<Receiver>>,
    pub state: Mutex<State>,
    reservation: Mutex<Option<JobReservation>>,
    registration: Mutex<Option<JobDeadline>>,
    resize_serial: AsyncMutex<()>,
}
pub(super) struct State {
    pub committed: bool,
    pub started: bool,
    pub exit: Option<CompartmentExit>,
    pub input_closed: bool,
    pub stdin_eof: bool,
    pub reaped: bool,
    pub released: bool,
    wire_released: bool,
    resources_settled: bool,
    deadline_settled: bool,
    pub terminate: bool,
    pub resize: Option<Resize>,
    next_resize: u64,
    input_waker: Option<Waker>,
    input_port_dropped: bool,
    readers: usize,
    failed: bool,
}
pub(super) struct Resize {
    pub id: u64,
    pub size: CompartmentPtySize,
    pub queued: bool,
    reply: oneshot::Sender<()>,
}
pub(super) struct ProcessHandle(pub Arc<ClientJob>);

impl ClientJob {
    pub(super) fn new(id: Uuid, admitted: AdmittedJob, flows: ClientFlows) -> Arc<Self> {
        let AdmittedJob {
            stop,
            scope,
            deadline,
            reservation,
            registration,
        } = admitted;
        let ClientFlows {
            changed,
            input,
            output,
            stderr,
        } = flows;
        let readers = if stderr.is_some() { 2 } else { 1 };
        let job = Arc::new(Self {
            id,
            scope,
            deadline,
            changed,
            input,
            output,
            stderr,
            state: Mutex::new(State {
                committed: false,
                started: false,
                exit: None,
                input_closed: false,
                stdin_eof: false,
                reaped: false,
                released: false,
                wire_released: false,
                resources_settled: false,
                deadline_settled: false,
                terminate: false,
                resize: None,
                next_resize: 0,
                input_waker: None,
                input_port_dropped: false,
                readers,
                failed: false,
            }),
            reservation: Mutex::new(Some(reservation)),
            registration: Mutex::new(Some(registration)),
            resize_serial: AsyncMutex::new(()),
        });
        stop.disarm();
        job
    }
    pub(super) fn notify(&self) {
        self.changed.notify_waiters();
    }
    pub(super) fn close_input(&self) {
        let waker = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .input_waker
            .take();
        if let Some(waker) = waker {
            waker.wake();
        }
        self.notify();
    }
    pub(super) fn register_input_waker(&self, waker: Waker) -> (bool, Option<Waker>) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let open = !state.input_closed && state.exit.is_none() && !state.reaped;
        (open, state.input_waker.replace(waker))
    }
    pub(super) fn input_open(&self) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        !state.input_closed && state.exit.is_none() && !state.reaped
    }
    pub(super) async fn released(&self) -> Result<()> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .wire_released = true;
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            self.maybe_settle();
            let published = {
                let mut state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.readers > 0
                    || (state.deadline_settled
                        && (!state.input_port_dropped || state.resources_settled))
                {
                    state.released = true;
                    true
                } else {
                    false
                }
            };
            if published {
                self.notify();
                return Ok(());
            }
            tokio::select! {
                _ = self.scope.invalidated() => anyhow::bail!("Native release invalidated"),
                _ = &mut changed => {}
            }
        }
    }
    pub(super) fn cutoff_handle(&self) -> Option<JobCutoff> {
        self.registration
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(JobDeadline::cutoff_handle)
    }
    fn stop_if_live(&self) {
        if let Some(cutoff) = self.cutoff_handle() {
            cutoff.stop_if_live();
        }
    }
    pub(super) fn input_port_done(&self) {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .input_port_dropped = true;
        self.maybe_settle();
    }
    pub(super) fn reader_done(&self, complete: bool) {
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.readers -= 1;
            state.failed |= !complete;
        }
        if !complete {
            self.stop_if_live();
        }
        self.maybe_settle();
    }
    fn maybe_settle(&self) {
        let (done, storage_done) = {
            let state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            (
                state.reaped
                    && state.wire_released
                    && state.readers == 0
                    && state.stdin_eof
                    && !state.failed,
                state.input_port_dropped,
            )
        };
        if !done {
            return;
        }
        // Actual process/wire/output obligations are complete. A closed input
        // queue may retain storage, but cannot retain old stop authority.
        let registration = self
            .registration
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(registration) = registration {
            registration.settled(); // unregister/wake outside the owner lock
            self.state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .deadline_settled = true;
            self.notify();
        }
        if storage_done {
            let reservation = self
                .reservation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if let Some(reservation) = reservation {
                drop(reservation); // actual queues were dropped before this call
                self.state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .resources_settled = true;
                self.notify();
            }
        }
    }
    pub(super) async fn wait(&self) -> Result<CompartmentExit> {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            self.scope.check()?;
            let exit = {
                let state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.reaped && state.released {
                    state.exit
                } else {
                    None
                }
            };
            if let Some(exit) = exit {
                self.scope.check()?;
                return Ok(exit);
            }
            tokio::select! { biased;
                _ = self.scope.invalidated() => anyhow::bail!("Native job invalidated"),
                _ = &mut changed => {}
            }
        }
    }
    pub(super) fn resized(&self, control_id: u64) -> Result<()> {
        let reply = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let resize = state
                .resize
                .take()
                .context("Native unexpected resize acknowledgement")?;
            ensure!(
                resize.id == control_id && resize.queued && !state.reaped,
                "Native resize acknowledgement mismatch"
            );
            resize.reply
        };
        reply
            .send(())
            .map_err(|()| anyhow::anyhow!("Native resize caller cancelled"))?;
        Ok(())
    }
}
impl Drop for ClientJob {
    fn drop(&mut self) {
        // Only unresolved process/wire/output ownership retains stop authority.
        // A completed closed port's remaining heap charge is independent.
        if self
            .registration
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some()
        {
            self.stop_if_live();
        }
    }
}
impl CompartmentProcess for ProcessHandle {
    fn wait(&self) -> CompartmentFuture<'_, CompartmentExit> {
        poll_wake::future(self.0.wait())
    }
    fn terminate_and_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()> {
        let completed = {
            let state = self
                .0
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.reaped && state.released
        };
        if completed {
            return poll_wake::future(async move {
                self.0.scope.check()?;
                ensure!(
                    Instant::now() < original_deadline,
                    "Native completed cleanup observation original cutoff expired"
                );
                Ok(())
            });
        }
        let deadline = original_deadline.min(self.0.deadline);
        let cutoff = self.0.cutoff_handle();
        if let Some(cutoff) = &cutoff {
            cutoff.tighten(deadline);
        }
        self.0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .terminate = true;
        self.0.notify();
        let pending = StopJobOnDrop::new(self.0.cutoff_handle());
        poll_wake::future(async move {
            ensure!(
                Instant::now() < deadline,
                "Native termination original cutoff expired"
            );
            tokio::time::timeout_at(deadline.into(), self.0.wait())
                .await
                .context("Native termination original cutoff expired")??;
            ensure!(
                Instant::now() < deadline,
                "Native termination completed after original cutoff"
            );
            pending.disarm();
            Ok(())
        })
    }
}
impl CompartmentPtyProcess for ProcessHandle {
    fn resize(&self, size: CompartmentPtySize) -> CompartmentFuture<'_, ()> {
        poll_wake::future(async move {
            let _serial =
                tokio::time::timeout_at(self.0.deadline.into(), self.0.resize_serial.lock())
                    .await
                    .context("Native resize original cutoff expired")?;
            self.0.scope.check()?;
            ensure!(
                size.rows != 0 && size.cols != 0,
                "Native invalid PTY dimensions"
            );
            let (reply, received) = oneshot::channel();
            {
                let mut state = self
                    .0
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                ensure!(
                    state.started
                        && state.exit.is_none()
                        && !state.reaped
                        && state.resize.is_none(),
                    "Native resize after exit or pending control"
                );
                let id = state
                    .next_resize
                    .checked_add(1)
                    .context("Native resize sequence exhausted")?;
                state.next_resize = id;
                state.resize = Some(Resize {
                    id,
                    size,
                    queued: false,
                    reply,
                });
            }
            let pending = StopJobOnDrop::new(self.0.cutoff_handle());
            self.0.notify();
            tokio::time::timeout_at(self.0.deadline.into(), received)
                .await
                .context("Native resize original cutoff expired")?
                .context("Native resize outcome unknown")?;
            self.0.scope.check()?;
            pending.disarm();
            Ok(())
        })
    }
}
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        if !self
            .0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .reaped
        {
            self.0.stop_if_live();
        }
    }
}
