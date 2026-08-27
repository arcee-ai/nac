use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::{mpsc, Mutex};
use tokio::time::sleep;

use crate::process::ProcessTreeGuard;
use crate::sandbox::ExecutionBackend;
use crate::tools::ThreadCancellation;

use super::keyparse::parse_keys;
use super::session::{terminal_env_owned, TerminalSession};
use super::{
    ArtifactKind, CommandOutput, CommandOutputLimits, CommandStatus, OutputPage, OutputRegistry,
    OutputStream, TerminalInfo, TerminalOutput,
};

#[path = "manager_interactive.rs"]
mod interactive;
#[path = "manager_one_shot.rs"]
mod one_shot;
#[path = "manager_retention.rs"]
mod retention;

const PIPE_CHUNK_BYTES: usize = 16 * 1024;
const PIPE_CHANNEL_CHUNKS: usize = 16;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
const READER_DRAIN_GRACE: Duration = Duration::from_millis(100);
type WorkspaceAuthority = Option<(PathBuf, Vec<u8>)>;
type SessionResourceAuthority = Option<(PathBuf, String)>;

const NONINTERACTIVE_PROMPT_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "0"),
    ("GH_PROMPT_DISABLED", "1"),
];

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pending_remote_cleanups: Arc<StdMutex<HashMap<String, Arc<PendingRemoteCleanup>>>>,
    create_gate: Arc<Mutex<()>>,
    #[cfg(test)]
    one_shot_spawn_gate: Arc<Mutex<()>>,
    completed_sessions: Arc<Mutex<VecDeque<(String, CompletedTerminal)>>>,
    max_sessions: usize,
    isolate_process_groups: bool,
    output_registry: OutputRegistry,
    preserve_retained_on_settlement: bool,
    instance_id: Arc<str>,
    workspace_authority: Arc<StdMutex<WorkspaceAuthority>>,
    session_resource_authority: Arc<StdMutex<SessionResourceAuthority>>,
}

#[derive(Clone)]
struct CompletedTerminal {
    output_id: String,
    preview_cursor: u64,
    exit_code: Option<i32>,
}

struct PendingRemoteCleanup {
    backend: Arc<ExecutionBackend>,
    transport_active: AtomicBool,
}

/// Marks the local SSH/Podman launcher inactive even when the command future
/// is aborted. This value is deliberately created before the child/process
/// guard so Rust's reverse local drop order stops the transport first.
struct RemoteTransportOwnership {
    cleanup: Arc<PendingRemoteCleanup>,
}

impl RemoteTransportOwnership {
    fn stopped(&self) {
        self.cleanup.transport_active.store(false, Ordering::SeqCst);
    }
}

impl Drop for RemoteTransportOwnership {
    fn drop(&mut self) {
        self.stopped();
    }
}

impl TerminalManager {
    #[expect(
        clippy::expect_used,
        reason = "the compile-time default command output limits are validated by construction"
    )]
    pub fn new() -> Self {
        Self::with_process_group_isolation(true, false, CommandOutputLimits::default())
            .expect("default command output limits are valid")
    }

    #[expect(
        clippy::expect_used,
        reason = "the compile-time direct command output limits are validated by construction"
    )]
    pub(crate) fn for_direct() -> Self {
        Self::with_process_group_isolation(true, true, CommandOutputLimits::default())
            .expect("default command output limits are valid")
    }

    pub(crate) fn for_worker_with_limits(limits: CommandOutputLimits) -> Result<Self> {
        Self::with_process_group_isolation(true, false, limits)
    }

    #[cfg(test)]
    pub(crate) fn with_limits(limits: CommandOutputLimits) -> Result<Self> {
        Self::with_process_group_isolation(true, false, limits)
    }

    fn with_process_group_isolation(
        isolate_process_groups: bool,
        preserve_retained_on_settlement: bool,
        limits: CommandOutputLimits,
    ) -> Result<Self> {
        Ok(Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_remote_cleanups: Arc::new(StdMutex::new(HashMap::new())),
            create_gate: Arc::new(Mutex::new(())),
            #[cfg(test)]
            one_shot_spawn_gate: Arc::new(Mutex::new(())),
            completed_sessions: Arc::new(Mutex::new(VecDeque::new())),
            max_sessions: 16,
            isolate_process_groups,
            output_registry: OutputRegistry::new(limits)?,
            preserve_retained_on_settlement,
            instance_id: Arc::from(uuid::Uuid::new_v4().to_string()),
            workspace_authority: Arc::new(StdMutex::new(None)),
            session_resource_authority: Arc::new(StdMutex::new(None)),
        })
    }

    pub(crate) fn configure_workspace_authority(
        &self,
        store_path: PathBuf,
        workspace_identity: Vec<u8>,
    ) {
        *self
            .workspace_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some((store_path, workspace_identity));
    }

    pub(crate) fn configure_session_resource_authority(
        &self,
        store_path: PathBuf,
        session_id: String,
    ) {
        *self
            .session_resource_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((store_path, session_id));
    }

    pub(crate) fn acquire_workspace_activity_lease(
        &self,
    ) -> Result<Option<crate::sessions::WorkspaceActivityLease>> {
        let authority = self
            .workspace_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        authority
            .map(|(store_path, workspace_identity)| {
                crate::sessions::WorkspaceActivityLease::try_acquire(
                    &store_path,
                    &workspace_identity,
                )
                .map_err(anyhow::Error::new)
            })
            .transpose()
    }

    fn acquire_session_resource_lease(
        &self,
    ) -> Result<Option<crate::sessions::SessionResourceLease>> {
        let authority = self
            .session_resource_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        authority
            .map(|(store_path, session_id)| {
                crate::sessions::SessionResourceLease::try_acquire(&store_path, &session_id)
                    .map_err(anyhow::Error::new)
            })
            .transpose()
    }
}

struct StreamChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

async fn read_chunks<R>(
    mut reader: R,
    stream: OutputStream,
    sender: mpsc::Sender<StreamChunk>,
    shutdown: ThreadCancellation,
) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
{
    loop {
        let mut bytes = vec![0u8; PIPE_CHUNK_BYTES];
        let read = tokio::select! {
            _ = shutdown.cancelled() => return Ok(()),
            read = reader.read(&mut bytes) => read?,
        };
        if read == 0 {
            return Ok(());
        }
        bytes.truncate(read);
        let sent = tokio::select! {
            _ = shutdown.cancelled() => return Ok(()),
            sent = sender.send(StreamChunk { stream, bytes }) => sent,
        };
        if sent.is_err() {
            return Ok(());
        }
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
