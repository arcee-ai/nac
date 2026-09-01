//! One-time import of a controller-delivered managed Arcee credential.
//!
//! The bootstrap payload is deliberately not a public Rust data type: callers
//! pass only the configured logical host identity, and secret-bearing values
//! never acquire `Debug` or escape this module. A separate nonsecret receipt
//! makes the import independent of the read-only mount after the first durable
//! transaction.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use nac_credential_store::{
    read_auth_bytes_from_path, read_mounted_credential_string, with_credential_lock,
    write_auth_string_to_path,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::arcee::{
    parse_stored_auth, validate_stored_base_url, ManagedBootstrapProvenance, StoredArceeAuth,
    AUTH_TYPE, MANAGED_CLIENT_ID,
};
use super::auth_store::{
    arcee_auth_file_path, arcee_auth_lock_path, arcee_managed_bootstrap_receipt_path,
};

pub const MANAGED_ARCEE_BOOTSTRAP_PATH: &str = "/run/secrets/nac/bootstrap.json";
const BOOTSTRAP_VERSION: u32 = 1;
const RECEIPT_VERSION: u32 = 1;

/// Safe startup result. No variant contains identifiers or credential values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedArceeBootstrapOutcome {
    Imported,
    RecoveredReceipt,
    AlreadyConsumed,
    ExistingCredentialPreserved,
    InvalidCredentialPreserved,
    InvalidReceiptPreserved,
}

struct BootstrapPayload {
    bootstrap_id: Uuid,
    managed_host_id: Uuid,
    access_token: String,
    refresh_token: String,
    expires_at_ms: u64,
    inference_base_url: String,
    organization_id: String,
    workspace: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BootstrapWire {
    version: u32,
    bootstrap_id: String,
    managed_host_id: String,
    client_id: String,
    access_token: String,
    refresh_token: String,
    access_token_expires_at: String,
    token_type: String,
    inference_base_url: String,
    organization_id: String,
    workspace: String,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReceiptDisposition {
    Imported,
    PreservedExisting,
    PreservedInvalid,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BootstrapReceipt {
    version: u32,
    bootstrap_id: Uuid,
    managed_host_id: Uuid,
    client_id: String,
    disposition: ReceiptDisposition,
}

struct ImportPaths<'a> {
    input: &'a Path,
    auth: &'a Path,
    receipt: &'a Path,
    lock: &'a Path,
}

/// Import the fixed managed bootstrap input into NAC's normal Arcee store.
///
/// A valid receipt short-circuits before opening the bootstrap mount, which is
/// what makes steady-state restart independent of Kubernetes Secret delivery.
pub fn import_managed_arcee_bootstrap(
    expected_managed_host_id: &str,
) -> Result<ManagedArceeBootstrapOutcome> {
    let auth = arcee_auth_file_path()?;
    let receipt = arcee_managed_bootstrap_receipt_path()?;
    let lock = arcee_auth_lock_path()?;
    import_with_paths(
        expected_managed_host_id,
        ImportPaths {
            input: Path::new(MANAGED_ARCEE_BOOTSTRAP_PATH),
            auth: &auth,
            receipt: &receipt,
            lock: &lock,
        },
        || Ok(()),
    )
}

pub fn managed_arcee_auth_storage_root() -> Result<PathBuf> {
    arcee_auth_file_path()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| anyhow!("managed Arcee credential path has no parent directory"))
}

/// Validate the durable nonsecret receipt without consulting the bootstrap
/// mount. Managed readiness combines this with durable credential validation.
pub fn validate_managed_arcee_bootstrap_receipt(expected_managed_host_id: &str) -> Result<()> {
    let expected_host = Uuid::parse_str(expected_managed_host_id)
        .map_err(|_| anyhow!("managed logical_host_id must be a UUID for managed bootstrap"))?;
    let receipt = arcee_managed_bootstrap_receipt_path()?;
    let lock = arcee_auth_lock_path()?;
    with_credential_lock(&lock, || {
        match read_receipt(&receipt)? {
        ReceiptState::Valid(receipt) if receipt.managed_host_id == expected_host => Ok(()),
        ReceiptState::Valid(_) => bail!(
            "managed Arcee bootstrap receipt belongs to a different logical host; refusing durable state reuse"
        ),
        ReceiptState::Missing => bail!("managed Arcee bootstrap receipt is unavailable"),
        ReceiptState::Invalid => bail!("managed Arcee bootstrap receipt is invalid"),
    }
    })
}

fn import_with_paths(
    expected_managed_host_id: &str,
    paths: ImportPaths<'_>,
    after_credential_write: impl FnOnce() -> Result<()>,
) -> Result<ManagedArceeBootstrapOutcome> {
    let expected_host = Uuid::parse_str(expected_managed_host_id)
        .map_err(|_| anyhow!("managed logical_host_id must be a UUID for managed bootstrap"))?;
    with_credential_lock(paths.lock, || {
        match read_receipt(paths.receipt)? {
            ReceiptState::Valid(receipt) => {
                if receipt.managed_host_id != expected_host {
                    bail!(
                        "managed Arcee bootstrap receipt belongs to a different logical host; refusing durable state reuse"
                    );
                }
                return Ok(ManagedArceeBootstrapOutcome::AlreadyConsumed);
            }
            ReceiptState::Invalid => {
                return Ok(ManagedArceeBootstrapOutcome::InvalidReceiptPreserved)
            }
            ReceiptState::Missing => {}
        }

        let existing = read_existing_auth(paths.auth);
        if let ExistingAuthState::Recoverable(provenance) = &existing {
            if provenance.managed_host_id != expected_host {
                bail!(
                    "managed Arcee credential belongs to a different logical host; refusing durable state reuse"
                );
            }
            write_receipt(
                paths.receipt,
                BootstrapReceipt {
                    version: RECEIPT_VERSION,
                    bootstrap_id: provenance.bootstrap_id,
                    managed_host_id: provenance.managed_host_id,
                    client_id: MANAGED_CLIENT_ID.to_string(),
                    disposition: ReceiptDisposition::Imported,
                },
            )?;
            return Ok(ManagedArceeBootstrapOutcome::RecoveredReceipt);
        }

        let payload = read_bootstrap(paths.input, expected_host)?;
        let mut receipt = BootstrapReceipt {
            version: RECEIPT_VERSION,
            bootstrap_id: payload.bootstrap_id,
            managed_host_id: payload.managed_host_id,
            client_id: MANAGED_CLIENT_ID.to_string(),
            disposition: ReceiptDisposition::Imported,
        };
        match existing {
            ExistingAuthState::Invalid => {
                receipt.disposition = ReceiptDisposition::PreservedInvalid;
                write_receipt(paths.receipt, receipt)?;
                Ok(ManagedArceeBootstrapOutcome::InvalidCredentialPreserved)
            }
            ExistingAuthState::Valid | ExistingAuthState::Recoverable(_) => {
                receipt.disposition = ReceiptDisposition::PreservedExisting;
                write_receipt(paths.receipt, receipt)?;
                Ok(ManagedArceeBootstrapOutcome::ExistingCredentialPreserved)
            }
            ExistingAuthState::Missing => {
                let auth = stored_auth_from_payload(payload);
                write_stored_auth_to_path(paths.auth, &auth)?;
                after_credential_write()?;
                write_receipt(paths.receipt, receipt)?;
                Ok(ManagedArceeBootstrapOutcome::Imported)
            }
        }
    })
}

enum ExistingAuthState {
    Missing,
    Valid,
    Recoverable(ManagedBootstrapProvenance),
    Invalid,
}

fn read_existing_auth(path: &Path) -> ExistingAuthState {
    let raw = match read_auth_bytes_from_path(path) {
        Ok(Some(raw)) => raw,
        Ok(None) => return ExistingAuthState::Missing,
        Err(_) => return ExistingAuthState::Invalid,
    };
    let parsed = String::from_utf8(raw)
        .ok()
        .and_then(|raw| parse_stored_auth(&raw, path).ok().flatten());
    match parsed {
        Some(auth) => match (auth.client_id.as_str(), auth.managed_bootstrap) {
            (MANAGED_CLIENT_ID, Some(provenance)) => ExistingAuthState::Recoverable(provenance),
            _ => ExistingAuthState::Valid,
        },
        None => ExistingAuthState::Invalid,
    }
}

fn stored_auth_from_payload(payload: BootstrapPayload) -> StoredArceeAuth {
    StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        token_type: "bearer".to_string(),
        expires_at_ms: payload.expires_at_ms,
        base_url: payload.inference_base_url,
        organization_id: payload.organization_id,
        workspace_name: payload.workspace,
        client_id: MANAGED_CLIENT_ID.to_string(),
        managed_bootstrap: Some(ManagedBootstrapProvenance {
            bootstrap_id: payload.bootstrap_id,
            managed_host_id: payload.managed_host_id,
        }),
    }
}

fn read_bootstrap(path: &Path, expected_host: Uuid) -> Result<BootstrapPayload> {
    let raw = read_mounted_credential_string(path)?
        .ok_or_else(|| anyhow!("managed Arcee bootstrap input is unavailable"))?;
    let wire: BootstrapWire = serde_json::from_str(&raw)
        .map_err(|_| anyhow!("managed Arcee bootstrap input is not valid strict v1 JSON"))?;
    if wire.version != BOOTSTRAP_VERSION {
        bail!("managed Arcee bootstrap input has an unsupported version");
    }
    let bootstrap_id = Uuid::parse_str(&wire.bootstrap_id)
        .map_err(|_| anyhow!("managed Arcee bootstrap bootstrap_id must be a UUID"))?;
    let managed_host_id = Uuid::parse_str(&wire.managed_host_id)
        .map_err(|_| anyhow!("managed Arcee bootstrap managed_host_id must be a UUID"))?;
    if managed_host_id != expected_host {
        bail!("managed Arcee bootstrap does not match the configured logical host");
    }
    if wire.client_id != MANAGED_CLIENT_ID {
        bail!("managed Arcee bootstrap client_id must be managed-nac");
    }
    if wire.token_type != "bearer" {
        bail!("managed Arcee bootstrap token_type must be bearer");
    }
    require_nonblank(&wire.access_token, "access_token")?;
    require_nonblank(&wire.refresh_token, "refresh_token")?;
    require_nonblank(&wire.organization_id, "organization_id")?;
    require_nonblank(&wire.workspace, "workspace")?;
    validate_stored_base_url(&wire.inference_base_url)
        .map_err(|_| anyhow!("managed Arcee bootstrap inference_base_url is not approved"))?;
    let expires_at_ms = parse_rfc3339_utc_millis(&wire.access_token_expires_at)
        .ok_or_else(|| anyhow!("managed Arcee bootstrap access_token_expires_at is invalid"))?;

    Ok(BootstrapPayload {
        bootstrap_id,
        managed_host_id,
        access_token: wire.access_token,
        refresh_token: wire.refresh_token,
        expires_at_ms,
        inference_base_url: wire.inference_base_url,
        organization_id: wire.organization_id,
        workspace: wire.workspace,
    })
}

fn require_nonblank(value: &str, field: &str) -> Result<()> {
    if value.trim().is_empty() {
        bail!("managed Arcee bootstrap requires nonblank field '{field}'");
    }
    Ok(())
}

enum ReceiptState {
    Missing,
    Valid(BootstrapReceipt),
    Invalid,
}

fn read_receipt(path: &Path) -> Result<ReceiptState> {
    let raw = match read_auth_bytes_from_path(path) {
        Ok(Some(raw)) => raw,
        Ok(None) => return Ok(ReceiptState::Missing),
        Err(_) => return Ok(ReceiptState::Invalid),
    };
    let Ok(receipt) = serde_json::from_slice::<BootstrapReceipt>(&raw) else {
        return Ok(ReceiptState::Invalid);
    };
    if receipt.version != RECEIPT_VERSION || receipt.client_id != MANAGED_CLIENT_ID {
        return Ok(ReceiptState::Invalid);
    }
    Ok(ReceiptState::Valid(receipt))
}

fn write_receipt(path: &Path, receipt: BootstrapReceipt) -> Result<()> {
    let raw = serde_json::to_string_pretty(&receipt)
        .context("failed to serialize managed Arcee bootstrap receipt")?;
    write_auth_string_to_path(path, &raw)
        .context("failed to persist managed Arcee bootstrap receipt")
}

fn write_stored_auth_to_path(path: &Path, auth: &StoredArceeAuth) -> Result<()> {
    let raw = serde_json::to_string_pretty(auth)
        .context("failed to serialize imported managed Arcee credential")?;
    write_auth_string_to_path(path, &raw)
        .context("failed to persist imported managed Arcee credential")
}

/// Parse the strict UTC (`...Z`) RFC3339 subset into Unix milliseconds.
fn parse_rfc3339_utc_millis(value: &str) -> Option<u64> {
    let (date, time) = value.strip_suffix('Z')?.split_once('T')?;
    if date.len() != 10 || time.len() < 8 {
        return None;
    }
    let year = parse_digits(date.get(0..4)?)? as i64;
    let month = parse_digits(date.get(5..7)?)? as i64;
    let day = parse_digits(date.get(8..10)?)? as i64;
    if date.as_bytes().get(4) != Some(&b'-') || date.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let hour = parse_digits(time.get(0..2)?)? as i64;
    let minute = parse_digits(time.get(3..5)?)? as i64;
    let second = parse_digits(time.get(6..8)?)? as i64;
    if time.as_bytes().get(2) != Some(&b':')
        || time.as_bytes().get(5) != Some(&b':')
        || hour > 23
        || minute > 59
        || second > 59
        || !valid_date(year, month, day)
    {
        return None;
    }
    let millis = match time.get(8..) {
        Some("") => 0,
        Some(fraction) => {
            let digits = fraction.strip_prefix('.')?;
            if digits.is_empty()
                || digits.len() > 9
                || !digits.bytes().all(|byte| byte.is_ascii_digit())
            {
                return None;
            }
            let mut padded = digits
                .as_bytes()
                .iter()
                .copied()
                .take(3)
                .collect::<Vec<_>>();
            padded.resize(3, b'0');
            parse_digits(std::str::from_utf8(&padded).ok()?)?
        }
        None => return None,
    };
    let days = days_from_civil(year, month, day);
    if days < 0 {
        return None;
    }
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour.checked_mul(3_600)?)?
        .checked_add(minute.checked_mul(60)?)?
        .checked_add(second)?;
    u64::try_from(seconds)
        .ok()?
        .checked_mul(1_000)?
        .checked_add(millis)
}

fn parse_digits(value: &str) -> Option<u64> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

fn valid_date(year: i64, month: i64, day: i64) -> bool {
    if year < 1970 || !(1..=12).contains(&month) {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (1..=days).contains(&day)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
#[path = "arcee_bootstrap_tests.rs"]
mod tests;
