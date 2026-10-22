//! One owned listener/spawn/accept allocation. Socket names and negotiation do
//! not consume a lifecycle lease or construct an admitted execution boundary.
use super::*;
use crate::execution_supervision::{ExecutionPeerExpectation, ExecutionSupervisionChannel};
use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use tokio::net::UnixListener;
use uuid::Uuid;

pub(in crate::execution_supervision) struct RunnerBootstrap {
    custody: Arc<IssuerRunnerCustody>,
    listener: Option<UnixListener>,
    socket: SocketOwner,
    expected: ExecutionPeerExpectation,
    connected: bool,
}
pub(in crate::execution_supervision) struct ConnectedRunner {
    channel: Option<ExecutionSupervisionChannel>,
    custody: Arc<IssuerRunnerCustody>,
    transferred: bool,
}
#[path = "../../create.rs"]
mod create;
pub use create::{NativeCreateFailure, NativeCreateJoin};
#[path = "../../managed_create_launcher.rs"]
mod production;
pub use production::{NativeCreateLaunch, NativeCreateResources};
impl ConnectedRunner {
    pub(in crate::execution_supervision) fn retain_core_join(
        self,
        construction: nac_core::runtime::NativeCreateConstruction,
        plan: ResourcePlan,
    ) -> create::NativeCreateJoin {
        create::NativeCreateJoin::retain(self, construction, plan)
    }
    /// One-way handoff into the actual private client. Dropping this pending
    /// handoff cannot leave a child waiting until a renewed connection arrives.
    pub(in crate::execution_supervision) fn into_client(
        mut self,
        plan: ResourcePlan,
    ) -> std::result::Result<
        (
            super::super::client::NativeExecutionTransport,
            nac_process::peer_channel::PeerLifetime,
        ),
        ConstructionFailure,
    > {
        let Some(channel) = self.channel.take() else {
            return Err(Arc::clone(&self.custody)
                .failed(anyhow::anyhow!("original connected runner absent")));
        };
        let result = super::super::client::NativeExecutionTransport::from_owned_runner(
            channel,
            Arc::clone(&self.custody),
            plan,
        );
        if result.is_ok() {
            self.transferred = true;
        }
        result
    }
}
impl Drop for ConnectedRunner {
    fn drop(&mut self) {
        if !self.transferred {
            self.custody.request_stop(self.custody.original_cutoff());
        }
    }
}
struct StopPending {
    owner: Arc<IssuerRunnerCustody>,
    complete: bool,
}
impl Drop for StopPending {
    fn drop(&mut self) {
        if !self.complete {
            self.owner.request_stop(self.owner.original_cutoff());
        }
    }
}

impl RunnerBootstrap {
    /// The actual factory must supply the qualified command, trusted runtime
    /// directory, original consumed owner, and two distinct original holds.
    /// This private method creates no authority from those scalar inputs.
    pub(in crate::execution_supervision) fn spawn(
        command: Command,
        plan: ResourcePlan,
        client: CompartmentStorageHold,
        runner: CompartmentStorageHold,
        original: Instant,
        runtime_directory: &Path,
        expected: ExecutionPeerExpectation,
    ) -> std::result::Result<Self, ConstructionFailure> {
        let custody = IssuerRunnerCustody::prepare(plan, client, runner, original);
        Self::spawn_owned(command, custody, runtime_directory, expected)
    }
    /// Same prepared allocation, registered by the production launch owner
    /// before first listener/spawn. This is resource custody, never admission.
    fn spawn_owned(
        mut command: Command,
        custody: Arc<IssuerRunnerCustody>,
        runtime_directory: &Path,
        expected: ExecutionPeerExpectation,
    ) -> std::result::Result<Self, ConstructionFailure> {
        let built = (|| {
            custody.check_current()?;
            // SAFETY: geteuid only observes this issuer process's identity.
            let issuer_uid = unsafe { libc::geteuid() };
            ensure!(
                expected.uid != 0 && expected.gid != 0 && expected.uid != issuer_uid,
                "bootstrap requires the original nonroot cross-UID peer"
            );
            ensure!(
                custody.plan.declaration() == custody.client_storage.declaration()
                    && custody.plan.declaration() == custody.storage.declaration(),
                "bootstrap storage mismatch"
            );
            // Both original charges are retained BEFORE this first listener.
            let socket = SocketOwner::create(runtime_directory)?;
            let listener = UnixListener::bind(&socket.path)?;
            let mut socket = socket;
            socket.capture_socket()?;
            // No other actor can modify the enclosing issuer-owned directory.
            // A foreign connector can only deny this one attempt, never enter.
            fs::set_permissions(&socket.path, fs::Permissions::from_mode(0o666))?;
            socket.check_current()?;
            command.env("NAC_EXECUTION_SUPERVISION_SOCKET", &socket.path);
            custody.start(command)?;
            Ok::<_, anyhow::Error>((listener, socket))
        })();
        match built {
            Ok((listener, socket)) => Ok(Self {
                custody,
                listener: Some(listener),
                socket,
                expected,
                connected: false,
            }),
            Err(error) => Err(custody.failed(error)),
        }
    }
    /// Consumes the one accept attempt BEFORE first await. Error/cancellation
    /// permanently stops the original child; a second connection cannot retry.
    pub(in crate::execution_supervision) fn connect(
        &mut self,
        boot: Uuid,
    ) -> impl std::future::Future<Output = std::result::Result<ConnectedRunner, ConstructionFailure>> + '_
    {
        // These resources enter the returned future BEFORE it is first polled.
        let pending = StopPending {
            owner: Arc::clone(&self.custody),
            complete: false,
        };
        let listener = self.listener.take();
        async move {
            // Move the WHOLE Drop guard, not only its `complete` field, into
            // the future. Disjoint-field capture would stop at method return.
            let mut pending = pending;
            let result = self.negotiate_original(listener, boot).await;
            match result {
                Ok(channel) => {
                    pending.complete = true;
                    self.connected = true;
                    Ok(ConnectedRunner {
                        channel: Some(channel),
                        custody: Arc::clone(&self.custody),
                        transferred: false,
                    })
                }
                Err(error) => Err(Arc::clone(&self.custody).failed(error)),
            }
        }
    }
    async fn negotiate_original(
        &self,
        listener: Option<UnixListener>,
        boot: Uuid,
    ) -> Result<ExecutionSupervisionChannel> {
        self.custody.check_current()?;
        self.socket.check_current()?;
        let listener =
            listener.ok_or_else(|| anyhow::anyhow!("runner bootstrap already consumed"))?;
        let source = self.custody.plan.retained_policy_source()?;
        let stop = self.custody.stop.changed.notified();
        tokio::pin!(stop);
        stop.as_mut().enable();
        let cutoff = self.custody.original_cutoff();
        let (stream, _) = tokio::select! { biased;
            _ = source.retired() => anyhow::bail!("runner original policy retired"),
            _ = &mut stop => anyhow::bail!("runner original custody stopped"),
            _ = tokio::time::sleep_until(cutoff.into()) => anyhow::bail!("runner original accept cutoff expired"),
            accepted = listener.accept() => accepted?,
        };
        drop(listener);
        self.socket.check_current()?;
        let mut channel = ExecutionSupervisionChannel::capture(
            stream,
            ExecutionPeerExpectation {
                uid: self.expected.uid,
                gid: self.expected.gid,
            },
            cutoff.into(),
        )?;
        // Reject a foreign process with even the expected UID/GID BEFORE
        // allowing it to enter the protocol handshake.
        self.custody
            .require_peer(&channel.peer, &self.custody.plan)?;
        tokio::select! { biased;
            _ = source.retired() => anyhow::bail!("runner original policy retired"),
            _ = &mut stop => anyhow::bail!("runner original custody stopped"),
            _ = tokio::time::sleep_until(cutoff.into()) => anyhow::bail!("runner original negotiation cutoff expired"),
            negotiated = channel.negotiate_execution(boot,true) => { negotiated?; },
        }
        self.custody
            .require_peer(&channel.peer, &self.custody.plan)?;
        self.socket.check_current()?;
        Ok::<_, anyhow::Error>(channel)
    }
}
impl Drop for RunnerBootstrap {
    fn drop(&mut self) {
        // After a successful transfer the actual client owns cleanup. Before it,
        // including never-polled connect, this owner must stop the child.
        if !self.connected {
            self.custody.request_stop(self.custody.original_cutoff());
        }
    }
}

struct SocketOwner {
    parent: PathBuf,
    parent_file: File,
    directory: PathBuf,
    directory_file: File,
    path: PathBuf,
    socket_identity: Option<(u64, u64)>,
}
fn directory(path: &Path) -> Result<File> {
    ensure!(path.is_absolute(), "runtime directory must be absolute");
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open(path)?;
    let meta = file.metadata()?;
    // SAFETY: geteuid observes the current issuer identity.
    let uid = unsafe { libc::geteuid() };
    ensure!(
        meta.is_dir() && (meta.uid() == uid || meta.uid() == 0) && meta.mode() & 0o022 == 0,
        "runtime directory is not protected"
    );
    Ok(file)
}
fn matches(file: &File, path: &Path) -> Result<bool> {
    let held = file.metadata()?;
    let current = fs::symlink_metadata(path)?;
    // SAFETY: geteuid observes only the current issuer's identity.
    let uid = unsafe { libc::geteuid() };
    Ok(current.is_dir()
        && [0, uid].contains(&current.uid())
        && current.mode() & 0o022 == 0
        && held.uid() == current.uid()
        && held.dev() == current.dev()
        && held.ino() == current.ino())
}
impl SocketOwner {
    fn create(parent: &Path) -> Result<Self> {
        let parent_file = directory(parent)?;
        ensure!(matches(&parent_file, parent)?, "runtime directory changed");
        let dir = parent.join(format!("r-{}", Uuid::new_v4().simple()));
        use std::os::unix::ffi::OsStrExt;
        ensure!(
            dir.join("c.sock").as_os_str().as_bytes().len() < 108,
            "bootstrap socket path exceeds Linux bound"
        );
        fs::DirBuilder::new().mode(0o711).create(&dir)?;
        let directory_file = directory(&dir)?;
        let owner = Self {
            parent: parent.to_owned(),
            parent_file,
            path: dir.join("c.sock"),
            directory: dir,
            directory_file,
            socket_identity: None,
        };
        owner.check_current()?;
        Ok(owner)
    }
    fn capture_socket(&mut self) -> Result<()> {
        let meta = fs::symlink_metadata(&self.path)?;
        ensure!(
            meta.file_type().is_socket(),
            "bootstrap socket identity absent"
        );
        self.socket_identity = Some((meta.dev(), meta.ino()));
        Ok(())
    }
    fn check_current(&self) -> Result<()> {
        ensure!(
            matches(&self.parent_file, &self.parent)?
                && matches(&self.directory_file, &self.directory)?,
            "bootstrap directory replaced"
        );
        if let Some(identity) = self.socket_identity {
            let meta = fs::symlink_metadata(&self.path)?;
            ensure!(
                meta.file_type().is_socket() && (meta.dev(), meta.ino()) == identity,
                "bootstrap socket replaced"
            );
        }
        Ok(())
    }
}
impl Drop for SocketOwner {
    fn drop(&mut self) {
        if !matches(&self.parent_file, &self.parent).unwrap_or(false)
            || !matches(&self.directory_file, &self.directory).unwrap_or(false)
        {
            return;
        }
        if let Some(identity) = self.socket_identity {
            if let Ok(meta) = fs::symlink_metadata(&self.path) {
                if meta.file_type().is_socket() && (meta.dev(), meta.ino()) == identity {
                    let _ = fs::remove_file(&self.path);
                }
            }
        }
        let _ = fs::remove_dir(&self.directory); // Never recursive or replacement deletion.
    }
}

#[cfg(test)]
mod tests;
