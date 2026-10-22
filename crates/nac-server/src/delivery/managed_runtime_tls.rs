//! Thin HTTP adaptation of the original enrolled TLS resource owner.
//! A peer is authenticated carriage; Core still owns operation admission.
use anyhow::{Context, Result};
use axum::{extract::connect_info::Connected, serve::IncomingStream, Router};
pub use nac_runtime_auth::RuntimeTlsIdentity;
use nac_runtime_auth::{AuthenticatedPeer, AuthenticatedStream, RuntimeTlsAcceptor};
use std::net::SocketAddr;

/// Only the original accepted stream produces this weak peer view. Its Drop,
/// EOF, failure and serving retirement are observed by the same opaque owner.
#[derive(Clone, Debug)]
pub(crate) struct AuthenticatedRuntimePeer(AuthenticatedPeer);
impl AuthenticatedRuntimePeer {
    pub(super) fn original(&self) -> &AuthenticatedPeer {
        &self.0
    }
}
impl Connected<IncomingStream<'_, RuntimeTlsListener>> for AuthenticatedRuntimePeer {
    fn connect_info(stream: IncomingStream<'_, RuntimeTlsListener>) -> Self {
        Self(stream.io().peer())
    }
}

/// Same private listener, original CA/pin/handshake limits and no raw stream
/// extraction. Ordinary enrollment cannot issue CREATE or cleanup ACK.
pub struct RuntimeTlsListener(RuntimeTlsAcceptor);
impl RuntimeTlsListener {
    pub async fn bind(addr: SocketAddr, identity: RuntimeTlsIdentity) -> Result<Self> {
        RuntimeTlsAcceptor::bind(addr, identity).await.map(Self)
    }
    pub(crate) async fn bind_create_issuer(
        addr: SocketAddr,
        identity: RuntimeTlsIdentity,
    ) -> Result<Self> {
        RuntimeTlsAcceptor::bind_create_issuer(addr, identity)
            .await
            .map(Self)
    }
    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.0.local_addr()
    }
}
impl axum::serve::Listener for RuntimeTlsListener {
    type Io = AuthenticatedStream;
    type Addr = SocketAddr;
    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        self.0.accept().await
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
                .and_then(|peer| peer.0.original().issuer().ok());
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

/// Only trusted native delivery composes a router with this listener-created
/// peer context. No HTTP header, body field or plaintext address can create it.
pub(crate) async fn serve_authenticated_runtime(
    listener: RuntimeTlsListener,
    router: Router,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<AuthenticatedRuntimePeer>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .context("authenticated runtime TLS server failed")
}

#[cfg(test)]
#[path = "managed_runtime_tls_tests.rs"]
pub(crate) mod tests;
