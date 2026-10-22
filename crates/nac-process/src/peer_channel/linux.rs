//! Linux same-socket pidfd capture and an independent, non-consuming observer.
use super::*;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::time::Duration;

const SOCKET_EVENTS: libc::c_short = libc::POLLHUP | libc::POLLERR | libc::POLLRDHUP;

pub(super) struct Kernel {
    pidfd: OwnedFd,
    wake_read: OwnedFd,
    wake_write: OwnedFd,
    #[cfg(test)]
    pub(super) polls: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    pub(super) thread_id: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    pub(super) interrupted: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    pub(super) observed_events: std::sync::atomic::AtomicU8,
    #[cfg(test)]
    pub(super) fault_on_ready: std::sync::atomic::AtomicU8,
}

impl Kernel {
    fn observed(&self, stream: &UnixStream) -> [libc::pollfd; 3] {
        [
            libc::pollfd {
                fd: self.pidfd.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: stream.as_raw_fd(),
                events: SOCKET_EVENTS,
                revents: 0,
            },
            libc::pollfd {
                fd: self.wake_read.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
        ]
    }

    pub(super) fn check(&self, stream: &UnixStream) -> io::Result<()> {
        let mut observed = self.observed(stream);
        // SAFETY: initialized owned descriptors remain live for this borrow.
        // POLLNVAL, unsolicited readiness and poll errors all fail closed.
        let ready = unsafe { libc::poll(observed.as_mut_ptr(), observed.len() as _, 0) };
        if ready != 0 {
            return Err(unavailable());
        }
        Ok(())
    }

    pub(super) fn shutdown(&self, stream: &UnixStream) {
        // SAFETY: the original socket is still owned by Shared. Shutdown does
        // not close/reuse the fd or change shared open-file-description flags.
        unsafe { libc::shutdown(stream.as_raw_fd(), libc::SHUT_RDWR) };
        self.wake();
    }

    fn wake(&self) {
        let byte = 1_u8;
        // SAFETY: the private pipe is live and nonblocking; one byte suffices.
        // EAGAIN already means it is readable. Its read end stays owned here,
        // including if the monitor exits, so this cannot generate SIGPIPE.
        unsafe { libc::write(self.wake_write.as_raw_fd(), (&byte as *const u8).cast(), 1) };
    }

    fn monitor(&self, shared: &Shared) -> io::Result<()> {
        #[cfg(test)]
        // SAFETY: observing the current pthread identity has no side effects.
        self.thread_id
            .store(unsafe { libc::pthread_self() } as usize, Ordering::Release);
        loop {
            if shared.signal.denied.load(Ordering::Acquire) {
                return Ok(());
            }
            let Some(remaining) = shared.cutoff.checked_duration_since(Instant::now()) else {
                return Ok(());
            };
            let mut observed = self.observed(&shared.stream);
            #[cfg(test)]
            self.polls.fetch_add(1, Ordering::Relaxed);
            // No socket POLLIN: buffered payload is neither consumed nor a
            // readiness loop. RDHUP detects EOF even with unread payload.
            // SAFETY: all descriptors remain owned by the retained Shared.
            let ready = unsafe {
                libc::poll(
                    observed.as_mut_ptr(),
                    observed.len() as _,
                    poll_timeout(remaining),
                )
            };
            if ready > 0 {
                #[cfg(test)]
                match self.fault_on_ready.load(Ordering::Acquire) {
                    1 => panic!("injected actual peer monitor panic"),
                    2 => return Err(io::Error::other("injected peer monitor error")),
                    _ => {}
                }
                #[cfg(test)]
                self.observed_events.store(
                    u8::from(observed[0].revents != 0)
                        | (u8::from(observed[1].revents != 0) << 1)
                        | (u8::from(observed[2].revents != 0) << 2),
                    Ordering::Release,
                );
                // Any reported bit, including POLLNVAL/ERR, denies. We never
                // interpret an error as successful peer/process settlement.
                return Ok(());
            }
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
                #[cfg(test)]
                self.interrupted.fetch_add(1, Ordering::Relaxed);
            }
            // EINTR, bounded integer timeout or spurious timeout: recompute
            // only the remaining time from the same original Instant.
        }
    }
}

fn poll_timeout(remaining: Duration) -> libc::c_int {
    let ceil_ms = remaining.as_millis().saturating_add(u128::from(
        !remaining.subsec_nanos().is_multiple_of(1_000_000),
    ));
    ceil_ms.min(libc::c_int::MAX as u128) as libc::c_int
}

struct MonitorGuard(Arc<Shared>);

impl Drop for MonitorGuard {
    fn drop(&mut self) {
        self.0.deny();
    }
}

fn spawn_monitor(guard: MonitorGuard) -> io::Result<JoinHandle<()>> {
    #[cfg(test)]
    if FAIL_SPAWN.with(|fail| fail.replace(false)) {
        return Err(io::Error::other("injected peer monitor spawn failure"));
    }
    std::thread::Builder::new()
        .name("nac-peer-lifetime".into())
        .spawn(move || {
            let _ = guard.0.kernel.monitor(&guard.0);
            // Guard Drop denies on normal exit, error or unwinding. It was
            // constructed before spawn, so failed spawn denies as well.
            drop(guard);
        })
}

#[cfg(test)]
thread_local! {
    pub(super) static FAIL_SPAWN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub(super) fn capture(
    stream: UnixStream,
    cutoff: Instant,
) -> io::Result<(PeerConnection, PeerLifetime)> {
    if Instant::now() >= cutoff {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "peer cutoff expired",
        ));
    }
    let peer = stream.peer_cred()?;
    let pidfd = peer_pidfd(&stream)?;
    require_flags(stream.as_raw_fd(), true)?;
    // Pidfds are poll-only here; neither read nor waitid is issued. Do not
    // change OFD flags on the socket or any externally shared descriptor.
    require_flags(pidfd.as_raw_fd(), false)?;
    let (wake_read, wake_write) = wake_pipe()?;
    let shared = Arc::new(Shared {
        stream,
        cutoff,
        credentials: PeerCredentials {
            uid: peer.uid(),
            gid: peer.gid(),
        },
        signal: Arc::new(Signal {
            denied: AtomicBool::new(false),
            changed: Notify::new(),
        }),
        read_waker: Mutex::new(None),
        write_waker: Mutex::new(None),
        kernel: Kernel {
            pidfd,
            wake_read,
            wake_write,
            #[cfg(test)]
            polls: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            thread_id: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            interrupted: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            observed_events: std::sync::atomic::AtomicU8::new(0),
            #[cfg(test)]
            fault_on_ready: std::sync::atomic::AtomicU8::new(0),
        },
    });
    // Prepared before spawn; every exit after resource assembly denies.
    let guard = MonitorGuard(Arc::clone(&shared));
    shared.check_current()?;
    let monitor = spawn_monitor(guard)?;
    let owner = PeerLifetime {
        shared: Arc::clone(&shared),
        monitor: Some(monitor),
    };
    owner.check_current()?;
    Ok((PeerConnection(shared), owner))
}

fn peer_pidfd(stream: &UnixStream) -> io::Result<OwnedFd> {
    let mut raw: libc::c_int = -1;
    let mut size = std::mem::size_of_val(&raw) as libc::socklen_t;
    // SAFETY: integer output storage and its length are initialized. This
    // obtains the kernel peer of this very socket, never a numeric-PID lookup.
    let status = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERPIDFD,
            (&mut raw as *mut libc::c_int).cast(),
            &mut size,
        )
    };
    if status != 0 {
        let error = io::Error::last_os_error();
        return Err(match error.raw_os_error() {
            Some(libc::ENOPROTOOPT | libc::ENOSYS | libc::EINVAL) => {
                io::Error::new(io::ErrorKind::Unsupported, error)
            }
            _ => error,
        });
    }
    if raw < 0 {
        return Err(io::Error::other("kernel peer pidfd unavailable"));
    }
    // SAFETY: successful SO_PEERPIDFD returned a new owned fd. Adopt before
    // validating size so malformed output cannot leak a returned resource.
    let owned = unsafe { OwnedFd::from_raw_fd(raw) };
    if size as usize != std::mem::size_of_val(&raw) {
        return Err(io::Error::other("invalid kernel peer pidfd result"));
    }
    Ok(owned)
}

fn require_flags(fd: libc::c_int, nonblocking: bool) -> io::Result<()> {
    // SAFETY: these getters only inspect flags of a retained descriptor.
    let descriptor = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    // SAFETY: F_GETFL also only observes flags of that retained descriptor.
    let status = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if descriptor < 0 || status < 0 {
        return Err(io::Error::last_os_error());
    }
    if descriptor & libc::FD_CLOEXEC == 0 || (nonblocking && status & libc::O_NONBLOCK == 0) {
        return Err(io::Error::other("peer descriptor flags unavailable"));
    }
    Ok(())
}

fn wake_pipe() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut raw = [-1; 2];
    // SAFETY: pipe2 initializes both outputs on success, atomically setting
    // CLOEXEC/nonblocking. No F_SETFL mutation of a shared OFD is necessary.
    if unsafe { libc::pipe2(raw.as_mut_ptr(), libc::O_CLOEXEC | libc::O_NONBLOCK) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: successful pipe2 produced two new, distinct owned descriptors.
    Ok(unsafe { (OwnedFd::from_raw_fd(raw[0]), OwnedFd::from_raw_fd(raw[1])) })
}

#[cfg(test)]
mod tests;
