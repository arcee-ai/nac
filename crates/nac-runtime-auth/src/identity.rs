use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer},
    },
    TlsAcceptor,
};

/// Trusted composition supplies DER bytes. No request chooses trust or a key.
/// Existing field names and identity validation remain compatible.
pub struct RuntimeTlsIdentity {
    pub serving_chain: Vec<CertificateDer<'static>>,
    pub serving_key: PrivateKeyDer<'static>,
    pub client_ca: CertificateDer<'static>,
    pub d_service_leaf_sha256: [u8; 32],
}

pub(crate) struct AcceptedIdentity {
    pub acceptor: TlsAcceptor,
    pub client_pin: [u8; 32],
    pub serving_pin: [u8; 32],
    pub client_ca_pin: [u8; 32],
}

impl RuntimeTlsIdentity {
    pub(crate) fn acceptor(self) -> Result<AcceptedIdentity> {
        if self.d_service_leaf_sha256 == [0; 32] || self.serving_chain.is_empty() {
            bail!("runtime TLS identity is incomplete");
        }
        let serving_pin = Sha256::digest(self.serving_chain[0].as_ref()).into();
        let client_ca_pin = Sha256::digest(self.client_ca.as_ref()).into();
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
            .with_protocol_versions(&[&rustls::version::TLS13])?
            .with_client_cert_verifier(verifier)
            .with_single_cert(self.serving_chain, self.serving_key)
            .context("runtime serving identity is invalid")?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        Ok(AcceptedIdentity {
            acceptor: TlsAcceptor::from(Arc::new(config)),
            client_pin: self.d_service_leaf_sha256,
            serving_pin,
            client_ca_pin,
        })
    }
}
