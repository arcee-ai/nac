//! Separate, opt-in runtime transport. A verified TLS peer is not operation authority.
//!
//! The operator supplies serving identity, a client CA and an exact nac-api leaf
//! certificate pin. No machine secret, browser grant or bearer signer belongs here.

use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{bail, Context, Result};
use axum::{extract::connect_info::Connected, serve::IncomingStream, Router};
use sha2::{Digest, Sha256};
use tokio::{
    net::{TcpListener, TcpStream},
    task::JoinSet,
};
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer},
    },
    server::TlsStream,
    TlsAcceptor,
};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HANDSHAKES: usize = 32;

/// Explicit construction capability; absent configuration creates no listener.
/// DER bytes are loaded by trusted composition, never selected by an HTTP request.
pub struct RuntimeTlsIdentity {
    pub serving_chain: Vec<CertificateDer<'static>>,
    pub serving_key: PrivateKeyDer<'static>,
    pub client_ca: CertificateDer<'static>,
    pub nac_api_leaf_sha256: [u8; 32],
}

impl RuntimeTlsIdentity {
    fn acceptor(self) -> Result<TlsAcceptor> {
        if self.nac_api_leaf_sha256 == [0; 32] || self.serving_chain.is_empty() {
            bail!("runtime TLS identity is incomplete");
        }
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(self.client_ca)
            .context("runtime client CA is invalid")?;
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let verifier = rustls::server::WebPkiClientVerifier::builder_with_provider(
            Arc::new(roots),
            Arc::clone(&provider),
        )
        .build()
        .context("runtime client verification configuration failed")?;
        let mut config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_client_cert_verifier(verifier)
            .with_single_cert(self.serving_chain, self.serving_key)
            .context("runtime serving identity is invalid")?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        Ok(TlsAcceptor::from(Arc::new(config)))
    }
}

/// Only this listener can manufacture the peer marker used by admission.
#[derive(Clone, Debug)]
pub(crate) struct AuthenticatedRuntimePeer {
    leaf_sha256: [u8; 32],
}

impl Connected<IncomingStream<'_, RuntimeTlsListener>> for AuthenticatedRuntimePeer {
    #[expect(
        clippy::expect_used,
        reason = "the listener returns only CA-verified TLS streams with the configured nonzero leaf pin"
    )]
    fn connect_info(stream: IncomingStream<'_, RuntimeTlsListener>) -> Self {
        let leaf = stream
            .io()
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|chain| chain.first())
            .expect("listener accepts only verified pinned peers");
        Self {
            leaf_sha256: Sha256::digest(leaf.as_ref()).into(),
        }
    }
}

/// Bounded concurrent TLS handshakes keep a stalled unauthenticated connection
/// from holding the accept loop. Failed handshakes never reach an HTTP handler.
pub struct RuntimeTlsListener {
    listener: TcpListener,
    acceptor: TlsAcceptor,
    pin: [u8; 32],
    handshakes: JoinSet<Option<(TlsStream<TcpStream>, SocketAddr)>>,
}

impl RuntimeTlsListener {
    pub async fn bind(addr: SocketAddr, identity: RuntimeTlsIdentity) -> Result<Self> {
        let pin = identity.nac_api_leaf_sha256;
        // Validate identity before binding; an invalid configuration fails startup.
        let acceptor = identity.acceptor()?;
        let listener = TcpListener::bind(addr)
            .await
            .context("runtime TLS bind failed")?;
        Ok(Self {
            listener,
            acceptor,
            pin,
            handshakes: JoinSet::new(),
        })
    }

    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.listener.local_addr()
    }
}

impl axum::serve::Listener for RuntimeTlsListener {
    type Io = TlsStream<TcpStream>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
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
                            self.handshakes.spawn(async move {
                                let stream = tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(socket))
                                    .await.ok()?.ok()?;
                                let leaf = stream.get_ref().1.peer_certificates()?.first()?;
                                let actual: [u8; 32] = Sha256::digest(leaf.as_ref()).into();
                                (actual == pin).then_some((stream, address))
                            });
                        }
                        Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                    }
                }
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.local_addr()
    }
}

/// Foundation deliberately denies all operations until accepted canonical
/// admission is composed. Even a correct CA-enrolled, pinned client gets no API.
pub fn denied_runtime_router(native: Router) -> Router {
    native.layer(axum::middleware::from_fn(
        |request: axum::extract::Request, _next: axum::middleware::Next| async move {
            let _authenticated_peer = request
                .extensions()
                .get::<axum::extract::ConnectInfo<AuthenticatedRuntimePeer>>()
                .map(|peer| peer.0.leaf_sha256);
            axum::http::StatusCode::UNAUTHORIZED
        },
    ))
}

/// Explicit opt-in fence for the ordinary plaintext listener in mediated mode.
/// Trusted composition applies this only to the public runtime router, never to
/// the separately authenticated maintenance listener. Headers, local addresses,
/// peer-marker lookalikes and future routes cannot bypass it. Standalone callers
/// retain their existing router by omitting this wrapper.
pub fn mediated_only_plaintext_router(native: Router) -> Router {
    native.layer(axum::middleware::from_fn(
        |request: axum::extract::Request, next: axum::middleware::Next| async move {
            let diagnostic =
                matches!(
                    request.method(),
                    &axum::http::Method::GET | &axum::http::Method::HEAD
                ) && matches!(request.uri().path(), "/health" | "/healthz" | "/readyz");
            if diagnostic {
                next.run(request).await
            } else {
                axum::response::IntoResponse::into_response(axum::http::StatusCode::UNAUTHORIZED)
            }
        },
    ))
}

/// Serve the denied foundation with transport-created peer information. The
/// caller owns shutdown coordination with the native session/persistence root.
pub async fn serve_denied_runtime(
    listener: RuntimeTlsListener,
    native: Router,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    axum::serve(
        listener,
        denied_runtime_router(native)
            .into_make_service_with_connect_info::<AuthenticatedRuntimePeer>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .context("runtime TLS server failed")
}

#[cfg(test)]
#[path = "managed_runtime_tls_tests.rs"]
mod tests;
