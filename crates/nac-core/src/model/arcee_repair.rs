//! Managed Arcee credential-repair transaction.
//!
//! The opaque repair capability is stored separately from rotating auth so
//! logout and invalid-grant cleanup cannot destroy the only repair path. The
//! capability never enters `Debug`, errors, status, or model-visible state.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use nac_credential_store::{
    read_auth_bytes_from_path, with_credential_lock, write_auth_string_to_path,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::arcee::{
    validate_arcee_auth_issuer, validate_stored_base_url, ManagedArceeRepairBinding,
    ManagedBootstrapProvenance, StoredArceeAuth, MANAGED_CLIENT_ID,
};
use super::arcee_bootstrap::{read_receipt, BootstrapReceipt, ReceiptDisposition, ReceiptState};
use super::auth_store::{
    arcee_auth_file_path, arcee_auth_lock_path, arcee_managed_bootstrap_receipt_path,
    arcee_managed_repair_capability_path,
};

pub(super) const REPAIR_CAPABILITY_VERSION: u32 = 1;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RepairCapability {
    pub(super) version: u32,
    pub(super) bootstrap_id: Uuid,
    pub(super) managed_host_id: Uuid,
    pub(super) repair_intent: String,
}

#[derive(Clone, Copy)]
pub(super) struct AuthorizationPaths<'a> {
    pub(super) auth: &'a Path,
    pub(super) receipt: &'a Path,
    pub(super) repair: &'a Path,
    pub(super) lock: &'a Path,
}

/// Durable managed identity and opaque repair capability captured before an
/// interactive repair. Completion revalidates every field under the credential
/// lock before it may write provider-returned tokens. Its `Debug` output
/// deliberately omits the repair secret.
pub(super) struct ManagedArceeRepairContext {
    expected_managed_host_id: Uuid,
    expected_base_url: String,
    expected_auth_issuer: String,
    bootstrap_id: Uuid,
    repair_intent: String,
    auth_path: PathBuf,
    receipt_path: PathBuf,
    repair_path: PathBuf,
    lock_path: PathBuf,
}

impl std::fmt::Debug for ManagedArceeRepairContext {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedArceeRepairContext")
            .field("expected_managed_host_id", &self.expected_managed_host_id)
            .field("expected_base_url", &self.expected_base_url)
            .field("expected_auth_issuer", &self.expected_auth_issuer)
            .field("bootstrap_id", &self.bootstrap_id)
            .finish_non_exhaustive()
    }
}

impl ManagedArceeRepairContext {
    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_issuer(&self) -> &str {
        &self.expected_auth_issuer
    }

    pub(super) fn repair_intent(&self) -> &str {
        &self.repair_intent
    }
}

pub(super) fn prepare_managed_arcee_repair(
    expected_managed_host_id: &str,
    expected_base_url: &str,
    expected_auth_issuer: &str,
) -> Result<ManagedArceeRepairContext> {
    let auth = arcee_auth_file_path()?;
    let receipt = arcee_managed_bootstrap_receipt_path()?;
    let repair = arcee_managed_repair_capability_path()?;
    let lock = arcee_auth_lock_path()?;
    prepare_managed_arcee_repair_with_paths(
        expected_managed_host_id,
        expected_base_url,
        expected_auth_issuer,
        AuthorizationPaths {
            auth: &auth,
            receipt: &receipt,
            repair: &repair,
            lock: &lock,
        },
    )
}

pub(super) fn complete_managed_arcee_repair(
    context: &ManagedArceeRepairContext,
    auth: StoredArceeAuth,
    binding: Option<ManagedArceeRepairBinding>,
) -> Result<StoredArceeAuth> {
    complete_managed_arcee_repair_with_paths(
        context,
        auth,
        binding,
        AuthorizationPaths {
            auth: &context.auth_path,
            receipt: &context.receipt_path,
            repair: &context.repair_path,
            lock: &context.lock_path,
        },
    )
}

pub(super) fn prepare_managed_arcee_repair_with_paths(
    expected_managed_host_id: &str,
    expected_base_url: &str,
    expected_auth_issuer: &str,
    paths: AuthorizationPaths<'_>,
) -> Result<ManagedArceeRepairContext> {
    let expected_host = Uuid::parse_str(expected_managed_host_id)
        .map_err(|_| anyhow!("managed logical_host_id must be a UUID for managed repair"))?;
    validate_stored_base_url(expected_base_url)
        .map_err(|_| anyhow!("managed model endpoint is not approved for Arcee repair"))?;
    validate_arcee_auth_issuer(expected_auth_issuer)
        .map_err(|_| anyhow!("managed expected auth issuer is not approved"))?;

    with_credential_lock(paths.lock, || {
        let receipt = require_repair_receipt(paths.receipt, expected_host)?;
        let capability = require_repair_capability(paths.repair, &receipt)?;
        require_empty_repair_target(paths.auth)?;
        Ok(ManagedArceeRepairContext {
            expected_managed_host_id: expected_host,
            expected_base_url: expected_base_url.to_string(),
            expected_auth_issuer: expected_auth_issuer.to_string(),
            bootstrap_id: receipt.bootstrap_id,
            repair_intent: capability.repair_intent,
            auth_path: paths.auth.to_path_buf(),
            receipt_path: paths.receipt.to_path_buf(),
            repair_path: paths.repair.to_path_buf(),
            lock_path: paths.lock.to_path_buf(),
        })
    })
}

pub(super) fn complete_managed_arcee_repair_with_paths(
    context: &ManagedArceeRepairContext,
    mut auth: StoredArceeAuth,
    binding: Option<ManagedArceeRepairBinding>,
    paths: AuthorizationPaths<'_>,
) -> Result<StoredArceeAuth> {
    with_credential_lock(paths.lock, || {
        let receipt = require_repair_receipt(paths.receipt, context.expected_managed_host_id)?;
        if receipt.bootstrap_id != context.bootstrap_id {
            bail!("managed Arcee repair receipt changed while authorization was pending");
        }
        let capability = require_repair_capability(paths.repair, &receipt)?;
        if capability.repair_intent != context.repair_intent {
            bail!("managed Arcee repair capability changed while authorization was pending");
        }
        require_empty_repair_target(paths.auth)?;

        let binding = binding.ok_or_else(|| {
            anyhow!("managed Arcee repair response did not include required binding proof")
        })?;
        validate_repair_binding(context, &receipt, &auth, binding)?;

        if auth.auth_issuer != context.expected_auth_issuer {
            bail!("managed Arcee repair authorization issuer does not match managed configuration");
        }
        if auth.access_token.trim().is_empty()
            || auth.refresh_token.trim().is_empty()
            || auth.token_type != "bearer"
            || auth.organization_id.trim().is_empty()
            || auth.workspace_name.trim().is_empty()
        {
            bail!("managed Arcee repair returned a structurally invalid authorization");
        }

        auth.client_id = MANAGED_CLIENT_ID.to_string();
        auth.managed_bootstrap = Some(ManagedBootstrapProvenance {
            bootstrap_id: receipt.bootstrap_id,
            managed_host_id: receipt.managed_host_id,
        });
        write_stored_auth_to_path(paths.auth, &auth)?;
        Ok(auth)
    })
}

fn validate_repair_binding(
    context: &ManagedArceeRepairContext,
    receipt: &BootstrapReceipt,
    auth: &StoredArceeAuth,
    binding: ManagedArceeRepairBinding,
) -> Result<()> {
    let managed_host_id = Uuid::parse_str(&binding.managed_host_id)
        .map_err(|_| anyhow!("managed Arcee repair binding managed_host_id is invalid"))?;
    let bootstrap_id = Uuid::parse_str(&binding.bootstrap_id)
        .map_err(|_| anyhow!("managed Arcee repair binding bootstrap_id is invalid"))?;
    if managed_host_id != context.expected_managed_host_id
        || managed_host_id != receipt.managed_host_id
    {
        bail!("managed Arcee repair binding belongs to a different logical host");
    }
    if bootstrap_id != context.bootstrap_id || bootstrap_id != receipt.bootstrap_id {
        bail!("managed Arcee repair binding does not match the bootstrap receipt");
    }
    if binding.host_incarnation_id.trim().is_empty() {
        bail!("managed Arcee repair binding has no host incarnation");
    }
    validate_arcee_auth_issuer(&binding.auth_issuer)
        .map_err(|_| anyhow!("managed Arcee repair binding auth issuer is not approved"))?;
    if binding.auth_issuer != context.expected_auth_issuer
        || binding.auth_issuer != auth.auth_issuer
    {
        bail!("managed Arcee repair binding auth issuer does not match managed configuration");
    }

    let expected_url = validate_stored_base_url(&context.expected_base_url)
        .map_err(|_| anyhow!("managed model endpoint is not approved for Arcee repair"))?;
    let binding_url = validate_stored_base_url(&binding.inference_base_url)
        .map_err(|_| anyhow!("managed Arcee repair binding inference URL is invalid"))?;
    let returned_url = validate_stored_base_url(&auth.base_url)
        .map_err(|_| anyhow!("managed Arcee repair returned an invalid inference URL"))?;
    if binding_url != expected_url || returned_url != binding_url {
        bail!("managed Arcee repair binding inference URL does not match managed configuration");
    }
    Ok(())
}

fn require_repair_receipt(path: &Path, expected_host: Uuid) -> Result<BootstrapReceipt> {
    let receipt = match read_receipt(path)? {
        ReceiptState::Valid(receipt) => receipt,
        ReceiptState::Missing => {
            bail!("managed Arcee repair requires its durable bootstrap receipt")
        }
        ReceiptState::Invalid => bail!("managed Arcee repair bootstrap receipt is invalid"),
    };
    if receipt.managed_host_id != expected_host {
        bail!("managed Arcee repair receipt belongs to a different logical host");
    }
    if !matches!(receipt.disposition, ReceiptDisposition::Imported) {
        bail!("managed Arcee repair receipt has no imported credential provenance");
    }
    Ok(receipt)
}

fn require_repair_capability(path: &Path, receipt: &BootstrapReceipt) -> Result<RepairCapability> {
    let capability = read_repair_capability(path)?.ok_or_else(|| {
        anyhow!("managed Arcee repair capability is unavailable; reprovision this managed host")
    })?;
    if capability.bootstrap_id != receipt.bootstrap_id
        || capability.managed_host_id != receipt.managed_host_id
    {
        bail!("managed Arcee repair capability does not match its bootstrap receipt");
    }
    Ok(capability)
}

fn require_empty_repair_target(path: &Path) -> Result<()> {
    match read_auth_bytes_from_path(path) {
        Ok(None) => Ok(()),
        Ok(Some(_)) => bail!(
            "managed Arcee repair will not replace an existing credential; log out before starting repair"
        ),
        Err(_) => bail!(
            "managed Arcee repair cannot safely inspect the credential path; correct or remove it before retrying"
        ),
    }
}

pub(super) fn read_repair_capability(path: &Path) -> Result<Option<RepairCapability>> {
    let raw = match read_auth_bytes_from_path(path) {
        Ok(Some(raw)) => raw,
        Ok(None) => return Ok(None),
        Err(_) => bail!("managed Arcee repair capability cannot be read safely"),
    };
    let capability = serde_json::from_slice::<RepairCapability>(&raw)
        .map_err(|_| anyhow!("managed Arcee repair capability is invalid"))?;
    if capability.version != REPAIR_CAPABILITY_VERSION {
        bail!("managed Arcee repair capability is invalid");
    }
    validate_repair_intent(&capability.repair_intent)
        .map_err(|_| anyhow!("managed Arcee repair capability is invalid"))?;
    Ok(Some(capability))
}

pub(super) fn write_repair_capability(path: &Path, capability: &RepairCapability) -> Result<()> {
    let raw = serde_json::to_string_pretty(capability)
        .context("failed to serialize managed Arcee repair capability")?;
    write_auth_string_to_path(path, &raw)
        .context("failed to persist managed Arcee repair capability")
}

pub(super) fn validate_repair_intent(repair_intent: &str) -> Result<()> {
    let length = repair_intent.chars().count();
    if !(32..=512).contains(&length) {
        bail!("managed Arcee bootstrap repair_intent has an invalid length");
    }
    Ok(())
}

fn write_stored_auth_to_path(path: &Path, auth: &StoredArceeAuth) -> Result<()> {
    let raw = serde_json::to_string_pretty(auth)
        .context("failed to serialize imported managed Arcee credential")?;
    write_auth_string_to_path(path, &raw)
        .context("failed to persist imported managed Arcee credential")
}
