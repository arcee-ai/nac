//! Private opt-in bundled-engine composition. This channel identifies one launch;
//! it grants no HTTP authentication, human capability or agent permission.
use std::{
    io::{BufRead, BufReader, Write},
    net::{Shutdown, SocketAddr},
    os::{fd::FromRawFd, unix::net::UnixStream},
    path::Path,
    time::Duration,
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::{
    application::managed::ManagedReadinessPolicy, build_identity, delivery::server, BindPolicy,
    SessionManager,
};

const VERSION: u32 = 1;
const LIMIT: usize = 16 * 1024;
const FD_ENV: &str = "NAC_DESKTOP_CHANNEL_FD";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Identity {
    product_version: String,
    build_id: String,
    source_revision: String,
    track: String,
}

impl Identity {
    fn current() -> Self {
        let build = build_identity::current();
        Self {
            product_version: build.product_version.into(),
            build_id: build.build_id.into(),
            source_revision: build.source_revision.into(),
            track: build.track.into(),
        }
    }
}

/// Written into the bundle by its builder using the exact bundled executable.
pub fn identity_json() -> Result<String> {
    Ok(serde_json::to_string(&Identity::current())?)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Hello {
    kind: String,
    version: u32,
    incarnation: String,
    identity: Identity,
    store: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Stop {
    kind: String,
    version: u32,
    incarnation: String,
}

/// Bounded even when the peer never sends a newline. A partial final record is
/// an error, never a receipt. No peer-controlled bytes are included in errors.
fn read_record(reader: &mut impl BufRead) -> Result<Vec<u8>> {
    let mut record = Vec::new();
    loop {
        let bytes = reader.fill_buf()?;
        if bytes.is_empty() {
            bail!("desktop channel closed");
        }
        let count = bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |n| n + 1);
        if record.len() + count > LIMIT {
            bail!("desktop record too large");
        }
        record.extend_from_slice(&bytes[..count]);
        reader.consume(count);
        if record.last() == Some(&b'\n') {
            return Ok(record);
        }
    }
}

pub struct DesktopLaunch {
    stream: UnixStream,
    stopped: watch::Receiver<bool>,
    stop: watch::Sender<bool>,
    incarnation: String,
    expected_store: String,
    complete: std::sync::mpsc::Sender<()>,
}

impl DesktopLaunch {
    /// Adopt before constructing managers or launching any helper. Both the
    /// adopted endpoint and every clone are CLOEXEC before descendant spawn.
    pub fn inherit() -> Result<Option<Self>> {
        let Some(raw) = std::env::var_os(FD_ENV) else {
            return Ok(None);
        };
        // SAFETY: only startup calls this, before application/helper construction.
        unsafe {
            std::env::remove_var(FD_ENV);
        }
        let fd: i32 = raw
            .to_str()
            .context("invalid desktop descriptor")?
            .parse()?;
        if fd < 3 {
            bail!("invalid desktop descriptor");
        }
        // SAFETY: explicit private launch mode transfers this inherited descriptor.
        let stream = unsafe { UnixStream::from_raw_fd(fd) };
        Self::adopt(stream).map(Some)
    }

    fn adopt(stream: UnixStream) -> Result<Self> {
        use std::os::fd::AsRawFd;
        let fd = stream.as_raw_fd();
        // SAFETY: fcntl acts on the descriptor now exclusively owned by stream.
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        stream
            .peer_addr()
            .context("desktop channel must be a connected Unix socket")?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(1)))?;
        let mut reader = BufReader::with_capacity(LIMIT, stream.try_clone()?);
        let hello: Hello = serde_json::from_slice(&read_record(&mut reader)?)
            .map_err(|_| anyhow::anyhow!("invalid desktop hello"))?;
        if hello.kind != "hello"
            || hello.version != VERSION
            || hello.identity != Identity::current()
            || hello.incarnation.len() != 36
            || uuid::Uuid::parse_str(&hello.incarnation).is_err()
            || !Path::new(&hello.store).is_absolute()
        {
            bail!("desktop launch identity mismatch");
        }
        stream.set_read_timeout(None)?;
        let (stop, stopped) = watch::channel(false);
        let (complete, completed) = std::sync::mpsc::channel();
        let launch = Self {
            stream,
            stop: stop.clone(),
            stopped,
            incarnation: hello.incarnation.clone(),
            expected_store: hello.store,
            complete,
        };
        std::thread::Builder::new()
            .name("nac-desktop-parent".into())
            .spawn(move || {
                // Only the exact incarnation may issue stop. Any malformed record,
                // duplicate hello, truncated record or EOF also fails closed.
                let _valid_stop = read_record(&mut reader)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Stop>(&bytes).ok())
                    .is_some_and(|record| {
                        record.kind == "stop"
                            && record.version == VERSION
                            && record.incarnation == hello.incarnation
                    });
                let _ = stop.send(true);
                // Cover parent loss during manager/migration construction as
                // well as serving. Graceful settlement remains the server's
                // owner; this outer cap starts at loss, independent of Tokio.
                if completed
                    .recv_timeout(crate::COMPLETE_SHUTDOWN_TIMEOUT)
                    .is_err()
                {
                    server::forced_shutdown_after_timeout(crate::COMPLETE_SHUTDOWN_TIMEOUT, || {
                        std::process::exit(0)
                    });
                }
            })?;
        Ok(launch)
    }

    fn send(&self, value: serde_json::Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        if bytes.len() > LIMIT {
            bail!("desktop record too large");
        }
        let mut writer = &self.stream;
        writer.write_all(&bytes)?;
        Ok(())
    }

    /// Deliberately constant diagnostics: configuration, credentials and raw
    /// migration/provider errors never cross into a receipt or native log.
    pub fn failed(&self) {
        let _ = self.send(serde_json::json!({"kind":"failed", "version":VERSION,
            "incarnation":self.incarnation, "stage":"startup", "code":"engine_unavailable",
            "message":"The bundled engine could not initialize its selected store or listener."}));
    }

    pub async fn serve(&self, addr: SocketAddr, manager: SessionManager) -> Result<()> {
        if !addr.ip().is_loopback() || addr.port() != 0 || manager.managed_host().is_some() {
            bail!("desktop launch requires a local ephemeral listener");
        }
        let info = manager.store_info();
        let store = info.store_path.canonicalize()?;
        if store.to_str() != Some(&self.expected_store) {
            bail!("desktop selected store mismatch");
        }
        let mut stopped = self.stopped.clone();
        let shutdown = async move {
            tokio::select! {
                () = server::shutdown_signal() => {},
                _ = async { while !*stopped.borrow_and_update() { if stopped.changed().await.is_err() { break; } } } => {},
            }
        };
        server::serve_with_lifecycle(
            addr,
            BindPolicy::LoopbackOnly,
            manager,
            |bound| {
                if *self.stopped.borrow() {
                    return;
                }
                if self
                    .send(serde_json::json!({"kind":"ready", "version":VERSION,
                "incarnation":self.incarnation, "endpoint":format!("http://{bound}"),
                "identity":Identity::current(), "store":store,
                "schema":nac_core::store::schema_version()}))
                    .is_err()
                {
                    let _ = self.stop.send(true);
                }
            },
            ManagedReadinessPolicy::production(),
            shutdown,
        )
        .await
    }
}

impl Drop for DesktopLaunch {
    fn drop(&mut self) {
        let _ = self.complete.send(());
        let _ = self.stream.shutdown(Shutdown::Both);
    }
}

#[cfg(test)]
mod tests;
