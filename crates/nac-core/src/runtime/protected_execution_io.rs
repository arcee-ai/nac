//! Unqualified compartment I/O ports. None of these data types grants access.
use anyhow::Result;
use std::{
    collections::BTreeMap, ffi::OsString, future::Future, path::PathBuf, pin::Pin, time::Instant,
};
use tokio::io::{AsyncRead, AsyncWrite};

pub type CompartmentFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;
pub type CompartmentReader = Box<dyn AsyncRead + Unpin + Send>;
pub type CompartmentWriter = Box<dyn AsyncWrite + Unpin + Send>;

/// Explicit target-side inputs. Implementations must clear inherited trusted
/// environment/control FDs and bound capture to the prepared output limits.
pub struct CompartmentCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub environment: BTreeMap<OsString, OsString>,
    pub stdin: Option<Vec<u8>>,
    pub stdout_limit: usize,
    pub stderr_limit: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompartmentPtySize {
    pub cols: u16,
    pub rows: u16,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompartmentExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}
pub struct CompartmentOutput {
    pub exit: CompartmentExit,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

/// Runner-side process/descendant ownership. No trusted-host PID or Child leaks.
/// The transport must stop at the original cutoff even without a wait poll.
/// Dropped/cancelled callers leave cleanup ownership with the implementation;
/// only successful explicit reaping establishes completed cleanup.
pub trait CompartmentProcess: Send + Sync {
    fn wait(&self) -> CompartmentFuture<'_, CompartmentExit>;
    fn terminate_and_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()>;
}
pub trait CompartmentPtyProcess: CompartmentProcess {
    fn resize(&self, size: CompartmentPtySize) -> CompartmentFuture<'_, ()>;
}
pub struct CompartmentPipe {
    pub stdin: CompartmentWriter,
    pub stdout: CompartmentReader,
    pub stderr: CompartmentReader,
    pub process: Box<dyn CompartmentProcess>,
}
pub struct CompartmentPty {
    pub input: CompartmentWriter,
    pub output: CompartmentReader,
    pub process: Box<dyn CompartmentPtyProcess>,
}

/// Prepared by Core's existing canonical/revision-checked file adapters. The
/// command runs in a credential-free child, never the supervisor's own proc/FD
/// context. It confers no authority outside a consumed protected effect.
pub struct CompartmentFileIoCommand {
    command: CompartmentCommand,
}
impl CompartmentFileIoCommand {
    pub(super) fn capture_limits(&self) -> (usize, usize) {
        (self.command.stdout_limit, self.command.stderr_limit)
    }
    pub fn into_command(self) -> CompartmentCommand {
        self.command
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "protected file adapters cannot be installed before the real target is qualified"
        )
    )]
    pub(crate) fn from_prepared(command: CompartmentCommand) -> Self {
        Self { command }
    }
}

/// RAW transport, not qualification. A caller implementation, claimed UID,
/// Ready flag or receipt cannot mint a ProtectedExecutionBoundary.
/// All deadlines belong to the original trusted-side owner; no reset on reply.
/// Stream handles must close on owner invalidation. Target process and retained
/// output ownership must survive dispatch cancellation or a lost response.
pub trait ExecutionCompartmentTransport: Send + Sync {
    /// Association with the actual connection used by this actor. This is
    /// observation only, never qualification or an owner constructor. It must
    /// remain unchanged; missing/replaced association denies the private join.
    /// Reading it must not wait on protocol I/O or an asynchronous actor lock.
    #[cfg(unix)]
    fn peer_binding(&self) -> Option<nac_process::peer_channel::PeerBinding> {
        None
    }
    fn execute(
        &self,
        command: CompartmentCommand,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput>;
    fn spawn_pipe(
        &self,
        command: CompartmentCommand,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe>;
    fn spawn_pty(
        &self,
        command: CompartmentCommand,
        size: CompartmentPtySize,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty>;
    fn native_file_io(
        &self,
        operation: CompartmentFileIoCommand,
        original_deadline: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput>;
    fn close_and_reap(&self, original_deadline: Instant) -> CompartmentFuture<'_, ()>;
}
