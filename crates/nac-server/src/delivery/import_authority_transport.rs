//! A separate pre-import TLS purpose. Transport context is observation only:
//! it cannot import a key, issue controller Evidence, or prove runtime Ready.
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    net::SocketAddr,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    task::{Context as TaskContext, Poll, Waker},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use uuid::Uuid;

use super::{
    certificate_cutoff::CertificateTimeAnchor,
    managed_fact_listener::{decode_pin, read_input},
    managed_runtime_tls::{RuntimeTlsIdentity, RuntimeTlsListener},
};

pub const IMPORT_AUTHORITY_PURPOSE: &str = "native-initial-import-authority.v1";
pub const IMPORT_AUTHORITY_EXPORTER_LABEL: &[u8] = b"EXPORTER-nac-initial-import-authority-v1";

/// Nonsecret transport configuration, independently enrolled before any model
/// host-key import. This selects neither product authority nor a signer key.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportAuthorityTransportOptions {
    version: u32,
    purpose: String,
    authority_bind: SocketAddr,
    imported_bind: SocketAddr,
    serving_chain_der_files: Vec<PathBuf>,
    serving_pkcs8_der_file: PathBuf,
    d_client_ca_der_file: PathBuf,
    d_service_leaf_sha256: String,
    public_issuer_trust_file: PathBuf,
    original_context_file: PathBuf,
}

impl ImportAuthorityTransportOptions {
    /// Read the selected expected-context snapshot before listener construction.
    /// No proof, bootstrap key, grant, or serving capability is created here.
    pub fn load_original_context(&self) -> Result<crate::InitialEnrollmentContext> {
        self.validate()?;
        crate::InitialEnrollmentContext::load(&self.original_context_file)
    }

    /// Bind against the SAME startup snapshot's clock pair and deadline. This
    /// still constructs only transport, without importing or accepting proof.
    pub async fn bind_original(
        self,
        startup: &crate::InitialEnrollmentContext,
    ) -> Result<ImportAuthorityListener> {
        startup.check_current()?;
        let (start, utc) = startup.original_clock();
        self.bind_with_clock(
            startup.deadline(),
            CertificateTimeAnchor::from_original(start, utc),
        )
        .await
    }

    pub fn load(path: &Path) -> Result<Self> {
        let options: Self = serde_json::from_slice(&read_input(path, false)?)
            .context("invalid pre-import authority transport configuration")?;
        options.validate()?;
        Ok(options)
    }

    fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.purpose != IMPORT_AUTHORITY_PURPOSE
            || self.authority_bind == self.imported_bind
            || self.serving_chain_der_files.is_empty()
            || self.serving_chain_der_files.len() > 8
        {
            bail!("invalid pre-import authority transport configuration");
        }
        decode_pin(&self.d_service_leaf_sha256)?;
        if self
            .serving_chain_der_files
            .iter()
            .chain([
                &self.serving_pkcs8_der_file,
                &self.d_client_ca_der_file,
                &self.public_issuer_trust_file,
                &self.original_context_file,
            ])
            .any(|path| !path.is_absolute())
        {
            bail!("pre-import authority input paths must be absolute");
        }
        Ok(())
    }

    /// Bind only the independent authority purpose. This never reads model
    /// bootstrap input, constructs a SessionManager, or publishes Imported/Ready.
    /// The application supplies the immutable ORIGINAL deadline; it is not
    /// captured afresh after accept, proof issuance, import, or a failed wait.
    pub async fn bind_before_import(
        self,
        original_deadline: tokio::time::Instant,
    ) -> Result<ImportAuthorityListener> {
        self.bind_with_clock(original_deadline, CertificateTimeAnchor::capture())
            .await
    }

    async fn bind_with_clock(
        self,
        original_deadline: tokio::time::Instant,
        certificate_time: CertificateTimeAnchor,
    ) -> Result<ImportAuthorityListener> {
        self.validate()?;
        if tokio::time::Instant::now() >= original_deadline {
            bail!("pre-import authority original deadline expired");
        }
        // Hardening precedes loading actual TLS keys. The application still
        // owns its selected sandbox/backend and process security context.
        nac_core::runtime::restrict_same_uid_inspection()?;
        let serving_chain = self
            .serving_chain_der_files
            .iter()
            .map(|path| read_input(path, false).map(CertificateDer::from))
            .collect::<Result<Vec<_>>>()?;
        let identity = RuntimeTlsIdentity {
            serving_chain,
            serving_key: PrivatePkcs8KeyDer::from(read_input(&self.serving_pkcs8_der_file, true)?)
                .into(),
            client_ca: CertificateDer::from(read_input(&self.d_client_ca_der_file, false)?),
            d_service_leaf_sha256: decode_pin(&self.d_service_leaf_sha256)?,
        };
        ImportAuthorityListener::bind(
            self.authority_bind,
            identity,
            original_deadline,
            certificate_time,
            nac_managed::ImportProofVerifier::new(self.public_issuer_trust_file),
        )
        .await
    }
}

struct Lifetime {
    id: Uuid,
    original_deadline: tokio::time::Instant,
    open: AtomicBool,
    read_waker: Mutex<Option<Waker>>,
    write_waker: Mutex<Option<Waker>>,
}

impl Lifetime {
    fn close(&self) {
        self.open.store(false, Ordering::Release);
        for slot in [&self.read_waker, &self.write_waker] {
            let waker = slot
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if let Some(waker) = waker {
                waker.wake();
            }
        }
    }

    fn check(&self) -> Result<()> {
        if !self.open.load(Ordering::Acquire)
            || tokio::time::Instant::now() >= self.original_deadline
        {
            self.close();
            bail!("pre-import authority lifetime unavailable");
        }
        Ok(())
    }
}

/// One pre-import listener accepts one actual enrolled channel. It is not an
/// Axum listener and cannot be mounted on the runtime or maintenance router.
pub struct ImportAuthorityListener {
    transport: RuntimeTlsListener,
    serving_leaf_sha256: [u8; 32],
    lifetime: Arc<Lifetime>,
    accepted: bool,
    certificate_time: CertificateTimeAnchor,
    verifier: Option<nac_managed::ImportProofVerifier>,
}

impl ImportAuthorityListener {
    pub(crate) fn owns_original(&self, connection: &ImportAuthorityConnection) -> bool {
        Arc::ptr_eq(&self.lifetime, &connection.lifetime)
    }
    async fn bind(
        address: SocketAddr,
        identity: RuntimeTlsIdentity,
        original_deadline: tokio::time::Instant,
        certificate_time: CertificateTimeAnchor,
        verifier: nac_managed::ImportProofVerifier,
    ) -> Result<Self> {
        let mut original_deadline = original_deadline;
        for certificate in identity
            .serving_chain
            .iter()
            .chain(std::iter::once(&identity.client_ca))
        {
            original_deadline =
                certificate_time.tighten(certificate.as_ref(), original_deadline)?;
        }
        let serving_leaf_sha256 = Sha256::digest(
            identity
                .serving_chain
                .first()
                .ok_or_else(|| anyhow::anyhow!("authority serving identity unavailable"))?
                .as_ref(),
        )
        .into();
        let lifetime = Arc::new(Lifetime {
            id: Uuid::new_v4(),
            original_deadline,
            open: AtomicBool::new(true),
            read_waker: Mutex::new(None),
            write_waker: Mutex::new(None),
        });
        lifetime.check()?;
        let transport = RuntimeTlsListener::bind(address, identity).await?;
        lifetime.check()?;
        Ok(Self {
            transport,
            serving_leaf_sha256,
            lifetime,
            accepted: false,
            certificate_time,
            verifier: Some(verifier),
        })
    }

    pub(super) fn take_original_verifier(&mut self) -> Result<nac_managed::ImportProofVerifier> {
        self.lifetime.check()?;
        self.verifier
            .take()
            .context("original import verifier already transferred")
    }

    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.transport.local_addr()
    }

    pub async fn accept_original(&mut self) -> Result<ImportAuthorityConnection> {
        self.lifetime.check()?;
        if self.accepted {
            bail!("pre-import authority original channel already accepted");
        }
        // A cancelled borrowed wait cannot admit a replacement connection.
        self.accepted = true;
        let (stream, _) = tokio::time::timeout_at(
            self.lifetime.original_deadline,
            axum::serve::Listener::accept(&mut self.transport),
        )
        .await
        .map_err(|_| anyhow::anyhow!("pre-import authority original deadline expired"))?;
        self.lifetime.check()?;
        if stream.tls_connection().protocol_version()
            != Some(tokio_rustls::rustls::ProtocolVersion::TLSv1_3)
        {
            bail!("pre-import authority requires TLS1.3");
        }
        let leaf = stream
            .tls_connection()
            .peer_certificates()
            .and_then(|chain| chain.first())
            .ok_or_else(|| anyhow::anyhow!("authority verified peer unavailable"))?;
        let peer_leaf_sha256 = Sha256::digest(leaf.as_ref()).into();
        let mut channel_deadline = self.lifetime.original_deadline;
        for certificate in stream
            .tls_connection()
            .peer_certificates()
            .unwrap_or_default()
        {
            channel_deadline = self
                .certificate_time
                .tighten(certificate.as_ref(), channel_deadline)?;
        }
        if tokio::time::Instant::now() >= channel_deadline {
            self.lifetime.close();
            bail!("authority peer certificate deadline expired");
        }
        let exporter = stream
            .tls_connection()
            .export_keying_material([0u8; 32], IMPORT_AUTHORITY_EXPORTER_LABEL, Some(&[]))
            .map_err(|_| anyhow::anyhow!("authority channel binding unavailable"))?;
        Ok(ImportAuthorityConnection {
            stream,
            lifetime: Arc::clone(&self.lifetime),
            context: ImportAuthorityChannelContext {
                authority_channel_lifetime_id: self.lifetime.id,
                peer_leaf_sha256,
                serving_leaf_sha256: self.serving_leaf_sha256,
                authority_channel_binding_sha256: Sha256::digest(exporter).into(),
            },
            open: true,
            channel_deadline,
            read_deadline: Box::pin(tokio::time::sleep_until(channel_deadline)),
            write_deadline: Box::pin(tokio::time::sleep_until(channel_deadline)),
        })
    }
}

impl Drop for ImportAuthorityListener {
    fn drop(&mut self) {
        self.lifetime.close();
    }
}

/// Actual physical channel observations. Copying them grants no authority;
/// only the owned connection constructs this context and keeps it live.
pub struct ImportAuthorityChannelContext {
    authority_channel_lifetime_id: Uuid,
    peer_leaf_sha256: [u8; 32],
    serving_leaf_sha256: [u8; 32],
    authority_channel_binding_sha256: [u8; 32],
}

impl ImportAuthorityChannelContext {
    pub fn authority_channel_lifetime_id(&self) -> Uuid {
        self.authority_channel_lifetime_id
    }
    pub fn peer_leaf_sha256(&self) -> [u8; 32] {
        self.peer_leaf_sha256
    }
    pub fn serving_leaf_sha256(&self) -> [u8; 32] {
        self.serving_leaf_sha256
    }
    pub fn authority_channel_binding_sha256(&self) -> [u8; 32] {
        self.authority_channel_binding_sha256
    }
}

pub struct ImportAuthorityConnection {
    stream: nac_runtime_auth::AuthenticatedStream,
    lifetime: Arc<Lifetime>,
    context: ImportAuthorityChannelContext,
    open: bool,
    channel_deadline: tokio::time::Instant,
    read_deadline: Pin<Box<tokio::time::Sleep>>,
    write_deadline: Pin<Box<tokio::time::Sleep>>,
}

/// Private resource retained only from an actual accepted TLS stream. The
/// reader actor must keep polling EOF; this also observes listener/drop fences
/// synchronously while an application operation runs off the reactor.
pub(crate) struct ImportAuthorityLiveOwner {
    lifetime: Arc<Lifetime>,
    deadline: tokio::time::Instant,
}

impl ImportAuthorityLiveOwner {
    pub(crate) fn close(&self) {
        self.lifetime.close();
    }
    pub(crate) fn check_live(&self) -> Result<()> {
        if tokio::time::Instant::now() >= self.deadline {
            self.lifetime.close();
            bail!("original import authority deadline expired");
        }
        self.lifetime.check()
    }
}

impl ImportAuthorityConnection {
    pub(crate) fn retain_live_owner(&self) -> Result<ImportAuthorityLiveOwner> {
        self.check_live()?;
        Ok(ImportAuthorityLiveOwner {
            lifetime: Arc::clone(&self.lifetime),
            deadline: self.channel_deadline,
        })
    }
    pub fn context(&self) -> &ImportAuthorityChannelContext {
        &self.context
    }
    /// Observation for the owning async driver; this cannot extend the scope.
    pub fn deadline(&self) -> tokio::time::Instant {
        self.channel_deadline
    }
    pub fn check_live(&self) -> Result<()> {
        if !self.open || tokio::time::Instant::now() >= self.channel_deadline {
            self.lifetime.close();
            bail!("pre-import authority channel unavailable");
        }
        self.lifetime.check()
    }
    fn check_io(&self) -> std::io::Result<()> {
        self.check_live().map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "pre-import authority channel unavailable",
            )
        })
    }

    fn poll_current(&mut self, cx: &mut TaskContext<'_>, reading: bool) -> std::io::Result<()> {
        let slot = if reading {
            &self.lifetime.read_waker
        } else {
            &self.lifetime.write_waker
        };
        *slot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cx.waker().clone());
        let deadline = if reading {
            &mut self.read_deadline
        } else {
            &mut self.write_deadline
        };
        if deadline.as_mut().poll(cx).is_ready() {
            self.lifetime.close();
        }
        self.check_io()
    }
}

impl Drop for ImportAuthorityConnection {
    fn drop(&mut self) {
        self.lifetime.close();
    }
}

impl AsyncRead for ImportAuthorityConnection {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if let Err(e) = self.poll_current(cx, true) {
            return Poll::Ready(Err(e));
        }
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        let before = buf.filled().len();
        let result = Pin::new(&mut self.stream).poll_read(cx, buf);
        if matches!(result, Poll::Ready(Err(_)))
            || (matches!(result, Poll::Ready(Ok(()))) && before == buf.filled().len())
        {
            self.open = false;
            self.lifetime.close();
        }
        result
    }
}

impl AsyncWrite for ImportAuthorityConnection {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if let Err(e) = self.poll_current(cx, false) {
            return Poll::Ready(Err(e));
        }
        let result = Pin::new(&mut self.stream).poll_write(cx, buf);
        if matches!(result, Poll::Ready(Err(_))) {
            self.open = false;
            self.lifetime.close();
        }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<std::io::Result<()>> {
        if let Err(e) = self.poll_current(cx, false) {
            return Poll::Ready(Err(e));
        }
        let result = Pin::new(&mut self.stream).poll_flush(cx);
        if matches!(result, Poll::Ready(Err(_))) {
            self.open = false;
            self.lifetime.close();
        }
        result
    }
    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
    ) -> Poll<std::io::Result<()>> {
        self.open = false;
        self.lifetime.close();
        // TLS close flushes queued records. Keep polling the SAME original
        // timer even after logical denial, so a non-reading peer cannot hold
        // shutdown open or create a new cleanup deadline.
        if self.write_deadline.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "pre-import authority shutdown original deadline expired",
            )));
        }
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

#[cfg(test)]
#[path = "import_authority_transport_tests.rs"]
mod tests;
