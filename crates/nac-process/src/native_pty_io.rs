//! Linux PTY descriptors around the existing exclusive fresh-session owner.
//! Descriptor hygiene is not credential, mount, procfs or sandbox isolation.
use crate::{NativePtyChild, NativePtyOwner, NativePtySnapshot};
use std::{
    fs::File,
    io,
    os::fd::{AsRawFd, FromRawFd},
    pin::Pin,
    process::{ExitStatus, Stdio},
    sync::{Arc, Mutex},
    task::{Context, Poll},
};
use tokio::{
    io::{unix::AsyncFd, AsyncRead, AsyncWrite, ReadBuf},
    process::{Child, Command},
    time::Instant,
};

pub struct NativePty {
    pub input: NativePtyInput,
    pub output: NativePtyOutput,
    pub process: NativePtyProcess,
}
pub struct NativePtyInput {
    master: Arc<AsyncFd<File>>,
    closed: bool,
}
pub struct NativePtyOutput(Arc<AsyncFd<File>>);
pub struct NativePtyProcess {
    owner: NativePtyOwner,
    exit: Arc<Mutex<Option<ExitStatus>>>,
    master: Arc<AsyncFd<File>>,
    deadline: Instant,
}
struct PtyChild {
    child: Child,
    exit: Arc<Mutex<Option<ExitStatus>>>,
}
impl NativePtyChild for PtyChild {
    fn process_id(&self) -> Option<u32> {
        self.child.id()
    }
    fn try_wait(&mut self) -> io::Result<Option<i32>> {
        let Some(status) = self.child.try_wait()? else {
            return Ok(None);
        };
        *self
            .exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(status);
        Ok(Some(status.code().unwrap_or(1)))
    }
}

impl NativePty {
    /// Explicit environment, fresh controlling terminal/session, CLOEXEC from
    /// descriptor creation, and close-range barrier at exec. Unsupported kernel
    /// operations fail before exec. Caller pre-exec hooks are not safe inputs:
    /// an isolated runner must construct this command itself from closed data.
    pub fn spawn_with_closed_fds(
        mut command: Command,
        rows: u16,
        cols: u16,
        original_deadline: Instant,
    ) -> io::Result<Self> {
        current(original_deadline)?;
        NativePtyOwner::preflight()?;
        let dimensions = dimensions(rows, cols)?;
        // SAFETY: flags are valid; the returned descriptor is immediately owned.
        let descriptor = unsafe {
            libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY | libc::O_NONBLOCK | libc::O_CLOEXEC)
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: posix_openpt returned this unique descriptor.
        let master = unsafe { File::from_raw_fd(descriptor) };
        // SAFETY: all calls operate on the live owned PTY master.
        if unsafe { libc::grantpt(descriptor) } != 0 || unsafe { libc::unlockpt(descriptor) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let mut name = [0 as libc::c_char; libc::PATH_MAX as usize];
        // SAFETY: the buffer length matches the actual writable allocation.
        let error = unsafe { libc::ptsname_r(descriptor, name.as_mut_ptr(), name.len()) };
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error));
        }
        // SAFETY: successful ptsname_r wrote a NUL-terminated path. O_NOFOLLOW
        // refuses a substituted symlink; the actual slave is opened CLOEXEC.
        let slave_fd = unsafe {
            libc::open(
                name.as_ptr(),
                libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if slave_fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: open returned this unique descriptor.
        let slave = unsafe { File::from_raw_fd(slave_fd) };
        // SAFETY: a valid winsize pointer and live PTY descriptor.
        if unsafe { libc::ioctl(descriptor, libc::TIOCSWINSZ, &dimensions) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let master = Arc::new(AsyncFd::new(master)?);
        let environment = command
            .as_std()
            .get_envs()
            .filter_map(|(name, value)| {
                value.map(|value| (name.to_os_string(), value.to_os_string()))
            })
            .collect::<Vec<_>>();
        command
            .env_clear()
            .envs(environment)
            .stdin(Stdio::from(slave.try_clone()?))
            .stdout(Stdio::from(slave.try_clone()?))
            .stderr(Stdio::from(slave))
            .kill_on_drop(true);
        let cutoff = original_deadline.into_std();
        // SAFETY: only monotonic time and async-signal-safe syscalls execute in
        // the forked child. Rust maps stdio before this hook. The spawn-error
        // pipe remains available until exec because close_range uses CLOEXEC.
        unsafe {
            command.pre_exec(move || {
                if std::time::Instant::now() >= cutoff {
                    return Err(io::Error::from_raw_os_error(libc::ETIMEDOUT));
                }
                if libc::setsid() < 0
                    || libc::ioctl(libc::STDIN_FILENO, libc::TIOCSCTTY, 0) < 0
                    || libc::syscall(
                        libc::SYS_close_range,
                        3u32,
                        u32::MAX,
                        libc::CLOSE_RANGE_CLOEXEC,
                    ) != 0
                {
                    return Err(io::Error::last_os_error());
                }
                if std::time::Instant::now() >= cutoff {
                    return Err(io::Error::from_raw_os_error(libc::ETIMEDOUT));
                }
                Ok(())
            });
        }
        current(original_deadline)?;
        let child = command.spawn()?;
        let exit = Arc::new(Mutex::new(None));
        let owner = NativePtyOwner::from_fresh_session_until(
            Box::new(PtyChild {
                child,
                exit: Arc::clone(&exit),
            }),
            Arc::new(|| {}),
            original_deadline,
        );
        Ok(Self {
            input: NativePtyInput {
                master: Arc::clone(&master),
                closed: false,
            },
            output: NativePtyOutput(Arc::clone(&master)),
            process: NativePtyProcess {
                owner,
                exit,
                master,
                deadline: original_deadline,
            },
        })
    }
}

impl NativePtyProcess {
    pub fn snapshot(&self) -> NativePtySnapshot {
        self.owner.snapshot()
    }
    pub async fn wait(&self) -> io::Result<ExitStatus> {
        self.owner.wait_for_settlement(self.deadline).await?;
        self.exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .ok_or_else(|| io::Error::other("native PTY final status unavailable"))
    }
    /// Completion means the ioctl completed, never merely that a wire record
    /// was queued. A failed/expired result does not prove child settlement.
    pub fn resize(&self, rows: u16, cols: u16) -> io::Result<()> {
        current(self.deadline)?;
        let size = dimensions(rows, cols)?;
        // SAFETY: master remains owned and size is a valid winsize.
        if unsafe { libc::ioctl(self.master.get_ref().as_raw_fd(), libc::TIOCSWINSZ, &size) } < 0 {
            return Err(io::Error::last_os_error());
        }
        current(self.deadline)
    }
    pub fn request_stop_until(&self, original_deadline: Instant) {
        self.owner
            .request_stop_until(original_deadline.min(self.deadline));
    }
    pub async fn terminate_until(&self, original_deadline: Instant) -> io::Result<()> {
        self.owner
            .terminate_until(original_deadline.min(self.deadline))
            .await
    }
}

fn current(deadline: Instant) -> io::Result<()> {
    if Instant::now() >= deadline {
        return Err(io::Error::other("native PTY original deadline expired"));
    }
    Ok(())
}
fn dimensions(rows: u16, cols: u16) -> io::Result<libc::winsize> {
    if rows == 0 || cols == 0 {
        return Err(io::Error::other("invalid native PTY dimensions"));
    }
    Ok(libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    })
}

impl AsyncRead for NativePtyOutput {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        loop {
            let mut readiness = std::task::ready!(self.0.poll_read_ready(cx))?;
            match readiness.try_io(|fd| {
                let target = buf.initialize_unfilled();
                // SAFETY: target points into the actual initialized ReadBuf.
                let count = unsafe {
                    libc::read(
                        fd.get_ref().as_raw_fd(),
                        target.as_mut_ptr().cast(),
                        target.len(),
                    )
                };
                if count < 0 {
                    let error = io::Error::last_os_error();
                    // Linux PTY hangup after the last slave closes is EIO.
                    if error.raw_os_error() == Some(libc::EIO) {
                        return Ok(0);
                    }
                    return Err(error);
                }
                Ok(count as usize)
            }) {
                Ok(Ok(count)) => {
                    buf.advance(count);
                    return Poll::Ready(Ok(()));
                }
                Ok(Err(error)) if error.kind() == io::ErrorKind::Interrupted => continue,
                Ok(Err(error)) => return Poll::Ready(Err(error)),
                Err(_) => continue,
            }
        }
    }
}
impl AsyncWrite for NativePtyInput {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.closed {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "native PTY input closed",
            )));
        }
        if data.is_empty() {
            return Poll::Ready(Ok(0));
        }
        loop {
            let mut readiness = std::task::ready!(self.master.poll_write_ready(cx))?;
            match readiness.try_io(|fd| {
                // SAFETY: data is readable for its actual length.
                let count = unsafe {
                    libc::write(fd.get_ref().as_raw_fd(), data.as_ptr().cast(), data.len())
                };
                if count < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(count as usize)
                }
            }) {
                Ok(Err(error)) if error.kind() == io::ErrorKind::Interrupted => continue,
                Ok(result) => return Poll::Ready(result),
                Err(_) => continue,
            }
        }
    }
    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        // Master input has no half-close. Never inject terminal characters or
        // an exit command: the runner closes its logical input state instead.
        self.closed = true;
        Poll::Ready(Ok(()))
    }
}

#[cfg(test)]
mod tests;
