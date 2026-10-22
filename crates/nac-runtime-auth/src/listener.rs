use crate::{
    state::{ConnectionState, IssuerView, ServingState},
    AuthenticatedStream, RuntimeTlsIdentity,
};
use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::{
    net::SocketAddr,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tokio::{net::TcpListener, sync::Notify, task::JoinSet};
use tokio_rustls::TlsAcceptor;
use uuid::Uuid;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HANDSHAKES: usize = 32;

/// Actual TLS acceptance, independent of HTTP/Axum and Core authorization.
pub struct RuntimeTlsAcceptor {
    listener: TcpListener,
    acceptor: TlsAcceptor,
    pin: [u8; 32],
    serving: Arc<ServingState>,
    handshakes: JoinSet<Option<(AuthenticatedStream, SocketAddr)>>,
}
impl RuntimeTlsAcceptor {
    /// Existing enrollment remains read-only by default.
    pub async fn bind(addr: SocketAddr, identity: RuntimeTlsIdentity) -> Result<Self> {
        Self::bind_inner(addr, identity, false).await
    }
    /// Trusted explicit configuration additionally enrolls this exact issuer
    /// for the existing CREATE purpose. Authentication still grants no Core op.
    pub async fn bind_create_issuer(
        addr: SocketAddr,
        identity: RuntimeTlsIdentity,
    ) -> Result<Self> {
        Self::bind_inner(addr, identity, true).await
    }
    async fn bind_inner(
        addr: SocketAddr,
        identity: RuntimeTlsIdentity,
        create_issuer: bool,
    ) -> Result<Self> {
        // Preserve identity validation before binding a socket.
        let identity = identity.acceptor()?;
        let listener = TcpListener::bind(addr)
            .await
            .context("runtime TLS bind failed")?;
        Ok(Self {
            listener,
            acceptor: identity.acceptor,
            pin: identity.client_pin,
            serving: Arc::new(ServingState {
                live: AtomicBool::new(true),
                changed: Notify::new(),
                incarnation: Uuid::new_v4(),
                serving_pin: identity.serving_pin,
                client_ca_pin: identity.client_ca_pin,
                create_issuer,
            }),
            handshakes: JoinSet::new(),
        })
    }
    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.listener.local_addr()
    }
    pub async fn accept(&mut self) -> (AuthenticatedStream, SocketAddr) {
        loop {
            tokio::select! {
                result = self.handshakes.join_next(), if !self.handshakes.is_empty() => {
                    if let Some(Ok(Some(accepted))) = result { return accepted; }
                }
                result = self.listener.accept(), if self.handshakes.len() < MAX_HANDSHAKES => {
                    match result {
                        Ok((socket, address)) => {
                            let acceptor = self.acceptor.clone();
                            let pin = self.pin;
                            let serving = Arc::downgrade(&self.serving);
                            self.handshakes.spawn(async move {
                                let stream = tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(socket))
                                    .await.ok()?.ok()?;
                                let leaf = stream.get_ref().1.peer_certificates()?.first()?;
                                let actual: [u8; 32] = Sha256::digest(leaf.as_ref()).into();
                                if actual != pin { return None; }
                                let original = serving.upgrade()?;
                                let state = Arc::new(ConnectionState {
                                    serving,
                                    live: AtomicBool::new(true),
                                    create_started: AtomicBool::new(false),
                                    changed: Notify::new(),
                                    issuer: IssuerView {
                                        client_leaf_sha256: actual,
                                        client_ca_sha256: original.client_ca_pin,
                                        serving_leaf_sha256: original.serving_pin,
                                        serving_incarnation: original.incarnation,
                                        connection_incarnation: Uuid::new_v4(),
                                    },
                                    process: std::process::id(),
                                });
                                state.check().ok()?;
                                Some((AuthenticatedStream { stream, state }, address))
                            });
                        }
                        Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                    }
                }
            }
        }
    }
}
impl Drop for RuntimeTlsAcceptor {
    fn drop(&mut self) {
        self.serving.close();
    }
}
