use anyhow::Result;
use nac_core::{
    light_model::LightModelSettings,
    model::{provider_for_model, BackendKind},
    runtime::CredentialDestinationPolicy,
};

use crate::{enforce_trusted_base_url, nonblank_request_string};

/// A top-level generated credential the light model may inherit. During
/// rotation, `previous` identifies references that should follow the new key.
#[derive(Clone, Copy)]
pub(crate) struct InheritedCredential<'a> {
    pub backend: BackendKind,
    pub name: &'a str,
    pub previous: Option<&'a str>,
}

/// Normalize and destination-check the light model before persistence or
/// launch.
pub(crate) fn normalize(
    light: LightModelSettings,
    policy: &CredentialDestinationPolicy,
    inherited: Option<InheritedCredential<'_>>,
) -> Result<LightModelSettings> {
    let mut light = LightModelSettings {
        model: nonblank_request_string(light.model, "light_model.model")?,
        base_url: light
            .base_url
            .map(|value| nonblank_request_string(value, "light_model.base_url"))
            .transpose()?,
        ..light
    };
    enforce_trusted_base_url(
        light.backend.or_else(|| provider_for_model(&light.model)),
        light.base_url.as_deref(),
        policy,
    )?;
    if let Some(credential) = inherited {
        rotate_inherited_credential(&mut light, credential);
    }
    Ok(light)
}

/// Rotate an inherited light-model reference when a generated top-level
/// credential is issued or changes. Only a light model on the same backend
/// follows the new key, and never one holding an unrelated explicit selector.
pub(crate) fn rotate_inherited_credential(
    light: &mut LightModelSettings,
    credential: InheritedCredential<'_>,
) {
    let light_backend = light
        .backend
        .or_else(|| provider_for_model(light.model.as_str()));
    if light_backend == Some(credential.backend)
        && (light.api_key_env.is_none() || light.api_key_env.as_deref() == credential.previous)
    {
        light.api_key_env = Some(credential.name.to_string());
    }
}
