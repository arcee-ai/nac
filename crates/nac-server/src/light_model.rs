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
    let model = nonblank_request_string(light.model, "light_model.model")?;
    let base_url = light
        .base_url
        .map(|value| nonblank_request_string(value, "light_model.base_url"))
        .transpose()?;
    let light_backend = light.backend.or_else(|| provider_for_model(&model));
    enforce_trusted_base_url(light_backend, base_url.as_deref(), policy)?;
    let inherit = inherited.is_some_and(|credential| {
        Some(credential.backend) == light_backend
            && (light.api_key_env.is_none() || light.api_key_env.as_deref() == credential.previous)
    });
    let api_key_env = if inherit {
        inherited.map(|credential| credential.name.to_string())
    } else {
        light.api_key_env
    };
    Ok(LightModelSettings {
        model,
        backend: light.backend,
        base_url,
        api_key_env,
        reasoning_effort: light.reasoning_effort,
    })
}

/// The credential selector the light model names, for retirement accounting.
/// Rotation only follows a light model on the new primary backend, so a
/// superseded generated key may stay referenced (backend switched, or auth
/// moved off API keys) and must then outlive the update.
pub(crate) fn light_credential(light: &LightModelSettings) -> Option<&str> {
    light.api_key_env.as_deref()
}

/// Rotate an inherited light-model reference when a saved configuration's
/// generated top-level credential changes.
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
