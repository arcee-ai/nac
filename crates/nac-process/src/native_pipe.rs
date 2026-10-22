//! Fresh-session pipe child ownership using the existing native session worker.
//! This is unqualified process infrastructure, not sandbox or tool authority.
use crate::{NativePtyChild, NativePtyOwner, NativePtySnapshot};
use std::{
    io,
    process::{ExitStatus, Stdio},
    sync::{Arc, Mutex},
};
use tokio::{
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    time::Instant,
};
#[cfg(target_os = "linux")]
mod peer_origin;

pub struct NativePipe {
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
    pub stderr: ChildStderr,
    pub process: NativePipeOwner,
}

/// Status/control only; the existing worker exclusively owns and reaps the
/// child. Last-handle drop requests cleanup and never declares settlement.
pub struct NativePipeOwner {
    owner: NativePtyOwner,
    exit: Arc<Mutex<Option<ExitStatus>>>,
    deadline: Instant,
    #[cfg(target_os = "linux")]
    origin: Option<peer_origin::ChildOrigin>,
}

/// Actual spawn error and any already-created original process owner. Callers
/// that precharged resources must retain this cleanup, including after timeout.
pub struct NativePipeSpawnFailure {
    pub error: io::Error,
    pub process: Option<NativePipeOwner>,
}
impl From<io::Error> for NativePipeSpawnFailure {
    fn from(error: io::Error) -> Self {
        Self {
            error,
            process: None,
        }
    }
}
impl std::fmt::Debug for NativePipeSpawnFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativePipeSpawnFailure")
            .field("error", &self.error)
            .field("retains_process", &self.process.is_some())
            .finish()
    }
}
impl std::fmt::Display for NativePipeSpawnFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}
impl std::error::Error for NativePipeSpawnFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}
impl NativePipeSpawnFailure {
    fn into_error(self) -> io::Error {
        self.error
    }
}

struct SpawnedParts {
    stdin: Option<ChildStdin>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    process: NativePipeOwner,
}

struct PipeChild {
    child: Child,
    exit: Arc<Mutex<Option<ExitStatus>>>,
}

#[derive(Clone, Copy)]
enum ExecDescriptors {
    Preserve,
    #[cfg(target_os = "linux")]
    CloseExtra,
    #[cfg(target_os = "linux")]
    CloseExtraWithPeerOrigin,
    #[cfg(target_os = "linux")]
    SilentPeerOrigin,
}

impl NativePtyChild for PipeChild {
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

impl NativePipe {
    /// Spawn a fresh native session. Only explicitly set environment entries
    /// survive; the parent environment is never inherited. This does not clear
    /// arbitrary non-CLOEXEC descriptors or establish an execution compartment.
    pub fn spawn(command: Command, original_deadline: Instant) -> io::Result<Self> {
        Self::spawn_inner(command, original_deadline, ExecDescriptors::Preserve)
            .map_err(NativePipeSpawnFailure::into_error)
    }

    /// Linux opt-in: close every descriptor above stderr at exec, including
    /// inherited descriptors lacking CLOEXEC. The parent table is unchanged.
    /// Unsupported/denied kernel operations fail before the program can exec.
    ///
    /// This is descriptor inheritance hygiene, not credential/mount/procfs
    /// isolation. A compartment runner must build the command itself: arbitrary
    /// caller pre-exec hooks can run before this final barrier and are not safe
    /// inputs for an isolated child. Stdio and explicit environment remain the
    /// caller's responsibility; no trusted control resource belongs in them.
    #[cfg(target_os = "linux")]
    pub fn spawn_with_closed_fds(command: Command, original_deadline: Instant) -> io::Result<Self> {
        Self::spawn_inner(command, original_deadline, ExecDescriptors::CloseExtra)
            .map_err(NativePipeSpawnFailure::into_error)
    }

    /// Retain a pidfd for the actual direct child before transferring reaping
    /// to its worker. No PID/path/credential can manufacture this association.
    /// This is process custody only, not isolation or execution admission.
    #[cfg(target_os = "linux")]
    pub fn spawn_peer_runner(
        command: Command,
        original_deadline: Instant,
    ) -> Result<Self, NativePipeSpawnFailure> {
        Self::spawn_inner(
            command,
            original_deadline,
            ExecDescriptors::CloseExtraWithPeerOrigin,
        )
    }

    /// Control uses a separate supervision socket. Null stdio avoids allocating
    /// additional payload drain buffers outside the admitted Native plan.
    #[cfg(target_os = "linux")]
    pub fn spawn_silent_peer_runner(
        command: Command,
        original_deadline: Instant,
    ) -> Result<NativePipeOwner, NativePipeSpawnFailure> {
        Self::spawn_parts(
            command,
            original_deadline,
            ExecDescriptors::SilentPeerOrigin,
        )
        .map(|parts| parts.process)
    }

    fn spawn_inner(
        command: Command,
        original_deadline: Instant,
        descriptors: ExecDescriptors,
    ) -> Result<Self, NativePipeSpawnFailure> {
        let SpawnedParts {
            stdin,
            stdout,
            stderr,
            process,
        } = Self::spawn_parts(command, original_deadline, descriptors)?;
        match (stdin, stdout, stderr) {
            (Some(stdin), Some(stdout), Some(stderr)) => Ok(Self {
                stdin,
                stdout,
                stderr,
                process,
            }),
            _ => {
                process.request_stop_until(original_deadline);
                Err(NativePipeSpawnFailure {
                    error: io::Error::other("native pipe ports unavailable"),
                    process: Some(process),
                })
            }
        }
    }

    fn spawn_parts(
        mut command: Command,
        original_deadline: Instant,
        descriptors: ExecDescriptors,
    ) -> Result<SpawnedParts, NativePipeSpawnFailure> {
        if Instant::now() >= original_deadline {
            return Err(io::Error::other("native pipe original deadline expired").into());
        }
        NativePtyOwner::preflight()?;
        let environment = command
            .as_std()
            .get_envs()
            .filter_map(|(name, value)| {
                value.map(|value| (name.to_os_string(), value.to_os_string()))
            })
            .collect::<Vec<_>>();
        command.env_clear().envs(environment).kill_on_drop(true);
        #[cfg(target_os = "linux")]
        let silent = matches!(descriptors, ExecDescriptors::SilentPeerOrigin);
        #[cfg(not(target_os = "linux"))]
        let silent = false;
        if silent {
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
        } else {
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        }
        let cutoff = original_deadline.into_std();
        // SAFETY: the native monotonic clock, setsid and optional close_range
        // syscall require no allocation or locks. They run only in the forked
        // direct child before exec. No caller may reap after transfer below.
        unsafe {
            command.pre_exec(move || {
                if std::time::Instant::now() >= cutoff {
                    return Err(io::Error::from_raw_os_error(libc::ETIMEDOUT));
                }
                match descriptors {
                    ExecDescriptors::Preserve => {}
                    #[cfg(target_os = "linux")]
                    ExecDescriptors::CloseExtra
                    | ExecDescriptors::CloseExtraWithPeerOrigin
                    | ExecDescriptors::SilentPeerOrigin => {
                        // Marking only the child's descriptors CLOEXEC keeps
                        // Rust's spawn-error pipe open until exec or failure.
                        // No parent table changes and no fd-number discovery.
                        if libc::syscall(
                            libc::SYS_close_range,
                            3u32,
                            u32::MAX,
                            libc::CLOSE_RANGE_CLOEXEC,
                        ) != 0
                        {
                            return Err(io::Error::last_os_error());
                        }
                    }
                }
                if libc::setsid() < 0 {
                    return Err(io::Error::last_os_error());
                }
                #[cfg(target_os = "linux")]
                if matches!(
                    descriptors,
                    ExecDescriptors::CloseExtra
                        | ExecDescriptors::CloseExtraWithPeerOrigin
                        | ExecDescriptors::SilentPeerOrigin
                ) && std::time::Instant::now() >= cutoff
                {
                    return Err(io::Error::from_raw_os_error(libc::ETIMEDOUT));
                }
                Ok(())
            });
        }
        if Instant::now() >= original_deadline {
            return Err(
                io::Error::other("native pipe original deadline expired before spawn").into(),
            );
        }
        let mut child = command.spawn()?;
        #[cfg(target_os = "linux")]
        let (origin, origin_error) = if matches!(
            descriptors,
            ExecDescriptors::CloseExtraWithPeerOrigin | ExecDescriptors::SilentPeerOrigin
        ) {
            match peer_origin::ChildOrigin::capture(&child) {
                Ok(origin) => (Some(origin), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let exit = Arc::new(Mutex::new(None));
        let owner = NativePtyOwner::from_fresh_session_until(
            Box::new(PipeChild {
                child,
                exit: Arc::clone(&exit),
            }),
            Arc::new(|| {}),
            original_deadline,
        );
        let process = NativePipeOwner {
            owner,
            exit,
            deadline: original_deadline,
            #[cfg(target_os = "linux")]
            origin,
        };
        #[cfg(target_os = "linux")]
        if let Some(error) = origin_error {
            process.request_stop_until(original_deadline);
            return Err(NativePipeSpawnFailure {
                error,
                process: Some(process),
            });
        }
        Ok(SpawnedParts {
            stdin,
            stdout,
            stderr,
            process,
        })
    }
}

impl NativePipeOwner {
    /// Compare two retained original kernel resources, never caller PID data.
    #[cfg(target_os = "linux")]
    pub fn require_original_peer(
        &self,
        peer: &crate::peer_channel::PeerLifetime,
    ) -> io::Result<()> {
        self.origin
            .as_ref()
            .ok_or_else(|| io::Error::other("original child peer identity absent"))?
            .require_peer(peer)
    }
    pub fn snapshot(&self) -> NativePtySnapshot {
        self.owner.snapshot()
    }

    /// Wait for actual child AND descendant settlement. Caller cancellation
    /// leaves the worker and original automatic cutoff intact.
    pub async fn wait(&self) -> io::Result<ExitStatus> {
        self.owner.wait_for_settlement(self.deadline).await?;
        self.exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .ok_or_else(|| io::Error::other("native pipe final status unavailable"))
    }

    pub async fn terminate_until(&self, original_deadline: Instant) -> io::Result<()> {
        self.owner
            .terminate_until(original_deadline.min(self.deadline))
            .await
    }

    /// Record stop before returning, even for an expired cutoff or an unpolled
    /// caller runtime. Child/descendant settlement still requires actual reap.
    pub fn request_stop_until(&self, original_deadline: Instant) {
        self.owner
            .request_stop_until(original_deadline.min(self.deadline));
    }
}

#[cfg(test)]
mod tests;

#[cfg(all(test, target_os = "linux"))]
mod fd_tests;
