//! Actual private v2 target dispatch. Core qualification remains separate/closed.
use super::super::{
    job_wire::{
        assembly::{Assembly, AssemblyId},
        command::decode_command,
        Direction, Frame, Operation, Stream,
    },
    wire_pump::{NativeWire, WireSender},
    ExecutionSupervisionChannel,
};
#[cfg(test)]
use super::resources::ResourceLimits;
use super::{
    child::{Children, Process},
    construction::{BuildControl, ConstructionFailure, NativeCleanup},
    flow::{Receiver, Sink},
    resources::{JobReservation, ResourcePlan, ResourcePool, StorageCharge},
    runner_job::{JobLink, RunnerJob},
    send::IncomingIds,
    stop::{JobDeadline, StopOnDrop, StopScope},
};
use anyhow::{ensure, Context, Result};
use nac_core::runtime::{CompartmentFuture, CompartmentStorageHold, ExecutionCompartmentTransport};
use nac_process::peer_channel::PeerLifetime;
use std::{collections::BTreeMap, sync::Arc, time::Instant};
use tokio::{sync::Notify, task::JoinHandle};

pub(in super::super) struct NativeRunner {
    pub(super) cleanup: NativeCleanup,
}
struct Building {
    command: Assembly,
    operation: Operation,
    reservation: JobReservation,
    deadline: JobDeadline,
}
struct Running {
    job: Arc<RunnerJob>,
    input: Sink,
    writer: JoinHandle<Result<()>>,
    _reservation: JobReservation,
    deadline: JobDeadline,
}
enum Entry {
    Building(Building),
    Running(Box<Running>),
}

impl NativeRunner {
    pub(in super::super) fn from_negotiated(
        channel: ExecutionSupervisionChannel,
        plan: ResourcePlan,
        storage: CompartmentStorageHold,
    ) -> std::result::Result<(Self, PeerLifetime), ConstructionFailure> {
        Self::construct(
            channel,
            plan,
            StorageCharge::Accounted(storage),
            BuildControl::Normal,
        )
    }
    pub(super) fn construct(
        channel: ExecutionSupervisionChannel,
        plan: ResourcePlan,
        storage: StorageCharge,
        control: BuildControl,
    ) -> std::result::Result<(Self, PeerLifetime), ConstructionFailure> {
        let cutoff = plan.policy_cutoff(channel.peer.original_cutoff());
        let children = Children::new();
        let mut cleanup = NativeCleanup::new(Arc::<Children>::clone(&children), storage, cutoff);
        let result = (|| {
            let pool = ResourcePool::new(plan, cleanup.storage.clone())?;
            let (wire, owner) = NativeWire::from_negotiated(
                channel,
                Direction::ToRunner,
                pool.limits().wire_records,
                Arc::clone(&cleanup.tasks),
            )?;
            control.after_wire()?;
            let sender = wire.sender();
            let tasks = wire.tasks();
            let (gate, denial, _) = sender.physical_observer();
            let scope = StopScope::start(gate, denial, Arc::<Children>::clone(&children), cutoff)?;
            cleanup.scope = Some(Arc::clone(&scope));
            pool.observe_policy(&scope, &cleanup.tasks, cutoff)?;
            let task_stop = StopOnDrop::new(Arc::clone(&scope));
            let _actor = tasks.spawn(&tokio::runtime::Handle::current(), async move {
                let _stop = task_stop;
                let _result = run(wire, sender, pool, children, scope, cutoff).await;
            })?;
            Ok(owner)
        })();
        match result {
            Ok(owner) => Ok((Self { cleanup }, owner)),
            Err(error) => Err(cleanup.failed(error)),
        }
    }
    #[cfg(test)]
    pub(super) fn unaccounted_for_test(
        channel: ExecutionSupervisionChannel,
        limits: ResourceLimits,
    ) -> Result<(Self, PeerLifetime)> {
        Ok(Self::construct(
            channel,
            limits.validate()?,
            StorageCharge::Unaccounted,
            BuildControl::Normal,
        )?)
    }
    /// Record stop/minimum cutoff even if the returned wait is never polled.
    pub(in super::super) fn close_and_reap(
        &self,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, ()> {
        self.cleanup.close_and_reap(original_deadline)
    }
}

async fn run(
    mut wire: NativeWire,
    sender: WireSender,
    pool: Arc<ResourcePool>,
    children: Arc<Children>,
    scope: Arc<StopScope>,
    cutoff: Instant,
) -> Result<()> {
    let tasks = wire.tasks();
    let mut jobs = BTreeMap::new();
    let mut identities = IncomingIds::new();
    loop {
        let frame = wire.receive().await?;
        scope.check()?;
        match frame {
            Frame::BeginCommand {
                job_id,
                operation,
                encoded_bytes,
            } => {
                identities.accept(job_id)?;
                ensure!(
                    !jobs.contains_key(&job_id),
                    "Native duplicate command identity"
                );
                let (reservation, _capture) = pool.reserve(0, 0)?;
                let deadline = scope.register(cutoff)?;
                let command = Assembly::new(AssemblyId::Command(job_id), encoded_bytes as usize)?;
                jobs.insert(
                    job_id,
                    Entry::Building(Building {
                        command,
                        operation,
                        reservation,
                        deadline,
                    }),
                );
            }
            Frame::CommandFragment {
                job_id,
                offset,
                data,
            } => {
                let Some(Entry::Building(job)) = jobs.get_mut(&job_id) else {
                    anyhow::bail!("Native command fragment state mismatch")
                };
                job.command
                    .push(AssemblyId::Command(job_id), offset as usize, &data)?;
            }
            Frame::CommitCommand { job_id } => {
                let Some(Entry::Building(job)) = jobs.remove(&job_id) else {
                    anyhow::bail!("Native command commit state mismatch")
                };
                let command = decode_command(&job.command.finish(AssemblyId::Command(job_id))?)?;
                scope.check()?;
                children.reserve_spawn(job_id)?;
                scope.check()?;
                let child = Process::spawn(command, job.operation, cutoff)?;
                children.insert(job_id, Arc::clone(&child.process))?;
                scope.check()?;
                let changed = Arc::new(Notify::new());
                let (input, incoming, credit) = Receiver::pair(
                    job_id,
                    Stream::Stdin,
                    pool.limits().flow_window.get(),
                    Arc::clone(&changed),
                    Arc::clone(&scope),
                    &sender,
                    cutoff,
                )?;
                let pty = matches!(job.operation, Operation::Pty { .. });
                let running = RunnerJob::new(
                    Arc::clone(&child.process),
                    pool.limits().flow_window.get(),
                    changed,
                    pty,
                )?;
                let writer = running.spawn(
                    child,
                    incoming,
                    credit,
                    JobLink {
                        id: job_id,
                        wire: sender.clone(),
                        scope: Arc::clone(&scope),
                        deadline: cutoff,
                        tasks: Arc::clone(&tasks),
                    },
                )?;
                jobs.insert(
                    job_id,
                    Entry::Running(Box::new(Running {
                        job: running,
                        input,
                        writer,
                        _reservation: job.reservation,
                        deadline: job.deadline,
                    })),
                );
            }
            Frame::BeginData { job_id, .. }
            | Frame::DataFragment { job_id, .. }
            | Frame::EndData { job_id, .. } => {
                let Some(Entry::Running(job)) = jobs.get_mut(&job_id) else {
                    anyhow::bail!("Native stdin data state mismatch")
                };
                ensure!(!job.job.is_reaped(), "Native stdin data after reap");
                job.input.record(frame)?;
            }
            Frame::Credit {
                job_id,
                stream,
                upto,
            } => {
                let Some(Entry::Running(job)) = jobs.get(&job_id) else {
                    anyhow::bail!("Native output credit state mismatch")
                };
                // Keep bounded counters through Reaped until the client's last
                // Released record fences legitimate already-in-flight credits.
                job.job.grant(stream, upto)?;
            }
            Frame::StdinEof { job_id } => {
                let Some(Entry::Running(job)) = jobs.get_mut(&job_id) else {
                    anyhow::bail!("Native stdin EOF state mismatch")
                };
                job.job.stdin_eof()?;
                job.input.finish()?;
            }
            Frame::Resize {
                job_id,
                control_id,
                rows,
                cols,
            } => {
                let Some(Entry::Running(job)) = jobs.get(&job_id) else {
                    anyhow::bail!("Native resize state mismatch")
                };
                scope.check()?;
                job.job.resize(control_id, rows, cols)?;
                scope.check()?;
            }
            Frame::Terminate { job_id } => {
                let Some(Entry::Running(job)) = jobs.get(&job_id) else {
                    anyhow::bail!("Native terminate state mismatch")
                };
                // Repeated stop on a reaped tombstone is harmless; never a new
                // child, cleanup budget, or permission grant.
                job.job.process.stop(cutoff);
            }
            Frame::Released { job_id } => {
                let Some(Entry::Running(job)) = jobs.remove(&job_id) else {
                    anyhow::bail!("Native release state mismatch")
                };
                ensure!(job.job.is_reaped(), "Native release before actual reap");
                // A conforming client has already read Reaped, the writer's
                // FINAL frame. Join that local final write acknowledgement;
                // no further child I/O or remote credit can be awaited here.
                job.writer
                    .await
                    .context("Native target job writer failed")??;
                children.remove_reaped(job_id)?;
                job.deadline.settled();
            }
            Frame::Close {} => {
                scope.stop(cutoff);
                return Ok(());
            }
            _ => anyhow::bail!("Native unexpected target record"),
        }
    }
}
