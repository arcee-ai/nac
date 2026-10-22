//! Per-stream byte queues and coalesced cumulative credit, never total-output caps.
use super::super::{
    job_wire::{
        assembly::{Assembly, AssemblyId},
        flow::{CreditReceiver, CreditSender},
        Frame, Stream,
    },
    wire_pump::WireSender,
};
use super::{byte_queue, stop::StopScope};
use anyhow::{bail, ensure, Context as _, Result};
use std::{
    io,
    num::NonZeroU64,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
    time::Instant,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::Notify,
};
use uuid::Uuid;

pub(super) struct Receiver {
    state: Mutex<ReceiverState>,
    changed: Arc<Notify>,
}
struct ReceiverState {
    credit: CreditReceiver,
    pending: Option<u64>,
    closed: bool,
}
pub(super) struct Sink {
    job: Uuid,
    stream: Stream,
    receiver: Arc<Receiver>,
    queue: Option<byte_queue::Writer>,
    assembly: Option<Assembly>,
}
struct QueueReader {
    queue: byte_queue::Reader,
    receiver: Arc<Receiver>,
    scope: Arc<StopScope>,
    deadline: Instant,
    consume_on_read: bool,
    eof: bool,
}
pub(super) struct Sender {
    credit: Mutex<CreditSender>,
    changed: Arc<Notify>,
}

impl Sender {
    pub(super) fn new(window: usize, changed: Arc<Notify>) -> Result<Arc<Self>> {
        let window =
            NonZeroU64::new(u64::try_from(window)?).context("Native flow window is zero")?;
        Ok(Arc::new(Self {
            credit: Mutex::new(CreditSender::new(window)),
            changed,
        }))
    }
    pub(super) fn grant(&self, upto: u64) -> Result<()> {
        self.credit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .grant(upto)?;
        self.changed.notify_waiters();
        Ok(())
    }
    pub(super) fn available(&self) -> Result<usize> {
        Ok(self
            .credit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .available()?
            .try_into()?)
    }
    pub(super) fn reserve(&self, bytes: usize) -> Result<u64> {
        self.credit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .try_take(bytes)?
            .ok_or_else(|| anyhow::anyhow!("Native send exceeds available credit"))
    }
}

impl Receiver {
    pub(super) fn pair(
        job: Uuid,
        stream: Stream,
        window: usize,
        changed: Arc<Notify>,
        scope: Arc<StopScope>,
        wire: &WireSender,
        deadline: Instant,
    ) -> Result<(Sink, nac_core::runtime::CompartmentReader, Arc<Self>)> {
        ensure!(window > 0, "Native flow window is zero");
        let mut credit = CreditReceiver::new(
            NonZeroU64::new(u64::try_from(window)?).context("Native flow window is zero")?,
        );
        let pending = credit.open()?;
        let receiver = Arc::new(Self {
            state: Mutex::new(ReceiverState {
                credit,
                pending: Some(pending),
                closed: false,
            }),
            changed,
        });
        let (queue, read) = byte_queue::pair(window)?;
        let reader = QueueReader {
            queue: read,
            receiver: Arc::clone(&receiver),
            scope,
            deadline,
            consume_on_read: stream != Stream::Stdin,
            eof: false,
        };
        Ok((
            Sink {
                job,
                stream,
                receiver: Arc::clone(&receiver),
                queue: Some(queue),
                assembly: None,
            },
            Box::new(wire.buffered(reader, deadline)),
            receiver,
        ))
    }
    /// For target stdin, call only after actual child writes. Merely dequeuing
    /// stdin into a local scratch buffer never gives the client more credit.
    pub(super) fn consumed(&self, bytes: usize) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let limit = state.credit.consumed(bytes.try_into()?)?;
        if !state.closed && limit.is_some() {
            state.pending = limit;
        }
        drop(state);
        self.changed.notify_waiters();
        Ok(())
    }
    pub(super) fn take_credit(&self) -> Option<u64> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.closed {
            None
        } else {
            state.pending.take()
        }
    }
}
impl Sink {
    pub(super) fn record(&mut self, frame: Frame) -> Result<()> {
        let id = |block| AssemblyId::Data {
            job_id: self.job,
            stream: self.stream,
            block,
        };
        match frame {
            Frame::BeginData {
                job_id,
                stream,
                block,
                bytes,
            } => {
                ensure!(
                    job_id == self.job
                        && stream == self.stream
                        && self.queue.is_some()
                        && self.assembly.is_none(),
                    "Native data begin state mismatch"
                );
                self.receiver
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .credit
                    .accept(block, bytes as usize)?;
                self.assembly = Some(Assembly::new(id(block), bytes as usize)?);
            }
            Frame::DataFragment {
                job_id,
                stream,
                block,
                offset,
                data,
            } => {
                ensure!(
                    job_id == self.job && stream == self.stream,
                    "Native data fragment identity mismatch"
                );
                self.assembly
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("Native data fragment without begin"))?
                    .push(id(block), offset as usize, &data)?;
            }
            Frame::EndData {
                job_id,
                stream,
                block,
            } => {
                ensure!(
                    job_id == self.job && stream == self.stream,
                    "Native data end identity mismatch"
                );
                let data = self
                    .assembly
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("Native data end without begin"))?
                    .finish(id(block))?;
                let queue = self
                    .queue
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("Native data after EOF"))?;
                // Credit bounds all unconsumed bytes, including this assembly.
                // With one queue writer, a full block MUST fit immediately.
                // The main receive loop never waits on an individual consumer.
                let mut context = Context::from_waker(Waker::noop());
                match Pin::new(queue).poll_write(&mut context, &data) {
                    Poll::Ready(Ok(count)) if count == data.len() => {}
                    _ => bail!("Native credited byte queue invariant failed"),
                }
            }
            _ => bail!("Native non-data record routed to byte queue"),
        }
        Ok(())
    }
    pub(super) fn finish(&mut self) -> Result<()> {
        ensure!(
            self.queue.is_some() && self.assembly.is_none(),
            "Native EOF state mismatch"
        );
        self.receiver
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .closed = true;
        self.queue.take();
        Ok(())
    }
}
impl AsyncRead for QueueReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        let before = buf.filled().len();
        match Pin::new(&mut self.queue).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let count = buf.filled().len() - before;
                if count == 0 {
                    self.eof = true;
                }
                if self.consume_on_read {
                    if let Err(error) = self.receiver.consumed(count) {
                        self.scope.stop(self.deadline);
                        return Poll::Ready(Err(io::Error::other(error.to_string())));
                    }
                }
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}
impl Drop for QueueReader {
    fn drop(&mut self) {
        if !self.eof {
            self.scope.stop(self.deadline);
        }
    }
}
