use anyhow::Result;
use nac_core::{
    mixed_mode::{MixedModeConfig, MixedTierSettings},
    model::{provider_for_model, BackendKind},
    runtime::CredentialDestinationPolicy,
};

use crate::{enforce_trusted_base_url, nonblank_request_string};

/// A top-level generated credential which matching tiers may inherit. During
/// rotation, `previous` identifies references that should follow the new key.
#[derive(Clone, Copy)]
pub(crate) struct InheritedCredential<'a> {
    pub backend: BackendKind,
    pub name: &'a str,
    pub previous: Option<&'a str>,
}

fn normalize_tier(
    tier: MixedTierSettings,
    label: &str,
    policy: &CredentialDestinationPolicy,
    inherited: Option<InheritedCredential<'_>>,
) -> Result<MixedTierSettings> {
    let model = nonblank_request_string(tier.model, &format!("mixed_models.{label}.model"))?;
    let base_url = tier
        .base_url
        .map(|value| nonblank_request_string(value, &format!("mixed_models.{label}.base_url")))
        .transpose()?;
    let tier_backend = tier.backend.or_else(|| provider_for_model(&model));
    enforce_trusted_base_url(tier_backend, base_url.as_deref(), policy)?;
    let inherit = inherited.is_some_and(|credential| {
        Some(credential.backend) == tier_backend
            && (tier.api_key_env.is_none() || tier.api_key_env.as_deref() == credential.previous)
    });
    let api_key_env = if inherit {
        inherited.map(|credential| credential.name.to_string())
    } else {
        tier.api_key_env
    };
    Ok(MixedTierSettings {
        model,
        backend: tier.backend,
        base_url,
        api_key_env,
        reasoning_effort: tier.reasoning_effort,
    })
}

/// Normalize and destination-check all tiers before persistence or launch.
pub(crate) fn normalize(
    request: MixedModeConfig,
    policy: &CredentialDestinationPolicy,
    inherited: Option<InheritedCredential<'_>>,
) -> Result<MixedModeConfig> {
    Ok(MixedModeConfig {
        easy: normalize_tier(request.easy, "easy", policy, inherited)?,
        medium: normalize_tier(request.medium, "medium", policy, inherited)?,
        hard: normalize_tier(request.hard, "hard", policy, inherited)?,
    })
}

/// Every credential selector the tiers name, for retirement accounting.
/// Rotation only follows tiers on the new primary backend, so a superseded
/// generated key may stay referenced (backend switched, or auth moved off API
/// keys) and must then outlive the update.
pub(crate) fn tier_credentials(mixed: &MixedModeConfig) -> impl Iterator<Item = &str> {
    [&mixed.easy, &mixed.medium, &mixed.hard]
        .into_iter()
        .filter_map(|tier| tier.api_key_env.as_deref())
}

/// Rotate inherited tier references when a saved configuration's generated
/// top-level credential changes.
pub(crate) fn rotate_inherited_credential(
    mixed: &mut MixedModeConfig,
    credential: InheritedCredential<'_>,
) {
    for tier in [&mut mixed.easy, &mut mixed.medium, &mut mixed.hard] {
        let tier_backend = tier
            .backend
            .or_else(|| provider_for_model(tier.model.as_str()));
        if tier_backend == Some(credential.backend)
            && (tier.api_key_env.is_none() || tier.api_key_env.as_deref() == credential.previous)
        {
            tier.api_key_env = Some(credential.name.to_string());
        }
    }
}
