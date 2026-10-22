//! Native framing over one actual inward connection and kernel peer lifetime.
//! This transport cannot qualify a protected boundary or dispatch/authorize work.
use anyhow::{bail, Context, Result};
use nac_process::peer_channel::{self, PeerBinding, PeerConnection, PeerDenial, PeerLifetime};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::UnixStream,
    time::Instant,
};
use uuid::Uuid;

#[expect(
    dead_code,
    reason = "private actor awaits actual Core qualification and production installation"
)]
mod actor;
#[cfg(target_os = "linux")]
pub(crate) use actor::run_original_native_child;
#[cfg(target_os = "linux")]
pub use actor::{NativeCreateFailure, NativeCreateJoin, NativeCreateLaunch, NativeCreateResources};

#[expect(
    dead_code,
    reason = "private buffered streams are installed only in the unqualified private actor"
)]
mod buffered_io;
mod handshake;
#[expect(
    dead_code,
    reason = "private v2 codec is installed only in the unqualified private actor"
)]
mod job_wire;
mod poll_wake;
mod protocol;
mod task_set;
#[expect(
    dead_code,
    reason = "private continuous frame pump awaits job dispatch"
)]
mod wire_pump;
use protocol::Frame;

const PROTOCOL: &str = "nac-protected-execution-v1";
const EXECUTION_PROTOCOL: &str = "nac-protected-execution-v2";
const MAX_FRAME: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq)]
enum NegotiatedProtocol {
    Observation,
    Execution,
}
impl NegotiatedProtocol {
    fn wire(self) -> &'static str {
        match self {
            Self::Observation => PROTOCOL,
            Self::Execution => EXECUTION_PROTOCOL,
        }
    }
}

/// Expected kernel identity is an input for comparison, never topology proof.
pub struct ExecutionPeerExpectation {
    pub uid: u32,
    pub gid: u32,
}

/// One actual paired inward owner/I/O allocation. No reconnect, credential
/// transfer, generic file/command RPC or positive Core capability.
pub struct ExecutionSupervisionChannel {
    stream: PeerConnection,
    peer: PeerLifetime,
    denied: AtomicBool,
    negotiated: bool,
    protocol: Option<NegotiatedProtocol>,
}

impl ExecutionSupervisionChannel {
    /// Capture actual kernel resources. Native's nonroot cross-UID/GID policy
    /// stays here; unsupported hosts/kernels never use a PID-string fallback.
    pub fn capture(
        stream: UnixStream,
        expected: ExecutionPeerExpectation,
        deadline: Instant,
    ) -> Result<Self> {
        // SAFETY: geteuid only observes this process's current identity.
        if expected.uid == 0 || expected.gid == 0 || expected.uid == unsafe { libc::geteuid() } {
            bail!("execution supervision kernel peer mismatch");
        }
        let (stream, peer) = peer_channel::capture(stream, deadline.into_std())
            .context("execution supervision peer lifetime unavailable")?;
        let actual = peer.credentials();
        if actual.uid != expected.uid || actual.gid != expected.gid {
            bail!("execution supervision kernel peer mismatch");
        }
        let channel = Self {
            stream,
            peer,
            denied: AtomicBool::new(false),
            negotiated: false,
            protocol: None,
        };
        channel.check_current()?;
        Ok(channel)
    }

    /// Only a version/nonce exchange. Success cannot mint Core's private
    /// boundary, establish isolation or admit execution.
    pub async fn negotiate(&mut self, boot_id: Uuid, initiator: bool) -> Result<Uuid> {
        self.negotiate_protocol(boot_id, initiator, NegotiatedProtocol::Observation)
            .await
    }

    // Only the private Linux actor constructor may choose this phase. No
    // public selector or v1 receipt can mark an actual channel as v2.
    #[cfg(target_os = "linux")]
    async fn negotiate_execution(&mut self, boot_id: Uuid, initiator: bool) -> Result<Uuid> {
        self.negotiate_protocol(boot_id, initiator, NegotiatedProtocol::Execution)
            .await
    }

    async fn negotiate_protocol(
        &mut self,
        boot_id: Uuid,
        initiator: bool,
        protocol: NegotiatedProtocol,
    ) -> Result<Uuid> {
        let result = self.negotiate_checked(boot_id, initiator, protocol).await;
        if result.is_err() {
            self.denied.store(true, Ordering::Release);
            self.peer.deny();
        }
        result
    }

    async fn negotiate_checked(
        &mut self,
        boot_id: Uuid,
        initiator: bool,
        protocol: NegotiatedProtocol,
    ) -> Result<Uuid> {
        self.check_current()?;
        if self.negotiated || boot_id.is_nil() {
            bail!("execution supervision negotiation unavailable");
        }
        self.negotiated = true;
        self.denied.store(true, Ordering::Release);
        let mut pending = PendingNegotiation {
            denial: self.peer.denial_handle(),
            completed: false,
        };
        let peer_boot = tokio::select! {
            result = handshake::exchange(&mut self.stream, boot_id, initiator, protocol.wire()) => result?,
            _ = self.peer.invalidated() => bail!("execution supervision original peer lifetime ended"),
        };
        self.peer.check_current()?;
        self.denied.store(false, Ordering::Release);
        self.check_current()?;
        self.protocol = Some(protocol);
        pending.completed = true;
        Ok(peer_boot)
    }

    pub fn check_current(&self) -> Result<()> {
        if self.denied.load(Ordering::Acquire) {
            bail!("execution supervision unavailable");
        }
        let result = self.peer.check_current().map_err(Into::into);
        if result.is_err() {
            self.denied.store(true, Ordering::Release);
        }
        result
    }

    /// Association only. A copied binding neither proves the protocol nor
    /// constructs the unique inward lifetime or a Core boundary.
    pub fn binding(&self) -> PeerBinding {
        self.stream.binding()
    }

    /// Transfer the matched gated I/O and unique inward owner after the same
    /// original handshake. There is no raw stream/descriptor extraction, new
    /// capture, deadline budget or positive execution qualification here.
    pub fn into_peer_parts(self) -> Result<(PeerConnection, PeerLifetime)> {
        self.check_current()?;
        if !self.negotiated {
            bail!("execution supervision has not negotiated");
        }
        Ok((self.stream, self.peer))
    }

    fn into_execution_parts(self) -> Result<(PeerConnection, PeerLifetime)> {
        if self.protocol != Some(NegotiatedProtocol::Execution) {
            bail!("execution supervision has not negotiated v2");
        }
        self.into_peer_parts()
    }
}

struct PendingNegotiation {
    denial: PeerDenial,
    completed: bool,
}
impl Drop for PendingNegotiation {
    fn drop(&mut self) {
        if !self.completed {
            self.denial.deny();
        }
    }
}

async fn read_frame(stream: &mut (impl AsyncRead + Unpin + Send)) -> Result<Frame> {
    let size = stream.read_u32().await? as usize;
    if size == 0 || size > MAX_FRAME {
        bail!("execution supervision frame exceeds bound");
    }
    let mut raw = vec![0; size];
    stream.read_exact(&mut raw).await?;
    let frame: Frame =
        serde_json::from_slice(&raw).context("invalid execution supervision frame")?;
    frame.validate()?;
    Ok(frame)
}

async fn write_frame(stream: &mut (impl AsyncWrite + Unpin + Send), frame: &Frame) -> Result<()> {
    frame.validate()?;
    let raw = serde_json::to_vec(frame)?;
    if raw.is_empty() || raw.len() > MAX_FRAME {
        bail!("execution supervision frame exceeds bound");
    }
    stream.write_u32(raw.len().try_into()?).await?;
    stream.write_all(&raw).await?;
    Ok(())
}

#[cfg(test)]
#[path = "execution_supervision_tests.rs"]
mod tests;
