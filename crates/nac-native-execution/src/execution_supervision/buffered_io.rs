//! Checks at the buffered-byte boundary. This is not an actor, process owner,
//! source check or independent stop watcher. The actor must retain those owners.
use nac_process::peer_channel::{PeerDenial, PeerIoGate};
use std::{
    future::Future,
    io,
    pin::Pin,
    task::{Context, Poll},
    time::Instant,
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

pub(super) struct Guarded<T> {
    inner: T,
    guard: Guard,
}

struct Guard {
    gate: PeerIoGate,
    denial: PeerDenial,
    read: WakePath,
    write: WakePath,
    deadline: Instant,
    failed: bool,
}

// Tokio's notification and timer futures each retain one task waker. Split
// readers and writers may be polled by different tasks, so never share them.
struct WakePath {
    invalidated: Pin<Box<dyn Future<Output = ()> + Send>>,
    timer: Pin<Box<tokio::time::Sleep>>,
    // Retained after the actual notification/timer fields are dropped.
    wake: super::poll_wake::PollWake,
}

impl WakePath {
    fn new(gate: &PeerIoGate, deadline: Instant) -> Self {
        let signal = gate.clone();
        Self {
            invalidated: Box::pin(async move { signal.invalidated().await }),
            timer: Box::pin(tokio::time::sleep_until(deadline.into())),
            wake: super::poll_wake::PollWake::new(),
        }
    }

    fn poll_ended(&mut self, cx: &mut Context<'_>) -> bool {
        let mut safe = self.wake.context(cx);
        self.invalidated.as_mut().poll(&mut safe).is_ready()
            || self.timer.as_mut().poll(&mut safe).is_ready()
    }
}

impl<T> Guarded<T> {
    pub(super) fn new(
        inner: T,
        gate: PeerIoGate,
        denial: PeerDenial,
        original_deadline: Instant,
    ) -> Self {
        Self {
            inner,
            guard: Guard {
                read: WakePath::new(&gate, original_deadline),
                write: WakePath::new(&gate, original_deadline),
                gate,
                denial,
                deadline: original_deadline,
                failed: false,
            },
        }
    }
}

impl Guard {
    fn refuse(&mut self) -> io::Error {
        self.failed = true;
        self.denial.deny();
        io::Error::new(
            io::ErrorKind::BrokenPipe,
            "buffered execution stream unavailable",
        )
    }

    fn check(&mut self) -> io::Result<()> {
        if self.failed || Instant::now() >= self.deadline || self.gate.check_current().is_err() {
            return Err(self.refuse());
        }
        Ok(())
    }

    fn poll_current(&mut self, cx: &mut Context<'_>, writing: bool) -> io::Result<()> {
        // Completed notification futures must never be polled again after the
        // first refusal, including a denial discovered by a post-I/O check.
        if self.failed {
            return Err(self.refuse());
        }
        // Register both wake paths before the final physical/deadline check.
        // The gate's notification handles invalidation before registration too.
        let wake = if writing {
            &mut self.write
        } else {
            &mut self.read
        };
        if wake.poll_ended(cx) {
            return Err(self.refuse());
        }
        self.check()
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for Guarded<T> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        this.guard.poll_current(cx, false)?;
        // Do not publish any filled bytes until the post-read physical check.
        // Bound one poll independently from caller buffer/capture capacities.
        let count = output.remaining().min(super::protocol::MAX_DATA);
        let mut staged = ReadBuf::new(output.initialize_unfilled_to(count));
        let mut safe = this.guard.read.wake.current_context();
        match Pin::new(&mut this.inner).poll_read(&mut safe, &mut staged) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(error)) => Poll::Ready(Err(error)),
            Poll::Ready(Ok(())) => {
                let filled = staged.filled().len();
                this.guard.check()?;
                output.advance(filled);
                Poll::Ready(Ok(()))
            }
        }
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for Guarded<T> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        this.guard.poll_current(cx, true)?;
        let mut safe = this.guard.write.wake.current_context();
        let result = Pin::new(&mut this.inner).poll_write(&mut safe, bytes);
        if result.is_ready() {
            this.guard.check()?;
        }
        result
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        this.guard.poll_current(cx, true)?;
        let mut safe = this.guard.write.wake.current_context();
        let result = Pin::new(&mut this.inner).poll_flush(&mut safe);
        if result.is_ready() {
            this.guard.check()?;
        }
        result
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        this.guard.poll_current(cx, true)?;
        let mut safe = this.guard.write.wake.current_context();
        let result = Pin::new(&mut this.inner).poll_shutdown(&mut safe);
        if result.is_ready() {
            this.guard.check()?;
        }
        result
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests;
