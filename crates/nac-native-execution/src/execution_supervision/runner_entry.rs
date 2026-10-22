//! Fixed credential-free child entry. No public job/transport factory, runtime
//! configuration, credentials, catalog, model or provider initialization runs.
use super::{
    issuer_child_storage::{RunnerInput, INPUT_ENV, SOCKET_ENV},
    resources::StorageCharge,
    runner::NativeRunner,
};
use crate::execution_supervision::{ExecutionSupervisionChannel, NegotiatedProtocol};
use anyhow::{ensure, Context, Result};
use std::{path::PathBuf, time::Instant};
use tokio::net::UnixStream;

pub(in crate::execution_supervision) async fn run() -> Result<()> {
    ensure!(
        std::env::args_os().len() == 1,
        "fixed runner accepts no arguments"
    );
    // SAFETY: all calls only observe this child's inherited credentials.
    let credentials = unsafe {
        (
            libc::getuid(),
            libc::geteuid(),
            libc::getgid(),
            libc::getegid(),
            libc::getgroups(0, std::ptr::null_mut()),
            libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0),
        )
    };
    ensure!(
        credentials.0 != 0 && credentials.1 != 0 && credentials.2 != 0 && credentials.3 != 0,
        "runner must already be unprivileged"
    );
    ensure!(
        credentials.4 == 0 && credentials.5 == 1,
        "runner credential preflight absent"
    );
    let input =
        RunnerInput::decode(&std::env::var(INPUT_ENV).context("runner launch input absent")?)?;
    let socket =
        PathBuf::from(std::env::var_os(SOCKET_ENV).context("original runner socket absent")?);
    ensure!(socket.is_absolute(), "runner socket must be absolute");
    let cutoff = input.cutoff()?;
    let stream = tokio::time::timeout_at(cutoff.into(), UnixStream::connect(socket)).await??;
    let mut channel = capture_original_parent(stream, cutoff)?;
    tokio::time::timeout_at(
        cutoff.into(),
        channel.negotiate_execution(input.boot(), false),
    )
    .await??;
    ensure!(
        channel.protocol == Some(NegotiatedProtocol::Execution),
        "original runner negotiation absent"
    );
    let (plan, storage) = input.limits()?.validate()?.bind_issuer_storage(&channel)?;
    ensure!(
        matches!(storage, StorageCharge::IssuerRetained(_)),
        "original issuer storage absent"
    );
    let (runner, peer) = match NativeRunner::construct(
        channel,
        plan,
        storage,
        super::construction::BuildControl::Normal,
    ) {
        Ok(runner) => runner,
        Err(failure) => {
            // No target effects can survive a returning fixed child. The
            // issuer separately owns/reaps this process and its descendants.
            let result = nac_core::runtime::ExecutionCompartmentTransport::close_and_reap(
                &failure.cleanup,
                cutoff,
            )
            .await;
            result?;
            return Err(failure.error);
        }
    };
    peer.invalidated().await;
    // Retain the exact peer and all actor/child storage while real cleanup
    // joins. Its denial alone is never treated as physical settlement.
    let result = runner.close_and_reap(cutoff).await;
    drop(peer);
    result
}
fn capture_original_parent(
    stream: UnixStream,
    cutoff: Instant,
) -> Result<ExecutionSupervisionChannel> {
    let (stream, peer) = nac_process::peer_channel::capture(stream, cutoff)?;
    peer.require_original_parent()?;
    ensure!(
        peer.credentials().uid == 0,
        "runner issuer is not the original privileged parent"
    );
    Ok(ExecutionSupervisionChannel {
        stream,
        peer,
        denied: std::sync::atomic::AtomicBool::new(false),
        negotiated: false,
        protocol: None,
    })
}
