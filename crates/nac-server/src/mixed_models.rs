use anyhow::Result;
use nac_core::{
    mixed_mode::{MixedModeConfig, MixedTierSettings},
    model::{provider_for_model, BackendKind, ReasoningEffort},
    runtime::CredentialDestinationPolicy,
};
use serde::Deserialize;

use crate::{enforce_trusted_base_url, nonblank_request_string};

/// One mixed tier's model identity as a request names it. The credential is
/// an environment/stored-credential name, never a key value.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MixedTierRequest {
    pub model: String,
    #[serde(default)]
    pub backend: Option<BackendKind>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<ReasoningEffort>,
}

/// Request representation of easy, medium, and hard dispatch models.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MixedModelsRequest {
    pub easy: MixedTierRequest,
    pub medium: MixedTierRequest,
    pub hard: MixedTierRequest,
}

/// A top-level generated credential which matching tiers may inherit. During
/// rotation, `previous` identifies references that should follow the new key.
#[derive(Clone, Copy)]
pub(crate) struct InheritedCredential<'a> {
    pub backend: BackendKind,
    pub name: &'a str,
    pub previous: Option<&'a str>,
}

fn normalize_tier(
    tier: MixedTierRequest,
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
    request: MixedModelsRequest,
    policy: &CredentialDestinationPolicy,
    inherited: Option<InheritedCredential<'_>>,
) -> Result<MixedModeConfig> {
    Ok(MixedModeConfig {
        easy: normalize_tier(request.easy, "easy", policy, inherited)?,
        medium: normalize_tier(request.medium, "medium", policy, inherited)?,
        hard: normalize_tier(request.hard, "hard", policy, inherited)?,
    })
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
