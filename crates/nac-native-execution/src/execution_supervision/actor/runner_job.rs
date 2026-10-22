//! One actual target child: independent stdin drain and a serialized output/control writer.
use super::super::{
    job_wire::{Frame, Stream},
    protocol::MAX_DATA,
    wire_pump::WireSender,
};
use super::{
    child::{ChildPorts, Process},
    flow::{Receiver, Sender},
    send,
    stop::{StopOnDrop, StopScope},
};
use anyhow::{ensure, Result};
use nac_core::runtime::{CompartmentReader, CompartmentWriter};
use std::{
    io,
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Notify,
    task::JoinHandle,
};
use uuid::Uuid;

pub(super) struct JobLink {
    pub id: Uuid,
    pub wire: WireSender,
    pub scope: Arc<StopScope>,
    pub deadline: Instant,
    pub tasks: Arc<super::super::task_set::TaskSet>,
}
pub(super) struct RunnerJob {
    pub process: Arc<Process>,
    pub output: Arc<Sender>,
    pub stderr: Option<Arc<Sender>>,
    pub changed: Arc<Notify>,
    state: Mutex<State>,
}
#[derive(Default)]
struct State {
    started: bool,
    stdin_eof: bool,
    stdin_done: bool,
    input_closed: bool,
    resize: Option<u64>,
    resize_inflight: Option<u64>,
    next_resize: u64,
    exited: bool,
    reaped: bool,
}
impl RunnerJob {
    pub(super) fn new(
        process: Arc<Process>,
        window: usize,
        changed: Arc<Notify>,
        pty: bool,
    ) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            process,
            output: Sender::new(window, Arc::clone(&changed))?,
            stderr: if pty {
                None
            } else {
                Some(Sender::new(window, Arc::clone(&changed))?)
            },
            changed,
            state: Mutex::new(State::default()),
        }))
    }
    pub(super) fn stdin_eof(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.started && !state.stdin_eof && !state.reaped,
            "Native duplicate or late stdin EOF"
        );
        state.stdin_eof = true;
        drop(state);
        self.changed.notify_waiters();
        Ok(())
    }
    pub(super) fn resize(&self, control: u64, rows: u16, cols: u16) -> Result<()> {
        self.reserve_resize(control)?;
        // The in-flight reservation fences Reaped while the actual ioctl runs
        // outside shared state locks. A failed ioctl poisons the owning actor.
        self.process.resize(rows, cols)?;
        self.complete_resize(control)
    }
    fn reserve_resize(&self, control: u64) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.started
                && !state.exited
                && !state.reaped
                && state.resize.is_none()
                && state.resize_inflight.is_none()
                && state.next_resize.checked_add(1) == Some(control),
            "Native resize state mismatch"
        );
        state.next_resize = control;
        state.resize_inflight = Some(control);
        Ok(())
    }
    fn complete_resize(&self, control: u64) -> Result<()> {
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            ensure!(
                state.resize_inflight == Some(control) && !state.reaped && state.resize.is_none(),
                "Native resize completion state mismatch"
            );
            state.resize_inflight = None;
            state.resize = Some(control);
        }
        self.changed.notify_waiters();
        Ok(())
    }
    pub(super) fn is_reaped(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .reaped
    }
    pub(super) fn grant(&self, stream: Stream, upto: u64) -> Result<()> {
        ensure!(
            self.state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .started,
            "Native credit before started"
        );
        match stream {
            Stream::Stdout if self.stderr.is_some() => self.output.grant(upto),
            Stream::PtyOutput if self.stderr.is_none() => self.output.grant(upto),
            Stream::Stderr => self
                .stderr
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Native stderr on PTY"))?
                .grant(upto),
            _ => anyhow::bail!("Native credit stream mismatch"),
        }
    }
    pub(super) fn spawn(
        self: &Arc<Self>,
        child: ChildPorts,
        incoming: CompartmentReader,
        receiver: Arc<Receiver>,
        link: JobLink,
    ) -> Result<JoinHandle<Result<()>>> {
        let scope = Arc::clone(&link.scope);
        let guard = StopOnDrop::new(Arc::clone(&scope));
        let input_guard = StopOnDrop::new(Arc::clone(&scope));
        let input_job = Arc::clone(self);
        let input_scope = Arc::clone(&scope);
        let input_credit = Arc::clone(&receiver);
        let runtime = tokio::runtime::Handle::current();
        let stdin = link.tasks.spawn(&runtime, async move {
            input_pump(
                incoming,
                child.input,
                &input_credit,
                &input_job,
                &input_scope,
            )
            .await?;
            input_job
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .stdin_done = true;
            input_job.changed.notify_waiters();
            input_guard.disarm();
            Ok::<(), anyhow::Error>(())
        })?;
        let owned = Arc::clone(self);
        let tasks = Arc::clone(&link.tasks);
        tasks.spawn(&runtime, async move {
            owned
                .run(&link, child.output, child.stderr, receiver, stdin)
                .await?;
            guard.disarm();
            Ok(())
        })
    }
    async fn run(
        &self,
        link: &JobLink,
        mut output: CompartmentReader,
        mut stderr: Option<CompartmentReader>,
        input: Arc<Receiver>,
        stdin: JoinHandle<Result<()>>,
    ) -> Result<()> {
        let JobLink {
            id: job,
            wire,
            scope,
            deadline,
            tasks: _,
        } = link;
        let (job, deadline) = (*job, *deadline);
        let mut stdin = Some(stdin);
        scope.check()?;
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .started = true;
        wire.send(Frame::Started { job_id: job }, deadline).await?;
        let waiting = self.process.wait();
        tokio::pin!(waiting);
        let (mut exit_sent, mut out_done, mut err_done, mut closed_sent) =
            (false, false, stderr.is_none(), false);
        let (mut out, mut err) = ([0; MAX_DATA], [0; MAX_DATA]);
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            scope.check()?;
            let (resize, input_closed, input_done, resizing) = {
                let mut state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                (
                    state.resize.take(),
                    state.input_closed,
                    state.stdin_done,
                    state.resize_inflight.is_some(),
                )
            };
            if let Some(control_id) = resize {
                wire.send(
                    Frame::Resized {
                        job_id: job,
                        control_id,
                    },
                    deadline,
                )
                .await?;
                continue;
            }
            if input_closed && !closed_sent {
                closed_sent = true;
                wire.send(Frame::InputClosed { job_id: job }, deadline)
                    .await?;
                continue;
            }
            if let Some(upto) = input.take_credit() {
                wire.send(
                    Frame::Credit {
                        job_id: job,
                        stream: Stream::Stdin,
                        upto,
                    },
                    deadline,
                )
                .await?;
                continue;
            }
            if exit_sent && out_done && err_done && input_done && !resizing {
                // Joins only a completed local stdin task, never child I/O.
                if let Some(stdin) = stdin.take() {
                    stdin.await??;
                }
                {
                    let mut state = self
                        .state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    ensure!(state.stdin_eof, "Native reap has unfinished stdin");
                    if state.resize.is_some() || state.resize_inflight.is_some() {
                        continue;
                    }
                    state.reaped = true;
                }
                wire.send(Frame::Reaped { job_id: job }, deadline).await?;
                return Ok(());
            }
            let out_capacity = self.output.available()?.min(MAX_DATA);
            let err_capacity = self
                .stderr
                .as_ref()
                .map(|flow| flow.available())
                .transpose()?
                .unwrap_or(0)
                .min(MAX_DATA);
            tokio::select! {
                biased;
                _ = scope.invalidated() => anyhow::bail!("Native target peer invalidated"),
                _ = &mut changed => continue,
                status = &mut waiting, if !exit_sent => {
                    let status = status?;
                    self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).exited = true;
                    exit_sent = true;
                    wire.send(Frame::Exited { job_id: job, code: status.code, signal: status.signal }, deadline).await?;
                }
                bytes = output.read(&mut out[..out_capacity]), if !out_done && out_capacity > 0 => {
                    let bytes = bytes?;
                    if bytes == 0 { out_done = true; continue; }
                    let block = self.output.reserve(bytes)?;
                    let stream = if self.stderr.is_none() { Stream::PtyOutput } else { Stream::Stdout };
                    send::data(wire, job, stream, block, &out[..bytes], deadline).await?;
                }
                bytes = async { stderr.as_mut().ok_or_else(|| io::Error::other("Native stderr missing"))?.read(&mut err[..err_capacity]).await }, if !err_done && err_capacity > 0 => {
                    let bytes = bytes?;
                    if bytes == 0 { err_done = true; continue; }
                    let flow = self.stderr.as_ref().ok_or_else(|| anyhow::anyhow!("Native stderr credit missing"))?;
                    let block = flow.reserve(bytes)?;
                    send::data(wire, job, Stream::Stderr, block, &err[..bytes], deadline).await?;
                }
            }
        }
    }
}
async fn input_pump(
    mut input: CompartmentReader,
    child: CompartmentWriter,
    credit: &Receiver,
    job: &RunnerJob,
    scope: &StopScope,
) -> Result<()> {
    let mut child = Some(child);
    let mut buffer = [0; MAX_DATA];
    loop {
        scope.check()?;
        let bytes = input.read(&mut buffer).await?;
        if bytes == 0 {
            if let Some(mut child) = child {
                match child.shutdown().await {
                    Ok(()) => {}
                    Err(error) if closed_input(&error) => {}
                    Err(error) => return Err(error.into()),
                }
            }
            return Ok(());
        }
        let mut offset = 0;
        while offset < bytes {
            let Some(writer) = &mut child else {
                break;
            };
            scope.check()?;
            match writer.write(&buffer[offset..bytes]).await {
                Ok(0) => anyhow::bail!("Native child stdin write made no progress"),
                Ok(written) => {
                    offset += written;
                    credit.consumed(written)?;
                }
                Err(error) if closed_input(&error) => {
                    child = None;
                    job.state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .input_closed = true;
                    job.changed.notify_waiters();
                }
                Err(error) => return Err(error.into()),
            }
        }
        // After actual EPIPE/hangup, discard only already-granted in-flight
        // input until the client's ordered EOF. Never advertise more credit.
    }
}
fn closed_input(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::BrokenPipe || error.raw_os_error() == Some(libc::EIO)
}

#[cfg(test)]
mod tests;
