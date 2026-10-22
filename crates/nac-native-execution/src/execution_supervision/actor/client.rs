//! Actual four RAW routes over one private v2 actor; never a qualification factory.
mod construction;
use super::super::poll_wake;
use super::super::{
    job_wire::{Direction, Frame, Operation, Stream},
    wire_pump::{NativeWire, WireSender},
};
use super::{
    byte_queue, capture,
    client_job::{AdmittedJob, ClientFlows, ClientJob, ProcessHandle},
    client_send,
    flow::{Receiver, Sender, Sink},
    resources::{CaptureReservation, ResourcePool},
    send::JobIds,
    stop::{StopJobOnDrop, StopOnDrop, StopScope},
};
use anyhow::{ensure, Context, Result};
use nac_core::runtime::{
    CompartmentCommand, CompartmentFileIoCommand, CompartmentFuture, CompartmentOutput,
    CompartmentPipe, CompartmentPty, CompartmentPtySize, ExecutionCompartmentTransport,
};
use nac_process::peer_channel::PeerBinding;
use std::{collections::BTreeMap, sync::Arc, time::Instant};
use tokio::sync::{mpsc, oneshot, Notify};
use uuid::Uuid;

pub(in super::super) struct NativeExecutionTransport {
    scope: Arc<StopScope>,
    pool: Arc<ResourcePool>,
    binding: PeerBinding,
    requests: mpsc::Sender<Request>,
    tasks: Arc<super::super::task_set::TaskSet>,
    _stop: StopOnDrop,
}
struct Prepared {
    admitted: AdmittedJob,
    encoded: Vec<u8>,
    initial: Option<Vec<u8>>,
    operation: Operation,
}
struct Request {
    prepared: Prepared,
    reply: oneshot::Sender<Ports>,
}
enum Ports {
    Pipe(CompartmentPipe),
    Pty(CompartmentPty),
}
struct Entry {
    job: Arc<ClientJob>,
    output: Sink,
    stderr: Option<Sink>,
    ready: Option<(oneshot::Sender<Ports>, Ports)>,
}
impl NativeExecutionTransport {
    fn prepare(
        &self,
        command: CompartmentCommand,
        operation: Operation,
        deadline: Instant,
        capture: bool,
    ) -> Result<(Prepared, CaptureReservation)> {
        let stop = StopOnDrop::new(Arc::clone(&self.scope));
        self.scope.check()?;
        let input = capture::owned_input(&command)?;
        let capture_bytes = if capture {
            command
                .stdout_limit
                .checked_add(command.stderr_limit)
                .context("Native capture ceilings overflow")?
        } else {
            0
        };
        let (reservation, capture) = self.pool.reserve(input, capture_bytes)?;
        let registration = self.scope.register(deadline)?;
        let (encoded, initial) = capture::encode(command)?;
        Ok((
            Prepared {
                admitted: AdmittedJob {
                    stop,
                    scope: Arc::clone(&self.scope),
                    deadline,
                    reservation,
                    registration,
                },
                encoded,
                initial,
                operation,
            },
            capture,
        ))
    }
    async fn dispatch(&self, prepared: Prepared) -> Result<Ports> {
        let deadline = prepared.admitted.deadline;
        let (reply, received) = oneshot::channel();
        let response = async {
            self.requests
                .send(Request { prepared, reply })
                .await
                .map_err(|_| anyhow::anyhow!("Native dispatch actor ended"))?;
            received.await.context("Native dispatch outcome unknown")
        };
        self.scope.check()?;
        let ports = tokio::select! { biased;
            _ = tokio::time::sleep_until(deadline.into()) => anyhow::bail!("Native dispatch original cutoff expired"),
            _ = self.scope.invalidated() => anyhow::bail!("Native dispatch invalidated"),
            ports = response => ports?,
        };
        self.scope.check()?;
        ensure!(
            Instant::now() < deadline,
            "Native dispatch completed after original cutoff"
        );
        Ok(ports)
    }
    fn captured(
        &self,
        command: CompartmentCommand,
        operation: Operation,
        deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        let (stdout, stderr) = (command.stdout_limit, command.stderr_limit);
        let prepared = self.prepare(command, operation, deadline, true);
        let pending = StopJobOnDrop::new(
            prepared
                .as_ref()
                .ok()
                .map(|(job, _)| job.admitted.registration.cutoff_handle()),
        );
        poll_wake::future(async move {
            let (prepared, _capture) = prepared?;
            let Ports::Pipe(pipe) = self.dispatch(prepared).await? else {
                anyhow::bail!("Native capture returned PTY")
            };
            drop(pipe.stdin);
            let (out, err, exit) = tokio::try_join!(
                capture::drain(pipe.stdout, stdout),
                capture::drain(pipe.stderr, stderr),
                pipe.process.wait()
            )?;
            self.scope.check()?;
            ensure!(
                Instant::now() < deadline,
                "Native capture completed after original cutoff"
            );
            pending.disarm();
            // Returned vectors now belong to Core, outside Native's live capture
            // quota. Truncation remains explicit, including for prepared files.
            Ok(CompartmentOutput {
                exit,
                stdout: out.0,
                stderr: err.0,
                stdout_truncated: out.1,
                stderr_truncated: err.1,
            })
        })
    }
}
impl ExecutionCompartmentTransport for NativeExecutionTransport {
    fn peer_binding(&self) -> Option<PeerBinding> {
        Some(self.binding.clone())
    }
    fn execute(
        &self,
        command: CompartmentCommand,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.captured(command, Operation::Execute {}, original_deadline)
    }
    fn native_file_io(
        &self,
        operation: CompartmentFileIoCommand,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.captured(
            operation.into_command(),
            Operation::FileChild {},
            original_deadline,
        )
    }
    fn spawn_pipe(
        &self,
        command: CompartmentCommand,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        let prepared = self.prepare(command, Operation::Pipe {}, original_deadline, false);
        let pending = StopJobOnDrop::new(
            prepared
                .as_ref()
                .ok()
                .map(|(job, _)| job.admitted.registration.cutoff_handle()),
        );
        poll_wake::future(async move {
            let (prepared, _capture) = prepared?;
            let Ports::Pipe(pipe) = self.dispatch(prepared).await? else {
                anyhow::bail!("Native pipe returned PTY")
            };
            pending.disarm();
            Ok(pipe)
        })
    }
    fn spawn_pty(
        &self,
        command: CompartmentCommand,
        size: CompartmentPtySize,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        let prepared = self.prepare(
            command,
            Operation::Pty {
                rows: size.rows,
                cols: size.cols,
            },
            original_deadline,
            false,
        );
        let pending = StopJobOnDrop::new(
            prepared
                .as_ref()
                .ok()
                .map(|(job, _)| job.admitted.registration.cutoff_handle()),
        );
        poll_wake::future(async move {
            let (prepared, _capture) = prepared?;
            let Ports::Pty(pty) = self.dispatch(prepared).await? else {
                anyhow::bail!("Native PTY returned pipe")
            };
            pending.disarm();
            Ok(pty)
        })
    }
    fn close_and_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()> {
        self.scope.stop(original_deadline);
        poll_wake::future(async move {
            let cutoff = original_deadline.min(self.scope.cleanup_cutoff()?);
            tokio::try_join!(self.scope.close_and_reap(cutoff), self.tasks.join(cutoff))?;
            ensure!(
                Instant::now() < self.scope.cleanup_cutoff()?,
                "Native close completed after original cutoff"
            );
            Ok(())
        })
    }
}

async fn run(
    mut wire: NativeWire,
    sender: WireSender,
    mut requests: mpsc::Receiver<Request>,
    scope: Arc<StopScope>,
    pool: Arc<ResourcePool>,
) -> Result<()> {
    let tasks = wire.tasks();
    let mut jobs = BTreeMap::new();
    let mut ids = JobIds::new();
    let mut previous_begin = None;
    loop {
        tokio::select! {
            request = requests.recv() => {
                let request = request.context("Native dispatch owner ended")?;
                let job_id = ids.take()?;
                let (next_begin, receiver) = oneshot::channel();
                let turn = client_send::BeginTurn { previous: previous_begin.take(), next: next_begin };
                let entry = create(job_id, request, &sender, Arc::clone(&scope), pool.limits().flow_window.get(), &tasks, turn)?;
                previous_begin = Some(receiver);
                ensure!(jobs.insert(job_id, entry).is_none(), "Native duplicate local job");
            }
            frame = wire.receive() => {
                let frame = frame?; scope.check()?;
                let id = match &frame {
                    Frame::Started { job_id } | Frame::Exited { job_id, .. } | Frame::Reaped { job_id }
                    | Frame::Resized { job_id, .. } | Frame::InputClosed { job_id }
                    | Frame::Credit { job_id, .. } | Frame::BeginData { job_id, .. }
                    | Frame::DataFragment { job_id, .. } | Frame::EndData { job_id, .. } => *job_id,
                    _ => anyhow::bail!("Native unexpected client record"),
                };
                let entry = jobs.get_mut(&id).context("Native unknown client job")?;
                match frame {
                    Frame::Started { .. } => {
                        {
                            let mut state = entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                            ensure!(state.committed && !state.started && !state.reaped, "Native started state mismatch");
                            state.started = true;
                        }
                        entry.job.notify();
                        let (reply, ports) = entry.ready.take().context("Native duplicate dispatch response")?;
                        reply.send(ports).map_err(|_| anyhow::anyhow!("Native dispatch caller cancelled"))?;
                    }
                    Frame::Exited { code, signal, .. } => {
                        {
                            let mut state = entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                            ensure!(state.started && state.exit.is_none() && !state.reaped, "Native exited state mismatch");
                            state.exit = Some(nac_core::runtime::CompartmentExit { code, signal });
                        }
                        entry.job.close_input();
                    }
                    Frame::InputClosed { .. } => {
                        {
                            let mut state = entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                            ensure!(state.started && !state.input_closed && !state.reaped, "Native input-close state mismatch");
                            state.input_closed = true;
                        }
                        entry.job.close_input();
                    }
                    Frame::Credit { stream: Stream::Stdin, upto, .. } => {
                        ensure!(entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).started, "Native stdin credit before started");
                        entry.job.input.grant(upto)?;
                    }
                    Frame::Resized { control_id, .. } => { entry.job.resized(control_id)?; }
                    Frame::BeginData { stream, .. } | Frame::DataFragment { stream, .. } | Frame::EndData { stream, .. } => {
                        ensure!(entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).started, "Native output before started");
                        match stream {
                            Stream::Stdout if entry.stderr.is_some() => entry.output.record(frame)?,
                            Stream::PtyOutput if entry.stderr.is_none() => entry.output.record(frame)?,
                            Stream::Stderr => entry.stderr.as_mut().context("Native stderr on PTY")?.record(frame)?,
                            _ => anyhow::bail!("Native output stream mismatch"),
                        }
                    }
                    Frame::Reaped { .. } => {
                        {
                            let state = entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                            ensure!(state.started && state.exit.is_some() && state.stdin_eof && !state.reaped && state.resize.is_none(), "Native reaped state mismatch");
                        }
                        entry.output.finish()?;
                        if let Some(stderr) = &mut entry.stderr { stderr.finish()?; }
                        entry.job.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner).reaped = true;
                        entry.job.close_input();
                        // Scheduler retains the live lease until its final
                        // Released write completes; all local queues remain
                        // charged until their readers actually consume EOF.
                        jobs.remove(&id);
                    }
                    _ => anyhow::bail!("Native client stream/control mismatch"),
                }
            }
        }
    }
}
fn create(
    id: Uuid,
    request: Request,
    wire: &WireSender,
    scope: Arc<StopScope>,
    window: usize,
    tasks: &Arc<super::super::task_set::TaskSet>,
    turn: client_send::BeginTurn,
) -> Result<Entry> {
    let Prepared {
        admitted,
        encoded,
        initial,
        operation,
    } = request.prepared;
    let pty = matches!(operation, Operation::Pty { .. });
    let deadline = admitted.deadline;
    let changed = Arc::new(Notify::new());
    let (output, out, output_flow) = Receiver::pair(
        id,
        if pty {
            Stream::PtyOutput
        } else {
            Stream::Stdout
        },
        window,
        Arc::clone(&changed),
        Arc::clone(&scope),
        wire,
        deadline,
    )?;
    let (stderr, err, stderr_flow) = if pty {
        (None, None, None)
    } else {
        let (sink, reader, flow) = Receiver::pair(
            id,
            Stream::Stderr,
            window,
            Arc::clone(&changed),
            Arc::clone(&scope),
            wire,
            deadline,
        )?;
        (Some(sink), Some(reader), Some(flow))
    };
    let input = Sender::new(window, Arc::clone(&changed))?;
    let job = ClientJob::new(
        id,
        admitted,
        ClientFlows {
            changed,
            input,
            output: output_flow,
            stderr: stderr_flow,
        },
    );
    let (input, incoming) = byte_queue::pair(window)?;
    let input = job.input_handle(input, wire);
    let output_reader = job.output_handle(out);
    let ports = if pty {
        Ports::Pty(CompartmentPty {
            input,
            output: output_reader,
            process: Box::new(ProcessHandle(Arc::clone(&job))),
        })
    } else {
        Ports::Pipe(CompartmentPipe {
            stdin: input,
            stdout: output_reader,
            stderr: job.output_handle(err.context("Native pipe stderr missing")?),
            process: Box::new(ProcessHandle(Arc::clone(&job))),
        })
    };
    let pending = StopJobOnDrop::new(job.cutoff_handle());
    let owned = Arc::clone(&job);
    let sender = wire.clone();
    let _writer = tasks.spawn(&tokio::runtime::Handle::current(), async move {
        client_send::run(&owned, &sender, operation, encoded, initial, incoming, turn).await?;
        owned.released().await?;
        pending.disarm();
        Ok::<(), anyhow::Error>(())
    })?;
    Ok(Entry {
        job,
        output,
        stderr,
        ready: Some((request.reply, ports)),
    })
}

#[cfg(all(test, target_os = "linux"))]
mod tests;
