//! One actual Unix connection and kernel peer lifetime, without authorization.
//!
//! Capture is Linux-only and fails closed when peer pidfds are unavailable.
//! Neither resource proves isolation, protocol identity, or process settlement.
//! The original cutoff is immutable; it is not a renewable operation budget.
//!
//! The unique halves cannot be cloned or reconstructed from observations:
//! ```compile_fail
//! fn clone_owner(owner: nac_process::peer_channel::PeerLifetime) {
//!     let _ = owner.clone();
//! }
//! ```
//! ```compile_fail
//! fn clone_connection(connection: nac_process::peer_channel::PeerConnection) {
//!     let _ = connection.clone();
//! }
//! ```
//! No raw descriptor or stream can escape through the connection:
//! ```compile_fail
//! use std::os::fd::AsRawFd;
//! fn raw(connection: nac_process::peer_channel::PeerConnection) {
//!     let _ = connection.as_raw_fd();
//! }
//! ```
//! ```compile_fail
//! fn extract(connection: nac_process::peer_channel::PeerConnection) {
//!     let _ = connection.into_inner();
//! }
//! ```
//! ```compile_fail
//! fn extract_owner(owner: nac_process::peer_channel::PeerLifetime) {
//!     let _ = owner.shared;
//! }
//! ```
//! ```compile_fail
//! fn forge_binding() {
//!     let _ = nac_process::peer_channel::PeerBinding(Default::default());
//! }
//! ```
//! A weak buffered-I/O check cannot replace the unique retained lifetime:
//! ```compile_fail
//! use nac_process::peer_channel::{PeerIoGate, PeerLifetime};
//! fn reconstruct_owner(gate: PeerIoGate) -> PeerLifetime {
//!     gate.into()
//! }
//! ```

use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::task::{Context, Poll, Waker};
use std::thread::JoinHandle;
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::UnixStream;
use tokio::sync::Notify;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(test)]
mod tests;

/// Actual kernel observations. These values cannot reconstruct a resource.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerCredentials {
    pub uid: u32,
    pub gid: u32,
}

/// Opaque association with one allocation, including after its owners drop.
/// Equality never establishes current liveness or grants authority.
#[derive(Clone)]
pub struct PeerBinding(Weak<Shared>);

impl PartialEq for PeerBinding {
    fn eq(&self, other: &Self) -> bool {
        Weak::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for PeerBinding {}

/// The unique gated I/O half. Dropping it permanently invalidates both halves.
pub struct PeerConnection(Arc<Shared>);

/// The unique kernel-lifetime half. Dropping it denies without joining cleanup.
pub struct PeerLifetime {
    shared: Arc<Shared>,
    // Dropping this handle detaches the finite observer; it never waits for it.
    monitor: Option<JoinHandle<()>>,
}

/// Cloneable denial/notification only. It owns no socket or pidfd.
#[derive(Clone)]
pub struct PeerDenial {
    shared: Weak<Shared>,
    signal: Arc<Signal>,
}

/// Weak physical-current checks for adapters that buffer bytes outside the
/// connection. This retains signal state, never a socket/pidfd or lifetime.
/// Success is only an I/O observation, not authorization or protocol proof.
#[derive(Clone)]
pub struct PeerIoGate {
    shared: Weak<Shared>,
    signal: Arc<Signal>,
}

struct Signal {
    denied: AtomicBool,
    changed: Notify,
}

impl Signal {
    async fn invalidated(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            // Register before checking, including notify_waiters races.
            changed.as_mut().enable();
            if self.denied.load(Ordering::Acquire) {
                return;
            }
            changed.await;
        }
    }
}

struct Shared {
    stream: UnixStream,
    cutoff: Instant,
    credentials: PeerCredentials,
    signal: Arc<Signal>,
    read_waker: Mutex<Option<Waker>>,
    write_waker: Mutex<Option<Waker>>,
    #[cfg(target_os = "linux")]
    kernel: linux::Kernel,
}

/// Consume the actual original stream, acquiring its same-socket kernel pidfd.
/// There is no PID, descriptor-number, path, or copied-credential constructor.
pub fn capture(
    stream: UnixStream,
    original_cutoff: Instant,
) -> io::Result<(PeerConnection, PeerLifetime)> {
    #[cfg(target_os = "linux")]
    {
        linux::capture(stream, original_cutoff)
    }
    #[cfg(not(target_os = "linux"))]
    {
        drop((stream, original_cutoff));
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "kernel peer lifetime capture is unavailable",
        ))
    }
}

fn unavailable() -> io::Error {
    io::Error::new(io::ErrorKind::BrokenPipe, "peer channel is unavailable")
}

fn register(slot: &Mutex<Option<Waker>>, waker: &Waker) {
    // Both clone and destruction can run caller callbacks. Neither may run
    // while holding a slot lock: callbacks can reenter denial on this owner.
    let replacement = waker.clone();
    let retired = {
        let mut slot = slot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if slot.as_ref().is_none_or(|old| !old.will_wake(waker)) {
            slot.replace(replacement)
        } else {
            Some(replacement)
        }
    };
    drop(retired);
}

impl Shared {
    fn deny(&self) {
        if self.signal.denied.swap(true, Ordering::AcqRel) {
            return;
        }
        #[cfg(target_os = "linux")]
        self.kernel.shutdown(&self.stream);
        self.signal.changed.notify_waiters();
        for slot in [&self.read_waker, &self.write_waker] {
            let waker = slot
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if let Some(waker) = waker {
                // An arbitrary caller's Waker must not unwind the monitor or
                // cause a double panic during owner Drop.
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| waker.wake()));
            }
        }
    }

    fn check_current(&self) -> io::Result<()> {
        let result = (|| {
            if self.signal.denied.load(Ordering::Acquire) || Instant::now() >= self.cutoff {
                return Err(unavailable());
            }
            #[cfg(target_os = "linux")]
            self.kernel.check(&self.stream)?;
            #[cfg(not(target_os = "linux"))]
            return Err(unavailable());
            #[cfg(target_os = "linux")]
            if self.signal.denied.load(Ordering::Acquire) || Instant::now() >= self.cutoff {
                return Err(unavailable());
            }
            #[cfg(target_os = "linux")]
            Ok(())
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
}

impl PeerConnection {
    pub fn binding(&self) -> PeerBinding {
        PeerBinding(Arc::downgrade(&self.0))
    }
    /// Derive from the actual I/O allocation; metadata cannot manufacture it.
    /// Buffered readers/writers must still preserve their source's ordering,
    /// cancellation and result checks. A gate never owns or clones the I/O.
    pub fn io_gate(&self) -> PeerIoGate {
        PeerIoGate {
            shared: Arc::downgrade(&self.0),
            signal: Arc::clone(&self.0.signal),
        }
    }
}

impl PeerIoGate {
    /// Synchronous same-resource kernel/cutoff check, without reading bytes or
    /// borrowing an actor lock. Either unique owner's Drop permanently denies.
    pub fn check_current(&self) -> io::Result<()> {
        self.shared
            .upgrade()
            .ok_or_else(unavailable)?
            .check_current()
    }
    pub async fn invalidated(&self) {
        self.signal.invalidated().await;
    }
}

impl PeerLifetime {
    #[cfg(target_os = "linux")]
    pub(crate) fn require_original_child_pid(&self, pid: u32) -> io::Result<()> {
        self.check_current()?;
        // The caller holds the ORIGINAL child's live pidfd throughout this
        // comparison, so its PID cannot name a replacement process.
        if self.shared.stream.peer_cred()?.pid() != i32::try_from(pid).ok() {
            return Err(io::Error::other("peer is not the original direct child"));
        }
        self.check_current()
    }

    /// Compare this original socket/pidfd with the current actual parent.
    /// No caller-supplied PID or credentials can create that relationship.
    #[cfg(target_os = "linux")]
    pub fn require_original_parent(&self) -> io::Result<()> {
        self.check_current()?;
        // SAFETY: getppid only observes this process's actual parent.
        let before = unsafe { libc::getppid() };
        if before <= 1 || self.shared.stream.peer_cred()?.pid() != Some(before) {
            return Err(io::Error::other("peer is not the original parent"));
        }
        self.check_current()?;
        // SAFETY: bookend the same parent relationship after checking pidfd.
        if unsafe { libc::getppid() } != before {
            return Err(io::Error::other("original parent changed"));
        }
        self.check_current()
    }
    /// Synchronous kernel/current-cutoff check; never polls protocol I/O.
    pub fn check_current(&self) -> io::Result<()> {
        self.shared.check_current()
    }
    pub fn original_cutoff(&self) -> Instant {
        self.shared.cutoff
    }
    pub fn credentials(&self) -> PeerCredentials {
        self.shared.credentials
    }
    pub fn binding(&self) -> PeerBinding {
        PeerBinding(Arc::downgrade(&self.shared))
    }
    /// Sticky denial only; this neither kills nor reaps the peer process.
    pub fn deny(&self) {
        self.shared.deny();
    }
    pub fn denial_handle(&self) -> PeerDenial {
        PeerDenial {
            shared: Arc::downgrade(&self.shared),
            signal: Arc::clone(&self.shared.signal),
        }
    }
    pub async fn invalidated(&self) {
        self.shared.signal.invalidated().await;
    }
}

impl PeerDenial {
    pub fn deny(&self) {
        if let Some(shared) = self.shared.upgrade() {
            shared.deny();
        }
    }
    pub async fn invalidated(&self) {
        self.signal.invalidated().await;
    }
}

impl Drop for PeerConnection {
    fn drop(&mut self) {
        self.0.deny();
    }
}
impl Drop for PeerLifetime {
    fn drop(&mut self) {
        self.shared.deny();
        drop(self.monitor.take());
    }
}

impl AsyncRead for PeerConnection {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let shared = &self.0;
        register(&shared.read_waker, cx.waker());
        shared.check_current()?;
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        loop {
            match shared.stream.poll_read_ready(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(error)) => {
                    shared.deny();
                    return Poll::Ready(Err(error));
                }
                Poll::Ready(Ok(())) => {}
            }
            match shared.stream.try_read(buf.initialize_unfilled()) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => continue,
                result => {
                    let count = match result {
                        Ok(0) => {
                            shared.deny();
                            return Poll::Ready(Err(unavailable()));
                        }
                        Ok(count) => count,
                        Err(error) => {
                            shared.deny();
                            return Poll::Ready(Err(error));
                        }
                    };
                    shared.check_current()?;
                    buf.advance(count);
                    return Poll::Ready(Ok(()));
                }
            }
        }
    }
}

impl AsyncWrite for PeerConnection {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let shared = &self.0;
        register(&shared.write_waker, cx.waker());
        shared.check_current()?;
        if buf.is_empty() {
            return Poll::Ready(Ok(0));
        }
        loop {
            match shared.stream.poll_write_ready(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(error)) => {
                    shared.deny();
                    return Poll::Ready(Err(error));
                }
                Poll::Ready(Ok(())) => {}
            }
            match shared.stream.try_write(buf) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => continue,
                result => {
                    if result.is_err() || matches!(result, Ok(0)) {
                        shared.deny();
                    }
                    shared.check_current()?;
                    return Poll::Ready(result);
                }
            }
        }
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(self.0.check_current())
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.0.deny();
        Poll::Ready(Ok(()))
    }
}
