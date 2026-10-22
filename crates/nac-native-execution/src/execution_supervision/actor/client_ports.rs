//! Client byte-port ownership. EOF frees live byte queues; completed handles are inert.
use super::super::wire_pump::WireSender;
use super::{byte_queue, client_job::ClientJob};
use nac_core::runtime::{CompartmentReader, CompartmentWriter};
use std::{
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
struct OutputHandle {
    inner: Option<CompartmentReader>,
    job: Arc<ClientJob>,
    complete: bool,
}
struct InputHandle {
    inner: Option<CompartmentWriter>,
    job: Arc<ClientJob>,
    complete: bool,
}
struct InputGate {
    inner: byte_queue::Writer,
    job: Arc<ClientJob>,
}

impl ClientJob {
    pub(super) fn output_handle(self: &Arc<Self>, inner: CompartmentReader) -> CompartmentReader {
        Box::new(OutputHandle {
            inner: Some(inner),
            job: Arc::clone(self),
            complete: false,
        })
    }
    pub(super) fn input_handle(
        self: &Arc<Self>,
        inner: byte_queue::Writer,
        wire: &WireSender,
    ) -> CompartmentWriter {
        let gate = InputGate {
            inner,
            job: Arc::clone(self),
        };
        Box::new(InputHandle {
            inner: Some(Box::new(wire.buffered(gate, wire.physical_observer().2))),
            job: Arc::clone(self),
            complete: false,
        })
    }
}
impl AsyncRead for OutputHandle {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.job
            .scope
            .check()
            .map_err(|error| io::Error::other(error.to_string()))?;
        if buf.remaining() == 0 || self.complete {
            return Poll::Ready(Ok(()));
        }
        let before = buf.filled().len();
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| io::Error::other("Native output handle missing"))?;
        let result = Pin::new(inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &result {
            if buf.filled().len() == before {
                self.complete = true;
                self.inner.take(); // release actual byte queue capacity first
                self.job.reader_done(true);
            }
        }
        result
    }
}
impl Drop for OutputHandle {
    fn drop(&mut self) {
        if !self.complete {
            self.inner.take();
            self.job.reader_done(false);
        }
    }
}
impl InputGate {
    fn check_active_deadline(&self) -> io::Result<()> {
        if std::time::Instant::now() >= self.job.deadline {
            // Only the live registry may commit a job-derived global stop.
            // A local poll can race actual completion and lose that authority.
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Native input original cutoff expired",
            ));
        }
        Ok(())
    }
}
impl AsyncWrite for InputGate {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let waker = cx.waker().clone();
        let (open, old) = self.job.register_input_waker(waker);
        drop(old); // arbitrary waker Drop is outside state locks
        if !open {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Native child input closed",
            )));
        }
        self.check_active_deadline()?;
        let result = Pin::new(&mut self.inner).poll_write(cx, data);
        if !self.job.input_open() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Native child input closed",
            )));
        }
        self.check_active_deadline()?;
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if !self.job.input_open() {
            return Poll::Ready(Ok(()));
        }
        self.check_active_deadline()?;
        let result = Pin::new(&mut self.inner).poll_flush(cx);
        if self.job.input_open() {
            self.check_active_deadline()?;
        }
        result
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if !self.job.input_open() {
            return Poll::Ready(Ok(()));
        }
        self.check_active_deadline()?;
        let result = Pin::new(&mut self.inner).poll_shutdown(cx);
        if self.job.input_open() {
            self.check_active_deadline()?;
        }
        result
    }
}
impl AsyncWrite for InputHandle {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.job
            .scope
            .check()
            .map_err(|error| io::Error::other(error.to_string()))?;
        if !self.job.input_open() {
            // No new wire I/O is possible after target input close/exit. Do not
            // repoll a buffered guard that could revive a settled job's cutoff.
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Native child input closed",
            )));
        }
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "Native input shutdown"))?;
        Pin::new(inner).poll_write(cx, data)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.job
            .scope
            .check()
            .map_err(|error| io::Error::other(error.to_string()))?;
        if !self.job.input_open() {
            self.job
                .scope
                .check()
                .map_err(|error| io::Error::other(error.to_string()))?;
            return Poll::Ready(Ok(()));
        }
        match &mut self.inner {
            Some(inner) => Pin::new(inner).poll_flush(cx),
            None => Poll::Ready(Ok(())),
        }
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.job
            .scope
            .check()
            .map_err(|error| io::Error::other(error.to_string()))?;
        if self.job.input_open() {
            if let Some(inner) = &mut self.inner {
                std::task::ready!(Pin::new(inner).poll_shutdown(cx))?;
            }
        }
        self.inner.take();
        if !self.complete {
            self.complete = true;
            self.job.input_port_done();
        }
        self.job
            .scope
            .check()
            .map_err(|error| io::Error::other(error.to_string()))?;
        Poll::Ready(Ok(()))
    }
}
impl Drop for InputHandle {
    fn drop(&mut self) {
        if !self.complete {
            self.inner.take();
            self.job.input_port_done();
        }
    }
}
