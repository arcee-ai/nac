//! Nonsecret controller binding for the opt-in managed static-key profile.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};

use crate::configuration::{ManagedHostConfig, ManagedModelCredentialSource};

pub const HOST_KEY_MANAGED_CONFIG_VERSION: u32 = 3;

/// Configuration is a trust source, never a bootstrap/provider verification result.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManagedHostKeyConfig {
    pub bootstrap_id: String,
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub pvc_uid: String,
    pub organization_id: String,
    pub owner_epoch: u64,
    pub key_generation: u64,
    pub local_key_id: String,
    pub key_id: String,
    pub clerk_instance_id: String,
    pub inference_origin: String,
}

pub(crate) fn validate_host_key_configuration(host: &ManagedHostConfig) -> Result<()> {
    let selected = host.model_credential_source == ManagedModelCredentialSource::ManagedHostKey;
    match (selected, &host.managed_host_key) {
        (false, None) => return Ok(()),
        (false, Some(_)) => {
            bail!("managed_host_key requires the managed-host-key credential source")
        }
        (true, None) => bail!("managed-host-key requires its trusted binding"),
        (true, Some(_)) => {}
    }
    if host.version != HOST_KEY_MANAGED_CONFIG_VERSION
        || host.model_backend != "arcee-api"
        || host.model_auth_issuer.is_some()
        || !host.model_credential_environment_names.is_empty()
        || host.model_credential_file != std::path::Path::new("/run/secrets/nac/bootstrap.json")
    {
        bail!("managed-host-key requires version 3, arcee-api and the fixed bootstrap path without issuer/environment selectors");
    }
    let binding = host
        .managed_host_key
        .as_ref()
        .ok_or_else(|| anyhow!("managed host-key binding is unavailable"))?;
    if binding.managed_host_id != host.logical_host_id
        || Some(&binding.host_incarnation_id) != host.host_incarnation_id.as_ref()
        || binding.inference_origin != host.model_endpoint
    {
        bail!("managed host-key binding does not match the host configuration");
    }
    for value in [
        &binding.bootstrap_id,
        &binding.managed_host_id,
        &binding.organization_id,
        &binding.local_key_id,
    ] {
        let id = uuid::Uuid::parse_str(value)
            .map_err(|_| anyhow!("managed host-key identity must be a canonical UUID"))?;
        if id.to_string() != *value {
            bail!("managed host-key identity must be a canonical UUID");
        }
    }
    for value in [
        &binding.host_incarnation_id,
        &binding.pvc_uid,
        &binding.key_id,
        &binding.clerk_instance_id,
    ] {
        if value.is_empty()
            || value.len() > 256
            || value.chars().any(char::is_whitespace)
            || value.chars().any(char::is_control)
        {
            bail!("managed host-key identity is invalid");
        }
    }
    if binding.owner_epoch == 0
        || binding.key_generation == 0
        || binding.owner_epoch > i64::MAX as u64
        || binding.key_generation > i64::MAX as u64
    {
        bail!("managed host-key generations must be positive signed 64-bit integers");
    }
    let origin = url::Url::parse(&binding.inference_origin)
        .map_err(|_| anyhow!("managed host-key origin is invalid"))?;
    if origin.scheme() != "https"
        || origin.origin().ascii_serialization() != binding.inference_origin
    {
        bail!("managed host-key origin must be an exact HTTPS origin");
    }
    Ok(())
}

#[cfg(test)]
#[path = "host_key_configuration_tests.rs"]
mod tests;
