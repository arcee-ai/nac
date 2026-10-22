//! Explicit operator construction for the private fact listener. This is not
//! managed admission, credential enrollment, or a second manager/store owner.
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::{fs::OpenOptions, io::Read, net::SocketAddr, path::Path};
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};

use super::managed_runtime_tls::{RuntimeTlsIdentity, RuntimeTlsListener};
use crate::{application::managed, SessionManager};

/// Supplying this value explicitly selects mediated plaintext and a separate
/// pinned-D fact listener. Omission preserves the existing standalone startup.
pub struct ManagedFactListenerOptions {
    bind: SocketAddr,
    identity: RuntimeTlsIdentity,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperatorConfiguration {
    version: u32,
    mode: String,
    bind: SocketAddr,
    serving_chain_der_files: Vec<std::path::PathBuf>,
    serving_pkcs8_der_file: std::path::PathBuf,
    d_client_ca_der_file: std::path::PathBuf,
    d_service_leaf_sha256: String,
}

impl ManagedFactListenerOptions {
    /// The caller supplies actual enrolled trust and current peer pin. No
    /// environment discovery, self-signed fallback, or expected-target echo.
    pub fn new(bind: SocketAddr, identity: RuntimeTlsIdentity) -> Self {
        Self { bind, identity }
    }

    /// Load a versioned explicit operator document. DER paths must be absolute;
    /// keys are owner-only regular files. This never enrolls or refreshes trust.
    pub fn load(path: &Path) -> Result<Self> {
        let config: OperatorConfiguration = serde_json::from_slice(&read_input(path, false)?)
            .context("invalid managed fact listener configuration")?;
        if config.version != 1 || config.mode != "mediated" {
            bail!("managed fact listener requires version 1 and explicit mediated mode");
        }
        if config.serving_chain_der_files.is_empty() || config.serving_chain_der_files.len() > 8 {
            bail!("managed fact serving chain requires 1 to 8 DER certificates");
        }
        let pin = decode_pin(&config.d_service_leaf_sha256)?;
        let serving_chain = config
            .serving_chain_der_files
            .iter()
            .map(|path| read_input(path, false).map(CertificateDer::from))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self::new(
            config.bind,
            RuntimeTlsIdentity {
                serving_chain,
                serving_key: PrivatePkcs8KeyDer::from(read_input(
                    &config.serving_pkcs8_der_file,
                    true,
                )?)
                .into(),
                client_ca: CertificateDer::from(read_input(&config.d_client_ca_der_file, false)?),
                d_service_leaf_sha256: pin,
            },
        ))
    }

    pub(crate) async fn bind(
        self,
        manager: &SessionManager,
        public_bind: SocketAddr,
        control_bind: Option<SocketAddr>,
        policy: managed::ManagedReadinessPolicy,
    ) -> Result<Option<RuntimeTlsListener>> {
        manager.managed_location_binding()?;
        if self.bind == public_bind || control_bind == Some(self.bind) {
            bail!("managed fact listener must have a separate address");
        }
        // Migration recovery retains diagnostics, without a fact listener even
        // when another process later repairs the store. Restart is required.
        if manager.is_recovery_only() {
            return Ok(None);
        }
        let readiness_manager = manager.clone();
        manager
            .inner
            ._store_ownership
            .call_legacy(move || managed::require_replacement_readiness(&readiness_manager, policy))
            .await??;
        Ok(Some(
            RuntimeTlsListener::bind(self.bind, self.identity).await?,
        ))
    }
}

pub(super) fn decode_pin(text: &str) -> Result<[u8; 32]> {
    if text.len() != 64
        || !text
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        bail!("D service leaf SHA256 must be 64 lowercase hex characters");
    }
    let mut pin = [0; 32];
    for (index, byte) in pin.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16)?;
    }
    if pin == [0; 32] {
        bail!("D service leaf SHA256 must not be zero");
    }
    Ok(pin)
}

pub(super) fn read_input(path: &Path, private: bool) -> Result<Vec<u8>> {
    if !path.is_absolute() {
        bail!("managed fact configuration and DER paths must be absolute");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .context("cannot open managed fact operator input")?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > 1024 * 1024 {
        bail!("managed fact input must be a regular file of at most 1 MiB");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // Root-owned mounted inputs and current-user operator inputs are valid.
        // Trust material must not be writable by another user or group.
        // SAFETY: geteuid has no arguments and only observes process identity.
        let current_uid = unsafe { libc::geteuid() };
        if ![0, current_uid].contains(&metadata.uid())
            || metadata.mode() & 0o022 != 0
            || (private && metadata.mode() & 0o077 != 0)
        {
            bail!("managed fact operator input has unsafe ownership or permissions");
        }
    }
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > 1024 * 1024 {
        bail!("managed fact input is empty or exceeds 1 MiB");
    }
    Ok(bytes)
}

#[cfg(test)]
#[path = "managed_fact_listener_tests.rs"]
mod tests;
