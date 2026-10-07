//! Separately enrolled inbound issuer purpose; a TLS connection grants no effect.
//!
//! This construction is deliberately uninstalled. The host/server writer owns
//! serving-key custody and startup. Ordinary runtime markers and request JSON
//! cannot create this connection identity. Current policy and canonical one-use
//! challenge consumption remain separate application responsibilities.

#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "uninstalled issuer purpose awaits canonical admission and host composition"
    )
)]

use super::*;
use uuid::Uuid;

/// Trusted operator construction, separate from ordinary runtime enrollment.
/// There is no request-selected certificate, CA, pin or callback credential.
pub(crate) struct IssuerControlTlsIdentity {
    pub serving_chain: Vec<CertificateDer<'static>>,
    pub serving_key: PrivateKeyDer<'static>,
    pub client_ca: CertificateDer<'static>,
    pub issuer_leaf_sha256: [u8; 32],
}

/// Purpose is carried by the actual listener type, not a serialized peer claim.
/// The wrapper preserves the existing bounded TLS1.3 handshake implementation.
pub(crate) struct IssuerControlTlsListener {
    transport: RuntimeTlsListener,
}

impl IssuerControlTlsListener {
    pub(crate) async fn bind(addr: SocketAddr, identity: IssuerControlTlsIdentity) -> Result<Self> {
        if identity.issuer_leaf_sha256 == [0; 32] {
            bail!("issuer TLS identity is incomplete");
        }
        let transport = RuntimeTlsListener::bind(
            addr,
            RuntimeTlsIdentity {
                serving_chain: identity.serving_chain,
                serving_key: identity.serving_key,
                client_ca: identity.client_ca,
                nac_api_leaf_sha256: identity.issuer_leaf_sha256,
            },
        )
        .await?;
        Ok(Self { transport })
    }

    pub(crate) fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.transport.local_addr()
    }
}

impl axum::serve::Listener for IssuerControlTlsListener {
    type Io = TlsStream<TcpStream>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        axum::serve::Listener::accept(&mut self.transport).await
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.local_addr()
    }
}

/// Private fields make this an actual enrolled connection capability. A copied
/// UUID is only a selector: it cannot manufacture or replace this marker.
#[derive(Clone, Debug)]
pub(crate) struct AuthenticatedIssuerControlPeer {
    channel_id: Uuid,
    leaf_sha256: [u8; 32],
}

impl AuthenticatedIssuerControlPeer {
    pub(crate) fn channel_id(&self) -> Uuid {
        self.channel_id
    }

    pub(crate) fn leaf_sha256(&self) -> [u8; 32] {
        self.leaf_sha256
    }
}

impl Connected<IncomingStream<'_, IssuerControlTlsListener>> for AuthenticatedIssuerControlPeer {
    #[expect(
        clippy::expect_used,
        reason = "the purpose listener preserves mandatory CA verification and exact configured nonzero issuer pin"
    )]
    fn connect_info(stream: IncomingStream<'_, IssuerControlTlsListener>) -> Self {
        let leaf = stream
            .io()
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|chain| chain.first())
            .expect("issuer listener accepts only verified pinned peers");
        Self {
            channel_id: Uuid::new_v4(),
            leaf_sha256: Sha256::digest(leaf.as_ref()).into(),
        }
    }
}

/// Safe construction default: even an enrolled issuer cannot operate before
/// independently qualified policy/challenge/journal composition is installed.
pub(crate) fn denied_issuer_router(native: Router) -> Router {
    native.layer(axum::middleware::from_fn(
        |_request: axum::extract::Request, _next: axum::middleware::Next| async move {
            axum::http::StatusCode::UNAUTHORIZED
        },
    ))
}

#[cfg(test)]
#[path = "managed_runtime_issuer_tests.rs"]
mod tests;
