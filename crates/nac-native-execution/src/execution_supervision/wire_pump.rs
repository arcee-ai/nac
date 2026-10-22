//! Continuous bounded framing, never job admission or process execution.
//! Cancelling a receive does not cancel/restart a partial physical record.
use super::{
    buffered_io::Guarded,
    job_wire::{self, Direction, Frame},
    task_set::TaskSet,
    ExecutionSupervisionChannel,
};
use anyhow::{bail, Context, Result};
use nac_process::peer_channel::{PeerBinding, PeerDenial, PeerIoGate, PeerLifetime};
use std::{num::NonZeroUsize, time::Instant};
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt},
    sync::{mpsc, oneshot},
};

pub(super) struct NativeWire {
    sender: WireSender,
    incoming: mpsc::Receiver<Frame>,
    tasks: std::sync::Arc<TaskSet>,
}

#[derive(Clone)]
pub(super) struct WireSender {
    peer: WirePeer,
    direction: Direction,
    outgoing: mpsc::Sender<Outbound>,
}

// Derived only from the same successfully negotiated actual pair, before
// transferring its original unique lifetime. All copies retain weak state.
#[derive(Clone)]
struct WirePeer {
    gate: PeerIoGate,
    denial: PeerDenial,
    binding: PeerBinding,
    cutoff: Instant,
}

struct Outbound {
    raw: Vec<u8>,
    cutoff: Instant,
    done: oneshot::Sender<Result<()>>,
}

struct PendingWrite {
    denial: PeerDenial,
    complete: bool,
}
impl Drop for PendingWrite {
    fn drop(&mut self) {
        if !self.complete {
            self.denial.deny();
        }
    }
}

struct TaskOwner(PeerDenial);
impl Drop for TaskOwner {
    fn drop(&mut self) {
        self.0.deny();
    }
}

impl NativeWire {
    pub(super) fn from_negotiated(
        channel: ExecutionSupervisionChannel,
        receive: Direction,
        queue_records: NonZeroUsize,
        tasks: std::sync::Arc<TaskSet>,
    ) -> Result<(Self, PeerLifetime)> {
        // A missing runtime is a construction failure, never a detached owner.
        let runtime = tokio::runtime::Handle::try_current()?;
        anyhow::ensure!(
            queue_records.get() <= tokio::sync::Semaphore::MAX_PERMITS
                && queue_records.get().checked_mul(super::MAX_FRAME).is_some(),
            "execution queue capacity overflow"
        );
        let (connection, owner) = channel.into_execution_parts()?;
        let peer = WirePeer {
            gate: connection.io_gate(),
            denial: owner.denial_handle(),
            binding: connection.binding(),
            cutoff: owner.original_cutoff(),
        };
        peer.check()?;
        let (reader, writer) = tokio::io::split(connection);
        let (incoming_tx, incoming) = mpsc::channel(queue_records.get());
        let (outgoing, outgoing_rx) = mpsc::channel(queue_records.get());
        let read_peer = peer.clone();
        let read_owner = TaskOwner(read_peer.denial.clone());
        let _reader = tasks.spawn(&runtime, async move {
            let _owner = read_owner;
            let _result = read_frames(reader, receive, incoming_tx, &read_peer).await;
        })?;
        let write_peer = peer.clone();
        let write_owner = TaskOwner(write_peer.denial.clone());
        let _writer = tasks.spawn(&runtime, async move {
            let _owner = write_owner;
            let _result = write_frames(writer, outgoing_rx, &write_peer).await;
        })?;
        Ok((
            Self {
                sender: WireSender {
                    peer,
                    direction: receive.opposite(),
                    outgoing,
                },
                incoming,
                tasks,
            },
            owner,
        ))
    }

    pub(super) fn tasks(&self) -> std::sync::Arc<TaskSet> {
        std::sync::Arc::clone(&self.tasks)
    }

    pub(super) fn sender(&self) -> WireSender {
        self.sender.clone()
    }

    pub(super) async fn receive(&mut self) -> Result<Frame> {
        self.sender.peer.check()?;
        let frame = tokio::select! {
            biased;
            _ = self.sender.peer.gate.invalidated() => bail!("execution wire invalidated"),
            frame = self.incoming.recv() => frame.context("execution wire reader ended")?,
        };
        self.sender.peer.check()?;
        Ok(frame)
    }
}

impl Drop for NativeWire {
    fn drop(&mut self) {
        self.sender.peer.denial.deny();
    }
}

impl WirePeer {
    fn check(&self) -> Result<()> {
        self.gate
            .check_current()
            .context("execution wire unavailable")
    }
}

impl WireSender {
    // Same negotiated pair, weak observers only; no descriptor or lifetime transfer.
    pub(super) fn physical_observer(&self) -> (PeerIoGate, PeerDenial, Instant) {
        (
            self.peer.gate.clone(),
            self.peer.denial.clone(),
            self.peer.cutoff,
        )
    }

    pub(super) fn binding(&self) -> PeerBinding {
        self.peer.binding.clone()
    }

    pub(super) fn buffered<T>(&self, inner: T, original_deadline: Instant) -> Guarded<T> {
        Guarded::new(
            inner,
            self.peer.gate.clone(),
            self.peer.denial.clone(),
            original_deadline.min(self.peer.cutoff),
        )
    }

    // The future job actor must install its independent original-deadline stop
    // owner BEFORE waiting for this queue. This timeout denies I/O only; it is
    // not a child/selected-driver stop or successful cleanup observation.
    pub(super) async fn send(&self, frame: Frame, original_deadline: Instant) -> Result<()> {
        let mut pending = PendingWrite {
            denial: self.peer.denial.clone(),
            complete: false,
        };
        let raw = job_wire::encode(self.direction, &frame)?;
        let cutoff = original_deadline.min(self.peer.cutoff);
        self.peer.check()?;
        if Instant::now() >= cutoff {
            bail!("execution write deadline expired");
        }
        let written = async {
            let (done, received) = oneshot::channel();
            let permit = self
                .outgoing
                .reserve()
                .await
                .context("execution wire writer ended")?;
            self.peer.check()?;
            if Instant::now() >= cutoff {
                bail!("execution write deadline expired");
            }
            permit.send(Outbound { raw, cutoff, done });
            received
                .await
                .context("execution wire write outcome unknown")??;
            self.peer.check()
        };
        tokio::select! {
            biased;
            _ = self.peer.gate.invalidated() => bail!("execution wire invalidated"),
            result = tokio::time::timeout_at(cutoff.into(), written) => result.context("execution write deadline expired")??,
        }
        if Instant::now() >= cutoff {
            bail!("execution write deadline expired");
        }
        pending.complete = true;
        Ok(())
    }
}

async fn read_frames(
    mut reader: impl AsyncRead + Unpin + Send,
    direction: Direction,
    incoming: mpsc::Sender<Frame>,
    peer: &WirePeer,
) -> Result<()> {
    loop {
        // This read is owned by the continuous task, never a cancelled receive.
        // A terminal task cancellation drops TaskOwner and denies the pair;
        // there is no attempt to resume or resynchronize a partial record.
        let frame = job_wire::read(&mut reader, direction).await?;
        peer.check()?;
        tokio::select! {
            biased;
            _ = peer.gate.invalidated() => bail!("execution wire invalidated"),
            result = incoming.send(frame) => result.context("execution receiver ended")?,
        }
    }
}

async fn write_frames(
    mut writer: impl AsyncWrite + Unpin + Send,
    mut outgoing: mpsc::Receiver<Outbound>,
    peer: &WirePeer,
) -> Result<()> {
    loop {
        let request = tokio::select! {
            biased;
            _ = peer.gate.invalidated() => bail!("execution wire invalidated"),
            request = outgoing.recv() => request.context("execution sender ended")?,
        };
        peer.check()?;
        if Instant::now() >= request.cutoff {
            bail!("queued execution write expired");
        }
        // Only validated <=4096-byte encodings enter this private queue.
        // A partial write is never retried after cancellation or failure.
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(request.cutoff.into()) => bail!("execution write expired"),
            result = async {
                writer.write_u32(request.raw.len().try_into()?).await?;
                writer.write_all(&request.raw).await?;
                Ok::<(), anyhow::Error>(())
            } => result?,
        }
        peer.check()?;
        if Instant::now() >= request.cutoff {
            bail!("execution write expired");
        }
        if request.done.send(Ok(())).is_err() {
            bail!("execution write acknowledgement lost");
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests;
