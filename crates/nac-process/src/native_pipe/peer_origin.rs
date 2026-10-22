//! Original direct-child identity, captured before any worker may reap it.
use crate::peer_channel::PeerLifetime;
use std::{
    io,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
};
use tokio::process::Child;

pub(super) struct ChildOrigin {
    pid: u32,
    pidfd: OwnedFd,
}
#[cfg(test)]
thread_local! { static FAIL_CAPTURE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
impl ChildOrigin {
    pub(super) fn capture(child: &Child) -> io::Result<Self> {
        #[cfg(test)]
        if FAIL_CAPTURE.with(std::cell::Cell::get) {
            return Err(io::Error::other(
                "injected original child peer capture failure",
            ));
        }
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("original child identity absent"))?;
        // SAFETY: the unreaped original Child still owns this PID. The syscall
        // returns a new CLOEXEC pidfd; failure transfers no descriptor.
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let origin = Self {
            pid,
            // SAFETY: successful pidfd_open returned this new owned descriptor.
            pidfd: unsafe { OwnedFd::from_raw_fd(fd as _) },
        };
        origin.check_current()?;
        Ok(origin)
    }
    fn check_current(&self) -> io::Result<()> {
        let mut poll = libc::pollfd {
            fd: self.pidfd.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: the original pidfd remains owned for the entire poll.
        if unsafe { libc::poll(&mut poll, 1, 0) } != 0 {
            return Err(io::Error::other(
                "original direct child is no longer current",
            ));
        }
        Ok(())
    }
    pub(super) fn require_peer(&self, peer: &PeerLifetime) -> io::Result<()> {
        self.check_current()?;
        peer.require_original_child_pid(self.pid)?;
        self.check_current()
    }
}

#[cfg(test)]
mod tests;
