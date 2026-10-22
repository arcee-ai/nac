//! Parse-only validity bounds for actual DER. Rustls retains certificate chain,
//! signature and peer authentication. Parsed metadata never grants authority.
use anyhow::{bail, Context, Result};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::Instant;
use x509_parser::{certificate::X509CertificateParser, nom::Parser, time::ASN1Time};

const MAX_CERTIFICATE_BYTES: usize = 65536;

/// One conservative clock pair, retained from listener construction through the
/// actual peer handshake. Never resample it to renew an existing cutoff.
pub(super) struct CertificateTimeAnchor {
    monotonic: Instant,
    utc: SystemTime,
}

impl CertificateTimeAnchor {
    pub(super) fn capture() -> Self {
        let monotonic = Instant::now();
        let utc = SystemTime::now();
        Self::from_original(monotonic, utc)
    }

    pub(super) fn from_original(monotonic: Instant, utc: SystemTime) -> Self {
        Self { monotonic, utc }
    }

    #[cfg(test)]
    pub(super) fn for_test(utc: SystemTime, monotonic: Instant) -> Self {
        Self { monotonic, utc }
    }

    pub(super) fn tighten(&self, der: &[u8], previous: Instant) -> Result<Instant> {
        if der.is_empty() || der.len() > MAX_CERTIFICATE_BYTES {
            bail!("authority certificate DER exceeds its bound");
        }
        let (remaining, certificate) = X509CertificateParser::new()
            .with_deep_parse_extensions(false)
            .parse(der)
            .map_err(|_| anyhow::anyhow!("invalid authority certificate DER"))?;
        if !remaining.is_empty() || certificate.version().0 != 2 {
            bail!("authority certificate must be one complete X.509 v3 object");
        }
        let validity = certificate.validity();
        let not_before = certificate_time(validity.not_before)?;
        let not_after = certificate_time(validity.not_after)?;
        // Deliberately do not use is_valid_at (inclusive at NotAfter) or the
        // convenience expiration methods (which sample a fresh UTC clock).
        if not_before >= not_after || self.utc < not_before || self.utc >= not_after {
            bail!("authority certificate validity unavailable");
        }
        let remaining = not_after
            .duration_since(self.utc)
            .context("authority certificate validity unavailable")?;
        let cutoff = self
            .monotonic
            .checked_add(remaining)
            .context("authority certificate cutoff overflow")?;
        Ok(previous.min(cutoff))
    }
}

fn certificate_time(time: ASN1Time) -> Result<SystemTime> {
    // RFC5280 authority certificates use whole seconds. The parser also
    // accepts fractional GeneralizedTime; silently flooring NotBefore would
    // admit a certificate before its actual validity starts.
    if time.to_datetime().nanosecond() != 0 {
        bail!("fractional authority certificate time is unsupported");
    }
    unix_time(time.timestamp())
}

fn unix_time(seconds: i64) -> Result<SystemTime> {
    UNIX_EPOCH
        .checked_add(Duration::from_secs(u64::try_from(seconds).map_err(
            |_| anyhow::anyhow!("unsupported authority certificate time"),
        )?))
        .context("authority certificate time overflow")
}

#[cfg(test)]
#[path = "certificate_cutoff_tests.rs"]
mod tests;
